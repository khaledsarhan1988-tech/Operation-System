'use strict';
/**
 * SQLite wrapper using better-sqlite3 (native, synchronous, file-backed).
 *
 * WHY we switched from sql.js:
 *   sql.js kept the entire database in WASM memory and only persisted to disk
 *   when saveNow() was called. On Railway's rolling deployments, a new container
 *   could start and read the file just before the old container's final save,
 *   then overwrite the file with stale in-memory data — silently losing all writes
 *   made in the old container (e.g. distribution confirms).
 *
 *   better-sqlite3 writes every transaction directly to the SQLite file.
 *   SQLite's WAL mode + file-level locking handles concurrent access correctly,
 *   so two containers running simultaneously will never corrupt each other's data.
 *
 * API compatibility:
 *   - db.prepare / db.exec / db.pragma / db.transaction / db.close — same as before
 *   - db._raw — emulates the sql.js low-level API used by migrations in app.js / seed.js
 *   - saveNow() / scheduleSave() — kept as no-ops for backward compatibility
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/academy.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let _db = null;

// ─── DATABASE WRAPPER ─────────────────────────────────────────────────────────
const db = {
  prepare(sql) {
    if (!_db) throw new Error('DB not ready');
    return _db.prepare(sql);
  },

  /** Run raw SQL without parameters (used in auth.routes.js for batch deletes). */
  exec(sql) {
    if (!_db) throw new Error('DB not ready');
    _db.exec(sql);
  },

  pragma(stmt) {
    if (!_db) throw new Error('DB not ready');
    _db.pragma(stmt);
  },

  transaction(fn) {
    return (...args) => {
      if (!_db) throw new Error('DB not ready');
      return _db.transaction(fn)(...args);
    };
  },

  close() {
    if (_db) { _db.close(); _db = null; }
  },

  /**
   * sql.js-compatible _raw API — used by migrations in app.js and seed.js.
   *
   *   _raw.run(sql)     → executes DDL / DML without parameters
   *                        returns { changes, lastInsertRowid } (like better-sqlite3 .run())
   *   _raw.exec(sql)    → executes SELECT / PRAGMA and returns sql.js format:
   *                        [{ columns: string[], values: any[][] }]
   *   _raw.prepare(sql) → returns a better-sqlite3 PreparedStatement
   *                        (has .run(), .get(), .all() — compatible calling conventions)
   */
  get _raw() {
    const d = _db;
    return {
      /** Runs DDL / DML. Returns { changes, lastInsertRowid }. */
      run(sql) {
        try {
          const stmt = d.prepare(sql);
          if (stmt.reader) {
            // A SELECT accidentally called via run() — execute but discard rows.
            stmt.all();
            return { changes: 0, lastInsertRowid: null };
          }
          return stmt.run(); // { changes, lastInsertRowid }
        } catch (_) {
          // Fallback for multi-statement SQL or special syntax that can't be prepared.
          d.exec(sql);
          return { changes: 0, lastInsertRowid: null };
        }
      },

      /** Runs SELECT / PRAGMA. Returns sql.js-format [{columns, values}]. */
      exec(sql) {
        try {
          const stmt = d.prepare(sql);
          if (stmt.reader) {
            const rows = stmt.all();
            if (!rows.length) return [];
            const cols = Object.keys(rows[0]);
            return [{ columns: cols, values: rows.map(r => cols.map(c => r[c])) }];
          }
          // DML / DDL called via exec() — run and return empty.
          stmt.run();
          return [];
        } catch (_) {
          d.exec(sql);
          return [];
        }
      },

      /** Returns a better-sqlite3 PreparedStatement with .run()/.get()/.all(). */
      prepare(sql) {
        return d.prepare(sql);
      },
    };
  },
};

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function initDb() {
  _db = new Database(DB_PATH);
  // WAL mode: allows concurrent reads while a write is in progress.
  // NORMAL synchronous: safe durability without the overhead of FULL.
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('foreign_keys = ON');
  return db;
}

/**
 * No-op — kept for backward compatibility.
 * better-sqlite3 writes every transaction directly to the file;
 * there is no in-memory buffer that needs flushing.
 */
function saveNow() { /* intentionally empty */ }

/** No-op — same reason as saveNow(). */
function scheduleSave() { /* intentionally empty */ }

module.exports = db;
module.exports.initDb = initDb;
module.exports.saveNow = saveNow;
module.exports.scheduleSave = scheduleSave;
