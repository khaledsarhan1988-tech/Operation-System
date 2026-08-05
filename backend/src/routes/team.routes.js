'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requirePageOrManagement } = require('../middleware/roles');

const router = express.Router();
// فريق العمل + team API = admin whose management is Enrollment/All (مسؤول + مدير
// Enrollment) OR any user granted the 'team' page (إدارة فريق العمل — Owner
// 2026-07-21). Kept OPEN to Enrollment so «سجل عمل المدربين» (edits trainers via
// /team) keeps working. Other admins / leaders / agents without the grant = 403.
router.use(authenticate, requirePageOrManagement('team', 'Enrollment'));

// ─── GET /api/team ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { department, section, shift, status = 'active', search } = req.query;
  // Parameterized — never interpolate req.query into SQL (was a SQL-injection /
  // filter-bypass hole: section="all' OR '1'='1" returned all rows).
  const where = [];
  const params = [];
  if (department) { where.push('department = ?'); params.push(department); }
  if (section)    { where.push('section = ?');    params.push(section); }
  if (shift)      { where.push('shift = ?');       params.push(shift); }
  if (status && status !== 'all') { where.push('status = ?'); params.push(status); }
  if (search)     { where.push("name LIKE ? ESCAPE '\\'"); params.push('%' + String(search).replace(/[\\%_]/g, c => '\\' + c) + '%'); }
  const sql = `SELECT * FROM team_members${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY department, section, shift, name`;
  try {
    const rows = db.prepare(sql).all(...params);
    return res.json(rows.map(withShiftsArray));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/team/salary-categories ──────────────────────────────────────────
// Distinct shift-type names defined on the (owner-only) salaries page, used to
// populate the per-shift "فئة المرتب" picker in the member modal. Returns NAMES
// ONLY — no amounts — so the salaries page itself stays private. Safe for any
// leader/admin who edits team members.
router.get('/salary-categories', (req, res) => {
  try {
    let rows = [];
    try {
      rows = db.prepare(
        `SELECT DISTINCT TRIM(shift_type) AS name FROM trainer_salary_defs
          WHERE shift_type IS NOT NULL AND TRIM(shift_type) <> ''
          ORDER BY name`
      ).all();
    } catch {
      // trainer_salary_defs may not exist yet on a fresh DB — fall back to empty.
      rows = [];
    }
    return res.json(rows.map(r => r.name));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/team/cs-user-diff ───────────────────────────────────────────────
// Compares the Customer-Services فريق العمل roster against the users (login)
// accounts, keyed by users.username ↔ team_members.name — the coordinator name
// the system matches on. Surfaces three buckets:
//   • teamOnly   — team members whose name has no matching username
//   • usersOnly  — usernames with no matching team member (+ nearest suggestion)
//   • fieldDiffs — matched pairs whose dept/section, status, dates or line differ
// Read-only; leader+ (parent router guard).
router.get('/cs-user-diff', (req, res) => {
  const norm = s => String(s || '').trim().toLowerCase();
  const squash = s => norm(s).replace(/\s+/g, '');
  // Levenshtein distance (on space/case-normalized strings) for suggestions.
  function lev(a, b) {
    a = squash(a); b = squash(b);
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      prev = cur;
    }
    return prev[n];
  }
  function nearest(name, candidates) {
    let best = null, bestD = Infinity;
    for (const c of candidates) {
      const dd = lev(name, c);
      if (dd < bestD) { bestD = dd; best = c; }
    }
    if (best === null) return null;
    const maxLen = Math.max(squash(name).length, squash(best).length) || 1;
    if (bestD <= 3 || bestD <= maxLen * 0.4) return { name: best, distance: bestD };
    return null;
  }
  try {
    const users = db.prepare(
      `SELECT id, username, full_name, role, department, line, is_active, start_date, end_date
         FROM users WHERE role IN ('agent','leader')`
    ).all();
    const team = db.prepare(
      `SELECT id, name, section, status, line, start_date, end_date
         FROM team_members WHERE department='customer_services'`
    ).all();
    const userByName = new Map(users.map(u => [norm(u.username), u]));
    const teamByName = new Map(team.map(t => [norm(t.name), t]));
    const userNames = users.map(u => u.username);
    const teamNames = team.map(t => t.name);

    const teamOnly = team
      .filter(t => !userByName.has(norm(t.name)))
      .map(t => ({
        id: t.id, name: t.name, section: t.section, status: t.status, line: t.line,
        suggestion: nearest(t.name, userNames),
      }));
    const usersOnly = users
      .filter(u => !teamByName.has(norm(u.username)))
      .map(u => ({
        id: u.id, username: u.username, full_name: u.full_name, role: u.role,
        department: u.department, is_active: u.is_active,
        suggestion: nearest(u.username, teamNames),
      }));

    const d10 = v => (v ? String(v).slice(0, 10) : '');
    const fieldDiffs = [];
    for (const u of users) {
      const t = teamByName.get(norm(u.username));
      if (!t) continue;
      const diffs = {};
      const ud = norm(u.department), ts = norm(t.section);
      // department is General/Private/Semi/All; section is general/private/semi/all.
      // Compare only when both are concrete sections.
      if (ud !== 'all' && ['general', 'private', 'semi'].includes(ts) && ud !== ts) {
        diffs.dept = { user: u.department, team: t.section };
      }
      const ustat = u.is_active ? 'active' : 'inactive';
      if (ustat !== t.status) diffs.status = { user: ustat, team: t.status };
      if (d10(u.start_date) !== d10(t.start_date)) diffs.start_date = { user: d10(u.start_date), team: d10(t.start_date) };
      if (d10(u.end_date) !== d10(t.end_date)) diffs.end_date = { user: d10(u.end_date), team: d10(t.end_date) };
      if (norm(u.line) !== norm(t.line)) diffs.line = { user: u.line, team: t.line };
      if (Object.keys(diffs).length) {
        fieldDiffs.push({ name: t.name, username: u.username, full_name: u.full_name, diffs });
      }
    }
    return res.json({
      summary: {
        users: users.length, team: team.length,
        teamOnly: teamOnly.length, usersOnly: usersOnly.length, fieldDiffs: fieldDiffs.length,
      },
      teamOnly, usersOnly, fieldDiffs,
    });
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
    .map(x => {
      // Optional per-day scoping: which work-days this break/voice block applies
      // to. Empty = applies to ALL the shift's days (backward-compatible).
      const days = Array.isArray(x.days)
        ? x.days.map(d => String(d).trim().toLowerCase()).filter(d => VALID_DAYS.includes(d))
        : [];
      return {
        start: typeof x.start === 'string' && HHMM_RE.test(x.start) ? x.start : null,
        end:   typeof x.end   === 'string' && HHMM_RE.test(x.end)   ? x.end   : null,
        days,
      };
    })
    .filter(x => x.start && x.end)
    .map(x => (x.days.length ? { start: x.start, end: x.end, days: x.days } : { start: x.start, end: x.end }));
  return cleaned.length ? JSON.stringify(cleaned) : null;
}

// Build a normalized shift bundle (start/end/rests/voice_notes/employment_type/work_days/dates) from raw body.
// Shift fields are only meaningful when the shift itself is set.
// start_date is required when shift is set; end_date is optional (NULL = still active).
// voice_notes use the same [{start,end}, ...] shape as rests, normalized via normalizeRests.
// phone_call is split into 3 course-type sub-sections (عام/شبه خاص/خاص).
// Plain 'phone_call' kept for LEGACY members not yet re-classified — no data loss.
const VALID_SECTIONS = ['general', 'private', 'semi', 'phone_call', 'phone_call_general', 'phone_call_semi', 'phone_call_private', 'all'];
function buildShiftBundle(rawShift, rawStart, rawEnd, rawRests, rawEmpType, rawDays, rawStartDate, rawEndDate, rawVoiceNotes, rawSection, rawSalaryCategory) {
  const shift = rawShift || null;
  // Salary category: a free-text label linking the shift to a salary scheme
  // (e.g. "Full Time 7 to 12"). Display-only — does NOT affect work-days or
  // utilization logic. Lives inside shifts_json, no dedicated column.
  const salary_category = rawSalaryCategory ? String(rawSalaryCategory).trim().slice(0, 80) || null : null;
  if (!shift) {
    return { shift: null, start: null, end: null, rests: null, voice_notes: null, emp_type: null, days: null, start_date: null, end_date: null, section: null, salary_category: null };
  }
  const emp_type = rawEmpType || null;
  const days = emp_type === 'full_time'
    ? VALID_DAYS.join(',')
    : (emp_type === 'part_time' ? normalizeWorkDays(rawDays) : null);
  // Per-shift section: a trainer who changed section mid-period sets the right
  // section on each shift. 'all'/empty → null = use the trainer's main section.
  const secLc = rawSection ? String(rawSection).trim().toLowerCase() : null;
  const section = (secLc && secLc !== 'all' && VALID_SECTIONS.includes(secLc)) ? secLc : null;
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
    section,
    salary_category,
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
          s.start_date, s.end_date, s.voice_notes, s.section, s.salary_category,
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
    section: b.section || null,
    salary_category: b.salary_category || null,
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
      salary_category: null,
    });
    if (row.shift2) arr.push({
      shift: row.shift2, start: row.shift2_start, end: row.shift2_end,
      rests: row.shift2_rests, voice_notes: row.shift2_voice_notes,
      employment_type: row.shift2_employment_type, work_days: row.shift2_work_days,
      start_date: row.shift2_start_date, end_date: row.shift2_end_date,
      salary_category: null,
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
  const validSections = ['all','general','private','semi','phone_call','phone_call_general','phone_call_semi','phone_call_private'];
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
    // Open the initial dept/section history record (mirrors users dept-history).
    try {
      const nowIso = new Date().toISOString();
      db.prepare(
        `INSERT INTO team_member_dept_history (team_member_id, member_name, department, section, effective_from, effective_to)
         VALUES (?, ?, ?, ?, ?, NULL)`
      ).run(member.id, String(member.name).trim(), member.department, member.section, nowIso);
    } catch (e) {
      console.error('team_member_dept_history create-track error:', e.message);
    }
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

  // Snapshot old state for the employment end_date transition logic AND for
  // detecting dept/section moves (history tracking below).
  const old = db.prepare('SELECT name, status, start_date, end_date, department, section FROM team_members WHERE id = ?').get(id);
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
    // coordinator_type was never wired into the write path — make it editable.
    // Only write when an explicit valid value is sent, so updates that omit it
    // don't clear the existing value.
    {
      const ct = req.body.coordinator_type;
      if (['standard', 'multi_task', 'on_leave'].includes(ct)) {
        try { db.prepare('UPDATE team_members SET coordinator_type=? WHERE id=?').run(ct, id); } catch (_) {}
      }
    }
    // On a NAME change, keep team_member_dept_history.member_name in sync so the
    // date-aware section filter (which joins on member_name) keeps matching.
    if (name && old && String(name).trim() !== String(old.name || '').trim()) {
      try { db.prepare('UPDATE team_member_dept_history SET member_name=? WHERE team_member_id=?').run(String(name).trim(), id); } catch (_) {}
    }
    // ── Track dept/section moves in team_member_dept_history ────────────────
    // When either the management (department) or the sub-dept (section) changes
    // we close the current open record and open a new one — same pattern the
    // users dept-history uses, so the absence reports can attribute events to
    // the section the coordinator held AT THE TIME of each absence.
    if ((department && department !== old.department) || (section && section !== old.section)) {
      try {
        const nowIso = new Date().toISOString();
        db.prepare(
          `UPDATE team_member_dept_history SET effective_to = ?
            WHERE team_member_id = ? AND effective_to IS NULL`
        ).run(nowIso, id);
        db.prepare(
          `INSERT INTO team_member_dept_history (team_member_id, member_name, department, section, effective_from, effective_to)
           VALUES (?, ?, ?, ?, ?, NULL)`
        ).run(id, String(name).trim(), department, section, nowIso);
      } catch (e) {
        console.error('team_member_dept_history change-track error:', e.message);
      }
    }
    return res.json(withShiftsArray(member));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── DEPT/SECTION HISTORY: CRUD for team_member_dept_history ──────────────────
// Mirrors the users dept-history endpoints. READS allowed for leader+ (parent
// router guard); WRITES are Admin/Manager only. Records track BOTH department
// and section over time and feed the absence reports (team history takes
// precedence over user_department_history).
const requireAdminWrite = (req, res) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'صلاحية للأدمن / المدير فقط' });
    return false;
  }
  return true;
};

// GET /api/team/:id/dept-history — list all records, newest first
router.get('/:id/dept-history', (req, res) => {
  const { id } = req.params;
  const member = db.prepare('SELECT id, name FROM team_members WHERE id = ?').get(id);
  if (!member) return res.status(404).json({ error: 'team member not found' });
  try {
    const rows = db.prepare(
      `SELECT id, team_member_id, member_name, department, section, effective_from, effective_to, detected_at
         FROM team_member_dept_history
        WHERE team_member_id = ?
        ORDER BY DATE(effective_from) DESC, id DESC`
    ).all(id);
    return res.json({ member: { id: member.id, name: member.name }, history: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/team/:id/dept-history — add a new record (Admin only)
router.post('/:id/dept-history', (req, res) => {
  if (!requireAdminWrite(req, res)) return;
  const { id } = req.params;
  const { department, section, effective_from, effective_to } = req.body;
  const member = db.prepare('SELECT id, name FROM team_members WHERE id = ?').get(id);
  if (!member) return res.status(404).json({ error: 'team member not found' });
  if (!department || !section || !effective_from) {
    return res.status(400).json({ error: 'department و section و effective_from مطلوبين' });
  }
  if (effective_to && effective_to <= effective_from) {
    return res.status(400).json({ error: 'effective_to يجب أن يكون بعد effective_from' });
  }
  try {
    const r = db.prepare(
      `INSERT INTO team_member_dept_history (team_member_id, member_name, department, section, effective_from, effective_to)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, member.name, department, section, effective_from, effective_to || null);
    const created = db.prepare(`SELECT * FROM team_member_dept_history WHERE id = ?`).get(r.lastInsertRowid);
    return res.status(201).json(created);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/team/dept-history/:rid — edit a record (Admin only)
router.put('/dept-history/:rid', (req, res) => {
  if (!requireAdminWrite(req, res)) return;
  const { rid } = req.params;
  const { department, section, effective_from, effective_to } = req.body;
  const row = db.prepare(`SELECT * FROM team_member_dept_history WHERE id = ?`).get(rid);
  if (!row) return res.status(404).json({ error: 'History record not found' });
  const newFrom = effective_from || row.effective_from;
  const newTo   = effective_to === undefined ? row.effective_to : (effective_to || null);
  if (newTo && newTo <= newFrom) {
    return res.status(400).json({ error: 'effective_to يجب أن يكون بعد effective_from' });
  }
  const newDept = department || row.department;
  const newSection = section || row.section;
  try {
    db.prepare(
      `UPDATE team_member_dept_history
          SET department = ?, section = ?, effective_from = ?, effective_to = ?
        WHERE id = ?`
    ).run(newDept, newSection, newFrom, newTo, rid);
    const updated = db.prepare(`SELECT * FROM team_member_dept_history WHERE id = ?`).get(rid);
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/team/dept-history/:rid — remove a record (Admin only)
router.delete('/dept-history/:rid', (req, res) => {
  if (!requireAdminWrite(req, res)) return;
  const { rid } = req.params;
  const row = db.prepare(`SELECT id FROM team_member_dept_history WHERE id = ?`).get(rid);
  if (!row) return res.status(404).json({ error: 'History record not found' });
  try {
    db.prepare(`DELETE FROM team_member_dept_history WHERE id = ?`).run(rid);
    return res.json({ ok: true });
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

// POST /api/team/:id/extra-shifts/bulk-delete — remove several entries at once.
// Body: { entry_ids: [1,2,...] }. Scoped to the member (ids not belonging to
// this member are ignored, not deleted). Transaction → all-or-nothing.
router.post('/:id/extra-shifts/bulk-delete', express.json(), (req, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'leader') {
    return res.status(403).json({ error: 'صلاحية للأدمن أو القائد فقط' });
  }
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid member id' });
  const ids = (Array.isArray(req.body?.entry_ids) ? req.body.entry_ids : [])
    .map(x => parseInt(x, 10)).filter(n => Number.isInteger(n) && n > 0);
  if (!ids.length) return res.status(400).json({ error: 'entry_ids (non-empty array) is required' });
  try {
    const stmt = db.prepare(`DELETE FROM team_member_extra_shifts WHERE id = ? AND team_member_id = ?`);
    let deleted = 0;
    db.transaction(() => { for (const eid of ids) deleted += stmt.run(eid, id).changes; })();
    return res.json({ deleted, requested: ids.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── EXTRA SHIFTS — BULK GENERATE FROM THE LECTURE SCHEDULE ──────────────────
// Owner pain point: a trainer who covered 20+ lectures by the hour had to be
// entered day-by-day above. These two endpoints read the trainer's own lectures
// in a date window and turn each one into a ready extra-shift block (date +
// start_time + end_time), so the owner only reviews & confirms. Purely additive:
// the rows created are IDENTICAL to manual ones — same table, same semantics
// (they raise the trainer's "available" capacity for that day in utilization).

// "09:00 PM" / "10:00 AM" → minutes since midnight (lectures store 12h+AM/PM).
// Falls back to a 24h read when no meridiem is present.
function lecTime12ToMins(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const mer = m[3] ? m[3].toUpperCase() : null;
  if (mer === 'PM' && h < 12) h += 12;
  if (mer === 'AM' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// "01:00" → 60, "00:28" → 28; also tolerates a plain minutes number.
function lecDurToMins(d) {
  if (d === null || d === undefined) return null;
  const s = String(d).trim();
  const m = s.match(/^(\d{1,3}):(\d{2})$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// minutes since midnight → 24h "HH:MM"
function minsTo24h(mins) {
  const t = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60), m = t % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

const stripParens = s => String(s || '').replace(/\([^)]*\)/g, '').trim();
const normTrainer = s => stripParens(s).toLowerCase().replace(/\s+/g, '');
const MAX_REASONABLE_MIN = 6 * 60;  // > 6h on a single block = data anomaly → flag

// A group's TEACHING section — same constitution rule as trGroupSection in
// reports.routes.js (org-chart): batches.dept_type is reliable for the main line
// but NOT for Dardasha (names carry _P_D/_SP_D yet dept_type says General), so
// Dardasha uses the name suffix; other lines use dept_type, falling back to the
// suffix when the batch row is missing.
// Suffixes: _SP = semi · _P/_KP = private · _Pm = private-morning (owner fact
// 2026-06-28) — EXCEPT when preceded by a pure time token («Sat_10_Pm_» = 10 PM).
const _SEC_MAP = { private: 'private', general: 'general', semi: 'semi' };
function groupSectionOf(name, line, deptType) {
  const s = String(name || '').replace(/\s+/g, '').toLowerCase();
  const bySuffix = () => {
    if (/_sp/.test(s)) return 'semi';
    if (/_kp|_p(?![a-z])/.test(s)) return 'private';
    if (/(?<!_\d{1,2}(:\d{2})?)_pm(?![a-z])/.test(s)) return 'private';   // General4_Pm ✓ · Sat_10_Pm ✗ (time)
    return 'general';
  };
  if (String(line) === 'Dardasha') return bySuffix();
  return _SEC_MAP[String(deptType || '').toLowerCase()] || bySuffix();
}

// Build the candidate blocks for a member over [from,to] (shared by GET+POST).
// session_type='main', status IN ('مؤكدة','مجدولة'), matched by trainer name +
// line. Twins (same date+start+end) collapse to one. Each block is flagged
// `already_exists` (same date/start/end already saved) and `anomaly` (unparseable
// time / duration ≤0 / duration > 6h).
function buildLectureBlocks(member, from, to, win) {
  // team_members.line is often 'All' (line-neutral) while lectures.line is a
  // concrete line ('Ahmed Hassan' / 'Dardasha'). Only constrain by line when the
  // member is pinned to a specific one — otherwise match across lines by name.
  const pinnedLine = member.line && member.line !== 'All' ? member.line : null;
  const rows = db.prepare(`
    SELECT date, time, duration, trainer, group_name, status, line
      FROM lectures
     WHERE session_type = 'main'
       AND status IN ('مؤكدة','مجدولة')
       AND date BETWEEN ? AND ?
       ${pinnedLine ? 'AND line = ?' : ''}
  `).all(...(pinnedLine ? [from, to, pinnedLine] : [from, to]));

  const target = normTrainer(member.name);
  const existing = new Set(
    db.prepare(`SELECT date, start_time, end_time FROM team_member_extra_shifts WHERE team_member_id = ?`)
      .all(member.id)
      .map(r => `${r.date}|${r.start_time || ''}|${r.end_time || ''}`)
  );

  // dept_type per group (batches) → each block gets its group's TEACHING section
  // (عام/شبه خاص/خاص) so the owner can filter, e.g. pay only the general-section
  // lectures after that section's shift ended.
  const normGroup = s => String(s || '').replace(/\s+/g, '').toLowerCase();
  const batchDept = new Map();
  for (const b of db.prepare(`SELECT group_name, line, MAX(dept_type) dt FROM batches GROUP BY group_name, line`).all())
    batchDept.set(normGroup(b.group_name) + '|' + b.line, b.dt);

  const byKey = new Map();   // date|start|end → block (dedup twins)
  for (const r of rows) {
    if (normTrainer(r.trainer) !== target) continue;
    const startMin = lecTime12ToMins(r.time);
    const durMin   = lecDurToMins(r.duration);
    // Optional time window: keep only lectures whose START time is within
    // [win.fromMin, win.toMin]. Unparseable times can't be placed → skipped.
    if (win && (startMin === null || startMin < win.fromMin || startMin > win.toMin)) continue;
    let anomaly = false, start_time = null, end_time = null, duration_min = null;
    if (startMin === null || durMin === null || durMin <= 0 || durMin > MAX_REASONABLE_MIN) {
      anomaly = true;
      duration_min = durMin && durMin > 0 ? durMin : null;
      if (startMin !== null) start_time = minsTo24h(startMin);
      if (startMin !== null && durMin && durMin > 0) end_time = minsTo24h(startMin + durMin);
    } else {
      start_time = minsTo24h(startMin);
      end_time   = minsTo24h(startMin + durMin);
      duration_min = durMin;
    }
    const key = `${r.date}|${start_time || ''}|${end_time || ''}`;
    if (byKey.has(key)) continue;   // collapse rename/import twins
    byKey.set(key, {
      date: r.date, start_time, end_time, duration_min,
      group_name: r.group_name, status: r.status, line: r.line,
      section: groupSectionOf(r.group_name, r.line, batchDept.get(normGroup(r.group_name) + '|' + r.line)),
      already_exists: existing.has(key),
      anomaly,
    });
  }
  return [...byKey.values()].sort((a, b) =>
    a.date === b.date ? String(a.start_time).localeCompare(String(b.start_time)) : a.date.localeCompare(b.date));
}

// GET /api/team/:id/extra-shifts/from-lectures?from=&to=&from_time=&to_time= — PREVIEW only (no write)
// Optional from_time/to_time (24h HH:MM): restrict to lectures whose START time is
// inside the window. Both or neither — one alone is an error.
router.get('/:id/extra-shifts/from-lectures', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid member id' });
  const { from, to, from_time, to_time } = req.query;
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(String(from)) ||
      !to   || !/^\d{4}-\d{2}-\d{2}$/.test(String(to))) {
    return res.status(400).json({ error: 'from & to are required (YYYY-MM-DD)' });
  }
  if (String(from) > String(to)) return res.status(400).json({ error: 'from must be ≤ to' });

  // Optional time window
  let win = null;
  if (from_time || to_time) {
    if (!from_time || !to_time) {
      return res.status(400).json({ error: 'حدد وقت البداية والنهاية معًا، أو سيبهم فاضيين' });
    }
    const ft = timeStrToMins(from_time), tt = timeStrToMins(to_time);
    if (ft === null || tt === null) return res.status(400).json({ error: 'صيغة وقت غير صحيحة (HH:MM)' });
    if (ft > tt) return res.status(400).json({ error: 'وقت البداية يجب أن يكون قبل وقت النهاية' });
    win = { fromMin: ft, toMin: tt };
  }

  const member = db.prepare(`SELECT id, name, line FROM team_members WHERE id = ?`).get(id);
  if (!member) return res.status(404).json({ error: 'team member not found' });
  try {
    const blocks = buildLectureBlocks(member, String(from), String(to), win);
    return res.json({
      member: { id: member.id, name: member.name, line: member.line },
      from, to,
      from_time: from_time || null, to_time: to_time || null,
      count: blocks.length,
      addable: blocks.filter(b => !b.already_exists && !b.anomaly).length,
      blocks,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/team/:id/extra-shifts/from-lectures — bulk-insert the selected blocks.
// Admin / leader only. Body: { entries: [{date, start_time, end_time, duration_min, notes?}] }
// Idempotent: skips any (date,start,end) already saved for this member.
router.post('/:id/extra-shifts/from-lectures', express.json(), (req, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'leader') {
    return res.status(403).json({ error: 'صلاحية للأدمن أو القائد فقط' });
  }
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid member id' });
  const member = db.prepare(`SELECT id FROM team_members WHERE id = ?`).get(id);
  if (!member) return res.status(404).json({ error: 'team member not found' });

  const entries = Array.isArray(req.body?.entries) ? req.body.entries : null;
  if (!entries || entries.length === 0) {
    return res.status(400).json({ error: 'entries (non-empty array) is required' });
  }

  const existing = new Set(
    db.prepare(`SELECT date, start_time, end_time FROM team_member_extra_shifts WHERE team_member_id = ?`)
      .all(id)
      .map(r => `${r.date}|${r.start_time || ''}|${r.end_time || ''}`)
  );

  const ins = db.prepare(`
    INSERT INTO team_member_extra_shifts
      (team_member_id, date, start_time, end_time, duration_min, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const createdBy = req.user?.id || null;
  let inserted = 0, skipped = 0;
  const errors = [];

  const run = db.transaction(() => {
    for (const e of entries) {
      const date = String(e?.date || '');
      const start_time = e?.start_time ? String(e.start_time) : null;
      const end_time   = e?.end_time ? String(e.end_time) : null;
      const durMin     = Math.round(Number(e?.duration_min));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(durMin > 0)) {
        skipped++; errors.push({ date, reason: 'تاريخ أو مدة غير صالحة' }); continue;
      }
      const key = `${date}|${start_time || ''}|${end_time || ''}`;
      if (existing.has(key)) { skipped++; continue; }   // already saved → idempotent
      ins.run(id, date, start_time, end_time, durMin, e?.notes ? String(e.notes) : 'من الجدول', createdBy);
      existing.add(key);
      inserted++;
    }
  });

  try {
    run();
    return res.status(201).json({ inserted, skipped, errors });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── OUT-OF-DUTY PAID HOURS ("خارج مهام عمله") ────────────────────────────────
// PAID extra hours outside a trainer's normal duties. Stored in a SEPARATE table
// from extra-shifts and NEVER counted in utilization. Surfaced only in the
// payroll page where each entry is paid at the trainer's hourly rate.

// GET /api/team/outofduty-hours?from&to — RAW entries in the period (for the
// payroll column). Returns [{ team_member_id, date, duration_min }] so the
// frontend can bucket each entry into the shift whose date range contains it
// (per-shift out-of-duty). Literal single-segment path, declared before
// /:id/... so it can never be captured as an :id.
router.get('/outofduty-hours', (req, res) => {
  const { from, to } = req.query;
  try {
    const where = [];
    const params = [];
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(String(from))) { where.push('date >= ?'); params.push(from); }
    if (to   && /^\d{4}-\d{2}-\d{2}$/.test(String(to)))   { where.push('date <= ?'); params.push(to); }
    const rows = db.prepare(`
      SELECT team_member_id, date, duration_min
        FROM team_member_outofduty_hours
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    `).all(...params);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/team/:id/outofduty-hours — list one trainer's entries (newest first)
router.get('/:id/outofduty-hours', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid member id' });
  try {
    const rows = db.prepare(`
      SELECT oo.*, u.full_name AS created_by_name
        FROM team_member_outofduty_hours oo
        LEFT JOIN users u ON u.id = oo.created_by
       WHERE oo.team_member_id = ?
       ORDER BY oo.date DESC, oo.start_time, oo.id DESC
    `).all(id);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/team/:id/outofduty-hours — add an entry. Admin / leader only.
router.post('/:id/outofduty-hours', express.json(), (req, res) => {
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

  // Resolve duration: prefer (start_time + end_time) → fallback to duration_min.
  let resolvedMin = null;
  const sMin = timeStrToMins(start_time);
  const eMin = timeStrToMins(end_time);
  if (sMin !== null && eMin !== null) {
    let diff = eMin - sMin;
    if (diff < 0) diff += 24 * 60;
    if (diff > 0) resolvedMin = diff;
  }
  if (resolvedMin === null && Number(duration_min) > 0) {
    resolvedMin = Math.round(Number(duration_min));
  }
  if (!resolvedMin || resolvedMin <= 0) {
    return res.status(400).json({ error: 'يجب تحديد وقت بداية ونهاية، أو عدد دقائق صالح' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO team_member_outofduty_hours
        (team_member_id, date, start_time, end_time, duration_min, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, date,
      start_time || null, end_time || null,
      resolvedMin,
      notes || null,
      req.user?.id || null,
    );
    const row = db.prepare(`SELECT * FROM team_member_outofduty_hours WHERE id = ?`).get(result.lastInsertRowid);
    return res.status(201).json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/team/outofduty-hours/:entryId — remove a single entry
router.delete('/outofduty-hours/:entryId', (req, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'leader') {
    return res.status(403).json({ error: 'صلاحية للأدمن أو القائد فقط' });
  }
  const entryId = parseInt(req.params.entryId, 10);
  if (!entryId) return res.status(400).json({ error: 'invalid entry id' });
  try {
    const r = db.prepare(`DELETE FROM team_member_outofduty_hours WHERE id = ?`).run(entryId);
    if (r.changes === 0) return res.status(404).json({ error: 'entry not found' });
    return res.json({ deleted: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── COORDINATOR LEAVE PERIODS ("فترات الانقطاع") ─────────────────────────────
// Date ranges when a CS coordinator was AWAY (left to another dept then returned).
// During a leave period the attendance/quality reports move any absence still
// attributed to them (a group that kept their name) OFF them — to the group's new
// coordinator if the batch handed it over, else to the placeholder «بدون منسق».

// GET /api/team/:id/leave-periods — list a member's leave periods (newest first)
router.get('/:id/leave-periods', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid member id' });
  try {
    const rows = db.prepare(`
      SELECT lp.*, u.full_name AS created_by_name
        FROM coordinator_leave_periods lp
        LEFT JOIN users u ON u.id = lp.created_by
       WHERE lp.team_member_id = ?
       ORDER BY lp.from_date DESC, lp.id DESC
    `).all(id);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/team/:id/leave-periods — add a leave period. Admin / leader only.
router.post('/:id/leave-periods', express.json(), (req, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'leader') {
    return res.status(403).json({ error: 'صلاحية للأدمن أو القائد فقط' });
  }
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid member id' });
  const member = db.prepare(`SELECT id, name FROM team_members WHERE id = ?`).get(id);
  if (!member) return res.status(404).json({ error: 'team member not found' });

  const { from_date, to_date, reason } = req.body || {};
  const dRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!from_date || !dRe.test(String(from_date)) || !to_date || !dRe.test(String(to_date))) {
    return res.status(400).json({ error: 'from_date & to_date required (YYYY-MM-DD)' });
  }
  if (String(from_date) > String(to_date)) {
    return res.status(400).json({ error: 'from_date must be ≤ to_date' });
  }
  try {
    const result = db.prepare(`
      INSERT INTO coordinator_leave_periods (team_member_id, coordinator, from_date, to_date, reason, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, member.name, from_date, to_date, reason ? String(reason) : null, req.user?.id || null);
    const row = db.prepare(`SELECT * FROM coordinator_leave_periods WHERE id = ?`).get(result.lastInsertRowid);
    return res.status(201).json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/team/leave-periods/:entryId — remove a leave period
router.delete('/leave-periods/:entryId', (req, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'leader') {
    return res.status(403).json({ error: 'صلاحية للأدمن أو القائد فقط' });
  }
  const entryId = parseInt(req.params.entryId, 10);
  if (!entryId) return res.status(400).json({ error: 'invalid entry id' });
  try {
    const r = db.prepare(`DELETE FROM coordinator_leave_periods WHERE id = ?`).run(entryId);
    if (r.changes === 0) return res.status(404).json({ error: 'entry not found' });
    return res.json({ deleted: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
