'use strict';
const db = require('../config/database');

/**
 * Daily Todos Service
 *
 * Single source of truth for generating a date's instances from recurring
 * todo templates. Used by:
 *   1. node-cron job — fires nightly at 00:30 Cairo (see app.js)
 *   2. startup catch-up — runs ~7s after boot in case the cron missed the
 *      fire window (e.g. server was restarting during a deploy)
 *   3. lazy generation — todos.routes.js still calls it (via the shared
 *      helpers below) when a user opens the todos page (handles edge cases
 *      like first-of-the-day visit before the cron has fired)
 *
 * IDEMPOTENT: every (template, date, assignee) triple is checked before
 * insert, so this can be called any number of times per day without
 * duplicating instances.
 *
 * SCHEDULING (added 2026-07-02):
 *   • recurrence_start_date / recurrence_end_date gate WHICH dates fire.
 *   • target_scope fans a template out to many assignees at generation time:
 *       'user'       → the template's own assigned_to (legacy, default)
 *       'department' → every ACTIVE agent in the template's department + line
 *       'all'        → every ACTIVE agent in the template's management + line
 *     Resolving assignees at generation time means new hires are picked up
 *     automatically and departed staff are dropped — no per-user templates.
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

// Full "should this template produce instances on `dateStr`?" check:
// recurrence pattern match AND inside the optional [start, end] window.
// YYYY-MM-DD strings compare lexicographically, so plain < / > work.
function templateFiresOn(tmpl, dateStr) {
  if (!recurrenceMatchesDate(tmpl.recurrence_pattern, dateStr)) return false;
  if (tmpl.recurrence_start_date && dateStr < tmpl.recurrence_start_date) return false;
  if (tmpl.recurrence_end_date   && dateStr > tmpl.recurrence_end_date)   return false;
  return true;
}

// Resolve the list of assignee user IDs a template fans out to.
//   'department' → active agents in tmpl.department + tmpl.line
//   'all'        → active agents in tmpl.management (unless 'All') + tmpl.line
//   'user'/other → the single assigned_to (may be null → one legacy instance)
function resolveFanoutAssignees(tmpl) {
  const scope = tmpl.target_scope || 'user';
  const line = tmpl.line || 'Ahmed Hassan';

  if (scope === 'department') {
    if (!tmpl.department) return [];
    return db.prepare(`
      SELECT id FROM users
       WHERE is_active = 1 AND role = 'agent'
         AND LOWER(TRIM(department)) = LOWER(TRIM(?))
         AND line = ?
    `).all(tmpl.department, line).map(r => r.id);
  }

  if (scope === 'all') {
    if (tmpl.management && tmpl.management !== 'All') {
      return db.prepare(`
        SELECT id FROM users
         WHERE is_active = 1 AND role = 'agent'
           AND management = ? AND line = ?
      `).all(tmpl.management, line).map(r => r.id);
    }
    return db.prepare(`
      SELECT id FROM users
       WHERE is_active = 1 AND role = 'agent' AND line = ?
    `).all(line).map(r => r.id);
  }

  // Legacy single-user scope. Preserve old behaviour exactly: one instance
  // carrying the template's assigned_to (which may be null).
  return [tmpl.assigned_to ?? null];
}

// Prepared statements shared by every generation path.
function makeStmts() {
  return {
    insertInstance: db.prepare(`
      INSERT INTO todos
        (title, description, status, priority, due_date, due_time,
         created_by, assigned_to, department, management,
         related_remark_id, tags, parent_todo_id, line)
      VALUES (?,?,'new',?,?,?,?,?,?,?,?,?,?,?)
    `),
    // NULL-safe on assigned_to (`IS ?`) so a legacy unassigned instance and a
    // fanned-out per-agent instance never collide on the same (parent, date).
    checkExisting: db.prepare(
      `SELECT id FROM todos WHERE parent_todo_id = ? AND due_date = ? AND assigned_to IS ? LIMIT 1`
    ),
  };
}

// Generate (idempotently) all instances a single template owes for one date.
// Returns { created, skipped }. Callers that already filtered by
// templateFiresOn still get a safe no-op here if the date doesn't fire.
function generateInstancesForTemplate(tmpl, dateStr, stmts) {
  if (!templateFiresOn(tmpl, dateStr)) return { created: 0, skipped: 0 };
  const { insertInstance, checkExisting } = stmts;
  let created = 0, skipped = 0;
  for (const uid of resolveFanoutAssignees(tmpl)) {
    const uidVal = uid ?? null;
    if (checkExisting.get(tmpl.id, dateStr, uidVal)) { skipped++; continue; }
    insertInstance.run(
      tmpl.title, tmpl.description, tmpl.priority,
      dateStr, tmpl.due_time,
      tmpl.created_by, uidVal, tmpl.department, tmpl.management,
      tmpl.related_remark_id, tmpl.tags, tmpl.id, tmpl.line
    );
    created++;
  }
  return { created, skipped };
}

/**
 * Generate instances for ALL active templates that fire on `date`.
 *
 * @param {string|null} date  YYYY-MM-DD (default: today in Cairo)
 * @returns {{
 *   date: string,
 *   total_templates: number,
 *   matched: number,         // templates whose schedule fires on `date`
 *   created: number,         // new instances inserted (across fan-out)
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

  const stmts = makeStmts();
  let matched = 0, created = 0, skipped = 0;
  for (const tmpl of templates) {
    if (!templateFiresOn(tmpl, t)) continue;
    matched++;
    const r = generateInstancesForTemplate(tmpl, t, stmts);
    created += r.created;
    skipped += r.skipped;
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
  templateFiresOn,
  resolveFanoutAssignees,
  makeStmts,
  generateInstancesForTemplate,
  generateDailyInstancesForAll,
};
