'use strict';
const express = require('express');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const adminOnly = requireRole('admin');
const { lineFilter } = require('../utils/lineFilter');
const { nameInListInline } = require('../utils/nameMatch');

const router = express.Router();
router.use(authenticate, requireRole('agent')); // base auth — admin gates per route

// Leaders may only see their own department, regardless of what the client
// passes via ?dept_type=. Admins (and anyone with department='All') are
// trusted to filter freely.
function leaderScopedDept(req) {
  if (req.user?.role === 'leader' && req.user?.department && req.user.department !== 'All') {
    return req.user.department;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// PERIOD HELPERS
// ──────────────────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

// Get start (Monday) + end (Sunday) of ISO week N in year Y, returned as YYYY-MM-DD
function isoWeekRange(year, week) {
  // ISO 8601: Week 1 = week containing the first Thursday of the year
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dayOfWeek = simple.getUTCDay();
  const isoWeekStart = new Date(simple);
  if (dayOfWeek <= 4) {
    isoWeekStart.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
  } else {
    isoWeekStart.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay());
  }
  const isoWeekEnd = new Date(isoWeekStart);
  isoWeekEnd.setUTCDate(isoWeekStart.getUTCDate() + 6);
  return {
    start: isoWeekStart.toISOString().slice(0, 10),
    end:   isoWeekEnd.toISOString().slice(0, 10),
  };
}

function monthRange(year, month) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate(); // last day of that month
  return { start: isoDate(year, month, 1), end: isoDate(year, month, last) };
}

function quarterRange(year, quarter) {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const last = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  return { start: isoDate(year, startMonth, 1), end: isoDate(year, endMonth, last) };
}

function periodRange({ period_type, year, month, week, quarter }) {
  if (period_type === 'weekly')    return isoWeekRange(year, week);
  if (period_type === 'monthly')   return monthRange(year, month);
  if (period_type === 'quarterly') return quarterRange(year, quarter);
  throw new Error(`Unknown period_type: ${period_type}`);
}

function periodLabel({ period_type, year, month, week, quarter }) {
  if (period_type === 'weekly')    return `W${pad(week)} ${year}`;
  if (period_type === 'monthly')   {
    const names = ['', 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${names[month]} ${year}`;
  }
  if (period_type === 'quarterly') return `Q${quarter} ${year}`;
  return `${year}`;
}

// Previous period (used to fetch baseline)
function previousPeriod({ period_type, year, month, week, quarter }) {
  if (period_type === 'weekly') {
    if (week > 1) return { period_type, year, week: week - 1 };
    // Wrap to last week of previous year (ISO uses 52 or 53)
    return { period_type, year: year - 1, week: 52 }; // approximation; OK for baseline
  }
  if (period_type === 'monthly') {
    if (month > 1) return { period_type, year, month: month - 1 };
    return { period_type, year: year - 1, month: 12 };
  }
  if (period_type === 'quarterly') {
    if (quarter > 1) return { period_type, year, quarter: quarter - 1 };
    return { period_type, year: year - 1, quarter: 4 };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// COMPUTE ABSENCE RATES FOR ONE AGENT — mirrors /reports/quality-employee
// EXACTLY (same formulas, same JOINs, same coordinator matching).
// Used as a building block by computeDeptAbsenceRates so dept totals are
// guaranteed to equal sum-of-per-agent (which is what the Quality Report
// page shows in its Department Averages sidebar).
// ──────────────────────────────────────────────────────────────────────────
function computeAgentAbsenceRates(agentName, fromDate, toDate, line) {
  const coordMatch = nameInListInline('b.coordinators', agentName);
  const lineLA = line ? ` AND l.line = '${line.replace(/'/g, "''")}'` : '';
  const lineAA = line ? ` AND a.line = '${line.replace(/'/g, "''")}'` : '';
  const lineLec = line ? ` AND line = '${line.replace(/'/g, "''")}'` : '';
  const dateMainLec = ` AND l.date BETWEEN '${fromDate}' AND '${toDate}'`;

  // Main absent — Part 1 + Part 2
  const dateResolvedFilter = ` AND resolved_date BETWEEN '${fromDate}' AND '${toDate}'`;

  const mainAbsentP1 = db.prepare(`
    SELECT COUNT(*) AS cnt FROM (
      SELECT COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date) AS resolved_date
      FROM absent_students a
      LEFT JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
      LEFT JOIN clients c_lu ON (a.student_name IS NULL OR TRIM(a.student_name)='')
        AND a.phone IS NOT NULL AND TRIM(a.phone)!='' AND c_lu.phone = a.phone${line ? ' AND c_lu.line = a.line' : ''}
      LEFT JOIN (
        SELECT group_name, date, line,
          ROW_NUMBER() OVER (PARTITION BY group_name ORDER BY date) AS lec_num
        FROM lectures WHERE session_type='main' AND status != 'غير مؤكدة'${lineLec}
      ) lec_inf ON (a.date IS NULL OR TRIM(a.date)='')
        AND lec_inf.group_name = a.group_name
        AND a.lecture_no IS NOT NULL
        AND lec_inf.lec_num = a.lecture_no${line ? ' AND lec_inf.line = a.line' : ''}
      WHERE (
        (a.student_name IS NOT NULL AND TRIM(a.student_name)!='')
        OR (a.phone IS NOT NULL AND TRIM(a.phone)!='' AND c_lu.name IS NOT NULL)
      )
      AND ${coordMatch}
    ) p1
    WHERE 1=1${dateResolvedFilter}
  `).get()?.cnt || 0;

  const mainAbsentP2 = db.prepare(`
    SELECT COUNT(*) AS cnt FROM lectures l
    INNER JOIN batches b ON l.group_name = b.group_name${line ? ' AND b.line = l.line' : ''}
    INNER JOIN clients c ON c.group_name = l.group_name${line ? ' AND c.line = l.line' : ''}
    WHERE l.session_type = 'main' AND l.status = 'مؤكدة'
      AND (l.attendance IS NULL OR TRIM(l.attendance) = '')
      AND c.name IS NOT NULL AND TRIM(c.name) != ''
      AND c.phone IS NOT NULL AND TRIM(c.phone) != ''
      AND NOT EXISTS (
        SELECT 1 FROM absent_students a2
        WHERE a2.group_name = l.group_name AND a2.date = l.date${line ? ' AND a2.line = l.line' : ''}
      )
      ${lineLA}${dateMainLec} AND ${coordMatch}
  `).get()?.cnt || 0;

  const main_absent = mainAbsentP1 + mainAbsentP2;

  const mainExp = db.prepare(`
    SELECT COALESCE(SUM(b.trainee_count), 0) AS cnt FROM lectures l
    INNER JOIN batches b ON b.group_name = l.group_name${line ? ' AND b.line = l.line' : ''}
    WHERE l.session_type = 'main' AND l.status != 'غير مؤكدة'${lineLA}${dateMainLec}
      AND ${coordMatch}
  `).get()?.cnt || 0;

  // Zoom expected
  const zoomExp = db.prepare(`
    SELECT COUNT(*) AS cnt FROM lectures l
    INNER JOIN batches b ON b.group_name = l.group_name${line ? ' AND b.line = l.line' : ''}
    WHERE l.session_type = 'side' AND l.status = 'مؤكدة'
      AND (l.duration IS NULL OR l.duration <= '00:15')${lineLA}${dateMainLec}
      AND ${coordMatch}
  `).get()?.cnt || 0;

  // Zoom absent — slots − present per (group, date)
  const zoomAbs = db.prepare(`
    SELECT COALESCE(SUM(absent_count), 0) AS cnt FROM (
      SELECT COUNT(*) - SUM(CASE WHEN l.attendance IS NOT NULL AND l.attendance != ''
                                   AND CAST(l.attendance AS INTEGER) > 0 THEN 1 ELSE 0 END)
                AS absent_count
      FROM lectures l
      INNER JOIN batches b ON l.group_name = b.group_name${line ? ' AND b.line = l.line' : ''}
      WHERE l.session_type = 'side' AND l.status = 'مؤكدة'
        AND (l.duration IS NULL OR l.duration <= '00:15')${lineLA}${dateMainLec}
        AND ${coordMatch}
      GROUP BY l.group_name, l.date
      HAVING absent_count > 0
    ) sub
  `).get()?.cnt || 0;

  return {
    main_absent_count: main_absent,
    main_expected:     mainExp,
    zoom_absent_count: zoomAbs,
    zoom_expected:     zoomExp,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// COMPUTE ABSENCE RATES FOR A DEPARTMENT — sums per-agent values, exactly
// matching the Quality Report's "Department Averages" sidebar.
// ──────────────────────────────────────────────────────────────────────────
function computeDeptAbsenceRates(dept_type, fromDate, toDate, line) {
  // Get all active agents in this department
  const userConds = ["u.role = 'agent'", 'u.is_active = 1', 'u.department = ?'];
  const userParams = [dept_type];
  if (line) {
    userConds.push('u.line = ?');
    userParams.push(line);
  }
  const agents = db.prepare(`
    SELECT u.id, u.full_name FROM users u
    WHERE ${userConds.join(' AND ')}
    ORDER BY u.full_name COLLATE NOCASE
  `).all(...userParams);

  let main_abs = 0, main_exp = 0, zoom_abs = 0, zoom_exp = 0;
  for (const agent of agents) {
    const r = computeAgentAbsenceRates(agent.full_name, fromDate, toDate, line);
    main_abs += r.main_absent_count;
    main_exp += r.main_expected;
    zoom_abs += r.zoom_absent_count;
    zoom_exp += r.zoom_expected;
  }

  const mainRate = main_exp > 0 ? Math.round((main_abs / main_exp) * 100) : 0;
  const zoomRate = zoom_exp > 0 ? Math.round((zoom_abs / zoom_exp) * 100) : 0;

  return {
    main_absent_count: main_abs,
    main_expected:     main_exp,
    main_rate:         mainRate,
    zoom_absent_count: zoom_abs,
    zoom_expected:     zoom_exp,
    zoom_rate:         zoomRate,
    agents_count:      agents.length,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// FETCH RATES FROM OFFICIAL SNAPSHOT
// Returns the dept's main/zoom rates from a saved official snapshot whose
// date range exactly matches the requested period. Returns null if none.
// ──────────────────────────────────────────────────────────────────────────
function getRatesFromOfficialSnapshot(dept_type, fromDate, toDate, line) {
  const snap = db.prepare(`
    SELECT id, snapshot_label, dept_averages_json
    FROM quality_report_snapshots
    WHERE is_official = 1
      AND from_date = ? AND to_date = ?
      AND line = ?
      AND department_filter = 'All'
    ORDER BY frozen_at DESC LIMIT 1
  `).get(fromDate, toDate, line || 'Ahmed Hassan');

  if (!snap) return null;

  let deptAverages;
  try { deptAverages = JSON.parse(snap.dept_averages_json || '[]'); }
  catch { deptAverages = []; }

  const dept = deptAverages.find(d => d.department === dept_type);
  if (!dept) return null;

  return {
    main_absent_count: dept.mainAbsent ?? 0,
    main_expected:     dept.mainExpected ?? 0,
    main_rate:         dept.mainRate ?? 0,
    zoom_absent_count: dept.zoomAbsent ?? 0,
    zoom_expected:     dept.zoomExpected ?? 0,
    zoom_rate:         dept.zoomRate ?? 0,
    snapshot_id:       snap.id,
    snapshot_label:    snap.snapshot_label,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// COMPUTE STATUS based on actual vs target
// ──────────────────────────────────────────────────────────────────────────
function computeStatus(actualMain, actualZoom, targetMain, targetZoom) {
  const mainMet = actualMain <= targetMain;
  const zoomMet = actualZoom <= targetZoom;
  if (mainMet && zoomMet) return 'met';
  if (!mainMet && !zoomMet) return 'missed';
  return 'partial';
}

// ──────────────────────────────────────────────────────────────────────────
// GET /api/dept-goals/baseline — pull the previous period's actual rates so
// the Set Goals UI can pre-fill the baseline column.
//   query: dept_type, period_type, year, month/week/quarter
// ──────────────────────────────────────────────────────────────────────────
router.get('/baseline', (req, res) => {
  const { dept_type, period_type } = req.query;
  const year    = parseInt(req.query.year, 10);
  const month   = req.query.month   ? parseInt(req.query.month, 10)   : null;
  const week    = req.query.week    ? parseInt(req.query.week, 10)    : null;
  const quarter = req.query.quarter ? parseInt(req.query.quarter, 10) : null;
  const line    = lineFilter(req);

  if (!dept_type || !period_type || !year) {
    return res.status(400).json({ error: 'dept_type, period_type, year required' });
  }

  try {
    const prev = previousPeriod({ period_type, year, month, week, quarter });
    if (!prev) return res.json(null);
    const range = periodRange(prev);
    const lineKey = line || 'Ahmed Hassan';

    // PREFERRED PATH: pull from the official snapshot for the previous period
    const fromSnap = getRatesFromOfficialSnapshot(dept_type, range.start, range.end, lineKey);
    if (fromSnap) {
      return res.json({
        source: 'snapshot',
        snapshot_id: fromSnap.snapshot_id,
        snapshot_label: fromSnap.snapshot_label,
        main_absent_count: fromSnap.main_absent_count,
        main_expected:     fromSnap.main_expected,
        main_rate:         fromSnap.main_rate,
        zoom_absent_count: fromSnap.zoom_absent_count,
        zoom_expected:     fromSnap.zoom_expected,
        zoom_rate:         fromSnap.zoom_rate,
        period_label: periodLabel(prev),
        period_start: range.start,
        period_end:   range.end,
      });
    }

    // FALLBACK PATH: live computation when no official snapshot exists
    const rates = computeDeptAbsenceRates(dept_type, range.start, range.end, lineKey);
    return res.json({
      source: 'live',
      warning: 'لا يوجد snapshot رسمى لهذه الفترة — الأرقام محسوبة مباشرة من البيانات الحالية وممكن تتغير لو رفعت Excel جديد. ينصح بحفظ snapshot رسمى لتثبيت الأرقام.',
      ...rates,
      period_label: periodLabel(prev),
      period_start: range.start,
      period_end:   range.end,
    });
  } catch (err) {
    console.error('[dept-goals] baseline:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// POST /api/dept-goals — admin only, create or update a goal
// ──────────────────────────────────────────────────────────────────────────
router.post('/', adminOnly, (req, res) => {
  const {
    dept_type, period_type, year,
    month, week, quarter,
    target_main_absent_rate, target_zoom_absent_rate,
    bonus_points, notes,
  } = req.body || {};

  if (!dept_type || !period_type || !year) {
    return res.status(400).json({ error: 'dept_type, period_type, year are required' });
  }
  if (!['General','Private','Semi'].includes(dept_type)) {
    return res.status(400).json({ error: `Invalid dept_type: ${dept_type}` });
  }
  if (!['weekly','monthly','quarterly'].includes(period_type)) {
    return res.status(400).json({ error: `Invalid period_type: ${period_type}` });
  }
  if (target_main_absent_rate == null || target_zoom_absent_rate == null) {
    return res.status(400).json({ error: 'target rates are required' });
  }
  const tMain = parseInt(target_main_absent_rate, 10);
  const tZoom = parseInt(target_zoom_absent_rate, 10);
  if (Number.isNaN(tMain) || tMain < 0 || tMain > 100) {
    return res.status(400).json({ error: 'target_main_absent_rate must be 0-100' });
  }
  if (Number.isNaN(tZoom) || tZoom < 0 || tZoom > 100) {
    return res.status(400).json({ error: 'target_zoom_absent_rate must be 0-100' });
  }

  const line = lineFilter(req) || 'Ahmed Hassan';

  try {
    const range = periodRange({ period_type, year, month, week, quarter });
    const label = periodLabel({ period_type, year, month, week, quarter });

    // Auto-fetch baseline from previous period
    let baseMain = 0, baseZoom = 0, baseLabel = null;
    const prev = previousPeriod({ period_type, year, month, week, quarter });
    if (prev) {
      const prevRange = periodRange(prev);
      const prevRates = computeDeptAbsenceRates(dept_type, prevRange.start, prevRange.end, line);
      baseMain = prevRates.main_rate;
      baseZoom = prevRates.zoom_rate;
      baseLabel = periodLabel(prev);
    }

    // Upsert pattern: try insert, fall back to update on unique-conflict
    const existing = db.prepare(`
      SELECT id FROM department_quality_goals
      WHERE dept_type = ? AND period_type = ? AND year = ?
        AND COALESCE(month,0) = COALESCE(?,0)
        AND COALESCE(week,0) = COALESCE(?,0)
        AND COALESCE(quarter,0) = COALESCE(?,0)
        AND line = ?
    `).get(dept_type, period_type, year, month, week, quarter, line);

    if (existing) {
      db.prepare(`
        UPDATE department_quality_goals SET
          period_label = ?, period_start = ?, period_end = ?,
          baseline_main_absent_rate = ?, baseline_zoom_absent_rate = ?, baseline_period_label = ?,
          target_main_absent_rate = ?, target_zoom_absent_rate = ?,
          bonus_points = COALESCE(?, bonus_points),
          notes = ?,
          updated_by = ?, updated_at = datetime('now', '+2 hours')
        WHERE id = ?
      `).run(
        label, range.start, range.end,
        baseMain, baseZoom, baseLabel,
        tMain, tZoom,
        bonus_points != null ? parseInt(bonus_points, 10) : null,
        notes || null,
        req.user?.id || null,
        existing.id,
      );
      saveNow();
      return res.json({ success: true, id: existing.id, updated: true });
    }

    const result = db.prepare(`
      INSERT INTO department_quality_goals
        (dept_type, period_type, year, month, week, quarter,
         period_label, period_start, period_end, line,
         baseline_main_absent_rate, baseline_zoom_absent_rate, baseline_period_label,
         target_main_absent_rate, target_zoom_absent_rate,
         bonus_points, notes,
         created_by, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?,
              ?, ?,
              ?, ?,
              ?, ?)
    `).run(
      dept_type, period_type, year, month || null, week || null, quarter || null,
      label, range.start, range.end, line,
      baseMain, baseZoom, baseLabel,
      tMain, tZoom,
      bonus_points != null ? parseInt(bonus_points, 10) : 5,
      notes || null,
      req.user?.id || null,
      req.user?.full_name || req.user?.username || null,
    );
    saveNow();
    return res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('[dept-goals] create:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// GET /api/dept-goals — list goals (with computed actual + status if active)
//   query: status, period_type, year, dept_type, mode (active|all|history)
// ──────────────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { period_type, mode } = req.query;
  const year = req.query.year ? parseInt(req.query.year, 10) : null;
  const line = lineFilter(req);
  const dept_type = leaderScopedDept(req) || req.query.dept_type;

  const conds = [];
  const params = [];

  if (line) { conds.push('line = ?'); params.push(line); }
  if (dept_type)   { conds.push('dept_type = ?');   params.push(dept_type); }
  if (period_type) { conds.push('period_type = ?'); params.push(period_type); }
  if (year)        { conds.push('year = ?');        params.push(year); }

  if (mode === 'active') {
    conds.push("status = 'active'");
    conds.push("date(period_end) >= date('now', '+2 hours')");
  } else if (mode === 'history') {
    conds.push("(status IN ('met','missed','partial','cancelled') OR date(period_end) < date('now', '+2 hours'))");
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  try {
    const rows = db.prepare(`
      SELECT * FROM department_quality_goals
      ${where}
      ORDER BY period_end DESC, dept_type
      LIMIT 500
    `).all(...params);

    // Live-compute actuals for active goals so user always sees current progress
    const todayIso = new Date().toISOString().slice(0, 10);
    const enriched = rows.map(g => {
      let actualMain = g.actual_main_absent_rate;
      let actualZoom = g.actual_zoom_absent_rate;
      let actualMainCount = g.actual_main_absent_count;
      let actualMainExp = g.actual_main_expected;
      let actualZoomCount = g.actual_zoom_absent_count;
      let actualZoomExp = g.actual_zoom_expected;

      // For active or in-flight goals, recompute live so the UI is always fresh
      if (g.status === 'active') {
        const today = todayIso;
        const upTo = today < g.period_end ? today : g.period_end;
        const live = computeDeptAbsenceRates(g.dept_type, g.period_start, upTo, g.line);
        actualMain = live.main_rate;
        actualZoom = live.zoom_rate;
        actualMainCount = live.main_absent_count;
        actualMainExp = live.main_expected;
        actualZoomCount = live.zoom_absent_count;
        actualZoomExp = live.zoom_expected;
      }

      const periodEndDate = new Date(g.period_end + 'T23:59:59Z');
      const nowDate = new Date();
      const daysRemaining = Math.ceil((periodEndDate - nowDate) / (1000 * 60 * 60 * 24));

      // Live status (not yet committed if active)
      const liveStatus = g.status === 'active'
        ? computeStatus(actualMain || 0, actualZoom || 0, g.target_main_absent_rate, g.target_zoom_absent_rate)
        : g.status;

      return {
        ...g,
        actual_main_absent_rate:  actualMain,
        actual_zoom_absent_rate:  actualZoom,
        actual_main_absent_count: actualMainCount,
        actual_main_expected:     actualMainExp,
        actual_zoom_absent_count: actualZoomCount,
        actual_zoom_expected:     actualZoomExp,
        live_status: liveStatus,
        days_remaining: daysRemaining,
      };
    });

    return res.json(enriched);
  } catch (err) {
    console.error('[dept-goals] list:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// POST /api/dept-goals/:id/evaluate — admin only, finalize a goal:
//   - recompute actuals against FULL period
//   - persist actual_* + status
//   - if status=met and not yet bonus_awarded, distribute bonus points
//     to monthly_snapshots.dept_goal_bonus + send notifications
// ──────────────────────────────────────────────────────────────────────────
router.post('/:id/evaluate', adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  const g = db.prepare(`SELECT * FROM department_quality_goals WHERE id = ?`).get(id);
  if (!g) return res.status(404).json({ error: 'Goal not found' });

  try {
    // REQUIRE official snapshot for the period before evaluation
    const fromSnap = getRatesFromOfficialSnapshot(g.dept_type, g.period_start, g.period_end, g.line);
    if (!fromSnap) {
      return res.status(400).json({
        error: 'snapshot_required',
        message: `يجب حفظ snapshot رسمى (Official) من Quality Report يغطى الفترة (${g.period_start} → ${g.period_end}) قبل التقييم النهائى. اذهب إلى Quality Reports واضبط الفلتر للفترة ده ثم احفظ snapshot وفعّل Official.`,
        period_start: g.period_start,
        period_end:   g.period_end,
      });
    }
    const rates = {
      main_absent_count: fromSnap.main_absent_count,
      main_expected:     fromSnap.main_expected,
      main_rate:         fromSnap.main_rate,
      zoom_absent_count: fromSnap.zoom_absent_count,
      zoom_expected:     fromSnap.zoom_expected,
      zoom_rate:         fromSnap.zoom_rate,
    };
    const status = computeStatus(rates.main_rate, rates.zoom_rate,
                                 g.target_main_absent_rate, g.target_zoom_absent_rate);

    db.prepare(`
      UPDATE department_quality_goals SET
        actual_main_absent_rate  = ?,
        actual_zoom_absent_rate  = ?,
        actual_main_absent_count = ?,
        actual_main_expected     = ?,
        actual_zoom_absent_count = ?,
        actual_zoom_expected     = ?,
        status                   = ?,
        evaluated_at             = datetime('now', '+2 hours'),
        updated_by               = ?,
        updated_at               = datetime('now', '+2 hours')
      WHERE id = ?
    `).run(
      rates.main_rate, rates.zoom_rate,
      rates.main_absent_count, rates.main_expected,
      rates.zoom_absent_count, rates.zoom_expected,
      status,
      req.user?.id || null,
      id,
    );

    // Bonus + notifications on 'met' goals (only once)
    let bonusGiven = 0;
    if (status === 'met' && !g.bonus_awarded && g.period_type === 'monthly') {
      // Add bonus to every monthly_snapshots row for this dept + period (year, month)
      const result = db.prepare(`
        UPDATE monthly_snapshots
        SET dept_goal_bonus = dept_goal_bonus + ?
        WHERE department = ? AND year = ? AND month = ? AND line = ?
      `).run(g.bonus_points, g.dept_type, g.year, g.month, g.line);
      bonusGiven = result.changes;

      db.prepare(`UPDATE department_quality_goals SET bonus_awarded = 1 WHERE id = ?`).run(id);
    }

    // Notifications — admins always notified; agents in dept notified if 'met'
    try {
      const adminIds = db.prepare(`SELECT id FROM users WHERE role = 'admin' AND is_active = 1`).all();
      const title = status === 'met'    ? `هدف القسم تحقق ✅`
                  : status === 'partial' ? `هدف القسم محقق جزئياً ⚠️`
                                         : `هدف القسم لم يتحقق ❌`;
      const body  = `${g.dept_type} — ${g.period_label}: غياب ${rates.main_rate}% / زووم ${rates.zoom_rate}% (الهدف: ${g.target_main_absent_rate}% / ${g.target_zoom_absent_rate}%)`;
      const meta = JSON.stringify({ subtype: 'dept_goal_evaluated', goal_id: id, status });

      adminIds.forEach(u => {
        db.prepare(`
          INSERT INTO notifications (user_id, type, title, body, link, meta)
          VALUES (?, 'system', ?, ?, ?, ?)
        `).run(u.id, title, body, '/admin/reports/dept-goals', meta);
      });

      if (status === 'met') {
        const agents = db.prepare(`
          SELECT id FROM users WHERE role IN ('agent','leader') AND is_active = 1 AND department = ?
        `).all(g.dept_type);
        const agentBody = `قسمك حقق هدف ${g.period_label}! +${g.bonus_points} نقاط مكافأة على overall_score`;
        const agentMeta = JSON.stringify({ subtype: 'dept_goal_met', goal_id: id, bonus_points: g.bonus_points });
        agents.forEach(u => {
          db.prepare(`
            INSERT INTO notifications (user_id, type, title, body, link, meta)
            VALUES (?, 'achievement_earned', ?, ?, ?, ?)
          `).run(u.id, '🎉 مكافأة قسم!', agentBody, '/agent/my-progression', agentMeta);
        });
      }
    } catch (e) {
      // Notifications shouldn't fail evaluation
      console.warn('[dept-goals] notification dispatch warn:', e.message);
    }

    saveNow();
    return res.json({
      success: true,
      status,
      actual_main_rate: rates.main_rate,
      actual_zoom_rate: rates.zoom_rate,
      bonus_given_to_employees: bonusGiven,
    });
  } catch (err) {
    console.error('[dept-goals] evaluate:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// DELETE /api/dept-goals/:id — admin only
// ──────────────────────────────────────────────────────────────────────────
router.delete('/:id', adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = db.prepare(`DELETE FROM department_quality_goals WHERE id = ?`).run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Goal not found' });
  saveNow();
  return res.json({ success: true });
});

// ──────────────────────────────────────────────────────────────────────────
// GET /api/dept-goals/history — past goals grouped by dept for charts
// ──────────────────────────────────────────────────────────────────────────
router.get('/history', (req, res) => {
  const { period_type } = req.query;
  const line = lineFilter(req);
  const dept_type = leaderScopedDept(req) || req.query.dept_type;
  const conds = ["status IN ('met','missed','partial')"];
  const params = [];
  if (line)        { conds.push('line = ?');        params.push(line); }
  if (dept_type)   { conds.push('dept_type = ?');   params.push(dept_type); }
  if (period_type) { conds.push('period_type = ?'); params.push(period_type); }

  const rows = db.prepare(`
    SELECT id, dept_type, period_type, period_label, period_start, period_end,
           baseline_main_absent_rate, baseline_zoom_absent_rate,
           target_main_absent_rate, target_zoom_absent_rate,
           actual_main_absent_rate, actual_zoom_absent_rate,
           status, evaluated_at, bonus_points, bonus_awarded
    FROM department_quality_goals
    WHERE ${conds.join(' AND ')}
    ORDER BY period_end ASC LIMIT 500
  `).all(...params);

  return res.json(rows);
});

module.exports = router;
