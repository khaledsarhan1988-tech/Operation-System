/* Guard for the «فترات الانقطاع / بدون منسق» feature.
 *
 * The feature moves a coordinator's absences OFF them during a recorded leave
 * period (to the handed-over coordinator, else the placeholder «بدون منسق»).
 * This MUST stay consistent across reports, or it silently breaks the protected
 * quality↔attendance parity. Live snapshots usually have no leave periods, so
 * this check SEEDS one (for the highest-absence quality agent over the window),
 * re-runs both reports, asserts, then removes the seed.
 *
 * HARD checks:
 *  1. Under an active full-window leave, the on-leave agent's attendance absences
 *     drop to 0 (main + zoom) — the feature actually fires.
 *  2. quality per-coordinator absence == attendance per-coordinator absence for
 *     every agent present in BOTH, WITH the leave active (parity preserved).
 */
const Database = require('better-sqlite3');
const compact = s => String(s || '').toLowerCase().replace(/\s+/g, '');

module.exports = async function leave({ call, window }) {
  const { from, to } = window;
  const checks = [];
  const add = (name, fails) => checks.push({ name, pass: fails.length === 0, fails: fails.slice(0, 20), count: fails.length });

  // Pick the highest-absence quality agent as the leave subject.
  const q0 = (await call(`/reports/quality-employee?from=${from}&to=${to}`)).json || [];
  const cand = (Array.isArray(q0) ? q0 : q0.rows || [])
    .filter(r => Number(r.main_absent_count) > 10)
    .sort((a, b) => b.main_absent_count - a.main_absent_count)[0];
  if (!cand) { add('leave feature (no absence data to exercise)', []); return { area: 'leave', meta: 'no absence data', checks }; }
  const A = cand.agent_name;

  // Seed a full-window leave period for A on the working DB (separate writable
  // connection — the booted server reads it via WAL). Compact name match links
  // it to coordinator_history the same way the reports do.
  const w = new Database(process.env.DB_PATH);
  let seededId = null;
  try {
    const tm = w.prepare("SELECT id FROM team_members WHERE REPLACE(name,' ','')=REPLACE(?,' ','') COLLATE NOCASE AND department='customer_services' LIMIT 1").get(A);
    const r = w.prepare('INSERT INTO coordinator_leave_periods (team_member_id, coordinator, from_date, to_date, reason) VALUES (?,?,?,?,?)')
      .run(tm ? tm.id : null, A, from, to, 'audit-seed');
    seededId = r.lastInsertRowid;

    // Cache-busting param so we don't read the pre-seed cached response.
    const qa = (await call(`/reports/quality-employee?from=${from}&to=${to}&_leaveaudit=1`)).json || [];
    const aa = (await call(`/reports/attendance-absence?from_date=${from}&to_date=${to}&_leaveaudit=1`)).json || [];
    const qRows = Array.isArray(qa) ? qa : qa.rows || [];
    const aRows = Array.isArray(aa) ? aa : aa.rows || [];
    const qMap = new Map(qRows.map(r => [compact(r.agent_name), r]));
    const aMap = new Map(aRows.map(r => [compact(r.coordinator), r]));

    // 1) on-leave agent moved off in attendance
    const aA = aMap.get(compact(A));
    const movedFails = [];
    if (aA && (Number(aA.main_absent) !== 0 || Number(aA.zoom_absent) !== 0)) {
      movedFails.push(`${A}: attendance still main=${aA.main_absent} zoom=${aA.zoom_absent} during full-window leave (expected 0)`);
    }
    add('on-leave coordinator absences moved off (attendance)', movedFails);

    // 2) quality == attendance per shared agent, under active leave
    const parityFails = [];
    for (const [k, qrow] of qMap) {
      const arow = aMap.get(k);
      if (!arow) continue;
      if (Number(qrow.main_absent_count) !== Number(arow.main_absent) || Number(qrow.zoom_absent_count) !== Number(arow.zoom_absent)) {
        parityFails.push(`${qrow.agent_name}: Q(main=${qrow.main_absent_count},zoom=${qrow.zoom_absent_count}) vs A(main=${arow.main_absent},zoom=${arow.zoom_absent})`);
      }
    }
    add(`quality==attendance under active leave (subject: ${A})`, parityFails);
  } finally {
    if (seededId != null) { try { w.prepare('DELETE FROM coordinator_leave_periods WHERE id = ?').run(seededId); } catch (_) {} }
    w.close();
  }
  return { area: 'leave', meta: `subject=${A}`, checks };
};
