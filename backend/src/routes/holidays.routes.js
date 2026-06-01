'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

/**
 * Official Holidays — date ranges where lectures normally get bulk-shifted
 * (Eid, national days, etc.). Used by the sync service to auto-mark
 * reschedule rows as reason='official_holiday' so admins don't have to
 * triage every Eid Monday.
 *
 * Routes:
 *   GET    /api/holidays      — list (any authenticated user can view)
 *   POST   /api/holidays      — create (super-admin only)
 *   DELETE /api/holidays/:id  — remove  (super-admin only)
 */

function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'admin' || req.user?.management !== 'All') {
    return res.status(403).json({ error: 'صلاحية للمدير العام فقط' });
  }
  next();
}

// GET /api/holidays — newest first, with creator name for display
router.get('/', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT h.*, u.full_name AS created_by_name
        FROM official_holidays h
        LEFT JOIN users u ON u.id = h.created_by
       ORDER BY h.start_date DESC
    `).all();
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/holidays — body: { name, start_date, end_date, notes? }
router.post('/', express.json(), requireSuperAdmin, (req, res) => {
  const { name, start_date, end_date, notes } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'اسم الإجازة مطلوب' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start_date || ''))) {
    return res.status(400).json({ error: 'تاريخ بداية غير صالح' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(end_date || ''))) {
    return res.status(400).json({ error: 'تاريخ نهاية غير صالح' });
  }
  if (end_date < start_date) {
    return res.status(400).json({ error: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية' });
  }
  try {
    const result = db.prepare(`
      INSERT INTO official_holidays (name, start_date, end_date, notes, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(name).trim(), start_date, end_date, notes || null, req.user?.id || null);
    const row = db.prepare(`SELECT * FROM official_holidays WHERE id = ?`)
      .get(result.lastInsertRowid);
    return res.status(201).json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/holidays/:id — edit an existing holiday (super-admin only)
router.put('/:id', express.json(), requireSuperAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const { name, start_date, end_date, notes } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'اسم الإجازة مطلوب' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start_date || ''))) {
    return res.status(400).json({ error: 'تاريخ بداية غير صالح' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(end_date || ''))) {
    return res.status(400).json({ error: 'تاريخ نهاية غير صالح' });
  }
  if (end_date < start_date) {
    return res.status(400).json({ error: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية' });
  }
  try {
    const r = db.prepare(`
      UPDATE official_holidays SET name = ?, start_date = ?, end_date = ?, notes = ? WHERE id = ?
    `).run(String(name).trim(), start_date, end_date, notes || null, id);
    if (r.changes === 0) return res.status(404).json({ error: 'not found' });
    const row = db.prepare(`SELECT * FROM official_holidays WHERE id = ?`).get(id);
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/holidays/:id
router.delete('/:id', requireSuperAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    const r = db.prepare(`DELETE FROM official_holidays WHERE id = ?`).run(id);
    if (r.changes === 0) return res.status(404).json({ error: 'not found' });
    return res.json({ deleted: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
