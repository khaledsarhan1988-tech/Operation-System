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
// Any non-empty shift label is allowed (Full Time, Part Time, Free Lance,
// Project, "Full Time From 7 To 12", ...). Trimmed and capped; empty → default.
const cleanShift = (v) => {
  const s = String(v == null ? '' : v).trim().slice(0, 80);
  return s || 'Full Time';
};

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
    // KPI breakdown — kpis (total) is always the SUM of the 3 components.
    const kNo = num(b.kpi_no_absence), kOn = num(b.kpi_on_time), kAt = num(b.kpi_attendance);
    const kpisTotal = kNo + kOn + kAt;
    const r = db.prepare(`
      INSERT INTO trainer_salary_defs
        (system_id, category, shift_type, days, hr, week, total_amount, kpis,
         kpi_no_absence, kpi_on_time, kpi_attendance,
         tw_hours_override, per_hour_override, rate_per_h_override, sort_order)
      VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      systemId, cleanShift(b.shift_type),
      num(b.days), num(b.hr), num(b.week), num(b.total_amount), kpisTotal,
      kNo, kOn, kAt,
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
    const kNo = num(b.kpi_no_absence), kOn = num(b.kpi_on_time), kAt = num(b.kpi_attendance);
    const kpisTotal = kNo + kOn + kAt;
    const r = db.prepare(`
      UPDATE trainer_salary_defs SET
        shift_type          = ?,
        days                = ?,
        hr                  = ?,
        week                = ?,
        total_amount        = ?,
        kpis                = ?,
        kpi_no_absence      = ?,
        kpi_on_time         = ?,
        kpi_attendance      = ?,
        tw_hours_override   = ?,
        per_hour_override   = ?,
        rate_per_h_override = ?,
        updated_at          = datetime('now', '+2 hours')
      WHERE id = ?
    `).run(
      cleanShift(b.shift_type),
      num(b.days), num(b.hr), num(b.week), num(b.total_amount), kpisTotal,
      kNo, kOn, kAt,
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

/* ─── DEDUCTIONS (الخصومات) ───────────────────────────────────────────────
 * Owner-only salary deductions per trainer (team_members.id). Each entry is
 * hours or days on a date; the money value is computed on the client from the
 * trainer's salary row. */

// GET /deductions?from=&to=&trainer_id=  → list (optionally filtered)
router.get('/deductions', (req, res) => {
  try {
    const { from, to, trainer_id } = req.query;
    const where = [];
    const params = [];
    if (from)       { where.push('date >= ?'); params.push(from); }
    if (to)         { where.push('date <= ?'); params.push(to); }
    if (trainer_id) { where.push('trainer_id = ?'); params.push(parseInt(trainer_id, 10)); }
    const sql = `SELECT * FROM trainer_deductions
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY date ASC, id ASC`;
    return res.json(db.prepare(sql).all(...params));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /deductions — body: { trainer_id, kind, amount, date, note? }
router.post('/deductions', express.json(), (req, res) => {
  const b = req.body || {};
  const trainerId = parseInt(b.trainer_id, 10);
  if (!trainerId) return res.status(400).json({ error: 'trainer_id مطلوب' });
  const kind = b.kind === 'days' ? 'days' : 'hours';
  const amount = num(b.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'العدد يجب أن يكون أكبر من صفر' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) {
    return res.status(400).json({ error: 'تاريخ غير صالح' });
  }
  try {
    const r = db.prepare(`
      INSERT INTO trainer_deductions (trainer_id, kind, amount, date, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(trainerId, kind, amount, b.date, String(b.note || '').trim() || null);
    const row = db.prepare(`SELECT * FROM trainer_deductions WHERE id = ?`).get(r.lastInsertRowid);
    return res.status(201).json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /deductions/:id
router.delete('/deductions/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    const r = db.prepare(`DELETE FROM trainer_deductions WHERE id = ?`).run(id);
    if (r.changes === 0) return res.status(404).json({ error: 'not found' });
    return res.json({ deleted: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* ─── KPI AWARDS (اختيار KPIs لكل مدرب/شهر) ────────────────────────────────
 * Manual selection of which KPI components a trainer earned in a month. The
 * money is derived on the client from the trainer's salary-def KPI amounts. */

// GET /kpi-awards?month=YYYY-MM  → all awards for the month
router.get('/kpi-awards', (req, res) => {
  const month = String(req.query.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month=YYYY-MM مطلوب' });
  try {
    return res.json(db.prepare(`SELECT * FROM trainer_kpi_awards WHERE month = ?`).all(month));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /kpi-awards — upsert one trainer's award flags for a month.
// body: { trainer_id, month, no_absence, on_time, attendance }
router.put('/kpi-awards', express.json(), (req, res) => {
  const b = req.body || {};
  const trainerId = parseInt(b.trainer_id, 10);
  const month = String(b.month || '');
  if (!trainerId) return res.status(400).json({ error: 'trainer_id مطلوب' });
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month=YYYY-MM مطلوب' });
  const flag = (v) => (v ? 1 : 0);
  try {
    db.prepare(`
      INSERT INTO trainer_kpi_awards (trainer_id, month, no_absence, on_time, attendance, updated_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(trainer_id, month) DO UPDATE SET
        no_absence = excluded.no_absence,
        on_time    = excluded.on_time,
        attendance = excluded.attendance,
        updated_by = excluded.updated_by,
        updated_at = datetime('now', '+2 hours')
    `).run(trainerId, month, flag(b.no_absence), flag(b.on_time), flag(b.attendance), req.user?.id || null);
    const row = db.prepare(`SELECT * FROM trainer_kpi_awards WHERE trainer_id = ? AND month = ?`).get(trainerId, month);
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* ─── MONTH LOCKS (قفل/تجميد الشهر) ────────────────────────────────────────
 * Freeze a month's payroll into a JSON snapshot so future changes to salary
 * systems / KPIs / hours never alter a finished month. */

// GET /locks  → list of locked months (lightweight, no snapshot body)
router.get('/locks', (req, res) => {
  try {
    return res.json(db.prepare(`SELECT month, locked_at, locked_by FROM payroll_month_locks ORDER BY month DESC`).all());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /locks/:month  → the frozen snapshot rows for a month (404 if not locked)
router.get('/locks/:month', (req, res) => {
  const month = String(req.params.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month=YYYY-MM' });
  try {
    const row = db.prepare(`SELECT * FROM payroll_month_locks WHERE month = ?`).get(month);
    if (!row) return res.status(404).json({ error: 'الشهر غير مقفول' });
    let rows = [];
    try { rows = JSON.parse(row.snapshot_json) || []; } catch (_) { rows = []; }
    return res.json({ month, locked_at: row.locked_at, locked_by: row.locked_by, rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /locks/:month  → lock the month with the computed snapshot rows.
// body: { rows: [...] } — the fully-computed payroll rows as displayed.
router.post('/locks/:month', express.json({ limit: '8mb' }), (req, res) => {
  const month = String(req.params.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month=YYYY-MM' });
  const rows = (req.body && Array.isArray(req.body.rows)) ? req.body.rows : null;
  if (!rows) return res.status(400).json({ error: 'rows مطلوبة' });
  try {
    db.prepare(`
      INSERT INTO payroll_month_locks (month, snapshot_json, locked_by)
      VALUES (?, ?, ?)
      ON CONFLICT(month) DO UPDATE SET
        snapshot_json = excluded.snapshot_json,
        locked_by     = excluded.locked_by,
        locked_at     = datetime('now', '+2 hours')
    `).run(month, JSON.stringify(rows), req.user?.id || null);
    const row = db.prepare(`SELECT month, locked_at, locked_by FROM payroll_month_locks WHERE month = ?`).get(month);
    return res.status(201).json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /locks/:month  → unlock (removes the snapshot → live again)
router.delete('/locks/:month', (req, res) => {
  const month = String(req.params.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month=YYYY-MM' });
  try {
    const r = db.prepare(`DELETE FROM payroll_month_locks WHERE month = ?`).run(month);
    if (r.changes === 0) return res.status(404).json({ error: 'الشهر غير مقفول' });
    return res.json({ unlocked: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
