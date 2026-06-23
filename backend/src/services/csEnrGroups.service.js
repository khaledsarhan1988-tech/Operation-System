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
const canonGroupKey = (s) => stripSpaces(String(s == null ? '' : s).split('(')[0]);

// Placeholder / non-real groups excluded entirely (same list as csDeliveries).
const IGNORED_GROUP_PATTERNS = [
  /free\s*slots/i,
  /do\s*-?\s*not\s*closed/i,
  /donot\s*closed/i,
  /grammer/i,
  /grammar/i,
  /comp[ae]ns/i,
  /تعويض/,
];
const isIgnoredGroup = (name) => {
  const s = String(name == null ? '' : name);
  return IGNORED_GROUP_PATTERNS.some(re => re.test(s));
};

// Normalize a coordinator name for the '--' placeholder check.
const normName = (s) =>
  String(s == null ? '' : s).replace(/\(.*?\)/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

// First REAL coordinator in a (possibly comma-separated) coordinators string —
// skip the '--' placeholder (a "تعويض سيشن" comp-session group often sits with
// coordinators='--', which would otherwise hide the real coordinator).
function realCoordinator(coordStr) {
  for (const c of String(coordStr || '').split(',')) {
    const t = c.trim();
    if (t && normName(t) !== '--') return t;
  }
  return null;
}

// Per-group lecture meta: count + first/last date. IDENTICAL query to
// csDeliveries.makeGroupLectureMeta (main only, مؤكدة+مجدولة, current sheet only,
// DISTINCT date|time). Memoized per (group_name, line) for the page run.
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
    const key = String(group) + '' + String(line || '');
    if (memo.has(key)) return memo.get(key);
    const r = stmt.get(group, line || '') || {};
    const meta = { lectures: r.cnt || 0, start_date: r.mn || null, end_date: r.mx || null };
    memo.set(key, meta);
    return meta;
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

module.exports = { getEnrGroups, DEPTS };
