'use strict';
const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { lineFilter } = require('../utils/lineFilter');
const { nameInListInline } = require('../utils/nameMatch');

const router = express.Router();
// Read endpoints need at least leader (so the team-progression page works).
// Write/destructive endpoints are gated with `requireRole('admin')` per-route.
router.use(authenticate, requireRole('leader'));
const adminOnly = requireRole('admin');

// For leader: scope every read query to their own department automatically,
// regardless of what the client passed in `?department=`. Admins see everything.
function leaderScopedDept(req) {
  if (req.user?.role === 'leader' && req.user?.department && req.user.department !== 'All') {
    return req.user.department;
  }
  return null; // null = trust client's ?department= param
}

// Notification helper — fail-soft
function createNotification(userId, type, title, body, link = null, meta = null) {
  if (!userId) return;
  try {
    db.prepare(`INSERT INTO notifications (user_id, type, title, body, link, meta)
                VALUES (?, ?, ?, ?, ?, ?)`).run(
      userId, type, title, body || null, link || null,
      meta ? (typeof meta === 'string' ? meta : JSON.stringify(meta)) : null
    );
  } catch (e) { console.error('notify error:', e.message); }
}

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

// Compute overall using current admin-configured weights
// (falls back to 50/25/25/0 if the weights row is missing).
function getKpiWeights() {
  try {
    const row = db.prepare(`SELECT weight_completion, weight_followup, weight_fix, weight_sla FROM kpi_weights WHERE id = 1`).get();
    if (row) return row;
  } catch (_) {}
  return { weight_completion: 50, weight_followup: 25, weight_fix: 25, weight_sla: 0 };
}

function computeOverall(completion, followup, fix, sla = 0) {
  const w = getKpiWeights();
  const sum = (w.weight_completion || 0) + (w.weight_followup || 0) + (w.weight_fix || 0) + (w.weight_sla || 0);
  if (sum <= 0) return clampPct(completion * 0.5 + followup * 0.25 + fix * 0.25);
  // Normalize so weights always sum to 100 in effect
  return clampPct(
    (completion * (w.weight_completion || 0) +
     followup   * (w.weight_followup   || 0) +
     fix        * (w.weight_fix        || 0) +
     sla        * (w.weight_sla        || 0)) / sum
  );
}

// Audit log helper — fail-soft (never break the parent operation)
function logAudit({ action, year = null, month = null, agent_name = null, details = null, user_id = null, user_name = null, line = 'Ahmed Hassan' }) {
  try {
    db.prepare(`INSERT INTO snapshot_audit_log
      (action, year, month, agent_name, details, user_id, user_name, line)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      action, year, month, agent_name,
      details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
      user_id, user_name, line
    );
  } catch (e) {
    console.error('audit log error:', e.message);
  }
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

  const overall_score = computeOverall(completion_rate, followup_rate, fix_rate, sla_rate);

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

  // Send in-app notifications to each agent whose snapshot was created/updated
  try {
    const periodLabel = `${MONTH_NAMES_AR[month] || month} ${year}`;
    const agentRows = db.prepare(`
      SELECT ms.agent_name, ms.overall_score, ms.met_target, ms.achievements, ms.agent_id
      FROM monthly_snapshots ms
      WHERE ms.line = ? AND ms.year = ? AND ms.month = ?
    `).all(line, year, month);
    for (const a of agentRows) {
      if (!a.agent_id) continue;
      let achievementsCount = 0;
      try { achievementsCount = (JSON.parse(a.achievements || '[]') || []).length; } catch (_) {}
      const body = a.met_target === 1
        ? `🎉 رائع! حقّقت كل الأهداف هذا الشهر بأداء ${a.overall_score}%`
        : `أداء الشهر: ${a.overall_score}% — اطّلع على التفاصيل في صفحة "تطوّري"`;
      createNotification(
        a.agent_id,
        'snapshot_frozen',
        `📊 تم تجميد نتائج ${periodLabel}`,
        achievementsCount > 0 ? `${body} · حصلت على ${achievementsCount} إنجاز جديد` : body,
        '/agent/my-progression',
        { year, month, score: a.overall_score, met_target: a.met_target }
      );
    }
  } catch (e) { console.error('notify-on-freeze error:', e.message); }

  saveNow();
  return result;
}

// ─── ENDPOINTS ────────────────────────────────────────────────────────────────

// POST /api/admin/snapshots/freeze
router.post('/freeze', adminOnly, (req, res) => {
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
    logAudit({
      action: overwrite ? 'overwrite' : 'freeze',
      year: y, month: m,
      details: { created: result.created, updated: result.updated, skipped: result.skipped },
      user_id: req.user?.id, user_name: req.user?.full_name, line,
    });
    return res.json({ year: y, month: m, line, ...result });
  } catch (e) {
    console.error('freeze error', e);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/snapshots/freeze-bulk
// Body: { from: {year, month}, to: {year, month}, overwrite }
router.post('/freeze-bulk', adminOnly, (req, res) => {
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
  logAudit({
    action: 'freeze_bulk',
    details: { from, to, overwrite: !!overwrite, results: all.map(a => ({ y: a.year, m: a.month, status: a.status, created: a.created, updated: a.updated })) },
    user_id: req.user?.id, user_name: req.user?.full_name, line,
  });
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
  const { agent, from_year, from_month, to_year, to_month } = req.query;
  // Leaders are auto-scoped to their own dept regardless of ?department=
  const department = leaderScopedDept(req) || req.query.department;
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
  // Leader auto-scoped to own dept
  const dept = leaderScopedDept(req) || req.query.department;

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
  const { from_year, from_month, to_year, to_month } = req.query;
  // Leader auto-scoped to own dept
  const department = leaderScopedDept(req) || req.query.department;
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
  // Leaders may only view agents inside their own department
  const leaderDept = leaderScopedDept(req);
  if (leaderDept) { where += ' AND department = ?'; params.push(leaderDept); }
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
router.delete('/:year(\\d{4})/:month(\\d{1,2})', adminOnly, (req, res) => {
  const y = parseInt(req.params.year, 10), m = parseInt(req.params.month, 10);
  if (!y || !m) return res.status(400).json({ error: 'Invalid year/month' });
  const line = lineFilter(req);
  const params = [y, m];
  let where = 'WHERE year = ? AND month = ?';
  if (line) { where += ' AND line = ?'; params.push(line); }
  const before = db.prepare(`SELECT COUNT(*) AS c FROM monthly_snapshots ${where}`).get(...params);
  db.prepare(`DELETE FROM monthly_snapshots ${where}`).run(...params);
  saveNow();
  logAudit({
    action: 'delete', year: y, month: m,
    details: { deleted: before?.c || 0 },
    user_id: req.user?.id, user_name: req.user?.full_name, line: line || 'Ahmed Hassan',
  });
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
router.post('/:id/notes', adminOnly, (req, res) => {
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
  // Audit
  const meta = db.prepare(`SELECT year, month, agent_name, line FROM monthly_snapshots WHERE id = ?`).get(id);
  logAudit({
    action: 'note_add',
    year: meta?.year, month: meta?.month, agent_name: meta?.agent_name,
    details: { snapshot_id: id, note_id: r.lastInsertRowid, preview: note.trim().slice(0, 80) },
    user_id: req.user?.id, user_name: req.user?.full_name, line: meta?.line || 'Ahmed Hassan',
  });
  return res.json({ id: r.lastInsertRowid, snapshot_id: id });
});

// PUT /api/admin/snapshots/notes/:noteId
router.put('/notes/:noteId', adminOnly, (req, res) => {
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
  // Audit
  const meta = db.prepare(`
    SELECT ms.year, ms.month, ms.agent_name, ms.line, sn.snapshot_id
    FROM snapshot_notes sn
    LEFT JOIN monthly_snapshots ms ON ms.id = sn.snapshot_id
    WHERE sn.id = ?
  `).get(noteId);
  logAudit({
    action: 'note_edit',
    year: meta?.year, month: meta?.month, agent_name: meta?.agent_name,
    details: { snapshot_id: meta?.snapshot_id, note_id: noteId, preview: note.trim().slice(0, 80) },
    user_id: req.user?.id, user_name: req.user?.full_name, line: meta?.line || 'Ahmed Hassan',
  });
  return res.json({ id: noteId });
});

// DELETE /api/admin/snapshots/notes/:noteId
router.delete('/notes/:noteId', adminOnly, (req, res) => {
  const noteId = parseInt(req.params.noteId, 10);
  if (!noteId) return res.status(400).json({ error: 'Invalid note id' });
  // Get metadata before deletion (for audit log)
  const meta = db.prepare(`
    SELECT ms.year, ms.month, ms.agent_name, ms.line, sn.snapshot_id
    FROM snapshot_notes sn
    LEFT JOIN monthly_snapshots ms ON ms.id = sn.snapshot_id
    WHERE sn.id = ?
  `).get(noteId);
  const r = db.prepare(`DELETE FROM snapshot_notes WHERE id = ?`).run(noteId);
  saveNow();
  if (r.changes === 0) return res.status(404).json({ error: 'Note not found' });
  logAudit({
    action: 'note_delete',
    year: meta?.year, month: meta?.month, agent_name: meta?.agent_name,
    details: { snapshot_id: meta?.snapshot_id, note_id: noteId },
    user_id: req.user?.id, user_name: req.user?.full_name, line: meta?.line || 'Ahmed Hassan',
  });
  return res.json({ deleted: 1 });
});

// ─── KPI WEIGHTS ──────────────────────────────────────────────────────────────

// GET /api/admin/snapshots/weights
router.get('/weights', (req, res) => {
  const w = getKpiWeights();
  return res.json(w);
});

// PUT /api/admin/snapshots/weights
router.put('/weights', adminOnly, (req, res) => {
  const wc = parseInt(req.body?.weight_completion, 10);
  const wf = parseInt(req.body?.weight_followup,   10);
  const wx = parseInt(req.body?.weight_fix,        10);
  const ws = parseInt(req.body?.weight_sla,        10);
  if ([wc, wf, wx, ws].some(v => !Number.isFinite(v) || v < 0 || v > 100)) {
    return res.status(400).json({ error: 'كل الأوزان لازم تكون بين 0 و 100' });
  }
  if ((wc + wf + wx + ws) === 0) {
    return res.status(400).json({ error: 'يجب أن يكون مجموع الأوزان أكبر من صفر' });
  }
  const before = getKpiWeights();
  db.prepare(`
    UPDATE kpi_weights
    SET weight_completion=?, weight_followup=?, weight_fix=?, weight_sla=?,
        updated_by=?, updated_at=datetime('now','+2 hours')
    WHERE id=1
  `).run(wc, wf, wx, ws, req.user?.id);
  saveNow();
  logAudit({
    action: 'weights_change',
    details: { before, after: { weight_completion: wc, weight_followup: wf, weight_fix: wx, weight_sla: ws } },
    user_id: req.user?.id, user_name: req.user?.full_name,
    line: lineFilter(req) || 'Ahmed Hassan',
  });
  return res.json(getKpiWeights());
});

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────

// GET /api/admin/snapshots/audit?action=&from=&to=&user_id=&limit=
router.get('/audit', adminOnly, (req, res) => {
  const { action, from, to, user_id } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const offset = parseInt(req.query.offset, 10) || 0;
  const line = lineFilter(req);

  const params = [];
  let where = 'WHERE 1=1';
  if (line) { where += ' AND line = ?'; params.push(line); }
  if (action)  { where += ' AND action = ?'; params.push(action); }
  if (user_id) { where += ' AND user_id = ?'; params.push(parseInt(user_id, 10)); }
  if (from) { where += ' AND created_at >= ?'; params.push(from); }
  if (to)   { where += ' AND created_at <= ?'; params.push(to); }

  const rows = db.prepare(`
    SELECT id, action, year, month, agent_name, details,
           user_id, user_name, line, created_at
    FROM snapshot_audit_log
    ${where}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  rows.forEach(r => {
    try { r.details = r.details ? JSON.parse(r.details) : null; }
    catch (_) {}
  });

  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM snapshot_audit_log ${where}`).get(...params);

  return res.json({ total: totalRow?.c || 0, rows, limit, offset });
});

// ─── DEPARTMENT ROLLUP ────────────────────────────────────────────────────────
// GET /api/admin/snapshots/dept-rollup?from_year=&from_month=&to_year=&to_month=
// Aggregates monthly snapshots into per-department averages by month.
router.get('/dept-rollup', (req, res) => {
  const { from_year, from_month, to_year, to_month } = req.query;
  const line = lineFilter(req);
  const leaderDept = leaderScopedDept(req);

  const params = [];
  let where = 'WHERE 1=1';
  if (line) { where += ' AND line = ?'; params.push(line); }
  if (leaderDept) { where += ' AND department = ?'; params.push(leaderDept); }
  if (from_year && from_month) {
    where += ' AND (year > ? OR (year = ? AND month >= ?))';
    params.push(+from_year, +from_year, +from_month);
  }
  if (to_year && to_month) {
    where += ' AND (year < ? OR (year = ? AND month <= ?))';
    params.push(+to_year, +to_year, +to_month);
  }

  const rows = db.prepare(`
    SELECT department, year, month, period_label,
           COUNT(*) AS agents,
           ROUND(AVG(completion_rate)) AS avg_completion,
           ROUND(AVG(sla_rate))        AS avg_sla,
           ROUND(AVG(followup_rate))   AS avg_followup,
           ROUND(AVG(fix_rate))        AS avg_fix,
           ROUND(AVG(overall_score))   AS avg_overall,
           SUM(tasks_total)            AS total_tasks,
           SUM(tasks_done)             AS total_done,
           SUM(tasks_overdue)          AS total_overdue,
           SUM(absents_total)          AS total_absents,
           SUM(absents_followed_up)    AS total_followed,
           SUM(code_problems_total)    AS total_code_problems,
           SUM(code_problems_resolved) AS total_code_resolved,
           SUM(CASE WHEN met_target = 1 THEN 1 ELSE 0 END) AS targets_met
    FROM monthly_snapshots
    ${where}
    GROUP BY department, year, month
    ORDER BY year, month, department
  `).all(...params);

  // Pivot for the chart: { period_label, [dept]: avg_overall, ... }
  const periodSet = new Set();
  const periods = [];
  const deptNames = new Set();
  const matrix = {};
  for (const r of rows) {
    if (!periodSet.has(r.period_label)) {
      periodSet.add(r.period_label);
      periods.push({ year: r.year, month: r.month, label: r.period_label });
    }
    deptNames.add(r.department);
    matrix[r.department] = matrix[r.department] || { department: r.department, cells: {}, avg_overall: 0, total_agents: 0 };
    matrix[r.department].cells[r.period_label] = r;
  }
  periods.sort((a, b) => a.year - b.year || a.month - b.month);

  // Compute per-dept aggregate
  const departments = Object.values(matrix);
  departments.forEach(d => {
    const cells = Object.values(d.cells);
    if (cells.length > 0) {
      d.avg_overall  = Math.round(cells.reduce((s, c) => s + (c.avg_overall || 0), 0) / cells.length);
      d.total_agents = Math.max(...cells.map(c => c.agents || 0));
    }
  });
  departments.sort((a, b) => b.avg_overall - a.avg_overall);

  return res.json({ periods, departments, rows });
});

// ─── COMPARE TWO MONTHS ───────────────────────────────────────────────────────
// GET /api/admin/snapshots/compare?a_year=&a_month=&b_year=&b_month=&department=
router.get('/compare', (req, res) => {
  const { a_year, a_month, b_year, b_month } = req.query;
  // Leader auto-scoped to own dept
  const department = leaderScopedDept(req) || req.query.department;
  const ay = parseInt(a_year, 10), am = parseInt(a_month, 10);
  const by = parseInt(b_year, 10), bm = parseInt(b_month, 10);
  if (!ay || !am || !by || !bm) {
    return res.status(400).json({ error: 'a_year, a_month, b_year, b_month all required' });
  }
  const line = lineFilter(req);
  const lineCl = line ? ' AND line = ?' : '';
  const lineP  = line ? [line] : [];
  const deptCl = (department && department !== 'All') ? ' AND department = ?' : '';
  const deptP  = (department && department !== 'All') ? [department] : [];

  const aRows = db.prepare(`
    SELECT * FROM monthly_snapshots
    WHERE year = ? AND month = ?${lineCl}${deptCl}
    ORDER BY agent_name COLLATE NOCASE
  `).all(ay, am, ...lineP, ...deptP);

  const bRows = db.prepare(`
    SELECT * FROM monthly_snapshots
    WHERE year = ? AND month = ?${lineCl}${deptCl}
    ORDER BY agent_name COLLATE NOCASE
  `).all(by, bm, ...lineP, ...deptP);

  const byNameA = Object.fromEntries(aRows.map(r => [r.agent_name.toLowerCase().trim(), r]));
  const byNameB = Object.fromEntries(bRows.map(r => [r.agent_name.toLowerCase().trim(), r]));
  const allNames = new Set([...Object.keys(byNameA), ...Object.keys(byNameB)]);

  const compare = [];
  for (const key of allNames) {
    const a = byNameA[key];
    const b = byNameB[key];
    const display = a?.agent_name || b?.agent_name;
    compare.push({
      agent_name: display,
      department: a?.department || b?.department,
      a: a ? {
        overall: a.overall_score, completion: a.completion_rate, sla: a.sla_rate,
        followup: a.followup_rate, fix: a.fix_rate, met_target: a.met_target,
      } : null,
      b: b ? {
        overall: b.overall_score, completion: b.completion_rate, sla: b.sla_rate,
        followup: b.followup_rate, fix: b.fix_rate, met_target: b.met_target,
      } : null,
      delta_overall: (a && b) ? (b.overall_score - a.overall_score) : null,
    });
  }
  // Sort by delta desc (improvers first)
  compare.sort((x, y) => {
    const dx = x.delta_overall ?? -999;
    const dy = y.delta_overall ?? -999;
    return dy - dx;
  });

  // Aggregate stats
  const validDeltas = compare.filter(c => c.delta_overall != null);
  const improved = validDeltas.filter(c => c.delta_overall > 0);
  const declined = validDeltas.filter(c => c.delta_overall < 0);
  const stable   = validDeltas.filter(c => c.delta_overall === 0);
  const onlyA    = compare.filter(c => c.a && !c.b);
  const onlyB    = compare.filter(c => !c.a && c.b);

  const avgA = aRows.length > 0 ? Math.round(aRows.reduce((s, r) => s + (r.overall_score || 0), 0) / aRows.length) : 0;
  const avgB = bRows.length > 0 ? Math.round(bRows.reduce((s, r) => s + (r.overall_score || 0), 0) / bRows.length) : 0;

  return res.json({
    a: { year: ay, month: am, agents: aRows.length, avg_overall: avgA },
    b: { year: by, month: bm, agents: bRows.length, avg_overall: avgB },
    delta_avg: avgB - avgA,
    summary: {
      improved: improved.length,
      declined: declined.length,
      stable:   stable.length,
      only_in_a: onlyA.length,
      only_in_b: onlyB.length,
    },
    rows: compare,
  });
});

// ─── EXCEL EXPORT ─────────────────────────────────────────────────────────────
// GET /api/admin/snapshots/export-excel?year=&month=&department=
// Multi-sheet Excel: Summary, by Department, Achievements
router.get('/export-excel', adminOnly, async (req, res) => {
  const y = parseInt(req.query.year, 10);
  const m = parseInt(req.query.month, 10);
  const department = req.query.department;
  if (!y || !m) return res.status(400).json({ error: 'year and month are required' });
  const line = lineFilter(req);

  const params = [y, m];
  let where = 'WHERE year = ? AND month = ?';
  if (line) { where += ' AND line = ?'; params.push(line); }
  if (department && department !== 'All') { where += ' AND department = ?'; params.push(department); }

  const rows = db.prepare(`
    SELECT * FROM monthly_snapshots ${where}
    ORDER BY department, overall_score DESC
  `).all(...params);

  if (rows.length === 0) return res.status(404).json({ error: 'No data for this period' });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Academy System';
  wb.created = new Date();

  // ── Sheet 1: Summary (all agents) ──
  const sumSheet = wb.addWorksheet('الملخّص', { views: [{ rightToLeft: true }] });
  sumSheet.columns = [
    { header: 'الموظف',         key: 'agent_name', width: 24 },
    { header: 'القسم',           key: 'department', width: 12 },
    { header: 'إجمالي المهام',  key: 'tasks_total', width: 14 },
    { header: 'مكتملة',          key: 'tasks_done', width: 12 },
    { header: 'متأخرة',          key: 'tasks_overdue', width: 12 },
    { header: 'الإنجاز %',       key: 'completion_rate', width: 12 },
    { header: 'SLA %',           key: 'sla_rate', width: 10 },
    { header: 'متابعة الغياب %', key: 'followup_rate', width: 16 },
    { header: 'حل الأعطال %',   key: 'fix_rate', width: 14 },
    { header: 'الأداء العام %',  key: 'overall_score', width: 14 },
    { header: 'حقّق الأهداف',    key: 'met_target', width: 14 },
    { header: 'المركز',          key: 'rank_in_dept', width: 10 },
    { header: 'الإنجازات',       key: 'achievements', width: 30 },
  ];
  rows.forEach(r => {
    let badges = [];
    try { badges = JSON.parse(r.achievements || '[]'); } catch (_) {}
    sumSheet.addRow({
      ...r,
      met_target: r.met_target === 1 ? 'نعم' : 'لا',
      rank_in_dept: r.rank_in_dept ? `${r.rank_in_dept}/${r.total_in_dept}` : '—',
      achievements: badges.join(', '),
    });
  });
  sumSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sumSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  sumSheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
  sumSheet.getRow(1).height = 26;

  // ── Sheet 2: By Department (averages) ──
  const deptSheet = wb.addWorksheet('حسب القسم', { views: [{ rightToLeft: true }] });
  deptSheet.columns = [
    { header: 'القسم',                key: 'department', width: 14 },
    { header: 'عدد الموظفين',         key: 'agents', width: 14 },
    { header: 'متوسط الإنجاز %',      key: 'avg_completion', width: 16 },
    { header: 'متوسط SLA %',          key: 'avg_sla', width: 14 },
    { header: 'متوسط متابعة الغياب %',key: 'avg_followup', width: 18 },
    { header: 'متوسط حل الأعطال %',  key: 'avg_fix', width: 18 },
    { header: 'متوسط الأداء %',       key: 'avg_overall', width: 14 },
    { header: 'حقّقوا الأهداف',       key: 'targets_met', width: 14 },
  ];
  const deptAgg = db.prepare(`
    SELECT department, COUNT(*) AS agents,
           ROUND(AVG(completion_rate)) AS avg_completion,
           ROUND(AVG(sla_rate))        AS avg_sla,
           ROUND(AVG(followup_rate))   AS avg_followup,
           ROUND(AVG(fix_rate))        AS avg_fix,
           ROUND(AVG(overall_score))   AS avg_overall,
           SUM(CASE WHEN met_target = 1 THEN 1 ELSE 0 END) AS targets_met
    FROM monthly_snapshots ${where}
    GROUP BY department
    ORDER BY avg_overall DESC
  `).all(...params);
  deptAgg.forEach(r => deptSheet.addRow(r));
  deptSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  deptSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  deptSheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
  deptSheet.getRow(1).height = 26;

  // ── Sheet 3: Achievements ──
  const achSheet = wb.addWorksheet('الإنجازات', { views: [{ rightToLeft: true }] });
  achSheet.columns = [
    { header: 'الموظف',  key: 'agent', width: 24 },
    { header: 'القسم',    key: 'dept', width: 14 },
    { header: 'الإنجاز',  key: 'badge', width: 24 },
  ];
  const BADGE_LABELS = {
    top_performer: '🥇 بطل القسم', top_3_performer: '🥈 ضمن أعلى 3',
    rising_star: '🚀 النجم الصاعد', streak_3: '🔥 3 شهور متتالية',
    streak_6: '🔥🔥 6 شهور متتالية', perfect_sla: '💎 التزام مثالي',
    perfect_completion: '🎯 إنجاز كامل', consistent: '🛡️ الثابت',
    target_master: '🏆 محقق الأهداف', excellence: '🎓 تميّز',
  };
  rows.forEach(r => {
    let badges = [];
    try { badges = JSON.parse(r.achievements || '[]'); } catch (_) {}
    badges.forEach(b => {
      achSheet.addRow({ agent: r.agent_name, dept: r.department, badge: BADGE_LABELS[b] || b });
    });
  });
  achSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  achSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="snapshots-${y}-${pad2(m)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ─── YoY (Year-over-Year) ─────────────────────────────────────────────────────
// GET /api/admin/snapshots/yoy/:agent_name?year=&month=
// Returns the same agent's snapshot from one year ago alongside the current one.
router.get('/yoy/:agentName', (req, res) => {
  const agent = req.params.agentName;
  const y = parseInt(req.query.year, 10);
  const m = parseInt(req.query.month, 10);
  if (!agent || !y || !m) return res.status(400).json({ error: 'agent, year, month required' });
  const line = lineFilter(req);
  const lineCl = line ? ' AND line = ?' : '';
  const lineP  = line ? [line] : [];
  // Leaders can only see agents in their own department
  const leaderDept = leaderScopedDept(req);
  const deptCl = leaderDept ? ' AND department = ?' : '';
  const deptP  = leaderDept ? [leaderDept] : [];

  const current = db.prepare(`
    SELECT overall_score, completion_rate, sla_rate, followup_rate, fix_rate
    FROM monthly_snapshots
    WHERE LOWER(TRIM(agent_name)) = LOWER(TRIM(?))
      AND year = ? AND month = ?${lineCl}${deptCl}
  `).get(agent, y, m, ...lineP, ...deptP);

  const prev = db.prepare(`
    SELECT overall_score, completion_rate, sla_rate, followup_rate, fix_rate
    FROM monthly_snapshots
    WHERE LOWER(TRIM(agent_name)) = LOWER(TRIM(?))
      AND year = ? AND month = ?${lineCl}${deptCl}
  `).get(agent, y - 1, m, ...lineP, ...deptP);

  if (!current && !prev) return res.json({ current: null, prev: null, delta: null });

  const delta = (current && prev) ? {
    overall:    current.overall_score    - prev.overall_score,
    completion: current.completion_rate  - prev.completion_rate,
    sla:        current.sla_rate          - prev.sla_rate,
    followup:   current.followup_rate     - prev.followup_rate,
    fix:        current.fix_rate          - prev.fix_rate,
  } : null;

  return res.json({ year: y, month: m, agent, current, prev, delta });
});

// ─── AUDIT LOG CSV EXPORT ─────────────────────────────────────────────────────
// GET /api/admin/snapshots/audit/export
router.get('/audit/export', adminOnly, (req, res) => {
  const { action, from, to } = req.query;
  const line = lineFilter(req);

  const params = [];
  let where = 'WHERE 1=1';
  if (line)   { where += ' AND line = ?'; params.push(line); }
  if (action) { where += ' AND action = ?'; params.push(action); }
  if (from)   { where += ' AND created_at >= ?'; params.push(from); }
  if (to)     { where += ' AND created_at <= ?'; params.push(to); }

  const rows = db.prepare(`
    SELECT id, action, year, month, agent_name, details, user_name, line, created_at
    FROM snapshot_audit_log ${where}
    ORDER BY id DESC LIMIT 5000
  `).all(...params);

  const headers = ['ID', 'العملية', 'السنة', 'الشهر', 'الموظف', 'التفاصيل', 'المستخدم', 'الخط', 'الوقت'];
  const csv = [headers.join(',')];
  for (const r of rows) {
    const row = [
      r.id,
      r.action,
      r.year || '',
      r.month || '',
      `"${(r.agent_name || '').replace(/"/g, '""')}"`,
      `"${(r.details || '').replace(/"/g, '""').replace(/\n/g, ' ').slice(0, 500)}"`,
      `"${(r.user_name || '').replace(/"/g, '""')}"`,
      r.line,
      r.created_at,
    ];
    csv.push(row.join(','));
  }
  const ts = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv;charset=utf-8;');
  res.setHeader('Content-Disposition', `attachment; filename="audit-log-${ts}.csv"`);
  res.send('﻿' + csv.join('\n'));
});

// ─── AUTO-FREEZE TRIGGER ──────────────────────────────────────────────────────
// Helper exposed for the cron job. Internal — same as POST /freeze with overwrite=true.
function autoFreezeMonth(year, month, line, userName = 'System (Auto)') {
  const result = freezeMonth(year, month, line, null, true);
  logAudit({
    action: 'freeze',
    year, month,
    details: { ...result, source: 'auto_cron' },
    user_id: null, user_name: userName, line,
  });
  return result;
}
// Expose for cron + manual trigger from app.js
router.autoFreezeMonth = autoFreezeMonth;

// POST /api/admin/snapshots/auto-freeze-now — manually trigger the cron job's logic
router.post('/auto-freeze-now', adminOnly, (req, res) => {
  // Most useful for testing. Freezes the previous calendar month for current line.
  const today = new Date();
  // Auto-freeze runs at month start, so target = previous month
  let y = today.getFullYear(), m = today.getMonth(); // (last month: 1-12 of previous if Jan)
  if (m === 0) { m = 12; y -= 1; }
  const line = lineFilter(req) || 'Ahmed Hassan';
  try {
    const result = autoFreezeMonth(y, m, line, req.user?.full_name || 'Admin (Manual)');
    return res.json({ year: y, month: m, line, ...result });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
