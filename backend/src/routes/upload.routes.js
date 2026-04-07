'use strict';
const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { syncFile, FILE_TYPES } = require('../services/sync.service');

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
router.post('/:fileType', authenticate, requireRole('leader'), upload.single('file'), (req, res) => {
  const { fileType } = req.params;
  if (!FILE_TYPES.includes(fileType)) {
    return res.status(400).json({ error: `Invalid fileType. Must be one of: ${FILE_TYPES.join(', ')}` });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const rows = syncFile(fileType, req.file.buffer, req.user.id, req.file.originalname);
    return res.json({ message: 'Import successful', fileType, inserted: rows, rows_imported: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Import failed', details: err.message });
  }
});

module.exports = router;
