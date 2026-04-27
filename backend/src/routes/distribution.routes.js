'use strict';
const express  = require('express');
const XLSX     = require('xlsx');
const db       = require('../config/database');
const { saveNow } = require('../config/database');
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

// ─── DEBUG / DIAGNOSTIC ───────────────────────────────────────────────────────

// GET /api/distribution/debug/state
// Returns raw counts so admin can see the true DB state even if UI filters hide things.
router.get('/debug/state', (_req, res) => {
  const sessionsByStatus = db.prepare(
    `SELECT status, COUNT(*) AS cnt FROM distribution_sessions GROUP BY status`
  ).all();

  const itemsCount = db.prepare(
    `SELECT COUNT(*) AS cnt FROM distribution_items`
  ).get()?.cnt ?? 0;

  const orphanedItems = db.prepare(`
    SELECT COUNT(*) AS cnt FROM distribution_items di
    WHERE NOT EXISTS (SELECT 1 FROM distribution_sessions ds WHERE ds.id = di.session_id)
  `).get()?.cnt ?? 0;

  const activeDistItems = db.prepare(`
    SELECT COUNT(*) AS cnt FROM distribution_items di
    INNER JOIN distribution_sessions ds ON ds.id = di.session_id AND ds.status = 'confirmed'
    WHERE LOWER(COALESCE(di.status,'جديدة')) NOT IN ('إنتهت','retention done')
  `).get()?.cnt ?? 0;

  const confirmedItems = db.prepare(`
    SELECT COUNT(*) AS cnt FROM distribution_items di
    INNER JOIN distribution_sessions ds ON ds.id = di.session_id AND ds.status = 'confirmed'
  `).get()?.cnt ?? 0;

  // Show up to 10 sample phones from confirmed active items
  const sampleDistributed = db.prepare(`
    SELECT di.client_phone, di.client_name, COALESCE(di.status,'جديدة') AS status, di.session_id, di.assigned_to
    FROM distribution_items di
    INNER JOIN distribution_sessions ds ON ds.id = di.session_id AND ds.status = 'confirmed'
    WHERE LOWER(COALESCE(di.status,'جديدة')) NOT IN ('إنتهت','retention done')
    LIMIT 10
  `).all();

  const itemsByStatus = db.prepare(`
    SELECT COALESCE(di.status,'جديدة') AS status, COUNT(*) AS cnt
    FROM distribution_items di
    INNER JOIN distribution_sessions ds ON ds.id = di.session_id AND ds.status = 'confirmed'
    GROUP BY COALESCE(di.status,'جديدة')
  `).all();

  return res.json({
    sessions_by_status:       sessionsByStatus,
    distribution_items_count: itemsCount,
    confirmed_items_count:    confirmedItems,
    active_dist_items:        activeDistItems,
    items_by_status:          itemsByStatus,
    orphaned_items_count:     orphanedItems,
    sample_active_items:      sampleDistributed,
  });
});

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
// Body: { file_base64, line? }
// Returns: { dates, stats } where stats is an array of per-date objects:
//   { date, total, distributed, remaining }
// "distributed" = clients whose phone has an active remark from a confirmed
//                 distribution session (same logic as the preview duplicate check).
router.post('/scan-dates', (req, res) => {
  const { file_base64, line } = req.body;
  if (!file_base64) return res.status(400).json({ error: 'file_base64 مطلوب' });

  try {
    const buffer = Buffer.from(file_base64, 'base64');
    const wb   = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Build per-date buckets (phone → first occurrence wins for dedup)
    const parseDMY = s => {
      const [d, m, y] = (s || '').split('/');
      return new Date(+y, +m - 1, +d);
    };

    const dateMap  = {};   // date → Set of unique phones
    const phoneSeen = new Set();

    for (let i = 1; i < rows.length; i++) {
      const date  = parseExcelDate(rows[i][0]);
      const phone = normalisePhone(rows[i][3]);
      const name  = String(rows[i][2] || '').trim();
      if (!date) continue;
      if (!name && !phone) continue;

      if (!dateMap[date]) dateMap[date] = new Set();

      // Only count each phone once (first occurrence in sheet)
      if (phone && phoneSeen.has(phone)) continue;
      if (phone) phoneSeen.add(phone);
      dateMap[date].add(phone || `__noPhone_${i}`);
    }

    // Sort dates ascending
    const sortedDates = Object.keys(dateMap).sort((a, b) => {
      try { return parseDMY(a) - parseDMY(b); } catch { return a.localeCompare(b, 'ar'); }
    });

    // Collect ALL unique phones from the file for a single bulk DB query
    const allPhones = [...phoneSeen].filter(Boolean);

    // Check which phones already have an active item in a confirmed distribution session
    const distributedPhones = new Set();
    if (allPhones.length > 0) {
      const ph     = allPhones.map(() => '?').join(',');
      const lf     = line && line !== 'All' ? ` AND ds.line = ?` : '';
      const params = line && line !== 'All' ? [...allPhones, line] : allPhones;
      db.prepare(`
        SELECT di.client_phone
        FROM distribution_items di
        INNER JOIN distribution_sessions ds ON ds.id = di.session_id AND ds.status = 'confirmed'
        WHERE di.client_phone IN (${ph})
          AND di.client_phone != ''
          AND LOWER(COALESCE(di.status,'جديدة')) NOT IN ('retention done','إنتهت')${lf}
      `).all(...params).forEach(r => distributedPhones.add(r.client_phone));
    }

    // Build per-date stats
    const stats = sortedDates.map(date => {
      const phones = [...dateMap[date]];
      const total       = phones.length;
      const distributed = phones.filter(p => distributedPhones.has(p)).length;
      const remaining   = total - distributed;
      return { date, total, distributed, remaining };
    });

    // Summary totals
    const totals = stats.reduce(
      (acc, s) => ({ total: acc.total + s.total, distributed: acc.distributed + s.distributed, remaining: acc.remaining + s.remaining }),
      { total: 0, distributed: 0, remaining: 0 }
    );

    return res.json({ dates: sortedDates, stats, totals });
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
      WHERE LOWER(COALESCE(di.status,'جديدة')) NOT IN ('retention done','إنتهت')
    ) active_di ON active_di.assigned_to = u.full_name
    WHERE u.role IN ('agent','enrollment') AND u.is_active = 1${lf}
    GROUP BY u.id
    ORDER BY open_tasks ASC, u.full_name COLLATE NOCASE
  `).all();

  return res.json(agents);
});

// ─── COORDINATOR STATS (new) ──────────────────────────────────────────────────

// GET /api/distribution/coordinator-stats?line=
// Returns per-coordinator breakdown from distribution_items (confirmed sessions only)
router.get('/coordinator-stats', (req, res) => {
  const { line } = req.query;
  const lf = line ? ` AND line = '${line.replace(/'/g, "''")}'` : '';

  try {
    const lf2 = line ? ` AND ds.line = '${line.replace(/'/g, "''")}'` : '';
    const rows = db.prepare(`
      SELECT
        di.assigned_to,
        COUNT(*) as total,
        SUM(CASE WHEN LOWER(COALESCE(di.status,'جديدة')) NOT IN ('retention done','إنتهت') THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN LOWER(COALESCE(di.status,'')) IN ('retention done','إنتهت') THEN 1 ELSE 0 END) as closed_count,
        SUM(CASE WHEN COALESCE(di.status,'جديدة') = 'جديدة' THEN 1 ELSE 0 END) as new_count,
        SUM(CASE WHEN LOWER(COALESCE(di.status,'')) NOT IN ('retention done','إنتهت','جديدة','') THEN 1 ELSE 0 END) as in_progress_count
      FROM distribution_items di
      INNER JOIN distribution_sessions ds ON ds.id = di.session_id AND ds.status = 'confirmed'
      WHERE 1=1${lf2}
      GROUP BY di.assigned_to
      ORDER BY open_count DESC, di.assigned_to COLLATE NOCASE
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

    // ── Parse ALL rows from Excel (keep Excel row order; tag each with inFilter) ──
    // We parse everything so we can fill gaps from overflow rows later.
    const allClients = [];
    for (let i = 1; i < rows.length; i++) {
      const row      = rows[i];
      const date     = parseExcelDate(row[0]);
      const pages    = String(row[1] || '').trim();
      const name     = String(row[2] || '').trim();
      const phone    = normalisePhone(row[3]);
      if (!name && !phone) continue;
      const inFilter = !filterDates || filterDates.has(date);
      allClients.push({ date, pages, name, phone, inFilter });
    }

    if (!allClients.length) return res.status(400).json({ error: 'لم يتم العثور على عملاء في الملف' });

    // ── Intra-file dedup (global — one pass over ALL rows in Excel order) ────────
    // Keep the first occurrence of each phone across the entire file.
    // Report duplicates that fell inside the selected filter (visible to user).
    const filePhoneSeen    = new Set();
    const intraFileDuplicates = [];
    const uniqueAll        = []; // all unique clients (in-filter + overflow), Excel order
    for (const c of allClients) {
      if (c.phone && filePhoneSeen.has(c.phone)) {
        if (c.inFilter) intraFileDuplicates.push({ name: c.name, phone: c.phone, date: c.date });
      } else {
        if (c.phone) filePhoneSeen.add(c.phone);
        uniqueAll.push(c);
      }
    }

    // ── Cross-session dedup: skip phones already in a CONFIRMED distribution ─────
    const phoneList = [...new Set(uniqueAll.map(c => c.phone).filter(Boolean))];
    const existingActiveMap = {};
    if (phoneList.length > 0) {
      const ph = phoneList.map(() => '?').join(',');
      db.prepare(`
        SELECT di.client_phone, di.client_name, di.assigned_to, di.status, di.id
        FROM distribution_items di
        INNER JOIN distribution_sessions ds ON ds.id = di.session_id AND ds.status = 'confirmed'
        WHERE di.client_phone IN (${ph})
          AND di.client_phone != ''
          AND LOWER(COALESCE(di.status,'جديدة')) NOT IN ('retention done','إنتهت')
        ORDER BY di.id DESC
      `).all(...phoneList).forEach(r => {
        if (!existingActiveMap[r.client_phone]) existingActiveMap[r.client_phone] = r;
      });
    }

    // Split unique clients into: cross-session duplicates / fresh-in-filter / fresh-overflow
    const duplicates      = [];   // cross-session, were inside filter → shown to user
    const freshInFilter   = [];   // fresh, inside date filter
    const freshOverflow   = [];   // fresh, outside date filter (fill-up pool)
    for (const c of uniqueAll) {
      const ex = c.phone && existingActiveMap[c.phone];
      if (ex) {
        if (c.inFilter) {
          duplicates.push({
            name:                 c.name,
            phone:                c.phone,
            date:                 c.date,
            existing_assigned_to: ex.assigned_to,
            existing_status:      ex.status,
            existing_remark_id:   ex.id,
          });
        }
        // overflow cross-session duplicates are silently skipped
      } else {
        if (c.inFilter) freshInFilter.push(c);
        else             freshOverflow.push(c);
      }
    }

    // ── Fill-up: if selected clients are fewer than the manual target, pull extras ──
    // When manual assignments are provided, we know the intended total count.
    // If filter + dedup gave fewer than that count, take the next fresh rows from the
    // overflow pool (the rows that came after the selected dates in the Excel file).
    const hasManual    = Array.isArray(assignments) && assignments.length > 0;
    const manualTarget = hasManual
      ? assignments.reduce((sum, a) => sum + (Math.max(0, parseInt(a.count) || 0)), 0)
      : 0;

    let clients_to_distribute;
    if (hasManual && freshInFilter.length < manualTarget && freshOverflow.length > 0) {
      const needed  = manualTarget - freshInFilter.length;
      const filler  = freshOverflow.slice(0, needed);
      clients_to_distribute = [...freshInFilter, ...filler];
      console.log(`[distribution/preview] fill-up: inFilter=${freshInFilter.length} target=${manualTarget} filling=${filler.length}`);
    } else if (filterDates) {
      clients_to_distribute = freshInFilter;   // respect filter, no fill-up
    } else {
      clients_to_distribute = [...freshInFilter, ...freshOverflow]; // no filter → all fresh
    }

    if (!clients_to_distribute.length) {
      if (duplicates.length > 0 || intraFileDuplicates.length > 0) {
        return res.status(400).json({
          error: `جميع العملاء (${duplicates.length + intraFileDuplicates.length}) مكررون أو لديهم مهام نشطة`,
          duplicates,
          intra_file_duplicates: intraFileDuplicates,
        });
      }
      return res.status(400).json({ error: 'لم يتم العثور على عملاء جدد للتوزيع' });
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
      `SELECT full_name FROM users WHERE role IN ('agent','enrollment') AND is_active = 1`
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
        WHERE LOWER(COALESCE(di.status,'جديدة')) NOT IN ('retention done','إنتهت')
      ) active_di ON active_di.assigned_to = u.full_name
      WHERE u.role IN ('agent','enrollment') AND u.is_active = 1${ul}
      GROUP BY u.full_name
      ORDER BY open_tasks ASC, u.full_name COLLATE NOCASE
    `).all();

    if (!agents.length)
      return res.status(400).json({ error: 'لا يوجد أجنتس نشطين لهذا الخط' });

    const workload = {};
    agents.forEach(a => { workload[a.full_name] = a.open_tasks; });

    // ── Apply manual assignments OR auto-distribute ───────────────────────────
    // If manual assignments provided: assign ONLY specified counts, leave rest unassigned.
    // If no manual assignments: auto-distribute all unmatched clients by workload.
    let finalDistributed = [];
    // hasManual is already defined above (used for fill-up logic)

    // When the user explicitly chose a set of agents (manual mode), restrict
    // "existing_coordinator" matches to ONLY those agents. Clients whose existing
    // coordinator is NOT in the chosen list are moved to the unmatched pool so they
    // can be redistributed among the chosen agents — preventing unwanted employees
    // from appearing in the distribution result.
    if (hasManual) {
      const chosenSet = new Set(
        assignments.map(a => (a.agent || '').trim().toLowerCase()).filter(Boolean)
      );
      const keptMatched = [];
      for (const m of matched) {
        if (chosenSet.has(m.assigned_to.trim().toLowerCase())) {
          keptMatched.push(m);
        } else {
          // Redirect to unmatched pool — will be distributed among chosen agents
          unmatched.push({ ...m, assigned_to: null, match_type: 'auto_distributed' });
        }
      }
      matched.length = 0;
      keptMatched.forEach(m => matched.push(m));
    }

    if (hasManual) {
      // Manual mode: each coordinator gets (requested - already_matched) new clients
      // so their total never exceeds the requested count
      const matchedPerAgent = {};
      matched.forEach(m => {
        matchedPerAgent[m.assigned_to] = (matchedPerAgent[m.assigned_to] || 0) + 1;
      });

      let idx = 0;
      for (const asgn of assignments) {
        const alreadyMatched = matchedPerAgent[asgn.agent] || 0;
        const needed = Math.max(0, (parseInt(asgn.count) || 0) - alreadyMatched);
        const cnt = Math.min(needed, unmatched.length - idx);
        for (let i = 0; i < cnt && idx < unmatched.length; i++, idx++) {
          finalDistributed.push({ ...unmatched[idx], assigned_to: asgn.agent, match_type: 'manual' });
        }
      }
      // Remaining unmatched clients are NOT distributed — left out of this session
    } else {
      // Auto mode: distribute all unmatched by workload balance
      finalDistributed = unmatched.map(client => {
        const minAgent = Object.entries(workload).sort(([,a],[,b]) => a - b)[0][0];
        workload[minAgent]++;
        return { ...client, assigned_to: minAgent, match_type: 'auto_distributed' };
      });
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

    // Preserve Excel sheet order: sort by insertion id (= original row order)
    const savedItems = db.prepare(`
      SELECT * FROM distribution_items WHERE session_id = ?
      ORDER BY id ASC
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
        const cnt = db.prepare(`
          SELECT COUNT(*) as cnt FROM distribution_items di
          INNER JOIN distribution_sessions ds ON ds.id = di.session_id AND ds.status = 'confirmed'
          WHERE di.assigned_to = ? AND LOWER(COALESCE(di.status,'جديدة')) NOT IN ('إنتهت','retention done')
        `).get(item.assigned_to)?.cnt ?? 0;
        summaryMap[item.assigned_to] = {
          full_name: item.assigned_to, department: ag?.department ?? '',
          current_tasks: cnt, new_clients: 0,
        };
      }
      summaryMap[item.assigned_to].new_clients++;
    });

    return res.json({
      session_id:       sessionId,
      total:                        allItems.length,
      matched:                      matched.length,
      distributed:                  finalDistributed.length,
      duplicates_count:             duplicates.length,
      duplicates:                   duplicates,
      intra_file_duplicates_count:  intraFileDuplicates.length,
      intra_file_duplicates:        intraFileDuplicates,
      agent_summary:                Object.values(summaryMap).filter(a => a.new_clients > 0),
      items:                        savedItems,
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
    `SELECT full_name FROM users WHERE full_name = ? AND role IN ('agent','enrollment') AND is_active = 1`
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
// Deletes all distribution_items and interactions linked to this session.
// Does NOT touch remarks — the distribution system is completely separate.
router.delete('/sessions/:sid/force', (req, res) => {
  const session = db.prepare(`SELECT * FROM distribution_sessions WHERE id = ?`).get(req.params.sid);
  if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة' });

  db.transaction(() => {
    // Delete interaction logs for all items in this session
    const itemIds = db.prepare(
      `SELECT id FROM distribution_items WHERE session_id = ?`
    ).all(req.params.sid).map(r => r.id);

    if (itemIds.length > 0) {
      const ph = itemIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM remark_interactions WHERE item_id IN (${ph})`).run(...itemIds);
      db.prepare(`DELETE FROM client_transfers      WHERE item_id IN (${ph})`).run(...itemIds);
    }

    db.prepare(`DELETE FROM distribution_items    WHERE session_id = ?`).run(req.params.sid);
    db.prepare(`DELETE FROM distribution_sessions WHERE id = ?`).run(req.params.sid);
  })();
  saveNow();

  return res.json({ message: 'تم حذف الجلسة نهائياً' });
});

// ─── CONFIRM session → create remarks ─────────────────────────────────────────

// POST /api/distribution/sessions/:sid/confirm
// Body (optional): { item_ids: [1,2,3] } — if provided, only confirm those items
router.post('/sessions/:sid/confirm', (req, res) => {
  const session = db.prepare(`SELECT * FROM distribution_sessions WHERE id = ?`).get(req.params.sid);
  if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة' });
  if (session.status !== 'pending')
    return res.status(400).json({ error: 'الجلسة مؤكدة أو ملغاة بالفعل' });

  const { item_ids } = req.body;
  let items;
  if (Array.isArray(item_ids) && item_ids.length > 0) {
    const ph = item_ids.map(() => '?').join(',');
    items = db.prepare(
      `SELECT * FROM distribution_items WHERE session_id = ? AND id IN (${ph})`
    ).all(req.params.sid, ...item_ids);
  } else {
    items = db.prepare(`SELECT * FROM distribution_items WHERE session_id = ?`).all(req.params.sid);
  }
  if (!items.length) return res.status(400).json({ error: 'لا يوجد عملاء لتوزيعهم في هذا النطاق' });

  // ── Duplicate guard: skip phones already active in another confirmed session ──
  const itemPhones = [...new Set(items.map(i => i.client_phone).filter(Boolean))];
  const dupePhones = new Set();
  if (itemPhones.length > 0) {
    const ph = itemPhones.map(() => '?').join(',');
    db.prepare(`
      SELECT di.client_phone
      FROM distribution_items di
      INNER JOIN distribution_sessions ds ON ds.id = di.session_id AND ds.status = 'confirmed'
      WHERE di.client_phone IN (${ph})
        AND di.client_phone != ''
        AND ds.id != ?
        AND LOWER(COALESCE(di.status,'جديدة')) NOT IN ('retention done','إنتهت')
    `).all(...itemPhones, parseInt(req.params.sid))
      .forEach(r => dupePhones.add(r.client_phone));
  }

  const ts = nowTs();
  let confirmed = 0;
  let duped     = 0;
  const seenPhones = new Set();

  db.transaction(() => {
    for (const item of items) {
      // Skip cross-session duplicates
      if (item.client_phone && dupePhones.has(item.client_phone)) { duped++; continue; }
      // Skip intra-session duplicates (same phone twice in Excel)
      if (item.client_phone && seenPhones.has(item.client_phone)) { duped++; continue; }
      if (item.client_phone) seenPhones.add(item.client_phone);

      // Set initial pipeline status on the item
      db.prepare(
        `UPDATE distribution_items SET status = 'جديدة', last_updated = ? WHERE id = ?`
      ).run(ts, item.id);
      confirmed++;
    }
    db.prepare(`
      UPDATE distribution_sessions
      SET status = 'confirmed', confirmed_by = ?, confirmed_at = datetime('now','localtime')
      WHERE id = ?
    `).run(req.user.id, req.params.sid);
  })();
  saveNow();

  return res.json({
    message:            'تم تأكيد التوزيع',
    items_confirmed:    confirmed,
    duplicates_skipped: duped,
    ...(duped > 0 && { warning: `تم تخطي ${duped} عميل موجودون بالفعل في توزيع نشط` }),
  });
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
    ORDER BY id ASC
  `).all(...params);

  if (!sourceItems.length)
    return res.status(400).json({ error: 'لا يوجد عملاء في هذا النطاق الزمني' });

  // Duplicate detection — skip clients already in a CONFIRMED distribution session
  // (same logic as /preview: external remarks are ignored)
  const phoneList = [...new Set(sourceItems.map(i => i.client_phone).filter(Boolean))];
  const existingActiveMap = {};
  if (phoneList.length > 0) {
    const ph = phoneList.map(() => '?').join(',');
    db.prepare(`
      SELECT di.client_phone, di.client_name, di.assigned_to, di.status, di.id
      FROM distribution_items di
      INNER JOIN distribution_sessions ds ON ds.id = di.session_id AND ds.status = 'confirmed'
      WHERE di.client_phone IN (${ph})
        AND di.client_phone != ''
        AND LOWER(COALESCE(di.status,'جديدة')) NOT IN ('retention done','إنتهت')
      ORDER BY di.id DESC
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
        existing_assigned_to: ex.assigned_to, existing_status: ex.status, existing_item_id: ex.id,
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
    // Restrict 'existing_coordinator' items to chosen agents only (same rule as /preview)
    const chosenSet = new Set(
      assignments.map(a => (a.agent || '').trim().toLowerCase()).filter(Boolean)
    );
    const redirected = [];
    const kept       = [];
    for (const item of finalItems) {
      if (
        item.match_type === 'existing_coordinator' &&
        !chosenSet.has((item.assigned_to || '').trim().toLowerCase())
      ) {
        redirected.push({ ...item, assigned_to: null, match_type: 'auto_distributed' });
      } else {
        kept.push(item);
      }
    }
    // Put redirected items at end so manual slots fill from the front first
    finalItems = [...kept, ...redirected];

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
    ORDER BY id ASC
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

// GET /api/distribution/last-distributed-date?line=
// Returns the client_date of the LAST item in the most recent CONFIRMED session.
// Used by the frontend to suggest a start date for the next distribution.
router.get('/last-distributed-date', (req, res) => {
  const { line } = req.query;
  const lf = line ? ` AND s.line = '${line.replace(/'/g, "''")}'` : '';
  try {
    // Get the last item (highest id) from the most recent confirmed session
    const row = db.prepare(`
      SELECT di.client_date, di.client_name, s.id AS session_id
      FROM distribution_items di
      INNER JOIN distribution_sessions s ON s.id = di.session_id
      WHERE s.status = 'confirmed'${lf}
        AND di.client_date IS NOT NULL AND di.client_date != ''
      ORDER BY s.id DESC, di.id DESC
      LIMIT 1
    `).get();

    if (!row) return res.json({ last_date: null, last_client: null, session_id: null });

    return res.json({
      last_date:   row.client_date,   // DD/MM/YYYY — last client date distributed
      last_client: row.client_name,
      session_id:  row.session_id,
    });
  } catch (err) {
    console.error('[distribution/last-distributed-date]', err);
    return res.status(500).json({ error: err.message });
  }
});

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

  // Preserve Excel sheet order (insertion order = original row order)
  const items = db.prepare(`
    SELECT * FROM distribution_items WHERE session_id = ?
    ORDER BY id ASC
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
