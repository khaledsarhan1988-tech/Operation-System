'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireAnyRole } = require('../middleware/roles');
const { lineFilter } = require('../utils/lineFilter');

const router = express.Router();

// Enrollment leaders + admin only
router.use(authenticate, requireAnyRole(['enrollment_leader', 'admin']));

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

// ─── TEAM ────────────────────────────────────────────────────────────────────

// GET /api/enrollment-leader/team
router.get('/team', (req, res) => {
  const line = lineFilter(req);
  const conditions = ["u.role = 'enrollment'", 'u.is_active = 1'];
  const params = [];

  if (line) { conditions.push('u.line = ?'); params.push(line); }

  const joinLine = line ? ' AND r.line = u.line' : '';
  const where = 'WHERE ' + conditions.join(' AND ');

  const agents = db.prepare(`
    SELECT
      u.full_name AS name,
      COUNT(r.id) AS total,
      COALESCE(SUM(CASE WHEN r.status != 'إنتهت' THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN r.status = 'إنتهت' THEN 1 ELSE 0 END), 0) AS done,
      COALESCE(SUM(CASE WHEN r.status = 'إنتهت' AND date(r.last_updated) = date('now') THEN 1 ELSE 0 END), 0) AS completed_today,
      COALESCE(SUM(CASE WHEN r.status != 'إنتهت' AND r.sla_deadline < datetime('now', 'localtime') THEN 1 ELSE 0 END), 0) AS overdue
    FROM users u
    LEFT JOIN remarks r ON r.assigned_to = u.full_name${joinLine}
    ${where}
    GROUP BY u.full_name
    ORDER BY pending DESC, u.full_name COLLATE NOCASE
  `).all(...params);
  return res.json(agents);
});

// ─── PIPELINE ────────────────────────────────────────────────────────────────

// GET /api/enrollment-leader/pipeline?agent_name=&date_from=&date_to=
router.get('/pipeline', (req, res) => {
  const line = lineFilter(req);
  const { agent_name, date_from, date_to } = req.query;

  const conditions = [`category = 'توزيع عملاء'`];
  const params = [];

  if (agent_name) {
    conditions.push('assigned_to = ?');
    params.push(agent_name);
  } else {
    const agentConds = ["role = 'enrollment'", "is_active = 1"];
    const subParams  = [];
    if (line) { agentConds.push('line = ?'); subParams.push(line); }
    conditions.push(`assigned_to IN (SELECT full_name FROM users WHERE ${agentConds.join(' AND ')})`);
    params.push(...subParams);
  }

  if (date_from) { conditions.push('client_date >= ?'); params.push(date_from); }
  if (date_to)   { conditions.push('client_date <= ?'); params.push(date_to);   }

  const where = conditions.join(' AND ');

  const buildCol = (stageWhere) =>
    db.prepare(`
      SELECT id, client_name, client_phone, task_type, status, priority,
             sla_deadline, added_at, last_updated, next_followup_at,
             agent_notes, category, line, details, client_date, assigned_to,
             (SELECT COUNT(*) FROM client_transfers ct WHERE ct.remark_id = remarks.id) AS transfer_count
      FROM remarks
      WHERE ${where} AND ${stageWhere}
      ORDER BY
        assigned_to COLLATE NOCASE ASC,
        CASE priority WHEN 'عاجلة' THEN 1 WHEN 'هامة' THEN 2 ELSE 3 END ASC,
        CASE WHEN sla_deadline < datetime('now','+2 hours') THEN 0 ELSE 1 END ASC,
        added_at ASC
      LIMIT 2000
    `).all(...params)
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
    console.error('[enrollment-leader/pipeline]', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/enrollment-leader/assign
router.post('/assign', (req, res) => {
  const { remark_id, agent_name } = req.body;
  if (!remark_id || !agent_name)
    return res.status(400).json({ error: 'remark_id and agent_name are required' });

  const line = lineFilter(req);
  const lineClause = line ? ' AND line = ?' : '';
  const lineParams = line ? [line] : [];
  const remark = db.prepare(`SELECT id FROM remarks WHERE id = ?${lineClause}`).get(remark_id, ...lineParams);
  if (!remark) return res.status(404).json({ error: 'Remark not found' });

  db.prepare("UPDATE remarks SET assigned_to = ?, last_updated = datetime('now', 'localtime') WHERE id = ?")
    .run(agent_name, remark_id);
  return res.json({ message: 'Assigned', remark_id, agent_name });
});

module.exports = router;
