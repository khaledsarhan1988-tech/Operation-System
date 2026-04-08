'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { initDb, saveNow } = require('../config/database');

const schemaPath = path.join(__dirname, 'schema.sql');

const DB_PATH_USED = process.env.DB_PATH || path.join(__dirname, '../../data/academy.db');
console.log('🗄️  DB_PATH =', DB_PATH_USED);
console.log('📁  File exists before load:', fs.existsSync(DB_PATH_USED));

initDb().then(db => {
  // Log current user count before any changes
  try {
    const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
    console.log('👥  Users in DB before seed:', userCount?.c ?? 0);
  } catch(e) { /* table may not exist yet */ }

  // Run schema
  const schema = fs.readFileSync(schemaPath, 'utf8');
  schema.split(';').forEach(stmt => {
    const trimmed = stmt.trim();
    if (trimmed) {
      try { db._raw.run(trimmed); } catch (e) { /* ignore already exists */ }
    }
  });
  console.log('✅ Schema applied');

  // Add management column if it doesn't exist (migration)
  try {
    db._raw.run(`ALTER TABLE users ADD COLUMN management TEXT NOT NULL DEFAULT 'Customer Services'`);
    console.log('✅ Migration: added management column');
  } catch(e) {
    // Column already exists, ignore
  }

  // Fix dept_type for existing batches where regex was wrong
  try {
    // Fix Semi: group names containing _SP( or _SP_ or _Sp etc.
    const semiResult = db._raw.run(
      `UPDATE batches SET dept_type = 'Semi', lecture_duration_min = 60
       WHERE (lower(group_name) LIKE '%\\_sp(%' ESCAPE '\\'
          OR lower(group_name) LIKE '%\\_sp_%' ESCAPE '\\'
          OR lower(group_name) LIKE '%\\_sp ' ESCAPE '\\'
          OR lower(group_name) LIKE '%semi%')
         AND dept_type != 'Semi'`
    );
    console.log(`✅ Migration: fixed ${semiResult.changes} Semi batches`);
  } catch(e) {
    console.log('dept_type Semi migration:', e.message);
  }

  try {
    // Fix Private: group names containing _P( or _4P( etc., but NOT _SP
    const privateResult = db._raw.run(
      `UPDATE batches SET dept_type = 'Private', lecture_duration_min = 60
       WHERE (lower(group_name) LIKE '%\\_p(%' ESCAPE '\\'
          OR lower(group_name) LIKE '%private%')
         AND lower(group_name) NOT LIKE '%\\_sp%' ESCAPE '\\'
         AND dept_type != 'Semi'
         AND dept_type != 'Private'`
    );
    console.log(`✅ Migration: fixed ${privateResult.changes} Private batches`);
  } catch(e) {
    console.log('dept_type Private migration:', e.message);
  }

  // Create / migrate team_members table
  try {
    // Always recreate with updated CHECK (SQLite can't ALTER CHECK constraints)
    // Use temp table → copy data → drop old → rename
    db._raw.run(`
      CREATE TABLE IF NOT EXISTS team_members_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        department  TEXT NOT NULL,
        section     TEXT NOT NULL,
        shift       TEXT,
        job_title   TEXT,
        phone       TEXT,
        user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status      TEXT NOT NULL DEFAULT 'active',
        notes       TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // Copy existing data if old table exists
    try {
      db._raw.run(`INSERT OR IGNORE INTO team_members_new SELECT * FROM team_members`);
      db._raw.run(`DROP TABLE IF EXISTS team_members`);
    } catch(_) {}
    db._raw.run(`ALTER TABLE team_members_new RENAME TO team_members`);
    db._raw.run(`CREATE INDEX IF NOT EXISTS idx_team_dept_section ON team_members(department, section)`);
    console.log('✅ Migration: team_members table ready (section constraint updated)');
  } catch(e) {
    console.log('team_members migration:', e.message);
  }

  // Add composite performance indexes (safe — IF NOT EXISTS)
  const perfIndexes = [
    `CREATE INDEX IF NOT EXISTS idx_lectures_type_date  ON lectures(session_type, date)`,
    `CREATE INDEX IF NOT EXISTS idx_lectures_type_group ON lectures(session_type, group_name)`,
    `CREATE INDEX IF NOT EXISTS idx_lectures_group_cat  ON lectures(group_name, session_type, side_session_category)`,
    `CREATE INDEX IF NOT EXISTS idx_batches_status_end  ON batches(status, end_date)`,
    `CREATE INDEX IF NOT EXISTS idx_batches_status_sched ON batches(status, scheduled_lectures, completed_lectures)`,
    `CREATE INDEX IF NOT EXISTS idx_remarks_status_date ON remarks(status, added_at)`,
    `CREATE INDEX IF NOT EXISTS idx_clients_phone_group ON clients(phone, group_name)`,
  ];
  perfIndexes.forEach(sql => {
    try { db._raw.run(sql); } catch(e) { /* already exists */ }
  });
  console.log('✅ Performance indexes applied');

  // Create admin user
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'Admin@2024';
  const fullName = process.env.ADMIN_FULLNAME || 'System Admin';

  const hash = bcrypt.hashSync(password, 12);
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!existing) {
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, department, language, management)
      VALUES (?, ?, ?, 'admin', 'All', 'ar', 'Customer Services')
    `).run(username, hash, fullName);
    console.log(`✅ Admin user created: ${username}`);
  } else {
    db.prepare(`UPDATE users SET password_hash = ?, full_name = ?, role = 'admin', management = 'All' WHERE username = ?`)
      .run(hash, fullName, username);
    console.log(`✅ Admin user updated: ${username}`);
  }

  const finalCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
  console.log('👥  Users in DB after seed:', finalCount?.c ?? 0);
  saveNow();
  console.log('✅ Database saved at:', DB_PATH_USED);
  console.log('📦  File size after save:', fs.existsSync(DB_PATH_USED) ? fs.statSync(DB_PATH_USED).size + ' bytes' : 'FILE NOT FOUND');
  process.exit(0);
}).catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
