'use strict';

/**
 * Department Deliveries (تسليمات الأقسام).
 *
 * A per-department reporting view built ON TOP of existing data — it does NOT
 * ingest anything new. For each client (keyed by normalized phone) it combines:
 *   - cs_sales_register (كشف العملاء, 2025+) → memberships + paid months per track
 *       (course-code classification; explicit transfer keeps a consumed/new split;
 *        client_transfer moves levels between clients; otherwise a valid
 *        new_courses IS the final membership — owner decisions 2026-06-20→07-13)
 *   - clients ⟕ batches (نشطة + orphans)     → active groups + coordinator
 *   - cs_completed_levels                    → inactive (past) groups (Drive level folders)
 *   - csClientPlan                           → pacing (completed count / last level date)
 *   - cs_client_delivery_status              → the MANUAL status (churned/postponed/exit_level/refund/active)
 *
 * Department placement (owner decision 2026-06-22): population per dept tab =
 * clients holding a live (non-refunded) membership in THAT track — a client can
 * appear on MORE THAN ONE tab (e.g. after a dept transfer: old dept keeps the
 * consumed levels, the new dept holds the new membership).
 *
 * No writes here except setDeliveryStatus (the manual status).
 */

const db = require('../config/database');
const { saveNow } = require('../config/database');
const { csPrimaryPhone } = require('../utils/csPhoneNormalize');
const { IGNORED_GROUP_PATTERNS, isIgnoredGroup, normName } = require('../utils/csGroupHelpers');
const { canonKey: bmCanon, slotKey: bmSlot } = require('../utils/csBatchMatch');

const DEPTS = ['General', 'Private', 'Semi'];
const STATUSES = ['active', 'churned', 'postponed', 'exit_level', 'refund'];

const stripSpaces = (s) => String(s == null ? '' : s).replace(/\s/g, '');

// Canonical group identity = the code BEFORE the first "(" (drops the
// "(trainer)" paren AND the trailing coordinator-name suffix), space-stripped.
// The coordinator suffix can differ between data sources for the SAME group:
// e.g. batches stores "...General1(Mariam Saad)Zainab" while the Drive level
// file stores "...General1(Mariam Saad)nasreen" after a coordinator handover.
// That suffix must NOT be part of the dedup key — otherwise ONE real group
// shows up in BOTH the active and inactive columns (and double-counts a level).
const canonGroupKey = (s) => stripSpaces(String(s == null ? '' : s).split('(')[0]);

// Group cells in the level Excel store the group code PLUS a trailing status
// word (e.g. "May_16_..._Starter3(Esraa Hani)hanaa نشطة" or "...إنتهت"). Strip
// the status (and take the first line) so the code matches the clean
// batches.group_name for both dedup AND display.
const STATUS_WORD_RE = /\s*(نشطة|نشطه|إنتهت|انتهت|منته\S*|ملغا\S*|active|ended|closed)\s*$/i;
function cleanGroupCode(raw) {
  let s = String(raw == null ? '' : raw).split(/[\r\n]+/)[0].trim();
  s = s.replace(STATUS_WORD_RE, '').trim();   // strip a trailing status word…
  s = s.replace(STATUS_WORD_RE, '').trim();   // …twice in case two are appended
  return s;
}

// IGNORED_GROUP_PATTERNS / isIgnoredGroup / normName now come from
// ../utils/csGroupHelpers (shared with csEnrGroups & csEnrTransition).

// Drop inactive (past) groups that are really the client's CURRENT group under
// a stale name. Two signals, both per-client: exact canon (month-normalized,
// case-insensitive) OR same SLOT (month+weekday+time+level) as an active group.
// A level lasts ~a month, so one client can never consume the same level twice
// in the same slot — a renamed group (Jul_20 → Jul_13(Israa), owner case
// 01014885850) or a wrong day-of-month in the level file would otherwise count
// twice (once active + once past). MUST be used identically by membershipBalance
// AND the page loop so the audit invariant (balance == page) holds.
function dropActiveTwins(activeGroups, inactiveList) {
  if (!inactiveList.length || !activeGroups.length) return inactiveList;
  const keys = new Set(activeGroups.map(bmCanon));
  const slots = new Set(activeGroups.map(bmSlot).filter(Boolean));
  return inactiveList.filter(g => {
    if (keys.has(bmCanon(g))) return false;
    const sk = bmSlot(g);
    return !(sk && slots.has(sk));
  });
}

// Does a (possibly comma-separated) coordinator string contain this person?
// Coordinator names are stored inconsistently: users.full_name 'Radwa Gamal' vs
// batches.coordinators 'RadwaGamal'. Match on the spaced form OR a space-stripped
// compact key so the internal-space variant still matches (an agent was being
// scoped to ZERO clients because of this).
function coordStrHasName(coordStr, targetNorm) {
  if (!targetNorm) return false;
  const targetCompact = targetNorm.replace(/\s+/g, '');
  return String(coordStr || '').split(',').map(normName).some(c => {
    if (!c) return false;
    return c === targetNorm || c.replace(/\s+/g, '') === targetCompact;
  });
}

// phone_norm → [{ group_name, dept_type, coordinators }] for groups still active.
function buildActiveGroupMap() {
  // Active memberships = clients in a group with an active batch (status='نشطة')
  // OR in a group that has NO batches row at all ("orphan" groups — a live group
  // present in the trainees sheet but missing from the batches sheet; e.g. renamed
  // then dropped on a sync). Using a LEFT JOIN + orphan clause instead of an INNER
  // JOIN so such a membership isn't lost (same principle as the ENDED-groups rule).
  // Orphans have no dept_type/coordinators → they fall back like ended groups do.
  const rows = db.prepare(`
    SELECT c.phone AS phone, c.group_name AS group_name, c.line AS line,
           b.dept_type AS dept_type, b.coordinators AS coordinators
      FROM clients c
      LEFT JOIN batches b
        ON b.group_name = c.group_name AND b.line = c.line AND b.status = 'نشطة'
     WHERE b.id IS NOT NULL
        OR NOT EXISTS (SELECT 1 FROM batches bb WHERE bb.group_name = c.group_name AND bb.line = c.line)
  `).all();
  const map = new Map();
  for (const r of rows) {
    const pn = csPrimaryPhone(r.phone);
    if (!pn) continue;
    if (isIgnoredGroup(r.group_name)) continue;   // skip placeholder groups (Free Slots, …)
    if (!map.has(pn)) map.set(pn, []);
    map.get(pn).push({ group_name: r.group_name, line: r.line, dept_type: r.dept_type, coordinators: r.coordinators });
  }
  return map;
}

// Per active group: lecture count + first/last lecture date, taken from the
// `lectures` table directly (NOT the batches report — owner's decision). Scope:
// MAIN sessions only (side/zoom excluded), status مؤكدة + مجدولة ("all registered
// on the system"). COUNT(DISTINCT date|time) collapses the ~40% rename twins so a
// group isn't over-counted. Memoized per (group_name, line) for the page slice.
function makeGroupLectureMeta() {
  const stmt = db.prepare(`
    SELECT COUNT(DISTINCT date || '|' || time) AS cnt, MIN(date) AS mn, MAX(date) AS mx
      FROM lectures
      INNER JOIN (SELECT group_name AS g, line AS l, date(MAX(synced_at)) AS sd
                    FROM lectures WHERE session_type='main' GROUP BY group_name, line) ls
        ON ls.g = lectures.group_name AND ls.l = lectures.line
       AND date(lectures.synced_at) = ls.sd
     WHERE group_name = ? AND line = ?
       AND session_type = 'main' AND status IN ('مؤكدة', 'مجدولة')
  `);
  const memo = new Map();
  return (group, line) => {
    const key = String(group) + '' + String(line || '');
    if (memo.has(key)) return memo.get(key);
    const r = stmt.get(group, line || '') || {};
    const meta = { lectures: r.cnt || 0, start_date: r.mn || null, end_date: r.mx || null };
    memo.set(key, meta);
    return meta;
  };
}

// phone_norm → Set(group codes) of PAST (consumed-level) groups. Two sources:
//   1) cs_completed_levels — the Drive level files (authoritative up to May 2026)
//   2) cs_client_group_history — permanent roster memory from the daily trainees
//      sheets; counts ONLY groups that already ENDED (dropped off the batches
//      sheet). Active/waiting groups stay on the active path. This closes the
//      gap where a June+ group ends and vanishes from both sources (owner
//      2026-07-14: a member of a group counts even if he was absent).
// Per-phone dedup is by CANON key, so name variants of one group count once.
// Groups the OWNER has confirmed as deleted (cs_deleted_groups, status=confirmed)
// are dropped — they were opened then removed by management, so they never counted
// as a consumed level. ONLY owner-confirmed keys are excluded (human is the gate).
function buildInactiveGroupMap() {
  // One canon function for EVERYTHING here (dedup, deleted-keys, live-batch):
  // csBatchMatch.canonKey also normalizes month spellings/typos, so "Jnu_14_…"
  // and "Jun_14_…" (same real group, typo'd in some daily sheets) count ONCE
  // (live bug 2026-07-15: a client showed 7 taken instead of 6).
  const { canonKey: canonOf, slotKey: slotOf } = require('../utils/csBatchMatch');
  let deletedKeys = new Set();
  try { deletedKeys = require('./csDeletedGroups.service').getConfirmedKeys(); } catch (_) { /* optional */ }
  const map = new Map();            // pn → Set(code)  (returned)
  const canons = new Map();         // pn → Set(canon) (dedup guard)
  const slots = new Map();          // pn → Set(slot)  (2nd dedup guard)
  const add = (pn, code) => {
    const ck = canonOf(code);
    if (deletedKeys.size && deletedKeys.has(ck)) return;         // owner-confirmed deleted
    let cs = canons.get(pn);
    if (!cs) { cs = new Set(); canons.set(pn, cs); slots.set(pn, new Set()); map.set(pn, new Set()); }
    if (cs.has(ck)) return;                                       // one entry per real group
    // SLOT guard: the SAME real group can be written with a wrong day-of-month
    // in one source (level file says Jun_20, the sheets say Jun_13 — owner-
    // confirmed case). A level lasts ~a month, so one client can never take the
    // same level twice at the same month+weekday+time slot — same slot within
    // one client ⇒ same group. (Repeats live in different months/slots.)
    const sk = slotOf(code);
    if (sk && slots.get(pn).has(sk)) return;
    cs.add(ck);
    if (sk) slots.get(pn).add(sk);
    map.get(pn).add(code);
  };

  // ── PRE-START REMOVALS (computed FIRST — applies to BOTH sources) ──────────
  // A client who vanished from a group's roster BEFORE its nominal start never
  // took that level (owner cases 01012965657 Jul_4, 01112806182 Jnu_21). The
  // level files can carry the client's ORIGINAL registration group even after
  // such a move, so the roster evidence overrides the file's stale group cell.
  const preStartRemoved = new Set();   // 'pn|canon'
  let histRows = [], liveBatch = new Set();
  try {
    liveBatch = new Set(
      db.prepare(`SELECT group_name FROM batches WHERE group_name IS NOT NULL`).all()
        .map(b => canonOf(b.group_name))
    );
    const { groupNameDate } = require('../utils/csBatchMatch');
    histRows = db.prepare(`
      SELECT client_phone_norm AS pn, group_name_raw AS g, last_seen AS ls
        FROM cs_client_group_history
    `).all();
    // Per group: the latest roster day ANY member was seen on — by canon AND by
    // SLOT (a renamed group, e.g. General1 → General1_SP, keeps its slot, so the
    // slot map proves the group really continued under its new name).
    const groupMaxSeen = new Map(), slotMaxSeen = new Map();
    for (const r of histRows) {
      if (!r.ls) continue;
      const ck = canonOf(r.g);
      if (!groupMaxSeen.has(ck) || r.ls > groupMaxSeen.get(ck)) groupMaxSeen.set(ck, r.ls);
      const sk = bmSlot(r.g);
      if (sk && (!slotMaxSeen.has(sk) || r.ls > slotMaxSeen.get(sk))) slotMaxSeen.set(sk, r.ls);
    }
    // Nominal start date from the group NAME (Jul_4 → YYYY-07-04); year inferred
    // as the candidate closest to the client's roster window.
    const startISO = (code, refDate) => {
      const d = groupNameDate(code);
      if (!d || !refDate) return null;
      const y = +String(refDate).slice(0, 4);
      if (!y) return null;
      let best = null, bestDiff = Infinity;
      for (const yy of [y - 1, y, y + 1]) {
        const iso = `${yy}-${String(d.mon).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
        const diff = Math.abs(new Date(iso) - new Date(refDate));
        if (diff < bestDiff) { bestDiff = diff; best = iso; }
      }
      return best;
    };
    for (const r of histRows) {
      if (!r.pn || !r.ls) continue;
      const code = cleanGroupCode(r.g);
      if (!code) continue;
      const ck = canonOf(code);
      // The client vanished from the roster BEFORE the nominal start while the
      // group (or its slot — renames/date-typos) kept appearing on later sheets.
      // (A client who stays enrolled counts even if absent — different case.)
      const st = startISO(code, r.ls);
      const groupWentOn = ((groupMaxSeen.get(ck) || '') >= st) || ((slotMaxSeen.get(bmSlot(code)) || '') >= st);
      // GRACE: only judge groups whose start is ≥4 days in the past. Around a
      // start date the sheets lag a day or two, so a still-enrolled client of a
      // just-started group briefly looks "removed" — within days his roster
      // observation moves past the start and the flag resolves itself.
      const stale = st && (Date.now() - new Date(st).getTime()) >= 4 * 86400e3;
      if (st && stale && r.ls < st && groupWentOn) preStartRemoved.add(r.pn + '|' + ck);
    }
  } catch (_) { /* table may not exist on older deploys */ }

  for (const r of db.prepare(`
    SELECT client_phone_norm AS pn, group_name_raw AS g
      FROM cs_completed_levels
     WHERE group_name_raw IS NOT NULL AND TRIM(group_name_raw) != ''
  `).all()) {
    if (!r.pn) continue;
    const code = cleanGroupCode(r.g);     // strip status suffix + dedupe same group across levels
    if (!code || isIgnoredGroup(code)) continue;   // skip empty + placeholder groups (Free Slots, …)
    if (preStartRemoved.has(r.pn + '|' + canonOf(code))) continue;  // roster proves pre-start removal
    add(r.pn, code);
  }

  for (const r of histRows) {
    if (!r.pn) continue;
    const code = cleanGroupCode(r.g);
    if (!code || isIgnoredGroup(code)) continue;
    const ck = canonOf(code);
    if (liveBatch.has(ck)) continue;    // group still active/waiting → active path owns it
    if (preStartRemoved.has(r.pn + '|' + ck)) continue;
    add(r.pn, code);
  }

  return map;
}

// Set of phones whose كشف-العملاء memberships include an INTENSIVE course.
// Intensive levels run at a faster pace (2 weeks each) vs 1 month for regular.
// Intensive = the "Z P [N] L A" zoom-intensive codes (owner's list 2026-06-22:
// Z P 1/2/3/6/9 L A). "Z P 6 L K" is NOT a membership (already excluded).
function buildIntensiveSet() {
  const set = new Set();
  for (const r of db.prepare(`SELECT mobile_no AS m, courses AS c, new_courses AS nc, entry_date AS d FROM cs_sales_register WHERE mobile_no IS NOT NULL AND TRIM(mobile_no) <> ''`).all()) {
    if (salesYear(r.d) < 2025) continue;
    // Same final-membership principle as buildSalesMembershipMap: when the row
    // carries a valid NEW course, that's the client's effective membership —
    // so an upgrade INTO a "Z P … L A" code makes them intensive (and out of one
    // makes them regular).
    const effRaw = classifySalesCourse(r.nc).include ? r.nc : r.c;
    if (/^\s*Z\s*P\b/i.test(String(effRaw || '')) && classifySalesCourse(effRaw).include) {
      const pn = csPrimaryPhone(r.m);
      if (pn) set.add(pn);
    }
  }
  return set;
}

// Pace (days per level): intensive = 2 weeks, regular = 1 month.
const PACE_INTENSIVE_DAYS = 14;
const PACE_REGULAR_DAYS = 30;

// Add `days` to a YYYY-MM-DD reference (or today when missing) → YYYY-MM-DD.
function addDaysISO(refDateStr, days) {
  const base = refDateStr ? new Date(refDateStr) : new Date();
  if (isNaN(base.getTime())) return null;
  return new Date(base.getTime() + days * 86400000).toISOString().slice(0, 10);
}

// phone_norm → current coordinator name (cs_client_coordinator fallback).
function buildCoordFallbackMap() {
  const rows = db.prepare(`
    SELECT cc.client_phone_norm AS pn, tm.name AS name
      FROM cs_client_coordinator cc
      LEFT JOIN team_members tm ON tm.id = cc.coordinator_id
     WHERE cc.unassigned_at IS NULL
  `).all();
  const map = new Map();
  for (const r of rows) {
    if (r.pn && r.name && !map.has(r.pn)) map.set(r.pn, r.name);
  }
  return map;
}

// ─── Client Sales Register (كشف العملاء) = the membership source ───────────────
// (owner decision 2026-06-20) Memberships + months on the deliveries page now come
// from cs_sales_register, clients from 2025-01-01 on. The course code encodes BOTH
// the track and the level count: "[N]L G…"=General, "[N]L P…"=Private, "…2P/3P"=Semi,
// "Z P [N] L A"=Private; the N before "L" = months. Non-membership codes (Refund,
// Delay, Book, Shipping, Deposite, Session*, Bussines*, Conversation*, Topic, Your
// American, Z P 6 L K, Back Extral) are dropped. A client is treated as REFUNDED
// (left) on a track when their LATEST membership there is refunded — signalled by
// noted1/noted2~"refund" OR a Refund row (courses~"refund"/price<0) — and is then
// hidden from that track's tab. (verified classification: 0 unknown codes.)
const SALES_NON_MEMBERSHIP = /REFUND|DELAY|BOOK|SHIPPING|DEPOSIT|BACK\s*EXTRAL|SESSION|BUSSINES|BUSINESS|CONVERSATION|TOPIC|YOUR\s*AMERICAN|Z\s*P\s*6\s*L\s*K/i;
function salesYear(s) { const m = String(s == null ? '' : s).match(/(\d{4})/g); return m ? parseInt(m[m.length - 1], 10) : 0; }
function salesDateKey(s) {              // "M/D/YYYY" → sortable YYYYMMDD (0 if unparseable)
  const m = String(s == null ? '' : s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? (parseInt(m[3], 10) * 10000 + parseInt(m[1], 10) * 100 + parseInt(m[2], 10)) : 0;
}
const salesIsRefundRow  = (r) => /refund/i.test(String(r.courses || '')) || (r.price != null && Number(r.price) < 0);
const salesNotedRefunded = (r) => /refund/i.test(String(r.noted1 || '')) || /refund/i.test(String(r.noted2 || ''));
function classifySalesCourse(raw) {     // → { include, track, months }
  const u = String(raw == null ? '' : raw).toUpperCase();
  if (!u.trim() || SALES_NON_MEMBERSHIP.test(u)) return { include: false };
  const lm = u.match(/(\d+)\s*L(?:EVEL)?\b/);
  const months = lm ? parseInt(lm[1], 10) : null;
  let track = null;
  if (/[23]P/.test(u.replace(/\s/g, '')))            track = 'Semi';      // 2P / 3P = persons → Semi
  else if (/^Z\s*P\b/.test(u))                        track = 'Private';  // "Z P …" = zoom private
  else if (u.replace(/[0-9]+\s*P\b/, '').includes('P')) track = 'Private';
  else if (u.includes('G'))                           track = 'General';
  return { include: !!(months && track), track, months };
}
// phone → { name, byTrack: { <track>: { count, months, list, excludedRefund } } }
function buildSalesMembershipMap() {
  const rows = db.prepare(`
    SELECT mobile_no AS m, client_name AS name, courses AS c, entry_date AS d, noted1, noted2, price,
           op_type, new_courses, transfer_consumed_levels, transfer_total_levels,
           transfer_from_phone AS from_phone
      FROM cs_sales_register
     WHERE mobile_no IS NOT NULL AND TRIM(mobile_no) <> ''
  `).all();
  const scratch = new Map();   // pn -> { name, mems:[{track,months,key,refunded}], lastRefundKey }
  // Cross-client transfers ("نقل لعميل آخر"): the RECEIVER's row gains the moved
  // levels; the SENDER (transfer_from_phone) must LOSE them. We collect the sender
  // reductions here and apply them after every membership is tallied.
  const senderCaps = [];   // { phone, track, amount }
  for (const r of rows) {
    if (salesYear(r.d) < 2025) continue;
    const pn = csPrimaryPhone(r.m);
    if (!pn) continue;
    let s = scratch.get(pn);
    if (!s) { s = { name: r.name || null, mems: [], lastRefundKey: 0 }; scratch.set(pn, s); }
    if (!s.name && r.name) s.name = r.name;
    if (salesIsRefundRow(r)) { s.lastRefundKey = Math.max(s.lastRefundKey, salesDateKey(r.d)); continue; }
    const key = salesDateKey(r.d);
    const refunded = salesNotedRefunded(r);
    // CROSS-CLIENT TRANSFER ("نقل لعميل آخر"): this row belongs to the RECEIVER.
    // They gain the moved levels = (total − consumed) on the received membership's
    // track; the SENDER (transfer_from_phone) is capped by the same amount on the
    // OLD membership's track (applied after the tally). No membership value is
    // (re)booked as revenue here — only the transfer fee (handled by the money code).
    if (String(r.op_type || '').toLowerCase() === 'client_transfer') {
      const total    = Number(r.transfer_total_levels) || 0;
      const consumed = Number(r.transfer_consumed_levels) || 0;
      const moved    = Math.max(0, total - consumed);
      const oldCl    = classifySalesCourse(r.c);
      const recvCl   = classifySalesCourse(r.new_courses).include ? classifySalesCourse(r.new_courses) : oldCl;
      if (recvCl.track && moved > 0) s.mems.push({ track: recvCl.track, months: moved, key, refunded });
      const fromPn = csPrimaryPhone(r.from_phone);
      if (fromPn && oldCl.track && moved > 0) senderCaps.push({ phone: fromPn, track: oldCl.track, amount: moved });
      continue;
    }
    // TRANSFER: the old track keeps only the CONSUMED levels; the new membership
    // (new_courses) lands on the new track. So the client shows on both depts.
    if (String(r.op_type || '').toLowerCase() === 'transfer') {
      const oldCl = classifySalesCourse(r.c);
      const consumed = Number(r.transfer_consumed_levels) || 0;
      if (oldCl.track && consumed > 0) s.mems.push({ track: oldCl.track, months: consumed, key, refunded });
      const newCl = classifySalesCourse(r.new_courses);
      if (newCl.include) s.mems.push({ track: newCl.track, months: newCl.months, key, refunded });
      continue;
    }
    // UPGRADE / unmarked dept-change (owner decision 2026-07-13): a non-transfer
    // row carrying a VALID new course means the client's FINAL membership is the
    // NEW code — its track AND months win; the old course is just "بدأ بـ".
    // (Same principle as the documented upgrade rule; explicit transfers above
    // keep the consumed-levels split instead.) Live audit found 121 rows counted
    // on the WRONG dept + 138 counted with the OLD months before this rule.
    const newCl = classifySalesCourse(r.new_courses);
    const cl = newCl.include ? newCl : classifySalesCourse(r.c);
    if (!cl.include) continue;
    s.mems.push({ track: cl.track, months: cl.months, key, refunded });
  }
  const map = new Map();
  for (const [pn, s] of scratch) {
    const overallLatest = s.mems.reduce((mx, m) => Math.max(mx, m.key), 0);
    const byTrack = {};
    for (const t of DEPTS) {
      const mems = s.mems.filter(m => m.track === t);
      if (!mems.length) continue;
      const latest = mems.reduce((a, b) => (b.key >= a.key ? b : a), mems[0]);
      const latestRefunded = latest.refunded
        || (s.lastRefundKey > 0 && latest.key === overallLatest && s.lastRefundKey >= latest.key);
      const live = mems.filter(m => !m.refunded);
      byTrack[t] = {
        count: live.length,
        months: live.reduce((sum, m) => sum + (m.months || 0), 0),
        list: live.map(m => m.months),
        excludedRefund: latestRefunded,
      };
    }
    map.set(pn, { name: s.name, byTrack });
  }
  // Apply cross-client transfer reductions: the sender loses the moved levels on
  // the old track (floored at 0). Done after the tally so it works regardless of
  // row order (the sender's own membership rows may come after the transfer row).
  for (const cap of senderCaps) {
    const entry = map.get(cap.phone);
    if (entry && entry.byTrack[cap.track]) {
      const b = entry.byTrack[cap.track];
      b.months = Math.max(0, (b.months || 0) - cap.amount);
      // Keep the breakdown consistent with the capped total (audit invariant:
      // paid_months == Σ months_list) — the sender's original per-purchase list
      // no longer reflects what they hold after the transfer.
      b.list = b.months > 0 ? [b.months] : [];
    }
  }
  return map;
}

// ─── MEMBERSHIP LEVEL-BALANCE (shared) ─────────────────────────────────────────
// Reusable layer so the Enr Groups transition screen (and the renewal list) show
// the SAME "remaining levels" as the deliveries page — built from the SAME maps,
// NOT a second formula. Plus the "simulate next transfer" projection.

// Build the three source maps ONCE; pass the context to membershipBalance() so a
// caller iterating many clients doesn't rebuild them per row.
// ── Phone aliases (owner 2026-07-18): one client, TWO numbers ────────────────
// cs_client_codes.mobile_no2 (موبايل إضافي on the كشف العملاء codes tab) marks
// the SAME person: memberships bought under either number and groups taken
// under either number must merge into ONE client, keyed by the code's primary
// mobile_no (e.g. عائشة 01012121347: membership 3L under the primary, two of
// her three groups under 01210760663 — merged remaining = 0, not 2).
function buildPhoneAliasMap() {
  const map = new Map();   // secondaryNorm → primaryNorm
  try {
    for (const r of db.prepare(`
      SELECT mobile_no, mobile_no2 FROM cs_client_codes
       WHERE mobile_no2 IS NOT NULL AND TRIM(mobile_no2) <> ''`).all()) {
      const p = csPrimaryPhone(r.mobile_no), s = csPrimaryPhone(r.mobile_no2);
      if (p && s && p !== s) map.set(s, p);
    }
  } catch (_) { /* mobile_no2 may not exist on older DBs */ }
  return map;
}

// Fold every alias phone's data into its primary phone across the three maps.
// The alias key is DELETED so the client appears exactly once (the primary).
function foldPhoneAliases(ctx, alias) {
  if (!alias.size) return ctx;
  for (const [s, p] of alias) {
    // memberships — sum per track, skipping refunded sides (a refunded
    // membership must not add months; if one side is live the merged track is live)
    const src = ctx.salesMap.get(s);
    if (src) {
      const dst = ctx.salesMap.get(p);
      if (!dst) ctx.salesMap.set(p, src);
      else {
        for (const d of DEPTS) {
          const a = src.byTrack[d];
          if (!a) continue;
          const b = dst.byTrack[d];
          if (!b) dst.byTrack[d] = a;
          else if (b.excludedRefund && !a.excludedRefund) dst.byTrack[d] = a;
          else if (!b.excludedRefund && !a.excludedRefund) {
            b.months = (b.months || 0) + (a.months || 0);
            b.list = [...(b.list || []), ...(a.list || [])];
            b.count = (b.count || 0) + (a.count || 0);
          }
          // (a refunded, b live → keep b; both refunded → keep b)
        }
        if (!dst.name && src.name) dst.name = src.name;
      }
      ctx.salesMap.delete(s);
    }
    // active groups — concat
    const act = ctx.activeMap.get(s);
    if (act) {
      ctx.activeMap.set(p, [...(ctx.activeMap.get(p) || []), ...act]);
      ctx.activeMap.delete(s);
    }
    // past groups — union with the same canon+slot guards used everywhere,
    // so the same group under both numbers counts ONCE
    const ina = ctx.inactiveMap.get(s);
    if (ina) {
      const cur = ctx.inactiveMap.get(p) || new Set();
      const canons = new Set([...cur].map(bmCanon));
      const slots = new Set([...cur].map(bmSlot).filter(Boolean));
      for (const g of ina) {
        const ck = bmCanon(g);
        if (canons.has(ck)) continue;
        const sk = bmSlot(g);
        if (sk && slots.has(sk)) continue;
        cur.add(g); canons.add(ck); if (sk) slots.add(sk);
      }
      ctx.inactiveMap.set(p, cur);
      ctx.inactiveMap.delete(s);
    }
  }
  return ctx;
}

// Manual settlements (تسوية): Map('pn|dept' → {note, by, at}) of memberships
// CLOSED by an owner-approved deal (e.g. remaining levels converted to a
// Business level). A Map so the page can DISPLAY the reason/who/when; callers
// that only need membership (membershipBalance) use .has() as before. Keys are
// resolved through the phone-alias map so a settlement recorded under either
// of a client's numbers lands on the primary.
function buildSettledSet(alias) {
  const map = new Map();
  try {
    for (const r of db.prepare(`SELECT client_phone_norm pn, dept, note, settled_by_name, settled_at FROM cs_membership_settlements`).all()) {
      const p = csPrimaryPhone(r.pn);
      if (!p || !DEPTS.includes(r.dept)) continue;
      map.set(((alias && alias.get(p)) || p) + '|' + r.dept,
        { note: r.note || null, by: r.settled_by_name || null, at: r.settled_at || null });
    }
  } catch (_) { /* table may not exist on older deploys */ }
  return map;
}

// Manual per-client GROUP exclusions (owner-reviewed borderline journeys):
// Map('pn|canon' → {label, note, by, at}). Phones resolved through the alias map.
function buildGroupExclusions(alias) {
  const map = new Map();
  try {
    for (const r of db.prepare(`SELECT client_phone_norm pn, group_key, group_label, note, excluded_by_name, excluded_at FROM cs_client_group_exclusions`).all()) {
      const p = csPrimaryPhone(r.pn);
      if (!p || !r.group_key) continue;
      map.set(((alias && alias.get(p)) || p) + '|' + r.group_key,
        { label: r.group_label || r.group_key, note: r.note || null, by: r.excluded_by_name || null, at: r.excluded_at || null });
    }
  } catch (_) { /* table may not exist on older deploys */ }
  return map;
}

function buildBalanceContext() {
  const alias = buildPhoneAliasMap();
  const ctx = foldPhoneAliases({
    salesMap: buildSalesMembershipMap(),   // كشف العملاء (2025+) → per-dept paid months
    activeMap: buildActiveGroupMap(),       // clients ∩ batches(نشطة)
    inactiveMap: buildInactiveGroupMap(),   // cs_completed_levels (past groups)
  }, alias);
  ctx.settledSet = buildSettledSet(alias);  // 'pn|dept' → membership closed by settlement
  // Owner's manual group exclusions — applied AFTER the alias fold so a group
  // recorded under either of the client's numbers is caught. Removing the entry
  // here flows to the page, membershipBalance and renewals alike.
  ctx.groupExclusions = buildGroupExclusions(alias);
  for (const [key] of ctx.groupExclusions) {
    const cut = key.indexOf('|');
    const pn = key.slice(0, cut), ck = key.slice(cut + 1);
    const set = ctx.inactiveMap.get(pn);
    if (!set) continue;
    for (const g of [...set]) if (bmCanon(g) === ck) set.delete(g);
  }
  return ctx;
}

// Per-client membership balance in ONE department, computed EXACTLY like
// getDepartmentDeliveries (paid_months − groups_taken), PLUS the projection after
// moving the client into one more (next) group. MUST stay identical to the
// deliveries formula above — the audit asserts balance.remaining == the deliveries
// remaining_levels. Returns state 'unknown' (render '—') when the client has no
// live membership in this dept.
//   ctx:   from buildBalanceContext()
//   phone: raw phone (normalized inside)
//   dept:  'General' | 'Private' | 'Semi'  (the group's dept_type)
function membershipBalance(ctx, phone, dept) {
  const UNKNOWN = { paid_months: null, groups_taken: null, remaining: null, remaining_after_move: null, state: 'unknown' };
  const pn = csPrimaryPhone(phone);
  if (!pn || !DEPTS.includes(dept)) return UNKNOWN;
  const sales = ctx.salesMap.get(pn);
  const tm = sales && sales.byTrack[dept];
  if (!tm || tm.excludedRefund) return UNKNOWN;   // no / refunded membership in this dept → '—'

  // groups_taken mirrors deliveries EXACTLY: every active group + every inactive
  // (past) group not already counted as active (canon+slot dedup). Each = 1 level.
  const activeGroups = (ctx.activeMap.get(pn) || []).map(a => a.group_name);
  const inactiveGroups = dropActiveTwins(activeGroups, [...(ctx.inactiveMap.get(pn) || [])]);
  const groupsTaken = activeGroups.length + inactiveGroups.length;

  const paid = tm.months;

  // Settled (تسوية): the membership was CLOSED by an owner-approved deal —
  // remaining is 0 by decision, whatever paid-minus-taken says. Also keeps the
  // client out of the renewal-needed pipeline (state 'settled', not 'exhausted').
  if (ctx.settledSet && ctx.settledSet.has(pn + '|' + dept)) {
    return { paid_months: paid, groups_taken: groupsTaken, remaining: 0, remaining_after_move: 0, state: 'settled' };
  }

  const remaining = Math.max(0, paid - groupsTaken);
  const remainingAfter = Math.max(0, paid - (groupsTaken + 1));   // simulate +1 group (the next transfer)
  // exhausted = no paid level left (a further move is unpaid); last_level = exactly
  // one left (the next move IS the last paid one); ok = 2+ left.
  const state = remaining <= 0 ? 'exhausted' : (remaining === 1 ? 'last_level' : 'ok');
  return { paid_months: paid, groups_taken: groupsTaken, remaining, remaining_after_move: remainingAfter, state };
}

// Clients whose membership is at/near its end (remaining ≤ 1) in their CURRENT
// active group's dept — the proactive "محتاج تجديد" pipeline. Keyed by (phone,dept):
// a client active in two depts can surface for each. Optional dept filter.
function getRenewalNeeded({ dept } = {}) {
  dept = (dept || '').trim();
  const ctx = buildBalanceContext();
  const firstRealCoord = (s) => {
    for (const c of String(s || '').split(',')) { const t = c.trim(); if (t && normName(t) !== '--') return t; }
    return null;
  };
  const rows = new Map();
  for (const [pn, groups] of ctx.activeMap) {
    for (const g of groups) {
      const d = g.dept_type;
      if (!DEPTS.includes(d)) continue;
      if (dept && DEPTS.includes(dept) && d !== dept) continue;
      const bal = membershipBalance(ctx, pn, d);
      if (bal.state === 'unknown' || bal.state === 'settled' || bal.remaining == null || bal.remaining > 1) continue;
      const key = pn + '|' + d;
      if (rows.has(key)) continue;
      rows.set(key, {
        phone: pn,
        name: ctx.salesMap.get(pn)?.name || null,
        dept: d,
        group_name: g.group_name,
        coordinator: firstRealCoord(g.coordinators),
        paid_months: bal.paid_months,
        groups_taken: bal.groups_taken,
        remaining: bal.remaining,
        state: bal.state,
      });
    }
  }
  const items = [...rows.values()].sort((a, b) =>
    (a.remaining - b.remaining) ||   // exhausted (0) before last_level (1)
    String(a.name || '').localeCompare(String(b.name || ''), 'ar'));
  return { count: items.length, items };
}

/**
 * Build the deliveries table for one department.
 *
 *   dept:     'General' | 'Private' | 'Semi'
 *   q:        free-text search on name/phone
 *   status:   filter by manual status (or '' / 'all' for everyone)
 *   page, pageSize: pagination
 *   user:     the authenticated req.user — drives PER-ROLE scoping:
 *               • admin / management='All'        → all clients
 *               • leader                          → own department only
 *               • agent (coordinator)             → only clients they coordinate
 */
function getDepartmentDeliveries({ dept, q, status, page, pageSize, user,
  coordinator, firstFrom, firstTo, lastFrom, lastTo, remainingMin, remainingMax }) {
  if (!DEPTS.includes(dept)) throw new Error('Invalid dept (use General | Private | Semi)');
  page = Math.max(1, parseInt(page, 10) || 1);
  pageSize = Math.min(200, Math.max(5, parseInt(pageSize, 10) || 25));
  q = (q || '').trim();
  status = (status || '').trim();
  // New column filters (all optional).
  coordinator = (coordinator || '').trim();
  firstFrom = (firstFrom || '').trim();  firstTo = (firstTo || '').trim();
  lastFrom  = (lastFrom  || '').trim();  lastTo  = (lastTo  || '').trim();
  const toIntOrNull = (v) => {
    if (v === '' || v == null) return null;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
  };
  remainingMin = toIntOrNull(remainingMin);
  remainingMax = toIntOrNull(remainingMax);

  // ── PER-ROLE SCOPE ──────────────────────────────────────────────────────
  const role = user?.role || null;
  const seesEverything = role === 'admin' || user?.management === 'All';
  const isLeader = role === 'leader' && !seesEverything;
  const isAgent  = role === 'agent'  && !seesEverything;

  // Leader sees ONLY their own department. Requesting another dept → empty.
  if (isLeader) {
    const leaderDept = user?.department;
    if (leaderDept && leaderDept !== 'All' && leaderDept !== dept) {
      return { dept, page: 1, page_size: pageSize, total: 0, total_pages: 1, items: [], scope: 'leader_other_dept' };
    }
  }
  // Agent is scoped to the clients they coordinate.
  const agentNorm = isAgent ? normName(user?.full_name) : null;

  // ONE folded context for the whole page (phone-aliases merged) — the SAME
  // builder membershipBalance uses, so the audit invariant balance==page holds.
  const ctxMaps       = buildBalanceContext();
  const activeMap     = ctxMaps.activeMap;
  const coordFallback = buildCoordFallbackMap();
  const salesMap      = ctxMaps.salesMap;            // كشف العملاء (2025+) = membership source

  const statusRows = db.prepare(`SELECT client_phone_norm AS pn, status, note FROM cs_client_delivery_status`).all();
  const statusMap = new Map(statusRows.map(r => [r.pn, { status: r.status, note: r.note }]));

  // Client display-name fallback by normalized phone (when the sales row has no name).
  const nameByPhone = new Map();
  for (const r of db.prepare(`SELECT phone, MAX(name) AS name FROM clients WHERE phone IS NOT NULL AND TRIM(phone) <> '' GROUP BY phone`).all()) {
    const pn = csPrimaryPhone(r.phone);
    if (pn && r.name && !nameByPhone.has(pn)) nameByPhone.set(pn, r.name);
  }

  // Population = clients who have a 2025+ membership in كشف العملاء.
  const allPhones = new Set(salesMap.keys());

  // Primary coordinator for DISPLAY: first active group with a REAL coordinator
  // (skip the '--' placeholder), else the cs_client_coordinator fallback.
  const realCoordOf = (active, pn) =>
    (active.find(a => { const c = normName(a.coordinators); return c && c !== '--'; })?.coordinators)
    || coordFallback.get(pn) || null;

  const items = [];
  for (const pn of allPhones) {
    const sales = salesMap.get(pn);
    const tm = sales && sales.byTrack[dept];
    if (!tm) continue;                  // no membership in THIS track
    if (tm.excludedRefund) continue;    // latest membership in this track refunded → hidden

    const active = activeMap.get(pn) || [];

    const st = statusMap.get(pn)?.status || 'active';
    if (status && status !== 'all' && st !== status) continue;

    const name = sales.name || nameByPhone.get(pn) || null;
    if (q) {
      const ql = q.toLowerCase();
      if (!(String(name || '').toLowerCase().includes(ql) || pn.includes(q))) continue;
    }

    const activeGroups = active.map(a => a.group_name);
    const coordinator = realCoordOf(active, pn);

    // Agent scoping: keep the row only if this coordinator owns it — either via
    // an active group's coordinators field OR the cs_client_coordinator record.
    if (isAgent) {
      const ownsViaGroup = active.some(a => coordStrHasName(a.coordinators, agentNorm));
      const ownsViaCs    = coordStrHasName(coordFallback.get(pn), agentNorm);
      if (!ownsViaGroup && !ownsViaCs) continue;
    }

    items.push({
      phone: pn,
      name,
      membership_count: tm.count,        // from كشف العملاء, this track
      total_months: tm.months,
      _pd: { months: tm.months, list: tm.list },
      has_subscription: true,
      status: st,
      status_note: statusMap.get(pn)?.note || null,
      active_groups: activeGroups,
      coordinator,
      _hasActive: active.length > 0,
    });
  }

  // ── Compute the FILTERABLE derived fields for ALL items (cheap: global maps +
  // lazy-memoized lecture lookups, NO heavy csClientPlan call) so the new column
  // filters (coordinator / lecture dates / remaining levels) can run BEFORE
  // pagination. The heavy pacing work stays on the page slice only (below). ────
  const inactiveMap = ctxMaps.inactiveMap;   // folded — same object as the balance layer
  // Owner's manual group exclusions per phone (for display + restore in the UI).
  const exclByPhone = new Map();
  for (const [key, info] of ctxMaps.groupExclusions) {
    const cut = key.indexOf('|');
    const pn2 = key.slice(0, cut);
    if (!exclByPhone.has(pn2)) exclByPhone.set(pn2, []);
    exclByPhone.get(pn2).push({ group: info.label, note: info.note, by: info.by, at: info.at });
  }
  const groupLectureMeta = makeGroupLectureMeta();
  for (const it of items) {
    const inactiveAll = [...(inactiveMap.get(it.phone) || [])];
    it.inactive_groups = dropActiveTwins(it.active_groups, inactiveAll);
    it.excluded_groups = exclByPhone.get(it.phone) || [];   // manually excluded (display + restore)

    // Per active group: lecture count + first/last lecture date (from `lectures`).
    // Aligned with it.active_groups order so the UI can show them side-by-side.
    it.active_groups_meta = (activeMap.get(it.phone) || []).map(a => {
      const m = groupLectureMeta(a.group_name, a.line);
      return { group_name: a.group_name, lectures: m.lectures, start_date: m.start_date, end_date: m.end_date };
    });

    // Per-dept (owner's decision): paid months restricted to THIS department.
    // No-subscription clients (present only via an active group) have no membership
    // data → null so عضويات/شهور/المستويات المتبقية render as '—'.
    it.paid_months = it.has_subscription ? it._pd.months : null;
    it.months_list = it.has_subscription ? it._pd.list : [];
    delete it._pd;

    // Remaining levels = total paid levels (إجمالي العضويات) MINUS the number of
    // groups the client appears in (active + inactive) — each group = one level
    // taken. Uses the FILTERED group lists (Free Slots / Grammer already removed).
    const groupsTaken = (it.active_groups?.length || 0) + (it.inactive_groups?.length || 0);
    it.groups_taken = groupsTaken;
    // Settled (تسوية) — membership closed by an owner-approved deal: remaining is
    // 0 by decision. SAME rule as membershipBalance (audit: balance == page).
    const settleInfo = ctxMaps.settledSet.get(it.phone + '|' + dept);
    it.settled = !!settleInfo;
    if (settleInfo) {
      it.settled_note = settleInfo.note;
      it.settled_by = settleInfo.by;
      it.settled_at = settleInfo.at;
    }
    it.remaining_levels = it.settled ? 0
      : (it.paid_months != null) ? Math.max(0, it.paid_months - groupsTaken)
      : null;
  }

  // Coordinators for the filter dropdown = EVERY coordinator who runs an active
  // group of any client in this dept (not just each client's resolved primary) —
  // so the dropdown matches the "any active group" filter below. Deduped by
  // compact key, '--' placeholder excluded.
  const coordDisplay = new Map();
  for (const it of items) {
    for (const a of (activeMap.get(it.phone) || [])) {
      for (const c of String(a.coordinators || '').split(',')) {
        const t = c.trim(); const k = normName(t);
        if (k && k !== '--' && !coordDisplay.has(k)) coordDisplay.set(k, t);
      }
    }
  }
  const coordinatorsList = [...coordDisplay.values()].sort((a, b) => String(a).localeCompare(String(b), 'ar'));

  // ── NEW column filters (match-if-ANY-active-group for the date ranges) ───────
  const dateInRange = (d, from, to) => {
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };
  let filtered = items;
  if (coordinator) {
    // Match like فريق العمل / org-chart: a client belongs to coordinator X if ANY
    // of their active groups is coordinated by X (not just the resolved primary).
    // A client in two coordinators' groups appears under BOTH — intended.
    const wantNorm = normName(coordinator);
    filtered = filtered.filter(it => (activeMap.get(it.phone) || []).some(a => coordStrHasName(a.coordinators, wantNorm)));
  }
  if (firstFrom || firstTo) {
    filtered = filtered.filter(it => (it.active_groups_meta || []).some(m => dateInRange(m.start_date, firstFrom, firstTo)));
  }
  if (lastFrom || lastTo) {
    filtered = filtered.filter(it => (it.active_groups_meta || []).some(m => dateInRange(m.end_date, lastFrom, lastTo)));
  }
  if (remainingMin != null || remainingMax != null) {
    filtered = filtered.filter(it => {
      if (it.remaining_levels == null) return false;
      if (remainingMin != null && it.remaining_levels < remainingMin) return false;
      if (remainingMax != null && it.remaining_levels > remainingMax) return false;
      return true;
    });
  }

  // Active clients first, then alphabetical by name.
  filtered.sort((a, b) =>
    (Number(b._hasActive) - Number(a._hasActive)) ||
    String(a.name || '').localeCompare(String(b.name || ''), 'ar'));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  // Heavy per-row pacing work (completed levels + expected finish + overdue) only
  // for the current page slice — these are display-only, not filtered on.
  const intensiveSet = buildIntensiveSet();
  const csPlan = require('./csClientPlan.service');
  for (const it of pageItems) {
    let lastLevelDate = null, daysSinceLast = null;
    try {
      const plan = csPlan.getClientPlan(it.phone);
      it.completed_count = plan ? plan.summary.completed_count : null;
      lastLevelDate = plan?.summary?.last_level_date || null;
      daysSinceLast = plan?.summary?.days_since_last_level ?? null;
    } catch (_) {
      it.completed_count = null;
    }

    // ── Intensive-aware pacing (2 weeks / level) vs regular (1 month / level) ──
    const isIntensive = intensiveSet.has(it.phone);
    const pace = isIntensive ? PACE_INTENSIVE_DAYS : PACE_REGULAR_DAYS;
    const rem = it.remaining_levels;
    it.is_intensive = isIntensive;
    it.pace_days = pace;
    it.days_since_last_level = daysSinceLast;
    if (rem != null && rem > 0) {
      it.expected_remaining_days = rem * pace;
      // Friendly label that reflects the pace: intensive → weeks, regular → months.
      it.expected_remaining_label = isIntensive ? `${rem * 2} أسبوع` : `${rem} شهر`;
      it.expected_finish_date = addDaysISO(lastLevelDate, rem * pace);
      // Overdue = behind pace: more time has passed since the last completed
      // level than a single level should take.
      it.is_overdue = (daysSinceLast != null && daysSinceLast > pace);
    } else {
      it.expected_remaining_days = 0;
      it.expected_remaining_label = (rem === 0) ? 'مكتمل' : null;
      it.expected_finish_date = null;
      it.is_overdue = false;
    }
    delete it._hasActive;
  }

  return {
    dept,
    page,
    page_size: pageSize,
    total,
    total_pages: Math.ceil(total / pageSize) || 1,
    items: pageItems,
    coordinators: coordinatorsList,   // distinct coordinators in this dept (filter dropdown)
  };
}

/**
 * Set (or clear) the manual delivery status for one client.
 */
function setDeliveryStatus({ phone, status, note, userId, userName }) {
  const pn = csPrimaryPhone(phone);
  if (!pn) throw new Error('Invalid phone');
  if (!STATUSES.includes(status)) throw new Error('Invalid status');

  const existing = db.prepare('SELECT id FROM cs_client_delivery_status WHERE client_phone_norm = ?').get(pn);
  if (existing) {
    db.prepare(`
      UPDATE cs_client_delivery_status
         SET status = ?, note = ?, updated_by = ?, updated_by_name = ?,
             updated_at = datetime('now', '+2 hours')
       WHERE client_phone_norm = ?
    `).run(status, note || null, userId || null, userName || null, pn);
  } else {
    db.prepare(`
      INSERT INTO cs_client_delivery_status
        (client_phone_norm, status, note, updated_by, updated_by_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(pn, status, note || null, userId || null, userName || null);
  }
  saveNow();
  return { phone: pn, status, note: note || null };
}

// ── Manual settlement (تسوية — إنهاء العضوية) writes. Admin-gated at the route. ──
function setSettlement({ phone, dept, note, userId, userName }) {
  const pn = csPrimaryPhone(phone);
  if (!pn) throw new Error('Invalid phone');
  if (!DEPTS.includes(dept)) throw new Error('Invalid dept (use General | Private | Semi)');
  db.prepare(`
    INSERT INTO cs_membership_settlements (client_phone_norm, dept, note, settled_by, settled_by_name, settled_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', '+2 hours'))
    ON CONFLICT(client_phone_norm, dept) DO UPDATE SET
      note = excluded.note, settled_by = excluded.settled_by,
      settled_by_name = excluded.settled_by_name, settled_at = excluded.settled_at
  `).run(pn, dept, note || null, userId || null, userName || null);
  saveNow();
  return { phone: pn, dept, settled: true };
}

function clearSettlement({ phone, dept }) {
  const pn = csPrimaryPhone(phone);
  if (!pn) throw new Error('Invalid phone');
  db.prepare(`DELETE FROM cs_membership_settlements WHERE client_phone_norm = ? AND dept = ?`).run(pn, dept);
  saveNow();
  return { phone: pn, dept, settled: false };
}

// ── Manual per-client group exclusion (تعديل المجموعات يدويًّا) writes. ──────
function excludeClientGroup({ phone, group, note, userId, userName }) {
  const pn = csPrimaryPhone(phone);
  if (!pn) throw new Error('Invalid phone');
  const label = cleanGroupCode(group);
  if (!label) throw new Error('Invalid group');
  db.prepare(`
    INSERT INTO cs_client_group_exclusions (client_phone_norm, group_key, group_label, note, excluded_by, excluded_by_name, excluded_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+2 hours'))
    ON CONFLICT(client_phone_norm, group_key) DO UPDATE SET
      group_label = excluded.group_label, note = excluded.note,
      excluded_by = excluded.excluded_by, excluded_by_name = excluded.excluded_by_name,
      excluded_at = excluded.excluded_at
  `).run(pn, bmCanon(label), label, note || null, userId || null, userName || null);
  saveNow();
  return { phone: pn, group_key: bmCanon(label), excluded: true };
}

function restoreClientGroup({ phone, group }) {
  const pn = csPrimaryPhone(phone);
  if (!pn) throw new Error('Invalid phone');
  const ck = bmCanon(cleanGroupCode(group));
  db.prepare(`DELETE FROM cs_client_group_exclusions WHERE client_phone_norm = ? AND group_key = ?`).run(pn, ck);
  saveNow();
  return { phone: pn, group_key: ck, excluded: false };
}

module.exports = {
  getDepartmentDeliveries, setDeliveryStatus, DEPTS, STATUSES,
  buildBalanceContext, membershipBalance, getRenewalNeeded,
  buildPhoneAliasMap,   // secondary→primary phone merge (كشف العملاء mobile_no2)
  setSettlement, clearSettlement,   // تسوية — إنهاء العضوية (owner-approved deals)
  excludeClientGroup, restoreClientGroup,   // استبعاد مجموعة يدويًّا من حساب عميل
};
