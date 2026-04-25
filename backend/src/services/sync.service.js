'use strict';
const db = require('../config/database');
const excel = require('./excel.service');

const FILE_TYPES = ['data', 'trainees', 'batches', 'remarks', 'lectures', 'side_sessions', 'absent'];
const VALID_LINES = ['Ahmed Hassan', 'Dardasha'];

/**
 * Exclusive group ownership — when a group is uploaded for a line,
 * remove it from ALL other lines to prevent cross-line duplication.
 * Each group_name belongs to exactly ONE line at a time.
 *
 * @param {string} table       - table name
 * @param {string} line        - the current (new owner) line
 * @param {string[]} groupNames - unique group_names being uploaded
 * @param {string} extraWhere  - optional extra WHERE clause (e.g. " AND session_type='side'")
 */
function evictFromOtherLines(table, line, groupNames, extraWhere = '') {
  if (!groupNames.length) return;
  const CHUNK = 500;
  for (let i = 0; i < groupNames.length; i += CHUNK) {
    const chunk = groupNames.slice(i, i + CHUNK);
    const ph = chunk.map(() => '?').join(',');
    db.prepare(
      `DELETE FROM ${table} WHERE line != ? AND group_name IN (${ph})${extraWhere}`
    ).run(line, ...chunk);
  }
}

/**
 * Main sync entry point — MULTI-LINE aware
 *
 * fileType: one of FILE_TYPES
 * buffer:   Excel file buffer
 * userId:   uploader user id
 * filename: original filename
 * line:     which operational line this upload targets (REQUIRED)
 *
 * Returns: { rows_imported, warnings: [] }
 * Each line operates on isolated data — DELETE + INSERT are scoped by line.
 * Cross-line external_id duplicates are detected and returned as warnings (non-fatal).
 */
function syncFile(fileType, buffer, userId, filename, line) {
  if (!line) throw new Error('Line is required for upload (Ahmed Hassan | Dardasha)');
  if (!VALID_LINES.includes(line)) throw new Error(`Invalid line: ${line}`);

  const syncEntry = { file_type: fileType, filename, rows_imported: 0, status: 'success', error_msg: null, uploaded_by: userId, line };
  const warnings = [];
  try {
    let rows = 0;
    switch (fileType) {
      case 'data':         rows = syncEmployees(buffer, line);           break;
      case 'trainees':     rows = syncTrainees(buffer, line);            break;
      case 'batches':      rows = syncBatches(buffer, line);             break;
      case 'remarks':      rows = syncRemarks(buffer, line, warnings);   break;
      case 'lectures':     rows = syncLectures(buffer, line);            break;
      case 'side_sessions':rows = syncSideSessions(buffer, line);        break;
      case 'absent':       rows = syncAbsent(buffer, line);              break;
      default: throw new Error(`Unknown file type: ${fileType}`);
    }
    syncEntry.rows_imported = rows;
  } catch (err) {
    syncEntry.status = 'error';
    syncEntry.error_msg = err.message;
    throw err;
  } finally {
    db.prepare(`
      INSERT INTO excel_syncs (file_type, filename, rows_imported, status, error_msg, uploaded_by, line)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(syncEntry.file_type, syncEntry.filename, syncEntry.rows_imported, syncEntry.status, syncEntry.error_msg, syncEntry.uploaded_by, syncEntry.line);
  }
  return { rows_imported: syncEntry.rows_imported, warnings };
}

// ─── INDIVIDUAL SYNC FUNCTIONS (all scoped by line) ───────────────────────────

function syncEmployees(buffer, line) {
  const rows = excel.parseEmployees(buffer);
  const run = db.transaction(() => {
    db.prepare('DELETE FROM employees WHERE line = ?').run(line);
    const insert = db.prepare(`INSERT INTO employees (name, department, line, synced_at)
      VALUES (?, ?, ?, datetime('now', '+2 hours'))`);
    rows.forEach(r => insert.run(r.name, r.department, line));
  });
  run();
  return rows.length;
}

function syncTrainees(buffer, line) {
  const rows = excel.parseTrainees(buffer);
  const uniqueGroups = [...new Set(rows.map(r => r.group_name).filter(Boolean))];
  const run = db.transaction(() => {
    db.prepare('DELETE FROM clients WHERE line = ?').run(line);
    // Claim exclusive ownership of these groups' trainees
    evictFromOtherLines('clients', line, uniqueGroups);
    const insert = db.prepare(`
      INSERT INTO clients (name, phone, email, group_name, via_company, registration_time, line, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+2 hours'))
    `);
    rows.forEach(r => insert.run(r.name, r.phone, r.email, r.group_name, r.via_company, r.registration_time, line));
  });
  run();
  return rows.length;
}

function syncBatches(buffer, line) {
  const rows = excel.parseBatches(buffer);
  const uniqueGroups = [...new Set(rows.map(r => r.group_name))];
  const run = db.transaction(() => {
    // Remove this line's old batches
    db.prepare('DELETE FROM batches WHERE line = ?').run(line);
    // Claim exclusive ownership — remove same groups from other lines
    evictFromOtherLines('batches', line, uniqueGroups);
    evictFromOtherLines('lectures', line, uniqueGroups, " AND session_type = 'main'");
    evictFromOtherLines('lectures', line, uniqueGroups, " AND session_type = 'side'");
    evictFromOtherLines('clients', line, uniqueGroups);
    evictFromOtherLines('absent_students', line, uniqueGroups);
    const insert = db.prepare(`
      INSERT INTO batches (
        external_id, group_name, course, status, trainers,
        trainee_count, max_trainees, scheduled_lectures, completed_lectures,
        start_date, end_date, training_schedule, coordinators,
        added_at, added_by, closed_by,
        dept_type, level_code, main_days, side_days, lecture_duration_min,
        line, synced_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now', '+2 hours'))
    `);
    rows.forEach(r => insert.run(
      r.external_id, r.group_name, r.course, r.status, r.trainers,
      r.trainee_count, r.max_trainees, r.scheduled_lectures, r.completed_lectures,
      r.start_date, r.end_date, r.training_schedule, r.coordinators,
      r.added_at, r.added_by, r.closed_by,
      r.dept_type, r.level_code, r.main_days, r.side_days, r.lecture_duration_min,
      line
    ));
  });
  run();
  return rows.length;
}

function syncRemarks(buffer, line, warnings) {
  const rows = excel.parseRemarks(buffer);

  // ─── CROSS-LINE DUPLICATE DETECTION ───────────────────────────
  // Check: any external_id from incoming rows that already exists in OTHER lines?
  const incomingIds = rows.map(r => r.external_id).filter(id => id != null);
  if (incomingIds.length) {
    // Build chunked IN-query (sql.js handles up to ~999 params comfortably)
    const CHUNK = 500;
    const collisions = [];
    for (let i = 0; i < incomingIds.length; i += CHUNK) {
      const chunk = incomingIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const found = db.prepare(
        `SELECT external_id, line FROM remarks WHERE line != ? AND external_id IN (${placeholders})`
      ).all(line, ...chunk);
      collisions.push(...found);
    }
    if (collisions.length) {
      warnings.push({
        type: 'cross_line_duplicate_external_id',
        file: 'remarks',
        message: `⚠ تم اكتشاف ${collisions.length} external_id مكرر بين الـ Lines`,
        count: collisions.length,
        details: collisions.map(c => ({
          external_id: c.external_id,
          exists_in_line: c.line,
          uploading_to_line: line,
        })),
      });
    }
  }

  // Snapshot preserved agent data BEFORE delete — SCOPED by line + external_id
  const preserved = {};
  db.prepare('SELECT external_id, agent_notes, resolved_at FROM remarks WHERE line = ? AND external_id IS NOT NULL')
    .all(line)
    .forEach(r => { preserved[r.external_id] = { agent_notes: r.agent_notes, resolved_at: r.resolved_at }; });

  const run = db.transaction(() => {
    db.prepare('DELETE FROM remarks WHERE line = ?').run(line);
    const insert = db.prepare(`
      INSERT INTO remarks (
        external_id, task_type, assigned_to, details, category, status,
        client_name, client_phone, priority, assigned_by, notes,
        added_at, last_updated, sla_deadline,
        agent_notes, resolved_at, line, synced_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now', '+2 hours'))
    `);
    rows.forEach(r => {
      const p = preserved[r.external_id] || {};
      insert.run(
        r.external_id, r.task_type, r.assigned_to, r.details, r.category, r.status,
        r.client_name, r.client_phone, r.priority, r.assigned_by, r.notes,
        r.added_at, r.last_updated, r.sla_deadline,
        p.agent_notes || null, p.resolved_at || null,
        line
      );
    });
  });
  run();
  return rows.length;
}

function syncLectures(buffer, line) {
  const rows = excel.parseLectures(buffer);
  const uniqueGroups = [...new Set(rows.map(r => r.group_name))];
  const run = db.transaction(() => {
    db.prepare("DELETE FROM lectures WHERE session_type = 'main' AND line = ?").run(line);
    // Claim exclusive ownership of these groups' main lectures
    evictFromOtherLines('lectures', line, uniqueGroups, " AND session_type = 'main'");
    const insert = db.prepare(`
      INSERT INTO lectures (group_name, date, time, duration, trainer, status, location, attendance, session_type, side_session_category, line, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'main', NULL, ?, datetime('now', '+2 hours'))
    `);
    rows.forEach(r => insert.run(r.group_name, r.date, r.time, r.duration, r.trainer, r.status, r.location, r.attendance, line));

    // Update completed_lectures ONLY for this line's batches — count CONFIRMED lectures only
    // (unconfirmed lectures are excluded from all CS reports per business rule).
    db.prepare(`
      UPDATE batches
      SET completed_lectures = (
        SELECT COUNT(*) FROM lectures l
        WHERE l.group_name = batches.group_name
          AND l.session_type = 'main'
          AND l.status != 'غير مؤكدة'
          AND l.line = batches.line
      )
      WHERE line = ?
        AND EXISTS (
          SELECT 1 FROM lectures l
          WHERE l.group_name = batches.group_name
            AND l.session_type = 'main'
            AND l.line = batches.line
        )
    `).run(line);
  });
  run();
  return rows.length;
}

function syncSideSessions(buffer, line) {
  const rows = excel.parseSideSessions(buffer);
  const uniqueGroups = [...new Set(rows.map(r => r.group_name))];
  const run = db.transaction(() => {
    db.prepare("DELETE FROM lectures WHERE session_type = 'side' AND line = ?").run(line);
    // Claim exclusive ownership of these groups' side sessions
    evictFromOtherLines('lectures', line, uniqueGroups, " AND session_type = 'side'");
    const insert = db.prepare(`
      INSERT INTO lectures (group_name, date, time, duration, trainer, status, location, attendance, session_type, side_session_category, line, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'side', ?, ?, datetime('now', '+2 hours'))
    `);
    rows.forEach(r => insert.run(r.group_name, r.date, r.time, r.duration, r.trainer, r.status, r.location, r.attendance, r.side_session_category, line));
  });
  run();
  return rows.length;
}

function syncAbsent(buffer, line) {
  const rows = excel.parseAbsent(buffer);

  // Snapshot follow-up data BEFORE delete — SCOPED by line
  const preserved = {};
  db.prepare('SELECT group_name, student_name, date, lecture_no, follow_up_status, follow_up_note, follow_up_by, follow_up_at FROM absent_students WHERE line = ?')
    .all(line)
    .forEach(r => {
      const key = `${r.group_name}|${r.student_name}|${r.date}|${r.lecture_no}`;
      preserved[key] = { follow_up_status: r.follow_up_status, follow_up_note: r.follow_up_note, follow_up_by: r.follow_up_by, follow_up_at: r.follow_up_at };
    });

  const uniqueAbsentGroups = [...new Set(rows.map(r => r.group_name).filter(Boolean))];
  const run = db.transaction(() => {
    db.prepare('DELETE FROM absent_students WHERE line = ?').run(line);
    // Claim exclusive ownership of these groups' absent records
    evictFromOtherLines('absent_students', line, uniqueAbsentGroups);
    const insert = db.prepare(`
      INSERT INTO absent_students (group_name, student_name, phone, date, time, lecture_no, follow_up_status, follow_up_note, follow_up_by, follow_up_at, line, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+2 hours'))
    `);
    rows.forEach(r => {
      const key = `${r.group_name}|${r.student_name}|${r.date}|${r.lecture_no}`;
      const p = preserved[key] || {};
      insert.run(r.group_name, r.student_name, r.phone, r.date, r.time, r.lecture_no,
        p.follow_up_status || 'pending', p.follow_up_note || null, p.follow_up_by || null, p.follow_up_at || null,
        line);
    });
  });
  run();
  return rows.length;
}

module.exports = { syncFile, FILE_TYPES, VALID_LINES };
