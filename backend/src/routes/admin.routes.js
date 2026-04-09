'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate, requireRole('leader'));

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────

// GET /api/admin/users
router.get('/users', (req, res) => {
  const users = db.prepare(
    'SELECT id, username, full_name, role, department, management, language, is_active, created_at FROM users ORDER BY role, full_name'
  ).all();
  return res.json(users);
});

// POST /api/admin/users
router.post('/users', (req, res) => {
  const { username, password, full_name, role, department, language = 'ar', management = 'Customer Services' } = req.body;
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
    INSERT INTO users (username, password_hash, full_name, role, department, language, management)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(username, hash, full_name, role, department || 'General', language, management);

  const user = db.prepare('SELECT id, username, full_name, role, department, management, language, is_active FROM users WHERE id = ?')
    .get(result.lastInsertRowid);
  return res.status(201).json(user);
});

// PUT /api/admin/users/:id
router.put('/users/:id', (req, res) => {
  const { id } = req.params;
  const { full_name, role, department, language, password, is_active, management } = req.body;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (password) {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
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

  if (fields.length) {
    fields.push("updated_at = datetime('now')");
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params, id);
  }

  const updated = db.prepare('SELECT id, username, full_name, role, department, management, language, is_active FROM users WHERE id = ?').get(id);
  return res.json(updated);
});

// PATCH /api/admin/users/:id/status — toggle active/inactive
router.patch('/users/:id/status', (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) return res.status(400).json({ error: 'Cannot change your own status' });
  const user = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const newStatus = user.is_active ? 0 : 1;
  db.prepare("UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, id);
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
  const check = db.prepare('SELECT id FROM side_session_checks WHERE id = ?').get(req.params.id);
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
    return res.json({ syncs }); // wrapped so frontend data.syncs works
  } catch (err) {
    return res.json({ syncs: [] });
  }
});

// ─── helper ──────────────────────────────────────────────────────────────────
function safeCount(db, sql) {
  try { return db.prepare(sql).get()?.c ?? 0; } catch { return 0; }
}

// ─── UPLOAD STATUS (last upload per file type + live counts) ─────────────────
router.get('/upload-status', (req, res) => {
  try {
    // Last successful upload per file_type — uses rows_imported (correct column name)
    let uploadMap = {};
    try {
      db.prepare(`
        SELECT file_type, MAX(created_at) as last_upload, rows_imported
        FROM excel_syncs WHERE status = 'success'
        GROUP BY file_type
      `).all().forEach(r => { uploadMap[r.file_type] = r; });
    } catch {}  // excel_syncs might be empty or missing — silently skip

    // Live counts from actual tables (correct table per file_type)
    const counts = {
      data:          safeCount(db, "SELECT COUNT(*) as c FROM employees"),
      trainees:      safeCount(db, "SELECT COUNT(*) as c FROM clients"),
      batches:       safeCount(db, "SELECT COUNT(*) as c FROM batches"),
      remarks:       safeCount(db, "SELECT COUNT(*) as c FROM remarks"),
      lectures:      safeCount(db, "SELECT COUNT(*) as c FROM lectures WHERE session_type='main'"),
      side_sessions: safeCount(db, "SELECT COUNT(*) as c FROM lectures WHERE session_type='side'"),
      absent:        safeCount(db, "SELECT COUNT(*) as c FROM absent_students"),
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

// ─── CLEAR SINGLE FILE TYPE DATA ─────────────────────────────────────────────
router.delete('/clear-excel-data/:fileType', (req, res) => {
  const { fileType } = req.params;
  const FILE_DELETE = {
    data:          () => { safeRun(db, 'DELETE FROM employees'); },
    trainees:      () => { safeRun(db, 'DELETE FROM clients'); },
    batches:       () => { safeRun(db, 'DELETE FROM batches'); },
    remarks:       () => { safeRun(db, 'DELETE FROM remarks'); },
    lectures:      () => { safeRun(db, "DELETE FROM lectures WHERE session_type='main'"); },
    side_sessions: () => { safeRun(db, "DELETE FROM lectures WHERE session_type='side'"); },
    absent:        () => { safeRun(db, 'DELETE FROM absent_students'); },
  };
  if (!FILE_DELETE[fileType])
    return res.status(400).json({ error: `Unknown fileType: ${fileType}` });
  try {
    FILE_DELETE[fileType]();
    // Remove that file's sync history too
    try { db.prepare("DELETE FROM excel_syncs WHERE file_type = ?").run(fileType); } catch {}
    return res.json({ message: `Cleared: ${fileType}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

function safeRun(db, sql) {
  try { db.prepare(sql).run(); } catch {}
}

// ─── CLEAR ALL EXCEL DATA ─────────────────────────────────────────────────────
router.delete('/clear-excel-data', (req, res) => {
  try {
    ['lectures','absent_students','clients','batches','remarks'].forEach(t => safeRun(db, `DELETE FROM ${t}`));
    safeRun(db, 'DELETE FROM employees');
    safeRun(db, 'DELETE FROM excel_syncs');
    return res.json({ message: 'All Excel data cleared' });
  } catch (err) {
    console.error('[admin] clear-excel-data error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── SYSTEM KPIs ─────────────────────────────────────────────────────────────
router.get('/kpis', (req, res) => {
  const kpis = {
    total_clients:   db.prepare('SELECT COUNT(*) AS c FROM clients').get().c,
    total_batches:   db.prepare("SELECT COUNT(*) AS c FROM batches WHERE status = 'نشطة'").get().c,
    total_remarks:   db.prepare('SELECT COUNT(*) AS c FROM remarks').get().c,
    pending_remarks: db.prepare("SELECT COUNT(*) AS c FROM remarks WHERE status != 'إنتهت'").get().c,
    overdue_remarks: db.prepare("SELECT COUNT(*) AS c FROM remarks WHERE status != 'إنتهت' AND sla_deadline < datetime('now')").get().c,
    total_agents:    db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'agent' AND is_active = 1").get().c,
    absent_pending:  db.prepare("SELECT COUNT(*) AS c FROM absent_students WHERE follow_up_status = 'pending'").get().c,
    last_sync:       db.prepare("SELECT created_at FROM excel_syncs WHERE status = 'success' ORDER BY created_at DESC LIMIT 1").get()?.created_at || null,
    session_checks_today: db.prepare("SELECT COUNT(*) AS c FROM side_session_checks WHERE date(checked_at) = date('now')").get().c,
  };
  return res.json(kpis);
});

module.exports = router;
