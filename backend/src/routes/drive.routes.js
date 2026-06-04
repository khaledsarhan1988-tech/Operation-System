'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const drive = require('../services/googleDrive.service');
const driveSync = require('../services/driveSync.service');
const { VALID_LINES } = require('../services/sync.service');
const db = require('../config/database');

const router = express.Router();

// Re-match cascade — Drive syncs land new clients/batches in the DB. Without
// re-running the matcher, finance_transactions that were marked 'unmatched'
// at last attempt stay unmatched even though the data they needed is now
// present. We fire matchAll({scope:'unmatched'}) after every successful
// sync so the admin doesn't have to remember to click "إعادة محاولة" on
// the matching page. Manual matches are sticky (see financeMatcher.service)
// so this can never erase an explicit pairing.
function cascadeRematch() {
  try {
    const matcher = require('../services/financeMatcher.service');
    const lifecycle = require('../services/clientLifecycle.service');
    return matcher.matchAll({
      scope: 'unmatched',
      onMatched: (cid, txId) => {
        try { lifecycle.regenerateFromTransactionId(txId); }
        catch (e) { console.error('lifecycle hook error:', e.message); }
      },
    });
  } catch (e) {
    console.error('[drive] cascade rematch error:', e.message);
    return { error: e.message };
  }
}

// Super-Admin only: department managers (admin بـ management != 'All')
// ما يقدروش يستخدموا الـ Drive sync. الرفع للمسؤول العام فقط.
router.use(authenticate, (req, res, next) => {
  if (req.user?.role !== 'admin' || req.user?.management !== 'All') {
    return res.status(403).json({ error: 'صلاحية Drive للمسؤول العام فقط (Super Admin)' });
  }
  next();
});

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
    const rematch = cascadeRematch();
    return res.json({ ...result, rematch });
  } catch (err) {
    return res.status(500).json({ error: 'Sync failed', details: err.message });
  }
});

// POST /api/drive/backfill-range — re-sync EVERY day in [from, to] for the given
// lines (force=true by default). One-off RECOVERY tool: with the history-preserving
// importers (delete-by-group+date), replaying each historical day rebuilds any
// previously-wiped history WITHOUT deleting what is already there. Runs
// synchronously; a multi-week range can take a few minutes (each day pulls all
// file types). Even if the HTTP client times out, the server keeps committing
// per file, so the recovery still completes — re-check via /sync-runs or reports.
router.post('/backfill-range', express.json(), async (req, res) => {
  const { from, to, lines: linesParam, fileTypes, force } = req.body || {};
  const fromD = parseDate(from), toD = parseDate(to);
  if (!from || !to || Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
    return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD).' });
  }
  // Enumerate the days at noon UTC (avoids midnight TZ drift in folder lookup).
  const cur = new Date(Date.UTC(fromD.getUTCFullYear(), fromD.getUTCMonth(), fromD.getUTCDate(), 12));
  const end = new Date(Date.UTC(toD.getUTCFullYear(), toD.getUTCMonth(), toD.getUTCDate(), 12));
  if (end < cur) return res.status(400).json({ error: 'to must be on or after from.' });
  const days = [];
  for (let d = new Date(cur); d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(new Date(d));
  if (days.length > 120) return res.status(400).json({ error: 'Range too large (max 120 days).' });

  // Resolve target lines (lock non-All users to their own line).
  const userLine = req.user.line || 'Ahmed Hassan';
  let lines = Array.isArray(linesParam) && linesParam.length ? linesParam : VALID_LINES;
  if (userLine !== 'All') lines = [userLine];
  lines = lines.filter((l) => VALID_LINES.includes(l));
  if (!lines.length) return res.status(400).json({ error: 'No valid lines to sync.' });

  const results = [];
  let ok = 0, failed = 0;
  for (const line of lines) {
    for (const date of days) {
      const iso = date.toISOString().slice(0, 10);
      try {
        const r = await driveSync.syncLineForDate({
          line, date, userId: req.user.id, fileTypes, force: force !== false,
        });
        results.push({ line, date: iso, status: 'ok', summary: r.summary });
        ok++;
      } catch (err) {
        results.push({ line, date: iso, status: 'error', error: err.message });
        failed++;
      }
    }
  }
  const rematch = cascadeRematch();
  return res.json({
    from: days[0].toISOString().slice(0, 10),
    to: days[days.length - 1].toISOString().slice(0, 10),
    lines, days: days.length, ok, failed, results, rematch,
  });
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
    const rematch = cascadeRematch();
    return res.json({ ...result, rematch });
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
    const rematch = cascadeRematch();
    return res.json({ ...result, rematch });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
