'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { lineFilter } = require('../utils/lineFilter');

const router = express.Router();
router.use(authenticate, requireRole('leader'));

// Effective line for endpoints where 'All' admins can choose via ?line= query:
//   - non-'All' users → always their own line (override ignored)
//   - 'All' users with ?line=X (valid) → X
//   - 'All' users without ?line= → null (no filter = see all)
const VALID_LINES = ['Ahmed Hassan', 'Dardasha'];
function effectiveLine(req) {
  const userLine = req.user?.line || 'Ahmed Hassan';
  if (userLine !== 'All') return userLine;
  const q = (req.query.line || '').trim();
  return VALID_LINES.includes(q) ? q : null;
}

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────

// GET /api/admin/users
router.get('/users', (req, res) => {
  const requesterLine = req.user.line || 'All';
  let sql = 'SELECT id, username, full_name, role, department, management, line, language, is_active, created_at FROM users';
  const params = [];
  if (requesterLine !== 'All') {
    sql += ' WHERE line = ?';
    params.push(requesterLine);
  }
  sql += ' ORDER BY role, full_name';
  const users = db.prepare(sql).all(...params);
  return res.json(users);
});

// POST /api/admin/users
router.post('/users', (req, res) => {
  const { username, password, full_name, role, department, language = 'ar', management = 'Customer Services', line = 'Ahmed Hassan' } = req.body;
  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ error: 'username, password, full_name, role are required' });
  }
  if (!['agent', 'leader', 'admin', 'enrollment', 'enrollment_leader'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (existing) return res.status(409).json({ error: 'Username already exists' });

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role, department, language, management, line)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(username, hash, full_name, role, department || 'General', language, management, line);

  const user = db.prepare('SELECT id, username, full_name, role, department, management, line, language, is_active FROM users WHERE id = ?')
    .get(result.lastInsertRowid);
  return res.status(201).json(user);
});

// PUT /api/admin/users/:id
router.put('/users/:id', (req, res) => {
  const { id } = req.params;
  const { full_name, role, department, language, password, is_active, management, line } = req.body;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (password) {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
      .run(bcrypt.hashSync(password, 12), id);
  }

  const fields = [];
  const params = [];
  if (full_name  !== undefined) { fields.push('full_name = ?');  params.push(full_name); }
  if (role       !== undefined) { fields.push('role = ?');       params.push(role); }
  if (department !== undefined) { fields.push('department = ?'); params.push(department); }
  if (language   !== undefined) { fields.push('language = ?');   params.push(language); }
  if (is_active  !== undefined) { fields.push('is_active = ?');  params.push(is_active ? 1 : 0); }
  if (management !== undefined) { fields.push('management = ?'); params.push(management); }
  if (line       !== undefined) { fields.push('line = ?');       params.push(line); }

  if (fields.length) {
    fields.push("updated_at = datetime('now', 'localtime')");
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params, id);
  }

  const updated = db.prepare('SELECT id, username, full_name, role, department, management, line, language, is_active FROM users WHERE id = ?').get(id);
  return res.json(updated);
});

// PATCH /api/admin/users/:id/status — toggle active/inactive
router.patch('/users/:id/status', (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) return res.status(400).json({ error: 'Cannot change your own status' });
  const user = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const newStatus = user.is_active ? 0 : 1;
  db.prepare("UPDATE users SET is_active = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(newStatus, id);
  return res.json({ is_active: newStatus });
});

// DELETE /api/admin/users/:id — hard delete
router.delete('/users/:id', (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return res.json({ message: 'User deleted' });
});

// ─── SIDE SESSION CHECKS — Admin only delete ─────────────────────────────────
router.delete('/side-session-checks/:id', (req, res) => {
  const line = lineFilter(req);
  const lineClause = line ? ' AND line = ?' : '';
  const lineParams = line ? [line] : [];
  const check = db.prepare(`SELECT id FROM side_session_checks WHERE id = ?${lineClause}`).get(req.params.id, ...lineParams);
  if (!check) return res.status(404).json({ error: 'Check record not found' });
  db.prepare('DELETE FROM side_session_checks WHERE id = ?').run(req.params.id);
  return res.json({ message: 'Deleted' });
});

// ─── SYNC HISTORY (line-scoped) ──────────────────────────────────────────────
router.get('/syncs', (req, res) => {
  try {
    const line = effectiveLine(req);
    const where = line ? 'WHERE es.line = ?' : '';
    const params = line ? [line] : [];
    const syncs = db.prepare(`
      SELECT es.*, u.full_name AS uploaded_by_name
      FROM excel_syncs es
      LEFT JOIN users u ON u.id = es.uploaded_by
      ${where}
      ORDER BY es.created_at DESC
      LIMIT 50
    `).all(...params);
    return res.json({ syncs });
  } catch (err) {
    return res.json({ syncs: [] });
  }
});

// ─── helper ──────────────────────────────────────────────────────────────────
function safeCount(db, sql, params = []) {
  try { return db.prepare(sql).get(...params)?.c ?? 0; } catch { return 0; }
}
function lineWhere(line, prefix = 'WHERE') {
  return line ? ` ${prefix} line = ?` : '';
}
function lineAnd(line) {
  return line ? ' AND line = ?' : '';
}

// ─── UPLOAD STATUS (line-scoped) ─────────────────────────────────────────────
router.get('/upload-status', (req, res) => {
  try {
    const line = effectiveLine(req);
    const lp = line ? [line] : [];

    let uploadMap = {};
    try {
      const syncWhere = line ? "WHERE status = 'success' AND line = ?" : "WHERE status = 'success'";
      db.prepare(`
        SELECT file_type, MAX(created_at) as last_upload, rows_imported
        FROM excel_syncs ${syncWhere}
        GROUP BY file_type
      `).all(...lp).forEach(r => { uploadMap[r.file_type] = r; });
    } catch {}

    // Line-scoped counts (NULL alias means 'no alias')
    const counts = {
      data:          safeCount(db, `SELECT COUNT(*) as c FROM employees${lineWhere(line)}`, lp),
      trainees:      safeCount(db, `SELECT COUNT(*) as c FROM clients${lineWhere(line)}`, lp),
      batches:       safeCount(db, `SELECT COUNT(*) as c FROM batches${lineWhere(line)}`, lp),
      remarks:       safeCount(db, `SELECT COUNT(*) as c FROM remarks${lineWhere(line)}`, lp),
      lectures:      safeCount(db, `SELECT COUNT(*) as c FROM lectures WHERE session_type='main'${lineAnd(line)}`, lp),
      side_sessions: safeCount(db, `SELECT COUNT(*) as c FROM lectures WHERE session_type='side'${lineAnd(line)}`, lp),
      absent:        safeCount(db, `SELECT COUNT(*) as c FROM absent_students${lineWhere(line)}`, lp),
    };

    const FILE_KEYS = ['data','trainees','batches','remarks','lectures','side_sessions','absent'];
    return res.json(FILE_KEYS.map(key => ({
      key,
      last_upload:    uploadMap[key]?.last_upload    ?? null,
      rows_imported:  uploadMap[key]?.rows_imported  ?? null,
      current_count:  counts[key],
    })));
  } catch (err) {
    console.error('[admin] upload-status error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── CLEAR SINGLE FILE TYPE DATA (line-scoped with ?line= override for 'All') ───
router.delete('/clear-excel-data/:fileType', (req, res) => {
  const { fileType } = req.params;
  const line = effectiveLine(req);
  const lineW  = lineWhere(line);
  const lineA  = lineAnd(line);
  const lp = line ? [line] : [];

  const FILE_DELETE = {
    data:          () => { safeRun(db, `DELETE FROM employees${lineW}`, lp); },
    trainees:      () => { safeRun(db, `DELETE FROM clients${lineW}`, lp); },
    batches:       () => { safeRun(db, `DELETE FROM batches${lineW}`, lp); },
    remarks:       () => { safeRun(db, `DELETE FROM remarks${lineW}`, lp); },
    lectures:      () => { safeRun(db, `DELETE FROM lectures WHERE session_type='main'${lineA}`, lp); },
    side_sessions: () => { safeRun(db, `DELETE FROM lectures WHERE session_type='side'${lineA}`, lp); },
    absent:        () => { safeRun(db, `DELETE FROM absent_students${lineW}`, lp); },
  };
  if (!FILE_DELETE[fileType])
    return res.status(400).json({ error: `Unknown fileType: ${fileType}` });
  try {
    FILE_DELETE[fileType]();
    // Scope sync log deletion by line too (preserve other line's history)
    try {
      if (line) {
        db.prepare("DELETE FROM excel_syncs WHERE file_type = ? AND line = ?").run(fileType, line);
      } else {
        db.prepare("DELETE FROM excel_syncs WHERE file_type = ?").run(fileType);
      }
    } catch {}
    return res.json({ message: `Cleared: ${fileType}` + (line ? ` (${line})` : '') });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

function safeRun(db, sql, params = []) {
  try { db.prepare(sql).run(...params); } catch {}
}

// ─── CLEAR CLIENT TRANSFERS LOG (completely separate from Excel data) ────────
router.delete('/clear-transfers', (req, res) => {
  try {
    const line = effectiveLine(req);
    const lineW = lineWhere(line);
    const lp = line ? [line] : [];
    safeRun(db, `DELETE FROM client_transfers${lineW}`, lp);
    return res.json({ message: 'Movement log cleared' + (line ? ` (${line})` : '') });
  } catch (err) {
    console.error('[admin] clear-transfers error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── CLEAR ALL EXCEL DATA (line-scoped with ?line= override for 'All') ──────
router.delete('/clear-excel-data', (req, res) => {
  try {
    const line = effectiveLine(req);
    const lineW = lineWhere(line);
    const lp = line ? [line] : [];
    ['lectures','absent_students','clients','batches','remarks','employees'].forEach(t =>
      safeRun(db, `DELETE FROM ${t}${lineW}`, lp)
    );
    // Clear sync audit log: scoped if a line is active, full wipe otherwise
    if (line) {
      safeRun(db, 'DELETE FROM excel_syncs WHERE line = ?', lp);
    } else {
      safeRun(db, 'DELETE FROM excel_syncs');
    }
    return res.json({ message: 'All Excel data cleared' + (line ? ` (${line})` : '') });
  } catch (err) {
    console.error('[admin] clear-excel-data error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── SYSTEM KPIs (line-scoped) ─────────────────────────────────────────────
router.get('/kpis', (req, res) => {
  const line = lineFilter(req);
  const lineW = lineWhere(line);
  const lineA = lineAnd(line);
  const lp = line ? [line] : [];

  const kpis = {
    total_clients:   db.prepare(`SELECT COUNT(*) AS c FROM clients${lineW}`).get(...lp).c,
    total_batches:   db.prepare(`SELECT COUNT(*) AS c FROM batches WHERE status = 'نشطة'${lineA}`).get(...lp).c,
    total_remarks:   db.prepare(`SELECT COUNT(*) AS c FROM remarks${lineW}`).get(...lp).c,
    pending_remarks: db.prepare(`SELECT COUNT(*) AS c FROM remarks WHERE status != 'إنتهت'${lineA}`).get(...lp).c,
    overdue_remarks: db.prepare(`SELECT COUNT(*) AS c FROM remarks WHERE status != 'إنتهت' AND sla_deadline < datetime('now', 'localtime')${lineA}`).get(...lp).c,
    total_agents:    db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role IN ('agent','enrollment') AND is_active = 1${lineA}`).get(...lp).c,
    absent_pending:  db.prepare(`SELECT COUNT(*) AS c FROM absent_students WHERE follow_up_status = 'pending'${lineA}`).get(...lp).c,
    last_sync:       db.prepare("SELECT created_at FROM excel_syncs WHERE status = 'success' ORDER BY created_at DESC LIMIT 1").get()?.created_at || null,
    session_checks_today: db.prepare(`SELECT COUNT(*) AS c FROM side_session_checks WHERE date(checked_at) = date('now')${lineA}`).get(...lp).c,
  };
  return res.json(kpis);
});

// ─── KPI DRILL-DOWN DETAILS ──────────────────────────────────────────────────
router.get('/kpis/details/:metric', (req, res) => {
  const { metric } = req.params;
  const line = lineFilter(req);
  const lineW = lineWhere(line);
  const lineA = lineAnd(line);
  const lp = line ? [line] : [];
  try {
    let rows = [];
    switch (metric) {
      case 'clients':
        rows = db.prepare(`
          SELECT id, name, phone, email, group_name, via_company, registration_time
          FROM clients${lineW}
          ORDER BY name COLLATE NOCASE
        `).all(...lp);
        break;

      case 'batches':
        rows = db.prepare(`
          SELECT id, group_name, course, status, trainers, coordinators,
                 trainee_count, max_trainees, scheduled_lectures, completed_lectures,
                 start_date, end_date, dept_type
          FROM batches
          WHERE status = 'نشطة'${lineA}
          ORDER BY group_name
        `).all(...lp);
        break;

      case 'remarks':
        rows = db.prepare(`
          SELECT id, client_name, client_phone, task_type, category, priority, status,
                 assigned_to, assigned_by, added_at, sla_deadline, last_updated
          FROM remarks${lineW}
          ORDER BY added_at DESC
        `).all(...lp);
        break;

      case 'pending-remarks':
        rows = db.prepare(`
          SELECT id, client_name, client_phone, task_type, category, priority, status,
                 assigned_to, assigned_by, added_at, sla_deadline
          FROM remarks
          WHERE status != 'إنتهت'${lineA}
          ORDER BY sla_deadline ASC
        `).all(...lp);
        break;

      case 'overdue-remarks':
        rows = db.prepare(`
          SELECT id, client_name, client_phone, task_type, category, priority, status,
                 assigned_to, assigned_by, added_at, sla_deadline
          FROM remarks
          WHERE status != 'إنتهت'
            AND sla_deadline < datetime('now', 'localtime')${lineA}
          ORDER BY sla_deadline ASC
        `).all(...lp);
        break;

      case 'agents':
        rows = db.prepare(`
          SELECT id, username, full_name, role, department, management, line, language, is_active, created_at
          FROM users
          WHERE role IN ('agent','enrollment') AND is_active = 1${lineA}
          ORDER BY full_name COLLATE NOCASE
        `).all(...lp);
        break;

      case 'absent-pending':
        rows = db.prepare(`
          SELECT id, group_name, student_name, phone, date, time, lecture_no,
                 follow_up_status, follow_up_note, follow_up_by, follow_up_at
          FROM absent_students
          WHERE follow_up_status = 'pending'${lineA}
          ORDER BY date DESC, group_name
        `).all(...lp);
        break;

      case 'session-checks-today':
        rows = db.prepare(`
          SELECT s.id, s.group_name, s.session_date,
                 s.trainer_present, s.student_present,
                 s.lecture_start_time, s.recording_start_time,
                 s.actual_duration_min, s.notes,
                 s.checked_at, u.full_name AS checked_by_name
          FROM side_session_checks s
          LEFT JOIN users u ON u.id = s.checked_by
          WHERE date(s.checked_at) = date('now')${line ? ' AND s.line = ?' : ''}
          ORDER BY s.checked_at DESC
        `).all(...lp);
        break;

      default:
        return res.status(404).json({ error: 'Unknown metric' });
    }

    return res.json({ metric, count: rows.length, rows });
  } catch (err) {
    console.error('[admin] kpi details error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN PIPELINE ──────────────────────────────────────────────────────────

function getSlaStatus(slaDeadline, priority) {
  if (!slaDeadline) return 'on_time';
  const deadline = new Date(slaDeadline);
  const now = new Date();
  const WARN = { 'عاجلة': 3, 'هامة': 24, 'عادية': 48 };
  const warnMs = (WARN[priority] || 48) * 3600000;
  if (now > deadline) return 'breached';
  if (deadline - now <= warnMs) return 'at_risk';
  return 'on_time';
}

// GET /api/admin/pipeline?line=&agent=&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
router.get('/pipeline', (req, res) => {
  const line      = effectiveLine(req);
  const agent     = (req.query.agent     || '').trim();
  const dateFrom  = (req.query.date_from || '').trim();
  const dateTo    = (req.query.date_to   || '').trim();

  const conditions = [`r.category = 'توزيع عملاء'`];
  const params     = [];

  if (line)     { conditions.push('r.line = ?');         params.push(line);     }
  if (agent)    { conditions.push('r.assigned_to = ?');  params.push(agent);    }
  // client_date in remarks is stored as YYYY-MM-DD (via dmyToISO on confirm) — direct comparison is correct
  if (dateFrom) { conditions.push('r.client_date >= ?'); params.push(dateFrom); }
  if (dateTo)   { conditions.push('r.client_date <= ?'); params.push(dateTo);   }

  const where = conditions.join(' AND ');

  const buildCol = (stageWhere) =>
    db.prepare(`
      SELECT r.id, r.client_name, r.client_phone, r.task_type, r.status,
             r.priority, r.sla_deadline, r.added_at, r.last_updated,
             r.next_followup_at, r.agent_notes, r.category,
             r.line, r.assigned_to, r.client_date
      FROM remarks r
      WHERE ${where} AND ${stageWhere}
      ORDER BY
        CASE r.priority WHEN 'عاجلة' THEN 1 WHEN 'هامة' THEN 2 ELSE 3 END ASC,
        CASE WHEN r.sla_deadline < datetime('now','+2 hours') THEN 0 ELSE 1 END ASC,
        r.added_at ASC
      LIMIT 500
    `).all(...params)
      .map(r => ({ ...r, sla_status: getSlaStatus(r.sla_deadline, r.priority) }));

  try {
    return res.json({
      'جديدة':           buildCol(`r.status NOT IN ('إنتهت','قيد المتابعة','في المتابعة','بانتظار الرد','Follow Up','Placement Test','Problem Existing','No Answer','No Interesting','Retention Done')`),
      'Follow Up':       buildCol(`r.status IN ('قيد المتابعة','في المتابعة','Follow Up')`),
      'Placement Test':  buildCol(`r.status = 'Placement Test'`),
      'Problem Existing':buildCol(`r.status = 'Problem Existing'`),
      'No Answer':       buildCol(`r.status IN ('بانتظار الرد','No Answer')`),
      'No Interesting':  buildCol(`r.status = 'No Interesting'`),
      'Retention Done':  buildCol(`r.status IN ('إنتهت','Retention Done')`),
    });
  } catch (err) {
    console.error('[admin/pipeline]', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/pipeline/reminders?line=&agent=  — all logged follow-ups from remark_interactions for open tasks
router.get('/pipeline/reminders', (req, res) => {
  const line  = effectiveLine(req);
  const agent = (req.query.agent || '').trim();
  const conditions = [
    `ri.next_followup_at IS NOT NULL`,
    `ri.next_followup_at != ''`,
    `r.category = 'توزيع عملاء'`,
    `r.status NOT IN ('Retention Done','إنتهت')`,
  ];
  const params = [];
  if (line)  { conditions.push('r.line = ?');        params.push(line);  }
  if (agent) { conditions.push('r.assigned_to = ?'); params.push(agent); }
  const rows = db.prepare(`
    SELECT ri.id, ri.next_followup_at, ri.agent_name, ri.created_at,
           r.id        AS remark_id,
           r.client_name, r.client_phone, r.status, r.assigned_to, r.line
    FROM remark_interactions ri
    JOIN remarks r ON r.id = ri.remark_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY ri.next_followup_at ASC
    LIMIT 500
  `).all(...params);
  return res.json(rows);
});

// GET /api/admin/pipeline/agents?line=  — list agents for filter dropdown
router.get('/pipeline/agents', (req, res) => {
  const line = effectiveLine(req);
  const lf   = line ? ` AND line = '${line.replace(/'/g,"''")}'` : '';
  const rows = db.prepare(
    `SELECT full_name FROM users WHERE role IN ('agent','enrollment') AND is_active = 1${lf} ORDER BY full_name COLLATE NOCASE`
  ).all();
  return res.json(rows.map(r => r.full_name));
});

// PUT /api/admin/pipeline/tasks/:id  — admin can move any card
router.put('/pipeline/tasks/:id', (req, res) => {
  const { id } = req.params;
  const { status, next_followup_at } = req.body;
  const line = effectiveLine(req);
  const lf   = line ? ` AND line = '${line.replace(/'/g,"''")}'` : '';

  const remark = db.prepare(`SELECT * FROM remarks WHERE id = ?${lf}`).get(id);
  if (!remark) return res.status(404).json({ error: 'Task not found' });

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

  const updated = db.prepare('SELECT * FROM remarks WHERE id = ?').get(id);
  return res.json({ ...updated, sla_status: getSlaStatus(updated.sla_deadline, updated.priority) });
});

// GET /api/admin/pipeline/transfer-targets — full list for admin (agents + leaders + enrollment)
router.get('/pipeline/transfer-targets', (req, res) => {
  const line = effectiveLine(req);
  const lf   = line ? ` AND line = '${line.replace(/'/g,"''")}'` : '';
  const rows = db.prepare(
    `SELECT full_name, role, department, line FROM users
     WHERE is_active = 1 AND role IN ('agent','leader','enrollment','enrollment_leader')${lf}
     ORDER BY
       CASE role WHEN 'leader' THEN 1 WHEN 'enrollment_leader' THEN 2 WHEN 'enrollment' THEN 3 ELSE 4 END,
       full_name COLLATE NOCASE`
  ).all();
  return res.json(rows);
});

// PUT /api/admin/pipeline/bulk-reassign  — reassign a list of remarks (admin) + log to client_transfers
router.put('/pipeline/bulk-reassign', (req, res) => {
  const { ids, assigned_to } = req.body;
  if (!Array.isArray(ids) || ids.length === 0 || !assigned_to) {
    return res.status(400).json({ error: 'ids[] and assigned_to are required' });
  }
  const line = effectiveLine(req);
  const lf   = line ? ` AND line = '${line.replace(/'/g,"''")}'` : '';
  const ph   = ids.map(() => '?').join(',');

  // Fetch original assignments for audit log
  const originals = db.prepare(
    `SELECT id, client_name, client_phone, assigned_to, line FROM remarks
     WHERE id IN (${ph})${lf} AND category = 'توزيع عملاء'`
  ).all(...ids);

  const updateStmt = db.prepare(
    `UPDATE remarks SET assigned_to = ?, last_updated = datetime('now','+2 hours') WHERE id = ?`
  );
  const logStmt = db.prepare(`
    INSERT INTO client_transfers
      (remark_id, client_name, client_phone, from_user, to_user, transferred_by, transfer_type, line)
    VALUES (?, ?, ?, ?, ?, ?, 'bulk', ?)
  `);

  db.transaction(() => {
    for (const r of originals) {
      updateStmt.run(assigned_to, r.id);
      logStmt.run(r.id, r.client_name, r.client_phone, r.assigned_to, assigned_to, req.user.full_name, r.line || '');
    }
  })();

  return res.json({ updated: originals.length });
});

// GET /api/admin/pipeline/transfer-history — full audit log for admins
router.get('/pipeline/transfer-history', (req, res) => {
  const { page = 1, limit = 50, from_user, to_user, by_user, date_from, date_to } = req.query;
  const conditions = [];
  const params     = [];

  if (from_user) { conditions.push('ct.from_user = ?');        params.push(from_user); }
  if (to_user)   { conditions.push('ct.to_user = ?');          params.push(to_user);   }
  if (by_user)   { conditions.push('ct.transferred_by = ?');   params.push(by_user);   }
  if (date_from) { conditions.push('ct.transferred_at >= ?');  params.push(date_from); }
  if (date_to)   { conditions.push('ct.transferred_at <= ?');  params.push(date_to + ' 23:59:59'); }

  const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const total  = db.prepare(`SELECT COUNT(*) as cnt FROM client_transfers ct ${where}`).get(...params).cnt;
  const data   = db.prepare(`
    SELECT ct.*, r.status AS current_status, r.category
    FROM client_transfers ct
    LEFT JOIN remarks r ON r.id = ct.remark_id
    ${where}
    ORDER BY ct.transferred_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  return res.json({ total, page: parseInt(page), data });
});

// GET /api/admin/pipeline/tasks/:id/logs  — admin: view any task's interaction logs
router.get('/pipeline/tasks/:id/logs', (req, res) => {
  const { id } = req.params;
  const line = effectiveLine(req);
  const lf   = line ? ` AND line = '${line.replace(/'/g,"''")}'` : '';
  const remark = db.prepare(`SELECT id FROM remarks WHERE id = ?${lf}`).get(id);
  if (!remark) return res.status(404).json({ error: 'Task not found' });
  const logs = db.prepare(
    'SELECT * FROM remark_interactions WHERE remark_id = ? ORDER BY created_at DESC'
  ).all(id);
  return res.json(logs);
});

// POST /api/admin/pipeline/tasks/:id/log  — admin: log interaction on any task
router.post('/pipeline/tasks/:id/log', (req, res) => {
  const { id } = req.params;
  const { interaction_type = 'call', outcome, notes, next_followup_at, status } = req.body;
  const line = effectiveLine(req);
  const lf   = line ? ` AND line = '${line.replace(/'/g,"''")}'` : '';

  const remark = db.prepare(`SELECT * FROM remarks WHERE id = ?${lf}`).get(id);
  if (!remark) return res.status(404).json({ error: 'Task not found' });

  const log = db.prepare(`
    INSERT INTO remark_interactions
      (remark_id, agent_name, interaction_type, outcome, notes, next_followup_at)
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

// DELETE /api/admin/pipeline/interactions/:id  — admin: delete any interaction log
router.delete('/pipeline/interactions/:id', (req, res) => {
  const { id } = req.params;
  const interaction = db.prepare('SELECT * FROM remark_interactions WHERE id = ?').get(id);
  if (!interaction) return res.status(404).json({ error: 'Interaction not found' });
  db.prepare('DELETE FROM remark_interactions WHERE id = ?').run(id);
  return res.json({ ok: true });
});

// GET /api/admin/backup/download  — admin only, downloads full SQLite DB file
router.get('/backup/download', (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/academy.db');
  try {
    saveNow();
    if (!fs.existsSync(DB_PATH)) {
      return res.status(404).json({ error: 'Database file not found' });
    }
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="academy-backup-${date}.db"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(DB_PATH).pipe(res);
  } catch (err) {
    console.error('[backup/download]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
