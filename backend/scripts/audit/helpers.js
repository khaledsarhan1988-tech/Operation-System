/* Shared pure helpers for audit checks (parsing, interval math, dates). */
const DOWK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const getDow = s => new Date(s + 'T12:00:00').getDay();
const strip = s => String(s || '').replace(/\([^)]*\)/g, '').trim().toLowerCase();
const hm = s => { if (!s) return null; const m = String(s).match(/^(\d{1,2}):(\d{2})$/); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const hmEnd = s => { const v = hm(s); return v === 0 ? 1440 : v; };
const parseTime12 = t => { if (!t) return -1; const m = String(t).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i); if (!m) return -1; let h = +m[1], mn = +m[2]; if ((m[3] || '').toUpperCase() === 'PM' && h < 12) h += 12; if ((m[3] || '').toUpperCase() === 'AM' && h === 12) h = 0; return h * 60 + mn; };
const parseDur = d => { if (!d) return 0; const m = String(d).match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : 0; };
function mergeIntervals(iv) { if (!iv.length) return 0; const a = iv.slice().sort((x, y) => x[0] - y[0]); let tot = 0, [cs, ce] = a[0]; for (let i = 1; i < a.length; i++) { const [s, e] = a[i]; if (s <= ce) { if (e > ce) ce = e; } else { tot += ce - cs; cs = s; ce = e; } } tot += ce - cs; return tot; }
function datesBetween(from, to) { const out = []; let d = new Date(from + 'T12:00:00'); const end = new Date(to + 'T12:00:00'); while (d <= end) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); } return out; }
// recursively scan a JSON value for numeric red flags
function scanNumbers(obj, onBad, pathStr = '') {
  if (obj == null) return;
  if (typeof obj === 'number') { if (Number.isNaN(obj)) onBad(pathStr, 'NaN'); else if (!Number.isFinite(obj)) onBad(pathStr, 'Infinity'); return; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => scanNumbers(v, onBad, `${pathStr}[${i}]`)); return; }
  if (typeof obj === 'object') { for (const k of Object.keys(obj)) scanNumbers(obj[k], onBad, pathStr ? `${pathStr}.${k}` : k); }
}
module.exports = { DOWK, getDow, strip, hm, hmEnd, parseTime12, parseDur, mergeIntervals, datesBetween, scanNumbers };
