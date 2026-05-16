'use strict';
const db = require('../config/database');
const { saveNow } = require('../config/database');
const excel = require('./excel.service');

const FILE_TYPES = ['data', 'trainees', 'batches', 'remarks', 'lectures', 'side_sessions', 'absent', 'absent_zoom'];
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
/**
 * AUTO-ABSENT REGENERATION
 * ─────────────────────────
 * Rule (per business spec): when a lecture has status='مؤكدة' AND attendance is empty/0,
 * EVERY student in that group is considered absent for that lecture — even if the group
 * code does not appear in the manually-uploaded absent sheet.
 *
 * Implementation: deletes auto-generated rows (auto_generated=1) for the line, then
 * re-inserts them from current `lectures` + `clients` state. Manual rows (auto_generated=0)
 * are never touched. Idempotent — safe to call multiple times.
 *
 * Triggers: must run after any sync that changes lectures, clients, or absent records,
 * because (a) absent re-imports DELETE all rows including auto, (b) lectures/clients
 * changes alter the input data.
 *
 * Scope: main lectures → absent_students. Zoom calls (side + category='regular') →
 * absent_zoom_students. Other side sessions (compensatory/offboarding) are excluded.
 */
function regenerateAutoAbsents(line) {
  const EMPTY_ATTENDANCE = `(l.attendance IS NULL OR TRIM(COALESCE(l.attendance,'')) IN ('', '0'))`;

  // SMART RULE — skip auto-marking if any sibling lecture (same group/date/session-kind)
  // already has a real attendance count. Trainer recorded SOME attendance that day, so the
  // empty row is not "everyone absent" — just a split session or follow-up unrecorded by
  // mistake. Manual absent_zoom rows still cover the truly absent students.
  const HAS_SIBLING_WITH_ATTENDANCE = (sessionType, sideCategory) => `
    EXISTS (
      SELECT 1 FROM lectures l_sib
       WHERE l_sib.line       = l.line
         AND l_sib.group_name = l.group_name
         AND l_sib.date       = l.date
         AND l_sib.session_type = '${sessionType}'
         ${sideCategory ? `AND l_sib.side_session_category = '${sideCategory}'` : ''}
         AND l_sib.status = 'مؤكدة'
         AND l_sib.attendance IS NOT NULL
         AND TRIM(l_sib.attendance) <> ''
         AND TRIM(l_sib.attendance) <> '0'
    )`;

  const run = db.transaction(() => {
    // 1. clear previously auto-generated rows for this line
    db.prepare(`DELETE FROM absent_students      WHERE line = ? AND auto_generated = 1`).run(line);
    db.prepare(`DELETE FROM absent_zoom_students WHERE line = ? AND auto_generated = 1`).run(line);

    // 2. main lectures → absent_students
    db.prepare(`
      INSERT INTO absent_students (
        group_name, student_name, phone, date, time, lecture_no,
        follow_up_status, line, auto_generated, synced_at
      )
      SELECT DISTINCT
        l.group_name,
        c.name,
        c.phone,
        l.date,
        l.time,
        (SELECT COUNT(*) FROM lectures l2
          WHERE l2.line = l.line
            AND l2.session_type = 'main'
            AND l2.group_name = l.group_name
            AND (l2.date < l.date
              OR (l2.date = l.date AND COALESCE(l2.time,'') <= COALESCE(l.time,'')))) AS lecture_no,
        'pending',
        l.line,
        1,
        datetime('now','localtime')
      FROM lectures l
      INNER JOIN clients c
        ON c.line = l.line AND c.group_name = l.group_name
      WHERE l.line = ?
        AND l.session_type = 'main'
        AND l.status = 'مؤكدة'
        AND ${EMPTY_ATTENDANCE}
        AND NOT ${HAS_SIBLING_WITH_ATTENDANCE('main', null)}
        AND NOT EXISTS (
          SELECT 1 FROM absent_students a
           WHERE a.line       = l.line
             AND a.group_name = l.group_name
             AND a.date       = l.date
             AND a.phone      = c.phone
        )
    `).run(line);

    // 3. zoom calls (side + regular) → absent_zoom_students
    //
    // BUGFIX: zoom days often have many 15-min lecture slots (one per student
    // booking). Previously we inserted one absent_zoom row per (lecture, client),
    // so a student missing 7 slots on the same day got 7 duplicate auto-rows.
    // Fix: collapse the lecture set to ONE representative per (group, date) — the
    // first slot of the day — so each student gets exactly one auto-row per day.
    db.prepare(`
      INSERT INTO absent_zoom_students (
        group_name, student_name, phone, date, time, lecture_no,
        follow_up_status, line, auto_generated, synced_at
      )
      SELECT
        l.group_name,
        c.name,
        c.phone,
        l.date,
        l.time,
        (SELECT COUNT(*) FROM lectures l2
          WHERE l2.line = l.line
            AND l2.session_type = 'side'
            AND l2.side_session_category = 'regular'
            AND l2.group_name = l.group_name
            AND (l2.date < l.date
              OR (l2.date = l.date AND COALESCE(l2.time,'') <= COALESCE(l.time,'')))) AS lecture_no,
        'pending',
        l.line,
        1,
        datetime('now','localtime')
      FROM lectures l
      INNER JOIN clients c
        ON c.line = l.line AND c.group_name = l.group_name
      WHERE l.line = ?
        AND l.session_type = 'side'
        AND l.side_session_category = 'regular'
        AND l.status = 'مؤكدة'
        AND ${EMPTY_ATTENDANCE}
        AND NOT ${HAS_SIBLING_WITH_ATTENDANCE('side', 'regular')}
        AND NOT EXISTS (
          SELECT 1 FROM absent_zoom_students a
           WHERE a.line       = l.line
             AND a.group_name = l.group_name
             AND a.date       = l.date
             AND a.phone      = c.phone
        )
        AND l.id = (
          SELECT l3.id FROM lectures l3
           WHERE l3.line       = l.line
             AND l3.group_name = l.group_name
             AND l3.date       = l.date
             AND l3.session_type = 'side'
             AND l3.side_session_category = 'regular'
             AND l3.status = 'مؤكدة'
             AND (l3.attendance IS NULL OR TRIM(COALESCE(l3.attendance,'')) IN ('', '0'))
           ORDER BY COALESCE(l3.time,'') ASC, l3.id ASC
           LIMIT 1
        )
    `).run(line);
  });
  run();
}

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
function syncFile(fileType, buffer, userId, filename, line, options = {}) {
  if (!line) throw new Error('Line is required for upload (Ahmed Hassan | Dardasha)');
  if (!VALID_LINES.includes(line)) throw new Error(`Invalid line: ${line}`);

  // Optional: drive_file_id — set when imported via Drive Sync. Stored in
  // excel_syncs so Smart Sync can compare by file IDENTITY (not just time),
  // which protects against the "new upload with old local mtime" case.
  // Manual uploads (no Drive context) pass null and the column stays NULL.
  const driveFileId = options.driveFileId || null;

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
      case 'absent_zoom':  rows = syncAbsentZoom(buffer, line);          break;
      default: throw new Error(`Unknown file type: ${fileType}`);
    }
    syncEntry.rows_imported = rows;
  } catch (err) {
    syncEntry.status = 'error';
    syncEntry.error_msg = err.message;
    throw err;
  } finally {
    db.prepare(`
      INSERT INTO excel_syncs (file_type, filename, rows_imported, status, error_msg, uploaded_by, line, drive_file_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `).run(
      syncEntry.file_type, syncEntry.filename, syncEntry.rows_imported,
      syncEntry.status, syncEntry.error_msg, syncEntry.uploaded_by,
      syncEntry.line, driveFileId
    );
    // Force immediate disk write — prevents data loss on Railway rolling deployments
    saveNow();
  }
  return { rows_imported: syncEntry.rows_imported, warnings };
}

// ─── INDIVIDUAL SYNC FUNCTIONS (all scoped by line) ───────────────────────────

function syncEmployees(buffer, line) {
  const rows = excel.parseEmployees(buffer);
  const run = db.transaction(() => {
    db.prepare('DELETE FROM employees WHERE line = ?').run(line);
    const insert = db.prepare(`INSERT INTO employees (name, department, line, synced_at)
      VALUES (?, ?, ?, datetime('now', 'localtime'))`);
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
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `);
    rows.forEach(r => insert.run(r.name, r.phone, r.email, r.group_name, r.via_company, r.registration_time, line));
  });
  run();
  // Roster changed → recompute auto-absences (students added/removed from groups)
  // Auto-absent refresh is best-effort — never let a failure here break the upload.
  try { regenerateAutoAbsents(line); }
  catch (e) { console.error('[regenerateAutoAbsents]', e.message); }
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
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now', 'localtime'))
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
  // Use DISTINCT + filter to incoming ids only — defends against any accidental
  // duplicate rows that might exist for the same (external_id, line) pair.
  const incomingIds = [...new Set(rows.map(r => r.external_id).filter(id => id != null && Number.isFinite(id)))];
  console.log(`[syncRemarks] line=${line} | parsed_rows=${rows.length} | unique_incoming_ids=${incomingIds.length}`);
  if (incomingIds.length) {
    // Build chunked IN-query (SQLite handles up to ~999 params; chunk at 500 to be safe)
    const CHUNK = 500;
    // Use a Map keyed by external_id to dedupe collisions and report each ID once
    const collisionMap = new Map();
    for (let i = 0; i < incomingIds.length; i += CHUNK) {
      const chunk = incomingIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const found = db.prepare(
        `SELECT DISTINCT external_id, line FROM remarks WHERE line != ? AND external_id IN (${placeholders})`
      ).all(line, ...chunk);
      for (const f of found) {
        const key = `${f.external_id}|${f.line}`;
        if (!collisionMap.has(key)) collisionMap.set(key, f);
      }
    }
    const collisions = [...collisionMap.values()];
    console.log(`[syncRemarks] line=${line} | collision_count=${collisions.length}`);
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

    // Evict same external_ids from OTHER lines — each external_id belongs to ONE line only
    if (incomingIds.length) {
      const CHUNK = 500;
      for (let i = 0; i < incomingIds.length; i += CHUNK) {
        const chunk = incomingIds.slice(i, i + CHUNK);
        const ph = chunk.map(() => '?').join(',');
        db.prepare(`DELETE FROM remarks WHERE line != ? AND external_id IN (${ph})`).run(line, ...chunk);
      }
    }

    const insert = db.prepare(`
      INSERT INTO remarks (
        external_id, task_type, assigned_to, details, category, status,
        client_name, client_phone, priority, assigned_by, notes,
        added_at, last_updated, sla_deadline,
        agent_notes, resolved_at, line, synced_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now', 'localtime'))
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'main', NULL, ?, datetime('now', 'localtime'))
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
  // Main lectures changed → recompute auto-absences for confirmed empty-attendance rows
  // Auto-absent refresh is best-effort — never let a failure here break the upload.
  try { regenerateAutoAbsents(line); }
  catch (e) { console.error('[regenerateAutoAbsents]', e.message); }
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'side', ?, ?, datetime('now', 'localtime'))
    `);
    rows.forEach(r => insert.run(r.group_name, r.date, r.time, r.duration, r.trainer, r.status, r.location, r.attendance, r.side_session_category, line));
  });
  run();
  // Side sessions changed → recompute auto-absences for zoom calls (regular)
  // Auto-absent refresh is best-effort — never let a failure here break the upload.
  try { regenerateAutoAbsents(line); }
  catch (e) { console.error('[regenerateAutoAbsents]', e.message); }
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
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
  // Manual upload wiped the table → re-create auto-generated rows from current lectures+clients
  // Auto-absent refresh is best-effort — never let a failure here break the upload.
  try { regenerateAutoAbsents(line); }
  catch (e) { console.error('[regenerateAutoAbsents]', e.message); }
  return rows.length;
}

function syncAbsentZoom(buffer, line) {
  // Same parser as the main absent file — columns are identical
  const rows = excel.parseAbsent(buffer);

  // Snapshot follow-up data BEFORE delete — SCOPED by line
  const preserved = {};
  db.prepare('SELECT group_name, student_name, date, lecture_no, follow_up_status, follow_up_note, follow_up_by, follow_up_at FROM absent_zoom_students WHERE line = ?')
    .all(line)
    .forEach(r => {
      const key = `${r.group_name}|${r.student_name}|${r.date}|${r.lecture_no}`;
      preserved[key] = { follow_up_status: r.follow_up_status, follow_up_note: r.follow_up_note, follow_up_by: r.follow_up_by, follow_up_at: r.follow_up_at };
    });

  const uniqueAbsentGroups = [...new Set(rows.map(r => r.group_name).filter(Boolean))];
  const run = db.transaction(() => {
    db.prepare('DELETE FROM absent_zoom_students WHERE line = ?').run(line);
    // Claim exclusive ownership of these groups' zoom-absent records
    evictFromOtherLines('absent_zoom_students', line, uniqueAbsentGroups);
    const insert = db.prepare(`
      INSERT INTO absent_zoom_students (group_name, student_name, phone, date, time, lecture_no, follow_up_status, follow_up_note, follow_up_by, follow_up_at, line, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
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
  // Manual upload wiped the table → re-create auto-generated rows from current lectures+clients
  // Auto-absent refresh is best-effort — never let a failure here break the upload.
  try { regenerateAutoAbsents(line); }
  catch (e) { console.error('[regenerateAutoAbsents]', e.message); }
  return rows.length;
}

function regenerateAllLines() {
  VALID_LINES.forEach(ln => {
    try { regenerateAutoAbsents(ln); }
    catch (e) { console.error(`[regenerateAutoAbsents:${ln}]`, e.message); }
  });
}

module.exports = { syncFile, FILE_TYPES, VALID_LINES, regenerateAutoAbsents, regenerateAllLines };
