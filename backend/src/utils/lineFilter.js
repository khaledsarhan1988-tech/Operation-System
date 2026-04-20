'use strict';
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
 */

function lineFilter(req) {
  const line = req.user?.line || 'Ahmed Hassan';
  return line === 'All' ? null : line;
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
