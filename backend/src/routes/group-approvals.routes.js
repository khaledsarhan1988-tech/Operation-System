'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// GROUP COUNT APPROVALS  —  "استلام المجموعات"
//
// A user "receives" a group and approves its current client count. We snapshot
// batches.trainee_count into group_count_approvals.approved_count. Later, if the
// live count differs (up OR down), /reports/code-problems flags it. Re-approving
// updates the baseline and clears the flag.
//
// Scope (mirrors /reports/code-problems):
//   • agent / enrollment        → only groups they coordinate
//   • leader / enrollment_leader → only groups in their department
//   • admin                     → everything (optional ?department / ?coordinator / ?line)
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { lineFilter } = require('../utils/lineFilter');
const { nameInListInline } = require('../utils/nameMatch');

const router = express.Router();
router.use(authenticate, requireRole('agent'));

const sq = (s) => String(s == null ? '' : s).replace(/'/g, "''");

// Build the role-scoped WHERE fragment applied to a `batches b` query.
// Returns a string that always starts with ' AND ...' (or '' for no extra filter).
function buildScopeFilter(req) {
  const { department, coordinator, employee } = req.query;
  const role = req.user?.role;

  // agent / enrollment → restrict to their own groups by exact-token match
  if (role === 'agent' || role === 'enrollment') {
    const fullName = (req.user?.full_name || '').trim();
    if (!fullName) return ' AND 1=0';
    return ` AND ${nameInListInline('b.coordinators', fullName)}`;
  }

  // leader / enrollment_leader → their department.
  // Coordinator's registered dept is source of truth; fall back to batch
  // dept_type when the coordinator isn't registered or there's no coordinator.
  if (role === 'leader' || role === 'enrollment_leader') {
    const dept = (!department || department === 'All') ? req.user?.department : department;
    if (!dept || dept === 'All') return '';
    const s = sq(dept);
    return ` AND (
      EXISTS (
        SELECT 1 FROM users u
        WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
          AND u.department = '${s}'
      )
      OR (
        b.dept_type = '${s}'
        AND b.coordinators IS NOT NULL AND TRIM(b.coordinators) NOT IN ('', '--')
        AND NOT EXISTS (
          SELECT 1 FROM users u
          WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
            AND u.department IS NOT NULL AND u.department != 'All'
        )
      )
      OR (
        b.dept_type = '${s}'
        AND (b.coordinators IS NULL OR TRIM(b.coordinators) IN ('', '--'))
      )
    )`;
  }

  // admin → optional department + coordinator filters
  let clause = '';
  if (department && department !== 'All') {
    const s = sq(department);
    clause += ` AND (b.dept_type = '${s}' OR EXISTS (
      SELECT 1 FROM users u
      WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
        AND u.department = '${s}'
    ))`;
  }
  const coord = (coordinator || employee || '').trim();
  if (coord) clause += ` AND ${nameInListInline('b.coordinators', coord)}`;
  return clause;
}

// ─── GET /api/group-approvals ────────────────────────────────────────────────
// Lists all active groups in scope with their approval status.
router.get('/', (req, res) => {
  const line = lineFilter(req);
  const lineClause = line ? ` AND b.line = '${sq(line)}'` : '';
  const scope = buildScopeFilter(req);
  const search = (req.query.search || '').trim();
  const searchClause = search ? ` AND b.group_name LIKE '%${sq(search)}%'` : '';

  try {
    const rows = db.prepare(`
      SELECT
        b.group_name,
        b.line,
        b.trainee_count                                              AS current_count,
        b.course,
        b.start_date,
        COALESCE(NULLIF(TRIM(b.coordinators), ''), '--')             AS coordinators,
        COALESCE(
          (SELECT u.department FROM users u
            WHERE LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.coordinators))
              AND u.department IS NOT NULL AND u.department != 'All'
            LIMIT 1),
          b.dept_type
        )                                                            AS dept_type,
        gca.approved_count,
        gca.approved_by_name,
        gca.approved_at,
        gca.updated_at
      FROM batches b
      LEFT JOIN group_count_approvals gca
        ON gca.group_name = b.group_name AND gca.line = b.line
      WHERE b.status = 'نشطة'${lineClause}${scope}${searchClause}
      ORDER BY b.group_name COLLATE NOCASE
    `).all();

    const groups = rows.map(r => {
      let status;
      if (r.approved_count == null)               status = 'not_approved';
      else if (r.approved_count === r.current_count) status = 'approved';
      else                                        status = 'changed';
      return {
        ...r,
        status,
        diff: r.approved_count == null ? null : (r.current_count - r.approved_count),
      };
    });

    const summary = {
      total:        groups.length,
      approved:     groups.filter(g => g.status === 'approved').length,
      not_approved: groups.filter(g => g.status === 'not_approved').length,
      changed:      groups.filter(g => g.status === 'changed').length,
    };

    return res.json({ groups, summary });
  } catch (err) {
    console.error('[group-approvals] list error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Confirms the given group is active AND visible within the caller's scope.
// Returns the batch row (with trainee_count) or null.
function findScopedBatch(req, groupName, line) {
  const scope = buildScopeFilter(req);
  return db.prepare(`
    SELECT b.group_name, b.line, b.trainee_count
    FROM batches b
    WHERE b.status = 'نشطة'
      AND b.group_name = ? AND b.line = ?${scope}
    LIMIT 1
  `).get(groupName, line);
}

// UPSERT one approval row, snapshotting the batch's current trainee_count.
function approveOne(req, groupName, line) {
  const batch = findScopedBatch(req, groupName, line);
  if (!batch) return { ok: false, reason: 'not_found_or_out_of_scope' };

  const count   = batch.trainee_count || 0;
  const byId    = req.user?.id || null;
  const byName  = req.user?.full_name || null;
  const nowIso  = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  const existing = db.prepare(
    `SELECT id FROM group_count_approvals WHERE group_name = ? AND line = ?`
  ).get(groupName, line);

  if (existing) {
    db.prepare(`
      UPDATE group_count_approvals
         SET approved_count = ?, approved_by = ?, approved_by_name = ?,
             approved_at = ?, updated_at = ?
       WHERE id = ?
    `).run(count, byId, byName, nowIso, nowIso, existing.id);
  } else {
    db.prepare(`
      INSERT INTO group_count_approvals
        (group_name, line, approved_count, approved_by, approved_by_name, approved_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `).run(groupName, line, count, byId, byName, nowIso);
  }
  return { ok: true, approved_count: count };
}

// ─── POST /api/group-approvals ───────────────────────────────────────────────
// Body: { group_name, line }  → approve / re-approve one group.
router.post('/', (req, res) => {
  const groupName = (req.body?.group_name || '').trim();
  const line      = (req.body?.line || '').trim();
  if (!groupName || !line) {
    return res.status(400).json({ error: 'group_name and line are required' });
  }
  try {
    const result = approveOne(req, groupName, line);
    if (!result.ok) {
      return res.status(404).json({ error: 'المجموعة غير موجودة أو خارج نطاقك' });
    }
    saveNow();
    return res.json({ ok: true, group_name: groupName, line, approved_count: result.approved_count });
  } catch (err) {
    console.error('[group-approvals] approve error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/group-approvals/bulk ──────────────────────────────────────────
// Approves every NOT-yet-approved group in the caller's scope at once.
// Groups whose count already changed are left untouched (review individually).
router.post('/bulk', (req, res) => {
  const line = lineFilter(req);
  const lineClause = line ? ` AND b.line = '${sq(line)}'` : '';
  const scope = buildScopeFilter(req);
  try {
    const pending = db.prepare(`
      SELECT b.group_name, b.line
      FROM batches b
      LEFT JOIN group_count_approvals gca
        ON gca.group_name = b.group_name AND gca.line = b.line
      WHERE b.status = 'نشطة' AND gca.id IS NULL${lineClause}${scope}
    `).all();

    let approved = 0;
    const tx = db.transaction(() => {
      for (const g of pending) {
        const r = approveOne(req, g.group_name, g.line);
        if (r.ok) approved += 1;
      }
    });
    tx();
    if (approved > 0) saveNow();
    return res.json({ ok: true, approved });
  } catch (err) {
    console.error('[group-approvals] bulk error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
