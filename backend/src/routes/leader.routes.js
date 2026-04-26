'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { lineFilter } = require('../utils/lineFilter');

const router = express.Router();
router.use(authenticate, requireRole('leader'));

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// GET /api/leader/team?coordinator=
router.get('/team', (req, res) => {
  const { coordinator } = req.query;
  const userConditions = ["u.role = 'agent'", 'u.is_active = 1'];
  const userParams = [];
  const dept = req.user?.department;
  if (dept && dept !== 'All') {
    userConditions.push('u.department = ?');
    userParams.push(dept);
  }
  // Line filter on users — agents scoped to same line as leader
  const line = lineFilter(req);
  if (line) { userConditions.push('u.line = ?'); userParams.push(line); }
  if (coordinator) {
    userConditions.push('u.full_name LIKE ?');
    userParams.push(`%${coordinator}%`);
  }
  const userWhere = 'WHERE ' + userConditions.join(' AND ');

  // JOIN also scoped — only include remarks from same line
  const joinLine = line ? ' AND r.line = u.line' : '';

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
    ${userWhere}
    GROUP BY u.full_name
    ORDER BY pending DESC, u.full_name COLLATE NOCASE
  `).all(...userParams);
  return res.json(agents);
});

// GET /api/leader/absent-report
router.get('/absent-report', (req, res) => {
  const { group, status, from, to, coordinator, page = 1, limit = 50 } = req.query;
  const conditions = [];
  const params = [];

  // Line filter on absent_students
  const line = lineFilter(req);
  if (line) { conditions.push('line = ?'); params.push(line); }

  if (group)       { conditions.push('group_name LIKE ?'); params.push(`%${group}%`); }
  if (status)      { conditions.push('follow_up_status = ?'); params.push(status); }
  if (from)        { conditions.push('date >= ?'); params.push(from); }
  if (to)          { conditions.push('date <= ?'); params.push(to); }
  if (coordinator) {
    const joinBatchLine = line ? ' AND b.line = absent_students.line' : '';
    conditions.push(`EXISTS (SELECT 1 FROM batches b WHERE b.group_name = absent_students.group_name${joinBatchLine} AND b.coordinators LIKE ?)`);
    params.push(`%${coordinator}%`);
  }
  const dept = req.user?.department;
  if (dept && dept !== 'All') {
    const joinBatchLine = line ? ' AND b.line = absent_students.line' : '';
    conditions.push(`EXISTS (
      SELECT 1 FROM batches b
      WHERE b.group_name = absent_students.group_name${joinBatchLine}
        AND (
          EXISTS (
            SELECT 1 FROM users u
            WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
              AND u.department = ?
          )
          OR (
            b.dept_type = ?
            AND NOT EXISTS (
              SELECT 1 FROM users u2
              WHERE LOWER(TRIM(u2.full_name)) = LOWER(TRIM(b.coordinators))
                AND u2.department IS NOT NULL AND u2.department != 'All'
            )
          )
        )
    )`);
    params.push(dept, dept);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM absent_students ${where}`).get(...params).cnt;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const data = db.prepare(
    `SELECT * FROM absent_students ${where} ORDER BY date DESC, group_name LIMIT ? OFFSET ?`
  ).all(...params, parseInt(limit), offset);

  return res.json({ total, page: parseInt(page), data });
});

// GET /api/leader/groups?coordinator=
router.get('/groups', (req, res) => {
  const { coordinator } = req.query;
  const conditions = ["b.status = 'نشطة'"];
  const params = [];

  // Line filter on batches
  const line = lineFilter(req);
  if (line) { conditions.push('b.line = ?'); params.push(line); }

  if (coordinator) { conditions.push('b.coordinators LIKE ?'); params.push(`%${coordinator}%`); }
  const dept = req.user?.department;
  if (dept && dept !== 'All') {
    conditions.push(`(
      EXISTS (
        SELECT 1 FROM users u
        WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
          AND u.department = ?
      )
      OR (
        b.dept_type = ?
        AND NOT EXISTS (
          SELECT 1 FROM users u2
          WHERE LOWER(TRIM(u2.full_name)) = LOWER(TRIM(b.coordinators))
            AND u2.department IS NOT NULL AND u2.department != 'All'
        )
      )
    )`);
    params.push(dept, dept);
  }
  const where = 'WHERE ' + conditions.join(' AND ');
  // Clients subquery scoped by line too
  const clientLine = line ? ' AND c.line = b.line' : '';
  const groups = db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM clients c WHERE c.group_name = b.group_name${clientLine}) AS actual_clients
    FROM batches b
    ${where}
    ORDER BY b.start_date DESC
  `).all(...params);
  return res.json(groups);
});

// GET /api/leader/performance
router.get('/performance', (req, res) => {
  const { from, to, coordinator } = req.query;

  const userConditions = ["u.role = 'agent'", 'u.is_active = 1'];
  const userParams = [];
  const dept = req.user?.department;
  if (dept && dept !== 'All') {
    userConditions.push('u.department = ?');
    userParams.push(dept);
  }
  const line = lineFilter(req);
  if (line) { userConditions.push('u.line = ?'); userParams.push(line); }
  if (coordinator) {
    userConditions.push('u.full_name LIKE ?');
    userParams.push(`%${coordinator}%`);
  }
  const userWhere = 'WHERE ' + userConditions.join(' AND ');

  const joinConditions = ['r.assigned_to = u.full_name'];
  if (line) joinConditions.push('r.line = u.line');
  const joinParams = [];
  if (from) { joinConditions.push('r.added_at >= ?'); joinParams.push(from); }
  if (to)   { joinConditions.push('r.added_at <= ?'); joinParams.push(to); }
  const joinClause = joinConditions.join(' AND ');

  const params = [...joinParams, ...userParams];

  const data = db.prepare(`
    SELECT
      u.full_name AS name,
      COUNT(r.id) AS total,
      COALESCE(SUM(CASE WHEN r.status = 'إنتهت' THEN 1 ELSE 0 END), 0) AS done,
      COALESCE(SUM(CASE WHEN r.status != 'إنتهت' THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN r.status != 'إنتهت' AND r.sla_deadline < datetime('now', 'localtime') THEN 1 ELSE 0 END), 0) AS overdue,
      COALESCE(SUM(CASE WHEN r.priority = 'عاجلة' THEN 1 ELSE 0 END), 0) AS urgent
    FROM users u
    LEFT JOIN remarks r ON ${joinClause}
    ${userWhere}
    GROUP BY u.full_name
    ORDER BY total DESC, u.full_name COLLATE NOCASE
  `).all(...params);
  return res.json(data);
});

// POST /api/leader/assign
router.post('/assign', (req, res) => {
  const { remark_id, agent_name } = req.body;
  if (!remark_id || !agent_name) {
    return res.status(400).json({ error: 'remark_id and agent_name are required' });
  }
  const line = lineFilter(req);
  const lineClause = line ? ' AND line = ?' : '';
  const lineParams = line ? [line] : [];
  const remark = db.prepare(`SELECT id FROM remarks WHERE id = ?${lineClause}`).get(remark_id, ...lineParams);
  if (!remark) return res.status(404).json({ error: 'Remark not found' });

  db.prepare("UPDATE remarks SET assigned_to = ?, last_updated = datetime('now', 'localtime') WHERE id = ?")
    .run(agent_name, remark_id);
  return res.json({ message: 'Assigned', remark_id, agent_name });
});

// GET /api/leader/side-sessions-summary
router.get('/side-sessions-summary', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const dept = req.user?.department;
  const line = lineFilter(req);
  let deptClause = '';
  if (dept && dept !== 'All') {
    const safe = dept.replace(/'/g, "''");
    deptClause = ` AND (
      EXISTS (
        SELECT 1 FROM users u2
        WHERE LOWER(TRIM(u2.full_name)) = LOWER(TRIM(b.coordinators))
          AND u2.department = '${safe}'
      )
      OR (
        b.dept_type = '${safe}'
        AND NOT EXISTS (
          SELECT 1 FROM users u3
          WHERE LOWER(TRIM(u3.full_name)) = LOWER(TRIM(b.coordinators))
            AND u3.department IS NOT NULL AND u3.department != 'All'
        )
      )
    )`;
  }
  const params = [date, date];
  let lineClause = '';
  if (line) {
    lineClause = ' AND l.line = ?';
    params.push(line);
  }
  const batchJoinLine = line ? ' AND b.line = l.line' : '';
  const sscJoinLine   = line ? ' AND ssc.line = l.line' : '';
  const data = db.prepare(`
    SELECT
      l.group_name,
      l.time,
      l.trainer,
      l.side_session_category,
      ssc.id AS check_id,
      ssc.trainer_present,
      ssc.student_present,
      ssc.actual_duration_min,
      ssc.checked_at,
      u.full_name AS checked_by_name
    FROM lectures l
    LEFT JOIN batches b ON b.group_name = l.group_name${batchJoinLine}
    LEFT JOIN side_session_checks ssc ON ssc.lecture_id = l.id AND ssc.session_date = ?${sscJoinLine}
    LEFT JOIN users u ON u.id = ssc.checked_by
    WHERE l.date = ? AND l.session_type = 'side' AND l.status != 'غير مؤكدة'${lineClause}${deptClause}
    ORDER BY l.group_name, l.time
  `).all(...params);
  return res.json(data);
});

// ─── PIPELINE (team-wide Kanban) ─────────────────────────────────────────────

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

// GET /api/leader/pipeline?agent_name=&date_from=&date_to=
router.get('/pipeline', (req, res) => {
  const dept = req.user?.department;
  const line = lineFilter(req);
  const { agent_name, date_from, date_to } = req.query;

  const conditions = [`category = 'توزيع عملاء'`];
  const params = [];

  if (agent_name) {
    conditions.push('assigned_to = ?');
    params.push(agent_name);
  } else {
    const agentConds = ["role = 'agent'", "is_active = 1"];
    const subParams  = [];
    if (dept && dept !== 'All') { agentConds.push('department = ?'); subParams.push(dept); }
    if (line)                   { agentConds.push('line = ?');       subParams.push(line); }
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
    console.error('[leader/pipeline]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
