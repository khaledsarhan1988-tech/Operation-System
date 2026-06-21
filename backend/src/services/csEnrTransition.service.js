'use strict';

/**
 * Enr Groups — group transition + dispositions.
 *
 * From the Enr Groups page, clicking a (current) group opens a screen to:
 *   1. pick a NEXT group (an active group that hasn't started yet),
 *   2. move selected current-group clients (and add new ones from كشف العملاء /
 *      cs_sales_register) into that next group's in-app roster (enr_next_members),
 *   3. record a disposition for each client NOT moved: postponed (with follow-up
 *      date/time/method/notes), no_answer, or unsuccessful (enr_dispositions).
 *
 * In-app overlay only — never touches Drive-sourced clients/batches. Admin only
 * (enforced at the route).
 */

const db = require('../config/database');
const { saveNow } = require('../config/database');
const { csPrimaryPhone } = require('../utils/csPhoneNormalize');

const DEPTS = ['General', 'Private', 'Semi'];
const DISPOSITIONS = ['postponed', 'no_answer', 'unsuccessful'];
const FOLLOWUP_METHODS = ['call', 'whatsapp', 'visit'];

const stripSpaces = (s) => String(s == null ? '' : s).replace(/\s/g, '');
const canonGroupKey = (s) => stripSpaces(String(s == null ? '' : s).split('(')[0]);

// Same placeholder list as csEnrGroups / csDeliveries.
const IGNORED_GROUP_PATTERNS = [
  /free\s*slots/i, /do\s*-?\s*not\s*closed/i, /donot\s*closed/i,
  /grammer/i, /grammar/i, /comp[ae]ns/i, /تعويض/,
];
const isIgnoredGroup = (name) =>
  IGNORED_GROUP_PATTERNS.some(re => re.test(String(name == null ? '' : name)));

const normName = (s) =>
  String(s == null ? '' : s).replace(/\(.*?\)/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
function realCoordinator(coordStr) {
  for (const c of String(coordStr || '').split(',')) {
    const t = c.trim();
    if (t && normName(t) !== '--') return t;
  }
  return null;
}

// Main-lecture count for a group (current sheet only) — same query shape as
// csEnrGroups.makeGroupLectureMeta. Returns the DISTINCT date|time count.
const lectureCountStmt = () => db.prepare(`
  SELECT COUNT(DISTINCT date || '|' || time) AS cnt
    FROM lectures
    INNER JOIN (SELECT group_name AS g, line AS l, date(MAX(synced_at)) AS sd
                  FROM lectures WHERE session_type='main' GROUP BY group_name, line) ls
      ON ls.g = lectures.group_name AND ls.l = lectures.line
     AND date(lectures.synced_at) = ls.sd
   WHERE group_name = ? AND line = ?
     AND session_type = 'main' AND status IN ('مؤكدة', 'مجدولة')
`);

/**
 * Next-group options = ACTIVE groups (optionally in a dept) that have NOT started
 * (0 registered main lectures). Deduped, placeholders excluded.
 */
function getNextGroupOptions({ dept }) {
  dept = (dept || '').trim();
  const where = dept && DEPTS.includes(dept) ? `AND dept_type = ?` : '';
  const args = dept && DEPTS.includes(dept) ? [dept] : [];
  const rows = db.prepare(`
    SELECT group_name, line, dept_type, coordinators, start_date
      FROM batches WHERE status = 'نشطة' ${where}
  `).all(...args);

  const seen = new Map();
  for (const r of rows) {
    if (isIgnoredGroup(r.group_name)) continue;
    const key = canonGroupKey(r.group_name) + '|' + String(r.line || '');
    if (!seen.has(key)) seen.set(key, r);
  }
  const lc = lectureCountStmt();
  const out = [];
  for (const r of seen.values()) {
    if ((lc.get(r.group_name, r.line).cnt || 0) > 0) continue;   // started → not a "next" group
    out.push({
      group_name: r.group_name,
      line: r.line,
      dept_type: r.dept_type,
      coordinator: realCoordinator(r.coordinators),
      start_date: r.start_date || null,
    });
  }
  out.sort((a, b) => String(a.group_name).localeCompare(String(b.group_name), 'ar'));
  return { items: out };
}

// Distinct clients in a group (clients table), deduped by normalized phone.
function currentGroupClients(group, line) {
  const rows = db.prepare(`
    SELECT name, phone FROM clients WHERE group_name = ? AND line = ?
  `).all(group, line || '');
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const pn = csPrimaryPhone(r.phone) || r.phone || '';
    const id = pn ? 'p:' + pn : 'n:' + (r.name || '');
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ name: r.name || null, phone: r.phone || null });
  }
  return out;
}

/**
 * Transition context for one CURRENT group: its clients, each annotated with
 * whether they were already moved (and to which next group) and their disposition.
 */
function getTransition({ group, line }) {
  group = (group || '').trim();
  line = (line || '').trim();
  if (!group) throw new Error('group is required');

  const clients = currentGroupClients(group, line);

  const moved = db.prepare(`
    SELECT id, client_phone, client_name, next_group_name, next_line
      FROM enr_next_members WHERE source_group_name = ? AND source_line = ?
  `).all(group, line);
  const movedByPhone = new Map();
  for (const m of moved) {
    const key = csPrimaryPhone(m.client_phone) || m.client_phone || ('n:' + (m.client_name || ''));
    movedByPhone.set(key, m);
  }

  const disps = db.prepare(`
    SELECT * FROM enr_dispositions WHERE source_group_name = ? AND source_line = ?
  `).all(group, line);
  const dispByPhone = new Map();
  for (const d of disps) {
    const key = csPrimaryPhone(d.client_phone) || d.client_phone || ('n:' + (d.client_name || ''));
    dispByPhone.set(key, d);
  }

  const items = clients.map(c => {
    const key = csPrimaryPhone(c.phone) || c.phone || ('n:' + (c.name || ''));
    const mv = movedByPhone.get(key) || null;
    const dp = dispByPhone.get(key) || null;
    return {
      name: c.name, phone: c.phone,
      moved_to: mv ? { id: mv.id, next_group_name: mv.next_group_name, next_line: mv.next_line } : null,
      disposition: dp ? {
        id: dp.id, disposition: dp.disposition,
        followup_date: dp.followup_date, followup_time: dp.followup_time,
        followup_method: dp.followup_method, notes: dp.notes,
      } : null,
    };
  });
  return { group, line, count: items.length, items };
}

/**
 * Search كشف العملاء (cs_sales_register) by name / mobile / code. Returns distinct
 * clients (by mobile) for adding brand-new members to a next group.
 */
function searchSalesRegister({ q, limit }) {
  q = (q || '').trim();
  limit = Math.min(50, Math.max(1, parseInt(limit, 10) || 25));
  if (!q) return { items: [] };
  const like = '%' + q + '%';
  const rows = db.prepare(`
    SELECT client_name, mobile_no, code, courses
      FROM cs_sales_register
     WHERE client_name LIKE ? OR mobile_no LIKE ? OR code LIKE ?
     ORDER BY id DESC
     LIMIT 500
  `).all(like, like, like);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const pn = csPrimaryPhone(r.mobile_no) || r.mobile_no || '';
    const id = pn ? 'p:' + pn : 'n:' + (r.client_name || '');
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ name: r.client_name || null, phone: r.mobile_no || null, code: r.code || null, courses: r.courses || null });
    if (out.length >= limit) break;
  }
  return { items: out };
}

/**
 * Add members to a next group's roster. members = [{name, phone}]. Clearing any
 * existing disposition for a client that is now being moved (they're no longer
 * "not moved"). addedFrom = 'current' | 'sales_register'.
 */
function addNextMembers({ nextGroup, nextLine, sourceGroup, sourceLine, members, addedFrom, user }) {
  nextGroup = (nextGroup || '').trim();
  nextLine = (nextLine || '').trim();
  if (!nextGroup) throw new Error('nextGroup is required');
  if (!Array.isArray(members) || !members.length) throw new Error('members required');
  addedFrom = addedFrom === 'sales_register' ? 'sales_register' : 'current';

  const ins = db.prepare(`
    INSERT OR IGNORE INTO enr_next_members
      (next_group_name, next_line, client_name, client_phone, source_group_name, source_line, added_from, created_by, created_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const delDisp = db.prepare(`DELETE FROM enr_dispositions WHERE source_group_name = ? AND source_line = ? AND client_phone = ?`);
  const tx = db.transaction(() => {
    let added = 0;
    for (const m of members) {
      const phone = (m.phone || '').trim();
      const name = (m.name || '').trim() || null;
      const r = ins.run(nextGroup, nextLine, name, phone || null,
        (sourceGroup || '').trim() || null, (sourceLine || '').trim() || null,
        addedFrom, user?.id || null, user?.full_name || user?.name || null);
      if (r.changes) added++;
      if (sourceGroup && phone) delDisp.run((sourceGroup || '').trim(), (sourceLine || '').trim(), phone);
    }
    return added;
  });
  const added = tx();
  saveNow();
  return { added };
}

function removeNextMember({ id }) {
  id = parseInt(id, 10);
  if (!id) throw new Error('id is required');
  db.prepare(`DELETE FROM enr_next_members WHERE id = ?`).run(id);
  saveNow();
  return { ok: true };
}

/** Roster of a next group. */
function getNextRoster({ nextGroup, nextLine }) {
  nextGroup = (nextGroup || '').trim();
  nextLine = (nextLine || '').trim();
  if (!nextGroup) throw new Error('nextGroup is required');
  const items = db.prepare(`
    SELECT id, client_name, client_phone, source_group_name, added_from, created_at
      FROM enr_next_members WHERE next_group_name = ? AND next_line = ?
      ORDER BY id DESC
  `).all(nextGroup, nextLine);
  return { next_group_name: nextGroup, next_line: nextLine, count: items.length, items };
}

/**
 * Upsert a disposition for a current-group client who is NOT being moved.
 * Removing them from the next-group roster if they were there (mutually exclusive).
 */
function setDisposition({ sourceGroup, sourceLine, dept, clientName, clientPhone,
  disposition, followupDate, followupTime, followupMethod, notes, user }) {
  sourceGroup = (sourceGroup || '').trim();
  sourceLine = (sourceLine || '').trim();
  clientPhone = (clientPhone || '').trim();
  if (!sourceGroup) throw new Error('sourceGroup is required');
  if (!clientPhone && !clientName) throw new Error('client identity is required');
  if (!DISPOSITIONS.includes(disposition)) throw new Error('Invalid disposition');
  // Follow-up fields apply to "postponed" only.
  const fDate = disposition === 'postponed' ? (followupDate || null) : null;
  const fTime = disposition === 'postponed' ? (followupTime || null) : null;
  const fMethod = (disposition === 'postponed' && FOLLOWUP_METHODS.includes(followupMethod)) ? followupMethod : null;

  const existing = db.prepare(`
    SELECT id FROM enr_dispositions WHERE source_group_name = ? AND source_line = ? AND client_phone = ?
  `).get(sourceGroup, sourceLine, clientPhone);

  const tx = db.transaction(() => {
    if (existing) {
      db.prepare(`
        UPDATE enr_dispositions
           SET dept = ?, client_name = ?, disposition = ?, followup_date = ?, followup_time = ?,
               followup_method = ?, notes = ?, updated_at = datetime('now', '+2 hours')
         WHERE id = ?
      `).run(dept || null, clientName || null, disposition, fDate, fTime, fMethod, notes || null, existing.id);
    } else {
      db.prepare(`
        INSERT INTO enr_dispositions
          (source_group_name, source_line, dept, client_name, client_phone, disposition,
           followup_date, followup_time, followup_method, notes, created_by, created_by_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sourceGroup, sourceLine, dept || null, clientName || null, clientPhone || null, disposition,
        fDate, fTime, fMethod, notes || null, user?.id || null, user?.full_name || user?.name || null);
    }
    // A client with a disposition is NOT moved → drop them from this source's next-roster.
    if (clientPhone) {
      db.prepare(`DELETE FROM enr_next_members WHERE source_group_name = ? AND source_line = ? AND client_phone = ?`)
        .run(sourceGroup, sourceLine, clientPhone);
    }
  });
  tx();
  saveNow();
  return { ok: true };
}

function clearDisposition({ id }) {
  id = parseInt(id, 10);
  if (!id) throw new Error('id is required');
  db.prepare(`DELETE FROM enr_dispositions WHERE id = ?`).run(id);
  saveNow();
  return { ok: true };
}

/**
 * The three disposition lists (postponed / no_answer / unsuccessful) for the tabs.
 * Filters: type (disposition), q (name/phone/group), dept, from/to (followup_date
 * for postponed, else created_at date).
 */
function getDispositions({ type, q, dept, from, to, page, pageSize }) {
  type = (type || '').trim();
  q = (q || '').trim();
  dept = (dept || '').trim();
  from = (from || '').trim();
  to = (to || '').trim();
  page = Math.max(1, parseInt(page, 10) || 1);
  pageSize = Math.min(200, Math.max(5, parseInt(pageSize, 10) || 25));

  const where = [];
  const args = [];
  if (type && DISPOSITIONS.includes(type)) { where.push(`disposition = ?`); args.push(type); }
  if (dept && DEPTS.includes(dept)) { where.push(`dept = ?`); args.push(dept); }
  if (q) {
    where.push(`(client_name LIKE ? OR client_phone LIKE ? OR source_group_name LIKE ?)`);
    const like = '%' + q + '%'; args.push(like, like, like);
  }
  // Date range: follow-up date for postponed, else created date.
  if (from) { where.push(`date(COALESCE(followup_date, created_at)) >= ?`); args.push(from); }
  if (to)   { where.push(`date(COALESCE(followup_date, created_at)) <= ?`); args.push(to); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM enr_dispositions ${whereSql}`).get(...args).c;
  const items = db.prepare(`
    SELECT * FROM enr_dispositions ${whereSql}
     ORDER BY COALESCE(followup_date, date(created_at)) DESC, id DESC
     LIMIT ? OFFSET ?
  `).all(...args, pageSize, (page - 1) * pageSize);

  return {
    type, page, page_size: pageSize, total,
    total_pages: Math.ceil(total / pageSize) || 1,
    items,
  };
}

module.exports = {
  getNextGroupOptions, getTransition, searchSalesRegister,
  addNextMembers, removeNextMember, getNextRoster,
  setDisposition, clearDisposition, getDispositions,
  DEPTS, DISPOSITIONS, FOLLOWUP_METHODS,
};
