/* Deep audit of «تسليمات الأقسام» (/cs/deliveries) + the membership-balance layer
 * that the Enr Groups feature reuses.
 *
 * HARD checks (pass/fail):
 *  1. derived consistency (per client): remaining_levels == max(0, paid_months −
 *     groups_taken); groups_taken == active_groups + inactive_groups;
 *     paid_months == Σ months_list; membership_count == months_list.length.
 *  2. sanity: paid_months ≥ 0, groups_taken ≥ 0, 0 ≤ remaining_levels ≤ paid_months.
 *  3. balance-layer reconciliation: csDeliveries.membershipBalance(ctx, phone, dept)
 *     .remaining == the deliveries remaining_levels for EVERY client — the Enr Groups
 *     «المتبقّي/بعد النقل» badges + «محتاج تجديد» list reuse this layer, so it MUST
 *     equal the page (an independent code path that must reconcile).
 *  4. cross-endpoint: every /cs/enr-groups/renewals client appears in /cs/deliveries
 *     for that dept with remaining_levels ≤ 1 (the renewals list is a strict subset).
 *
 * Pages through every client per dept (cap MAX_PAGES, coverage logged).
 * NOTE: /cs/deliveries reads dept + page + page_size (page_size capped at 200).
 */
const path = require('path');

module.exports = async function deliveries({ call }) {
  const checks = [];
  const add = (name, fails) => checks.push({ name, pass: fails.length === 0, fails: fails.slice(0, 20), count: fails.length });
  const csD = require(path.join(__dirname, '..', '..', '..', 'src', 'services', 'csDeliveries.service'));
  const DEPTS = csD.DEPTS;
  const ctx = csD.buildBalanceContext();   // built once for the balance reconciliation

  const MAX_PAGES = 40;
  const derivedFails = [], sanityFails = [], balanceFails = [];
  const delivRemaining = new Map();   // `dept|phone` → remaining_levels (for the renewals cross-check)
  let totalClients = 0, capped = false;
  const id = (dept, it) => `${dept}/${it.name || it.phone}`;

  for (const dept of DEPTS) {
    let page = 1, pages = 1;
    do {
      const r = (await call(`/cs/deliveries?dept=${dept}&page=${page}&page_size=200`)).json;
      const items = (r && r.items) || [];
      pages = (r && r.total_pages) || 1;
      for (const it of items) {
        totalClients++;
        delivRemaining.set(`${dept}|${it.phone}`, it.remaining_levels);
        const paid = it.paid_months, taken = it.groups_taken, rem = it.remaining_levels;
        const ag = (it.active_groups || []).length, ig = (it.inactive_groups || []).length;
        const sumMonths = (it.months_list || []).reduce((s, m) => s + (Number(m) || 0), 0);

        // 1. derived consistency
        if (taken !== ag + ig) derivedFails.push(`${id(dept, it)}: groups_taken ${taken} ≠ active ${ag}+inactive ${ig}`);
        // Settled (تسوية) memberships are CLOSED by an owner-approved deal —
        // remaining is 0 by decision, not by paid-minus-taken.
        if (it.settled) {
          if (rem !== 0) derivedFails.push(`${id(dept, it)}: settled but remaining ${rem} ≠ 0`);
        } else if (paid != null && rem !== Math.max(0, paid - taken)) derivedFails.push(`${id(dept, it)}: remaining ${rem} ≠ max(0,${paid}−${taken})`);
        if (paid != null && paid !== sumMonths) derivedFails.push(`${id(dept, it)}: paid_months ${paid} ≠ Σ months_list ${sumMonths}`);
        if (it.membership_count !== (it.months_list || []).length) derivedFails.push(`${id(dept, it)}: membership_count ${it.membership_count} ≠ months_list.len ${(it.months_list || []).length}`);

        // 2. sanity
        if (paid != null && paid < 0) sanityFails.push(`${id(dept, it)}: negative paid ${paid}`);
        if (taken < 0) sanityFails.push(`${id(dept, it)}: negative groups_taken ${taken}`);
        if (rem != null && rem < 0) sanityFails.push(`${id(dept, it)}: negative remaining ${rem}`);
        if (rem != null && paid != null && rem > paid) sanityFails.push(`${id(dept, it)}: remaining ${rem} > paid ${paid}`);

        // 3. balance layer == deliveries
        const bal = csD.membershipBalance(ctx, it.phone, dept);
        if ((bal.remaining ?? null) !== (rem ?? null)) balanceFails.push(`${id(dept, it)}: balance ${bal.remaining} ≠ deliveries ${rem}`);
      }
      page++;
      if (page > MAX_PAGES) { capped = true; break; }
    } while (page <= pages);
  }
  add('derived consistency (remaining/taken/paid/count)', derivedFails);
  add('sanity (non-negative, remaining ≤ paid)', sanityFails);
  add('balance-layer == deliveries remaining_levels', balanceFails);

  // 4. renewals ⊆ deliveries(remaining ≤ 1) — cross-endpoint, against the actual
  // deliveries page output (not the balance layer).
  const renFails = [];
  const ren = (await call('/cs/enr-groups/renewals')).json;
  const renItems = (ren && ren.items) || [];
  for (const r of renItems) {
    const dr = delivRemaining.get(`${r.dept}|${r.phone}`);
    if (dr === undefined) { if (!capped) renFails.push(`${r.dept}/${r.name || r.phone}: in renewals but NOT in deliveries`); }
    else if (dr > 1) renFails.push(`${r.dept}/${r.name || r.phone}: in renewals but deliveries remaining=${dr}`);
  }
  add('renewals ⊆ deliveries remaining ≤ 1', renFails);

  return {
    area: 'deliveries',
    meta: `clients=${totalClients}${capped ? ` (CAPPED ${MAX_PAGES}p/dept)` : ''} renewals=${renItems.length}`,
    checks,
  };
};
