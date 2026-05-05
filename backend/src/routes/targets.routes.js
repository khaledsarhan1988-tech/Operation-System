'use strict';
const express = require('express');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { lineFilter } = require('../utils/lineFilter');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// GET /api/admin/targets
// Returns all targets, optionally filtered by agent or department.
router.get('/', (req, res) => {
  const { agent, department } = req.query;
  const line = lineFilter(req);

  const params = [];
  let where = 'WHERE 1=1';
  if (line) { where += ' AND t.line = ?'; params.push(line); }
  if (agent) {
    where += ' AND LOWER(TRIM(t.agent_name)) = LOWER(TRIM(?))';
    params.push(agent);
  }
  if (department && department !== 'All') {
    where += ' AND t.department = ?';
    params.push(department);
  }
  const rows = db.prepare(`
    SELECT t.id, t.agent_name, t.department, t.line,
           t.target_completion, t.target_followup, t.target_fix, t.target_overall,
           t.target_main_absent_rate, t.target_zoom_absent_rate,
           t.effective_from, t.set_at, t.notes,
           u.full_name AS set_by_name,
           CASE
             WHEN t.agent_name IS NOT NULL THEN 'agent'
             WHEN t.department IS NOT NULL THEN 'department'
             ELSE 'global'
           END AS scope
    FROM employee_targets t
    LEFT JOIN users u ON u.id = t.set_by
    ${where}
    ORDER BY
      CASE
        WHEN t.agent_name IS NOT NULL THEN 0
        WHEN t.department IS NOT NULL THEN 1
        ELSE 2
      END,
      t.effective_from DESC, t.set_at DESC
  `).all(...params);
  return res.json(rows);
});

// GET /api/admin/targets/baseline?agent_name=... or ?department=...
// Returns the agent/dept's main + zoom absence rates from the latest Official
// quality snapshot, used to pre-fill placeholder + warn on >=baseline targets.
router.get('/baseline', (req, res) => {
  const { agent_name, department } = req.query;
  if (!agent_name && !department) {
    return res.status(400).json({ error: 'agent_name or department required' });
  }
  const line = lineFilter(req) || 'Ahmed Hassan';

  const snap = db.prepare(`
    SELECT id, snapshot_label, from_date, to_date, rows_json, dept_averages_json
    FROM quality_report_snapshots
    WHERE is_official = 1 AND line = ?
    ORDER BY frozen_at DESC LIMIT 1
  `).get(line);

  if (!snap) {
    return res.json({ found: false, reason: 'no_official_snapshot' });
  }

  if (agent_name) {
    let rows;
    try { rows = JSON.parse(snap.rows_json || '[]'); }
    catch { rows = []; }
    const target = String(agent_name).trim().toLowerCase();
    const row = rows.find(r => String(r.agent_name || '').trim().toLowerCase() === target);
    if (row) {
      return res.json({
        found: true,
        snapshot_id: snap.id,
        snapshot_label: snap.snapshot_label,
        from_date: snap.from_date,
        to_date: snap.to_date,
        main_absent_rate: row.main_absent_rate ?? 0,
        zoom_absent_rate: row.zoom_absent_rate ?? 0,
      });
    }

    // Agent isn't in the snapshot — likely new hire. Fall back to their
    // department's average so the admin still has a sensible reference.
    const u = db.prepare(`
      SELECT department FROM users
      WHERE TRIM(LOWER(full_name)) = TRIM(LOWER(?)) AND line = ?
      LIMIT 1
    `).get(agent_name, line);

    let depts;
    try { depts = JSON.parse(snap.dept_averages_json || '[]'); }
    catch { depts = []; }
    const d = u?.department ? depts.find(x => x.department === u.department) : null;
    if (d) {
      return res.json({
        found: true,
        fallback: 'department_average',
        department: u.department,
        snapshot_id: snap.id,
        snapshot_label: snap.snapshot_label,
        from_date: snap.from_date,
        to_date: snap.to_date,
        main_absent_rate: d.mainRate ?? 0,
        zoom_absent_rate: d.zoomRate ?? 0,
      });
    }

    return res.json({
      found: false,
      reason: 'agent_not_in_snapshot',
      snapshot_label: snap.snapshot_label,
    });
  }

  // department scope — pull from dept_averages_json
  let depts;
  try { depts = JSON.parse(snap.dept_averages_json || '[]'); }
  catch { depts = []; }
  const d = depts.find(x => x.department === department);
  if (!d) {
    return res.json({
      found: false,
      reason: 'dept_not_in_snapshot',
      snapshot_label: snap.snapshot_label,
    });
  }
  return res.json({
    found: true,
    snapshot_id: snap.id,
    snapshot_label: snap.snapshot_label,
    from_date: snap.from_date,
    to_date: snap.to_date,
    main_absent_rate: d.mainRate ?? 0,
    zoom_absent_rate: d.zoomRate ?? 0,
  });
});

// POST /api/admin/targets
// Body: { agent_name?, department?, target_main_absent_rate, target_zoom_absent_rate,
//         effective_from, notes? }
// Pass NULL for agent_name and department to set a global target.
router.post('/', (req, res) => {
  const {
    agent_name, department,
    target_main_absent_rate, target_zoom_absent_rate,
    effective_from, notes,
  } = req.body || {};

  if (!effective_from || !/^\d{4}-\d{2}-\d{2}$/.test(effective_from)) {
    return res.status(400).json({ error: 'effective_from must be YYYY-MM-DD' });
  }
  const tMain = parseInt(target_main_absent_rate, 10);
  const tZoom = parseInt(target_zoom_absent_rate, 10);
  if (!Number.isFinite(tMain) || tMain < 0 || tMain > 100) {
    return res.status(400).json({ error: 'target_main_absent_rate must be 0-100' });
  }
  if (!Number.isFinite(tZoom) || tZoom < 0 || tZoom > 100) {
    return res.status(400).json({ error: 'target_zoom_absent_rate must be 0-100' });
  }

  const line = lineFilter(req) || 'Ahmed Hassan';
  const r = db.prepare(`
    INSERT INTO employee_targets
      (agent_name, department, line,
       target_main_absent_rate, target_zoom_absent_rate,
       effective_from, set_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agent_name || null,
    (department && department !== 'All') ? department : null,
    line, tMain, tZoom,
    effective_from,
    req.user?.id,
    notes || null
  );
  saveNow();
  // Audit the target change (fail-soft — don't break parent if audit fails)
  try {
    db.prepare(`INSERT INTO snapshot_audit_log
      (action, agent_name, details, user_id, user_name, line)
      VALUES ('target_change', ?, ?, ?, ?, ?)`).run(
      agent_name || department || 'global',
      JSON.stringify({ op: 'create', id: r.lastInsertRowid, scope: agent_name ? 'agent' : department ? 'department' : 'global', target: { tMain, tZoom, effective_from } }),
      req.user?.id, req.user?.full_name, line
    );
  } catch (_) {}
  return res.json({ id: r.lastInsertRowid });
});

// PUT /api/admin/targets/:id
// Body: any of { target_main_absent_rate, target_zoom_absent_rate, effective_from, notes }
router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const fields = [];
  const params = [];
  const map = {
    target_main_absent_rate: 'target_main_absent_rate',
    target_zoom_absent_rate: 'target_zoom_absent_rate',
    effective_from:          'effective_from',
    notes:                   'notes',
  };
  for (const [k, col] of Object.entries(map)) {
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, k)) {
      const v = req.body[k];
      if (k.startsWith('target_')) {
        const n = parseInt(v, 10);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          return res.status(400).json({ error: `${k} must be 0-100` });
        }
        fields.push(`${col} = ?`); params.push(n);
      } else if (k === 'effective_from') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return res.status(400).json({ error: 'effective_from must be YYYY-MM-DD' });
        fields.push(`${col} = ?`); params.push(v);
      } else {
        fields.push(`${col} = ?`); params.push(v || null);
      }
    }
  }
  if (fields.length === 0) return res.status(400).json({ error: 'No updatable fields supplied' });
  params.push(id);
  const r = db.prepare(`UPDATE employee_targets SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  saveNow();
  if (r.changes === 0) return res.status(404).json({ error: 'Target not found' });
  // Audit
  try {
    const t = db.prepare(`SELECT agent_name, department, line FROM employee_targets WHERE id = ?`).get(id);
    db.prepare(`INSERT INTO snapshot_audit_log
      (action, agent_name, details, user_id, user_name, line)
      VALUES ('target_change', ?, ?, ?, ?, ?)`).run(
      t?.agent_name || t?.department || 'global',
      JSON.stringify({ op: 'update', id, fields: req.body }),
      req.user?.id, req.user?.full_name, t?.line || lineFilter(req) || 'Ahmed Hassan'
    );
  } catch (_) {}
  return res.json({ id });
});

// DELETE /api/admin/targets/:id
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const t = db.prepare(`SELECT agent_name, department, line FROM employee_targets WHERE id = ?`).get(id);
  const r = db.prepare(`DELETE FROM employee_targets WHERE id = ?`).run(id);
  saveNow();
  if (r.changes === 0) return res.status(404).json({ error: 'Target not found' });
  // Audit
  try {
    db.prepare(`INSERT INTO snapshot_audit_log
      (action, agent_name, details, user_id, user_name, line)
      VALUES ('target_change', ?, ?, ?, ?, ?)`).run(
      t?.agent_name || t?.department || 'global',
      JSON.stringify({ op: 'delete', id }),
      req.user?.id, req.user?.full_name, t?.line || lineFilter(req) || 'Ahmed Hassan'
    );
  } catch (_) {}
  return res.json({ deleted: 1 });
});

module.exports = router;
