'use strict';
/**
 * SQLite wrapper using better-sqlite3 (disk-backed, native).
 *
 * WHY THIS EXISTS / WHAT CHANGED:
 *   The previous engine was sql.js (WASM). It loaded the ENTIRE database into
 *   memory as a buffer and re-exported a full copy on every save. As the DB
 *   grew (~123 MB in production) the baseline memory sat near 1 GB and any heavy
 *   operation (e.g. a Drive sync that regenerates auto-absents) pushed the WASM
 *   heap past the container limit → "out of memory" → every query (incl. login)
 *   failed with 503.
 *
 *   better-sqlite3 reads/writes the SAME academy.db file directly from disk with
 *   its own page cache. The whole DB is NEVER held in JS memory, so the OOM class
 *   of failure disappears. Memory drops from ~1 GB to tens of MB.
 *
 * COMPATIBILITY CONTRACT (kept identical so NO other file needs to change):
 *   db.prepare(sql).run/get/all(...)   — same shape; run() → {lastInsertRowid, changes}
 *   db.exec(sql)                       — run arbitrary SQL, ignore results
 *   db.pragma(stmt)                    — run a PRAGMA
 *   db.transaction(fn)                 — returns a callable that runs fn atomically
 *   db.close() / db.reload() / db.healthCheck()
 *   db._raw.run(sql)                   — sql.js-style: execute, returns {changes}
 *   db._raw.exec(sql)                  — sql.js-style: returns [{columns, values}]
 *   db._raw.prepare(sql)               — returns a statement with run/get/all/free
 *   initDb(), saveNow(), scheduleSave()
 *
 *   saveNow()/scheduleSave() are now NO-OPS: better-sqlite3 persists to disk on
 *   every statement/commit, so there is nothing to flush. They remain exported
 *   because ~hundreds of call sites import and call them.
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/academy.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let _bsqlite = null;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function _applyPragmas() {
  // Behavior-preserving: same PRAGMAs the sql.js engine applied.
  //  - foreign_keys ON           : enforce FK / ON DELETE CASCADE (as before)
  //  - ignore_check_constraints  : CHECK() constraints are intentionally ignored
  //                                at runtime (statuses outside the CHECK list are
  //                                inserted on purpose) — MUST stay 1 to match old behavior
  //  - cache_size / temp_store   : carried over from before
  // WAL is better-sqlite3's recommended journal mode: readers never block the
  // writer, and it's crash-safe (recovers from the -wal file on next open).
  // synchronous=NORMAL is the standard WAL companion — durable against app/OS
  // crashes (no corruption), only risks the very last txn on a hard power loss.
  // Set explicitly so behavior is deterministic regardless of the file's prior state.
  _bsqlite.pragma('journal_mode = WAL');
  _bsqlite.pragma('synchronous = NORMAL');
  _bsqlite.pragma('foreign_keys = ON');
  _bsqlite.pragma('ignore_check_constraints = 1');
  _bsqlite.pragma('cache_size = -65536');   // 64 MB page cache
  _bsqlite.pragma('temp_store = 2');        // memory for temp tables/sorts
}

// better-sqlite3 cannot bind `undefined` and throws on JS booleans. sql.js was
// lenient, so callers pass optional fields straight from req.body. Coerce here so
// behavior matches the old engine: undefined → null, true → 1, false → 0.
function flattenParams(args) {
  let arr;
  if (args.length === 0) return [];
  if (args.length === 1 && Array.isArray(args[0])) arr = args[0];
  else arr = Array.from(args);
  return arr.map(v => {
    if (v === undefined) return null;
    if (v === true) return 1;
    if (v === false) return 0;
    return v;
  });
}

// ─── STATEMENT WRAPPER ────────────────────────────────────────────────────────
// Prepares against the CURRENT connection on every call (better-sqlite3 caches
// the compiled statement per SQL string internally, so this is cheap). Preparing
// lazily — instead of caching one Statement object — keeps us correct across a
// reload() that swaps the underlying connection, and mirrors the old "fresh
// statement per op" design.
class PreparedStatement {
  constructor(sql) { this._sql = sql; }

  run(...args) {
    const info = _bsqlite.prepare(this._sql).run(...flattenParams(args));
    return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
  }

  get(...args) {
    return _bsqlite.prepare(this._sql).get(...flattenParams(args));
  }

  all(...args) {
    return _bsqlite.prepare(this._sql).all(...flattenParams(args));
  }

  // sql.js compatibility — some callers (e.g. team-members-safety) free() the
  // statement in a finally block. better-sqlite3 manages statement lifetime
  // itself, so this is a safe no-op.
  free() {}
}

// ─── _raw SHIM ──────────────────────────────────────────────────────────────
// Migrations (app.js, seed.js) and the team_members safety net talk to the
// engine through `db._raw` using the sql.js Database API. We reproduce that API
// exactly on top of better-sqlite3 so none of that code needs to change.
const rawShim = {
  // sql.js: _rawDb.run(sql) — execute one (or many) statements, results ignored.
  // Supports DDL, DML, PRAGMA-set, and BEGIN/COMMIT/ROLLBACK. Returns an object
  // so legacy `result.changes` reads don't throw (it was already `undefined`
  // under sql.js — seed.js logs "fixed undefined ... batches").
  run(sql) {
    _bsqlite.exec(sql);
    return { changes: undefined, lastInsertRowid: undefined };
  },

  // sql.js: _rawDb.exec(sql) — returns [{ columns: string[], values: any[][] }].
  // Used for SELECT / PRAGMA reads in migrations and the safety net.
  exec(sql) {
    try {
      const stmt = _bsqlite.prepare(sql);
      if (stmt.reader) {
        const columns = stmt.columns().map(c => c.name);
        // Use object rows then project to arrays — avoids calling .raw() which
        // would leave the (internally cached) statement stuck in raw mode and
        // corrupt later object-returning queries for the same SQL.
        const values = stmt.all().map(o => columns.map(c => o[c]));
        return [{ columns, values }];
      }
      stmt.run();
      return [];
    } catch (_) {
      // Fallback for multi-statement strings prepare() can't handle.
      _bsqlite.exec(sql);
      return [];
    }
  },

  prepare(sql) { return new PreparedStatement(sql); },

  pragma(source) { return _bsqlite.pragma(source); },
};

// ─── PERSISTENCE (no-ops — better-sqlite3 writes to disk immediately) ──────────
function saveNow() { /* no-op: data is already durable on disk */ }
function scheduleSave() { /* no-op */ }

// ─── DATABASE WRAPPER ─────────────────────────────────────────────────────────
const db = {
  prepare(sql) { return new PreparedStatement(sql); },

  exec(sql) {
    if (!_bsqlite) throw new Error('DB not ready');
    _bsqlite.exec(sql);
  },

  pragma(stmt) {
    if (!_bsqlite) throw new Error('DB not ready');
    return _bsqlite.pragma(stmt);
  },

  // better-sqlite3 transactions are atomic and support nesting via savepoints.
  // Same external contract as before: returns a function; call it to run fn in
  // a transaction (auto BEGIN/COMMIT, auto ROLLBACK on throw).
  transaction(fn) {
    if (!_bsqlite) throw new Error('DB not ready');
    return _bsqlite.transaction(fn);
  },

  close() {
    if (_bsqlite) { _bsqlite.close(); _bsqlite = null; }
  },

  // Re-open the connection from disk. Rarely needed now (no in-memory snapshot
  // to go stale), but kept for API compatibility / manual recovery.
  reload(reason = 'manual') {
    try {
      if (_bsqlite) _bsqlite.close();
      _bsqlite = new Database(DB_PATH);
      _applyPragmas();
      console.log(`[DB] Reloaded from disk — ${reason}`);
      return true;
    } catch (e) {
      console.error('[DB] Reload error:', e.message);
      return false;
    }
  },

  // Health check — trivial query; returns true if the DB is responsive.
  healthCheck() {
    try {
      _bsqlite.prepare('SELECT 1').get();
      return true;
    } catch (_) {
      return false;
    }
  },

  get _raw() { return rawShim; },
};

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function initDb() {
  // Opens (or creates, for a fresh install) the SAME academy.db file on disk.
  _bsqlite = new Database(DB_PATH);
  _applyPragmas();
  return db;
}

module.exports = db;
module.exports.initDb = initDb;
module.exports.saveNow = saveNow;
module.exports.scheduleSave = scheduleSave;
