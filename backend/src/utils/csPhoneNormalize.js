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

  // A single leading "0" written before a COUNTRY CODE is a typo for "+":
  // "0201021925461" is "+20 1021925461", "0966535193907" is "+966 535193907".
  // These used to fall through to the catch-all and stay verbatim, so the same
  // client existed twice and 20 memberships went uncounted (owner audit
  // 2026-07-22). Egyptian "01XXXXXXXXX" is untouched — after the 0 comes a "1",
  // which is not a country code.
  if (/^0(?:20|966|971|972|970)/.test(s)) s = s.slice(1);

  // A "0" sitting BETWEEN a country code and the local number is the local
  // number's own leading zero, left in by mistake: "9660508919052" is
  // "+966" + "0508919052" — the same client as "966508919052". Without this the
  // 13-digit form was kept verbatim (see the length-13 branch below) and split
  // the client in two. Strip that one zero for every code we recognize; 9+ more
  // digits must remain so we never eat a real digit.
  s = s.replace(/^(20|966|971|972|970|249)0(?=\d{9,})/, '$1');

  // Egyptian with country code: "20" + local, whether the local part kept its
  // leading zero ("2001034885366", 13) or dropped it ("201021925461", 12).
  if (s.startsWith('20') && (s.length === 12 || s.length === 13)) {
    const rest = s.slice(2);
    if (rest.length === 10 && rest.startsWith('1')) return '0' + rest;
    if (rest.length === 11 && rest.startsWith('01')) return rest;
  }

  // Egyptian already in 11-digit local form
  if (s.length === 11 && s.startsWith('01')) return s;

  // Egyptian missing the leading zero
  if (s.length === 10 && s.startsWith('1')) return '0' + s;

  // Saudi mobile written in local form — fold onto the international "966…" key
  // so the three spellings of ONE number converge instead of splitting a client:
  //   "0575282028" (10, "05…")  → "966575282028"
  //   "575282028"  (9,  "5…")   → "966575282028"
  //   "966575282028" (12)       → stays
  // The register kept some Saudis as the 9-digit local form while their group
  // data used "966…", so 5 clients had membership under one key and their levels
  // under the other (owner audit 2026-07-22). Not Egyptian: an Egyptian local
  // number is 11 digits and starts "01". All 18 short numbers in the data are
  // Saudi — none has a "971" (UAE) counterpart — so "966" is unambiguous here.
  if (s.length === 10 && s.startsWith('05')) return '966' + s.slice(1);
  if (s.length === 9 && s.startsWith('5'))   return '966' + s;

  // Saudi / UAE / Palestinian — keep as-is (12 digits)
  if (s.length === 12 && (s.startsWith('966') || s.startsWith('971') || s.startsWith('972') || s.startsWith('970'))) {
    return s;
  }
  // 13 digits sometimes (e.g., "9660550357448" — extra digit), still keep
  if (s.length === 13 && (s.startsWith('966') || s.startsWith('971') || s.startsWith('972') || s.startsWith('970'))) {
    return s;
  }

  // A spurious leading "0" on a NON-Egyptian number ("023599784396",
  // "061470273770") — the register kept the same value without it, so the two
  // split one client. Egyptian is safe: an 11-digit "01…" was already returned
  // above, and after stripping the zeros an Egyptian number would start "1",
  // which we refuse to touch here.
  if (s.startsWith('0') && s.length >= 10) {
    const t = s.replace(/^0+/, '');
    if (t.length >= 9 && !t.startsWith('1')) s = t;
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
 *   "1099596097_966592778186" → ["01099596097", "966592778186"]
 *   "1098217866ـــــ1021533108" → ["01098217866", "01021533108"]
 */
function csExtractAllPhones(raw) {
  if (raw == null) return [];
  const out = new Set();
  // Split ONLY on separators that really mean "another number"
  // (/ - , ، ; newline, and "_" / Arabic tatweel "ـ" — the register uses both to
  // join a client and a guardian: "1099596097_966592778186" alongside the name
  // "Hala Ahmed fawzy_Ahmed fawzy"). Without them the two numbers glued into a
  // 22-digit string, which the ≤15-digit guard rejected outright, so the WHOLE
  // membership row dropped out of كشف العملاء (owner report 2026-07-22).
  // Spaces are treated as digit grouping INSIDE one number ("109 856 1111"),
  // which the old split-on-everything lost entirely (4 register rows).
  for (const seg of String(raw).split(/[\/\\,،;\n\r|_ـ-]+/)) {
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
