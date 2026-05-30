'use strict';

/**
 * Authoritative membership catalog for CENTER APP clients.
 *
 * Source of truth: "Center APP.xlsx" provided by the user (2026-05-29).
 * Each membership name maps to its fixed duration (months = level count) and
 * department. This catalog OVERRIDES the keyword heuristic in csArabicParser —
 * the heuristic is only a fallback for names not listed here.
 *
 * dept ∈ 'General' | 'Private' | 'Semi'
 * To update: edit CATALOG_RAW (or regenerate from the Excel).
 */

// Normalize an Arabic membership name so spelling variants in the live Center
// App data (extra spaces, أ/إ/آ, ى/ي, ة/ه, tashkeel, tatweel) still match the
// catalog entry.
function normalizeName(s) {
  return String(s == null ? '' : s)
    .replace(/[\u064B-\u0652\u0670]/g, '')   // tashkeel / superscript alef
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')                          // tatweel
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// [name, months, dept]
const CATALOG_RAW = [
  ["رحلة ممارسه الإنجليزى جولد جروب", 3, "General"],
  ["رحلة ممارسة الإنجليزي سوبر جولد جروب", 6, "General"],
  ["رحلة ممارسه الإنجليزي جولد برايفت صباحي", 3, "Private"],
  ["رحلة ممارسه الإنجليزي جولد برايفت مسائي", 3, "Private"],
  ["رحلة ممارسة الإنجليزي سوبر جولد برايفت صباحي", 6, "Private"],
  ["رحلة ممارسة الإنجليزي سوبر جولد برايفت مسائي", 6, "Private"],
  ["رحلة ممارسه الإنجليزي جولد سيمي برايفت", 3, "Semi"],
  ["رحلة ممارسة الإنجليزي سوبر جولد سيمي برايفت", 6, "Semi"],
  ["رحلة ممارسة الانجليزي سيمي برايفت سينجل", 1, "Semi"],
  ["رحلة ممارسة الانجليزي برايفت مسائي سينجل", 1, "Private"],
  ["رحلة ممارسة الانجليزي برايفت صباحي سينجل", 1, "Private"],
  ["رحلة ممارسة الانجليزي جروب سينجل", 1, "General"],
  ["رحلة ممارسه الإنجليزى جولد مكثف برايفت", 3, "Private"],
  ["رحلة ممارسة الانجليزي سوبر جولد مكثف برايفت", 6, "Private"],
  ["رحلة ممارسة الانجليزي جولد جروب قسط", 3, "General"],
  ["رحلة ممارسة الانجليزي جولد جروب عرض عيله", 3, "General"],
  ["رحلة ممارسة الانجليزي جولد جروب عرض صحاب", 3, "General"],
  ["رحلة ممارسة الانجليزي جولد برايفت صباحى عرض صحاب", 3, "Private"],
  ["رحلة ممارسة الانجليزي جولد برايفت مسائى عرض صحاب", 3, "Private"],
  ["رحلة ممارسة الانجليزي جولد برايفت صباحي عرض عيله", 3, "Private"],
  ["رحلة ممارسة الانجليزي جولد برايفت مسائي عرض عيله", 3, "Private"],
  ["رحلة ممارسة الانجليزي جولد برايفت قسط", 3, "Private"],
  ["رحلة ممارسة الانجليزي سوبر جولد جروب قسط", 6, "General"],
  ["رحلة ممارسة الانجليزي سوبر جولد جروب عرض صحاب", 6, "General"],
  ["رحلة ممارسة الانجليزي سوبر جولد جروب عرض العيله", 6, "General"],
  ["رحلة ممارسة الانجليزي سوبر جولد برايفت قسط", 6, "Private"],
  ["رحلة ممارسة الانجليزي سوبر جولد برايفت صباحي عرض الصحاب", 6, "Private"],
  ["رحلة ممارسة الانجليزي سوبر جولد برايفت مسائي عرض الصحاب", 6, "Private"],
  ["رحلة ممارسة الانجليزي سوبر جولد برايفت صباحي عرض العيله", 6, "Private"],
  ["رحلة ممارسة الانجليزي سوبر جولد برايفت مسائي عرض العيله", 6, "Private"],
  ["رحلة ممارسة الانجليزي جولد سيمي برايفت عرض الصحاب", 3, "Semi"],
  ["رحلة ممارسة الانجليزي جولد سيمي برايفت عرض العيله", 3, "Semi"],
  ["رحلة ممارسة الانجليزي سوبر جولد سيمي برايفت عرض الصحاب", 6, "Semi"],
  ["رحلة ممارسة الانجليزي سوبر جولد سيمي برايفت عرض العيله", 6, "Semi"],
  ["رحلة ممارسة الانجليزي 9 شهور برايفت صباحي", 9, "Private"],
  ["رحلة ممارسة الانجليزي 9 شهور برايفت مسائي", 9, "Private"],
  ["رحلة ممارسة الانجليزي 9 شهور سيمي برايفت", 9, "Semi"],
  ["رحلة ممارسة الانجليزي 9 شهور جروب", 9, "General"],
];

const _map = new Map();
for (const [name, months, dept] of CATALOG_RAW) {
  _map.set(normalizeName(name), { months, dept, raw: name });
}

// Exact (normalized) lookup. Returns { months, dept, raw } or null.
function lookupMembership(name) {
  if (!name) return null;
  return _map.get(normalizeName(name)) || null;
}

module.exports = { lookupMembership, normalizeName, CATALOG_RAW };
