'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate, requireRole('leader'));

// ─── GET /api/team ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { department, section, shift, status = 'active', search } = req.query;
  let where = [];
  if (department) where.push(`department = '${department}'`);
  if (section)    where.push(`section = '${section}'`);
  if (shift)      where.push(`shift = '${shift}'`);
  if (status && status !== 'all') where.push(`status = '${status}'`);
  if (search)     where.push(`name LIKE '%${search.replace(/'/g, "''")}%'`);
  const sql = `SELECT * FROM team_members${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY department, section, shift, name`;
  try {
    const rows = db.prepare(sql).all();
    return res.json(rows.map(withShiftsArray));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Sanitize and normalize the work_days field — only allow valid day codes,
// dedupe, preserve canonical order. Returns null for empty input.
const VALID_DAYS = ['saturday','sunday','monday','tuesday','wednesday','thursday'];
function normalizeWorkDays(raw) {
  if (!raw) return null;
  const list = String(raw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const valid = VALID_DAYS.filter(d => list.includes(d));
  return valid.length ? valid.join(',') : null;
}

// Coerce a raw rests value (array, JSON string, or null) into a normalized
// JSON string of [{start,end}, ...] — drops malformed entries silently.
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function normalizeRests(raw) {
  if (!raw) return null;
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return null; }
  }
  if (!Array.isArray(arr)) return null;
  const cleaned = arr
    .filter(x => x && typeof x === 'object')
    .map(x => ({
      start: typeof x.start === 'string' && HHMM_RE.test(x.start) ? x.start : null,
      end:   typeof x.end   === 'string' && HHMM_RE.test(x.end)   ? x.end   : null,
    }))
    .filter(x => x.start && x.end);
  return cleaned.length ? JSON.stringify(cleaned) : null;
}

// Build a normalized shift bundle (start/end/rests/voice_notes/employment_type/work_days/dates) from raw body.
// Shift fields are only meaningful when the shift itself is set.
// start_date is required when shift is set; end_date is optional (NULL = still active).
// voice_notes use the same [{start,end}, ...] shape as rests, normalized via normalizeRests.
function buildShiftBundle(rawShift, rawStart, rawEnd, rawRests, rawEmpType, rawDays, rawStartDate, rawEndDate, rawVoiceNotes) {
  const shift = rawShift || null;
  if (!shift) {
    return { shift: null, start: null, end: null, rests: null, voice_notes: null, emp_type: null, days: null, start_date: null, end_date: null };
  }
  const emp_type = rawEmpType || null;
  const days = emp_type === 'full_time'
    ? VALID_DAYS.join(',')
    : (emp_type === 'part_time' ? normalizeWorkDays(rawDays) : null);
  return {
    shift,
    start: rawStart || null,
    end: rawEnd || null,
    rests: normalizeRests(rawRests),
    voice_notes: normalizeRests(rawVoiceNotes),
    emp_type,
    days,
    start_date: rawStartDate || null,
    end_date: rawEndDate || null,
  };
}

// ─── Teachable courses ─────────────────────────────────────────────────────
//   Coerce the raw body fields into a clamped {starter, general, conversation}
//   object. Each value is an integer in [0, max] where max is the number of
//   levels in that course. Anything missing/invalid falls back to max (= all
//   levels) so the principle "every trainer can teach everything by default"
//   is enforced server-side too.
const COURSE_MAX = { starter: 3, general: 5, conversation: 5 };
function clampLevel(raw, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return max;       // missing / garbage → all
  if (n < 0) return 0;
  if (n > max) return max;
  return Math.floor(n);
}
function buildTeachable(body) {
  let starter      = clampLevel(body.teachable_starter,      COURSE_MAX.starter);
  let general      = clampLevel(body.teachable_general,      COURSE_MAX.general);
  let conversation = clampLevel(body.teachable_conversation, COURSE_MAX.conversation);
  // Cascade rule: if the trainer can teach ANY General level, they can teach
  // every Starter level. Enforced at save time so the DB is always consistent
  // even if the client forgot to bump Starter.
  if (general > 0 && starter < COURSE_MAX.starter) starter = COURSE_MAX.starter;
  return { starter, general, conversation };
}

// ── Employment dates (Customer Services only) ─────────────────────────────────
// Hire date (start_date) + last-day-of-work (end_date). Mirrors the users
// feature. Only applied to department='customer_services'; other departments
// keep whatever they already had (or NULL for new rows).
const _today = () => new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
const _clean = (v) => (v && String(v).trim() ? String(v).trim() : null);

function buildEmploymentDatesForCreate(department, status, body, isAdmin) {
  // Only Admin/Manager may set employment dates, and only for Customer Services.
  if (!isAdmin || department !== 'customer_services') return { start_date: null, end_date: null };
  const start = _clean(body.start_date) || _today();
  const typedEnd = _clean(body.end_date);
  // New member created inactive → stamp today as the end of work.
  const end = status === 'inactive' ? (typedEnd || _today()) : typedEnd;
  return { start_date: start, end_date: end };
}

function buildEmploymentDatesForUpdate(department, old, newStatus, body, isAdmin) {
  // Only Admin/Manager may change employment dates, and only for Customer
  // Services. Anyone else (or any other department) keeps the existing values.
  if (!isAdmin || department !== 'customer_services') {
    return { start_date: old.start_date || null, end_date: old.end_date || null };
  }
  const start = _clean(body.start_date) || old.start_date || _today();
  const typedEnd = _clean(body.end_date);
  const oldActive = old.status !== 'inactive';
  const newActive = newStatus !== 'inactive';
  let end;
  if (oldActive && !newActive) {
    // active → inactive: record the day work ended (typed value wins if given)
    end = typedEnd || _today();
  } else if (!oldActive && newActive) {
    // inactive → active: employee is back, clear the end date
    end = null;
  } else {
    // no status transition: honor whatever the admin typed (incl. future date)
    end = typedEnd;
  }
  return { start_date: start, end_date: end };
}

// Validate shift dates: when a shift is set, start_date is required.
// Returns { error: '...' } on failure or null when valid.
function validateShiftDates(s1, s2) {
  if (s1.shift && !s1.start_date) {
    return { error: 'تاريخ بداية الشيفت الأول مطلوب' };
  }
  if (s2.shift && !s2.start_date) {
    return { error: 'تاريخ بداية الشيفت الثاني مطلوب' };
  }
  if (s1.start_date && s1.end_date && s1.end_date < s1.start_date) {
    return { error: 'تاريخ نهاية الشيفت الأول يجب أن يكون بعد تاريخ البداية' };
  }
  if (s2.start_date && s2.end_date && s2.end_date < s2.start_date) {
    return { error: 'تاريخ نهاية الشيفت الثاني يجب أن يكون بعد تاريخ البداية' };
  }
  return null;
}

// Empty bundle used to fill the legacy shift1/shift2 columns when the trainer
// has fewer than 2 shifts in the new array.
const EMPTY_BUNDLE = {
  shift: null, start: null, end: null, rests: null, voice_notes: null,
  emp_type: null, days: null, start_date: null, end_date: null,
};

// Normalize an array of raw shift objects from the new `shifts:[]` body field
// into an array of buildShiftBundle outputs. Drops entries with no shift set.
function readShiftsArray(rawShifts) {
  if (!Array.isArray(rawShifts)) return null;  // signals "use legacy fields"
  return rawShifts
    .map(s => s && typeof s === 'object'
      ? buildShiftBundle(
          s.shift, s.start, s.end, s.rests,
          s.employment_type, s.work_days,
          s.start_date, s.end_date, s.voice_notes,
        )
      : null)
    .filter(b => b && b.shift);
}

// Validate every shift in the array. Same rules as validateShiftDates but
// applied per-index with a clear "الشيفت رقم N" error message.
function validateShiftsArray(arr) {
  for (let i = 0; i < arr.length; i++) {
    const s = arr[i];
    if (s.shift && !s.start_date) {
      return { error: `تاريخ بداية الشيفت رقم ${i + 1} مطلوب` };
    }
    if (s.start_date && s.end_date && s.end_date < s.start_date) {
      return { error: `تاريخ نهاية الشيفت رقم ${i + 1} يجب أن يكون بعد تاريخ البداية` };
    }
  }
  return null;
}

// Convert a buildShiftBundle output into the JSON-array shape stored in
// team_members.shifts_json (keyed for read clarity, not by SQL column).
function bundleToJsonShape(b) {
  return {
    shift: b.shift, start: b.start, end: b.end,
    rests: b.rests, voice_notes: b.voice_notes,
    employment_type: b.emp_type, work_days: b.days,
    start_date: b.start_date, end_date: b.end_date,
  };
}

// Single entry point: given req.body, return { shifts:[bundle], json:'...' }.
// Uses the new `shifts:[]` array when provided, otherwise falls back to the
// legacy `shift / shift2 / shift_*` body fields so old clients keep working.
function resolveShiftsFromBody(body) {
  const fromArray = readShiftsArray(body.shifts);
  const shifts = fromArray !== null
    ? fromArray
    : [
        buildShiftBundle(body.shift,  body.shift_start,  body.shift_end,  body.shift_rests,
                         body.employment_type, body.work_days,
                         body.shift_start_date, body.shift_end_date, body.voice_notes),
        buildShiftBundle(body.shift2, body.shift2_start, body.shift2_end, body.shift2_rests,
                         body.shift2_employment_type, body.shift2_work_days,
                         body.shift2_start_date, body.shift2_end_date, body.shift2_voice_notes),
      ].filter(b => b.shift);
  const json = JSON.stringify(shifts.map(bundleToJsonShape));
  return { shifts, json };
}

// Attach a parsed `shifts` array to a row before returning to the client.
// Falls back to building the array from the legacy columns for rows that
// haven't been backfilled yet.
function withShiftsArray(row) {
  if (!row) return row;
  let arr = [];
  if (row.shifts_json) {
    try { arr = JSON.parse(row.shifts_json); } catch { arr = []; }
  } else {
    if (row.shift) arr.push({
      shift: row.shift, start: row.shift_start, end: row.shift_end,
      rests: row.shift_rests, voice_notes: row.voice_notes,
      employment_type: row.employment_type, work_days: row.work_days,
      start_date: row.shift_start_date, end_date: row.shift_end_date,
    });
    if (row.shift2) arr.push({
      shift: row.shift2, start: row.shift2_start, end: row.shift2_end,
      rests: row.shift2_rests, voice_notes: row.shift2_voice_notes,
      employment_type: row.shift2_employment_type, work_days: row.shift2_work_days,
      start_date: row.shift2_start_date, end_date: row.shift2_end_date,
    });
  }
  return { ...row, shifts: arr };
}

// ─── POST /api/team ───────────────────────────────────────────────────────────
// 'All' = trainer is line-agnostic (visible in both Ahmed Hassan & Dardasha lists).
// Education-department trainers are line-agnostic by policy, so we force their
// line to 'All' regardless of what the client sent.
const VALID_LINES_TM = ['All', 'Ahmed Hassan', 'Dardasha'];

function resolveTeamLine(reqBody) {
  if (reqBody.department === 'education') return 'All';
  return VALID_LINES_TM.includes(reqBody.line) ? reqBody.line : 'Ahmed Hassan';
}

router.post('/', (req, res) => {
  const { name, department, section, status = 'active' } = req.body;
  const line = resolveTeamLine(req.body);
  const { shifts: allShifts, json: shiftsJson } = resolveShiftsFromBody(req.body);
  const s1 = allShifts[0] || EMPTY_BUNDLE;
  const s2 = allShifts[1] || EMPTY_BUNDLE;
  const job_title = req.body.job_title || null;
  const phone     = req.body.phone     || null;
  const user_id   = req.body.user_id   || null;
  const notes     = req.body.notes     || null;
  const teachable = buildTeachable(req.body);
  const validSections = ['all','general','private','semi','phone_call'];
  if (!name || !department || !section || !validSections.includes(section))
    return res.status(400).json({ error: 'name, department, section required' });
  const dateErr = validateShiftsArray(allShifts);
  if (dateErr) return res.status(400).json(dateErr);

  // Employment dates — Customer Services only. start_date defaults to today
  // (the creation date); end_date = last day of work (stamped today if the
  // member is created inactive). Non-CS members keep both NULL.
  const empDates = buildEmploymentDatesForCreate(department, status, req.body, req.user.role === 'admin');
  try {
    const r = db.prepare(
      `INSERT INTO team_members (
         name, department, section, line,
         shift, shift_start, shift_end, shift_rests, voice_notes, employment_type, work_days, shift_start_date, shift_end_date,
         shift2, shift2_start, shift2_end, shift2_rests, shift2_voice_notes, shift2_employment_type, shift2_work_days, shift2_start_date, shift2_end_date,
         shifts_json,
         job_title, phone, user_id, status, notes,
         teachable_starter, teachable_general, teachable_conversation,
         start_date, end_date
       ) VALUES (?, ?, ?, ?,  ?, ?, ?, ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?, ?, ?, ?,  ?,  ?, ?, ?, ?, ?,  ?, ?, ?,  ?, ?)`
    ).run(
      name, department, section, line,
      s1.shift, s1.start, s1.end, s1.rests, s1.voice_notes, s1.emp_type, s1.days, s1.start_date, s1.end_date,
      s2.shift, s2.start, s2.end, s2.rests, s2.voice_notes, s2.emp_type, s2.days, s2.start_date, s2.end_date,
      shiftsJson,
      job_title, phone, user_id, status, notes,
      teachable.starter, teachable.general, teachable.conversation,
      empDates.start_date, empDates.end_date
    );
    const member = db.prepare('SELECT * FROM team_members WHERE id = ?').get(r.lastInsertRowid);
    return res.status(201).json(withShiftsArray(member));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/team/:id ────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { name, department, section, status } = req.body;
  const line = resolveTeamLine(req.body);
  const { shifts: allShifts, json: shiftsJson } = resolveShiftsFromBody(req.body);
  const s1 = allShifts[0] || EMPTY_BUNDLE;
  const s2 = allShifts[1] || EMPTY_BUNDLE;
  const job_title = req.body.job_title || null;
  const phone     = req.body.phone     || null;
  const user_id   = req.body.user_id   || null;
  const notes     = req.body.notes     || null;
  const teachable = buildTeachable(req.body);
  if (!name || !department || !section) return res.status(400).json({ error: 'name, department, section required' });
  const dateErr = validateShiftsArray(allShifts);
  if (dateErr) return res.status(400).json(dateErr);

  // Snapshot old state for the employment end_date transition logic.
  const old = db.prepare('SELECT status, start_date, end_date FROM team_members WHERE id = ?').get(id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const newStatus = status || 'active';
  // Employment dates — Customer Services only; transition-aware so the editable
  // field and the "end = deactivation date" rule don't fight each other.
  const empDates = buildEmploymentDatesForUpdate(department, old, newStatus, req.body, req.user.role === 'admin');
  try {
    db.prepare(
      `UPDATE team_members SET
         name=?, department=?, section=?, line=?,
         shift=?, shift_start=?, shift_end=?, shift_rests=?, voice_notes=?, employment_type=?, work_days=?, shift_start_date=?, shift_end_date=?,
         shift2=?, shift2_start=?, shift2_end=?, shift2_rests=?, shift2_voice_notes=?, shift2_employment_type=?, shift2_work_days=?, shift2_start_date=?, shift2_end_date=?,
         shifts_json=?,
         job_title=?, phone=?, user_id=?, status=?, notes=?,
         teachable_starter=?, teachable_general=?, teachable_conversation=?,
         start_date=?, end_date=?
       WHERE id=?`
    ).run(
      name, department, section, line,
      s1.shift, s1.start, s1.end, s1.rests, s1.voice_notes, s1.emp_type, s1.days, s1.start_date, s1.end_date,
      s2.shift, s2.start, s2.end, s2.rests, s2.voice_notes, s2.emp_type, s2.days, s2.start_date, s2.end_date,
      shiftsJson,
      job_title, phone, user_id, newStatus, notes,
      teachable.starter, teachable.general, teachable.conversation,
      empDates.start_date, empDates.end_date,
      id
    );
    const member = db.prepare('SELECT * FROM team_members WHERE id = ?').get(id);
    if (!member) return res.status(404).json({ error: 'Not found' });
    return res.json(withShiftsArray(member));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/team/:id/line ─────────────────────────────────────────────────
// Tiny admin helper to update ONLY the `line` field on a team_members row.
// Useful when the full edit form is unavailable (browser cache, stale build)
// — admin can call it from DevTools/cURL: e.g.
//   fetch('/api/team/Alia7/line', { method:'PATCH', headers:{...},
//     body: JSON.stringify({ line: 'Dardasha' }) })
// `:id` accepts either the numeric id OR the exact team_members.name.
router.patch('/:id/line', (req, res) => {
  const idOrName = req.params.id;
  const line = req.body?.line;
  if (!VALID_LINES_TM.includes(line)) {
    return res.status(400).json({ error: `line must be one of ${VALID_LINES_TM.join(', ')}` });
  }
  try {
    let result;
    if (/^\d+$/.test(idOrName)) {
      result = db.prepare('UPDATE team_members SET line=? WHERE id=?').run(line, Number(idOrName));
    } else {
      result = db.prepare(
        `UPDATE team_members SET line=? WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`
      ).run(line, idOrName);
    }
    if (!result.changes) return res.status(404).json({ error: 'team member not found' });
    return res.json({ ok: true, changes: result.changes, line });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/team/:id ─────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM team_members WHERE id = ?').run(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── EXTRA SHIFTS (one-off after-shift-end hour blocks) ──────────────────────
// Use case: trainer's shift_end_date passed (e.g. 21/5) but they come back
// on specific days for limited hours (e.g. 24/5 → 4h, 25/5 → 1h). Each entry
// counts toward the trainer's daily capacity in utilization reports without
// having to start a new shift.
//
// Body for POST may include EITHER (start_time + end_time) OR a raw
// duration_min, OR both. When endpoints are present the server prefers the
// computed minutes so consumers can rely on a single `duration_min` column.

// HH:MM → minutes since midnight (or null on parse failure)
function timeStrToMins(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// GET /api/team/:id/extra-shifts — list all extra-shift entries (newest first)
router.get('/:id/extra-shifts', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid member id' });
  try {
    const rows = db.prepare(`
      SELECT es.*, u.full_name AS created_by_name
        FROM team_member_extra_shifts es
        LEFT JOIN users u ON u.id = es.created_by
       WHERE es.team_member_id = ?
       ORDER BY es.date DESC, es.start_time, es.id DESC
    `).all(id);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/team/:id/extra-shifts — add a new entry. Admin / leader only.
router.post('/:id/extra-shifts', express.json(), (req, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'leader') {
    return res.status(403).json({ error: 'صلاحية للأدمن أو القائد فقط' });
  }
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid member id' });
  const exists = db.prepare(`SELECT id FROM team_members WHERE id = ?`).get(id);
  if (!exists) return res.status(404).json({ error: 'team member not found' });

  const { date, start_time, end_time, duration_min, notes } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
  }

  // Resolve duration: prefer explicit (start_time + end_time) → fallback to
  // user-supplied duration_min → reject if neither is usable.
  let resolvedMin = null;
  const sMin = timeStrToMins(start_time);
  const eMin = timeStrToMins(end_time);
  if (sMin !== null && eMin !== null) {
    // Handle wrap past midnight (rare but harmless)
    let diff = eMin - sMin;
    if (diff < 0) diff += 24 * 60;
    if (diff > 0) resolvedMin = diff;
  }
  if (resolvedMin === null && Number(duration_min) > 0) {
    resolvedMin = Math.round(Number(duration_min));
  }
  if (!resolvedMin || resolvedMin <= 0) {
    return res.status(400).json({
      error: 'يجب تحديد وقت بداية ونهاية، أو عدد دقائق صالح'
    });
  }

  try {
    const result = db.prepare(`
      INSERT INTO team_member_extra_shifts
        (team_member_id, date, start_time, end_time, duration_min, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, date,
      start_time || null, end_time || null,
      resolvedMin,
      notes || null,
      req.user?.id || null,
    );
    const row = db.prepare(`SELECT * FROM team_member_extra_shifts WHERE id = ?`).get(result.lastInsertRowid);
    return res.status(201).json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/team/extra-shifts/:entryId — remove a single entry
router.delete('/extra-shifts/:entryId', (req, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'leader') {
    return res.status(403).json({ error: 'صلاحية للأدمن أو القائد فقط' });
  }
  const entryId = parseInt(req.params.entryId, 10);
  if (!entryId) return res.status(400).json({ error: 'invalid entry id' });
  try {
    const r = db.prepare(`DELETE FROM team_member_extra_shifts WHERE id = ?`).run(entryId);
    if (r.changes === 0) return res.status(404).json({ error: 'entry not found' });
    return res.json({ deleted: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
