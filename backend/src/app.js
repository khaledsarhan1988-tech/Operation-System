'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
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
        updated_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
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
        updated_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
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

  // 4b. AUTO-ABSENT: add `auto_generated` column to absent tables
  //     Tags rows generated from lectures with empty attendance + confirmed status,
  //     so they can be deleted/recreated without affecting manually-uploaded rows.
  ['absent_students', 'absent_zoom_students'].forEach(table => {
    try {
      const info = db._raw.exec(`PRAGMA table_info(${table})`);
      const tableCols = info[0]?.values.map(r => r[1]) || [];
      if (tableCols.length > 0 && !tableCols.includes('auto_generated')) {
        db._raw.run(`ALTER TABLE ${table} ADD COLUMN auto_generated INTEGER NOT NULL DEFAULT 0`);
        db._raw.run(`CREATE INDEX IF NOT EXISTS idx_${table}_auto ON ${table}(auto_generated)`);
        saveNow();
        console.log(`✅ Migration: added \`auto_generated\` column to ${table}`);
      }
    } catch (e) {
      console.error(`${table}.auto_generated migration error:`, e.message);
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
        updated_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
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

  // 9. Add client_date to remarks (store original Excel date for filtering)
  try {
    const cols9 = db._raw.exec(`PRAGMA table_info(remarks)`)[0]?.values.map(r => r[1]) || [];
    if (!cols9.includes('client_date')) {
      db._raw.run(`ALTER TABLE remarks ADD COLUMN client_date TEXT`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_remarks_client_date ON remarks(client_date)`);
      saveNow();
      console.log('✅ Migration: added client_date to remarks');
    }
  } catch(e) { console.error('client_date migration:', e.message); }

  // 8. CRM Pipeline: remark_interactions + next_followup_at on remarks
  try {
    db._raw.run(`CREATE TABLE IF NOT EXISTS remark_interactions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      remark_id        INTEGER NOT NULL REFERENCES remarks(id) ON DELETE CASCADE,
      agent_name       TEXT    NOT NULL,
      interaction_type TEXT    NOT NULL DEFAULT 'call'
                       CHECK(interaction_type IN ('call','message','visit','note')),
      outcome          TEXT,
      notes            TEXT,
      next_followup_at TEXT,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now','+2 hours'))
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_ri_remark ON remark_interactions(remark_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_ri_agent  ON remark_interactions(agent_name)`);
    const riCols = db._raw.exec(`PRAGMA table_info(remarks)`)[0]?.values.map(r => r[1]) || [];
    if (!riCols.includes('next_followup_at')) {
      db._raw.run(`ALTER TABLE remarks ADD COLUMN next_followup_at TEXT`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_remarks_followup ON remarks(next_followup_at)`);
    }
    // item_id: links interaction to distribution_items (pipeline items, separate from remarks)
    const riColsFull = db._raw.exec(`PRAGMA table_info(remark_interactions)`)[0]?.values.map(r => r[1]) || [];
    if (!riColsFull.includes('item_id')) {
      db._raw.run(`ALTER TABLE remark_interactions ADD COLUMN item_id INTEGER REFERENCES distribution_items(id) ON DELETE CASCADE`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_ri_item ON remark_interactions(item_id)`);
    }
    saveNow();
    console.log('✅ Migration: remark_interactions + next_followup_at ready');
  } catch (e) {
    console.error('CRM pipeline migration error:', e.message);
  }

  // 8b. Make remark_interactions.remark_id nullable so pipeline interactions
  //     (which use item_id and have remark_id=NULL) can be inserted without
  //     hitting a NOT NULL constraint failure. Pipeline interactions are
  //     completely independent of remarks.
  try {
    const riSql = db._raw.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='remark_interactions'`)[0]?.values[0][0] || '';
    if (riSql && /remark_id\s+INTEGER\s+NOT\s+NULL/i.test(riSql)) {
      db._raw.run(`PRAGMA writable_schema = ON`);
      db._raw.run(`
        UPDATE sqlite_master
        SET sql = REPLACE(sql,
          'remark_id        INTEGER NOT NULL REFERENCES remarks(id) ON DELETE CASCADE',
          'remark_id        INTEGER          REFERENCES remarks(id) ON DELETE CASCADE'
        )
        WHERE type = 'table' AND name = 'remark_interactions'
      `);
      db._raw.run(`PRAGMA writable_schema = OFF`);
      saveNow();
      console.log('✅ Migration: remark_interactions.remark_id made nullable (pipeline fix)');
    }
  } catch (e) {
    console.error('remark_interactions nullable migration error:', e.message);
  }

  // 7. Distribution tables (client distribution feature)
  try {
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS distribution_sessions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        line           TEXT    NOT NULL,
        total_clients  INTEGER NOT NULL DEFAULT 0,
        matched        INTEGER NOT NULL DEFAULT 0,
        distributed    INTEGER NOT NULL DEFAULT 0,
        status         TEXT    NOT NULL DEFAULT 'pending'
                       CHECK(status IN ('pending','confirmed','cancelled')),
        task_type      TEXT    NOT NULL DEFAULT 'متابعة مشترك جديد',
        priority       TEXT    NOT NULL DEFAULT 'عادية',
        created_by     INTEGER REFERENCES users(id),
        confirmed_by   INTEGER REFERENCES users(id),
        created_at     TEXT    NOT NULL DEFAULT (datetime('now','+2 hours')),
        confirmed_at   TEXT
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_dist_sessions_line   ON distribution_sessions(line)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_dist_sessions_status ON distribution_sessions(status)`);

    db._raw.run(`
      CREATE TABLE IF NOT EXISTS distribution_items (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id   INTEGER NOT NULL REFERENCES distribution_sessions(id) ON DELETE CASCADE,
        client_name  TEXT    NOT NULL,
        client_phone TEXT,
        client_line  TEXT,
        client_date  TEXT,
        match_type   TEXT    NOT NULL CHECK(match_type IN ('existing_coordinator','auto_distributed')),
        assigned_to  TEXT    NOT NULL,
        remark_id    INTEGER REFERENCES remarks(id) ON DELETE SET NULL,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now','+2 hours'))
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_dist_items_session ON distribution_items(session_id)`);

    db._raw.run(`
      CREATE TABLE IF NOT EXISTS distribution_task_types (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (datetime('now','+2 hours'))
      )
    `);
    // Seed the one default type if not already present
    db._raw.run(`INSERT OR IGNORE INTO distribution_task_types (name, is_default) VALUES ('متابعة مشترك جديد', 1)`);
    console.log('✅ Migration: distribution tables ready');
  } catch (e) {
    console.error('distribution migration error:', e.message);
  }

  // 9. Client transfer audit log
  try {
    db._raw.run(`CREATE TABLE IF NOT EXISTS client_transfers (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      remark_id      INTEGER REFERENCES remarks(id) ON DELETE SET NULL,
      client_name    TEXT,
      client_phone   TEXT,
      from_user      TEXT NOT NULL,
      to_user        TEXT NOT NULL,
      transferred_by TEXT NOT NULL,
      transfer_type  TEXT NOT NULL DEFAULT 'manual'
                     CHECK(transfer_type IN ('auto_distribution','manual','bulk')),
      line           TEXT,
      transferred_at TEXT NOT NULL DEFAULT (datetime('now','+2 hours'))
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_ct_from  ON client_transfers(from_user)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_ct_to    ON client_transfers(to_user)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_ct_by    ON client_transfers(transferred_by)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_ct_at    ON client_transfers(transferred_at)`);
    saveNow();
    console.log('✅ Migration: client_transfers audit table ready');
  } catch (e) {
    console.error('client_transfers migration error:', e.message);
  }

  // ── Fix distribution_items CHECK constraint to allow 'manual' match_type ──
  try {
    const diSql = db._raw.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='distribution_items'`)[0]?.values[0][0] || '';
    if (diSql && !diSql.includes("'manual'")) {
      db._raw.run(`CREATE TABLE IF NOT EXISTS distribution_items_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id   INTEGER NOT NULL REFERENCES distribution_sessions(id) ON DELETE CASCADE,
        client_name  TEXT    NOT NULL,
        client_phone TEXT,
        client_line  TEXT,
        client_date  TEXT,
        match_type   TEXT    NOT NULL CHECK(match_type IN ('existing_coordinator','auto_distributed','manual')),
        assigned_to  TEXT    NOT NULL,
        remark_id    INTEGER REFERENCES remarks(id) ON DELETE SET NULL,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now','+2 hours'))
      )`);
      db._raw.run(`INSERT INTO distribution_items_new SELECT * FROM distribution_items`);
      db._raw.run(`DROP TABLE distribution_items`);
      db._raw.run(`ALTER TABLE distribution_items_new RENAME TO distribution_items`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_dist_items_session ON distribution_items(session_id)`);
      console.log("✅ Migration: distribution_items CHECK constraint updated to allow 'manual'");
    }
  } catch (e) { console.error('distribution_items manual migration:', e.message); }

  // ── Add date_from / date_to columns to distribution_sessions ─────────────
  try {
    const dsCols = db._raw.exec(`PRAGMA table_info(distribution_sessions)`)[0]?.values.map(r => r[1]) || [];
    if (!dsCols.includes('date_from')) db._raw.run(`ALTER TABLE distribution_sessions ADD COLUMN date_from TEXT`);
    if (!dsCols.includes('date_to'))   db._raw.run(`ALTER TABLE distribution_sessions ADD COLUMN date_to   TEXT`);
  } catch (e) { console.error('distribution_sessions date range migration:', e.message); }

  // ── Pipeline tracking columns for distribution_items ─────────────────────
  // Distribution data is completely separate from remarks — pipeline state lives here.
  try {
    const diCols = db._raw.exec(`PRAGMA table_info(distribution_items)`)[0]?.values.map(r => r[1]) || [];
    if (!diCols.includes('status'))           db._raw.run(`ALTER TABLE distribution_items ADD COLUMN status TEXT DEFAULT 'جديدة'`);
    if (!diCols.includes('agent_notes'))      db._raw.run(`ALTER TABLE distribution_items ADD COLUMN agent_notes TEXT`);
    if (!diCols.includes('last_updated'))     db._raw.run(`ALTER TABLE distribution_items ADD COLUMN last_updated TEXT`);
    if (!diCols.includes('next_followup_at')) db._raw.run(`ALTER TABLE distribution_items ADD COLUMN next_followup_at TEXT`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_dist_items_assigned ON distribution_items(assigned_to)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_dist_items_status   ON distribution_items(status)`);
    saveNow();
    console.log('✅ Migration: distribution_items pipeline columns ready');
  } catch (e) { console.error('distribution_items pipeline migration:', e.message); }

  // ── item_id column in client_transfers (for distribution_items transfers) ─
  try {
    const ctCols = db._raw.exec(`PRAGMA table_info(client_transfers)`)[0]?.values.map(r => r[1]) || [];
    if (!ctCols.includes('item_id')) db._raw.run(`ALTER TABLE client_transfers ADD COLUMN item_id INTEGER REFERENCES distribution_items(id) ON DELETE SET NULL`);
    console.log('✅ Migration: client_transfers.item_id ready');
  } catch (e) { console.error('client_transfers item_id migration:', e.message); }

  // ── Covering index for canonical-line lookup in batchSubQ queries ────────
  try {
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_lectures_type_group_line ON lectures(session_type, group_name, line)`);
  } catch (e) { /* index already exists or schema mismatch — safe to ignore */ }

  // ── Absent Zoom students table (Zoom Call absences from new Excel) ──────
  // Mirrors absent_students. Created on demand for existing DBs.
  try {
    db._raw.run(`CREATE TABLE IF NOT EXISTS absent_zoom_students (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name        TEXT,
      student_name      TEXT,
      phone             TEXT,
      date              TEXT,
      time              TEXT,
      lecture_no        INTEGER,
      follow_up_status  TEXT NOT NULL DEFAULT 'pending' CHECK(follow_up_status IN ('pending','contacted','resolved')),
      follow_up_note    TEXT,
      follow_up_by      TEXT,
      follow_up_at      TEXT,
      line              TEXT NOT NULL DEFAULT 'Ahmed Hassan',
      synced_at         TEXT
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_absent_zoom_line       ON absent_zoom_students(line)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_absent_zoom_group      ON absent_zoom_students(group_name)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_absent_zoom_student    ON absent_zoom_students(student_name COLLATE NOCASE)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_absent_zoom_phone      ON absent_zoom_students(phone)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_absent_zoom_status     ON absent_zoom_students(follow_up_status)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_absent_zoom_group_date ON absent_zoom_students(group_name, date)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_absent_zoom_phone_date ON absent_zoom_students(phone, date)`);
    saveNow();
    console.log('✅ Migration: absent_zoom_students table ready');
  } catch (e) {
    console.error('absent_zoom_students migration error:', e.message);
  }

  // ── Performance composite indexes (additive — no behavior change) ────────
  // Speeds up: /reports/dashboard, remarks-notes (main+zoom), code-problems,
  // team-summary. All CREATE INDEX IF NOT EXISTS — safe to re-run forever.
  try {
    const perfIndexes = [
      `CREATE INDEX IF NOT EXISTS idx_remarks_category_line ON remarks(category, line)`,
      `CREATE INDEX IF NOT EXISTS idx_remarks_cat_phone     ON remarks(category, client_phone)`,
      `CREATE INDEX IF NOT EXISTS idx_absent_group_date     ON absent_students(group_name, date)`,
      `CREATE INDEX IF NOT EXISTS idx_absent_phone_date     ON absent_students(phone, date)`,
      `CREATE INDEX IF NOT EXISTS idx_lectures_group_date   ON lectures(group_name, date)`,
      `CREATE INDEX IF NOT EXISTS idx_lectures_status_type  ON lectures(status, session_type)`,
      `CREATE INDEX IF NOT EXISTS idx_clients_phone_line    ON clients(phone, line)`,
      `CREATE INDEX IF NOT EXISTS idx_clients_group_line    ON clients(group_name, line)`,
      `CREATE INDEX IF NOT EXISTS idx_batches_group_line    ON batches(group_name, line)`,
    ];
    let added = 0;
    for (const sql of perfIndexes) {
      try { db._raw.run(sql); added++; } catch (_) { /* already exists */ }
    }
    // Refresh query-planner stats after adding indexes
    try { db._raw.run(`ANALYZE`); } catch (_) {}
    saveNow();
    console.log(`✅ Migration: performance indexes ready (${added}/${perfIndexes.length} statements ran)`);
  } catch (e) {
    console.error('performance indexes migration error:', e.message);
  }

  // ── Extend users.role CHECK to include enrollment roles ──────────────────
  // Uses writable_schema to patch the constraint text directly — no table recreate needed.
  try {
    const usersSql = db._raw.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`)[0]?.values[0][0] || '';
    if (usersSql && !usersSql.includes("'enrollment'")) {
      db._raw.run(`PRAGMA writable_schema = ON`);
      db._raw.run(`
        UPDATE sqlite_master
        SET sql = REPLACE(sql,
          'CHECK(role IN (''agent'',''leader'',''admin''))',
          'CHECK(role IN (''agent'',''leader'',''admin'',''enrollment'',''enrollment_leader''))'
        )
        WHERE type = 'table' AND name = 'users'
      `);
      db._raw.run(`PRAGMA writable_schema = OFF`);
      saveNow();
      console.log('✅ Migration: users.role CHECK extended to include enrollment roles');
    }
  } catch (e) {
    console.error('users enrollment migration error:', e.message);
  }

  // ── Auto-upsert admin user on every startup ───────────────────────────────
  // Ensures admin always exists even after DB reset (e.g. Railway redeploy).
  try {
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@2024';
    const adminName     = process.env.ADMIN_FULLNAME || 'System Admin';
    const adminHash     = bcrypt.hashSync(adminPassword, 12);
    const existingAdmin = db._raw.prepare('SELECT id FROM users WHERE username = ?').get(adminUsername);
    if (!existingAdmin) {
      db._raw.prepare(`
        INSERT INTO users (username, password_hash, full_name, role, department, language, management, line)
        VALUES (?, ?, ?, 'admin', 'All', 'ar', 'All', 'All')
      `).run(adminUsername, adminHash, adminName);
      console.log(`✅ Admin user created on startup: ${adminUsername}`);
    } else {
      // Do NOT reset password — preserves any password changes made via UI
      console.log(`✅ Admin user exists: ${adminUsername}`);
    }
    saveNow();
  } catch (e) {
    console.error('Admin upsert error:', e.message);
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
  app.use('/api/reports',       require('./routes/reports.routes'));
  app.use('/api/team',          require('./routes/team.routes'));
  app.use('/api/distribution',       require('./routes/distribution.routes'));
  app.use('/api/enrollment',         require('./routes/enrollment.routes'));
  app.use('/api/enrollment-leader',  require('./routes/enrollment-leader.routes'));

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
