'use strict';
const express  = require('express');
const XLSX     = require('xlsx');
const db       = require('../config/database');
const { authenticate }  = require('../middleware/auth');
const { requireRole }   = require('../middleware/roles');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

const VALID_LINES  = ['Ahmed Hassan', 'Dardasha'];
const SLA_HOURS    = { 'عاجلة': 3, 'هامة': 24, 'عادية': 48 };

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Normalise any phone value coming from Excel (handles scientific notation). */
function normalisePhone(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  let s = typeof raw === 'number' ? Math.round(raw).toString() : String(raw);
  return s.replace(/[^0-9]/g, '');
}

/** Arabic timestamp matching the format used everywhere else in the system. */
function nowTs() {
  const d = new Date();
  const pad  = n => String(n).padStart(2, '0');
  const h    = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}, ${pad(h12)}:${pad(d.getMinutes())} ${ampm}`;
}

/** ISO deadline string offset from now by `hours`. */
function deadline(hours) {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

/**
 * Convert an Excel column-A cell to a display date string.
 * With cellDates:true, date cells arrive as JS Date objects.
 * Falls back to raw string for any non-date value.
 */
function parseExcelDate(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  if (raw instanceof Date) {
    const pad = n => String(n).padStart(2, '0');
    return `${pad(raw.getDate())}/${pad(raw.getMonth() + 1)}/${raw.getFullYear()}`;
  }
  return String(raw).trim();
}

/** Convert DD/MM/YYYY → YYYY-MM-DD for ISO storage (sortable for date range queries) */
function dmyToISO(dmy) {
  if (!dmy) return null;
  const parts = dmy.split('/');
  if (parts.length === 3 && parts[2].length === 4) {
    return `${parts[2]}-${String(parts[1]).padStart(2,'0')}-${String(parts[0]).padStart(2,'0')}`;
  }
  return null;
}

// ─── TASK TYPES ───────────────────────────────────────────────────────────────

// GET /api/distribution/task-types
router.get('/task-types', (_req, res) => {
  const rows = db.prepare(
    `SELECT * FROM distribution_task_types ORDER BY is_default DESC, name COLLATE NOCASE`
  ).all();
  return res.json(rows);
});

// POST /api/distribution/task-types
router.post('/task-types', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const r = db.prepare(
      `INSERT INTO distribution_task_types (name, is_default) VALUES (?, 0)`
    ).run(name);
    return res.status(201).json({ id: r.lastInsertRowid, name, is_default: 0 });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Task type already exists' });
    throw e;
  }
});

// DELETE /api/distribution/task-types/:id
router.delete('/task-types/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM distribution_task_types WHERE id = ?`).get(req.params.id);
  if (!row)           return res.status(404).json({ error: 'Not found' });
  if (row.is_default) return res.status(400).json({ error: 'Cannot delete the default task type' });
  db.prepare(`DELETE FROM distribution_task_types WHERE id = ?`).run(req.params.id);
  return res.json({ message: 'Deleted' });
});

// ─── SCAN DATES (new) ─────────────────────────────────────────────────────────

// POST /api/distribution/scan-dates
// Body: { file_base64 }
// Returns: { dates: ["date1", "date2", ...] } sorted unique list from column A
router.post('/scan-dates', (req, res) => {
  const { file_base64 } = req.body;
  if (!file_base64) return res.status(400).json({ error: 'file_base64 مطلوب' });

  try {
    const buffer = Buffer.from(file_base64, 'base64');
    const wb   = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const dateSet = new Set();
    for (let i = 1; i < rows.length; i++) {
      const date = parseExcelDate(rows[i][0]);
      if (date) dateSet.add(date);
    }

    // Sort DD/MM/YYYY ascending; fall back to locale compare
    const parseDMY = s => {
      const [d, m, y] = s.split('/');
      return new Date(+y, +m - 1, +d);
    };
    const dates = [...dateSet].sort((a, b) => {
      try { return parseDMY(a) - parseDMY(b); } catch { return a.localeCompare(b, 'ar'); }
    });

    return res.json({ dates });
  } catch (err) {
    console.error('[distribution/scan-dates]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── AGENTS WORKLOAD ──────────────────────────────────────────────────────────

// GET /api/distribution/agents?line=
router.get('/agents', (req, res) => {
  const { line } = req.query;
  const lf = line ? ` AND u.line = '${line.replace(/'/g, "''")}'` : '';
  const rl = line ? ` AND r.line = '${line.replace(/'/g, "''")}'` : '';

  const agents = db.prepare(`
    SELECT u.id, u.full_name, u.department, u.line,
           COUNT(active_di.id) AS open_tasks
    FROM users u
    LEFT JOIN (
      SELECT di.id, di.assigned_to
      FROM distribution_items di
      INNER JOIN distribution_sessions ds ON ds.id = di.session_id AND ds.status = 'confirmed'
      LEFT JOIN remarks r ON r.id = di.remark_id
      WHERE di.remark_id IS NULL
         OR LOWER(r.status) NOT IN ('إنتهت','closed','resolved','مغلق')
    ) active_di ON active_di.assigned_to = u.full_name
    WHERE u.role = 'agent' AND u.is_active = 1${lf}
    GROUP BY u.id
    ORDER BY open_tasks ASC, u.full_name COLLATE NOCASE
  `).all();

  return res.json(agents);
});

// ─── COORDINATOR STATS (new) ──────────────────────────────────────────────────

// GET /api/distribution/coordinator-stats?line=
// Returns per-coordinator breakdown from remarks WHERE category='توزيع عملاء'
router.get('/coordinator-stats', (req, res) => {
  const { line } = req.query;
  const lf = line ? ` AND line = '${line.replace(/'/g, "''")}'` : '';

  try {
    const rows = db.prepare(`
      SELECT
        assigned_to,
        COUNT(*) as total,
        SUM(CASE WHEN LOWER(status) NOT IN ('إنتهت','closed','resolved') THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN LOWER(status) IN ('إنتهت','closed','resolved') THEN 1 ELSE 0 END) as closed_count,
        SUM(CASE WHEN status = 'جديدة' THEN 1 ELSE 0 END) as new_count,
        SUM(CASE WHEN LOWER(status) NOT IN ('إنتهت','closed','resolved','جديدة') THEN 1 ELSE 0 END) as in_progress_count
      FROM remarks
      WHERE category = 'توزيع عملاء'${lf}
      GROUP BY assigned_to
      ORDER BY open_count DESC, assigned_to COLLATE NOCASE
    `).all();

    return res.json(rows);
  } catch (err) {
    console.error('[distribution/coordinator-stats]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── PREVIEW (upload + analyse) ───────────────────────────────────────────────

// POST /api/distribution/preview
// Body: { file_base64, filename, line, task_type, priority, dates? }
// If `dates` is a non-empty array, only clients whose date (col A) is in the array are included.
router.post('/preview', (req, res) => {
  const { file_base64, line, task_type = 'متابعة مشترك جديد', priority = 'عادية', dates, assignments } = req.body;

  if (!file_base64) return res.status(400).json({ error: 'لم يتم رفع ملف' });
  if (!line)        return res.status(400).json({ error: 'line مطلوب' });
  if (!VALID_LINES.includes(line)) return res.status(400).json({ error: 'line غير صالح' });

  try {
    // ── Parse Excel from base64 ───────────────────────────────────────────────
    const buffer = Buffer.from(file_base64, 'base64');
    const wb   = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Build optional date filter set
    const filterDates = Array.isArray(dates) && dates.length > 0 ? new Set(dates) : null;

    // Skip header (row 0) — columns: A=date, B=pages/line, C=name, D=phone
    const clients = [];
    for (let i = 1; i < rows.length; i++) {
      const row   = rows[i];
      const date  = parseExcelDate(row[0]);
      const pages = String(row[1] || '').trim();
      const name  = String(row[2] || '').trim();
      const phone = normalisePhone(row[3]);
      if (!name && !phone) continue;
      if (filterDates && !filterDates.has(date)) continue;
      clients.push({ date, pages, name, phone });
    }

    if (!clients.length) return res.status(400).json({ error: 'لم يتم العثور على عملاء في الملف' });

    // ── Sort clients by subscription date ascending (DD/MM/YYYY) ─────────────
    const parseDMYSort = dmy => {
      if (!dmy) return new Date(0);
      const [d, m, y] = dmy.split('/');
      return y ? new Date(+y, +m - 1, +d) : new Date(0);
    };
    clients.sort((a, b) => parseDMYSort(a.date) - parseDMYSort(b.date));

    // ── Detect duplicates: clients with an existing ACTIVE remark ─────────────
    const phoneList = [...new Set(clients.map(c => c.phone).filter(Boolean))];
    const existingActiveMap = {};
    if (phoneList.length > 0) {
      const ph = phoneList.map(() => '?').join(',');
      db.prepare(`
        SELECT client_phone, client_name, assigned_to, status, id
        FROM remarks
        WHERE client_phone IN (${ph})
          AND client_phone != ''
          AND LOWER(status) NOT IN ('إنتهت','closed','resolved')
        ORDER BY added_at DESC
      `).all(...phoneList).forEach(r => {
        if (!existingActiveMap[r.client_phone])
          existingActiveMap[r.client_phone] = r;
      });
    }

    // Split: fresh (will be distributed) vs duplicates (skipped)
    const duplicates  = [];
    const freshClients = [];
    for (const c of clients) {
      const ex = c.phone && existingActiveMap[c.phone];
      if (ex) {
        duplicates.push({
          name:                c.name,
          phone:               c.phone,
          date:                c.date,
          existing_assigned_to: ex.assigned_to,
          existing_status:      ex.status,
          existing_remark_id:   ex.id,
        });
      } else {
        freshClients.push(c);
      }
    }
    // Only distribute fresh clients
    const clients_to_distribute = freshClients;
    if (!clients_to_distribute.length && duplicates.length > 0) {
      return res.status(400).json({
        error: `جميع العملاء (${duplicates.length}) لديهم مهام نشطة بالفعل`,
        duplicates,
      });
    }

    // ── Build phone→coordinator map in ONE bulk query ─────────────────────────
    const allCoords = db.prepare(`
      SELECT
        REPLACE(REPLACE(REPLACE(c.phone,' ',''),'-',''),'+','') AS norm_phone,
        b.coordinators
      FROM clients c
      INNER JOIN batches b ON b.group_name = c.group_name
      WHERE b.status = 'نشطة'
        AND c.phone IS NOT NULL AND c.phone != ''
      ORDER BY b.start_date DESC
    `).all();

    const coordMap = {};
    for (const row of allCoords) {
      if (row.norm_phone && !coordMap[row.norm_phone]) {
        coordMap[row.norm_phone] = row.coordinators;
      }
    }

    // Build active-agent set for fast O(1) validation
    const activeAgents = db.prepare(
      `SELECT full_name FROM users WHERE role = 'agent' AND is_active = 1`
    ).all();
    const agentSet = new Set(activeAgents.map(a => a.full_name.trim().toLowerCase()));

    // ── Match each client in memory (O(1) per client) ─────────────────────────
    const matched   = [];
    const unmatched = [];

    for (const client of clients_to_distribute) {
      let assignedTo = null;
      if (client.phone) {
        const coordinator = coordMap[client.phone];
        if (coordinator && agentSet.has(coordinator.trim().toLowerCase())) {
          const agentObj = activeAgents.find(
            a => a.full_name.trim().toLowerCase() === coordinator.trim().toLowerCase()
          );
          if (agentObj) assignedTo = agentObj.full_name;
        }
      }
      if (assignedTo) {
        matched.push({ ...client, assigned_to: assignedTo, match_type: 'existing_coordinator' });
      } else {
        unmatched.push({ ...client, match_type: 'auto_distributed' });
      }
    }

    // ── Load-balanced distribution for unmatched ──────────────────────────────
    const safeL = line ? line.replace(/'/g, "''") : '';
    const ql = line ? ` AND r.line = '${safeL}'` : '';
    const wl = line ? ` AND line = '${safeL}'` : '';
    const ul = line ? ` AND u.line = '${safeL}'` : '';

    const agents = db.prepare(`
      SELECT u.full_name, u.department, u.line,
             COUNT(active_di.id) AS open_tasks
      FROM users u
      LEFT JOIN (
        SELECT di.id, di.assigned_to
        FROM distribution_items di
        INNER JOIN distribution_sessions ds ON ds.id = di.session_id AND ds.status = 'confirmed'
        LEFT JOIN remarks r ON r.id = di.remark_id
        WHERE di.remark_id IS NULL
           OR LOWER(r.status) NOT IN ('إنتهت','closed','resolved','مغلق')
      ) active_di ON active_di.assigned_to = u.full_name
      WHERE u.role = 'agent' AND u.is_active = 1${ul}
      GROUP BY u.full_name
      ORDER BY open_tasks ASC, u.full_name COLLATE NOCASE
    `).all();

    if (!agents.length)
      return res.status(400).json({ error: 'لا يوجد أجنتس نشطين لهذا الخط' });

    const workload = {};
    agents.forEach(a => { workload[a.full_name] = a.open_tasks; });

    const distributed = unmatched.map(client => {
      const minAgent = Object.entries(workload).sort(([,a],[,b]) => a - b)[0][0];
      workload[minAgent]++;
      return { ...client, assigned_to: minAgent, match_type: 'auto_distributed' };
    });

    // ── Apply manual assignments to unmatched clients ────────────────────────
    let finalDistributed = [...distributed];
    if (Array.isArray(assignments) && assignments.length > 0) {
      let idx = 0;
      for (const asgn of assignments) {
        const cnt = Math.min(parseInt(asgn.count) || 0, finalDistributed.length - idx);
        for (let i = 0; i < cnt && idx < finalDistributed.length; i++, idx++) {
          finalDistributed[idx].assigned_to = asgn.agent;
          finalDistributed[idx].match_type  = 'manual';
        }
      }
    }
    const allItems = [...matched, ...finalDistributed];
    const manualCount = allItems.filter(i => i.match_type === 'manual').length;

    // ── Persist pending session ───────────────────────────────────────────────
    // Compute date range from client dates (DD/MM/YYYY → sort as YYYYMMDD)
    const clientDates = allItems.map(i => i.date).filter(Boolean);
    const toSortable  = d => { const [dd,mm,yy] = (d||'').split('/'); return yy ? `${yy}${mm}${dd}` : ''; };
    const sorted      = clientDates.map(toSortable).filter(Boolean).sort();
    const sessionDateFrom = sorted.length ? clientDates.find(d => toSortable(d) === sorted[0])             : null;
    const sessionDateTo   = sorted.length ? clientDates.find(d => toSortable(d) === sorted[sorted.length-1]) : null;

    const sessionRow = db.prepare(`
      INSERT INTO distribution_sessions
        (line, total_clients, matched, distributed, status, task_type, priority, created_by, date_from, date_to)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(line, allItems.length, matched.length, finalDistributed.length,
           task_type, priority, req.user.id, sessionDateFrom, sessionDateTo);

    const sessionId = sessionRow.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO distribution_items
        (session_id, client_name, client_phone, client_line, client_date, match_type, assigned_to)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      allItems.forEach(item =>
        insertItem.run(sessionId, item.name, item.phone,
                       item.pages, item.date, item.match_type, item.assigned_to)
      );
    })();

    // Order by date ascending: convert DD/MM/YYYY → YYYYMMDD for correct sort
    const savedItems = db.prepare(`
      SELECT * FROM distribution_items WHERE session_id = ?
      ORDER BY
        CASE WHEN client_date IS NULL OR client_date = '' THEN '99999999' ELSE
          SUBSTR(client_date,7,4) || SUBSTR(client_date,4,2) || SUBSTR(client_date,1,2)
        END ASC,
        id ASC
    `).all(sessionId);

    // ── Build agent summary ───────────────────────────────────────────────────
    const summaryMap = {};
    agents.forEach(a => {
      summaryMap[a.full_name] = {
        full_name: a.full_name, department: a.department,
        current_tasks: a.open_tasks, new_clients: 0,
      };
    });
    savedItems.forEach(item => {
      if (!summaryMap[item.assigned_to]) {
        const ag  = db.prepare(`SELECT department FROM users WHERE full_name = ? LIMIT 1`).get(item.assigned_to);
        const cnt = db.prepare(
          `SELECT COUNT(*) as cnt FROM remarks WHERE assigned_to = ? AND LOWER(status) NOT IN ('إنتهت','closed','resolved')${wl}`
        ).get(item.assigned_to)?.cnt ?? 0;
        summaryMap[item.assigned_to] = {
          full_name: item.assigned_to, department: ag?.department ?? '',
          current_tasks: cnt, new_clients: 0,
        };
      }
      summaryMap[item.assigned_to].new_clients++;
    });

    return res.json({
      session_id:       sessionId,
      total:            allItems.length,
      matched:          matched.length,
      distributed:      distributed.length,
      duplicates_count: duplicates.length,
      duplicates:       duplicates,
      agent_summary:    Object.values(summaryMap).filter(a => a.new_clients > 0),
      items:            savedItems,
    });

  } catch (err) {
    console.error('[distribution/preview]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── OVERRIDE single item ─────────────────────────────────────────────────────

// PUT /api/distribution/sessions/:sid/items/:iid
router.put('/sessions/:sid/items/:iid', (req, res) => {
  const { sid, iid } = req.params;
  const assigned_to = (req.body.assigned_to || '').trim();
  if (!assigned_to) return res.status(400).json({ error: 'assigned_to مطلوب' });

  const session = db.prepare(`SELECT * FROM distribution_sessions WHERE id = ?`).get(sid);
  if (!session)                  return res.status(404).json({ error: 'الجلسة غير موجودة' });
  if (session.status !== 'pending')
    return res.status(400).json({ error: 'الجلسة مؤكدة أو ملغاة — لا يمكن التعديل' });

  const agent = db.prepare(
    `SELECT full_name FROM users WHERE full_name = ? AND role = 'agent' AND is_active = 1`
  ).get(assigned_to);
  if (!agent) return res.status(400).json({ error: 'الموظف غير موجود أو غير نشط' });

  db.prepare(
    `UPDATE distribution_items SET assigned_to = ? WHERE id = ? AND session_id = ?`
  ).run(assigned_to, iid, sid);

  return res.json({ message: 'تم التحديث', item_id: Number(iid), assigned_to });
});

// ─── CANCEL session ───────────────────────────────────────────────────────────

// DELETE /api/distribution/sessions/:sid
router.delete('/sessions/:sid', (req, res) => {
  const session = db.prepare(`SELECT * FROM distribution_sessions WHERE id = ?`).get(req.params.sid);
  if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة' });
  if (session.status !== 'pending')
    return res.status(400).json({ error: 'يمكن إلغاء الجلسات المعلقة فقط' });

  db.prepare(`UPDATE distribution_sessions SET status = 'cancelled' WHERE id = ?`).run(req.params.sid);
  return res.json({ message: 'تم إلغاء الجلسة' });
});

// DELETE /api/distribution/sessions/:sid/force  — hard-delete any session (admin)
router.delete('/sessions/:sid/force', (req, res) => {
  const session = db.prepare(`SELECT * FROM distribution_sessions WHERE id = ?`).get(req.params.sid);
  if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة' });

  db.transaction(() => {
    db.prepare(`DELETE FROM distribution_items    WHERE session_id = ?`).run(req.params.sid);
    db.prepare(`DELETE FROM distribution_sessions WHERE id = ?`).run(req.params.sid);
  })();

  return res.json({ message: 'تم حذف الجلسة نهائياً' });
});

// ─── CONFIRM session → create remarks ─────────────────────────────────────────

// POST /api/distribution/sessions/:sid/confirm
// Body (optional): { item_ids: [1,2,3] } — if provided, only distribute those items
router.post('/sessions/:sid/confirm', (req, res) => {
  const session = db.prepare(`SELECT * FROM distribution_sessions WHERE id = ?`).get(req.params.sid);
  if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة' });
  if (session.status !== 'pending')
    return res.status(400).json({ error: 'الجلسة مؤكدة أو ملغاة بالفعل' });

  // Support partial confirmation via item_ids filter
  const { item_ids } = req.body;
  let items;
  if (Array.isArray(item_ids) && item_ids.length > 0) {
    const ph = item_ids.map(() => '?').join(',');
    items = db.prepare(
      `SELECT * FROM distribution_items WHERE session_id = ? AND id IN (${ph})`
    ).all(req.params.sid, ...item_ids);
  } else {
    items = db.prepare(
      `SELECT * FROM distribution_items WHERE session_id = ?`
    ).all(req.params.sid);
  }
  if (!items.length) return res.status(400).json({ error: 'لا يوجد عملاء لتوزيعهم في هذا النطاق' });

  const ts          = nowTs();
  const slaDeadline = deadline(SLA_HOURS[session.priority] ?? 48);
  const byName      = req.user.full_name;

  const insertRemark = db.prepare(`
    INSERT INTO remarks
      (task_type, assigned_to, details, category, status,
       client_name, client_phone, priority, assigned_by,
       added_at, last_updated, sla_deadline, line, client_date, synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','+2 hours'))
  `);
  const updateItem = db.prepare(
    `UPDATE distribution_items SET remark_id = ? WHERE id = ?`
  );

  db.transaction(() => {
    for (const item of items) {
      const details = item.match_type === 'existing_coordinator'
        ? `توزيع عملاء — منسق موجود (${item.assigned_to})`
        : `توزيع عملاء — توزيع تلقائي`;

      const r = insertRemark.run(
        session.task_type,
        item.assigned_to,
        details,
        'توزيع عملاء',
        'جديدة',
        item.client_name,
        item.client_phone,
        session.priority,
        byName,
        ts, ts,
        slaDeadline,
        session.line,
        dmyToISO(item.client_date)   // YYYY-MM-DD from DD/MM/YYYY
      );
      updateItem.run(r.lastInsertRowid, item.id);
    }
    db.prepare(`
      UPDATE distribution_sessions
      SET status = 'confirmed', confirmed_by = ?, confirmed_at = datetime('now','+2 hours')
      WHERE id = ?
    `).run(req.user.id, req.params.sid);
  })();

  return res.json({ message: 'تم تأكيد التوزيع', remarks_created: items.length });
});

// ─── FORK (resume pending session with date filter) ──────────────────────────

// POST /api/distribution/sessions/:sid/fork
// Body: { date_from?: 'YYYY-MM-DD', date_to?: 'YYYY-MM-DD' }
// Creates a new pending session from a subset of an existing pending session's items.
router.post('/sessions/:sid/fork', (req, res) => {
  const source = db.prepare(`SELECT * FROM distribution_sessions WHERE id = ?`).get(req.params.sid);
  if (!source)                  return res.status(404).json({ error: 'الجلسة غير موجودة' });
  if (source.status !== 'pending')
    return res.status(400).json({ error: 'الاستكمال متاح للجلسات المعلقة فقط' });

  const { date_from, date_to, assignments } = req.body; // YYYY-MM-DD; assignments: [{agent,count}]

  // Filter items by date using SUBSTR trick (client_date is DD/MM/YYYY)
  const conditions = ['session_id = ?'];
  const params     = [req.params.sid];
  if (date_from) {
    conditions.push(`SUBSTR(client_date,7,4)||'-'||SUBSTR(client_date,4,2)||'-'||SUBSTR(client_date,1,2) >= ?`);
    params.push(date_from);
  }
  if (date_to) {
    conditions.push(`SUBSTR(client_date,7,4)||'-'||SUBSTR(client_date,4,2)||'-'||SUBSTR(client_date,1,2) <= ?`);
    params.push(date_to);
  }

  const sourceItems = db.prepare(`
    SELECT * FROM distribution_items
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE WHEN client_date IS NULL OR client_date = '' THEN '99999999' ELSE
        SUBSTR(client_date,7,4) || SUBSTR(client_date,4,2) || SUBSTR(client_date,1,2)
      END ASC, id ASC
  `).all(...params);

  if (!sourceItems.length)
    return res.status(400).json({ error: 'لا يوجد عملاء في هذا النطاق الزمني' });

  // Duplicate detection — skip clients with active remarks
  const phoneList = [...new Set(sourceItems.map(i => i.client_phone).filter(Boolean))];
  const existingActiveMap = {};
  if (phoneList.length > 0) {
    const ph = phoneList.map(() => '?').join(',');
    db.prepare(`
      SELECT client_phone, client_name, assigned_to, status, id
      FROM remarks
      WHERE client_phone IN (${ph})
        AND client_phone != ''
        AND LOWER(status) NOT IN ('إنتهت','closed','resolved')
      ORDER BY added_at DESC
    `).all(...phoneList).forEach(r => {
      if (!existingActiveMap[r.client_phone]) existingActiveMap[r.client_phone] = r;
    });
  }

  const duplicates  = [];
  const freshItems  = [];
  for (const item of sourceItems) {
    const ex = item.client_phone && existingActiveMap[item.client_phone];
    if (ex) {
      duplicates.push({
        name: item.client_name, phone: item.client_phone, date: item.client_date,
        existing_assigned_to: ex.assigned_to, existing_status: ex.status, existing_remark_id: ex.id,
      });
    } else {
      freshItems.push(item);
    }
  }

  if (!freshItems.length && duplicates.length > 0) {
    return res.status(400).json({
      error: `جميع العملاء (${duplicates.length}) لديهم مهام نشطة بالفعل`,
      duplicates,
    });
  }

  // ── Apply manual assignments if provided ────────────────────────────────────
  // assignments = [{agent: 'Name', count: N}, ...] — override assigned_to in order
  let finalItems = freshItems.map(i => ({ ...i }));
  if (Array.isArray(assignments) && assignments.length > 0) {
    let idx = 0;
    for (const asgn of assignments) {
      const cnt = Math.min(parseInt(asgn.count) || 0, finalItems.length - idx);
      for (let i = 0; i < cnt && idx < finalItems.length; i++, idx++) {
        finalItems[idx].assigned_to = asgn.agent;
        finalItems[idx].match_type  = 'manual';
      }
    }
    // remaining items (beyond specified counts) keep their original assigned_to
  }

  const matched     = finalItems.filter(i => i.match_type === 'existing_coordinator').length;
  const manual      = finalItems.filter(i => i.match_type === 'manual').length;
  const distributed = finalItems.length - matched - manual;

  // Create new session
  const newRow = db.prepare(`
    INSERT INTO distribution_sessions
      (line, total_clients, matched, distributed, status, task_type, priority, created_by)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(source.line, finalItems.length, matched, distributed + manual,
         source.task_type, source.priority, req.user.id);

  const newSid = newRow.lastInsertRowid;

  // Copy final items into new session
  const insertItem = db.prepare(`
    INSERT INTO distribution_items
      (session_id, client_name, client_phone, client_line, client_date, match_type, assigned_to)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    finalItems.forEach(item =>
      insertItem.run(newSid, item.client_name, item.client_phone,
                     item.client_line, item.client_date, item.match_type, item.assigned_to)
    );
  })();

  const savedItems = db.prepare(`
    SELECT * FROM distribution_items WHERE session_id = ?
    ORDER BY
      CASE WHEN client_date IS NULL OR client_date = '' THEN '99999999' ELSE
        SUBSTR(client_date,7,4) || SUBSTR(client_date,4,2) || SUBSTR(client_date,1,2)
      END ASC, id ASC
  `).all(newSid);

  // Agent summary
  const summaryMap = {};
  savedItems.forEach(item => {
    if (!summaryMap[item.assigned_to])
      summaryMap[item.assigned_to] = { full_name: item.assigned_to, new_clients: 0 };
    summaryMap[item.assigned_to].new_clients++;
  });

  return res.json({
    session_id:        newSid,
    source_session_id: parseInt(req.params.sid),
    total:             finalItems.length,
    matched,
    manual,
    distributed,
    duplicates_count:  duplicates.length,
    duplicates,
    agent_summary:     Object.values(summaryMap),
    items:             savedItems,
  });
});

// ─── HISTORY LIST ─────────────────────────────────────────────────────────────

// GET /api/distribution/sessions?line=&page=&limit=
router.get('/sessions', (req, res) => {
  const { line, page = 1, limit = 20 } = req.query;
  const lf     = line ? ` AND s.line = '${line.replace(/'/g,"''")}'` : '';
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const total = db.prepare(
    `SELECT COUNT(*) as cnt FROM distribution_sessions s WHERE 1=1${lf}`
  ).get().cnt;

  const sessions = db.prepare(`
    SELECT s.*,
           u1.full_name AS created_by_name,
           u2.full_name AS confirmed_by_name
    FROM distribution_sessions s
    LEFT JOIN users u1 ON u1.id = s.created_by
    LEFT JOIN users u2 ON u2.id = s.confirmed_by
    WHERE 1=1${lf}
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?
  `).all(parseInt(limit), offset);

  return res.json({ total, page: parseInt(page), sessions });
});

// GET /api/distribution/sessions/:sid  (detail + items)
router.get('/sessions/:sid', (req, res) => {
  const session = db.prepare(
    `SELECT s.*, u1.full_name AS created_by_name, u2.full_name AS confirmed_by_name
     FROM distribution_sessions s
     LEFT JOIN users u1 ON u1.id = s.created_by
     LEFT JOIN users u2 ON u2.id = s.confirmed_by
     WHERE s.id = ?`
  ).get(req.params.sid);
  if (!session) return res.status(404).json({ error: 'Not found' });

  // Sort items chronologically (DD/MM/YYYY → YYYYMMDD)
  const items = db.prepare(`
    SELECT * FROM distribution_items WHERE session_id = ?
    ORDER BY
      CASE WHEN client_date IS NULL OR client_date = '' THEN '99999999' ELSE
        SUBSTR(client_date,7,4) || SUBSTR(client_date,4,2) || SUBSTR(client_date,1,2)
      END ASC, id ASC
  `).all(req.params.sid);

  // Compute date range from items' client_date
  const dateRange = db.prepare(`
    SELECT
      MIN(SUBSTR(client_date,7,4)||'-'||SUBSTR(client_date,4,2)||'-'||SUBSTR(client_date,1,2)) AS date_from_iso,
      MAX(SUBSTR(client_date,7,4)||'-'||SUBSTR(client_date,4,2)||'-'||SUBSTR(client_date,1,2)) AS date_to_iso
    FROM distribution_items
    WHERE session_id = ? AND client_date IS NOT NULL AND LENGTH(client_date) = 10
  `).get(req.params.sid);

  // Convert ISO → DD/MM/YYYY for display
  const toDisplay = iso => {
    if (!iso) return null;
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  return res.json({
    ...session,
    items,
    date_from: toDisplay(dateRange?.date_from_iso),
    date_to:   toDisplay(dateRange?.date_to_iso),
  });
});

module.exports = router;
