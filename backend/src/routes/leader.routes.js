'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate, requireRole('leader'));

// GET /api/leader/team?coordinator=
router.get('/team', (req, res) => {
  const { coordinator } = req.query;
  const conditions = [];
  const params = [];
  if (coordinator) { conditions.push('r.assigned_to LIKE ?'); params.push(`%${coordinator}%`); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const agents = db.prepare(`
    SELECT
      r.assigned_to AS name,
      COUNT(*) AS total,
      SUM(CASE WHEN r.status != 'إنتهت' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN r.status = 'إنتهت' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN r.status = 'إنتهت' AND date(r.last_updated) = date('now') THEN 1 ELSE 0 END) AS completed_today,
      SUM(CASE WHEN r.status != 'إنتهت' AND r.sla_deadline < datetime('now', '+2 hours') THEN 1 ELSE 0 END) AS overdue
    FROM remarks r
    ${where}
    GROUP BY r.assigned_to
    ORDER BY pending DESC
  `).all(...params);
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
router.get('/performance', (req, res) => {
  const { from, to, coordinator } = req.query;
  const conditions = [];
  const params = [];
  if (from)        { conditions.push('added_at >= ?'); params.push(from); }
  if (to)          { conditions.push('added_at <= ?'); params.push(to); }
  if (coordinator) { conditions.push('assigned_to LIKE ?'); params.push(`%${coordinator}%`); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const data = db.prepare(`
    SELECT
      assigned_to AS name,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'إنتهت' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status != 'إنتهت' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status != 'إنتهت' AND sla_deadline < datetime('now', '+2 hours') THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN priority = 'عاجلة' THEN 1 ELSE 0 END) AS urgent
    FROM remarks
    ${where}
    GROUP BY assigned_to
    ORDER BY total DESC
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
    LEFT JOIN side_session_checks ssc ON ssc.lecture_id = l.id AND ssc.session_date = ?
    LEFT JOIN users u ON u.id = ssc.checked_by
    WHERE l.date = ? AND l.session_type = 'side'
    ORDER BY l.group_name, l.time
  `).all(date, date);
  return res.json(data);
});

module.exports = router;
