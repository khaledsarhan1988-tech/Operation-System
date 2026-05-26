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

// Normalize a coordinators field (TEXT, may contain comma-separated names) to a
// sorted unique Set of trimmed lowercase-keyed names. Returns Map<lowerKey, original>
// so we preserve the original casing for storage but use the lowercase for comparison.
function parseCoordinatorList(coordField) {
  const map = new Map();
  if (!coordField) return map;
  String(coordField).split(',').forEach(raw => {
    const t = raw.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (!map.has(key)) map.set(key, t);
  });
  return map;
}

// Extract the "stable identifier" of a group code — everything BEFORE the
// FIRST `(`. The parens contain the trainer name; what follows them is the
// coordinator. Both can change over the life of a batch (trainer leaves,
// coordinator reassigned) without the batch itself changing identity.
// Stripping both gives us a stable anchor for rename detection.
//
// Examples:
//   "Apr_19_Sun_11pm_ General1 _SP(Nashwa Shabaan)alaa" → "apr_19_sun_11pm_ general1 _sp"
//   "Apr_19_Sun_11pm_ General1 _SP(Yasmeen Mohamed)alaa" → "apr_19_sun_11pm_ general1 _sp"
//   "May_10_Sun_10PM_Con2_P(Asmaa)hanaa"                → "may_10_sun_10pm_con2_p"
//   "Apr_29_Sat_9Pm_General3(Ali Hashem)"               → "apr_29_sat_9pm_general3"
//   "no_parens_code"                                    → null (can't split)
//
// ⚠ TRADE-OFF: two parallel batches with the same prefix (different trainers
// AND different coordinators running in parallel) would collide. In practice
// the prefix encodes month/day/weekday/time/course so this is rare — but if
// it happens, the admin sees both as the same batch and can reject the
// resulting reschedule rows.
function getStableIdentifier(groupName) {
  if (!groupName) return null;
  const s = String(groupName).trim();
  const idx = s.indexOf('(');
  if (idx === -1) return null;   // no `(` → can't reliably split
  return s.substring(0, idx)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[_\s]+$/, '');     // strip trailing underscores/spaces
}

function syncBatches(buffer, line) {
  const rows = excel.parseBatches(buffer);
  const uniqueGroups = [...new Set(rows.map(r => r.group_name))];
  const run = db.transaction(() => {
    // ── COORDINATOR HISTORY: detect changes BEFORE we DELETE batches ─────
    // For each incoming group, diff old vs new coordinator sets:
    //   removed = old - new  → close their history rows (effective_to = NOW)
    //   added   = new - old  → open new history rows (effective_from = NOW)
    //   common              → leave as is
    // Multi-coordinator-aware (handles "خالد, سعيد" → "احمد, سعيد" cleanly).
    const oldCoords = db.prepare(
      `SELECT group_name, coordinators FROM batches WHERE line = ?`
    ).all(line);
    const oldByGroup = new Map(oldCoords.map(r => [r.group_name, r.coordinators]));

    const nowIso = new Date().toISOString();
    const closeStmt = db.prepare(
      `UPDATE coordinator_history
          SET effective_to = ?
        WHERE group_name = ? AND line = ? AND coordinator = ? AND effective_to IS NULL`
    );
    const openStmt = db.prepare(
      `INSERT INTO coordinator_history (group_name, line, coordinator, effective_from, effective_to)
       VALUES (?, ?, ?, ?, NULL)`
    );

    let closed = 0, opened = 0;
    for (const r of rows) {
      const oldField = oldByGroup.get(r.group_name);
      const oldMap   = parseCoordinatorList(oldField);
      const newMap   = parseCoordinatorList(r.coordinators);

      // removed
      for (const [key, original] of oldMap) {
        if (!newMap.has(key)) {
          closeStmt.run(nowIso, r.group_name, line, original);
          closed += 1;
        }
      }
      // added — use start_date (YYYY-MM-DD) as effective_from so historical
      // sessions uploaded BEFORE the first sync are correctly attributed to the
      // coordinator. If start_date is absent, fall back to nowIso.
      // NOTE: for mid-group coordinator CHANGES the "removed" branch above
      // closes the old record first, so the new record's effective_from never
      // back-dates past the old record's effective_to.
      for (const [key, original] of newMap) {
        if (!oldMap.has(key)) {
          const effectiveFrom = r.start_date || nowIso;
          openStmt.run(r.group_name, line, original, effectiveFrom);
          opened += 1;
        }
      }
    }

    // ── RENAME DETECTION via stable identifier ───────────────────────────
    // Group codes follow the pattern: `<stable>...<coordinator>` where
    // <stable> usually ends with `)`. When the coordinator suffix changes
    // (e.g., `...P(Asmaa)hanaa` → `...P(Asmaa) doha`), the system normally
    // sees this as a new group. Here we detect it: if an OLD group_name
    // and a NEW group_name share the same stable prefix but neither
    // exists in the other set, it's a rename. We record it in group_renames
    // so date-aware filters can attribute pre-rename events to the OLD name.
    try {
      const oldStable = new Map();
      const newStable = new Map();
      for (const [oldName] of oldByGroup) {
        const s = getStableIdentifier(oldName);
        if (s) {
          if (!oldStable.has(s)) oldStable.set(s, []);
          oldStable.get(s).push(oldName);
        }
      }
      for (const r of rows) {
        const s = getStableIdentifier(r.group_name);
        if (s) {
          if (!newStable.has(s)) newStable.set(s, []);
          newStable.get(s).push(r.group_name);
        }
      }
      const insertRename = db.prepare(`
        INSERT OR IGNORE INTO group_renames
          (old_group_name, new_group_name, line, renamed_on, detected_by)
        VALUES (?, ?, ?, DATE('now', '+2 hours'), 'auto-sync')
      `);
      // When a group is renamed (coordinator suffix changes in the code)
      // it's the SAME group. Carry its count-approval baseline over to the
      // new code so "استلام المجموعات" keeps tracking it instead of
      // treating the renamed code as a brand-new unapproved group.
      const findApproval = db.prepare(
        `SELECT 1 FROM group_count_approvals WHERE group_name = ? AND line = ?`
      );
      const moveApproval = db.prepare(
        `UPDATE group_count_approvals SET group_name = ? WHERE group_name = ? AND line = ?`
      );
      const dropApproval = db.prepare(
        `DELETE FROM group_count_approvals WHERE group_name = ? AND line = ?`
      );
      let renames = 0;
      for (const [stable, oldNames] of oldStable) {
        const newNames = newStable.get(stable) || [];
        // For each OLD name no longer present, find a NEW name with same
        // stable that's not in the old set → that's the rename target.
        for (const oldName of oldNames) {
          if (newNames.includes(oldName)) continue;
          const target = newNames.find(n => !oldNames.includes(n));
          if (target) {
            insertRename.run(oldName, target, line);
            renames += 1;
            // Migrate the count-approval baseline to the renamed code.
            try {
              if (findApproval.get(oldName, line)) {
                if (findApproval.get(target, line)) {
                  // New code already approved → just drop the stale old row.
                  dropApproval.run(oldName, line);
                } else {
                  moveApproval.run(target, oldName, line);
                }
              }
            } catch (_) { /* group_count_approvals absent on very old DB — skip */ }
          }
        }
      }
      if (renames > 0) {
        console.log(`[syncBatches] group_renames: detected ${renames} renames for line=${line}`);
      }
    } catch (e) {
      console.error('[syncBatches] rename detection error:', e.message);
    }
    if (closed > 0 || opened > 0) {
      console.log(`[syncBatches] coordinator_history: ${opened} opened, ${closed} closed for line=${line}`);
    }

    // ── existing batches replacement ────────────────────────────────────
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

  // ── REMARK ASSIGNMENT HISTORY: detect changes BEFORE DELETE ──────────
  // Each remark has a single assigned_to value. Diff: if old != new, close
  // the open history row for the old assignee and open one for the new.
  const oldAssign = db.prepare(
    `SELECT external_id, assigned_to FROM remarks WHERE line = ? AND external_id IS NOT NULL`
  ).all(line);
  const oldAssignByExt = new Map(oldAssign.map(r => [r.external_id, r.assigned_to]));

  const run = db.transaction(() => {
    // ── apply assignment-history diff ─────────────────────────────────
    const nowIso = new Date().toISOString();
    const closeAssignStmt = db.prepare(
      `UPDATE remark_assignment_history
          SET effective_to = ?
        WHERE remark_external_id = ? AND line = ? AND assigned_to = ? AND effective_to IS NULL`
    );
    const openAssignStmt = db.prepare(
      `INSERT INTO remark_assignment_history
         (remark_external_id, line, assigned_to, effective_from, effective_to)
       VALUES (?, ?, ?, ?, NULL)`
    );

    let aClosed = 0, aOpened = 0;
    for (const r of rows) {
      if (r.external_id == null || !Number.isFinite(r.external_id)) continue;
      const oldVal = (oldAssignByExt.get(r.external_id) || '').trim();
      const newVal = (r.assigned_to || '').trim();
      if (oldVal === newVal) continue;
      if (oldVal) {
        closeAssignStmt.run(nowIso, r.external_id, line, oldVal);
        aClosed += 1;
      }
      if (newVal) {
        openAssignStmt.run(r.external_id, line, newVal, nowIso);
        aOpened += 1;
      }
    }
    if (aClosed > 0 || aOpened > 0) {
      console.log(`[syncRemarks] remark_assignment_history: ${aOpened} opened, ${aClosed} closed for line=${line}`);
    }

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

// ─── RESCHEDULE DETECTION ────────────────────────────────────────────────────
// Lecture imports are DELETE-then-INSERT per (line + session_type). That wipes
// the previous state before the new file lands, so by default we lose any
// "this lecture moved from X to Y" signal. To preserve it, we:
//   1. Snapshot the existing lectures for this scope BEFORE the DELETE.
//   2. After INSERT, build matching sets keyed by a STABLE identifier
//      (group_name + trainer + session_type + line — the parts that survive
//      a coordinator's reschedule).
//   3. Anything in the snapshot but absent from the new state = cancelled.
//      Anything in the new state but absent from the snapshot = added.
//   4. Pair cancellations with the closest added entry sharing the same
//      stable identifier. Each pair becomes a `lecture_reschedules` row.
//   5. If the cancelled date falls inside an active official_holiday range,
//      auto-mark the row as reason='official_holiday' + status='auto'
//      (no admin approval needed — these are expected bulk shifts).
//
// All writes go through the transaction that wraps the import so a failure
// here rolls back atomically.

function _stableKey(r) {
  return [
    String(r.group_name || '').trim().toLowerCase(),
    String(r.trainer    || '').trim().toLowerCase(),
    String(r.session_type || '').trim().toLowerCase(),
    String(r.line       || '').trim().toLowerCase(),
  ].join('|');
}
function _slotKey(r) {
  // Identifies a specific slot (so an unchanged slot doesn't get flagged).
  return [
    r.date, r.time,
    String(r.group_name || '').trim().toLowerCase(),
    String(r.trainer    || '').trim().toLowerCase(),
    String(r.session_type || '').trim().toLowerCase(),
    String(r.line       || '').trim().toLowerCase(),
  ].join('|');
}
// Parse a time field that can be "HH:MM", "HH:MM:SS", or other forms into
// minutes-since-midnight. Returns null when unparseable.
function _timeToMins(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}
// Two slots are "essentially the same" when their date matches AND their
// time differs by less than this many minutes. Excel imports occasionally
// produce 1-minute jitter on the time column (e.g. "18:00:00" vs
// "18:01:00") — those are NOT reschedules.
const SAME_SLOT_TIME_TOLERANCE_MIN = 30;
function _isMinorTimeDrift(rowA, rowB) {
  if (!rowA || !rowB) return false;
  if (rowA.date !== rowB.date) return false;
  const ma = _timeToMins(rowA.time);
  const mb = _timeToMins(rowB.time);
  if (ma == null || mb == null) return false;
  return Math.abs(ma - mb) < SAME_SLOT_TIME_TOLERANCE_MIN;
}

// ⚠️ DEAD CODE — kept for reference only.
// This function is NOT called anywhere in production. Live detection was
// removed per business rule: reschedule audit data must come ONLY from
// Google Drive snapshot comparisons (see reschedules.routes.js →
// /backfill-from-drive). Do not re-enable without explicit approval.
// eslint-disable-next-line no-unused-vars
function detectAndRecordReschedules({ snapshot, after, sessionType, line }) {
  // Build slot maps to find truly-changed slots (skip rows that are identical
  // pre/post — those are just re-imports of unchanged data).
  const beforeSlots = new Map();
  for (const r of snapshot) beforeSlots.set(_slotKey(r), r);
  const afterSlots = new Set();
  for (const r of after)   afterSlots.add(_slotKey(r));

  // Cancellations = slots present before but not after.
  const cancelled = [];
  for (const [k, row] of beforeSlots) {
    if (!afterSlots.has(k)) cancelled.push(row);
  }
  if (cancelled.length === 0) return 0;   // nothing to do

  // Additions = slots present after but not before, grouped by stable key
  // so we can pop the closest match per cancellation.
  const additionsByStable = new Map();
  const beforeSlotKeys = new Set(beforeSlots.keys());
  for (const r of after) {
    if (beforeSlotKeys.has(_slotKey(r))) continue;
    const k = _stableKey(r);
    if (!additionsByStable.has(k)) additionsByStable.set(k, []);
    additionsByStable.get(k).push(r);
  }

  // Pre-load active holidays so we can mark holiday-shifted rows.
  let holidays = [];
  try {
    holidays = db.prepare(
      `SELECT id, start_date, end_date FROM official_holidays`
    ).all();
  } catch (_) { /* table might not exist on first deploy */ }

  function holidayFor(date) {
    for (const h of holidays) {
      if (date >= h.start_date && date <= h.end_date) return h;
    }
    return null;
  }

  // Match each cancelled row to the closest added row with the same stable
  // key. Sort cancellations by date so the earliest gets first pick when
  // multiple slots moved at once.
  cancelled.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const insertResched = db.prepare(`
    INSERT INTO lecture_reschedules
      (group_name, line, session_type,
       old_date, old_time, old_trainer, old_duration,
       new_date, new_time, new_trainer, new_duration,
       reschedule_reason, holiday_id, approval_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  for (const oldRow of cancelled) {
    const k = _stableKey(oldRow);
    const candidates = additionsByStable.get(k) || [];
    if (candidates.length === 0) continue;   // pure cancellation, not a reschedule
    // Pick the temporally-closest new slot (minimize |new_date - old_date|).
    candidates.sort((a, b) => {
      const da = Math.abs(_daysBetween(oldRow.date, a.date));
      const db_ = Math.abs(_daysBetween(oldRow.date, b.date));
      return da - db_;
    });
    const newRow = candidates.shift();   // consume — each addition matches once

    // Skip false positives: same date + tiny time drift (< 30 min). Excel
    // imports occasionally jitter the time column by a minute or two
    // ("18:00:00" → "18:01:00") and we don't want to flag those as
    // reschedules.
    if (_isMinorTimeDrift(oldRow, newRow)) continue;
    // Skip "backward" pairs (new_date is BEFORE old_date). These are not
    // disruptive reschedules — they're compensation lectures or cases
    // where the student took the lecture earlier than originally planned.
    // Business rule: only forward reschedules count.
    if (newRow.date < oldRow.date) continue;

    const hol = holidayFor(oldRow.date);
    const reason = hol ? 'official_holiday' : null;
    const status = hol ? 'auto' : 'pending';

    insertResched.run(
      oldRow.group_name, line, sessionType,
      oldRow.date, oldRow.time, oldRow.trainer, oldRow.duration,
      newRow.date, newRow.time, newRow.trainer, newRow.duration,
      reason, hol ? hol.id : null, status,
    );
    inserted++;
  }
  return inserted;
}

function _daysBetween(d1, d2) {
  const a = new Date(d1 + 'T00:00:00').getTime();
  const b = new Date(d2 + 'T00:00:00').getTime();
  if (!isFinite(a) || !isFinite(b)) return 999999;
  return Math.round((b - a) / 86400000);
}

function syncLectures(buffer, line) {
  const rows = excel.parseLectures(buffer);
  const uniqueGroups = [...new Set(rows.map(r => r.group_name))];
  const run = db.transaction(() => {
    // ── RESCHEDULE DETECTION INTENTIONALLY DISABLED ──────────────────────
    // Live detection compares the current DB state (which may have come from
    // a different source, manual upload, or older sync) to the incoming
    // Excel — producing reschedule rows whose "old" side does NOT correspond
    // to any specific Drive file. Per business decision, reschedule audit
    // data must come ONLY from Google Drive snapshots — see the
    // `/api/reschedules/backfill-from-drive` endpoint, which compares
    // Excel files dated D vs D+1 directly. Do NOT re-enable live detection
    // here without revisiting that policy.
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
    // ── RESCHEDULE DETECTION INTENTIONALLY DISABLED — see syncLectures ──
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

  // ── Phone-based name enrichment ────────────────────────────────────────────
  // When a row has a phone but no student name (e.g. Arabic name in a PDF that
  // OCR couldn't extract), look up the name from the clients table.
  // Tries phone as-is, then with a leading '0' (handles local vs. stored format).
  {
    const nameByPhone = db.prepare(
      `SELECT name FROM clients
       WHERE (phone = ? OR phone = '0' || ?) AND line = ?
       LIMIT 1`
    );
    rows.forEach(r => {
      if ((!r.student_name || !String(r.student_name).trim()) && r.phone) {
        const hit = nameByPhone.get(r.phone, r.phone, line);
        if (hit && hit.name) r.student_name = String(hit.name).trim();
      }
    });
  }

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

  // ── Phone-based name enrichment (same rule as syncAbsent) ─────────────────
  {
    const nameByPhone = db.prepare(
      `SELECT name FROM clients
       WHERE (phone = ? OR phone = '0' || ?) AND line = ?
       LIMIT 1`
    );
    rows.forEach(r => {
      if ((!r.student_name || !String(r.student_name).trim()) && r.phone) {
        const hit = nameByPhone.get(r.phone, r.phone, line);
        if (hit && hit.name) r.student_name = String(hit.name).trim();
      }
    });
  }

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
