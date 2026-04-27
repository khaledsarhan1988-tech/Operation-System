'use strict';
const express = require('express');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireAnyRole } = require('../middleware/roles');
const { lineClause } = require('../utils/lineFilter');

const router = express.Router();

// Enrollment agents + enrollment leaders + admin can access these routes
router.use(authenticate, requireAnyRole(['enrollment', 'enrollment_leader', 'admin']));

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function nowTs() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ─── PIPELINE ────────────────────────────────────────────────────────────────

// GET /api/enrollment/pipeline
// Reads exclusively from distribution_items — completely separate from remarks
router.get('/pipeline', (req, res) => {
  const name = req.user.full_name;
  const lf = lineClause(req, 'ds');
  const dateFrom = (req.query.date_from || '').trim();
  const dateTo   = (req.query.date_to   || '').trim();

  const dateParams = [];
  let dateClause = '';
  if (dateFrom) { dateClause += ' AND di.client_date >= ?'; dateParams.push(dateFrom); }
  if (dateTo)   { dateClause += ' AND di.client_date <= ?'; dateParams.push(dateTo); }

  const base       = `di.assigned_to = ?${lf.clause}${dateClause}`;
  const baseParams = [name, ...lf.params, ...dateParams];

  const buildCol = (stageWhere) =>
    db.prepare(`
      SELECT di.id, di.client_name, di.client_phone, ds.task_type,
             COALESCE(di.status,'جديدة') AS status, ds.priority,
             NULL AS sla_deadline, 'on_time' AS sla_status,
             ds.created_at AS added_at, di.last_updated, di.next_followup_at,
             di.agent_notes, 'توزيع عملاء' AS category, ds.line, di.client_date, di.match_type,
             (SELECT COUNT(*) FROM client_transfers ct WHERE ct.item_id = di.id) AS transfer_count
      FROM distribution_items di
      INNER JOIN distribution_sessions ds ON ds.id = di.session_id AND ds.status = 'confirmed'
      WHERE ${base} AND ${stageWhere}
      ORDER BY
        CASE COALESCE(di.status,'جديدة') WHEN 'جديدة' THEN 0 ELSE 1 END ASC,
        di.last_updated ASC
      LIMIT 500
    `).all(...baseParams);

  try {
    return res.json({
      'جديدة':            buildCol(`COALESCE(di.status,'جديدة') NOT IN ('إنتهت','Follow Up','Placement Test','Problem Existing','No Answer','No Interesting','Retention Done')`),
      'Follow Up':        buildCol(`di.status = 'Follow Up'`),
      'Placement Test':   buildCol(`di.status = 'Placement Test'`),
      'Problem Existing': buildCol(`di.status = 'Problem Existing'`),
      'No Answer':        buildCol(`di.status = 'No Answer'`),
      'No Interesting':   buildCol(`di.status = 'No Interesting'`),
      'Retention Done':   buildCol(`di.status IN ('إنتهت','Retention Done')`),
    });
  } catch (err) {
    console.error('[enrollment/pipeline]', err);
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/enrollment/tasks/:id
// Updates distribution_items — does NOT touch remarks
router.put('/tasks/:id', (req, res) => {
  const { id } = req.params;
  const { agent_notes, status, next_followup_at } = req.body;
  const lf = lineClause(req, 'ds');

  const item = db.prepare(`
    SELECT di.* FROM distribution_items di
    INNER JOIN distribution_sessions ds ON ds.id = di.session_id
    WHERE di.id = ? AND di.assigned_to = ?${lf.clause}
  `).get(id, req.user.full_name, ...lf.params);
  if (!item) return res.status(404).json({ error: 'Task not found' });

  const ts = nowTs();
  db.prepare(`
    UPDATE distribution_items
    SET agent_notes      = COALESCE(?, agent_notes),
        status           = COALESCE(?, status),
        next_followup_at = CASE WHEN ? IS NOT NULL THEN ? ELSE next_followup_at END,
        last_updated     = ?
    WHERE id = ?
  `).run(
    agent_notes || null,
    status || null,
    next_followup_at !== undefined ? next_followup_at : null,
    next_followup_at !== undefined ? next_followup_at : null,
    ts,
    id
  );
  saveNow();

  const updated = db.prepare(`
    SELECT di.*, ds.task_type, ds.priority, ds.line, ds.created_at AS added_at
    FROM distribution_items di
    INNER JOIN distribution_sessions ds ON ds.id = di.session_id
    WHERE di.id = ?
  `).get(id);
  return res.json({ ...updated, sla_status: 'on_time', sla_deadline: null, category: 'توزيع عملاء' });
});

// POST /api/enrollment/tasks/:id/log
// Logs to remark_interactions using item_id (not remark_id)
router.post('/tasks/:id/log', (req, res) => {
  const { id } = req.params;
  const { interaction_type = 'call', outcome, notes, next_followup_at, status } = req.body;
  const lf = lineClause(req, 'ds');

  const item = db.prepare(`
    SELECT di.* FROM distribution_items di
    INNER JOIN distribution_sessions ds ON ds.id = di.session_id
    WHERE di.id = ? AND di.assigned_to = ?${lf.clause}
  `).get(id, req.user.full_name, ...lf.params);
  if (!item) return res.status(404).json({ error: 'Task not found' });

  const log = db.prepare(`
    INSERT INTO remark_interactions (item_id, agent_name, interaction_type, outcome, notes, next_followup_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.user.full_name, interaction_type, outcome || null, notes || null, next_followup_at || null);

  if (status || next_followup_at !== undefined) {
    const ts = nowTs();
    db.prepare(`
      UPDATE distribution_items
      SET status           = CASE WHEN ? IS NOT NULL THEN ? ELSE status END,
          next_followup_at = CASE WHEN ? IS NOT NULL THEN ? ELSE next_followup_at END,
          last_updated     = ?
      WHERE id = ?
    `).run(
      status || null, status || null,
      next_followup_at !== undefined ? next_followup_at : null,
      next_followup_at !== undefined ? next_followup_at : null,
      nowTs(),
      id
    );
  }
  saveNow();

  const updated = db.prepare(`
    SELECT di.*, ds.task_type, ds.priority, ds.line, ds.created_at AS added_at
    FROM distribution_items di
    INNER JOIN distribution_sessions ds ON ds.id = di.session_id
    WHERE di.id = ?
  `).get(id);
  return res.status(201).json({
    log_id: log.lastInsertRowid,
    item: { ...updated, sla_status: 'on_time', sla_deadline: null, category: 'توزيع عملاء' },
  });
});

// GET /api/enrollment/tasks/:id/logs
router.get('/tasks/:id/logs', (req, res) => {
  const { id } = req.params;
  const lf = lineClause(req, 'ds');

  const item = db.prepare(`
    SELECT di.id FROM distribution_items di
    INNER JOIN distribution_sessions ds ON ds.id = di.session_id
    WHERE di.id = ? AND di.assigned_to = ?${lf.clause}
  `).get(id, req.user.full_name, ...lf.params);
  if (!item) return res.status(404).json({ error: 'Task not found' });

  const logs = db.prepare(
    `SELECT * FROM remark_interactions WHERE item_id = ? ORDER BY created_at DESC`
  ).all(id);
  return res.json(logs);
});

// DELETE /api/enrollment/interactions/:id
router.delete('/interactions/:id', (req, res) => {
  const { id } = req.params;
  const lf = lineClause(req, 'ds');
  const interaction = db.prepare(`
    SELECT ri.* FROM remark_interactions ri
    JOIN distribution_items di ON di.id = ri.item_id
    JOIN distribution_sessions ds ON ds.id = di.session_id
    WHERE ri.id = ? AND di.assigned_to = ?${lf.clause}
  `).get(id, req.user.full_name, ...lf.params);
  if (!interaction) return res.status(404).json({ error: 'Interaction not found' });
  db.prepare('DELETE FROM remark_interactions WHERE id = ?').run(id);
  return res.json({ ok: true });
});

// GET /api/enrollment/transfer-targets
// Agents (enrollment) can only transfer to leaders/admins — not to other agents
router.get('/transfer-targets', (req, res) => {
  const user = req.user;
  const isAgent = user.role === 'enrollment';
  const allowedRoles = isAgent
    ? "'enrollment_leader', 'leader', 'admin'"
    : "'enrollment', 'enrollment_leader', 'leader', 'admin'";
  const rows = db.prepare(`
    SELECT full_name, role, department, line FROM users
    WHERE is_active = 1
      AND full_name != ?
      AND role IN (${allowedRoles})
    ORDER BY
      CASE role WHEN 'admin' THEN 1 WHEN 'enrollment_leader' THEN 2 WHEN 'leader' THEN 3 ELSE 4 END ASC,
      full_name COLLATE NOCASE
  `).all(user.full_name);
  return res.json(rows);
});

// PUT /api/enrollment/bulk-transfer
// Transfers distribution_items — does NOT touch remarks
router.put('/bulk-transfer', (req, res) => {
  const user = req.user;
  const { ids, assigned_to } = req.body;

  if (!Array.isArray(ids) || !ids.length || !assigned_to)
    return res.status(400).json({ error: 'ids و assigned_to مطلوبان' });

  const target = db.prepare(`SELECT * FROM users WHERE full_name = ? AND is_active = 1`).get(assigned_to);
  if (!target) return res.status(400).json({ error: 'المستخدم المستهدف غير موجود' });

  const lf = lineClause(req, 'ds');
  const safeIds = ids.map(Number).filter(n => n > 0);
  const ph = safeIds.map(() => '?').join(',');

  const itemsToMove = db.prepare(`
    SELECT di.id, di.client_name, di.client_phone, di.assigned_to, ds.line
    FROM distribution_items di
    INNER JOIN distribution_sessions ds ON ds.id = di.session_id
    WHERE di.id IN (${ph}) AND di.assigned_to = ?${lf.clause}
  `).all(...safeIds, user.full_name, ...lf.params);

  if (!itemsToMove.length)
    return res.status(404).json({ error: 'لا توجد مهام مؤهلة للنقل' });

  const ts = nowTs();
  const updateStmt = db.prepare(
    `UPDATE distribution_items SET assigned_to = ?, last_updated = ? WHERE id = ?`
  );
  const logStmt = db.prepare(`
    INSERT INTO client_transfers
      (item_id, client_name, client_phone, from_user, to_user, transferred_by, transfer_type, line)
    VALUES (?, ?, ?, ?, ?, ?, 'bulk', ?)
  `);

  db.transaction(() => {
    for (const r of itemsToMove) {
      updateStmt.run(assigned_to, ts, r.id);
      logStmt.run(r.id, r.client_name, r.client_phone, r.assigned_to, assigned_to, user.full_name, r.line || '');
    }
  })();
  saveNow();

  return res.json({ moved: itemsToMove.length });
});

module.exports = router;
