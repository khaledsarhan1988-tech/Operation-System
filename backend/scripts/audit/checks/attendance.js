/* Deep audit of «الحضور والغياب» (/attendance-absence).
 *
 * HARD checks (pass/fail):
 *  1. rate consistency: main/zoom absence_rate == round(absent/expected*100)
 *  2. sanity: counts >= 0 and absent <= expected. The per-lecture expectedSlots
 *     denominator (MAX(enrolled, present+listed-absent)) guarantees rate <= 100%;
 *     an absent>expected row = a denominator regression.
 *  3. conservation (segment-first): for each coordinator, the
 *     /attendance-absence/segments numbers SUM to that coordinator's
 *     /attendance-absence row (main+zoom, expected+absent). Segments use an
 *     INDEPENDENT query path (the `cf` single-coordinator membership test +
 *     section bucketing) that must reconcile to the row — the constitution's
 *     segment-first invariant. Drift here = attribution changed in one endpoint
 *     but not the other (e.g. a rename/ended-group fix applied to only one).
 *
 * NOTES:
 *  - Both endpoints read from_date/to_date (NOT from/to) — see quality.js header.
 *  - /attendance-absence-by-department is intentionally NOT cross-checked: it is a
 *    deprecated path (the page now derives dept cards from /attendance-absence) and
 *    uses a DIFFERENT denominator (batches.trainee_count) + INNER-JOIN-batches
 *    attribution (drops ended groups), so it does not reconcile by design.
 */
const FIELDS = ['main_expected', 'main_absent', 'zoom_expected', 'zoom_absent'];

module.exports = async function attendance({ call, window }) {
  const { from, to } = window;
  const checks = [];
  const add = (name, fails) => checks.push({ name, pass: fails.length === 0, fails: fails.slice(0, 20), count: fails.length });

  const a = (await call(`/reports/attendance-absence?from_date=${from}&to_date=${to}`)).json;
  const rows = Array.isArray(a) ? a : ((a && (a.rows || a.data)) || []);

  // 1 + 2: rate consistency + sanity (internal)
  const rateFails = [], sanityFails = [];
  for (const r of rows) {
    for (const [c, e, lbl] of [[r.main_absent, r.main_expected, 'main'], [r.zoom_absent, r.zoom_expected, 'zoom']]) {
      if (c < 0 || e < 0) sanityFails.push(`${r.coordinator}: negative ${lbl} (${c}/${e})`);
      if (c > e) sanityFails.push(`${r.coordinator}: ${lbl} absent ${c} > expected ${e}`);
    }
    const mr = r.main_expected > 0 ? Math.round(r.main_absent / r.main_expected * 100) : 0;
    const zr = r.zoom_expected > 0 ? Math.round(r.zoom_absent / r.zoom_expected * 100) : 0;
    if (r.main_absence_rate != null && Math.abs(r.main_absence_rate - mr) > 1) rateFails.push(`${r.coordinator}: main rate ${r.main_absence_rate} vs ${mr}`);
    if (r.zoom_absence_rate != null && Math.abs(r.zoom_absence_rate - zr) > 1) rateFails.push(`${r.coordinator}: zoom rate ${r.zoom_absence_rate} vs ${zr}`);
  }
  add('absence-rate == round(absent/expected)', rateFails);
  add('sanity (no negative, absent <= expected)', sanityFails);

  // 3: conservation — segments sum == coordinator row (only coords with activity)
  const segFails = [];
  let segChecked = 0;
  const active = rows.filter(r => FIELDS.some(f => r[f]));
  for (const r of active) {
    const s = (await call(`/reports/attendance-absence/segments?from_date=${from}&to_date=${to}&coordinator=${encodeURIComponent(r.coordinator)}`)).json;
    const segs = (s && s.segments) || [];
    const sum = FIELDS.reduce((o, f) => (o[f] = segs.reduce((t, x) => t + (x[f] || 0), 0), o), {});
    segChecked++;
    for (const f of FIELDS) {
      if (Math.abs((sum[f] || 0) - (r[f] || 0)) > 1) segFails.push(`${r.coordinator}: segments ${f}=${sum[f]} ≠ row ${r[f] || 0}`);
    }
  }
  add('segments sum == coordinator row', segFails);

  return {
    area: 'attendance',
    meta: `coords=${rows.length} segChecked=${segChecked}`,
    checks,
  };
};
