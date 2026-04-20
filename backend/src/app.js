'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const { initDb, saveNow } = require('./config/database');

const PORT = process.env.PORT || 3001;

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',').map(o => o.trim());

// ─── INITIALIZE DB THEN START SERVER ─────────────────────────────────────────
initDb().then(db => {
  // Run schema if tables don't exist
  const schemaPath = path.join(__dirname, 'db/schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    // Execute each statement separately
    schema.split(';').forEach(stmt => {
      const trimmed = stmt.trim();
      if (trimmed) {
        try { db._raw.run(trimmed); } catch (e) { /* ignore IF NOT EXISTS */ }
      }
    });
  }

  // Safe migrations
  // 1. Recreate code_problem_status with correct CHECK constraint (adds wont_repeat) + actual_at_status column
  try {
    const res = db._raw.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='code_problem_status'`);
    const tableSql = res[0]?.values[0][0] || '';
    if (!tableSql.includes('wont_repeat') || !tableSql.includes('actual_at_status')) {
      db._raw.run(`CREATE TABLE IF NOT EXISTS code_problem_status_new (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        group_name       TEXT NOT NULL,
        problem_type     TEXT NOT NULL,
        session_type     TEXT NOT NULL DEFAULT 'main',
        status           TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reported','in_progress','exception','wont_repeat')),
        note             TEXT,
        actual_at_status INTEGER,
        updated_by       INTEGER,
        updated_at       TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        UNIQUE(group_name, problem_type, session_type)
      )`);
      db._raw.run(`INSERT OR IGNORE INTO code_problem_status_new (id, group_name, problem_type, session_type, status, note, updated_by, updated_at)
        SELECT id, group_name, problem_type, session_type, status, note, updated_by, updated_at FROM code_problem_status`);
      db._raw.run(`DROP TABLE code_problem_status`);
      db._raw.run(`ALTER TABLE code_problem_status_new RENAME TO code_problem_status`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cps_group  ON code_problem_status(group_name)`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cps_status ON code_problem_status(status)`);
      saveNow(); // force write to disk immediately after DDL migration
      console.log('✅ Migration: code_problem_status rebuilt with wont_repeat + actual_at_status');
    }
  } catch (e) {
    console.error('code_problem_status migration error:', e.message);
  }

  // 2. Add 'resolved' to code_problem_status CHECK constraint
  try {
    const res2 = db._raw.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='code_problem_status'`);
    const tableSql2 = res2[0]?.values[0][0] || '';
    if (!tableSql2.includes("'resolved'")) {
      db._raw.run(`CREATE TABLE code_problem_status_new2 (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        group_name       TEXT NOT NULL,
        problem_type     TEXT NOT NULL,
        session_type     TEXT NOT NULL DEFAULT 'main',
        status           TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reported','in_progress','exception','wont_repeat','resolved')),
        note             TEXT,
        actual_at_status INTEGER,
        updated_by       INTEGER,
        updated_at       TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        UNIQUE(group_name, problem_type, session_type)
      )`);
      db._raw.run(`INSERT OR IGNORE INTO code_problem_status_new2
        SELECT id, group_name, problem_type, session_type, status, note, actual_at_status, updated_by, updated_at
        FROM code_problem_status`);
      db._raw.run(`DROP TABLE code_problem_status`);
      db._raw.run(`ALTER TABLE code_problem_status_new2 RENAME TO code_problem_status`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cps_group  ON code_problem_status(group_name)`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cps_status ON code_problem_status(status)`);
      saveNow();
      console.log("✅ Migration: code_problem_status added 'resolved' status");
    }
  } catch (e) {
    console.error('code_problem_status resolved migration error:', e.message);
  }

  // 3. Add `line` column to users if missing
  try {
    const res3 = db._raw.exec(`PRAGMA table_info(users)`);
    const cols = res3[0]?.values.map(r => r[1]) || [];
    if (!cols.includes('line')) {
      db._raw.run(`ALTER TABLE users ADD COLUMN line TEXT NOT NULL DEFAULT 'Ahmed Hassan'`);
      saveNow();
      console.log('✅ Migration: added `line` column to users');
    }
  } catch (e) {
    console.error('users.line migration error:', e.message);
  }

  // 4. MULTI-LINE: Add `line` column to all data tables
  //    Safe — DEFAULT 'Ahmed Hassan' auto-tags ALL existing rows.
  //    No data loss. No conflict. Tables skipped if column already exists.
  const multiLineTables = [
    'employees',
    'clients',
    'batches',
    'lectures',
    'absent_students',
    'side_session_checks',
    'excel_syncs',
  ];
  multiLineTables.forEach(table => {
    try {
      const info = db._raw.exec(`PRAGMA table_info(${table})`);
      const tableCols = info[0]?.values.map(r => r[1]) || [];
      if (tableCols.length > 0 && !tableCols.includes('line')) {
        db._raw.run(`ALTER TABLE ${table} ADD COLUMN line TEXT NOT NULL DEFAULT 'Ahmed Hassan'`);
        db._raw.run(`CREATE INDEX IF NOT EXISTS idx_${table}_line ON ${table}(line)`);
        saveNow();
        console.log(`✅ Migration: added \`line\` column to ${table}`);
      }
    } catch (e) {
      console.error(`${table}.line migration error:`, e.message);
    }
  });

  // 5. MULTI-LINE: Rebuild `remarks` with UNIQUE(external_id, line)
  //    Previous UNIQUE(external_id) prevents cross-line duplicates.
  //    Must recreate table because SQLite can't ALTER UNIQUE constraints.
  try {
    const res5 = db._raw.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='remarks'`);
    const remarksSql = res5[0]?.values[0][0] || '';
    // Detect old single-column UNIQUE: "external_id   INTEGER UNIQUE"
    const hasOldUnique = /external_id\s+INTEGER\s+UNIQUE/i.test(remarksSql);
    const hasNewUnique = /UNIQUE\s*\(\s*external_id\s*,\s*line\s*\)/i.test(remarksSql);
    if (hasOldUnique && !hasNewUnique) {
      db._raw.run(`CREATE TABLE remarks_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id   INTEGER,
        task_type     TEXT,
        assigned_to   TEXT,
        details       TEXT,
        category      TEXT,
        status        TEXT,
        client_name   TEXT,
        client_phone  TEXT,
        priority      TEXT,
        assigned_by   TEXT,
        notes         TEXT,
        added_at      TEXT,
        last_updated  TEXT,
        sla_deadline  TEXT,
        agent_notes   TEXT,
        resolved_at   TEXT,
        line          TEXT NOT NULL DEFAULT 'Ahmed Hassan',
        synced_at     TEXT,
        UNIQUE(external_id, line)
      )`);
      // Copy all data, tagging every existing row as 'Ahmed Hassan'
      db._raw.run(`INSERT INTO remarks_new
        (id, external_id, task_type, assigned_to, details, category, status,
         client_name, client_phone, priority, assigned_by, notes,
         added_at, last_updated, sla_deadline, agent_notes, resolved_at, line, synced_at)
        SELECT id, external_id, task_type, assigned_to, details, category, status,
               client_name, client_phone, priority, assigned_by, notes,
               added_at, last_updated, sla_deadline, agent_notes, resolved_at,
               'Ahmed Hassan', synced_at
        FROM remarks`);
      db._raw.run(`DROP TABLE remarks`);
      db._raw.run(`ALTER TABLE remarks_new RENAME TO remarks`);
      // Rebuild all indexes
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_remarks_external    ON remarks(external_id)`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_remarks_assigned    ON remarks(assigned_to COLLATE NOCASE)`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_remarks_status      ON remarks(status)`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_remarks_client      ON remarks(client_name COLLATE NOCASE)`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_remarks_phone       ON remarks(client_phone)`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_remarks_priority    ON remarks(priority)`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_remarks_added_at    ON remarks(added_at)`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_remarks_status_date ON remarks(status, added_at)`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_remarks_line        ON remarks(line)`);
      saveNow();
      console.log('✅ Migration: remarks rebuilt with UNIQUE(external_id, line)');
    } else if (!remarksSql.includes('line')) {
      // Table exists but line column missing AND no old UNIQUE (shouldn't happen but be safe)
      db._raw.run(`ALTER TABLE remarks ADD COLUMN line TEXT NOT NULL DEFAULT 'Ahmed Hassan'`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_remarks_line ON remarks(line)`);
      saveNow();
      console.log('✅ Migration: added `line` column to remarks');
    }
  } catch (e) {
    console.error('remarks multi-line migration error:', e.message);
  }

  // 6. MULTI-LINE: Rebuild `code_problem_status` with UNIQUE(group_name, problem_type, session_type, line)
  try {
    const res6 = db._raw.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='code_problem_status'`);
    const cpsSql = res6[0]?.values[0][0] || '';
    const hasLineInUnique = /UNIQUE\s*\([^)]*\bline\b[^)]*\)/i.test(cpsSql);
    if (cpsSql && !hasLineInUnique) {
      db._raw.run(`CREATE TABLE code_problem_status_ml (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        group_name       TEXT NOT NULL,
        problem_type     TEXT NOT NULL,
        session_type     TEXT NOT NULL DEFAULT 'main',
        status           TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reported','in_progress','exception','wont_repeat','resolved')),
        note             TEXT,
        actual_at_status INTEGER,
        new_group_code   TEXT,
        updated_by       INTEGER,
        updated_at       TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        line             TEXT NOT NULL DEFAULT 'Ahmed Hassan',
        UNIQUE(group_name, problem_type, session_type, line)
      )`);
      // Build column list dynamically from existing columns — older DBs may not have new_group_code
      const colsInfo = db._raw.exec(`PRAGMA table_info(code_problem_status)`);
      const existingCols = colsInfo[0]?.values.map(r => r[1]) || [];
      const copyCols = ['id','group_name','problem_type','session_type','status','note','actual_at_status','updated_by','updated_at'];
      if (existingCols.includes('new_group_code')) copyCols.splice(8, 0, 'new_group_code');
      const colList = copyCols.join(', ');
      const selectList = copyCols.map(c => existingCols.includes(c) ? c : 'NULL AS ' + c).join(', ');
      db._raw.run(`INSERT INTO code_problem_status_ml (${colList}, line)
        SELECT ${selectList}, 'Ahmed Hassan' FROM code_problem_status`);
      db._raw.run(`DROP TABLE code_problem_status`);
      db._raw.run(`ALTER TABLE code_problem_status_ml RENAME TO code_problem_status`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cps_group  ON code_problem_status(group_name)`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cps_status ON code_problem_status(status)`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cps_line   ON code_problem_status(line)`);
      saveNow();
      console.log('✅ Migration: code_problem_status rebuilt with UNIQUE(group_name, problem_type, session_type, line)');
    }
  } catch (e) {
    console.error('code_problem_status multi-line migration error:', e.message);
  }

  const app = express();

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: ${origin} not allowed`));
    },
    credentials: true,
  }));

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Static assets
  app.use('/assets', express.static(path.join(__dirname, '../assets')));

  // Health check
  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  // Routes
  app.use('/api/auth',    require('./routes/auth.routes'));
  app.use('/api/upload',  require('./routes/upload.routes'));
  app.use('/api/agent',   require('./routes/agent.routes'));
  app.use('/api/clients', require('./routes/clients.routes'));
  app.use('/api/remarks', require('./routes/remarks.routes'));
  app.use('/api/leader',  require('./routes/leader.routes'));
  app.use('/api/admin',   require('./routes/admin.routes'));
  app.use('/api/export',  require('./routes/export.routes'));
  app.use('/api/reports', require('./routes/reports.routes'));
  app.use('/api/team',    require('./routes/team.routes'));

  // 404
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Error handler
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err.stack);
    res.status(500).json({
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
    });
  });

  app.listen(PORT, () => {
    console.log(`🚀 Academy System backend running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => { db.close(); process.exit(0); });
  process.on('SIGINT',  () => { db.close(); process.exit(0); });

}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
