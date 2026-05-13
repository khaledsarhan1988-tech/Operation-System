'use strict';
const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const db = require('../config/database');
const { ingestSnapshot, ingestSnapshotFromDb, deleteSnapshot } = require('../services/remarksMonitor.service');

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

module.exports = router;
