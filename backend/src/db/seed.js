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
    db.prepare(`UPDATE users SET password_hash = ?, full_name = ?, role = 'admin', management = 'Customer Services' WHERE username = ?`)
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
