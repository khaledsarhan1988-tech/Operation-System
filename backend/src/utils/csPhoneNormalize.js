'use strict';

/**
 * Phone normalizer for the Client Subscriptions (cs_*) tracking system.
 *
 * Unlike the existing Egyptian-only `phoneNormalize.js` (used by Center App
 * finance matcher), the subscription tracker accepts numbers from multiple
 * Arab countries because some Ahmed Hassan students are based abroad:
 *   - Egypt (+20)   → canonical "01XXXXXXXXX" (11 digits)
 *   - Saudi (+966)  → canonical "966XXXXXXXXX" (12 digits)
 *   - UAE (+971)    → canonical "971XXXXXXXXX" (12 digits)
 *   - Palestine/Israel (+972) → canonical "972XXXXXXXXX" (12 digits)
 *   - Anything else → kept verbatim as digits only (best-effort)
 *
 * Strategy: strip non-digits, classify by leading digits, return canonical
 * form. Returns null only if input is empty after stripping.
 *
 * Examples:
 *   "+20 122 128 0830"   → "01221280830"
 *   "01221280830"        → "01221280830"
 *   "1221280830"         → "01221280830"
 *   "966554979231"       → "966554979231"
 *   "+966 55 497 9231"   → "966554979231"
 *   "971547140805"       → "971547140805"
 *   "1507409030-1225977162" → "01507409030" (first valid number)
 *   ""  /  null          → null
 */
function csNormalizePhone(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/\D+/g, '');
  if (!s) return null;

  // Egyptian: "20XXXXXXXXXX" (12) → strip 20 → "01..." (with prefix fix below)
  if (s.length === 12 && s.startsWith('20')) {
    const rest = s.slice(2);
    if (rest.length === 10 && rest.startsWith('1')) return '0' + rest;
    if (rest.length === 11 && rest.startsWith('01')) return rest;
  }

  // Egyptian already in 11-digit local form
  if (s.length === 11 && s.startsWith('01')) return s;

  // Egyptian missing the leading zero
  if (s.length === 10 && s.startsWith('1')) return '0' + s;

  // Saudi / UAE / Palestinian — keep as-is (12 digits)
  if (s.length === 12 && (s.startsWith('966') || s.startsWith('971') || s.startsWith('972') || s.startsWith('970'))) {
    return s;
  }
  // 13 digits sometimes (e.g., "9660550357448" — extra digit), still keep
  if (s.length === 13 && (s.startsWith('966') || s.startsWith('971') || s.startsWith('972') || s.startsWith('970'))) {
    return s;
  }

  // Unknown country code: accept ONLY if it looks like a real international
  // number (≥ 9 digits). Shorter strings are almost certainly noise from
  // adjacent text (emails with digits, ID codes, etc.) — return null.
  if (s.length >= 9 && s.length <= 15) return s;
  return null;
}

/**
 * Extract every plausible phone from a free-text field. The Excel may have
 * multi-number cells separated by "/", "-", whitespace, "،", etc.
 * Returns a deduplicated array of canonical numbers.
 *
 *   "1093648335/1021261029"  → ["01093648335", "01021261029"]
 *   "1507409030-1225977162"  → ["01507409030", "01225977162"]
 */
function csExtractAllPhones(raw) {
  if (raw == null) return [];
  const parts = String(raw).split(/[^\d+]+/);
  const out = new Set();
  for (const p of parts) {
    const n = csNormalizePhone(p);
    if (n) out.add(n);
  }
  return Array.from(out);
}

/**
 * First valid phone from a multi-number cell, or null if none.
 */
function csPrimaryPhone(raw) {
  const all = csExtractAllPhones(raw);
  return all.length ? all[0] : null;
}

module.exports = {
  csNormalizePhone,
  csExtractAllPhones,
  csPrimaryPhone,
};
