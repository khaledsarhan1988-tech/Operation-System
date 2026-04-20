'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate, requireRole('leader'));

// ─── HELPER ───────────────────────────────────────────────────────────────────
// Returns a filter to restrict remarks to agents whose batches match the leader's dept_type
// Falls back to users table for agents registered in the system
function leaderDeptRemarksClause(user) {
  const dept = user?.department;
  if (!dept || dept === 'All') return '';
  const safe = dept.replace(/'/g, "''");
  return ` AND r.assigned_to IN (SELECT full_name FROM users WHERE role='agent' AND department='${safe}')`;
}

function leaderDeptRemarksClauseFlat(user) {
  const dept = user?.department;
  if (!dept || dept === 'All') return '';
  const safe = dept.replace(/'/g, "''");
  return ` AND assigned_to IN (SELECT full_name FROM users WHERE role='agent' AND department='${safe}')`;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// GET /api/leader/team?coordinator=
// Lists every active agent in the leader's department with task counts.
// Starts from the users table so agents with zero remarks still appear.
router.get('/team', (req, res) => {
  const { coordinator } = req.query;
  const userConditions = ["u.role = 'agent'", 'u.is_active = 1'];
  const userParams = [];
  const dept = req.user?.department;
  if (dept && dept !== 'All') {
    userConditions.push('u.department = ?');
    userParams.push(dept);
  }
  if (coordinator) {
    userConditions.push('u.full_name LIKE ?');
    userParams.push(`%${coordinator}%`);
  }
  const userWhere = 'WHERE ' + userConditions.join(' AND ');

  const agents = db.prepare(`
    SELECT
      u.full_name AS name,
      COUNT(r.id) AS total,
      COALESCE(SUM(CASE WHEN r.status != 'إنتهت' THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN r.status = 'إنتهت' THEN 1 ELSE 0 END), 0) AS done,
      COALESCE(SUM(CASE WHEN r.status = 'إنتهت' AND date(r.last_updated) = date('now') THEN 1 ELSE 0 END), 0) AS completed_today,
      COALESCE(SUM(CASE WHEN r.status != 'إنتهت' AND r.sla_deadline < datetime('now', '+2 hours') THEN 1 ELSE 0 END), 0) AS overdue
    FROM users u
    LEFT JOIN remarks r ON r.assigned_to = u.full_name
    ${userWhere}
    GROUP BY u.full_name
    ORDER BY pending DESC, u.full_name COLLATE NOCASE
  `).all(...userParams);
  return res.json(agents);
});

// GET /api/leader/absent-report?group=&status=&from=&to=&coordinator=&page=&limit=
router.get('/absent-report', (req, res) => {
  const { group, status, from, to, coordinator, page = 1, limit = 50 } = req.query;
  const conditions = [];
  const params = [];

  if (group)       { conditions.push('group_name LIKE ?'); params.push(`%${group}%`); }
  if (status)      { conditions.push('follow_up_status = ?'); params.push(status); }
  if (from)        { conditions.push('date >= ?'); params.push(from); }
  if (to)          { conditions.push('date <= ?'); params.push(to); }
  if (coordinator) {
    conditions.push(`EXISTS (SELECT 1 FROM batches b WHERE b.group_name = absent_students.group_name AND b.coordinators LIKE ?)`);
    params.push(`%${coordinator}%`);
  }
  // Dept filter: coordinator's registered dept is source of truth.
  // Include if coordinator registered in leader's dept, OR (coordinator NOT registered AND batch dept matches).
  const dept = req.user?.department;
  if (dept && dept !== 'All') {
    conditions.push(`EXISTS (
      SELECT 1 FROM batches b
      WHERE b.group_name = absent_students.group_name
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
  if (coordinator) { conditions.push('b.coordinators LIKE ?'); params.push(`%${coordinator}%`); }
  const dept = req.user?.department;
  if (dept && dept !== 'All') {
    // Coordinator's registered dept is source of truth; fallback to batch.dept_type only if coordinator unregistered.
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
  const groups = db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM clients c WHERE c.group_name = b.group_name) AS actual_clients
    FROM batches b
    ${where}
    ORDER BY b.start_date DESC
  `).all(...params);
  return res.json(groups);
});

// GET /api/leader/performance?from=&to=&coordinator=
// Per-agent performance stats. Starts from the users table so every active
// agent in the leader's department is listed (even with zero tasks).
router.get('/performance', (req, res) => {
  const { from, to, coordinator } = req.query;

  // Build user-side filters (always applied)
  const userConditions = ["u.role = 'agent'", 'u.is_active = 1'];
  const userParams = [];
  const dept = req.user?.department;
  if (dept && dept !== 'All') {
    userConditions.push('u.department = ?');
    userParams.push(dept);
  }
  if (coordinator) {
    userConditions.push('u.full_name LIKE ?');
    userParams.push(`%${coordinator}%`);
  }
  const userWhere = 'WHERE ' + userConditions.join(' AND ');

  // Build date filters for the LEFT JOIN (must live inside the ON clause
  // so agents with no remarks still appear with zero counts).
  const joinConditions = ['r.assigned_to = u.full_name'];
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
      COALESCE(SUM(CASE WHEN r.status != 'إنتهت' AND r.sla_deadline < datetime('now', '+2 hours') THEN 1 ELSE 0 END), 0) AS overdue,
      COALESCE(SUM(CASE WHEN r.priority = 'عاجلة' THEN 1 ELSE 0 END), 0) AS urgent
    FROM users u
    LEFT JOIN remarks r ON ${joinClause}
    ${userWhere}
    GROUP BY u.full_name
    ORDER BY total DESC, u.full_name COLLATE NOCASE
  `).all(...params);
  return res.json(data);
});

// POST /api/leader/assign — reassign task to agent
router.post('/assign', (req, res) => {
  const { remark_id, agent_name } = req.body;
  if (!remark_id || !agent_name) {
    return res.status(400).json({ error: 'remark_id and agent_name are required' });
  }
  const remark = db.prepare('SELECT id FROM remarks WHERE id = ?').get(remark_id);
  if (!remark) return res.status(404).json({ error: 'Remark not found' });

  db.prepare("UPDATE remarks SET assigned_to = ?, last_updated = datetime('now', '+2 hours') WHERE id = ?")
    .run(agent_name, remark_id);
  return res.json({ message: 'Assigned', remark_id, agent_name });
});

// GET /api/leader/side-sessions-summary?date=
router.get('/side-sessions-summary', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  // Coordinator-first dept filter: coordinator's registered department is source of truth;
  // fall back to batch.dept_type only if coordinator not registered in users table.
  const dept = req.user?.department;
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
    LEFT JOIN batches b ON b.group_name = l.group_name
    LEFT JOIN side_session_checks ssc ON ssc.lecture_id = l.id AND ssc.session_date = ?
    LEFT JOIN users u ON u.id = ssc.checked_by
    WHERE l.date = ? AND l.session_type = 'side'${deptClause}
    ORDER BY l.group_name, l.time
  `).all(date, date);
  return res.json(data);
});

module.exports = router;
