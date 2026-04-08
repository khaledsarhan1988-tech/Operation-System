'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate, requireRole('leader'));

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function buildDateFilter(field, from_date, to_date) {
  if (from_date && to_date) return ` AND ${field} BETWEEN '${from_date}' AND '${to_date}'`;
  if (from_date) return ` AND ${field} >= '${from_date}'`;
  if (to_date) return ` AND ${field} <= '${to_date}'`;
  return '';
}

function buildDeptFilter(table, department) {
  if (!department || department === 'All') return '';
  return ` AND ${table}.dept_type = '${department}'`;
}

// ─── GET /api/reports/dashboard ───────────────────────────────────────────────
router.get('/dashboard', (req, res) => {
  const { from_date, to_date, department, employee } = req.query;

  const deptBatches = buildDeptFilter('batches', department);
  const deptB       = buildDeptFilter('b', department);
  const empFilter   = employee ? ` AND batches.coordinators LIKE '%${employee}%'` : '';
  const empBFilter  = employee ? ` AND b.coordinators LIKE '%${employee}%'` : '';
  const empRemark   = employee ? ` AND remarks.assigned_to LIKE '%${employee}%'` : '';

  // للملاحظات: ربط العميل بالمجموعة للفلترة بالقسم
  const deptRemark  = department && department !== 'All'
    ? ` AND EXISTS (
          SELECT 1 FROM clients c
          INNER JOIN batches b ON c.group_name = b.group_name
          WHERE c.phone = remarks.client_phone
            AND b.dept_type = '${department}'
        )`
    : '';

  try {
    // 1. Active groups (3 statuses)
    const activeGroupsList = db.prepare(
      `SELECT * FROM batches WHERE status='نشطة'${deptBatches}${empFilter} ORDER BY start_date DESC`
    ).all();

    const waitingTraineesList = db.prepare(
      `SELECT * FROM batches WHERE status='بانتظار تسجيل المتدربين'${deptBatches}${empFilter} ORDER BY start_date DESC`
    ).all();

    const waitingLecturesList = db.prepare(
      `SELECT * FROM batches WHERE status='بانتظار تسجيل المحاضرات'${deptBatches}${empFilter} ORDER BY start_date DESC`
    ).all();

    // 2. Expired active groups
    const expiredGroupsList = db.prepare(
      `SELECT * FROM batches
       WHERE status='نشطة'
         AND end_date IS NOT NULL
         AND end_date != ''
         AND end_date < date('now')
       ${deptBatches}${empFilter}
       ORDER BY end_date DESC`
    ).all();

    // 3. Main lectures count
    const mainLecturesRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM lectures
       INNER JOIN batches ON lectures.group_name = batches.group_name
       WHERE lectures.session_type='main'
       ${buildDateFilter('lectures.date', from_date, to_date)}
       ${deptBatches}${empFilter}`
    ).get();

    // 4. Side sessions count
    const sideLecturesRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM lectures
       INNER JOIN batches ON lectures.group_name = batches.group_name
       WHERE lectures.session_type='side'
       ${buildDateFilter('lectures.date', from_date, to_date)}
       ${deptBatches}${empFilter}`
    ).get();

    // 5. Absent main
    const absentMainRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM absent_students
       INNER JOIN batches ON absent_students.group_name = batches.group_name
       WHERE 1=1
       ${buildDateFilter('absent_students.date', from_date, to_date)}
       ${deptBatches}${empFilter}`
    ).get();

    // 6. Absent side — grouped per group+date, absent = trainee_count - present sessions
    const absentSideRow = db.prepare(
      `SELECT COALESCE(SUM(absent_count), 0) as cnt FROM (
         SELECT
           b.trainee_count,
           SUM(CASE WHEN l.attendance IS NOT NULL AND l.attendance != '' AND CAST(l.attendance AS INTEGER) > 0 THEN 1 ELSE 0 END) AS present_count,
           MAX(b.trainee_count) - SUM(CASE WHEN l.attendance IS NOT NULL AND l.attendance != '' AND CAST(l.attendance AS INTEGER) > 0 THEN 1 ELSE 0 END) AS absent_count
         FROM lectures l
         INNER JOIN batches b ON l.group_name = b.group_name
         WHERE l.session_type = 'side'
           AND l.status = 'مؤكدة'
           AND (l.duration IS NULL OR l.duration <= '00:15')
         ${buildDateFilter('l.date', from_date, to_date)}
         ${deptBatches}${empFilter}
         GROUP BY l.group_name, l.date
         HAVING absent_count > 0
       )`
    ).get();

    // 7. Open remarks — count only for KPI, limited list for dashboard table
    const openRemarksCount = db.prepare(
      `SELECT COUNT(*) as cnt FROM remarks
       WHERE LOWER(status) NOT IN ('closed','مغلق','resolved')
       ${buildDateFilter('remarks.added_at', from_date, to_date)}
       ${empRemark}${deptRemark}`
    ).get();

    const openRemarksList = db.prepare(
      `SELECT id, client_name, client_phone, details, category, status, priority, assigned_to, added_at, last_updated
       FROM remarks
       WHERE LOWER(status) NOT IN ('closed','مغلق','resolved')
       ${buildDateFilter('remarks.added_at', from_date, to_date)}
       ${empRemark}${deptRemark}
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
         ${deptRemark}
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
       ${deptBatches}${empFilter}
       ORDER BY missing_lectures DESC`
    ).all();

    // 8c. Side session errors (count < trainee_count * 7)
    const sideSessionErrors = db.prepare(
      `SELECT b.group_name, b.trainee_count, b.dept_type, b.coordinators,
         COUNT(l.id) as side_count,
         (b.trainee_count * 7) as expected_side_count
       FROM batches b
       LEFT JOIN lectures l ON l.group_name = b.group_name AND l.session_type = 'side'
       WHERE b.status = 'نشطة'
       ${deptB}${empBFilter}
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
        absent_main:           absentMainRow?.cnt ?? 0,
        absent_side:           absentSideRow?.cnt ?? 0,
        open_remarks:          openRemarksCount?.cnt ?? 0,
        remarks_notes:         (() => {
          try {
            return db.prepare(
              `SELECT COUNT(*) as cnt FROM remarks
               WHERE category IN ('Attendance Main Session','Attendance Zoom Call')
               AND LOWER(status) NOT IN ('closed','مغلق','resolved')
               ${buildDateFilter('remarks.added_at', from_date, to_date)}
               ${empRemark}${deptRemark}`
            ).get()?.cnt ?? 0;
          } catch(e) { return 0; }
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
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const deptFilter        = department && department !== 'All' ? ` AND b.dept_type = '${department}'` : '';
  const empFilter         = employee    ? ` AND b.coordinators LIKE '%${employee}%'` : '';
  const searchFilter      = search      ? ` AND l.group_name LIKE '%${search}%'` : '';
  const trainerFilter     = trainer     ? ` AND l.trainer LIKE '%${trainer}%'` : '';
  const coordFilter       = coordinator ? ` AND b.coordinators LIKE '%${coordinator}%'` : '';
  // Modal date overrides outer date if provided
  const activFrom  = modal_from || from_date;
  const activTo    = modal_to   || to_date;
  const dateFilter = activFrom && activTo ? ` AND l.date BETWEEN '${activFrom}' AND '${activTo}'`
                   : activFrom ? ` AND l.date >= '${activFrom}'`
                   : activTo   ? ` AND l.date <= '${activTo}'` : '';

  const allFilters = `${dateFilter}${deptFilter}${empFilter}${trainerFilter}${coordFilter}${searchFilter}`;

  // For side sessions: pre-aggregate onboarding/offboarding per group (one JOIN instead of N subqueries)
  const sideJoin = session_type === 'side'
    ? `LEFT JOIN (
         SELECT group_name,
           SUM(CASE WHEN side_session_category='onboarding'  THEN 1 ELSE 0 END) AS onboarding_count,
           SUM(CASE WHEN side_session_category='offboarding' THEN 1 ELSE 0 END) AS offboarding_count
         FROM lectures WHERE session_type='side'
         GROUP BY group_name
       ) lx_counts ON lx_counts.group_name = l.group_name`
    : '';
  const sideExtraFields = session_type === 'side'
    ? `, COALESCE(lx_counts.onboarding_count,0) AS onboarding_count, COALESCE(lx_counts.offboarding_count,0) AS offboarding_count`
    : '';

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM lectures l
       LEFT JOIN batches b ON l.group_name = b.group_name
       WHERE l.session_type = '${session_type}'${allFilters}`
    ).get();

    const rows = db.prepare(
      `SELECT l.*, b.dept_type, b.coordinators, b.lecture_duration_min${sideExtraFields}
       FROM lectures l
       LEFT JOIN batches b ON l.group_name = b.group_name
       ${sideJoin}
       WHERE l.session_type = '${session_type}'${allFilters}
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

  // Modal filters override outer filters when provided
  const activeDept  = modal_dept  && modal_dept  !== 'All' ? modal_dept  : (department && department !== 'All' ? department : '');
  const activeFrom  = modal_from  || from_date;
  const activeTo    = modal_to    || to_date;

  const deptFilter   = activeDept ? ` AND b.dept_type = '${activeDept}'` : '';
  const empFilter    = employee   ? ` AND b.coordinators LIKE '%${employee}%'` : '';
  const coordFilter  = coordinator ? ` AND b.coordinators LIKE '%${coordinator}%'` : '';
  const searchFilter = search     ? ` AND a.group_name LIKE '%${search}%'` : '';
  const dateFilter   = activeFrom && activeTo ? ` AND a.date BETWEEN '${activeFrom}' AND '${activeTo}'`
                     : activeFrom ? ` AND a.date >= '${activeFrom}'`
                     : activeTo   ? ` AND a.date <= '${activeTo}'` : '';

  // استبعاد الصفوف التي لا يوجد بها اسم الطالب أو رقم الموبايل
  const validFilter = ` AND a.student_name IS NOT NULL AND TRIM(a.student_name) != ''
                        AND a.phone IS NOT NULL AND TRIM(a.phone) != ''`;

  const allFilters = `${validFilter}${dateFilter}${deptFilter}${empFilter}${coordFilter}${searchFilter}`;

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM absent_students a
       LEFT JOIN batches b ON a.group_name = b.group_name
       WHERE 1=1${allFilters}`
    ).get();
    const rows = db.prepare(
      `SELECT a.*, b.dept_type, b.coordinators FROM absent_students a
       LEFT JOIN batches b ON a.group_name = b.group_name
       WHERE 1=1${allFilters}
       ORDER BY a.date DESC LIMIT ${Number(limit)} OFFSET ${offset}`
    ).all();
    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
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

  const activeDept = modal_dept && modal_dept !== 'All' ? modal_dept : (department && department !== 'All' ? department : '');
  const activeFrom = modal_from || from_date;
  const activeTo   = modal_to   || to_date;

  const deptFilter    = activeDept  ? ` AND b.dept_type = '${activeDept}'` : '';
  const empFilter     = employee    ? ` AND b.coordinators LIKE '%${employee}%'` : '';
  const trainerFilter = trainer     ? ` AND l.trainer LIKE '%${trainer}%'` : '';
  const coordFilter   = coordinator ? ` AND b.coordinators LIKE '%${coordinator}%'` : '';
  const searchFilter  = search      ? ` AND l.group_name LIKE '%${search}%'` : '';
  const dateFilter    = activeFrom && activeTo
    ? ` AND l.date BETWEEN '${activeFrom}' AND '${activeTo}'`
    : activeFrom ? ` AND l.date >= '${activeFrom}'`
    : activeTo   ? ` AND l.date <= '${activeTo}'` : '';

  const baseWhere = `
    WHERE l.session_type = 'side'
      AND l.status = 'مؤكدة'
      AND (l.duration IS NULL OR l.duration <= '00:15')
    ${dateFilter}${deptFilter}${empFilter}${trainerFilter}${coordFilter}${searchFilter}`;

  const groupedQuery = `
    SELECT
      l.group_name,
      l.date                                                                    AS session_date,
      MAX(l.trainer)                                                            AS trainer,
      MAX(b.coordinators)                                                       AS coordinators,
      MAX(b.dept_type)                                                          AS dept_type,
      MAX(b.trainee_count)                                                      AS trainee_count,
      SUM(CASE WHEN l.attendance IS NOT NULL
               AND l.attendance != ''
               AND CAST(l.attendance AS INTEGER) > 0
               THEN 1 ELSE 0 END)                                               AS present_count,
      MAX(b.trainee_count) -
      SUM(CASE WHEN l.attendance IS NOT NULL
               AND l.attendance != ''
               AND CAST(l.attendance AS INTEGER) > 0
               THEN 1 ELSE 0 END)                                               AS absent_count
    FROM lectures l
    LEFT JOIN batches b ON l.group_name = b.group_name
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

  const activeFrom = modal_from || from_date;
  const activeTo   = modal_to   || to_date;
  const activeDept = modal_dept && modal_dept !== 'All' ? modal_dept
                   : department && department !== 'All' ? department : '';

  const dateFilter     = activeFrom && activeTo ? ` AND added_at BETWEEN '${activeFrom}' AND '${activeTo}'`
                       : activeFrom ? ` AND added_at >= '${activeFrom}'`
                       : activeTo   ? ` AND added_at <= '${activeTo}'` : '';
  const empFilter      = employee        ? ` AND assigned_to LIKE '%${employee}%'` : '';
  const assignFilter   = assigned_to     ? ` AND assigned_to LIKE '%${assigned_to}%'` : '';
  const priorityFilter = priority        ? ` AND priority = '${priority}'` : '';
  const categoryFilter = category_search ? ` AND category LIKE '%${category_search}%'` : '';
  const statusFilter   = status_filter   ? ` AND status = '${status_filter}'` : '';
  const searchFilter   = search          ? ` AND (client_name LIKE '%${search}%' OR details LIKE '%${search}%')` : '';
  const deptFilter     = activeDept
    ? ` AND EXISTS (
          SELECT 1 FROM clients c
          INNER JOIN batches b ON c.group_name = b.group_name
          WHERE c.phone = remarks.client_phone
            AND b.dept_type = '${activeDept}'
        )`
    : '';

  // added_at is stored as "DD/MM/YYYY, HH:MM AM/PM"
  // Convert to YYYY-MM-DD for date comparison with batches.start_date / end_date
  const dateConvert = `(substr(r.added_at,7,4) || '-' || substr(r.added_at,4,2) || '-' || substr(r.added_at,1,2))`;

  const baseWhere = `WHERE LOWER(remarks.status) NOT IN ('closed','مغلق','resolved')
    ${dateFilter}${empFilter}${assignFilter}${priorityFilter}${categoryFilter}${statusFilter}${deptFilter}${searchFilter}`;

  // Use CTE to pre-compute active batches per phone — avoids N+1 correlated subquery
  const withCte = `
    WITH active_batches AS (
      SELECT c.phone, b.group_name, b.start_date, b.end_date
      FROM clients c
      INNER JOIN batches b ON c.group_name = b.group_name
      WHERE b.status = 'نشطة'
        AND b.start_date IS NOT NULL AND b.start_date != ''
        AND b.end_date   IS NOT NULL AND b.end_date   != ''
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

  const activeFrom = modal_from || from_date;
  const activeTo   = modal_to   || to_date;
  const activeDept = modal_dept && modal_dept !== 'All' ? modal_dept : (department && department !== 'All' ? department : '');

  const deptFilter   = activeDept  ? ` AND b.dept_type = '${activeDept}'` : '';
  const empFilter    = employee    ? ` AND b.coordinators LIKE '%${employee}%'` : '';
  const coordFilter  = coordinator ? ` AND b.coordinators LIKE '%${coordinator}%'` : '';
  const searchFilter = search      ? ` AND (a.student_name LIKE '%${search}%' OR a.group_name LIKE '%${search}%' OR a.phone LIKE '%${search}%')` : '';
  const dateFilter   = buildDateFilter('a.date', activeFrom, activeTo);
  const remarkFilter = has_remark === '1' ? ` AND r_check.id IS NOT NULL`
                     : has_remark === '0' ? ` AND r_check.id IS NULL` : '';

  const baseWhere = `WHERE a.student_name IS NOT NULL AND TRIM(a.student_name) != ''
    AND a.phone IS NOT NULL AND TRIM(a.phone) != ''
    ${dateFilter}${deptFilter}${empFilter}${coordFilter}${searchFilter}`;

  // Pre-deduplicate remarks: one row per phone+date to avoid duplicate rows in JOIN
  const innerQ = `
    SELECT a.id, a.student_name, a.phone AS student_phone, a.group_name, a.date AS absence_date,
      b.coordinators, b.dept_type,
      date(a.date, '+1 day') AS expected_remark_date,
      r.id AS remark_id, r.details AS remark_details, r.added_at AS remark_date,
      r.assigned_to, r.status AS remark_status,
      CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END AS has_remark
    FROM absent_students a
    LEFT JOIN batches b ON a.group_name = b.group_name
    LEFT JOIN (
      SELECT client_phone,
        date(substr(added_at,7,4)||'-'||substr(added_at,4,2)||'-'||substr(added_at,1,2)) AS rdate,
        MAX(id) AS id, MAX(details) AS details, MAX(added_at) AS added_at,
        MAX(assigned_to) AS assigned_to, MAX(status) AS status
      FROM remarks WHERE category = 'Attendance Main Session'
      GROUP BY client_phone, date(substr(added_at,7,4)||'-'||substr(added_at,4,2)||'-'||substr(added_at,1,2))
    ) r ON r.client_phone = a.phone AND r.rdate = date(a.date, '+1 day')
    ${baseWhere}`;

  // For has_remark filter, we need to filter after the LEFT JOIN
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
router.get('/remarks-notes-zoom', (req, res) => {
  const {
    from_date, to_date, department, employee,
    page = 1, limit = 100, search = '',
    modal_from = '', modal_to = '', modal_dept = '',
    coordinator = '', has_session = '',
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const activeFrom = modal_from || from_date;
  const activeTo   = modal_to   || to_date;
  const activeDept = modal_dept && modal_dept !== 'All' ? modal_dept : (department && department !== 'All' ? department : '');

  const remarkDateSQL      = `date(substr(r.added_at,7,4)||'-'||substr(r.added_at,4,2)||'-'||substr(r.added_at,1,2))`;
  const expectedSessionSQL = `date(${remarkDateSQL}, '-1 day')`;

  const deptFilter   = activeDept  ? ` AND b.dept_type = '${activeDept}'` : '';
  const empFilter    = employee    ? ` AND b.coordinators LIKE '%${employee}%'` : '';
  const coordFilter  = coordinator ? ` AND b.coordinators LIKE '%${coordinator}%'` : '';
  const searchFilter = search      ? ` AND (r.client_name LIKE '%${search}%' OR r.client_phone LIKE '%${search}%' OR c.group_name LIKE '%${search}%')` : '';
  const dateFilter   = activeFrom && activeTo ? ` AND ${remarkDateSQL} BETWEEN '${activeFrom}' AND '${activeTo}'`
                     : activeFrom ? ` AND ${remarkDateSQL} >= '${activeFrom}'`
                     : activeTo   ? ` AND ${remarkDateSQL} <= '${activeTo}'` : '';

  const baseWhere = `WHERE r.category = 'Attendance Zoom Call'
    ${dateFilter}${deptFilter}${empFilter}${coordFilter}${searchFilter}`;

  // Deduplicate clients (one row per phone) AND lectures (one row per group+date)
  // to prevent row multiplication from either join
  const innerQ = `
    SELECT r.id, r.client_name, r.client_phone, r.details AS remark_details,
      r.added_at AS remark_date, r.assigned_to, r.status AS remark_status,
      c.group_name, b.coordinators, b.dept_type,
      ${expectedSessionSQL} AS expected_session_date,
      l.session_date,
      CASE WHEN l.group_name IS NOT NULL THEN 1 ELSE 0 END AS has_session
    FROM remarks r
    LEFT JOIN (SELECT phone, MIN(group_name) AS group_name FROM clients GROUP BY phone) c
      ON c.phone = r.client_phone
    LEFT JOIN batches b ON b.group_name = c.group_name
    LEFT JOIN (
      SELECT group_name, date AS session_date
      FROM lectures
      WHERE session_type = 'side'
      GROUP BY group_name, date
    ) l ON l.group_name = c.group_name AND l.session_date = ${expectedSessionSQL}
    ${baseWhere}`;

  const havingFilter = has_session === '1' ? ` AND has_session = 1`
                     : has_session === '0' ? ` AND has_session = 0` : '';

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM (${innerQ}) t WHERE 1=1 ${havingFilter}`
    ).get();

    const rows = db.prepare(
      `SELECT * FROM (${innerQ}) t WHERE 1=1 ${havingFilter}
       ORDER BY remark_date DESC
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

  const activeFrom = modal_from || from_date;
  const activeTo   = modal_to   || to_date;
  const activeDept = modal_dept && modal_dept !== 'All' ? modal_dept : (department && department !== 'All' ? department : '');

  const remarkDateSQL  = `date(substr(r.added_at,7,4)||'-'||substr(r.added_at,4,2)||'-'||substr(r.added_at,1,2))`;
  const deptFilter     = activeDept
    ? ` AND EXISTS (SELECT 1 FROM clients cx INNER JOIN batches bx ON cx.group_name=bx.group_name WHERE cx.phone=r.client_phone AND bx.dept_type='${activeDept}')`
    : '';
  const empFilter      = employee       ? ` AND r.assigned_to LIKE '%${employee}%'` : '';
  const assignFilter   = assigned_to    ? ` AND r.assigned_to LIKE '%${assigned_to}%'` : '';
  const catFilter      = category_filter ? ` AND r.category LIKE '%${category_filter}%'` : '';
  const searchFilter   = search         ? ` AND (r.client_name LIKE '%${search}%' OR r.category LIKE '%${search}%' OR r.client_phone LIKE '%${search}%')` : '';
  const dateFilter     = buildDateFilter(remarkDateSQL, activeFrom, activeTo);

  const baseWhere = `WHERE r.category IS NOT NULL AND TRIM(r.category) != ''
    ${dateFilter}${deptFilter}${empFilter}${assignFilter}${catFilter}${searchFilter}`;

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM remarks r ${baseWhere}`
    ).get();

    const rows = db.prepare(
      `WITH cat_counts AS (
         SELECT category, COUNT(*) as cnt FROM remarks
         WHERE category IS NOT NULL AND TRIM(category) != ''
         GROUP BY category
       ),
       client_groups AS (
         SELECT c.phone, b.group_name, b.coordinators
         FROM clients c INNER JOIN batches b ON c.group_name = b.group_name
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
  const { department, employee } = req.query;
  const deptFilter = department && department !== 'All' ? ` AND b.dept_type = '${department}'` : '';
  const empFilter  = employee ? ` AND b.coordinators LIKE '%${employee}%'` : '';

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
      `SELECT group_name, trainee_count, dept_type, coordinators, start_date
       FROM batches b WHERE status='نشطة'${deptFilter}${empFilter}`
    ).all();

    // fetch all main sessions with time + duration
    const mainRaw = db.prepare(
      `SELECT l.group_name, l.date, l.time, l.duration FROM lectures l
       INNER JOIN batches b ON l.group_name=b.group_name
       WHERE b.status='نشطة' AND l.session_type='main'
       ${deptFilter}${empFilter} ORDER BY l.group_name, l.date ASC`
    ).all();

    // fetch all valid side sessions with time + duration (exclude onboarding/offboarding)
    const sideRaw = db.prepare(
      `SELECT l.group_name, l.date, l.time, l.duration FROM lectures l
       INNER JOIN batches b ON l.group_name=b.group_name
       WHERE b.status='نشطة' AND l.session_type='side'
         AND LOWER(COALESCE(l.side_session_category,'')) NOT IN ('onboarding','offboarding')
       ${deptFilter}${empFilter} ORDER BY l.group_name, l.date ASC`
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

    const mainProblems = [], sideProblems = [];

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
        mainProblems.push({ ...meta, first_date: firstMainDate,
          problem_type: 'عدد محاضرات زيادة',
          detail: `الموجود: ${mainDates.length} محاضرة — المفروض: 8`,
          actual: mainDates.length, expected: 8,
        });
      }

      if (parsed) {
        // 2. First session date ≠ name date
        if (mainDates.length > 0) {
          const first    = mainDates[0];
          const year     = first.substring(0,4);
          const expected = `${year}-${pad(parsed.monthNum)}-${pad(parsed.dayNum)}`;
          const firstDow = getDow(first);
          if (first !== expected) {
            mainProblems.push({ ...meta, first_date: firstMainDate,
              problem_type: 'تاريخ أول محاضرة غلط',
              detail: `الاسم: ${expected} (${DAY_EN[parsed.dow]}) | الفعلي: ${first} (${DAY_EN[firstDow]||'?'})`,
              expected_date: expected, actual_date: first,
            });
          }
        }

        // 3. Sessions on wrong days
        const mainPair = getMainPair(parsed.dow);
        if (mainPair && mainDates.length > 0) {
          const wrong = mainDates.filter(d => !mainPair.includes(getDow(d)));
          if (wrong.length > 0) {
            mainProblems.push({ ...meta, first_date: firstMainDate,
              problem_type: 'محاضرات على أيام غلط',
              detail: `${wrong.length} محاضرة خارج أيام (${mainPair.map(d=>DAY_AR[d]).join(' و')}) | أمثلة: ${wrong.slice(0,3).join(', ')}`,
              wrong_count: wrong.length,
            });
          }
        }

        // ── SIDE CHECKS ──────────────────────────────────────────────
        // 1. Side sessions on wrong days
        const sidePair = getSidePair(parsed.dow);
        if (sidePair && sideDates.length > 0) {
          const wrong = sideDates.filter(d => !sidePair.includes(getDow(d)));
          if (wrong.length > 0) {
            sideProblems.push({ ...meta, trainee_count: batch.trainee_count, first_date: firstSideDate,
              problem_type: 'جلسات جانبية على أيام غلط',
              detail: `${wrong.length} جلسة خارج أيام (${sidePair.map(d=>DAY_AR[d]).join(' و')}) | أمثلة: ${wrong.slice(0,3).join(', ')}`,
              wrong_count: wrong.length,
            });
          }
        }
      }

      // 2. Side count ≠ trainee_count × 7
      const expectedSide = (batch.trainee_count || 0) * 7;
      if (expectedSide > 0 && sideDates.length !== expectedSide) {
        sideProblems.push({ ...meta, trainee_count: batch.trainee_count, first_date: firstSideDate,
          problem_type: sideDates.length < expectedSide ? 'جلسات جانبية ناقصة' : 'جلسات جانبية زيادة',
          detail: `الموجود: ${sideDates.length} | المطلوب: ${expectedSide} (${batch.trainee_count}×7)`,
          actual: sideDates.length, expected: expectedSide,
        });
      }

      // 3. MAIN — last session date mismatch
      if (mainDates.length > 0 && firstMainDate) {
        const lastMainRow   = mainRows[mainRows.length - 1];
        const actualLast    = effectiveDate(lastMainRow.date, lastMainRow.time, lastMainRow.duration);
        const calcLast      = expectedMainLast(firstMainDate);
        if (actualLast !== calcLast) {
          const midnight = effectiveDate(lastMainRow.date, lastMainRow.time, lastMainRow.duration) !== lastMainRow.date;
          mainProblems.push({ ...meta, first_date: firstMainDate,
            problem_type: 'تاريخ آخر محاضرة غلط',
            detail: `المحسوب: ${calcLast} | الفعلي: ${actualLast}${midnight ? ' (تعدى منتصف الليل)' : ''}`,
            expected_date: calcLast, actual_date: actualLast,
          });
        }
      }

      // 4. SIDE — last session date mismatch
      if (sideSlotDates.length > 0 && firstSideDate) {
        const lastSideRow   = sideRows[sideRows.length - 1];
        const actualSideLast = effectiveDate(lastSideRow.date, lastSideRow.time, lastSideRow.duration);
        const calcSideLast   = expectedSideLast(firstSideDate);
        if (actualSideLast !== calcSideLast) {
          const midnight = effectiveDate(lastSideRow.date, lastSideRow.time, lastSideRow.duration) !== lastSideRow.date;
          sideProblems.push({ ...meta, trainee_count: batch.trainee_count, first_date: firstSideDate,
            problem_type: 'تاريخ آخر جلسة جانبية غلط',
            detail: `المحسوب: ${calcSideLast} | الفعلي: ${actualSideLast}${midnight ? ' (تعدى منتصف الليل)' : ''}`,
            expected_date: calcSideLast, actual_date: actualSideLast,
          });
        }
      }
    }

    return res.json({ main_problems: mainProblems, side_problems: sideProblems,
      total: mainProblems.length + sideProblems.length });
  } catch (err) {
    console.error('[reports] code-problems error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/remarks-notes-options ──────────────────────────────────
// Returns dropdown options for coordinator, category, assigned_to
router.get('/remarks-notes-options', (req, res) => {
  try {
    const coordinators = db.prepare(
      `SELECT DISTINCT TRIM(coordinators) as val FROM batches
       WHERE coordinators IS NOT NULL AND TRIM(coordinators) != ''
       ORDER BY val`
    ).all().map(r => r.val);

    const categories = db.prepare(
      `SELECT DISTINCT TRIM(category) as val FROM remarks
       WHERE category IS NOT NULL AND TRIM(category) != ''
       ORDER BY val`
    ).all().map(r => r.val);

    const assignedTo = db.prepare(
      `SELECT DISTINCT TRIM(assigned_to) as val FROM remarks
       WHERE assigned_to IS NOT NULL AND TRIM(assigned_to) != ''
       ORDER BY val`
    ).all().map(r => r.val);

    return res.json({ coordinators, categories, assignedTo });
  } catch (err) {
    console.error('[reports] remarks-notes-options error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/group-trainees?group_name=xxx ──────────────────────────
router.get('/group-trainees', (req, res) => {
  const { group_name } = req.query;
  if (!group_name) return res.status(400).json({ error: 'group_name required' });
  try {
    const trainees = db.prepare(
      `SELECT name, phone FROM clients WHERE group_name = ? ORDER BY name ASC`
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
  try {
    const batch = db.prepare(`SELECT * FROM batches WHERE group_name = ?`).get(group_name);
    const lectures = db.prepare(
      `SELECT * FROM lectures WHERE group_name = ? ORDER BY date ASC`
    ).all(group_name);
    return res.json({ batch, lectures });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
