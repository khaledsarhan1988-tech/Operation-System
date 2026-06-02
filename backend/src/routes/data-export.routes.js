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

module.exports = router;
