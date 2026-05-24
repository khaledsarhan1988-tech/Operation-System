'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

/**
 * Lecture Reschedules — audit trail for lectures moved between dates.
 *
 *   GET    /api/reschedules                  — list (filterable)
 *   PATCH  /api/reschedules/:id/approve      — super-admin only
 *   PATCH  /api/reschedules/:id/reject       — super-admin only
 *   PATCH  /api/reschedules/:id/notes        — super-admin only
 *
 * Filters on GET:
 *   ?status=pending|approved|rejected|auto|all   (default 'all')
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD               (old_date in range)
 *   ?trainer=...                                  (old_trainer or new_trainer)
 *   ?group=...                                    (group_name LIKE)
 *   ?line=Ahmed Hassan|Dardasha
 *   ?session_type=main|side
 *
 * Returns hydrated rows with names of approver + holiday (if applicable).
 */

function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'admin' || req.user?.management !== 'All') {
    return res.status(403).json({ error: 'صلاحية للمدير العام فقط' });
  }
  next();
}

// GET /api/reschedules
router.get('/', (req, res) => {
  const { status = 'all', from, to, trainer, group, line, session_type } = req.query;
  const wheres = [];
  const params = [];
  if (status && status !== 'all') {
    wheres.push('r.approval_status = ?');
    params.push(status);
  }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    wheres.push('r.old_date >= ?'); params.push(from);
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    wheres.push('r.old_date <= ?'); params.push(to);
  }
  if (trainer) {
    wheres.push('(LOWER(TRIM(r.old_trainer)) LIKE ? OR LOWER(TRIM(r.new_trainer)) LIKE ?)');
    const t = `%${String(trainer).toLowerCase().trim()}%`;
    params.push(t, t);
  }
  if (group) {
    wheres.push('r.group_name LIKE ?');
    params.push(`%${group}%`);
  }
  if (line) {
    wheres.push('r.line = ?'); params.push(line);
  }
  if (session_type === 'main' || session_type === 'side') {
    wheres.push('r.session_type = ?'); params.push(session_type);
  }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

  try {
    const rows = db.prepare(`
      SELECT
        r.*,
        u.full_name AS approved_by_name,
        h.name      AS holiday_name,
        h.start_date AS holiday_start,
        h.end_date   AS holiday_end
      FROM lecture_reschedules r
      LEFT JOIN users u            ON u.id = r.approved_by
      LEFT JOIN official_holidays h ON h.id = r.holiday_id
      ${where}
      ORDER BY r.detected_at DESC, r.id DESC
      LIMIT 1000
    `).all(...params);

    // Counts per status (so the UI tabs can show badges without an extra call)
    const counts = db.prepare(`
      SELECT approval_status, COUNT(*) AS cnt
        FROM lecture_reschedules
       GROUP BY approval_status
    `).all().reduce((acc, r) => { acc[r.approval_status] = r.cnt; return acc; }, {});

    return res.json({ rows, counts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reschedules/:id/approve
router.patch('/:id/approve', requireSuperAdmin, express.json(), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    const r = db.prepare(`
      UPDATE lecture_reschedules
         SET approval_status = 'approved',
             approved_by     = ?,
             approved_at     = datetime('now', '+2 hours'),
             rejection_reason = NULL
       WHERE id = ?
    `).run(req.user?.id || null, id);
    if (r.changes === 0) return res.status(404).json({ error: 'not found' });
    const row = db.prepare(`SELECT * FROM lecture_reschedules WHERE id = ?`).get(id);
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reschedules/:id/reject  body: { reason? }
router.patch('/:id/reject', requireSuperAdmin, express.json(), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const reason = (req.body?.reason || '').trim() || null;
  try {
    const r = db.prepare(`
      UPDATE lecture_reschedules
         SET approval_status  = 'rejected',
             approved_by      = ?,
             approved_at      = datetime('now', '+2 hours'),
             rejection_reason = ?
       WHERE id = ?
    `).run(req.user?.id || null, reason, id);
    if (r.changes === 0) return res.status(404).json({ error: 'not found' });
    const row = db.prepare(`SELECT * FROM lecture_reschedules WHERE id = ?`).get(id);
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reschedules/:id/notes  body: { notes }
router.patch('/:id/notes', requireSuperAdmin, express.json(), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const notes = (req.body?.notes || '').trim() || null;
  try {
    const r = db.prepare(
      `UPDATE lecture_reschedules SET admin_notes = ? WHERE id = ?`
    ).run(notes, id);
    if (r.changes === 0) return res.status(404).json({ error: 'not found' });
    const row = db.prepare(`SELECT * FROM lecture_reschedules WHERE id = ?`).get(id);
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reschedules/diagnostic ─────────────────────────────────────────
// Returns a snapshot of the data that helps answer "are there any
// reschedules in the past?". The reschedule-detection feature was only
// added today, so anything that happened before its deploy can't be
// detected automatically. This endpoint surfaces:
//
//   syncs:    excel_syncs in the requested window — proves whether new
//             uploads happened that COULD trigger detection.
//   counts:   how many lecture_reschedules rows exist (per status).
//   suspects: heuristic — lectures whose date doesn't fall on any of the
//             batch's planned training_schedule weekdays. These are
//             "anomalies" — likely reschedules, but we can't know the
//             original date without historical snapshots.
//
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&line=  (defaults: last 30 days, all lines)
router.get('/diagnostic', requireSuperAdmin, (req, res) => {
  // Default window: last 30 days
  const today = new Date(Date.now() + 2 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const thirty = new Date(Date.now() - 30 * 86400000 + 2 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : thirty;
  const to   = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to   || '') ? req.query.to   : today;
  const line = (req.query.line || '').trim();

  try {
    // Syncs in window
    const syncWhere = ['file_type IN (?, ?)', 'status = ?', "DATE(created_at) BETWEEN ? AND ?"];
    const syncParams = ['lectures', 'side_sessions', 'success', from, to];
    if (line) { syncWhere.push('line = ?'); syncParams.push(line); }
    const syncs = db.prepare(`
      SELECT file_type, line, rows_imported, created_at
        FROM excel_syncs
       WHERE ${syncWhere.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT 50
    `).all(...syncParams);

    // Reschedule row counts
    const counts = db.prepare(`
      SELECT approval_status AS status, COUNT(*) AS cnt
        FROM lecture_reschedules
       GROUP BY approval_status
    `).all().reduce((acc, r) => { acc[r.status] = r.cnt; return acc; }, {});
    const totalReschedules = Object.values(counts).reduce((s, n) => s + n, 0);

    // Heuristic suspects — lectures whose date weekday isn't in the batch's
    // training_schedule. Schedule format examples seen in this DB:
    //   "Sat, Mon", "Sun,Wed", "Saturday,Tuesday", etc.
    // We tolerate both 3-letter and full names by lowercasing + prefix-match.
    const DOW = ['sun','mon','tue','wed','thu','fri','sat']; // index 0..6
    const lectures = db.prepare(`
      SELECT l.id, l.group_name, l.date, l.time, l.trainer, l.session_type, l.line,
             b.training_schedule
        FROM lectures l
        INNER JOIN batches b ON b.group_name = l.group_name AND b.line = l.line
       WHERE l.date BETWEEN ? AND ?
         ${line ? 'AND l.line = ?' : ''}
    `).all(from, to, ...(line ? [line] : []));

    const suspects = [];
    for (const l of lectures) {
      const sched = String(l.training_schedule || '')
        .toLowerCase()
        .split(/[,،;]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => s.slice(0, 3));        // normalize to 3-letter
      if (sched.length === 0) continue;   // no schedule on file → can't judge
      const dow = DOW[new Date(l.date + 'T12:00:00').getDay()];
      if (!sched.includes(dow)) {
        suspects.push({
          id: l.id,
          group_name: l.group_name,
          line: l.line,
          session_type: l.session_type,
          date: l.date,
          weekday: dow,
          time: l.time,
          trainer: l.trainer,
          expected_days: sched.join(','),
        });
      }
    }

    // Group suspects per batch for easier reading
    const suspectsByBatch = {};
    for (const s of suspects) {
      const key = `${s.group_name}|${s.line}`;
      if (!suspectsByBatch[key]) {
        suspectsByBatch[key] = {
          group_name: s.group_name,
          line: s.line,
          expected_days: s.expected_days,
          lectures: [],
        };
      }
      suspectsByBatch[key].lectures.push({
        date: s.date,
        weekday: s.weekday,
        time: s.time,
        trainer: s.trainer,
        session_type: s.session_type,
      });
    }

    return res.json({
      window: { from, to, line: line || 'all' },
      syncs: {
        count: syncs.length,
        latest: syncs[0]?.created_at || null,
        rows: syncs,
      },
      reschedules: {
        total: totalReschedules,
        by_status: counts,
        explanation: totalReschedules === 0
          ? 'لا توجد reschedules مكتشفة. الـ feature اتفعّل النهارده، ولن يكتشف إلا الـ reschedules اللى تحصل في sync جديد من دلوقت.'
          : `${totalReschedules} reschedule مكتشف`,
      },
      suspects: {
        count: suspects.length,
        batches_affected: Object.keys(suspectsByBatch).length,
        per_batch: Object.values(suspectsByBatch).slice(0, 50),   // cap for response size
        explanation: 'محاضرات تاريخها لا يقع في أيام الـ training_schedule المعتمد للمجموعة — مؤشّر قوي على إن المحاضرة اتـ rescheduled لكن مفيش طريقة نعرف التاريخ الأصلي.',
      },
    });
  } catch (err) {
    console.error('[reschedules/diagnostic]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/reschedules/backfill ──────────────────────────────────────────
// Takes the heuristic "suspects" from /diagnostic and writes them into the
// lecture_reschedules table as `pending` rows with reason='anomaly_detected'.
// The old_date is recorded as NULL (unknown — we don't have history), and
// new_date is the suspect lecture's actual date. The admin can review and
// approve/reject just like normal reschedules.
//
// Idempotent: skips rows where (group_name, line, new_date, new_time,
// session_type) already exists in lecture_reschedules.
router.post('/backfill', requireSuperAdmin, express.json(), (req, res) => {
  const today = new Date(Date.now() + 2 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const thirty = new Date(Date.now() - 30 * 86400000 + 2 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.from || '') ? req.body.from : thirty;
  const to   = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.to   || '') ? req.body.to   : today;

  try {
    const DOW = ['sun','mon','tue','wed','thu','fri','sat'];
    const lectures = db.prepare(`
      SELECT l.group_name, l.date, l.time, l.duration, l.trainer,
             l.session_type, l.line, b.training_schedule
        FROM lectures l
        INNER JOIN batches b ON b.group_name = l.group_name AND b.line = l.line
       WHERE l.date BETWEEN ? AND ?
    `).all(from, to);

    const checkDup = db.prepare(`
      SELECT id FROM lecture_reschedules
       WHERE group_name = ? AND line = ? AND session_type = ?
         AND new_date = ? AND IFNULL(new_time,'') = IFNULL(?, '')
       LIMIT 1
    `);
    const insertResched = db.prepare(`
      INSERT INTO lecture_reschedules
        (group_name, line, session_type,
         old_date, old_time, old_trainer, old_duration,
         new_date, new_time, new_trainer, new_duration,
         reschedule_reason, approval_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    let skipped  = 0;
    for (const l of lectures) {
      const sched = String(l.training_schedule || '')
        .toLowerCase()
        .split(/[,،;]+/)
        .map(s => s.trim().slice(0, 3))
        .filter(Boolean);
      if (sched.length === 0) continue;
      const dow = DOW[new Date(l.date + 'T12:00:00').getDay()];
      if (sched.includes(dow)) continue;

      // Dedup against existing reschedules
      if (checkDup.get(l.group_name, l.line, l.session_type, l.date, l.time || null)) {
        skipped++;
        continue;
      }

      // Insert as pending anomaly. old_date = NULL signals "unknown
      // original date" (frontend should show "—" / "غير معروف").
      insertResched.run(
        l.group_name, l.line, l.session_type,
        l.date,  // we DON'T know the original date, so use current as placeholder
        l.time, l.trainer, l.duration,
        l.date, l.time, l.trainer, l.duration,
        'anomaly_detected', 'pending',
      );
      inserted++;
    }

    return res.json({
      ok: true,
      window: { from, to },
      inserted,
      skipped,
      message: inserted === 0
        ? 'مفيش anomalies جديدة. كل المحاضرات في الفترة دي ضمن أيام الـ training_schedule المعتمد.'
        : `${inserted} انومالي اتزرعت كـ pending — راجعها في تاب "في الانتظار".`,
    });
  } catch (err) {
    console.error('[reschedules/backfill]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/reschedules/backfill-from-drive ───────────────────────────────
// TRUE historical reschedule detection — reads the Excel files DIRECTLY from
// Google Drive for every day in the requested window. For each consecutive
// pair of days (D and D+1), parses both lectures Excel snapshots and finds
// any (group + trainer + session_type) tuple whose date/time CHANGED between
// the two snapshots. Each such change = an authentic reschedule with REAL
// old_date and new_date (recovered from the historical files themselves).
//
// This is the proper backfill: we don't need to guess from weekday patterns.
// The Excel files dated 17/5 contain the lecture for 16/5 AS THE COORDINATOR
// SAW IT on 17/5 — so comparing 16/5's file vs 17/5's file shows exactly
// what changed in those 24 hours.
//
// Body:  { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', line?: 'Ahmed Hassan|Dardasha' }
// (defaults: from = 16/5/current-year, to = today, line = run for both lines)
//
// Safe to re-run — duplicates are skipped via the dedup check (same group,
// line, session_type, old_date, new_date already exists).
router.post('/backfill-from-drive', requireSuperAdmin, express.json(), async (req, res) => {
  const today = new Date(Date.now() + 2 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.from || '') ? req.body.from : `${new Date().getUTCFullYear()}-05-16`;
  const to   = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.to   || '') ? req.body.to   : today;
  const requestedLines = req.body?.line
    ? [req.body.line]
    : ['Ahmed Hassan', 'Dardasha'];

  if (from > to) return res.status(400).json({ error: 'from > to' });

  const drive = require('../services/googleDrive.service');
  const excel = require('../services/excel.service');

  // Helper: enumerate every YYYY-MM-DD in the inclusive range
  function eachDate(fromStr, toStr) {
    const out = [];
    const d = new Date(fromStr + 'T12:00:00Z');
    const end = new Date(toStr + 'T12:00:00Z');
    while (d <= end) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }

  // Helper: fetch + parse the day's Excel for a fileType. Returns rows array
  // (possibly empty) or NULL if no file exists for that day.
  async function fetchAndParse(line, dateStr, fileType) {
    try {
      const dateObj = new Date(dateStr + 'T12:00:00Z');
      const folderId = await drive.getOrCreateDatePath(line, dateObj, fileType, {
        createIfMissing: false,
      });
      if (!folderId) return null;
      const fileInfo = await drive.getLatestFileInFolder(folderId);
      if (!fileInfo) return null;
      const buffer = await drive.downloadFile(fileInfo.id);
      const rows = fileType === 'lectures'
        ? excel.parseLectures(buffer)
        : excel.parseSideSessions(buffer);
      return rows.map(r => ({ ...r, line }));
    } catch (e) {
      // Folder missing / file unreadable / parse error — log + continue
      console.warn(`[backfill] ${line} ${dateStr} ${fileType}: ${e.message}`);
      return null;
    }
  }

  // Helper: stable identifier (same as live detection — group + trainer +
  // session_type + line). Slot identifier adds date+time.
  function stableKey(r) {
    return [
      String(r.group_name   || '').trim().toLowerCase(),
      String(r.trainer      || '').trim().toLowerCase(),
      String(r.session_type || '').trim().toLowerCase(),
      String(r.line         || '').trim().toLowerCase(),
    ].join('|');
  }
  function slotKey(r) {
    return [
      r.date, r.time,
      String(r.group_name   || '').trim().toLowerCase(),
      String(r.trainer      || '').trim().toLowerCase(),
      String(r.session_type || '').trim().toLowerCase(),
      String(r.line         || '').trim().toLowerCase(),
    ].join('|');
  }
  // Same-day, sub-30-min time differences are NOT reschedules — they're
  // Excel time-formatting jitter. Filter them out before INSERT.
  const SAME_SLOT_TIME_TOLERANCE_MIN = 30;
  function timeToMins(t) {
    if (!t) return null;
    const m = String(t).match(/^(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  }
  function isMinorTimeDrift(a, b) {
    if (!a || !b || a.date !== b.date) return false;
    const ma = timeToMins(a.time);
    const mb = timeToMins(b.time);
    if (ma == null || mb == null) return false;
    return Math.abs(ma - mb) < SAME_SLOT_TIME_TOLERANCE_MIN;
  }

  // Pre-load holidays so we can flag holiday-shifted rows.
  let holidays = [];
  try {
    holidays = db.prepare(`SELECT id, start_date, end_date FROM official_holidays`).all();
  } catch (_) { /* defensive */ }
  function holidayFor(date) {
    for (const h of holidays) {
      if (date >= h.start_date && date <= h.end_date) return h;
    }
    return null;
  }

  const checkDup = db.prepare(`
    SELECT id FROM lecture_reschedules
     WHERE group_name = ? AND line = ? AND session_type = ?
       AND old_date = ? AND IFNULL(old_time,'') = IFNULL(?, '')
       AND new_date = ? AND IFNULL(new_time,'') = IFNULL(?, '')
     LIMIT 1
  `);
  const insertResched = db.prepare(`
    INSERT INTO lecture_reschedules
      (group_name, line, session_type,
       old_date, old_time, old_trainer, old_duration,
       new_date, new_time, new_trainer, new_duration,
       reschedule_reason, holiday_id, approval_status,
       admin_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Detect reschedules between two parsed-rows arrays for ONE specific
  // target date. We only compare slots whose date == targetDate (the day
  // we're "looking at" in both snapshots). Returns array of pairs.
  function diffForTargetDate(beforeRows, afterRows, targetDate) {
    const beforeForDate = beforeRows.filter(r => r.date === targetDate);
    const afterForDate  = afterRows;   // anything that could be the new date

    const beforeBySlot = new Map();
    beforeForDate.forEach(r => beforeBySlot.set(slotKey(r), r));
    const afterBySlot = new Set(afterRows.map(slotKey));

    // Cancellations: slots that were on targetDate before but NOT in after.
    const cancelled = [];
    for (const [k, row] of beforeBySlot) {
      if (!afterBySlot.has(k)) cancelled.push(row);
    }
    if (cancelled.length === 0) return [];

    // Additions: any row in after whose stable key matches one of the
    // cancelled rows AND whose date/time differs from before.
    const beforeStableKeys = new Set(beforeForDate.map(stableKey));
    const additions = afterRows.filter(r =>
      beforeStableKeys.has(stableKey(r)) && !beforeBySlot.has(slotKey(r))
    );

    // Pair: greedy match by stable key, pick closest date.
    const additionsByKey = new Map();
    for (const r of additions) {
      const k = stableKey(r);
      if (!additionsByKey.has(k)) additionsByKey.set(k, []);
      additionsByKey.get(k).push(r);
    }
    const pairs = [];
    for (const oldRow of cancelled) {
      const candidates = additionsByKey.get(stableKey(oldRow)) || [];
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => {
        const da = Math.abs(new Date(a.date) - new Date(oldRow.date));
        const db_ = Math.abs(new Date(b.date) - new Date(oldRow.date));
        return da - db_;
      });
      const newRow = candidates.shift();
      // Skip false-positive pairs: same date + tiny time drift = Excel jitter
      if (isMinorTimeDrift(oldRow, newRow)) continue;
      // Skip "backward" pairs (new is BEFORE old) — these are compensation
      // lectures or the student taking the lecture earlier than planned, not
      // a disruptive reschedule.
      if (newRow.date < oldRow.date) continue;
      pairs.push({ old: oldRow, new: newRow });
    }
    return pairs;
  }

  // ── Main loop ────────────────────────────────────────────────────────────
  const dates = eachDate(from, to);
  const summary = {
    days_scanned: dates.length,
    days_with_data: 0,
    days_with_pairs: 0,
    inserted: 0,
    skipped_existing: 0,
    by_line: {},
    by_session_type: { main: 0, side: 0 },
  };
  const log = [];

  for (const line of requestedLines) {
    summary.by_line[line] = { days_with_data: 0, inserted: 0 };

    for (const sessionType of ['lectures', 'side_sessions']) {
      const sessionLabel = sessionType === 'lectures' ? 'main' : 'side';

      // Parse the day-by-day snapshot. We cache so we don't re-fetch the
      // same file twice (D's file used both as "after" for D-1 and "before"
      // for D).
      const snapshots = new Map();   // dateStr → parsed rows | null
      for (const d of dates) {
        if (!snapshots.has(d)) {
          snapshots.set(d, await fetchAndParse(line, d, sessionType));
        }
      }

      // Pair-wise diff
      for (let i = 0; i < dates.length - 1; i++) {
        const d1 = dates[i];
        const d2 = dates[i + 1];
        const before = snapshots.get(d1);
        const after  = snapshots.get(d2);
        if (!before || !after) continue;

        // For each "target date" present in `before`, see if it changed
        // in `after`. The most meaningful target is d1 itself (lectures
        // dated for d1, as of d1 — vs as of d2). Limit to that for now to
        // avoid double-counting.
        const pairs = diffForTargetDate(before, after, d1);

        for (const { old: o, new: n } of pairs) {
          // Dedup against any existing row
          if (checkDup.get(
            o.group_name, line, sessionLabel,
            o.date, o.time || null,
            n.date, n.time || null,
          )) {
            summary.skipped_existing++;
            continue;
          }
          const hol = holidayFor(o.date);
          insertResched.run(
            o.group_name, line, sessionLabel,
            o.date, o.time, o.trainer, o.duration,
            n.date, n.time, n.trainer, n.duration,
            hol ? 'official_holiday' : null,
            hol ? hol.id : null,
            hol ? 'auto' : 'pending',
            `Backfilled from Drive (${d1} → ${d2} snapshot diff)`,
          );
          summary.inserted++;
          summary.by_line[line].inserted++;
          summary.by_session_type[sessionLabel]++;
          log.push({
            line, session_type: sessionLabel,
            from_file_date: d1, to_file_date: d2,
            group: o.group_name,
            old: `${o.date} ${o.time || ''}`,
            new: `${n.date} ${n.time || ''}`,
            trainer: o.trainer,
            holiday: hol ? hol.name : null,
          });
        }
      }

      // Track days that actually had files
      for (const [d, rows] of snapshots) {
        if (rows && rows.length > 0) {
          summary.by_line[line].days_with_data++;
          if (sessionType === 'lectures') summary.days_with_data++;
        }
      }
    }
  }

  return res.json({
    ok: true,
    window: { from, to },
    summary,
    sample_log: log.slice(0, 50),   // cap for response size
  });
});

// ─── POST /api/reschedules/cleanup-false-positives ───────────────────────────
// Removes already-inserted rows that match one of two false-positive patterns:
//   A) same date + < 30 minutes time difference  → Excel time-formatting jitter
//   B) new_date BEFORE old_date                   → compensation / early take
// Both patterns are NOT disruptive reschedules per business rules. Safe to
// re-run; only deletes rows matching the patterns.
router.post('/cleanup-false-positives', requireSuperAdmin, (req, res) => {
  try {
    function timeToMins(t) {
      if (!t) return null;
      const m = String(t).match(/^(\d{1,2}):(\d{2})/);
      return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
    }

    // Pattern A: same date + tiny time diff
    const sameDayCandidates = db.prepare(`
      SELECT id, old_time, new_time
        FROM lecture_reschedules
       WHERE old_date = new_date
         AND old_time IS NOT NULL
         AND new_time IS NOT NULL
    `).all();
    const toDeleteJitter = [];
    for (const c of sameDayCandidates) {
      const ma = timeToMins(c.old_time);
      const mb = timeToMins(c.new_time);
      if (ma == null || mb == null) continue;
      if (Math.abs(ma - mb) < 30) toDeleteJitter.push(c.id);
    }

    // Pattern B: backward reschedules (new_date < old_date)
    const backwardIds = db.prepare(`
      SELECT id FROM lecture_reschedules
       WHERE new_date < old_date
    `).all().map(r => r.id);

    const allIds = Array.from(new Set([...toDeleteJitter, ...backwardIds]));
    if (allIds.length === 0) {
      return res.json({
        ok: true,
        deleted: 0,
        message: 'مفيش false positives (لا time jitter ولا تواريخ سابقة).',
      });
    }

    const del = db.prepare(`DELETE FROM lecture_reschedules WHERE id = ?`);
    const tx = db.transaction(() => {
      for (const id of allIds) del.run(id);
    });
    tx();

    return res.json({
      ok: true,
      deleted: allIds.length,
      breakdown: {
        time_jitter:        toDeleteJitter.length,
        backward_dates:     backwardIds.length,
      },
      message:
        `تم حذف ${allIds.length} false positive ` +
        `(${toDeleteJitter.length} time jitter + ${backwardIds.length} تواريخ سابقة).`,
    });
  } catch (err) {
    console.error('[reschedules/cleanup-false-positives]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reschedules/verify-source ──────────────────────────────────────
// Verifies that a specific group exists in the CURRENT lectures table (i.e.
// the latest synced Excel state). Lets admins double-check that a flagged
// reschedule was actually based on real Excel data — not a sync glitch.
//
// Query:
//   ?group=...      (required, partial match via LIKE)
//   ?line=...       (optional — filters to one line)
//   ?from=YYYY-MM-DD  (optional, default 30 days ago)
//   ?to=YYYY-MM-DD    (optional, default today)
//
// Returns:
//   {
//     group_query, line, window,
//     matches:        [batches matching the group_name LIKE — name, dept_type, status],
//     lectures: {
//       count, by_session_type: {main, side},
//       rows: [...]           // sorted by date+time
//     },
//     reschedules: {
//       count,
//       rows: [...]           // all reschedule audit rows for this group
//     },
//   }
router.get('/verify-source', requireSuperAdmin, (req, res) => {
  const group = String(req.query.group || '').trim();
  const line  = (req.query.line || '').trim();
  if (!group) return res.status(400).json({ error: 'group is required' });

  const today = new Date(Date.now() + 2 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const thirty = new Date(Date.now() - 30 * 86400000 + 2 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : thirty;
  const to   = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to   || '') ? req.query.to   : today;

  try {
    const lineClause   = line ? ' AND line = ?' : '';
    const lineLClause  = line ? ' AND l.line = ?' : '';
    const lineParam    = line ? [line] : [];
    const groupLike    = `%${group}%`;

    // Matching batches (so the admin sees if the group_name matches multiple
    // batches — e.g. cross-line)
    const matches = db.prepare(`
      SELECT group_name, line, status, dept_type, course, training_schedule, coordinators
        FROM batches
       WHERE group_name LIKE ?${lineClause}
       ORDER BY line, group_name
       LIMIT 25
    `).all(groupLike, ...lineParam);

    // All lectures for the group inside the window
    const lectures = db.prepare(`
      SELECT l.id, l.group_name, l.date, l.time, l.duration, l.trainer,
             l.status, l.session_type, l.side_session_category, l.line, l.synced_at
        FROM lectures l
       WHERE l.group_name LIKE ?${lineLClause}
         AND l.date BETWEEN ? AND ?
       ORDER BY l.date, l.time, l.session_type
       LIMIT 500
    `).all(groupLike, ...lineParam, from, to);

    const byType = lectures.reduce((acc, l) => {
      acc[l.session_type] = (acc[l.session_type] || 0) + 1;
      return acc;
    }, { main: 0, side: 0 });

    // All reschedules ever recorded for the group
    const reschedules = db.prepare(`
      SELECT id, group_name, line, session_type,
             old_date, old_time, old_trainer,
             new_date, new_time, new_trainer,
             approval_status, reschedule_reason, detected_at
        FROM lecture_reschedules
       WHERE group_name LIKE ?${lineClause}
       ORDER BY old_date DESC
       LIMIT 100
    `).all(groupLike, ...lineParam);

    return res.json({
      group_query: group,
      line:        line || 'all',
      window:      { from, to },
      matches: {
        count: matches.length,
        rows:  matches,
      },
      lectures: {
        count:           lectures.length,
        by_session_type: byType,
        rows:            lectures,
      },
      reschedules: {
        count: reschedules.length,
        rows:  reschedules,
      },
    });
  } catch (err) {
    console.error('[reschedules/verify-source]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/reschedules/wipe-all ──────────────────────────────────────────
// Hard-deletes EVERY row from `lecture_reschedules`. Used once after disabling
// live detection (in sync.service.js) so the table can be rebuilt cleanly from
// `/backfill-from-drive` — guaranteeing every remaining row's source is a
// real Google Drive Excel snapshot, not a DB live-diff.
//
// Optional body: { confirm: true }  — required, prevents accidental wipes.
// Returns: { ok, deleted, message }
router.post('/wipe-all', requireSuperAdmin, express.json(), (req, res) => {
  if (req.body?.confirm !== true) {
    return res.status(400).json({
      error: 'حذف كامل لكل سجلات إعادة الجدولة — مطلوب confirm:true في الـ body للتأكيد',
    });
  }
  try {
    const before = db.prepare(`SELECT COUNT(*) AS n FROM lecture_reschedules`).get().n;
    db.prepare(`DELETE FROM lecture_reschedules`).run();
    return res.json({
      ok: true,
      deleted: before,
      message:
        `تم مسح ${before} سجل إعادة جدولة. ` +
        `استخدم "فحص من Drive" لإعادة بناء البيانات من ملفات Google Drive فقط.`,
    });
  } catch (err) {
    console.error('[reschedules/wipe-all]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
