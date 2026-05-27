'use strict';

/**
 * cs_* — Per-client plan computation.
 *
 * For a given client (identified by normalized phone), combine:
 *   - subscriptions (sum of paid months across rows)
 *   - completed levels (which 1..13 orders are done)
 * to derive the planned / completed / pending levels.
 *
 * Output is plain JSON ready for the UI. No writes.
 */

const db = require('../config/database');
const { csPrimaryPhone } = require('../utils/csPhoneNormalize');
const { computePlan, levelAtOrder, orderOf, MAX_ORDER } = require('../utils/csLevelOrder');

/**
 * Sum all paid months for a client. Subscriptions marked is_ignored=1 are
 * excluded. We sum across all non-ignored rows for the same phone.
 *
 * Returns { total_paid_months, subscription_count, depts: Set, breakdown: [...] }
 */
function aggregatePaid(phoneNorm) {
  const rows = db.prepare(`
    SELECT id, source, dept, months, is_installment, subscription_date,
           product_name_raw, created_at
      FROM cs_subscriptions
     WHERE client_phone_norm = ? AND is_ignored = 0 AND months IS NOT NULL
     ORDER BY created_at ASC, id ASC
  `).all(phoneNorm);

  let totalMonths = 0;
  const depts = new Set();
  for (const r of rows) {
    totalMonths += Number(r.months) || 0;
    if (r.dept) depts.add(r.dept);
  }
  return {
    total_paid_months: totalMonths,
    subscription_count: rows.length,
    depts: [...depts],
    breakdown: rows,
  };
}

/**
 * Fetch all completed-level rows for a client.
 */
function fetchCompleted(phoneNorm) {
  return db.prepare(`
    SELECT track, level_number, level_order, drive_file_name, drive_folder,
           dept, group_name_raw, registration_date, synced_at
      FROM cs_completed_levels
     WHERE client_phone_norm = ?
     ORDER BY level_order ASC
  `).all(phoneNorm);
}

/**
 * Determine the "start order" — the lowest level_order in the completed list.
 * If the client has NO completed levels yet, start = 1 (Starter 1) by default.
 *
 * Business rule: "if a client appears in General 3 with no record of S/G1/G2,
 * their journey starts at General 3 — we don't assume they completed prior".
 * So the start order is just min(completedOrders) — NOT 1 by default.
 */
function determineStartOrder(completedOrders) {
  if (!completedOrders.length) return null;
  return Math.min(...completedOrders);
}

/**
 * Build the full per-client plan view.
 *
 *   phoneOrId: phone string or clients.id integer
 *
 * Returns:
 *   {
 *     client_phone_norm,
 *     paid: { total_paid_months, subscription_count, depts, breakdown: [...] },
 *     completed: [{ track, level_number, level_order, ... }, ...],
 *     plan: { startOrder, plannedOrders, completedOrders, pendingOrders, overflowMonths, reachedConversation5 },
 *     planned_levels: [{ track, level, order, status: 'completed'|'pending' }, ...],
 *     pending_levels: [{ track, level, order }, ...],
 *     extra_courses_eligible: boolean,
 *     summary: { paid_months, completed_count, pending_count, max_reached_level, days_since_last_level }
 *   }
 */
function getClientPlan(phoneOrId) {
  let phoneNorm = null;
  if (typeof phoneOrId === 'number' || /^\d+$/.test(String(phoneOrId))) {
    // Looks like a clients.id — resolve to phone
    const row = db.prepare(`SELECT phone FROM clients WHERE id = ?`).get(Number(phoneOrId));
    if (row?.phone) phoneNorm = csPrimaryPhone(row.phone);
  }
  if (!phoneNorm) phoneNorm = csPrimaryPhone(phoneOrId);
  if (!phoneNorm) return null;

  const paid = aggregatePaid(phoneNorm);
  const completed = fetchCompleted(phoneNorm);
  const completedOrders = completed.map(r => r.level_order);

  const startOrder = determineStartOrder(completedOrders);
  const plan = computePlan(startOrder || 1, paid.total_paid_months || 0, completedOrders);

  // Build a label-friendly planned list
  const plannedLevels = plan.plannedOrders.map(o => {
    const lvl = levelAtOrder(o);
    return {
      track: lvl?.track,
      level: lvl?.level,
      order: o,
      status: plan.completedOrders.includes(o) ? 'completed' : 'pending',
    };
  });
  const pendingLevels = plan.pendingOrders.map(o => {
    const lvl = levelAtOrder(o);
    return { track: lvl?.track, level: lvl?.level, order: o };
  });

  // Days since the most recent completed-level synced_at (proxy for inactivity).
  let daysSinceLastLevel = null;
  let lastLevelDate = null;
  if (completed.length) {
    // Use the latest registration_date (or synced_at as fallback) of the highest order.
    const sorted = [...completed].sort((a, b) => b.level_order - a.level_order);
    const top = sorted[0];
    const dStr = top.registration_date || top.synced_at;
    if (dStr) {
      const d = new Date(dStr);
      if (!isNaN(d.getTime())) {
        lastLevelDate = dStr;
        daysSinceLastLevel = Math.floor((Date.now() - d.getTime()) / 86400000);
      }
    }
  }

  const maxReachedOrder = completedOrders.length ? Math.max(...completedOrders) : null;
  const maxReachedLabel = maxReachedOrder ? (() => { const l = levelAtOrder(maxReachedOrder); return l ? `${l.track} ${l.level}` : null; })() : null;

  return {
    client_phone_norm: phoneNorm,
    paid,
    completed,
    plan: { ...plan, startOrder },
    planned_levels: plannedLevels,
    pending_levels: pendingLevels,
    extra_courses_eligible: plan.reachedConversation5 && (paid.total_paid_months || 0) > 0
                              && (startOrder || 1) + (paid.total_paid_months || 0) - 1 > MAX_ORDER,
    summary: {
      paid_months: paid.total_paid_months,
      completed_count: completed.length,
      pending_count: plan.pendingOrders.length,
      max_reached_order: maxReachedOrder,
      max_reached_label: maxReachedLabel,
      overflow_months: plan.overflowMonths,
      last_level_date: lastLevelDate,
      days_since_last_level: daysSinceLastLevel,
      depts_paid: paid.depts,
    },
  };
}

module.exports = {
  getClientPlan,
  aggregatePaid,
  fetchCompleted,
  determineStartOrder,
};
