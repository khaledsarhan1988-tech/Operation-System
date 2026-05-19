'use strict';
const db = require('../config/database');

/**
 * Daily Todos Service
 *
 * Single source of truth for generating today's instances from recurring
 * todo templates. Used by:
 *   1. node-cron job — fires nightly at 00:30 Cairo (see app.js)
 *   2. startup catch-up — runs ~5s after boot in case the cron missed the
 *      fire window (e.g. server was restarting during a deploy)
 *   3. lazy generation — todos.routes.js still calls it when a user opens
 *      the todos page (handles edge cases like first-of-the-day visit
 *      before the cron has fired, or a template added after midnight)
 *
 * IDEMPOTENT: every template+date pair is checked before insert, so this
 * function can be called any number of times per day without duplicating
 * instances.
 */

// Cairo "today" — must match the DATE() format stored in due_date columns
// (the rest of the app uses `DATE('now', '+2 hours')` to express Cairo time).
function todayCairo() {
  const r = db.prepare("SELECT DATE('now', '+2 hours') AS d").get();
  return r?.d || new Date().toISOString().slice(0, 10);
}

// Does the template's recurrence pattern match the given date?
// Supports:
//   'daily'                              → every day
//   'weekly:sat,sun,mon,...'             → specific weekdays (3-letter en)
//   'monthly:15'                         → 15th of every month
function recurrenceMatchesDate(pattern, dateStr) {
  if (!pattern) return false;
  if (pattern === 'daily') return true;
  if (pattern.startsWith('weekly:')) {
    const days = pattern.slice(7).toLowerCase().split(',').map(s => s.trim());
    const dayOfWeek = new Date(dateStr + 'T00:00:00')
      .toLocaleDateString('en-US', { weekday: 'short' })
      .toLowerCase();
    return days.some(d => d.startsWith(dayOfWeek));
  }
  if (pattern.startsWith('monthly:')) {
    const day = parseInt(pattern.slice(8), 10);
    const todayDay = parseInt(dateStr.split('-')[2], 10);
    return day === todayDay;
  }
  return false;
}

/**
 * Generate instances for ALL active templates whose pattern matches `date`.
 *
 * @param {string|null} date  YYYY-MM-DD (default: today in Cairo)
 * @returns {{
 *   date: string,
 *   total_templates: number,
 *   matched: number,         // templates whose pattern fires today
 *   created: number,         // new instances inserted
 *   skipped: number,         // instances that already existed
 * }}
 */
function generateDailyInstancesForAll(date = null) {
  const t = date || todayCairo();

  const templates = db.prepare(`
    SELECT * FROM todos
    WHERE is_recurring = 1
      AND parent_todo_id IS NULL
      AND status NOT IN ('cancelled')
  `).all();

  const insertInstance = db.prepare(`
    INSERT INTO todos
      (title, description, status, priority, due_date, due_time,
       created_by, assigned_to, department, management,
       related_remark_id, tags, parent_todo_id, line)
    VALUES (?,?,'new',?,?,?,?,?,?,?,?,?,?,?)
  `);
  const checkExisting = db.prepare(
    `SELECT id FROM todos WHERE parent_todo_id = ? AND due_date = ? LIMIT 1`
  );

  let matched = 0, created = 0, skipped = 0;
  for (const tmpl of templates) {
    if (!recurrenceMatchesDate(tmpl.recurrence_pattern, t)) continue;
    matched++;

    if (checkExisting.get(tmpl.id, t)) { skipped++; continue; }

    insertInstance.run(
      tmpl.title, tmpl.description, tmpl.priority,
      t, tmpl.due_time,
      tmpl.created_by, tmpl.assigned_to, tmpl.department, tmpl.management,
      tmpl.related_remark_id, tmpl.tags, tmpl.id, tmpl.line
    );
    created++;
  }

  return {
    date: t,
    total_templates: templates.length,
    matched,
    created,
    skipped,
  };
}

module.exports = {
  todayCairo,
  recurrenceMatchesDate,
  generateDailyInstancesForAll,
};
