'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { lineFilter } = require('../utils/lineFilter');
const { nameInListParam } = require('../utils/nameMatch');

// Coordinator field token-exact matcher: prevents "Alaa" matching "Alaa wael".
const coordTokenMatch = nameInListParam('b.coordinators');
const coordTokenMatchAbsent = nameInListParam('b.coordinators');

const router = express.Router();
router.use(authenticate, requireRole('leader'));

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// GET /api/leader/team?coordinator=
router.get('/team', (req, res) => {
  const { coordinator } = req.query;
  // Include the leader themselves so they can manage clients transferred to them
  const userConditions = ["(u.role = 'agent' OR u.full_name = ?)", 'u.is_active = 1'];
  const userParams = [req.user.full_name];
  const dept = req.user?.department;
  if (dept && dept !== 'All') {
    userConditions.push('(u.department = ? OR u.full_name = ?)');
    userParams.push(dept, req.user.full_name);
  }
  // Line filter on users — agents scoped to same line as leader (leader always included)
  const line = lineFilter(req);
  if (line) { userConditions.push('(u.line = ? OR u.full_name = ?)'); userParams.push(line, req.user.full_name); }
  if (coordinator) {
    // Exact-name match (case-insensitive, trimmed) — "Alaa" must NOT match "Alaa wael".
    userConditions.push('LOWER(TRIM(u.full_name)) = LOWER(TRIM(?))');
    userParams.push(coordinator);
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
    const m = coordTokenMatchAbsent(coordinator);
    conditions.push(`EXISTS (SELECT 1 FROM batches b WHERE b.group_name = absent_students.group_name${joinBatchLine} AND ${m.clause})`);
    params.push(m.param);
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

  if (coordinator) { const m = coordTokenMatch(coordinator); conditions.push(m.clause); params.push(m.param); }
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
    // Exact-name match — "Alaa" must NOT match "Alaa wael".
    userConditions.push('LOWER(TRIM(u.full_name)) = LOWER(TRIM(?))');
    userParams.push(coordinator);
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
// Reads exclusively from distribution_items — completely separate from remarks
router.get('/pipeline', (req, res) => {
  const dept = req.user?.department;
  const line = lineFilter(req);
  const { agent_name, date_from, date_to } = req.query;

  const conditions = ['ds.status = \'confirmed\''];
  const params     = [];

  if (agent_name) {
    conditions.push('di.assigned_to = ?');
    params.push(agent_name);
  } else {
    // Include items assigned to the leader themselves + their team's agents
    const agentConds = ["role = 'agent'", "is_active = 1"];
    const subParams  = [];
    if (dept && dept !== 'All') { agentConds.push('department = ?'); subParams.push(dept); }
    if (line)                   { agentConds.push('line = ?');       subParams.push(line); }
    conditions.push(`(di.assigned_to = ? OR di.assigned_to IN (SELECT full_name FROM users WHERE ${agentConds.join(' AND ')}))`);
    params.push(req.user.full_name, ...subParams);
  }

  if (line)      { conditions.push('ds.line = ?'); params.push(line); }
  if (date_from) { conditions.push('di.client_date >= ?'); params.push(date_from); }
  if (date_to)   { conditions.push('di.client_date <= ?'); params.push(date_to);   }

  const where = conditions.join(' AND ');

  const buildCol = (stageWhere) =>
    db.prepare(`
      SELECT di.id, di.client_name, di.client_phone, di.assigned_to,
             ds.task_type, COALESCE(di.status,'جديدة') AS status, ds.priority,
             ds.created_at AS added_at, di.last_updated, di.next_followup_at,
             di.agent_notes, ds.line, di.client_date, di.match_type,
             'توزيع عملاء' AS category, NULL AS sla_deadline, 'on_time' AS sla_status,
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
    console.error('[leader/pipeline]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
