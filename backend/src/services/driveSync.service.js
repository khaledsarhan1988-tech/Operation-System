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

const XLSX = require('xlsx');
const drive = require('./googleDrive.service');
const { syncFile, VALID_LINES } = require('./sync.service');
const db = require('../config/database');
const { saveNow } = require('../config/database');

// ─── SMART VALIDATION — anomaly detection thresholds ──────────────────────────
// These guard against catastrophic data loss when a wrong/corrupted file lands
// on Drive (e.g., team accidentally uploads an empty template or a draft with
// only a few rows). All thresholds are conservative — they only fire for the
// kind of changes that almost-certainly indicate a mistake, not normal
// day-to-day fluctuations.
const ANOMALY_BASELINE_FLOOR = 10;   // skip validation if last import had < this many rows
const ANOMALY_EMPTY_FLOOR    = 5;    // < this many new rows is always suspicious
const ANOMALY_EMPTY_PCT      = 0.05; // OR < 5% of last import = empty/near-empty
const ANOMALY_DROP_PCT       = 0.50; // > 50% drop = anomaly
const ANOMALY_SURGE_MULT     = 4;    // > 4x previous = anomaly

const SYSTEM_USER_ID = 0; // sentinel for cron-initiated syncs

/**
 * Returns "today" in a specific IANA timezone, as a Date object positioned at
 * noon UTC of that calendar day. Using noon UTC avoids midnight-boundary
 * ambiguity when prepareDayFolders() / sync logic later extracts year/month/day
 * via getFullYear()/getMonth()/getDate() — even on a UTC server, noon UTC
 * always falls within the same calendar day in both UTC and Cairo.
 *
 * Necessary because cron-fired jobs that schedule in Cairo time still receive
 * `new Date()` in the SERVER's local time (UTC on Railway), so the calendar
 * date can drift by one day between the cron firing time and the date used
 * for folder names.
 */
function todayInTimezone(timeZone = 'Africa/Cairo') {
  // 'en-CA' gives YYYY-MM-DD format
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone });
  return new Date(`${dateStr}T12:00:00Z`);
}

/**
 * Returns metadata about the most-recent successful import for (fileType, line):
 *   { timeMs: number, driveFileId: string|null }
 *
 * Smart Sync uses BOTH:
 *   - driveFileId to detect "is this the same file as last time?"
 *   - timeMs as a fallback for files imported before the drive_file_id column
 *     existed, or for manual uploads (which have no Drive file ID)
 *
 * The excel_syncs.created_at is stored via SQLite datetime('now','localtime')
 * which on Railway (UTC server) equals UTC.
 */
function getLastImport(fileType, line) {
  try {
    const row = db.prepare(`
      SELECT created_at, drive_file_id
      FROM excel_syncs
      WHERE file_type = ? AND line = ? AND status = 'success'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(fileType, line);
    if (!row || !row.created_at) return { timeMs: null, driveFileId: null };
    const iso = String(row.created_at).replace(' ', 'T') + 'Z';
    const t = Date.parse(iso);
    return {
      timeMs: Number.isFinite(t) ? t : null,
      driveFileId: row.drive_file_id || null,
    };
  } catch (_) {
    return { timeMs: null, driveFileId: null };
  }
}

// Backward-compat: callers that only need the time
function getLastImportTime(fileType, line) {
  return getLastImport(fileType, line).timeMs;
}

/**
 * Quickly counts the data rows in an .xlsx buffer by reading sheet metadata
 * (range), without parsing every cell. Returns -1 if it can't be determined.
 * Slightly over-counts because it includes the header row + any blank trailing
 * rows, which is fine for order-of-magnitude anomaly detection.
 */
function countRowsInXlsx(buffer) {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', bookSheets: true, sheetRows: 0 });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) return 0;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    return Math.max(0, range.e.r - range.s.r); // subtract 1 to exclude header
  } catch (_) {
    return -1;
  }
}

/**
 * Compares a new file's row count against the last successful import for
 * (fileType, line). Returns { ok: true } if the change is normal, or
 * { ok: false, code, lastRows, newRows, ... } describing the anomaly.
 *
 * Anomaly codes:
 *   - 'empty_or_near_empty' — file is essentially empty (< 5 rows or < 5% of baseline)
 *   - 'large_drop'          — > 50% fewer rows than last import
 *   - 'large_surge'         — > 4x more rows than last import
 *
 * Returns ok=true (no validation) when:
 *   - We can't read the row count
 *   - There's no previous import (first time)
 *   - Last import had < 10 rows (baseline too small to compare)
 */
function detectAnomaly(fileType, line, newRows) {
  if (newRows < 0) return { ok: true, reason: 'count_unknown' };

  const lastSync = db.prepare(`
    SELECT rows_imported FROM excel_syncs
    WHERE file_type = ? AND line = ? AND status = 'success'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(fileType, line);

  if (!lastSync) return { ok: true, reason: 'no_baseline' };

  const lastRows = lastSync.rows_imported || 0;
  if (lastRows < ANOMALY_BASELINE_FLOOR) return { ok: true, reason: 'baseline_too_small' };

  // Empty / near-empty — strongest signal something is wrong
  if (newRows < Math.max(ANOMALY_EMPTY_FLOOR, lastRows * ANOMALY_EMPTY_PCT)) {
    return {
      ok: false,
      code: 'empty_or_near_empty',
      lastRows,
      newRows,
      message: `الملف الجديد فيه ${newRows} صف فقط مقارنة بـ ${lastRows} في آخر استيراد ناجح.`,
    };
  }

  // Large drop (> 50% drop)
  if (newRows < lastRows * (1 - ANOMALY_DROP_PCT)) {
    const dropPct = Math.round(((lastRows - newRows) / lastRows) * 100);
    return {
      ok: false,
      code: 'large_drop',
      lastRows,
      newRows,
      changePct: -dropPct,
      message: `هبوط كبير: ${lastRows} → ${newRows} صف (-${dropPct}%).`,
    };
  }

  // Large surge (> 4x previous)
  if (newRows > lastRows * ANOMALY_SURGE_MULT) {
    const surgePct = Math.round(((newRows - lastRows) / lastRows) * 100);
    return {
      ok: false,
      code: 'large_surge',
      lastRows,
      newRows,
      changePct: surgePct,
      message: `قفزة كبيرة: ${lastRows} → ${newRows} صف (+${surgePct}%).`,
    };
  }

  return { ok: true };
}

/**
 * Pulls the latest file from each File Type folder for a (line, date) and imports it.
 *
 * Smart Sync: by default, skips files whose Drive modifiedTime is not newer
 * than the last successful import. Pass `force: true` to override and re-import
 * everything regardless.
 *
 * @param {Object} opts
 * @param {string} opts.line          — must be in VALID_LINES
 * @param {Date}   opts.date          — calendar day to look up
 * @param {number} [opts.userId=0]    — uploader id stored in excel_syncs (0 = system)
 * @param {string[]} [opts.fileTypes] — restrict to a subset; defaults to all 7
 * @param {boolean} [opts.force=false] — if true, re-import even unchanged files
 * @returns {Object} { line, date, summary, results }
 */
async function syncLineForDate({ line, date, userId = SYSTEM_USER_ID, fileTypes, force = false } = {}) {
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

      // Smart Sync: skip only when we're SURE this exact file has already been
      // imported. The check uses BOTH file IDENTITY and time:
      //   1. If last import's drive_file_id == current latest.id → same file →
      //      compare effective time, skip only if not modified since import.
      //   2. If last import's drive_file_id != current latest.id → DIFFERENT file
      //      on Drive → ALWAYS import (we've never seen this file before).
      //   3. If last import has no drive_file_id (legacy/manual upload) → fall
      //      back to time-only check.
      if (!force) {
        const lastImport = getLastImport(fileType, line);
        const driveMs = Date.parse(latest.effectiveModifiedTime || latest.modifiedTime);

        const sameFile = lastImport.driveFileId && lastImport.driveFileId === latest.id;
        const noFileIdRecorded = !lastImport.driveFileId;
        const fileNotModified = lastImport.timeMs && Number.isFinite(driveMs) && driveMs <= lastImport.timeMs;

        // Skip when: it's the SAME Drive file AND hasn't been modified since import
        // OR when: legacy record (no file_id) AND time check passes
        const shouldSkip = (sameFile && fileNotModified) || (noFileIdRecorded && fileNotModified);

        if (shouldSkip) {
          results.push({
            fileType,
            status: 'skipped',
            reason: 'unchanged',
            filename: latest.name,
            driveFileId: latest.id,
            modifiedTime: latest.modifiedTime,
            createdTime: latest.createdTime,
            effectiveModifiedTime: latest.effectiveModifiedTime,
            lastImportAt: new Date(lastImport.timeMs).toISOString(),
          });
          skipped++;
          continue;
        }
      }

      const buffer = await drive.downloadFile(latest.id);

      // Smart Validation: detect anomalies BEFORE writing to DB.
      // Force mode bypasses this — the user has explicitly opted in.
      if (!force) {
        const approxRows = countRowsInXlsx(buffer);
        const anomaly = detectAnomaly(fileType, line, approxRows);
        if (!anomaly.ok) {
          results.push({
            fileType,
            status: 'skipped',
            reason: 'anomaly_detected',
            filename: latest.name,
            driveFileId: latest.id,
            modifiedTime: latest.modifiedTime,
            anomaly,
          });
          skipped++;
          continue;
        }
      }

      const result = syncFile(fileType, buffer, userId, latest.name, line, {
        driveFileId: latest.id,
      });

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
async function syncMultipleLinesToday({ lines, userId = SYSTEM_USER_ID, force = false } = {}) {
  const linesToSync = (Array.isArray(lines) && lines.length > 0 ? lines : VALID_LINES)
    .filter((l) => VALID_LINES.includes(l));

  // Use Cairo's "today" so the calendar date is consistent with how the team
  // organizes Drive folders. Without this, a cron that fires between 00:00 and
  // 03:00 Cairo (21:00-00:00 UTC of prev day) would look at YESTERDAY's folder.
  const today = todayInTimezone('Africa/Cairo');
  const perLine = [];
  for (const line of linesToSync) {
    try {
      // Hourly safety net: ensure today's folders exist before trying to sync
      // them. If the prep cron missed (e.g. server restart at 00:30), this
      // catches it within an hour. Idempotent — existing folders are kept.
      try {
        const r = await drive.prepareDayFolders(line, today);
        const made = r.folders.filter((f) => f.created).length;
        if (made > 0) {
          console.log(`📁 Auto-sync safety: created ${made} missing folders for ${line} ${r.date}`);
        }
      } catch (e) {
        console.error(`Auto-sync safety prep ${line} failed:`, e.message);
      }

      const r = await syncLineForDate({ line, date: today, userId, force });
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
  getLastImport,
  getLastImportTime,
  detectAnomaly,
  countRowsInXlsx,
  todayInTimezone,
  SYSTEM_USER_ID,
};
