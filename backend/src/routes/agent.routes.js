'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { lineClause, lineFilter } = require('../utils/lineFilter');

const router = express.Router();
router.use(authenticate, requireRole('agent'));

// Compute SLA status from sla_deadline string
function getSlaStatus(slaDeadline, priority) {
  if (!slaDeadline) return 'on_time';
  const deadline = new Date(slaDeadline);
  const now = new Date();
  // Warning thresholds: urgent=3h, important=24h, normal=48h
  const WARN_HOURS = { 'عاجلة': 3, 'هامة': 24, 'عادية': 48 };
  const warnMs = (WARN_HOURS[priority] || 48) * 3600000;
  if (now > deadline) return 'breached';
  if (deadline - now <= warnMs) return 'at_risk';
  return 'on_time';
}

// GET /api/agent/stats
router.get('/stats', (req, res) => {
  const name = req.user.full_name;
  const lf = lineClause(req);
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status != 'إنتهت' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'إنتهت' AND date(last_updated) = date('now') THEN 1 ELSE 0 END) AS completed_today,
      SUM(CASE WHEN status != 'إنتهت' AND sla_deadline < datetime('now', '+2 hours') THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN status != 'إنتهت' AND priority = 'عاجلة' THEN 1 ELSE 0 END) AS urgent_pending
    FROM remarks
    WHERE assigned_to = ?${lf.clause}
  `).get(name, ...lf.params);
  return res.json(stats || { total: 0, pending: 0, completed_today: 0, overdue: 0, urgent_pending: 0 });
});

// GET /api/agent/tasks
router.get('/tasks', (req, res) => {
  const name = req.user.full_name;
  const { status, priority, sort = 'added_at', order = 'desc', page = 1, limit = 25, q } = req.query;

  const conditions = ['assigned_to = ?'];
  const params = [name];

  if (status) {
    const statusMap = { pending: "status != 'إنتهت'", done: "status = 'إنتهت'" };
    if (statusMap[status]) conditions.push(statusMap[status]);
    else { conditions.push('status = ?'); params.push(status); }
  }
  if (priority) { conditions.push('priority = ?'); params.push(priority); }
  if (q) {
    conditions.push('(client_name LIKE ? OR client_phone LIKE ? OR task_type LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  // Line filter
  const line = lineFilter(req);
  if (line) { conditions.push('line = ?'); params.push(line); }

  const safeSort = ['added_at', 'last_updated', 'priority', 'sla_deadline'].includes(sort) ? sort : 'added_at';
  const safeOrder = order === 'asc' ? 'ASC' : 'DESC';
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM remarks WHERE ${where}`).get(...params).cnt;
  const rows = db.prepare(`SELECT * FROM remarks WHERE ${where} ORDER BY ${safeSort} ${safeOrder} LIMIT ? OFFSET ?`)
    .all(...params, parseInt(limit), offset)
    .map(r => ({ ...r, sla_status: getSlaStatus(r.sla_deadline, r.priority) }));

  return res.json({ total, page: parseInt(page), limit: parseInt(limit), data: rows });
});

// PUT /api/agent/tasks/:id
router.put('/tasks/:id', (req, res) => {
  const { id } = req.params;
  const { agent_notes, status, resolved_at } = req.body;
  const lf = lineClause(req);
  const remark = db.prepare(`SELECT * FROM remarks WHERE id = ? AND assigned_to = ?${lf.clause}`).get(id, req.user.full_name, ...lf.params);
  if (!remark) return res.status(404).json({ error: 'Task not found' });

  // Reset SLA if adding notes while remark is still open
  let newSlaDeadline = remark.sla_deadline;
  if (agent_notes && remark.status !== 'إنتهت') {
    const excel = require('../services/excel.service');
    newSlaDeadline = excel.computeSlaDeadline(new Date().toISOString(), remark.priority);
  }

  db.prepare(`
    UPDATE remarks
    SET agent_notes = COALESCE(?, agent_notes),
        status = COALESCE(?, status),
        resolved_at = COALESCE(?, resolved_at),
        sla_deadline = ?,
        last_updated = datetime('now', '+2 hours')
    WHERE id = ?
  `).run(agent_notes || null, status || null, resolved_at || null, newSlaDeadline, id);

  const updated = db.prepare('SELECT * FROM remarks WHERE id = ?').get(id);
  return res.json({ ...updated, sla_status: getSlaStatus(updated.sla_deadline, updated.priority) });
});

// GET /api/agent/schedule?date=YYYY-MM-DD
router.get('/schedule', (req, res) => {
  const name = req.user.full_name;
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const bf = lineClause(req);

  // Get groups where this agent is coordinator (scoped to line)
  const batches = db.prepare(
    `SELECT group_name FROM batches WHERE coordinators LIKE ? AND status = 'نشطة'${bf.clause}`
  ).all(`%${name}%`, ...bf.params).map(b => b.group_name);

  if (!batches.length) return res.json([]);

  const placeholders = batches.map(() => '?').join(',');
  const lf = lineClause(req);
  const lectures = db.prepare(`
    SELECT * FROM lectures
    WHERE group_name IN (${placeholders})
      AND date = ?${lf.clause}
    ORDER BY time ASC
  `).all(...batches, date, ...lf.params);

  return res.json(lectures);
});

// GET /api/agent/absent
router.get('/absent', (req, res) => {
  const name = req.user.full_name;
  const {
    follow_up_status, page = 1, limit = 25,
    q, session_type, from_date, to_date, department, coordinator,
  } = req.query;

  const bf = lineClause(req);
  const batchRows = db.prepare(
    `SELECT group_name, dept_type, coordinators FROM batches WHERE coordinators LIKE ? AND status = 'نشطة'${bf.clause}`
  ).all(`%${name}%`, ...bf.params);

  if (!batchRows.length) return res.json({ total: 0, page: parseInt(page), data: [], filter_opts: { departments: [], coordinators: [] } });

  const groupNames = batchRows.map(b => b.group_name);
  const placeholders = groupNames.map(() => '?').join(',');

  const conditions = [`a.group_name IN (${placeholders})`];
  const params = [...groupNames];

  // Line filter on the absent_students table itself
  const line = lineFilter(req);
  if (line) { conditions.push('a.line = ?'); params.push(line); }

  if (follow_up_status) { conditions.push('a.follow_up_status = ?'); params.push(follow_up_status); }
  if (from_date)        { conditions.push('a.date >= ?'); params.push(from_date); }
  if (to_date)          { conditions.push('a.date <= ?'); params.push(to_date); }
  if (q) {
    conditions.push('(a.student_name LIKE ? OR a.phone LIKE ? OR a.group_name LIKE ?)');
    const esc = q.replace(/%/g, '\\%').replace(/_/g, '\\_');
    params.push(`%${esc}%`, `%${esc}%`, `%${esc}%`);
  }
  if (department && department !== 'All') {
    conditions.push(`(
      b.dept_type = ?
      OR EXISTS (
        SELECT 1 FROM users u
        WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
          AND u.department = ?
      )
    )`);
    params.push(department, department);
  }
  if (coordinator) { conditions.push('b.coordinators LIKE ?'); params.push(`%${coordinator}%`); }
  if (session_type) {
    if (session_type === 'side') {
      conditions.push("l.session_type = 'side'");
    } else {
      conditions.push("COALESCE(l.session_type, 'main') = 'main'");
    }
  }

  const where = conditions.join(' AND ');
  // Scope JOINs to the same line so we don't mix data across lines
  const batchJoinLine = line ? ' AND b.line = a.line' : '';
  const lectJoinLine  = line ? ' AND l.line = a.line' : '';
  const baseFrom = `
    FROM absent_students a
    LEFT JOIN batches b ON a.group_name = b.group_name${batchJoinLine}
    LEFT JOIN lectures l ON a.group_name = l.group_name AND a.date = l.date${lectJoinLine}
    WHERE ${where}
  `;

  const total = db.prepare(`SELECT COUNT(DISTINCT a.id) AS cnt ${baseFrom}`).get(...params).cnt;
  const data  = db.prepare(`
    SELECT a.id, a.group_name, a.date, a.time, a.lecture_no,
      a.follow_up_status, a.follow_up_note, a.follow_up_by, a.follow_up_at, a.synced_at,
      COALESCE(
        CASE WHEN a.phone IS NOT NULL AND TRIM(a.phone) != '' THEN
          (SELECT c.name FROM clients c WHERE c.phone = a.phone${line ? ' AND c.line = a.line' : ''} LIMIT 1)
        END,
        CASE WHEN a.student_name IS NOT NULL AND TRIM(a.student_name) != '' THEN
          (SELECT c.name FROM clients c
           WHERE c.group_name = a.group_name
             AND LOWER(TRIM(c.name)) = LOWER(TRIM(a.student_name))${line ? ' AND c.line = a.line' : ''} LIMIT 1)
        END,
        NULLIF(TRIM(a.student_name), '')
      ) AS student_name,
      COALESCE(
        NULLIF(TRIM(a.phone), ''),
        CASE WHEN a.student_name IS NOT NULL AND TRIM(a.student_name) != '' THEN
          (SELECT c.phone FROM clients c
           WHERE c.group_name = a.group_name
             AND LOWER(TRIM(c.name)) = LOWER(TRIM(a.student_name))${line ? ' AND c.line = a.line' : ''} LIMIT 1)
        END
      ) AS phone,
      b.dept_type,
      b.coordinators AS batch_coordinators,
      COALESCE(l.session_type, 'main') AS session_type
    ${baseFrom}
    GROUP BY a.id
    ORDER BY a.date DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const depts  = [...new Set(batchRows.map(b => b.dept_type).filter(Boolean))];
  const coords = [...new Set(
    batchRows.flatMap(b => (b.coordinators || '').split(/[,،]/).map(c => c.trim())).filter(Boolean)
  )];

  return res.json({ total, page: parseInt(page), data, filter_opts: { departments: depts, coordinators: coords } });
});

// PUT /api/agent/absent/:id
router.put('/absent/:id', (req, res) => {
  const { id } = req.params;
  const { follow_up_status, follow_up_note } = req.body;
  if (!follow_up_status) return res.status(400).json({ error: 'follow_up_status required' });

  const lf = lineClause(req);
  const absent = db.prepare(`SELECT id FROM absent_students WHERE id = ?${lf.clause}`).get(id, ...lf.params);
  if (!absent) return res.status(404).json({ error: 'Record not found' });

  db.prepare(`
    UPDATE absent_students
    SET follow_up_status = ?, follow_up_note = ?, follow_up_by = ?, follow_up_at = datetime('now', '+2 hours')
    WHERE id = ?
  `).run(follow_up_status, follow_up_note || null, req.user.full_name, id);

  return res.json(db.prepare('SELECT * FROM absent_students WHERE id = ?').get(id));
});

// GET /api/agent/side-session-check?date=YYYY-MM-DD&session_type=side|main
router.get('/side-session-check', (req, res) => {
  const name = req.user.full_name;
  const date         = req.query.date         || new Date().toISOString().slice(0, 10);
  const session_type = req.query.session_type || 'side';
  const bf = lineClause(req);

  const batches = db.prepare(
    `SELECT group_name FROM batches WHERE coordinators LIKE ? AND status = 'نشطة'${bf.clause}`
  ).all(`%${name}%`, ...bf.params).map(b => b.group_name);

  if (!batches.length) return res.json([]);

  const placeholders = batches.map(() => '?').join(',');
  const line = lineFilter(req);
  const lineL = line ? ' AND l.line = ?' : '';
  const lineSSC = line ? ' AND ssc.line = ?' : '';
  const sessions = db.prepare(`
    SELECT l.*, ssc.id AS check_id, ssc.trainer_present, ssc.student_present,
           ssc.lecture_start_time, ssc.recording_start_time, ssc.actual_duration_min,
           ssc.notes AS check_notes, ssc.checked_at, ssc.updated_at
    FROM lectures l
    LEFT JOIN side_session_checks ssc ON ssc.lecture_id = l.id AND ssc.session_date = ?${lineSSC}
    WHERE l.group_name IN (${placeholders})
      AND l.date = ?
      AND l.session_type = ?${lineL}
    ORDER BY l.time ASC
  `).all(
    date,
    ...(line ? [line] : []),
    ...batches,
    date,
    session_type,
    ...(line ? [line] : [])
  );

  return res.json(sessions);
});

// POST /api/agent/side-session-check
router.post('/side-session-check', (req, res) => {
  const {
    lecture_id, group_name, session_date,
    trainer_present, student_present,
    lecture_start_time, recording_start_time, actual_duration_min, notes
  } = req.body;

  if (!group_name || !session_date) {
    return res.status(400).json({ error: 'group_name and session_date are required' });
  }

  // Tag with user's line (Admin→Ahmed Hassan default)
  const userLine = req.user.line && req.user.line !== 'All' ? req.user.line : 'Ahmed Hassan';

  const result = db.prepare(`
    INSERT INTO side_session_checks
      (lecture_id, group_name, session_date, trainer_present, student_present,
       lecture_start_time, recording_start_time, actual_duration_min, notes, checked_by, line)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(lecture_id || null, group_name, session_date,
    trainer_present !== undefined ? (trainer_present ? 1 : 0) : null,
    student_present !== undefined ? (student_present ? 1 : 0) : null,
    lecture_start_time || null, recording_start_time || null,
    actual_duration_min || null, notes || null, req.user.id, userLine);

  return res.status(201).json(db.prepare('SELECT * FROM side_session_checks WHERE id = ?').get(result.lastInsertRowid));
});

// PUT /api/agent/side-session-check/:id
router.put('/side-session-check/:id', (req, res) => {
  const { id } = req.params;
  const {
    trainer_present, student_present,
    lecture_start_time, recording_start_time, actual_duration_min, notes
  } = req.body;

  const lf = lineClause(req);
  const check = db.prepare(`SELECT * FROM side_session_checks WHERE id = ?${lf.clause}`).get(id, ...lf.params);
  if (!check) return res.status(404).json({ error: 'Check record not found' });

  db.prepare(`
    UPDATE side_session_checks
    SET trainer_present = COALESCE(?, trainer_present),
        student_present = COALESCE(?, student_present),
        lecture_start_time = COALESCE(?, lecture_start_time),
        recording_start_time = COALESCE(?, recording_start_time),
        actual_duration_min = COALESCE(?, actual_duration_min),
        notes = COALESCE(?, notes),
        updated_by = ?, updated_at = datetime('now', '+2 hours')
    WHERE id = ?
  `).run(
    trainer_present !== undefined ? (trainer_present ? 1 : 0) : null,
    student_present !== undefined ? (student_present ? 1 : 0) : null,
    lecture_start_time || null, recording_start_time || null,
    actual_duration_min || null, notes || null,
    req.user.id, id
  );

  return res.json(db.prepare('SELECT * FROM side_session_checks WHERE id = ?').get(id));
});

module.exports = router;
