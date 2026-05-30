'use strict';

/**
 * Department Deliveries (تسليمات الأقسام).
 *
 * A per-department reporting view built ON TOP of the existing cs_* data —
 * it does NOT ingest anything new. For each client (keyed by normalized
 * phone) it combines:
 *   - cs_subscriptions          → membership count + dept + paid months
 *   - clients ∩ batches (نشطة)  → active groups + coordinator
 *   - cs_completed_levels       → inactive (past) groups from the Drive level folders
 *   - csClientPlan              → remaining levels (paid − completed)
 *   - cs_client_delivery_status → the MANUAL status (churned/postponed/exit_level/refund/active)
 *
 * Department placement rule (agreed with user):
 *   resolved_dept = active group's dept_type when the client has an active group,
 *   otherwise the client's most-recent subscription dept. A client appears on
 *   exactly ONE department page.
 *
 * No writes here except setDeliveryStatus (the manual status).
 */

const db = require('../config/database');
const { saveNow } = require('../config/database');
const { csPrimaryPhone } = require('../utils/csPhoneNormalize');

const DEPTS = ['General', 'Private', 'Semi'];
const STATUSES = ['active', 'churned', 'postponed', 'exit_level', 'refund'];

const stripSpaces = (s) => String(s == null ? '' : s).replace(/\s/g, '');

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

// Placeholder / non-real groups that must be EXCLUDED from the deliveries view
// entirely — they are not real client groups (e.g. the "Free Slots(DONOT CLOSED)"
// filler batch). Add more patterns here as needed.
const IGNORED_GROUP_PATTERNS = [
  /free\s*slots/i,
  /do\s*-?\s*not\s*closed/i,
  /donot\s*closed/i,
  /grammer/i,                  // "Grammer_Con_G(...)" — grammar sessions, not a level group
  /grammar/i,                  // correct spelling, just in case
];
const isIgnoredGroup = (name) => {
  const s = String(name == null ? '' : name);
  return IGNORED_GROUP_PATTERNS.some(re => re.test(s));
};

// Normalize a coordinator/user name for comparison: drop any "(...)" suffix,
// trim, lowercase, collapse spaces. Used to match the logged-in coordinator
// (users.full_name) against batches.coordinators / team_members.name.
const normName = (s) =>
  String(s == null ? '' : s).replace(/\(.*?\)/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

// Does a (possibly comma-separated) coordinator string contain this person?
function coordStrHasName(coordStr, targetNorm) {
  if (!targetNorm) return false;
  return String(coordStr || '').split(',').map(normName).some(c => c && c === targetNorm);
}

// phone_norm → [{ group_name, dept_type, coordinators }] for groups still active.
function buildActiveGroupMap() {
  const rows = db.prepare(`
    SELECT c.phone AS phone, c.group_name AS group_name,
           b.dept_type AS dept_type, b.coordinators AS coordinators
      FROM clients c
      JOIN batches b
        ON b.group_name = c.group_name AND b.line = c.line
     WHERE b.status = 'نشطة'
  `).all();
  const map = new Map();
  for (const r of rows) {
    const pn = csPrimaryPhone(r.phone);
    if (!pn) continue;
    if (isIgnoredGroup(r.group_name)) continue;   // skip placeholder groups (Free Slots, …)
    if (!map.has(pn)) map.set(pn, []);
    map.get(pn).push({ group_name: r.group_name, dept_type: r.dept_type, coordinators: r.coordinators });
  }
  return map;
}

// phone_norm → Set(group_name_raw) from completed-level Drive files.
function buildInactiveGroupMap() {
  const rows = db.prepare(`
    SELECT client_phone_norm AS pn, group_name_raw AS g
      FROM cs_completed_levels
     WHERE group_name_raw IS NOT NULL AND TRIM(group_name_raw) != ''
  `).all();
  const map = new Map();
  for (const r of rows) {
    if (!r.pn) continue;
    const code = cleanGroupCode(r.g);     // strip status suffix + dedupe same group across levels
    if (!code || isIgnoredGroup(code)) continue;   // skip empty + placeholder groups (Free Slots, …)
    if (!map.has(r.pn)) map.set(r.pn, new Set());
    map.get(r.pn).add(code);
  }
  return map;
}

// Set of phones whose subscriptions include an INTENSIVE course ("مكثفة").
// Intensive levels run at a faster pace (2 weeks each) vs 1 month for regular.
function buildIntensiveSet() {
  const rows = db.prepare(`
    SELECT DISTINCT client_phone_norm AS pn
      FROM cs_subscriptions
     WHERE is_ignored = 0 AND product_name_raw LIKE '%مكثف%'
  `).all();
  return new Set(rows.map(r => r.pn).filter(Boolean));
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
function getDepartmentDeliveries({ dept, q, status, page, pageSize, user }) {
  if (!DEPTS.includes(dept)) throw new Error('Invalid dept (use General | Private | Semi)');
  page = Math.max(1, parseInt(page, 10) || 1);
  pageSize = Math.min(200, Math.max(5, parseInt(pageSize, 10) || 25));
  q = (q || '').trim();
  status = (status || '').trim();

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

  // Per-phone subscription aggregate (non-ignored rows only).
  const subRows = db.prepare(`
    SELECT client_phone_norm AS pn,
           MAX(client_name_raw) AS name,
           COUNT(*)             AS membership_count,
           SUM(COALESCE(months, 0)) AS total_months
      FROM cs_subscriptions
     WHERE is_ignored = 0 AND client_phone_norm IS NOT NULL AND client_phone_norm != ''
     GROUP BY client_phone_norm
  `).all();

  // Most-recent subscription dept per phone (fallback when no active group).
  const deptRows = db.prepare(`
    SELECT client_phone_norm AS pn, dept
      FROM cs_subscriptions
     WHERE is_ignored = 0 AND dept IS NOT NULL
     ORDER BY COALESCE(subscription_date, '') ASC, id ASC
  `).all();
  const latestDept = new Map();
  for (const r of deptRows) latestDept.set(r.pn, r.dept);   // last write wins = latest

  const activeMap     = buildActiveGroupMap();
  const coordFallback = buildCoordFallbackMap();

  const statusRows = db.prepare(`SELECT client_phone_norm AS pn, status, note FROM cs_client_delivery_status`).all();
  const statusMap = new Map(statusRows.map(r => [r.pn, { status: r.status, note: r.note }]));

  const items = [];
  for (const s of subRows) {
    const pn = s.pn;
    const active = activeMap.get(pn) || [];
    const resolvedDept = active.length ? active[0].dept_type : (latestDept.get(pn) || null);
    if (resolvedDept !== dept) continue;

    const st = statusMap.get(pn)?.status || 'active';
    if (status && status !== 'all' && st !== status) continue;

    const name = s.name || null;
    if (q) {
      const ql = q.toLowerCase();
      if (!(String(name || '').toLowerCase().includes(ql) || pn.includes(q))) continue;
    }

    const activeGroups = active.map(a => a.group_name);
    const coordinator = (active.find(a => a.coordinators && String(a.coordinators).trim())?.coordinators)
                        || coordFallback.get(pn) || null;

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
      membership_count: s.membership_count,
      total_months: s.total_months,
      status: st,
      status_note: statusMap.get(pn)?.note || null,
      active_groups: activeGroups,
      coordinator,
      _hasActive: active.length > 0,
    });
  }

  // Active clients first, then alphabetical by name.
  items.sort((a, b) =>
    (Number(b._hasActive) - Number(a._hasActive)) ||
    String(a.name || '').localeCompare(String(b.name || ''), 'ar'));

  const total = items.length;
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  // Heavy per-row work (inactive groups + remaining levels + expected time)
  // only for the current page slice so the report stays responsive on sql.js.
  const inactiveMap = buildInactiveGroupMap();
  const intensiveSet = buildIntensiveSet();
  const csPlan = require('./csClientPlan.service');
  for (const it of pageItems) {
    const activeNorm = new Set(it.active_groups.map(stripSpaces));
    const inactiveAll = [...(inactiveMap.get(it.phone) || [])];
    it.inactive_groups = inactiveAll.filter(g => !activeNorm.has(stripSpaces(g)));

    let lastLevelDate = null, daysSinceLast = null;
    try {
      const plan = csPlan.getClientPlan(it.phone);
      it.remaining_levels = plan ? plan.summary.pending_count : null;
      it.paid_months = plan ? plan.summary.paid_months : it.total_months;
      it.completed_count = plan ? plan.summary.completed_count : null;
      // Per-subscription months so the UI can show e.g. "6+3 = 9".
      it.months_list = plan?.paid?.breakdown?.map(b => b.months).filter(m => m != null) || [];
      lastLevelDate = plan?.summary?.last_level_date || null;
      daysSinceLast = plan?.summary?.days_since_last_level ?? null;
    } catch (_) {
      it.remaining_levels = null;
      it.months_list = [];
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

module.exports = { getDepartmentDeliveries, setDeliveryStatus, DEPTS, STATUSES };
