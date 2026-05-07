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
    return res.json(db.prepare(sql).all());
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

// Build a normalized shift bundle (start/end/rests/employment_type/work_days/dates) from raw body.
// Shift fields are only meaningful when the shift itself is set.
// start_date is required when shift is set; end_date is optional (NULL = still active).
function buildShiftBundle(rawShift, rawStart, rawEnd, rawRests, rawEmpType, rawDays, rawStartDate, rawEndDate) {
  const shift = rawShift || null;
  if (!shift) {
    return { shift: null, start: null, end: null, rests: null, emp_type: null, days: null, start_date: null, end_date: null };
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
    emp_type,
    days,
    start_date: rawStartDate || null,
    end_date: rawEndDate || null,
  };
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

// ─── POST /api/team ───────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { name, department, section, status = 'active' } = req.body;
  const s1 = buildShiftBundle(req.body.shift,  req.body.shift_start,  req.body.shift_end,  req.body.shift_rests,  req.body.employment_type,        req.body.work_days,        req.body.shift_start_date,  req.body.shift_end_date);
  const s2 = buildShiftBundle(req.body.shift2, req.body.shift2_start, req.body.shift2_end, req.body.shift2_rests, req.body.shift2_employment_type, req.body.shift2_work_days, req.body.shift2_start_date, req.body.shift2_end_date);
  const job_title = req.body.job_title || null;
  const phone     = req.body.phone     || null;
  const user_id   = req.body.user_id   || null;
  const notes     = req.body.notes     || null;
  const validSections = ['all','general','private','semi','phone_call'];
  if (!name || !department || !section || !validSections.includes(section))
    return res.status(400).json({ error: 'name, department, section required' });
  const dateErr = validateShiftDates(s1, s2);
  if (dateErr) return res.status(400).json(dateErr);
  try {
    const r = db.prepare(
      `INSERT INTO team_members (
         name, department, section,
         shift, shift_start, shift_end, shift_rests, employment_type, work_days, shift_start_date, shift_end_date,
         shift2, shift2_start, shift2_end, shift2_rests, shift2_employment_type, shift2_work_days, shift2_start_date, shift2_end_date,
         job_title, phone, user_id, status, notes
       ) VALUES (?, ?, ?,  ?, ?, ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?, ?)`
    ).run(
      name, department, section,
      s1.shift, s1.start, s1.end, s1.rests, s1.emp_type, s1.days, s1.start_date, s1.end_date,
      s2.shift, s2.start, s2.end, s2.rests, s2.emp_type, s2.days, s2.start_date, s2.end_date,
      job_title, phone, user_id, status, notes
    );
    const member = db.prepare('SELECT * FROM team_members WHERE id = ?').get(r.lastInsertRowid);
    return res.status(201).json(member);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/team/:id ────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { name, department, section, status } = req.body;
  const s1 = buildShiftBundle(req.body.shift,  req.body.shift_start,  req.body.shift_end,  req.body.shift_rests,  req.body.employment_type,        req.body.work_days,        req.body.shift_start_date,  req.body.shift_end_date);
  const s2 = buildShiftBundle(req.body.shift2, req.body.shift2_start, req.body.shift2_end, req.body.shift2_rests, req.body.shift2_employment_type, req.body.shift2_work_days, req.body.shift2_start_date, req.body.shift2_end_date);
  const job_title = req.body.job_title || null;
  const phone     = req.body.phone     || null;
  const user_id   = req.body.user_id   || null;
  const notes     = req.body.notes     || null;
  if (!name || !department || !section) return res.status(400).json({ error: 'name, department, section required' });
  const dateErr = validateShiftDates(s1, s2);
  if (dateErr) return res.status(400).json(dateErr);
  try {
    db.prepare(
      `UPDATE team_members SET
         name=?, department=?, section=?,
         shift=?, shift_start=?, shift_end=?, shift_rests=?, employment_type=?, work_days=?, shift_start_date=?, shift_end_date=?,
         shift2=?, shift2_start=?, shift2_end=?, shift2_rests=?, shift2_employment_type=?, shift2_work_days=?, shift2_start_date=?, shift2_end_date=?,
         job_title=?, phone=?, user_id=?, status=?, notes=?
       WHERE id=?`
    ).run(
      name, department, section,
      s1.shift, s1.start, s1.end, s1.rests, s1.emp_type, s1.days, s1.start_date, s1.end_date,
      s2.shift, s2.start, s2.end, s2.rests, s2.emp_type, s2.days, s2.start_date, s2.end_date,
      job_title, phone, user_id, status || 'active', notes, id
    );
    const member = db.prepare('SELECT * FROM team_members WHERE id = ?').get(id);
    if (!member) return res.status(404).json({ error: 'Not found' });
    return res.json(member);
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

module.exports = router;
