'use strict';
/**
 * SQLite wrapper using sql.js (pure WASM — zero native compilation required).
 *
 * PERFORMANCE: Statement cache — each unique SQL string is compiled once and
 * reused on subsequent calls via reset(). Eliminates expensive WASM prepare()
 * overhead on every query (previously re-parsed SQL on every run/get/all call).
 *
 * RACE-CONDITION FIX (Railway rolling deployments):
 *   Before every save, compare the file's mtime. If another process wrote a
 *   newer version, reload from disk instead of overwriting with stale data.
 *   All writes use atomic tmp-file + rename to prevent partial reads.
 */
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/academy.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let _SQL       = null;
let _rawDb     = null;
let _dirty     = false;
let _saveTimer = null;
let _fileTs    = 0;

// ─── STATEMENT CACHE ──────────────────────────────────────────────────────────
// Compiled statements are stored here and reset() between uses instead of
// being freed and re-created, which eliminates expensive WASM parse overhead.
const _stmtCache = new Map();

function _clearCache() {
  for (const stmt of _stmtCache.values()) {
    try { stmt.free(); } catch (_) {}
  }
  _stmtCache.clear();
}

function _getCached(sql) {
  if (!_rawDb) throw new Error('DB not ready');
  if (!_stmtCache.has(sql)) {
    _stmtCache.set(sql, _rawDb.prepare(sql));
  }
  return _stmtCache.get(sql);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function _fileMtime() {
  try { return fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).mtimeMs : 0; }
  catch (_) { return 0; }
}

function _atomicWrite(data) {
  const tmp = DB_PATH + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, DB_PATH);
  _fileTs = _fileMtime();
}

function _reloadFromDisk() {
  try {
    if (!fs.existsSync(DB_PATH)) return;
    const data = fs.readFileSync(DB_PATH);
    _clearCache();                          // invalidate all cached statements
    if (_rawDb) _rawDb.close();
    _rawDb = new _SQL.Database(data);
    _applyPragmas();
    _fileTs = _fileMtime();
    console.log('[DB] Reloaded from disk — newer version detected from another process');
  } catch (e) {
    console.error('[DB] Reload error:', e.message);
  }
}

function _applyPragmas() {
  _rawDb.run('PRAGMA foreign_keys = ON');
  _rawDb.run('PRAGMA ignore_check_constraints = 1');
  _rawDb.run('PRAGMA cache_size = -16000');   // 16 MB page cache
  _rawDb.run('PRAGMA temp_store = 2');        // use memory for temp tables
}

// ─── PERSISTENCE ──────────────────────────────────────────────────────────────

function saveNow() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  if (!_rawDb) return;

  try {
    const diskTs = _fileMtime();

    if (diskTs > _fileTs + 200) {
      _reloadFromDisk();
      _dirty = false;
      return;
    }

    const exported = Buffer.from(_rawDb.export());
    _atomicWrite(exported);
    _dirty = false;
  } catch (e) {
    console.error('[DB] saveNow error:', e.message);
  }
}

function scheduleSave() {
  _dirty = true;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (_dirty && _rawDb) saveNow();
  }, 300);
}

// ─── STATEMENT WRAPPER ────────────────────────────────────────────────────────

class PreparedStatement {
  constructor(sql) { this._sql = sql; }

  run(...args) {
    const params = flattenParams(args);
    const stmt   = _getCached(this._sql);
    try {
      stmt.run(params);  // internally: bind + step + reset
      const rowid   = _rawDb.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? null;
      const changes = _rawDb.exec('SELECT changes()')[0]?.values[0][0] ?? 0;
      scheduleSave();
      return { lastInsertRowid: rowid, changes };
    } finally {
      try { stmt.reset(); } catch (_) {}
    }
  }

  get(...args) {
    const params = flattenParams(args);
    const stmt   = _getCached(this._sql);
    try {
      stmt.bind(params);
      const row = stmt.step() ? stmt.getAsObject() : undefined;
      return row;
    } finally {
      try { stmt.reset(); } catch (_) {}
    }
  }

  all(...args) {
    const params = flattenParams(args);
    const stmt   = _getCached(this._sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      try { stmt.reset(); } catch (_) {}
    }
  }
}

function flattenParams(args) {
  if (args.length === 0) return [];
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

// ─── DATABASE WRAPPER ─────────────────────────────────────────────────────────
const db = {
  prepare(sql) { return new PreparedStatement(sql); },

  exec(sql) {
    if (!_rawDb) throw new Error('DB not ready');
    _rawDb.run(sql);
    scheduleSave();
  },

  pragma(stmt) {
    if (!_rawDb) throw new Error('DB not ready');
    _rawDb.run(`PRAGMA ${stmt}`);
  },

  transaction(fn) {
    return (...args) => {
      if (!_rawDb) throw new Error('DB not ready');
      _rawDb.run('BEGIN');
      try {
        const result = fn(...args);
        _rawDb.run('COMMIT');
        scheduleSave();
        return result;
      } catch (err) {
        try { _rawDb.run('ROLLBACK'); } catch (_) {}
        throw err;
      }
    };
  },

  close() {
    saveNow();
    _clearCache();
    if (_rawDb) { _rawDb.close(); _rawDb = null; }
  },

  get _raw() { return _rawDb; },
};

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function initDb() {
  _SQL = await initSqlJs();
  let data;
  if (fs.existsSync(DB_PATH)) {
    data = fs.readFileSync(DB_PATH);
    _fileTs = _fileMtime();
  } else {
    _fileTs = 0;
  }
  _rawDb = data ? new _SQL.Database(data) : new _SQL.Database();
  _applyPragmas();
  return db;
}

module.exports = db;
module.exports.initDb = initDb;
module.exports.saveNow = saveNow;
module.exports.scheduleSave = scheduleSave;
