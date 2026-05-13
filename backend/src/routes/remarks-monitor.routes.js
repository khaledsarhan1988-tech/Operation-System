'use strict';
const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { ingestSnapshot, ingestSnapshotFromDb } = require('../services/remarksMonitor.service');

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

module.exports = router;
