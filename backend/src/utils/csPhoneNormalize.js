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
  let s = String(raw).replace(/\D+/g, '');
  if (!s) return null;

  // International dialing prefix: "00" + country code IS "+" + country code.
  // Without this, "00966554157081" and "966554157081" were two different
  // clients — 515 real clients (380 of them just this prefix) looked
  // unregistered and their memberships went uncounted (owner audit 2026-07-22).
  // Only strip when what remains is still a plausible international number.
  if (s.startsWith('00') && s.length - 2 >= 9) s = s.slice(2);

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
  const out = new Set();
  // Split ONLY on separators that really mean "another number" (/ - , ، ; newline).
  // Spaces are treated as digit grouping INSIDE one number ("109 856 1111"),
  // which the old split-on-everything lost entirely (4 register rows).
  for (const seg of String(raw).split(/[\/\\,،;\n\r|-]+/)) {
    if (!seg.trim()) continue;
    const joined = csNormalizePhone(seg.replace(/\s+/g, ''));   // spaced single number
    if (joined) out.add(joined);
    // Belt-and-braces: a segment may still hold two space-separated numbers.
    for (const tok of seg.split(/\s+/)) {
      const n = csNormalizePhone(tok);
      if (n) out.add(n);
    }
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
