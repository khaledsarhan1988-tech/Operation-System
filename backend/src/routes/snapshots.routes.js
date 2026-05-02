'use strict';
const express = require('express');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { lineFilter } = require('../utils/lineFilter');
const { nameInListInline } = require('../utils/nameMatch');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const MONTH_NAMES_AR = [
  '', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function pad2(n) { return String(n).padStart(2, '0'); }

// First and (exclusive) last day of a calendar month.
function monthBounds(year, month) {
  const start = `${year}-${pad2(month)}-01`;
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const end = `${ny}-${pad2(nm)}-01`;
  return { start, end, label: `${year}-${pad2(month)}` };
}

function clampPct(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function safeRate(num, denom) {
  if (!denom || denom <= 0) return 0;
  return clampPct((num / denom) * 100);
}

// Compute overall = 0.5*completion + 0.25*followup + 0.25*fix
function computeOverall(completion, followup, fix) {
  return clampPct(completion * 0.5 + followup * 0.25 + fix * 0.25);
}

// Look up the effective target for an agent on a given month.
// Priority: agent-specific > department > global.
// Target row is "effective" if effective_from <= start of month.
function lookupTarget(agentName, department, line, monthStart) {
  const params = [agentName, department, line, monthStart];
  const row = db.prepare(`
    SELECT target_completion, target_followup, target_fix, target_overall
    FROM employee_targets
    WHERE line = ?4
      AND effective_from <= ?4
      AND (
        (LOWER(TRIM(agent_name)) = LOWER(TRIM(?1)))
        OR (agent_name IS NULL AND department = ?2)
        OR (agent_name IS NULL AND department IS NULL)
      )
    ORDER BY
      CASE WHEN LOWER(TRIM(agent_name)) = LOWER(TRIM(?1)) THEN 0
           WHEN department = ?2 THEN 1
           ELSE 2 END,
      effective_from DESC
    LIMIT 1
  `).get(agentName, department, line, monthStart);
  return row || { target_completion: 85, target_followup: 80, target_fix: 90, target_overall: 80 };
}

// Compute KPIs for one agent for one calendar month.
function computeAgentKpis(agent, year, month, line) {
  const { start, end, label } = monthBounds(year, month);
  const lineSafe = (line || 'Ahmed Hassan').replace(/'/g, "''");
  const agentSafe = (agent.full_name || '').replace(/'/g, "''");
  const deptSafe = (agent.department || '').replace(/'/g, "''");
  const yearStr = String(year);
  const monthStr = pad2(month);

  // Coordinator-name match against batches.coordinators field (token-exact).
  const coordMatch = nameInListInline('b.coordinators', agent.full_name);

  // remarks.added_at can be in either DD/MM/YYYY ('15/04/2026, 04:00 PM') or
  // ISO format. Match either by extracting year/month with substr — ISO has
  // year at chars 1-4 and month at 6-7; DD/MM/YYYY has year at 7-10 and month at 4-5.
  // Both branches produce a "YYYY-MM" string we can compare to period_label.
  const remarksPeriodExpr = `CASE
    WHEN substr(added_at, 5, 1) = '-' THEN substr(added_at, 1, 7)
    WHEN substr(added_at, 3, 1) = '/' THEN substr(added_at, 7, 4) || '-' || substr(added_at, 4, 2)
    ELSE NULL
  END`;
  const slaPeriodExpr = `CASE
    WHEN sla_deadline IS NULL THEN NULL
    WHEN substr(sla_deadline, 5, 1) = '-' THEN substr(sla_deadline, 1, 7)
    WHEN substr(sla_deadline, 3, 1) = '/' THEN substr(sla_deadline, 7, 4) || '-' || substr(sla_deadline, 4, 2)
    ELSE NULL
  END`;

  // ─── 1. TASKS / REMARKS ──────────────────────────────────────
  const tasks = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'إنتهت' THEN 1 ELSE 0 END), 0) AS done,
      COALESCE(SUM(CASE WHEN priority = 'عاجلة' THEN 1 ELSE 0 END), 0) AS urgent,
      COALESCE(SUM(CASE WHEN status != 'إنتهت' AND ${slaPeriodExpr} IS NOT NULL AND ${slaPeriodExpr} <= ? THEN 1 ELSE 0 END), 0) AS overdue,
      COALESCE(SUM(CASE WHEN status = 'إنتهت' AND (resolved_at IS NULL OR sla_deadline IS NULL OR resolved_at <= sla_deadline) THEN 1 ELSE 0 END), 0) AS done_in_sla
    FROM remarks
    WHERE line = ?
      AND LOWER(TRIM(assigned_to)) = LOWER(TRIM(?))
      AND ${remarksPeriodExpr} = ?
  `).get(label, line, agent.full_name, label);

  const tasks_total = tasks?.total || 0;
  const tasks_done = tasks?.done || 0;
  const tasks_urgent = tasks?.urgent || 0;
  const tasks_overdue = tasks?.overdue || 0;
  const completion_rate = safeRate(tasks_done, tasks_total);
  const sla_rate = safeRate((tasks?.done_in_sla || 0) + Math.max(0, tasks_total - tasks_done - tasks_overdue), tasks_total);

  // ─── 2. ABSENT FOLLOW-UP ─────────────────────────────────────
  // Absences in groups coordinated by this agent during the month
  // (both main + zoom).
  const absent = db.prepare(`
    SELECT
      COALESCE(SUM(cnt), 0) AS total,
      COALESCE(SUM(followed), 0) AS followed
    FROM (
      SELECT
        COUNT(*) AS cnt,
        SUM(CASE WHEN follow_up_status IN ('contacted','resolved') THEN 1 ELSE 0 END) AS followed
      FROM absent_students a
      INNER JOIN batches b ON b.group_name = a.group_name AND b.line = a.line
      WHERE a.line = ?
        AND a.date >= ?
        AND a.date < ?
        AND ${coordMatch}
      UNION ALL
      SELECT
        COUNT(*) AS cnt,
        SUM(CASE WHEN follow_up_status IN ('contacted','resolved') THEN 1 ELSE 0 END) AS followed
      FROM absent_zoom_students az
      INNER JOIN batches b ON b.group_name = az.group_name AND b.line = az.line
      WHERE az.line = ?
        AND az.date >= ?
        AND az.date < ?
        AND ${coordMatch}
    )
  `).get(line, start, end, line, start, end);

  const absents_total = absent?.total || 0;
  const absents_followed_up = absent?.followed || 0;
  const followup_rate = safeRate(absents_followed_up, absents_total);

  // ─── 3. CODE PROBLEMS ────────────────────────────────────────
  // Problems on agent's groups whose updated_at falls in the month.
  const cp = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN cps.status IN ('resolved','wont_repeat','exception') THEN 1 ELSE 0 END), 0) AS resolved
    FROM code_problem_status cps
    INNER JOIN batches b ON b.group_name = cps.group_name AND b.line = cps.line
    WHERE cps.line = ?
      AND cps.updated_at >= ?
      AND cps.updated_at < ?
      AND ${coordMatch}
  `).get(line, start, end);

  const code_problems_total = cp?.total || 0;
  const code_problems_resolved = cp?.resolved || 0;
  const fix_rate = code_problems_total === 0 ? 100 : safeRate(code_problems_resolved, code_problems_total);

  const overall_score = computeOverall(completion_rate, followup_rate, fix_rate);

  // Targets snapshot
  const t = lookupTarget(agent.full_name, agent.department, line, start);
  const met_target =
    completion_rate >= (t.target_completion || 0) &&
    followup_rate   >= (t.target_followup   || 0) &&
    fix_rate        >= (t.target_fix        || 0) &&
    overall_score   >= (t.target_overall    || 0)
      ? 1 : 0;

  return {
    agent_name: agent.full_name,
    agent_id: agent.id,
    department: agent.department,
    line,
    year, month, period_label: label,
    tasks_total, tasks_done, tasks_overdue, tasks_urgent,
    completion_rate, sla_rate,
    absents_total, absents_followed_up, followup_rate,
    code_problems_total, code_problems_resolved, fix_rate,
    overall_score,
    target_completion: t.target_completion,
    target_followup:   t.target_followup,
    target_fix:        t.target_fix,
    target_overall:    t.target_overall,
    met_target,
  };
}

// Compute and apply department averages + ranks for snapshots in this period.
function applyDepartmentBenchmarks(year, month, line) {
  const params = [line, year, month];
  // Group by department — compute avg + count per dept
  const deptAggs = db.prepare(`
    SELECT department,
           AVG(completion_rate) AS avg_c,
           AVG(followup_rate)   AS avg_f,
           AVG(fix_rate)        AS avg_x,
           AVG(overall_score)   AS avg_o,
           COUNT(*) AS total_in_dept
    FROM monthly_snapshots
    WHERE line = ? AND year = ? AND month = ?
    GROUP BY department
  `).all(...params);

  // For each dept, compute rank by overall_score desc
  for (const d of deptAggs) {
    const ordered = db.prepare(`
      SELECT id FROM monthly_snapshots
      WHERE line = ? AND year = ? AND month = ? AND department = ?
      ORDER BY overall_score DESC, completion_rate DESC, agent_name COLLATE NOCASE
    `).all(line, year, month, d.department);

    ordered.forEach((row, idx) => {
      db.prepare(`
        UPDATE monthly_snapshots
        SET dept_avg_completion = ?,
            dept_avg_followup   = ?,
            dept_avg_fix        = ?,
            dept_avg_overall    = ?,
            rank_in_dept        = ?,
            total_in_dept       = ?
        WHERE id = ?
      `).run(
        clampPct(d.avg_c),
        clampPct(d.avg_f),
        clampPct(d.avg_x),
        clampPct(d.avg_o),
        idx + 1,
        d.total_in_dept,
        row.id
      );
    });
  }
}

// Compute and persist achievements for snapshots in this period.
function applyAchievements(year, month, line) {
  const snaps = db.prepare(`
    SELECT * FROM monthly_snapshots
    WHERE line = ? AND year = ? AND month = ?
  `).all(line, year, month);

  for (const s of snaps) {
    const badges = [];

    if (s.rank_in_dept === 1 && (s.total_in_dept || 0) > 1) badges.push('top_performer');
    else if (s.rank_in_dept && s.rank_in_dept <= 3 && (s.total_in_dept || 0) >= 3) badges.push('top_3_performer');

    // Rising star: +10 over previous month for same agent
    const prevY = month === 1 ? year - 1 : year;
    const prevM = month === 1 ? 12 : month - 1;
    const prev = db.prepare(`
      SELECT overall_score FROM monthly_snapshots
      WHERE line = ? AND LOWER(TRIM(agent_name)) = LOWER(TRIM(?))
        AND year = ? AND month = ?
    `).get(line, s.agent_name, prevY, prevM);
    if (prev && (s.overall_score - prev.overall_score) >= 10) badges.push('rising_star');

    // Streak: 3 / 6 consecutive months >= 85
    const recent = db.prepare(`
      SELECT overall_score FROM monthly_snapshots
      WHERE line = ? AND LOWER(TRIM(agent_name)) = LOWER(TRIM(?))
        AND (year < ? OR (year = ? AND month <= ?))
      ORDER BY year DESC, month DESC LIMIT 6
    `).all(line, s.agent_name, year, year, month);
    const streak = recent.findIndex(r => r.overall_score < 85);
    const streakLen = streak === -1 ? recent.length : streak;
    if (streakLen >= 6) badges.push('streak_6');
    else if (streakLen >= 3) badges.push('streak_3');

    if (s.sla_rate === 100 && s.tasks_total > 0) badges.push('perfect_sla');
    if (s.completion_rate === 100 && s.tasks_total > 0) badges.push('perfect_completion');
    if (s.met_target === 1) badges.push('target_master');
    if (s.overall_score >= 95) badges.push('excellence');

    // Consistent: variance < 5 over last 4 months
    if (recent.length >= 4) {
      const last4 = recent.slice(0, 4).map(r => r.overall_score);
      const max = Math.max(...last4), min = Math.min(...last4);
      if (max - min < 5) badges.push('consistent');
    }

    db.prepare(`UPDATE monthly_snapshots SET achievements = ? WHERE id = ?`)
      .run(JSON.stringify(badges), s.id);
  }
}

// Run the whole freeze pipeline for a single (year, month, line).
// Returns { created, skipped, updated, errors }
function freezeMonth(year, month, line, frozenBy, overwrite) {
  const result = { created: 0, updated: 0, skipped: 0, errors: [] };

  // List active agents on this line
  const agents = db.prepare(`
    SELECT id, full_name, department
    FROM users
    WHERE role = 'agent' AND is_active = 1
      AND (line = ? OR ? = 'All')
      AND (department IS NOT NULL AND department != 'All')
  `).all(line, line);

  for (const agent of agents) {
    try {
      const kpis = computeAgentKpis(agent, year, month, line);

      // Check if exists
      const existing = db.prepare(`
        SELECT id FROM monthly_snapshots
        WHERE line = ? AND year = ? AND month = ? AND LOWER(TRIM(agent_name)) = LOWER(TRIM(?))
      `).get(line, year, month, agent.full_name);

      if (existing && !overwrite) {
        result.skipped++;
        continue;
      }

      if (existing && overwrite) {
        db.prepare(`
          UPDATE monthly_snapshots SET
            agent_id = ?, department = ?,
            tasks_total = ?, tasks_done = ?, tasks_overdue = ?, tasks_urgent = ?,
            completion_rate = ?, sla_rate = ?,
            absents_total = ?, absents_followed_up = ?, followup_rate = ?,
            code_problems_total = ?, code_problems_resolved = ?, fix_rate = ?,
            overall_score = ?,
            target_completion = ?, target_followup = ?, target_fix = ?, target_overall = ?,
            met_target = ?,
            frozen_by = ?, frozen_at = datetime('now', '+2 hours')
          WHERE id = ?
        `).run(
          kpis.agent_id, kpis.department,
          kpis.tasks_total, kpis.tasks_done, kpis.tasks_overdue, kpis.tasks_urgent,
          kpis.completion_rate, kpis.sla_rate,
          kpis.absents_total, kpis.absents_followed_up, kpis.followup_rate,
          kpis.code_problems_total, kpis.code_problems_resolved, kpis.fix_rate,
          kpis.overall_score,
          kpis.target_completion, kpis.target_followup, kpis.target_fix, kpis.target_overall,
          kpis.met_target,
          frozenBy,
          existing.id
        );
        result.updated++;
      } else {
        db.prepare(`
          INSERT INTO monthly_snapshots
            (agent_name, agent_id, department, line, year, month, period_label,
             tasks_total, tasks_done, tasks_overdue, tasks_urgent,
             completion_rate, sla_rate,
             absents_total, absents_followed_up, followup_rate,
             code_problems_total, code_problems_resolved, fix_rate,
             overall_score,
             target_completion, target_followup, target_fix, target_overall,
             met_target,
             frozen_by)
          VALUES (?,?,?,?,?,?,?, ?,?,?,?, ?,?, ?,?,?, ?,?,?, ?, ?,?,?,?, ?, ?)
        `).run(
          kpis.agent_name, kpis.agent_id, kpis.department, kpis.line,
          kpis.year, kpis.month, kpis.period_label,
          kpis.tasks_total, kpis.tasks_done, kpis.tasks_overdue, kpis.tasks_urgent,
          kpis.completion_rate, kpis.sla_rate,
          kpis.absents_total, kpis.absents_followed_up, kpis.followup_rate,
          kpis.code_problems_total, kpis.code_problems_resolved, kpis.fix_rate,
          kpis.overall_score,
          kpis.target_completion, kpis.target_followup, kpis.target_fix, kpis.target_overall,
          kpis.met_target,
          frozenBy
        );
        result.created++;
      }
    } catch (e) {
      result.errors.push({ agent: agent.full_name, error: e.message });
    }
  }

  // Apply benchmarks + achievements after all snapshots written
  applyDepartmentBenchmarks(year, month, line);
  applyAchievements(year, month, line);

  saveNow();
  return result;
}

// ─── ENDPOINTS ────────────────────────────────────────────────────────────────

// POST /api/admin/snapshots/freeze
router.post('/freeze', (req, res) => {
  const { year, month, overwrite } = req.body || {};
  const y = parseInt(year, 10), m = parseInt(month, 10);
  if (!y || !m || m < 1 || m > 12) {
    return res.status(400).json({ error: 'Invalid year/month' });
  }
  const line = lineFilter(req) || 'Ahmed Hassan';

  // Conflict check if not overwriting
  if (!overwrite) {
    const existingCount = db.prepare(`
      SELECT COUNT(*) AS c FROM monthly_snapshots
      WHERE line = ? AND year = ? AND month = ?
    `).get(line, y, m);
    if (existingCount?.c > 0) {
      return res.status(409).json({
        error: 'Already frozen',
        existing: existingCount.c,
        message: 'هذا الشهر مجمّد بالفعل. أرسل overwrite=true للاستبدال.',
      });
    }
  }

  try {
    const result = freezeMonth(y, m, line, req.user?.id, !!overwrite);
    return res.json({ year: y, month: m, line, ...result });
  } catch (e) {
    console.error('freeze error', e);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/snapshots/freeze-bulk
// Body: { from: {year, month}, to: {year, month}, overwrite }
router.post('/freeze-bulk', (req, res) => {
  const { from, to, overwrite } = req.body || {};
  if (!from?.year || !from?.month || !to?.year || !to?.month) {
    return res.status(400).json({ error: 'Provide from {year,month} and to {year,month}' });
  }
  const line = lineFilter(req) || 'Ahmed Hassan';

  // Build month list
  const months = [];
  let y = +from.year, m = +from.month;
  const endY = +to.year, endM = +to.month;
  let safety = 0;
  while ((y < endY || (y === endY && m <= endM)) && safety < 60) {
    months.push({ year: y, month: m });
    m++;
    if (m > 12) { m = 1; y++; }
    safety++;
  }
  if (months.length === 0) return res.status(400).json({ error: 'Empty range' });

  const all = [];
  for (const p of months) {
    try {
      // Skip silently if exists and not overwriting
      if (!overwrite) {
        const ex = db.prepare(`SELECT COUNT(*) AS c FROM monthly_snapshots
          WHERE line=? AND year=? AND month=?`).get(line, p.year, p.month);
        if (ex?.c > 0) {
          all.push({ year: p.year, month: p.month, status: 'skipped_exists', existing: ex.c });
          continue;
        }
      }
      const r = freezeMonth(p.year, p.month, line, req.user?.id, !!overwrite);
      all.push({ year: p.year, month: p.month, status: 'ok', ...r });
    } catch (e) {
      all.push({ year: p.year, month: p.month, status: 'error', error: e.message });
    }
  }
  return res.json({ line, months: all });
});

// GET /api/admin/snapshots/list
// All frozen months grouped by year/month + count of agents.
router.get('/list', (req, res) => {
  const line = lineFilter(req);
  const params = [];
  let where = 'WHERE 1=1';
  if (line) { where += ' AND line = ?'; params.push(line); }
  const rows = db.prepare(`
    SELECT year, month, period_label, COUNT(*) AS agents,
           MIN(frozen_at) AS first_frozen,
           MAX(frozen_at) AS last_frozen
    FROM monthly_snapshots
    ${where}
    GROUP BY year, month
    ORDER BY year DESC, month DESC
  `).all(...params);
  return res.json(rows);
});

// GET /api/admin/snapshots/history
// Query: agent (optional), department (optional), from_year, from_month, to_year, to_month, kpi
// Returns array of rows for chart.
router.get('/history', (req, res) => {
  const { agent, department, from_year, from_month, to_year, to_month } = req.query;
  const line = lineFilter(req);
  const params = [];
  let where = 'WHERE 1=1';
  if (line) { where += ' AND line = ?'; params.push(line); }
  if (agent) {
    where += ' AND LOWER(TRIM(agent_name)) = LOWER(TRIM(?))';
    params.push(agent);
  }
  if (department && department !== 'All') {
    where += ' AND department = ?';
    params.push(department);
  }
  if (from_year && from_month) {
    where += ' AND (year > ? OR (year = ? AND month >= ?))';
    params.push(+from_year, +from_year, +from_month);
  }
  if (to_year && to_month) {
    where += ' AND (year < ? OR (year = ? AND month <= ?))';
    params.push(+to_year, +to_year, +to_month);
  }
  const rows = db.prepare(`
    SELECT id, agent_name, department, year, month, period_label,
           tasks_total, tasks_done, tasks_overdue, tasks_urgent,
           completion_rate, sla_rate,
           absents_total, absents_followed_up, followup_rate,
           code_problems_total, code_problems_resolved, fix_rate,
           overall_score,
           target_completion, target_followup, target_fix, target_overall,
           met_target,
           dept_avg_completion, dept_avg_followup, dept_avg_fix, dept_avg_overall,
           rank_in_dept, total_in_dept,
           achievements
    FROM monthly_snapshots
    ${where}
    ORDER BY year, month, agent_name COLLATE NOCASE
  `).all(...params);
  // Parse achievements JSON for client convenience
  rows.forEach(r => {
    try { r.achievements = r.achievements ? JSON.parse(r.achievements) : []; }
    catch (_) { r.achievements = []; }
  });
  return res.json(rows);
});

// GET /api/admin/snapshots/leaderboard?year=&month=&department=
router.get('/leaderboard', (req, res) => {
  const y = parseInt(req.query.year, 10);
  const m = parseInt(req.query.month, 10);
  if (!y || !m) return res.status(400).json({ error: 'year and month are required' });
  const line = lineFilter(req);
  const dept = req.query.department;

  const params = [y, m];
  let where = 'WHERE year = ? AND month = ?';
  if (line) { where += ' AND line = ?'; params.push(line); }
  if (dept && dept !== 'All') { where += ' AND department = ?'; params.push(dept); }

  // Top performers (top 3 by overall_score)
  const top = db.prepare(`
    SELECT agent_name, department, overall_score, completion_rate, sla_rate,
           followup_rate, fix_rate, met_target, achievements,
           rank_in_dept, total_in_dept
    FROM monthly_snapshots ${where}
    ORDER BY overall_score DESC, completion_rate DESC LIMIT 3
  `).all(...params);

  // Most improved: compare to previous month
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const improvedParams = [y, m, prevY, prevM];
  let improvedWhere = 'WHERE cur.year = ? AND cur.month = ? AND prev.year = ? AND prev.month = ?';
  if (line) {
    improvedWhere += ' AND cur.line = ? AND prev.line = ?';
    improvedParams.push(line, line);
  }
  if (dept && dept !== 'All') {
    improvedWhere += ' AND cur.department = ?';
    improvedParams.push(dept);
  }
  const improved = db.prepare(`
    SELECT cur.agent_name, cur.department,
           cur.overall_score AS score, prev.overall_score AS prev_score,
           (cur.overall_score - prev.overall_score) AS delta,
           cur.completion_rate, cur.sla_rate, cur.followup_rate, cur.fix_rate,
           cur.achievements
    FROM monthly_snapshots cur
    INNER JOIN monthly_snapshots prev
      ON LOWER(TRIM(cur.agent_name)) = LOWER(TRIM(prev.agent_name))
    ${improvedWhere}
    ORDER BY delta DESC
    LIMIT 3
  `).all(...improvedParams);

  // Needs attention: bottom 3 by overall_score (also filter score < 70)
  const attention = db.prepare(`
    SELECT agent_name, department, overall_score, completion_rate, sla_rate,
           followup_rate, fix_rate, met_target, achievements
    FROM monthly_snapshots ${where}
      AND overall_score < 70
    ORDER BY overall_score ASC LIMIT 3
  `).all(...params);

  // Perfect SLA
  const perfectSla = db.prepare(`
    SELECT agent_name, department, overall_score, sla_rate, achievements
    FROM monthly_snapshots ${where}
      AND sla_rate = 100 AND tasks_total > 0
    ORDER BY overall_score DESC LIMIT 3
  `).all(...params);

  // Target masters (met_target = 1)
  const targetMasters = db.prepare(`
    SELECT agent_name, department, overall_score, met_target, achievements,
           target_completion, target_followup, target_fix, target_overall,
           completion_rate, followup_rate, fix_rate
    FROM monthly_snapshots ${where}
      AND met_target = 1
    ORDER BY overall_score DESC LIMIT 5
  `).all(...params);

  // Hero summary stats
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total_agents,
      AVG(overall_score) AS avg_score,
      SUM(CASE WHEN met_target = 1 THEN 1 ELSE 0 END) AS targets_met
    FROM monthly_snapshots ${where}
  `).get(...params);

  // Previous month avg for "monthly improvement" stat
  const prevSummaryParams = [prevY, prevM];
  let prevSummaryWhere = 'WHERE year = ? AND month = ?';
  if (line) { prevSummaryWhere += ' AND line = ?'; prevSummaryParams.push(line); }
  if (dept && dept !== 'All') { prevSummaryWhere += ' AND department = ?'; prevSummaryParams.push(dept); }
  const prevSummary = db.prepare(`
    SELECT AVG(overall_score) AS avg_score FROM monthly_snapshots ${prevSummaryWhere}
  `).get(...prevSummaryParams);
  const prevAvg = clampPct(prevSummary?.avg_score || 0);

  // Parse achievements JSON for all rows
  [top, improved, attention, perfectSla, targetMasters].forEach(arr => {
    arr.forEach(r => {
      try { r.achievements = r.achievements ? JSON.parse(r.achievements) : []; }
      catch (_) { r.achievements = []; }
    });
  });

  return res.json({
    period: { year: y, month: m, label: `${y}-${pad2(m)}`, name_ar: MONTH_NAMES_AR[m] },
    summary: {
      total_agents: summary?.total_agents || 0,
      avg_score: clampPct(summary?.avg_score || 0),
      targets_met: summary?.targets_met || 0,
      prev_avg_score: prevAvg,
      month_delta: Math.round((summary?.avg_score || 0) - prevAvg),
    },
    top, improved, attention, perfectSla, targetMasters,
  });
});

// GET /api/admin/snapshots/heatmap?from_year=&from_month=&to_year=&to_month=&kpi=
router.get('/heatmap', (req, res) => {
  const { from_year, from_month, to_year, to_month, department } = req.query;
  const kpi = ['completion_rate','sla_rate','followup_rate','fix_rate','overall_score']
    .includes(req.query.kpi) ? req.query.kpi : 'overall_score';
  const line = lineFilter(req);

  const params = [];
  let where = 'WHERE 1=1';
  if (line) { where += ' AND line = ?'; params.push(line); }
  if (department && department !== 'All') { where += ' AND department = ?'; params.push(department); }
  if (from_year && from_month) {
    where += ' AND (year > ? OR (year = ? AND month >= ?))';
    params.push(+from_year, +from_year, +from_month);
  }
  if (to_year && to_month) {
    where += ' AND (year < ? OR (year = ? AND month <= ?))';
    params.push(+to_year, +to_year, +to_month);
  }

  const rows = db.prepare(`
    SELECT id, agent_name, department, year, month, period_label,
           ${kpi} AS value,
           overall_score, completion_rate, sla_rate, followup_rate, fix_rate,
           target_completion, target_followup, target_fix, target_overall, met_target,
           rank_in_dept, total_in_dept,
           (SELECT COUNT(*) FROM snapshot_notes WHERE snapshot_id = monthly_snapshots.id) AS notes_count
    FROM monthly_snapshots
    ${where}
    ORDER BY agent_name COLLATE NOCASE, year, month
  `).all(...params);

  // Group into pivot: { agent_name -> { period_label -> row } }, plus list of distinct periods
  const periods = [];
  const periodSet = new Set();
  const matrix = {};
  for (const r of rows) {
    if (!periodSet.has(r.period_label)) {
      periodSet.add(r.period_label);
      periods.push({ year: r.year, month: r.month, label: r.period_label, name_ar: MONTH_NAMES_AR[r.month] });
    }
    if (!matrix[r.agent_name]) {
      matrix[r.agent_name] = { agent_name: r.agent_name, department: r.department, cells: {}, avg: 0, trend: 0 };
    }
    matrix[r.agent_name].cells[r.period_label] = r;
  }
  // Sort periods by year, month
  periods.sort((a, b) => a.year - b.year || a.month - b.month);

  // Compute avg + trend per agent
  const agents = Object.values(matrix);
  agents.forEach(a => {
    const vals = periods.map(p => a.cells[p.label]?.value).filter(v => v != null);
    if (vals.length > 0) {
      a.avg = clampPct(vals.reduce((s, v) => s + v, 0) / vals.length);
      a.trend = vals.length > 1 ? (vals[vals.length - 1] - vals[0]) : 0;
    }
  });
  // Sort: by avg desc
  agents.sort((a, b) => b.avg - a.avg);

  return res.json({ kpi, periods, agents });
});

// GET /api/admin/snapshots/employee/:name?year=
// All snapshots for one agent, plus achievements rollup
router.get('/employee/:name', (req, res) => {
  const name = req.params.name;
  const line = lineFilter(req);
  const params = [name];
  let where = 'WHERE LOWER(TRIM(agent_name)) = LOWER(TRIM(?))';
  if (line) { where += ' AND line = ?'; params.push(line); }
  if (req.query.year) {
    where += ' AND year = ?';
    params.push(+req.query.year);
  }
  const rows = db.prepare(`
    SELECT *, (SELECT COUNT(*) FROM snapshot_notes WHERE snapshot_id = monthly_snapshots.id) AS notes_count
    FROM monthly_snapshots ${where}
    ORDER BY year DESC, month DESC
  `).all(...params);
  rows.forEach(r => {
    try { r.achievements = r.achievements ? JSON.parse(r.achievements) : []; }
    catch (_) { r.achievements = []; }
  });
  return res.json(rows);
});

// DELETE /api/admin/snapshots/:year/:month
// Numeric-only constraint prevents this from swallowing /notes/:noteId.
router.delete('/:year(\\d{4})/:month(\\d{1,2})', (req, res) => {
  const y = parseInt(req.params.year, 10), m = parseInt(req.params.month, 10);
  if (!y || !m) return res.status(400).json({ error: 'Invalid year/month' });
  const line = lineFilter(req);
  const params = [y, m];
  let where = 'WHERE year = ? AND month = ?';
  if (line) { where += ' AND line = ?'; params.push(line); }
  const before = db.prepare(`SELECT COUNT(*) AS c FROM monthly_snapshots ${where}`).get(...params);
  db.prepare(`DELETE FROM monthly_snapshots ${where}`).run(...params);
  saveNow();
  return res.json({ deleted: before?.c || 0, year: y, month: m });
});

// ─── NOTES (annotations on a snapshot) ────────────────────────────────────────

// GET /api/admin/snapshots/:id/notes
router.get('/:id/notes', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid snapshot id' });
  const rows = db.prepare(`
    SELECT n.id, n.snapshot_id, n.note, n.created_at, n.updated_at,
           u.full_name AS created_by_name, n.created_by
    FROM snapshot_notes n
    LEFT JOIN users u ON u.id = n.created_by
    WHERE n.snapshot_id = ?
    ORDER BY n.created_at DESC
  `).all(id);
  return res.json(rows);
});

// POST /api/admin/snapshots/:id/notes
router.post('/:id/notes', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { note } = req.body || {};
  if (!id || !note || !note.trim()) {
    return res.status(400).json({ error: 'Snapshot id and non-empty note are required' });
  }
  // Verify snapshot exists
  const snap = db.prepare(`SELECT id FROM monthly_snapshots WHERE id = ?`).get(id);
  if (!snap) return res.status(404).json({ error: 'Snapshot not found' });

  const r = db.prepare(`
    INSERT INTO snapshot_notes (snapshot_id, note, created_by)
    VALUES (?, ?, ?)
  `).run(id, note.trim(), req.user?.id);
  saveNow();
  return res.json({ id: r.lastInsertRowid, snapshot_id: id });
});

// PUT /api/admin/snapshots/notes/:noteId
router.put('/notes/:noteId', (req, res) => {
  const noteId = parseInt(req.params.noteId, 10);
  const { note } = req.body || {};
  if (!noteId || !note || !note.trim()) {
    return res.status(400).json({ error: 'Note id and non-empty body required' });
  }
  const r = db.prepare(`
    UPDATE snapshot_notes SET note = ?, updated_at = datetime('now', '+2 hours')
    WHERE id = ?
  `).run(note.trim(), noteId);
  saveNow();
  if (r.changes === 0) return res.status(404).json({ error: 'Note not found' });
  return res.json({ id: noteId });
});

// DELETE /api/admin/snapshots/notes/:noteId
router.delete('/notes/:noteId', (req, res) => {
  const noteId = parseInt(req.params.noteId, 10);
  if (!noteId) return res.status(400).json({ error: 'Invalid note id' });
  const r = db.prepare(`DELETE FROM snapshot_notes WHERE id = ?`).run(noteId);
  saveNow();
  if (r.changes === 0) return res.status(404).json({ error: 'Note not found' });
  return res.json({ deleted: 1 });
});

module.exports = router;
