'use strict';

/**
 * Official-holidays helpers.
 *
 * `official_holidays` stores date RANGES (start_date..end_date) that the
 * business marks as official holidays. Trainer-facing reports (availability,
 * utilization, work history) must EXCLUDE these days from the calculation so a
 * trainer is never counted as absent / under-utilized just because the academy
 * was closed.
 */

const db = require('../config/database');

// Set of every holiday date string (YYYY-MM-DD), expanding each range day-by-day.
function getHolidayDateSet() {
  const set = new Set();
  let rows = [];
  try {
    rows = db.prepare(`SELECT start_date, end_date FROM official_holidays`).all();
  } catch (_) { return set; }   // table may not exist on first boot
  for (const r of rows) {
    const s = String(r.start_date || '').slice(0, 10);
    const e = String(r.end_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) continue;
    const d = new Date(s + 'T12:00:00');
    const end = new Date(e + 'T12:00:00');
    if (isNaN(d.getTime()) || isNaN(end.getTime())) continue;
    let guard = 0;
    while (d <= end && guard++ < 400) {
      set.add(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
  }
  return set;
}

// SQL boolean expression: TRUE when `dateExpr` (a column/expr yielding YYYY-MM-DD)
// falls inside ANY official holiday range. Use as `AND NOT ${isHolidaySql('l.date')}`.
function isHolidaySql(dateExpr) {
  return `EXISTS (SELECT 1 FROM official_holidays oh WHERE ${dateExpr} BETWEEN oh.start_date AND oh.end_date)`;
}

module.exports = { getHolidayDateSet, isHolidaySql };
