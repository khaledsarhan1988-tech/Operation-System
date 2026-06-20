'use strict';
/**
 * Cold-archive service — ships dead-weight DB tables to Google Drive and removes
 * them from the live SQLite DB to keep the Railway volume lean.
 *
 * SAFETY MODEL (why this is safe to run on production):
 *   1. HARD WHITELIST. Only tables proven by a code audit (2026-06-20) to be
 *      NEVER read by any report/route can be archived. `assertWhitelisted`
 *      refuses anything else, even if a caller passes the name explicitly.
 *        - lectures_history              : write-only archive of phantom rows
 *        - absent_students_history       : dedupe overflow (dedupeAbsenceTable
 *        - absent_zoom_students_history    only ever writes, never reads)
 *        - group_renames_backup_20260606 : one-time pre-cleanup backup
 *   2. VERIFY-BEFORE-DELETE. The gzip is uploaded, then re-downloaded and its
 *      sha256 + row count re-checked. Rows are deleted ONLY after that passes.
 *   3. CONCURRENCY-SAFE. The exact rowids are captured in the synchronous SELECT
 *      (before any await). Deletion targets those rowids only — never a re-run of
 *      the WHERE clause — so rows a sync inserts during the Drive round-trip are
 *      never deleted unsent.
 *   4. FULLY REVERSIBLE. `restore` pulls the Drive file back and re-inserts
 *      (INSERT OR IGNORE). Every action is logged in `cold_archive_log`.
 *   5. VACUUM is separate, manual, and free-space-guarded (better-sqlite3 is
 *      synchronous → VACUUM freezes the server; never auto, never fills disk).
 */
const zlib = require('zlib');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const drive = require('./googleDrive.service');

// cutoffCol = timestamp column for the rolling N-day window; null = whole-table
// one-time archive (a one-off backup that simply isn't needed in-DB anymore).
const COLD_TABLES = {
  lectures_history:              { cutoffCol: 'archived_at', kind: 'rolling' },
  absent_students_history:       { cutoffCol: 'archived_at', kind: 'rolling' },
  absent_zoom_students_history:  { cutoffCol: 'archived_at', kind: 'rolling' },
  group_renames_backup_20260606: { cutoffCol: null,          kind: 'backup'  },
};

function assertWhitelisted(table) {
  if (!Object.prototype.hasOwnProperty.call(COLD_TABLES, table)) {
    throw new Error(`Refusing to touch "${table}" — not in the cold-table whitelist`);
  }
}

function tableExists(t) {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
}

// Rows eligible for archiving. For rolling tables: archive timestamp older than
// the window (NULL timestamp = treat as old/eligible). For backups: everything.
function cutoffClause(table, cutoffDays) {
  const meta = COLD_TABLES[table];
  if (!meta.cutoffCol) return { sql: '1=1', params: [] };
  return {
    sql: `(${meta.cutoffCol} IS NULL OR ${meta.cutoffCol} < datetime('now', ?, 'localtime'))`,
    params: [`-${cutoffDays} days`],
  };
}

// ── PREVIEW (read-only dry-run) ──────────────────────────────────────────────
function preview(cutoffDays) {
  const tables = [];
  for (const t of Object.keys(COLD_TABLES)) {
    if (!tableExists(t)) { tables.push({ table: t, exists: false, eligible_rows: 0, total_rows: 0 }); continue; }
    const w = cutoffClause(t, cutoffDays);
    const eligible = db.prepare(`SELECT COUNT(*) c FROM "${t}" WHERE ${w.sql}`).get(...w.params).c;
    const total = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
    tables.push({ table: t, exists: true, kind: COLD_TABLES[t].kind, eligible_rows: eligible, total_rows: total });
  }
  return { cutoff_days: cutoffDays, tables };
}

// ── ARCHIVE one table (upload → verify → delete) ─────────────────────────────
async function archiveTable(table, cutoffDays, user) {
  assertWhitelisted(table);
  if (!tableExists(table)) return { table, archived: 0, skipped: 'no_such_table' };

  const w = cutoffClause(table, cutoffDays);
  // Capture rowids + rows NOW (synchronous, before any await) so the later delete
  // targets exactly what we uploaded — concurrency-safe.
  const rows = db.prepare(`SELECT rowid AS _rid, * FROM "${table}" WHERE ${w.sql} ORDER BY rowid`).all(...w.params);
  if (rows.length === 0) return { table, archived: 0, skipped: 'nothing_to_archive' };
  const rowids = rows.map(r => r._rid);
  const clean = rows.map(({ _rid, ...rest }) => rest);

  // serialize → gzip → sha256
  const jsonl = clean.map(r => JSON.stringify(r)).join('\n') + '\n';
  const gz = zlib.gzipSync(Buffer.from(jsonl, 'utf8'));
  const sha = crypto.createHash('sha256').update(gz).digest('hex');

  // upload to Drive: System DB Archive / <table> / <table>_<ts>_<n>rows.jsonl.gz
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fname = `${table}_${stamp}_${rows.length}rows.jsonl.gz`;
  const folderId = await drive.getOrCreateArchiveFolder(table);
  const up = await drive.uploadFile(folderId, fname, 'application/gzip', gz);

  // VERIFY before deleting anything
  const back = await drive.downloadFile(up.id);
  const backSha = crypto.createHash('sha256').update(back).digest('hex');
  const backRows = zlib.gunzipSync(back).toString('utf8').trim().split('\n').filter(Boolean).length;
  if (backSha !== sha || backRows !== rows.length) {
    throw new Error(`Verify FAILED for ${table} (sha_ok=${backSha === sha}, rows=${backRows}/${rows.length}) — nothing deleted; Drive file ${up.id} left for inspection`);
  }

  // delete the exact rows, in a transaction
  const del = db.prepare(`DELETE FROM "${table}" WHERE rowid = ?`);
  db.transaction((list) => { for (const id of list) del.run(id); })(rowids);

  db.prepare(`INSERT INTO cold_archive_log
      (table_name, drive_file_id, drive_file_name, row_count, bytes, sha256,
       cutoff_days, archived_by, archived_at, status)
      VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'),'archived')`)
    .run(table, up.id, fname, rows.length, gz.length, sha, cutoffDays, user || null);

  return { table, archived: rows.length, drive_file_id: up.id, file: fname, bytes: gz.length };
}

async function archive(tablesArg, cutoffDays, user) {
  const tables = (Array.isArray(tablesArg) && tablesArg.length)
    ? tablesArg : Object.keys(COLD_TABLES);
  const results = [];
  for (const t of tables) {
    try { results.push(await archiveTable(t, cutoffDays, user)); }
    catch (e) { results.push({ table: t, error: e.message }); }
  }
  return { cutoff_days: cutoffDays, results };
}

// ── RESTORE a logged archive file back into its table ────────────────────────
async function restore(logId, user) {
  const log = db.prepare(`SELECT * FROM cold_archive_log WHERE id=?`).get(logId);
  if (!log) throw new Error('archive log entry not found');
  assertWhitelisted(log.table_name);
  if (!tableExists(log.table_name)) throw new Error(`target table ${log.table_name} no longer exists`);

  const buf = await drive.downloadFile(log.drive_file_id);
  if (log.sha256 && crypto.createHash('sha256').update(buf).digest('hex') !== log.sha256) {
    throw new Error('downloaded archive sha256 mismatch — aborting restore');
  }
  const lines = zlib.gunzipSync(buf).toString('utf8').trim().split('\n').filter(Boolean);

  let restored = 0;
  db.transaction(() => {
    for (const line of lines) {
      const obj = JSON.parse(line);
      const keys = Object.keys(obj);
      const sql = `INSERT OR IGNORE INTO "${log.table_name}" (${keys.map(k => `"${k}"`).join(',')})
                   VALUES (${keys.map(() => '?').join(',')})`;
      restored += db.prepare(sql).run(...keys.map(k => obj[k])).changes;
    }
  })();

  db.prepare(`UPDATE cold_archive_log SET status='restored', restored_at=datetime('now','localtime'), restored_by=? WHERE id=?`)
    .run(user || null, logId);
  return { table: log.table_name, restored, of: lines.length };
}

function listLog() {
  return db.prepare(`SELECT id, table_name, drive_file_name, row_count, bytes, cutoff_days,
                            archived_by, archived_at, status, restored_at, restored_by
                       FROM cold_archive_log ORDER BY id DESC`).all();
}

// ── VACUUM (manual, free-space-guarded) ──────────────────────────────────────
function vacuum() {
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/academy.db');
  const dbSize = fs.statSync(DB_PATH).size;
  let avail = 0;
  try { const s = fs.statfsSync(path.dirname(DB_PATH)); avail = s.bavail * s.bsize; } catch (_) {}
  const need = dbSize * 1.2; // VACUUM builds a full copy + slack
  if (avail && avail < need) {
    return { ok: false, error: 'insufficient_free_space',
             need_mb: +(need / 1e6).toFixed(1), avail_mb: +(avail / 1e6).toFixed(1) };
  }
  db.exec('VACUUM');
  const after = fs.statSync(DB_PATH).size;
  return { ok: true, before_mb: +(dbSize / 1e6).toFixed(1), after_mb: +(after / 1e6).toFixed(1),
           reclaimed_mb: +((dbSize - after) / 1e6).toFixed(1) };
}

module.exports = { COLD_TABLES, preview, archive, archiveTable, restore, listLog, vacuum };
