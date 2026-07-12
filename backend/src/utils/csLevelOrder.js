'use strict';

/**
 * Level order utilities for the Client Subscription tracker.
 *
 * The academy curriculum has 13 levels across 3 tracks, taken in this order:
 *
 *   Starter 1 → Starter 2 → Starter 3
 *     → General 1 → General 2 → General 3 → General 4 → General 5
 *       → Conversation 1 → Conversation 2 → Conversation 3 → Conversation 4 → Conversation 5
 *
 * We assign a global "order" 1..13 so that math is easy:
 *   - "Where do they start?"          → find the order of their first completed level
 *   - "How many levels did they buy?" → equals months purchased
 *   - "Which orders should they take?" → [startOrder .. startOrder+months-1], capped at 13
 *   - "How many are pending?"          → planned orders not yet in completed list
 *
 * Business rule: if a client appears in (say) General 3 with NO record of
 * Starter/General 1-2, their journey starts at General 3 (we don't assume
 * they completed the prior levels — they may have placed in).
 *
 * Business rule: if a paid plan would extend past Conversation 5 (order 13),
 * the overflow becomes "extra courses" credit — the user is notified and the
 * client is eligible for Business/Conversation extras using their remaining
 * months as credit.
 */

const MAX_ORDER = 13;

// The full ordered curriculum.
const CURRICULUM = [
  { order: 1,  track: 'Starter',       level: 1 },
  { order: 2,  track: 'Starter',       level: 2 },
  { order: 3,  track: 'Starter',       level: 3 },
  { order: 4,  track: 'General',       level: 1 },
  { order: 5,  track: 'General',       level: 2 },
  { order: 6,  track: 'General',       level: 3 },
  { order: 7,  track: 'General',       level: 4 },
  { order: 8,  track: 'General',       level: 5 },
  { order: 9,  track: 'Conversation',  level: 1 },
  { order: 10, track: 'Conversation',  level: 2 },
  { order: 11, track: 'Conversation',  level: 3 },
  { order: 12, track: 'Conversation',  level: 4 },
  { order: 13, track: 'Conversation',  level: 5 },
];

// Lookup maps for O(1) access.
const _byKey = new Map();   // "Starter|1" → 1
const _byOrder = new Map(); // 1 → { track:'Starter', level:1 }
for (const c of CURRICULUM) {
  _byKey.set(`${c.track}|${c.level}`, c.order);
  _byOrder.set(c.order, c);
}

/**
 * Convert (track, level) → global order, or null if invalid.
 *
 *   orderOf('Starter', 1)      → 1
 *   orderOf('General', 5)      → 8
 *   orderOf('Conversation', 5) → 13
 *   orderOf('General', 99)     → null
 */
function orderOf(track, level) {
  if (track == null || level == null) return null;
  const key = `${track}|${Number(level)}`;
  return _byKey.get(key) || null;
}

/**
 * Convert global order → { track, level }, or null if out of range.
 *
 *   levelAtOrder(1)  → { track:'Starter',      level:1 }
 *   levelAtOrder(8)  → { track:'General',      level:5 }
 *   levelAtOrder(13) → { track:'Conversation', level:5 }
 *   levelAtOrder(14) → null
 */
function levelAtOrder(order) {
  return _byOrder.get(Number(order)) || null;
}

/**
 * Parse a file name like "Starter 2.xlsx" / "General 3.xlsx" / "CON 4.xlsx"
 * into { track, level, order }.
 *
 *   parseFileName("Starter 2.xlsx")  → { track:'Starter', level:2, order:2 }
 *   parseFileName("General 3.xlsx")  → { track:'General', level:3, order:6 }
 *   parseFileName("CON 4.xlsx")      → { track:'Conversation', level:4, order:12 }
 *   parseFileName("Con_5")           → { track:'Conversation', level:5, order:13 }
 *   parseFileName("garbage.xlsx")    → null
 */
function parseFileName(fname) {
  if (!fname) return null;
  let base = String(fname).replace(/\.xlsx?$/i, '').trim();
  // Dept-prefixed file names — the Private folder names its files
  // "Private General 4" / "Private CON 3" (and Semi may use "2 in 1 …").
  // The dept comes from the parent FOLDER, so the prefix carries no level info;
  // strip it (repeatedly, for combos like "Private 2 in 1 …") before matching.
  // Without this the anchored patterns below return null and the WHOLE file is
  // skipped — the entire Private/Semi completed-levels never ingested (0 rows).
  // "p" alone covers the Semi folder's "P General 4.xlsx" naming. Safe: it only
  // strips when followed by a separator, so "Private…" is eaten by its own
  // alternative and no track keyword starts with "p ".
  base = base.replace(/^(?:(?:private|semi|p|2\s*in\s*1|2n1)[\s_-]+)+/i, '');

  // Conversation: "CON 1" / "Conversation 1" / "Con_1" / "Con1"
  let m = base.match(/^(?:con(?:versation)?)[\s_-]*([1-5])$/i);
  if (m) return { track: 'Conversation', level: Number(m[1]), order: orderOf('Conversation', m[1]) };

  // General: "General 1" / "Gen 1" / "G 1"
  m = base.match(/^(?:general|gen|g)[\s_-]*([1-5])$/i);
  if (m) return { track: 'General', level: Number(m[1]), order: orderOf('General', m[1]) };

  // Starter: "Starter 1" / "Start 1" / "S 1"
  m = base.match(/^(?:starter|start|s)[\s_-]*([1-3])$/i);
  if (m) return { track: 'Starter', level: Number(m[1]), order: orderOf('Starter', m[1]) };

  return null;
}

/**
 * Given a client's earliest completed order and the paid plan length in
 * months, compute the planned levels and remaining-pending levels.
 *
 *   startOrder: the order of the earliest level we saw them in.
 *   paidMonths: how many months they paid for (= number of levels).
 *   completedOrders: array of orders already marked as done (from Drive files).
 *
 * Returns:
 *   {
 *     plannedOrders:   [orders they should take],
 *     completedOrders: [orders done],
 *     pendingOrders:   [orders still to take],
 *     overflowMonths:  N,            // months that exceed Con 5 = credit for extras
 *     reachedConversation5: boolean, // they finished Con 5 already?
 *   }
 */
function computePlan(startOrder, paidMonths, completedOrders = []) {
  const start = Number(startOrder);
  const months = Number(paidMonths);
  const done = new Set((completedOrders || []).map(Number));

  if (!start || !months) {
    return { plannedOrders: [], completedOrders: [...done], pendingOrders: [], overflowMonths: 0, reachedConversation5: false };
  }

  const planned = [];
  let overflow = 0;
  for (let i = 0; i < months; i++) {
    const o = start + i;
    if (o > MAX_ORDER) overflow++;
    else planned.push(o);
  }
  const pending = planned.filter(o => !done.has(o));
  const reachedC5 = done.has(MAX_ORDER);

  return {
    plannedOrders: planned,
    completedOrders: [...done].sort((a,b) => a-b),
    pendingOrders: pending,
    overflowMonths: overflow,
    reachedConversation5: reachedC5,
  };
}

/**
 * Aggregate "completed levels" rows (from cs_completed_levels) for one client
 * into a sorted array of distinct orders.
 *
 *   rows: [{ track:'General', level_number:3 }, { track:'General', level_number:4 }, ...]
 *   → [6, 7]
 */
function rowsToOrders(rows) {
  const set = new Set();
  for (const r of rows || []) {
    const o = orderOf(r.track, r.level_number);
    if (o) set.add(o);
  }
  return [...set].sort((a, b) => a - b);
}

module.exports = {
  MAX_ORDER,
  CURRICULUM,
  orderOf,
  levelAtOrder,
  parseFileName,
  computePlan,
  rowsToOrders,
};
