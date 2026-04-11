'use strict';
const db = require('../config/database');
const excel = require('./excel.service');

const FILE_TYPES = ['data', 'trainees', 'batches', 'remarks', 'lectures', 'side_sessions', 'absent'];

/**
 * Main sync entry point
 * fileType: one of FILE_TYPES
 * buffer: Excel file buffer
 * userId: uploader user id
 */
function syncFile(fileType, buffer, userId, filename) {
  const syncEntry = { file_type: fileType, filename, rows_imported: 0, status: 'success', error_msg: null, uploaded_by: userId };
  try {
    let rows = 0;
    switch (fileType) {
      case 'data':         rows = syncEmployees(buffer);   break;
      case 'trainees':     rows = syncTrainees(buffer);    break;
      case 'batches':      rows = syncBatches(buffer);     break;
      case 'remarks':      rows = syncRemarks(buffer);     break;
      case 'lectures':     rows = syncLectures(buffer);    break;
      case 'side_sessions':rows = syncSideSessions(buffer);break;
      case 'absent':       rows = syncAbsent(buffer);      break;
      default: throw new Error(`Unknown file type: ${fileType}`);
    }
    syncEntry.rows_imported = rows;
  } catch (err) {
    syncEntry.status = 'error';
    syncEntry.error_msg = err.message;
    throw err;
  } finally {
    db.prepare(`
      INSERT INTO excel_syncs (file_type, filename, rows_imported, status, error_msg, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(syncEntry.file_type, syncEntry.filename, syncEntry.rows_imported, syncEntry.status, syncEntry.error_msg, syncEntry.uploaded_by);
  }
  return syncEntry.rows_imported;
}

// ─── INDIVIDUAL SYNC FUNCTIONS ────────────────────────────────────────────────

function syncEmployees(buffer) {
  const rows = excel.parseEmployees(buffer);
  const run = db.transaction(() => {
    db.prepare('DELETE FROM employees').run();
    const insert = db.prepare('INSERT INTO employees (name, department, synced_at) VALUES (?, ?, datetime(\'now\'))');
    rows.forEach(r => insert.run(r.name, r.department));
  });
  run();
  return rows.length;
}

function syncTrainees(buffer) {
  const rows = excel.parseTrainees(buffer);
  const run = db.transaction(() => {
    db.prepare('DELETE FROM clients').run();
    const insert = db.prepare(`
      INSERT INTO clients (name, phone, email, group_name, via_company, registration_time, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+2 hours'))
    `);
    rows.forEach(r => insert.run(r.name, r.phone, r.email, r.group_name, r.via_company, r.registration_time));
  });
  run();
  return rows.length;
}

function syncBatches(buffer) {
  const rows = excel.parseBatches(buffer);
  const run = db.transaction(() => {
    db.prepare('DELETE FROM batches').run();
    const insert = db.prepare(`
      INSERT INTO batches (
        external_id, group_name, course, status, trainers,
        trainee_count, max_trainees, scheduled_lectures, completed_lectures,
        start_date, end_date, training_schedule, coordinators,
        added_at, added_by, closed_by,
        dept_type, level_code, main_days, side_days, lecture_duration_min,
        synced_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now', '+2 hours'))
    `);
    rows.forEach(r => insert.run(
      r.external_id, r.group_name, r.course, r.status, r.trainers,
      r.trainee_count, r.max_trainees, r.scheduled_lectures, r.completed_lectures,
      r.start_date, r.end_date, r.training_schedule, r.coordinators,
      r.added_at, r.added_by, r.closed_by,
      r.dept_type, r.level_code, r.main_days, r.side_days, r.lecture_duration_min
    ));
  });
  run();
  return rows.length;
}

function syncRemarks(buffer) {
  const rows = excel.parseRemarks(buffer);

  // Snapshot preserved agent data BEFORE delete
  const preserved = {};
  db.prepare('SELECT external_id, agent_notes, resolved_at FROM remarks WHERE external_id IS NOT NULL')
    .all()
    .forEach(r => { preserved[r.external_id] = { agent_notes: r.agent_notes, resolved_at: r.resolved_at }; });

  const run = db.transaction(() => {
    db.prepare('DELETE FROM remarks').run();
    const insert = db.prepare(`
      INSERT INTO remarks (
        external_id, task_type, assigned_to, details, category, status,
        client_name, client_phone, priority, assigned_by, notes,
        added_at, last_updated, sla_deadline,
        agent_notes, resolved_at, synced_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now', '+2 hours'))
    `);
    rows.forEach(r => {
      const p = preserved[r.external_id] || {};
      insert.run(
        r.external_id, r.task_type, r.assigned_to, r.details, r.category, r.status,
        r.client_name, r.client_phone, r.priority, r.assigned_by, r.notes,
        r.added_at, r.last_updated, r.sla_deadline,
        p.agent_notes || null, p.resolved_at || null
      );
    });
  });
  run();
  return rows.length;
}

function syncLectures(buffer) {
  const rows = excel.parseLectures(buffer);
  const run = db.transaction(() => {
    db.prepare("DELETE FROM lectures WHERE session_type = 'main'").run();
    const insert = db.prepare(`
      INSERT INTO lectures (group_name, date, time, duration, trainer, status, location, attendance, session_type, side_session_category, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'main', NULL, datetime('now', '+2 hours'))
    `);
    rows.forEach(r => insert.run(r.group_name, r.date, r.time, r.duration, r.trainer, r.status, r.location, r.attendance));
  });
  run();
  return rows.length;
}

function syncSideSessions(buffer) {
  const rows = excel.parseSideSessions(buffer);
  const run = db.transaction(() => {
    db.prepare("DELETE FROM lectures WHERE session_type = 'side'").run();
    const insert = db.prepare(`
      INSERT INTO lectures (group_name, date, time, duration, trainer, status, location, attendance, session_type, side_session_category, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'side', ?, datetime('now', '+2 hours'))
    `);
    rows.forEach(r => insert.run(r.group_name, r.date, r.time, r.duration, r.trainer, r.status, r.location, r.attendance, r.side_session_category));
  });
  run();
  return rows.length;
}

function syncAbsent(buffer) {
  const rows = excel.parseAbsent(buffer);

  // Snapshot follow-up data BEFORE delete
  const preserved = {};
  db.prepare('SELECT group_name, student_name, date, lecture_no, follow_up_status, follow_up_note, follow_up_by, follow_up_at FROM absent_students')
    .all()
    .forEach(r => {
      const key = `${r.group_name}|${r.student_name}|${r.date}|${r.lecture_no}`;
      preserved[key] = { follow_up_status: r.follow_up_status, follow_up_note: r.follow_up_note, follow_up_by: r.follow_up_by, follow_up_at: r.follow_up_at };
    });

  const run = db.transaction(() => {
    db.prepare('DELETE FROM absent_students').run();
    const insert = db.prepare(`
      INSERT INTO absent_students (group_name, student_name, phone, date, time, lecture_no, follow_up_status, follow_up_note, follow_up_by, follow_up_at, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+2 hours'))
    `);
    rows.forEach(r => {
      const key = `${r.group_name}|${r.student_name}|${r.date}|${r.lecture_no}`;
      const p = preserved[key] || {};
      insert.run(r.group_name, r.student_name, r.phone, r.date, r.time, r.lecture_no,
        p.follow_up_status || 'pending', p.follow_up_note || null, p.follow_up_by || null, p.follow_up_at || null);
    });
  });
  run();
  return rows.length;
}

module.exports = { syncFile, FILE_TYPES };
