'use strict';

/**
 * High-level Drive sync logic.
 *
 * Wraps googleDrive.service (Drive API) + sync.service (Excel parsers + DB writes)
 * into reusable functions that both the manual route handlers AND the cron job
 * can call uniformly.
 *
 * No HTTP concerns here — pure business logic.
 */

const drive = require('./googleDrive.service');
const { syncFile, VALID_LINES } = require('./sync.service');
const db = require('../config/database');
const { saveNow } = require('../config/database');

const SYSTEM_USER_ID = 0; // sentinel for cron-initiated syncs

/**
 * Pulls the latest file from each File Type folder for a (line, date) and imports it.
 *
 * @param {Object} opts
 * @param {string} opts.line          — must be in VALID_LINES
 * @param {Date}   opts.date          — calendar day to look up
 * @param {number} [opts.userId=0]    — uploader id stored in excel_syncs (0 = system)
 * @param {string[]} [opts.fileTypes] — restrict to a subset; defaults to all 7
 * @returns {Object} { line, date, summary, results }
 */
async function syncLineForDate({ line, date, userId = SYSTEM_USER_ID, fileTypes } = {}) {
  if (!VALID_LINES.includes(line)) {
    throw new Error(`Invalid line: ${line}`);
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('Invalid date');
  }

  const targetTypes = Array.isArray(fileTypes) && fileTypes.length > 0
    ? fileTypes.filter((t) => drive.ALL_FILE_TYPES.includes(t))
    : drive.ALL_FILE_TYPES;

  const results = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const fileType of targetTypes) {
    try {
      const folderId = await drive.getOrCreateDatePath(line, date, fileType, { createIfMissing: false });
      if (!folderId) {
        results.push({ fileType, status: 'skipped', reason: 'folder_missing' });
        skipped++;
        continue;
      }

      const latest = await drive.getLatestFileInFolder(folderId);
      if (!latest) {
        results.push({ fileType, status: 'skipped', reason: 'folder_empty' });
        skipped++;
        continue;
      }

      const buffer = await drive.downloadFile(latest.id);
      const result = syncFile(fileType, buffer, userId, latest.name, line);

      results.push({
        fileType,
        status: 'imported',
        filename: latest.name,
        driveFileId: latest.id,
        modifiedTime: latest.modifiedTime,
        rows_imported: result.rows_imported,
        warnings: result.warnings || [],
      });
      imported++;
    } catch (err) {
      results.push({ fileType, status: 'failed', error: err.message });
      failed++;
    }
  }

  return {
    line,
    date: date.toISOString().slice(0, 10),
    summary: { imported, skipped, failed, total: targetTypes.length },
    results,
  };
}

/**
 * Convenience: sync today's files for one or more lines.
 *
 * @param {Object} opts
 * @param {string[]} [opts.lines]      — defaults to all VALID_LINES
 * @param {number}   [opts.userId=0]
 * @returns {Object} { date, lines: [...] }
 */
async function syncMultipleLinesToday({ lines, userId = SYSTEM_USER_ID } = {}) {
  const linesToSync = (Array.isArray(lines) && lines.length > 0 ? lines : VALID_LINES)
    .filter((l) => VALID_LINES.includes(l));

  const today = new Date();
  const perLine = [];
  for (const line of linesToSync) {
    try {
      const r = await syncLineForDate({ line, date: today, userId });
      perLine.push(r);
    } catch (err) {
      perLine.push({
        line,
        date: today.toISOString().slice(0, 10),
        summary: { imported: 0, skipped: 0, failed: drive.ALL_FILE_TYPES.length, total: drive.ALL_FILE_TYPES.length },
        results: [],
        error: err.message,
      });
    }
  }
  return {
    date: today.toISOString().slice(0, 10),
    lines: perLine,
  };
}

/**
 * Run the auto-sync job and persist the result to drive_sync_runs.
 * Called by the cron job. Idempotent — safe to invoke multiple times.
 *
 * @param {string} trigger — 'cron' | 'manual'
 */
async function runAutoSync(trigger = 'cron') {
  const startedAt = new Date();
  let outcome = { date: null, lines: [] };
  let errorMsg = null;
  let status = 'success';

  try {
    outcome = await syncMultipleLinesToday({ userId: SYSTEM_USER_ID });
  } catch (err) {
    status = 'error';
    errorMsg = err.message;
  }

  const finishedAt = new Date();
  const durationMs = finishedAt - startedAt;

  // Aggregate totals across all lines
  let totalImported = 0, totalSkipped = 0, totalFailed = 0;
  for (const lineRes of outcome.lines || []) {
    if (lineRes.summary) {
      totalImported += lineRes.summary.imported || 0;
      totalSkipped  += lineRes.summary.skipped  || 0;
      totalFailed   += lineRes.summary.failed   || 0;
    }
  }
  if (totalFailed > 0 && status !== 'error') status = 'partial';

  try {
    db.prepare(`
      INSERT INTO drive_sync_runs
        (trigger, status, started_at, finished_at, duration_ms, imported, skipped, failed, error_msg, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trigger,
      status,
      startedAt.toISOString(),
      finishedAt.toISOString(),
      durationMs,
      totalImported,
      totalSkipped,
      totalFailed,
      errorMsg,
      JSON.stringify(outcome).slice(0, 50_000) // cap to avoid bloat
    );
    saveNow();
  } catch (logErr) {
    console.error('drive_sync_runs log insert failed:', logErr.message);
  }

  return {
    trigger,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    totals: { imported: totalImported, skipped: totalSkipped, failed: totalFailed },
    error: errorMsg,
    outcome,
  };
}

module.exports = {
  syncLineForDate,
  syncMultipleLinesToday,
  runAutoSync,
  SYSTEM_USER_ID,
};
