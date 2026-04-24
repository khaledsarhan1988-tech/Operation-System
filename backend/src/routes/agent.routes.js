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
  const { agent_notes, status, resolved_at, next_followup_at } = req.body;
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
    SET agent_notes      = COALESCE(?, agent_notes),
        status           = COALESCE(?, status),
        resolved_at      = COALESCE(?, resolved_at),
        next_followup_at = CASE WHEN ? IS NOT NULL THEN ? ELSE next_followup_at END,
        sla_deadline     = ?,
        last_updated     = datetime('now', '+2 hours')
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

// ─── REMINDERS ───────────────────────────────────────────────────────────────

// GET /api/agent/reminders — all logged follow-ups (from remark_interactions) for open tasks assigned to me
router.get('/reminders', (req, res) => {
  const name = req.user.full_name;
  const lf   = lineClause(req);
  const rows = db.prepare(`
    SELECT ri.id, ri.next_followup_at, ri.agent_name, ri.created_at,
           r.id        AS remark_id,
           r.client_name, r.client_phone, r.status, r.assigned_to, r.line
    FROM remark_interactions ri
    JOIN remarks r ON r.id = ri.remark_id
    WHERE ri.next_followup_at IS NOT NULL
      AND ri.next_followup_at != ''
      AND r.category    = 'توزيع عملاء'
      AND r.assigned_to = ?
      AND r.status NOT IN ('Retention Done','إنتهت')
      ${lf.clause}
    ORDER BY ri.next_followup_at ASC
    LIMIT 200
  `).all(name, ...lf.params);
  return res.json(rows);
});

// ─── PIPELINE (CRM Kanban) ────────────────────────────────────────────────────

// GET /api/agent/pipeline?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
router.get('/pipeline', (req, res) => {
  const name     = req.user.full_name;
  const lf       = lineClause(req);
  const dateFrom = (req.query.date_from || '').trim();
  const dateTo   = (req.query.date_to   || '').trim();

  const dateParams  = [];
  let   dateClause  = '';
  if (dateFrom) { dateClause += ' AND client_date >= ?'; dateParams.push(dateFrom); }
  if (dateTo)   { dateClause += ' AND client_date <= ?'; dateParams.push(dateTo);   }

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
      'جديدة':           buildCol(`status NOT IN ('إنتهت','قيد المتابعة','في المتابعة','بانتظار الرد','Follow Up','Placement Test','Problem Existing','No Answer','No Interesting','Retention Done')`),
      'Follow Up':       buildCol(`status IN ('قيد المتابعة','في المتابعة','Follow Up')`),
      'Placement Test':  buildCol(`status = 'Placement Test'`),
      'Problem Existing':buildCol(`status = 'Problem Existing'`),
      'No Answer':       buildCol(`status IN ('بانتظار الرد','No Answer')`),
      'No Interesting':  buildCol(`status = 'No Interesting'`),
      'Retention Done':  buildCol(`status IN ('إنتهت','Retention Done')`),
    });
  } catch (err) {
    console.error('[agent/pipeline]', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/agent/tasks/:id/log  — record an interaction
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

  // Optionally update remark status + next_followup_at
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

// GET /api/agent/tasks/:id/logs
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

// DELETE /api/agent/interactions/:id  — delete a specific interaction log
router.delete('/interactions/:id', (req, res) => {
  const { id } = req.params;
  const name = req.user.full_name;
  const lf = lineClause(req);
  // Confirm the interaction belongs to a remark assigned to this agent
  const interaction = db.prepare(`
    SELECT ri.* FROM remark_interactions ri
    JOIN remarks r ON r.id = ri.remark_id
    WHERE ri.id = ? AND r.assigned_to = ?${lf.clause}
  `).get(id, name, ...lf.params);
  if (!interaction) return res.status(404).json({ error: 'Interaction not found' });
  db.prepare('DELETE FROM remark_interactions WHERE id = ?').run(id);
  return res.json({ ok: true });
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

// GET /api/agent/zoom-sessions — Zoom (side) sessions table with filters, scoped to agent's groups
router.get('/zoom-sessions', (req, res) => {
  const name = req.user.full_name;
  const {
    page = 1, limit = 25,
    from_date, to_date, trainer, q,
  } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const line   = lineFilter(req);
  const bf     = lineClause(req);
  const lineL  = line ? ` AND l.line = '${line.replace(/'/g,"''")}'` : '';
  const lineB  = line ? ` AND b.line = l.line` : '';

  // Agent's groups — all batches (no status restriction)
  const batchRows = db.prepare(
    `SELECT group_name, dept_type, coordinators FROM batches WHERE coordinators LIKE ?${bf.clause}`
  ).all(`%${name}%`, ...bf.params);

  if (!batchRows.length)
    return res.json({ total: 0, page: parseInt(page), data: [] });

  const groupNames = batchRows.map(b => b.group_name);
  const gph        = groupNames.map(() => '?').join(',');

  const conditions = [
    `l.session_type = 'side'`,
    `l.group_name IN (${gph})`,
  ];
  const params = [...groupNames];

  if (line)      { conditions.push(`l.line = ?`);      params.push(line); }
  if (from_date) { conditions.push(`l.date >= ?`);     params.push(from_date); }
  if (to_date)   { conditions.push(`l.date <= ?`);     params.push(to_date); }
  if (trainer) {
    const esc = trainer.replace(/%/g,'\\%').replace(/_/g,'\\_');
    conditions.push(`l.trainer LIKE ? ESCAPE '\\'`);   params.push(`%${esc}%`);
  }
  if (q) {
    const esc = q.replace(/%/g,'\\%').replace(/_/g,'\\_');
    conditions.push(`l.group_name LIKE ? ESCAPE '\\'`); params.push(`%${esc}%`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const baseQ = `
    SELECT
      l.id, l.group_name, l.date, l.time, l.duration,
      l.trainer, l.status, l.location, l.attendance,
      l.side_session_category,
      COALESCE(b.coordinators, ?) AS coordinators,
      COALESCE(
        (SELECT u.department FROM users u
         WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
           AND u.department != 'All' LIMIT 1),
        b.dept_type
      ) AS dept_type
    FROM lectures l
    LEFT JOIN batches b ON l.group_name = b.group_name${lineB}
    ${where}
  `;
  const baseParams = [name, ...params];

  try {
    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM (${baseQ})`).get(...baseParams).cnt;
    const data  = db.prepare(`${baseQ} ORDER BY l.date DESC, l.time ASC LIMIT ? OFFSET ?`)
                    .all(...baseParams, parseInt(limit), offset);

    return res.json({ total, page: parseInt(page), data });
  } catch (err) {
    console.error('[agent/zoom-sessions]', err);
    return res.status(500).json({ error: err.message });
  }
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
    `SELECT group_name, dept_type, coordinators FROM batches WHERE coordinators LIKE ?${bf.clause}`
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
    LEFT JOIN lectures l ON a.group_name = l.group_name AND a.date = l.date AND l.status != 'غير مؤكدة'${lectJoinLine}
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

// GET /api/agent/absent-zoom — Zoom (side) session absence, grouped per group+date
// Mirrors admin's /reports/absent-side-list, scoped to agent's groups
router.get('/absent-zoom', (req, res) => {
  const name = req.user.full_name;
  const { page = 1, limit = 25, from_date, to_date, q } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const line   = lineFilter(req);
  const bf     = lineClause(req);
  const lineL  = line ? ` AND l.line = '${line.replace(/'/g, "''")}'` : '';
  const lineB  = line ? ' AND b.line = l.line' : '';

  // Agent's group names (all batches, no status restriction)
  const batchRows = db.prepare(
    `SELECT group_name FROM batches WHERE coordinators LIKE ?${bf.clause}`
  ).all(`%${name}%`, ...bf.params);

  if (!batchRows.length)
    return res.json({ total: 0, page: parseInt(page), data: [] });

  const groupNames = batchRows.map(b => b.group_name);
  const gph        = groupNames.map(() => '?').join(',');

  const dateFilter = from_date && to_date
    ? ` AND l.date BETWEEN '${from_date}' AND '${to_date}'`
    : from_date ? ` AND l.date >= '${from_date}'`
    : to_date   ? ` AND l.date <= '${to_date}'` : '';

  const searchFilter = q
    ? ` AND l.group_name LIKE '%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%' ESCAPE '\\'`
    : '';

  // Same formula as admin /reports/absent-side-list
  const groupedQuery = `
    SELECT
      l.group_name,
      l.date                                                                AS session_date,
      MAX(l.trainer)                                                        AS trainer,
      MAX(b.coordinators)                                                   AS coordinators,
      COALESCE(
        (SELECT u.department FROM users u
         WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
           AND u.department != 'All' LIMIT 1),
        MAX(b.dept_type)
      )                                                                     AS dept_type,
      COUNT(*)                                                              AS trainee_count,
      SUM(CASE WHEN l.attendance IS NOT NULL AND l.attendance != ''
               AND CAST(l.attendance AS INTEGER) > 0 THEN 1 ELSE 0 END)   AS present_count,
      COUNT(*) -
      SUM(CASE WHEN l.attendance IS NOT NULL AND l.attendance != ''
               AND CAST(l.attendance AS INTEGER) > 0 THEN 1 ELSE 0 END)   AS absent_count
    FROM lectures l
    LEFT JOIN batches b ON l.group_name = b.group_name${lineB}
    WHERE l.session_type = 'side'
      AND l.status = 'مؤكدة'
      AND (l.duration IS NULL OR l.duration <= '00:15')
      AND l.group_name IN (${gph})${lineL}${dateFilter}${searchFilter}
    GROUP BY l.group_name, l.date
    HAVING absent_count > 0
  `;

  try {
    const total        = db.prepare(`SELECT COUNT(*) AS cnt FROM (${groupedQuery})`).get(...groupNames).cnt;
    const totalAbsent  = db.prepare(`SELECT COALESCE(SUM(absent_count),0) AS cnt FROM (${groupedQuery})`).get(...groupNames).cnt;
    const data         = db.prepare(`${groupedQuery} ORDER BY session_date DESC LIMIT ? OFFSET ?`)
                           .all(...groupNames, parseInt(limit), offset);
    return res.json({ total, total_absent: totalAbsent, page: parseInt(page), data });
  } catch (err) {
    console.error('[agent/absent-zoom]', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/agent/absent-zoom-detail — individual absent students for a specific group+date
router.get('/absent-zoom-detail', (req, res) => {
  const name = req.user.full_name;
  const { group_name, session_date } = req.query;
  if (!group_name || !session_date)
    return res.status(400).json({ error: 'group_name and session_date required' });

  const line  = lineFilter(req);
  const bf    = lineClause(req);
  const lineA = line ? ` AND a.line = '${line.replace(/'/g, "''")}'` : '';
  const lineC = line ? ` AND c.line = '${line.replace(/'/g, "''")}'` : '';
  const lineR = line ? ` AND r.line = '${line.replace(/'/g, "''")}'` : '';

  // Verify group belongs to this agent
  const batch = db.prepare(
    `SELECT group_name FROM batches WHERE group_name = ? AND coordinators LIKE ?${bf.clause}`
  ).get(group_name, `%${name}%`, ...bf.params);
  if (!batch) return res.status(403).json({ error: 'Access denied' });

  // ── Source 1: absent_students table ──────────────────────────────────────
  const fromAbsent = db.prepare(`
    SELECT DISTINCT
      COALESCE(c.name, NULLIF(TRIM(a.student_name), '')) AS student_name,
      COALESCE(NULLIF(TRIM(a.phone), ''), c.phone)        AS phone
    FROM absent_students a
    LEFT JOIN clients c ON c.phone = a.phone${lineC}
    WHERE a.group_name = ? AND a.date = ?${lineA}
      AND ((a.student_name IS NOT NULL AND TRIM(a.student_name) != '')
           OR  (a.phone IS NOT NULL AND TRIM(a.phone) != ''))
    ORDER BY student_name
  `).all(group_name, session_date);

  if (fromAbsent.length > 0)
    return res.json({ source: 'absent_students', data: fromAbsent });

  // ── Source 2: remarks with category = 'Attendance Zoom Call' ─────────────
  // • remarks table has NO group_name column → join via clients to resolve it
  // • Remark is created the day AFTER the absence, so:
  //     session_date = date(added_at [DD/MM/YYYY], '-1 day')
  const rdSQL = `date(substr(r.added_at,7,4)||'-'||substr(r.added_at,4,2)||'-'||substr(r.added_at,1,2), '-1 day')`;
  const fromRemarks = db.prepare(`
    SELECT DISTINCT
      COALESCE(c.name, r.client_name) AS student_name,
      r.client_phone                  AS phone
    FROM remarks r
    LEFT JOIN clients c ON c.phone = r.client_phone${lineC}
    WHERE r.category = 'Attendance Zoom Call'
      AND c.group_name = ?
      AND ${rdSQL} = ?${lineR}
      AND r.client_phone IS NOT NULL AND TRIM(r.client_phone) != ''
    ORDER BY student_name
  `).all(group_name, session_date);

  if (fromRemarks.length > 0)
    return res.json({ source: 'remarks', data: fromRemarks });

  // ── No individual data available ─────────────────────────────────────────
  return res.json({ source: 'none', data: [] });
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

// ─── CLIENT TRANSFER SYSTEM ───────────────────────────────────────────────────

// GET /api/agent/transfer-targets — role-based list of allowed transfer recipients
router.get('/transfer-targets', (req, res) => {
  const user = req.user;
  let rows;
  if (user.role === 'leader') {
    // Leader: own agents + all other leaders + admins (not themselves)
    rows = db.prepare(`
      SELECT full_name, role, department, line FROM users
      WHERE is_active = 1
        AND full_name != ?
        AND (
          (role = 'agent'  AND department = ?)
          OR role = 'leader'
          OR role = 'admin'
        )
      ORDER BY
        CASE role WHEN 'admin' THEN 1 WHEN 'leader' THEN 2 ELSE 3 END ASC,
        full_name COLLATE NOCASE
    `).all(user.full_name, user.department);
  } else {
    // Agent: their department's leader(s) + admins
    rows = db.prepare(`
      SELECT full_name, role, department FROM users
      WHERE is_active = 1
        AND full_name != ?
        AND (
          (role = 'leader' AND department = ?)
          OR role = 'admin'
        )
      ORDER BY
        CASE role WHEN 'admin' THEN 1 ELSE 2 END ASC,
        full_name COLLATE NOCASE
    `).all(user.full_name, user.department || '');
  }
  return res.json(rows);
});

// PUT /api/agent/bulk-transfer — transfer selected clients (with permission check + logging)
router.put('/bulk-transfer', (req, res) => {
  const user = req.user;
  const { ids, assigned_to } = req.body;

  if (!Array.isArray(ids) || !ids.length || !assigned_to)
    return res.status(400).json({ error: 'ids و assigned_to مطلوبان' });

  // Verify target exists
  const target = db.prepare(`SELECT * FROM users WHERE full_name = ? AND is_active = 1`).get(assigned_to);
  if (!target) return res.status(400).json({ error: 'المستخدم المستهدف غير موجود' });

  // ── Permission check ──────────────────────────────────────────────────────
  if (user.role === 'agent') {
    // Agent → their department's leader OR any admin
    const ok = target.role === 'admin'
             || (target.role === 'leader' && target.department === user.department);
    if (!ok) return res.status(403).json({ error: 'يمكنك إحالة العملاء لقائد فريقك أو المسؤول فقط' });
  } else if (user.role === 'leader') {
    // Leader → their agents OR any leader OR any admin
    const ok = target.role === 'admin'
             || target.role === 'leader'
             || (target.role === 'agent' && target.department === user.department);
    if (!ok) return res.status(403).json({ error: 'يمكنك النقل لموظفي قسمك أو قادة الفرق أو المسؤولين فقط' });
  }
  // admin role unreachable here (admin uses /api/admin/* routes)

  const lf = lineClause(req);
  const safeIds = ids.map(Number).filter(n => n > 0);
  const ph = safeIds.map(() => '?').join(',');

  // Fetch remarks to move — must be currently assigned to the requesting user
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
      logStmt.run(r.id, r.client_name, r.client_phone, r.assigned_to, assigned_to, user.full_name, r.line || user.line || '');
    }
  })();

  return res.json({ moved: remarksToMove.length });
});

// GET /api/agent/transfer-history — audit history scoped to the requesting user/leader
router.get('/transfer-history', (req, res) => {
  const user = req.user;
  const { page = 1, limit = 50, date_from, date_to, phone, user_name } = req.query;
  const conditions = [];
  const params     = [];

  if (user.role === 'leader') {
    // Leader sees transfers in their department
    conditions.push(`(
      ct.transferred_by = ?
      OR ct.to_user = ?
      OR EXISTS (SELECT 1 FROM users u WHERE u.full_name = ct.from_user AND u.department = ?)
    )`);
    params.push(user.full_name, user.full_name, user.department || '');
  } else {
    // Agent sees only transfers they initiated or received
    conditions.push(`(ct.from_user = ? OR ct.to_user = ?)`);
    params.push(user.full_name, user.full_name);
  }

  if (date_from)  { conditions.push(`ct.transferred_at >= ?`);                          params.push(date_from); }
  if (date_to)    { conditions.push(`ct.transferred_at <= ?`);                          params.push(date_to + ' 23:59:59'); }
  if (phone)      { conditions.push(`ct.client_phone LIKE ?`);                          params.push(`%${phone}%`); }
  if (user_name)  { conditions.push(`(ct.from_user LIKE ? OR ct.to_user LIKE ?)`);      params.push(`%${user_name}%`, `%${user_name}%`); }

  const where  = 'WHERE ' + conditions.join(' AND ');
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const total  = db.prepare(`SELECT COUNT(*) as cnt FROM client_transfers ct ${where}`).get(...params).cnt;
  const data   = db.prepare(`
    SELECT ct.* FROM client_transfers ct
    ${where}
    ORDER BY ct.transferred_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  return res.json({ total, page: parseInt(page), data });
});

module.exports = router;
