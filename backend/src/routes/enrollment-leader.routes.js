'use strict';
const express = require('express');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireAnyRole } = require('../middleware/roles');
const { lineFilter } = require('../utils/lineFilter');

const router = express.Router();

// Enrollment leaders + admin only
router.use(authenticate, requireAnyRole(['enrollment_leader', 'admin']));

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function nowTs() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ─── TEAM ────────────────────────────────────────────────────────────────────

// GET /api/enrollment-leader/team
// Counts sourced from distribution_items — completely separate from remarks
router.get('/team', (req, res) => {
  const line = lineFilter(req);
  const conditions = ["u.role = 'enrollment'", 'u.is_active = 1'];
  const params = [];

  if (line) { conditions.push('u.line = ?'); params.push(line); }

  const joinLine = line ? ' AND ds.line = u.line' : '';
  const where = 'WHERE ' + conditions.join(' AND ');

  const agents = db.prepare(`
    SELECT
      u.full_name AS name,
      COUNT(di.id) AS total,
      COALESCE(SUM(CASE WHEN COALESCE(di.status,'جديدة') NOT IN ('إنتهت','Retention Done') THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN COALESCE(di.status,'جديدة') IN ('إنتهت','Retention Done') THEN 1 ELSE 0 END), 0) AS done,
      COALESCE(SUM(CASE WHEN COALESCE(di.status,'جديدة') IN ('إنتهت','Retention Done') AND date(di.last_updated) = date('now') THEN 1 ELSE 0 END), 0) AS completed_today,
      0 AS overdue
    FROM users u
    LEFT JOIN distribution_items di ON di.assigned_to = u.full_name
    LEFT JOIN distribution_sessions ds ON ds.id = di.session_id AND ds.status = 'confirmed'${joinLine}
    ${where}
    GROUP BY u.full_name
    ORDER BY pending DESC, u.full_name COLLATE NOCASE
  `).all(...params);
  return res.json(agents);
});

// ─── PIPELINE ────────────────────────────────────────────────────────────────

// GET /api/enrollment-leader/pipeline?agent_name=&date_from=&date_to=
// Reads exclusively from distribution_items — completely separate from remarks
router.get('/pipeline', (req, res) => {
  const line = lineFilter(req);
  const { agent_name, date_from, date_to } = req.query;

  const conditions = ['ds.status = \'confirmed\''];
  const params     = [];

  if (agent_name) {
    conditions.push('di.assigned_to = ?');
    params.push(agent_name);
  } else {
    const agentConds = ["role = 'enrollment'", "is_active = 1"];
    const subParams  = [];
    if (line) { agentConds.push('line = ?'); subParams.push(line); }
    conditions.push(`di.assigned_to IN (SELECT full_name FROM users WHERE ${agentConds.join(' AND ')})`);
    params.push(...subParams);
  }

  if (line)      { conditions.push('ds.line = ?'); params.push(line); }
  if (date_from) { conditions.push('di.client_date >= ?'); params.push(date_from); }
  if (date_to)   { conditions.push('di.client_date <= ?'); params.push(date_to);   }

  const where = conditions.join(' AND ');

  const buildCol = (stageWhere) =>
    db.prepare(`
      SELECT di.id, di.client_name, di.client_phone, di.assigned_to,
             ds.task_type, COALESCE(di.status,'جديدة') AS status, ds.priority,
             NULL AS sla_deadline, 'on_time' AS sla_status,
             ds.created_at AS added_at, di.last_updated, di.next_followup_at,
             di.agent_notes, 'توزيع عملاء' AS category, ds.line, di.client_date, di.match_type,
             (SELECT COUNT(*) FROM client_transfers ct WHERE ct.item_id = di.id) AS transfer_count
      FROM distribution_items di
      INNER JOIN distribution_sessions ds ON ds.id = di.session_id
      WHERE ${where} AND ${stageWhere}
      ORDER BY di.assigned_to COLLATE NOCASE ASC, di.last_updated ASC
      LIMIT 2000
    `).all(...params);

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
    console.error('[enrollment-leader/pipeline]', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/enrollment-leader/assign
// Assigns a distribution_item to an agent — does NOT touch remarks
router.post('/assign', (req, res) => {
  const { remark_id, agent_name } = req.body; // remark_id is actually item_id (kept for API compat)
  if (!remark_id || !agent_name)
    return res.status(400).json({ error: 'remark_id and agent_name are required' });

  const line = lineFilter(req);
  const lineJoin = line ? ` AND ds.line = '${line.replace(/'/g, "''")}'` : '';

  const item = db.prepare(`
    SELECT di.id FROM distribution_items di
    INNER JOIN distribution_sessions ds ON ds.id = di.session_id${lineJoin}
    WHERE di.id = ?
  `).get(remark_id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const ts = nowTs();
  db.prepare('UPDATE distribution_items SET assigned_to = ?, last_updated = ? WHERE id = ?')
    .run(agent_name, ts, remark_id);
  saveNow();
  return res.json({ message: 'Assigned', remark_id, agent_name });
});

module.exports = router;
