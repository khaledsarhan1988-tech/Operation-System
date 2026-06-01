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

// ─── Stable Prefix Helper ────────────────────────────────────────────────────
// Extract the prefix BEFORE the first `(` from a group_name. This is the
// batch's natural identifier — survives BOTH trainer changes (inside parens)
// and coordinator changes (after parens). Used for aggregating reschedule
// pairs into one "chain" per group.
//
// Example: "Apr_19_Sun_11pm_ General1 _SP(Nashwa Shabaan)alaa"
//       and "Apr_19_Sun_11pm_ General1 _SP(Yasmeen Mohamed)alaa"
// both yield "apr_19_sun_11pm_ general1 _sp" → grouped as the SAME batch.
function stablePrefix(groupName) {
  const s = String(groupName || '').trim();
  const idx = s.indexOf('(');
  const head = idx === -1 ? s : s.substring(0, idx);
  return head.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[_\s]+$/, '');
}

// Aggregation priority: pending outranks everything else (still needs
// decision), then rejected (decided no), approved (decided yes), auto
// (auto-marked holiday). So a chain is "pending" if ANY pair is pending.
const STATUS_PRIORITY = { pending: 4, rejected: 3, approved: 2, auto: 1 };

// GET /api/reschedules
// AGGREGATED LIST — one row per group "chain" (stable prefix + line +
// session_type). A chain folds together every pair that shares the same
// stable identifier so the user sees ONE entry for a group that was
// rescheduled multiple times, not N separate entries. The aggregated row
// exposes:
//   • old_date/time/trainer  — from the FIRST cancellation in the chain
//   • new_date/time/trainer  — from the LAST destination in the chain
//   • pair_count, pair_ids   — so the modal can drill into every pair
//   • approval_status        — highest-priority status across the chain
//                              (pending > rejected > approved > auto)
//   • trainer_changed        — true when first.old_trainer != last.new_trainer
//
// Filters (status/from/to/trainer/group/line/session_type) apply at the PAIR
// level first; matching pairs are then aggregated. A chain with no matching
// pair is omitted entirely.
router.get('/', (req, res) => {
  const { status = 'all', from, to, trainer, group, line, session_type } = req.query;
  const wheres = [];
  const params = [];

  // NOTE: status is NOT applied here — it's filtered after aggregation so a
  // chain with at least one pending pair surfaces in the "pending" tab.
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
    const allPairs = db.prepare(`
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
      ORDER BY r.old_date ASC, r.old_time ASC, r.id ASC
    `).all(...params);

    // Group by stable prefix + line + session_type
    const chainsMap = new Map();
    for (const p of allPairs) {
      const sp = stablePrefix(p.group_name);
      const key = `${sp}|${p.line}|${p.session_type}`;
      if (!chainsMap.has(key)) chainsMap.set(key, []);
      chainsMap.get(key).push(p);
    }

    // Helper: build a {first_old_*, last_new_*, count} summary for a subset
    // of pairs (used to describe an approval/pending sub-range of a chain).
    function summarizeRange(arr) {
      if (!arr.length) return null;
      // Pairs already sorted by old_date ASC at the SQL level
      const f = arr[0];
      const l = arr[arr.length - 1];
      return {
        first_old_date: f.old_date,
        first_old_time: f.old_time,
        first_old_trainer: f.old_trainer,
        last_new_date: l.new_date,
        last_new_time: l.new_time,
        last_new_trainer: l.new_trainer,
        count: arr.length,
      };
    }

    // Build aggregated rows
    const aggregated = [];
    for (const [key, pairs] of chainsMap) {
      // Already sorted by old_date ASC. First = earliest cancellation,
      // Last = most recent destination.
      const first = pairs[0];
      const last  = pairs[pairs.length - 1];

      // Partition by status so the modal can show "approved up to X, new
      // pending from Y" instead of treating the chain as one blob.
      const byStatus = { pending: [], approved: [], rejected: [], auto: [] };
      for (const p of pairs) {
        if (byStatus[p.approval_status]) byStatus[p.approval_status].push(p);
      }

      // Aggregate status: highest priority wins (pending wins over all)
      let aggStatus = 'auto';
      let latestDetectedAt = null;
      for (const p of pairs) {
        if ((STATUS_PRIORITY[p.approval_status] || 0) > (STATUS_PRIORITY[aggStatus] || 0)) {
          aggStatus = p.approval_status;
        }
        if (!latestDetectedAt || p.detected_at > latestDetectedAt) {
          latestDetectedAt = p.detected_at;
        }
      }

      // Approved summary — pick latest approval metadata (approver, date,
      // note) from the approved subset so the modal can render a card
      // saying "approved by X on date Y, note: Z".
      let approvedSummary = null;
      if (byStatus.approved.length) {
        const sortedByApproval = byStatus.approved.slice().sort(
          (a, b) => (b.approved_at || '').localeCompare(a.approved_at || '')
        );
        const latestApproved = sortedByApproval[0];
        approvedSummary = {
          ...summarizeRange(byStatus.approved),
          approver_name: latestApproved.approved_by_name || null,
          approved_at:   latestApproved.approved_at || null,
          note:          latestApproved.admin_notes || null,
        };
      }

      const pendingSummary  = byStatus.pending.length  ? summarizeRange(byStatus.pending)  : null;
      const rejectedSummary = byStatus.rejected.length ? {
        ...summarizeRange(byStatus.rejected),
        reason: byStatus.rejected.slice().sort(
          (a, b) => (b.approved_at || '').localeCompare(a.approved_at || '')
        )[0]?.rejection_reason || null,
      } : null;
      const autoSummary = byStatus.auto.length ? summarizeRange(byStatus.auto) : null;

      // Latest fallback metadata for cases where the user is viewing a chain
      // that's entirely pending (no decisions yet) — keeps existing UI fields
      // populated without forcing the frontend to look inside the summaries.
      const latestAdminNotes      = pairs.slice().reverse().find(p => p.admin_notes)?.admin_notes || null;
      const latestRejectionReason = pairs.slice().reverse().find(p => p.rejection_reason)?.rejection_reason || null;
      const latestApprovedBy      = pairs.slice().reverse().find(p => p.approved_by_name)?.approved_by_name || null;
      const latestApprovedAt      = pairs.slice().reverse().find(p => p.approved_at)?.approved_at || null;

      aggregated.push({
        group_key:        key,
        group_name:       last.group_name,          // latest known name
        line:             last.line,
        session_type:     last.session_type,
        old_date:         first.old_date,
        old_time:         first.old_time,
        old_trainer:      first.old_trainer,
        old_duration:     first.old_duration,
        new_date:         last.new_date,
        new_time:         last.new_time,
        new_trainer:      last.new_trainer,
        new_duration:     last.new_duration,
        approval_status:  aggStatus,
        pair_count:       pairs.length,
        pair_ids:         pairs.map(p => p.id),
        // Per-status breakdown — lets the modal show "X already-approved,
        // Y still pending" and apply approve/reject only to the right set.
        pending_pair_ids:  byStatus.pending.map(p => p.id),
        approved_pair_ids: byStatus.approved.map(p => p.id),
        rejected_pair_ids: byStatus.rejected.map(p => p.id),
        auto_pair_ids:     byStatus.auto.map(p => p.id),
        approved_summary:  approvedSummary,
        pending_summary:   pendingSummary,
        rejected_summary:  rejectedSummary,
        auto_summary:      autoSummary,
        trainer_changed:  (first.old_trainer || '').trim() !== (last.new_trainer || '').trim(),
        reschedule_reason: last.reschedule_reason,
        holiday_name:     last.holiday_name,
        admin_notes:      latestAdminNotes,
        rejection_reason: latestRejectionReason,
        approved_by_name: latestApprovedBy,
        approved_at:      latestApprovedAt,
        detected_at:      latestDetectedAt,
      });
    }

    // Status filter at chain level
    const filtered = status === 'all'
      ? aggregated
      : aggregated.filter(c => c.approval_status === status);

    // Sort by most recent detection first
    filtered.sort((a, b) => (b.detected_at || '').localeCompare(a.detected_at || ''));

    // Counts per status — measured ACROSS the full aggregated set
    // (not the filtered set), so tab badges reflect total chains regardless
    // of which tab the user is currently viewing.
    const counts = aggregated.reduce((acc, c) => {
      acc[c.approval_status] = (acc[c.approval_status] || 0) + 1;
      return acc;
    }, {});

    return res.json({ rows: filtered.slice(0, 1000), counts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/reschedules/group/approve ────────────────────────────────────
// Bulk approval — applies to every pair in a chain at once. Body: { pair_ids }
// (must be a non-empty array of numeric ids). Returns count of updated rows.
router.patch('/group/approve', requireSuperAdmin, express.json(), (req, res) => {
  const ids = Array.isArray(req.body?.pair_ids)
    ? req.body.pair_ids.filter(n => Number.isFinite(n))
    : [];
  if (!ids.length) return res.status(400).json({ error: 'pair_ids array required' });
  try {
    const ph = ids.map(() => '?').join(',');
    const r = db.prepare(`
      UPDATE lecture_reschedules
         SET approval_status  = 'approved',
             approved_by      = ?,
             approved_at      = datetime('now', '+2 hours'),
             rejection_reason = NULL
       WHERE id IN (${ph})
    `).run(req.user?.id || null, ...ids);
    return res.json({ ok: true, updated: r.changes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/reschedules/group/reject ─────────────────────────────────────
// Bulk rejection. Body: { pair_ids, reason? }
router.patch('/group/reject', requireSuperAdmin, express.json(), (req, res) => {
  const ids = Array.isArray(req.body?.pair_ids)
    ? req.body.pair_ids.filter(n => Number.isFinite(n))
    : [];
  if (!ids.length) return res.status(400).json({ error: 'pair_ids array required' });
  const reason = (req.body?.reason || '').trim() || null;
  try {
    const ph = ids.map(() => '?').join(',');
    const r = db.prepare(`
      UPDATE lecture_reschedules
         SET approval_status  = 'rejected',
             approved_by      = ?,
             approved_at      = datetime('now', '+2 hours'),
             rejection_reason = ?
       WHERE id IN (${ph})
    `).run(req.user?.id || null, reason, ...ids);
    return res.json({ ok: true, updated: r.changes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/reschedules/group/notes ──────────────────────────────────────
// Bulk-write the same admin note to every pair in a chain.
router.patch('/group/notes', requireSuperAdmin, express.json(), (req, res) => {
  const ids = Array.isArray(req.body?.pair_ids)
    ? req.body.pair_ids.filter(n => Number.isFinite(n))
    : [];
  if (!ids.length) return res.status(400).json({ error: 'pair_ids array required' });
  const notes = (req.body?.notes || '').trim() || null;
  try {
    const ph = ids.map(() => '?').join(',');
    const r = db.prepare(
      `UPDATE lecture_reschedules SET admin_notes = ? WHERE id IN (${ph})`
    ).run(notes, ...ids);
    return res.json({ ok: true, updated: r.changes });
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

  // stablePrefix is defined at module level — reused here for stableKey.
  function stableKey(r) {
    return [
      stablePrefix(r.group_name),
      String(r.session_type || '').trim().toLowerCase(),
      String(r.line         || '').trim().toLowerCase(),
    ].join('|');
  }
  function slotKey(r) {
    return [
      r.date, r.time,
      stablePrefix(r.group_name),
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

  // Full-schedule diff between two snapshots. Unlike the old per-day approach,
  // this compares the COMPLETE schedule of every group (all dates), so a
  // postponement of FUTURE lectures (what a holiday shift looks like) is seen.
  // Any lecture that moved to a LATER date is a postponement. Returns {old,new}.
  function diffFullSchedule(beforeRows, afterRows) {
    const beforeBySlot = new Map();
    beforeRows.forEach(r => beforeBySlot.set(slotKey(r), r));
    const afterSlots = new Set(afterRows.map(slotKey));

    // Cancellations: a slot present in `before` but gone in `after`.
    const cancelled = [];
    for (const [k, row] of beforeBySlot) {
      if (!afterSlots.has(k)) cancelled.push(row);
    }
    if (cancelled.length === 0) return [];

    // Additions: a slot in `after` (absent from before) whose group/trainer/
    // session (stableKey) matches a cancelled one — i.e. the same lecture moved.
    const additionsByKey = new Map();
    for (const r of afterRows) {
      if (beforeBySlot.has(slotKey(r))) continue;
      const k = stableKey(r);
      if (!additionsByKey.has(k)) additionsByKey.set(k, []);
      additionsByKey.get(k).push(r);
    }

    // Pair: greedy match by stable key, pick the closest later date.
    const pairs = [];
    cancelled.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const oldRow of cancelled) {
      const candidates = additionsByKey.get(stableKey(oldRow)) || [];
      if (candidates.length === 0) continue;   // pure cancellation, not a move
      candidates.sort((a, b) =>
        Math.abs(new Date(a.date) - new Date(oldRow.date)) -
        Math.abs(new Date(b.date) - new Date(oldRow.date))
      );
      const newRow = candidates.shift();        // consume — match once
      // Skip false-positive pairs: same date + tiny time drift = Excel jitter
      if (isMinorTimeDrift(oldRow, newRow)) continue;
      // Skip "backward" pairs (new is BEFORE old) — compensation / early-take,
      // not a postponement.
      if (newRow.date < oldRow.date) continue;
      pairs.push({ old: oldRow, new: newRow });
    }
    return pairs;
  }

  // ── Main loop — boundary snapshot comparison ─────────────────────────────
  // Per business rule, compare the FIRST file that has data in the range with
  // the LAST file that has data (the empty "holiday" days in between are
  // skipped automatically), then diff the full schedule. This recovers
  // postponements that straddle a holiday gap — impossible to see day-by-day —
  // and reads only the two boundary files, so it's fast and never times out.
  const dates = eachDate(from, to);
  const summary = {
    days_scanned: dates.length,
    days_with_data: 0,
    inserted: 0,
    skipped_existing: 0,
    skipped_holiday: 0,        // postponements ignored because original date ∈ holiday
    by_line: {},
    by_session_type: { main: 0, side: 0 },
    compared: [],              // which boundary files were diffed
  };
  const log = [];

  for (const line of requestedLines) {
    summary.by_line[line] = { days_with_data: 0, inserted: 0 };

    for (const sessionType of ['lectures', 'side_sessions']) {
      const sessionLabel = sessionType === 'lectures' ? 'main' : 'side';
      const cache = new Map();   // dateStr → rows|null, shared by both probes
      const fetchDay = async (d) => {
        if (!cache.has(d)) cache.set(d, await fetchAndParse(line, d, sessionType));
        return cache.get(d);
      };

      // First file WITH data scanning forward from `from` …
      let before = null;
      for (const d of dates) {
        const rows = await fetchDay(d);
        if (rows && rows.length > 0) { before = { date: d, rows }; break; }
      }
      // … and last file WITH data scanning backward from `to`.
      let after = null;
      for (let i = dates.length - 1; i >= 0; i--) {
        const rows = await fetchDay(dates[i]);
        if (rows && rows.length > 0) { after = { date: dates[i], rows }; break; }
      }

      const distinct = new Set();
      if (before) distinct.add(before.date);
      if (after)  distinct.add(after.date);
      summary.by_line[line].days_with_data += distinct.size;
      if (sessionType === 'lectures') summary.days_with_data += distinct.size;

      // Need two DISTINCT files with data to compare.
      if (!before || !after || before.date === after.date) continue;
      summary.compared.push({ line, session_type: sessionLabel, before: before.date, after: after.date });

      const pairs = diffFullSchedule(before.rows, after.rows);
      for (const { old: o, new: n } of pairs) {
        // ── HOLIDAY RULE ──────────────────────────────────────────────────
        // If the lecture's ORIGINAL date falls inside a registered official
        // holiday, the postponement is expected → IGNORE it entirely (do not
        // insert). Otherwise it's an unexpected reschedule → record as pending.
        if (holidayFor(o.date)) { summary.skipped_holiday++; continue; }

        if (checkDup.get(
          o.group_name, line, sessionLabel,
          o.date, o.time || null,
          n.date, n.time || null,
        )) { summary.skipped_existing++; continue; }

        insertResched.run(
          o.group_name, line, sessionLabel,
          o.date, o.time, o.trainer, o.duration,
          n.date, n.time, n.trainer, n.duration,
          null, null, 'pending',
          `Backfilled from Drive (${before.date} → ${after.date} full-schedule diff)`,
        );
        summary.inserted++;
        summary.by_line[line].inserted++;
        summary.by_session_type[sessionLabel]++;
        log.push({
          line, session_type: sessionLabel,
          from_file_date: before.date, to_file_date: after.date,
          group: o.group_name,
          old: `${o.date} ${o.time || ''}`,
          new: `${n.date} ${n.time || ''}`,
          trainer: o.trainer,
          holiday: null,
        });
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
// Build the full alias set for a group_name by walking group_renames BOTH
// directions (forward — group was renamed TO X; backward — group was
// renamed FROM Y). Returns Set<string> of all known aliases (always
// includes the input).
function resolveGroupAliases(group, line) {
  const aliases = new Set([group]);
  const queue   = [group];
  while (queue.length) {
    const cur = queue.shift();
    let forwards = [], backwards = [];
    try {
      forwards = db.prepare(
        `SELECT new_group_name FROM group_renames WHERE old_group_name = ?${line ? ' AND line = ?' : ''}`
      ).all(cur, ...(line ? [line] : []));
      backwards = db.prepare(
        `SELECT old_group_name FROM group_renames WHERE new_group_name = ?${line ? ' AND line = ?' : ''}`
      ).all(cur, ...(line ? [line] : []));
    } catch (_) { /* table missing on first deploy */ }
    for (const r of forwards) {
      if (!aliases.has(r.new_group_name)) {
        aliases.add(r.new_group_name);
        queue.push(r.new_group_name);
      }
    }
    for (const r of backwards) {
      if (!aliases.has(r.old_group_name)) {
        aliases.add(r.old_group_name);
        queue.push(r.old_group_name);
      }
    }
  }
  return aliases;
}

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
    // ── Step 1 — resolve the full alias chain via group_renames ─────────
    // A group can be referred to by multiple names over time as trainers
    // and coordinators change. We chase both directions to gather them all.
    const aliasSet = resolveGroupAliases(group, line);
    const aliasArr = Array.from(aliasSet);
    const lineClause   = line ? ' AND line = ?' : '';
    const lineLClause  = line ? ' AND l.line = ?' : '';
    const lineParam    = line ? [line] : [];

    // ── Step 2 — match against ALL aliases. Build (group LIKE ? OR ...)
    // so even partial-name searches still hit. Each alias becomes a LIKE.
    const groupOrs = aliasArr.map(() => 'group_name LIKE ?').join(' OR ');
    const groupOrsL = aliasArr.map(() => 'l.group_name LIKE ?').join(' OR ');
    const likeParams = aliasArr.map(a => `%${a}%`);

    const matches = db.prepare(`
      SELECT group_name, line, status, dept_type, course, training_schedule, coordinators
        FROM batches
       WHERE (${groupOrs})${lineClause}
       ORDER BY line, group_name
       LIMIT 25
    `).all(...likeParams, ...lineParam);

    const lectures = db.prepare(`
      SELECT l.id, l.group_name, l.date, l.time, l.duration, l.trainer,
             l.status, l.session_type, l.side_session_category, l.line, l.synced_at
        FROM lectures l
       WHERE (${groupOrsL})${lineLClause}
         AND l.date BETWEEN ? AND ?
       ORDER BY l.date, l.time, l.session_type
       LIMIT 500
    `).all(...likeParams, ...lineParam, from, to);

    const byType = lectures.reduce((acc, l) => {
      acc[l.session_type] = (acc[l.session_type] || 0) + 1;
      return acc;
    }, { main: 0, side: 0 });

    const reschedules = db.prepare(`
      SELECT id, group_name, line, session_type,
             old_date, old_time, old_trainer,
             new_date, new_time, new_trainer,
             approval_status, reschedule_reason, detected_at
        FROM lecture_reschedules
       WHERE (${groupOrs})${lineClause}
       ORDER BY old_date DESC
       LIMIT 100
    `).all(...likeParams, ...lineParam);

    return res.json({
      group_query: group,
      line:        line || 'all',
      window:      { from, to },
      aliases:     aliasArr,           // all known names for this group
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

// ─── GET /api/reschedules/timeline ───────────────────────────────────────────
// Full chronological story for ONE group. Walks group_renames to gather
// every alias the group ever had, then merges:
//   • completed/confirmed lectures (from `lectures` table)
//   • cancelled lectures (reschedule rows' old side)
//   • newly-scheduled lectures (reschedule rows' new side, including current state)
// Into a single chronological timeline. Also computes summary stats:
//   • full date range (earliest → latest event)
//   • count of cancelled-and-moved lectures by weekday (Sun/Mon/…)
//   • the chain of group_name aliases
//
// Query: ?group=...&line=...
router.get('/timeline', requireSuperAdmin, (req, res) => {
  const group = String(req.query.group || '').trim();
  const line  = (req.query.line || '').trim();
  if (!group) return res.status(400).json({ error: 'group is required' });

  try {
    const aliasArr = Array.from(resolveGroupAliases(group, line));
    const groupOrs   = aliasArr.map(() => 'group_name = ?').join(' OR ');
    const groupOrsL  = aliasArr.map(() => 'l.group_name = ?').join(' OR ');
    const lineClause = line ? ' AND line = ?' : '';
    const lineLClause = line ? ' AND l.line = ?' : '';
    const lineParam  = line ? [line] : [];

    // Pull all reschedules for any alias, ASC by old_date (chronological)
    const reschedRows = db.prepare(`
      SELECT id, group_name, line, session_type,
             old_date, old_time, old_trainer, old_duration,
             new_date, new_time, new_trainer, new_duration,
             approval_status, reschedule_reason, holiday_id, admin_notes,
             detected_at
        FROM lecture_reschedules
       WHERE (${groupOrs})${lineClause}
       ORDER BY old_date ASC, old_time ASC, id ASC
    `).all(...aliasArr, ...lineParam);

    // Pull all lectures (any alias) for context — gives the user the
    // "active period" of the group, not just the reschedule window.
    const lectureRows = db.prepare(`
      SELECT l.id, l.group_name, l.date, l.time, l.duration, l.trainer,
             l.status, l.session_type, l.side_session_category, l.line
        FROM lectures l
       WHERE (${groupOrsL})${lineLClause}
       ORDER BY l.date ASC, l.time ASC
    `).all(...aliasArr, ...lineParam);

    // ── Coordinator-at-time lookup ────────────────────────────────────────
    // coordinator_history records every coord assignment with effective_from/
    // effective_to. For each event in the timeline we'll resolve the coord(s)
    // who were active on that specific date — so the admin sees the person
    // responsible AT THE TIME of cancellation, not the current coordinator.
    let coordHistory = [];
    try {
      coordHistory = db.prepare(`
        SELECT group_name, coordinator, effective_from, effective_to
          FROM coordinator_history
         WHERE (${groupOrs})${lineClause}
         ORDER BY effective_from ASC
      `).all(...aliasArr, ...lineParam);
    } catch (_) { /* table may not exist on first deploy */ }

    function uniqueCoordNames(arr) {
      const seen = new Set();
      const out  = [];
      for (const r of arr) {
        const k = String(r.coordinator || '').toLowerCase().trim();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(r.coordinator);
      }
      return out;
    }

    function coordinatorsOnDate(dateStr) {
      if (!dateStr || coordHistory.length === 0) return [];
      // Match: effective_from's DATE <= eventDate AND
      //        (effective_to IS NULL OR effective_to's DATE > eventDate)
      const exact = coordHistory.filter(h => {
        const fromDate = (h.effective_from || '').slice(0, 10);
        if (fromDate > dateStr) return false;
        if (!h.effective_to) return true;
        const toDate = (h.effective_to || '').slice(0, 10);
        return toDate > dateStr;
      });
      if (exact.length > 0) return uniqueCoordNames(exact);

      // Fallback — event predates the earliest sync record. Use the coord(s)
      // with the earliest effective_from (best guess of who was active then).
      const sortedByFrom = coordHistory.slice()
        .sort((a, b) => (a.effective_from || '').localeCompare(b.effective_from || ''));
      const earliestFrom = sortedByFrom[0]?.effective_from;
      if (!earliestFrom) return [];
      return uniqueCoordNames(sortedByFrom.filter(h => h.effective_from === earliestFrom));
    }

    // Weekday helper — JS getDay() is 0=Sun..6=Sat; map to Arabic name.
    const DOW_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    function dow(dateStr) {
      const d = new Date(dateStr + 'T12:00:00');
      const i = d.getDay();
      return { ar: DOW_AR[i], en: DOW_EN[i], idx: i };
    }

    // Build a single chronological event stream so the frontend can render
    // it like "May 17 (Sun): cancelled — moved to May 20…".
    // We dedupe carefully: a reschedule row contributes TWO events (its
    // cancellation + its rescheduled-to). The same date can BE a cancellation
    // in one row and a rescheduled-to in an earlier row (chain). We keep both
    // perspectives so the user sees "this date was a destination that later
    // also got cancelled".
    const events = [];
    for (const r of reschedRows) {
      events.push({
        kind: 'cancelled',
        date: r.old_date,
        time: r.old_time,
        weekday: dow(r.old_date),
        trainer: r.old_trainer,
        duration: r.old_duration,
        group_name: r.group_name,
        session_type: r.session_type,
        moved_to: r.new_date,
        moved_to_time: r.new_time,
        moved_to_trainer: r.new_trainer,
        // Coordinator(s) responsible at the time of the cancellation —
        // not the current coordinator. Uses coordinator_history's time
        // windows to resolve correctly even if the coordinator changed
        // mid-batch.
        coordinators_at_time: coordinatorsOnDate(r.old_date),
        reschedule_id: r.id,
        approval_status: r.approval_status,
        holiday_id: r.holiday_id,
        reason: r.reschedule_reason,
      });
      events.push({
        kind: 'rescheduled',
        date: r.new_date,
        time: r.new_time,
        weekday: dow(r.new_date),
        trainer: r.new_trainer,
        duration: r.new_duration,
        group_name: r.group_name,
        session_type: r.session_type,
        moved_from: r.old_date,
        moved_from_time: r.old_time,
        moved_from_trainer: r.old_trainer,
        coordinators_at_time: coordinatorsOnDate(r.new_date),
        name_changed: false,   // filled below if trainer/coordinator differ
        reschedule_id: r.id,
        approval_status: r.approval_status,
      });
    }

    // Flag rescheduled events whose final name (latest lecture row for the
    // same date) differs from the originating row's group_name.
    const lectureByDate = new Map();
    for (const l of lectureRows) lectureByDate.set(`${l.date}|${l.session_type}`, l);
    for (const ev of events) {
      if (ev.kind !== 'rescheduled') continue;
      const cur = lectureByDate.get(`${ev.date}|${ev.session_type}`);
      if (cur && cur.group_name && cur.group_name !== ev.group_name) {
        ev.name_changed = true;
        ev.current_name = cur.group_name;
        ev.current_trainer = cur.trainer;
      }
    }

    // Sort chronologically (oldest first). Ties: cancelled before rescheduled
    // so the narrative reads "X was cancelled → moved to Y".
    events.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if ((a.time || '') !== (b.time || '')) return (a.time || '').localeCompare(b.time || '');
      if (a.kind !== b.kind) return a.kind === 'cancelled' ? -1 : 1;
      return 0;
    });

    // Stats
    const allDates = [
      ...reschedRows.flatMap(r => [r.old_date, r.new_date]).filter(Boolean),
      ...lectureRows.map(l => l.date).filter(Boolean),
    ].sort();
    const dateRange = allDates.length
      ? { from: allDates[0], to: allDates[allDates.length - 1] }
      : null;

    // Cancellations grouped by weekday (the headline stat the user wants)
    const cancelledByWeekday = {};
    for (const r of reschedRows) {
      const w = dow(r.old_date);
      const k = w.en;
      if (!cancelledByWeekday[k]) {
        cancelledByWeekday[k] = { label_ar: w.ar, label_en: w.en, count: 0, dates: [] };
      }
      cancelledByWeekday[k].count++;
      cancelledByWeekday[k].dates.push(r.old_date);
    }

    // Latest "currently-scheduled" lecture for the group (gives the user the
    // "final destination" line). Take the latest by date among lectures
    // whose status is not 'مكتملة'/'ملغية' — i.e. still on the calendar.
    const latestScheduled = lectureRows.length
      ? lectureRows[lectureRows.length - 1]
      : null;

    return res.json({
      group_query: group,
      line: line || 'all',
      aliases: aliasArr,
      total_reschedules: reschedRows.length,
      date_range: dateRange,
      cancelled_by_weekday: cancelledByWeekday,
      latest_scheduled: latestScheduled,
      events,
      reschedules: reschedRows,
      lectures_count: lectureRows.length,
    });
  } catch (err) {
    console.error('[reschedules/timeline]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/reschedules/wipe-pending ──────────────────────────────────────
// Deletes ONLY rows where approval_status = 'pending'. Approved, rejected,
// and auto-marked rows are PRESERVED. Intended use: the admin reviewed all
// pending items and wants a clean slate for the "في الانتظار" tab so the
// next Drive backfill can surface fresh reschedules to review — without
// losing the audit trail of past decisions.
//
// Body: { confirm: true }   — required guard against accidental wipes.
// Returns: { ok, deleted, message, preserved }
router.post('/wipe-pending', requireSuperAdmin, express.json(), (req, res) => {
  if (req.body?.confirm !== true) {
    return res.status(400).json({
      error: 'حذف سجلات الانتظار — مطلوب confirm:true في الـ body للتأكيد',
    });
  }
  try {
    const pendingCount = db.prepare(
      `SELECT COUNT(*) AS n FROM lecture_reschedules WHERE approval_status = 'pending'`
    ).get().n;
    const preservedCount = db.prepare(
      `SELECT COUNT(*) AS n FROM lecture_reschedules WHERE approval_status != 'pending'`
    ).get().n;
    db.prepare(
      `DELETE FROM lecture_reschedules WHERE approval_status = 'pending'`
    ).run();
    return res.json({
      ok: true,
      deleted: pendingCount,
      preserved: preservedCount,
      message:
        `تم مسح ${pendingCount} سجل في الانتظار. ` +
        `${preservedCount} سجل (معتمد / مرفوض / إجازة) محفوظ بدون تأثير. ` +
        `استخدم "الفحص الحقيقي من Drive" لاكتشاف السجلات الجديدة.`,
    });
  } catch (err) {
    console.error('[reschedules/wipe-pending]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
