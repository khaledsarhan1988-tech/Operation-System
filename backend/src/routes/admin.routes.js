'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────

// GET /api/admin/users
router.get('/users', (req, res) => {
  const users = db.prepare(
    'SELECT id, username, full_name, role, department, language, is_active, created_at FROM users ORDER BY role, full_name'
  ).all();
  return res.json(users);
});

// POST /api/admin/users
router.post('/users', (req, res) => {
  const { username, password, full_name, role, department, language = 'ar' } = req.body;
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
    INSERT INTO users (username, password_hash, full_name, role, department, language)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(username, hash, full_name, role, department || 'General', language);

  const user = db.prepare('SELECT id, username, full_name, role, department, language, is_active FROM users WHERE id = ?')
    .get(result.lastInsertRowid);
  return res.status(201).json(user);
});

// PUT /api/admin/users/:id
router.put('/users/:id', (req, res) => {
  const { id } = req.params;
  const { full_name, role, department, language, password, is_active } = req.body;

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

  if (fields.length) {
    fields.push("updated_at = datetime('now')");
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params, id);
  }

  const updated = db.prepare('SELECT id, username, full_name, role, department, language, is_active FROM users WHERE id = ?').get(id);
  return res.json(updated);
});

// DELETE /api/admin/users/:id (soft delete)
router.delete('/users/:id', (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) return res.status(400).json({ error: 'Cannot deactivate yourself' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare("UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
  return res.json({ message: 'User deactivated' });
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
  const syncs = db.prepare(`
    SELECT es.*, u.full_name AS uploaded_by_name
    FROM excel_syncs es
    LEFT JOIN users u ON u.id = es.uploaded_by
    ORDER BY es.created_at DESC
    LIMIT 50
  `).all();
  return res.json(syncs);
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
