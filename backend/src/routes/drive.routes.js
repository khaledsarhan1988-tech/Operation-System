'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const drive = require('../services/googleDrive.service');
const driveSync = require('../services/driveSync.service');
const { VALID_LINES } = require('../services/sync.service');
const db = require('../config/database');

const router = express.Router();

// Resolve the line a request should target, honoring line restrictions.
function resolveLine(req, requestedLine) {
  const userLine = req.user.line || 'Ahmed Hassan';
  let line = requestedLine;

  if (userLine !== 'All') {
    line = userLine; // lock non-All users to their own line
  }

  if (!line) {
    return { error: `Line is required. Must be one of: ${VALID_LINES.join(', ')}` };
  }
  if (!VALID_LINES.includes(line)) {
    return { error: `Invalid line: ${line}. Must be one of: ${VALID_LINES.join(', ')}` };
  }
  return { line };
}

function parseDate(input) {
  if (!input) return new Date();
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// GET /api/drive/status — verify connection and return config
router.get('/status', authenticate, requireRole('leader'), async (req, res) => {
  try {
    const root = await drive.verifyConnection();
    return res.json({
      connected: true,
      rootFolder: { id: root.id, name: root.name },
      fileTypeFolders: drive.FILE_TYPE_FOLDERS,
      lines: VALID_LINES,
    });
  } catch (err) {
    return res.status(500).json({
      connected: false,
      error: err.message,
    });
  }
});

// GET /api/drive/files?line=X&date=YYYY-MM-DD
// Returns latest file per File Type folder + Smart Sync hint (changed/unchanged).
router.get('/files', authenticate, requireRole('leader'), async (req, res) => {
  const { line: lineParam, date: dateParam } = req.query;
  const { line, error } = resolveLine(req, lineParam);
  if (error) return res.status(400).json({ error });

  const date = parseDate(dateParam);
  if (!date) return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD.' });

  try {
    const files = await drive.getLatestFilesForDay(line, date);
    // Annotate each file with `changed` (true if Drive modifiedTime > last import time).
    // null = no file or never imported; we treat that as "changed/eligible".
    const annotated = {};
    for (const [fileType, file] of Object.entries(files)) {
      if (!file || !file.id) {
        annotated[fileType] = file;
        continue;
      }
      // Use the same logic as syncLineForDate (file ID + time) so the preview
      // exactly matches what will happen on sync.
      const lastImport = driveSync.getLastImport
        ? driveSync.getLastImport(fileType, line)
        : { timeMs: driveSync.getLastImportTime(fileType, line), driveFileId: null };
      const driveMs = Date.parse(file.effectiveModifiedTime || file.modifiedTime);

      const sameFile = lastImport.driveFileId && lastImport.driveFileId === file.id;
      const noFileIdRecorded = !lastImport.driveFileId;
      const fileNotModified = lastImport.timeMs && Number.isFinite(driveMs) && driveMs <= lastImport.timeMs;

      // "changed" = NOT (same file AND not modified) AND NOT (legacy AND time-stable)
      const changed = !((sameFile && fileNotModified) || (noFileIdRecorded && fileNotModified));

      annotated[fileType] = {
        ...file,
        lastImportAt: lastImport.timeMs ? new Date(lastImport.timeMs).toISOString() : null,
        lastImportedFileId: lastImport.driveFileId,
        changed,
      };
    }
    return res.json({
      line,
      date: date.toISOString().slice(0, 10),
      files: annotated,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list Drive files', details: err.message });
  }
});

// POST /api/drive/prepare-folders
// Body: { line, date (optional, defaults to today) }
// Pre-creates Line/YYYY/MM/DD/<all 7 File Type folders>. Idempotent.
router.post('/prepare-folders', authenticate, requireRole('leader'), express.json(), async (req, res) => {
  const { line: lineParam, date: dateParam } = req.body || {};
  const { line, error } = resolveLine(req, lineParam);
  if (error) return res.status(400).json({ error });

  const date = parseDate(dateParam);
  if (!date) return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD.' });

  try {
    const result = await drive.prepareDayFolders(line, date);
    const createdCount  = result.folders.filter(f => f.created).length;
    const existingCount = result.folders.length - createdCount;
    return res.json({
      ...result,
      summary: { created: createdCount, existing: existingCount, total: result.folders.length },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to prepare folders', details: err.message });
  }
});

// POST /api/drive/sync
// Body: { line, date, fileTypes?, force? }
// force=true → re-import even unchanged files (default false = Smart Sync)
router.post('/sync', authenticate, requireRole('leader'), express.json(), async (req, res) => {
  const { line: lineParam, date: dateParam, fileTypes, force } = req.body || {};
  const { line, error } = resolveLine(req, lineParam);
  if (error) return res.status(400).json({ error });

  const date = parseDate(dateParam);
  if (!date) return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD.' });

  try {
    const result = await driveSync.syncLineForDate({
      line,
      date,
      userId: req.user.id,
      fileTypes,
      force: force === true,
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Sync failed', details: err.message });
  }
});

// POST /api/drive/sync-today
router.post('/sync-today', authenticate, requireRole('leader'), express.json(), async (req, res) => {
  const userLine = req.user.line || 'Ahmed Hassan';
  const requestedLines = Array.isArray(req.body?.lines) && req.body.lines.length > 0
    ? req.body.lines
    : VALID_LINES;

  const lines = userLine === 'All'
    ? requestedLines.filter((l) => VALID_LINES.includes(l))
    : [userLine];

  if (lines.length === 0) {
    return res.status(400).json({ error: 'No valid lines to sync.' });
  }

  try {
    const result = await driveSync.syncMultipleLinesToday({
      lines,
      userId: req.user.id,
      force: req.body?.force === true,
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Sync failed', details: err.message });
  }
});

// GET /api/drive/sync-runs?limit=50
// Returns recent auto-sync history (cron + manual runs that went through runAutoSync).
router.get('/sync-runs', authenticate, requireRole('leader'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  try {
    const rows = db.prepare(`
      SELECT id, trigger, status, started_at, finished_at, duration_ms,
             imported, skipped, failed, error_msg
      FROM drive_sync_runs
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
    return res.json({ runs: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load sync history', details: err.message });
  }
});

// GET /api/drive/sync-runs/:id — fetch full details_json for one run
router.get('/sync-runs/:id', authenticate, requireRole('leader'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const row = db.prepare(`SELECT * FROM drive_sync_runs WHERE id = ?`).get(id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    let details = null;
    try { details = row.details_json ? JSON.parse(row.details_json) : null; } catch (_) {}
    return res.json({ ...row, details });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/drive/run-auto-now — manually trigger the auto-sync logic (admin only)
// Useful for testing the cron path without waiting.
router.post('/run-auto-now', authenticate, requireRole('admin'), express.json(), async (req, res) => {
  try {
    const result = await driveSync.runAutoSync('manual');
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
