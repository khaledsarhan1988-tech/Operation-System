'use strict';
const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const db = require('../config/database');
const { ingestSnapshot, ingestSnapshotFromDb, deleteSnapshot, cleanupOrphans } = require('../services/remarksMonitor.service');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.xlsx$/i.test(file.originalname) ||
               file.mimetype.includes('spreadsheetml') ||
               file.mimetype.includes('excel');
    cb(ok ? null : new Error('Only .xlsx files allowed'), ok);
  },
});

router.post(
  '/upload',
  authenticate,
  requireRole('leader'),
  upload.single('file'),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
    }

    const userLine = req.user?.line || 'Ahmed Hassan';
    let line = (req.body && req.body.line) || req.query.line || userLine;
    if (userLine !== 'All') line = userLine;

    if (!line || line === 'All') {
      return res.status(400).json({
        error: 'يجب تحديد الـ Line',
      });
    }

    try {
      const result = ingestSnapshot({
        buffer: req.file.buffer,
        uploadedBy: req.user.id,
        line,
        notesField: req.body?.notes || null,
      });

      return res.json({
        message: 'تم رفع الـ Snapshot بنجاح',
        snapshot_id: result.snapshot_id,
        snapshot_at: result.snapshot_at,
        total_remarks: result.total_remarks,
        events_generated: result.events_generated,
        prev_snapshot_id: result.prev_snapshot_id,
        line,
      });
    } catch (err) {
      console.error('[remarks-monitor] upload error:', err);
      return res.status(400).json({
        error: 'فشل رفع الـ Snapshot',
        details: err.message,
      });
    }
  }
);

router.post(
  '/snapshot-from-db',
  authenticate,
  requireRole('leader'),
  (req, res) => {
    const userLine = req.user?.line || 'Ahmed Hassan';
    let line = (req.body && req.body.line) || req.query.line || userLine;
    if (userLine !== 'All') line = userLine;

    if (!line || line === 'All') {
      return res.status(400).json({ error: 'يجب تحديد الـ Line' });
    }

    try {
      const result = ingestSnapshotFromDb({
        uploadedBy: req.user.id,
        line,
        notesField: req.body?.notes || 'Snapshot من البيانات الحالية',
      });

      return res.json({
        message: 'تم إنشاء Snapshot من البيانات الحالية بنجاح',
        snapshot_id: result.snapshot_id,
        snapshot_at: result.snapshot_at,
        total_remarks: result.total_remarks,
        events_generated: result.events_generated,
        prev_snapshot_id: result.prev_snapshot_id,
        source: 'db',
        line,
      });
    } catch (err) {
      console.error('[remarks-monitor] snapshot-from-db error:', err);
      return res.status(400).json({
        error: 'فشل إنشاء الـ Snapshot',
        details: err.message,
      });
    }
  }
);

router.get(
  '/snapshots',
  authenticate,
  (req, res) => {
    const userLine = req.user?.line || 'Ahmed Hassan';
    let line = req.query.line || userLine;
    if (userLine !== 'All') line = userLine;

    if (!line || line === 'All') {
      return res.status(400).json({ error: 'يجب تحديد الـ Line' });
    }

    try {
      const snapshots = db.prepare(`
        SELECT s.id, s.snapshot_at, s.line, s.total_remarks, s.notes,
               s.uploaded_by, u.full_name as uploaded_by_name,
               (SELECT COUNT(*) FROM remark_activity_events WHERE to_snapshot_id = s.id) as events_count
          FROM remark_snapshots s
          LEFT JOIN users u ON s.uploaded_by = u.id
         WHERE s.line = ?
         ORDER BY s.id DESC
         LIMIT 100
      `).all(line);

      return res.json({ snapshots, line });
    } catch (err) {
      console.error('[remarks-monitor] snapshots list error:', err);
      return res.status(500).json({ error: 'فشل تحميل قائمة الـ Snapshots', details: err.message });
    }
  }
);

router.delete(
  '/snapshots/:id',
  authenticate,
  requireRole('leader'),
  (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'رقم Snapshot غير صالح' });
    }

    const userLine = req.user?.line || 'Ahmed Hassan';
    let line = (req.body && req.body.line) || req.query.line || userLine;
    if (userLine !== 'All') line = userLine;

    if (!line || line === 'All') {
      return res.status(400).json({ error: 'يجب تحديد الـ Line' });
    }

    try {
      const result = deleteSnapshot(id, line);
      return res.json({
        message: `تم حذف Snapshot #${id} بنجاح`,
        ...result,
      });
    } catch (err) {
      console.error('[remarks-monitor] delete error:', err);
      return res.status(400).json({
        error: 'فشل الحذف',
        details: err.message,
      });
    }
  }
);

// ─── POST /api/remarks-monitor/cleanup-orphans ────────────────────────────────
// One-time cleanup for events/rows whose parent snapshot was deleted but
// CASCADE didn't fire (sql.js limitation). Safe to call multiple times.
router.post('/cleanup-orphans', authenticate, requireRole('leader'), (req, res) => {
  const userLine = req.user?.line || 'Ahmed Hassan';
  let line = (req.body && req.body.line) || req.query.line || userLine;
  if (userLine !== 'All') line = userLine;

  try {
    const result = cleanupOrphans(line);
    return res.json({
      message: 'تم تنظيف الأحداث المعلقة',
      ...result,
      line,
    });
  } catch (err) {
    console.error('[remarks-monitor] cleanup error:', err);
    return res.status(500).json({ error: 'فشل التنظيف', details: err.message });
  }
});

// ─── GET /api/remarks-monitor/filters ─────────────────────────────────────────
// Returns dropdown values for the dashboard filters
router.get('/filters', authenticate, (req, res) => {
  const userLine = req.user?.line || 'Ahmed Hassan';
  let line = req.query.line || userLine;
  if (userLine !== 'All') line = userLine;

  try {
    const tasks = db.prepare(
      `SELECT id, name FROM remark_monitor_tasks WHERE is_active = 1 ORDER BY sort_order, id`
    ).all();
    const categories = db.prepare(
      `SELECT id, name FROM remark_monitor_categories WHERE is_active = 1 ORDER BY sort_order, id`
    ).all();

    let assignees = [];
    if (line && line !== 'All') {
      const rows = db.prepare(
        `SELECT DISTINCT assigned_to FROM remark_snapshot_rows
          WHERE line = ? AND assigned_to IS NOT NULL AND assigned_to != ''
            AND snapshot_id = (SELECT MAX(id) FROM remark_snapshots WHERE line = ?)
          ORDER BY assigned_to COLLATE NOCASE`
      ).all(line, line);
      assignees = rows.map(r => r.assigned_to);
    }

    return res.json({
      tasks,
      categories,
      assignees,
      lines: userLine === 'All' ? ['Ahmed Hassan', 'Dardasha'] : [userLine],
    });
  } catch (err) {
    console.error('[remarks-monitor] filters error:', err);
    return res.status(500).json({ error: 'فشل تحميل الفلاتر', details: err.message });
  }
});

// ─── GET /api/remarks-monitor/dashboard ───────────────────────────────────────
// Main dashboard list with sparkline data + last activity
router.get('/dashboard', authenticate, (req, res) => {
  const userLine = req.user?.line || 'Ahmed Hassan';
  const role = req.user?.role || 'agent';
  let line = req.query.line || userLine;
  if (userLine !== 'All') line = userLine;

  if (!line || line === 'All') {
    return res.status(400).json({ error: 'يجب تحديد الـ Line' });
  }

  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  const sparkN = Math.min(parseInt(req.query.sparkline, 10) || 8, 20);

  const taskType   = req.query.task_type   || null;
  const category   = req.query.category    || null;
  const priority   = req.query.priority    || null;
  const status     = req.query.status      || null;
  const assignedTo = req.query.assigned_to || null;
  const search     = (req.query.search || '').trim();
  const sortBy     = req.query.sort || 'last_activity_desc';

  try {
    const latestSnap = db.prepare(
      `SELECT id, snapshot_at FROM remark_snapshots WHERE line = ? ORDER BY id DESC LIMIT 1`
    ).get(line);

    if (!latestSnap) {
      return res.json({
        remarks: [],
        total: 0,
        snapshots_meta: [],
        latest_snapshot: null,
        page: { limit, offset },
      });
    }

    const wheres = ['lr.line = ?', 'lr.snapshot_id = ?'];
    const params = [line, latestSnap.id];

    if (taskType)   { wheres.push('lr.task_type = ?');   params.push(taskType);   }
    if (category)   { wheres.push('lr.category  = ?');   params.push(category);   }
    if (priority)   { wheres.push('lr.priority  = ?');   params.push(priority);   }
    if (status)     { wheres.push('lr.status    = ?');   params.push(status);     }
    if (assignedTo) { wheres.push('lr.assigned_to = ?'); params.push(assignedTo); }

    // Agent role: only their own remarks
    if (role === 'agent' && req.user?.full_name) {
      wheres.push('lr.assigned_to = ?');
      params.push(req.user.full_name);
    }

    if (search) {
      wheres.push(`(
        CAST(lr.external_id AS TEXT) LIKE ? OR
        lr.client_name LIKE ? OR
        lr.client_phone LIKE ? OR
        lr.details LIKE ?
      )`);
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const whereClause = wheres.join(' AND ');

    const totalRow = db.prepare(
      `SELECT COUNT(*) as c FROM remark_snapshot_rows lr WHERE ${whereClause}`
    ).get(...params);
    const total = totalRow ? totalRow.c : 0;

    let orderBy = '';
    switch (sortBy) {
      case 'silence_desc':       orderBy = 'last_activity_at ASC';  break;
      case 'events_desc':        orderBy = 'total_events DESC';     break;
      case 'priority_desc':      orderBy = "CASE lr.priority WHEN 'عالية' THEN 1 WHEN 'هامة' THEN 2 WHEN 'عادية' THEN 3 ELSE 4 END"; break;
      case 'last_activity_desc':
      default:                   orderBy = 'last_activity_at DESC'; break;
    }

    const rows = db.prepare(
      `SELECT lr.external_id, lr.task_type, lr.assigned_to, lr.details, lr.category,
              lr.status, lr.client_name, lr.client_phone, lr.priority, lr.assigned_by,
              lr.notes_count, lr.last_note_at, lr.added_at, lr.last_updated,
              COALESCE(stats.total_events, 0) as total_events,
              stats.last_activity_at
         FROM remark_snapshot_rows lr
         LEFT JOIN (
           SELECT external_id, line, COUNT(*) as total_events, MAX(occurred_at) as last_activity_at
             FROM remark_activity_events
            WHERE line = ?
            GROUP BY external_id, line
         ) stats ON lr.external_id = stats.external_id AND lr.line = stats.line
        WHERE ${whereClause}
        ORDER BY ${orderBy} NULLS LAST, lr.external_id DESC
        LIMIT ? OFFSET ?`
    ).all(line, ...params, limit, offset);

    // Sparkline meta — last N snapshots
    const snapshotsMeta = db.prepare(
      `SELECT id, snapshot_at FROM remark_snapshots WHERE line = ? ORDER BY id DESC LIMIT ?`
    ).all(line, sparkN).reverse();

    // Activity per snapshot for the visible remarks
    const externalIds = rows.map(r => r.external_id);
    let sparkData = [];
    if (externalIds.length > 0 && snapshotsMeta.length > 0) {
      const minSnapId = snapshotsMeta[0].id;
      const placeholders = externalIds.map(() => '?').join(',');
      sparkData = db.prepare(
        `SELECT external_id, to_snapshot_id, COUNT(*) as events
           FROM remark_activity_events
          WHERE line = ?
            AND external_id IN (${placeholders})
            AND to_snapshot_id >= ?
          GROUP BY external_id, to_snapshot_id`
      ).all(line, ...externalIds, minSnapId);
    }

    // Build sparkline arrays per remark
    const sparkByRemark = new Map();
    for (const row of rows) sparkByRemark.set(row.external_id, new Map());
    for (const s of sparkData) {
      sparkByRemark.get(s.external_id)?.set(s.to_snapshot_id, s.events);
    }

    const nowMs = Date.now();
    const decorated = rows.map(r => {
      const sparkline = snapshotsMeta.map(snap => ({
        snapshot_id: snap.id,
        snapshot_at: snap.snapshot_at,
        events: sparkByRemark.get(r.external_id)?.get(snap.id) || 0,
      }));

      let silence_hours = null;
      if (r.last_activity_at) {
        const t = Date.parse(r.last_activity_at);
        if (!isNaN(t)) silence_hours = Math.max(0, (nowMs - t) / 3_600_000);
      }

      return { ...r, sparkline, silence_hours };
    });

    return res.json({
      remarks: decorated,
      total,
      snapshots_meta: snapshotsMeta,
      latest_snapshot: latestSnap,
      page: { limit, offset },
    });
  } catch (err) {
    console.error('[remarks-monitor] dashboard error:', err);
    return res.status(500).json({ error: 'فشل تحميل اللوحة', details: err.message });
  }
});

// Helper: create a notification (fail-soft, mirrors snapshots.routes pattern)
function createNotification(userId, type, title, body, link = null, meta = null) {
  if (!userId) return;
  try {
    db.prepare(
      `INSERT INTO notifications (user_id, type, title, body, link, meta)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId, type, title, body || null, link || null,
      meta ? (typeof meta === 'string' ? meta : JSON.stringify(meta)) : null
    );
  } catch (e) { console.error('notify error:', e.message); }
}

// ─── POST /api/remarks-monitor/notify-stale ───────────────────────────────────
// Scans for remarks exceeding the silence threshold + sends notifications
router.post('/notify-stale', authenticate, requireRole('leader'), (req, res) => {
  const userLine = req.user?.line || 'Ahmed Hassan';
  let line = (req.body && req.body.line) || req.query.line || userLine;
  if (userLine !== 'All') line = userLine;
  if (!line || line === 'All') return res.status(400).json({ error: 'يجب تحديد الـ Line' });

  const category = req.body?.category || req.query.category || 'Inprogress';
  const thresholdHours = parseInt(req.body?.threshold_hours || req.query.threshold_hours, 10) || 24;
  const thresholdMinutes = thresholdHours * 60;

  try {
    const latestSnap = db.prepare(
      `SELECT id FROM remark_snapshots WHERE line = ? ORDER BY id DESC LIMIT 1`
    ).get(line);
    if (!latestSnap) return res.json({ message: 'لا توجد Snapshots', notifications_sent: 0 });

    const stale = db.prepare(
      `SELECT lr.external_id, lr.assigned_to, lr.task_type, lr.client_name,
              es.last_event_at
         FROM remark_snapshot_rows lr
         LEFT JOIN (
           SELECT external_id, line, MAX(occurred_at) as last_event_at
             FROM remark_activity_events
            WHERE line = ?
            GROUP BY external_id, line
         ) es ON lr.external_id = es.external_id AND lr.line = es.line
        WHERE lr.line = ?
          AND lr.snapshot_id = ?
          AND lr.category = ?
          AND lr.assigned_to IS NOT NULL AND lr.assigned_to != ''
          AND es.last_event_at IS NOT NULL
          AND (julianday('now', '+2 hours') - julianday(es.last_event_at)) * 1440 >= ?`
    ).all(line, line, latestSnap.id, category, thresholdMinutes);

    if (stale.length === 0) {
      return res.json({ message: 'لا توجد Remarks متجاوزة للعتبة', notifications_sent: 0, stale_count: 0 });
    }

    // Group by assignee
    const byAssignee = new Map();
    for (const r of stale) {
      if (!byAssignee.has(r.assigned_to)) byAssignee.set(r.assigned_to, []);
      byAssignee.get(r.assigned_to).push(r);
    }

    let sent = 0;
    // Notify each assignee (if their user account exists)
    for (const [name, remarks] of byAssignee.entries()) {
      const u = db.prepare(`SELECT id FROM users WHERE full_name = ? LIMIT 1`).get(name);
      if (!u) continue;
      const sample = remarks.slice(0, 3).map(r => `#${r.external_id}`).join('، ');
      const extra = remarks.length > 3 ? ` و${remarks.length - 3} أخرى` : '';
      createNotification(
        u.id,
        'remarks_stale',
        `⚠️ عندك ${remarks.length} Remark ساكتة أكتر من ${thresholdHours} ساعة`,
        `${sample}${extra}`,
        '/admin/remarks-monitor/category',
        { count: remarks.length, threshold_hours: thresholdHours, category }
      );
      sent++;
    }

    // Summary notification to the requester (leader/admin)
    createNotification(
      req.user.id,
      'remarks_stale_summary',
      `📊 تم إرسال تنبيهات السكوت — ${stale.length} Remark متجاوزة`,
      `${byAssignee.size} موظف لديهم Remarks ساكتة. عتبة: ${thresholdHours} ساعة`,
      '/admin/remarks-monitor/category',
      { total_stale: stale.length, assignees: byAssignee.size, threshold_hours: thresholdHours }
    );

    return res.json({
      message: 'تم إرسال التنبيهات',
      notifications_sent: sent,
      stale_count: stale.length,
      assignees_notified: byAssignee.size,
      threshold_hours: thresholdHours,
    });
  } catch (err) {
    console.error('[remarks-monitor] notify-stale error:', err);
    return res.status(500).json({ error: 'فشل إرسال التنبيهات', details: err.message });
  }
});

// ─── GET /api/remarks-monitor/compare-periods ─────────────────────────────────
// Compare two date ranges
router.get('/compare-periods', authenticate, (req, res) => {
  const userLine = req.user?.line || 'Ahmed Hassan';
  let line = req.query.line || userLine;
  if (userLine !== 'All') line = userLine;
  if (!line || line === 'All') return res.status(400).json({ error: 'يجب تحديد الـ Line' });

  const category = req.query.category || 'Inprogress';
  const p1Start = req.query.p1_start;
  const p1End   = req.query.p1_end;
  const p2Start = req.query.p2_start;
  const p2End   = req.query.p2_end;

  if (!p1Start || !p1End || !p2Start || !p2End) {
    return res.status(400).json({ error: 'يجب تحديد بداية ونهاية الفترتين' });
  }

  function periodStats(start, end) {
    const latestSnap = db.prepare(
      `SELECT id FROM remark_snapshots WHERE line = ? ORDER BY id DESC LIMIT 1`
    ).get(line);
    if (!latestSnap) return { total_events: 0, unique_remarks: 0, avg_events_per_day: 0, by_type: [] };

    const stats = db.prepare(
      `SELECT COUNT(*) as total_events,
              COUNT(DISTINCT e.external_id) as unique_remarks
         FROM remark_activity_events e
         INNER JOIN remark_snapshot_rows lr
                 ON e.external_id = lr.external_id AND e.line = lr.line
        WHERE e.line = ?
          AND lr.snapshot_id = ?
          AND lr.category = ?
          AND DATE(e.occurred_at) BETWEEN ? AND ?`
    ).get(line, latestSnap.id, category, start, end);

    const byType = db.prepare(
      `SELECT e.event_type, COUNT(*) as count
         FROM remark_activity_events e
         INNER JOIN remark_snapshot_rows lr
                 ON e.external_id = lr.external_id AND e.line = lr.line
        WHERE e.line = ?
          AND lr.snapshot_id = ?
          AND lr.category = ?
          AND DATE(e.occurred_at) BETWEEN ? AND ?
        GROUP BY e.event_type
        ORDER BY count DESC`
    ).all(line, latestSnap.id, category, start, end);

    const topAssignees = db.prepare(
      `SELECT lr.assigned_to, COUNT(*) as events_count
         FROM remark_activity_events e
         INNER JOIN remark_snapshot_rows lr
                 ON e.external_id = lr.external_id AND e.line = lr.line
        WHERE e.line = ?
          AND lr.snapshot_id = ?
          AND lr.category = ?
          AND lr.assigned_to IS NOT NULL AND lr.assigned_to != ''
          AND DATE(e.occurred_at) BETWEEN ? AND ?
        GROUP BY lr.assigned_to
        ORDER BY events_count DESC
        LIMIT 5`
    ).all(line, latestSnap.id, category, start, end);

    const dayCount = Math.max(1, (Date.parse(end) - Date.parse(start)) / 86400000 + 1);
    return {
      total_events: stats?.total_events || 0,
      unique_remarks: stats?.unique_remarks || 0,
      avg_events_per_day: Math.round(((stats?.total_events || 0) / dayCount) * 10) / 10,
      by_type: byType,
      top_assignees: topAssignees,
    };
  }

  try {
    return res.json({
      period1: { start: p1Start, end: p1End, ...periodStats(p1Start, p1End) },
      period2: { start: p2Start, end: p2End, ...periodStats(p2Start, p2End) },
      category, line,
    });
  } catch (err) {
    console.error('[remarks-monitor] compare-periods error:', err);
    return res.status(500).json({ error: 'فشل المقارنة', details: err.message });
  }
});

// ─── GET /api/remarks-monitor/employee-timeline ───────────────────────────────
// All events for remarks currently assigned to a specific person
router.get('/employee-timeline', authenticate, (req, res) => {
  const userLine = req.user?.line || 'Ahmed Hassan';
  let line = req.query.line || userLine;
  if (userLine !== 'All') line = userLine;
  if (!line || line === 'All') return res.status(400).json({ error: 'يجب تحديد الـ Line' });

  const assignee = req.query.assignee;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 180);
  const category = req.query.category || null;

  if (!assignee) return res.status(400).json({ error: 'يجب تحديد الموظف' });

  try {
    const latestSnap = db.prepare(
      `SELECT id FROM remark_snapshots WHERE line = ? ORDER BY id DESC LIMIT 1`
    ).get(line);
    if (!latestSnap) return res.json({ events: [], assignee, days });

    const wheres = ['lr.line = ?', 'lr.snapshot_id = ?', 'lr.assigned_to = ?'];
    const params = [line, latestSnap.id, assignee];
    if (category) { wheres.push('lr.category = ?'); params.push(category); }

    const events = db.prepare(
      `SELECT e.id, e.external_id, e.event_type, e.event_data, e.occurred_at,
              e.to_snapshot_id, lr.task_type, lr.client_name, lr.category, lr.priority
         FROM remark_activity_events e
         INNER JOIN remark_snapshot_rows lr
                 ON e.external_id = lr.external_id AND e.line = lr.line
        WHERE ${wheres.join(' AND ')}
          AND DATE(e.occurred_at) >= DATE('now', '+2 hours', ?)
        ORDER BY e.occurred_at DESC, e.id DESC
        LIMIT 500`
    ).all(...params, `-${days} days`);

    const parsed = events.map(ev => {
      let data = null;
      try { data = ev.event_data ? JSON.parse(ev.event_data) : null; } catch {}
      return { ...ev, event_data: data };
    });

    return res.json({
      events: parsed,
      assignee,
      days,
      total: parsed.length,
      line,
    });
  } catch (err) {
    console.error('[remarks-monitor] employee-timeline error:', err);
    return res.status(500).json({ error: 'فشل التحميل', details: err.message });
  }
});

// ─── GET /api/remarks-monitor/bottlenecks ─────────────────────────────────────
// Group by task_type to find bottlenecks
router.get('/bottlenecks', authenticate, (req, res) => {
  const userLine = req.user?.line || 'Ahmed Hassan';
  let line = req.query.line || userLine;
  if (userLine !== 'All') line = userLine;
  if (!line || line === 'All') return res.status(400).json({ error: 'يجب تحديد الـ Line' });

  const category = req.query.category || 'Inprogress';

  try {
    const latestSnap = db.prepare(
      `SELECT id FROM remark_snapshots WHERE line = ? ORDER BY id DESC LIMIT 1`
    ).get(line);
    if (!latestSnap) return res.json({ bottlenecks: [], category, line });

    const rows = db.prepare(
      `SELECT lr.external_id, lr.task_type,
              COALESCE(es.total_events, 0) as total_events,
              es.last_event_at, es.first_event_at
         FROM remark_snapshot_rows lr
         LEFT JOIN (
           SELECT external_id, line, COUNT(*) as total_events,
                  MIN(occurred_at) as first_event_at,
                  MAX(occurred_at) as last_event_at
             FROM remark_activity_events
            WHERE line = ?
            GROUP BY external_id, line
         ) es ON lr.external_id = es.external_id AND lr.line = es.line
        WHERE lr.line = ? AND lr.snapshot_id = ? AND lr.category = ?
          AND lr.task_type IS NOT NULL AND lr.task_type != ''`
    ).all(line, line, latestSnap.id, category);

    const byType = new Map();
    const nowMs = Date.now();
    for (const r of rows) {
      let agg = byType.get(r.task_type);
      if (!agg) {
        agg = {
          task_type: r.task_type,
          remarks_count: 0, total_events: 0,
          stalled_24h: 0, stalled_72h: 0,
          sum_silence: 0, max_silence: 0, silence_samples: 0,
          sum_active: 0, active_samples: 0,
        };
        byType.set(r.task_type, agg);
      }
      agg.remarks_count++;
      agg.total_events += r.total_events;
      if (r.last_event_at) {
        const t = Date.parse(r.last_event_at);
        if (!isNaN(t)) {
          const silence = Math.floor((nowMs - t) / 60000);
          agg.sum_silence += silence;
          agg.silence_samples++;
          if (silence > agg.max_silence) agg.max_silence = silence;
          if (silence > 1440) agg.stalled_24h++;
          if (silence > 4320) agg.stalled_72h++;
        }
      }
      if (r.first_event_at && r.last_event_at) {
        const t1 = Date.parse(r.first_event_at);
        const t2 = Date.parse(r.last_event_at);
        if (!isNaN(t1) && !isNaN(t2)) {
          const span = Math.floor((t2 - t1) / 60000);
          agg.sum_active += span;
          agg.active_samples++;
        }
      }
    }

    const bottlenecks = Array.from(byType.values()).map(agg => ({
      ...agg,
      avg_silence_minutes: agg.silence_samples > 0 ? Math.round(agg.sum_silence / agg.silence_samples) : null,
      avg_active_minutes:  agg.active_samples > 0 ? Math.round(agg.sum_active / agg.active_samples) : null,
      bottleneck_score: agg.stalled_24h * 2 + agg.stalled_72h * 5 + (agg.silence_samples > 0 ? (agg.sum_silence / agg.silence_samples / 60) : 0),
    })).sort((a, b) => b.bottleneck_score - a.bottleneck_score);

    return res.json({ bottlenecks, category, line, total_task_types: bottlenecks.length });
  } catch (err) {
    console.error('[remarks-monitor] bottlenecks error:', err);
    return res.status(500).json({ error: 'فشل التحميل', details: err.message });
  }
});

// ─── GET /api/remarks-monitor/leaderboard ─────────────────────────────────────
// Per-assignee aggregations for a given category
router.get('/leaderboard', authenticate, (req, res) => {
  const userLine = req.user?.line || 'Ahmed Hassan';
  let line = req.query.line || userLine;
  if (userLine !== 'All') line = userLine;
  if (!line || line === 'All') return res.status(400).json({ error: 'يجب تحديد الـ Line' });

  const category = req.query.category || 'Inprogress';
  const stalledThresholdMinutes = parseInt(req.query.stalled_minutes, 10) || 1440;

  try {
    const latestSnap = db.prepare(
      `SELECT id FROM remark_snapshots WHERE line = ? ORDER BY id DESC LIMIT 1`
    ).get(line);
    if (!latestSnap) return res.json({ leaderboard: [], category, line });

    const rows = db.prepare(
      `SELECT lr.external_id, lr.assigned_to,
              COALESCE(es.total_events, 0) as total_events,
              es.last_event_at, es.first_event_at
         FROM remark_snapshot_rows lr
         LEFT JOIN (
           SELECT external_id, line, COUNT(*) as total_events,
                  MIN(occurred_at) as first_event_at,
                  MAX(occurred_at) as last_event_at
             FROM remark_activity_events
            WHERE line = ?
            GROUP BY external_id, line
         ) es ON lr.external_id = es.external_id AND lr.line = es.line
        WHERE lr.line = ?
          AND lr.snapshot_id = ?
          AND lr.category = ?
          AND lr.assigned_to IS NOT NULL AND lr.assigned_to != ''`
    ).all(line, line, latestSnap.id, category);

    const byAssignee = new Map();
    const nowMs = Date.now();
    for (const r of rows) {
      let agg = byAssignee.get(r.assigned_to);
      if (!agg) {
        agg = {
          assigned_to: r.assigned_to,
          remarks_count: 0, total_events: 0,
          active_count: 0, stalled_count: 0, idle_count: 0,
          sum_silence_minutes: 0, silence_samples: 0,
          max_silence_minutes: 0, oldest_remark_age_minutes: 0,
        };
        byAssignee.set(r.assigned_to, agg);
      }
      agg.remarks_count++;
      agg.total_events += r.total_events || 0;
      if (r.last_event_at) {
        const t = Date.parse(r.last_event_at);
        if (!isNaN(t)) {
          const minutes = Math.floor(Math.max(0, nowMs - t) / 60000);
          agg.sum_silence_minutes += minutes;
          agg.silence_samples++;
          if (minutes > agg.max_silence_minutes) agg.max_silence_minutes = minutes;
          if (minutes <= 60) agg.active_count++;
          if (minutes > stalledThresholdMinutes) agg.stalled_count++;
        }
      } else {
        agg.idle_count++;
      }
      if (r.first_event_at) {
        const t = Date.parse(r.first_event_at);
        if (!isNaN(t)) {
          const minutes = Math.floor(Math.max(0, nowMs - t) / 60000);
          if (minutes > agg.oldest_remark_age_minutes) agg.oldest_remark_age_minutes = minutes;
        }
      }
    }

    const leaderboard = Array.from(byAssignee.values()).map(agg => ({
      ...agg,
      avg_silence_minutes: agg.silence_samples > 0 ? Math.round(agg.sum_silence_minutes / agg.silence_samples) : null,
    }));

    return res.json({ leaderboard, category, line, total_assignees: leaderboard.length });
  } catch (err) {
    console.error('[remarks-monitor] leaderboard error:', err);
    return res.status(500).json({ error: 'فشل التحميل', details: err.message });
  }
});

// ─── GET /api/remarks-monitor/daily-events ────────────────────────────────────
// Events count per day for the chart
router.get('/daily-events', authenticate, (req, res) => {
  const userLine = req.user?.line || 'Ahmed Hassan';
  let line = req.query.line || userLine;
  if (userLine !== 'All') line = userLine;
  if (!line || line === 'All') return res.status(400).json({ error: 'يجب تحديد الـ Line' });

  const category = req.query.category || 'Inprogress';
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 180);

  try {
    const latestSnap = db.prepare(
      `SELECT id FROM remark_snapshots WHERE line = ? ORDER BY id DESC LIMIT 1`
    ).get(line);
    if (!latestSnap) return res.json({ daily: [], days, category, line });

    const rows = db.prepare(
      `SELECT DATE(e.occurred_at) as day,
              COUNT(*) as events_count,
              COUNT(DISTINCT e.external_id) as remarks_touched
         FROM remark_activity_events e
         INNER JOIN remark_snapshot_rows lr
                 ON e.external_id = lr.external_id AND e.line = lr.line
        WHERE e.line = ?
          AND lr.category = ?
          AND lr.snapshot_id = ?
          AND DATE(e.occurred_at) >= DATE('now', '+2 hours', ?)
        GROUP BY DATE(e.occurred_at)
        ORDER BY day ASC`
    ).all(line, category, latestSnap.id, `-${days} days`);

    return res.json({ daily: rows, days, category, line });
  } catch (err) {
    console.error('[remarks-monitor] daily-events error:', err);
    return res.status(500).json({ error: 'فشل التحميل', details: err.message });
  }
});

// ─── GET /api/remarks-monitor/category-distribution ───────────────────────────
// Category-focused view (defaults to Inprogress) — shows per-Remark event
// metrics: total events, first/last event, time since last event (active duration).
router.get('/category-distribution', authenticate, (req, res) => {
  const userLine = req.user?.line || 'Ahmed Hassan';
  const role = req.user?.role || 'agent';
  let line = req.query.line || userLine;
  if (userLine !== 'All') line = userLine;

  if (!line || line === 'All') {
    return res.status(400).json({ error: 'يجب تحديد الـ Line' });
  }

  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  const category   = req.query.category   || 'Inprogress';
  const assignedTo = req.query.assigned_to || null;
  const search     = (req.query.search || '').trim();
  const sortBy     = req.query.sort || 'last_event_desc';
  const minEvents  = req.query.min_events != null ? parseInt(req.query.min_events, 10) : null;
  const maxEvents  = req.query.max_events != null ? parseInt(req.query.max_events, 10) : null;
  const minSilenceMin = req.query.min_silence_minutes != null ? parseInt(req.query.min_silence_minutes, 10) : null;

  try {
    const latestSnap = db.prepare(
      `SELECT id, snapshot_at FROM remark_snapshots WHERE line = ? ORDER BY id DESC LIMIT 1`
    ).get(line);

    if (!latestSnap) {
      return res.json({ remarks: [], total: 0, category, latest_snapshot: null });
    }

    const wheres = ['lr.line = ?', 'lr.snapshot_id = ?', 'lr.category = ?'];
    const params = [line, latestSnap.id, category];

    if (assignedTo) {
      wheres.push('lr.assigned_to = ?');
      params.push(assignedTo);
    }

    if (role === 'agent' && req.user?.full_name) {
      wheres.push('lr.assigned_to = ?');
      params.push(req.user.full_name);
    }

    if (search) {
      wheres.push(`(
        CAST(lr.external_id AS TEXT) LIKE ? OR
        lr.client_name LIKE ? OR
        lr.client_phone LIKE ? OR
        lr.assigned_to LIKE ?
      )`);
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    // Extra filters that need the joined stats table
    const havingClauses = [];
    const havingParams = [];
    if (minEvents != null)    { havingClauses.push('COALESCE(stats.total_events, 0) >= ?'); havingParams.push(minEvents); }
    if (maxEvents != null)    { havingClauses.push('COALESCE(stats.total_events, 0) <= ?'); havingParams.push(maxEvents); }
    if (minSilenceMin != null) {
      havingClauses.push(`stats.last_event_at IS NOT NULL AND (julianday('now', '+2 hours') - julianday(stats.last_event_at)) * 1440 >= ?`);
      havingParams.push(minSilenceMin);
    }
    const extraWhere = havingClauses.length ? ' AND ' + havingClauses.join(' AND ') : '';

    const whereClause = wheres.join(' AND ');

    const totalRow = db.prepare(
      `SELECT COUNT(*) as c FROM remark_snapshot_rows lr
         LEFT JOIN (
           SELECT external_id, line, COUNT(*) as total_events,
                  MIN(occurred_at) as first_event_at,
                  MAX(occurred_at) as last_event_at
             FROM remark_activity_events WHERE line = ?
            GROUP BY external_id, line
         ) stats ON lr.external_id = stats.external_id AND lr.line = stats.line
        WHERE ${whereClause}${extraWhere}`
    ).get(line, ...params, ...havingParams);
    const total = totalRow ? totalRow.c : 0;

    let orderBy = '';
    switch (sortBy) {
      case 'time_since_last_desc': orderBy = 'last_event_at ASC';  break;
      case 'events_desc':          orderBy = 'total_events DESC';  break;
      case 'first_event_asc':      orderBy = 'first_event_at ASC'; break;
      case 'last_event_desc':
      default:                     orderBy = 'last_event_at DESC'; break;
    }

    const rows = db.prepare(
      `SELECT lr.external_id, lr.task_type, lr.assigned_to, lr.details,
              lr.category, lr.status, lr.client_name, lr.client_phone,
              lr.priority, lr.assigned_by, lr.notes_count,
              lr.added_at, lr.last_updated,
              COALESCE(stats.total_events, 0) as total_events,
              stats.first_event_at,
              stats.last_event_at
         FROM remark_snapshot_rows lr
         LEFT JOIN (
           SELECT external_id, line, COUNT(*) as total_events,
                  MIN(occurred_at) as first_event_at,
                  MAX(occurred_at) as last_event_at
             FROM remark_activity_events
            WHERE line = ?
            GROUP BY external_id, line
         ) stats ON lr.external_id = stats.external_id AND lr.line = stats.line
        WHERE ${whereClause}${extraWhere}
        ORDER BY ${orderBy} NULLS LAST, lr.external_id DESC
        LIMIT ? OFFSET ?`
    ).all(line, ...params, ...havingParams, limit, offset);

    const nowMs = Date.now();
    function durationFromMs(ms) {
      const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
      const days    = Math.floor(totalMinutes / 1440);
      const hours   = Math.floor((totalMinutes % 1440) / 60);
      const minutes = totalMinutes % 60;
      return { days, hours, minutes, total_minutes: totalMinutes };
    }

    const decorated = rows.map(r => {
      let time_since_last = null;
      if (r.last_event_at) {
        const t = Date.parse(r.last_event_at);
        if (!isNaN(t)) time_since_last = durationFromMs(nowMs - t);
      }

      let active_span = null;
      if (r.first_event_at && r.last_event_at) {
        const t1 = Date.parse(r.first_event_at);
        const t2 = Date.parse(r.last_event_at);
        if (!isNaN(t1) && !isNaN(t2)) active_span = durationFromMs(t2 - t1);
      }

      return { ...r, time_since_last, active_span };
    });

    return res.json({
      remarks: decorated,
      total,
      category,
      latest_snapshot: latestSnap,
      page: { limit, offset },
    });
  } catch (err) {
    console.error('[remarks-monitor] category-distribution error:', err);
    return res.status(500).json({ error: 'فشل التحميل', details: err.message });
  }
});

// ─── GET /api/remarks-monitor/timeline/:externalId ────────────────────────────
// Full activity timeline for a single remark
router.get('/timeline/:externalId', authenticate, (req, res) => {
  const externalId = Number(req.params.externalId);
  if (!Number.isFinite(externalId)) {
    return res.status(400).json({ error: 'رقم Remark غير صالح' });
  }

  const userLine = req.user?.line || 'Ahmed Hassan';
  let line = req.query.line || userLine;
  if (userLine !== 'All') line = userLine;

  if (!line || line === 'All') {
    return res.status(400).json({ error: 'يجب تحديد الـ Line' });
  }

  try {
    const currentState = db.prepare(
      `SELECT lr.*
         FROM remark_snapshot_rows lr
        WHERE lr.line = ? AND lr.external_id = ?
          AND lr.snapshot_id = (SELECT MAX(id) FROM remark_snapshots WHERE line = ?)
        LIMIT 1`
    ).get(line, externalId, line);

    if (!currentState) {
      return res.status(404).json({ error: 'الـ Remark غير موجود في آخر Snapshot' });
    }

    const events = db.prepare(
      `SELECT e.id, e.event_type, e.event_data, e.occurred_at,
              e.from_snapshot_id, e.to_snapshot_id,
              s.snapshot_at
         FROM remark_activity_events e
         LEFT JOIN remark_snapshots s ON e.to_snapshot_id = s.id
        WHERE e.external_id = ? AND e.line = ?
        ORDER BY e.occurred_at ASC, e.id ASC`
    ).all(externalId, line);

    const parsed = events.map(e => {
      let data = null;
      try { data = e.event_data ? JSON.parse(e.event_data) : null; } catch { data = null; }
      return { ...e, event_data: data };
    });

    return res.json({
      remark: currentState,
      events: parsed,
      total_events: parsed.length,
    });
  } catch (err) {
    console.error('[remarks-monitor] timeline error:', err);
    return res.status(500).json({ error: 'فشل تحميل الـ Timeline', details: err.message });
  }
});

module.exports = router;
