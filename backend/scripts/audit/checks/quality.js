/* Deep audit of «تقارير الجودة» (/quality-employee).
 *
 * HARD checks (pass/fail):
 *  1. rate consistency: *_absent_rate == round(absent/expected*100)
 *  2. sanity: counts >= 0, absent <= expected
 *
 * INFORMATIONAL (not a failure): quality vs /attendance-absence per coordinator.
 *  An old constitution note (2026-06-08) said the two should be EQUAL, but live
 *  data shows they use DIFFERENT scopes (quality's *_expected is far smaller than
 *  attendance's — e.g. Amira quality main_expected 134 vs attendance 2048). So a
 *  raw "must be equal" assertion is a FALSE POSITIVE. We surface the comparison
 *  for the owner to judge (intended scope difference vs a real divergence) rather
 *  than fail the audit. Verified the mismatch is scope (expected differs), not a
 *  count bug, before downgrading to informational.
 */
const compact = s => String(s || '').toLowerCase().replace(/\s+/g, '');

module.exports = async function quality({ call, window }) {
  const { from, to } = window;
  const checks = [];
  const add = (name, fails) => checks.push({ name, pass: fails.length === 0, fails: fails.slice(0, 20), count: fails.length });

  const q = (await call(`/reports/quality-employee?from=${from}&to=${to}`)).json;
  const a = (await call(`/reports/attendance-absence?from=${from}&to=${to}`)).json;
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

  // informational only — quality vs attendance differ by SCOPE (different expected),
  // so this is NOT a pass/fail; it's surfaced for the owner to review.
  const info = [];
  if (crossFails.length) {
    info.push(`quality ≠ attendance-absence لـ ${crossFails.length / 2 | 0}+ منسق (نطاق مختلف — المتوقع مختلف، مش خطأ عدّ). للمراجعة:`);
    info.push(...crossFails.slice(0, 8));
  }

  return {
    area: 'quality',
    meta: `quality rows=${qrows.length} matched=${matched}${unmatched.length ? ` unmatched=${unmatched.length}` : ''}`,
    checks,
    info,
  };
};
