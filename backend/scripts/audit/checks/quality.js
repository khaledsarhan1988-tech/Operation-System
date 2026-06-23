/* Deep audit of «تقارير الجودة» (/quality-employee).
 *
 * HARD checks (pass/fail):
 *  1. rate consistency: *_absent_rate == round(absent/expected*100)
 *  2. sanity: counts >= 0, absent <= expected
 *  3. cross-report: quality absent == /attendance-absence absent, per coordinator
 *     (constitution 2026-06-08: «الرقمان متطابقان لكل منسق»).
 *
 * IMPORTANT — same-window comparison: /attendance-absence reads from_date/to_date
 * (NOT from/to). Passing from/to silently drops its date filter so it runs
 * ALL-TIME, which earlier produced a PHANTOM "scope difference" (e.g. Amira
 * all-time main_expected 2048 vs May 63) that was wrongly logged as an intended
 * scope diff. Verified live (May 2026): with matching params the two reports agree
 * EXACTLY for every active coordinator (0 mismatches) — so this is a hard check.
 *
 * Coverage note (NOT a failure): quality lists active agent-users only; attendance
 * also seeds inactive/ended coordinators, so attendance has extra rows quality
 * doesn't. The per-coordinator equality is checked only for coordinators present
 * in BOTH (the constitution rule's scope).
 */
const compact = s => String(s || '').toLowerCase().replace(/\s+/g, '');

module.exports = async function quality({ call, window }) {
  const { from, to } = window;
  const checks = [];
  const add = (name, fails) => checks.push({ name, pass: fails.length === 0, fails: fails.slice(0, 20), count: fails.length });

  const q = (await call(`/reports/quality-employee?from=${from}&to=${to}`)).json;
  // attendance-absence reads from_date/to_date (NOT from/to) — must match the
  // quality window or it runs all-time and the cross-report check is meaningless.
  const a = (await call(`/reports/attendance-absence?from_date=${from}&to_date=${to}`)).json;
  const qrows = (q && q.rows) || [];
  const arows = Array.isArray(a) ? a : ((a && (a.rows || a.data)) || []);

  // attendance by compacted coordinator name
  const aMap = {};
  for (const r of arows) aMap[compact(r.coordinator)] = r;

  const crossFails = [], rateFails = [], sanityFails = [];
  let matched = 0; const unmatched = [];
  for (const r of qrows) {
    // sanity
    for (const [c, e, lbl] of [[r.main_absent_count, r.main_expected_count, 'main'], [r.zoom_absent_count, r.zoom_expected_count, 'zoom']]) {
      if (c < 0 || e < 0) sanityFails.push(`${r.agent_name}: negative ${lbl} (${c}/${e})`);
      if (c > e) sanityFails.push(`${r.agent_name}: ${lbl} absent ${c} > expected ${e}`);
    }
    // rate
    const mr = r.main_expected_count > 0 ? Math.round(r.main_absent_count / r.main_expected_count * 100) : 0;
    const zr = r.zoom_expected_count > 0 ? Math.round(r.zoom_absent_count / r.zoom_expected_count * 100) : 0;
    if (r.main_expected_count > 0 && r.main_absent_rate != null && Math.abs(r.main_absent_rate - mr) > 1) rateFails.push(`${r.agent_name}: main rate ${r.main_absent_rate} vs ${mr}`);
    if (r.zoom_expected_count > 0 && r.zoom_absent_rate != null && Math.abs(r.zoom_absent_rate - zr) > 1) rateFails.push(`${r.agent_name}: zoom rate ${r.zoom_absent_rate} vs ${zr}`);
    // cross-report
    const am = aMap[compact(r.agent_name)];
    if (!am) { unmatched.push(r.agent_name); continue; }
    matched++;
    if (Math.abs((r.main_absent_count || 0) - (am.main_absent || 0)) > 1) crossFails.push(`${r.agent_name}: quality main_absent ${r.main_absent_count} ≠ attendance ${am.main_absent}`);
    if (Math.abs((r.zoom_absent_count || 0) - (am.zoom_absent || 0)) > 1) crossFails.push(`${r.agent_name}: quality zoom_absent ${r.zoom_absent_count} ≠ attendance ${am.zoom_absent}`);
  }
  add('absent-rate == round(absent/expected)', rateFails);
  add('sanity (no negative, absent<=expected)', sanityFails);
  // constitution 2026-06-08: quality absence == attendance-absence per coordinator
  // (main + zoom). A real failure here means one report's absence calc drifted
  // from the other — fix both, never just one.
  add('quality absent == attendance-absence (per coordinator)', crossFails);

  return {
    area: 'quality',
    meta: `quality rows=${qrows.length} matched=${matched}${unmatched.length ? ` unmatched=${unmatched.length}` : ''}`,
    checks,
  };
};
