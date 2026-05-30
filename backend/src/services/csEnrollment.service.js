'use strict';

/**
 * Enrollment — manual data-entry grid (cs_*).
 *
 * CRUD over enrollment_rows + dropdown option lists:
 *   - days / statuses / levels   → static
 *   - coordinators (Admin)       → users in the department (agent/leader)
 *   - teachers                   → education trainers (optionally able to teach
 *                                  the row's level). Availability filtering and
 *                                  previous-group suggestion are later phases.
 */

const db = require('../config/database');
const { saveNow } = require('../config/database');

const DAYS     = ['Sat- Tue', 'Mon- Thu', 'Sun- Wed'];
const STATUSES = ['Exit Level', 'New', 'Postponed'];
const LEVELS   = [
  'Str 1', 'Str 2', 'Str 3',
  'G 1', 'G 2', 'G 3', 'G 4', 'G 5',
  'Con 1', 'Con 2', 'Con 3', 'Con 4', 'Con 5',
];

// Columns the client may set (everything except id / line / audit fields).
const FIELDS = [
  'round_name', 'start_date', 'end_date', 'days', 'hours',
  'num_students', 'group_code', 'level', 'status', 'admin', 'teacher',
];

const DEPTS = ['General', 'Private', 'Semi'];
function assertDept(d) {
  if (!DEPTS.includes(d)) throw new Error('Invalid dept (General | Private | Semi)');
  return d;
}

function listRows(dept, line = 'Ahmed Hassan') {
  assertDept(dept);
  return db.prepare(
    `SELECT * FROM enrollment_rows WHERE dept = ? AND line = ?
      ORDER BY COALESCE(start_date,'') ASC, id ASC`
  ).all(dept, line);
}

function createRow(dept, data, user, line = 'Ahmed Hassan') {
  assertDept(dept);
  const vals = FIELDS.map(f => (data[f] === undefined || data[f] === '') ? null : data[f]);
  const info = db.prepare(`
    INSERT INTO enrollment_rows
      (dept, round_name, start_date, end_date, days, hours,
       num_students, group_code, level, status, admin, teacher,
       line, created_by, created_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(dept, ...vals, line, user?.id || null, user?.full_name || null);
  saveNow();
  return db.prepare('SELECT * FROM enrollment_rows WHERE id = ?').get(info.lastInsertRowid);
}

function updateRow(id, data) {
  const row = db.prepare('SELECT id FROM enrollment_rows WHERE id = ?').get(id);
  if (!row) throw new Error('Row not found');
  const sets = FIELDS.map(f => `${f} = ?`).join(', ');
  const vals = FIELDS.map(f => (data[f] === undefined || data[f] === '') ? null : data[f]);
  // Business rule: a group that drops below 7 students cannot stay "Start".
  const num = parseInt(data.num_students, 10);
  const forcePending = Number.isFinite(num) && num < 7 ? `, generate_status = 'Pending'` : '';
  db.prepare(
    `UPDATE enrollment_rows SET ${sets}${forcePending}, updated_at = datetime('now','+2 hours') WHERE id = ?`
  ).run(...vals, id);
  saveNow();
  return db.prepare('SELECT * FROM enrollment_rows WHERE id = ?').get(id);
}

// Set the Generate status. "Start" requires the group to have >= 7 students.
// Role gating (admin / leader / enrollment_leader) is enforced in the route.
function setGenerate(id, status) {
  if (!['Start', 'Pending'].includes(status)) throw new Error('Invalid generate status');
  const row = db.prepare('SELECT num_students FROM enrollment_rows WHERE id = ?').get(id);
  if (!row) throw new Error('Row not found');
  if (status === 'Start' && (Number(row.num_students) || 0) < 7) {
    throw new Error('المجموعة محتاجة 7 طلاب أو أكثر علشان تتحول لـ Start');
  }
  db.prepare(
    `UPDATE enrollment_rows SET generate_status = ?, updated_at = datetime('now','+2 hours') WHERE id = ?`
  ).run(status, id);
  saveNow();
  return db.prepare('SELECT * FROM enrollment_rows WHERE id = ?').get(id);
}

function deleteRow(id) {
  db.prepare('DELETE FROM enrollment_students WHERE enrollment_row_id = ?').run(id);
  db.prepare('DELETE FROM enrollment_rows WHERE id = ?').run(id);
  saveNow();
  return { deleted: true, id };
}

// ─── Student roster (drives num_students) ─────────────────────────────────────
function listStudents(rowId) {
  return db.prepare(
    `SELECT id, client_id, client_name, client_phone
       FROM enrollment_students WHERE enrollment_row_id = ?
      ORDER BY client_name COLLATE NOCASE`
  ).all(rowId);
}

// Replace the whole roster for a row, then sync num_students (= count) and
// enforce the Generate rule (a group under 7 students can't stay "Start").
function setStudents(rowId, students) {
  const row = db.prepare('SELECT id FROM enrollment_rows WHERE id = ?').get(rowId);
  if (!row) throw new Error('Row not found');
  const run = db.transaction(() => {
    db.prepare('DELETE FROM enrollment_students WHERE enrollment_row_id = ?').run(rowId);
    const ins = db.prepare(
      `INSERT OR IGNORE INTO enrollment_students (enrollment_row_id, client_id, client_name, client_phone)
       VALUES (?, ?, ?, ?)`
    );
    for (const s of (students || [])) {
      const phone = String(s.phone ?? s.client_phone ?? '').trim();
      const name  = String(s.name  ?? s.client_name  ?? '').trim();
      if (!phone && !name) continue;
      ins.run(rowId, s.client_id ?? s.id ?? null, name || null, phone || null);
    }
    const cnt = db.prepare('SELECT COUNT(*) AS n FROM enrollment_students WHERE enrollment_row_id = ?').get(rowId).n;
    const forcePending = cnt < 7 ? `, generate_status = 'Pending'` : '';
    db.prepare(
      `UPDATE enrollment_rows SET num_students = ?${forcePending}, updated_at = datetime('now','+2 hours') WHERE id = ?`
    ).run(cnt, rowId);
  });
  run();
  saveNow();
  const count = db.prepare('SELECT COUNT(*) AS n FROM enrollment_students WHERE enrollment_row_id = ?').get(rowId).n;
  return { count, students: listStudents(rowId) };
}

// Search the clients table (name / phone), de-duplicated by name+phone.
function searchClients({ q, limit = 60 } = {}) {
  q = String(q || '').trim();
  limit = Math.min(200, Math.max(1, parseInt(limit, 10) || 60));
  if (q) {
    const like = `%${q}%`;
    return db.prepare(`
      SELECT MIN(id) AS id, name, phone FROM clients
       WHERE (name LIKE ? OR phone LIKE ?) AND name IS NOT NULL AND TRIM(name) != ''
       GROUP BY name, phone
       ORDER BY name COLLATE NOCASE
       LIMIT ?
    `).all(like, like, limit);
  }
  return db.prepare(`
    SELECT MIN(id) AS id, name, phone FROM clients
     WHERE name IS NOT NULL AND TRIM(name) != ''
     GROUP BY name, phone ORDER BY name COLLATE NOCASE LIMIT ?
  `).all(limit);
}

// Parse a level label ("G 3", "Con 2", "Str 3") → { family, num }.
function parseLevel(level) {
  if (!level) return null;
  const s = String(level).toLowerCase();
  const num = parseInt((s.match(/(\d+)/) || [])[1], 10) || null;
  let family = null;
  if (/con/.test(s))      family = 'conversation';
  else if (/str/.test(s)) family = 'starter';
  else if (/\bg/.test(s) || /general/.test(s)) family = 'general';
  return { family, num };
}

// ─── Phase 3: previous-group teacher suggestion ───────────────────────────────
const stripParens = (s) => String(s || '').replace(/\([^)]*\)/g, '').trim();

// Extract { family, num } from a group code ("...General3", "...Con2", "Str3").
function parseGroupLevel(name) {
  const s = String(name || '').toLowerCase();
  let m;
  if ((m = s.match(/con(?:versation)?[ _]*(\d+)/)))   return { family: 'conversation', num: +m[1] };
  if ((m = s.match(/(?:starter|str)[ _]*(\d+)/)))       return { family: 'starter',      num: +m[1] };
  if ((m = s.match(/(?:general|g)[ _]*(\d+)/)))         return { family: 'general',      num: +m[1] };
  return null;
}

// The level immediately BEFORE the given one on the Starter→General→Conversation
// ladder (Starter1..3 → General1..5 → Conversation1..5).
function previousLevel(level) {
  const p = parseLevel(level);
  if (!p || !p.family || !p.num) return null;
  const { family, num } = p;
  if (family === 'starter')      return num > 1 ? { family: 'starter', num: num - 1 } : null;
  if (family === 'general')      return num > 1 ? { family: 'general', num: num - 1 } : { family: 'starter', num: 3 };
  if (family === 'conversation') return num > 1 ? { family: 'conversation', num: num - 1 } : { family: 'general', num: 5 };
  return null;
}

/**
 * Suggest the teacher(s) who recently taught a group at the PREVIOUS level —
 * a heuristic to ease re-assigning the same teacher for continuing students.
 * Matches by level (previous of the entered level); returns most-recent first.
 */
function suggestTeacher({ level, line = 'Ahmed Hassan' }) {
  const prev = previousLevel(level);
  if (!prev) return { previous_level: null, suggestions: [] };

  const rows = db.prepare(`
    SELECT l.group_name AS group_name, l.trainer AS trainer, MAX(l.date) AS last_date
      FROM lectures l
      JOIN batches b ON b.group_name = l.group_name AND b.line = l.line
     WHERE l.line = ? AND l.session_type = 'main'
       AND l.trainer IS NOT NULL AND TRIM(l.trainer) != ''
     GROUP BY l.group_name, l.trainer
  `).all(line);

  const matches = rows
    .filter(r => { const g = parseGroupLevel(r.group_name); return g && g.family === prev.family && g.num === prev.num; })
    .sort((a, b) => String(b.last_date).localeCompare(String(a.last_date)));

  const seen = new Set(), out = [];
  for (const m of matches) {
    const t = stripParens(m.trainer);
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push({ teacher: t, from_group: m.group_name, last_date: m.last_date });
    }
    if (out.length >= 3) break;
  }
  return { previous_level: `${prev.family} ${prev.num}`, suggestions: out };
}

function getOptions(dept, level, line = 'Ahmed Hassan') {
  assertDept(dept);

  // Admin (coordinators) = users in this department (agents/leaders).
  const coordinators = db.prepare(`
    SELECT full_name FROM users
     WHERE department = ? AND role IN ('agent','leader')
       AND is_active = 1 AND full_name IS NOT NULL AND TRIM(full_name) != ''
     ORDER BY full_name COLLATE NOCASE
  `).all(dept).map(r => r.full_name);

  // Teachers = education trainers. If a level is given, prefer trainers able to
  // teach it (teachable_<family> >= level number); fall back to all if none.
  let teachers = db.prepare(`
    SELECT name, teachable_starter, teachable_general, teachable_conversation
      FROM team_members
     WHERE department = 'education' AND name IS NOT NULL AND TRIM(name) != ''
     ORDER BY name COLLATE NOCASE
  `).all();
  const lvl = parseLevel(level);
  if (lvl && lvl.family && lvl.num) {
    const col = lvl.family === 'conversation' ? 'teachable_conversation'
              : lvl.family === 'general'      ? 'teachable_general'
              : 'teachable_starter';
    const filtered = teachers.filter(t => (Number(t[col]) || 0) >= lvl.num);
    if (filtered.length) teachers = filtered;
  }

  return {
    days: DAYS,
    statuses: STATUSES,
    levels: LEVELS,
    coordinators,
    teachers: teachers.map(t => t.name),
  };
}

module.exports = {
  listRows, createRow, updateRow, deleteRow, setGenerate, getOptions, suggestTeacher,
  listStudents, setStudents, searchClients,
  DAYS, STATUSES, LEVELS, DEPTS,
};
