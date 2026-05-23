'use strict';

/**
 * Leader Scope Helper
 *
 * A leader's "team" used to be a single department (users.department). With
 * the addition of users.extra_departments, a single leader can now oversee
 * MULTIPLE org-chart sections (e.g. Mai = primary 'General' + extras 'Private').
 *
 * Every leader-scoped query must therefore expand from one department to a
 * LIST. This module is the single source of truth for that expansion.
 *
 * Usage:
 *   const { listDepts } = resolveLeaderDepts(db, req.user.id);
 *   // listDepts: ['General','Private']  (case preserved from users table)
 *
 * Notes:
 *   • Returns at least the primary department (or [] if user not found).
 *   • De-duplicates case-insensitively but preserves the original casing
 *     of the primary department.
 *   • Pure read — never writes.
 */

function resolveLeaderDepts(db, userId) {
  if (!userId) return { primary: null, extras: [], listDepts: [] };
  const row = db.prepare(
    `SELECT department, extra_departments FROM users WHERE id = ?`
  ).get(userId);
  if (!row) return { primary: null, extras: [], listDepts: [] };

  const primary = row.department ? String(row.department).trim() : null;
  const extras = String(row.extra_departments || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // De-dup case-insensitively, primary first.
  const seen = new Set();
  const listDepts = [];
  for (const d of [primary, ...extras]) {
    if (!d) continue;
    const key = d.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    listDepts.push(d);
  }
  return { primary, extras, listDepts };
}

// Convenience: convert a `req.user`-style scope object to an array of depts.
// Falls back to the JWT-provided department if the DB row is missing.
function leaderDeptList(db, user) {
  if (!user) return [];
  const r = resolveLeaderDepts(db, user.id);
  if (r.listDepts.length > 0) return r.listDepts;
  return user.department ? [String(user.department).trim()] : [];
}

// Build a SQL fragment + params for "department IN (...)" with NOCASE.
// Returns { sql, params } — caller embeds `sql` directly.
function sqlInDepts(depts, column = 'department') {
  const list = depts.filter(Boolean);
  if (list.length === 0) {
    // Match nothing safely (rather than empty IN which errors)
    return { sql: '0', params: [] };
  }
  const placeholders = list.map(() => '?').join(',');
  return {
    sql: `LOWER(TRIM(${column})) IN (${placeholders})`,
    params: list.map(d => String(d).toLowerCase().trim()),
  };
}

module.exports = {
  resolveLeaderDepts,
  leaderDeptList,
  sqlInDepts,
};
