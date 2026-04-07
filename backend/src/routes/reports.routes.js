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

    // 6. Absent side — only valid side sessions (duration <= 15 min, excludes Onboarding/Offboarding)
    const absentSideRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM side_session_checks
       WHERE student_present = 0
         AND (actual_duration_min IS NULL OR actual_duration_min <= 15)
       ${buildDateFilter('session_date', from_date, to_date)}`
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
  const { from_date, to_date, department, employee, session_type = 'main', page = 1, limit = 100, search = '' } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const deptFilter   = department && department !== 'All' ? ` AND b.dept_type = '${department}'` : '';
  const empFilter    = employee ? ` AND b.coordinators LIKE '%${employee}%'` : '';
  const searchFilter = search   ? ` AND l.group_name LIKE '%${search}%'` : '';
  const dateFilter   = from_date && to_date ? ` AND l.date BETWEEN '${from_date}' AND '${to_date}'`
                     : from_date ? ` AND l.date >= '${from_date}'`
                     : to_date   ? ` AND l.date <= '${to_date}'` : '';

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

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM lectures l
       LEFT JOIN batches b ON l.group_name = b.group_name
       WHERE l.session_type = '${session_type}'${dateFilter}${deptFilter}${empFilter}${searchFilter}`
    ).get();

    const rows = db.prepare(
      `SELECT l.*, b.dept_type, b.coordinators, b.lecture_duration_min${sideExtraFields}
       FROM lectures l
       LEFT JOIN batches b ON l.group_name = b.group_name
       WHERE l.session_type = '${session_type}'${dateFilter}${deptFilter}${empFilter}${searchFilter}
       ORDER BY l.date DESC LIMIT ${Number(limit)} OFFSET ${offset}`
    ).all();

    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/absent-list ─────────────────────────────────────────────
router.get('/absent-list', (req, res) => {
  const { from_date, to_date, department, employee, page = 1, limit = 100, search = '' } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const deptFilter   = department && department !== 'All' ? ` AND b.dept_type = '${department}'` : '';
  const empFilter    = employee ? ` AND b.coordinators LIKE '%${employee}%'` : '';
  const searchFilter = search   ? ` AND a.group_name LIKE '%${search}%'` : '';
  const dateFilter   = from_date && to_date ? ` AND a.date BETWEEN '${from_date}' AND '${to_date}'`
                     : from_date ? ` AND a.date >= '${from_date}'`
                     : to_date   ? ` AND a.date <= '${to_date}'` : '';
  // استبعاد الصفوف التي لا يوجد بها اسم الطالب أو رقم الموبايل
  const validFilter = ` AND a.student_name IS NOT NULL AND TRIM(a.student_name) != ''
                        AND a.phone IS NOT NULL AND TRIM(a.phone) != ''`;

  try {
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM absent_students a
       LEFT JOIN batches b ON a.group_name = b.group_name
       WHERE 1=1${validFilter}${dateFilter}${deptFilter}${empFilter}${searchFilter}`
    ).get();
    const rows = db.prepare(
      `SELECT a.*, b.dept_type, b.coordinators FROM absent_students a
       LEFT JOIN batches b ON a.group_name = b.group_name
       WHERE 1=1${validFilter}${dateFilter}${deptFilter}${empFilter}${searchFilter}
       ORDER BY a.date DESC LIMIT ${Number(limit)} OFFSET ${offset}`
    ).all();
    return res.json({ total: totalRow.cnt, page: Number(page), limit: Number(limit), rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/absent-side-list ────────────────────────────────────────
// Returns grouped rows: per group + session_date
// Only counts valid side sessions (duration <= 15 min — excludes Onboarding/Offboarding)
router.get('/absent-side-list', (req, res) => {
  const { from_date, to_date, department, employee, page = 1, limit = 100, search = '' } = req.query;
  const offset       = (Number(page) - 1) * Number(limit);
  const deptFilter   = department && department !== 'All' ? ` AND b.dept_type = '${department}'` : '';
  const empFilter    = employee ? ` AND b.coordinators LIKE '%${employee}%'` : '';
  const searchFilter = search ? ` AND ssc.group_name LIKE '%${search}%'` : '';
  const dateFilter   = from_date && to_date
    ? ` AND ssc.session_date BETWEEN '${from_date}' AND '${to_date}'`
    : from_date ? ` AND ssc.session_date >= '${from_date}'`
    : to_date   ? ` AND ssc.session_date <= '${to_date}'` : '';

  // Only valid side sessions: duration <= 15 min or not recorded
  const durationFilter = ` AND (ssc.actual_duration_min IS NULL OR ssc.actual_duration_min <= 15)`;

  const baseWhere = `WHERE 1=1 ${durationFilter}${dateFilter}${deptFilter}${empFilter}${searchFilter}`;

  try {
    // Count distinct group+date combinations that have at least 1 absent
    const totalRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM (
         SELECT ssc.group_name, ssc.session_date
         FROM side_session_checks ssc
         LEFT JOIN batches b ON ssc.group_name = b.group_name
         ${baseWhere}
         GROUP BY ssc.group_name, ssc.session_date
         HAVING SUM(CASE WHEN ssc.student_present = 0 THEN 1 ELSE 0 END) > 0
       )`
    ).get();

    const rows = db.prepare(
      `SELECT
         ssc.group_name,
         ssc.session_date,
         MAX(l.trainer)                                                   AS trainer,
         MAX(b.coordinators)                                              AS coordinators,
         MAX(b.dept_type)                                                 AS dept_type,
         COUNT(*)                                                         AS total_checked,
         SUM(CASE WHEN ssc.student_present = 1 THEN 1 ELSE 0 END)        AS present_count,
         SUM(CASE WHEN ssc.student_present = 0 THEN 1 ELSE 0 END)        AS absent_count,
         MAX(ssc.lecture_start_time)                                      AS lecture_start_time,
         MAX(ssc.actual_duration_min)                                     AS actual_duration_min,
         MAX(l.side_session_category)                                     AS side_session_category,
         MAX(ssc.notes)                                                   AS notes
       FROM side_session_checks ssc
       LEFT JOIN batches b ON ssc.group_name = b.group_name
       LEFT JOIN lectures l ON ssc.lecture_id = l.id
       ${baseWhere}
       GROUP BY ssc.group_name, ssc.session_date
       HAVING absent_count > 0
       ORDER BY ssc.session_date DESC
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
