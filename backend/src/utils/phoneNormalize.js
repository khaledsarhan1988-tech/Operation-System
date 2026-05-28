'use strict';

/**
 * Egyptian phone-number normalizer.
 *
 * Used by the finance matcher to compare numbers stored in Center App
 * (typically "+20…" or international form) against numbers stored in the
 * academy `clients.phone` column (often local "01…" form). Both flow into
 * the same canonical representation so matching is a single equality check.
 *
 * The canonical form for an Egyptian mobile is 11 digits starting with "01":
 *   01XXXXXXXXX
 *
 * Strategy:
 *   1. Strip everything that isn't a digit.
 *   2. If the result starts with "20" and is 12 digits, drop the leading "20".
 *   3. If the result is 10 digits and starts with "1", prepend a "0".
 *   4. Accept only the final 11-digit string starting with "01"; otherwise
 *      return null (caller treats null as "cannot match on phone").
 *
 * Examples:
 *   "+20 123 456 7890" → "01234567890"
 *   "201234567890"     → "01234567890"
 *   "01234567890"      → "01234567890"
 *   "1234567890"       → "01234567890"
 *   "123"              → null   (too short)
 *   "+1 415 555 0100"  → null   (not Egyptian — out of scope for v1)
 *   null / undefined    → null
 */
function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/\D+/g, '');
  if (!s) return null;

  // International dialing prefix "00" (e.g. "0020 1060801216")
  // Strip it first so the rest of the logic handles the country code uniformly.
  if (s.startsWith('00')) {
    s = s.slice(2);
  }

  if (s.length === 12 && s.startsWith('20')) {
    s = s.slice(2);
  }
  if (s.length === 10 && s.startsWith('1')) {
    s = '0' + s;
  }

  if (s.length === 11 && s.startsWith('01')) return s;
  return null;
}

/**
 * Extract every plausible Egyptian phone from a free-text field. The Center App
 * client_phone may sometimes contain multiple numbers (e.g. "01234567890 /
 * 01098765432"), and so may the academy clients.phone column. Returns a
 * deduplicated array of canonical numbers.
 */
function extractAllPhones(raw) {
  if (!raw) return [];
  const candidates = String(raw).split(/[^\d+]+/);
  const out = new Set();
  for (const c of candidates) {
    const n = normalizePhone(c);
    if (n) out.add(n);
  }
  return Array.from(out);
}

module.exports = { normalizePhone, extractAllPhones };
