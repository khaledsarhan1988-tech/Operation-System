'use strict';
const express = require('express');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { lineFilter } = require('../utils/lineFilter');

const router = express.Router();
router.use(authenticate, requireRole('agent')); // base auth — admin gates per write route
const adminOnly = requireRole('admin');

// Non-admins are scoped to what's relevant to them:
//   - leader  → only the dept-scope target for their own department
//   - agent   → their personal individual target + their dept's target
//               (so they see both their own goal and the team goal they
//               contribute toward)
//   - admin   → no extra filter (sees everything)
function scopedTargetWhere(req) {
  if (req.user?.role === 'admin') return null;
  if (req.user?.role === 'leader' && req.user?.department && req.user.department !== 'All') {
    return { sql: '(t.department = ? AND t.agent_name IS NULL)', params: [req.user.department] };
  }
  // agent
  const dept = req.user?.department && req.user.department !== 'All' ? req.user.department : null;
  if (dept) {
    return {
      sql: '((t.agent_name IS NOT NULL AND LOWER(TRIM(t.agent_name)) = LOWER(TRIM(?))) OR (t.department = ? AND t.agent_name IS NULL))',
      params: [req.user?.full_name || '', dept],
    };
  }
  return {
    sql: '(t.agent_name IS NOT NULL AND LOWER(TRIM(t.agent_name)) = LOWER(TRIM(?)))',
    params: [req.user?.full_name || ''],
  };
}

// ─── PERIOD HELPERS ────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }
function monthRange(year, month) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${year}-${pad(month)}-01`,
    end:   `${year}-${pad(month)}-${pad(last)}`,
  };
}
function monthLabel(year, month) {
  const names = ['', 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[month]} ${year}`;
}
function periodFromEffectiveFrom(effective_from) {
  // Treat the target as covering the calendar month that effective_from falls in.
  const [y, m] = effective_from.split('-').map(Number);
  const range = monthRange(y, m);
  return {
    period_year:  y,
    period_month: m,
    period_start: range.start,
    period_end:   range.end,
    period_label: monthLabel(y, m),
  };
}

function pullActualForAgent(snap, agent_name) {
  if (!snap) return null;
  let rows;
  try { rows = JSON.parse(snap.rows_json || '[]'); }
  catch { rows = []; }
  const target = String(agent_name).trim().toLowerCase();
  const r = rows.find(x => String(x.agent_name || '').trim().toLowerCase() === target);
  if (!r) return null;
  return {
    main_absent_count: r.main_absent_count ?? 0,
    main_expected:     r.main_expected_count ?? 0,
    main_rate:         r.main_absent_rate ?? 0,
    zoom_absent_count: r.zoom_absent_count ?? 0,
    zoom_expected:     r.zoom_expected_count ?? 0,
    zoom_rate:         r.zoom_absent_rate ?? 0,
  };
}
function pullActualForDept(snap, dept_type) {
  if (!snap) return null;
  let depts;
  try { depts = JSON.parse(snap.dept_averages_json || '[]'); }
  catch { depts = []; }
  const d = depts.find(x => x.department === dept_type);
  if (!d) return null;
  return {
    main_absent_count: d.mainAbsent ?? 0,
    main_expected:     d.mainExpected ?? 0,
    main_rate:         d.mainRate ?? 0,
    zoom_absent_count: d.zoomAbsent ?? 0,
    zoom_expected:     d.zoomExpected ?? 0,
    zoom_rate:         d.zoomRate ?? 0,
  };
}
function findOfficialSnapshotForPeriod(line, period_start, period_end) {
  return db.prepare(`
    SELECT id, snapshot_label, from_date, to_date, rows_json, dept_averages_json
    FROM quality_report_snapshots
    WHERE is_official = 1 AND line = ?
      AND from_date = ? AND to_date = ?
    ORDER BY frozen_at DESC LIMIT 1
  `).get(line, period_start, period_end);
}
function computeStatus(actualMain, actualZoom, targetMain, targetZoom) {
  const mainMet = actualMain <= targetMain;
  const zoomMet = actualZoom <= targetZoom;
  if (mainMet && zoomMet) return 'met';
  if (!mainMet && !zoomMet) return 'missed';
  return 'partial';
}

// ─── ROUTES ────────────────────────────────────────────────────────────────

// GET /api/admin/targets
// Query: ?agent= ?department= ?mode=active|history (default: all)
router.get('/', (req, res) => {
  const { agent, department, mode } = req.query;
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
  if (mode === 'active') {
    where += " AND t.status = 'active'";
  } else if (mode === 'history') {
    where += " AND t.status IN ('met','missed','partial')";
  }

  const scope = scopedTargetWhere(req);
  if (scope) {
    where += ` AND ${scope.sql}`;
    params.push(...scope.params);
  }

  const rows = db.prepare(`
    SELECT t.id, t.agent_name, t.department, t.line,
           t.target_completion, t.target_followup, t.target_fix, t.target_overall,
           t.target_main_absent_rate, t.target_zoom_absent_rate, t.bonus_points,
           t.period_year, t.period_month, t.period_start, t.period_end, t.period_label,
           t.status,
           t.actual_main_absent_rate, t.actual_zoom_absent_rate,
           t.actual_main_absent_count, t.actual_main_expected,
           t.actual_zoom_absent_count, t.actual_zoom_expected,
           t.evaluated_at, t.bonus_awarded,
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
      t.period_end DESC, t.effective_from DESC, t.set_at DESC
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
//         bonus_points?, effective_from, notes? }
// Pass NULL for agent_name and department to set a global target.
router.post('/', adminOnly, (req, res) => {
  const {
    agent_name, department,
    target_main_absent_rate, target_zoom_absent_rate,
    bonus_points,
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
  let bonus = bonus_points != null ? parseInt(bonus_points, 10) : 5;
  if (!Number.isFinite(bonus) || bonus < 0 || bonus > 100) bonus = 5;

  const line = lineFilter(req) || 'Ahmed Hassan';
  const period = periodFromEffectiveFrom(effective_from);
  const r = db.prepare(`
    INSERT INTO employee_targets
      (agent_name, department, line,
       target_main_absent_rate, target_zoom_absent_rate, bonus_points,
       effective_from, set_by, notes,
       period_year, period_month, period_start, period_end, period_label, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `).run(
    agent_name || null,
    (department && department !== 'All') ? department : null,
    line, tMain, tZoom, bonus,
    effective_from,
    req.user?.id,
    notes || null,
    period.period_year, period.period_month,
    period.period_start, period.period_end, period.period_label,
  );
  saveNow();
  // Audit the target change (fail-soft — don't break parent if audit fails)
  try {
    db.prepare(`INSERT INTO snapshot_audit_log
      (action, agent_name, details, user_id, user_name, line)
      VALUES ('target_change', ?, ?, ?, ?, ?)`).run(
      agent_name || department || 'global',
      JSON.stringify({ op: 'create', id: r.lastInsertRowid, scope: agent_name ? 'agent' : department ? 'department' : 'global', target: { tMain, tZoom, bonus, effective_from } }),
      req.user?.id, req.user?.full_name, line
    );
  } catch (_) {}
  return res.json({ id: r.lastInsertRowid });
});

// PUT /api/admin/targets/:id
// Body: any of { target_main_absent_rate, target_zoom_absent_rate, effective_from, notes }
router.put('/:id', adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const fields = [];
  const params = [];
  const map = {
    target_main_absent_rate: 'target_main_absent_rate',
    target_zoom_absent_rate: 'target_zoom_absent_rate',
    bonus_points:            'bonus_points',
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
      } else if (k === 'bonus_points') {
        const n = parseInt(v, 10);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          return res.status(400).json({ error: 'bonus_points must be 0-100' });
        }
        fields.push(`${col} = ?`); params.push(n);
      } else if (k === 'effective_from') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return res.status(400).json({ error: 'effective_from must be YYYY-MM-DD' });
        const p = periodFromEffectiveFrom(v);
        fields.push('effective_from = ?', 'period_year = ?', 'period_month = ?',
                    'period_start = ?', 'period_end = ?', 'period_label = ?');
        params.push(v, p.period_year, p.period_month, p.period_start, p.period_end, p.period_label);
        continue;
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

// POST /api/admin/targets/:id/evaluate
// Looks up the target's period in the latest matching Official quality
// snapshot, persists actual_* + status, and (if met) awards bonus points
// to the agent's monthly_snapshots row via individual_target_bonus.
router.post('/:id/evaluate', adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  const t = db.prepare(`SELECT * FROM employee_targets WHERE id = ?`).get(id);
  if (!t) return res.status(404).json({ error: 'Target not found' });
  if (!t.period_start || !t.period_end) {
    return res.status(400).json({ error: 'Target has no period — recreate it via the form.' });
  }
  if (t.target_main_absent_rate == null || t.target_zoom_absent_rate == null) {
    return res.status(400).json({ error: 'Target is missing absence rates — only absence-style targets can be evaluated.' });
  }

  try {
    const snap = findOfficialSnapshotForPeriod(t.line, t.period_start, t.period_end);
    if (!snap) {
      return res.status(400).json({
        error: 'snapshot_required',
        message: `يجب حفظ Snapshot Official من تقارير الجودة يغطي الفترة (${t.period_start} → ${t.period_end}) قبل التقييم.`,
      });
    }

    let actual = null;
    if (t.agent_name) {
      actual = pullActualForAgent(snap, t.agent_name);
      if (!actual) {
        return res.status(400).json({
          error: 'agent_not_in_snapshot',
          message: `الموظف "${t.agent_name}" مش موجود في Snapshot ${snap.snapshot_label}.`,
        });
      }
    } else if (t.department) {
      actual = pullActualForDept(snap, t.department);
      if (!actual) {
        return res.status(400).json({
          error: 'dept_not_in_snapshot',
          message: `القسم "${t.department}" مش موجود في Snapshot ${snap.snapshot_label}.`,
        });
      }
    } else {
      // global — sum across all dept_averages
      let depts;
      try { depts = JSON.parse(snap.dept_averages_json || '[]'); }
      catch { depts = []; }
      const totalMA = depts.reduce((s, d) => s + (d.mainAbsent ?? 0), 0);
      const totalME = depts.reduce((s, d) => s + (d.mainExpected ?? 0), 0);
      const totalZA = depts.reduce((s, d) => s + (d.zoomAbsent ?? 0), 0);
      const totalZE = depts.reduce((s, d) => s + (d.zoomExpected ?? 0), 0);
      actual = {
        main_absent_count: totalMA,
        main_expected:     totalME,
        main_rate:         totalME > 0 ? Math.round((totalMA / totalME) * 100) : 0,
        zoom_absent_count: totalZA,
        zoom_expected:     totalZE,
        zoom_rate:         totalZE > 0 ? Math.round((totalZA / totalZE) * 100) : 0,
      };
    }

    const status = computeStatus(
      actual.main_rate, actual.zoom_rate,
      t.target_main_absent_rate, t.target_zoom_absent_rate,
    );

    db.prepare(`
      UPDATE employee_targets SET
        actual_main_absent_rate  = ?,
        actual_zoom_absent_rate  = ?,
        actual_main_absent_count = ?,
        actual_main_expected     = ?,
        actual_zoom_absent_count = ?,
        actual_zoom_expected     = ?,
        status                   = ?,
        evaluated_at             = datetime('now', '+2 hours'),
        evaluated_by             = ?
      WHERE id = ?
    `).run(
      actual.main_rate, actual.zoom_rate,
      actual.main_absent_count, actual.main_expected,
      actual.zoom_absent_count, actual.zoom_expected,
      status,
      req.user?.id || null,
      id,
    );

    // Award bonus on 'met' (only once per target). Distribution depends
    // on scope:
    //   - agent  → just that one employee
    //   - dept   → every employee in that department for the period
    //   - global → every employee for the period (line-scoped)
    let bonusGiven = 0;
    if (status === 'met' && !t.bonus_awarded) {
      let result;
      if (t.agent_name) {
        result = db.prepare(`
          UPDATE monthly_snapshots
          SET individual_target_bonus = individual_target_bonus + ?
          WHERE agent_name = ? AND year = ? AND month = ? AND line = ?
        `).run(t.bonus_points, t.agent_name, t.period_year, t.period_month, t.line);
      } else if (t.department) {
        result = db.prepare(`
          UPDATE monthly_snapshots
          SET individual_target_bonus = individual_target_bonus + ?
          WHERE department = ? AND year = ? AND month = ? AND line = ?
        `).run(t.bonus_points, t.department, t.period_year, t.period_month, t.line);
      } else {
        result = db.prepare(`
          UPDATE monthly_snapshots
          SET individual_target_bonus = individual_target_bonus + ?
          WHERE year = ? AND month = ? AND line = ?
        `).run(t.bonus_points, t.period_year, t.period_month, t.line);
      }
      bonusGiven = result?.changes || 0;
      db.prepare(`UPDATE employee_targets SET bonus_awarded = 1 WHERE id = ?`).run(id);
    }

    saveNow();

    // Audit
    try {
      db.prepare(`INSERT INTO snapshot_audit_log
        (action, agent_name, details, user_id, user_name, line)
        VALUES ('target_change', ?, ?, ?, ?, ?)`).run(
        t.agent_name || t.department || 'global',
        JSON.stringify({ op: 'evaluate', id, status, actual_main: actual.main_rate, actual_zoom: actual.zoom_rate, bonus_given: bonusGiven }),
        req.user?.id, req.user?.full_name, t.line,
      );
    } catch (_) {}

    return res.json({
      success: true,
      status,
      actual_main_rate: actual.main_rate,
      actual_zoom_rate: actual.zoom_rate,
      bonus_given: bonusGiven,
    });
  } catch (err) {
    console.error('[targets/evaluate]', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/targets/history
// Query: ?dept_type= ?period_type=monthly (only monthly supported today)
// Returns evaluated targets + summary counts for the History tab.
router.get('/history', (req, res) => {
  const { dept_type } = req.query;
  const line = lineFilter(req);

  const conds = ["status IN ('met','missed','partial')"];
  const params = [];
  if (line)      { conds.push('line = ?');       params.push(line); }
  if (dept_type) { conds.push('department = ?'); params.push(dept_type); }

  // History uses bare column names (no `t.` alias) — translate the scope.
  const scope = scopedTargetWhere(req);
  if (scope) {
    conds.push(scope.sql.replace(/\bt\./g, ''));
    params.push(...scope.params);
  }

  const rows = db.prepare(`
    SELECT id, agent_name, department, line,
           target_main_absent_rate, target_zoom_absent_rate, bonus_points,
           actual_main_absent_rate, actual_zoom_absent_rate,
           period_year, period_month, period_start, period_end, period_label,
           status, evaluated_at, bonus_awarded,
           CASE
             WHEN agent_name IS NOT NULL THEN 'agent'
             WHEN department IS NOT NULL THEN 'department'
             ELSE 'global'
           END AS scope
    FROM employee_targets
    WHERE ${conds.join(' AND ')}
    ORDER BY period_end DESC, evaluated_at DESC
    LIMIT 500
  `).all(...params);

  return res.json(rows);
});

// DELETE /api/admin/targets/:id
router.delete('/:id', adminOnly, (req, res) => {
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
