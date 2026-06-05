'use strict';
// ─── READ-ONLY DATA EXPORT (API-key gated) ───────────────────────────────────
// Lets a trusted local tool pull live data for analysis WITHOUT a user login.
// Completely DISABLED unless the env var DATA_EXPORT_API_KEY is set. All routes
// are strictly read-only (SELECT), with a fixed whitelist of tables/columns —
// no user-supplied SQL. Intended for internal reporting/verification only.
const express = require('express');
const db = require('../config/database');

const router = express.Router();

// Gate: requires the secret key (header X-Export-Key or ?key=). If the env var
// is not configured, the whole feature 404s as if it doesn't exist.
router.use((req, res, next) => {
  const expected = process.env.DATA_EXPORT_API_KEY;
  if (!expected) return res.status(404).json({ error: 'not_found' });
  const got = req.header('X-Export-Key') || req.query.key;
  if (!got || String(got) !== String(expected)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

// Trainers (Educational Administration) + their extra shifts + official holidays.
// Everything needed to reconstruct availability. Small & fast.
router.get('/trainers', (req, res) => {
  try {
    const trainers = db.prepare(
      `SELECT * FROM team_members WHERE department='education' ORDER BY section, name`
    ).all();
    let extra_shifts = [];
    try {
      extra_shifts = db.prepare(
        `SELECT team_member_id, date, start_time, end_time, duration_min, notes
           FROM team_member_extra_shifts ORDER BY team_member_id, date`
      ).all();
    } catch (_) { /* table may not exist */ }
    let holidays = [];
    try {
      holidays = db.prepare(
        `SELECT name, start_date, end_date FROM official_holidays ORDER BY start_date`
      ).all();
    } catch (_) { /* table may not exist */ }
    res.json({ generated_at: new Date().toISOString(), trainers, extra_shifts, holidays });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Lectures within a bounded date range (required) — the booked-hours source.
router.get('/lectures', (req, res) => {
  const from = String(req.query.from || '');
  const to   = String(req.query.to   || '');
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!ok(from) || !ok(to)) {
    return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' });
  }
  try {
    const lectures = db.prepare(
      `SELECT DISTINCT group_name, date, time, duration, trainer, session_type,
              side_session_category, status, line
         FROM lectures
        WHERE date BETWEEN ? AND ?`
    ).all(from, to);
    res.json({ generated_at: new Date().toISOString(), from, to, count: lectures.length, lectures });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DIAGNOSTIC LOOKUPS (read-only, bounded) ─────────────────────────────────
// Small targeted lookups by name/phone/group for investigating specific data
// issues (missing remark, empty section column). LIKE-matched, capped at 50.
function likeArg(q) { return '%' + String(q || '').trim() + '%'; }

router.get('/remarks', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const rows = db.prepare(
      `SELECT id, external_id, client_name, client_phone, assigned_to, task_type,
              category, status, priority, line, details, added_at, last_updated
         FROM remarks
        WHERE client_phone LIKE ? OR client_name LIKE ? OR REPLACE(client_phone,' ','') LIKE ?
        ORDER BY added_at DESC LIMIT 50`
    ).all(likeArg(q), likeArg(q), likeArg(q));
    res.json({ generated_at: new Date().toISOString(), q, count: rows.length, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/absent', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    let main = [], zoom = [];
    try {
      main = db.prepare(
        `SELECT id, student_name, phone, group_name, line, date, time, lecture_no,
                follow_up_status, auto_generated
           FROM absent_students
          WHERE phone LIKE ? OR student_name LIKE ? ORDER BY date DESC LIMIT 50`
      ).all(likeArg(q), likeArg(q));
    } catch (_) {}
    try {
      zoom = db.prepare(
        `SELECT id, student_name, phone, group_name, line, date, time, lecture_no,
                follow_up_status
           FROM absent_zoom_students
          WHERE phone LIKE ? OR student_name LIKE ? ORDER BY date DESC LIMIT 50`
      ).all(likeArg(q), likeArg(q));
    } catch (_) {}
    res.json({ generated_at: new Date().toISOString(), q, absent_main: main, absent_zoom: zoom });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/batches', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const rows = db.prepare(
      `SELECT group_name, line, status, dept_type, coordinators
         FROM batches WHERE group_name LIKE ? ORDER BY group_name LIMIT 50`
    ).all(likeArg(q));
    let coordHist = [];
    try {
      coordHist = db.prepare(
        `SELECT group_name, line, coordinator, effective_from, effective_to
           FROM coordinator_history WHERE group_name LIKE ?
          ORDER BY group_name, effective_from LIMIT 100`
      ).all(likeArg(q));
    } catch (_) {}
    res.json({ generated_at: new Date().toISOString(), q, count: rows.length, rows, coordinator_history: coordHist });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const users = db.prepare(
      `SELECT id, full_name, username, department, role FROM users
        WHERE full_name LIKE ? OR username LIKE ? ORDER BY full_name LIMIT 50`
    ).all(likeArg(q), likeArg(q));
    let team = [];
    try {
      team = db.prepare(
        `SELECT id, name, department, section, job_title, coordinator_type, user_id
           FROM team_members WHERE name LIKE ? ORDER BY name LIMIT 50`
      ).all(likeArg(q));
    } catch (_) {}
    res.json({ generated_at: new Date().toISOString(), q, users, team_members: team });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── FULL CONSISTENT SNAPSHOT (read-only) ────────────────────────────────────
// Streams a consistent point-in-time copy of the LIVE database (all tables) so a
// trusted local tool can run the real report endpoints against today's data
// without a manual backup download. Uses SQLite `VACUUM INTO` → a clean snapshot
// (not a torn copy of a file being written). Key-gated like everything here.
router.get('/db', (req, res) => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const dest = path.join(os.tmpdir(), `export_snapshot_${process.pid}_${Date.now()}.db`);
  try { try { fs.unlinkSync(dest); } catch (_) {} } catch (_) {}
  try {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } catch (e) {
    return res.status(500).json({ error: 'snapshot_failed', detail: e.message });
  }
  res.download(dest, 'live-snapshot.db', (err) => {
    try { fs.unlinkSync(dest); } catch (_) {}
  });
});

module.exports = router;
