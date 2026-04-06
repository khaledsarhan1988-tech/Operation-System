'use strict';
/**
 * SQLite wrapper using sql.js (pure WASM — zero native compilation required)
 * Mimics better-sqlite3 synchronous API for seamless route integration.
 */
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/academy.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let _rawDb = null;
let _dirty = false;
let _saveTimer = null;

// ─── PERSISTENCE ─────────────────────────────────────────────────────────────
function scheduleSave() {
  _dirty = true;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (_dirty && _rawDb) {
      try {
        fs.writeFileSync(DB_PATH, Buffer.from(_rawDb.export()));
        _dirty = false;
      } catch (e) {
        console.error('DB save error:', e.message);
      }
    }
  }, 300);
}

function saveNow() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  if (_rawDb) {
    fs.writeFileSync(DB_PATH, Buffer.from(_rawDb.export()));
    _dirty = false;
  }
}

// ─── STATEMENT WRAPPER ────────────────────────────────────────────────────────
class PreparedStatement {
  constructor(sql) {
    this._sql = sql;
  }

  _getStmt() {
    if (!_rawDb) throw new Error('DB not ready');
    return _rawDb.prepare(this._sql);
  }

  run(...args) {
    const params = flattenParams(args);
    const stmt = this._getStmt();
    try {
      stmt.run(params);
      const rowid = _rawDb.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? null;
      const changes = _rawDb.exec('SELECT changes()')[0]?.values[0][0] ?? 0;
      scheduleSave();
      return { lastInsertRowid: rowid, changes };
    } finally {
      stmt.free();
    }
  }

  get(...args) {
    const params = flattenParams(args);
    const stmt = this._getStmt();
    try {
      stmt.bind(params);
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  all(...args) {
    const params = flattenParams(args);
    const stmt = this._getStmt();
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
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
  prepare(sql) {
    return new PreparedStatement(sql);
  },

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
    if (_rawDb) { _rawDb.close(); _rawDb = null; }
  },

  get _raw() { return _rawDb; },
};

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function initDb() {
  const SQL = await initSqlJs();
  let data;
  if (fs.existsSync(DB_PATH)) {
    data = fs.readFileSync(DB_PATH);
  }
  _rawDb = data ? new SQL.Database(data) : new SQL.Database();
  _rawDb.run('PRAGMA foreign_keys = ON');
  return db;
}

module.exports = db;
module.exports.initDb = initDb;
module.exports.saveNow = saveNow;
