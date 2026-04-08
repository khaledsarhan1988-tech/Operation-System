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

    // 7. Open remarks
    const openRemarksList = db.prepare(
      `SELECT * FROM remarks
       WHERE LOWER(status) NOT IN ('closed','مغلق','resolved')
       ${buildDateFilter('remarks.added_at', from_date, to_date)}
       ${empRemark}${deptRemark}
       ORDER BY added_at DESC`
    ).all();

    // 8a. Remarks errors (open >= 3 hours)
    const remarksErrors = db.prepare(
      `SELECT *,
         ROUND((julianday('now') - julianday(added_at)) * 24, 1) as hours_open,
         CASE
           WHEN ROUND((julianday('now') - julianday(added_at)) * 24, 1) BETWEEN 3 AND 24 THEN 'urgent'
           WHEN ROUND((julianday('now') - julianday(added_at)) * 24, 1) BETWEEN 24 AND 48 THEN 'important'
           WHEN ROUND((julianday('now') - julianday(added_at)) * 24, 1) BETWEEN 48 AND 72 THEN 'normal'
           WHEN ROUND((julianday('now') - julianday(added_at)) * 24, 1) > 72 THEN 'overdue'
           ELSE 'ok'
         END as urgency_level
       FROM remarks
       WHERE LOWER(status) NOT IN ('closed','مغلق','resolved')
         AND ROUND((julianday('now') - julianday(added_at)) * 24, 1) >= 3
         ${deptRemark}
       ORDER BY hours_open DESC`
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
        open_remarks:          openRemarksList.length,
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

  // For side sessions: add onboarding/offboarding counts per group
  const sideExtraFields = session_type === 'side' ? `,
    (SELECT COUNT(*) FROM lectures lx
     WHERE lx.group_name = l.group_name
       AND lx.session_type = 'side'
       AND lx.side_session_category = 'onboarding') AS onboarding_count,
    (SELECT COUNT(*) FROM lectures lx
     WHERE lx.group_name = l.group_name
       AND lx.session_type = 'side'
       AND lx.side_session_category = 'offboarding') AS offboarding_count` : '';

  const allFilters = `${dateFilter}${deptFilter}${empFilter}${trainerFilter}${coordFilter}${searchFilter}`;

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
