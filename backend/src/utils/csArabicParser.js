'use strict';

/**
 * Parse Arabic product/course strings from finance sources into a structured
 * shape used by the Client Subscription tracker.
 *
 * Inputs come from two places:
 *   1. finance_transactions.product_name — synced from Center App API
 *   2. Membership From Finance Department.xlsx — "Courses" column
 *
 * The strings look like (real examples):
 *   "رحلة ممارسة الانجليزي 3 شهور جينرال"
 *   "رحلة ممارسة الانجليزي 6 شهور جينرال"
 *   "رحلة ممارسه انجليزي 3 شهور برايفت"
 *   "رحلة ممارسه انجليزي 6 شهور برايفت"
 *   "رحلة ممارسه انجليزي 1 شهر برايفت"
 *   "رحله ممارسه الانجليزي 3 شهور جينرال قسط"   ← installment
 *   "رحلة ممارسه انجليزي3 شهور برايفت قسط"     ← no-space variant
 *   "Your American Day 9 Courses"                ← IGNORE per business rule
 *   "Bussines Course"                            ← IGNORE per business rule
 *
 * Output:
 *   { dept: 'General'|'Private'|'Semi', months: Number, isInstallment: Bool,
 *     isIgnored: Bool, raw: String, reason?: String }
 *
 * Rules (from the user, 2026-05-27):
 *   - شهور count = level count (1 month = 1 level)
 *   - "جينرال" = General
 *   - "برايفت" = Private
 *   - "سيمي" / "Private 2 in 1" / "برايفت 2 في 1" = Semi
 *   - "قسط" anywhere = installment payment
 *   - "Your American Day" / "Bussines Course" / non-track items = ignored
 */

// Department keyword groups. Order matters: check Semi BEFORE Private because
// "Private 2 in 1" contains the word "Private".
const DEPT_PATTERNS = [
  // Semi-Private — also called "Private 2 in 1" in marketing
  { dept: 'Semi',    patterns: [/سيمي/i, /سيمى/i, /semi/i, /2\s*in\s*1/i, /برايفت\s*2/i, /2\s*ف[يى]\s*1/i] },
  { dept: 'Private', patterns: [/برايفت/i, /private/i] },
  // General. NOTE: General memberships are marketed as "جروب" (group) and
  // often carry NO "جينرال" keyword (e.g. "جولد جروب", "سوبر جولد جروب").
  // "جروب" → General is safe because Semi/Private are checked first above.
  { dept: 'General', patterns: [/جينرال/i, /جنرال/i, /general/i, /جروب/i, /\bgroup\b/i] },
];

// Ignore list — products that should NOT generate subscription rows.
const IGNORE_PATTERNS = [
  /your\s*american\s*day/i,
  /american\s*day/i,
  /bussines/i,        // typo for "Business" — common in source data
  /business\s*course/i,
];

/**
 * Extract the months count (= level count).
 *
 * Priority (authoritative business rule from the user, "المنطق الأساسي"):
 *   1. "سوبر جولد" (super gold)  → 6 months
 *   2. "جولد" (gold)             → 3 months
 *   3. explicit "N شهور / N شهر / N months" → N
 *   4. "سينجل / single" → depends on dept (Semi = 1, Private = 3)
 *
 * Gold keywords beat an explicit number on purpose: a "جولد" membership is
 * always 3 months even if a stray digit appears. The 9-month products carry
 * no gold word, so they fall through to the explicit-number rule.
 *
 *   "سوبر جولد جروب"            → 6
 *   "جولد جروب"                 → 3
 *   "9 شهور برايفت"             → 9
 *   "3 شهور" / "3شهور" / "١ شهر" → 3 / 3 / 1
 *   "سيمي برايفت سينجل" (Semi)  → 1
 *   "برايفت مسائي سينجل" (Private) → 3
 *
 *   dept — optional; only needed to resolve "single" products.
 */
function extractMonths(s, dept = null) {
  if (!s) return null;
  // Normalize Arabic-Indic digits to Western
  const norm = String(s)
    .replace(/[٠۰]/g, '0').replace(/[١۱]/g, '1').replace(/[٢۲]/g, '2')
    .replace(/[٣۳]/g, '3').replace(/[٤۴]/g, '4').replace(/[٥۵]/g, '5')
    .replace(/[٦۶]/g, '6').replace(/[٧۷]/g, '7').replace(/[٨۸]/g, '8')
    .replace(/[٩۹]/g, '9');

  // 1+2. Gold keyword. Check "سوبر جولد" BEFORE "جولد" (it contains it).
  if (/سوبر\s*جولد|super\s*gold/i.test(norm)) return 6;
  if (/جولد|gold/i.test(norm)) return 3;

  // 3. Explicit "N شهور" / "N شهر" / "Nشهور" (no space)
  const monthsAr = norm.match(/(\d+)\s*شه(?:و)?ر/);
  if (monthsAr) {
    const n = parseInt(monthsAr[1], 10);
    if (n >= 1 && n <= 24) return n;
  }
  // English "N months"
  const monthsEn = norm.match(/(\d+)\s*month/i);
  if (monthsEn) {
    const n = parseInt(monthsEn[1], 10);
    if (n >= 1 && n <= 24) return n;
  }

  // 4. "سينجل / single" — duration depends on department.
  if (/سينجل|single/i.test(norm)) {
    if (dept === 'Semi')    return 1;
    if (dept === 'Private') return 3;
  }
  return null;
}

/**
 * Detect installment flag ("قسط").
 */
function isInstallment(s) {
  if (!s) return false;
  return /قسط/i.test(String(s));
}

/**
 * Detect ignored product (Your American Day / Business / etc.).
 */
function isIgnoredProduct(s) {
  if (!s) return false;
  for (const re of IGNORE_PATTERNS) {
    if (re.test(s)) return true;
  }
  return false;
}

/**
 * Detect department.
 */
function detectDept(s) {
  if (!s) return null;
  for (const group of DEPT_PATTERNS) {
    for (const re of group.patterns) {
      if (re.test(s)) return group.dept;
    }
  }
  return null;
}

/**
 * Main entry point. Always returns a structured object — never throws.
 *
 *   parseCourseString("رحلة ممارسة الانجليزي 6 شهور جينرال")
 *     → { dept: 'General', months: 6, isInstallment: false, isIgnored: false, raw: '...' }
 *
 *   parseCourseString("Your American Day 9 Courses")
 *     → { isIgnored: true, raw: '...', reason: 'ignored_product' }
 *
 *   parseCourseString("رحلة ممارسة 3 شهور")  ← no dept
 *     → { isIgnored: false, dept: null, months: 3, reason: 'unknown_dept' }
 */
function parseCourseString(raw) {
  const out = { raw: raw || '', dept: null, months: null, isInstallment: false, isIgnored: false };
  if (!raw) {
    out.reason = 'empty_input';
    return out;
  }

  if (isIgnoredProduct(raw)) {
    out.isIgnored = true;
    out.reason = 'ignored_product';
    return out;
  }

  out.dept           = detectDept(raw);
  out.months         = extractMonths(raw, out.dept);
  out.isInstallment  = isInstallment(raw);

  if (!out.dept)   out.reason = 'unknown_dept';
  else if (!out.months) out.reason = 'unknown_months';

  return out;
}

module.exports = {
  parseCourseString,
  detectDept,
  extractMonths,
  isInstallment,
  isIgnoredProduct,
};
