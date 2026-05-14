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
