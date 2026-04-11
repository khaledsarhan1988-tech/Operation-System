'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { computeSlaDeadline } = require('../services/excel.service');

const router = express.Router();
router.use(authenticate, requireRole('agent'));

// POST /api/remarks — create new remark
router.post('/', (req, res) => {
  const { task_type, client_name, client_phone, details, category, priority, notes } = req.body;
  if (!task_type || !client_name) {
    return res.status(400).json({ error: 'task_type and client_name are required' });
  }
  const now = new Date().toISOString();
  const sla = computeSlaDeadline(now, priority);

  const result = db.prepare(`
    INSERT INTO remarks
      (task_type, assigned_to, client_name, client_phone, details, category, priority, notes,
       status, assigned_by, added_at, last_updated, sla_deadline)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'غير منتهية', ?, datetime('now', '+2 hours'), datetime('now', '+2 hours'), ?)
  `).run(task_type, req.user.full_name, client_name, client_phone || null,
    details || null, category || null, priority || 'عادية', notes || null,
    req.user.full_name, sla);

  return res.status(201).json(db.prepare('SELECT * FROM remarks WHERE id = ?').get(result.lastInsertRowid));
});

// PUT /api/remarks/:id
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const remark = db.prepare('SELECT * FROM remarks WHERE id = ?').get(id);
  if (!remark) return res.status(404).json({ error: 'Remark not found' });

  // Agents can only edit their own; leaders/admins can edit all
  const role = req.user.role;
  if (role === 'agent' && remark.assigned_to !== req.user.full_name) {
    return res.status(403).json({ error: 'Cannot edit another agent\'s remark' });
  }

  const { status, agent_notes, notes, priority, details } = req.body;

  let newSlaDeadline = remark.sla_deadline;
  // Reset SLA when notes are added while open
  if (agent_notes && remark.status !== 'إنتهت') {
    newSlaDeadline = computeSlaDeadline(new Date().toISOString(), remark.priority);
  }

  let resolvedAt = remark.resolved_at;
  if (status === 'إنتهت' && !resolvedAt) resolvedAt = new Date().toISOString();

  db.prepare(`
    UPDATE remarks SET
      status       = COALESCE(?, status),
      agent_notes  = COALESCE(?, agent_notes),
      notes        = COALESCE(?, notes),
      priority     = COALESCE(?, priority),
      details      = COALESCE(?, details),
      sla_deadline = ?,
      resolved_at  = ?,
      last_updated = datetime('now', '+2 hours')
    WHERE id = ?
  `).run(status || null, agent_notes || null, notes || null,
    priority || null, details || null,
    newSlaDeadline, resolvedAt, id);

  return res.json(db.prepare('SELECT * FROM remarks WHERE id = ?').get(id));
});

module.exports = router;
