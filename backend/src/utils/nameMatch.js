'use strict';
/**
 * Exact-name-in-list matching helpers.
 *
 * The `coordinators` field on batches and the `assigned_to` field on remarks
 * can both hold either a single name ("Alaa") or a comma-separated list
 * ("Mostafa, fouad"). Until now we matched these fields with `LIKE '%Alaa%'`
 * — which incorrectly matches rows whose value is "Alaa wael" because
 * "Alaa" is a substring. This helper enforces a token-level exact match
 * (case-insensitive, whitespace-tolerant) so "Alaa" never matches "Alaa wael".
 *
 * Strategy:
 *   normalize(field) := ',' || REPLACE(REPLACE(field, ', ', ','), ' ,', ',') || ','
 *   match           := normalize(field) LIKE '%,Alaa,%' COLLATE NOCASE
 *
 * That wraps the field in commas, collapses comma-with-space to bare comma,
 * then asks for `,name,` — guaranteed to match only the whole token.
 */

function _safe(s) {
  return String(s).replace(/'/g, "''").trim();
}

/**
 * Inline (non-parameterized) version. Use when callers are already building
 * raw SQL fragments (typical in this codebase). Returns a SQL boolean
 * expression. Safe against single-quote injection in the name.
 */
function nameInListInline(field, name) {
  const safe = _safe(name);
  if (!safe) return '1=1'; // no filter
  return `(',' || REPLACE(REPLACE(${field}, ', ', ','), ' ,', ',') || ',') ` +
         `LIKE '%,${safe},%' COLLATE NOCASE`;
}

/**
 * Parameterized version. Returns { clause, param } — bind `param` as a
 * positional parameter. Use this when the surrounding query already uses
 * `?` binding for safety.
 */
function nameInListParam(field) {
  return (name) => ({
    clause:
      `(',' || REPLACE(REPLACE(${field}, ', ', ','), ' ,', ',') || ',') ` +
      `LIKE ? COLLATE NOCASE`,
    param: `%,${String(name).trim()},%`,
  });
}

module.exports = { nameInListInline, nameInListParam };
