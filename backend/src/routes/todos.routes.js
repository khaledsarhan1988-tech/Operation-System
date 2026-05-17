'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

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

// Build a WHERE clause for list queries, respecting role.
function buildListWhere(scope, query) {
  const wheres = ['t.line = ?'];
  const params = [scope.line === 'All' ? 'Ahmed Hassan' : scope.line];

  if (scope.role === 'admin') {
    if (scope.management !== 'All') {
      wheres.push('(t.management = ? OR t.management = "All" OR t.management IS NULL)');
      params.push(scope.management);
    }
  } else if (scope.role === 'leader') {
    wheres.push('(t.assigned_to = ? OR t.created_by = ? OR t.department = ? OR t.management = ?)');
    params.push(scope.id, scope.id, scope.department, scope.management);
  } else {
    wheres.push('(t.assigned_to = ? OR t.created_by = ?)');
    params.push(scope.id, scope.id);
  }

  // Filters
  if (query.status)      { wheres.push('t.status = ?');      params.push(query.status); }
  if (query.priority)    { wheres.push('t.priority = ?');    params.push(query.priority); }
  if (query.assigned_to) { wheres.push('t.assigned_to = ?'); params.push(query.assigned_to); }
  if (query.due_date)    { wheres.push('t.due_date = ?');    params.push(query.due_date); }
  if (query.search) {
    wheres.push('(t.title LIKE ? OR t.description LIKE ? OR t.tags LIKE ?)');
    const s = `%${query.search}%`;
    params.push(s, s, s);
  }
  if (query.bucket) {
    // Temporal buckets used by My-Day UI
    const today = todayCairo();
    const tomorrow = addDaysCairo(1);
    const weekEnd = addDaysCairo(7);
    switch (query.bucket) {
      case 'overdue':
        wheres.push("(t.status NOT IN ('completed','cancelled') AND t.due_date IS NOT NULL AND t.due_date < ?)");
        params.push(today);
        break;
      case 'today':
        wheres.push("(t.status NOT IN ('completed','cancelled') AND t.due_date = ?)");
        params.push(today);
        break;
      case 'tomorrow':
        wheres.push("(t.status NOT IN ('completed','cancelled') AND t.due_date = ?)");
        params.push(tomorrow);
        break;
      case 'this_week':
        wheres.push("(t.status NOT IN ('completed','cancelled') AND t.due_date BETWEEN ? AND ?)");
        params.push(today, weekEnd);
        break;
      case 'later':
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
  const r = db.prepare("SELECT DATE('now', '+2 hours', ?) AS d").get(`+${n} days`);
  return r?.d || null;
}

// ─── Recurring instance generator ─────────────────────────────────────────────
// For each recurring "template" todo, ensure that today's instance exists.
// Templates are: is_recurring=1 AND parent_todo_id IS NULL.
// Instances are: parent_todo_id = template.id, due_date = today.
// Patterns supported:
//   • 'daily'                                  → every day
//   • 'weekly:sat,sun,mon,tue,wed,thu,fri'     → specific weekdays
//   • 'monthly:15'                             → 15th of every month
function recurrenceMatchesToday(pattern, today) {
  if (!pattern) return false;
  if (pattern === 'daily') return true;
  if (pattern.startsWith('weekly:')) {
    const days = pattern.slice(7).toLowerCase().split(',').map(s => s.trim());
    const dayOfWeek = new Date(today + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    return days.some(d => d.startsWith(dayOfWeek));
  }
  if (pattern.startsWith('monthly:')) {
    const day = parseInt(pattern.slice(8), 10);
    const todayDay = parseInt(today.split('-')[2], 10);
    return day === todayDay;
  }
  return false;
}

function ensureTodayRecurringInstances(scope) {
  try {
    const today = todayCairo();
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
      templates = db.prepare(`
        SELECT * FROM todos
        WHERE is_recurring = 1 AND parent_todo_id IS NULL
          AND status NOT IN ('cancelled') AND line = ?
          AND (assigned_to = ? OR created_by = ? OR department = ? OR management = ?)
      `).all(lineParam, scope.id, scope.id, scope.department, scope.management);
    } else {
      templates = db.prepare(`
        SELECT * FROM todos
        WHERE is_recurring = 1 AND parent_todo_id IS NULL
          AND status NOT IN ('cancelled') AND line = ?
          AND (assigned_to = ? OR created_by = ?)
      `).all(lineParam, scope.id, scope.id);
    }

    const insertInstance = db.prepare(`
      INSERT INTO todos
        (title, description, status, priority, due_date, due_time,
         created_by, assigned_to, department, management,
         related_remark_id, tags, parent_todo_id, line)
      VALUES (?,?,'new',?,?,?,?,?,?,?,?,?,?,?)
    `);

    for (const tmpl of templates) {
      if (!recurrenceMatchesToday(tmpl.recurrence_pattern, today)) continue;

      // Skip if today's instance already exists
      const existing = db.prepare(
        `SELECT id FROM todos WHERE parent_todo_id = ? AND due_date = ? LIMIT 1`
      ).get(tmpl.id, today);
      if (existing) continue;

      insertInstance.run(
        tmpl.title, tmpl.description, tmpl.priority,
        today, tmpl.due_time,
        tmpl.created_by, tmpl.assigned_to, tmpl.department, tmpl.management,
        tmpl.related_remark_id, tmpl.tags, tmpl.id, tmpl.line
      );
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
    const templateClause = includeTemplates
      ? ''
      : ` AND NOT (t.is_recurring = 1 AND t.parent_todo_id IS NULL)`;
    const sort = (req.query.sort || 'smart').toString();
    let orderBy;
    switch (sort) {
      case 'created_desc': orderBy = 't.created_at DESC'; break;
      case 'due_asc':      orderBy = 't.due_date IS NULL, t.due_date ASC, t.priority_rank ASC'; break;
      case 'priority':     orderBy = 't.priority_rank ASC, t.due_date IS NULL, t.due_date ASC'; break;
      case 'smart':
      default:
        // smart = pending first, then by due_date, then by priority
        orderBy = `
          CASE t.status WHEN 'in_progress' THEN 0 WHEN 'new' THEN 1 WHEN 'on_hold' THEN 2
                       WHEN 'completed' THEN 3 ELSE 4 END,
          t.due_date IS NULL, t.due_date ASC,
          t.priority_rank ASC,
          t.created_at DESC
        `;
        break;
    }

    const rows = db.prepare(`
      SELECT t.*,
        CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END AS priority_rank,
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

    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN t.status='new'         THEN 1 ELSE 0 END) AS new_count,
        SUM(CASE WHEN t.status='in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
        SUM(CASE WHEN t.status='on_hold'     THEN 1 ELSE 0 END) AS on_hold_count,
        SUM(CASE WHEN t.status='completed'   THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN t.status NOT IN ('completed','cancelled')
                  AND t.due_date IS NOT NULL AND t.due_date < ? THEN 1 ELSE 0 END) AS overdue_count,
        SUM(CASE WHEN t.due_date = ? AND t.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS due_today_count,
        SUM(CASE WHEN t.priority='urgent' AND t.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS urgent_open
      FROM todos t
      WHERE ${where}
        AND NOT (t.is_recurring = 1 AND t.parent_todo_id IS NULL)
    `).get(today, today, ...params);

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
        u_created.full_name  AS created_by_name,
        (SELECT COUNT(*) FROM todos c WHERE c.parent_todo_id = t.id) AS instances_count,
        (SELECT COUNT(*) FROM todos c WHERE c.parent_todo_id = t.id AND c.status='completed') AS completed_count
      FROM todos t
      LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
      LEFT JOIN users u_created  ON u_created.id  = t.created_by
      WHERE ${where} AND t.is_recurring = 1 AND t.parent_todo_id IS NULL
      ORDER BY t.created_at DESC
    `).all(...params);
    return res.json({ templates: rows });
  } catch (err) {
    console.error('[todos] templates error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/todos/team-summary — per-assignee aggregate (for leader/admin)
router.get('/team-summary', (req, res) => {
  try {
    const scope = userScope(req);
    if (scope.role !== 'admin' && scope.role !== 'leader') {
      return res.status(403).json({ error: 'صلاحية للقادة والمدراء فقط' });
    }
    const { where, params } = buildListWhere(scope, {});
    const today = todayCairo();
    const rows = db.prepare(`
      SELECT
        t.assigned_to,
        u.full_name AS assigned_to_name,
        COUNT(*) AS total,
        SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN t.status NOT IN ('completed','cancelled')
                  AND t.due_date IS NOT NULL AND t.due_date < ? THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN t.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN t.priority='urgent' AND t.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS urgent_open
      FROM todos t
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE ${where} AND t.assigned_to IS NOT NULL
      GROUP BY t.assigned_to
      ORDER BY open_count DESC, urgent_open DESC
    `).all(today, ...params);
    return res.json({ rows });
  } catch (err) {
    console.error('[todos] team-summary error:', err);
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
      rows = db.prepare(
        `SELECT id, full_name, role, department, management FROM users
          WHERE is_active = 1 AND (department = ? OR id = ?) AND management = ?
          ORDER BY full_name COLLATE NOCASE`
      ).all(scope.department, scope.id, scope.management);
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
    const todo = db.prepare(`
      SELECT t.*,
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

    const result = db.prepare(`
      INSERT INTO todos
        (title, description, status, priority, due_date, due_time,
         created_by, assigned_to, department, management,
         related_remark_id, tags, is_recurring, recurrence_pattern,
         parent_todo_id, line)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      String(b.title).trim(),
      b.description || null,
      b.status || 'new',
      b.priority || 'normal',
      b.due_date || null,
      b.due_time || null,
      scope.id,
      assignedTo,
      b.department || scope.department || null,
      b.management || scope.management || null,
      b.related_remark_id || null,
      b.tags || null,
      b.is_recurring ? 1 : 0,
      b.recurrence_pattern || null,
      b.parent_todo_id || null,
      scope.line === 'All' ? 'Ahmed Hassan' : scope.line,
    );

    const todo = db.prepare(`SELECT * FROM todos WHERE id = ?`).get(result.lastInsertRowid);
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
    const fields = [];
    const params = [];
    const allowed = ['title', 'description', 'status', 'priority', 'due_date', 'due_time',
                     'assigned_to', 'department', 'management', 'related_remark_id',
                     'tags', 'is_recurring', 'recurrence_pattern', 'parent_todo_id'];

    // Agents can't reassign
    const safeAllowed = scope.role === 'agent'
      ? allowed.filter(f => f !== 'assigned_to' && f !== 'department' && f !== 'management')
      : allowed;

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
    return res.json({ todo });
  } catch (err) {
    console.error('[todos] update error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/todos/:id
router.delete('/:id', (req, res) => {
  try {
    const scope = userScope(req);
    const existing = db.prepare(`SELECT * FROM todos WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'غير موجود' });
    if (!canMutateTodo(scope, existing)) return res.status(403).json({ error: 'صلاحية غير كافية' });
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
  const checkExisting = db.prepare(`
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

  let created = 0, skipped = 0;
  const details = [];

  for (const uid of userIds) {
    const u = getUser.get(uid);
    if (!u) { details.push({ user_id: uid, status: 'user_not_found' }); continue; }

    let userCreated = 0, userSkipped = 0;
    for (const t of templates) {
      const title = String(t.title || '').trim();
      if (!title) continue;
      if (checkExisting.get(uid, title)) { skipped++; userSkipped++; continue; }
      try {
        insertTemplate.run(
          title,
          t.description || null,
          t.priority || 'normal',
          t.due_time || null,
          scope.id,
          uid,
          u.department || null,
          u.management || null,
          t.recurrence_pattern || 'daily',
          u.line || 'Ahmed Hassan',
        );
        created++; userCreated++;
      } catch (e) {
        details.push({ user_id: uid, task: title, error: e.message });
      }
    }
    details.push({ user_id: uid, created: userCreated, skipped: userSkipped });
  }

  return res.json({
    message: `تم إنشاء ${created} قالب، تخطي ${skipped} مكرّر`,
    created, skipped,
    total_users: userIds.length,
    total_templates: templates.length,
    details,
  });
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

module.exports = router;
