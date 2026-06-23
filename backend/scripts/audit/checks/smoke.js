/* Broad smoke check across many report endpoints — fast, system-wide:
 *   - endpoint returns 200 (no 500 / crash)
 *   - no NaN / Infinity anywhere in the response
 *   - pagination sanity: when {total, rows|data} present, total >= returned count
 * This is a wide net (every report), NOT deep per-report logic. Deep checks live
 * in their own modules (occupancy.js, …).
 */
const H = require('../helpers');

module.exports = async function smoke({ call, window }) {
  const { from, to } = window;
  const q = `from=${from}&to=${to}`;
  const endpoints = [
    ['dashboard', `/reports/dashboard?${q}`],
    ['absent-list', `/reports/absent-list?${q}&page=1&limit=50`],
    ['absent-side-list', `/reports/absent-side-list?${q}&page=1&limit=50`],
    ['remarks-notes-main', `/reports/remarks-notes-main?${q}&page=1&limit=50`],
    ['remarks-notes-zoom', `/reports/remarks-notes-zoom?${q}&page=1&limit=50`],
    ['code-problems', `/reports/code-problems`],
    ['attendance-absence', `/reports/attendance-absence?${q}`],
    ['quality-employee', `/reports/quality-employee?${q}`],
    ['trainer-utilization', `/reports/trainer-utilization?${q}`],
    ['trainer-utilization-summary', `/reports/trainer-utilization-summary?${q}`],
    ['trainer-work-history', `/reports/trainer-work-history?${q}`],
    ['find-available-trainer', `/reports/find-available-trainer?section=all&days=saturday,sunday,monday,tuesday,wednesday,thursday&weeks_count=1&start_date=${from}`],
    ['team', `/team?department=education`],
    ['org-chart/customer-services', `/org-chart/customer-services`],
    ['cs/deliveries', `/cs/deliveries?dept=General&page=1&limit=50`],
    ['cs/enr-groups', `/cs/enr-groups?dept=General`],
  ];
  const statusFails = [], numberFails = [], pageFails = [];
  for (const [name, p] of endpoints) {
    let r; try { r = await call(p); } catch (e) { statusFails.push(`${name}: threw ${e.message}`); continue; }
    if (r.status !== 200) { statusFails.push(`${name}: HTTP ${r.status}`); continue; }
    if (r.json == null) { statusFails.push(`${name}: non-JSON response`); continue; }
    H.scanNumbers(r.json, (path, kind) => numberFails.push(`${name}: ${kind} at ${path}`));
    // pagination sanity
    const j = r.json;
    const rowsArr = Array.isArray(j.rows) ? j.rows : Array.isArray(j.data) ? j.data : null;
    if (rowsArr && typeof j.total === 'number') {
      if (j.total < rowsArr.length) pageFails.push(`${name}: total ${j.total} < returned ${rowsArr.length}`);
      if (j.total < 0) pageFails.push(`${name}: negative total ${j.total}`);
    }
  }
  return {
    area: 'smoke',
    meta: `${endpoints.length} endpoints`,
    checks: [
      { name: 'all endpoints return 200 JSON', pass: statusFails.length === 0, fails: statusFails.slice(0, 20), count: statusFails.length },
      { name: 'no NaN/Infinity in responses', pass: numberFails.length === 0, fails: numberFails.slice(0, 20), count: numberFails.length },
      { name: 'pagination total >= returned rows', pass: pageFails.length === 0, fails: pageFails.slice(0, 20), count: pageFails.length },
    ],
  };
};
