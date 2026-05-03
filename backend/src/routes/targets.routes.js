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

// POST /api/admin/targets
// Body: { agent_name?, department?, target_completion, target_followup, target_fix, target_overall, effective_from, notes? }
// Pass NULL for agent_name and department to set a global target.
router.post('/', (req, res) => {
  const {
    agent_name, department,
    target_completion, target_followup, target_fix, target_overall,
    effective_from, notes,
  } = req.body || {};

  if (!effective_from || !/^\d{4}-\d{2}-\d{2}$/.test(effective_from)) {
    return res.status(400).json({ error: 'effective_from must be YYYY-MM-DD' });
  }
  const tc = parseInt(target_completion, 10);
  const tf = parseInt(target_followup, 10);
  const tx = parseInt(target_fix, 10);
  const to = parseInt(target_overall, 10);
  if ([tc, tf, tx, to].some(v => !Number.isFinite(v) || v < 0 || v > 100)) {
    return res.status(400).json({ error: 'All target_* values must be 0-100' });
  }

  const line = lineFilter(req) || 'Ahmed Hassan';
  const r = db.prepare(`
    INSERT INTO employee_targets
      (agent_name, department, line, target_completion, target_followup, target_fix, target_overall,
       effective_from, set_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agent_name || null,
    (department && department !== 'All') ? department : null,
    line, tc, tf, tx, to,
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
      JSON.stringify({ op: 'create', id: r.lastInsertRowid, scope: agent_name ? 'agent' : department ? 'department' : 'global', target: { tc, tf, tx, to, effective_from } }),
      req.user?.id, req.user?.full_name, line
    );
  } catch (_) {}
  return res.json({ id: r.lastInsertRowid });
});

// PUT /api/admin/targets/:id
// Body: any of { target_completion, target_followup, target_fix, target_overall, effective_from, notes }
router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const fields = [];
  const params = [];
  const map = {
    target_completion: 'target_completion',
    target_followup:   'target_followup',
    target_fix:        'target_fix',
    target_overall:    'target_overall',
    effective_from:    'effective_from',
    notes:             'notes',
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
