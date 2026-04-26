'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireAnyRole } = require('../middleware/roles');
const { lineClause } = require('../utils/lineFilter');

const router = express.Router();

// Enrollment agents + enrollment leaders + admin can access these routes
router.use(authenticate, requireAnyRole(['enrollment', 'enrollment_leader', 'admin']));

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getSlaStatus(slaDeadline, priority) {
  if (!slaDeadline) return 'on_time';
  const deadline = new Date(slaDeadline);
  const now = new Date();
  const WARN_HOURS = { 'عاجلة': 3, 'هامة': 24, 'عادية': 48 };
  const warnMs = (WARN_HOURS[priority] || 48) * 3600000;
  if (now > deadline) return 'breached';
  if (deadline - now <= warnMs) return 'at_risk';
  return 'on_time';
}

// ─── PIPELINE ────────────────────────────────────────────────────────────────

// GET /api/enrollment/pipeline
router.get('/pipeline', (req, res) => {
  const name = req.user.full_name;
  const lf = lineClause(req);
  const dateFrom = (req.query.date_from || '').trim();
  const dateTo   = (req.query.date_to   || '').trim();

  const dateParams = [];
  let dateClause = '';
  if (dateFrom) { dateClause += ' AND client_date >= ?'; dateParams.push(dateFrom); }
  if (dateTo)   { dateClause += ' AND client_date <= ?'; dateParams.push(dateTo); }

  const buildCol = (where) =>
    db.prepare(`
      SELECT id, client_name, client_phone, task_type, status, priority,
             sla_deadline, added_at, last_updated, next_followup_at,
             agent_notes, category, line, details, client_date,
             (SELECT COUNT(*) FROM client_transfers ct WHERE ct.remark_id = remarks.id) AS transfer_count
      FROM remarks
      WHERE assigned_to = ?
        AND category = 'توزيع عملاء'
        AND ${where}${lf.clause}${dateClause}
      ORDER BY
        CASE priority WHEN 'عاجلة' THEN 1 WHEN 'هامة' THEN 2 ELSE 3 END ASC,
        CASE WHEN sla_deadline < datetime('now','+2 hours') THEN 0 ELSE 1 END ASC,
        added_at ASC
      LIMIT 500
    `).all(name, ...lf.params, ...dateParams)
      .map(r => ({ ...r, sla_status: getSlaStatus(r.sla_deadline, r.priority) }));

  try {
    return res.json({
      'جديدة':            buildCol(`status NOT IN ('إنتهت','قيد المتابعة','في المتابعة','بانتظار الرد','Follow Up','Placement Test','Problem Existing','No Answer','No Interesting','Retention Done')`),
      'Follow Up':        buildCol(`status IN ('قيد المتابعة','في المتابعة','Follow Up')`),
      'Placement Test':   buildCol(`status = 'Placement Test'`),
      'Problem Existing': buildCol(`status = 'Problem Existing'`),
      'No Answer':        buildCol(`status IN ('بانتظار الرد','No Answer')`),
      'No Interesting':   buildCol(`status = 'No Interesting'`),
      'Retention Done':   buildCol(`status IN ('إنتهت','Retention Done')`),
    });
  } catch (err) {
    console.error('[enrollment/pipeline]', err);
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/enrollment/tasks/:id
router.put('/tasks/:id', (req, res) => {
  const { id } = req.params;
  const { agent_notes, status, resolved_at, next_followup_at } = req.body;
  const lf = lineClause(req);
  const remark = db.prepare(`SELECT * FROM remarks WHERE id = ? AND assigned_to = ?${lf.clause}`)
    .get(id, req.user.full_name, ...lf.params);
  if (!remark) return res.status(404).json({ error: 'Task not found' });

  let newSlaDeadline = remark.sla_deadline;
  if (agent_notes && remark.status !== 'إنتهت') {
    const excel = require('../services/excel.service');
    newSlaDeadline = excel.computeSlaDeadline(new Date().toISOString(), remark.priority);
  }

  db.prepare(`
    UPDATE remarks
    SET agent_notes      = COALESCE(?, agent_notes),
        status           = COALESCE(?, status),
        resolved_at      = COALESCE(?, resolved_at),
        next_followup_at = CASE WHEN ? IS NOT NULL THEN ? ELSE next_followup_at END,
        sla_deadline     = ?,
        last_updated     = datetime('now', 'localtime')
    WHERE id = ?
  `).run(
    agent_notes || null,
    status || null,
    resolved_at || null,
    next_followup_at !== undefined ? next_followup_at : null,
    next_followup_at !== undefined ? next_followup_at : null,
    newSlaDeadline,
    id
  );

  const updated = db.prepare('SELECT * FROM remarks WHERE id = ?').get(id);
  return res.json({ ...updated, sla_status: getSlaStatus(updated.sla_deadline, updated.priority) });
});

// POST /api/enrollment/tasks/:id/log
router.post('/tasks/:id/log', (req, res) => {
  const { id } = req.params;
  const { interaction_type = 'call', outcome, notes, next_followup_at, status } = req.body;
  const lf = lineClause(req);
  const remark = db.prepare(`SELECT * FROM remarks WHERE id = ? AND assigned_to = ?${lf.clause}`)
    .get(id, req.user.full_name, ...lf.params);
  if (!remark) return res.status(404).json({ error: 'Task not found' });

  const log = db.prepare(`
    INSERT INTO remark_interactions (remark_id, agent_name, interaction_type, outcome, notes, next_followup_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.user.full_name, interaction_type, outcome || null, notes || null, next_followup_at || null);

  if (status || next_followup_at !== undefined) {
    db.prepare(`
      UPDATE remarks
      SET status           = CASE WHEN ? IS NOT NULL THEN ? ELSE status END,
          next_followup_at = CASE WHEN ? IS NOT NULL THEN ? ELSE next_followup_at END,
          last_updated     = datetime('now','+2 hours')
      WHERE id = ?
    `).run(
      status || null, status || null,
      next_followup_at !== undefined ? next_followup_at : null,
      next_followup_at !== undefined ? next_followup_at : null,
      id
    );
  }

  const updated = db.prepare('SELECT * FROM remarks WHERE id = ?').get(id);
  return res.status(201).json({
    log_id: log.lastInsertRowid,
    remark: { ...updated, sla_status: getSlaStatus(updated.sla_deadline, updated.priority) },
  });
});

// GET /api/enrollment/tasks/:id/logs
router.get('/tasks/:id/logs', (req, res) => {
  const { id } = req.params;
  const lf = lineClause(req);
  const remark = db.prepare(`SELECT id FROM remarks WHERE id = ? AND assigned_to = ?${lf.clause}`)
    .get(id, req.user.full_name, ...lf.params);
  if (!remark) return res.status(404).json({ error: 'Task not found' });
  const logs = db.prepare(
    `SELECT * FROM remark_interactions WHERE remark_id = ? ORDER BY created_at DESC`
  ).all(id);
  return res.json(logs);
});

// DELETE /api/enrollment/interactions/:id
router.delete('/interactions/:id', (req, res) => {
  const { id } = req.params;
  const lf = lineClause(req);
  const interaction = db.prepare(`
    SELECT ri.* FROM remark_interactions ri
    JOIN remarks r ON r.id = ri.remark_id
    WHERE ri.id = ? AND r.assigned_to = ?${lf.clause}
  `).get(id, req.user.full_name, ...lf.params);
  if (!interaction) return res.status(404).json({ error: 'Interaction not found' });
  db.prepare('DELETE FROM remark_interactions WHERE id = ?').run(id);
  return res.json({ ok: true });
});

// GET /api/enrollment/transfer-targets
router.get('/transfer-targets', (req, res) => {
  const user = req.user;
  const rows = db.prepare(`
    SELECT full_name, role, department, line FROM users
    WHERE is_active = 1
      AND full_name != ?
      AND role IN ('enrollment', 'enrollment_leader', 'admin')
    ORDER BY
      CASE role WHEN 'admin' THEN 1 WHEN 'enrollment_leader' THEN 2 ELSE 3 END ASC,
      full_name COLLATE NOCASE
  `).all(user.full_name);
  return res.json(rows);
});

// PUT /api/enrollment/bulk-transfer
router.put('/bulk-transfer', (req, res) => {
  const user = req.user;
  const { ids, assigned_to } = req.body;

  if (!Array.isArray(ids) || !ids.length || !assigned_to)
    return res.status(400).json({ error: 'ids و assigned_to مطلوبان' });

  const target = db.prepare(`SELECT * FROM users WHERE full_name = ? AND is_active = 1`).get(assigned_to);
  if (!target) return res.status(400).json({ error: 'المستخدم المستهدف غير موجود' });

  const lf = lineClause(req);
  const safeIds = ids.map(Number).filter(n => n > 0);
  const ph = safeIds.map(() => '?').join(',');

  const remarksToMove = db.prepare(`
    SELECT id, client_name, client_phone, assigned_to, line
    FROM remarks
    WHERE id IN (${ph}) AND assigned_to = ?${lf.clause}
  `).all(...safeIds, user.full_name, ...lf.params);

  if (!remarksToMove.length)
    return res.status(404).json({ error: 'لا توجد مهام مؤهلة للنقل' });

  const updateStmt = db.prepare(
    `UPDATE remarks SET assigned_to = ?, last_updated = datetime('now','+2 hours') WHERE id = ?`
  );
  const logStmt = db.prepare(`
    INSERT INTO client_transfers
      (remark_id, client_name, client_phone, from_user, to_user, transferred_by, transfer_type, line)
    VALUES (?, ?, ?, ?, ?, ?, 'bulk', ?)
  `);

  db.transaction(() => {
    for (const r of remarksToMove) {
      updateStmt.run(assigned_to, r.id);
      logStmt.run(r.id, r.client_name, r.client_phone, r.assigned_to, assigned_to, user.full_name, r.line);
    }
  })();

  return res.json({ moved: remarksToMove.length });
});

module.exports = router;
