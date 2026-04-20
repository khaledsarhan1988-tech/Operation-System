'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { lineFilter } = require('../utils/lineFilter');

const router = express.Router();
router.use(authenticate, requireRole('leader'));

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────

// GET /api/admin/users
router.get('/users', (req, res) => {
  const requesterLine = req.user.line || 'All';
  let sql = 'SELECT id, username, full_name, role, department, management, line, language, is_active, created_at FROM users';
  const params = [];
  if (requesterLine !== 'All') {
    sql += ' WHERE line = ?';
    params.push(requesterLine);
  }
  sql += ' ORDER BY role, full_name';
  const users = db.prepare(sql).all(...params);
  return res.json(users);
});

// POST /api/admin/users
router.post('/users', (req, res) => {
  const { username, password, full_name, role, department, language = 'ar', management = 'Customer Services', line = 'Ahmed Hassan' } = req.body;
  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ error: 'username, password, full_name, role are required' });
  }
  if (!['agent', 'leader', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (existing) return res.status(409).json({ error: 'Username already exists' });

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role, department, language, management, line)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(username, hash, full_name, role, department || 'General', language, management, line);

  const user = db.prepare('SELECT id, username, full_name, role, department, management, line, language, is_active FROM users WHERE id = ?')
    .get(result.lastInsertRowid);
  return res.status(201).json(user);
});

// PUT /api/admin/users/:id
router.put('/users/:id', (req, res) => {
  const { id } = req.params;
  const { full_name, role, department, language, password, is_active, management, line } = req.body;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (password) {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now', '+2 hours') WHERE id = ?")
      .run(bcrypt.hashSync(password, 12), id);
  }

  const fields = [];
  const params = [];
  if (full_name  !== undefined) { fields.push('full_name = ?');  params.push(full_name); }
  if (role       !== undefined) { fields.push('role = ?');       params.push(role); }
  if (department !== undefined) { fields.push('department = ?'); params.push(department); }
  if (language   !== undefined) { fields.push('language = ?');   params.push(language); }
  if (is_active  !== undefined) { fields.push('is_active = ?');  params.push(is_active ? 1 : 0); }
  if (management !== undefined) { fields.push('management = ?'); params.push(management); }
  if (line       !== undefined) { fields.push('line = ?');       params.push(line); }

  if (fields.length) {
    fields.push("updated_at = datetime('now', '+2 hours')");
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params, id);
  }

  const updated = db.prepare('SELECT id, username, full_name, role, department, management, line, language, is_active FROM users WHERE id = ?').get(id);
  return res.json(updated);
});

// PATCH /api/admin/users/:id/status — toggle active/inactive
router.patch('/users/:id/status', (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) return res.status(400).json({ error: 'Cannot change your own status' });
  const user = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const newStatus = user.is_active ? 0 : 1;
  db.prepare("UPDATE users SET is_active = ?, updated_at = datetime('now', '+2 hours') WHERE id = ?").run(newStatus, id);
  return res.json({ is_active: newStatus });
});

// DELETE /api/admin/users/:id — hard delete
router.delete('/users/:id', (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return res.json({ message: 'User deleted' });
});

// ─── SIDE SESSION CHECKS — Admin only delete ─────────────────────────────────
router.delete('/side-session-checks/:id', (req, res) => {
  const line = lineFilter(req);
  const lineClause = line ? ' AND line = ?' : '';
  const lineParams = line ? [line] : [];
  const check = db.prepare(`SELECT id FROM side_session_checks WHERE id = ?${lineClause}`).get(req.params.id, ...lineParams);
  if (!check) return res.status(404).json({ error: 'Check record not found' });
  db.prepare('DELETE FROM side_session_checks WHERE id = ?').run(req.params.id);
  return res.json({ message: 'Deleted' });
});

// ─── SYNC HISTORY ────────────────────────────────────────────────────────────
router.get('/syncs', (req, res) => {
  try {
    const syncs = db.prepare(`
      SELECT es.*, u.full_name AS uploaded_by_name
      FROM excel_syncs es
      LEFT JOIN users u ON u.id = es.uploaded_by
      ORDER BY es.created_at DESC
      LIMIT 50
    `).all();
    return res.json({ syncs });
  } catch (err) {
    return res.json({ syncs: [] });
  }
});

// ─── helper ──────────────────────────────────────────────────────────────────
function safeCount(db, sql, params = []) {
  try { return db.prepare(sql).get(...params)?.c ?? 0; } catch { return 0; }
}
function lineWhere(line, prefix = 'WHERE') {
  return line ? ` ${prefix} line = ?` : '';
}
function lineAnd(line) {
  return line ? ' AND line = ?' : '';
}

// ─── UPLOAD STATUS ───────────────────────────────────────────────────────────
router.get('/upload-status', (req, res) => {
  try {
    let uploadMap = {};
    try {
      db.prepare(`
        SELECT file_type, MAX(created_at) as last_upload, rows_imported
        FROM excel_syncs WHERE status = 'success'
        GROUP BY file_type
      `).all().forEach(r => { uploadMap[r.file_type] = r; });
    } catch {}

    const line = lineFilter(req);
    const lp = line ? [line] : [];
    // Line-scoped counts (NULL alias means 'no alias')
    const counts = {
      data:          safeCount(db, `SELECT COUNT(*) as c FROM employees${lineWhere(line)}`, lp),
      trainees:      safeCount(db, `SELECT COUNT(*) as c FROM clients${lineWhere(line)}`, lp),
      batches:       safeCount(db, `SELECT COUNT(*) as c FROM batches${lineWhere(line)}`, lp),
      remarks:       safeCount(db, `SELECT COUNT(*) as c FROM remarks${lineWhere(line)}`, lp),
      lectures:      safeCount(db, `SELECT COUNT(*) as c FROM lectures WHERE session_type='main'${lineAnd(line)}`, lp),
      side_sessions: safeCount(db, `SELECT COUNT(*) as c FROM lectures WHERE session_type='side'${lineAnd(line)}`, lp),
      absent:        safeCount(db, `SELECT COUNT(*) as c FROM absent_students${lineWhere(line)}`, lp),
    };

    const FILE_KEYS = ['data','trainees','batches','remarks','lectures','side_sessions','absent'];
    return res.json(FILE_KEYS.map(key => ({
      key,
      last_upload:    uploadMap[key]?.last_upload    ?? null,
      rows_imported:  uploadMap[key]?.rows_imported  ?? null,
      current_count:  counts[key],
    })));
  } catch (err) {
    console.error('[admin] upload-status error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── CLEAR SINGLE FILE TYPE DATA (line-scoped) ───────────────────────────────
router.delete('/clear-excel-data/:fileType', (req, res) => {
  const { fileType } = req.params;
  const line = lineFilter(req);
  const lineW  = lineWhere(line);
  const lineA  = lineAnd(line);
  const lp = line ? [line] : [];

  const FILE_DELETE = {
    data:          () => { safeRun(db, `DELETE FROM employees${lineW}`, lp); },
    trainees:      () => { safeRun(db, `DELETE FROM clients${lineW}`, lp); },
    batches:       () => { safeRun(db, `DELETE FROM batches${lineW}`, lp); },
    remarks:       () => { safeRun(db, `DELETE FROM remarks${lineW}`, lp); },
    lectures:      () => { safeRun(db, `DELETE FROM lectures WHERE session_type='main'${lineA}`, lp); },
    side_sessions: () => { safeRun(db, `DELETE FROM lectures WHERE session_type='side'${lineA}`, lp); },
    absent:        () => { safeRun(db, `DELETE FROM absent_students${lineW}`, lp); },
  };
  if (!FILE_DELETE[fileType])
    return res.status(400).json({ error: `Unknown fileType: ${fileType}` });
  try {
    FILE_DELETE[fileType]();
    try { db.prepare("DELETE FROM excel_syncs WHERE file_type = ?").run(fileType); } catch {}
    return res.json({ message: `Cleared: ${fileType}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

function safeRun(db, sql, params = []) {
  try { db.prepare(sql).run(...params); } catch {}
}

// ─── CLEAR ALL EXCEL DATA (line-scoped) ───────────────────────────────────────
router.delete('/clear-excel-data', (req, res) => {
  try {
    const line = lineFilter(req);
    const lineW = lineWhere(line);
    const lp = line ? [line] : [];
    ['lectures','absent_students','clients','batches','remarks','employees'].forEach(t =>
      safeRun(db, `DELETE FROM ${t}${lineW}`, lp)
    );
    if (!line) {
      // Only wipe sync audit log if admin is clearing everything
      safeRun(db, 'DELETE FROM excel_syncs');
    }
    return res.json({ message: 'All Excel data cleared' + (line ? ` (${line})` : '') });
  } catch (err) {
    console.error('[admin] clear-excel-data error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── SYSTEM KPIs (line-scoped) ─────────────────────────────────────────────
router.get('/kpis', (req, res) => {
  const line = lineFilter(req);
  const lineW = lineWhere(line);
  const lineA = lineAnd(line);
  const lp = line ? [line] : [];

  const kpis = {
    total_clients:   db.prepare(`SELECT COUNT(*) AS c FROM clients${lineW}`).get(...lp).c,
    total_batches:   db.prepare(`SELECT COUNT(*) AS c FROM batches WHERE status = 'نشطة'${lineA}`).get(...lp).c,
    total_remarks:   db.prepare(`SELECT COUNT(*) AS c FROM remarks${lineW}`).get(...lp).c,
    pending_remarks: db.prepare(`SELECT COUNT(*) AS c FROM remarks WHERE status != 'إنتهت'${lineA}`).get(...lp).c,
    overdue_remarks: db.prepare(`SELECT COUNT(*) AS c FROM remarks WHERE status != 'إنتهت' AND sla_deadline < datetime('now', '+2 hours')${lineA}`).get(...lp).c,
    total_agents:    db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'agent' AND is_active = 1${lineA}`).get(...lp).c,
    absent_pending:  db.prepare(`SELECT COUNT(*) AS c FROM absent_students WHERE follow_up_status = 'pending'${lineA}`).get(...lp).c,
    last_sync:       db.prepare("SELECT created_at FROM excel_syncs WHERE status = 'success' ORDER BY created_at DESC LIMIT 1").get()?.created_at || null,
    session_checks_today: db.prepare(`SELECT COUNT(*) AS c FROM side_session_checks WHERE date(checked_at) = date('now')${lineA}`).get(...lp).c,
  };
  return res.json(kpis);
});

// ─── KPI DRILL-DOWN DETAILS ──────────────────────────────────────────────────
router.get('/kpis/details/:metric', (req, res) => {
  const { metric } = req.params;
  const line = lineFilter(req);
  const lineW = lineWhere(line);
  const lineA = lineAnd(line);
  const lp = line ? [line] : [];
  try {
    let rows = [];
    switch (metric) {
      case 'clients':
        rows = db.prepare(`
          SELECT id, name, phone, email, group_name, via_company, registration_time
          FROM clients${lineW}
          ORDER BY name COLLATE NOCASE
        `).all(...lp);
        break;

      case 'batches':
        rows = db.prepare(`
          SELECT id, group_name, course, status, trainers, coordinators,
                 trainee_count, max_trainees, scheduled_lectures, completed_lectures,
                 start_date, end_date, dept_type
          FROM batches
          WHERE status = 'نشطة'${lineA}
          ORDER BY group_name
        `).all(...lp);
        break;

      case 'remarks':
        rows = db.prepare(`
          SELECT id, client_name, client_phone, task_type, category, priority, status,
                 assigned_to, assigned_by, added_at, sla_deadline, last_updated
          FROM remarks${lineW}
          ORDER BY added_at DESC
        `).all(...lp);
        break;

      case 'pending-remarks':
        rows = db.prepare(`
          SELECT id, client_name, client_phone, task_type, category, priority, status,
                 assigned_to, assigned_by, added_at, sla_deadline
          FROM remarks
          WHERE status != 'إنتهت'${lineA}
          ORDER BY sla_deadline ASC
        `).all(...lp);
        break;

      case 'overdue-remarks':
        rows = db.prepare(`
          SELECT id, client_name, client_phone, task_type, category, priority, status,
                 assigned_to, assigned_by, added_at, sla_deadline
          FROM remarks
          WHERE status != 'إنتهت'
            AND sla_deadline < datetime('now', '+2 hours')${lineA}
          ORDER BY sla_deadline ASC
        `).all(...lp);
        break;

      case 'agents':
        rows = db.prepare(`
          SELECT id, username, full_name, role, department, management, line, language, is_active, created_at
          FROM users
          WHERE role = 'agent' AND is_active = 1${lineA}
          ORDER BY full_name COLLATE NOCASE
        `).all(...lp);
        break;

      case 'absent-pending':
        rows = db.prepare(`
          SELECT id, group_name, student_name, phone, date, time, lecture_no,
                 follow_up_status, follow_up_note, follow_up_by, follow_up_at
          FROM absent_students
          WHERE follow_up_status = 'pending'${lineA}
          ORDER BY date DESC, group_name
        `).all(...lp);
        break;

      case 'session-checks-today':
        rows = db.prepare(`
          SELECT s.id, s.group_name, s.session_date,
                 s.trainer_present, s.student_present,
                 s.lecture_start_time, s.recording_start_time,
                 s.actual_duration_min, s.notes,
                 s.checked_at, u.full_name AS checked_by_name
          FROM side_session_checks s
          LEFT JOIN users u ON u.id = s.checked_by
          WHERE date(s.checked_at) = date('now')${line ? ' AND s.line = ?' : ''}
          ORDER BY s.checked_at DESC
        `).all(...lp);
        break;

      default:
        return res.status(404).json({ error: 'Unknown metric' });
    }

    return res.json({ metric, count: rows.length, rows });
  } catch (err) {
    console.error('[admin] kpi details error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
