'use strict';

/**
 * Enr Groups (مجموعات الـ Enrollment) — a GROUP-oriented view (the inverse of the
 * client-oriented تسليمات الأقسام page). For each ACTIVE group it lists the clients
 * inside it plus the group's start/end dates and a STATUS.
 *
 *   - "active"  = batches.status = 'نشطة'  (placeholder groups excluded)
 *   - status = the REAL batches.status (same values as the SystemReports waiting
 *     pages — NOT computed from lecture counts):
 *       • نشطة                    → started
 *       • بانتظار تسجيل المحاضرات → waiting_lectures
 *       • بانتظار تسجيل المتدربين → waiting_trainees
 *   - start_date / end_date:
 *       • started groups → MIN/MAX lecture date from the `lectures` table directly
 *         (NOT batches), MAIN only, current sheet only (latest synced_at per group),
 *         COUNT(DISTINCT date|time) to collapse the ~40% rename twins — mirrors
 *         csDeliveries.makeGroupLectureMeta exactly so the numbers agree.
 *       • groups with NO lectures → start_date = batches.start_date (the group's
 *         stored start date = the date encoded in its name, year resolved by the
 *         system; owner's decision). No last lecture → end_date null.
 *
 * Read-only. Additive — touches no existing route/table/service. Admin only
 * (enforced at the route).
 */

const db = require('../config/database');
const { IGNORED_GROUP_PATTERNS, isIgnoredGroup, normName, realCoordinator } = require('../utils/csGroupHelpers');

const DEPTS = ['General', 'Private', 'Semi'];

// Real batches.status → the page's status key (same statuses as SystemReports).
const STATUS_MAP = {
  'نشطة': 'started',
  'بانتظار تسجيل المحاضرات': 'waiting_lectures',
  'بانتظار تسجيل المتدربين': 'waiting_trainees',
};

const stripSpaces = (s) => String(s == null ? '' : s).replace(/\s/g, '');

// Canonical group identity = the code BEFORE the first "(" (drops the
// "(trainer)" paren AND the trailing coordinator-name suffix), space-stripped.
// Same rule as csDeliveries so a group renamed/handed-over isn't double-counted.
// Names that START with "(" (batches data-entry pattern "(Trainer)Aug_29_…")
// produce an EMPTY base — before the 2026-07-22 fix every such group collapsed
// into one dedup key and all but one silently vanished from the pages (audit
// found 6 active Private groups hidden). Fall back to the full stripped name.
const canonGroupKey = (s) => {
  const base = stripSpaces(String(s == null ? '' : s).split('(')[0]);
  return base || stripSpaces(s);
};

// IGNORED_GROUP_PATTERNS / isIgnoredGroup / normName / realCoordinator now come
// from ../utils/csGroupHelpers (shared with csDeliveries & csEnrTransition).

// Normalized full-name key: lowercase + every whitespace stripped. The batches
// sheet and the lectures sheet sometimes spell the SAME group with different
// case/spacing ("Con2_SP…" vs "CON2_SP…", "5pm" vs "5Pm") — exact matching hid
// those groups' lectures entirely (audit 2026-07-22: 7 page rows wrongly showed
// 0 lectures / «لا يوجد مدرب»). Folding is on the FULL name (suffix included),
// so two different cohorts can never merge — respects the no-loose-linking rule.
const normFull = (s) => String(s == null ? '' : s).replace(/\s/g, '').toLowerCase();

// ONE-pass index over ALL main lectures: rows are bucketed by normalized full
// name + line; the "current sheet" = the rows of the LATEST synced_at day
// across the spelling variants (the live file's own rows), مؤكدة+مجدولة.
// From that one pass we derive count/first/last (meta), days + last-lecture
// trainer (facts) and the modal's row list — replacing the old per-group
// exact-name queries (which also re-scanned the table per group).
function buildMainIndex() {
  const raw = db.prepare(`
    SELECT group_name, IFNULL(line, '') AS ln, trainer, date, time, duration, status,
           date(synced_at) AS sday
      FROM lectures
     WHERE session_type = 'main'
  `).all();
  const byKey = new Map();   // normFull|line → { maxDay, rows }
  for (const r of raw) {
    const key = normFull(r.group_name) + '|' + r.ln;
    let e = byKey.get(key);
    if (!e) { e = { maxDay: '', rows: [] }; byKey.set(key, e); }
    if (String(r.sday || '') > e.maxDay) e.maxDay = String(r.sday || '');
    e.rows.push(r);
  }
  const agg = new Map();
  for (const [key, e] of byKey) {
    const cur = e.rows.filter(r =>
      String(r.sday || '') === e.maxDay && (r.status === 'مؤكدة' || r.status === 'مجدولة'));
    const sessions = new Set(), days = new Set(), byTrainer = new Map();
    let mn = null, mx = null;
    for (const r of cur) {
      sessions.add(r.date + '|' + r.time);
      const ds = String(r.date);
      if (mn === null || ds < mn) mn = ds;
      if (mx === null || ds > mx) mx = ds;
      const d = new Date(ds + 'T00:00:00');
      if (!isNaN(d)) days.add(d.getDay());
      const t = String(r.trainer == null ? '' : r.trainer).trim();
      if (t) {
        const c = byTrainer.get(t) || { maxDate: '', count: 0 };
        if (ds > c.maxDate) c.maxDate = ds;
        c.count++;
        byTrainer.set(t, c);
      }
    }
    // last-lecture trainer (MAX date; tie → most rows) — documented rule bf4997e.
    let trainer = null;
    for (const [t, v] of byTrainer) {
      if (!trainer || v.maxDate > trainer.maxDate ||
          (v.maxDate === trainer.maxDate && v.count > trainer.count)) trainer = { name: t, ...v };
    }
    agg.set(key, {
      lectures: sessions.size,
      start_date: mn,
      end_date: mx,
      days: DAY_ORDER.filter(d => days.has(d)).map(d => DAY_LABEL[d]),
      trainer: trainer ? trainer.name : null,
      rows: cur,
    });
  }
  const EMPTY = { lectures: 0, start_date: null, end_date: null, days: [], trainer: null, rows: [] };
  return (group, line) => agg.get(normFull(group) + '|' + String(line || '')) || EMPTY;
}

// Back-compat wrapper for getEnrGroups: same shape as the old per-group meta.
function makeGroupLectureMeta() {
  const idx = buildMainIndex();
  return (group, line) => {
    const e = idx(group, line);
    return { lectures: e.lectures, start_date: e.start_date, end_date: e.end_date };
  };
}

// (group_name|line) → [{ name, phone }] for clients currently in the group.
// clients.group_name matches batches.group_name directly (same as csDeliveries).
function buildClientsByGroup() {
  const rows = db.prepare(`
    SELECT group_name AS g, line AS l, name, phone
      FROM clients
     WHERE group_name IS NOT NULL AND TRIM(group_name) <> ''
  `).all();
  const map = new Map();
  for (const r of rows) {
    const key = String(r.g) + '|' + String(r.l || '');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ name: r.name || null, phone: r.phone || null });
  }
  // Dedup by phone (then name) within each group so a client listed twice isn't doubled.
  for (const [k, list] of map) {
    const seen = new Set();
    const out = [];
    for (const c of list) {
      const id = c.phone ? 'p:' + c.phone : 'n:' + (c.name || '');
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(c);
    }
    map.set(k, out);
  }
  return map;
}

// (next_group_name|line) → [{ name, phone, source_group_name, added_from }] for
// clients moved INTO that group via the transition screen (enr_next_members).
function buildNextMembersByGroup() {
  const map = new Map();
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT next_group_name AS g, next_line AS l, client_name AS name, client_phone AS phone,
             source_group_name AS src, added_from
        FROM enr_next_members
    `).all();
  } catch (_) { return map; }   // table may not exist yet on a fresh DB
  for (const r of rows) {
    const key = String(r.g) + '|' + String(r.l || '');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ name: r.name || null, phone: r.phone || null, source_group_name: r.src || null, added_from: r.added_from });
  }
  return map;
}

/**
 * Build the Enr Groups table for one department.
 *
 *   dept: 'General' | 'Private' | 'Semi'
 *   q:    free-text search on group code or coordinator
 *   status: '' (all) | 'started' | 'waiting_lectures' | 'waiting_trainees'
 *   firstFrom/firstTo: filter on start_date range
 *   lastFrom/lastTo:   filter on end_date range
 *   page, pageSize: pagination
 */
const STATUSES = ['started', 'waiting_lectures', 'waiting_trainees'];

function getEnrGroups({ dept, q, status, firstFrom, firstTo, lastFrom, lastTo, page, pageSize }) {
  if (!DEPTS.includes(dept)) throw new Error('Invalid dept (use General | Private | Semi)');
  page = Math.max(1, parseInt(page, 10) || 1);
  pageSize = Math.min(200, Math.max(5, parseInt(pageSize, 10) || 25));
  q = (q || '').trim();
  status = (status || '').trim();
  firstFrom = (firstFrom || '').trim();  firstTo = (firstTo || '').trim();
  lastFrom  = (lastFrom  || '').trim();  lastTo  = (lastTo  || '').trim();

  // Active + waiting groups in this dept, deduped by canonical key + line,
  // placeholders out. Status comes from the REAL batches.status (same values the
  // SystemReports waiting pages use), NOT computed from lecture counts.
  const rows = db.prepare(`
    SELECT group_name, line, dept_type, coordinators, start_date, status
      FROM batches
     WHERE status IN ('نشطة', 'بانتظار تسجيل المتدربين', 'بانتظار تسجيل المحاضرات')
       AND dept_type = ?
  `).all(dept);

  const seen = new Map();
  for (const r of rows) {
    if (isIgnoredGroup(r.group_name)) continue;
    const key = canonGroupKey(r.group_name) + '|' + String(r.line || '');
    if (!seen.has(key)) seen.set(key, r);   // first row wins (stable)
  }

  const lectureMeta = makeGroupLectureMeta();
  const clientsByGroup = buildClientsByGroup();
  const nextMembersByGroup = buildNextMembersByGroup();

  // Membership level-balance per client (the SAME number as the deliveries page) so
  // the group table can flag clients at/near the end of their membership. One ctx
  // for the whole page; lazy-required to avoid any module load-order cycle.
  const csBal = require('./csDeliveries.service');
  const balCtx = csBal.buildBalanceContext();

  let items = [];
  for (const r of seen.values()) {
    const meta = lectureMeta(r.group_name, r.line);
    const gkey = String(r.group_name) + '|' + String(r.line || '');
    const students = (clientsByGroup.get(gkey) || []).map(s => ({
      ...s, balance: csBal.membershipBalance(balCtx, s.phone, dept),
    }));
    const movedIn = nextMembersByGroup.get(gkey) || [];

    // Status = the real batches.status (matches the SystemReports waiting pages).
    const rowStatus = STATUS_MAP[r.status] || 'started';
    // Dates: from lectures when the group has any; otherwise the group's stored
    // start date (= the date encoded in its name). No lectures → no end date.
    let startDate, endDate;
    if (meta.lectures > 0) {
      startDate = meta.start_date;        // first lecture date
      endDate   = meta.end_date;          // last lecture date
    } else {
      startDate = r.start_date || null;   // batches.start_date
      endDate   = null;
    }

    items.push({
      group_name:    r.group_name,
      line:          r.line,
      dept_type:     r.dept_type,
      coordinator:   realCoordinator(r.coordinators),
      status:        rowStatus,
      students,
      student_count: students.length,
      renewal_count: students.filter(s => s.balance && (s.balance.state === 'exhausted' || s.balance.state === 'last_level')).length,
      moved_in:      movedIn,
      moved_in_count: movedIn.length,
      start_date:    startDate,
      end_date:      endDate,
      lectures:      meta.lectures,
    });
  }

  // Status filter.
  if (status && STATUSES.includes(status)) {
    items = items.filter(it => it.status === status);
  }

  // Search on group code or coordinator (space-insensitive for the code).
  if (q) {
    const ql = q.toLowerCase();
    const qcompact = stripSpaces(ql);
    items = items.filter(it =>
      stripSpaces(String(it.group_name || '').toLowerCase()).includes(qcompact) ||
      String(it.coordinator || '').toLowerCase().includes(ql)
    );
  }

  // Date-range filters (same dateInRange logic as csDeliveries). Each group has a
  // single start_date / end_date, so a plain in-range check is enough.
  const dateInRange = (d, from, to) => {
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };
  if (firstFrom || firstTo) items = items.filter(it => dateInRange(it.start_date, firstFrom, firstTo));
  if (lastFrom  || lastTo)  items = items.filter(it => dateInRange(it.end_date,   lastFrom,  lastTo));

  // Newest-started first, then by group code.
  items.sort((a, b) =>
    String(b.start_date || '').localeCompare(String(a.start_date || '')) ||
    String(a.group_name || '').localeCompare(String(b.group_name || ''), 'ar'));

  const total = items.length;
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return {
    dept,
    page,
    page_size: pageSize,
    total,
    total_pages: Math.ceil(total / pageSize) || 1,
    items: pageItems,
  };
}

// ─── Levels overview (المستويات الشغّالة) — 2026-07-21 ──────────────────────
// A LEVEL-oriented view of the same groups: for every active/waiting group in a
// department show its level + code + day(s) + first/last lecture date + trainer
// + student count, sorted by the level ladder (Starter → General → Conversation).
// Read-only, additive; reuses the exact same group population as getEnrGroups.

// Parse the level from the group code. Same family+number rule as
// csDeliveriesReport.parseLevel (kept local — not exported there): family must
// start the string or follow a non-alphanumeric separator, because "_" is a
// word char and a bare \b would grab "Aug_16" as "General 16". Two robustness
// additions for THIS page only (live nulls found in verification 2026-07-21):
//   - parenthesized segments are STRIPPED (not split-at-first-paren), so codes
//     that START with a paren like "(New)Aug_8_..._general3_(Menna)" still parse;
//     trainer/coordinator text inside parens is removed either way.
//   - "conv" accepted as a Conversation abbreviation (live codes: Conv4_P).
function parseLevelParts(name) {
  const base = String(name == null ? '' : name).replace(/\([^)]*\)/g, ' ');
  const m = base.match(/(?:^|[^a-z0-9])(conversation|conv|con|general|gen|starter|str)\s*_?\s*(\d+)/i);
  if (!m) return null;
  const fam = m[1].toLowerCase();
  const family = /^con/.test(fam) ? 'conversation'
    : /^(general|gen)/.test(fam)  ? 'general'
    : 'starter';
  return { family, num: parseInt(m[2], 10) };
}
const LEVEL_LABEL  = { starter: 'Starter', general: 'General', conversation: 'Conversation' };
const FAMILY_ORDER = { starter: 0, general: 1, conversation: 2 };

// Academy week starts Saturday: JS getDay() 6=Sat, 0=Sun, ...
const DAY_ORDER  = [6, 0, 1, 2, 3, 4, 5];
const DAY_LABEL  = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
const NAME_DAY_RE = /(?:^|[^a-z0-9])(sat|sun|mon|tue|wed|thu|fri)(?:[^a-z0-9]|$)/i;

// (makeGroupLectureFacts was folded into buildMainIndex — 2026-07-22.)

/**
 * Levels overview for one department.
 *   dept: 'General' | 'Private' | 'Semi'
 *   q: search on group code / trainer
 *   status: '' (all) | started | waiting_lectures | waiting_trainees
 *   firstFrom/firstTo: group start_date within range   (owner 2026-07-21)
 *   lastFrom/lastTo:   group end_date within range     (owner 2026-07-21)
 *   days: CSV of day labels (e.g. "Sun,Wed") — row matches if ANY selected day
 *         is among the group's days (OR semantics, owner: «الأحد أو الأربع أو
 *         الاثنين مع بعض»)                              (owner 2026-07-21)
 *   level: exact level label (e.g. "General 4")         (owner 2026-07-21)
 */
function getLevelsOverview({ dept, q, status, firstFrom, firstTo, lastFrom, lastTo, days, level, page, pageSize }) {
  if (!DEPTS.includes(dept)) throw new Error('Invalid dept (use General | Private | Semi)');
  page = Math.max(1, parseInt(page, 10) || 1);
  pageSize = Math.min(200, Math.max(5, parseInt(pageSize, 10) || 50));
  q = (q || '').trim();
  status = (status || '').trim();
  firstFrom = (firstFrom || '').trim();  firstTo = (firstTo || '').trim();
  lastFrom  = (lastFrom  || '').trim();  lastTo  = (lastTo  || '').trim();
  level = (level || '').trim();
  const VALID_DAYS = new Set(Object.values(DAY_LABEL));
  const daySel = new Set(String(days || '').split(',').map(s => s.trim()).filter(d => VALID_DAYS.has(d)));

  // Same population + dedup as getEnrGroups (real batches.status, placeholders out).
  const rows = db.prepare(`
    SELECT group_name, line, dept_type, start_date, status
      FROM batches
     WHERE status IN ('نشطة', 'بانتظار تسجيل المتدربين', 'بانتظار تسجيل المحاضرات')
       AND dept_type = ?
  `).all(dept);

  const seen = new Map();
  for (const r of rows) {
    if (isIgnoredGroup(r.group_name)) continue;
    const key = canonGroupKey(r.group_name) + '|' + String(r.line || '');
    if (!seen.has(key)) seen.set(key, r);
  }

  const mainIdx = buildMainIndex();
  const clientsByGroup = buildClientsByGroup();

  let items = [];
  for (const r of seen.values()) {
    const meta  = mainIdx(r.group_name, r.line);
    const facts = meta;   // same index entry carries days + trainer
    const gkey  = String(r.group_name) + '|' + String(r.line || '');

    // Dates: same rule as getEnrGroups — lectures when the group has any,
    // otherwise batches.start_date and no end date.
    let startDate, endDate;
    if (meta.lectures > 0) {
      startDate = meta.start_date;
      endDate   = meta.end_date;
    } else {
      startDate = r.start_date || null;
      endDate   = null;
    }

    // Day(s): actual lecture weekdays; a group with no lectures yet falls back
    // to the single day token written in its code (no pair inference).
    // Paren segments are stripped (not split-at-first-paren) so codes that
    // START with "(" still yield their day token.
    let daysList = facts.days;
    if (!daysList.length) {
      const m = String(r.group_name || '').replace(/\([^)]*\)/g, ' ').match(NAME_DAY_RE);
      if (m) daysList = [m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()];
    }

    const lvl = parseLevelParts(r.group_name);
    items.push({
      level:       lvl ? `${LEVEL_LABEL[lvl.family]} ${lvl.num}` : null,
      level_order: lvl ? (FAMILY_ORDER[lvl.family] * 100 + lvl.num) : 9999,
      group_name:  r.group_name,
      line:        r.line,
      day:         daysList.length ? daysList.join(' - ') : null,
      days_list:   daysList,
      start_date:  startDate,
      end_date:    endDate,
      // Trainer = last-lecture trainer; group with no lectures → null
      // (frontend shows «لا يوجد مدرب» — owner decision 2026-07-21).
      trainer:     meta.lectures > 0 ? facts.trainer : null,
      status:      STATUS_MAP[r.status] || 'started',
      student_count: (clientsByGroup.get(gkey) || []).length,
      lectures:    meta.lectures,
    });
  }

  // Level chips/options = every level present in the dept (computed BEFORE
  // any filter, so the list stays stable while filtering), ladder-sorted,
  // + a pre-filter group count per level (chip badges, owner 2026-07-21).
  const levelSet = new Map();   // label → order
  const levelCounts = {};       // label → group count (pre-filter)
  for (const it of items) if (it.level) {
    levelSet.set(it.level, it.level_order);
    levelCounts[it.level] = (levelCounts[it.level] || 0) + 1;
  }
  const levels = [...levelSet.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);

  if (status && STATUSES.includes(status)) {
    items = items.filter(it => it.status === status);
  }

  if (q) {
    const ql = q.toLowerCase();
    const qcompact = stripSpaces(ql);
    items = items.filter(it =>
      stripSpaces(String(it.group_name || '').toLowerCase()).includes(qcompact) ||
      String(it.trainer || '').toLowerCase().includes(ql)
    );
  }

  // Date-range filters — same dateInRange semantics as getEnrGroups (a null
  // date never matches an active range filter).
  const dateInRange = (d, from, to) => {
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };
  if (firstFrom || firstTo) items = items.filter(it => dateInRange(it.start_date, firstFrom, firstTo));
  if (lastFrom  || lastTo)  items = items.filter(it => dateInRange(it.end_date,   lastFrom,  lastTo));

  // Days filter — OR semantics: the row matches if ANY selected day is among
  // the group's days (Sun+Wed selected → rows with Sun, Wed, or both).
  if (daySel.size) items = items.filter(it => it.days_list.some(d => daySel.has(d)));

  // Level filter — exact label match.
  if (level) items = items.filter(it => it.level === level);

  // Level ladder ascending (Starter → General → Conversation; unknown last),
  // then newest start date, then code.
  items.sort((a, b) =>
    (a.level_order - b.level_order) ||
    String(b.start_date || '').localeCompare(String(a.start_date || '')) ||
    String(a.group_name || '').localeCompare(String(b.group_name || ''), 'ar'));

  const total = items.length;
  const start = (page - 1) * pageSize;
  return {
    dept,
    page,
    page_size: pageSize,
    total,
    total_pages: Math.ceil(total / pageSize) || 1,
    levels,
    level_counts: levelCounts,
    items: items.slice(start, start + pageSize).map(({ level_order, days_list, ...it }) => it),
  };
}

// ─── Levels page drill-downs (2026-07-21, owner request) ────────────────────

/**
 * Clients of ONE group with the SAME membership numbers as the deliveries page
 * (تسليمات الأقسام): paid months / taken / remaining / state + the past
 * (ended) groups the balance counts. Computed through the REAL csDeliveries
 * functions (buildBalanceContext + membershipBalance), so every deliveries-side
 * adjustment — تسوية, group exclusion, transfer, phone alias — flows here
 * automatically with zero mirroring.
 */
function getLevelsGroupClients({ group, line, dept }) {
  if (!DEPTS.includes(dept)) throw new Error('Invalid dept (use General | Private | Semi)');
  group = String(group || '').trim();
  if (!group) throw new Error('group is required');
  line = String(line || '');

  const csBal = require('./csDeliveries.service');
  const ctx = csBal.buildBalanceContext();
  const alias = csBal.buildPhoneAliasMap();

  // Same roster + dedup as the page's student_count (buildClientsByGroup rule).
  const rows = db.prepare(`
    SELECT name, phone FROM clients
     WHERE group_name = ? AND line = ? AND group_name IS NOT NULL AND TRIM(group_name) <> ''
  `).all(group, line);
  const seen = new Set();
  const items = [];
  for (const c of rows) {
    const id = c.phone ? 'p:' + c.phone : 'n:' + (c.name || '');
    if (seen.has(id)) continue;
    seen.add(id);

    // Resolve the phone to its PRIMARY (alias fold) exactly like deliveries:
    // ctx maps are keyed by primary after foldPhoneAliases.
    const pnRaw = csBal.csPrimaryPhone(c.phone);
    const pn = (pnRaw && alias.get(pnRaw)) || pnRaw;
    const bal = csBal.membershipBalance(ctx, pn || c.phone, dept);
    // Past/ended groups exactly as the balance counts them (post exclusions,
    // active twins dropped) — the same lines as membershipBalance internals.
    const activeGroups = pn ? (ctx.activeMap.get(pn) || []).map(a => a.group_name) : [];
    const inactiveGroups = pn ? csBal.dropActiveTwins(activeGroups, [...(ctx.inactiveMap.get(pn) || [])]) : [];

    items.push({
      name: c.name || null,
      phone: c.phone || null,
      paid_months: bal.paid_months,
      groups_taken: bal.groups_taken,
      remaining: bal.remaining,
      state: bal.state,
      active_groups: activeGroups,
      inactive_groups: inactiveGroups,
    });
  }
  return { group, line, dept, total: items.length, items };
}

// Side (فون كول) sessions index — bucketed by the group's CANONICAL BASE
// (the code before the first "(", normalized), like the phone-call-gap page's
// documented baseGroupOf rule: the side sheet writes the same group with a
// DIFFERENT coordinator suffix, so exact-name matching missed sessions (audit
// 2026-07-22: 28 page groups were missing 405 recorded side sessions).
// Current sheet is taken PER spelling variant (its own latest synced_at day).
// Empty base (name starts with "(") falls back to the full normalized name so
// unrelated paren-prefixed rows can never cross-match.
function buildSideIndex() {
  const raw = db.prepare(`
    SELECT group_name, IFNULL(line, '') AS ln, trainer, date, time, duration, status,
           date(synced_at) AS sday
      FROM lectures
     WHERE session_type = 'side'
  `).all();
  const byVar = new Map();   // normFull|line → { maxDay, rows }
  for (const r of raw) {
    const key = normFull(r.group_name) + '|' + r.ln;
    let e = byVar.get(key);
    if (!e) { e = { maxDay: '', rows: [] }; byVar.set(key, e); }
    if (String(r.sday || '') > e.maxDay) e.maxDay = String(r.sday || '');
    e.rows.push(r);
  }
  const baseKeyOf = (name, ln) => {
    const b = normFull(String(name == null ? '' : name).split('(')[0]);
    return (b || normFull(name)) + '|' + String(ln || '');
  };
  const byBase = new Map();
  for (const [, e] of byVar) {
    for (const r of e.rows) {
      if (String(r.sday || '') !== e.maxDay) continue;
      const bkey = baseKeyOf(r.group_name, r.ln);
      if (!byBase.has(bkey)) byBase.set(bkey, []);
      byBase.get(bkey).push(r);
    }
  }
  return (group, line) => byBase.get(baseKeyOf(group, line)) || [];
}

/**
 * Registered sessions of ONE group: main lectures (مؤكدة+مجدولة, current sheet,
 * normalized full-name match — the same population the page's lecture count
 * uses) + phone-call/side sessions (current sheet, canonical-base match like
 * the phone-call-gap page, no status filter — the documented side rule).
 * Counts use the canonical keys: main = DISTINCT date|time, side = DISTINCT
 * date|time|trainer.
 */
function getLevelsGroupLectures({ group, line }) {
  group = String(group || '').trim();
  if (!group) throw new Error('group is required');
  line = String(line || '');

  const toRow = ({ date, time, duration, trainer, status }) => ({ date, time, duration, trainer, status });
  const dedupe = (rows) => {
    const seen = new Set(), out = [];
    for (const r of rows) {
      const k = [r.date, r.time, r.duration, r.trainer, r.status].join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out.sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)));
  };

  const main = dedupe(buildMainIndex()(group, line).rows.map(toRow));
  const side = dedupe(buildSideIndex()(group, line).map(toRow));
  return {
    group, line,
    main, side,
    main_count: new Set(main.map(r => r.date + '|' + r.time)).size,
    side_count: new Set(side.map(r => r.date + '|' + r.time + '|' + (r.trainer || ''))).size,
  };
}

module.exports = { getEnrGroups, getLevelsOverview, getLevelsGroupClients, getLevelsGroupLectures, DEPTS };
