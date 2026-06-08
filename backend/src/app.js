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
    if (!cols.includes('avatar_url')) {
      db._raw.run(`ALTER TABLE users ADD COLUMN avatar_url TEXT`);
      saveNow();
      console.log('✅ Migration: added `avatar_url` column to users');
    }
    // extra_departments: lets ONE leader oversee MULTIPLE sections in the
    // org chart (e.g. Mai leads both 'General' and 'Private'). Stored as a
    // comma-separated list. NULL on non-leaders. No data migration needed —
    // every existing user simply gets NULL until an admin assigns extras.
    if (!cols.includes('extra_departments')) {
      db._raw.run(`ALTER TABLE users ADD COLUMN extra_departments TEXT`);
      saveNow();
      console.log('✅ Migration: added `extra_departments` column to users');
    }
    // extra_managements: lets ONE admin/manager oversee MULTIPLE managements
    // (e.g. a Customer Services manager also has Quality access). Mirror of
    // extra_departments but at the management level. NULL by default.
    if (!cols.includes('extra_managements')) {
      db._raw.run(`ALTER TABLE users ADD COLUMN extra_managements TEXT`);
      saveNow();
      console.log('✅ Migration: added `extra_managements` column to users');
    }
    // extra_pages: per-user PAGE grants (CSV of page keys, e.g.
    // 'occupancy-trainers'). Lets a non-admin (e.g. a CS agent) see ONE specific
    // report page without changing their role — page-level granularity below the
    // role/management model. NULL by default.
    if (!cols.includes('extra_pages')) {
      db._raw.run(`ALTER TABLE users ADD COLUMN extra_pages TEXT`);
      saveNow();
      console.log('✅ Migration: added `extra_pages` column to users');
    }
    // start_date / end_date: employment lifecycle dates (YYYY-MM-DD).
    //   start_date → hire date (تاريخ التعيين)
    //   end_date   → termination date (تاريخ ترك العمل). NULL = still employed.
    // Both nullable, no default → every existing user stays "still employed"
    // (NULL end_date) so NOBODY is auto-deactivated by this migration.
    if (!cols.includes('start_date')) {
      db._raw.run(`ALTER TABLE users ADD COLUMN start_date TEXT`);
      saveNow();
      console.log('✅ Migration: added `start_date` column to users');
    }
    if (!cols.includes('end_date')) {
      db._raw.run(`ALTER TABLE users ADD COLUMN end_date TEXT`);
      saveNow();
      console.log('✅ Migration: added `end_date` column to users');
    }
  } catch (e) {
    console.error('users.line migration error:', e.message);
  }

  // ── Backfill start_date = creation date for users without one ─────────────
  // Business rule: hire date defaults to the account's creation date so the
  // admin doesn't have to enter it for the whole existing roster one by one.
  // New users will get their real hire date entered manually; if left blank
  // they too fall back to the creation date here on the next startup.
  // Idempotent — only fills rows whose start_date is still NULL/empty.
  try {
    db._raw.run(`
      UPDATE users
      SET start_date = DATE(created_at)
      WHERE (start_date IS NULL OR TRIM(start_date) = '')
        AND created_at IS NOT NULL
    `);
    const nBackfill = db._raw.exec(`SELECT changes()`)[0]?.values[0][0] || 0;
    if (nBackfill > 0) {
      saveNow();
      console.log(`✅ Migration: backfilled start_date = creation date for ${nBackfill} user(s)`);
    }
  } catch (e) {
    console.error('users start_date backfill error:', e.message);
  }

  // ── Auto-deactivate users whose employment end_date has passed ────────────
  // A user with a non-NULL end_date earlier than today is no longer employed,
  // so their account must not allow login. We flip is_active=0 here at startup
  // (login also re-checks, in case the server runs for days without restart).
  // NULL/empty end_date = still on the job → never touched.
  // admin/manager accounts (role='admin') are EXEMPT — they are never
  // auto-deactivated, to avoid locking out a manager by a stale end_date.
  try {
    db._raw.run(`
      UPDATE users
      SET is_active = 0, updated_at = datetime('now', '+2 hours')
      WHERE end_date IS NOT NULL
        AND TRIM(end_date) != ''
        AND DATE(end_date) < DATE('now', '+2 hours')
        AND is_active = 1
        AND role != 'admin'
    `);
    const nDeact = db._raw.exec(`SELECT changes()`)[0]?.values[0][0] || 0;
    if (nDeact > 0) {
      saveNow();
      console.log(`✅ Migration: auto-deactivated ${nDeact} user(s) past their employment end_date`);
    }
  } catch (e) {
    console.error('users end_date auto-deactivation error:', e.message);
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

  // ── team_members.shifts_json: canonical store for unlimited shifts ──────
  // Adds the column if missing, then backfills from existing shift/shift2
  // columns once (only when the JSON column is empty). After backfill, the
  // UI saves all shifts to JSON and mirrors the first two back to the legacy
  // columns — so any consumer that hasn't been migrated keeps working.
  try {
    const info = db._raw.exec(`PRAGMA table_info(team_members)`);
    const cols = info[0]?.values.map(r => r[1]) || [];
    if (cols.length > 0 && !cols.includes('shifts_json')) {
      db._raw.run(`ALTER TABLE team_members ADD COLUMN shifts_json TEXT`);
      saveNow();
      console.log('✅ Migration: added `shifts_json` column to team_members');
    }
    // Backfill — convert legacy shift/shift2 fields into the JSON array for
    // any member whose shifts_json is still NULL.
    const pendingMembers = db.prepare(
      `SELECT id,
              shift,  shift_start,  shift_end,  shift_rests,  voice_notes,
              employment_type,  work_days,  shift_start_date,  shift_end_date,
              shift2, shift2_start, shift2_end, shift2_rests, shift2_voice_notes,
              shift2_employment_type, shift2_work_days, shift2_start_date, shift2_end_date
         FROM team_members
        WHERE shifts_json IS NULL`
    ).all();
    if (pendingMembers.length > 0) {
      const update = db.prepare(`UPDATE team_members SET shifts_json = ? WHERE id = ?`);
      let backfilled = 0;
      const tx = db.transaction(() => {
        for (const m of pendingMembers) {
          const arr = [];
          if (m.shift) arr.push({
            shift: m.shift, start: m.shift_start, end: m.shift_end,
            rests: m.shift_rests, voice_notes: m.voice_notes,
            employment_type: m.employment_type, work_days: m.work_days,
            start_date: m.shift_start_date, end_date: m.shift_end_date,
          });
          if (m.shift2) arr.push({
            shift: m.shift2, start: m.shift2_start, end: m.shift2_end,
            rests: m.shift2_rests, voice_notes: m.shift2_voice_notes,
            employment_type: m.shift2_employment_type, work_days: m.shift2_work_days,
            start_date: m.shift2_start_date, end_date: m.shift2_end_date,
          });
          update.run(JSON.stringify(arr), m.id);
          backfilled += 1;
        }
      });
      tx();
      if (backfilled > 0) {
        saveNow();
        console.log(`✅ Migration: backfilled shifts_json for ${backfilled} team_members`);
      }
    }
  } catch (e) {
    console.error('team_members.shifts_json migration error:', e.message);
  }

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

  // ── Backfill: education-department trainers are line-agnostic.
  // Whenever an education trainer is still on a specific line (legacy data),
  // promote them to 'All' so they appear in every line's view. Idempotent —
  // re-running is a no-op once data is clean.
  try {
    const res = db._raw.exec(
      `SELECT COUNT(*) FROM team_members WHERE department='education' AND line != 'All'`
    );
    const stale = res[0]?.values?.[0]?.[0] || 0;
    if (stale > 0) {
      db._raw.run(`UPDATE team_members SET line='All' WHERE department='education' AND line != 'All'`);
      saveNow();
      console.log(`✅ Migration: promoted ${stale} education trainer(s) to line='All'`);
    }
  } catch (e) {
    console.error('education trainers line=All backfill error:', e.message);
  }

  // ── team_members.coordinator_type: distinguishes "منسق" from "منسق متعدد المهام"
  //   • 'standard'   → handles students only         (capacity 80..120)
  //   • 'multi_task' → students + extra responsibilities (capacity 70..85)
  //   • NULL         → not a coordinator (leaders, trainers, etc.)
  //
  // DEFAULT 'standard' — every existing team member becomes a regular
  // "منسق" automatically, no data migration required. The admin reclassifies
  // selected members to 'multi_task' from the Org Chart UI.
  try {
    const info = db._raw.exec(`PRAGMA table_info(team_members)`);
    const cols = info[0]?.values.map(r => r[1]) || [];
    if (cols.length > 0 && !cols.includes('coordinator_type')) {
      db._raw.run(`ALTER TABLE team_members ADD COLUMN coordinator_type TEXT NOT NULL DEFAULT 'standard'`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_team_coord_type ON team_members(coordinator_type)`);
      saveNow();
      console.log('✅ Migration: added `coordinator_type` column to team_members (default standard)');
    }
  } catch (e) {
    console.error('team_members.coordinator_type migration error:', e.message);
  }

  // ── team_members.start_date / end_date: employment lifecycle dates ────────
  // Customer Services team view mirrors the users feature:
  //   start_date → hire date (defaults to the creation date)
  //   end_date   → last day of work. NULL = still on the job.
  // Both nullable, no default → existing members stay "still employed" so the
  // sweep below never deactivates anyone on first run.
  try {
    const info = db._raw.exec(`PRAGMA table_info(team_members)`);
    const cols = info[0]?.values.map(r => r[1]) || [];
    if (cols.length > 0 && !cols.includes('start_date')) {
      db._raw.run(`ALTER TABLE team_members ADD COLUMN start_date TEXT`);
      saveNow();
      console.log('✅ Migration: added `start_date` column to team_members');
    }
    if (cols.length > 0 && !cols.includes('end_date')) {
      db._raw.run(`ALTER TABLE team_members ADD COLUMN end_date TEXT`);
      saveNow();
      console.log('✅ Migration: added `end_date` column to team_members');
    }
  } catch (e) {
    console.error('team_members.start_date/end_date migration error:', e.message);
  }

  // ── Backfill team_members.start_date = creation date when missing ─────────
  // Idempotent — only fills NULL/empty rows so the admin doesn't have to enter
  // a hire date for the whole existing roster.
  try {
    db._raw.run(`
      UPDATE team_members
      SET start_date = DATE(created_at)
      WHERE (start_date IS NULL OR TRIM(start_date) = '')
        AND created_at IS NOT NULL
    `);
    const nTmBackfill = db._raw.exec(`SELECT changes()`)[0]?.values[0][0] || 0;
    if (nTmBackfill > 0) {
      saveNow();
      console.log(`✅ Migration: backfilled team_members.start_date for ${nTmBackfill} member(s)`);
    }
  } catch (e) {
    console.error('team_members start_date backfill error:', e.message);
  }

  // ── Auto-deactivate team members whose employment end_date has passed ─────
  // A member with a past end_date is no longer on the job → status='inactive'.
  // NULL/empty end_date = still employed → never touched. Only members given a
  // date via the Customer Services UI ever carry an end_date, so education
  // members (whose end_date stays NULL) are unaffected.
  try {
    db._raw.run(`
      UPDATE team_members
      SET status = 'inactive'
      WHERE end_date IS NOT NULL
        AND TRIM(end_date) != ''
        AND DATE(end_date) < DATE('now', '+2 hours')
        AND status = 'active'
    `);
    const nTmDeact = db._raw.exec(`SELECT changes()`)[0]?.values[0][0] || 0;
    if (nTmDeact > 0) {
      saveNow();
      console.log(`✅ Migration: set ${nTmDeact} team member(s) inactive (past employment end_date)`);
    }
  } catch (e) {
    console.error('team_members end_date auto-deactivation error:', e.message);
  }

  // ── team_member_extra_shifts: one-off extra-hour entries for trainers ────
  // who come back for a few hours AFTER their main shift end_date. Each row
  // is a single date's time block; counts toward trainer utilization on
  // that day. Created via the team-member edit modal.
  try {
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS team_member_extra_shifts (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        team_member_id  INTEGER NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
        date            TEXT NOT NULL,
        start_time      TEXT,
        end_time        TEXT,
        duration_min    INTEGER NOT NULL,
        notes           TEXT,
        created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_tmes_member ON team_member_extra_shifts(team_member_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_tmes_date   ON team_member_extra_shifts(date)`);
    saveNow();
    console.log('✅ Migration: team_member_extra_shifts table ready');
  } catch (e) {
    console.error('team_member_extra_shifts migration error:', e.message);
  }

  // ── official_holidays: ranges where lectures get bulk-rescheduled ────────
  // Admin enters an entry per holiday (start..end + name). The sync service
  // uses it to AUTO-MARK lecture reschedules whose old_date falls in the
  // range as reason='official_holiday' (and auto-approves them so admins
  // don't have to triage Eid/national-day shifts manually).
  try {
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS official_holidays (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        start_date  TEXT NOT NULL,
        end_date    TEXT NOT NULL,
        notes       TEXT,
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_holiday_range ON official_holidays(start_date, end_date)`);
    saveNow();
    console.log('✅ Migration: official_holidays table ready');
  } catch (e) {
    console.error('official_holidays migration error:', e.message);
  }

  // ── trainer_salary_defs: PRIVATE salary-definition table ────────────────
  // Owner-only feature (System Admin, username='admin'). Stores the RAW
  // salary inputs per trainer category/shift; the derived columns
  // (T.W Hours = days*hr*week, Per Hour = total_amount/tw_hours,
  //  Rate Per H For Kpis = kpis/tw_hours) are computed on display, NOT stored.
  // Backend routes (trainer-salaries.routes.js) reject anyone but the owner.
  try {
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS trainer_salary_defs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        category      TEXT    NOT NULL DEFAULT '',
        shift_type    TEXT    NOT NULL DEFAULT 'Full Time',
        days          REAL    NOT NULL DEFAULT 0,
        hr            REAL    NOT NULL DEFAULT 0,
        week          REAL    NOT NULL DEFAULT 0,
        total_amount  REAL    NOT NULL DEFAULT 0,
        kpis          REAL    NOT NULL DEFAULT 0,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now', '+2 hours')),
        updated_at    TEXT    NOT NULL DEFAULT (datetime('now', '+2 hours'))
      )
    `);
    // Seed the 3 reference rows from the original spec — ONLY on a fresh table.
    const hasRows = db._raw.exec(`SELECT COUNT(*) FROM trainer_salary_defs`)[0]?.values[0][0] || 0;
    if (!hasRows) {
      const seed = db._raw.prepare(`
        INSERT INTO trainer_salary_defs (category, shift_type, days, hr, week, total_amount, kpis, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      seed.run('فون كول',       'Full Time', 6, 8, 4, 6000, 750, 1);
      seed.run('جلسات اساسيه',  'Part Time', 4, 8, 4, 6000, 400, 2);
      seed.run('جلسات اساسيه',  'Full Time', 6, 8, 4, 8000, 750, 3);
    }
    saveNow();
    console.log('✅ Migration: trainer_salary_defs table ready');
  } catch (e) {
    console.error('trainer_salary_defs migration error:', e.message);
  }

  // ── trainer_salary_systems: named groups ("نظام مدرب") for the salary defs ──
  // Each system groups one or more shift rows. The owner adds a new trainer
  // system (a named group) and attaches shift rows under it — mirroring the
  // merged "مدرب" grouping in the original Excel. Rows link via defs.system_id.
  try {
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS trainer_salary_systems (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now', '+2 hours')),
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now', '+2 hours'))
      )
    `);
    // Add the system_id link column to the defs table if it's not there yet.
    const defCols = (db._raw.exec(`PRAGMA table_info(trainer_salary_defs)`)[0]?.values || []).map(v => v[1]);
    if (!defCols.includes('system_id')) {
      db._raw.run(`ALTER TABLE trainer_salary_defs ADD COLUMN system_id INTEGER REFERENCES trainer_salary_systems(id) ON DELETE CASCADE`);
    }
    // Backfill: convert each distinct category of any unlinked row into a
    // named system and link the rows, so existing/seeded data keeps showing
    // under a proper group instead of disappearing.
    const orphans = db._raw.exec(`SELECT COUNT(*) FROM trainer_salary_defs WHERE system_id IS NULL`)[0]?.values[0][0] || 0;
    if (orphans) {
      const cats = db.prepare(`SELECT DISTINCT category FROM trainer_salary_defs WHERE system_id IS NULL`).all();
      let order = db.prepare(`SELECT COALESCE(MAX(sort_order),0) AS m FROM trainer_salary_systems`).get().m;
      const findSys = db.prepare(`SELECT id FROM trainer_salary_systems WHERE name = ?`);
      const insSys  = db.prepare(`INSERT INTO trainer_salary_systems (name, sort_order) VALUES (?, ?)`);
      const linkRows = db.prepare(`UPDATE trainer_salary_defs SET system_id = ? WHERE system_id IS NULL AND category = ?`);
      for (const { category } of cats) {
        const name = String(category || '').trim();
        let sysId = findSys.get(name)?.id;
        if (!sysId) { order += 1; sysId = insSys.run(name, order).lastInsertRowid; }
        linkRows.run(sysId, category);
      }
    }
    saveNow();
    console.log('✅ Migration: trainer_salary_systems table ready');
  } catch (e) {
    console.error('trainer_salary_systems migration error:', e.message);
  }

  // ── trainer_salary_defs manual-override columns ─────────────────────────
  // Let the owner type T.W Hours / Per Hours / Rate Per H Kpis by hand to
  // override the auto formula. NULL = use the computed value; a number = a
  // manual override that wins over the formula on display.
  try {
    const cols = (db._raw.exec(`PRAGMA table_info(trainer_salary_defs)`)[0]?.values || []).map(v => v[1]);
    if (!cols.includes('tw_hours_override'))   db._raw.run(`ALTER TABLE trainer_salary_defs ADD COLUMN tw_hours_override REAL`);
    if (!cols.includes('per_hour_override'))   db._raw.run(`ALTER TABLE trainer_salary_defs ADD COLUMN per_hour_override REAL`);
    if (!cols.includes('rate_per_h_override')) db._raw.run(`ALTER TABLE trainer_salary_defs ADD COLUMN rate_per_h_override REAL`);
    saveNow();
    console.log('✅ Migration: trainer_salary_defs override columns ready');
  } catch (e) {
    console.error('trainer_salary_defs override migration error:', e.message);
  }

  // ── trainer_deductions: PRIVATE owner-only salary deductions ────────────
  // Each row = one deduction for a trainer on a date, either in hours or in
  // days. The money value is computed on the client from the trainer's
  // salary row (hours × per-hour, days × per-hour × Hr). Owner-only via the
  // trainer-salaries routes.
  try {
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS trainer_deductions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        trainer_id  INTEGER NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
        kind        TEXT    NOT NULL DEFAULT 'hours',  -- 'hours' | 'days'
        amount      REAL    NOT NULL DEFAULT 0,        -- number of hours or days
        date        TEXT    NOT NULL,                  -- YYYY-MM-DD
        note        TEXT,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now', '+2 hours'))
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_trainer_deductions_t ON trainer_deductions(trainer_id, date)`);
    saveNow();
    console.log('✅ Migration: trainer_deductions table ready');
  } catch (e) {
    console.error('trainer_deductions migration error:', e.message);
  }

  // ── lecture_reschedules: audit trail for lectures moved between dates ────
  // Sync detection writes here whenever the diff between an old & new
  // lectures Excel finds a (group + trainer + session_type) tuple that
  // disappeared from date X and reappeared on date Y. Admin then approves
  // or rejects through dedicated routes; admin-only notes column is kept
  // separate from any user-visible explanation.
  try {
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS lecture_reschedules (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        group_name        TEXT NOT NULL,
        line              TEXT NOT NULL,
        session_type      TEXT NOT NULL,
        old_date          TEXT NOT NULL,
        old_time          TEXT,
        old_trainer       TEXT,
        old_duration      TEXT,
        new_date          TEXT NOT NULL,
        new_time          TEXT,
        new_trainer       TEXT,
        new_duration      TEXT,
        detected_at       TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        excel_sync_id     INTEGER REFERENCES excel_syncs(id) ON DELETE SET NULL,
        reschedule_reason TEXT,
        holiday_id        INTEGER REFERENCES official_holidays(id) ON DELETE SET NULL,
        approval_status   TEXT NOT NULL DEFAULT 'pending'
                          CHECK(approval_status IN ('pending','approved','rejected','auto')),
        approved_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
        approved_at       TEXT,
        rejection_reason  TEXT,
        admin_notes       TEXT
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_resched_status   ON lecture_reschedules(approval_status)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_resched_old_date ON lecture_reschedules(old_date)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_resched_new_date ON lecture_reschedules(new_date)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_resched_group    ON lecture_reschedules(group_name)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_resched_trainer  ON lecture_reschedules(old_trainer)`);
    saveNow();
    console.log('✅ Migration: lecture_reschedules table ready');
  } catch (e) {
    console.error('lecture_reschedules migration error:', e.message);
  }

  // ── todos.due_date_end: support multi-day tasks (date ranges) ─────────────
  // A task can now span a date range. due_date = start, due_date_end = end.
  // NULL due_date_end means a single-day task (backward-compatible with all
  // existing rows). Bucket filters & "today" matching use range overlap.
  try {
    const info = db._raw.exec(`PRAGMA table_info(todos)`);
    const cols = info[0]?.values.map(r => r[1]) || [];
    if (cols.length > 0 && !cols.includes('due_date_end')) {
      db._raw.run(`ALTER TABLE todos ADD COLUMN due_date_end TEXT`);
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_todos_due_end ON todos(due_date_end)`);
      saveNow();
      console.log('✅ Migration: added `due_date_end` column to todos (NULL = single-day)');
    }
  } catch (e) {
    console.error('todos.due_date_end migration error:', e.message);
  }

  // ── coordinator_history: backfill effective_from to earliest lecture date ──
  // Root cause: when a group is first synced, effective_from was set to the
  // sync timestamp (nowIso). If sessions were uploaded with dates BEFORE the
  // first sync, coordFilterAtDate('l.date' <= effective_from) returns nothing.
  //
  // Fix: for each coordinator_history row whose effective_from is LATER than
  // the group's earliest lecture, set effective_from = earliest lecture date.
  // SAFETY guard: only backdate records that are the INITIAL coordinator
  // assignment for this group (no prior closed record exists that ended before
  // this one started) — so mid-group coordinator changes are never backdated.
  try {
    const fixed = db._raw.exec(`
      UPDATE coordinator_history
      SET effective_from = (
        SELECT MIN(l.date)
        FROM lectures l
        WHERE l.group_name = coordinator_history.group_name
          AND l.line       = coordinator_history.line
          AND l.status    != 'غير مؤكدة'
      )
      WHERE (
        SELECT MIN(l.date)
        FROM lectures l
        WHERE l.group_name = coordinator_history.group_name
          AND l.line       = coordinator_history.line
          AND l.status    != 'غير مؤكدة'
      ) < DATE(coordinator_history.effective_from)
      AND NOT EXISTS (
        SELECT 1 FROM coordinator_history ch2
        WHERE ch2.group_name   = coordinator_history.group_name
          AND ch2.line         = coordinator_history.line
          AND ch2.effective_to IS NOT NULL
          AND DATE(ch2.effective_to) <= DATE(coordinator_history.effective_from)
      )
    `);
    const n = db._raw.exec(`SELECT changes()`)[0]?.values[0][0] || 0;
    if (n > 0) {
      saveNow();
      console.log(`✅ Migration: backdated ${n} coordinator_history row(s) to earliest lecture date`);
    }
  } catch (e) {
    console.error('coordinator_history backfill migration error:', e.message);
  }

  // ── lectures: fix wrongly classified 30-min side sessions ─────────────────
  // 30-minute phone-call sessions were classified as onboarding/offboarding
  // because classifySideSession only treated 15-min sessions as 'regular'.
  // We now also treat 30-min sessions as 'regular'. Backfill existing rows.
  try {
    db._raw.run(`
      UPDATE lectures
      SET side_session_category = 'regular'
      WHERE session_type = 'side'
        AND duration = '00:30'
        AND side_session_category IN ('onboarding', 'offboarding')
    `);
    const n2 = db._raw.exec(`SELECT changes()`)[0]?.values[0][0] || 0;
    if (n2 > 0) {
      saveNow();
      console.log('✅ Migration: reclassified ' + n2 + ' 30-min side session(s) from onboarding/offboarding → regular');
    }
  } catch (e) {
    console.error('lectures 30-min side session reclassify migration error:', e.message);
  }

  // ── lectures: fix short side sessions (< 20 min) wrongly classified ─────────
  // Any side session shorter than 20 minutes is always a regular zoom call.
  // Some sessions (e.g. 14-min) may have been mis-classified as onboarding or
  // offboarding due to format edge-cases. Fix them now.
  // Uses the same HH:MM / MM:SS disambiguation as normalizeDuration() in JS:
  //   first segment >= 5  → MM:SS format, minutes = first segment
  //   first segment < 5   → HH:MM format, minutes = first*60 + second
  try {
    db._raw.run(`
      UPDATE lectures
      SET side_session_category = 'regular'
      WHERE session_type = 'side'
        AND duration IS NOT NULL AND TRIM(duration) != ''
        AND INSTR(duration, ':') > 0
        AND side_session_category IN ('onboarding', 'offboarding')
        AND (
          CASE
            WHEN CAST(SUBSTR(duration, 1, INSTR(duration,':')-1) AS INTEGER) >= 5
            THEN CAST(SUBSTR(duration, 1, INSTR(duration,':')-1) AS INTEGER)
            ELSE CAST(SUBSTR(duration, 1, INSTR(duration,':')-1) AS INTEGER) * 60
                 + CAST(SUBSTR(duration, INSTR(duration,':')+1, 2) AS INTEGER)
          END
        ) < 20
    `);
    const nShort = db._raw.exec(`SELECT changes()`)[0]?.values[0][0] || 0;
    if (nShort > 0) {
      saveNow();
      console.log('✅ Migration: fixed ' + nShort + ' short side session(s) (< 20 min) → regular');
    }
  } catch (e) {
    console.error('lectures short side session fix migration error:', e.message);
  }

  // ── lectures: reclassify first-session side sessions >= 20 min → onboarding ─
  // New rule: onboarding = position 1 (earliest session for the group) AND
  // duration >= 20 min. Previously the threshold was > 30 min.
  // Backfill: find sessions that ARE the earliest for their group AND have
  // 20 ≤ duration ≤ 50 min AND are currently classified as 'regular'.
  try {
    db._raw.run(`
      UPDATE lectures
      SET side_session_category = 'onboarding'
      WHERE session_type = 'side'
        AND status != 'غير مؤكدة'
        AND side_session_category = 'regular'
        AND duration IS NOT NULL
        AND (CAST(SUBSTR(duration,1,2) AS INTEGER)*60 + CAST(SUBSTR(duration,4,2) AS INTEGER)) >= 20
        AND (CAST(SUBSTR(duration,1,2) AS INTEGER)*60 + CAST(SUBSTR(duration,4,2) AS INTEGER)) <= 50
        AND (date || '|' || COALESCE(time,'')) = (
          SELECT MIN(l2.date || '|' || COALESCE(l2.time,''))
          FROM lectures l2
          WHERE l2.group_name   = lectures.group_name
            AND l2.line         = lectures.line
            AND l2.session_type = 'side'
            AND l2.status      != 'غير مؤكدة'
        )
    `);
    const nb = db._raw.exec(`SELECT changes()`)[0]?.values[0][0] || 0;
    if (nb > 0) {
      saveNow();
      console.log('✅ Migration: reclassified ' + nb + ' side session(s) to onboarding (>=20min first session)');
    }
  } catch (e) {
    console.error('lectures onboarding>=20min migration error:', e.message);
  }

  // ── absent_zoom_students: normalize group_name to match batches canonical names ──
  // Excel uploads may have group names with extra/missing spaces vs. batches/lectures.
  // E.g. absent has "May_4_Mon_3Pm_Starter3_P(Sara Salah)magdy"
  //      batches has "May_4_Mon_3Pm_ Starter3_P(Sara Salah)magdy"  ← extra space
  // Fix: update every absent_zoom row whose group_name differs from batches only by
  // spaces, aligning it to the exact canonical batches name so JOINs work naturally.
  try {
    db._raw.run(`
      UPDATE absent_zoom_students
      SET group_name = (
        SELECT b.group_name
        FROM batches b
        WHERE REPLACE(b.group_name, ' ', '') = REPLACE(absent_zoom_students.group_name, ' ', '')
        LIMIT 1
      )
      WHERE EXISTS (
        SELECT 1 FROM batches b
        WHERE REPLACE(b.group_name, ' ', '') = REPLACE(absent_zoom_students.group_name, ' ', '')
          AND b.group_name != absent_zoom_students.group_name
      )
    `);
    const nNorm = db._raw.exec(`SELECT changes()`)[0]?.values[0][0] || 0;
    if (nNorm > 0) {
      saveNow();
      console.log(`✅ Migration: normalized ${nNorm} absent_zoom_students group_name(s) to match batches canonical names`);
    }
  } catch (e) {
    console.error('absent_zoom_students group_name normalization error:', e.message);
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

  // ── lectures_history: archive for PHANTOM scheduled rows ─────────────────
  // When a trainer/group leaves, their recurring `مجدولة` (scheduled) slots are
  // removed from the live Drive sheet, but rows already imported linger in the
  // DB (the importer only deletes group+date keys present in the new file).
  // syncLectures/syncSideSessions now move those stale scheduled rows here
  // (NEVER `مؤكدة` — real delivered history stays in `lectures`). Archived, not
  // deleted, so the operation is fully reversible.
  try {
    db._raw.run(`CREATE TABLE IF NOT EXISTS lectures_history (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name            TEXT,
      date                  TEXT,
      time                  TEXT,
      duration              TEXT,
      trainer               TEXT,
      status                TEXT,
      location              TEXT,
      attendance            TEXT,
      session_type          TEXT,
      side_session_category TEXT,
      line                  TEXT,
      synced_at             TEXT,
      archived_at           TEXT,
      archived_reason       TEXT
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_lectures_history_grp ON lectures_history(line, session_type, group_name, date)`);
    console.log('✅ Migration: lectures_history ready');
  } catch (e) { console.error('lectures_history migration:', e.message); }

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
    // Archive tables for DUPLICATE/GHOST absence rows (same root cause as
    // phantom lectures): a re-upload moving a record to a new group leaves the
    // OLD wrong-group row behind (importer deletes only the new file's
    // group+date keys), inflating that coordinator's absences. dedupeAbsenceTable
    // keeps the latest synced row per (line, phone-or-name, date, time) and moves
    // the older duplicates here (reversible; same phone+date+time = one event).
    db._raw.run(`CREATE TABLE IF NOT EXISTS absent_students_history AS SELECT * FROM absent_students WHERE 0`);
    if (!(db._raw.exec(`PRAGMA table_info(absent_students_history)`)[0]?.values.map(r => r[1]) || []).includes('archived_at'))
      db._raw.run(`ALTER TABLE absent_students_history ADD COLUMN archived_at TEXT`);
    db._raw.run(`CREATE TABLE IF NOT EXISTS absent_zoom_students_history AS SELECT * FROM absent_zoom_students WHERE 0`);
    if (!(db._raw.exec(`PRAGMA table_info(absent_zoom_students_history)`)[0]?.values.map(r => r[1]) || []).includes('archived_at'))
      db._raw.run(`ALTER TABLE absent_zoom_students_history ADD COLUMN archived_at TEXT`);
    console.log('✅ Migration: absent_*_history ready');
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
  // NOTE: A previous one-time migration backfilled effective_from to
  // '2000-01-01' for orphan active coord/remark history entries. That migration
  // was REMOVED on 2026-05-18 because it caused over-attribution for renamed
  // groups (e.g. historical absences with the new group_name were being
  // attributed to the new coordinator instead of the old one). Date-aware
  // attribution is now handled correctly via the `group_renames` table —
  // queries resolve a record's group_name to its historical form at the
  // event's date. The '2000-01-01' values already in the DB are harmless
  // because the rename-aware filter routes pre-rename lookups to the OLD
  // group_name (which has its own coord_history entry).

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

  // ── user_department_history bootstrap + backfill ─────────────────────────
  // Creates the table if missing and seeds one record per user with their
  // current department. Going forward, dept changes are tracked via the
  // admin PUT /users/:id handler (closes old record + opens new). Baseline
  // uses far-past effective_from so historical events fall inside the
  // record (legacy behavior preserved for unchanged users).
  try {
    db._raw.run(`CREATE TABLE IF NOT EXISTS user_department_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_name       TEXT NOT NULL,
      department      TEXT NOT NULL,
      effective_from  TEXT NOT NULL,
      effective_to    TEXT,
      detected_at     TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_udh_user  ON user_department_history(user_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_udh_name  ON user_department_history(user_name COLLATE NOCASE)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_udh_dates ON user_department_history(effective_from, effective_to)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_udh_dept  ON user_department_history(department)`);

    const udhCount = db.prepare(`SELECT COUNT(*) AS cnt FROM user_department_history`).get();
    if (udhCount && udhCount.cnt === 0) {
      // Backfill: one record per user with valid dept, effective_from far past
      const usrs = db.prepare(
        `SELECT id, full_name, department FROM users
          WHERE department IS NOT NULL AND department != 'All'
            AND full_name IS NOT NULL AND TRIM(full_name) != ''`
      ).all();
      const insertUdh = db.prepare(
        `INSERT INTO user_department_history (user_id, user_name, department, effective_from, effective_to)
         VALUES (?, ?, ?, '2000-01-01', NULL)`
      );
      let seeded = 0;
      const tx = db.transaction(() => {
        for (const u of usrs) { insertUdh.run(u.id, u.full_name.trim(), u.department); seeded += 1; }
      });
      tx();
      if (seeded > 0) {
        saveNow();
        console.log(`✅ Migration: user_department_history seeded with ${seeded} baseline rows`);
      }
    }
  } catch (e) {
    console.error('user_department_history bootstrap error:', e.message);
  }

  // ── team_member_dept_history bootstrap + backfill ────────────────────────
  // Mirrors user_department_history but for team_members, storing BOTH the
  // management (department: customer_services/education) and the sub-dept
  // (section: general/private/semi/...). Going forward, dept/section changes
  // are tracked via PUT /team/:id (closes old record + opens new). The absence
  // reports attribute each absence to the coordinator's SECTION at the time of
  // the event using this table, which takes PRECEDENCE over the users table's
  // history. Baseline effective_from='2000-01-01' so historical events fall
  // inside the seeded record (same convention as user_department_history).
  try {
    db._raw.run(`CREATE TABLE IF NOT EXISTS team_member_dept_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      team_member_id  INTEGER NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
      member_name     TEXT NOT NULL,
      department      TEXT NOT NULL,
      section         TEXT NOT NULL,
      effective_from  TEXT NOT NULL,
      effective_to    TEXT,
      detected_at     TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_tmdh_member  ON team_member_dept_history(team_member_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_tmdh_name    ON team_member_dept_history(member_name COLLATE NOCASE)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_tmdh_dates   ON team_member_dept_history(effective_from, effective_to)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_tmdh_section ON team_member_dept_history(section)`);

    const tmdhCount = db.prepare(`SELECT COUNT(*) AS cnt FROM team_member_dept_history`).get();
    if (tmdhCount && tmdhCount.cnt === 0) {
      // Backfill strategy — start 100% consistent with the legacy absence logic.
      // The absence filter attributes each event by the COORDINATOR-of-record;
      // only Customer-Services members are ever coordinators, so:
      //   • Customer-Services members → IMPORT their user_department_history rows
      //     verbatim (department→section via lower-case). This reproduces the
      //     EXACT attribution the old user-history filter produced, including
      //     historical mid-period transitions. A CS member with NO user history
      //     gets NO seed row — so the filter keeps falling back to dept_type
      //     exactly like before (seeding a flat row here would wrongly override
      //     dept_type and shift numbers on day one).
      //   • Education / appointments members are NOT coordinators, so a flat
      //     baseline row (current section, from 2000-01-01) is harmless for the
      //     reports and just gives their history modal a sensible starting point.
      const tms = db.prepare(
        `SELECT id, name, department, section FROM team_members
          WHERE name IS NOT NULL AND TRIM(name) != ''
            AND department IS NOT NULL AND section IS NOT NULL`
      ).all();
      const getUserHist = db.prepare(
        `SELECT department, effective_from, effective_to
           FROM user_department_history
          WHERE LOWER(TRIM(user_name)) = LOWER(TRIM(?))
            AND department IS NOT NULL AND TRIM(department) != ''
          ORDER BY DATE(effective_from), id`
      );
      const insImported = db.prepare(
        `INSERT INTO team_member_dept_history (team_member_id, member_name, department, section, effective_from, effective_to)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const insFlat = db.prepare(
        `INSERT INTO team_member_dept_history (team_member_id, member_name, department, section, effective_from, effective_to)
         VALUES (?, ?, ?, ?, '2000-01-01', NULL)`
      );
      let seededTm = 0, importedRows = 0, importedMembers = 0, flatMembers = 0, skippedCs = 0;
      const txTm = db.transaction(() => {
        for (const m of tms) {
          const nm = m.name.trim();
          if (m.department === 'customer_services') {
            const hist = getUserHist.all(nm);
            if (hist.length > 0) {
              for (const h of hist) {
                insImported.run(m.id, nm, m.department, String(h.department).toLowerCase().trim(), h.effective_from, h.effective_to || null);
                seededTm += 1; importedRows += 1;
              }
              importedMembers += 1;
            } else {
              // No user history → leave empty so dept_type fallback is preserved.
              skippedCs += 1;
            }
          } else {
            insFlat.run(m.id, nm, m.department, m.section);
            seededTm += 1; flatMembers += 1;
          }
        }
      });
      txTm();
      if (seededTm > 0) {
        saveNow();
        console.log(`✅ Migration: team_member_dept_history seeded ${seededTm} rows (imported ${importedRows} row(s) for ${importedMembers} CS member(s); ${flatMembers} non-CS baseline; ${skippedCs} CS member(s) left empty to preserve dept_type fallback)`);
      }
    }
  } catch (e) {
    console.error('team_member_dept_history bootstrap error:', e.message);
  }

  // ── Sync CS team_members.start_date FROM users.start_date ─────────────────
  // Users (login accounts) are the source of truth for تاريخ التعيين (hire
  // date). Mirror it onto Customer-Services team members, matched by
  // users.username ↔ team_members.name. Idempotent — only rows whose date
  // actually differs are touched (so re-runs are no-ops). Ongoing changes are
  // propagated live by POST/PUT /api/admin/users.
  try {
    db._raw.run(`
      UPDATE team_members
         SET start_date = (
           SELECT substr(u.start_date, 1, 10) FROM users u
            WHERE LOWER(TRIM(u.username)) = LOWER(TRIM(team_members.name))
              AND u.start_date IS NOT NULL AND TRIM(u.start_date) != ''
            LIMIT 1
         )
       WHERE department = 'customer_services'
         AND EXISTS (
           SELECT 1 FROM users u
            WHERE LOWER(TRIM(u.username)) = LOWER(TRIM(team_members.name))
              AND u.start_date IS NOT NULL AND TRIM(u.start_date) != ''
              AND substr(u.start_date, 1, 10) != COALESCE(substr(team_members.start_date, 1, 10), '')
         )
    `);
    const nHire = db._raw.exec(`SELECT changes()`)[0]?.values[0][0] || 0;
    if (nHire > 0) {
      saveNow();
      console.log(`✅ Migration: synced ${nHire} CS team_members.start_date from users (hire-date source of truth)`);
    }
  } catch (e) {
    console.error('team start_date sync migration error:', e.message);
  }

  // ── group_count_approvals bootstrap ──────────────────────────────────────
  // "Receive a group" feature: stores the approved baseline client count per
  // group. Keyed by (group_name, line) so it survives the Excel sync that
  // rebuilds the `batches` table. No backfill — groups stay unapproved until
  // a user explicitly receives them.
  try {
    db._raw.run(`CREATE TABLE IF NOT EXISTS group_count_approvals (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name       TEXT NOT NULL,
      line             TEXT NOT NULL DEFAULT 'Ahmed Hassan',
      approved_count   INTEGER NOT NULL,
      approved_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_by_name TEXT,
      approved_at      TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
      updated_at       TEXT,
      UNIQUE(group_name, line)
    )`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_gca_group_line ON group_count_approvals(group_name, line)`);
    saveNow();
  } catch (e) {
    console.error('group_count_approvals bootstrap error:', e.message);
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

  // ── FINANCE INTEGRATION (Phase 1): Center App transactions mirror ────────
  // Read-only sync of the Finance Transactions API from center-app-2 (separate
  // app, same academy). Foundation for the client-level-progression system —
  // every new_enrollment / renewal / upgrade transaction becomes a lifecycle
  // event for the client.
  //
  // The sync engine (services/financeSync.service.js) polls
  //   GET /api/external/transactions?since=<cursor>&limit=500
  // every 30s and upserts here by `id` (Center App UUID = stable PK).
  //
  // 5 tables, all independent of existing schema. Safe to recreate / drop without
  // affecting any other feature.
  //
  // Notes on field choices:
  //   • `amount` stored as TEXT, not REAL — sql.js coerces decimals to float and
  //     loses precision. We keep the raw API string and parse on read.
  //   • `raw_json` keeps the full API payload — if the API adds fields we don't
  //     know about yet, or we hit a bug, we can replay/inspect without re-fetching.
  //   • `matched_client_id` stays NULL in Phase 1; Phase 2 will populate it from
  //     phone/name match against the academy `clients` table.
  try {
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS finance_transactions (
        id                  TEXT PRIMARY KEY,
        date                TEXT,
        client_name         TEXT,
        client_phone        TEXT,
        type                TEXT,
        amount              TEXT,
        currency            TEXT,
        category            TEXT,
        status              TEXT,
        discount_label      TEXT,
        discount_pct        TEXT,
        job                 TEXT,
        classify            TEXT,
        note                TEXT,
        has_installments    INTEGER NOT NULL DEFAULT 0,
        product_id          TEXT,
        product_name        TEXT,
        deal_type           TEXT,
        governorate         TEXT,
        agent_id            TEXT,
        agent_name          TEXT,
        created_by          TEXT,
        created_by_name     TEXT,
        approved_by         TEXT,
        approved_by_name    TEXT,
        approved_at         TEXT,
        rejection_reason    TEXT,
        department_id       TEXT,
        department_name     TEXT,
        created_at          TEXT,
        updated_at          TEXT,
        synced_at           TEXT,
        matched_client_id   INTEGER,
        raw_json            TEXT
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_finance_tx_updated ON finance_transactions(updated_at)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_finance_tx_date    ON finance_transactions(date)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_finance_tx_phone   ON finance_transactions(client_phone)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_finance_tx_name    ON finance_transactions(client_name COLLATE NOCASE)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_finance_tx_status  ON finance_transactions(status)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_finance_tx_type    ON finance_transactions(type)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_finance_tx_matched ON finance_transactions(matched_client_id)`);

    db._raw.run(`
      CREATE TABLE IF NOT EXISTS finance_installments (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id  TEXT NOT NULL REFERENCES finance_transactions(id) ON DELETE CASCADE,
        installment_no  INTEGER,
        amount          TEXT,
        due_date        TEXT,
        paid            INTEGER NOT NULL DEFAULT 0,
        paid_at         TEXT,
        note            TEXT,
        synced_at       TEXT
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_finance_inst_tx ON finance_installments(transaction_id)`);

    db._raw.run(`
      CREATE TABLE IF NOT EXISTS finance_audit_events (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id  TEXT NOT NULL REFERENCES finance_transactions(id) ON DELETE CASCADE,
        event_type      TEXT,
        event_at        TEXT,
        actor_id        TEXT,
        actor_name      TEXT,
        details         TEXT,
        fetched_at      TEXT
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_finance_audit_tx ON finance_audit_events(transaction_id)`);

    db._raw.run(`
      CREATE TABLE IF NOT EXISTS finance_sync_state (
        id                    INTEGER PRIMARY KEY,
        cursor                TEXT,
        last_poll_at          TEXT,
        last_success_at       TEXT,
        last_error            TEXT,
        last_error_at         TEXT,
        total_synced          INTEGER NOT NULL DEFAULT 0,
        consecutive_errors    INTEGER NOT NULL DEFAULT 0,
        backfill_completed    INTEGER NOT NULL DEFAULT 0,
        backfill_started_at   TEXT,
        backfill_finished_at  TEXT
      )
    `);
    // Single-row table — seed id=1 so the sync engine can always UPDATE WHERE id=1.
    db._raw.run(`INSERT OR IGNORE INTO finance_sync_state (id) VALUES (1)`);

    db._raw.run(`
      CREATE TABLE IF NOT EXISTS finance_sync_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at      TEXT,
        finished_at     TEXT,
        mode            TEXT,
        rows_fetched    INTEGER NOT NULL DEFAULT 0,
        rows_inserted   INTEGER NOT NULL DEFAULT 0,
        rows_updated    INTEGER NOT NULL DEFAULT 0,
        rows_skipped    INTEGER NOT NULL DEFAULT 0,
        pages_fetched   INTEGER NOT NULL DEFAULT 0,
        cursor_before   TEXT,
        cursor_after    TEXT,
        status          TEXT,
        error           TEXT,
        triggered_by    TEXT
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_finance_log_started ON finance_sync_log(started_at DESC)`);

    saveNow();
    console.log('✅ Migration: finance_* tables ready (transactions, installments, audit_events, sync_state, sync_log)');
  } catch (e) {
    console.error('finance tables migration error:', e.message);
  }

  // ── FINANCE INTEGRATION (Phase 2): client matching ───────────────────────
  // Add columns to finance_transactions tracking the auto-/manual-match state,
  // and a candidates table holding multiple possible client matches when
  // disambiguation is needed. Phase 1's `matched_client_id` becomes the final
  // resolved match — these new columns trace HOW we got there.
  //
  // match_method values:
  //   NULL          → never attempted yet
  //   'auto_phone'  → matched by normalized phone, single candidate, high conf
  //   'auto_name'   → matched by token-exact name, single candidate
  //   'manual'      → admin picked from candidates UI
  //   'ambiguous'   → 2+ candidates found, needs manual review
  //   'unmatched'   → 0 candidates found
  try {
    const ftCols = db._raw.exec(`PRAGMA table_info(finance_transactions)`)[0]?.values.map(r => r[1]) || [];
    if (ftCols.length > 0) {
      if (!ftCols.includes('match_method')) {
        db._raw.run(`ALTER TABLE finance_transactions ADD COLUMN match_method TEXT`);
      }
      if (!ftCols.includes('match_confidence')) {
        db._raw.run(`ALTER TABLE finance_transactions ADD COLUMN match_confidence TEXT`);
      }
      if (!ftCols.includes('match_attempted_at')) {
        db._raw.run(`ALTER TABLE finance_transactions ADD COLUMN match_attempted_at TEXT`);
      }
      if (!ftCols.includes('matched_by')) {
        db._raw.run(`ALTER TABLE finance_transactions ADD COLUMN matched_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
      }
      db._raw.run(`CREATE INDEX IF NOT EXISTS idx_finance_tx_match_method ON finance_transactions(match_method)`);
    }

    // Candidates: only populated when match_method='ambiguous'. Lets the
    // admin pick from a known list rather than searching from scratch.
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS finance_match_candidates (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id  TEXT NOT NULL REFERENCES finance_transactions(id) ON DELETE CASCADE,
        client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        method          TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        UNIQUE(transaction_id, client_id)
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_finance_match_cand_tx     ON finance_match_candidates(transaction_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_finance_match_cand_client ON finance_match_candidates(client_id)`);

    saveNow();
    console.log('✅ Migration: finance matching schema ready (match columns + candidates table)');
  } catch (e) {
    console.error('finance matching migration error:', e.message);
  }

  // ── FINANCE MATCHING (Tier 2): subscription archive ───────────────────────
  // Customers whose academy group has already "إنتهت" don't show up in the
  // Active Batches Trainees Excel, so the matcher's primary clients table
  // misses them. We mirror the "Customer subscription to groups" Drive
  // folders (per-line, per-level archives) into subscription_clients and
  // fall back to them when a phone match in clients fails.
  try {
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS subscription_clients (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT,
        phone         TEXT,
        phone_raw     TEXT,
        group_name    TEXT,
        group_status  TEXT,
        line          TEXT NOT NULL,
        source_file   TEXT,
        client_code   TEXT,
        reg_date      TEXT,
        synced_at     TEXT NOT NULL DEFAULT (datetime('now','+2 hours')),
        UNIQUE(phone_raw, source_file, line)
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_subclients_phone ON subscription_clients(phone)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_subclients_name  ON subscription_clients(name COLLATE NOCASE)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_subclients_line  ON subscription_clients(line)`);

    db._raw.run(`
      CREATE TABLE IF NOT EXISTS subscription_sync_state (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        last_started_at TEXT,
        last_finished_at TEXT,
        last_status     TEXT,
        last_error      TEXT,
        files_processed INTEGER NOT NULL DEFAULT 0,
        rows_total      INTEGER NOT NULL DEFAULT 0,
        triggered_by    TEXT
      )
    `);
    db._raw.run(`INSERT OR IGNORE INTO subscription_sync_state (id) VALUES (1)`);

    saveNow();
    console.log('✅ Migration: subscription_clients + subscription_sync_state ready');
  } catch (e) {
    console.error('subscription_clients migration error:', e.message);
  }

  // ── FINANCE INTEGRATION (Phase 3): client lifecycle events ───────────────
  // Per-client timeline derived from matched finance_transactions. A future
  // phase (Level Progression Engine) reads this ledger to decide when a client
  // moves between levels. Phase 3 only fills `level_raw` (regex extract from
  // product_name) — `level_canonical` stays NULL until Phase 4 owns it.
  //
  // UNIQUE(source_transaction_id, event_type) makes regeneration idempotent —
  // re-running on the same transaction is a no-op.
  try {
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS client_lifecycle_events (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id             INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        event_type            TEXT NOT NULL,
        event_date            TEXT NOT NULL,
        source_transaction_id TEXT REFERENCES finance_transactions(id) ON DELETE SET NULL,
        product_id            TEXT,
        product_name          TEXT,
        amount                TEXT,
        currency              TEXT,
        category              TEXT,
        level_raw             TEXT,
        level_canonical       TEXT,
        status                TEXT,
        notes                 TEXT,
        created_at            TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        updated_at            TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        UNIQUE(source_transaction_id, event_type)
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_lifecycle_client     ON client_lifecycle_events(client_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_lifecycle_event_date ON client_lifecycle_events(event_date)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_lifecycle_event_type ON client_lifecycle_events(event_type)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_lifecycle_tx         ON client_lifecycle_events(source_transaction_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_lifecycle_category   ON client_lifecycle_events(category)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_lifecycle_level_raw  ON client_lifecycle_events(level_raw)`);

    saveNow();
    console.log('✅ Migration: client_lifecycle_events table ready');
  } catch (e) {
    console.error('client_lifecycle_events migration error:', e.message);
  }

  // ── CLIENT SUBSCRIPTION TRACKER (cs_*) — standalone subsystem ─────────────
  // Tracks: who paid for how many levels, who completed which levels, current
  // coordinator + history, reminders + notes, auto-generated alerts, and a
  // full audit log. Zero touches on existing tables — all reads from clients/
  // team_members/finance_transactions are SELECT-only.
  //
  // See backend/src/utils/cs*.js helpers for parsing rules.
  try {
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS cs_subscriptions (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id             INTEGER,                           -- nullable until matched
        client_phone_raw      TEXT,
        client_phone_norm     TEXT,
        client_name_raw       TEXT,
        source                TEXT NOT NULL,                     -- 'finance_api' | 'excel_membership'
        source_ref            TEXT,                              -- transaction id, or sheet:row
        product_name_raw      TEXT,
        dept                  TEXT,                              -- 'General'|'Private'|'Semi'
        months                INTEGER,                           -- 1, 3, 6, 9, ...
        total_levels          INTEGER,                           -- usually = months
        is_installment        INTEGER NOT NULL DEFAULT 0,
        amount                TEXT,
        currency              TEXT,
        subscription_date     TEXT,
        is_ignored            INTEGER NOT NULL DEFAULT 0,        -- 1 = Your American Day / Business / etc.
        ignore_reason         TEXT,
        notes                 TEXT,
        created_at            TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        updated_at            TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        UNIQUE(source, source_ref)
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_sub_client   ON cs_subscriptions(client_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_sub_phone    ON cs_subscriptions(client_phone_norm)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_sub_dept     ON cs_subscriptions(dept)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_sub_date     ON cs_subscriptions(subscription_date)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_sub_source   ON cs_subscriptions(source)`);

    db._raw.run(`
      CREATE TABLE IF NOT EXISTS cs_completed_levels (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id             INTEGER,
        client_phone_norm     TEXT,
        client_name_raw       TEXT,
        track                 TEXT NOT NULL,                     -- 'Starter'|'General'|'Conversation'
        level_number          INTEGER NOT NULL,                  -- 1..5
        level_order           INTEGER NOT NULL,                  -- 1..13 (global)
        drive_file_id         TEXT,
        drive_file_name       TEXT,
        drive_folder          TEXT,                              -- 'A-H Genaral'|'A-H Private'|'Private 2 in 1'
        dept                  TEXT,                              -- derived from drive_folder
        group_name_raw        TEXT,
        registration_date     TEXT,
        synced_at             TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        UNIQUE(client_phone_norm, track, level_number)
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_lvl_client   ON cs_completed_levels(client_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_lvl_phone    ON cs_completed_levels(client_phone_norm)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_lvl_order    ON cs_completed_levels(level_order)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_lvl_track    ON cs_completed_levels(track)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_lvl_dept     ON cs_completed_levels(dept)`);

    db._raw.run(`
      CREATE TABLE IF NOT EXISTS cs_client_coordinator (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id             INTEGER,
        client_phone_norm     TEXT,
        coordinator_id        INTEGER NOT NULL,                  -- FK→team_members.id (read-only)
        assigned_at           TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        unassigned_at         TEXT,                              -- NULL = current
        assigned_by_user_id   INTEGER,
        assignment_reason     TEXT,                              -- 'auto_last_known'|'manual'|'reassign'
        notes                 TEXT
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_coord_client     ON cs_client_coordinator(client_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_coord_phone      ON cs_client_coordinator(client_phone_norm)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_coord_coord      ON cs_client_coordinator(coordinator_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_coord_current    ON cs_client_coordinator(unassigned_at)`);

    db._raw.run(`
      CREATE TABLE IF NOT EXISTS cs_reminders (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id             INTEGER,
        client_phone_norm     TEXT,
        coordinator_id        INTEGER,                           -- who created (team_members.id)
        created_by_user_id    INTEGER,                           -- users.id
        reminder_at           TEXT NOT NULL,                     -- when to remind
        reminder_type         TEXT NOT NULL DEFAULT 'manual',    -- 'manual'|'auto'
        severity              TEXT,                              -- 'soft'|'medium'|'hard'|'critical'
        note                  TEXT NOT NULL,                     -- per-reminder note
        status                TEXT NOT NULL DEFAULT 'pending',   -- 'pending'|'done'|'snoozed'
        done_at               TEXT,
        done_by_user_id       INTEGER,
        snoozed_until         TEXT,
        created_at            TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        updated_at            TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        updated_by_user_id    INTEGER,
        deleted_at            TEXT,
        deleted_by_user_id    INTEGER
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_rem_client       ON cs_reminders(client_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_rem_phone        ON cs_reminders(client_phone_norm)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_rem_coord        ON cs_reminders(coordinator_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_rem_status       ON cs_reminders(status)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_rem_due          ON cs_reminders(reminder_at)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_rem_deleted      ON cs_reminders(deleted_at)`);

    db._raw.run(`
      CREATE TABLE IF NOT EXISTS cs_notifications (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id             INTEGER,
        client_phone_norm     TEXT,
        notif_type            TEXT NOT NULL,                     -- 'paid_no_group_7d'|'no_level_10d'|'no_level_15d'|'no_level_20d'|'extra_courses_available'
        severity              TEXT NOT NULL,                     -- 'info'|'warning'|'urgent'|'critical'
        title                 TEXT,
        message               TEXT,
        meta_json             TEXT,                              -- arbitrary data (e.g. days_silent, paid_total, etc.)
        triggered_at          TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        is_active             INTEGER NOT NULL DEFAULT 1,        -- 0 = resolved (client completed level / enrolled)
        resolved_at           TEXT,
        resolution_reason     TEXT,                              -- 'completed_level'|'enrolled_group'|'manual_dismiss'
        UNIQUE(client_phone_norm, notif_type, is_active)         -- one active notif of each kind per client
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_notif_client     ON cs_notifications(client_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_notif_phone      ON cs_notifications(client_phone_norm)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_notif_active     ON cs_notifications(is_active, severity)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_notif_type       ON cs_notifications(notif_type)`);

    db._raw.run(`
      CREATE TABLE IF NOT EXISTS cs_notif_recipients (
        notif_id              INTEGER NOT NULL REFERENCES cs_notifications(id) ON DELETE CASCADE,
        user_id               INTEGER NOT NULL,                  -- users.id
        role_context          TEXT,                              -- 'coordinator'|'leader'|'admin'
        is_read               INTEGER NOT NULL DEFAULT 0,
        read_at               TEXT,
        PRIMARY KEY (notif_id, user_id)
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_notifrcp_user    ON cs_notif_recipients(user_id, is_read)`);

    db._raw.run(`
      CREATE TABLE IF NOT EXISTS cs_audit_log (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id             INTEGER,
        client_phone_norm     TEXT,
        event_type            TEXT NOT NULL,                     -- 'coord_changed'|'reminder_added'|'reminder_edited'|'reminder_deleted'|'level_completed'|'subscription_added'|'notification_triggered'|'notification_resolved'
        event_data            TEXT,                              -- JSON
        actor_user_id         INTEGER,
        actor_name            TEXT,
        created_at            TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_audit_client     ON cs_audit_log(client_id)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_audit_phone      ON cs_audit_log(client_phone_norm)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_audit_type       ON cs_audit_log(event_type)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_audit_created    ON cs_audit_log(created_at)`);

    saveNow();
    console.log('✅ Migration: cs_* subscription tracker tables ready (7 tables: subscriptions, completed_levels, client_coordinator, reminders, notifications, notif_recipients, audit_log)');
  } catch (e) {
    console.error('cs_* subscription tracker migration error:', e.message);
  }

  // ── cs_client_delivery_status: manual per-client status for the ───────────
  // "تسليمات الأقسام" (Department Deliveries) view. Set MANUALLY by a
  // coordinator/leader/admin from the deliveries page. Additive table — no
  // existing data touched. One row per client (keyed by normalized phone).
  // CHECK is informational only (database.js sets ignore_check_constraints=1);
  // the route validates status against the allowed set.
  try {
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS cs_client_delivery_status (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        client_phone_norm  TEXT NOT NULL,
        status             TEXT NOT NULL DEFAULT 'active'
                           CHECK(status IN ('active','churned','postponed','exit_level','refund')),
        note               TEXT,
        updated_by         INTEGER,
        updated_by_name    TEXT,
        updated_at         TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        UNIQUE(client_phone_norm)
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_delivery_phone  ON cs_client_delivery_status(client_phone_norm)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_delivery_status ON cs_client_delivery_status(status)`);
    saveNow();
    console.log('✅ Migration: cs_client_delivery_status table ready');
  } catch (e) {
    console.error('cs_client_delivery_status migration error:', e.message);
  }

  // ── enrollment_rows: manual data-entry grid for the Enrollment page ───────
  // Each row = one round/group an Enrollment employee enters by hand.
  // Additive table; per-department (General/Private/Semi). No existing data
  // touched. Persisted on the volume DB like everything else.
  try {
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS enrollment_rows (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        dept            TEXT NOT NULL,                 -- 'General'|'Private'|'Semi'
        round_name      TEXT,
        start_date      TEXT,
        end_date        TEXT,
        days            TEXT,                          -- 'Sat- Tue'|'Mon- Thu'|'Sun- Wed'
        hours           TEXT,                          -- e.g. '9:00pm_10:30pm'
        num_students    INTEGER,
        group_code      TEXT,
        level           TEXT,                          -- 'Str 3'|'G 3'|'Con 2' ...
        status          TEXT,                          -- 'Exit Level'|'New'|'Postponed'
        admin           TEXT,                          -- coordinator name
        teacher         TEXT,                          -- trainer name
        generate_status TEXT NOT NULL DEFAULT 'Pending',-- 'Start'|'Pending' (Start needs >=7 students + privileged role)
        line            TEXT NOT NULL DEFAULT 'Ahmed Hassan',
        created_by      INTEGER,
        created_by_name TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_enrollment_dept ON enrollment_rows(dept)`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_enrollment_line ON enrollment_rows(line)`);
    // generate_status added after the table first shipped → ALTER for existing DBs.
    const enrCols = db._raw.exec(`PRAGMA table_info(enrollment_rows)`)[0]?.values.map(r => r[1]) || [];
    if (!enrCols.includes('generate_status')) {
      db._raw.run(`ALTER TABLE enrollment_rows ADD COLUMN generate_status TEXT NOT NULL DEFAULT 'Pending'`);
    }
    saveNow();
    console.log('✅ Migration: enrollment_rows table ready');
  } catch (e) {
    console.error('enrollment_rows migration error:', e.message);
  }

  // ── enrollment_students: roster of clients assigned to an enrollment row ───
  // Drives enrollment_rows.num_students (= COUNT of this roster).
  try {
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS enrollment_students (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        enrollment_row_id INTEGER NOT NULL,
        client_id         INTEGER,
        client_name       TEXT,
        client_phone      TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
        UNIQUE(enrollment_row_id, client_phone)
      )
    `);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_enr_students_row ON enrollment_students(enrollment_row_id)`);
    saveNow();
    console.log('✅ Migration: enrollment_students table ready');
  } catch (e) {
    console.error('enrollment_students migration error:', e.message);
  }

  // ── group_renames de-pollution (2026-06-06) ───────────────────────────────
  // The Drive sync used to re-record renames every run (UNIQUE includes
  // renamed_on → re-stamped duplicate rows) and to emit REVERSE edges when a
  // stale old-name Drive file resynced and flipped `batches` back to the old
  // name. That left ~1930 rows (only ~836 distinct, 162 reverse pairs) which
  // broke the rename-aware read helpers (swap/zero). The sync is now guarded
  // (sync.service.js: idempotent + anti-reverse). This ONE-TIME, IDEMPOTENT
  // migration cleans the existing rows: (1) keep the EARLIEST renamed_on per
  // (old,new,line); (2) for each reverse pair drop the side whose new_group_name
  // is NOT the live `batches` name (if neither/both live → keep the earlier
  // renamed_on). A clean table makes this a no-op on later boots. A one-time
  // pre-cleanup snapshot is kept in group_renames_backup_20260606.
  try {
    const raw = db._raw;
    const before = raw.prepare('SELECT COUNT(*) c FROM group_renames').get().c;
    raw.run('CREATE TABLE IF NOT EXISTS group_renames_backup_20260606 AS SELECT * FROM group_renames WHERE 0');
    if (raw.prepare('SELECT COUNT(*) c FROM group_renames_backup_20260606').get().c === 0) {
      raw.run('INSERT INTO group_renames_backup_20260606 SELECT * FROM group_renames');
    }
    const cleanup = db.transaction(() => {
      // 1) Dedupe — keep the earliest renamed_on (min id tiebreak) per (old,new,line).
      raw.run(`
        DELETE FROM group_renames
         WHERE id NOT IN (
           SELECT g.id FROM group_renames g
            WHERE NOT EXISTS (
              SELECT 1 FROM group_renames g2
               WHERE g2.old_group_name = g.old_group_name
                 AND g2.new_group_name = g.new_group_name
                 AND g2.line           = g.line
                 AND ( DATE(g2.renamed_on) < DATE(g.renamed_on)
                    OR (DATE(g2.renamed_on) = DATE(g.renamed_on) AND g2.id < g.id) )
            )
         )`);
      // 2) Resolve reverse pairs (A→B & B→A on same line): drop the wrong side.
      const pairs = raw.prepare(`
        SELECT g1.id id1, g1.old_group_name a, g1.new_group_name b, g1.line ln,
               g1.renamed_on r1, g2.id id2, g2.renamed_on r2
          FROM group_renames g1
          JOIN group_renames g2
            ON g2.old_group_name = g1.new_group_name
           AND g2.new_group_name = g1.old_group_name
           AND g2.line           = g1.line
         WHERE g1.old_group_name < g1.new_group_name`).all();
      const inB   = raw.prepare('SELECT 1 FROM batches WHERE group_name = ? AND line = ? LIMIT 1');
      const delId = raw.prepare('DELETE FROM group_renames WHERE id = ?');
      for (const p of pairs) {
        const aLive = !!inB.get(p.a, p.ln);
        const bLive = !!inB.get(p.b, p.ln);
        let drop;
        if (bLive && !aLive)      drop = p.id2;   // a→b is correct (b is the live name)
        else if (aLive && !bLive) drop = p.id1;   // b→a is correct (a is the live name)
        else if (p.r1 < p.r2)     drop = p.id2;   // neither/both live → keep earlier renamed_on
        else if (p.r2 < p.r1)     drop = p.id1;
        else                      drop = Math.max(p.id1, p.id2);
        delId.run(drop);
      }
    });
    cleanup();
    const after = raw.prepare('SELECT COUNT(*) c FROM group_renames').get().c;
    if (before !== after) {
      saveNow();
      console.log(`✅ Migration: group_renames de-polluted (${before} → ${after} rows; backup in group_renames_backup_20260606)`);
    }
  } catch (e) {
    console.error('group_renames de-pollution migration error:', e.message);
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

  // Railway runs the app behind a single reverse proxy that sets X-Forwarded-For.
  // Trust exactly ONE proxy hop so express-rate-limit can identify clients by their
  // real IP (not the proxy's). Using `1` (not `true`) avoids the insecure
  // "trust all proxies" mode that express-rate-limit warns against.
  app.set('trust proxy', 1);

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
  app.use('/api/group-approvals', require('./routes/group-approvals.routes'));
  app.use('/api/org-chart',     require('./routes/org-chart.routes'));
  app.use('/api/holidays',      require('./routes/holidays.routes'));
  app.use('/api/trainer-salaries', require('./routes/trainer-salaries.routes'));
  app.use('/api/reschedules',   require('./routes/reschedules.routes'));
  app.use('/api/distribution',       require('./routes/distribution.routes'));
  app.use('/api/enrollment',         require('./routes/enrollment.routes'));
  app.use('/api/enrollment-leader',  require('./routes/enrollment-leader.routes'));
  app.use('/api/finance',            require('./routes/finance.routes'));
  app.use('/api/clients-finance',    require('./routes/clients-finance.routes'));
  app.use('/api/cs',                 require('./routes/cs.routes'));
  // Read-only data export (API-key gated; disabled unless DATA_EXPORT_API_KEY set)
  app.use('/api/data-export',        require('./routes/data-export.routes'));

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

            // Cascade: re-run the matcher on unmatched transactions so any
            // newly-imported clients/batches feed into existing rows. Same
            // pattern as the manual /sync endpoints in drive.routes.js.
            try {
              const matcher = require('./services/financeMatcher.service');
              const lifecycle = require('./services/clientLifecycle.service');
              const rm = matcher.matchAll({
                scope: 'unmatched',
                onMatched: (cid, txId) => {
                  try { lifecycle.regenerateFromTransactionId(txId); }
                  catch (e) { console.error('lifecycle hook error:', e.message); }
                },
              });
              console.log(
                `🎯 Drive cascade re-match: attempted=${rm.attempted} matched=${rm.matched}`
              );
            } catch (e) {
              console.error('Drive cascade re-match error:', e.message);
            }
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

  // ─── DRIVE PREP-TOMORROW CRON ────────────────────────────────────────────
  // Runs at 23:30 Cairo nightly to pre-create TOMORROW's folders. This is the
  // primary defense — by the time midnight strikes and the new day starts,
  // tomorrow's folders are ALREADY THERE. No gap, no waiting.
  //
  // Controlled by:
  //   DRIVE_PREP_TOMORROW_CRON='30 23 * * *'  (default: 23:30 daily)
  //   DRIVE_PREP_FOLDERS_TZ='Africa/Cairo'    (shared with today-prep)
  //
  // Auto-enabled whenever DRIVE_PREP_FOLDERS_ENABLED is set — no separate flag.
  if (process.env.DRIVE_PREP_FOLDERS_ENABLED === '1') {
    try {
      const cron = require('node-cron');
      const googleDrive = require('./services/googleDrive.service');
      const { VALID_LINES: prepLines } = require('./services/sync.service');
      const cronExpr = process.env.DRIVE_PREP_TOMORROW_CRON || '30 23 * * *';
      const tz       = process.env.DRIVE_PREP_FOLDERS_TZ   || 'Africa/Cairo';

      if (!cron.validate(cronExpr)) {
        console.error(`Drive prep-tomorrow: invalid cron expression "${cronExpr}", skipping schedule.`);
      } else {
        cron.schedule(cronExpr, async () => {
          const driveSyncSvc = require('./services/driveSync.service');
          const tomorrow = driveSyncSvc.tomorrowInTimezone(tz);
          for (const line of prepLines) {
            try {
              const r = await googleDrive.prepareDayFolders(line, tomorrow);
              const made = r.folders.filter(f => f.created).length;
              const kept = r.folders.length - made;
              console.log(`📁 Drive prep-tomorrow ${line} ${r.date}: created=${made} existing=${kept}`);
            } catch (e) {
              console.error(`Drive prep-tomorrow ${line} failed:`, e.message);
            }
          }
        }, { timezone: tz });
        console.log(`⏰ Drive prep-TOMORROW cron scheduled (${cronExpr}, ${tz})`);
      }
    } catch (e) {
      console.error('Failed to schedule Drive prep-tomorrow cron:', e.message);
    }
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
        const tomorrow = driveSyncSvc.tomorrowInTimezone(tz);
        // Prepare BOTH today and tomorrow on every startup. Tomorrow's prep
        // protects against the "deploy happens just before midnight" case:
        // even if the 23:30 cron is missed because the server is restarting,
        // the post-startup safety creates them.
        console.log(`📁 Safety-net: ensuring today (${today.toISOString().slice(0,10)}) AND tomorrow (${tomorrow.toISOString().slice(0,10)}) folders exist (${tz})...`);
        for (const line of prepLines) {
          for (const [label, date] of [['today', today], ['tomorrow', tomorrow]]) {
            try {
              const r = await googleDrive.prepareDayFolders(line, date);
              const made = r.folders.filter(f => f.created).length;
              const kept = r.folders.length - made;
              if (made > 0) {
                console.log(`📁 Safety-net ${line} ${r.date} (${label}): created=${made} existing=${kept}  ← caught missing folders`);
              } else {
                console.log(`📁 Safety-net ${line} ${r.date} (${label}): all ${kept} folders already exist ✓`);
              }
            } catch (e) {
              console.error(`Safety-net prep ${line} ${label} failed:`, e.message);
            }
          }
        }
      } catch (e) {
        console.error('Safety-net prep error:', e.message);
      }
    }, 5000);
  }

  // ─── DAILY TODOS GENERATOR CRON ──────────────────────────────────────────
  // Pre-creates today's recurring-template instances for ALL coordinators at
  // 00:30 Cairo every night, so the work is already waiting in their queue
  // when they log in next morning. Without this, instances were only created
  // on-demand when a user opened the todos page — meaning early-shift staff
  // could find an empty list if no one had logged in before them.
  //
  // Env vars:
  //   DAILY_TODOS_CRON='30 0 * * *'   — defaults to 00:30 daily
  //   DAILY_TODOS_TZ='Africa/Cairo'   — defaults to Cairo time
  try {
    const cron = require('node-cron');
    const dailyTodosService = require('./services/daily-todos.service');
    const cronExpr = process.env.DAILY_TODOS_CRON || '30 0 * * *';
    const tz       = process.env.DAILY_TODOS_TZ   || 'Africa/Cairo';

    if (!cron.validate(cronExpr)) {
      console.error(`Daily-todos cron: invalid expression "${cronExpr}", skipping schedule.`);
    } else {
      cron.schedule(cronExpr, () => {
        try {
          const r = dailyTodosService.generateDailyInstancesForAll();
          if (r.created > 0) saveNow();   // persist to disk only if we wrote rows
          console.log(
            `📋 Daily-todos cron (${r.date}): templates=${r.total_templates} ` +
            `matched=${r.matched} created=${r.created} skipped=${r.skipped}`
          );
        } catch (e) {
          console.error('Daily-todos cron error:', e.message);
        }
      }, { timezone: tz });
      console.log(`⏰ Daily-todos cron scheduled (${cronExpr}, ${tz})`);
    }
  } catch (e) {
    console.error('Failed to schedule daily-todos cron:', e.message);
  }

  // ─── DAILY TODOS STARTUP CATCH-UP ────────────────────────────────────────
  // If the server was restarting at 00:30 Cairo, the cron MISSES that fire
  // window — node-cron does not back-fill. This guarantees today's instances
  // exist on every startup. Idempotent: already-existing instances are skipped.
  // Runs ~7s after boot so it doesn't slow first-request handling.
  setTimeout(() => {
    try {
      const dailyTodosService = require('./services/daily-todos.service');
      const r = dailyTodosService.generateDailyInstancesForAll();
      if (r.created > 0) {
        saveNow();
        console.log(`📋 Daily-todos startup catch-up (${r.date}): created=${r.created}`);
      }
    } catch (e) {
      console.error('Daily-todos startup catch-up error:', e.message);
    }
  }, 7000);

  // ─── CS ALERTS — daily auto-alert sweep ──────────────────────────────────
  // Evaluates every known subscription-tracker client and triggers / resolves
  // notifications per the business rules (paid-no-group / no-level-10/15/20 /
  // extra-courses-available). Default 03:30 Cairo. Opt-in via env so dev /
  // staging never spam users.
  //
  // Env vars:
  //   CS_ALERTS_ENABLED=1            must be set to schedule
  //   CS_ALERTS_CRON='30 3 * * *'    default 03:30 daily
  //   CS_ALERTS_TZ='Africa/Cairo'    default Cairo
  if (process.env.CS_ALERTS_ENABLED === '1') {
    try {
      const cron = require('node-cron');
      const csAlerts = require('./services/csAlerts.service');
      const cronExpr = process.env.CS_ALERTS_CRON || '30 3 * * *';
      const tz       = process.env.CS_ALERTS_TZ   || 'Africa/Cairo';

      if (!cron.validate(cronExpr)) {
        console.error(`cs-alerts cron: invalid expression "${cronExpr}", skipping schedule.`);
      } else {
        cron.schedule(cronExpr, () => {
          try {
            // Pull any new finance_transactions into cs_subscriptions first,
            // so the alert sweep sees the freshest paid-state.
            try {
              const csFinance = require('./services/csIngestFinance.service');
              const fr = csFinance.runIngestion({});
              console.log(`📥 cs-alerts cron (pre-ingest finance): processed=${fr.processed} matched=${fr.matched_to_client} superseded_excel=${fr.excel_rows_superseded}`);
            } catch (e) { console.error('cs-alerts cron (finance ingest) error:', e.message); }

            const r = csAlerts.runOnce({});
            console.log(`🔔 cs-alerts cron: scanned=${r.scanned} resolved=${r.resolved} triggered=${JSON.stringify(r.triggered)} dur=${r.duration_ms}ms`);
          } catch (e) {
            console.error('cs-alerts cron error:', e.message);
          }
        }, { timezone: tz });
        console.log(`⏰ cs-alerts cron scheduled (${cronExpr}, ${tz})`);
      }
    } catch (e) {
      console.error('Failed to schedule cs-alerts cron:', e.message);
    }
  }

  // ─── FINANCE SYNC: incremental polling ───────────────────────────────────
  // Mirrors Center App's Finance Transactions API into the local finance_*
  // tables every N seconds. Only runs when explicitly opted in via env so
  // staging / dev never hits production data.
  //
  // Env vars:
  //   FINANCE_SYNC_ENABLED=1               must be set to enable
  //   FINANCE_SYNC_INTERVAL_SEC=30         default 30 (clamped to >= 15)
  //   CENTER_APP_API_KEY=<key>             required — sync silently skips without it
  //
  // setInterval (not node-cron) because 30s is below cron's sane resolution;
  // also lets the engine self-throttle via its in-process mutex if a tick
  // takes longer than the interval.
  if (process.env.FINANCE_SYNC_ENABLED === '1') {
    try {
      const financeSync = require('./services/financeSync.service');
      const requested = parseInt(process.env.FINANCE_SYNC_INTERVAL_SEC || '30', 10);
      const intervalSec = Number.isFinite(requested) && requested >= 15 ? requested : 30;
      const intervalMs = intervalSec * 1000;

      // Fire the first poll ~10s after boot so the server can fully come up
      // before we start hitting an external API. Then run every intervalSec.
      setTimeout(() => {
        // First poll on boot — useful for catching anything that changed while
        // the server was redeploying.
        financeSync.pollIncremental({ triggeredBy: 'startup' }).catch(e => {
          console.error('Finance-sync startup poll error:', e.message);
        });
      }, 10_000);

      setInterval(() => {
        // Fire-and-forget — the engine handles its own errors and mutex.
        financeSync.pollIncremental({ triggeredBy: 'cron' }).catch(e => {
          console.error('Finance-sync interval poll error:', e.message);
        });
      }, intervalMs);

      console.log(`💰 Finance-sync poll scheduled every ${intervalSec}s`);
    } catch (e) {
      console.error('Failed to schedule finance-sync polling:', e.message);
    }
  } else {
    console.log('💰 Finance-sync disabled (set FINANCE_SYNC_ENABLED=1 to enable).');
  }

  // ─── FINANCE SYNC: daily reconciliation ──────────────────────────────────
  // Catches DELETED transactions. The API only returns living rows; without
  // this cron, a transaction deleted upstream would stay in our mirror forever.
  // Runs at 03:00 Cairo (quiet hour, no overlap with Drive prep jobs).
  //
  // Env vars:
  //   FINANCE_SYNC_ENABLED=1               must be set (same flag as polling)
  //   FINANCE_RECONCILE_CRON='0 3 * * *'   default 03:00 daily
  //   FINANCE_RECONCILE_TZ='Africa/Cairo'  default Cairo
  //   FINANCE_RECONCILE_WINDOW_DAYS=90     default 90-day lookback
  if (process.env.FINANCE_SYNC_ENABLED === '1') {
    try {
      const cron = require('node-cron');
      const financeSync = require('./services/financeSync.service');
      const cronExpr = process.env.FINANCE_RECONCILE_CRON || '0 3 * * *';
      const tz       = process.env.FINANCE_RECONCILE_TZ   || 'Africa/Cairo';
      const windowDays = parseInt(process.env.FINANCE_RECONCILE_WINDOW_DAYS || '90', 10) || 90;

      if (!cron.validate(cronExpr)) {
        console.error(`Finance-reconcile: invalid cron expression "${cronExpr}", skipping schedule.`);
      } else {
        cron.schedule(cronExpr, async () => {
          try {
            const r = await financeSync.runReconciliation({ windowDays, triggeredBy: 'cron' });
            if (r.error) {
              console.error(`💰 Finance-reconcile error: ${r.error}`);
            } else if (r.skipped) {
              console.log(`💰 Finance-reconcile skipped: ${r.skipped}`);
            } else {
              console.log(`💰 Finance-reconcile (${r.window_from}): fetched=${r.fetched} pages=${r.pages} deleted=${r.deleted}`);
            }
          } catch (e) {
            console.error('Finance-reconcile cron error:', e.message);
          }
        }, { timezone: tz });
        console.log(`⏰ Finance-reconcile cron scheduled (${cronExpr}, ${tz}, window=${windowDays}d)`);
      }
    } catch (e) {
      console.error('Failed to schedule finance-reconcile cron:', e.message);
    }
  }

  // Graceful shutdown
  process.on('SIGTERM', () => { db.close(); process.exit(0); });
  process.on('SIGINT',  () => { db.close(); process.exit(0); });

}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
