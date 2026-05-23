'use strict';
/**
 * Custom Goals — extra goals beyond the 4 standard KPIs.
 * Created by agent OR leader; evaluated by the leader (final).
 *
 *   GET    /api/custom-goals/mine              — agent's own goals
 *   POST   /api/custom-goals/mine              — agent creates own goal
 *   PUT    /api/custom-goals/mine/:id          — agent edits (only if pending)
 *   DELETE /api/custom-goals/mine/:id          — agent deletes (only if pending)
 *
 *   GET    /api/custom-goals/team              — leader: all goals for their team
 *   POST   /api/custom-goals/team              — leader creates goal for one of their agents
 *   PUT    /api/custom-goals/team/:id          — leader edits (any time, but agent loses edit)
 *   DELETE /api/custom-goals/team/:id          — leader deletes
 *   PUT    /api/custom-goals/team/:id/evaluate — leader sets result + reason + strengths + weaknesses
 */
const express = require('express');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { resolveLeaderDepts } = require('../utils/leader-scope');

const router = express.Router();
router.use(authenticate);

const VALID_UNITS = ['%','عميل','تاسك','جلسة','نقطة','مجموعة','custom'];
const VALID_STATUSES = ['pending','achieved','partially','not_achieved'];
const MONTH_NAMES_AR = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function notify(userId, type, title, body, link, meta) {
  if (!userId) return;
  try {
    db.prepare(`INSERT INTO notifications (user_id, type, title, body, link, meta)
                VALUES (?, ?, ?, ?, ?, ?)`).run(
      userId, type, title, body || null, link || null,
      meta ? (typeof meta === 'string' ? meta : JSON.stringify(meta)) : null
    );
  } catch (e) { console.error('notify error:', e.message); }
}

// Validate the agent payload (used by both agent + leader create)
function validateGoalPayload(body) {
  const title = (body?.title || '').toString().trim();
  if (!title || title.length < 2) return { error: 'العنوان مطلوب (حرفين على الأقل)' };
  if (title.length > 120) return { error: 'العنوان طويل (الحد الأقصى 120 حرف)' };
  const description = body?.description ? body.description.toString().slice(0, 500) : null;
  const target_value = body?.target_value != null && body?.target_value !== ''
    ? parseInt(body.target_value, 10) : null;
  if (target_value != null && (!Number.isFinite(target_value) || target_value < 0 || target_value > 100000)) {
    return { error: 'القيمة المستهدفة غير صحيحة' };
  }
  let unit = body?.unit && VALID_UNITS.includes(body.unit) ? body.unit : '%';
  let unit_custom = null;
  if (unit === 'custom') {
    unit_custom = (body?.unit_custom || '').toString().trim().slice(0, 30);
    if (!unit_custom) return { error: 'يرجى إدخال وحدة مخصصة' };
  }
  const year  = body?.year  ? parseInt(body.year, 10)  : null;
  const month = body?.month ? parseInt(body.month, 10) : null;
  if (year && (year < 2020 || year > 2099))  return { error: 'السنة غير صحيحة' };
  if (month && (month < 1 || month > 12))    return { error: 'الشهر غير صحيح' };

  return { title, description, target_value, unit, unit_custom, year, month };
}

// Helper: load a goal with the user's department + name
function getGoalWithUser(id) {
  return db.prepare(`
    SELECT g.*, u.full_name AS agent_name, u.department AS agent_department,
           u.line AS agent_line, u.role AS agent_role,
           e.full_name AS evaluator_name
    FROM custom_goals g
    LEFT JOIN users u ON u.id = g.user_id
    LEFT JOIN users e ON e.id = g.evaluated_by
    WHERE g.id = ?
  `).get(id);
}

// ─── AGENT ENDPOINTS ──────────────────────────────────────────────────────────

// GET /api/custom-goals/mine
router.get('/mine', (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

  const rows = db.prepare(`
    SELECT g.*, e.full_name AS evaluator_name
    FROM custom_goals g
    LEFT JOIN users e ON e.id = g.evaluated_by
    WHERE g.user_id = ?
    ORDER BY
      CASE g.result_status WHEN 'pending' THEN 0 ELSE 1 END,
      g.id DESC
  `).all(userId);
  return res.json(rows);
});

// POST /api/custom-goals/mine
router.post('/mine', (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

  const v = validateGoalPayload(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  const r = db.prepare(`
    INSERT INTO custom_goals (user_id, created_by, title, description,
                              target_value, unit, unit_custom, year, month)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, userId, v.title, v.description, v.target_value, v.unit, v.unit_custom, v.year, v.month);
  saveNow();
  return res.json({ id: r.lastInsertRowid });
});

// PUT /api/custom-goals/mine/:id (only when status=pending)
router.put('/mine/:id', (req, res) => {
  const userId = req.user?.id;
  const id = parseInt(req.params.id, 10);
  if (!userId || !id) return res.status(400).json({ error: 'Invalid' });

  const goal = db.prepare(`SELECT * FROM custom_goals WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  if (goal.result_status !== 'pending') {
    return res.status(409).json({ error: 'لا يمكن التعديل بعد تقييم القائد' });
  }

  const v = validateGoalPayload(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  db.prepare(`
    UPDATE custom_goals SET
      title = ?, description = ?, target_value = ?, unit = ?, unit_custom = ?,
      year = ?, month = ?, updated_at = datetime('now', '+2 hours')
    WHERE id = ?
  `).run(v.title, v.description, v.target_value, v.unit, v.unit_custom, v.year, v.month, id);
  saveNow();
  return res.json({ id });
});

// DELETE /api/custom-goals/mine/:id (only when status=pending)
router.delete('/mine/:id', (req, res) => {
  const userId = req.user?.id;
  const id = parseInt(req.params.id, 10);
  if (!userId || !id) return res.status(400).json({ error: 'Invalid' });
  const goal = db.prepare(`SELECT result_status FROM custom_goals WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  if (goal.result_status !== 'pending') {
    return res.status(409).json({ error: 'لا يمكن حذف هدف تم تقييمه' });
  }
  db.prepare(`DELETE FROM custom_goals WHERE id = ?`).run(id);
  saveNow();
  return res.json({ deleted: 1 });
});

// ─── LEADER ENDPOINTS ─────────────────────────────────────────────────────────

function isLeader(req) {
  return req.user?.role === 'leader' || req.user?.role === 'admin';
}

// Returns the leader's overseen departments as a normalized lowercase array,
// or null when no filter should apply (admin). Supports multi-section leaders
// via users.extra_departments.
function leaderDeptFilter(req) {
  if (req.user?.role === 'admin') return null;
  const { listDepts } = resolveLeaderDepts(db, req.user?.id);
  const list = (listDepts.length ? listDepts : [req.user?.department])
    .filter(Boolean)
    .map(d => String(d).toLowerCase().trim());
  return list.length ? list : null;
}

// Build "LOWER(TRIM(col)) IN (?,?,...)" + params from a depts array. Returns
// `null` if there's no filter (admin) — caller should skip the clause entirely.
function deptInClause(column, depts) {
  if (!depts || depts.length === 0) return null;
  return {
    sql: `LOWER(TRIM(${column})) IN (${depts.map(() => '?').join(',')})`,
    params: depts,
  };
}

// GET /api/custom-goals/team?status=&agent=
// Leader sees goals for agents in their department.
// Admin sees everyone's goals.
router.get('/team', (req, res) => {
  if (!isLeader(req)) return res.status(403).json({ error: 'Forbidden' });

  const status = req.query.status;
  const agent  = req.query.agent;
  const deptFilter = leaderDeptFilter(req);

  const params = [];
  // Admin can also see goals assigned to team leaders; a regular leader sees agents only.
  const teamRoleClause = req.user?.role === 'admin'
    ? "u.role IN ('agent','leader')"
    : "u.role = 'agent'";
  const whereParts = [teamRoleClause, 'u.is_active = 1'];
  const inClause = deptInClause('u.department', deptFilter);
  if (inClause) { whereParts.push(inClause.sql); params.push(...inClause.params); }
  if (status && VALID_STATUSES.includes(status)) {
    whereParts.push('g.result_status = ?'); params.push(status);
  }
  if (agent) {
    whereParts.push('LOWER(TRIM(u.full_name)) = LOWER(TRIM(?))'); params.push(agent);
  }

  const rows = db.prepare(`
    SELECT g.*, u.full_name AS agent_name, u.department AS agent_department,
           u.line AS agent_line,
           c.full_name AS created_by_name,
           e.full_name AS evaluator_name
    FROM custom_goals g
    INNER JOIN users u ON u.id = g.user_id
    LEFT JOIN users c ON c.id = g.created_by
    LEFT JOIN users e ON e.id = g.evaluated_by
    WHERE ${whereParts.join(' AND ')}
    ORDER BY
      CASE g.result_status WHEN 'pending' THEN 0 ELSE 1 END,
      g.id DESC
  `).all(...params);

  // Counts by status for the page tabs
  const countsClause = deptInClause('u.department', deptFilter);
  const counts = db.prepare(`
    SELECT g.result_status AS status, COUNT(*) AS c
    FROM custom_goals g
    INNER JOIN users u ON u.id = g.user_id
    WHERE ${teamRoleClause} AND u.is_active = 1
      ${countsClause ? 'AND ' + countsClause.sql : ''}
    GROUP BY g.result_status
  `).all(...(countsClause ? countsClause.params : []));
  const countMap = { pending: 0, achieved: 0, partially: 0, not_achieved: 0 };
  counts.forEach(r => countMap[r.status] = r.c);
  countMap.total = (countMap.pending + countMap.achieved + countMap.partially + countMap.not_achieved);

  return res.json({ rows, counts: countMap });
});

// POST /api/custom-goals/team
// Leader creates a goal for one of their agents.
router.post('/team', (req, res) => {
  if (!isLeader(req)) return res.status(403).json({ error: 'Forbidden' });

  const targetUserId = parseInt(req.body?.user_id, 10);
  if (!targetUserId) return res.status(400).json({ error: 'user_id is required' });

  const target = db.prepare(`SELECT id, department, role FROM users WHERE id = ? AND role IN ('agent','leader') AND is_active = 1`).get(targetUserId);
  if (!target) return res.status(404).json({ error: 'الموظف غير موجود' });

  // Only an admin may assign a goal to a team leader.
  if (target.role === 'leader' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'إسناد هدف لقائد فريق متاح للأدمن فقط' });
  }

  const deptFilter = leaderDeptFilter(req);
  if (deptFilter && !deptFilter.includes(String(target.department || '').toLowerCase().trim())) {
    return res.status(403).json({ error: 'هذا الموظف ليس ضمن فريقك' });
  }

  const v = validateGoalPayload(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  const r = db.prepare(`
    INSERT INTO custom_goals (user_id, created_by, title, description,
                              target_value, unit, unit_custom, year, month)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(targetUserId, req.user.id, v.title, v.description, v.target_value, v.unit, v.unit_custom, v.year, v.month);
  saveNow();

  // Notify the agent
  notify(
    targetUserId,
    'custom',
    `🎯 هدف جديد من القائد: ${v.title}`,
    `قام ${req.user.full_name} بإضافة هدف جديد لك. اطّلع عليه في صفحة "تطوّري".`,
    '/agent/my-progression',
    { goal_id: r.lastInsertRowid }
  );

  return res.json({ id: r.lastInsertRowid });
});

// PUT /api/custom-goals/team/:id (leader edits any field except evaluation)
router.put('/team/:id', (req, res) => {
  if (!isLeader(req)) return res.status(403).json({ error: 'Forbidden' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid' });

  const goal = getGoalWithUser(id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });

  // Goals assigned to a team leader can only be managed by an admin.
  if (goal.agent_role === 'leader' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'إدارة أهداف قادة الفريق متاحة للأدمن فقط' });
  }

  const deptFilter = leaderDeptFilter(req);
  if (deptFilter && !deptFilter.includes(String(goal.agent_department || '').toLowerCase().trim())) {
    return res.status(403).json({ error: 'هذا الموظف ليس ضمن فريقك' });
  }

  const v = validateGoalPayload(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  db.prepare(`
    UPDATE custom_goals SET
      title = ?, description = ?, target_value = ?, unit = ?, unit_custom = ?,
      year = ?, month = ?, updated_at = datetime('now', '+2 hours')
    WHERE id = ?
  `).run(v.title, v.description, v.target_value, v.unit, v.unit_custom, v.year, v.month, id);
  saveNow();
  return res.json({ id });
});

// DELETE /api/custom-goals/team/:id
router.delete('/team/:id', (req, res) => {
  if (!isLeader(req)) return res.status(403).json({ error: 'Forbidden' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid' });

  const goal = getGoalWithUser(id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });

  // Goals assigned to a team leader can only be managed by an admin.
  if (goal.agent_role === 'leader' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'إدارة أهداف قادة الفريق متاحة للأدمن فقط' });
  }

  const deptFilter = leaderDeptFilter(req);
  if (deptFilter && !deptFilter.includes(String(goal.agent_department || '').toLowerCase().trim())) {
    return res.status(403).json({ error: 'هذا الموظف ليس ضمن فريقك' });
  }

  db.prepare(`DELETE FROM custom_goals WHERE id = ?`).run(id);
  saveNow();
  return res.json({ deleted: 1 });
});

// PUT /api/custom-goals/team/:id/evaluate
// Body: { achieved_value, result_status, evaluation_reason, strengths, weaknesses, leader_note }
// FINAL — agent can no longer edit/delete after this.
router.put('/team/:id/evaluate', (req, res) => {
  if (!isLeader(req)) return res.status(403).json({ error: 'Forbidden' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid' });

  const goal = getGoalWithUser(id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });

  // Goals assigned to a team leader can only be evaluated by an admin.
  if (goal.agent_role === 'leader' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'تقييم أهداف قادة الفريق متاح للأدمن فقط' });
  }

  const deptFilter = leaderDeptFilter(req);
  if (deptFilter && !deptFilter.includes(String(goal.agent_department || '').toLowerCase().trim())) {
    return res.status(403).json({ error: 'هذا الموظف ليس ضمن فريقك' });
  }

  const status = (req.body?.result_status || '').toString();
  if (!['achieved','partially','not_achieved'].includes(status)) {
    return res.status(400).json({ error: 'حالة التقييم غير صحيحة' });
  }
  const achieved_value = req.body?.achieved_value != null && req.body?.achieved_value !== ''
    ? parseInt(req.body.achieved_value, 10) : null;
  if (achieved_value != null && (!Number.isFinite(achieved_value) || achieved_value < 0 || achieved_value > 100000)) {
    return res.status(400).json({ error: 'القيمة المُحققة غير صحيحة' });
  }

  const reason     = (req.body?.evaluation_reason || '').toString().trim();
  if (!reason || reason.length < 5) {
    return res.status(400).json({ error: 'سبب التقييم مطلوب (5 أحرف على الأقل)' });
  }
  const strengths  = (req.body?.strengths  || '').toString().slice(0, 1000) || null;
  const weaknesses = (req.body?.weaknesses || '').toString().slice(0, 1000) || null;
  const leader_note = (req.body?.leader_note || '').toString().slice(0, 500) || null;

  db.prepare(`
    UPDATE custom_goals SET
      achieved_value    = ?,
      result_status     = ?,
      evaluation_reason = ?,
      strengths         = ?,
      weaknesses        = ?,
      leader_note       = ?,
      evaluated_by      = ?,
      evaluated_at      = datetime('now', '+2 hours'),
      updated_at        = datetime('now', '+2 hours')
    WHERE id = ?
  `).run(achieved_value, status, reason.slice(0, 1000), strengths, weaknesses, leader_note, req.user.id, id);
  saveNow();

  // Notify the agent
  const statusLabels = { achieved: '✅ تم تحقيقه', partially: '🟡 جزئياً', not_achieved: '❌ لم يتحقق' };
  notify(
    goal.user_id,
    'custom',
    `📋 تم تقييم هدف "${goal.title}"`,
    `${statusLabels[status]} — اطّلع على ملاحظات القائد في صفحة "تطوّري"`,
    '/agent/my-progression',
    { goal_id: id, status, evaluator: req.user.full_name }
  );

  return res.json({ id, result_status: status });
});

// ─── LEADER: list of their team agents (used by the "create goal for agent" modal) ──
router.get('/team-agents', (req, res) => {
  if (!isLeader(req)) return res.status(403).json({ error: 'Forbidden' });
  const deptFilter = leaderDeptFilter(req);
  const params = [];
  // Admin can also assign goals to team leaders; a regular leader sees agents only.
  const roleClause = req.user?.role === 'admin'
    ? "role IN ('agent','leader')"
    : "role = 'agent'";
  let where = `WHERE ${roleClause} AND is_active = 1`;
  const inC = deptInClause('department', deptFilter);
  if (inC) { where += ` AND ${inC.sql}`; params.push(...inC.params); }
  const rows = db.prepare(`
    SELECT id, full_name, department, role FROM users ${where}
    ORDER BY CASE role WHEN 'agent' THEN 0 ELSE 1 END, full_name COLLATE NOCASE
  `).all(...params);
  return res.json(rows);
});

module.exports = router;
