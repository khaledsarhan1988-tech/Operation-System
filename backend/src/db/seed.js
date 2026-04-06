'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { initDb, saveNow } = require('../config/database');

const schemaPath = path.join(__dirname, 'schema.sql');

initDb().then(db => {
  // Run schema
  const schema = fs.readFileSync(schemaPath, 'utf8');
  schema.split(';').forEach(stmt => {
    const trimmed = stmt.trim();
    if (trimmed) {
      try { db._raw.run(trimmed); } catch (e) { /* ignore already exists */ }
    }
  });
  console.log('✅ Schema applied');

  // Create admin user
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'Admin@2024';
  const fullName = process.env.ADMIN_FULLNAME || 'System Admin';

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 12);
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, department, language)
      VALUES (?, ?, ?, 'admin', 'General', 'ar')
    `).run(username, hash, fullName);
    console.log(`✅ Admin user created: ${username} / password: ${password}`);
  } else {
    console.log(`ℹ️  Admin user already exists: ${username}`);
  }

  saveNow();
  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/academy.db');
  console.log('✅ Database saved at:', dbPath);
  process.exit(0);
}).catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
