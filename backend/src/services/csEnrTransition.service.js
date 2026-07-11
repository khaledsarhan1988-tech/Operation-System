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
const { IGNORED_GROUP_PATTERNS, isIgnoredGroup, normName, realCoordinator } = require('../utils/csGroupHelpers');

const DEPTS = ['General', 'Private', 'Semi'];
const DISPOSITIONS = ['postponed', 'no_answer', 'unsuccessful'];
const FOLLOWUP_METHODS = ['call', 'whatsapp', 'visit'];
const DISP_LABEL = (d) => ({ postponed: 'تأجيل', no_answer: 'عدم الرد', unsuccessful: 'غير ناجح' }[d] || d);

// Append a row to the Enr Groups activity log (who did what, when).
function logActivity({ action, sourceGroup, sourceLine, nextGroup, clientName, clientPhone, detail, user }) {
  db.prepare(`
    INSERT INTO enr_activity_log
      (action, source_group_name, source_line, next_group_name, client_name, client_phone, detail, actor_id, actor_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(action, sourceGroup || null, sourceLine || null, nextGroup || null,
    clientName || null, clientPhone || null, detail || null,
    user?.id || null, user?.full_name || user?.name || null);
}

const stripSpaces = (s) => String(s == null ? '' : s).replace(/\s/g, '');
const canonGroupKey = (s) => stripSpaces(String(s == null ? '' : s).split('(')[0]);

// IGNORED_GROUP_PATTERNS / isIgnoredGroup / normName / realCoordinator now come
// from ../utils/csGroupHelpers (shared with csDeliveries & csEnrGroups).

// Real batches.status → status key (matches csEnrGroups / SystemReports).
const STATUS_MAP = {
  'بانتظار تسجيل المحاضرات': 'waiting_lectures',
  'بانتظار تسجيل المتدربين': 'waiting_trainees',
};

// Placement-test placeholder groups (تحديد مستوى / Placement Test) are NOT real
// destination groups — excluded from the next-group pickers only (owner decision
// 2026-07-11). Deliberately LOCAL, not in the shared IGNORED_GROUP_PATTERNS:
// adding them there would change deliveries/EnrGroups level counts.
const PLACEMENT_PATTERNS = [/placem/i, /تحديد مستو/];
const isPlacementGroup = (name) =>
  PLACEMENT_PATTERNS.some(re => re.test(String(name == null ? '' : name)));

/**
 * Next-group options = groups whose REAL batches.status is one of the two
 * "waiting" states (بانتظار تسجيل المتدربين / المحاضرات) — i.e. groups that
 * haven't started yet — scoped to the source group's dept AND line. Deduped,
 * placeholders excluded. (Same definition as the SystemReports waiting pages.)
 */
function getNextGroupOptions({ dept, line }) {
  dept = (dept || '').trim();
  line = (line || '').trim();
  const conds = [`status IN ('بانتظار تسجيل المتدربين', 'بانتظار تسجيل المحاضرات')`];
  const args = [];
  if (dept && DEPTS.includes(dept)) { conds.push(`dept_type = ?`); args.push(dept); }
  if (line) { conds.push(`line = ?`); args.push(line); }
  const rows = db.prepare(`
    SELECT group_name, line, dept_type, coordinators, start_date, status
      FROM batches WHERE ${conds.join(' AND ')}
  `).all(...args);

  const seen = new Map();
  for (const r of rows) {
    if (isIgnoredGroup(r.group_name)) continue;
    if (isPlacementGroup(r.group_name)) continue;
    const key = canonGroupKey(r.group_name) + '|' + String(r.line || '');
    if (!seen.has(key)) seen.set(key, r);
  }
  const out = [...seen.values()].map(r => ({
    group_name: r.group_name,
    line: r.line,
    dept_type: r.dept_type,
    coordinator: realCoordinator(r.coordinators),
    start_date: r.start_date || null,
    status: STATUS_MAP[r.status] || null,
  }));
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
function getTransition({ group, line, dept }) {
  group = (group || '').trim();
  line = (line || '').trim();
  dept = (dept || '').trim();
  if (!group) throw new Error('group is required');
  // Membership balance is per-dept = the SOURCE group's track. Prefer the caller's
  // dept (the EnrGroups tab); fall back to the group's batches.dept_type.
  if (!dept) {
    const b = db.prepare(`SELECT dept_type FROM batches WHERE group_name = ? AND line = ? LIMIT 1`).get(group, line);
    dept = (b && b.dept_type) || '';
  }

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

  // Client list = UNION of the Drive members + clients moved out + dispositioned
  // clients. The union recovers an ENDED group's clients (gone from `clients` once
  // the group leaves batches) so its transition screen still lists everyone.
  const byKey = new Map();
  const addClient = (name, phone) => {
    const key = csPrimaryPhone(phone) || phone || ('n:' + (name || ''));
    if (!byKey.has(key)) byKey.set(key, { name: name || null, phone: phone || null });
    else if (!byKey.get(key).name && name) byKey.get(key).name = name;
  };
  for (const c of currentGroupClients(group, line)) addClient(c.name, c.phone);
  for (const m of moved) addClient(m.client_name, m.client_phone);
  for (const d of disps) addClient(d.client_name, d.client_phone);
  const clients = [...byKey.values()];

  // Entries (follow-up/note thread) for all this group's dispositions.
  const entriesByDisp = new Map();
  const dispIds = disps.map(d => d.id);
  if (dispIds.length) {
    const rows = db.prepare(
      `SELECT * FROM enr_disposition_entries WHERE disposition_id IN (${dispIds.map(() => '?').join(',')}) ORDER BY id ASC`
    ).all(...dispIds);
    for (const e of rows) {
      if (!entriesByDisp.has(e.disposition_id)) entriesByDisp.set(e.disposition_id, []);
      entriesByDisp.get(e.disposition_id).push(e);
    }
  }

  // Membership level-balance per client (SAME number as the deliveries page) + the
  // projection after this move. Built once for the group; lazy-required to avoid
  // any module load-order cycle.
  let csBal = null, balCtx = null;
  if (dept) { csBal = require('./csDeliveries.service'); balCtx = csBal.buildBalanceContext(); }

  const items = clients.map(c => {
    const key = csPrimaryPhone(c.phone) || c.phone || ('n:' + (c.name || ''));
    const mv = movedByPhone.get(key) || null;
    const dp = dispByPhone.get(key) || null;
    return {
      name: c.name, phone: c.phone,
      moved_to: mv ? { id: mv.id, next_group_name: mv.next_group_name, next_line: mv.next_line } : null,
      disposition: dp ? {
        id: dp.id, disposition: dp.disposition,
        entries: entriesByDisp.get(dp.id) || [],
      } : null,
      balance: balCtx ? csBal.membershipBalance(balCtx, c.phone, dept) : null,
    };
  });
  return { group, line, dept: dept || null, count: items.length, items };
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
  const delEntries = db.prepare(`DELETE FROM enr_disposition_entries WHERE disposition_id IN (SELECT id FROM enr_dispositions WHERE source_group_name = ? AND source_line = ? AND client_phone = ?)`);
  const tx = db.transaction(() => {
    let added = 0;
    for (const m of members) {
      const phone = (m.phone || '').trim();
      const name = (m.name || '').trim() || null;
      const r = ins.run(nextGroup, nextLine, name, phone || null,
        (sourceGroup || '').trim() || null, (sourceLine || '').trim() || null,
        addedFrom, user?.id || null, user?.full_name || user?.name || null);
      if (r.changes) {
        added++;
        logActivity({ action: 'move_in', sourceGroup, sourceLine, nextGroup, clientName: name, clientPhone: phone,
          detail: addedFrom === 'sales_register' ? 'من كشف العملاء' : null, user });
      }
      // Moving a client out of "not moved" → drop any disposition they had.
      if (sourceGroup && phone) {
        delEntries.run((sourceGroup || '').trim(), (sourceLine || '').trim(), phone);
        delDisp.run((sourceGroup || '').trim(), (sourceLine || '').trim(), phone);
      }
    }
    return added;
  });
  const added = tx();
  saveNow();
  return { added };
}

function removeNextMember({ id, user }) {
  id = parseInt(id, 10);
  if (!id) throw new Error('id is required');
  const row = db.prepare(`SELECT * FROM enr_next_members WHERE id = ?`).get(id);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM enr_next_members WHERE id = ?`).run(id);
    if (row) logActivity({ action: 'move_out', sourceGroup: row.source_group_name, sourceLine: row.source_line,
      nextGroup: row.next_group_name, clientName: row.client_name, clientPhone: row.client_phone, user });
  });
  tx();
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

// Insert one entry (follow-up for postpone / plain note otherwise) + log it.
// Runs inside an existing transaction. Returns the new entry id.
function _insertEntry(disp, { followupDate, followupTime, followupMethod, note }, user) {
  const fDate = disp.disposition === 'postponed' ? (followupDate || null) : null;
  const fTime = disp.disposition === 'postponed' ? (followupTime || null) : null;
  const fMethod = (disp.disposition === 'postponed' && FOLLOWUP_METHODS.includes(followupMethod)) ? followupMethod : null;
  const r = db.prepare(`
    INSERT INTO enr_disposition_entries
      (disposition_id, followup_date, followup_time, followup_method, note, created_by, created_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(disp.id, fDate, fTime, fMethod, note || null, user?.id || null, user?.full_name || user?.name || null);
  logActivity({
    action: 'entry_added', sourceGroup: disp.source_group_name, sourceLine: disp.source_line,
    clientName: disp.client_name, clientPhone: disp.client_phone,
    detail: (fDate ? `متابعة ${fDate}${fTime ? ' ' + fTime : ''}${fMethod ? ' (' + fMethod + ')' : ''}` : 'ملاحظة') + (note ? ': ' + note : ''),
    user,
  });
  return r.lastInsertRowid;
}

/**
 * Set a disposition for a current-group client who is NOT being moved (creates the
 * header if missing). An optional first entry (follow-up/note) may be included.
 * Removes the client from the next-group roster (mutually exclusive).
 */
function setDisposition({ sourceGroup, sourceLine, dept, clientName, clientPhone, disposition, entry, user }) {
  sourceGroup = (sourceGroup || '').trim();
  sourceLine = (sourceLine || '').trim();
  clientPhone = (clientPhone || '').trim();
  if (!sourceGroup) throw new Error('sourceGroup is required');
  if (!clientPhone && !clientName) throw new Error('client identity is required');
  if (!DISPOSITIONS.includes(disposition)) throw new Error('Invalid disposition');

  const existing = db.prepare(`
    SELECT id, disposition FROM enr_dispositions WHERE source_group_name = ? AND source_line = ? AND client_phone = ?
  `).get(sourceGroup, sourceLine, clientPhone);

  let dispId;
  const tx = db.transaction(() => {
    if (existing) {
      db.prepare(`
        UPDATE enr_dispositions SET dept = ?, client_name = ?, disposition = ?, updated_at = datetime('now', '+2 hours')
         WHERE id = ?
      `).run(dept || null, clientName || null, disposition, existing.id);
      dispId = existing.id;
      if (existing.disposition !== disposition) {
        logActivity({ action: 'disposition_set', sourceGroup, sourceLine, clientName, clientPhone, detail: DISP_LABEL(disposition), user });
      }
    } else {
      const r = db.prepare(`
        INSERT INTO enr_dispositions
          (source_group_name, source_line, dept, client_name, client_phone, disposition, created_by, created_by_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sourceGroup, sourceLine, dept || null, clientName || null, clientPhone || null, disposition,
        user?.id || null, user?.full_name || user?.name || null);
      dispId = r.lastInsertRowid;
      logActivity({ action: 'disposition_set', sourceGroup, sourceLine, clientName, clientPhone, detail: DISP_LABEL(disposition), user });
    }
    // Optional first entry.
    if (entry && (entry.note || entry.followupDate || entry.followupTime || entry.followupMethod)) {
      _insertEntry({ id: dispId, disposition, source_group_name: sourceGroup, source_line: sourceLine, client_name: clientName, client_phone: clientPhone }, entry, user);
    }
    // A client with a disposition is NOT moved → drop them from this source's next-roster.
    if (clientPhone) {
      db.prepare(`DELETE FROM enr_next_members WHERE source_group_name = ? AND source_line = ? AND client_phone = ?`)
        .run(sourceGroup, sourceLine, clientPhone);
    }
  });
  tx();
  saveNow();
  return { ok: true, id: dispId };
}

/** Add a follow-up/note entry to an existing disposition. */
function addDispositionEntry({ dispositionId, followupDate, followupTime, followupMethod, note, user }) {
  dispositionId = parseInt(dispositionId, 10);
  if (!dispositionId) throw new Error('dispositionId is required');
  const disp = db.prepare(`SELECT * FROM enr_dispositions WHERE id = ?`).get(dispositionId);
  if (!disp) throw new Error('disposition not found');
  if (!(note || followupDate || followupTime || followupMethod)) throw new Error('empty entry');
  const tx = db.transaction(() => { _insertEntry(disp, { followupDate, followupTime, followupMethod, note }, user); });
  tx();
  saveNow();
  return { ok: true };
}

/** Remove a single entry. */
function removeDispositionEntry({ entryId, user }) {
  entryId = parseInt(entryId, 10);
  if (!entryId) throw new Error('entryId is required');
  const e = db.prepare(`
    SELECT e.id, d.source_group_name, d.source_line, d.client_name, d.client_phone
      FROM enr_disposition_entries e JOIN enr_dispositions d ON d.id = e.disposition_id
     WHERE e.id = ?
  `).get(entryId);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM enr_disposition_entries WHERE id = ?`).run(entryId);
    if (e) logActivity({ action: 'entry_removed', sourceGroup: e.source_group_name, sourceLine: e.source_line,
      clientName: e.client_name, clientPhone: e.client_phone, user });
  });
  tx();
  saveNow();
  return { ok: true };
}

function clearDisposition({ id, user }) {
  id = parseInt(id, 10);
  if (!id) throw new Error('id is required');
  const d = db.prepare(`SELECT * FROM enr_dispositions WHERE id = ?`).get(id);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM enr_disposition_entries WHERE disposition_id = ?`).run(id);
    db.prepare(`DELETE FROM enr_dispositions WHERE id = ?`).run(id);
    if (d) logActivity({ action: 'disposition_cleared', sourceGroup: d.source_group_name, sourceLine: d.source_line,
      clientName: d.client_name, clientPhone: d.client_phone, detail: DISP_LABEL(d.disposition), user });
  });
  tx();
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
  // Date range: match if ANY follow-up entry falls in range, else the disposition's
  // own created date (covers postpone follow-ups + plain dispositions).
  const entryDateExists = `EXISTS (SELECT 1 FROM enr_disposition_entries e WHERE e.disposition_id = enr_dispositions.id AND date(COALESCE(e.followup_date, e.created_at)) `;
  if (from) { where.push(`(${entryDateExists}>= ?) OR date(created_at) >= ?)`); args.push(from, from); }
  if (to)   { where.push(`(${entryDateExists}<= ?) OR date(created_at) <= ?)`); args.push(to, to); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM enr_dispositions ${whereSql}`).get(...args).c;
  const items = db.prepare(`
    SELECT * FROM enr_dispositions ${whereSql}
     ORDER BY date(created_at) DESC, id DESC
     LIMIT ? OFFSET ?
  `).all(...args, pageSize, (page - 1) * pageSize);

  // Attach the entries thread (+ latest entry) to each row.
  const ids = items.map(i => i.id);
  const entriesByDisp = new Map();
  if (ids.length) {
    const rows = db.prepare(
      `SELECT * FROM enr_disposition_entries WHERE disposition_id IN (${ids.map(() => '?').join(',')}) ORDER BY id ASC`
    ).all(...ids);
    for (const e of rows) {
      if (!entriesByDisp.has(e.disposition_id)) entriesByDisp.set(e.disposition_id, []);
      entriesByDisp.get(e.disposition_id).push(e);
    }
  }
  for (const it of items) {
    const es = entriesByDisp.get(it.id) || [];
    it.entries = es;
    it.entries_count = es.length;
    it.last_entry = es.length ? es[es.length - 1] : null;
  }

  return {
    type, page, page_size: pageSize, total,
    total_pages: Math.ceil(total / pageSize) || 1,
    items,
  };
}

/**
 * Enr Groups activity log (audit). Filters: group(+line), q (name/phone/group),
 * actor (employee name), action, from/to (created date). Paginated.
 */
function getActivityLog({ group, line, q, actor, action, from, to, page, pageSize }) {
  group = (group || '').trim();
  line = (line || '').trim();
  q = (q || '').trim();
  actor = (actor || '').trim();
  action = (action || '').trim();
  from = (from || '').trim();
  to = (to || '').trim();
  page = Math.max(1, parseInt(page, 10) || 1);
  pageSize = Math.min(200, Math.max(5, parseInt(pageSize, 10) || 25));

  const where = [];
  const args = [];
  if (group) { where.push(`(source_group_name = ? OR next_group_name = ?)`); args.push(group, group); }
  if (line)  { where.push(`(source_line = ? OR source_line IS NULL)`); args.push(line); }
  if (actor) { where.push(`actor_name LIKE ?`); args.push('%' + actor + '%'); }
  if (action) { where.push(`action = ?`); args.push(action); }
  if (q) {
    where.push(`(client_name LIKE ? OR client_phone LIKE ? OR source_group_name LIKE ? OR next_group_name LIKE ?)`);
    const like = '%' + q + '%'; args.push(like, like, like, like);
  }
  if (from) { where.push(`date(created_at) >= ?`); args.push(from); }
  if (to)   { where.push(`date(created_at) <= ?`); args.push(to); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM enr_activity_log ${whereSql}`).get(...args).c;
  const items = db.prepare(`
    SELECT * FROM enr_activity_log ${whereSql}
     ORDER BY id DESC
     LIMIT ? OFFSET ?
  `).all(...args, pageSize, (page - 1) * pageSize);

  return { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) || 1, items };
}

/**
 * Ended/historical groups = source groups that have transition activity (moves /
 * dispositions / log) but are NO LONGER in batches as active/waiting (they ended
 * or were renamed). Lets the user re-open a finished group and see its clients +
 * dispositions even after it left batches.
 */
function getEndedGroups({ q }) {
  q = (q || '').trim();
  const srcRows = db.prepare(`
    SELECT source_group_name AS g, source_line AS l FROM enr_next_members      WHERE source_group_name IS NOT NULL AND TRIM(source_group_name) <> ''
    UNION SELECT source_group_name AS g, source_line AS l FROM enr_dispositions WHERE source_group_name IS NOT NULL AND TRIM(source_group_name) <> ''
    UNION SELECT source_group_name AS g, source_line AS l FROM enr_activity_log WHERE source_group_name IS NOT NULL AND TRIM(source_group_name) <> ''
  `).all();
  const activeKeys = new Set(db.prepare(`
    SELECT group_name || '|' || COALESCE(line, '') AS k
      FROM batches WHERE status IN ('نشطة', 'بانتظار تسجيل المتدربين', 'بانتظار تسجيل المحاضرات')
  `).all().map(r => r.k));

  const seen = new Map();
  for (const r of srcRows) {
    const key = String(r.g) + '|' + String(r.l || '');
    if (activeKeys.has(key)) continue;          // still active/waiting → not "ended"
    if (!seen.has(key)) seen.set(key, { group_name: r.g, line: r.l || '' });
  }

  const movedCnt = db.prepare(`SELECT COUNT(*) c FROM enr_next_members WHERE source_group_name = ? AND source_line = ?`);
  const dispCnt  = db.prepare(`SELECT COUNT(*) c FROM enr_dispositions WHERE source_group_name = ? AND source_line = ?`);
  const deptStmt = db.prepare(`SELECT dept FROM enr_dispositions WHERE source_group_name = ? AND source_line = ? AND dept IS NOT NULL LIMIT 1`);
  const lastAct  = db.prepare(`SELECT MAX(created_at) m FROM enr_activity_log WHERE source_group_name = ? AND source_line = ?`);

  let items = [...seen.values()].map(g => ({
    group_name: g.group_name,
    line: g.line,
    dept_type: deptStmt.get(g.group_name, g.line)?.dept || null,
    moved_count: movedCnt.get(g.group_name, g.line).c || 0,
    disposition_count: dispCnt.get(g.group_name, g.line).c || 0,
    last_activity: lastAct.get(g.group_name, g.line).m || null,
  }));
  if (q) {
    const qc = stripSpaces(q.toLowerCase());
    items = items.filter(it => stripSpaces(String(it.group_name || '').toLowerCase()).includes(qc));
  }
  items.sort((a, b) => String(b.last_activity || '').localeCompare(String(a.last_activity || '')));
  return { count: items.length, items };
}

module.exports = {
  getNextGroupOptions, getTransition, searchSalesRegister, getEndedGroups,
  addNextMembers, removeNextMember, getNextRoster,
  setDisposition, addDispositionEntry, removeDispositionEntry, clearDisposition,
  getDispositions, getActivityLog,
  DEPTS, DISPOSITIONS, FOLLOWUP_METHODS,
};
