'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { lineFilter } = require('../utils/lineFilter');

const router = express.Router();
router.use(authenticate, requireRole('agent'));

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function buildDateFilter(field, from_date, to_date) {
  if (from_date && to_date) return ` AND ${field} BETWEEN '${from_date}' AND '${to_date}'`;
  if (from_date) return ` AND ${field} >= '${from_date}'`;
  if (to_date) return ` AND ${field} <= '${to_date}'`;
  return '';
}

function buildDeptFilter(table, department) {
  if (!department || department === 'All') return '';
  const safe = department.replace(/'/g, "''");
  return ` AND (${table}.dept_type = '${safe}' OR EXISTS (
    SELECT 1 FROM users u
    WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(${table}.coordinators))
    AND u.department = '${safe}'
  ))`;
}

// Dept filter — coordinator's registered department is SOURCE OF TRUTH.
// Rules:
//   1. If coordinator IS registered in users table → use their registered department
//      (Ali Moaatz registered General → his groups count as General even if batch stored Semi)
//   2. If coordinator is NOT registered (or multi-name field doesn't exact-match) →
//      fall back to batch.dept_type
// This prevents cross-dept leakage: groups where batch stored General but coordinator
// is registered Semi will NOT appear for General leader (they belong to coordinator's dept).
function buildStrictDeptFilter(table, department) {
  if (!department || department === 'All') return '';
  const safe = department.replace(/'/g, "''");
  return ` AND (
    EXISTS (
      SELECT 1 FROM users u
      WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(${table}.coordinators))
        AND u.department = '${safe}'
    )
    OR (
      ${table}.dept_type = '${safe}'
      AND NOT EXISTS (
        SELECT 1 FROM users u
        WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(${table}.coordinators))
          AND u.department IS NOT NULL AND u.department != 'All'
      )
    )
  )`;
}

function buildCoordFilter(table, value) {
  if (!value) return '';
  const safe = value.replace(/'/g, "''");
  return ` AND ${table}.coordinators LIKE '%${safe}%'`;
}

// Department filter for the `remarks` table — coordinator-first rule (Fix 16) + Fix 9 fallback.
// Rules:
//   1. Client HAS a group → match if coordinator registered in this dept,
//      OR (coordinator not registered anywhere AND batch.dept_type matches).
//      Prevents leaks where batch dept_type disagrees with coordinator's registered dept.
//   2. Client has NO group → fall back to team_members.section match on assigned_to (Fix 9).
// `alias` is the remarks table alias in the outer query (e.g. 'remarks', 'r').
function buildDeptRemarkFilter(alias, department) {
  if (!department || department === 'All') return '';
  const safe = department.replace(/'/g, "''");
  const a = alias || 'remarks';
  return ` AND (
    EXISTS (
      SELECT 1 FROM clients c
      INNER JOIN batches b ON c.group_name = b.group_name
      WHERE c.phone = ${a}.client_phone
        AND (
          EXISTS (
            SELECT 1 FROM users u
            WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
              AND u.department = '${safe}'
          )
          OR (
            b.dept_type = '${safe}'
            AND NOT EXISTS (
              SELECT 1 FROM users u
              WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
                AND u.department IS NOT NULL AND u.department != 'All'
            )
          )
        )
    )
    OR (
      NOT EXISTS (
        SELECT 1 FROM clients c
        INNER JOIN batches b ON c.group_name = b.group_name
        WHERE c.phone = ${a}.client_phone
      )
      AND EXISTS (
        SELECT 1 FROM team_members tm
        WHERE LOWER(TRIM(tm.name)) LIKE LOWER('%' || TRIM(${a}.assigned_to) || '%')
          AND LOWER(tm.section) = LOWER('${safe}')
      )
    )
  )`;
}

function escapeLike(s) {
  if (!s) return '';
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// Builds the inner UNION+dedup query used by /remarks-notes-main.
// Returns an SQL string that can be wrapped in `SELECT ... FROM (${innerQ}) t WHERE 1=1 ${havingFilter}`.
// Used by the endpoint AND by the dashboard KPI so both always agree on the count.
function buildRemarksNotesMainInnerQ({ from_date, to_date, department, employee, coordinator = '', search = '', line }) {
  const lineA  = buildLineFilter('a', line);
  const lineL  = buildLineFilter('l', line);
  const lineR3 = buildLineFilter('r3', line);

  // Coordinator → auto-resolve their registered dept (strict) when no explicit dept given
  let resolvedDept = department && department !== 'All' ? department : '';
  if (coordinator && !resolvedDept) {
    const coordUser = db.prepare(
      `SELECT department FROM users WHERE LOWER(TRIM(full_name))=LOWER(TRIM(?)) AND department != 'All' LIMIT 1${line ? ` AND line IN ('${line.replace(/'/g, "''")}','All')` : ''}`
    ).get(coordinator.trim());
    if (coordUser?.department) resolvedDept = coordUser.department;
  }

  const deptFilter1 = buildStrictDeptFilter('b', resolvedDept);
  const empFilter1  = buildCoordFilter('b', employee);
  const coord1      = buildCoordFilter('b', coordinator);
  const search1     = search ? ` AND (a.student_name LIKE '%${escapeLike(search)}%' OR a.group_name LIKE '%${escapeLike(search)}%' OR a.phone LIKE '%${escapeLike(search)}%') ESCAPE '\\'` : '';

  const deptFilter2 = buildStrictDeptFilter('b2', resolvedDept);
  const empFilter2  = buildCoordFilter('b2', employee);
  const coord2      = buildCoordFilter('b2', coordinator);
  const search2     = search ? ` AND (c.name LIKE '%${escapeLike(search)}%' OR l.group_name LIKE '%${escapeLike(search)}%' OR c.phone LIKE '%${escapeLike(search)}%') ESCAPE '\\'` : '';

  const safeCoord3  = coordinator ? coordinator.replace(/'/g, "''") : '';
  const safeDept3   = resolvedDept ? resolvedDept.replace(/'/g, "''") : '';
  const deptFilter3 = safeDept3  ? ` AND (b3.dept_type = '${safeDept3}' OR b3.coordinators IS NULL)` : '';
  const empFilter3  = employee   ? ` AND (b3.coordinators LIKE '%${employee.replace(/'/g,"''")}%' OR b3.coordinators IS NULL)` : '';
  const coord3      = safeCoord3 ? ` AND (b3.coordinators LIKE '%${safeCoord3}%' OR b3.coordinators IS NULL)` : '';
  const search3     = search ? ` AND (COALESCE(c3.name, r3.client_name) LIKE '%${escapeLike(search)}%' OR c3.group_name LIKE '%${escapeLike(search)}%' OR r3.client_phone LIKE '%${escapeLike(search)}%') ESCAPE '\\'` : '';

  const dateFilter = from_date && to_date
    ? ` AND absence_date BETWEEN '${from_date}' AND '${to_date}'`
    : from_date ? ` AND absence_date >= '${from_date}'`
    : to_date   ? ` AND absence_date <= '${to_date}'` : '';

  const outerCoordFilter = coordinator
    ? ` AND TRIM(LOWER(abs_base.coordinators)) LIKE LOWER('%${coordinator.replace(/'/g,"''")}%')`
    : '';

  const part1 = `
    SELECT
      COALESCE(c_lu.name, NULLIF(TRIM(a.student_name),'')) AS student_name,
      a.phone AS student_phone, a.group_name,
      COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date) AS absence_date,
      b.coordinators,
      COALESCE(
        (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(b.coordinators)) AND u.department != 'All' LIMIT 1),
        b.dept_type
      ) AS dept_type
    FROM absent_students a
    LEFT JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
    LEFT JOIN (SELECT phone, line, MIN(name) AS name FROM clients${line ? ` WHERE line = '${line.replace(/'/g, "''")}'` : ''} GROUP BY phone, line) c_lu
      ON (a.student_name IS NULL OR TRIM(a.student_name)='')
      AND a.phone IS NOT NULL AND TRIM(a.phone)!='' AND c_lu.phone = a.phone${line ? ' AND c_lu.line = a.line' : ''}
    LEFT JOIN (
      SELECT group_name, date, line,
        ROW_NUMBER() OVER (PARTITION BY group_name ORDER BY date) AS lec_num
      FROM lectures WHERE session_type = 'main' AND status != 'غير مؤكدة'${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
    ) lec_inf ON (a.date IS NULL OR TRIM(a.date)='')
      AND lec_inf.group_name = a.group_name
      AND a.lecture_no IS NOT NULL AND lec_inf.lec_num = a.lecture_no${line ? ' AND lec_inf.line = a.line' : ''}
    WHERE (
      (a.student_name IS NOT NULL AND TRIM(a.student_name)!='')
      OR (a.phone IS NOT NULL AND TRIM(a.phone)!='' AND c_lu.name IS NOT NULL)
    )
    ${deptFilter1}${empFilter1}${coord1}${search1}${lineA}`;

  const part2 = `
    SELECT
      c.name AS student_name, c.phone AS student_phone,
      l.group_name, l.date AS absence_date,
      b2.coordinators,
      COALESCE(
        (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(b2.coordinators)) AND u.department != 'All' LIMIT 1),
        b2.dept_type
      ) AS dept_type
    FROM lectures l
    INNER JOIN batches b2 ON l.group_name = b2.group_name${line ? ' AND b2.line = l.line' : ''}
    INNER JOIN clients c ON c.group_name = l.group_name${line ? ' AND c.line = l.line' : ''}
    WHERE l.session_type = 'main' AND l.status = 'مؤكدة'
      AND (l.attendance IS NULL OR TRIM(l.attendance) = '')
      AND c.name IS NOT NULL AND TRIM(c.name)!=''
      AND c.phone IS NOT NULL AND TRIM(c.phone)!=''
      AND NOT EXISTS (
        SELECT 1 FROM absent_students a2
        WHERE a2.group_name = l.group_name AND a2.date = l.date${line ? ' AND a2.line = l.line' : ''}
      )
    ${deptFilter2}${empFilter2}${coord2}${search2}${lineL}`;

  const remarksSubQ = `
    SELECT client_phone,
      date(substr(added_at,7,4)||'-'||substr(added_at,4,2)||'-'||substr(added_at,1,2)) AS rdate,
      MAX(id) AS id, MAX(details) AS details, MAX(added_at) AS added_at,
      MAX(assigned_to) AS assigned_to, MAX(status) AS status
    FROM remarks WHERE category = 'Attendance Main Session'${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
    GROUP BY client_phone, date(substr(added_at,7,4)||'-'||substr(added_at,4,2)||'-'||substr(added_at,1,2))`;

  const rdSQLMain = `date(substr(r3.added_at,7,4)||'-'||substr(r3.added_at,4,2)||'-'||substr(r3.added_at,1,2))`;
  const part3 = `
    SELECT DISTINCT
      COALESCE(c3.name, r3.client_name) AS student_name,
      r3.client_phone                   AS student_phone,
      COALESCE(c3.group_name, '--')     AS group_name,
      ${prevLectureDay(rdSQLMain)}      AS absence_date,
      COALESCE(b3.coordinators, r3.assigned_to) AS coordinators,
      COALESCE(
        (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(COALESCE(b3.coordinators, r3.assigned_to))) AND u.department != 'All' LIMIT 1),
        b3.dept_type
      ) AS dept_type
    FROM remarks r3
    LEFT JOIN clients c3 ON c3.phone = r3.client_phone${line ? ' AND c3.line = r3.line' : ''}
      AND c3.group_name = COALESCE(
        (SELECT cl.group_name FROM clients cl
         INNER JOIN batches bl ON bl.group_name = cl.group_name${line ? ' AND bl.line = cl.line' : ''}
         WHERE cl.phone = r3.client_phone
           AND bl.start_date IS NOT NULL
           AND bl.start_date <= ${rdSQLMain}${line ? ` AND cl.line = '${line.replace(/'/g, "''")}'` : ''}
         ORDER BY bl.start_date DESC LIMIT 1),
        (SELECT cl2.group_name FROM clients cl2
         WHERE cl2.phone = r3.client_phone${line ? ` AND cl2.line = '${line.replace(/'/g, "''")}'` : ''} ORDER BY cl2.group_name ASC LIMIT 1)
      )
    LEFT JOIN batches b3 ON b3.group_name = c3.group_name${line ? ' AND b3.line = c3.line' : ''}
    WHERE r3.category = 'Attendance Main Session'
      AND r3.client_phone IS NOT NULL AND TRIM(r3.client_phone) != ''
      AND NOT EXISTS (
        SELECT 1 FROM absent_students a3
        WHERE TRIM(a3.phone) = TRIM(r3.client_phone)
          AND a3.date = (${prevLectureDay(rdSQLMain)})${line ? ' AND a3.line = r3.line' : ''}
      )
      AND EXISTS (
        SELECT 1 FROM lectures lx
        WHERE lx.group_name = c3.group_name
          AND lx.session_type = 'main'
          AND lx.status != 'غير مؤكدة'
          AND lx.date = (${prevLectureDay(rdSQLMain)})${line ? ' AND lx.line = r3.line' : ''}
      )
    ${deptFilter3}${empFilter3}${coord3}${search3}${lineR3}`;

  return `
    SELECT
      abs_base.student_name, abs_base.student_phone, abs_base.group_name,
      abs_base.absence_date, abs_base.coordinators, abs_base.dept_type,
      ${nextRemarkDay('abs_base.absence_date')} AS expected_remark_date,
      r.id AS remark_id, r.details AS remark_details, r.added_at AS remark_date,
      r.assigned_to, r.status AS remark_status,
      CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END AS has_remark
    FROM (
      SELECT student_name, student_phone, group_name, absence_date, coordinators, dept_type
      FROM (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY
              COALESCE(NULLIF(TRIM(student_phone),''), LOWER(TRIM(COALESCE(student_name,'')))),
              group_name,
              absence_date
            ORDER BY
              CASE WHEN student_name IS NOT NULL AND TRIM(student_name) != '' THEN 0 ELSE 1 END,
              CASE WHEN dept_type IS NOT NULL AND dept_type != 'All' THEN 0 ELSE 1 END,
              CASE WHEN coordinators IS NOT NULL AND TRIM(coordinators) != '' THEN 0 ELSE 1 END
          ) AS _rn
        FROM (
          SELECT * FROM (${part1}) p1 WHERE absence_date IS NOT NULL
          UNION ALL
          SELECT * FROM (${part2}) p2
          UNION ALL
          SELECT * FROM (${part3}) p3
        ) _u
      ) _ranked
      WHERE _rn = 1
    ) abs_base
    LEFT JOIN (${remarksSubQ}) r
      ON r.client_phone = abs_base.student_phone
      AND r.rdate = (${nextRemarkDay('abs_base.absence_date')})
    WHERE abs_base.absence_date IS NOT NULL ${dateFilter}${outerCoordFilter}`;
}

// Builds the inner UNION+dedup query used by /remarks-notes-zoom.
// Mirrors buildRemarksNotesMainInnerQ's contract — used by both the endpoint
// and the dashboard KPI so counts stay in lock-step.
function buildRemarksNotesZoomInnerQ({ from_date, to_date, department, employee, coordinator = '', search = '', line }) {
  const lineA  = buildLineFilter('a', line);
  const lineR2 = buildLineFilter('r2', line);

  const safeEmp   = employee    ? employee.replace(/'/g, "''")    : '';
  const safeCoord = coordinator ? coordinator.replace(/'/g, "''") : '';

  let resolvedDept = department && department !== 'All' ? department : '';
  if (coordinator && !resolvedDept) {
    const coordUser = db.prepare(
      `SELECT department FROM users WHERE LOWER(TRIM(full_name))=LOWER(TRIM(?)) AND department != 'All' LIMIT 1${line ? ` AND line IN ('${line.replace(/'/g, "''")}','All')` : ''}`
    ).get(coordinator.trim());
    if (coordUser?.department) resolvedDept = coordUser.department;
  }
  const safeDept = resolvedDept ? resolvedDept.replace(/'/g, "''") : '';

  const dept1  = buildStrictDeptFilter('b', resolvedDept);
  const emp1   = buildCoordFilter('b', employee);
  const coord1 = buildCoordFilter('b', coordinator);
  const srch1  = search ? ` AND (c.name LIKE '%${escapeLike(search)}%' OR c.phone LIKE '%${escapeLike(search)}%' OR c.group_name LIKE '%${escapeLike(search)}%') ESCAPE '\\'` : '';
  const srchA  = search ? ` AND (a.student_name LIKE '%${escapeLike(search)}%' OR a.phone LIKE '%${escapeLike(search)}%' OR a.group_name LIKE '%${escapeLike(search)}%') ESCAPE '\\'` : '';

  const dept2  = safeDept  ? ` AND (b2.dept_type = '${safeDept}' OR EXISTS (SELECT 1 FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(r2.assigned_to)) AND u.department='${safeDept}'))` : '';
  const emp2   = safeEmp   ? ` AND (b2.coordinators LIKE '%${safeEmp}%' OR r2.assigned_to LIKE '%${safeEmp}%')` : '';
  const coord2 = safeCoord ? ` AND (b2.coordinators LIKE '%${safeCoord}%' OR r2.assigned_to LIKE '%${safeCoord}%')` : '';
  const srch2  = search ? ` AND (r2.client_name LIKE '%${escapeLike(search)}%' OR r2.client_phone LIKE '%${escapeLike(search)}%') ESCAPE '\\'` : '';

  const dateFilter = from_date && to_date
    ? ` AND abs_union.session_date BETWEEN '${from_date}' AND '${to_date}'`
    : from_date ? ` AND abs_union.session_date >= '${from_date}'`
    : to_date   ? ` AND abs_union.session_date <= '${to_date}'` : '';

  const partA = `
    SELECT DISTINCT
      COALESCE(c_lu.name, NULLIF(TRIM(a.student_name),'')) AS client_name,
      a.phone AS client_phone,
      a.group_name,
      a.date AS session_date,
      b.coordinators,
      COALESCE(
        (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(b.coordinators)) AND u.department != 'All' LIMIT 1),
        b.dept_type
      ) AS dept_type
    FROM absent_students a
    INNER JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
    LEFT JOIN (SELECT phone, line, MIN(name) AS name FROM clients${line ? ` WHERE line = '${line.replace(/'/g, "''")}'` : ''} GROUP BY phone, line) c_lu
      ON (a.student_name IS NULL OR TRIM(a.student_name) = '')
      AND a.phone IS NOT NULL AND TRIM(a.phone) != ''
      AND c_lu.phone = a.phone${line ? ' AND c_lu.line = a.line' : ''}
    WHERE (
      (a.student_name IS NOT NULL AND TRIM(a.student_name) != '')
      OR (a.phone IS NOT NULL AND TRIM(a.phone) != '' AND c_lu.name IS NOT NULL)
    )
    AND a.date IS NOT NULL AND TRIM(a.date) != ''
    AND EXISTS (
      SELECT 1 FROM lectures l
      WHERE l.group_name = a.group_name
        AND l.session_type = 'side'
        AND l.status != 'غير مؤكدة'
        AND l.date = a.date${line ? ' AND l.line = a.line' : ''}
    )
    ${dept1}${emp1}${coord1}${srchA}${lineA}`;

  const part1 = `
    SELECT DISTINCT c.name AS client_name, c.phone AS client_phone,
      c.group_name, grp.session_date, b.coordinators,
      COALESCE(
        (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(b.coordinators)) AND u.department != 'All' LIMIT 1),
        b.dept_type
      ) AS dept_type
    FROM (
      SELECT l.group_name, l.date AS session_date, l.line,
        COUNT(*) AS slot_count_on_date
      FROM lectures l
      WHERE l.session_type = 'side' AND l.status = 'مؤكدة'
        AND (l.duration IS NULL OR l.duration <= '00:15')${line ? ` AND l.line = '${line.replace(/'/g, "''")}'` : ''}
      GROUP BY l.group_name, l.date, l.line
      HAVING SUM(CASE WHEN l.attendance IS NOT NULL AND TRIM(l.attendance) != ''
                 AND CAST(l.attendance AS INTEGER) > 0 THEN 1 ELSE 0 END) = 0
        AND COUNT(*) > 0
    ) grp
    INNER JOIN clients c ON c.group_name = grp.group_name${line ? ' AND c.line = grp.line' : ''}
    INNER JOIN batches b ON b.group_name = grp.group_name${line ? ' AND b.line = grp.line' : ''}
    WHERE c.name IS NOT NULL AND TRIM(c.name) != ''
      AND c.phone IS NOT NULL AND TRIM(c.phone) != ''
      AND (
        grp.slot_count_on_date >= (
          SELECT COUNT(*) FROM clients c_cnt
          WHERE c_cnt.group_name = grp.group_name${line ? ' AND c_cnt.line = grp.line' : ''}
            AND c_cnt.name IS NOT NULL AND TRIM(c_cnt.name) != ''
            AND c_cnt.phone IS NOT NULL AND TRIM(c_cnt.phone) != ''
        )
        OR EXISTS (
          SELECT 1 FROM absent_students a_p1
          WHERE a_p1.group_name = grp.group_name
            AND a_p1.date = grp.session_date${line ? ' AND a_p1.line = grp.line' : ''}
            AND (
              (a_p1.phone IS NOT NULL AND TRIM(a_p1.phone) = TRIM(c.phone))
              OR (a_p1.student_name IS NOT NULL AND LOWER(TRIM(a_p1.student_name)) = LOWER(TRIM(c.name)))
            )
        )
      )
    ${dept1}${emp1}${coord1}${srch1}`;

  const rdSQL = `date(substr(r2.added_at,7,4)||'-'||substr(r2.added_at,4,2)||'-'||substr(r2.added_at,1,2))`;
  const part2 = `
    SELECT DISTINCT
      COALESCE(c2.name, r2.client_name)       AS client_name,
      r2.client_phone,
      c2.group_name,
      date(${rdSQL}, '-1 day')                AS session_date,
      COALESCE(r2.assigned_to, b2.coordinators) AS coordinators,
      COALESCE(
        (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(r2.assigned_to)) AND u.department != 'All' LIMIT 1),
        (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(b2.coordinators)) AND u.department != 'All' LIMIT 1),
        b2.dept_type
      ) AS dept_type
    FROM remarks r2
    LEFT JOIN clients c2 ON c2.phone = r2.client_phone${line ? ' AND c2.line = r2.line' : ''}
      AND c2.group_name = COALESCE(
        (SELECT cl.group_name FROM clients cl
         INNER JOIN batches bl ON bl.group_name = cl.group_name${line ? ' AND bl.line = cl.line' : ''}
         WHERE cl.phone = r2.client_phone
           AND bl.start_date IS NOT NULL
           AND bl.start_date <= ${rdSQL}${line ? ` AND cl.line = '${line.replace(/'/g, "''")}'` : ''}
         ORDER BY bl.start_date DESC LIMIT 1),
        (SELECT cl2.group_name FROM clients cl2
         WHERE cl2.phone = r2.client_phone${line ? ` AND cl2.line = '${line.replace(/'/g, "''")}'` : ''} ORDER BY cl2.group_name ASC LIMIT 1)
      )
    LEFT JOIN batches b2 ON b2.group_name = c2.group_name${line ? ' AND b2.line = c2.line' : ''}
    WHERE r2.category = 'Attendance Zoom Call'
    ${dept2}${emp2}${coord2}${srch2}${lineR2}`;

  const remarksSubQ = `
    SELECT client_phone,
      date(substr(added_at,7,4)||'-'||substr(added_at,4,2)||'-'||substr(added_at,1,2)) AS rdate,
      MAX(id) AS id, MAX(details) AS details, MAX(added_at) AS added_at,
      MAX(assigned_to) AS assigned_to, MAX(status) AS status
    FROM remarks WHERE category = 'Attendance Zoom Call'${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
    GROUP BY client_phone, date(substr(added_at,7,4)||'-'||substr(added_at,4,2)||'-'||substr(added_at,1,2))`;

  const outerCoordFilter = safeCoord
    ? ` AND TRIM(LOWER(abs_union.coordinators)) LIKE LOWER('%${safeCoord}%')`
    : '';

  return `
    SELECT
      abs_union.client_name, abs_union.client_phone, abs_union.group_name,
      abs_union.session_date, abs_union.coordinators, abs_union.dept_type,
      ${nextRemarkDay('abs_union.session_date')} AS expected_remark_date,
      r.id AS remark_id, r.details AS remark_details, r.added_at AS remark_date,
      r.assigned_to, r.status AS remark_status,
      CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END AS has_remark
    FROM (
      SELECT client_name, client_phone, group_name, session_date, coordinators, dept_type
      FROM (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY
              COALESCE(NULLIF(TRIM(client_phone),''), LOWER(TRIM(COALESCE(client_name,'')))),
              group_name,
              session_date
            ORDER BY
              CASE WHEN client_name IS NOT NULL AND TRIM(client_name) != '' THEN 0 ELSE 1 END,
              CASE WHEN dept_type IS NOT NULL AND dept_type != 'All' THEN 0 ELSE 1 END,
              CASE WHEN coordinators IS NOT NULL AND TRIM(coordinators) != '' THEN 0 ELSE 1 END
          ) AS _rn
        FROM (
          SELECT * FROM (${partA}) pA
          UNION ALL
          SELECT * FROM (${part1}) p1
          UNION ALL
          SELECT * FROM (${part2}) p2
        ) _u
      ) _ranked
      WHERE _rn = 1
    ) abs_union
    LEFT JOIN (${remarksSubQ}) r
      ON r.client_phone = abs_union.client_phone
      AND r.rdate = (${nextRemarkDay('abs_union.session_date')})
    WHERE abs_union.session_date IS NOT NULL ${dateFilter}${outerCoordFilter}`;
}

// Multi-line tenant filter — appends " AND <alias>.line = '<line>'" to a WHERE clause.
// Pass alias for aliased tables (e.g. 'b', 'r', 'l'); pass '' for plain column reference.
// When line is null (admin 'All'), returns '' so no filter is applied.
function buildLineFilter(alias, line) {
  if (!line) return '';
  const col = alias ? `${alias}.line` : 'line';
  const safe = line.replace(/'/g, "''");
  return ` AND ${col} = '${safe}'`;
}

// Friday-skip helpers — Friday is the weekly day off.
//
// nextRemarkDay(col): given a lecture/absence date column or expression,
//   returns the expected remark date:
//   - Thursday (strftime %w = '4') → Saturday (+2 days, skip Friday)
//   - Any other day               → next day (+1 day)
//
// prevLectureDay(rdSQL): given a remark date expression (used in part3 to
//   work backwards from the remark to the lecture date):
//   - Saturday remark (strftime %w = '6') → Thursday (-2 days, skip Friday)
//   - Any other remark day               → previous day (-1 day)
const nextRemarkDay = (col) =>
  `CASE WHEN strftime('%w', ${col}) = '4' THEN date(${col}, '+2 days') ELSE date(${col}, '+1 day') END`;

const prevLectureDay = (rdSQL) =>
  `CASE WHEN strftime('%w', ${rdSQL}) = '6' THEN date(${rdSQL}, '-2 days') ELSE date(${rdSQL}, '-1 day') END`;

// ─── GET /api/reports/dashboard ───────────────────────────────────────────────
router.get('/dashboard', (req, res) => {
  const { from_date, to_date, department, employee } = req.query;
  const line = lineFilter(req);
  const lineBatches = buildLineFilter('batches', line);
  const lineB       = buildLineFilter('b', line);
  const lineL       = buildLineFilter('lectures', line);
  const lineLA      = buildLineFilter('l', line);
  const lineA       = buildLineFilter('a', line);
  const lineRemarks = buildLineFilter('remarks', line);

  const deptBatches = buildDeptFilter('batches', department);
  const deptB       = buildDeptFilter('b', department);
  const empFilter   = buildCoordFilter('batches', employee);
  const empBFilter  = buildCoordFilter('b', employee);
  const empRemark   = employee ? ` AND remarks.assigned_to LIKE '%${employee.replace(/'/g,"''")}%'` : '';

  // Remarks dept filter — coordinator-first (Fix 16) + team_members fallback (Fix 9).
  // Centralized helper ensures dashboard KPIs and /remarks-list match exactly.
  const deptRemark  = buildDeptRemarkFilter('remarks', department);

  try {
    // 1. Active groups (3 statuses)
    const activeGroupsList = db.prepare(
      `SELECT * FROM batches WHERE status='نشطة'${deptBatches}${empFilter}${lineBatches} ORDER BY start_date DESC`
    ).all();

    const waitingTraineesList = db.prepare(
      `SELECT * FROM batches WHERE status='بانتظار تسجيل المتدربين'${deptBatches}${empFilter}${lineBatches} ORDER BY start_date DESC`
    ).all();

    const waitingLecturesList = db.prepare(
      `SELECT * FROM batches WHERE status='بانتظار تسجيل المحاضرات'${deptBatches}${empFilter}${lineBatches} ORDER BY start_date DESC`
    ).all();

    // 2. Expired active groups
    const expiredGroupsList = db.prepare(
      `SELECT * FROM batches
       WHERE status='نشطة'
         AND end_date IS NOT NULL
         AND end_date != ''
         AND end_date <= date('now', '+2 hours')
       ${deptBatches}${empFilter}${lineBatches}
       ORDER BY end_date DESC`
    ).all();

    // 3. Main lectures count — session_type='main' (uploaded from "Lecture" Excel sheet)
    // Only confirmed lectures count — status='مؤكدة'
    const mainLecturesRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM lectures
       INNER JOIN batches ON lectures.group_name = batches.group_name${line ? ' AND batches.line = lectures.line' : ''}
       WHERE lectures.session_type = 'main'
         AND lectures.status != 'غير مؤكدة'
       ${buildDateFilter('lectures.date', from_date, to_date)}
       ${deptBatches}${empFilter}${lineL}`
    ).get();

    // 4. Side sessions count — all confirmed side sessions
    const sideLecturesRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM lectures
       INNER JOIN batches ON lectures.group_name = batches.group_name${line ? ' AND batches.line = lectures.line' : ''}
       WHERE lectures.session_type = 'side'
         AND lectures.status != 'غير مؤكدة'
       ${buildDateFilter('lectures.date', from_date, to_date)}
       ${deptBatches}${empFilter}${lineL}`
    ).get();

    // 4b. Zoom calls count — confirmed regular side sessions (15 min only)
    const zoomCallsRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM lectures
       INNER JOIN batches ON lectures.group_name = batches.group_name${line ? ' AND batches.line = lectures.line' : ''}
       WHERE lectures.session_type = 'side'
         AND lectures.status != 'غير مؤكدة'
         AND lectures.side_session_category = 'regular'
       ${buildDateFilter('lectures.date', from_date, to_date)}
       ${deptBatches}${empFilter}${lineL}`
    ).get();

    // 5. Absent main — Part1: absent_students with name lookup + date inference from lecture_no
    //                   Part2: main lectures with no absences
    // Date inference: if a.date is NULL but lecture_no is set, infer date from Nth main lecture for group
    const absentDateFP1 = from_date && to_date
      ? ` AND resolved_date BETWEEN '${from_date}' AND '${to_date}'`
      : from_date ? ` AND resolved_date >= '${from_date}'`
      : to_date   ? ` AND resolved_date <= '${to_date}'` : '';
    const absentDateL  = buildDateFilter('l.date', from_date, to_date);
    const absentDeptB  = buildDeptFilter('b', department);
    const absentDeptB2 = buildDeptFilter('b2', department);
    const absentEmpB   = buildCoordFilter('b', employee);
    const absentEmpB2  = buildCoordFilter('b2', employee);
    const absentMainRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM (
         SELECT group_name FROM (
           SELECT a.group_name,
             COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date) AS resolved_date
           FROM absent_students a
           LEFT JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
           LEFT JOIN clients c_lu ON (a.student_name IS NULL OR TRIM(a.student_name)='')
             AND a.phone IS NOT NULL AND TRIM(a.phone)!='' AND c_lu.phone = a.phone${line ? ' AND c_lu.line = a.line' : ''}
           LEFT JOIN (
             SELECT group_name, date, line,
               ROW_NUMBER() OVER (PARTITION BY group_name ORDER BY date) AS lec_num
             FROM lectures WHERE session_type = 'main' AND status != 'غير مؤكدة'${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
           ) lec_inf ON (a.date IS NULL OR TRIM(a.date)='')
             AND lec_inf.group_name = a.group_name
             AND a.lecture_no IS NOT NULL
             AND lec_inf.lec_num = a.lecture_no${line ? ' AND lec_inf.line = a.line' : ''}
           WHERE (
             (a.student_name IS NOT NULL AND TRIM(a.student_name)!='')
             OR (a.phone IS NOT NULL AND TRIM(a.phone)!='' AND c_lu.name IS NOT NULL)
           )
           ${absentDeptB}${absentEmpB}${lineA}
         ) p1_inner
         WHERE 1=1${absentDateFP1}
         UNION ALL
         SELECT l.group_name FROM lectures l
         INNER JOIN batches b2 ON l.group_name = b2.group_name${line ? ' AND b2.line = l.line' : ''}
         INNER JOIN clients c ON c.group_name = l.group_name${line ? ' AND c.line = l.line' : ''}
         WHERE l.session_type = 'main'
           AND l.status = 'مؤكدة'
           AND (l.attendance IS NULL OR TRIM(l.attendance) = '')
           AND c.name IS NOT NULL AND TRIM(c.name)!=''
           AND c.phone IS NOT NULL AND TRIM(c.phone)!=''
           AND NOT EXISTS (
             SELECT 1 FROM absent_students a2
             WHERE a2.group_name = l.group_name AND a2.date = l.date${line ? ' AND a2.line = l.line' : ''}
           )
         ${absentDateL}${absentDeptB2}${absentEmpB2}${lineLA}
       )`
    ).get();

    // 6. Absent zoom call — grouped per group+date.
    // Side sessions are per-student 15-min slots, so the expected count
    // for a specific date is COUNT(*) of side rows on that date (NOT
    // batch.trainee_count which covers the whole group across all dates).
    // Must match the formula in /absent-side-list exactly to avoid
    // KPI-vs-modal mismatches.
    // ⚠ Doubling fix — smart canonical line approach:
    // Batches can have the same group_name in BOTH lines (Ahmed Hassan + Dardasha).
    // Lectures may be uploaded under only ONE line (e.g. Ahmed Hassan).
    // Strategy: for each group, resolve the ACTUAL line where lecture data exists
    // via a correlated subquery. Then JOIN with AND l.line = b.line to ensure each
    // lecture row is counted exactly ONCE regardless of which admin line filter is active.
    //
    // • admin "الكل" (no line) : canonical line = actual lecture line → no doubling ✓
    // • admin "Dardasha"       : canonical line = 'Ahmed Hassan' (where lectures are) → finds data ✓
    const absentSideBatchSubQ = line
      ? `(SELECT b.group_name,
           COALESCE(lc.canonical_line, MIN(b.line)) AS line,
           MAX(b.coordinators) AS coordinators, MAX(b.dept_type) AS dept_type
         FROM batches b
         LEFT JOIN (SELECT group_name, MIN(line) AS canonical_line FROM lectures WHERE session_type = 'side' GROUP BY group_name) lc ON lc.group_name = b.group_name
         WHERE b.line = '${line.replace(/'/g, "''")}'
         GROUP BY b.group_name)`
      : `(SELECT b.group_name,
           COALESCE(lc.canonical_line, MIN(b.line)) AS line,
           MAX(b.coordinators) AS coordinators, MAX(b.dept_type) AS dept_type
         FROM batches b
         LEFT JOIN (SELECT group_name, MIN(line) AS canonical_line FROM lectures WHERE session_type = 'side' GROUP BY group_name) lc ON lc.group_name = b.group_name
         GROUP BY b.group_name)`;
    const absentSideRow = db.prepare(
      `SELECT COALESCE(SUM(absent_count), 0) as cnt FROM (
         SELECT
           COUNT(*) -
           SUM(CASE WHEN l.attendance IS NOT NULL AND l.attendance != '' AND CAST(l.attendance AS INTEGER) > 0 THEN 1 ELSE 0 END) AS absent_count
         FROM lectures l
         INNER JOIN ${absentSideBatchSubQ} b ON l.group_name = b.group_name AND l.line = b.line
         WHERE l.session_type = 'side'
           AND l.status = 'مؤكدة'
           AND (l.duration IS NULL OR l.duration <= '00:15')
         ${buildDateFilter('l.date', from_date, to_date)}
         ${deptB}${empBFilter}
         GROUP BY l.group_name, l.date
         HAVING absent_count > 0
       )`
    ).get();

    // added_at is stored as "DD/MM/YYYY, HH:MM AM/PM" — convert to ISO date for comparison
    const remarkDateExpr = `date(substr(remarks.added_at,7,4)||'-'||substr(remarks.added_at,4,2)||'-'||substr(remarks.added_at,1,2))`;

    // 7. Open remarks — count only for KPI, limited list for dashboard table
    const openRemarksCount = db.prepare(
      `SELECT COUNT(*) as cnt FROM remarks
       WHERE LOWER(status) NOT IN ('closed','مغلق','resolved')
       ${buildDateFilter(remarkDateExpr, from_date, to_date)}
       ${empRemark}${deptRemark}${lineRemarks}`
    ).get();

    const openRemarksList = db.prepare(
      `SELECT id, client_name, client_phone, details, category, status, priority, assigned_to, added_at, last_updated
       FROM remarks
       WHERE LOWER(status) NOT IN ('closed','مغلق','resolved')
       ${buildDateFilter(remarkDateExpr, from_date, to_date)}
       ${empRemark}${deptRemark}${lineRemarks}
       ORDER BY added_at DESC
       LIMIT 150`
    ).all();

    // 8a. Remarks errors (open >= 3 hours) — limited to 200 rows
    const remarksErrors = db.prepare(
      `SELECT id, client_name, client_phone, status, assigned_to, added_at, last_updated,
         ROUND((julianday('now') - julianday(added_at)) * 24, 1) as hours_open,
         CASE
           WHEN ROUND((julianday('now') - julianday(added_at)) * 24, 1) > 72  THEN 'overdue'
           WHEN ROUND((julianday('now') - julianday(added_at)) * 24, 1) > 48  THEN 'normal'
           WHEN ROUND((julianday('now') - julianday(added_at)) * 24, 1) > 24  THEN 'important'
           WHEN ROUND((julianday('now') - julianday(added_at)) * 24, 1) >= 3  THEN 'urgent'
           ELSE 'ok'
         END as urgency_level
       FROM remarks
       WHERE LOWER(status) NOT IN ('closed','مغلق','resolved')
         AND ROUND((julianday('now') - julianday(added_at)) * 24, 1) >= 3
         ${deptRemark}${lineRemarks}
       ORDER BY hours_open DESC
       LIMIT 200`
    ).all();

    // 8b. Lectures errors (completed < scheduled)
    const lecturesErrors = db.prepare(
      `SELECT group_name, scheduled_lectures, completed_lectures,
         (scheduled_lectures - completed_lectures) as missing_lectures,
         dept_type, coordinators, start_date, end_date
       FROM batches
       WHERE status='نشطة' AND scheduled_lectures > completed_lectures
       ${deptBatches}${empFilter}${lineBatches}
       ORDER BY missing_lectures DESC`
    ).all();

    // 8c. Side session errors (count < trainee_count * 7)
    const sideSessionErrors = db.prepare(
      `SELECT b.group_name, b.trainee_count, b.dept_type, b.coordinators,
         COUNT(l.id) as side_count,
         (b.trainee_count * 7) as expected_side_count
       FROM batches b
       LEFT JOIN lectures l ON l.group_name = b.group_name AND l.session_type = 'side' AND l.status != 'غير مؤكدة'${line ? ' AND l.line = b.line' : ''}
       WHERE b.status = 'نشطة'
       ${deptB}${empBFilter}${lineB}
       GROUP BY b.group_name
       HAVING side_count < expected_side_count
       ORDER BY (expected_side_count - side_count) DESC`
    ).all();

    return res.json({
      kpis: {
        active_groups:         activeGroupsList.length,
        waiting_trainees:      waitingTraineesList.length,
        waiting_lectures:      waitingLecturesList.length,
        expired_active_groups: expiredGroupsList.length,
        main_lectures:         mainLecturesRow?.cnt ?? 0,
        side_sessions:         sideLecturesRow?.cnt ?? 0,
        zoom_calls:            zoomCallsRow?.cnt ?? 0,
        absent_main:           absentMainRow?.cnt ?? 0,
        absent_zoom:           absentSideRow?.cnt ?? 0,
        open_remarks:          openRemarksCount?.cnt ?? 0,
        remarks_notes:         (() => {
          // KPI = sum of the totals returned by /remarks-notes-main and
          // /remarks-notes-zoom. Uses the SAME builders the endpoints use so
          // the KPI always equals the grand total shown in the drill-down modal.
          try {
            const mainQ = buildRemarksNotesMainInnerQ({
              from_date, to_date, department, employee, line,
            });
            const zoomQ = buildRemarksNotesZoomInnerQ({
              from_date, to_date, department, employee, line,
            });
            const mainCnt = db.prepare(`SELECT COUNT(*) as cnt FROM (${mainQ}) t`).get()?.cnt ?? 0;
            const zoomCnt = db.prepare(`SELECT COUNT(*) as cnt FROM (${zoomQ}) t`).get()?.cnt ?? 0;
            return mainCnt + zoomCnt;
          } catch (e) {
            console.error('[reports] remarks_notes KPI error:', e);
            return 0;
          }
        })(),
      },
      active_groups_list:     activeGroupsList,
      waiting_trainees_list:  waitingTraineesList,
      waiting_lectures_list:  waitingLecturesList,
      expired_groups_list:    expiredGroupsList,
      open_remarks_list:    openRemarksList,
      groups_with_errors: {
        remarks_errors:      remarksErrors,
        lectures_errors:     lecturesErrors,
        side_session_errors: sideSessionErrors,
      },
    });
  } catch (err) {
    console.error('[reports] dashboard error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/lectures-list ──────────────────────────────────────────
router.get('/lectures-list', (req, res) => {
  const {
    from_date, to_date, department, employee,
    session_type = 'main', page = 1, limit = 100,
    search = '', trainer = '', coordinator = '',
    modal_from = '', modal_to = '',
    min_duration = '', max_duration = '',  // optional duration range filters
    group_name = '', category = '',        // for ob_count popup: exact group + category
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const line = lineFilter(req);
  const lineL = buildLineFilter('l', line);
  const deptFilter        = buildDeptFilter('b', department);
  const empFilter         = buildCoordFilter('b', employee);
  const searchEsc         = search.replace(/%/g, '\\%').replace(/_/g, '\\_');
  const searchFilter      = search      ? ` AND l.group_name LIKE '%${searchEsc}%' ESCAPE '\\'` : '';
  const trainerFilter     = trainer     ? ` AND l.trainer LIKE '%${trainer}%'` : '';
  const coordFilter       = buildCoordFilter('b', coordinator);
  const groupFilter       = group_name  ? ` AND l.group_name = '${group_name.replace(/'/g, "''")}'` : '';
  const categoryFilter    = category    ? ` AND l.side_session_category = '${category}'` : '';
  // Duration filters (HH:MM string comparison works correctly for same-format values)
  const minDurFilter      = min_duration ? ` AND l.duration >= '${min_duration}'` : '';
  const maxDurFilter      = max_duration ? ` AND l.duration <= '${max_duration}'` : '';
  // Modal date overrides outer date if provided
  const activFrom  = modal_from || from_date;
  const activTo    = modal_to   || to_date;
  const dateFilter = activFrom && activTo ? ` AND l.date BETWEEN '${activFrom}' AND '${activTo}'`
                   : activFrom ? ` AND l.date >= '${activFrom}'`
                   : activTo   ? ` AND l.date <= '${activTo}'` : '';

  // When min_duration is set (main lectures mode), ignore session_type filter — use duration to identify them
  const sessionTypeFilter = min_duration ? '' : ` AND l.session_type = '${session_type}'`;
  // Only confirmed lectures count in any CS report
  const statusFilter = ` AND l.status != 'غير مؤكدة'`;

  const allFilters = `${sessionTypeFilter}${statusFilter}${minDurFilter}${maxDurFilter}${dateFilter}${deptFilter}${empFilter}${trainerFilter}${coordFilter}${searchFilter}${groupFilter}${categoryFilter}${lineL}`;

  // For side sessions: pre-aggregate onboarding/offboarding/compensatory per group (one JOIN instead of N subqueries)
  // Only confirmed sessions are counted toward category totals
  const sideJoin = (!min_duration && session_type === 'side')
    ? `LEFT JOIN (
         SELECT group_name, line,
           SUM(CASE WHEN side_session_category='onboarding'    THEN 1 ELSE 0 END) AS onboarding_count,
           SUM(CASE WHEN side_session_category='offboarding'   THEN 1 ELSE 0 END) AS offboarding_count,
           SUM(CASE WHEN side_session_category='compensatory'  THEN 1 ELSE 0 END) AS compensatory_count
         FROM lectures WHERE session_type='side' AND status != 'غير مؤكدة'${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
         GROUP BY group_name, line
       ) lx_counts ON lx_counts.group_name = l.group_name${line ? ' AND lx_counts.line = l.line' : ''}`
    : '';
  const sideExtraFields = (!min_duration && session_type === 'side')
    ? `, COALESCE(lx_counts.onboarding_count,0) AS onboarding_count, COALESCE(lx_counts.offboarding_count,0) AS offboarding_count, COALESCE(lx_counts.compensatory_count,0) AS compensatory_count`
    : '';

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM lectures l
       LEFT JOIN batches b ON l.group_name = b.group_name${line ? ' AND b.line = l.line' : ''}
       WHERE 1=1${allFilters}`
    ).get();

    const rows = db.prepare(
      `SELECT l.*,
         COALESCE((SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(b.coordinators)) LIMIT 1), b.dept_type) AS dept_type,
         b.coordinators, b.lecture_duration_min${sideExtraFields}
       FROM lectures l
       LEFT JOIN batches b ON l.group_name = b.group_name${line ? ' AND b.line = l.line' : ''}
       ${sideJoin}
       WHERE 1=1${allFilters}
       ORDER BY l.date DESC LIMIT ${Number(limit)} OFFSET ${offset}`
    ).all();

    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/absent-list ─────────────────────────────────────────────
router.get('/absent-list', (req, res) => {
  const {
    from_date, to_date, department, employee,
    page = 1, limit = 100, search = '',
    coordinator = '', modal_from = '', modal_to = '', modal_dept = '',
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const line = lineFilter(req);
  const lineA = buildLineFilter('a', line);
  const lineL = buildLineFilter('l', line);

  // Modal filters override outer filters when provided
  const activeDept  = modal_dept  && modal_dept  !== 'All' ? modal_dept  : (department && department !== 'All' ? department : '');
  const activeFrom  = modal_from  || from_date;
  const activeTo    = modal_to    || to_date;

  const deptFilter   = buildDeptFilter('b', activeDept);
  const empFilter    = buildCoordFilter('b', employee);
  const coordFilter  = buildCoordFilter('b', coordinator);
  const searchFilter = search     ? ` AND a.group_name LIKE '%${escapeLike(search)}%' ESCAPE '\\'` : '';
  // Part1 date filter uses computed 'date' column (after inference), not raw a.date
  const dateFilterP1 = activeFrom && activeTo ? ` AND date BETWEEN '${activeFrom}' AND '${activeTo}'`
                     : activeFrom ? ` AND date >= '${activeFrom}'`
                     : activeTo   ? ` AND date <= '${activeTo}'` : '';

  // Part2 filters use l/b2 aliases
  const dateFilter2  = activeFrom && activeTo ? ` AND l.date BETWEEN '${activeFrom}' AND '${activeTo}'`
                     : activeFrom ? ` AND l.date >= '${activeFrom}'`
                     : activeTo   ? ` AND l.date <= '${activeTo}'` : '';
  const deptFilter2  = buildDeptFilter('b2', activeDept);
  const empFilter2   = buildCoordFilter('b2', employee);
  const coordFilter2 = buildCoordFilter('b2', coordinator);
  const searchFilter2= search      ? ` AND l.group_name LIKE '%${escapeLike(search)}%' ESCAPE '\\'` : '';

  // Part1: absent_students — with name lookup + date inference from lecture_no when date is missing
  const part1 = `
    SELECT student_name, phone, group_name, date, time, lecture_no, dept_type, coordinators
    FROM (
      SELECT
        COALESCE(
          CASE WHEN a.phone IS NOT NULL AND TRIM(a.phone)!='' THEN
            (SELECT c.name FROM clients c WHERE c.phone = a.phone LIMIT 1)
          END,
          NULLIF(TRIM(a.student_name),'')
        ) AS student_name,
        a.phone, a.group_name,
        COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date) AS date,
        a.time, a.lecture_no,
        COALESCE(
          (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(b.coordinators)) LIMIT 1),
          b.dept_type
        ) AS dept_type,
        b.coordinators
      FROM absent_students a
      LEFT JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
      LEFT JOIN (
        SELECT group_name, date, line,
          ROW_NUMBER() OVER (PARTITION BY group_name ORDER BY date) AS lec_num
        FROM lectures WHERE session_type = 'main' AND status != 'غير مؤكدة'${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
      ) lec_inf ON (a.date IS NULL OR TRIM(a.date)='')
        AND lec_inf.group_name = a.group_name
        AND a.lecture_no IS NOT NULL
        AND lec_inf.lec_num = a.lecture_no${line ? ' AND lec_inf.line = a.line' : ''}
      WHERE (
        (a.student_name IS NOT NULL AND TRIM(a.student_name)!='')
        OR (a.phone IS NOT NULL AND TRIM(a.phone)!='' AND EXISTS (SELECT 1 FROM clients c WHERE c.phone = a.phone${line ? ' AND c.line = a.line' : ''}))
      )
      ${deptFilter}${empFilter}${coordFilter}${searchFilter}${lineA}
    ) p1_inner
    WHERE 1=1${dateFilterP1}`;

  // Part2: main lectures with NO absence records → all students in group treated as absent
  const part2 = `
    SELECT
      c.name AS student_name,
      c.phone, l.group_name, l.date, l.time, NULL AS lecture_no,
      COALESCE(
        (SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(b2.coordinators)) LIMIT 1),
        b2.dept_type
      ) AS dept_type,
      b2.coordinators
    FROM lectures l
    INNER JOIN batches b2 ON l.group_name = b2.group_name${line ? ' AND b2.line = l.line' : ''}
    INNER JOIN clients c ON c.group_name = l.group_name${line ? ' AND c.line = l.line' : ''}
    WHERE l.session_type = 'main'
      AND l.status = 'مؤكدة'
      AND (l.attendance IS NULL OR TRIM(l.attendance) = '')
      AND c.name IS NOT NULL AND TRIM(c.name)!=''
      AND c.phone IS NOT NULL AND TRIM(c.phone)!=''
      AND NOT EXISTS (
        SELECT 1 FROM absent_students a2
        WHERE a2.group_name = l.group_name AND a2.date = l.date${line ? ' AND a2.line = l.line' : ''}
      )
    ${dateFilter2}${deptFilter2}${empFilter2}${coordFilter2}${searchFilter2}${lineL}`;

  const unionQ = `SELECT * FROM (${part1} UNION ALL ${part2}) t`;

  try {
    const totalRow = db.prepare(`SELECT COUNT(*) as cnt FROM (${part1} UNION ALL ${part2}) t`).get();
    const rows     = db.prepare(`${unionQ} ORDER BY date DESC LIMIT ${Number(limit)} OFFSET ${offset}`).all();
    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
    console.error('[absent-list]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/absent-side-list ────────────────────────────────────────
// Grouped per group_name + date
// present_count  = sessions where attendance > 0
// absent_count   = trainee_count - present_count
// Only valid side sessions: duration <= '00:15' (excludes Onboarding/Offboarding)
router.get('/absent-side-list', (req, res) => {
  const {
    from_date, to_date, department, employee,
    page = 1, limit = 100, search = '',
    trainer = '', coordinator = '', modal_from = '', modal_to = '', modal_dept = '',
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const line = lineFilter(req);
  const lineL = buildLineFilter('l', line);

  const activeDept = modal_dept && modal_dept !== 'All' ? modal_dept : (department && department !== 'All' ? department : '');
  const activeFrom = modal_from || from_date;
  const activeTo   = modal_to   || to_date;

  const deptFilter    = buildDeptFilter('b', activeDept);
  const empFilter     = buildCoordFilter('b', employee);
  const trainerFilter = trainer     ? ` AND l.trainer LIKE '%${escapeLike(trainer)}%' ESCAPE '\\'` : '';
  const coordFilter   = buildCoordFilter('b', coordinator);
  const searchFilter  = search      ? ` AND l.group_name LIKE '%${escapeLike(search)}%' ESCAPE '\\'` : '';
  const dateFilter    = activeFrom && activeTo
    ? ` AND l.date BETWEEN '${activeFrom}' AND '${activeTo}'`
    : activeFrom ? ` AND l.date >= '${activeFrom}'`
    : activeTo   ? ` AND l.date <= '${activeTo}'` : '';

  // Note: line scoping is handled by batchSubQ (groups belonging to the selected line),
  // NOT by filtering l.line directly. This allows Dardasha-line groups to find their
  // lectures even if those lectures are stored under a different line value.
  const baseWhere = `
    WHERE l.session_type = 'side'
      AND l.status = 'مؤكدة'
      AND (l.duration IS NULL OR l.duration <= '00:15')
    ${dateFilter}${deptFilter}${empFilter}${trainerFilter}${coordFilter}${searchFilter}`;

  // NOTE: Side sessions are per-student 15-min slots — each row in `lectures`
  // represents one student's scheduled session on that date, NOT the whole group.
  // So the "expected" count for a specific date is COUNT(*) of side rows on that
  // date, NOT batch.trainee_count (which covers the entire group).
  // Example: group with 2 trainees → one slot on Apr 19, another on Apr 20 →
  //   COUNT(*) per date = 1, not 2.
  //
  // ⚠ Doubling fix — smart canonical line approach:
  // Batches can have the same group_name in BOTH lines. Lectures may only exist for
  // one line. Resolve the ACTUAL lecture line per group so AND l.line = b.line
  // counts each lecture row exactly once.
  // • admin "الكل" (no line) : canonical = actual lecture line → no doubling ✓
  // • admin "Dardasha"       : canonical = 'Ahmed Hassan' (lectures stored there) → finds data ✓
  const batchSubQ = line
    ? `(SELECT b.group_name,
         COALESCE(lc.canonical_line, MIN(b.line)) AS line,
         MAX(b.coordinators) AS coordinators, MAX(b.dept_type) AS dept_type
       FROM batches b
       LEFT JOIN (SELECT group_name, MIN(line) AS canonical_line FROM lectures WHERE session_type = 'side' GROUP BY group_name) lc ON lc.group_name = b.group_name
       WHERE b.line = '${line.replace(/'/g, "''")}'
       GROUP BY b.group_name)`
    : `(SELECT b.group_name,
         COALESCE(lc.canonical_line, MIN(b.line)) AS line,
         MAX(b.coordinators) AS coordinators, MAX(b.dept_type) AS dept_type
       FROM batches b
       LEFT JOIN (SELECT group_name, MIN(line) AS canonical_line FROM lectures WHERE session_type = 'side' GROUP BY group_name) lc ON lc.group_name = b.group_name
       GROUP BY b.group_name)`;

  const groupedQuery = `
    SELECT
      l.group_name,
      l.date                                                                    AS session_date,
      MAX(l.trainer)                                                            AS trainer,
      MAX(b.coordinators)                                                       AS coordinators,
      COALESCE(MAX((SELECT u.department FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(b.coordinators)) AND u.department != 'All' LIMIT 1)), MAX(b.dept_type)) AS dept_type,
      COUNT(*)                                                                  AS trainee_count,
      SUM(CASE WHEN l.attendance IS NOT NULL
               AND l.attendance != ''
               AND CAST(l.attendance AS INTEGER) > 0
               THEN 1 ELSE 0 END)                                               AS present_count,
      COUNT(*) -
      SUM(CASE WHEN l.attendance IS NOT NULL
               AND l.attendance != ''
               AND CAST(l.attendance AS INTEGER) > 0
               THEN 1 ELSE 0 END)                                               AS absent_count
    FROM lectures l
    INNER JOIN ${batchSubQ} b ON l.group_name = b.group_name AND l.line = b.line
    ${baseWhere}
    GROUP BY l.group_name, l.date
    HAVING absent_count > 0`;

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM (${groupedQuery})`
    ).get();

    const rows = db.prepare(
      `${groupedQuery}
       ORDER BY session_date DESC
       LIMIT ${Number(limit)} OFFSET ${offset}`
    ).all();

    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
    console.error('[reports] absent-side-list error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/remarks-list ───────────────────────────────────────────
router.get('/remarks-list', (req, res) => {
  const {
    from_date, to_date, department, employee,
    page = 1, limit = 100, search = '',
    assigned_to = '', priority = '',
    modal_from = '', modal_to = '', modal_dept = '',
    category_search = '', status_filter = '',
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const line = lineFilter(req);
  const lineR = buildLineFilter('r', line);
  const lineRemarks = buildLineFilter('remarks', line);

  const activeFrom = modal_from || from_date;
  const activeTo   = modal_to   || to_date;
  const activeDept = modal_dept && modal_dept !== 'All' ? modal_dept
                   : department && department !== 'All' ? department : '';

  const remarkDate     = `date(substr(added_at,7,4)||'-'||substr(added_at,4,2)||'-'||substr(added_at,1,2))`;
  const dateFilter     = activeFrom && activeTo ? ` AND ${remarkDate} BETWEEN '${activeFrom}' AND '${activeTo}'`
                       : activeFrom ? ` AND ${remarkDate} >= '${activeFrom}'`
                       : activeTo   ? ` AND ${remarkDate} <= '${activeTo}'` : '';
  const empFilter      = employee        ? ` AND assigned_to LIKE '%${escapeLike(employee)}%' ESCAPE '\\'` : '';
  const assignFilter   = assigned_to     ? ` AND assigned_to LIKE '%${escapeLike(assigned_to)}%' ESCAPE '\\'` : '';
  const priorityFilter = priority        ? ` AND priority = '${priority}'` : '';
  const categoryFilter = category_search ? ` AND category LIKE '%${escapeLike(category_search)}%' ESCAPE '\\'` : '';
  const statusFilter   = status_filter   ? ` AND status = '${status_filter}'` : '';
  const searchFilter   = search          ? ` AND (client_name LIKE '%${escapeLike(search)}%' OR details LIKE '%${escapeLike(search)}%') ESCAPE '\\'` : '';
  // Coordinator-first dept filter (Fix 16) with team_members fallback (Fix 9).
  // Uses alias 'remarks' — baseWhereR swap below converts to 'r' for the joined query.
  const deptFilter     = buildDeptRemarkFilter('remarks', activeDept);

  // added_at is stored as "DD/MM/YYYY, HH:MM AM/PM"
  // Convert to YYYY-MM-DD for date comparison with batches.start_date / end_date
  const dateConvert = `(substr(r.added_at,7,4) || '-' || substr(r.added_at,4,2) || '-' || substr(r.added_at,1,2))`;

  const baseWhere = `WHERE LOWER(remarks.status) NOT IN ('closed','مغلق','resolved')
    ${dateFilter}${empFilter}${assignFilter}${priorityFilter}${categoryFilter}${statusFilter}${deptFilter}${searchFilter}${lineRemarks}`;

  // Use CTE to pre-compute active batches per phone — avoids N+1 correlated subquery
  const withCte = `
    WITH active_batches AS (
      SELECT c.phone, b.group_name, b.start_date, b.end_date
      FROM clients c
      INNER JOIN batches b ON c.group_name = b.group_name${line ? ' AND b.line = c.line' : ''}
      WHERE b.status = 'نشطة'
        AND b.start_date IS NOT NULL AND b.start_date != ''
        AND b.end_date   IS NOT NULL AND b.end_date   != ''${line ? ` AND c.line = '${line.replace(/'/g, "''")}'` : ''}
    )`;

  const baseWhereR = baseWhere.replace(/\bremarks\b/g, 'r');

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM remarks r ${baseWhereR}`
    ).get();

    const rows = db.prepare(
      `${withCte}
       SELECT r.*,
         ROUND((julianday('now') - julianday(r.added_at)) * 24, 1) AS hours_open,
         CASE
           WHEN ROUND((julianday('now') - julianday(r.added_at)) * 24, 1) > 72  THEN 'overdue'
           WHEN ROUND((julianday('now') - julianday(r.added_at)) * 24, 1) > 48  THEN 'normal'
           WHEN ROUND((julianday('now') - julianday(r.added_at)) * 24, 1) > 24  THEN 'important'
           WHEN ROUND((julianday('now') - julianday(r.added_at)) * 24, 1) >= 3  THEN 'urgent'
           ELSE 'ok'
         END AS urgency_level,
         (SELECT ab.group_name FROM active_batches ab
          WHERE ab.phone = r.client_phone
            AND ab.start_date <= ${dateConvert}
            AND ab.end_date   >= ${dateConvert}
          LIMIT 1) AS active_group
       FROM remarks r
       ${baseWhereR}
       ORDER BY r.added_at DESC
       LIMIT ${Number(limit)} OFFSET ${offset}`
    ).all();

    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
    console.error('[reports] remarks-list error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/remarks-notes-main ─────────────────────────────────────
router.get('/remarks-notes-main', (req, res) => {
  const {
    from_date, to_date, department, employee,
    page = 1, limit = 100, search = '',
    modal_from = '', modal_to = '', modal_dept = '',
    coordinator = '', has_remark = '',
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const line = lineFilter(req);

  const activeFrom = modal_from || from_date;
  const activeTo   = modal_to   || to_date;
  const activeDept = modal_dept && modal_dept !== 'All' ? modal_dept : (department && department !== 'All' ? department : '');

  const innerQ = buildRemarksNotesMainInnerQ({
    from_date: activeFrom, to_date: activeTo, department: activeDept,
    employee, coordinator, search, line,
  });

  const havingFilter = has_remark === '1' ? ` AND has_remark = 1`
                     : has_remark === '0' ? ` AND has_remark = 0` : '';

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM (${innerQ}) t WHERE 1=1 ${havingFilter}`
    ).get();

    const rows = db.prepare(
      `SELECT * FROM (${innerQ}) t WHERE 1=1 ${havingFilter}
       ORDER BY absence_date DESC
       LIMIT ${Number(limit)} OFFSET ${offset}`
    ).all();

    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
    console.error('[reports] remarks-notes-main error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/remarks-notes-zoom ──────────────────────────────────────
// Two-source UNION approach:
//   Part 1: clients in FULLY-absent sessions (all attendance=0) → all clients in group are absent
//   Part 2: clients confirmed absent via 'Attendance Zoom Call' remarks
//           (covers partial-attendance groups + groups missing from clients table)
router.get('/remarks-notes-zoom', (req, res) => {
  const {
    from_date, to_date, department, employee,
    page = 1, limit = 100, search = '',
    modal_from = '', modal_to = '', modal_dept = '',
    coordinator = '', has_remark = '',
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const line = lineFilter(req);

  const activeFrom = modal_from || from_date;
  const activeTo   = modal_to   || to_date;
  const activeDept = modal_dept && modal_dept !== 'All' ? modal_dept : (department && department !== 'All' ? department : '');

  const innerQ = buildRemarksNotesZoomInnerQ({
    from_date: activeFrom, to_date: activeTo, department: activeDept,
    employee, coordinator, search, line,
  });

  const havingFilter = has_remark === '1' ? ` AND has_remark = 1`
                     : has_remark === '0' ? ` AND has_remark = 0` : '';

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM (${innerQ}) t WHERE 1=1 ${havingFilter}`
    ).get();

    const rows = db.prepare(
      `SELECT * FROM (${innerQ}) t WHERE 1=1 ${havingFilter}
       ORDER BY session_date DESC
       LIMIT ${Number(limit)} OFFSET ${offset}`
    ).all();

    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
    console.error('[reports] remarks-notes-zoom error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/remarks-categories ──────────────────────────────────────
router.get('/remarks-categories', (req, res) => {
  const {
    from_date, to_date, department, employee,
    page = 1, limit = 100, search = '',
    modal_from = '', modal_to = '', modal_dept = '',
    assigned_to = '', category_filter = '',
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const line = lineFilter(req);
  const lineR = buildLineFilter('r', line);

  const activeFrom = modal_from || from_date;
  const activeTo   = modal_to   || to_date;
  const activeDept = modal_dept && modal_dept !== 'All' ? modal_dept : (department && department !== 'All' ? department : '');

  const remarkDateSQL  = `date(substr(r.added_at,7,4)||'-'||substr(r.added_at,4,2)||'-'||substr(r.added_at,1,2))`;
  const safeDeptCat    = activeDept ? activeDept.replace(/'/g, "''") : '';
  const deptFilter     = activeDept
    ? ` AND EXISTS (SELECT 1 FROM clients cx INNER JOIN batches bx ON cx.group_name=bx.group_name WHERE cx.phone=r.client_phone AND (bx.dept_type='${safeDeptCat}' OR EXISTS (SELECT 1 FROM users u WHERE LOWER(TRIM(u.full_name))=LOWER(TRIM(bx.coordinators)) AND u.department='${safeDeptCat}')))`
    : '';
  const empFilter      = employee       ? ` AND r.assigned_to LIKE '%${escapeLike(employee)}%' ESCAPE '\\'` : '';
  const assignFilter   = assigned_to    ? ` AND r.assigned_to LIKE '%${escapeLike(assigned_to)}%' ESCAPE '\\'` : '';
  const catFilter      = category_filter ? ` AND r.category LIKE '%${escapeLike(category_filter)}%' ESCAPE '\\'` : '';
  const searchFilter   = search         ? ` AND (r.client_name LIKE '%${escapeLike(search)}%' OR r.category LIKE '%${escapeLike(search)}%' OR r.client_phone LIKE '%${escapeLike(search)}%') ESCAPE '\\'` : '';
  const dateFilter     = buildDateFilter(remarkDateSQL, activeFrom, activeTo);

  const baseWhere = `WHERE r.category IS NOT NULL AND TRIM(r.category) != ''
    ${dateFilter}${deptFilter}${empFilter}${assignFilter}${catFilter}${searchFilter}${lineR}`;

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM remarks r ${baseWhere}`
    ).get();

    const rows = db.prepare(
      `WITH cat_counts AS (
         SELECT category, COUNT(*) as cnt FROM remarks
         WHERE category IS NOT NULL AND TRIM(category) != ''${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
         GROUP BY category
       ),
       client_groups AS (
         SELECT c.phone, b.group_name, b.coordinators
         FROM clients c INNER JOIN batches b ON c.group_name = b.group_name${line ? ' AND b.line = c.line' : ''}${line ? ` WHERE c.line = '${line.replace(/'/g, "''")}'` : ''}
         GROUP BY c.phone
       )
       SELECT r.id, r.category,
         cc.cnt AS category_count,
         ${remarkDateSQL} AS remark_date_val,
         r.added_at AS remark_date_raw,
         r.client_name, r.client_phone, r.assigned_to,
         cg.group_name, cg.coordinators
       FROM remarks r
       LEFT JOIN cat_counts cc ON cc.category = r.category
       LEFT JOIN client_groups cg ON cg.phone = r.client_phone
       ${baseWhere}
       ORDER BY r.category, r.added_at DESC
       LIMIT ${Number(limit)} OFFSET ${offset}`
    ).all();

    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
    console.error('[reports] remarks-categories error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/code-problems ──────────────────────────────────────────
// Validates groups against business rules for main & side sessions
router.get('/code-problems', (req, res) => {
  const { department, employee, show_resolved } = req.query;
  const showResolved = show_resolved === 'true';
  const line = lineFilter(req);
  const lineB = buildLineFilter('b', line);
  const lineL = buildLineFilter('l', line);
  const lineCps = buildLineFilter('', line);

  // Dept filter:
  // - agent:  NO dept filter — coordinator name LIKE filter already restricts to their own groups.
  //           Applying dept_type filter causes false negatives when a group's stored dept_type
  //           doesn't match the coordinator's registered department (e.g., Ali Moaatz is General
  //           but his group is stored as Semi → group gets incorrectly excluded).
  // - leader: strict dept_type-only filter (no OR EXISTS) to prevent cross-dept leakage
  // - admin:  full buildDeptFilter (includes coordinator-based fallback)
  let deptFilter;
  if (req.user.role === 'agent') {
    deptFilter = '';
  } else if (req.user.role === 'leader') {
    // Leader: coordinator's registered dept is source of truth.
    // Include group if: coordinator registered in leader's dept, OR (coordinator NOT registered AND batch.dept_type matches).
    const dept = (!department || department === 'All') ? req.user.department : department;
    if (dept && dept !== 'All') {
      const s = dept.replace(/'/g, "''");
      deptFilter = ` AND (
          EXISTS (
            SELECT 1 FROM users u
            WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
              AND u.department = '${s}'
          )
          OR (
            b.dept_type = '${s}'
            AND NOT EXISTS (
              SELECT 1 FROM users u
              WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
                AND u.department IS NOT NULL AND u.department != 'All'
            )
          )
        )
        AND b.coordinators IS NOT NULL AND TRIM(b.coordinators) NOT IN ('', '--')`;
    } else {
      deptFilter = '';
    }
  } else {
    deptFilter = buildDeptFilter('b', department);
  }

  // If agent: force filter to their own groups using FULL name as one unit (not split by word)
  // Splitting by word causes cross-agent leakage: "Shrouk Ali" → LIKE '%Ali%' also matches "Ali Moaatz"
  let empFilter;
  if (req.user.role === 'agent') {
    const userRow = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id);
    const fullName = (userRow?.full_name || '').trim();
    if (fullName) {
      const safe = fullName.replace(/'/g, "''");
      // Match full name as a complete unit (handles single and multi-coordinator fields)
      empFilter = ` AND TRIM(LOWER(b.coordinators)) LIKE LOWER('%${safe}%')`;
    } else {
      empFilter = ' AND 1=0';
    }
  } else {
    empFilter = buildCoordFilter('b', employee);
  }

  // ── helpers ──
  const MONTHS  = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
  const DAY_NUM = { Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6 };
  const DAY_AR  = ['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];
  const DAY_EN  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Sat(6)+Tue(2) / Sun(0)+Wed(3) / Mon(1)+Thu(4)
  const getMainPair = d => {
    if (d===6||d===2) return [6,2];
    if (d===0||d===3) return [0,3];
    if (d===1||d===4) return [1,4];
    return null;
  };
  const getSidePair = d => {
    if (d===6||d===2) return [1,4]; // Sat+Tue main → Mon+Thu side
    if (d===0||d===3) return [6,2]; // Sun+Wed main → Sat+Tue side
    if (d===1||d===4) return [0,3]; // Mon+Thu main → Sun+Wed side
    return null;
  };
  const getDow = s => { if (!s) return -1; return new Date(s+'T12:00:00').getDay(); };
  const pad    = n => String(n).padStart(2,'0');

  const parseGroupName = name => {
    const m = name.match(/^([A-Za-z]{3})_(\d{1,2})_([A-Za-z]{2,4})_/);
    if (!m) return null;
    const monthNum = MONTHS[m[1]];
    const dayStr   = m[3];
    const dow      = DAY_NUM[dayStr];
    if (!monthNum || dow === undefined) return null;
    return { monthNum, dayNum: parseInt(m[2]), dayStr, dow };
  };

  try {
    const batches = db.prepare(
      `SELECT b.group_name, b.trainee_count,
              COALESCE(
                (SELECT u.department FROM users u
                 WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
                   AND u.department IS NOT NULL
                   AND u.department != 'All'
                 LIMIT 1),
                b.dept_type
              ) AS dept_type,
              b.coordinators, b.start_date
       FROM batches b WHERE status='نشطة'${deptFilter}${empFilter}${lineB}`
    ).all();

    // fetch all CONFIRMED main sessions with time + duration
    const mainRaw = db.prepare(
      `SELECT l.group_name, l.date, l.time, l.duration FROM lectures l
       INNER JOIN batches b ON l.group_name=b.group_name${line ? ' AND b.line = l.line' : ''}
       WHERE b.status='نشطة' AND l.session_type='main' AND l.status != 'غير مؤكدة'
       ${deptFilter}${empFilter}${lineL} ORDER BY l.group_name, l.date ASC`
    ).all();

    // fetch only CONFIRMED zoom call sessions (regular 15-min) for zoom-call problem checks
    const sideRaw = db.prepare(
      `SELECT l.group_name, l.date, l.time, l.duration FROM lectures l
       INNER JOIN batches b ON l.group_name=b.group_name${line ? ' AND b.line = l.line' : ''}
       WHERE b.status='نشطة' AND l.session_type='side' AND l.status != 'غير مؤكدة'
         AND LOWER(COALESCE(l.side_session_category,'regular')) = 'regular'
       ${deptFilter}${empFilter}${lineL} ORDER BY l.group_name, l.date ASC`
    ).all();

    // group by group_name (store full rows)
    const mainByGroup = {}, sideByGroup = {};
    mainRaw.forEach(r => { (mainByGroup[r.group_name] = mainByGroup[r.group_name]||[]).push(r); });
    sideRaw.forEach(r => { (sideByGroup[r.group_name] = sideByGroup[r.group_name]||[]).push(r); });

    // ── midnight rule helpers ──────────────────────────────────────────
    const parseTimeMins = t => {
      if (!t) return -1;
      const m = String(t).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (!m) return -1;
      let h = parseInt(m[1]), min = parseInt(m[2]);
      if (m[3]?.toUpperCase() === 'PM' && h < 12) h += 12;
      if (m[3]?.toUpperCase() === 'AM' && h === 12) h = 0;
      return h * 60 + min;
    };
    const parseDurMins = d => {
      if (!d) return 0;
      const m = String(d).match(/(\d{1,2}):(\d{2})/);
      return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0;
    };
    const addDays = (dateStr, n) => {
      const d = new Date(dateStr + 'T12:00:00');
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0,10);
    };
    // Returns effective date (next day if session ends after midnight)
    const effectiveDate = (date, time, duration) => {
      const start = parseTimeMins(time);
      if (start < 0) return date;
      return (start + parseDurMins(duration)) >= 1440 ? addDays(date, 1) : date;
    };

    // Expected last date for MAIN (8 sessions, 2/week)
    // First day of pair (Sat/Sun/Mon) → +24 days; second day (Tue/Wed/Thu) → +25 days
    const FIRST_IN_PAIR = new Set([6, 0, 1]); // Sat, Sun, Mon
    const expectedMainLast = firstDate => {
      const dow = getDow(firstDate);
      return addDays(firstDate, FIRST_IN_PAIR.has(dow) ? 24 : 25);
    };
    // Expected last date for SIDE (7 slot-dates, 2/week) → always +21 days
    const expectedSideLast = firstDate => addDays(firstDate, 21);

    // Load all stored statuses into a map for O(1) lookup
    const storedStatuses = db.prepare(`SELECT * FROM code_problem_status WHERE 1=1${lineCps}`).all();
    const statusMap = {};
    storedStatuses.forEach(s => { statusMap[`${s.group_name}|${s.problem_type}|${s.session_type}`] = s; });

    // Build rename map: new_group_code → { previous_group_name, updated_at }
    // Used to display "Previous code" badge when user searches by the new code name
    const renameMap = {};
    storedStatuses.forEach(s => {
      if (s.new_group_code && s.new_group_code.trim()) {
        const key = s.new_group_code.trim();
        // Keep the most recent rename entry per new code
        if (!renameMap[key] || s.updated_at > renameMap[key].updated_at) {
          renameMap[key] = {
            previous_group_name: s.group_name,
            updated_at: s.updated_at,
          };
        }
      }
    });

    // Helper: add problem respecting wont_repeat/exception rules
    // - If status is wont_repeat/exception AND actual <= actual_at_status → SKIP
    // - If status is wont_repeat/exception AND actual > actual_at_status → show as new with repeated_violation flag
    // - If status is wont_repeat/exception AND no actual (date-based) → SKIP
    const addProblem = (arr, problem, sessionType) => {
      const key = `${problem.group_name}|${problem.problem_type}|${sessionType}`;
      const s = statusMap[key];
      if (s && (s.status === 'wont_repeat' || s.status === 'exception' || s.status === 'resolved')) {
        if (showResolved) {
          // Include resolved items when explicitly requested (for filter view)
          problem._resolved_status = s.status;
          problem._status_note     = s.note;
          problem._status_by       = s.updated_by_name;
          problem._status_at       = s.updated_at;
          arr.push(problem);
          return;
        }
        if (problem.actual != null && s.actual_at_status != null) {
          if (problem.actual <= s.actual_at_status) return; // still same or less → skip
          // Count increased → employee repeated the mistake
          problem.repeated_violation = true;
          problem.previous_status    = s.status;
          problem.previous_actual    = s.actual_at_status;
        } else {
          return; // date-based problem → skip
        }
      }
      arr.push(problem);
    };

    const mainProblems = [], zoomProblems = [];

    for (const batch of batches) {
      const gn        = batch.group_name;
      const parsed    = parseGroupName(gn);
      const mainRows  = mainByGroup[gn] || [];
      const sideRows  = sideByGroup[gn] || [];
      const mainDates = mainRows.map(r => r.date);
      const sideDates = sideRows.map(r => r.date);
      // Unique sorted side slot-dates (multiple sessions per day → deduplicate)
      const sideSlotDates = [...new Set(sideDates)].sort();
      const meta = { group_name: gn, dept_type: batch.dept_type, coordinators: batch.coordinators };

      // first dates for display
      const firstMainDate = mainDates[0] || null;
      const firstSideDate = sideSlotDates[0] || null;

      // ── MAIN CHECKS ──────────────────────────────────────────────
      // 1. Count > 8
      if (mainDates.length > 8) {
        addProblem(mainProblems, { ...meta, first_date: firstMainDate,
          problem_type: 'عدد محاضرات زيادة',
          detail: `الموجود: ${mainDates.length} محاضرة — المفروض: 8`,
          actual: mainDates.length, expected: 8,
        }, 'main');
      }

      // 1b. Count < 8 (missing main lectures)
      if (mainDates.length > 0 && mainDates.length < 8) {
        addProblem(mainProblems, { ...meta, first_date: firstMainDate,
          problem_type: 'عدد المحاضرات ناقصة',
          detail: `الموجود: ${mainDates.length} محاضرة — المفروض: 8`,
          actual: mainDates.length, expected: 8,
        }, 'main');
      }

      if (parsed) {
        // 2. First session date ≠ name date
        if (mainDates.length > 0) {
          const first    = mainDates[0];
          const year     = first.substring(0,4);
          const expected = `${year}-${pad(parsed.monthNum)}-${pad(parsed.dayNum)}`;
          const firstDow = getDow(first);
          if (first !== expected) {
            addProblem(mainProblems, { ...meta, first_date: firstMainDate,
              problem_type: 'تاريخ أول محاضرة غلط',
              detail: `الاسم: ${expected} (${DAY_EN[parsed.dow]}) | الفعلي: ${first} (${DAY_EN[firstDow]||'?'})`,
              expected_date: expected, actual_date: first,
            }, 'main');
          }
        }

        // 3. Sessions on wrong days
        const mainPair = getMainPair(parsed.dow);
        if (mainPair && mainDates.length > 0) {
          const wrong = mainDates.filter(d => !mainPair.includes(getDow(d)));
          if (wrong.length > 0) {
            addProblem(mainProblems, { ...meta, first_date: firstMainDate,
              problem_type: 'محاضرات على أيام غلط',
              detail: `${wrong.length} محاضرة خارج أيام (${mainPair.map(d=>DAY_AR[d]).join(' و')}) | أمثلة: ${wrong.slice(0,3).join(', ')}`,
              wrong_count: wrong.length,
            }, 'main');
          }
        }

        // ── ZOOM CALL CHECKS ──────────────────────────────────────────────
        // 1. Zoom calls on wrong days
        const sidePair = getSidePair(parsed.dow);
        if (sidePair && sideDates.length > 0) {
          const wrong = sideDates.filter(d => !sidePair.includes(getDow(d)));
          if (wrong.length > 0) {
            addProblem(zoomProblems, { ...meta, trainee_count: batch.trainee_count, first_date: firstSideDate,
              problem_type: 'زووم كول على أيام غلط',
              detail: `${wrong.length} جلسة خارج أيام (${sidePair.map(d=>DAY_AR[d]).join(' و')}) | أمثلة: ${wrong.slice(0,3).join(', ')}`,
              wrong_count: wrong.length,
            }, 'side');
          }
        }
      }

      // 2. Zoom call count ≠ trainee_count × 7
      const expectedSide = (batch.trainee_count || 0) * 7;
      if (expectedSide > 0 && sideDates.length !== expectedSide) {
        addProblem(zoomProblems, { ...meta, trainee_count: batch.trainee_count, first_date: firstSideDate,
          problem_type: sideDates.length < expectedSide ? 'زووم كول ناقصة' : 'زووم كول زيادة',
          detail: `الموجود: ${sideDates.length} | المطلوب: ${expectedSide} (${batch.trainee_count}×7)`,
          actual: sideDates.length, expected: expectedSide,
        }, 'side');
      }

      // 3. MAIN — last session date mismatch
      if (mainDates.length > 0 && firstMainDate) {
        const lastMainRow   = mainRows[mainRows.length - 1];
        const actualLast    = effectiveDate(lastMainRow.date, lastMainRow.time, lastMainRow.duration);
        const calcLast      = expectedMainLast(firstMainDate);
        if (actualLast !== calcLast) {
          const midnight = effectiveDate(lastMainRow.date, lastMainRow.time, lastMainRow.duration) !== lastMainRow.date;
          addProblem(mainProblems, { ...meta, first_date: firstMainDate,
            problem_type: 'تاريخ آخر محاضرة غلط',
            detail: `المحسوب: ${calcLast} | الفعلي: ${actualLast}${midnight ? ' (تعدى منتصف الليل)' : ''}`,
            expected_date: calcLast, actual_date: actualLast,
          }, 'main');
        }
      }

      // 4. ZOOM CALL — last session date mismatch
      if (sideSlotDates.length > 0 && firstSideDate) {
        const lastSideRow   = sideRows[sideRows.length - 1];
        const actualSideLast = effectiveDate(lastSideRow.date, lastSideRow.time, lastSideRow.duration);
        const calcSideLast   = expectedSideLast(firstSideDate);
        if (actualSideLast !== calcSideLast) {
          const midnight = effectiveDate(lastSideRow.date, lastSideRow.time, lastSideRow.duration) !== lastSideRow.date;
          addProblem(zoomProblems, { ...meta, trainee_count: batch.trainee_count, first_date: firstSideDate,
            problem_type: 'تاريخ آخر زووم كول غلط',
            detail: `المحسوب: ${calcSideLast} | الفعلي: ${actualSideLast}${midnight ? ' (تعدى منتصف الليل)' : ''}`,
            expected_date: calcSideLast, actual_date: actualSideLast,
          }, 'side');
        }
      }
    }

    // Attach previous_group_name to problems whose group_name matches a recorded new_group_code
    const attachRename = p => {
      const r = renameMap[p.group_name];
      if (r) {
        p.previous_group_name = r.previous_group_name;
        p.rename_recorded_at  = r.updated_at;
      }
      return p;
    };
    mainProblems.forEach(attachRename);
    zoomProblems.forEach(attachRename);

    // ── GHOST entries ────────────────────────────────────────────────────────
    // For each resolved problem that points to a new_group_code which exists as
    // a current batch, surface a read-only "historical" problem under the new
    // code so users searching by the new code can see what was resolved
    // previously. Without this, searching by the new code hides the resolved
    // record (because the resolved record is keyed to the old group_name).
    const batchMap = {};
    batches.forEach(b => { batchMap[b.group_name] = b; });
    const existingKey = new Set();
    mainProblems.forEach(p => existingKey.add(`${p.group_name}|${p.problem_type}|main`));
    zoomProblems.forEach(p => existingKey.add(`${p.group_name}|${p.problem_type}|side`));

    storedStatuses.forEach(s => {
      if (!s.new_group_code) return;
      const newCode = s.new_group_code.trim();
      if (!newCode) return;
      // Only surface closed statuses (resolved / wont_repeat / exception)
      if (!['resolved', 'wont_repeat', 'exception'].includes(s.status)) return;
      const batch = batchMap[newCode];
      if (!batch) return; // new code must exist in the filtered batches
      const sessionType = s.session_type || 'main';
      const key = `${newCode}|${s.problem_type}|${sessionType}`;
      if (existingKey.has(key)) return; // a live problem already exists — skip
      // When showResolved=false (default), skip — ghost entries are inherently "closed"
      if (!showResolved) return;
      // Look up the "updated_by_name" (join users) — cheap, done once per ghost
      let updatedByName = null;
      if (s.updated_by) {
        const u = db.prepare('SELECT full_name FROM users WHERE id = ?').get(s.updated_by);
        updatedByName = u?.full_name ?? null;
      }
      const ghost = {
        group_name:          newCode,
        problem_type:        s.problem_type,
        dept_type:           batch.dept_type,
        coordinators:        batch.coordinators,
        trainee_count:       batch.trainee_count,
        first_date:          null,
        detail:              `تم حل هذه المشكلة تحت الاسم السابق: ${s.group_name}`,
        // flags that mark this as a ghost/historical entry
        _ghost:              true,
        _ghost_source_group: s.group_name,
        // already-closed status fields (mirrors addProblem's showResolved branch)
        _resolved_status:    s.status,
        _status_note:        s.note,
        _status_by:          updatedByName,
        _status_at:          s.updated_at,
        // rename badge
        previous_group_name: s.group_name,
        rename_recorded_at:  s.updated_at,
      };
      if (sessionType === 'side') zoomProblems.push(ghost);
      else                        mainProblems.push(ghost);
      existingKey.add(key);
    });

    return res.json({ main_problems: mainProblems, zoom_problems: zoomProblems,
      total: mainProblems.length + zoomProblems.length });
  } catch (err) {
    console.error('[reports] code-problems error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/remarks-notes-options ──────────────────────────────────
// Returns dropdown options for coordinator, category, assigned_to
router.get('/remarks-notes-options', (req, res) => {
  const line = lineFilter(req);
  const lineBatches = buildLineFilter('batches', line);
  const lineRemarks = buildLineFilter('remarks', line);
  try {
    const coordinators = db.prepare(
      `SELECT DISTINCT TRIM(coordinators) as val FROM batches
       WHERE coordinators IS NOT NULL AND TRIM(coordinators) != ''${lineBatches}
       ORDER BY val`
    ).all().map(r => r.val);

    const categories = db.prepare(
      `SELECT DISTINCT TRIM(category) as val FROM remarks
       WHERE category IS NOT NULL AND TRIM(category) != ''${lineRemarks}
       ORDER BY val`
    ).all().map(r => r.val);

    const assignedTo = db.prepare(
      `SELECT DISTINCT TRIM(assigned_to) as val FROM remarks
       WHERE assigned_to IS NOT NULL AND TRIM(assigned_to) != ''${lineRemarks}
       ORDER BY val`
    ).all().map(r => r.val);

    return res.json({ coordinators, categories, assignedTo });
  } catch (err) {
    console.error('[reports] remarks-notes-options error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── TEAM SUMMARY FILTER HELPERS ─────────────────────────────────────────────
function tsFilters(q) {
  const { from_date, to_date, department } = q;
  const deptF  = buildDeptFilter('b', department);
  const dateA  = from_date ? ` AND a.date >= '${from_date}'` : '';
  const dateAe = to_date   ? ` AND a.date <= '${to_date}'`   : '';
  const dateL  = from_date ? ` AND l.date >= '${from_date}'` : '';
  const dateLe = to_date   ? ` AND l.date <= '${to_date}'`   : '';
  const dateR  = from_date ? ` AND r2.added_at >= '${from_date}'` : '';
  const dateRe = to_date   ? ` AND r2.added_at <= '${to_date}'`   : '';
  return { deptF, dateA: dateA+dateAe, dateL: dateL+dateLe, dateR: dateR+dateRe };
}

// ─── GET /api/reports/team-summary-detail ────────────────────────────────────
router.get('/team-summary-detail', (req, res) => {
  const { employee, metric, from_date, to_date, department } = req.query;
  if (!employee || !metric) return res.status(400).json({ error: 'employee and metric required' });
  const line = lineFilter(req);
  const lineBatches = buildLineFilter('batches', line);
  const lineB = buildLineFilter('b', line);
  const lineL = buildLineFilter('l', line);
  const lineA = buildLineFilter('a', line);
  const lineRemarks = buildLineFilter('', line);
  const { deptF, dateA, dateL, dateR } = tsFilters(req.query);
  const empFBatches = buildCoordFilter('batches', employee);
  const empFB       = buildCoordFilter('b', employee);
  const empFRemarks = employee ? ` AND assigned_to LIKE '%${escapeLike(employee.replace(/'/g,"''"))}%' ESCAPE '\\'` : '';

  try {
    let rows = [];

    if (metric === 'expired_groups') {
      rows = db.prepare(
        `SELECT group_name, end_date, dept_type, trainee_count
         FROM batches
         WHERE status='نشطة'
           AND end_date IS NOT NULL AND end_date != ''
           AND end_date <= date('now')
           ${empFBatches}
           ${deptF.replace('b.','').replace('AND b.','AND ')}${lineBatches}
         ORDER BY end_date ASC`
      ).all();

    } else if (metric === 'overdue_remarks') {
      const dateRBase = from_date ? ` AND added_at >= '${from_date}'` : '';
      const dateREnd  = to_date   ? ` AND added_at <= '${to_date}'`   : '';
      rows = db.prepare(
        `SELECT id, client_name, client_phone, details, priority, status,
           added_at, last_updated,
           ROUND((julianday('now')-julianday(COALESCE(added_at,'2000-01-01')))*24,1) as hours_open
         FROM remarks
         WHERE LOWER(status) NOT IN ('closed','مغلق','resolved')
           ${empFRemarks}
           ${dateRBase}${dateREnd}${lineRemarks}
           AND ROUND((julianday('now')-julianday(COALESCE(added_at,'2000-01-01')))*24,1) >=
               CASE WHEN priority='عاجلة' THEN 3
                    WHEN priority='هامة'  THEN 24
                    ELSE 48 END
           AND (last_updated IS NULL
             OR ROUND((julianday('now')-julianday(last_updated))*24,1) >= 24)
         ORDER BY hours_open DESC`
      ).all();

    } else if (metric === 'main_absence_no_remark') {
      rows = db.prepare(
        `SELECT DISTINCT a.student_name, a.phone, a.group_name, a.date
         FROM absent_students a
         INNER JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
         WHERE 1=1
           ${empFB}
           ${deptF}${dateA}${lineA}
           AND a.phone IS NOT NULL AND TRIM(a.phone) != ''
           AND NOT EXISTS (
             SELECT 1 FROM remarks r
             WHERE r.client_phone = a.phone
               AND r.category = 'Attendance Main Session'
               AND LOWER(r.status) NOT IN ('closed','مغلق','resolved')${line ? ' AND r.line = a.line' : ''}
           )
         ORDER BY a.group_name, a.date DESC`
      ).all();

    } else if (metric === 'side_absence_no_remark') {
      rows = db.prepare(
        `SELECT DISTINCT l.group_name, l.date, b.trainee_count,
           CAST(l.attendance AS INTEGER) as attendance
         FROM lectures l
         INNER JOIN batches b ON l.group_name = b.group_name${line ? ' AND b.line = l.line' : ''}
         WHERE 1=1
           ${empFB}
           ${deptF}${dateL}${lineL}
           AND l.session_type = 'side'
           AND l.side_session_category = 'regular'
           AND l.status != 'غير مؤكدة'
           AND l.attendance IS NOT NULL
           AND CAST(l.attendance AS INTEGER) < b.trainee_count
           AND b.trainee_count > 0
           AND NOT EXISTS (
             SELECT 1 FROM remarks r
             INNER JOIN clients c ON r.client_phone = c.phone${line ? ' AND c.line = r.line' : ''}
             WHERE c.group_name = l.group_name
               AND r.category = 'Attendance Zoom Call'
               AND LOWER(r.status) NOT IN ('closed','مغلق','resolved')${line ? ' AND r.line = l.line' : ''}
           )
         ORDER BY l.group_name, l.date DESC`
      ).all();

    } else if (metric === 'groups_with_errors') {
      rows = db.prepare(
        `SELECT group_name, scheduled_lectures, completed_lectures, dept_type,
           ABS(scheduled_lectures - completed_lectures) as diff
         FROM batches
         WHERE status = 'نشطة'
           ${empFBatches}
           ${deptF.replace('b.','').replace('AND b.','AND ')}${lineBatches}
           AND scheduled_lectures IS NOT NULL
           AND completed_lectures IS NOT NULL
           AND scheduled_lectures != completed_lectures
         ORDER BY diff DESC`
      ).all();
    }

    return res.json({ employee, metric, rows });
  } catch (err) {
    console.error('[reports] team-summary-detail error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/team-summary ──────────────────────────────────────────
// Returns per-employee metrics — supports from_date, to_date, department, employee filters
router.get('/team-summary', (req, res) => {
  const { from_date, to_date, department, employee: empFilter } = req.query;
  const line = lineFilter(req);
  const lineBatches = buildLineFilter('', line);
  const lineRemarks = buildLineFilter('', line);
  const lineB = buildLineFilter('b', line);
  const lineL = buildLineFilter('l', line);
  const lineA = buildLineFilter('a', line);
  const { deptF, dateA, dateL } = tsFilters(req.query);
  const dateRBase = from_date ? ` AND added_at >= '${from_date}'` : '';
  const dateREnd  = to_date   ? ` AND added_at <= '${to_date}'`   : '';
  const deptFNoB  = deptF.replace('b.dept_type','dept_type').replace('AND b.','AND ');

  try {
    // Filter team members by name if employee filter set
    const empWhere = empFilter ? ` AND LOWER(name) LIKE LOWER('%${empFilter}%')` : '';
    const members = db.prepare(
      `SELECT id, name, department, section, job_title
       FROM team_members
       WHERE department IN ('customer_services', 'appointments')
         AND status = 'active'
         ${empWhere}
       ORDER BY department, section, name`
    ).all();

    const stmtExpired = db.prepare(
      `SELECT COUNT(*) as cnt FROM batches
       WHERE status='نشطة'
         AND end_date IS NOT NULL AND end_date != ''
         AND end_date <= date('now')
         AND coordinators LIKE ?
         ${deptFNoB}${lineBatches}`
    );

    const stmtOverdue = db.prepare(
      `SELECT COUNT(*) as cnt FROM remarks
       WHERE LOWER(status) NOT IN ('closed','مغلق','resolved')
         AND assigned_to LIKE ?
         ${dateRBase}${dateREnd}${lineRemarks}
         AND ROUND((julianday('now') - julianday(COALESCE(added_at,'2000-01-01'))) * 24, 1) >=
             CASE WHEN priority='عاجلة' THEN 3
                  WHEN priority='هامة'  THEN 24
                  ELSE 48
             END
         AND (last_updated IS NULL
           OR ROUND((julianday('now') - julianday(last_updated)) * 24, 1) >= 24)`
    );

    const stmtMainAbsence = db.prepare(
      `SELECT COUNT(*) as cnt
       FROM absent_students a
       INNER JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
       WHERE b.coordinators LIKE ?
         ${deptF}${dateA}${lineA}
         AND a.phone IS NOT NULL AND TRIM(a.phone) != ''
         AND NOT EXISTS (
           SELECT 1 FROM remarks r
           WHERE r.client_phone = a.phone
             AND r.category = 'Attendance Main Session'
             AND LOWER(r.status) NOT IN ('closed','مغلق','resolved')${line ? ' AND r.line = a.line' : ''}
         )`
    );

    const stmtSideAbsence = db.prepare(
      `SELECT COUNT(*) as cnt FROM (
         SELECT DISTINCT l.group_name, l.date
         FROM lectures l
         INNER JOIN batches b ON l.group_name = b.group_name${line ? ' AND b.line = l.line' : ''}
         WHERE b.coordinators LIKE ?
           ${deptF}${dateL}${lineL}
           AND l.session_type = 'side'
           AND l.side_session_category = 'regular'
           AND l.status != 'غير مؤكدة'
           AND l.attendance IS NOT NULL
           AND CAST(l.attendance AS INTEGER) < b.trainee_count
           AND b.trainee_count > 0
           AND NOT EXISTS (
             SELECT 1 FROM remarks r
             INNER JOIN clients c ON r.client_phone = c.phone${line ? ' AND c.line = r.line' : ''}
             WHERE c.group_name = l.group_name
               AND r.category = 'Attendance Zoom Call'
               AND LOWER(r.status) NOT IN ('closed','مغلق','resolved')${line ? ' AND r.line = l.line' : ''}
           )
       )`
    );

    const stmtErrors = db.prepare(
      `SELECT COUNT(*) as cnt FROM batches
       WHERE status = 'نشطة'
         AND coordinators LIKE ?
         ${deptFNoB}${lineBatches}
         AND scheduled_lectures IS NOT NULL
         AND completed_lectures IS NOT NULL
         AND scheduled_lectures != completed_lectures`
    );

    const result = members.map(m => {
      const like = `%${m.name}%`;
      return {
        id:                    m.id,
        name:                  m.name,
        department:            m.department,
        section:               m.section,
        job_title:             m.job_title,
        expired_groups:        stmtExpired.get(like)?.cnt    ?? 0,
        overdue_remarks:       stmtOverdue.get(like)?.cnt    ?? 0,
        main_absence_no_remark:stmtMainAbsence.get(like)?.cnt?? 0,
        side_absence_no_remark:stmtSideAbsence.get(like)?.cnt?? 0,
        groups_with_errors:    stmtErrors.get(like)?.cnt     ?? 0,
      };
    });

    return res.json(result);
  } catch (err) {
    console.error('[reports] team-summary error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/problem-statuses ───────────────────────────────────────
router.get('/problem-statuses', (req, res) => {
  const line = lineFilter(req);
  const linePs = buildLineFilter('ps', line);
  try {
    const rows = db.prepare(
      `SELECT ps.*, u.full_name as updated_by_name
       FROM code_problem_status ps
       LEFT JOIN users u ON ps.updated_by = u.id
       WHERE 1=1${linePs}
       ORDER BY ps.updated_at DESC`
    ).all();
    return res.json(rows);
  } catch (err) {
    console.error('[reports] problem-statuses error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/reports/problem-status (upsert) ────────────────────────────────
// Problem types that REQUIRE new_group_code when status is resolved/wont_repeat/exception
const RENAME_REQUIRED_TYPES = new Set([
  'تاريخ أول محاضرة غلط',
  'محاضرات على أيام غلط',
]);
// Statuses that allow (and sometimes require) entering new_group_code
const RENAME_ALLOWED_STATUSES = new Set(['resolved', 'wont_repeat', 'exception']);
// Valid group code regex: Month(3 letters)_Day_Weekday_...(Trainer)Coordinator
const GROUP_CODE_REGEX = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)_\d{1,2}_(Sat|Sun|Mon|Tue|Wed|Thu|Fri)_.+\(.+\).+$/;

router.put('/problem-status', (req, res) => {
  const { group_name, problem_type, session_type = 'main', status, note, actual, new_group_code, line: bodyLine } = req.body;
  if (!group_name || !problem_type || !status)
    return res.status(400).json({ error: 'group_name, problem_type, status required' });
  const validStatuses = ['new', 'reported', 'in_progress', 'exception', 'wont_repeat', 'resolved'];
  if (!validStatuses.includes(status))
    return res.status(400).json({ error: 'Invalid status' });

  // Resolve effective line:
  //  - 'All' admins can target a specific line via body.line (else fallback to existing row's line, else 'Ahmed Hassan')
  //  - Non-'All' users are ALWAYS locked to their own line
  const userLine = req.user?.line || 'Ahmed Hassan';
  let effectiveLine;
  if (userLine === 'All') {
    const validLines = ['Ahmed Hassan', 'Dardasha'];
    if (bodyLine && validLines.includes(bodyLine)) {
      effectiveLine = bodyLine;
    } else {
      // Fallback: look up existing row across lines and keep its line
      const existing = db.prepare(
        `SELECT line FROM code_problem_status WHERE group_name=? AND problem_type=? AND session_type=? LIMIT 1`
      ).get(group_name, problem_type, session_type);
      effectiveLine = existing?.line || 'Ahmed Hassan';
    }
  } else {
    effectiveLine = userLine;
  }

  // new_group_code handling
  let newCodeValue = null;
  if (RENAME_ALLOWED_STATUSES.has(status)) {
    const trimmed = (new_group_code || '').trim();
    // Required for certain problem types
    if (RENAME_REQUIRED_TYPES.has(problem_type) && !trimmed) {
      return res.status(400).json({
        error: 'يجب إدخال الكود الجديد لأن نوع المشكلة من النوع الذي يتطلب تعديل الاسم'
      });
    }
    // Validate format if provided
    if (trimmed) {
      if (!GROUP_CODE_REGEX.test(trimmed)) {
        return res.status(400).json({
          error: 'صيغة الكود الجديد غير صحيحة. مثال: May_23_Sat_6PM_General2_P(nada)mostafa'
        });
      }
      newCodeValue = trimmed;
    }
  }
  // For non-resolution statuses, new_group_code is always null (doesn't apply)

  // Store actual count only when marking as wont_repeat or exception
  const actualAtStatus = (status === 'wont_repeat' || status === 'exception' || status === 'resolved') && actual != null
    ? actual : null;
  try {
    db.prepare(`
      INSERT INTO code_problem_status (group_name, problem_type, session_type, status, note, actual_at_status, new_group_code, updated_by, updated_at, line)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+2 hours'), ?)
      ON CONFLICT(group_name, problem_type, session_type, line) DO UPDATE SET
        status           = excluded.status,
        note             = excluded.note,
        actual_at_status = excluded.actual_at_status,
        new_group_code   = excluded.new_group_code,
        updated_by       = excluded.updated_by,
        updated_at       = excluded.updated_at
    `).run(group_name, problem_type, session_type, status, note ?? null, actualAtStatus, newCodeValue, req.user?.id ?? null, effectiveLine);

    const row = db.prepare(
      `SELECT ps.*, u.full_name as updated_by_name
       FROM code_problem_status ps LEFT JOIN users u ON ps.updated_by = u.id
       WHERE ps.group_name=? AND ps.problem_type=? AND ps.session_type=? AND ps.line=?`
    ).get(group_name, problem_type, session_type, effectiveLine);
    return res.json(row);
  } catch (err) {
    console.error('[reports] problem-status upsert error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/group-trainees?group_name=xxx ──────────────────────────
router.get('/group-trainees', (req, res) => {
  const { group_name } = req.query;
  if (!group_name) return res.status(400).json({ error: 'group_name required' });
  const line = lineFilter(req);
  const lineClients = buildLineFilter('', line);
  try {
    const trainees = db.prepare(
      `SELECT name, phone FROM clients WHERE group_name = ?${lineClients} ORDER BY name ASC`
    ).all(group_name);
    return res.json(trainees);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/group-lectures?group_name=xxx ───────────────────────────
router.get('/group-lectures', (req, res) => {
  const { group_name } = req.query;
  if (!group_name) return res.status(400).json({ error: 'group_name required' });
  const line = lineFilter(req);
  const lineAny = buildLineFilter('', line);
  try {
    const batch = db.prepare(`SELECT * FROM batches WHERE group_name = ?${lineAny}`).get(group_name);
    const lectures = db.prepare(
      `SELECT * FROM lectures WHERE group_name = ?${lineAny} ORDER BY date ASC`
    ).all(group_name);
    return res.json({ batch, lectures });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/fix-report ─────────────────────────────────────────────
router.get('/fix-report', (req, res) => {
  const { period, date_from, date_to } = req.query;
  const line = lineFilter(req);
  const lineB = buildLineFilter('b', line);
  const lineCps = buildLineFilter('cps', line);
  // No WHERE dept filter — all coordinators always appear.
  // For leaders: dept filter applied inside CASE WHEN so fixed counts only include
  // records from the leader's own department. This prevents fixed > all_count.
  let deptCond = '';
  if (req.user.role === 'leader') {
    const dept = req.user.department;
    if (dept && dept !== 'All') {
      const s = dept.replace(/'/g,"''");
      // Coordinator's registered dept is source of truth; fallback to batch.dept_type only if coordinator unregistered.
      deptCond = ` AND (
        EXISTS (
          SELECT 1 FROM users u
          WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
            AND u.department = '${s}'
        )
        OR (
          b.dept_type = '${s}'
          AND NOT EXISTS (
            SELECT 1 FROM users u
            WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
              AND u.department IS NOT NULL AND u.department != 'All'
          )
        )
      )`;
    }
  }
  // Build date condition embedded in CASE WHEN (date_from/date_to override period)
  let fixedDateCond = '';
  if (date_from && date_to) {
    const f = date_from.replace(/'/g,"''"); const t = date_to.replace(/'/g,"''");
    fixedDateCond = ` AND date(cps.updated_at) BETWEEN '${f}' AND '${t}'`;
  } else if (date_from) {
    const f = date_from.replace(/'/g,"''");
    fixedDateCond = ` AND date(cps.updated_at) >= '${f}'`;
  } else if (date_to) {
    const t = date_to.replace(/'/g,"''");
    fixedDateCond = ` AND date(cps.updated_at) <= '${t}'`;
  } else if (period === 'today') {
    fixedDateCond = ` AND date(cps.updated_at)=date('now','+2 hours')`;
  } else if (period === 'week') {
    fixedDateCond = ` AND cps.updated_at>=datetime('now','-6 days','+2 hours')`;
  } else if (period === 'month') {
    fixedDateCond = ` AND cps.updated_at>=datetime('now','-29 days','+2 hours')`;
  }
  try {
    const rows = db.prepare(`
      SELECT
        COALESCE(b.coordinators, '--') AS coordinator,
        COUNT(*) AS all_count,
        SUM(CASE WHEN cps.status NOT IN ('wont_repeat','exception','resolved') THEN 1 ELSE 0 END) AS remaining,
        SUM(CASE WHEN cps.status IN ('wont_repeat','exception','resolved')${deptCond} THEN 1 ELSE 0 END) AS fixed,
        SUM(CASE WHEN cps.status IN ('wont_repeat','exception','resolved')${deptCond}${fixedDateCond} THEN 1 ELSE 0 END) AS fixed_period,
        SUM(CASE WHEN cps.status IN ('wont_repeat','exception','resolved')${deptCond}
              AND date(cps.updated_at)=date('now','+2 hours') THEN 1 ELSE 0 END) AS fixed_today
      FROM code_problem_status cps
      LEFT JOIN batches b ON TRIM(LOWER(b.group_name))=TRIM(LOWER(cps.group_name))${line ? ' AND b.line = cps.line' : ''}
      WHERE 1=1${lineCps}
      GROUP BY COALESCE(b.coordinators, '--')
      ORDER BY remaining DESC, fixed DESC
    `).all();
    return res.json(rows);
  } catch (err) {
    console.error('[reports] fix-report:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/fix-report/detail ──────────────────────────────────────
router.get('/fix-report/detail', (req, res) => {
  const { coordinator, period, date_from, date_to } = req.query;
  if (!coordinator) return res.status(400).json({ error: 'coordinator required' });
  const line = lineFilter(req);
  const lineCps = buildLineFilter('cps', line);
  // For leader: coordinator's registered dept is source of truth (consistent with code-problems)
  let deptClause = '';
  if (req.user.role === 'leader') {
    const dept = req.user.department;
    if (dept && dept !== 'All') {
      const s = dept.replace(/'/g,"''");
      deptClause = ` AND (
        EXISTS (
          SELECT 1 FROM users u
          WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
            AND u.department = '${s}'
        )
        OR (
          b.dept_type = '${s}'
          AND NOT EXISTS (
            SELECT 1 FROM users u
            WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
              AND u.department IS NOT NULL AND u.department != 'All'
          )
        )
      )`;
    }
  }
  let periodClause = '';
  if (date_from && date_to) {
    const f = date_from.replace(/'/g,"''"); const t = date_to.replace(/'/g,"''");
    periodClause = ` AND date(cps.updated_at) BETWEEN '${f}' AND '${t}'`;
  } else if (date_from) {
    const f = date_from.replace(/'/g,"''");
    periodClause = ` AND date(cps.updated_at) >= '${f}'`;
  } else if (date_to) {
    const t = date_to.replace(/'/g,"''");
    periodClause = ` AND date(cps.updated_at) <= '${t}'`;
  } else if (period === 'today') {
    periodClause = ` AND date(cps.updated_at)=date('now','+2 hours')`;
  } else if (period === 'week') {
    periodClause = ` AND cps.updated_at>=datetime('now','-6 days','+2 hours')`;
  } else if (period === 'month') {
    periodClause = ` AND cps.updated_at>=datetime('now','-29 days','+2 hours')`;
  }
  const safe = coordinator.replace(/'/g,"''");
  try {
    const rows = db.prepare(`
      SELECT cps.group_name, cps.problem_type, cps.session_type, cps.status, cps.note,
             cps.updated_at, b.dept_type, COALESCE(b.coordinators,'--') AS coordinators,
             u.full_name AS updated_by_name
      FROM code_problem_status cps
      LEFT JOIN batches b ON TRIM(LOWER(b.group_name))=TRIM(LOWER(cps.group_name))${line ? ' AND b.line = cps.line' : ''}
      LEFT JOIN users u ON u.id=cps.updated_by
      WHERE cps.status IN ('wont_repeat','exception','resolved')
        AND COALESCE(b.coordinators,'--') LIKE '%${safe}%'${deptClause}${periodClause}${lineCps}
      ORDER BY cps.updated_at DESC
    `).all();
    return res.json(rows);
  } catch (err) {
    console.error('[reports] fix-report/detail:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/attendance-absence ─────────────────────────────────────
// Per-coordinator attendance & absence stats for Main sessions + Zoom/Side sessions.
// Uses the SAME formulas as the Customer Services Reports dashboard so numbers
// line up perfectly (e.g. dashboard `absent_main=45` → this page `main_absent=45`).
//
// Main sessions:
//   - Expected = COUNT of main lectures for the coordinator in the filter window.
//   - Absent   = Part1 (absent_students with resolved name + resolved date via
//                lecture_no when date is missing)
//              + Part2 (main lectures with empty attendance where a client
//                exists in the group AND no matching absent_students record).
//
// Zoom / side sessions:
//   - Expected = COUNT of regular 15-min confirmed side sessions for coord.
//   - Absent   = per (group,date), MAX(trainee_count) - COUNT(sessions with
//                attendance>0). Only groups with absent_count>0 are counted.
//
// Role-based:
//   - admin  → sees all, honors ?department= filter (OR EXISTS)
//   - leader → scoped to req.user.department (coordinator-first)
//   - agent  → scoped to their own groups (coordinator = their name)
router.get('/attendance-absence', (req, res) => {
  const { from_date, to_date, coordinator } = req.query;
  const line = lineFilter(req);
  const lineB = buildLineFilter('b', line);
  const lineB2 = buildLineFilter('b2', line);
  const lineL = buildLineFilter('l', line);
  const lineA = buildLineFilter('a', line);

  // Role-based dept filter (applied to both 'b' and 'b2' batches aliases)
  let deptFilterB = '', deptFilterB2 = '';
  let coordFilterB = buildCoordFilter('b', coordinator);
  let coordFilterB2 = buildCoordFilter('b2', coordinator);
  if (req.user?.role === 'leader') {
    deptFilterB  = buildStrictDeptFilter('b',  req.user.department);
    deptFilterB2 = buildStrictDeptFilter('b2', req.user.department);
  } else if (req.user?.role === 'admin') {
    deptFilterB  = buildDeptFilter('b',  req.query.department);
    deptFilterB2 = buildDeptFilter('b2', req.query.department);
  } else if (req.user?.role === 'agent') {
    coordFilterB  = buildCoordFilter('b',  req.user.full_name);
    coordFilterB2 = buildCoordFilter('b2', req.user.full_name);
  }

  const dateFilterL = buildDateFilter('l.date', from_date, to_date);
  const dateFilterResolved = from_date && to_date
    ? ` AND resolved_date BETWEEN '${from_date}' AND '${to_date}'`
    : from_date ? ` AND resolved_date >= '${from_date}'`
    : to_date   ? ` AND resolved_date <= '${to_date}'` : '';

  try {
    // ─── MAIN EXPECTED per coordinator ─────────────────────────────────────
    // Student-slot count: SUM(trainee_count) across main lectures in window.
    // This is the correct denominator for student-level absences (Part1+Part2).
    const mainExpectedRows = db.prepare(`
      SELECT COALESCE(b.coordinators, '--') AS coordinator,
        COALESCE(SUM(b.trainee_count), 0) AS cnt
      FROM lectures l
      INNER JOIN batches b ON l.group_name = b.group_name${line ? ' AND b.line = l.line' : ''}
      WHERE l.session_type = 'main' AND l.status != 'غير مؤكدة'
      ${dateFilterL}${deptFilterB}${coordFilterB}${lineL}
      GROUP BY b.coordinators
    `).all();

    // ─── MAIN ABSENT per coordinator (dashboard Part1 + Part2) ─────────────
    // Part1: absent_students records with resolved name & date.
    const mainAbsentPart1 = db.prepare(`
      SELECT coordinator, COUNT(*) AS cnt FROM (
        SELECT COALESCE(b.coordinators, '--') AS coordinator,
          COALESCE(NULLIF(TRIM(a.date),''), lec_inf.date) AS resolved_date
        FROM absent_students a
        LEFT JOIN batches b ON a.group_name = b.group_name${line ? ' AND b.line = a.line' : ''}
        LEFT JOIN clients c_lu ON (a.student_name IS NULL OR TRIM(a.student_name)='')
          AND a.phone IS NOT NULL AND TRIM(a.phone)!='' AND c_lu.phone = a.phone${line ? ' AND c_lu.line = a.line' : ''}
        LEFT JOIN (
          SELECT group_name, date, line,
            ROW_NUMBER() OVER (PARTITION BY group_name ORDER BY date) AS lec_num
          FROM lectures WHERE session_type='main' AND status != 'غير مؤكدة'${line ? ` AND line = '${line.replace(/'/g, "''")}'` : ''}
        ) lec_inf ON (a.date IS NULL OR TRIM(a.date)='')
          AND lec_inf.group_name = a.group_name
          AND a.lecture_no IS NOT NULL
          AND lec_inf.lec_num = a.lecture_no${line ? ' AND lec_inf.line = a.line' : ''}
        WHERE (
          (a.student_name IS NOT NULL AND TRIM(a.student_name)!='')
          OR (a.phone IS NOT NULL AND TRIM(a.phone)!='' AND c_lu.name IS NOT NULL)
        )
        ${deptFilterB}${coordFilterB}${lineA}
      ) p1
      WHERE 1=1${dateFilterResolved}
      GROUP BY coordinator
    `).all();

    // Part2: main lectures with empty attendance + client exists + no absent record.
    const mainAbsentPart2 = db.prepare(`
      SELECT COALESCE(b2.coordinators, '--') AS coordinator, COUNT(*) AS cnt
      FROM lectures l
      INNER JOIN batches b2 ON l.group_name = b2.group_name${line ? ' AND b2.line = l.line' : ''}
      INNER JOIN clients c ON c.group_name = l.group_name${line ? ' AND c.line = l.line' : ''}
      WHERE l.session_type = 'main'
        AND l.status = 'مؤكدة'
        AND (l.attendance IS NULL OR TRIM(l.attendance) = '')
        AND c.name IS NOT NULL AND TRIM(c.name)!=''
        AND c.phone IS NOT NULL AND TRIM(c.phone)!=''
        AND NOT EXISTS (
          SELECT 1 FROM absent_students a2
          WHERE a2.group_name = l.group_name AND a2.date = l.date${line ? ' AND a2.line = l.line' : ''}
        )
      ${dateFilterL}${deptFilterB2}${coordFilterB2}${lineL}
      GROUP BY b2.coordinators
    `).all();

    // ─── ZOOM EXPECTED per coordinator ─────────────────────────────────────
    // Side sessions are per-student 15-min slots — each lecture row is ONE
    // student's scheduled slot. So expected slots per (group,date) = COUNT(*)
    // of lecture rows, NOT batch.trainee_count (which is the whole group size
    // spanning many dates). Must match /absent-side-list and dashboard KPI.
    //
    // ⚠ Doubling fix — smart canonical line approach:
    // Batches can have the same group_name in BOTH lines. Lectures may only exist for
    // one line. Resolve the ACTUAL lecture line per group so AND l.line = b.line
    // counts each lecture row exactly once.
    // • admin "الكل" (no line) : canonical = actual lecture line → no doubling ✓
    // • admin "Dardasha"       : canonical = 'Ahmed Hassan' (lectures stored there) → finds data ✓
    const zoomBatchSubQ = line
      ? `(SELECT b.group_name,
           COALESCE(lc.canonical_line, MIN(b.line)) AS line,
           MAX(b.coordinators) AS coordinators, MAX(b.dept_type) AS dept_type
         FROM batches b
         LEFT JOIN (SELECT group_name, MIN(line) AS canonical_line FROM lectures WHERE session_type = 'side' GROUP BY group_name) lc ON lc.group_name = b.group_name
         WHERE b.line = '${line.replace(/'/g, "''")}'
         GROUP BY b.group_name)`
      : `(SELECT b.group_name,
           COALESCE(lc.canonical_line, MIN(b.line)) AS line,
           MAX(b.coordinators) AS coordinators, MAX(b.dept_type) AS dept_type
         FROM batches b
         LEFT JOIN (SELECT group_name, MIN(line) AS canonical_line FROM lectures WHERE session_type = 'side' GROUP BY group_name) lc ON lc.group_name = b.group_name
         GROUP BY b.group_name)`;

    const zoomExpectedRows = db.prepare(`
      SELECT coordinator, COALESCE(SUM(expected_slots), 0) AS cnt FROM (
        SELECT COALESCE(b.coordinators, '--') AS coordinator,
          COUNT(*) AS expected_slots
        FROM lectures l
        INNER JOIN ${zoomBatchSubQ} b ON l.group_name = b.group_name AND l.line = b.line
        WHERE l.session_type = 'side'
          AND l.status = 'مؤكدة'
          AND (l.duration IS NULL OR l.duration <= '00:15')
        ${dateFilterL}${deptFilterB}${coordFilterB}
        GROUP BY b.coordinators, l.group_name, l.date
      ) sub
      GROUP BY coordinator
    `).all();

    // ─── ZOOM ABSENT per coordinator (dashboard formula) ───────────────────
    // absent = COUNT(*) - present(attendance>0). See comment above.
    const zoomAbsentRows = db.prepare(`
      SELECT coordinator, COALESCE(SUM(absent_count), 0) AS cnt FROM (
        SELECT COALESCE(b.coordinators, '--') AS coordinator,
          COUNT(*) -
            SUM(CASE WHEN l.attendance IS NOT NULL AND l.attendance != ''
                     AND CAST(l.attendance AS INTEGER) > 0 THEN 1 ELSE 0 END)
            AS absent_count
        FROM lectures l
        INNER JOIN ${zoomBatchSubQ} b ON l.group_name = b.group_name AND l.line = b.line
        WHERE l.session_type = 'side'
          AND l.status = 'مؤكدة'
          AND (l.duration IS NULL OR l.duration <= '00:15')
        ${dateFilterL}${deptFilterB}${coordFilterB}
        GROUP BY b.coordinators, l.group_name, l.date
        HAVING absent_count > 0
      ) sub
      GROUP BY coordinator
    `).all();

    // Merge per coordinator
    const map = new Map();
    const ensure = (raw) => {
      const key = raw || '--';
      if (!map.has(key)) {
        map.set(key, {
          coordinator: key,
          main_expected: 0, main_absent: 0,
          zoom_expected: 0, zoom_absent: 0,
        });
      }
      return map.get(key);
    };

    mainExpectedRows.forEach(r => {
      ensure(r.coordinator).main_expected += r.cnt || 0;
    });
    mainAbsentPart1.forEach(r => {
      ensure(r.coordinator).main_absent += r.cnt || 0;
    });
    mainAbsentPart2.forEach(r => {
      ensure(r.coordinator).main_absent += r.cnt || 0;
    });
    zoomExpectedRows.forEach(r => {
      ensure(r.coordinator).zoom_expected += r.cnt || 0;
    });
    zoomAbsentRows.forEach(r => {
      ensure(r.coordinator).zoom_absent += r.cnt || 0;
    });

    const result = Array.from(map.values())
      .filter(r => r.main_expected + r.zoom_expected > 0)
      .map(r => ({
        ...r,
        main_absence_rate: r.main_expected > 0
          ? Math.round((r.main_absent / r.main_expected) * 100)
          : 0,
        zoom_absence_rate: r.zoom_expected > 0
          ? Math.round((r.zoom_absent / r.zoom_expected) * 100)
          : 0,
      }))
      .sort((a, b) =>
        (b.main_absent + b.zoom_absent) - (a.main_absent + a.zoom_absent)
      );

    return res.json(result);
  } catch (err) {
    console.error('[reports] attendance-absence error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
