'use strict';
const express = require('express');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/notifications?unread=1&limit=50
// Returns the current user's notifications.
router.get('/', (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.json({ total: 0, unread: 0, rows: [] });

  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const onlyUnread = req.query.unread === '1';
  const params = [userId];
  let where = 'WHERE user_id = ?';
  if (onlyUnread) where += ' AND is_read = 0';

  const rows = db.prepare(`
    SELECT id, type, title, body, link, meta, is_read, read_at, created_at
    FROM notifications
    ${where}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params, limit);

  rows.forEach(r => {
    try { r.meta = r.meta ? JSON.parse(r.meta) : null; }
    catch (_) { r.meta = null; }
  });

  const unreadRow = db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0`).get(userId);
  const totalRow  = db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?`).get(userId);

  return res.json({
    total: totalRow?.c || 0,
    unread: unreadRow?.c || 0,
    rows,
  });
});

// PUT /api/notifications/:id/read — mark single notification as read
router.put('/:id/read', (req, res) => {
  const userId = req.user?.id;
  const id = parseInt(req.params.id, 10);
  if (!userId || !id) return res.status(400).json({ error: 'Invalid' });

  const r = db.prepare(`
    UPDATE notifications
    SET is_read = 1, read_at = datetime('now', '+2 hours')
    WHERE id = ? AND user_id = ?
  `).run(id, userId);
  saveNow();
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  return res.json({ id });
});

// PUT /api/notifications/read-all — mark all as read
router.put('/read-all', (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(400).json({ error: 'Invalid' });
  const r = db.prepare(`
    UPDATE notifications
    SET is_read = 1, read_at = datetime('now', '+2 hours')
    WHERE user_id = ? AND is_read = 0
  `).run(userId);
  saveNow();
  return res.json({ marked: r.changes });
});

// DELETE /api/notifications/:id
router.delete('/:id', (req, res) => {
  const userId = req.user?.id;
  const id = parseInt(req.params.id, 10);
  if (!userId || !id) return res.status(400).json({ error: 'Invalid' });
  const r = db.prepare(`DELETE FROM notifications WHERE id = ? AND user_id = ?`).run(id, userId);
  saveNow();
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  return res.json({ deleted: 1 });
});

module.exports = router;
