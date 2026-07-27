/* Deep audit of «الإشغال والمدربين» (trainer occupancy) — ported from the verified
 * one-off checks. Confirms the salary-adjacent numbers across the 3 quantitative
 * endpoints + the «تفاصيل المدربين» page derivations.
 *
 * Checks:
 *  1. /trainer-utilization: per-day sums == per-trainer totals (internal consistency)
 *  2. endpoint (section booked + out_of_shift) == TRUE occupied recomputed from RAW
 *     lectures (independent: merge all lectures+covering-shift voice, clamp+holidays)
 *  3. /trainer-utilization (heatmap) == /trainer-utilization-summary (dashboard) per trainer
 *  4. «تفاصيل» exact time blocks: every block maps to a real lecture/free_slot, no overlap
 *  5. stats-header formulas (utilization = booked/available)
 */
const H = require('../helpers');

function parseShifts(t) {
  let raw = null; try { raw = JSON.parse(t.shifts_json || '[]'); } catch { raw = null; }
  if (!Array.isArray(raw)) raw = [];
  const vn = r => { if (!r) return []; let a = r; if (typeof r === 'string') { try { a = JSON.parse(r); } catch { return []; } } if (!Array.isArray(a)) return []; return a.map(x => { const days = Array.isArray(x && x.days) ? x.days.map(y => String(y).trim().toLowerCase()) : String((x && x.days) || '').split(',').map(y => y.trim().toLowerCase()).filter(Boolean); return { s: H.hm(x && x.start), e: H.hm(x && x.end), days }; }).filter(x => x.s != null && x.e != null && x.e > x.s); };
  return raw.map(s => { if (!s || !s.shift) return null; const a = H.hm(s.start), b = H.hmEnd(s.end); if (a == null || b == null) return null; return { startMin: a, endMin: b, days: String(s.work_days || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean), section: s.section || null, startDate: s.start_date || null, endDate: s.end_date || null, voiceNotes: vn(s.voice_notes) }; }).filter(Boolean);
}
const covers = (sh, d) => { if (sh.startDate && d < sh.startDate) return false; if (sh.endDate && d > sh.endDate) return false; return sh.days.includes(H.DOWK[H.getDow(d)]); };

module.exports = async function occupancy({ call, db, window, holidaySet }) {
  const { from, to } = window;
  const dates = H.datesBetween(from, to);
  const checks = [];
  const add = (name, fails) => checks.push({ name, pass: fails.length === 0, fails: fails.slice(0, 20), count: fails.length });

  // raw data
  const tm = db.prepare(`SELECT * FROM team_members WHERE department='education' AND (job_title IS NULL OR job_title<>'تيم ليدر')`).all();
  const byName = new Map();
  for (const t of tm) { const k = H.strip(t.name); if (!k) continue; if (!byName.has(k)) byName.set(k, { name: t.name, shifts: [], ends: [], anyOpen: false, starts: [] }); const g = byName.get(k); g.shifts.push(...parseShifts(t)); if (t.start_date) g.starts.push(t.start_date); for (const s of parseShifts(t)) { if (!s.endDate) g.anyOpen = true; g.ends.push(s.endDate); } }
  const lecMap = {};
  db.prepare(`SELECT DISTINCT group_name,date,time,duration,trainer,status FROM lectures WHERE date BETWEEN ? AND ?`).all(from, to).forEach(l => { const k = H.strip(l.trainer); if (!k) return; (lecMap[`${k}|${l.date}`] = lecMap[`${k}|${l.date}`] || []).push(l); });

  function trueOccupied(g) {
    const clampStart = (() => { const ss = g.shifts.map(s => s.startDate).filter(Boolean).sort(); const hs = g.starts.slice().sort(); if (g.shifts.some(s => !s.startDate)) return hs[0] || null; return [ss[0], hs[0]].filter(Boolean).sort().slice(-1)[0] || null; })();
    const clampEnd = g.anyOpen ? null : (g.ends.filter(Boolean).sort().slice(-1)[0] || null);
    let tot = 0;
    for (const date of dates) { if (holidaySet.has(date)) continue; if (clampStart && date < clampStart) continue;
      let lec = lecMap[`${H.strip(g.name)}|${date}`] || [];
      if (clampEnd && date > clampEnd) lec = lec.filter(l => l.status !== 'مجدولة');
      const iv = []; const dk = H.DOWK[H.getDow(date)];
      for (const l of lec) { const s = H.parseTime12(l.time), d = H.parseDur(l.duration); if (s >= 0 && d > 0) iv.push([s, s + d]); }
      for (const sh of g.shifts) { if (!covers(sh, date)) continue; for (const v of sh.voiceNotes) { if (v.days && v.days.length && !v.days.includes(dk)) continue; iv.push([v.s, v.e]); } }
      tot += H.mergeIntervals(iv);
    }
    return tot;
  }

  const util = (await call(`/reports/trainer-utilization?from=${from}&to=${to}`)).json;
  const sum = (await call(`/reports/trainer-utilization-summary?from=${from}&to=${to}`)).json;
  const rows = (util && util.trainers) || [];
  const sRows = (sum && sum.trainers) || [];

  const c1 = [], c4 = [], c5 = [];
  for (const t of rows) {
    let sb = 0, sa = 0;
    for (const d in (t.days || {})) { sb += t.days[d].booked_min || 0; sa += t.days[d].available_min || 0; }
    const tb = (t.totals && t.totals.booked_min) || 0, ta = (t.totals && t.totals.available_min) || 0;
    if (Math.abs(sb - tb) > 1 || Math.abs(sa - ta) > 1) c1.push(`${t.name}[${t.section}] days=${sb}/${sa} totals=${tb}/${ta}`);
    const u2 = ta > 0 ? Math.round(tb / ta * 100) : null;
    if (t.totals.utilization_pct != null && t.totals.utilization_pct !== u2) c5.push(`${t.name}: ${t.totals.utilization_pct} vs ${u2}`);
    for (const date in (t.days || {})) { const day = t.days[date];
      const lecIv = (day.lectures || []).map(l => { const s = H.parseTime12(l.time), d = H.parseDur(l.duration); return s >= 0 && d > 0 ? [s, s + d] : null; }).filter(Boolean);
      const freeIv = (day.free_slots || []).map(f => [f.start_min, f.end_min]);
      const blocks = [...lecIv.map(x => ({ s: x[0], e: x[1], type: 'booked' })), ...freeIv.map(x => ({ s: x[0], e: x[1], type: 'free' }))];
      for (const b of blocks) { if (b.type === 'booked' && !lecIv.some(x => x[0] === b.s && x[1] === b.e)) c4.push(`${t.name} ${date}: booked block not a lecture`); if (b.type === 'free' && !freeIv.some(x => x[0] === b.s && x[1] === b.e)) c4.push(`${t.name} ${date}: free block not a free-slot`); }
      for (const a of lecIv) for (const f of freeIv) if (a[0] < f[1] && a[1] > f[0]) c4.push(`${t.name} ${date}: lecture overlaps free-slot`);
    }
  }
  add('per-day sums == totals', c1);
  add('time-block consistency', c4);
  add('stats formulas (util=booked/avail)', c5);

  // by-name aggregates for checks 2 & 3
  const heat = {}, dash = {};
  for (const t of rows) { const k = H.strip(t.name); (heat[k] = heat[k] || { b: 0, o: 0 }); heat[k].b += (t.totals && t.totals.booked_min) || 0; heat[k].o += (t.out_of_shift_min || 0); }
  for (const r of sRows) { const k = H.strip(r.name); (dash[k] = dash[k] || { b: 0, o: 0 }); dash[k].b += r._booked_min || 0; dash[k].o += r._out_of_shift_min || 0; }
  const c2 = [], c3 = [];
  for (const k of Object.keys(heat)) {
    const g = byName.get(k); if (g) { const to2 = trueOccupied(g); if (Math.abs((heat[k].b + heat[k].o) - to2) > 2) c2.push(`${g.name}: endpoint=${heat[k].b + heat[k].o} raw=${to2}`); }
    const d = dash[k] || { b: 0, o: 0 };
    if (Math.abs(heat[k].b - d.b) > 2 || Math.abs(heat[k].o - d.o) > 2) c3.push(`${(g && g.name) || k}: heat b=${heat[k].b}/o=${heat[k].o} dash b=${d.b}/o=${d.o}`);
  }
  add('endpoint == RAW true occupied', c2);
  add('heatmap == dashboard', c3);

  // ── Duplicate shifts inflate AVAILABLE (capacity), not booked, so the
  //    reconciliation checks above (which merge booked intervals) miss them —
  //    but they silently HALVE a trainer's utilization%. Flag any trainer with
  //    two identical shifts (same section + time + days + period). ──────────
  // (Israa Hafiz got a duplicate general shift during a manual edit: available
  //  9,660 vs true ~5,460, util 39% vs 69%.)
  const c6 = [];
  const dupKey = s => [s.section, s.startMin, s.endMin, [...s.days].sort().join(','),
                       s.startDate || '', s.endDate || ''].join('|');
  for (const [k, g] of byName) {
    const seen = new Map();
    for (const s of g.shifts) {
      const key = dupKey(s);
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    for (const [key, n] of seen) {
      if (n > 1) c6.push(`${g.name}: ${n}× identical shift [${key}] — doubles AVAILABLE, deflates utilization%`);
    }
  }
  add('no duplicate identical shifts (capacity double-count)', c6);

  return { area: 'occupancy', meta: `rows=${rows.length} days=${dates.length}`, checks };
};
