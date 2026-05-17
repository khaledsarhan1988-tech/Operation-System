'use strict';
const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { syncFile, FILE_TYPES, VALID_LINES } = require('../services/sync.service');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
  fileFilter: (req, file, cb) => {
    const ok = /\.xlsx$/i.test(file.originalname) ||
               file.mimetype.includes('spreadsheetml') ||
               file.mimetype.includes('excel');
    cb(ok ? null : new Error('Only .xlsx files allowed'), ok);
  },
});

// POST /api/upload/:fileType
// Required body/query: line  (Ahmed Hassan | Dardasha)
router.post('/:fileType', authenticate, requireRole('admin'), upload.single('file'), (req, res) => {
  // Super-Admin only: department managers (admin بـ management != 'All')
  // ما يقدروش يرفعوا ملفات Excel. الرفع للمسؤول العام فقط.
  if (req.user?.management !== 'All') {
    return res.status(403).json({ error: 'صلاحية رفع الملفات للمسؤول العام فقط (Super Admin)' });
  }

  const { fileType } = req.params;
  if (!FILE_TYPES.includes(fileType)) {
    return res.status(400).json({ error: `Invalid fileType. Must be one of: ${FILE_TYPES.join(', ')}` });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // Line selection — REQUIRED. Try body first, then query. Multer parses multipart form body.
  let line = (req.body && req.body.line) || req.query.line;

  // Non-'All' users can ONLY upload for their own line
  const userLine = req.user.line || 'Ahmed Hassan';
  if (userLine !== 'All') {
    line = userLine;
  }

  if (!line) {
    return res.status(400).json({
      error: 'Line is required',
      details: `Specify line in form data. Must be one of: ${VALID_LINES.join(', ')}`,
    });
  }
  if (!VALID_LINES.includes(line)) {
    return res.status(400).json({ error: `Invalid line. Must be one of: ${VALID_LINES.join(', ')}` });
  }

  try {
    const result = syncFile(fileType, req.file.buffer, req.user.id, req.file.originalname, line);
    return res.json({
      message: 'Import successful',
      fileType,
      line,
      inserted: result.rows_imported,
      rows_imported: result.rows_imported,
      warnings: result.warnings || [],
    });
  } catch (err) {
    return res.status(500).json({ error: 'Import failed', details: err.message });
  }
});

module.exports = router;
