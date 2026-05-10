'use strict';
/**
 * team_members safety net.
 *
 * Goal: the Educational Administration team data MUST survive deploys,
 * restarts, and any startup migration. The only thing allowed to remove
 * a row is a manual DELETE via the UI (DELETE /api/team/:id).
 *
 * Strategy:
 *   1. At every startup, BEFORE any DDL, snapshot current team_members
 *      rows to a JSON file on the same persistent Volume as the DB.
 *   2. After migrations, if the live table is missing or unexpectedly
 *      empty AND the snapshot has rows, restore from the snapshot.
 *   3. Log row counts on every startup so any silent data loss is
 *      visible in Railway logs.
 *
 * Snapshot file path: <DB_PATH dir>/team_members_backup.json
 *   (e.g. /data/team_members_backup.json on Railway).
 */
const fs   = require('fs');
const path = require('path');

const DB_PATH       = process.env.DB_PATH || path.join(__dirname, '../../data/academy.db');
const SNAPSHOT_PATH = path.join(path.dirname(DB_PATH), 'team_members_backup.json');

function tableExists(db) {
  try {
    const res = db._raw.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='team_members'`
    );
    return !!(res[0] && res[0].values && res[0].values.length);
  } catch (_) { return false; }
}

function getColumns(db) {
  try {
    const info = db._raw.exec(`PRAGMA table_info(team_members)`);
    return (info[0] && info[0].values) ? info[0].values.map(r => r[1]) : [];
  } catch (_) { return []; }
}

function dumpFromTable(db) {
  if (!tableExists(db)) return null;
  try {
    const res = db._raw.exec(`SELECT * FROM team_members`);
    if (!res || !res[0]) return [];
    const cols = res[0].columns;
    return res[0].values.map(row => {
      const obj = {};
      cols.forEach((c, i) => { obj[c] = row[i]; });
      return obj;
    });
  } catch (e) {
    console.error('[SAFETY] dumpFromTable error:', e.message);
    return null;
  }
}

function loadSnapshotFile() {
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return null;
    const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch (e) {
    console.error('[SAFETY] loadSnapshotFile error:', e.message);
    return null;
  }
}

function writeSnapshotFile(rows, reason) {
  try {
    const dir = path.dirname(SNAPSHOT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const payload = {
      saved_at: new Date().toISOString(),
      reason:   reason || 'startup_snapshot',
      count:    rows.length,
      rows,
    };
    const tmp = SNAPSHOT_PATH + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, SNAPSHOT_PATH);
    return true;
  } catch (e) {
    console.error('[SAFETY] writeSnapshotFile error:', e.message);
    return false;
  }
}

/**
 * Take a snapshot of the live team_members table — but only if the
 * table actually has rows. We never overwrite a non-empty snapshot with
 * an empty one (so if the table somehow got wiped between calls, the
 * old snapshot is still available for restore).
 */
function snapshotIfNonEmpty(db, reason) {
  const rows = dumpFromTable(db);
  if (rows && rows.length > 0) {
    if (writeSnapshotFile(rows, reason)) {
      console.log(`💾 [SAFETY] team_members snapshot saved: ${rows.length} rows → ${SNAPSHOT_PATH}`);
    }
    return rows.length;
  }
  // If the table is empty but we already have a non-empty snapshot, leave it alone.
  // It may be needed for the very next restoreIfMissingOrEmpty() call.
  return 0;
}

/**
 * If team_members is missing or unexpectedly empty AND we have a non-empty
 * snapshot, restore from the snapshot. Caller must ensure the table exists.
 *
 * Insert column list is computed dynamically from the intersection of
 * snapshot keys and live columns — schema additions don't break restore.
 */
function restoreIfMissingOrEmpty(db) {
  const liveRows = dumpFromTable(db);
  if (liveRows && liveRows.length > 0) return 0; // healthy — nothing to do
  const snapshot = loadSnapshotFile();
  if (!snapshot || !Array.isArray(snapshot.rows) || snapshot.rows.length === 0) return 0;
  if (!tableExists(db)) {
    console.error('[SAFETY] team_members table missing — cannot restore (caller must create it first)');
    return 0;
  }

  const liveCols   = new Set(getColumns(db));
  const sample     = snapshot.rows[0];
  const insertCols = Object.keys(sample).filter(c => liveCols.has(c));
  if (!insertCols.length) {
    console.error('[SAFETY] No overlapping columns between snapshot and live table — restore aborted');
    return 0;
  }

  const placeholders = insertCols.map(() => '?').join(', ');
  const sql = `INSERT INTO team_members (${insertCols.join(', ')}) VALUES (${placeholders})`;

  let restored = 0;
  try {
    db._raw.run('BEGIN');
    const stmt = db._raw.prepare(sql);
    try {
      for (const row of snapshot.rows) {
        const vals = insertCols.map(c => (row[c] === undefined ? null : row[c]));
        stmt.run(vals);
        restored++;
      }
    } finally { stmt.free(); }
    db._raw.run('COMMIT');
    console.log(`🔁 [SAFETY] Restored ${restored} team_members rows from snapshot (saved ${snapshot.saved_at})`);
  } catch (e) {
    try { db._raw.run('ROLLBACK'); } catch (_) {}
    console.error('[SAFETY] restoreIfMissingOrEmpty error:', e.message);
    return 0;
  }
  return restored;
}

function logIntegrity(db) {
  const rows = dumpFromTable(db);
  if (rows === null) {
    console.log('[SAFETY] team_members table MISSING — no data accessible!');
    return;
  }
  const eduCount   = rows.filter(r => r.department === 'education').length;
  const csCount    = rows.filter(r => r.department === 'customer_services').length;
  const otherCount = rows.length - eduCount - csCount;
  const otherTxt   = otherCount ? `, other: ${otherCount}` : '';
  console.log(`[SAFETY] team_members rows: ${rows.length} (education: ${eduCount}, customer_services: ${csCount}${otherTxt})`);
}

module.exports = {
  SNAPSHOT_PATH,
  tableExists,
  getColumns,
  dumpFromTable,
  loadSnapshotFile,
  writeSnapshotFile,
  snapshotIfNonEmpty,
  restoreIfMissingOrEmpty,
  logIntegrity,
};
