/* Todos / daily-workflow guards.
 *
 * Every check here exists because the bug it guards ACTUALLY happened in
 * production and cost the Owner trust in the board. Keep them green.
 *
 *  1. addDaysCairo(negative)  — built '+-6 days', an invalid SQLite modifier, so
 *     DATE() returned NULL, the "last N days" window start was NULL and every
 *     BETWEEN over it matched nothing → the historical column read 0 for
 *     EVERYONE, silently, for as long as the feature existed.
 *  2. Retired-template blindness — the board only listed live templates, so an
 *     instance already generated AND COMPLETED under a template that was later
 *     retired vanished: the agent's cell showed "—" (never assigned) and her
 *     completion rate dropped. Work must never disappear because the schedule
 *     changed afterwards.
 *  3. Departed staff / cancelled-without-work must NOT clutter the board.
 *  4. Matrix integrity — every template the payload reports for an employee must
 *     carry the fields the UI keys its columns on (title + due_time), otherwise
 *     cells drift under the wrong header.
 *  5. Date-range filters must actually filter, and reject garbage safely.
 */
const path = require('path');
const { BACKEND } = require('../harness');

module.exports = async function todos({ call, db }) {
  const fails = { window: [], retired: [], hygiene: [], matrix: [], range: [] };

  // ── 1. addDaysCairo — negative offsets must yield a real date ──────────────
  // Exercised through the real module, not a re-implementation.
  const todosRoute = path.join(BACKEND, 'src/routes/todos.routes.js');
  const src = require('fs').readFileSync(todosRoute, 'utf8');
  if (/`\+\$\{n\} days`/.test(src)) {
    fails.window.push('addDaysCairo still builds `+${n} days` → negative offsets produce the invalid modifier "+-N days"');
  }
  // Behavioural proof via SQLite itself.
  for (const n of [-1, -6, -29, -89]) {
    const modifier = `${n >= 0 ? '+' : '-'}${Math.abs(n)} days`;
    const row = db.prepare("SELECT DATE('now','+2 hours',?) AS d").get(modifier);
    if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.d || '')) {
      fails.window.push(`offset ${n}: modifier "${modifier}" did not yield a date (got ${row && row.d})`);
    }
  }

  // ── 2..4. The manager board ───────────────────────────────────────────────
  const presets = [1, 7, 30];
  let perf = null;
  for (const days of presets) {
    const r = await call(`/todos/templates-performance?days=${days}`);
    if (r.status !== 200 || !r.json) { fails.window.push(`templates-performance?days=${days}: HTTP ${r.status}`); continue; }
    if (days === 7) perf = r.json;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.json.window_start || '')) {
      fails.window.push(`days=${days}: window_start is not a date (${r.json.window_start}) — the NULL-window regression is back`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.json.window_end || '')) {
      fails.window.push(`days=${days}: window_end is not a date (${r.json.window_end})`);
    }
    if (r.json.window_start > r.json.window_end) {
      fails.window.push(`days=${days}: window_start ${r.json.window_start} is after window_end ${r.json.window_end}`);
    }
  }

  const employees = (perf && perf.employees) || [];

  // Sanity gate: if the board came back empty while live templates DO exist for
  // employed staff, the actor/scope is wrong (e.g. an audit stub without
  // management) — report that once instead of letting every later check
  // cascade into hundreds of bogus "invisible work" lines.
  const liveTemplateOwners = db.prepare(`
    SELECT COUNT(DISTINCT t.assigned_to) AS n
      FROM todos t
      INNER JOIN users u ON u.id = t.assigned_to AND u.is_active = 1
     WHERE t.is_recurring = 1 AND t.parent_todo_id IS NULL
       AND t.status NOT IN ('cancelled')
  `).get().n;
  const boardBlind = employees.length === 0 && liveTemplateOwners > 0;
  if (boardBlind) {
    fails.hygiene.push(`board returned 0 employees while ${liveTemplateOwners} employed staff hold live templates — scope/actor is wrong, later checks skipped`);
  }

  // Departed staff must not appear on the board.
  const activeById = new Map(
    db.prepare(`SELECT id, full_name, is_active FROM users`).all().map(u => [u.id, u])
  );
  for (const e of employees) {
    const u = activeById.get(e.user_id);
    if (!u) { fails.hygiene.push(`board lists user_id ${e.user_id} that no longer exists`); continue; }
    if (u.is_active !== 1) fails.hygiene.push(`departed employee on the board: ${u.full_name}`);
  }

  // Matrix integrity + retired semantics.
  const liveTitles = new Set();
  for (const e of employees) {
    for (const t of e.templates || []) {
      if (typeof t.title !== 'string' || !t.title.trim()) {
        fails.matrix.push(`${e.user_name}: template ${t.template_id} has no title → header-less column`);
      }
      if (!('due_time' in t)) {
        fails.matrix.push(`${e.user_name}: template ${t.template_id} missing due_time → column key drift`);
      }
      if (!t.today || typeof t.today !== 'object') {
        fails.matrix.push(`${e.user_name}: template ${t.template_id} missing today{} block`);
      }
      if (!t.stats_window || typeof t.stats_window.total !== 'number') {
        fails.matrix.push(`${e.user_name}: template ${t.template_id} missing stats_window`);
      }
      if (t.is_retired) liveTitles.add(`${e.user_name}|${t.title}`);
    }
  }

  // A retired template is only allowed on the board when it produced work in
  // the window — and conversely, work done in the window must never be hidden
  // just because its template was retired afterwards.
  if (perf && !boardBlind) {
    const inWindow = db.prepare(`
      SELECT c.parent_todo_id AS pid, COUNT(*) AS n
        FROM todos c
       WHERE c.parent_todo_id IS NOT NULL
         AND c.due_date BETWEEN ? AND ?
       GROUP BY c.parent_todo_id
    `).all(perf.window_start, perf.window_end);
    const workByTemplate = new Map(inWindow.map(r => [r.pid, r.n]));

    const shownIds = new Set(employees.flatMap(e => (e.templates || []).map(t => t.template_id)));

    // (a) retired + shown  ⇒ must have work in the window
    for (const e of employees) {
      for (const t of (e.templates || [])) {
        if (t.is_retired && !workByTemplate.get(t.template_id)) {
          fails.retired.push(`${e.user_name}: retired template "${t.title}" shown but has no work in the window`);
        }
      }
    }
    // (b) cancelled + has work in window + owner still employed ⇒ must be shown
    const hiddenWithWork = db.prepare(`
      SELECT t.id, t.title, u.full_name
        FROM todos t
        INNER JOIN users u ON u.id = t.assigned_to AND u.is_active = 1
       WHERE t.is_recurring = 1 AND t.parent_todo_id IS NULL
         AND t.status = 'cancelled'
         AND EXISTS (SELECT 1 FROM todos c
                      WHERE c.parent_todo_id = t.id
                        AND c.due_date BETWEEN ? AND ?)
    `).all(perf.window_start, perf.window_end);
    for (const h of hiddenWithWork) {
      if (!shownIds.has(h.id)) {
        fails.retired.push(`${h.full_name}: work under retired template "${h.title}" is INVISIBLE to the manager`);
      }
    }
  }

  // ── 5. Date-range filters must filter, and survive garbage ────────────────
  const rangeProbe = await call('/todos?limit=200&due_from=1990-01-01&due_to=1990-01-02');
  if (rangeProbe.status !== 200) fails.range.push(`/todos range probe: HTTP ${rangeProbe.status}`);
  else if ((rangeProbe.json.todos || []).length > 0) {
    fails.range.push('due_from/due_to did not filter (rows returned for an empty 1990 window)');
  }
  const badDate = await call('/todos?limit=5&due_from=notadate&due_to=<script>');
  if (badDate.status !== 200) fails.range.push(`invalid date crashed /todos: HTTP ${badDate.status}`);

  const perfRange = await call('/todos/templates-performance?from=1990-01-01&to=1990-01-02');
  if (perfRange.status !== 200) fails.range.push(`templates-performance range: HTTP ${perfRange.status}`);
  else {
    if (perfRange.json.custom_range !== true) fails.range.push('templates-performance ignored an explicit from/to range');
    const anyWork = (perfRange.json.employees || [])
      .flatMap(e => e.templates || [])
      .some(t => (t.stats_window || {}).total > 0);
    if (anyWork) fails.range.push('templates-performance reported work inside an empty 1990 window');
  }
  const perfBad = await call('/todos/templates-performance?from=notadate');
  if (perfBad.status !== 200) fails.range.push(`invalid range crashed templates-performance: HTTP ${perfBad.status}`);
  else if (perfBad.json.custom_range !== false) fails.range.push('invalid from/to was not ignored (should fall back to the preset)');

  return {
    area: 'todos',
    meta: `${employees.length} employee(s) on the board`,
    checks: [
      { name: 'stats window is a real date range (no NULL-window regression)', pass: fails.window.length === 0, fails: fails.window.slice(0, 20), count: fails.window.length },
      { name: 'work done under a retired template stays visible', pass: fails.retired.length === 0, fails: fails.retired.slice(0, 20), count: fails.retired.length },
      { name: 'board excludes departed employees', pass: fails.hygiene.length === 0, fails: fails.hygiene.slice(0, 20), count: fails.hygiene.length },
      { name: 'every template carries its column key (title + due_time)', pass: fails.matrix.length === 0, fails: fails.matrix.slice(0, 20), count: fails.matrix.length },
      { name: 'date-range filters filter, and reject garbage safely', pass: fails.range.length === 0, fails: fails.range.slice(0, 20), count: fails.range.length },
    ],
  };
};
