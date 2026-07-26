// Trainer-side DISPLAY merge (Owner 2026-07-20): شبه خاص + خاص are served by the
// SAME trainers (a semi trainer with idle time teaches private lectures), so the
// trainer-facing pages (occupancy, recruitment, team roster) show them as ONE
// section «خاص وشبه خاص». Likewise their phone-call sub-sections.
//
// DISPLAY ONLY — the backend data + each trainer's stored section are untouched,
// so it's fully reversible and the sensitive capacity/salary numbers are unchanged.
// NOT applied to the client side (تسليمات الأقسام).
// Verified live 2026-07-20: 0 trainers have both a semi AND a private active shift,
// so the two section groups are disjoint → summing them is exact (no double-count).

export const mergeSecKey = (sec) => {
  const s = String(sec || '');
  if (s === 'semi' || s === 'private') return 'privsemi';
  if (s === 'phone_call_semi' || s === 'phone_call_private') return 'phone_call_privsemi';
  return s;
};

export const MERGED_SEC_LABEL = {
  privsemi: 'خاص وشبه خاص',
  phone_call_privsemi: 'فون كول خاص وشبه خاص',
};

// Label for any section key, honoring the merge. `base` = the page's own map.
export const secLabel = (sec, base = {}) => MERGED_SEC_LABEL[sec] || base[sec] || base[mergeSecKey(sec)] || sec;

// Collapse a per-section array [{section, label, ...}] by mergeSecKey: sum numeric
// fields, concat array fields, keep the first of anything else, then run an
// optional `recompute(mergedRow)` for derived fields (%, ÷N, …). Order preserved.
export function collapseSections(sections, recompute) {
  const byKey = new Map();
  const order = [];
  for (const s of (sections || [])) {
    const key = mergeSecKey(s.section);
    if (!byKey.has(key)) {
      byKey.set(key, { ...s, section: key, label: MERGED_SEC_LABEL[key] || s.label });
      order.push(key);
    } else {
      const acc = byKey.get(key);
      for (const [k, v] of Object.entries(s)) {
        if (k === 'section' || k === 'label') continue;
        if (typeof v === 'number') acc[k] = (typeof acc[k] === 'number' ? acc[k] : 0) + v;
        else if (Array.isArray(v)) acc[k] = (Array.isArray(acc[k]) ? acc[k] : []).concat(v);
        else if (v && typeof v === 'object') {
          // number-map (e.g. capacity_by_side_pair {pair: calls}) → sum per key
          acc[k] = { ...(acc[k] || {}) };
          for (const [ik, iv] of Object.entries(v)) if (typeof iv === 'number') acc[k][ik] = (acc[k][ik] || 0) + iv;
        }
      }
    }
  }
  const out = order.map((k) => byKey.get(k));
  if (typeof recompute === 'function') out.forEach(recompute);
  return out;
}

// Merge an array of objects that carry their OWN section-like grouping under a
// day-pair (recruitment «استقلال» rows: [{main_pair, groups, students, ...}]).
// Sums numeric fields per `keyField` value. Used after concatenating two sections'
// rows so a duplicated day-pair collapses back to one row.
export function collapseRowsByKey(rows, keyField, recompute) {
  const byKey = new Map();
  const order = [];
  for (const r of (rows || [])) {
    const key = r[keyField];
    if (!byKey.has(key)) { byKey.set(key, { ...r }); order.push(key); }
    else {
      const acc = byKey.get(key);
      for (const [k, v] of Object.entries(r)) {
        if (k === keyField) continue;
        if (typeof v === 'number') acc[k] = (typeof acc[k] === 'number' ? acc[k] : 0) + v;
        else if (Array.isArray(v)) acc[k] = (Array.isArray(acc[k]) ? acc[k] : []).concat(v);
      }
    }
  }
  const out = order.map((k) => byKey.get(k));
  if (typeof recompute === 'function') out.forEach(recompute);
  return out;
}
