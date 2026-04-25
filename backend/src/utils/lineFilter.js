'use strict';
const db = require('../config/database');
/**
 * Multi-Line Filter Helper
 *
 * Usage in routes:
 *   const { lineFilter, lineClause } = require('../utils/lineFilter');
 *
 *   // Option A: full WHERE clause injection
 *   const { clause, params } = lineClause(req, 'r');
 *   // clause = "" OR " AND r.line = ? "
 *   // params = [] OR ['Ahmed Hassan']
 *
 *   // Option B: get line directly (null means admin-All, no filter)
 *   const line = lineFilter(req);
 *   // 'Ahmed Hassan' | 'Dardasha' | null
 *
 * Rules:
 * - If req.user.line === 'All' → no filter (sees everything)
 * - Otherwise → filter strictly by req.user.line
 * - Defaults to 'Ahmed Hassan' if somehow missing (backward-compatible)
 *
 * Admin override priority:
 *   1. Explicit ?line= param (e.g. ?line=Ahmed Hassan)
 *   2. Auto-detect from ?employee= or ?coordinator= → look up their line in users table
 *   3. null → admin sees everything (no filter)
 */

function lineFilter(req) {
  const userLine = req.user?.line || 'Ahmed Hassan';
  if (userLine === 'All') {
    // 1. Explicit ?line= param takes highest priority
    const queryLine = req.query?.line;
    if (queryLine && queryLine !== 'All') return queryLine;

    // 2. Auto-detect line from coordinator/employee name
    const coordinator = req.query?.employee || req.query?.coordinator;
    if (coordinator && coordinator.trim()) {
      try {
        const user = db.prepare(
          "SELECT line FROM users WHERE full_name = ? AND line IS NOT NULL AND line != 'All' LIMIT 1"
        ).get(coordinator.trim());
        if (user?.line) return user.line;
      } catch (_) { /* ignore DB errors — fall through to null */ }
    }

    // 3. Admin sees everything
    return null;
  }
  return userLine;
}

/**
 * Build SQL fragment to AND into an existing WHERE clause.
 * @param {object} req - Express request
 * @param {string} alias - optional table alias (e.g. 'r' → 'r.line')
 * @returns {{clause: string, params: any[]}}
 */
function lineClause(req, alias) {
  const line = lineFilter(req);
  if (!line) return { clause: '', params: [] };
  const col = alias ? `${alias}.line` : 'line';
  return { clause: ` AND ${col} = ?`, params: [line] };
}

/**
 * Build a standalone WHERE fragment (for queries that don't already have WHERE).
 * @returns {{clause: string, params: any[]}}  clause starts with ' WHERE ' if active
 */
function whereLineClause(req, alias) {
  const line = lineFilter(req);
  if (!line) return { clause: '', params: [] };
  const col = alias ? `${alias}.line` : 'line';
  return { clause: ` WHERE ${col} = ?`, params: [line] };
}

module.exports = { lineFilter, lineClause, whereLineClause };
