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
const teamSafety = require('./utils/team-members-safety');

const PORT = process.env.PORT || 3001;

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',').map(o => o.trim());

// ─── INITIALIZE DB THEN START SERVER ─────────────────────────────────────────
initDb().then(db => {
  // ── team_members SAFETY: snapshot BEFORE any schema/migrations ───────────
  // Educational Administration team data must survive any startup path. We
  // snapshot to /data/team_members_backup.json (same persistent Volume as
  // the DB) before anything that could conceivably touch the table. Manual
  // DELETE via DELETE /api/team/:id remains the only way to lose data.
  try { teamSafety.snapshotIfNonEmpty(db, 'app_startup_pre_schema'); } catch(_) {}

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

  // 4a. TEAM MEMBERS: add shift1 + shift2 columns (start/end/employment/work_days)
  // shift_start_date / shift_end_date track when each shift was active.
  // end_date NULL = trainer is still on the job; non-null = shift has ended.
  // voice_notes / shift2_voice_notes: dedicated work blocks inside the shift
  // (e.g. 30-min slot for recording student voice notes — NOT a break).
  [
    'shift_start', 'shift_end', 'shift_rests', 'voice_notes', 'employment_type', 'work_days',
    'shift_start_date', 'shift_end_date',
    'shift2', 'shift2_start', 'shift2_end', 'shift2_rests', 'shift2_voice_notes', 'shift2_employment_type', 'shift2_work_days',
    'shift2_start_date', 'shift2_end_date',
  ].forEach(col => {
    try {
      const info = db._raw.exec(`PRAGMA table_info(team_members)`);
      const cols = info[0]?.values.map(r => r[1]) || [];
      if (cols.length > 0 && !cols.includes(col)) {
        db._raw.run(`ALTER TABLE team_members ADD COLUMN ${col} TEXT`);
        saveNow();
        console.log(`✅ Migration: added \`${col}\` column to team_members`);
      }
    } catch (e) {
      console.error(`team_members.${col} migration error:`, e.message);
    }
  });

  // 4a-bis. TEAM MEMBERS: teachable courses (Starter / General / Conversation)
  //   Each column stores the HIGHEST level the trainer can teach.
  //     teachable_starter      → 0..3   (Starter 1..3,           0 = not capable)
  //     teachable_general      → 0..5   (General 1..5,           0 = not capable)
  //     teachable_conversation → 0..5   (Conversation 1..5,      0 = not capable)
  //   DEFAULT = max level so EVERY existing trainer is automatically able to
  //   teach all courses — no manual data entry required, zero risk to existing
  //   data. ALTER ADD COLUMN with DEFAULT is non-destructive in SQLite.
  [
    { col: 'teachable_starter',      def: 3 },
    { col: 'teachable_general',      def: 5 },
    { col: 'teachable_conversation', def: 5 },
  ].forEach(({ col, def }) => {
    try {
      const info = db._raw.exec(`PRAGMA table_info(team_members)`);
      const cols = info[0]?.values.map(r => r[1]) || [];
      if (cols.length > 0 && !cols.includes(col)) {
        db._raw.run(`ALTER TABLE team_members ADD COLUMN ${col} INTEGER NOT NULL DEFAULT ${def}`);
        saveNow();
        console.log(`✅ Migration: added \`${col}\` column to team_members (default ${def} = all levels)`);
      }
    } catch (e) {
      console.error(`team_members.${col} migration error:`, e.message);
    }
  });

  // ── team_members.line: operational line (Ahmed Hassan / Dardasha / etc.)
  // Lets the org chart split a section into line-specific columns
  // (e.g. "خاص" main line vs "خاص دردشة" Dardasha line).
  try {
    const info = db._raw.exec(`PRAGMA table_info(team_members)`);
    const cols = info[0]?.values.map(r => r[1]) || [];
    if (cols.length > 0 && !cols.includes('line')) {
      db._raw.run(`ALTER TABLE team_members ADD COLUMN line TEXT NOT NULL DEFAULT 'Ahmed Hassan'`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_team_line ON team_members(line)`);
      saveNow();
      console.log('✅ Migration: added `line` column to team_members (default Ahmed Hassan)');
    }
  } catch (e) {
    console.error('team_members.line migration error:', e.message);
  }

  // ── team_members SAFETY: restore from snapshot if rows vanished ─────────
  // Runs after all team_members DDL (step 4a). If anything above wiped or
  // failed to preserve rows, this brings them back from the JSON snapshot
  // taken at startup. The integrity log line goes to Railway logs so any
  // unexpected drop is immediately visible.
  try {
    teamSafety.restoreIfMissingOrEmpty(db);
    teamSafety.logIntegrity(db);
    saveNow();
  } catch(e) {
    console.error('[SAFETY] team_members post-migration check error:', e.message);
  }

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

  // ── Level 2: monthly_snapshots / employee_targets / snapshot_notes ──────
  try {
    db._raw.run(`CREATE TABLE IF NOT EXISTS monthly_snapshots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name      TEXT NOT NULL,
      agent_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      department      TEXT NOT NULL,
      line            TEXT NOT NULL DEFAULT 'Ahmed Hassan',
      year            INTEGER NOT NULL,
      month           INTEGER NOT NULL,
      period_label    TEXT NOT NULL,
      tasks_total     INTEGER DEFAULT 0,
      tasks_done      INTEGER DEFAULT 0,
      tasks_overdue   INTEGER DEFAULT 0,
      tasks_urgent    INTEGER DEFAULT 0,
      completion_rate INTEGER DEFAULT 0,
      sla_rate        INTEGER DEFAULT 0,
      absents_total       INTEGER DEFAULT 0,
      absents_followed_up INTEGER DEFAULT 0,
      followup_rate       INTEGER DEFAULT 0,
      code_problems_total    INTEGER DEFAULT 0,
      code_problems_resolved INTEGER DEFAULT 0,
      fix_rate               INTEGER DEFAULT 0,
      overall_score   INTEGER DEFAULT 0,
      target_completion INTEGER,
      target_followup   INTEGER,
      target_fix        INTEGER,
      target_overall    INTEGER,
      met_target        INTEGER NOT NULL DEFAULT 0,
      dept_avg_completion INTEGER,
      dept_avg_followup   INTEGER,
      dept_avg_fix        INTEGER,
      dept_avg_overall    INTEGER,
      rank_in_dept        INTEGER,
      total_in_dept       INTEGER,
      achievements    TEXT,
      frozen_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      frozen_at       TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
      notes           TEXT,
      UNIQUE(agent_name, year, month, line)
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_ms_agent       ON monthly_snapshots(agent_name COLLATE NOCASE)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_ms_period      ON monthly_snapshots(year, month)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_ms_line        ON monthly_snapshots(line)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_ms_dept        ON monthly_snapshots(department)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_ms_dept_period ON monthly_snapshots(department, year, month)`);

    db._raw.run(`CREATE TABLE IF NOT EXISTS employee_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT,
      department TEXT,
      line TEXT NOT NULL DEFAULT 'Ahmed Hassan',
      target_completion INTEGER NOT NULL DEFAULT 85,
      target_followup   INTEGER NOT NULL DEFAULT 80,
      target_fix        INTEGER NOT NULL DEFAULT 90,
      target_overall    INTEGER NOT NULL DEFAULT 80,
      effective_from TEXT NOT NULL,
      set_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      set_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
      notes TEXT
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_targets_agent      ON employee_targets(agent_name COLLATE NOCASE)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_targets_department ON employee_targets(department)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_targets_line       ON employee_targets(line)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_targets_effective  ON employee_targets(effective_from)`);

    // Add absence-target columns — used by the new "معايير الأداء" form to set
    // per-agent main/zoom absence targets that ladder up to a dept challenge.
    const etCols = db._raw.exec(`PRAGMA table_info(employee_targets)`)[0]?.values.map(r => r[1]) || [];
    if (!etCols.includes('target_main_absent_rate')) {
      db._raw.run(`ALTER TABLE employee_targets ADD COLUMN target_main_absent_rate INTEGER`);
    }
    if (!etCols.includes('target_zoom_absent_rate')) {
      db._raw.run(`ALTER TABLE employee_targets ADD COLUMN target_zoom_absent_rate INTEGER`);
    }
    if (!etCols.includes('bonus_points')) {
      db._raw.run(`ALTER TABLE employee_targets ADD COLUMN bonus_points INTEGER NOT NULL DEFAULT 5`);
    }
    // Period + evaluation columns — mirror the structure used by
    // department_quality_goals so the same "evaluate at end of period"
    // workflow applies to per-employee targets too.
    const evalCols = [
      ['period_year',                'INTEGER'],
      ['period_month',               'INTEGER'],
      ['period_start',               'TEXT'],
      ['period_end',                 'TEXT'],
      ['period_label',               'TEXT'],
      ['status',                     "TEXT NOT NULL DEFAULT 'active'"],
      ['actual_main_absent_rate',    'INTEGER'],
      ['actual_zoom_absent_rate',    'INTEGER'],
      ['actual_main_absent_count',   'INTEGER'],
      ['actual_main_expected',       'INTEGER'],
      ['actual_zoom_absent_count',   'INTEGER'],
      ['actual_zoom_expected',       'INTEGER'],
      ['evaluated_at',               'TEXT'],
      ['evaluated_by',               'INTEGER REFERENCES users(id) ON DELETE SET NULL'],
      ['bonus_awarded',              'INTEGER NOT NULL DEFAULT 0'],
    ];
    for (const [name, def] of evalCols) {
      if (!etCols.includes(name)) {
        db._raw.run(`ALTER TABLE employee_targets ADD COLUMN ${name} ${def}`);
      }
    }
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_targets_period ON employee_targets(period_year, period_month)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_targets_status ON employee_targets(status)`);

    db._raw.run(`CREATE TABLE IF NOT EXISTS snapshot_notes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL REFERENCES monthly_snapshots(id) ON DELETE CASCADE,
      note        TEXT NOT NULL,
      created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
      updated_at  TEXT
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_snapshot_notes_sid ON snapshot_notes(snapshot_id)`);

    // Audit log
    db._raw.run(`CREATE TABLE IF NOT EXISTS snapshot_audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      action     TEXT NOT NULL CHECK(action IN ('freeze','freeze_bulk','overwrite','delete','note_add','note_edit','note_delete','target_change','weights_change')),
      year       INTEGER,
      month      INTEGER,
      agent_name TEXT,
      details    TEXT,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_name  TEXT,
      line       TEXT NOT NULL DEFAULT 'Ahmed Hassan',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_audit_action ON snapshot_audit_log(action)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_audit_period ON snapshot_audit_log(year, month)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_audit_user   ON snapshot_audit_log(user_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_audit_line   ON snapshot_audit_log(line)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_audit_at     ON snapshot_audit_log(created_at)`);

    // KPI weights — single-row config table
    db._raw.run(`CREATE TABLE IF NOT EXISTS kpi_weights (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      weight_completion INTEGER NOT NULL DEFAULT 50,
      weight_followup   INTEGER NOT NULL DEFAULT 25,
      weight_fix        INTEGER NOT NULL DEFAULT 25,
      weight_sla        INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
    )`);
    db._raw.prepare(`INSERT OR IGNORE INTO kpi_weights (id, weight_completion, weight_followup, weight_fix, weight_sla)
                     VALUES (1, 50, 25, 25, 0)`).run();

    // Custom goals — extra goals (Retention/etc.) created by agent or leader, evaluated by leader
    db._raw.run(`CREATE TABLE IF NOT EXISTS custom_goals (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      title           TEXT NOT NULL,
      description     TEXT,
      target_value    INTEGER,
      unit            TEXT NOT NULL DEFAULT '%' CHECK(unit IN ('%','عميل','تاسك','جلسة','نقطة','مجموعة','custom')),
      unit_custom     TEXT,
      year            INTEGER,
      month           INTEGER,
      achieved_value     INTEGER,
      result_status      TEXT NOT NULL DEFAULT 'pending'
                         CHECK(result_status IN ('pending','achieved','partially','not_achieved')),
      evaluation_reason  TEXT,
      strengths          TEXT,
      weaknesses         TEXT,
      leader_note        TEXT,
      evaluated_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      evaluated_at       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
      updated_at TEXT
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_custom_goals_user   ON custom_goals(user_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_custom_goals_status ON custom_goals(result_status)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_custom_goals_period ON custom_goals(year, month)`);

    // Personal goals — motivational targets set by the agent themselves
    db._raw.run(`CREATE TABLE IF NOT EXISTS personal_goals (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      goal_completion INTEGER NOT NULL DEFAULT 90,
      goal_followup   INTEGER NOT NULL DEFAULT 85,
      goal_fix        INTEGER NOT NULL DEFAULT 95,
      goal_overall    INTEGER NOT NULL DEFAULT 90,
      notes           TEXT,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_personal_goals_user ON personal_goals(user_id)`);

    // Notifications
    db._raw.run(`CREATE TABLE IF NOT EXISTS notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL CHECK(type IN ('snapshot_frozen','target_changed','achievement_earned','system','custom')),
      title      TEXT NOT NULL,
      body       TEXT,
      link       TEXT,
      meta       TEXT,
      is_read    INTEGER NOT NULL DEFAULT 0,
      read_at    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notifications(user_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_notifications_read    ON notifications(user_id, is_read)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at)`);

    // Seed a default global target if no targets exist
    const existingTargets = db._raw.prepare(`SELECT COUNT(*) AS c FROM employee_targets`).get();
    if (!existingTargets || existingTargets.c === 0) {
      db._raw.prepare(`INSERT INTO employee_targets
        (agent_name, department, line, target_completion, target_followup, target_fix, target_overall, effective_from, notes)
        VALUES (NULL, NULL, 'Ahmed Hassan', 85, 80, 90, 80, '2026-01-01', 'Default global target')`).run();
    }
    saveNow();
    console.log('✅ Migration: monthly_snapshots / employee_targets / snapshot_notes ready');
  } catch (e) {
    console.error('Level-2 snapshots migration error:', e.message);
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

  // ── Department Quality Goals ─────────────────────────────────────────────
  // Track per-department absence-rate targets (weekly / monthly / quarterly).
  // Each row represents one goal for one (dept, period). Once the period
  // ends, actual rates are computed + the goal is marked met / missed.
  // When a goal is met, every employee in the department gets a bonus toward
  // their overall_score in monthly_snapshots (see snapshots integration).
  try {
    db._raw.run(`CREATE TABLE IF NOT EXISTS department_quality_goals (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      dept_type                   TEXT NOT NULL CHECK(dept_type IN ('General','Private','Semi')),
      period_type                 TEXT NOT NULL CHECK(period_type IN ('weekly','monthly','quarterly')),
      year                        INTEGER NOT NULL,
      month                       INTEGER,
      week                        INTEGER,
      quarter                     INTEGER,
      period_label                TEXT NOT NULL,
      period_start                TEXT NOT NULL,
      period_end                  TEXT NOT NULL,
      line                        TEXT NOT NULL DEFAULT 'Ahmed Hassan',
      baseline_main_absent_rate   INTEGER NOT NULL DEFAULT 0,
      baseline_zoom_absent_rate   INTEGER NOT NULL DEFAULT 0,
      baseline_period_label       TEXT,
      target_main_absent_rate     INTEGER NOT NULL,
      target_zoom_absent_rate     INTEGER NOT NULL,
      actual_main_absent_rate     INTEGER,
      actual_zoom_absent_rate     INTEGER,
      actual_main_absent_count    INTEGER,
      actual_main_expected        INTEGER,
      actual_zoom_absent_count    INTEGER,
      actual_zoom_expected        INTEGER,
      status                      TEXT NOT NULL DEFAULT 'active'
                                    CHECK(status IN ('active','met','missed','partial','cancelled')),
      bonus_awarded               INTEGER NOT NULL DEFAULT 0,
      bonus_points                INTEGER NOT NULL DEFAULT 5,
      notes                       TEXT,
      created_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by_name             TEXT,
      created_at                  TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
      updated_by                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at                  TEXT,
      evaluated_at                TEXT
    )`);
    db._raw.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_dqg_unique
                 ON department_quality_goals(dept_type, period_type, year, COALESCE(month,0), COALESCE(week,0), COALESCE(quarter,0), line)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_dqg_status     ON department_quality_goals(status)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_dqg_dates      ON department_quality_goals(period_start, period_end)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_dqg_dept       ON department_quality_goals(dept_type, year)`);
    saveNow();
    console.log('✅ Migration: department_quality_goals ready');
  } catch (e) {
    console.error('department_quality_goals migration error:', e.message);
  }

  // Bonus column on monthly_snapshots (Phase 3 integration)
  try {
    const cols = db._raw.exec(`PRAGMA table_info(monthly_snapshots)`)[0]?.values.map(r => r[1]) || [];
    const hasBonus = cols.includes('dept_goal_bonus');
    if (!hasBonus) {
      db._raw.run(`ALTER TABLE monthly_snapshots ADD COLUMN dept_goal_bonus INTEGER NOT NULL DEFAULT 0`);
      saveNow();
      console.log('✅ Migration: monthly_snapshots.dept_goal_bonus added');
    }
    if (!cols.includes('individual_target_bonus')) {
      db._raw.run(`ALTER TABLE monthly_snapshots ADD COLUMN individual_target_bonus INTEGER NOT NULL DEFAULT 0`);
      saveNow();
      console.log('✅ Migration: monthly_snapshots.individual_target_bonus added');
    }
  } catch (e) {
    console.error('monthly_snapshots.dept_goal_bonus migration error:', e.message);
  }

  // ── Quality Report Snapshots ─────────────────────────────────────────────
  // Frozen snapshots of the Quality Report page. Once a snapshot is saved,
  // its numbers are immutable — even if Excel files are re-uploaded later,
  // the saved snapshot's data stays exactly as it was at freeze time.
  try {
    db._raw.run(`CREATE TABLE IF NOT EXISTS quality_report_snapshots (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_label      TEXT NOT NULL,
      from_date           TEXT,
      to_date             TEXT,
      department_filter   TEXT,
      line                TEXT NOT NULL DEFAULT 'Ahmed Hassan',
      summary_json        TEXT NOT NULL,
      rows_json           TEXT NOT NULL,
      dept_averages_json  TEXT NOT NULL,
      notes               TEXT,
      frozen_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
      frozen_by_name      TEXT,
      frozen_at           TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_qrs_frozen_at ON quality_report_snapshots(frozen_at)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_qrs_dates     ON quality_report_snapshots(from_date, to_date)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_qrs_line      ON quality_report_snapshots(line)`);

    // Add is_official toggle — when ON, this snapshot is the authoritative
    // end-of-period record used as baseline source for Dept Goals.
    const qrsCols = db._raw.exec(`PRAGMA table_info(quality_report_snapshots)`)[0]?.values.map(r => r[1]) || [];
    const hasIsOfficial = qrsCols.includes('is_official');
    if (!hasIsOfficial) {
      db._raw.run(`ALTER TABLE quality_report_snapshots ADD COLUMN is_official INTEGER NOT NULL DEFAULT 0`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_qrs_official ON quality_report_snapshots(is_official, from_date, to_date)`);
      console.log('✅ Migration: quality_report_snapshots.is_official added');
    }

    saveNow();
    console.log('✅ Migration: quality_report_snapshots ready');
  } catch (e) {
    console.error('quality_report_snapshots migration error:', e.message);
  }

  // ── excel_syncs: add drive_file_id (track which Drive file was imported) ──
  // Lets Smart Sync compare by file IDENTITY, not just time. Solves the case
  // where a new file is uploaded with createdTime BEFORE a previous successful
  // sync — without this, the system would mistake it for "already imported".
  try {
    const info = db._raw.exec(`PRAGMA table_info(excel_syncs)`);
    const cols = info[0]?.values.map((r) => r[1]) || [];
    if (cols.length > 0 && !cols.includes('drive_file_id')) {
      db._raw.run(`ALTER TABLE excel_syncs ADD COLUMN drive_file_id TEXT`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_excel_syncs_drive_file ON excel_syncs(drive_file_id)`);
      saveNow();
      console.log('✅ Migration: excel_syncs.drive_file_id added');
    }
  } catch (e) {
    console.error('excel_syncs.drive_file_id migration error:', e.message);
  }

  // ── drive_sync_runs: audit log for Drive auto-sync (cron + manual triggers) ──
  try {
    db._raw.run(`CREATE TABLE IF NOT EXISTS drive_sync_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger      TEXT NOT NULL CHECK(trigger IN ('cron','manual')),
      status       TEXT NOT NULL CHECK(status IN ('success','partial','error')),
      started_at   TEXT NOT NULL,
      finished_at  TEXT NOT NULL,
      duration_ms  INTEGER NOT NULL DEFAULT 0,
      imported     INTEGER NOT NULL DEFAULT 0,
      skipped      INTEGER NOT NULL DEFAULT 0,
      failed       INTEGER NOT NULL DEFAULT 0,
      error_msg    TEXT,
      details_json TEXT
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_drive_sync_runs_started ON drive_sync_runs(started_at)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_drive_sync_runs_status  ON drive_sync_runs(status)`);
    saveNow();
    console.log('✅ Migration: drive_sync_runs ready');
  } catch (e) {
    console.error('drive_sync_runs migration error:', e.message);
  }

  // ── coordinator_history / remark_assignment_history bootstrap ────────────
  // First-time seed: when these tables exist but are empty, populate from the
  // current state of `batches` and `remarks` so reports have a baseline to JOIN
  // against. We use a far-past effective_from so any historical event lands
  // inside this seed window (queries become equivalent to the legacy behavior
  // for unchanged groups). Subsequent runs are no-ops — only seed when empty.
  // NOTE: Use the wrapper `db.prepare(...)` (not `db._raw.prepare(...)`).
  // sql.js's raw Statement has no `.all()` method — only the wrapper provides
  // `.all()` / `.get()` / `.run()` that return plain JS values.
  // ── ONE-TIME FIX: backfill orphan "new group" entries to far-past ──────
  // Prior to the 2026-05-18 fix, syncBatches stored effective_from=NOW for
  // newly-detected groups (including renamed groups). This broke filtering of
  // events with the new group_name whose date is BEFORE the sync time.
  //
  // Backfill rule: any active entry (effective_to IS NULL) with a modern
  // effective_from (after 2024-01-01) AND no related closed entry for the
  // same group → treat as orphan-new-group → backfill to '2000-01-01'.
  // (Real transitions have a closed entry for the previous coordinator on the
  // same group_name, so they're preserved.)
  try {
    const fixedCh = db.prepare(`
      UPDATE coordinator_history
         SET effective_from = '2000-01-01'
       WHERE effective_to IS NULL
         AND effective_from > '2024-01-01'
         AND NOT EXISTS (
           SELECT 1 FROM coordinator_history ch2
           WHERE ch2.group_name = coordinator_history.group_name
             AND ch2.line       = coordinator_history.line
             AND ch2.effective_to IS NOT NULL
         )
    `).run();
    if (fixedCh.changes > 0) {
      saveNow();
      console.log(`✅ Migration: backfilled ${fixedCh.changes} orphan coordinator_history entries to 2000-01-01`);
    }
  } catch (e) {
    console.error('coordinator_history backfill error:', e.message);
  }

  try {
    const fixedRah = db.prepare(`
      UPDATE remark_assignment_history
         SET effective_from = '2000-01-01'
       WHERE effective_to IS NULL
         AND effective_from > '2024-01-01'
         AND NOT EXISTS (
           SELECT 1 FROM remark_assignment_history rah2
           WHERE rah2.remark_external_id = remark_assignment_history.remark_external_id
             AND rah2.line = remark_assignment_history.line
             AND rah2.effective_to IS NOT NULL
         )
    `).run();
    if (fixedRah.changes > 0) {
      saveNow();
      console.log(`✅ Migration: backfilled ${fixedRah.changes} orphan remark_assignment_history entries to 2000-01-01`);
    }
  } catch (e) {
    console.error('remark_assignment_history backfill error:', e.message);
  }

  try {
    const chCount = db.prepare(`SELECT COUNT(*) AS cnt FROM coordinator_history`).get();
    if (chCount && chCount.cnt === 0) {
      const batches = db.prepare(
        `SELECT group_name, line, coordinators FROM batches WHERE coordinators IS NOT NULL AND TRIM(coordinators) != ''`
      ).all();
      const insertCh = db.prepare(
        `INSERT INTO coordinator_history (group_name, line, coordinator, effective_from, effective_to)
         VALUES (?, ?, ?, '2000-01-01', NULL)`
      );
      const seen = new Set();
      let seeded = 0;
      const tx = db.transaction(() => {
        for (const b of batches) {
          if (!b.coordinators) continue;
          for (const raw of String(b.coordinators).split(',')) {
            const name = raw.trim();
            if (!name) continue;
            const key = `${b.group_name}|${b.line}|${name.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            insertCh.run(b.group_name, b.line, name);
            seeded += 1;
          }
        }
      });
      tx();
      if (seeded > 0) {
        saveNow();
        console.log(`✅ Migration: coordinator_history seeded with ${seeded} baseline rows`);
      }
    }
  } catch (e) {
    console.error('coordinator_history bootstrap error:', e.message);
  }

  try {
    const rahCount = db.prepare(`SELECT COUNT(*) AS cnt FROM remark_assignment_history`).get();
    if (rahCount && rahCount.cnt === 0) {
      const remarks = db.prepare(
        `SELECT external_id, line, assigned_to, added_at
           FROM remarks
          WHERE external_id IS NOT NULL
            AND assigned_to IS NOT NULL AND TRIM(assigned_to) != ''`
      ).all();
      const insertRah = db.prepare(
        `INSERT INTO remark_assignment_history
           (remark_external_id, line, assigned_to, effective_from, effective_to)
         VALUES (?, ?, ?, ?, NULL)`
      );
      let seeded = 0;
      const tx = db.transaction(() => {
        for (const r of remarks) {
          // Use added_at as effective_from when available; fallback to far-past
          const eff = (r.added_at && String(r.added_at).trim()) ? r.added_at : '2000-01-01';
          insertRah.run(r.external_id, r.line, String(r.assigned_to).trim(), eff);
          seeded += 1;
        }
      });
      tx();
      if (seeded > 0) {
        saveNow();
        console.log(`✅ Migration: remark_assignment_history seeded with ${seeded} baseline rows`);
      }
    }
  } catch (e) {
    console.error('remark_assignment_history bootstrap error:', e.message);
  }

  // ── batches.dept_type re-classification from `course` column ─────────────
  // Authoritative rule (per Ahmed Hassan Academy convention):
  //   "Private <course>"  → Private
  //   "P <course>" / "SP <course>" → Semi
  //   otherwise              → General
  // Why a migration: the legacy parser inferred dept_type from group_name
  // segments and missed the "_P_Conversation" pattern (segment "P" not
  // followed by "(") — those groups landed as General. This pass re-derives
  // dept_type from the `course` column (the user-managed source of truth).
  // Idempotent: only updates rows whose stored dept_type differs from what
  // the rule produces, so reruns are no-ops once data is converged.
  try {
    const excelSvc = require('./services/excel.service');
    // Use wrapper db.prepare (raw sql.js Statement lacks .all/.get/.run).
    const allBatches = db.prepare(
      `SELECT id, group_name, course, dept_type, lecture_duration_min FROM batches`
    ).all();
    const updateStmt = db.prepare(
      `UPDATE batches SET dept_type = ?, lecture_duration_min = ? WHERE id = ?`
    );
    let changed = 0;
    const sample = [];
    const tx = db.transaction(() => {
      for (const b of allBatches) {
        const newDept = excelSvc.classifyDeptFromCourse(b.course);
        if (!newDept) continue; // no course → keep legacy classification untouched
        const newDuration = newDept === 'General' ? 90 : 60;
        if (newDept !== b.dept_type || newDuration !== b.lecture_duration_min) {
          updateStmt.run(newDept, newDuration, b.id);
          changed += 1;
          if (sample.length < 5) {
            sample.push(`  • ${b.group_name} | course="${b.course}" | ${b.dept_type} → ${newDept}`);
          }
        }
      }
    });
    tx();
    if (changed > 0) {
      saveNow();
      console.log(`✅ Migration: batches.dept_type re-classified from course column (${changed} rows updated)`);
      sample.forEach(s => console.log(s));
    }
  } catch (e) {
    console.error('batches dept_type re-classification migration error:', e.message);
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

  // NOTE: Startup auto-absent refresh was removed — running heavy DELETE+INSERT
  // queries on a large DB during boot was corrupting the sql.js WASM heap,
  // which broke unrelated queries (including auth/login). Auto-absences now
  // refresh only when an Excel file is re-uploaded — that path is small,
  // transactional, and safe.

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
  app.use('/api/drive',   require('./routes/drive.routes'));
  app.use('/api/agent',   require('./routes/agent.routes'));
  app.use('/api/clients', require('./routes/clients.routes'));
  app.use('/api/remarks', require('./routes/remarks.routes'));
  app.use('/api/remarks-monitor', require('./routes/remarks-monitor.routes'));
  app.use('/api/todos',           require('./routes/todos.routes'));
  app.use('/api/leader',  require('./routes/leader.routes'));
  // Level 2: snapshots + targets — mount BEFORE generic /api/admin so the
  // sub-paths win (Express matches in registration order).
  const snapshotsRoutes = require('./routes/snapshots.routes');
  app.use('/api/admin/snapshots', snapshotsRoutes);
  app.use('/api/admin/targets',   require('./routes/targets.routes'));
  app.use('/api/admin',           require('./routes/admin.routes'));
  app.use('/api/notifications',   require('./routes/notifications.routes'));
  app.use('/api/custom-goals',    require('./routes/custom-goals.routes'));
  app.use('/api/export',  require('./routes/export.routes'));
  app.use('/api/reports',       require('./routes/reports.routes'));
  app.use('/api/team',          require('./routes/team.routes'));
  app.use('/api/org-chart',     require('./routes/org-chart.routes'));
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

  // ─── AUTO-FREEZE CRON ────────────────────────────────────────────────────
  // Runs at 02:00 on the 1st of every month (Cairo time +2 hours).
  // For each registered line, freezes the previous calendar month.
  // Use AUTO_FREEZE_DISABLE=1 to opt out.
  if (process.env.AUTO_FREEZE_DISABLE !== '1' && snapshotsRoutes?.autoFreezeMonth) {
    try {
      const cron = require('node-cron');
      cron.schedule('0 2 1 * *', () => {
        try {
          const today = new Date();
          let y = today.getFullYear(), m = today.getMonth(); // m = previous month (0-11 → 1-12)
          if (m === 0) { m = 12; y -= 1; }
          // Freeze every distinct line that has at least one user
          const lines = db._raw.prepare(
            `SELECT DISTINCT line FROM users WHERE line IS NOT NULL AND line != 'All'`
          ).all();
          for (const lineRow of lines) {
            try {
              const result = snapshotsRoutes.autoFreezeMonth(y, m, lineRow.line, 'System (Cron)');
              console.log(`🔒 Auto-freeze ${lineRow.line} ${y}-${m}: created=${result.created} updated=${result.updated} skipped=${result.skipped}`);
            } catch (e) {
              console.error(`Auto-freeze ${lineRow.line} ${y}-${m} failed:`, e.message);
            }
          }
        } catch (e) {
          console.error('Cron job error:', e.message);
        }
      }, { timezone: 'Africa/Cairo' });
      console.log('⏰ Auto-freeze cron scheduled (1st of month, 02:00 Cairo time)');
    } catch (e) {
      console.error('Failed to schedule auto-freeze cron:', e.message);
    }
  }

  // ─── DRIVE AUTO-SYNC CRON ────────────────────────────────────────────────
  // Pulls today's latest files from Google Drive for every line and imports
  // them into the DB. Controlled by env vars (opt-in):
  //   DRIVE_AUTO_SYNC_ENABLED=1                   — must be set to enable
  //   DRIVE_AUTO_SYNC_CRON='0 */1 * * *'          — defaults to top of every hour
  //   DRIVE_AUTO_SYNC_TZ='Africa/Cairo'           — defaults to Cairo
  //
  // Set DRIVE_AUTO_SYNC_ENABLED=1 only after credentials.json / GOOGLE_CREDENTIALS_JSON
  // and DRIVE_ROOT_FOLDER_ID are configured. Disabled by default so existing
  // deployments don't suddenly start hitting Drive on startup.
  if (process.env.DRIVE_AUTO_SYNC_ENABLED === '1') {
    try {
      const cron = require('node-cron');
      const driveSyncService = require('./services/driveSync.service');
      const cronExpr = process.env.DRIVE_AUTO_SYNC_CRON || '0 */1 * * *';
      const tz       = process.env.DRIVE_AUTO_SYNC_TZ   || 'Africa/Cairo';

      if (!cron.validate(cronExpr)) {
        console.error(`Drive auto-sync: invalid cron expression "${cronExpr}", skipping schedule.`);
      } else {
        cron.schedule(cronExpr, async () => {
          try {
            const result = await driveSyncService.runAutoSync('cron');
            console.log(
              `☁️  Drive auto-sync (${result.status}): imported=${result.totals.imported} ` +
              `skipped=${result.totals.skipped} failed=${result.totals.failed} ` +
              `duration=${result.durationMs}ms`
            );
            if (result.error) console.error('   error:', result.error);
          } catch (e) {
            console.error('Drive auto-sync cron error:', e.message);
          }
        }, { timezone: tz });
        console.log(`⏰ Drive auto-sync cron scheduled (${cronExpr}, ${tz})`);
      }
    } catch (e) {
      console.error('Failed to schedule Drive auto-sync cron:', e.message);
    }
  } else {
    console.log('☁️  Drive auto-sync cron disabled (set DRIVE_AUTO_SYNC_ENABLED=1 to enable).');
  }

  // ─── DRIVE FOLDER PREP CRON ──────────────────────────────────────────────
  // Pre-creates the day's folder structure (Line/YYYY/MM/DD/<7 file-type folders>)
  // for every line so the Quality team finds folders ready when they log in.
  // Controlled by env vars (opt-in):
  //   DRIVE_PREP_FOLDERS_ENABLED=1                — must be set to enable
  //   DRIVE_PREP_FOLDERS_CRON='30 0 * * *'        — defaults to 00:30 daily (just past midnight)
  //   DRIVE_PREP_FOLDERS_TZ='Africa/Cairo'        — defaults to Cairo
  if (process.env.DRIVE_PREP_FOLDERS_ENABLED === '1') {
    try {
      const cron = require('node-cron');
      const googleDrive = require('./services/googleDrive.service');
      const { VALID_LINES: prepLines } = require('./services/sync.service');
      const cronExpr = process.env.DRIVE_PREP_FOLDERS_CRON || '30 0 * * *';
      const tz       = process.env.DRIVE_PREP_FOLDERS_TZ   || 'Africa/Cairo';

      if (!cron.validate(cronExpr)) {
        console.error(`Drive prep-folders: invalid cron expression "${cronExpr}", skipping schedule.`);
      } else {
        cron.schedule(cronExpr, async () => {
          // Compute "today" in the cron's configured timezone, not the
          // server's local time. Without this, a cron firing at 00:30 Cairo
          // (= 21:30 UTC prev day) on a UTC server would create yesterday's
          // folder instead of today's.
          const driveSyncSvc = require('./services/driveSync.service');
          const today = driveSyncSvc.todayInTimezone(tz);
          for (const line of prepLines) {
            try {
              const r = await googleDrive.prepareDayFolders(line, today);
              const made = r.folders.filter(f => f.created).length;
              const kept = r.folders.length - made;
              console.log(`📁 Drive prep ${line} ${r.date}: created=${made} existing=${kept}`);
            } catch (e) {
              console.error(`Drive prep ${line} failed:`, e.message);
            }
          }
        }, { timezone: tz });
        console.log(`⏰ Drive prep-folders cron scheduled (${cronExpr}, ${tz})`);
      }
    } catch (e) {
      console.error('Failed to schedule Drive prep-folders cron:', e.message);
    }
  } else {
    console.log('📁 Drive prep-folders cron disabled (set DRIVE_PREP_FOLDERS_ENABLED=1 to enable).');
  }

  // ─── DRIVE PREP-FOLDERS SAFETY NET ───────────────────────────────────────
  // The cron fires once per day at 00:30 Cairo. If the server happens to be
  // restarting at that exact moment (e.g. during a deploy), the cron MISSES
  // its fire and node-cron does NOT backfill — so today's folders would
  // never get created. This safety net guarantees that on every startup,
  // today's folders exist for every line. Idempotent: re-creating existing
  // folders is a no-op (the prepareDayFolders helper checks before creating).
  //
  // Runs ~5 seconds after startup so the server can handle incoming requests
  // first, and runs in the background so it never blocks server startup even
  // if Drive is slow to respond.
  if (process.env.DRIVE_PREP_FOLDERS_ENABLED === '1' || process.env.DRIVE_PREP_FOLDERS_STARTUP === '1') {
    setTimeout(async () => {
      try {
        const googleDrive = require('./services/googleDrive.service');
        const driveSyncSvc = require('./services/driveSync.service');
        const { VALID_LINES: prepLines } = require('./services/sync.service');
        const tz = process.env.DRIVE_PREP_FOLDERS_TZ || 'Africa/Cairo';
        const today = driveSyncSvc.todayInTimezone(tz);
        console.log(`📁 Safety-net: ensuring today's folders exist for ${today.toISOString().slice(0,10)} (${tz})...`);
        for (const line of prepLines) {
          try {
            const r = await googleDrive.prepareDayFolders(line, today);
            const made = r.folders.filter(f => f.created).length;
            const kept = r.folders.length - made;
            if (made > 0) {
              console.log(`📁 Safety-net ${line} ${r.date}: created=${made} existing=${kept}  ← caught missing folders`);
            } else {
              console.log(`📁 Safety-net ${line} ${r.date}: all ${kept} folders already exist ✓`);
            }
          } catch (e) {
            console.error(`Safety-net prep ${line} failed:`, e.message);
          }
        }
      } catch (e) {
        console.error('Safety-net prep error:', e.message);
      }
    }, 5000);
  }

  // Graceful shutdown
  process.on('SIGTERM', () => { db.close(); process.exit(0); });
  process.on('SIGINT',  () => { db.close(); process.exit(0); });

}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
