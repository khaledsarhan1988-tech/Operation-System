'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate, requireRole('leader'));

// ─── GET /api/team ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { department, section, shift, status = 'active', search } = req.query;
  let where = [];
  if (department) where.push(`department = '${department}'`);
  if (section)    where.push(`section = '${section}'`);
  if (shift)      where.push(`shift = '${shift}'`);
  if (status && status !== 'all') where.push(`status = '${status}'`);
  if (search)     where.push(`name LIKE '%${search.replace(/'/g, "''")}%'`);
  const sql = `SELECT * FROM team_members${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY department, section, shift, name`;
  try {
    return res.json(db.prepare(sql).all());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/team ───────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { name, department, section, status = 'active' } = req.body;
  const shift     = req.body.shift     || null;
  const job_title = req.body.job_title || null;
  const phone     = req.body.phone     || null;
  const user_id   = req.body.user_id   || null;
  const notes     = req.body.notes     || null;
  if (!name || !department || !section) return res.status(400).json({ error: 'name, department, section required' });
  try {
    const r = db.prepare(
      `INSERT INTO team_members (name, department, section, shift, job_title, phone, user_id, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(name, department, section, shift, job_title, phone, user_id, status, notes);
    const member = db.prepare('SELECT * FROM team_members WHERE id = ?').get(r.lastInsertRowid);
    return res.status(201).json(member);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/team/:id ────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { name, department, section, status } = req.body;
  const shift     = req.body.shift     || null;
  const job_title = req.body.job_title || null;
  const phone     = req.body.phone     || null;
  const user_id   = req.body.user_id   || null;
  const notes     = req.body.notes     || null;
  if (!name || !department || !section) return res.status(400).json({ error: 'name, department, section required' });
  try {
    db.prepare(
      `UPDATE team_members SET name=?, department=?, section=?, shift=?, job_title=?, phone=?, user_id=?, status=?, notes=? WHERE id=?`
    ).run(name, department, section, shift, job_title, phone, user_id, status || 'active', notes, id);
    const member = db.prepare('SELECT * FROM team_members WHERE id = ?').get(id);
    if (!member) return res.status(404).json({ error: 'Not found' });
    return res.json(member);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/team/:id ─────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM team_members WHERE id = ?').run(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
