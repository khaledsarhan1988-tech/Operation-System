'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { resolveLeaderDepts, sqlInDepts } = require('../utils/leader-scope');
const dailyTodos = require('../services/daily-todos.service');

const router = express.Router();
router.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function userScope(req) {
  return {
    id: req.user?.id,
    role: req.user?.role || 'agent',
    department: req.user?.department || null,
    management: req.user?.management || null,
    line: req.user?.line || 'Ahmed Hassan',
    fullName: req.user?.full_name || null,
  };
}

// Whether a user can see a given todo. Used for one-record checks.
function canViewTodo(scope, todo) {
  if (!todo) return false;
  if (scope.role === 'admin') {
    if (scope.management === 'All') return true;
    return todo.management === scope.management || todo.management === 'All' || todo.management == null;
  }
  if (scope.role === 'leader') {
    return todo.assigned_to === scope.id
        || todo.created_by  === scope.id
        || todo.department  === scope.department
        || todo.management  === scope.management;
  }
  // agent: only their own
  return todo.assigned_to === scope.id || todo.created_by === scope.id;
}

function canMutateTodo(scope, todo) {
  if (!todo) return false;
  if (scope.role === 'admin') return canViewTodo(scope, todo);
  if (scope.role === 'leader') {
    return todo.assigned_to === scope.id
        || todo.created_by  === scope.id
        || todo.department  === scope.department;
  }
  return todo.assigned_to === scope.id || todo.created_by === scope.id;
}

// Can the user edit the CONTENT of the todo (title/desc/date/priority/...)?
// Rule: only the creator can edit content — everyone else (even the assignee
// or a leader of the assignee's team) can only update the STATUS to reflect
// progress. The super-admin (management='All') can always edit anything as
// a system-wide override.
function canEditTodoContent(scope, todo) {
  if (!todo) return false;
  if (scope.role === 'admin' && scope.management === 'All') return true;
  return todo.created_by === scope.id;
}

// Deleting a todo is a stronger privilege than editing it. Same rule as
// content edit: only the creator or super-admin.
function canDeleteTodo(scope, todo) {
  return canEditTodoContent(scope, todo);
}

// Get the IDs of the agents that belong to a leader's *direct* team.
// Definition: any active user with role='agent' AND department in the
// leader's set of overseen departments (primary + extras). Other leaders /
// admins are excluded so they don't pollute the team views.
function leaderTeamMemberIds(scope) {
  if (scope.role !== 'leader') return [];
  const { listDepts } = resolveLeaderDepts(db, scope.id);
  if (listDepts.length === 0) return [];
  const { sql, params } = sqlInDepts(listDepts);
  const rows = db.prepare(`
    SELECT id FROM users
     WHERE is_active = 1
       AND role = 'agent'
       AND ${sql}
  `).all(...params);
  return rows.map(r => r.id);
}

// Build a WHERE clause for list queries, respecting role.
function buildListWhere(scope, query) {
  const wheres = ['t.line = ?'];
  const params = [scope.line === 'All' ? 'Ahmed Hassan' : scope.line];

  if (scope.role === 'admin') {
    if (scope.management !== 'All') {
      wheres.push("(t.management = ? OR t.management = 'All' OR t.management IS NULL)");
      params.push(scope.management);
    }
  } else if (scope.role === 'leader') {
    // Leader sees: their own tasks + tasks assigned to anyone in their
    // direct team (agents w/ same department). NOTE: we DON'T fall back to
    // `t.management = ?` here — that net was too wide and pulled in tasks
    // belonging to OTHER team leaders inside the same management.
    const teamIds = leaderTeamMemberIds(scope);
    const allIds = Array.from(new Set([scope.id, ...teamIds])).filter(Boolean);
    if (allIds.length === 0) {
      wheres.push('(t.assigned_to = ? OR t.created_by = ?)');
      params.push(scope.id, scope.id);
    } else {
      const placeholders = allIds.map(() => '?').join(',');
      wheres.push(`(
        t.assigned_to IN (${placeholders})
        OR t.created_by  IN (${placeholders})
      )`);
      params.push(...allIds, ...allIds);
    }
  } else {
    wheres.push('(t.assigned_to = ? OR t.created_by = ?)');
    params.push(scope.id, scope.id);
  }

  // Filters
  if (query.status)      { wheres.push('t.status = ?');      params.push(query.status); }
  if (query.priority)    { wheres.push('t.priority = ?');    params.push(query.priority); }
  if (query.assigned_to) { wheres.push('t.assigned_to = ?'); params.push(query.assigned_to); }
  if (query.due_date)    { wheres.push('t.due_date = ?');    params.push(query.due_date); }
  // Date-range filter (YYYY-MM-DD). Range-overlap semantics so multi-day tasks
  // count when any part of them falls inside the window. Validated to a strict
  // date shape before going into SQL.
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (dateRe.test(query.due_from || '')) {
    wheres.push('COALESCE(t.due_date_end, t.due_date) >= ?'); params.push(query.due_from);
  }
  if (dateRe.test(query.due_to || '')) {
    wheres.push('t.due_date <= ?'); params.push(query.due_to);
  }
  if (query.search) {
    wheres.push('(t.title LIKE ? OR t.description LIKE ? OR t.tags LIKE ?)');
    const s = `%${query.search}%`;
    params.push(s, s, s);
  }
  if (query.bucket) {
    // Temporal buckets used by My-Day UI.
    //
    // Multi-day tasks: due_date = range start, due_date_end = range end (may be
    // NULL for single-day tasks). The "effective end" of any task is
    // COALESCE(due_date_end, due_date), so a single-day task with date X is
    // treated as the range [X..X].
    //
    // A task is ACTIVE on a given date D when:  due_date <= D <= effective_end
    // It is OVERDUE on D when:                  effective_end < D
    const today = todayCairo();
    const tomorrow = addDaysCairo(1);
    const weekEnd = addDaysCairo(7);
    switch (query.bucket) {
      case 'overdue':
        // TIME-AWARE: a task with a due_time becomes overdue the minute its
        // deadline passes; a task without due_time is overdue once the
        // effective_end date is in the past.
        // Also includes COMPLETED-LATE tasks so the late history isn't lost.
        wheres.push(`(t.due_date IS NOT NULL AND (
             (t.status NOT IN ('completed','cancelled') AND t.due_time IS NOT NULL
               AND datetime(t.due_date || ' ' || t.due_time) < datetime('now', '+2 hours'))
          OR (t.status NOT IN ('completed','cancelled') AND t.due_time IS NULL
               AND COALESCE(t.due_date_end, t.due_date) < ?)
          OR (t.status = 'completed' AND t.completed_at IS NOT NULL AND t.due_time IS NOT NULL
               AND datetime(t.due_date || ' ' || t.due_time) < t.completed_at)
          OR (t.status = 'completed' AND t.completed_at IS NOT NULL AND t.due_time IS NULL
               AND DATE(t.completed_at) > COALESCE(t.due_date_end, t.due_date))
        ))`);
        params.push(today);
        break;
      case 'today':
        // Active today: today within [due_date, COALESCE(due_date_end, due_date)]
        wheres.push("(t.status NOT IN ('completed','cancelled') AND t.due_date <= ? AND COALESCE(t.due_date_end, t.due_date) >= ?)");
        params.push(today, today);
        break;
      case 'tomorrow':
        wheres.push("(t.status NOT IN ('completed','cancelled') AND t.due_date <= ? AND COALESCE(t.due_date_end, t.due_date) >= ?)");
        params.push(tomorrow, tomorrow);
        break;
      case 'this_week':
        // Range overlaps with [today..weekEnd]
        wheres.push("(t.status NOT IN ('completed','cancelled') AND t.due_date <= ? AND COALESCE(t.due_date_end, t.due_date) >= ?)");
        params.push(weekEnd, today);
        break;
      case 'later':
        // Starts after the week ends, or has no date at all
        wheres.push("(t.status NOT IN ('completed','cancelled') AND (t.due_date IS NULL OR t.due_date > ?))");
        params.push(weekEnd);
        break;
      case 'completed':
        wheres.push("t.status = 'completed'");
        break;
    }
  }

  return { where: wheres.join(' AND '), params };
}

function todayCairo() {
  const r = db.prepare("SELECT DATE('now', '+2 hours') AS d").get();
  return r?.d || new Date().toISOString().slice(0, 10);
}

function addDaysCairo(n) {
  // SQLite date modifiers must carry a SINGLE sign: '-6 days' is valid,
  // '+-6 days' is not — it makes DATE() return NULL, which silently turned the
  // "last N days" window start into NULL (so every BETWEEN over it matched
  // nothing). Build the sign from the number instead of always prefixing '+'.
  const days = Number(n) || 0;
  const modifier = `${days >= 0 ? '+' : '-'}${Math.abs(days)} days`;
  const r = db.prepare("SELECT DATE('now', '+2 hours', ?) AS d").get(modifier);
  return r?.d || null;
}

// ─── Recurring instance generator ─────────────────────────────────────────────
// For each recurring "template" todo VISIBLE to this viewer, ensure that
// today's instance(s) exist. Templates are: is_recurring=1 AND
// parent_todo_id IS NULL. Instances are: parent_todo_id = template.id.
//
// The scheduling + fan-out logic (pattern match, [start,end] window, and the
// per-scope assignee resolution for 'department'/'all') lives ENTIRELY in
// daily-todos.service.js so the lazy path here and the nightly cron / startup
// catch-up all share one implementation and can never drift. This function
// only decides WHICH templates the current viewer is allowed to trigger.
function ensureTodayRecurringInstances(scope) {
  try {
    const today = dailyTodos.todayCairo();
    const lineParam = scope.line === 'All' ? 'Ahmed Hassan' : scope.line;

    // Find all visible recurring templates for this user
    let templates;
    if (scope.role === 'admin' && scope.management === 'All') {
      templates = db.prepare(`
        SELECT * FROM todos
        WHERE is_recurring = 1 AND parent_todo_id IS NULL
          AND status NOT IN ('cancelled') AND line = ?
      `).all(lineParam);
    } else if (scope.role === 'admin') {
      templates = db.prepare(`
        SELECT * FROM todos
        WHERE is_recurring = 1 AND parent_todo_id IS NULL
          AND status NOT IN ('cancelled') AND line = ?
          AND (management = ? OR management = 'All' OR management IS NULL)
      `).all(lineParam, scope.management);
    } else if (scope.role === 'leader') {
      // Leader = own templates + templates assigned to anyone in their team.
      // Drop the wide `OR management = ?` net so we don't grab other teams'
      // templates and start generating duplicate daily instances for them.
      const teamIds = leaderTeamMemberIds(scope);
      const allIds = Array.from(new Set([scope.id, ...teamIds])).filter(Boolean);
      if (allIds.length === 0) {
        templates = db.prepare(`
          SELECT * FROM todos
          WHERE is_recurring = 1 AND parent_todo_id IS NULL
            AND status NOT IN ('cancelled') AND line = ?
            AND (assigned_to = ? OR created_by = ?)
        `).all(lineParam, scope.id, scope.id);
      } else {
        const placeholders = allIds.map(() => '?').join(',');
        templates = db.prepare(`
          SELECT * FROM todos
          WHERE is_recurring = 1 AND parent_todo_id IS NULL
            AND status NOT IN ('cancelled') AND line = ?
            AND (assigned_to IN (${placeholders}) OR created_by IN (${placeholders}))
        `).all(lineParam, ...allIds, ...allIds);
      }
    } else {
      templates = db.prepare(`
        SELECT * FROM todos
        WHERE is_recurring = 1 AND parent_todo_id IS NULL
          AND status NOT IN ('cancelled') AND line = ?
          AND (assigned_to = ? OR created_by = ?)
      `).all(lineParam, scope.id, scope.id);
    }

    const stmts = dailyTodos.makeStmts();
    for (const tmpl of templates) {
      dailyTodos.generateInstancesForTemplate(tmpl, today, stmts);
    }
  } catch (e) {
    console.error('[todos] recurring generation error:', e.message);
  }
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// GET /api/todos — list (role-aware)
router.get('/', (req, res) => {
  try {
    const scope = userScope(req);
    // Generate today's recurring instances BEFORE fetching so they appear
    // in the user's "Today" bucket immediately.
    ensureTodayRecurringInstances(scope);

    const includeTemplates = req.query.include_templates === '1';
    const { where, params } = buildListWhere(scope, req.query);
    // Hide template todos from the main list — only their daily instances
    // should appear. Caller can pass ?include_templates=1 to see templates.
    let templateClause = includeTemplates
      ? ''
      : ` AND NOT (t.is_recurring = 1 AND t.parent_todo_id IS NULL)`;
    // ?task_kind=extra → only manual (non-workflow) tasks
    // ?task_kind=workflow → only workflow instances (recurring children)
    if (req.query.task_kind === 'extra') {
      templateClause += ` AND t.is_recurring = 0 AND t.parent_todo_id IS NULL`;
    } else if (req.query.task_kind === 'workflow') {
      templateClause += ` AND t.parent_todo_id IS NOT NULL`;
    }
    const sort = (req.query.sort || 'smart').toString();
    // NOTE: SQLite ORDER BY references the column alias `priority_rank` from
    // the SELECT list — NOT `t.priority_rank` (that prefix breaks because the
    // alias has no table qualifier). Previously caused
    // "no such column: t.priority_rank" → entire endpoint returned 0 results.
    let orderBy;
    switch (sort) {
      case 'created_desc': orderBy = 't.created_at DESC'; break;
      case 'due_asc':      orderBy = 't.due_date IS NULL, t.due_date ASC, priority_rank ASC'; break;
      case 'priority':     orderBy = 'priority_rank ASC, t.due_date IS NULL, t.due_date ASC'; break;
      case 'smart':
      default:
        // smart = pending first, then by due_date, then by priority
        orderBy = `
          CASE t.status WHEN 'in_progress' THEN 0 WHEN 'new' THEN 1 WHEN 'on_hold' THEN 2
                       WHEN 'completed' THEN 3 ELSE 4 END,
          t.due_date IS NULL, t.due_date ASC,
          priority_rank ASC,
          t.created_at DESC
        `;
        break;
    }

    // late_by_minutes — time-aware lateness in MINUTES.
    //   • Tasks with a due_time: deadline = due_date + due_time
    //   • Tasks without due_time: deadline = end of effective_end day (23:59:59)
    //   • For COMPLETED tasks: minutes between deadline and completed_at (if > 0)
    //   • For OPEN tasks past their deadline: minutes between deadline and NOW
    //   • NULL otherwise (on time / no due date)
    // julianday returns days, * 1440 → minutes.
    const lateExpr = `
      CAST(
        CASE
          /* Completed late, with due_time precision */
          WHEN t.status = 'completed' AND t.completed_at IS NOT NULL
               AND t.due_date IS NOT NULL AND t.due_time IS NOT NULL
               AND datetime(t.due_date || ' ' || t.due_time) < t.completed_at
          THEN (julianday(t.completed_at) - julianday(t.due_date || ' ' || t.due_time)) * 1440
          /* Completed late, date-only — compare day vs day */
          WHEN t.status = 'completed' AND t.completed_at IS NOT NULL
               AND t.due_date IS NOT NULL AND t.due_time IS NULL
               AND DATE(t.completed_at) > COALESCE(t.due_date_end, t.due_date)
          THEN (julianday(DATE(t.completed_at)) - julianday(COALESCE(t.due_date_end, t.due_date))) * 1440
          /* Open + past deadline, with due_time */
          WHEN t.status NOT IN ('completed','cancelled')
               AND t.due_date IS NOT NULL AND t.due_time IS NOT NULL
               AND datetime(t.due_date || ' ' || t.due_time) < datetime('now', '+2 hours')
          THEN (julianday(datetime('now', '+2 hours')) - julianday(t.due_date || ' ' || t.due_time)) * 1440
          /* Open + past deadline, date-only */
          WHEN t.status NOT IN ('completed','cancelled')
               AND t.due_date IS NOT NULL AND t.due_time IS NULL
               AND COALESCE(t.due_date_end, t.due_date) < DATE('now', '+2 hours')
          THEN (julianday(DATE('now', '+2 hours')) - julianday(COALESCE(t.due_date_end, t.due_date))) * 1440
          ELSE NULL
        END
      AS INTEGER)
    `;

    const rows = db.prepare(`
      SELECT t.*,
        CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END AS priority_rank,
        ${lateExpr} AS late_by_minutes,
        u_assigned.full_name AS assigned_to_name,
        u_created.full_name  AS created_by_name,
        (SELECT COUNT(*) FROM todo_comments c WHERE c.todo_id = t.id) AS comment_count
      FROM todos t
      LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = t.created_by
      WHERE ${where}${templateClause}
      ORDER BY ${orderBy}
      LIMIT ?
    `).all(...params, parseInt(req.query.limit, 10) || 500);

    return res.json({ todos: rows, total: rows.length });
  } catch (err) {
    console.error('[todos] list error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/todos/stats — counts for dashboard
router.get('/stats', (req, res) => {
  try {
    const scope = userScope(req);
    ensureTodayRecurringInstances(scope);
    const { where, params } = buildListWhere(scope, {});
    const today = todayCairo();

    // Stats:
    //   • overdue_count → TIME-AWARE: counts both (a) currently-open tasks
    //     past their deadline AND (b) tasks completed AFTER their deadline.
    //     With due_time, deadline = due_date + due_time. Without due_time,
    //     deadline = end of effective_end day (so date-only tasks become
    //     overdue at the start of the next day).
    //   • due_today_count → date-range overlap with today (unchanged).
    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN t.status='new'         THEN 1 ELSE 0 END) AS new_count,
        SUM(CASE WHEN t.status='in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
        SUM(CASE WHEN t.status='on_hold'     THEN 1 ELSE 0 END) AS on_hold_count,
        SUM(CASE WHEN t.status='completed'   THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN t.due_date IS NOT NULL AND (
          /* Open + past deadline (with due_time) */
          (t.status NOT IN ('completed','cancelled') AND t.due_time IS NOT NULL
            AND datetime(t.due_date || ' ' || t.due_time) < datetime('now', '+2 hours'))
          /* Open + past end-of-day (date-only) */
          OR (t.status NOT IN ('completed','cancelled') AND t.due_time IS NULL
            AND COALESCE(t.due_date_end, t.due_date) < DATE('now', '+2 hours'))
          /* Completed AFTER deadline (with due_time) */
          OR (t.status = 'completed' AND t.completed_at IS NOT NULL AND t.due_time IS NOT NULL
            AND datetime(t.due_date || ' ' || t.due_time) < t.completed_at)
          /* Completed AFTER end-of-day (date-only) */
          OR (t.status = 'completed' AND t.completed_at IS NOT NULL AND t.due_time IS NULL
            AND DATE(t.completed_at) > COALESCE(t.due_date_end, t.due_date))
        ) THEN 1 ELSE 0 END) AS overdue_count,
        SUM(CASE WHEN t.status NOT IN ('completed','cancelled')
                  AND t.due_date IS NOT NULL
                  AND t.due_date <= ?
                  AND COALESCE(t.due_date_end, t.due_date) >= ? THEN 1 ELSE 0 END) AS due_today_count,
        SUM(CASE WHEN t.priority='urgent' AND t.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS urgent_open
      FROM todos t
      WHERE ${where}
        AND NOT (t.is_recurring = 1 AND t.parent_todo_id IS NULL)
    `).get(today, today, ...params);  // 2 todays for due_today_count (overdue_count uses NOW() in-SQL)

    return res.json(stats || {});
  } catch (err) {
    console.error('[todos] stats error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/todos/templates — list user's recurring templates
router.get('/templates', (req, res) => {
  try {
    const scope = userScope(req);
    const { where, params } = buildListWhere(scope, {});
    const rows = db.prepare(`
      SELECT t.*,
        u_assigned.full_name AS assigned_to_name,
        -- Employment state of the assignee, so the manager can spot (and retire)
        -- templates still attached to people who left the academy.
        u_assigned.is_active AS assigned_is_active,
        u_created.full_name  AS created_by_name,
        (SELECT COUNT(*) FROM todos c WHERE c.parent_todo_id = t.id) AS instances_count,
        (SELECT COUNT(*) FROM todos c WHERE c.parent_todo_id = t.id AND c.status='completed') AS completed_count
      FROM todos t
      LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = t.created_by
      WHERE ${where} AND t.is_recurring = 1 AND t.parent_todo_id IS NULL
        AND t.status NOT IN ('cancelled')
      ORDER BY t.created_at DESC
    `).all(...params);
    return res.json({ templates: rows });
  } catch (err) {
    console.error('[todos] templates error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/todos/team-summary — per-assignee aggregate (for leader/admin)
//
// USERS-FIRST: we start from the user pool that should belong to this viewer's
// team. This guarantees we only show the leader's *own* coordinators (not
// other team leaders, not admins, and not coordinators outside her dept).
// Previously this query started from todos and grouped by assigned_to, which
// happily included anyone in the same `management` — that's why Gehad saw
// doha (another team leader) and other teams' agents.
router.get('/team-summary', (req, res) => {
  try {
    const scope = userScope(req);
    if (scope.role !== 'admin' && scope.role !== 'leader') {
      return res.status(403).json({ error: 'صلاحية للقادة والمدراء فقط' });
    }
    ensureTodayRecurringInstances(scope);
    const today = todayCairo();
    const lineParam = scope.line === 'All' ? 'Ahmed Hassan' : scope.line;

    // 1. Resolve the user pool to summarize.
    let userRows;
    if (scope.role === 'leader') {
      // Leader can manage MULTIPLE departments (primary + extras).
      const { listDepts } = resolveLeaderDepts(db, scope.id);
      const { sql, params: deptParams } = sqlInDepts(listDepts);
      userRows = db.prepare(`
        SELECT id, full_name FROM users
         WHERE is_active = 1
           AND role = 'agent'
           AND ${sql}
         ORDER BY full_name COLLATE NOCASE
      `).all(...deptParams);
    } else if (scope.management === 'All') {
      // Super-admin → every active agent
      userRows = db.prepare(`
        SELECT id, full_name FROM users
         WHERE is_active = 1 AND role = 'agent'
         ORDER BY full_name COLLATE NOCASE
      `).all();
    } else {
      // Department manager admin → agents in their management
      userRows = db.prepare(`
        SELECT id, full_name FROM users
         WHERE is_active = 1 AND role = 'agent' AND management = ?
         ORDER BY full_name COLLATE NOCASE
      `).all(scope.management);
    }
    if (userRows.length === 0) return res.json({ rows: [] });

    const ids = userRows.map(u => u.id);
    const placeholders = ids.map(() => '?').join(',');

    // 2. Aggregate todos for those users only.
    const aggRows = db.prepare(`
      SELECT
        t.assigned_to,
        COUNT(*) AS total,
        SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN t.status NOT IN ('completed','cancelled')
                  AND t.due_date IS NOT NULL AND t.due_date < ? THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN t.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN t.priority='urgent' AND t.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS urgent_open,
        SUM(CASE WHEN t.is_recurring = 0 AND t.parent_todo_id IS NULL THEN 1 ELSE 0 END) AS extra_count,
        SUM(CASE WHEN t.is_recurring = 0 AND t.parent_todo_id IS NULL
                  AND t.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS extra_open,
        SUM(CASE WHEN t.parent_todo_id IS NOT NULL THEN 1 ELSE 0 END) AS workflow_count,
        SUM(CASE WHEN t.parent_todo_id IS NOT NULL AND t.status='completed' THEN 1 ELSE 0 END) AS workflow_completed
      FROM todos t
      WHERE t.line = ?
        AND t.assigned_to IN (${placeholders})
        AND NOT (t.is_recurring = 1 AND t.parent_todo_id IS NULL)
      GROUP BY t.assigned_to
    `).all(today, lineParam, ...ids);

    const aggByUser = new Map(aggRows.map(r => [r.assigned_to, r]));

    // 3. Merge: every user appears (even with zeros), with completion_rate.
    const rows = userRows.map(u => {
      const a = aggByUser.get(u.id) || {};
      const total      = a.total      || 0;
      const completed  = a.completed  || 0;
      const completion_rate = total > 0 ? Math.round((completed / total) * 100) : 0;
      const workflow_count     = a.workflow_count     || 0;
      const workflow_completed = a.workflow_completed || 0;
      const workflow_rate = workflow_count > 0
        ? Math.round((workflow_completed / workflow_count) * 100) : 0;
      return {
        assigned_to: u.id,
        assigned_to_name: u.full_name,
        total,
        completed,
        overdue:     a.overdue     || 0,
        open_count:  a.open_count  || 0,
        urgent_open: a.urgent_open || 0,
        extra_count: a.extra_count || 0,
        extra_open:  a.extra_open  || 0,
        workflow_count,
        workflow_completed,
        completion_rate,
        workflow_rate,
      };
    }).sort((a, b) =>
      (b.open_count - a.open_count) || (b.urgent_open - a.urgent_open)
    );

    return res.json({ rows });
  } catch (err) {
    console.error('[todos] team-summary error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/todos/templates-performance — Matrix of employees × templates
// with today's status + historical completion rates. Used by the admin
// "Daily Workflow Monitoring" view.
//
// Query params:
//   ?days=7         → window for historical stats (1-90, default 7)
//   ?line=...       → for super-admins
//
// Returns:
//   {
//     date: "YYYY-MM-DD",  // today
//     employees: [
//       {
//         user_id, user_name,
//         today_completed, today_total, today_rate,
//         templates: [
//           {
//             template_id, title, due_time, priority,
//             today: { instance_id, status, completed_at, is_overdue },
//             stats_window: { total, completed, missed, rate }
//           }, ...
//         ]
//       }, ...
//     ],
//     templates_summary: [
//       { title, due_time, completed_today, total_assigned, completion_rate }, ...
//     ]
//   }
router.get('/templates-performance', (req, res) => {
  try {
    const scope = userScope(req);
    if (scope.role !== 'admin' && scope.role !== 'leader') {
      return res.status(403).json({ error: 'صلاحية للقادة والمدراء فقط' });
    }

    ensureTodayRecurringInstances(scope);

    const today = todayCairo();
    // Stats window: either an explicit from/to range (takes precedence) or the
    // rolling "last N days" preset. Dates are regex-validated before use.
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const fromQ = dateRe.test(req.query.from || '') ? req.query.from : null;
    const toQ   = dateRe.test(req.query.to   || '') ? req.query.to   : null;
    const customRange = !!(fromQ || toQ);
    let windowDays, windowStart, windowEnd;
    if (customRange) {
      windowEnd   = toQ   || today;
      windowStart = fromQ || windowEnd;
      if (windowStart > windowEnd) { const s = windowStart; windowStart = windowEnd; windowEnd = s; }
      windowDays = Math.round(
        (Date.parse(windowEnd + 'T00:00:00Z') - Date.parse(windowStart + 'T00:00:00Z')) / 86400000
      ) + 1;
    } else {
      windowDays  = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
      windowStart = addDaysCairo(-windowDays + 1);
      windowEnd   = today;
    }
    // The per-cell "current" status must follow the filter, not stay stuck on
    // today. When a date range is chosen, the cell shows the instance on the
    // range's END day (= the day itself for a single-day filter like "امبارح");
    // otherwise it's genuinely today.
    const refDate = customRange ? windowEnd : today;
    const refIsPast   = refDate < today;
    const refIsFuture = refDate > today;

    const { where, params } = buildListWhere(scope, {});

    // 1. Get all templates visible to this user, grouped per assignee.
    //    • status NOT 'cancelled' → retired/replaced templates must NOT keep
    //      showing here (replace-mode cancels rather than deletes so history
    //      survives; the monitoring board should only track the LIVE schedule).
    //    • INNER JOIN + is_active=1 → employees who left the academy drop out
    //      of the board (their history stays in the DB, just not monitored).
    // A RETIRED template must still appear when it produced real work inside the
    // window: its instances may already be done, and hiding the template would
    // erase that effort from the board (the employee shows "—" as if the task
    // was never theirs, and their rate silently drops). So: keep live templates,
    // plus cancelled ones that have at least one instance dated in the window.
    const templates = db.prepare(`
      SELECT t.id, t.title, t.description, t.due_time, t.priority, t.assigned_to,
             u.full_name AS assigned_to_name,
             u.department AS assigned_to_dept,
             CASE WHEN t.status = 'cancelled' THEN 1 ELSE 0 END AS is_retired
        FROM todos t
        INNER JOIN users u ON u.id = t.assigned_to AND u.is_active = 1
       WHERE ${where}
         AND t.is_recurring = 1 AND t.parent_todo_id IS NULL
         AND t.assigned_to IS NOT NULL
         AND (
           t.status NOT IN ('cancelled')
           OR EXISTS (SELECT 1 FROM todos c
                       WHERE c.parent_todo_id = t.id
                         AND c.due_date BETWEEN ? AND ?)
         )
       ORDER BY u.full_name COLLATE NOCASE, t.due_time, t.id
    `).all(...params, windowStart, windowEnd);

    // ── Fan-out templates (scope = department / all) ──────────────────────────
    // These carry assigned_to = NULL by design: the generator resolves the real
    // assignees per day. The query above requires assigned_to IS NOT NULL, so
    // they — and every instance the team completed under them — were INVISIBLE
    // on this board. Expand each one to the people who actually received it
    // inside the window, so their work is attributed to them.
    const fanoutTemplates = db.prepare(`
      SELECT t.id, t.title, t.description, t.due_time, t.priority,
             CASE WHEN t.status = 'cancelled' THEN 1 ELSE 0 END AS is_retired
        FROM todos t
       WHERE ${where}
         AND t.is_recurring = 1 AND t.parent_todo_id IS NULL
         AND t.assigned_to IS NULL
         AND (
           t.status NOT IN ('cancelled')
           OR EXISTS (SELECT 1 FROM todos c
                       WHERE c.parent_todo_id = t.id
                         AND c.due_date BETWEEN ? AND ?)
         )
    `).all(...params, windowStart, windowEnd);

    const getAudience = db.prepare(`
      SELECT DISTINCT c.assigned_to AS uid, u.full_name AS name, u.department AS dept
        FROM todos c
        INNER JOIN users u ON u.id = c.assigned_to AND u.is_active = 1
       WHERE c.parent_todo_id = ? AND c.due_date BETWEEN ? AND ?
    `);

    // Every template is evaluated as a (template, assignee) pair so a shared
    // fan-out template yields one cell per person.
    const pairs = templates.map(t => ({
      t, uid: t.assigned_to, name: t.assigned_to_name, dept: t.assigned_to_dept,
    }));
    for (const t of fanoutTemplates) {
      for (const a of getAudience.all(t.id, windowStart, windowEnd)) {
        pairs.push({ t, uid: a.uid, name: a.name, dept: a.dept });
      }
    }
    pairs.sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''))
      || String(a.t.due_time || '').localeCompare(String(b.t.due_time || ''))
      || a.t.id - b.t.id);

    // Instance lookups MUST be scoped to the assignee: a fan-out template has
    // one instance PER employee on the same date, so keying by template+date
    // alone would show one person's row to everybody.
    const getTodayInstance = db.prepare(`
      SELECT id, status, completed_at, due_time
        FROM todos
       WHERE parent_todo_id = ? AND due_date = ? AND assigned_to IS ?
       ORDER BY id ASC LIMIT 1
    `);

    // Helper for window stats
    const getWindowStats = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed
        FROM todos
       WHERE parent_todo_id = ?
         AND assigned_to IS ?
         AND due_date BETWEEN ? AND ?
    `);

    // Build "now HH:MM" for overdue detection
    const nowParts = new Date(Date.now() + 2 * 3600 * 1000);  // Cairo offset
    const nowMinutes = nowParts.getUTCHours() * 60 + nowParts.getUTCMinutes();

    function timeToMinutes(t) {
      if (!t) return null;
      const m = String(t).match(/^(\d{1,2}):(\d{2})/);
      if (!m) return null;
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }

    // 2. Group by employee
    const byEmployee = new Map();
    const templateAgg = new Map(); // by title — for overall summary

    for (const pair of pairs) {
      const t = pair.t;
      // Instance for the reference date (the filtered day, or today) — scoped
      // to THIS assignee.
      const inst = getTodayInstance.get(t.id, refDate, pair.uid);
      const dueMin = timeToMinutes(t.due_time);
      const notDone = !inst || (inst.status !== 'completed' && inst.status !== 'cancelled');
      const isOverdue = refIsFuture
        ? false                                    // a future day is never "late"
        : refIsPast
          ? notDone                                // a past day fully elapsed
          : (dueMin != null && nowMinutes > dueMin && notDone);   // today = time-aware

      // Window stats — scoped to THIS assignee
      const ws = getWindowStats.get(t.id, pair.uid, windowStart, windowEnd) || { total: 0, completed: 0 };

      const todayInfo = inst
        ? { instance_id: inst.id, status: inst.status, completed_at: inst.completed_at, is_overdue: isOverdue }
        : { instance_id: null, status: 'missing', completed_at: null, is_overdue: isOverdue };

      const statsInfo = {
        total: ws.total || 0,
        completed: ws.completed || 0,
        missed: (ws.total || 0) - (ws.completed || 0),
        rate: ws.total > 0 ? Math.round((ws.completed / ws.total) * 100) : 0,
        window_days: windowDays,
      };

      // Accumulate per-employee
      if (!byEmployee.has(pair.uid)) {
        byEmployee.set(pair.uid, {
          user_id: pair.uid,
          user_name: pair.name,
          department: pair.dept,
          templates: [],
          today_completed: 0,
          today_total: 0,
        });
      }
      const emp = byEmployee.get(pair.uid);
      emp.templates.push({
        template_id: t.id,
        title: t.title,
        description: t.description,
        due_time: t.due_time,
        priority: t.priority,
        is_retired: t.is_retired === 1,   // no longer scheduled, but did work in-window
        today: todayInfo,
        stats_window: statsInfo,
      });
      emp.today_total++;
      if (todayInfo.status === 'completed') emp.today_completed++;

      // Accumulate per-template (across employees)
      const key = `${t.title}|${t.due_time || ''}`;
      if (!templateAgg.has(key)) {
        templateAgg.set(key, {
          title: t.title,
          due_time: t.due_time,
          priority: t.priority,
          completed_today: 0,
          total_assigned: 0,
        });
      }
      const tagg = templateAgg.get(key);
      tagg.total_assigned++;
      if (todayInfo.status === 'completed') tagg.completed_today++;
    }

    // Compute per-employee rate
    const employees = Array.from(byEmployee.values()).map(e => ({
      ...e,
      today_rate: e.today_total > 0 ? Math.round((e.today_completed / e.today_total) * 100) : 0,
    }));

    // Sort employees by completion rate (highest first)
    employees.sort((a, b) => (b.today_rate || 0) - (a.today_rate || 0) || (b.today_completed - a.today_completed));

    const templates_summary = Array.from(templateAgg.values()).map(t => ({
      ...t,
      completion_rate: t.total_assigned > 0
        ? Math.round((t.completed_today / t.total_assigned) * 100) : 0,
    })).sort((a, b) => String(a.due_time || '').localeCompare(String(b.due_time || '')));

    return res.json({
      date: today,
      reference_date: refDate,   // the day the per-cell "current" status reflects
      window_days: windowDays,
      window_start: windowStart,
      window_end: windowEnd,
      custom_range: customRange,
      employees,
      templates_summary,
      total_employees: employees.length,
      total_templates: templates.length,
    });
  } catch (err) {
    console.error('[todos] templates-performance error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/todos/assignable-users — who can be assigned to (for create/edit dropdowns)
router.get('/assignable-users', (req, res) => {
  try {
    const scope = userScope(req);
    const userLine = scope.line === 'All' ? 'Ahmed Hassan' : scope.line;
    let rows;
    if (scope.role === 'admin' && scope.management === 'All') {
      rows = db.prepare(
        `SELECT id, full_name, role, department, management FROM users
          WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE`
      ).all();
    } else if (scope.role === 'admin') {
      rows = db.prepare(
        `SELECT id, full_name, role, department, management FROM users
          WHERE is_active = 1 AND (management = ? OR management = 'All')
          ORDER BY full_name COLLATE NOCASE`
      ).all(scope.management);
    } else if (scope.role === 'leader') {
      // Leader can only assign to: themselves + agents in any of their
      // overseen departments (primary + extras). Other leaders and other
      // teams' agents are excluded.
      const { listDepts } = resolveLeaderDepts(db, scope.id);
      const { sql: inSql, params: deptParams } = sqlInDepts(listDepts);
      rows = db.prepare(
        `SELECT id, full_name, role, department, management FROM users
          WHERE is_active = 1
            AND (
              id = ?
              OR (role = 'agent' AND ${inSql})
            )
          ORDER BY full_name COLLATE NOCASE`
      ).all(scope.id, ...deptParams);
    } else {
      // agent — only themselves
      rows = db.prepare(
        `SELECT id, full_name, role, department, management FROM users WHERE id = ?`
      ).all(scope.id);
    }
    return res.json({ users: rows, viewer_line: userLine });
  } catch (err) {
    console.error('[todos] assignable-users error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/todos/:id — single todo with comments
router.get('/:id', (req, res) => {
  try {
    const scope = userScope(req);
    // Same lateness maths the list uses, so the detail drill-down can show
    // "اتعملت متأخر بكام" without the client recomputing it.
    const todo = db.prepare(`
      SELECT t.*,
        CAST(
          CASE
            WHEN t.status = 'completed' AND t.completed_at IS NOT NULL
                 AND t.due_date IS NOT NULL AND t.due_time IS NOT NULL
                 AND datetime(t.due_date || ' ' || t.due_time) < t.completed_at
            THEN (julianday(t.completed_at) - julianday(t.due_date || ' ' || t.due_time)) * 1440
            WHEN t.status = 'completed' AND t.completed_at IS NOT NULL
                 AND t.due_date IS NOT NULL AND t.due_time IS NULL
                 AND DATE(t.completed_at) > COALESCE(t.due_date_end, t.due_date)
            THEN (julianday(DATE(t.completed_at)) - julianday(COALESCE(t.due_date_end, t.due_date))) * 1440
            WHEN t.status NOT IN ('completed','cancelled')
                 AND t.due_date IS NOT NULL AND t.due_time IS NOT NULL
                 AND datetime(t.due_date || ' ' || t.due_time) < datetime('now', '+2 hours')
            THEN (julianday(datetime('now', '+2 hours')) - julianday(t.due_date || ' ' || t.due_time)) * 1440
            WHEN t.status NOT IN ('completed','cancelled')
                 AND t.due_date IS NOT NULL AND t.due_time IS NULL
                 AND COALESCE(t.due_date_end, t.due_date) < DATE('now', '+2 hours')
            THEN (julianday(DATE('now', '+2 hours')) - julianday(COALESCE(t.due_date_end, t.due_date))) * 1440
            ELSE NULL
          END
        AS INTEGER) AS late_by_minutes,
        u_assigned.full_name AS assigned_to_name,
        u_created.full_name  AS created_by_name
      FROM todos t
      LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = t.created_by
      WHERE t.id = ?
    `).get(req.params.id);
    if (!todo) return res.status(404).json({ error: 'غير موجود' });
    if (!canViewTodo(scope, todo)) return res.status(403).json({ error: 'صلاحية غير كافية' });

    const comments = db.prepare(`
      SELECT c.*, u.full_name AS user_name
      FROM todo_comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.todo_id = ?
      ORDER BY c.created_at ASC
    `).all(req.params.id);

    return res.json({ todo, comments });
  } catch (err) {
    console.error('[todos] get error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/todos — create
router.post('/', express.json(), (req, res) => {
  try {
    const scope = userScope(req);
    const b = req.body || {};
    if (!b.title || !String(b.title).trim()) {
      return res.status(400).json({ error: 'العنوان مطلوب' });
    }

    // Agents can only assign to themselves
    let assignedTo = Number(b.assigned_to) || scope.id;
    if (scope.role === 'agent') assignedTo = scope.id;

    // Normalize date range: if due_date_end < due_date, swap to keep the
    // invariant (start <= end). Both can be NULL.
    let dueDate    = b.due_date    || null;
    let dueDateEnd = b.due_date_end || null;
    if (dueDate && dueDateEnd && dueDateEnd < dueDate) {
      [dueDate, dueDateEnd] = [dueDateEnd, dueDate];
    }
    // Single-day task → store NULL for end (signals "no range")
    if (dueDateEnd && dueDate && dueDateEnd === dueDate) dueDateEnd = null;

    // ── Recurring-template scheduling + fan-out scope ──────────────────────
    // target_scope is meaningful ONLY on recurring templates. Agents can never
    // fan out (forced to their own 'user' scope). department/all templates are
    // UNASSIGNED at the template level — the generator resolves the concrete
    // assignees per day (see daily-todos.service.js).
    const isRecurring = b.is_recurring ? 1 : 0;
    let targetScope = 'user';
    let templateDepartment = b.department || scope.department || null;
    if (isRecurring && scope.role !== 'agent' &&
        (b.target_scope === 'department' || b.target_scope === 'all')) {
      targetScope = b.target_scope;
      assignedTo = null;                       // fan-out template holds no assignee
      if (targetScope === 'department') {
        templateDepartment = b.department || null;   // required target dept
      }
    }
    const recStart = isRecurring ? (b.recurrence_start_date || null) : null;
    const recEnd   = isRecurring ? (b.recurrence_end_date   || null) : null;

    const result = db.prepare(`
      INSERT INTO todos
        (title, description, status, priority, due_date, due_date_end, due_time,
         created_by, assigned_to, department, management,
         related_remark_id, tags, is_recurring, recurrence_pattern,
         recurrence_start_date, recurrence_end_date, target_scope,
         parent_todo_id, line)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      String(b.title).trim(),
      b.description || null,
      b.status || 'new',
      b.priority || 'normal',
      dueDate,
      dueDateEnd,
      b.due_time || null,
      scope.id,
      assignedTo,
      templateDepartment,
      b.management || scope.management || null,
      b.related_remark_id || null,
      b.tags || null,
      isRecurring,
      b.recurrence_pattern || null,
      recStart,
      recEnd,
      targetScope,
      b.parent_todo_id || null,
      scope.line === 'All' ? 'Ahmed Hassan' : scope.line,
    );

    const todo = db.prepare(`SELECT * FROM todos WHERE id = ?`).get(result.lastInsertRowid);
    // Pre-generate the upcoming window for a new recurring template so its
    // instances show up immediately (this week + next), not only after the
    // nightly cron. Idempotent + cheap (one template).
    if (todo.is_recurring === 1 && todo.parent_todo_id == null) {
      try { dailyTodos.generateWindowForTemplate(todo); }
      catch (e) { console.error('[todos] window gen (create):', e.message); }
    }
    return res.status(201).json({ todo });
  } catch (err) {
    console.error('[todos] create error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/todos/:id — update (partial)
router.patch('/:id', express.json(), (req, res) => {
  try {
    const scope = userScope(req);
    const existing = db.prepare(`SELECT * FROM todos WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'غير موجود' });
    if (!canMutateTodo(scope, existing)) return res.status(403).json({ error: 'صلاحية غير كافية' });

    const b = req.body || {};
    // Normalize range if both ends are being updated. We do it BEFORE the
    // loop so the swap shows up in the SET clause.
    if ('due_date' in b || 'due_date_end' in b) {
      const newStart = ('due_date'     in b) ? (b.due_date     || null) : existing.due_date;
      let   newEnd   = ('due_date_end' in b) ? (b.due_date_end || null) : existing.due_date_end;
      if (newStart && newEnd && newEnd < newStart) {
        // Swap so start <= end
        b.due_date = newEnd;
        b.due_date_end = newStart;
      }
      // Collapse equal pair to single-day
      const finalStart = b.due_date ?? newStart;
      const finalEnd   = b.due_date_end ?? newEnd;
      if (finalStart && finalEnd && finalStart === finalEnd) b.due_date_end = null;
    }
    const fields = [];
    const params = [];
    const allowed = ['title', 'description', 'status', 'priority', 'due_date', 'due_date_end', 'due_time',
                     'assigned_to', 'department', 'management', 'related_remark_id',
                     'tags', 'is_recurring', 'recurrence_pattern',
                     'recurrence_start_date', 'recurrence_end_date', 'target_scope',
                     'parent_todo_id'];

    // Permission cascade:
    //   1. Non-creators (assignees + their leaders) can ONLY update `status`.
    //      Content fields are owned by whoever created the task.
    //   2. Creators (and super-admins) get the full allowed list, with the
    //      legacy agent restriction that agents still can't reassign tasks.
    let safeAllowed;
    if (!canEditTodoContent(scope, existing)) {
      safeAllowed = ['status'];
    } else if (scope.role === 'agent') {
      safeAllowed = allowed.filter(f => f !== 'assigned_to' && f !== 'department' && f !== 'management');
    } else {
      safeAllowed = allowed;
    }

    for (const k of safeAllowed) {
      if (k in b) {
        fields.push(`${k} = ?`);
        let v = b[k];
        if (k === 'is_recurring') v = v ? 1 : 0;
        params.push(v ?? null);
      }
    }
    if (fields.length === 0) return res.status(400).json({ error: 'لا يوجد تعديل' });

    // Auto-set completed_at when status flips to completed
    if (b.status === 'completed' && existing.status !== 'completed') {
      fields.push(`completed_at = datetime('now', '+2 hours')`);
    } else if (b.status && b.status !== 'completed' && existing.status === 'completed') {
      fields.push(`completed_at = NULL`);
    }

    fields.push(`updated_at = datetime('now', '+2 hours')`);

    db.prepare(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`).run(...params, req.params.id);
    const todo = db.prepare(`SELECT * FROM todos WHERE id = ?`).get(req.params.id);

    // If a recurring template's SCHEDULE/SCOPE changed, drop its FUTURE
    // still-untouched ('new') instances (due_date > today) and regenerate the
    // upcoming window — so the edit takes effect going forward WITHOUT touching
    // any instance the employee already started or completed.
    const recurrenceFields = ['is_recurring', 'recurrence_pattern', 'target_scope',
      'department', 'assigned_to', 'recurrence_start_date', 'recurrence_end_date', 'due_time'];
    if (todo.is_recurring === 1 && todo.parent_todo_id == null
        && canEditTodoContent(scope, existing)
        && recurrenceFields.some(f => f in b)) {
      try {
        const today = dailyTodos.todayCairo();
        db.prepare(`DELETE FROM todos WHERE parent_todo_id = ? AND status = 'new' AND due_date > ?`)
          .run(todo.id, today);
        dailyTodos.generateWindowForTemplate(todo);
      } catch (e) { console.error('[todos] window regen (edit):', e.message); }
    }
    return res.json({ todo });
  } catch (err) {
    console.error('[todos] update error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/todos/:id
// Only the creator or super-admin can delete a todo. Assignees who try to
// remove a task they didn't create get a 403 — they should mark it complete
// or talk to whoever assigned it instead.
router.delete('/:id', (req, res) => {
  try {
    const scope = userScope(req);
    const existing = db.prepare(`SELECT * FROM todos WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'غير موجود' });
    if (!canDeleteTodo(scope, existing)) {
      return res.status(403).json({ error: 'فقط منشئ المهمة يمكنه حذفها' });
    }
    db.prepare(`DELETE FROM todos WHERE id = ?`).run(req.params.id);
    return res.json({ deleted: true });
  } catch (err) {
    console.error('[todos] delete error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/todos/bulk-templates — Admin tool: apply a workflow (list of
// recurring templates) to a list of users. Idempotent — skips templates
// where a user already has a template with the same title.
router.post('/bulk-templates', express.json(), (req, res) => {
  const scope = userScope(req);
  if (scope.role !== 'admin') {
    return res.status(403).json({ error: 'صلاحية للأدمن فقط' });
  }

  const templates = Array.isArray(req.body?.templates) ? req.body.templates : [];
  const userIds   = Array.isArray(req.body?.user_ids)  ? req.body.user_ids  : [];
  if (templates.length === 0) return res.status(400).json({ error: 'يجب تحديد القوالب' });
  if (userIds.length === 0)   return res.status(400).json({ error: 'يجب تحديد المستخدمين' });

  const getUser = db.prepare(
    `SELECT id, line, department, management FROM users WHERE id = ? AND is_active = 1`
  );
  // Match an existing template for this user by title (the workflow's stable
  // key). We UPSERT: found → update its schedule; not found → insert.
  const findExisting = db.prepare(`
    SELECT id FROM todos
     WHERE assigned_to = ? AND is_recurring = 1 AND parent_todo_id IS NULL
       AND LOWER(TRIM(title)) = LOWER(TRIM(?))
     LIMIT 1
  `);
  const insertTemplate = db.prepare(`
    INSERT INTO todos
      (title, description, status, priority, due_date, due_time,
       created_by, assigned_to, department, management,
       is_recurring, recurrence_pattern, line)
    VALUES (?,?,'new',?,NULL,?,?,?,?,?,1,?,?)
  `);
  // Applying the workflow is the source of truth → update the existing
  // template's schedule (time/description/priority/recurrence) to match.
  const updateTemplate = db.prepare(`
    UPDATE todos SET description = ?, priority = ?, due_time = ?,
      recurrence_pattern = ?, updated_at = datetime('now', '+2 hours')
     WHERE id = ?
  `);

  // replace mode (default ON — the applied workflow is the ONLY daily schedule):
  // after upserting, any OTHER active recurring template a selected user has
  // (old titles, Arabic-digit variants, duplicates) is CANCELLED — not deleted,
  // so completed/started history survives (parent_todo_id is ON DELETE CASCADE,
  // deleting would wipe the performance history) — and its still-'new' upcoming
  // instances are removed. Pass replace:false to only add/update.
  const replaceMode = req.body?.replace !== false;

  let created = 0, updated = 0;
  const details = [];
  const createdIds = [];
  const updatedIds = [];
  const keptByUser = new Map();   // uid → Set(template ids that ARE the schedule)

  for (const uid of userIds) {
    const u = getUser.get(uid);
    if (!u) { details.push({ user_id: uid, status: 'user_not_found' }); continue; }

    const kept = new Set();
    keptByUser.set(uid, kept);
    let userCreated = 0, userUpdated = 0;
    for (const t of templates) {
      const title = String(t.title || '').trim();
      if (!title) continue;
      const desc = t.description || null;
      const prio = t.priority || 'normal';
      const time = t.due_time || null;
      const pat  = t.recurrence_pattern || 'daily';
      try {
        const ex = findExisting.get(uid, title);
        if (ex) {
          updateTemplate.run(desc, prio, time, pat, ex.id);
          updatedIds.push(ex.id);
          kept.add(ex.id);
          updated++; userUpdated++;
        } else {
          const ins = insertTemplate.run(
            title, desc, prio, time, scope.id, uid,
            u.department || null, u.management || null, pat, u.line || 'Ahmed Hassan',
          );
          createdIds.push(ins.lastInsertRowid);
          kept.add(ins.lastInsertRowid);
          created++; userCreated++;
        }
      } catch (e) {
        details.push({ user_id: uid, task: title, error: e.message });
      }
    }
    details.push({ user_id: uid, created: userCreated, updated: userUpdated });
  }

  const today = dailyTodos.todayCairo();
  const delFuture = db.prepare(
    `DELETE FROM todos WHERE parent_todo_id = ? AND status = 'new' AND due_date >= ?`
  );

  // ── Replace mode: cancel every other active template of the selected users ──
  // Covers stale titles from before the upsert fix, Arabic/English digit
  // variants ("جولة ٢" vs "جولة 2"), and duplicate same-title templates (the
  // upsert updates only one — the rest land here). Cancelled templates stop
  // generating (the generator skips status='cancelled') but keep history.
  let cancelled = 0;
  if (replaceMode) {
    try {
      const listUserTemplates = db.prepare(`
        SELECT id FROM todos
         WHERE assigned_to = ? AND is_recurring = 1 AND parent_todo_id IS NULL
           AND status NOT IN ('cancelled')
      `);
      const cancelTemplate = db.prepare(
        `UPDATE todos SET status = 'cancelled', updated_at = datetime('now', '+2 hours') WHERE id = ?`
      );
      for (const [uid, kept] of keptByUser) {
        for (const row of listUserTemplates.all(uid)) {
          if (kept.has(row.id)) continue;
          cancelTemplate.run(row.id);
          delFuture.run(row.id, today);
          cancelled++;
        }
      }
    } catch (e) { console.error('[todos] bulk-templates replace:', e.message); }
  }

  // Materialize the change on the employees' lists IMMEDIATELY (not only after
  // the nightly cron):
  //   • created  → generate the upcoming window.
  //   • updated  → drop still-untouched ('new') instances from TODAY forward
  //                and regenerate them with the new schedule, WITHOUT touching
  //                any instance the employee already started/finished.
  let instances_created = 0;
  try {
    const getT = db.prepare(`SELECT * FROM todos WHERE id = ?`);
    for (const tid of createdIds) {
      instances_created += dailyTodos.generateWindowForTemplate(getT.get(tid)).created;
    }
    for (const tid of updatedIds) {
      delFuture.run(tid, today);
      instances_created += dailyTodos.generateWindowForTemplate(getT.get(tid)).created;
    }
  } catch (e) { console.error('[todos] bulk-templates window gen:', e.message); }

  return res.json({
    message: `تم إنشاء ${created} قالب وتحديث ${updated}${cancelled ? ` وإلغاء ${cancelled} قديم` : ''}`,
    created, updated, cancelled,
    instances_created,
    total_users: userIds.length,
    total_templates: templates.length,
    details,
  });
});

// POST /api/todos/templates/cancel — retire specific recurring templates.
// Surgical counterpart to the workflow's replace mode: cancels ONLY the ids
// given, so stale/duplicate templates can be cleaned without touching tasks
// other managers assigned to their own people.
//
// Cancels (status='cancelled') rather than deletes — todos.parent_todo_id is
// ON DELETE CASCADE, so deleting a template would wipe every completed instance
// under it and destroy the performance history. Cancelled templates stop
// generating (the generator filters them out) and disappear from the boards.
// Their still-'new' upcoming instances are removed; started/finished ones stay.
//
// Body: { ids: [templateId, ...] }
router.post('/templates/cancel', express.json(), (req, res) => {
  try {
    const scope = userScope(req);
    if (scope.role !== 'admin' && scope.role !== 'leader') {
      return res.status(403).json({ error: 'صلاحية للقادة والمدراء فقط' });
    }
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map(n => parseInt(n, 10)).filter(Number.isFinite)
      : [];
    if (ids.length === 0) return res.status(400).json({ error: 'يجب تحديد القوالب' });

    const getOne = db.prepare(`SELECT * FROM todos WHERE id = ?`);
    const cancel = db.prepare(
      `UPDATE todos SET status = 'cancelled', updated_at = datetime('now', '+2 hours') WHERE id = ?`
    );
    const delFuture = db.prepare(
      `DELETE FROM todos WHERE parent_todo_id = ? AND status = 'new' AND due_date >= ?`
    );
    const today = dailyTodos.todayCairo();

    let cancelled = 0, instances_removed = 0, skipped = 0;
    const errors = [];
    for (const id of ids) {
      const t = getOne.get(id);
      if (!t || t.is_recurring !== 1 || t.parent_todo_id != null) { skipped++; continue; }
      if (!canMutateTodo(scope, t)) { skipped++; errors.push({ id, error: 'صلاحية غير كافية' }); continue; }
      if (t.status === 'cancelled') { skipped++; continue; }
      cancel.run(id);
      instances_removed += delFuture.run(id, today).changes;
      cancelled++;
    }
    return res.json({ ok: true, cancelled, instances_removed, skipped, errors });
  } catch (err) {
    console.error('[todos] templates/cancel error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/todos/:id/comments — add comment
router.post('/:id/comments', express.json(), (req, res) => {
  try {
    const scope = userScope(req);
    const existing = db.prepare(`SELECT * FROM todos WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'غير موجود' });
    if (!canViewTodo(scope, existing)) return res.status(403).json({ error: 'صلاحية غير كافية' });
    const text = String(req.body?.comment || '').trim();
    if (!text) return res.status(400).json({ error: 'التعليق فارغ' });
    const result = db.prepare(
      `INSERT INTO todo_comments (todo_id, user_id, comment) VALUES (?,?,?)`
    ).run(req.params.id, scope.id, text);
    const comment = db.prepare(`
      SELECT c.*, u.full_name AS user_name
      FROM todo_comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.id = ?
    `).get(result.lastInsertRowid);
    return res.status(201).json({ comment });
  } catch (err) {
    console.error('[todos] comment error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/todos/admin/generate-daily ────────────────────────────────────
// Manual trigger for the daily-instances generator. The cron runs this
// automatically at 00:30 Cairo every night — this endpoint is a one-click
// "fire it now" for testing or for when an admin wants to force generation
// outside the schedule (e.g. after adding a new template late in the day).
//
// Super-admin only. Returns counts of templates matched / instances created.
router.post('/admin/generate-daily', (req, res) => {
  try {
    const scope = userScope(req);
    if (scope.role !== 'admin' || scope.management !== 'All') {
      return res.status(403).json({ error: 'صلاحية للأدمن العام فقط' });
    }
    const dailyTodosService = require('../services/daily-todos.service');
    // Fire the whole upcoming window now (this week + next), not just today.
    const r = dailyTodosService.generateUpcomingInstances();
    return res.json({ ok: true, ...r });
  } catch (err) {
    console.error('[todos] generate-daily error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/todos/admin/cleanup-test-data ─────────────────────────────────
// One-shot cleanup for clearing trial/test data before going live. The actor
// chooses which buckets to wipe; recurring TEMPLATES are kept by default so
// the daily generator keeps producing instances tomorrow without re-setup.
//
// SAFETY:
//   1. Restricted to super-admin (role='admin' AND management='All').
//   2. Body must include  confirm: 'DELETE_TEST_DATA'  — guards against
//      accidental triggers from misconfigured clients.
//   3. ALWAYS snapshots the affected rows + their comments to a JSON file
//      on the persistent volume (next to the DB). Restore is a single
//      INSERT-from-JSON away if anything important was hit.
//
// Body:
//   {
//     confirm: 'DELETE_TEST_DATA',     // required
//     delete_instances: boolean,        // default true  — daily workflow instances
//     delete_extras:    boolean,        // default true  — one-off manual tasks
//     delete_templates: boolean,        // default false — the recurring templates
//   }
router.post('/admin/cleanup-test-data', express.json(), (req, res) => {
  try {
    const scope = userScope(req);
    if (scope.role !== 'admin' || scope.management !== 'All') {
      return res.status(403).json({
        error: 'الصلاحية مقصورة على مدير النظام (Super Admin) فقط',
      });
    }
    if ((req.body || {}).confirm !== 'DELETE_TEST_DATA') {
      return res.status(400).json({
        error: 'يجب إرسال confirm = "DELETE_TEST_DATA" في الـ body للتأكيد',
      });
    }
    const deleteInstances = req.body.delete_instances !== false;  // default true
    const deleteExtras    = req.body.delete_extras    !== false;  // default true
    const deleteTemplates = req.body.delete_templates === true;   // default false

    // ── 1. Snapshot to JSON (atomic write to .tmp then rename) ─────────────
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/academy.db');
    const backupDir = path.dirname(dbPath);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `todos_cleanup_backup_${ts}.json`;
    const backupPath = path.join(backupDir, backupName);

    let backupOK = false;
    let backupError = null;
    try {
      const allTodos = db.prepare(`SELECT * FROM todos`).all();
      const allComments = db.prepare(`SELECT * FROM todo_comments`).all();
      const snapshot = {
        version: 1,
        snapshot_at: new Date().toISOString(),
        actor: { id: scope.id, name: scope.fullName },
        flags: { deleteInstances, deleteExtras, deleteTemplates },
        counts_before: {
          todos: allTodos.length,
          comments: allComments.length,
        },
        todos: allTodos,
        comments: allComments,
      };
      const tmp = backupPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
      fs.renameSync(tmp, backupPath);
      backupOK = true;
    } catch (e) {
      backupError = e.message;
      console.error('[cleanup] snapshot failed:', e.message);
    }

    // If we can't snapshot, bail rather than delete blindly.
    if (!backupOK) {
      return res.status(500).json({
        error: 'فشل إنشاء النسخة الاحتياطية، لم يتم حذف أي شيء',
        details: backupError,
      });
    }

    // ── 2. Delete per the flags ────────────────────────────────────────────
    const counts = { daily_instances: 0, extra_tasks: 0, templates: 0 };
    // Order matters: kill instances first so the parent template can be
    // safely dropped (FK CASCADE handles it anyway, but explicit is clearer).
    if (deleteInstances) {
      counts.daily_instances = db.prepare(
        `DELETE FROM todos WHERE parent_todo_id IS NOT NULL`
      ).run().changes;
    }
    if (deleteExtras) {
      counts.extra_tasks = db.prepare(
        `DELETE FROM todos WHERE is_recurring = 0 AND parent_todo_id IS NULL`
      ).run().changes;
    }
    if (deleteTemplates) {
      counts.templates = db.prepare(
        `DELETE FROM todos WHERE is_recurring = 1 AND parent_todo_id IS NULL`
      ).run().changes;
    }
    const totalDeleted = counts.daily_instances + counts.extra_tasks + counts.templates;

    // Orphan comments (FK ON DELETE CASCADE should clear them automatically,
    // but be defensive in case the constraint was stripped in an older schema).
    const orphanCommentCleanup = db.prepare(
      `DELETE FROM todo_comments
        WHERE todo_id NOT IN (SELECT id FROM todos)`
    ).run().changes;

    // ── 3. Final remaining rows for the response ───────────────────────────
    const remaining = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN is_recurring = 1 AND parent_todo_id IS NULL THEN 1 ELSE 0 END) AS templates,
        SUM(CASE WHEN parent_todo_id IS NOT NULL THEN 1 ELSE 0 END) AS instances,
        SUM(CASE WHEN is_recurring = 0 AND parent_todo_id IS NULL THEN 1 ELSE 0 END) AS extras
      FROM todos
    `).get();

    return res.json({
      ok: true,
      total_deleted: totalDeleted,
      deleted: counts,
      orphan_comments_cleaned: orphanCommentCleanup,
      backup_file: backupName,
      backup_dir: backupDir,
      remaining,
    });
  } catch (err) {
    console.error('[todos] cleanup error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
