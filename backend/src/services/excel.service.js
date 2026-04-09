'use strict';
const XLSX = require('xlsx');

// ─── SCHEDULE HELPERS ─────────────────────────────────────────────────────────
const MAIN_TO_SIDE = {
  'Sat,Tue': 'Mon,Thu',
  'Tue,Sat': 'Mon,Thu',
  'Sun,Wed': 'Sat,Tue',
  'Wed,Sun': 'Sat,Tue',
  'Mon,Thu': 'Sun,Wed',
  'Thu,Mon': 'Sun,Wed',
};

const WEEKDAY_MAP = {
  Sat: 'Sat', Sat_: 'Sat', Saturday: 'Sat',
  Sun: 'Sun', Sunday: 'Sun',
  Mon: 'Mon', Monday: 'Mon',
  Tue: 'Tue', Tuesday: 'Tue',
  Wed: 'Wed', Wednesday: 'Wed',
  Thu: 'Thu', Thursday: 'Thu',
};

const MONTH_MAP = {
  Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6,
  Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12,
};

/**
 * Parse group name code to extract metadata
 * e.g. "Mar_30_Mon_9pm_Con_4_SP(Israa Hafiz)Amira"
 */
function parseGroupCode(groupName, trainerHint = '') {
  if (!groupName || typeof groupName !== 'string') return {};
  try {
    const result = { dept_type: null, level_code: null, main_days: null, side_days: null, lecture_duration_min: null };

    // Detect department type from group name segments (underscore-separated)
    // We split by _ and check segments to avoid matching partial words like shoroukG → G
    const segments = groupName.split('_').map(s => s.trim());

    // Semi: explicit _SP segment (standalone or with leading digit like 1SP(), or keyword, or trainer hint
    const hasSPSegment = segments.some(seg => /^\d*SP(\(|$)/i.test(seg));
    const hasSemiKeyword = /\bsemi\b/i.test(groupName);
    const trainerIsSemi = /\(semi\)/i.test(trainerHint) || /\(sp\)/i.test(trainerHint);

    if (hasSPSegment || hasSemiKeyword || trainerIsSemi) {
      result.dept_type = 'Semi';
      result.lecture_duration_min = 60;

    // Private: explicit segment or trainer hint "(private)" / "(p)"
    } else if (/\bPrivate\b/i.test(groupName) || segments.some(seg => /^\d*P\(/.test(seg)) || /\(private\)/i.test(trainerHint)) {
      result.dept_type = 'Private';
      result.lecture_duration_min = 60;

    // General: explicit keyword in group name
    } else if (/\bGeneral\b/i.test(groupName) || trainerIsSemi === false && /\(general\)/i.test(trainerHint)) {
      result.dept_type = 'General';
      result.lecture_duration_min = 90;

    } else {
      // Default fallback — no reliable indicator found
      result.dept_type = 'General';
      result.lecture_duration_min = 90;
    }

    // Extract level code (e.g. Con_4, General_3, conversation_2)
    const levelMatch = groupName.match(/(?:Con(?:versation)?_?\d+|General_?\d+|Intermediate_?\d+|Advanced_?\d+)/i);
    if (levelMatch) result.level_code = levelMatch[0];

    // Extract weekday from code
    const dayMatch = groupName.match(/_(Mon|Tue|Wed|Thu|Fri|Sat|Sun)_/i);
    if (dayMatch) {
      const day = dayMatch[1].charAt(0).toUpperCase() + dayMatch[1].slice(1).toLowerCase();
      // Map to pair
      for (const [key, val] of Object.entries(MAIN_TO_SIDE)) {
        const days = key.split(',');
        if (days.includes(day)) {
          result.main_days = key;
          result.side_days = val;
          break;
        }
      }
    }

    return result;
  } catch {
    return {};
  }
}

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────
function normalizeDate(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const s = String(val).trim();
  // dd/mm/yy or dd/mm/yyyy
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m1) {
    const year = m1[3].length === 2 ? '20' + m1[3] : m1[3];
    return `${year}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
  }
  // yyyy-mm-dd already
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // MM/DD with no year (e.g. "05/04, 03:18 PM")
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})(?:,\s*(.+))?/);
  if (m2) {
    const year = new Date().getFullYear();
    return `${year}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`;
  }
  return s;
}

function normalizePhone(val) {
  if (!val) return null;
  const n = Number(val);
  if (!isNaN(n) && n > 0) return String(Math.round(n));
  return String(val).trim().replace(/\s+/g, '');
}

function normalizeDuration(val) {
  // Returns minutes as integer
  if (!val) return null;
  const s = String(val).trim();
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);
  const mins = s.match(/^(\d+)\s*min/i);
  if (mins) return parseInt(mins[1]);
  return null;
}

/**
 * Classify side session category by duration and position
 * positionInGroup: 1-indexed position of this session among all sessions for this group
 * totalInGroup: total sessions in the group
 */
function classifySideSession(durationStr, positionInGroup, totalInGroup) {
  const dur = normalizeDuration(durationStr);
  if (dur === null) return 'regular';
  if (positionInGroup === 1 && dur > 15) return 'onboarding';
  if (positionInGroup === totalInGroup && dur > 15) return 'offboarding';
  if (dur === 15) return 'regular';
  return 'compensatory';
}

// ─── SLA HELPER ──────────────────────────────────────────────────────────────
const SLA_HOURS = { 'عاجلة': 24, 'هامة': 48, 'عادية': 72 };

function computeSlaDeadline(addedAt, priority) {
  if (!addedAt) return null;
  const hours = SLA_HOURS[priority] || 72;
  const dt = new Date(addedAt);
  if (isNaN(dt.getTime())) return null;
  dt.setHours(dt.getHours() + hours);
  return dt.toISOString();
}

// ─── PARSERS ──────────────────────────────────────────────────────────────────

/** Data.xlsx → employees */
function parseEmployees(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  rows.shift(); // remove header
  return rows
    .filter(r => r[0])
    .map(r => ({
      name: String(r[0]).trim(),
      department: r[1] ? String(r[1]).trim() : 'General',
    }));
}

/** Active Batches Trainees.xlsx → clients */
function parseTrainees(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  rows.shift();
  return rows
    .filter(r => r[0])
    .map(r => ({
      name: String(r[0]).trim(),
      phone: normalizePhone(r[1]),
      email: r[2] && String(r[2]).trim() !== '--' ? String(r[2]).trim() : null,
      group_name: r[3] ? String(r[3]).trim() : null,
      via_company: r[4] && String(r[4]).trim() !== '--' ? String(r[4]).trim() : null,
      registration_time: r[5] ? String(r[5]).trim() : null,
    }));
}

/** Batches.xlsx → batches */
function parseBatches(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  rows.shift();
  return rows
    .filter(r => r[1])
    .map(r => {
      const groupName = String(r[1]).trim();
      const trainersStr = r[4] ? String(r[4]).trim() : '';
      const parsed = parseGroupCode(groupName, trainersStr);
      return {
        external_id: r[0] ? Number(r[0]) : null,
        group_name: groupName,
        course: r[2] ? String(r[2]).trim() : null,
        status: r[3] ? String(r[3]).trim() : null,
        trainers: trainersStr || null,
        trainee_count: r[5] ? Number(r[5]) : 0,
        max_trainees: r[6] ? Number(r[6]) : 0,
        scheduled_lectures: r[7] ? Number(r[7]) : 0,
        completed_lectures: r[8] ? Number(r[8]) : 0,
        start_date: normalizeDate(r[9]),
        end_date: normalizeDate(r[10]),
        training_schedule: r[11] ? String(r[11]).trim() : null,
        coordinators: r[12] ? String(r[12]).trim() : null,
        added_at: r[13] ? String(r[13]).trim() : null,
        added_by: r[14] ? String(r[14]).trim() : null,
        closed_by: r[15] ? String(r[15]).trim() : null,
        ...parsed,
      };
    });
}

/** Remarks.xlsx → remarks */
function parseRemarks(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  rows.shift();
  return rows
    .filter(r => r[0])
    .map(r => {
      const addedAt = r[11] ? String(r[11]).trim() : null;
      const priority = r[8] ? String(r[8]).trim() : null;
      return {
        external_id: Number(r[0]),
        task_type: r[1] ? String(r[1]).trim() : null,
        assigned_to: r[2] ? String(r[2]).trim() : null,
        details: r[3] ? String(r[3]).trim() : null,
        category: r[4] ? String(r[4]).trim() : null,
        status: r[5] ? String(r[5]).trim() : null,
        client_name: r[6] ? String(r[6]).trim() : null,
        client_phone: normalizePhone(r[7]),
        priority,
        assigned_by: r[9] ? String(r[9]).trim() : null,
        notes: r[10] ? String(r[10]).trim() : null,
        added_at: addedAt,
        last_updated: r[12] ? String(r[12]).trim() : null,
        sla_deadline: computeSlaDeadline(addedAt, priority),
      };
    });
}

/** Lectures.xlsx → lectures (session_type='main') */
function parseLectures(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  rows.shift();
  return rows
    .filter(r => r[0])
    .map(r => ({
      group_name: String(r[0]).trim(),
      date: normalizeDate(r[1]),
      time: r[2] ? String(r[2]).trim() : null,
      duration: r[3] ? String(r[3]).trim() : null,
      trainer: r[4] ? String(r[4]).trim() : null,
      status: r[5] ? String(r[5]).trim() : null,
      location: r[6] ? String(r[6]).trim() : null,
      attendance: r[7] ? String(r[7]).trim() : null,
      session_type: 'main',
      side_session_category: null,
    }));
}

/** Lectures of Side Session.xlsx → lectures (session_type='side') */
function parseSideSessions(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  rows.shift();

  // Group by group_name to determine positions for classification
  const grouped = {};
  rows.filter(r => r[0]).forEach(r => {
    const g = String(r[0]).trim();
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(r);
  });

  const result = [];
  for (const [groupName, groupRows] of Object.entries(grouped)) {
    const total = groupRows.length;
    groupRows.forEach((r, idx) => {
      const duration = r[3] ? String(r[3]).trim() : null;
      result.push({
        group_name: groupName,
        date: normalizeDate(r[1]),
        time: r[2] ? String(r[2]).trim() : null,
        duration,
        trainer: r[4] ? String(r[4]).trim() : null,
        status: r[5] ? String(r[5]).trim() : null,
        location: r[6] ? String(r[6]).trim() : null,
        attendance: r[7] ? String(r[7]).trim() : null,
        session_type: 'side',
        side_session_category: classifySideSession(duration, idx + 1, total),
      });
    });
  }
  return result;
}

/** Absent Student.xlsx → absent_students */
function parseAbsent(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  rows.shift();
  return rows
    .filter(r => r[0])
    .map(r => ({
      group_name: String(r[0]).trim(),
      student_name: r[1] ? String(r[1]).trim() : null,
      phone: normalizePhone(r[2]),
      date: normalizeDate(r[3]),
      time: r[4] ? String(r[4]).trim() : null,
      lecture_no: r[5] ? Math.round(Number(r[5])) : null,
    }));
}

module.exports = {
  parseEmployees,
  parseTrainees,
  parseBatches,
  parseRemarks,
  parseLectures,
  parseSideSessions,
  parseAbsent,
  parseGroupCode,
  normalizeDuration,
  computeSlaDeadline,
};
