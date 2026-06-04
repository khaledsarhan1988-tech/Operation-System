'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

/**
 * Trainer Salary Definitions — PRIVATE, owner-only feature.
 *
 * Locked to a single account (System Admin, username='admin' / id=1). No other
 * user — not even another super-admin — can read or modify this data. The
 * owner-gate below enforces it on every route.
 *
 * Structure (two tables):
 *   trainer_salary_systems — a named group ("نظام مدرب"), e.g. "فون كول".
 *   trainer_salary_defs    — shift rows under a system (linked by system_id).
 *
 * Stored columns are RAW inputs only. Derived columns are computed on the
 * client and never persisted:
 *   T.W Hours           = days * hr * week
 *   Per Hour            = total_amount / tw_hours
 *   Rate Per H For Kpis = kpis / tw_hours
 *
 * Routes:
 *   GET    /api/trainer-salaries              — systems with nested rows
 *   POST   /api/trainer-salaries/systems      — create a system (group)
 *   PUT    /api/trainer-salaries/systems/:id  — rename a system
 *   DELETE /api/trainer-salaries/systems/:id  — delete a system + its rows
 *   POST   /api/trainer-salaries/rows         — create a shift row
 *   PUT    /api/trainer-salaries/rows/:id     — update a shift row
 *   DELETE /api/trainer-salaries/rows/:id     — delete a shift row
 */

const OWNER_USERNAME = 'admin';
const OWNER_ID = 1;

function requireOwner(req, res, next) {
  const u = req.user || {};
  const isOwner =
    (u.username && String(u.username).toLowerCase() === OWNER_USERNAME) ||
    u.id === OWNER_ID;
  if (!isOwner) {
    return res.status(403).json({ error: 'هذه الصفحة خاصة بصاحب الحساب فقط' });
  }
  next();
}

router.use(requireOwner);

// Coerce a body value to a finite non-negative number (defaults to 0).
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
// Nullable numeric: '' / null / undefined / invalid → NULL (use auto formula);
// a finite number → a manual override.
const numOrNull = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const cleanShift = (v) => (v === 'Part Time' ? 'Part Time' : 'Full Time');

/* ─── READ: systems with nested rows ──────────────────────────────────── */
router.get('/', (req, res) => {
  try {
    const systems = db.prepare(`
      SELECT * FROM trainer_salary_systems ORDER BY sort_order ASC, id ASC
    `).all();
    const defs = db.prepare(`
      SELECT * FROM trainer_salary_defs ORDER BY sort_order ASC, id ASC
    `).all();
    const bySys = {};
    for (const d of defs) {
      if (!bySys[d.system_id]) bySys[d.system_id] = [];
      bySys[d.system_id].push(d);
    }
    return res.json(systems.map(s => ({ ...s, rows: bySys[s.id] || [] })));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* ─── SYSTEMS (groups) ────────────────────────────────────────────────── */

// POST /systems — body: { name }
router.post('/systems', express.json(), (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'اسم النظام مطلوب' });
  try {
    const maxOrder = db.prepare(`SELECT COALESCE(MAX(sort_order),0) AS m FROM trainer_salary_systems`).get().m;
    const r = db.prepare(`INSERT INTO trainer_salary_systems (name, sort_order) VALUES (?, ?)`)
      .run(name, maxOrder + 1);
    const row = db.prepare(`SELECT * FROM trainer_salary_systems WHERE id = ?`).get(r.lastInsertRowid);
    return res.status(201).json({ ...row, rows: [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /systems/:id — rename. body: { name }
router.put('/systems/:id', express.json(), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'اسم النظام مطلوب' });
  try {
    const r = db.prepare(`
      UPDATE trainer_salary_systems SET name = ?, updated_at = datetime('now', '+2 hours') WHERE id = ?
    `).run(name, id);
    if (r.changes === 0) return res.status(404).json({ error: 'not found' });
    const row = db.prepare(`SELECT * FROM trainer_salary_systems WHERE id = ?`).get(id);
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /systems/:id — removes the system AND all its shift rows.
router.delete('/systems/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM trainer_salary_defs WHERE system_id = ?`).run(id);
      return db.prepare(`DELETE FROM trainer_salary_systems WHERE id = ?`).run(id);
    });
    const r = tx();
    if (r.changes === 0) return res.status(404).json({ error: 'not found' });
    return res.json({ deleted: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* ─── ROWS (shift definitions) ────────────────────────────────────────── */

// POST /rows — body: { system_id, shift_type, days, hr, week, total_amount, kpis }
router.post('/rows', express.json(), (req, res) => {
  const b = req.body || {};
  const systemId = parseInt(b.system_id, 10);
  if (!systemId) return res.status(400).json({ error: 'system_id مطلوب' });
  const sys = db.prepare(`SELECT id FROM trainer_salary_systems WHERE id = ?`).get(systemId);
  if (!sys) return res.status(404).json({ error: 'النظام غير موجود' });
  try {
    const maxOrder = db.prepare(
      `SELECT COALESCE(MAX(sort_order),0) AS m FROM trainer_salary_defs WHERE system_id = ?`
    ).get(systemId).m;
    const r = db.prepare(`
      INSERT INTO trainer_salary_defs
        (system_id, category, shift_type, days, hr, week, total_amount, kpis,
         tw_hours_override, per_hour_override, rate_per_h_override, sort_order)
      VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      systemId, cleanShift(b.shift_type),
      num(b.days), num(b.hr), num(b.week), num(b.total_amount), num(b.kpis),
      numOrNull(b.tw_hours_override), numOrNull(b.per_hour_override), numOrNull(b.rate_per_h_override),
      maxOrder + 1
    );
    const row = db.prepare(`SELECT * FROM trainer_salary_defs WHERE id = ?`).get(r.lastInsertRowid);
    return res.status(201).json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /rows/:id — update a shift row's inputs.
router.put('/rows/:id', express.json(), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const b = req.body || {};
  try {
    const r = db.prepare(`
      UPDATE trainer_salary_defs SET
        shift_type          = ?,
        days                = ?,
        hr                  = ?,
        week                = ?,
        total_amount        = ?,
        kpis                = ?,
        tw_hours_override   = ?,
        per_hour_override   = ?,
        rate_per_h_override = ?,
        updated_at          = datetime('now', '+2 hours')
      WHERE id = ?
    `).run(
      cleanShift(b.shift_type),
      num(b.days), num(b.hr), num(b.week), num(b.total_amount), num(b.kpis),
      numOrNull(b.tw_hours_override), numOrNull(b.per_hour_override), numOrNull(b.rate_per_h_override),
      id
    );
    if (r.changes === 0) return res.status(404).json({ error: 'not found' });
    const row = db.prepare(`SELECT * FROM trainer_salary_defs WHERE id = ?`).get(id);
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /rows/:id
router.delete('/rows/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    const r = db.prepare(`DELETE FROM trainer_salary_defs WHERE id = ?`).run(id);
    if (r.changes === 0) return res.status(404).json({ error: 'not found' });
    return res.json({ deleted: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
