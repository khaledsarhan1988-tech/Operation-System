'use strict';

/**
 * Department Deliveries — analytics report (per department).
 *
 * Answers, for one dept tab (General / Semi / Private), EXACTLY consistent with the
 * deliveries page numbers because it reuses csDeliveries' exported building blocks:
 *   1) how many clients still have remaining levels (remaining_levels > 0),
 *   2) whether each is placed in an UPCOMING group (a not-started/waiting batch group
 *      they're registered in, OR one they were moved to via Enr Groups),
 *   3) the LAST group each was in (most recent by last-lecture date, active+inactive)
 *      + its level (parsed from the group name),
 *   4) how many clients GRADUATE in a date range = they're in their FINAL paid level
 *      (remaining == 0) AND their last group's last-lecture date is within [from,to].
 *
 * Read-only, admin. Additive module — does NOT modify csDeliveries.
 */

const db = require('../config/database');
const { csPrimaryPhone } = require('../utils/csPhoneNormalize');
const { isIgnoredGroup } = require('../utils/csGroupHelpers');
const csDel = require('./csDeliveries.service');

const DEPTS = ['General', 'Private', 'Semi'];

// Per-group first/last-lecture date (current sheet only), aggregated by CANON
// key. The same real group is spelled differently across sources — a client's
// past-group entry can hold the bare daily-sheet name ("Jun_22_Mon_9Pm_General1")
// while `lectures` only has trainer-suffixed variants ("…General1(Ahmed)zainab").
// The old exact-name lookup returned NULL dates for those, so analytics picked
// an OLDER group as آخر مجموعة (owner case 01003803926: showed May_4 Starter3
// although his real last group was Jun_22 General1). One canon-grouped scan.
function makeLectureMeta() {
  const { canonKey } = require('../utils/csBatchMatch');
  const rows = db.prepare(`
    SELECT lectures.group_name AS g, MIN(date) AS mn, MAX(date) AS mx
      FROM lectures
      INNER JOIN (SELECT group_name AS g, line AS l, date(MAX(synced_at)) AS sd
                    FROM lectures WHERE session_type='main' GROUP BY group_name, line) ls
        ON ls.g = lectures.group_name AND ls.l = lectures.line AND date(lectures.synced_at) = ls.sd
     WHERE session_type='main' AND status IN ('مؤكدة','مجدولة')
     GROUP BY lectures.group_name, lectures.line
  `).all();
  const byCanon = new Map();
  for (const r of rows) {
    const ck = canonKey(r.g);
    const cur = byCanon.get(ck);
    if (!cur) byCanon.set(ck, { start: r.mn || null, end: r.mx || null });
    else {
      if (r.mn && (!cur.start || r.mn < cur.start)) cur.start = r.mn;
      if (r.mx && (!cur.end || r.mx > cur.end)) cur.end = r.mx;
    }
  }
  return (group, _line) => byCanon.get(canonKey(group)) || { start: null, end: null };
}

// "M/D/YYYY" → sortable YYYYMMDD (0 if unparseable). SAME as csDeliveries.salesDateKey.
function salesDateKey(s) {
  const m = String(s == null ? '' : s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? (parseInt(m[3], 10) * 10000 + parseInt(m[1], 10) * 100 + parseInt(m[2], 10)) : 0;
}

// Per-phone recency in كشف العملاء = the latest sale entry_date (tiebreak: highest
// row id = most recently added). Drives the "newest → oldest" client ordering.
function buildRecencyMap() {
  const map = new Map();   // pn → { dateKey, id }
  for (const r of db.prepare(`SELECT mobile_no AS m, entry_date AS d, id FROM cs_sales_register WHERE mobile_no IS NOT NULL AND TRIM(mobile_no) <> ''`).all()) {
    const pn = csPrimaryPhone(r.m);
    if (!pn) continue;
    const dk = salesDateKey(r.d);
    const cur = map.get(pn);
    if (!cur || dk > cur.dateKey || (dk === cur.dateKey && r.id > cur.id)) map.set(pn, { dateKey: dk, id: r.id });
  }
  return map;
}

// Parse the level label (e.g. "General 4", "Conversation 3", "Starter 2") from a
// group name. Reads the family + number before the first "(".
function parseLevel(name) {
  const base = String(name == null ? '' : name).split('(')[0];
  // Family must start the string or follow a non-alphanumeric separator (space/_/etc).
  // Can't use \b — group names use "_" (a word char) as a separator, and a lone "g"
  // would grab the "g" of the month "Aug" + the day number (Aug_16 → "General 16").
  const m = base.match(/(?:^|[^a-z0-9])(conversation|con|general|gen|starter|str)\s*_?\s*(\d+)/i);
  if (!m) return null;
  const fam = m[1].toLowerCase();
  const label = /^con/.test(fam) ? 'Conversation'
    : /^(general|gen)/.test(fam) ? 'General'
    : /^(starter|str)/.test(fam) ? 'Starter'
    : m[1];
  return `${label} ${m[2]}`;
}

/**
 * dept: 'General' | 'Private' | 'Semi'
 * gradFrom / gradTo: YYYY-MM-DD range for the "graduating in period" count.
 */
function getDeptAnalytics({ dept, gradFrom, gradTo }) {
  if (!DEPTS.includes(dept)) throw new Error('Invalid dept (use General | Private | Semi)');
  gradFrom = (gradFrom || '').trim();
  gradTo = (gradTo || '').trim();

  const ctx = csDel.buildBalanceContext();        // { salesMap, activeMap, inactiveMap } (phone-aliases folded)
  const lectMeta = makeLectureMeta();
  // Secondary→primary phone aliases (كشف العملاء mobile_no2): ctx keys are the
  // PRIMARY phones, so every phone landing in a lookup set must resolve too.
  const alias = csDel.buildPhoneAliasMap ? csDel.buildPhoneAliasMap() : new Map();
  const resolvePn = (pn) => (pn && alias.get(pn)) || pn;
  const recency = buildRecencyMap();              // pn → newest-in-كشف-العملاء key
  for (const [pn, v] of [...recency]) {           // fold alias recency into primary (newest wins)
    const p = resolvePn(pn);
    if (p === pn) continue;
    const cur = recency.get(p);
    if (!cur || v.dateKey > cur.dateKey || (v.dateKey === cur.dateKey && v.id > cur.id)) recency.set(p, v);
    recency.delete(pn);
  }

  // Upcoming = registered in a WAITING batch group (not started), keyed by phone.
  const waitingPhones = new Set();
  for (const r of db.prepare(`
    SELECT c.phone AS phone, c.group_name AS group_name
      FROM clients c
      JOIN batches b ON b.group_name = c.group_name AND b.line = c.line
     WHERE b.status IN ('بانتظار تسجيل المتدربين', 'بانتظار تسجيل المحاضرات')
  `).all()) {
    if (isIgnoredGroup(r.group_name)) continue;   // placement/تعويض are not real upcoming groups
    const pn = csPrimaryPhone(r.phone); if (pn) waitingPhones.add(resolvePn(pn));
  }

  // Upcoming = moved to a next group via the Enr Groups transition screen.
  const movedPhones = new Set();
  try {
    for (const r of db.prepare(`SELECT client_phone AS phone FROM enr_next_members WHERE client_phone IS NOT NULL`).all()) {
      const pn = csPrimaryPhone(r.phone); if (pn) movedPhones.add(resolvePn(pn));
    }
  } catch (_) { /* table may not exist yet */ }

  const maxDate = (a, b) => (!a ? b : !b ? a : (a >= b ? a : b));
  const inRange = (d) => !!d && (!gradFrom || d >= gradFrom) && (!gradTo || d <= gradTo);

  let totalWithRemaining = 0, upcomingYes = 0, upcomingNo = 0, graduatingCount = 0;
  const withRemaining = [];
  const graduating = [];

  for (const pn of ctx.salesMap.keys()) {
    const bal = csDel.membershipBalance(ctx, pn, dept);
    if (bal.state === 'unknown') continue;        // not part of this dept's population

    const active = ctx.activeMap.get(pn) || [];
    const activeKeys = new Set(active.map(a => String(a.group_name).split('(')[0].replace(/\s/g, '')));
    const inactive = [...(ctx.inactiveMap.get(pn) || [])].filter(g => !activeKeys.has(String(g).split('(')[0].replace(/\s/g, '')));

    // Last-lecture end date per group.
    const activeEnds = active.map(a => ({ name: a.group_name, end: lectMeta(a.group_name, a.line).end }));
    const inactiveEnds = inactive.map(g => ({ name: g, end: lectMeta(g, null).end }));

    // Active last end (their current last group's last lecture).
    const activeLastEnd = activeEnds.reduce((acc, x) => maxDate(acc, x.end), null);
    // Overall last group (active + inactive) by end date → for display + level.
    const allEnds = [...activeEnds, ...inactiveEnds].filter(x => x.end);
    let lastGroup = null, lastEnd = null;
    for (const x of allEnds) { if (!lastEnd || x.end >= lastEnd) { lastEnd = x.end; lastGroup = x.name; } }
    if (!lastGroup) { // no dated group → fall back to first active/inactive name
      lastGroup = (active[0]?.group_name) || inactive[0] || null;
    }

    const name = ctx.salesMap.get(pn)?.name || null;
    const upcoming = waitingPhones.has(pn) || movedPhones.has(pn);

    if (bal.remaining > 0) {
      totalWithRemaining++;
      upcoming ? upcomingYes++ : upcomingNo++;
      withRemaining.push({
        phone: pn, name, remaining: bal.remaining, paid_months: bal.paid_months, groups_taken: bal.groups_taken,
        in_upcoming: upcoming, last_group: lastGroup, last_level: parseLevel(lastGroup), last_date: lastEnd,
      });
    }

    // Graduating = final paid level (remaining == 0) + last group's last lecture in range.
    const gradDate = activeLastEnd || lastEnd;
    if (bal.remaining === 0 && inRange(gradDate)) {
      graduatingCount++;
      graduating.push({
        phone: pn, name, paid_months: bal.paid_months, groups_taken: bal.groups_taken,
        last_group: lastGroup, last_level: parseLevel(lastGroup), grad_date: gradDate, in_upcoming: upcoming,
      });
    }
  }

  // Order clients by newest → oldest in كشف العملاء (latest sale date, then latest id).
  const rk = (pn) => recency.get(pn) || { dateKey: 0, id: 0 };
  const byRecency = (a, b) => { const A = rk(a.phone), B = rk(b.phone); return (B.dateKey - A.dateKey) || (B.id - A.id) || String(a.name || '').localeCompare(String(b.name || ''), 'ar'); };
  withRemaining.sort(byRecency);
  graduating.sort(byRecency);

  return {
    dept,
    total_with_remaining: totalWithRemaining,
    with_remaining_in_upcoming: upcomingYes,
    with_remaining_not_upcoming: upcomingNo,
    graduating_count: graduatingCount,
    grad_from: gradFrom || null,
    grad_to: gradTo || null,
    clients: withRemaining,
    graduating,
  };
}

module.exports = { getDeptAnalytics, DEPTS };
