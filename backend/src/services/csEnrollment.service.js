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

// Phone normalization for matching: strip spaces / dashes / + / parens.
const NORM_PHONE = `REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),' ',''),'-',''),'+',''),'(','')`;

// Union of every known client across sources — academy trainees (clients),
// plus Center App / Membership clients (cs_subscriptions, finance_transactions)
// so a client who exists in Center App but isn't enrolled yet still shows up.
// client_id is the clients.id when available, else NULL (roster stores name+phone).
const CLIENTS_UNION = `
  SELECT id, name, phone FROM (
    SELECT MIN(id) AS id, name AS name, phone AS phone
      FROM clients WHERE name IS NOT NULL AND TRIM(name) != '' GROUP BY name, phone
    UNION
    SELECT NULL AS id, client_name_raw AS name,
           COALESCE(NULLIF(TRIM(client_phone_raw),''), client_phone_norm) AS phone
      FROM cs_subscriptions WHERE client_name_raw IS NOT NULL AND TRIM(client_name_raw) != ''
    UNION
    SELECT NULL AS id, client_name AS name, client_phone AS phone
      FROM finance_transactions WHERE client_name IS NOT NULL AND TRIM(client_name) != ''
  )
`;

// Search clients by name / phone. Phone match is tolerant: it compares the
// LAST 9 DIGITS, so a leading 0 or country code doesn't matter.
function searchClients({ q, limit = 60 } = {}) {
  q = String(q || '').trim();
  limit = Math.min(200, Math.max(1, parseInt(limit, 10) || 60));

  // Default (no query) browse stays on the academy trainees list (cleaner).
  if (!q) {
    return db.prepare(`
      SELECT MIN(id) AS id, name, phone FROM clients
       WHERE name IS NOT NULL AND TRIM(name) != ''
       GROUP BY name, phone ORDER BY name COLLATE NOCASE LIMIT ?
    `).all(limit);
  }

  const like = `%${q}%`;
  const digits = q.replace(/\D/g, '');
  const run = (sql, params) => {
    try { return db.prepare(sql).all(...params); }
    catch (e) { console.error('searchClients union error (falling back to clients):', e.message); return null; }
  };

  if (digits.length >= 4) {
    const tail = digits.slice(-9);
    const rows = run(`
      SELECT MIN(id) AS id, name, MIN(phone) AS phone FROM ( ${CLIENTS_UNION} )
       WHERE (${NORM_PHONE} LIKE ? OR ${NORM_PHONE} LIKE ? OR name LIKE ?)
       GROUP BY name, ${NORM_PHONE} ORDER BY name COLLATE NOCASE LIMIT ?
    `, ['%' + tail, '%' + digits + '%', like, limit]);
    if (rows) return rows;
    // Fallback: clients table only.
    return db.prepare(`
      SELECT MIN(id) AS id, name, phone FROM clients
       WHERE name IS NOT NULL AND TRIM(name) != ''
         AND (${NORM_PHONE} LIKE ? OR name LIKE ?)
       GROUP BY name, phone ORDER BY name COLLATE NOCASE LIMIT ?
    `).all('%' + tail, like, limit);
  }

  const rows = run(`
    SELECT MIN(id) AS id, name, MIN(phone) AS phone FROM ( ${CLIENTS_UNION} )
     WHERE (name LIKE ? OR ${NORM_PHONE} LIKE ?)
     GROUP BY name, ${NORM_PHONE} ORDER BY name COLLATE NOCASE LIMIT ?
  `, [like, like, limit]);
  if (rows) return rows;
  return db.prepare(`
    SELECT MIN(id) AS id, name, phone FROM clients
     WHERE (name LIKE ? OR phone LIKE ?) AND name IS NOT NULL AND TRIM(name) != ''
     GROUP BY name, phone ORDER BY name COLLATE NOCASE LIMIT ?
  `).all(like, like, limit);
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

// ─── Teacher available time slots (shift − rests − voice-notes) ───────────────
// Mirror of reports.routes parseTeamShifts: returns the trainer's shifts as
// { startMin, endMin, days:[...], rests:[{startMin,endMin}], voiceNotes:[...] }.
function parseTeamShifts(t) {
  if (!t) return [];
  const hm  = (s) => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; };
  const end = (s) => { const v = hm(s); return v === 0 ? 1440 : v; };
  const rests = (raw) => {
    let arr = raw;
    if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { return []; } }
    if (!Array.isArray(arr)) return [];
    return arr.map(r => ({ startMin: hm(r && r.start), endMin: hm(r && r.end) }))
      .filter(r => r.startMin != null && r.endMin != null && r.endMin > r.startMin);
  };
  const norm = (s) => {
    if (!s || !s.shift) return null;
    const startMin = hm(s.start), endMin = end(s.end);
    if (startMin == null || endMin == null) return null;
    return {
      startMin, endMin,
      days: String(s.work_days || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
      rests: rests(s.rests), voiceNotes: rests(s.voice_notes),
    };
  };
  let raw = null;
  if (t.shifts_json) { try { raw = JSON.parse(t.shifts_json); } catch { raw = null; } }
  if (!Array.isArray(raw) || raw.length === 0) {
    raw = [];
    if (t.shift)  raw.push({ shift: t.shift,  start: t.shift_start,  end: t.shift_end,  rests: t.shift_rests,  voice_notes: t.voice_notes,        work_days: t.work_days });
    if (t.shift2) raw.push({ shift: t.shift2, start: t.shift2_start, end: t.shift2_end, rests: t.shift2_rests, voice_notes: t.shift2_voice_notes, work_days: t.shift2_work_days });
  }
  return raw.map(norm).filter(Boolean);
}

const DAY_KEYS_BY_LABEL = {
  'Sat- Tue': ['saturday', 'tuesday'],
  'Mon- Thu': ['monday', 'thursday'],
  'Sun- Wed': ['sunday', 'wednesday'],
};

// Subtract rest + voice-note blocks from the shift window → free [start,end] intervals.
function freeIntervals(sh) {
  const blocks = [...sh.rests, ...sh.voiceNotes].map(b => [b.startMin, b.endMin]).sort((a, b) => a[0] - b[0]);
  let free = [[sh.startMin, sh.endMin]];
  for (const [bs, be] of blocks) {
    const next = [];
    for (const [fs, fe] of free) {
      if (be <= fs || bs >= fe) { next.push([fs, fe]); continue; }
      if (bs > fs) next.push([fs, Math.min(bs, fe)]);
      if (be < fe) next.push([Math.max(be, fs), fe]);
    }
    free = next.filter(([s, e]) => e > s);
  }
  return free;
}
function slotsFromFree(free, len) {
  const out = [];
  for (const [s, e] of free) { let t = s; while (t + len <= e) { out.push([t, t + len]); t += len; } }
  return out;
}
function fmt12(m) {
  const mod = ((m % 1440) + 1440) % 1440;
  let h = Math.floor(mod / 60); const mn = mod % 60;
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(mn).padStart(2, '0')}${ap}`;
}

/**
 * Available time slots for a teacher on the group's days.
 *   - slot length = 90 min (General) / 60 min (Private/Semi)
 *   - shift window minus rests minus voice-notes
 *   - intersection across all selected days (group meets on both)
 */
function teacherSlots({ teacher, days, dept = 'General' }) {
  const tname = String(teacher || '').trim();
  if (!tname) return { slots: [] };
  let dayKeys = DAY_KEYS_BY_LABEL[days];
  if (!dayKeys) dayKeys = String(days || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
  if (!dayKeys.length) return { slots: [] };

  const norm = (s) => String(s || '').replace(/\([^)]*\)/g, '').trim().toLowerCase();
  const trainers = db.prepare(`SELECT * FROM team_members WHERE department='education'`).all();
  const tm = trainers.find(t => norm(t.name) === norm(tname));
  if (!tm) return { slots: [], reason: 'trainer_not_found' };

  const shifts = parseTeamShifts(tm);
  const slotLen = dept === 'General' ? 90 : 60;

  const perDay = dayKeys.map(day => {
    const set = new Set();
    for (const sh of shifts.filter(s => s.days.includes(day))) {
      for (const [s, e] of slotsFromFree(freeIntervals(sh), slotLen)) set.add(s + '-' + e);
    }
    return set;
  });
  let inter = perDay[0] || new Set();
  for (let i = 1; i < perDay.length; i++) inter = new Set([...inter].filter(x => perDay[i].has(x)));

  const slots = [...inter]
    .map(x => x.split('-').map(Number))
    .sort((a, b) => a[0] - b[0])
    .map(([s, e]) => `${fmt12(s)}_${fmt12(e)}`);
  return { slots, slot_minutes: slotLen };
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
  listStudents, setStudents, searchClients, teacherSlots,
  DAYS, STATUSES, LEVELS, DEPTS,
};
