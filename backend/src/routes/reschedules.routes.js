'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

/**
 * Lecture Reschedules — audit trail for lectures moved between dates.
 *
 *   GET    /api/reschedules                  — list (filterable)
 *   PATCH  /api/reschedules/:id/approve      — super-admin only
 *   PATCH  /api/reschedules/:id/reject       — super-admin only
 *   PATCH  /api/reschedules/:id/notes        — super-admin only
 *
 * Filters on GET:
 *   ?status=pending|approved|rejected|auto|all   (default 'all')
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD               (old_date in range)
 *   ?trainer=...                                  (old_trainer or new_trainer)
 *   ?group=...                                    (group_name LIKE)
 *   ?line=Ahmed Hassan|Dardasha
 *   ?session_type=main|side
 *
 * Returns hydrated rows with names of approver + holiday (if applicable).
 */

function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'admin' || req.user?.management !== 'All') {
    return res.status(403).json({ error: 'صلاحية للمدير العام فقط' });
  }
  next();
}

// GET /api/reschedules
router.get('/', (req, res) => {
  const { status = 'all', from, to, trainer, group, line, session_type } = req.query;
  const wheres = [];
  const params = [];
  if (status && status !== 'all') {
    wheres.push('r.approval_status = ?');
    params.push(status);
  }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    wheres.push('r.old_date >= ?'); params.push(from);
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    wheres.push('r.old_date <= ?'); params.push(to);
  }
  if (trainer) {
    wheres.push('(LOWER(TRIM(r.old_trainer)) LIKE ? OR LOWER(TRIM(r.new_trainer)) LIKE ?)');
    const t = `%${String(trainer).toLowerCase().trim()}%`;
    params.push(t, t);
  }
  if (group) {
    wheres.push('r.group_name LIKE ?');
    params.push(`%${group}%`);
  }
  if (line) {
    wheres.push('r.line = ?'); params.push(line);
  }
  if (session_type === 'main' || session_type === 'side') {
    wheres.push('r.session_type = ?'); params.push(session_type);
  }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

  try {
    const rows = db.prepare(`
      SELECT
        r.*,
        u.full_name AS approved_by_name,
        h.name      AS holiday_name,
        h.start_date AS holiday_start,
        h.end_date   AS holiday_end
      FROM lecture_reschedules r
      LEFT JOIN users u            ON u.id = r.approved_by
      LEFT JOIN official_holidays h ON h.id = r.holiday_id
      ${where}
      ORDER BY r.detected_at DESC, r.id DESC
      LIMIT 1000
    `).all(...params);

    // Counts per status (so the UI tabs can show badges without an extra call)
    const counts = db.prepare(`
      SELECT approval_status, COUNT(*) AS cnt
        FROM lecture_reschedules
       GROUP BY approval_status
    `).all().reduce((acc, r) => { acc[r.approval_status] = r.cnt; return acc; }, {});

    return res.json({ rows, counts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reschedules/:id/approve
router.patch('/:id/approve', requireSuperAdmin, express.json(), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    const r = db.prepare(`
      UPDATE lecture_reschedules
         SET approval_status = 'approved',
             approved_by     = ?,
             approved_at     = datetime('now', '+2 hours'),
             rejection_reason = NULL
       WHERE id = ?
    `).run(req.user?.id || null, id);
    if (r.changes === 0) return res.status(404).json({ error: 'not found' });
    const row = db.prepare(`SELECT * FROM lecture_reschedules WHERE id = ?`).get(id);
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reschedules/:id/reject  body: { reason? }
router.patch('/:id/reject', requireSuperAdmin, express.json(), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const reason = (req.body?.reason || '').trim() || null;
  try {
    const r = db.prepare(`
      UPDATE lecture_reschedules
         SET approval_status  = 'rejected',
             approved_by      = ?,
             approved_at      = datetime('now', '+2 hours'),
             rejection_reason = ?
       WHERE id = ?
    `).run(req.user?.id || null, reason, id);
    if (r.changes === 0) return res.status(404).json({ error: 'not found' });
    const row = db.prepare(`SELECT * FROM lecture_reschedules WHERE id = ?`).get(id);
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reschedules/:id/notes  body: { notes }
router.patch('/:id/notes', requireSuperAdmin, express.json(), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const notes = (req.body?.notes || '').trim() || null;
  try {
    const r = db.prepare(
      `UPDATE lecture_reschedules SET admin_notes = ? WHERE id = ?`
    ).run(notes, id);
    if (r.changes === 0) return res.status(404).json({ error: 'not found' });
    const row = db.prepare(`SELECT * FROM lecture_reschedules WHERE id = ?`).get(id);
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
