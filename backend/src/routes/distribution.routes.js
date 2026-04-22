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
  // Excel stores large numbers as floats → convert to integer string first
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

// ─── AGENTS WORKLOAD ──────────────────────────────────────────────────────────

// GET /api/distribution/agents?line=
router.get('/agents', (req, res) => {
  const { line } = req.query;
  const lf = line ? ` AND u.line = '${line.replace(/'/g, "''")}'` : '';
  const rl = line ? ` AND r.line = '${line.replace(/'/g, "''")}'` : '';

  const agents = db.prepare(`
    SELECT u.id, u.full_name, u.department, u.line,
           COUNT(r.id) AS open_tasks
    FROM users u
    LEFT JOIN remarks r
      ON r.assigned_to = u.full_name
      AND LOWER(r.status) NOT IN ('إنتهت','closed','resolved')${rl}
    WHERE u.role = 'agent' AND u.is_active = 1${lf}
    GROUP BY u.id
    ORDER BY open_tasks ASC, u.full_name COLLATE NOCASE
  `).all();

  return res.json(agents);
});

// ─── PREVIEW (upload + analyse) ───────────────────────────────────────────────

// POST /api/distribution/preview  (JSON: { file_base64, filename, line, task_type, priority })
router.post('/preview', (req, res) => {
  const { file_base64, line, task_type = 'متابعة مشترك جديد', priority = 'عادية' } = req.body;

  if (!file_base64) return res.status(400).json({ error: 'لم يتم رفع ملف' });
  if (!line)        return res.status(400).json({ error: 'line مطلوب' });
  if (!VALID_LINES.includes(line)) return res.status(400).json({ error: 'line غير صالح' });

  try {
    // ── Parse Excel from base64 ───────────────────────────────────────────────
    const buffer = Buffer.from(file_base64, 'base64');
    const wb   = XLSX.read(buffer, { type: 'buffer', raw: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    // raw:true gives us numeric values, cellText not needed
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Skip header (row 0) — columns: A=date, B=pages/line, C=name, D=phone
    const clients = [];
    for (let i = 1; i < rows.length; i++) {
      const row   = rows[i];
      const date  = String(row[0] || '').trim();
      const pages = String(row[1] || '').trim();
      const name  = String(row[2] || '').trim();
      const phone = normalisePhone(row[3]);
      if (!name && !phone) continue;
      clients.push({ date, pages, name, phone });
    }

    if (!clients.length) return res.status(400).json({ error: 'لم يتم العثور على عملاء في الملف' });

    // ── Build phone→coordinator map in ONE bulk query ─────────────────────────
    // Fetches all active-batch coordinators at once — no per-client SQL loop
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

    // coordMap: normalized_phone → coordinator name (first active batch wins)
    const coordMap = {};
    for (const row of allCoords) {
      if (row.norm_phone && !coordMap[row.norm_phone]) {
        coordMap[row.norm_phone] = row.coordinators;
      }
    }

    // Build active-agent set for fast O(1) validation
    const activeAgents = db.prepare(`
      SELECT full_name FROM users WHERE role = 'agent' AND is_active = 1
    `).all();
    const agentSet = new Set(activeAgents.map(a => a.full_name.trim().toLowerCase()));

    // ── Match each client in memory (O(1) per client) ──────────────────────
    const matched   = [];
    const unmatched = [];

    for (const client of clients) {
      let assignedTo = null;
      if (client.phone) {
        const coordinator = coordMap[client.phone];
        if (coordinator && agentSet.has(coordinator.trim().toLowerCase())) {
          // Find the exact-case name from activeAgents
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
    const ql = line ? ` AND r.line = '${line.replace(/'/g,"''")}'` : '';
    const ul = line ? ` AND u.line = '${line.replace(/'/g,"''")}'` : '';

    const agents = db.prepare(`
      SELECT u.full_name, u.department, u.line,
             COUNT(r.id) AS open_tasks
      FROM users u
      LEFT JOIN remarks r
        ON r.assigned_to = u.full_name
        AND LOWER(r.status) NOT IN ('إنتهت','closed','resolved')${ql}
      WHERE u.role = 'agent' AND u.is_active = 1${ul}
      GROUP BY u.full_name
      ORDER BY open_tasks ASC, u.full_name COLLATE NOCASE
    `).all();

    if (!agents.length)
      return res.status(400).json({ error: 'لا يوجد أجنتس نشطين لهذا الخط' });

    // workload map: name → current count (copy to mutate during distribution)
    const workload = {};
    agents.forEach(a => { workload[a.full_name] = a.open_tasks; });

    const distributed = unmatched.map(client => {
      // Pick agent with smallest current workload
      const minAgent = Object.entries(workload).sort(([,a],[,b]) => a - b)[0][0];
      workload[minAgent]++;
      return { ...client, assigned_to: minAgent, match_type: 'auto_distributed' };
    });

    const allItems = [...matched, ...distributed];

    // ── Persist pending session ───────────────────────────────────────────────
    const sessionRow = db.prepare(`
      INSERT INTO distribution_sessions
        (line, total_clients, matched, distributed, status, task_type, priority, created_by)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(line, allItems.length, matched.length, distributed.length,
           task_type, priority, req.user.id);

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

    // Fetch back with real IDs
    const savedItems = db.prepare(
      `SELECT * FROM distribution_items WHERE session_id = ? ORDER BY id`
    ).all(sessionId);

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
          `SELECT COUNT(*) as cnt FROM remarks WHERE assigned_to = ? AND LOWER(status) NOT IN ('إنتهت','closed','resolved')${ql}`
        ).get(item.assigned_to)?.cnt ?? 0;
        summaryMap[item.assigned_to] = {
          full_name: item.assigned_to, department: ag?.department ?? '',
          current_tasks: cnt, new_clients: 0,
        };
      }
      summaryMap[item.assigned_to].new_clients++;
    });

    return res.json({
      session_id:    sessionId,
      total:         allItems.length,
      matched:       matched.length,
      distributed:   distributed.length,
      agent_summary: Object.values(summaryMap).filter(a => a.new_clients > 0),
      items:         savedItems,
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

// ─── CONFIRM session → create remarks ─────────────────────────────────────────

// POST /api/distribution/sessions/:sid/confirm
router.post('/sessions/:sid/confirm', (req, res) => {
  const session = db.prepare(`SELECT * FROM distribution_sessions WHERE id = ?`).get(req.params.sid);
  if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة' });
  if (session.status !== 'pending')
    return res.status(400).json({ error: 'الجلسة مؤكدة أو ملغاة بالفعل' });

  const items = db.prepare(
    `SELECT * FROM distribution_items WHERE session_id = ?`
  ).all(req.params.sid);

  const ts          = nowTs();
  const slaDeadline = deadline(SLA_HOURS[session.priority] ?? 48);
  const byName      = req.user.full_name;

  const insertRemark = db.prepare(`
    INSERT INTO remarks
      (task_type, assigned_to, details, category, status,
       client_name, client_phone, priority, assigned_by,
       added_at, last_updated, sla_deadline, line, synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','+2 hours'))
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
        session.line
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

  const items = db.prepare(
    `SELECT * FROM distribution_items WHERE session_id = ? ORDER BY id`
  ).all(req.params.sid);

  return res.json({ ...session, items });
});

module.exports = router;
