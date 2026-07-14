'use strict';

/**
 * Group-matching primitives shared by the "deleted groups" review pipeline:
 *   - the All-Batches reference ingest  (populates canon_key / slot_key)
 *   - the suggestion engine             (which completed-level groups have NO match)
 *   - the exclusion in buildInactiveGroupMap
 *
 * Two keys per group name:
 *   canonKey — exact identity: text before the first "(", spaces stripped, lower.
 *              (drops the "(trainer)" paren + trailing coordinator suffix)
 *   slotKey  — month + day-of-WEEK + time + level-family+number. The day-of-MONTH
 *              is deliberately DROPPED so a group written with a slightly different
 *              date (e.g. Jun_20 vs the real Jun_13, same Sat 5pm General1) still
 *              matches. Returns null when any component is unparseable.
 *
 * Verified 2026-07-14 on the owner's examples: Jun_20_Sat_5Pm_General1 slot-matches
 * the real Jun_13_Sat_5Pm_General1 (kept), while a genuinely-deleted group with no
 * counterpart matches nothing.
 */

const STATUS_WORD_RE = /\s*(نشطة|نشطه|إنتهت|انتهت|منته\S*|ملغا\S*|active|ended|closed)\s*$/i;
function cleanGroupCode(raw) {
  let s = String(raw == null ? '' : raw).split(/[\r\n]+/)[0].trim();
  s = s.replace(STATUS_WORD_RE, '').trim();
  s = s.replace(STATUS_WORD_RE, '').trim();
  return s;
}

const canonKey = (s) => cleanGroupCode(s).split('(')[0].replace(/\s/g, '').toLowerCase();

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DOW = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
function parseGroup(s) {
  const b = String(s == null ? '' : s).split('(')[0].toLowerCase().replace(/[_\s]+/g, ' ').trim();
  let mon = null;
  const mm = b.match(/^([a-z]{3,})/);
  if (mm) { let m = mm[1].slice(0, 3); if (m === 'jnu') m = 'jun'; if (m === 'jly') m = 'jul'; if (MON[m]) mon = MON[m]; }
  const toks = b.split(' ');
  const dow = DOW.find(d => toks.includes(d)) || null;
  const tm = b.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  let time = null;
  if (tm) { let h = (+tm[1]) % 12; if (tm[3] === 'pm') h += 12; time = h * 100 + (tm[2] ? +tm[2] : 0); }
  const fm = b.match(/(conversation|conv|con|general|gen|genral|genera|starter|str)\s*_?\s*(\d+)/);
  let fam = null, lvl = null;
  if (fm) { fam = /^con/.test(fm[1]) ? 'C' : /^(gen|general|genra|genera)/.test(fm[1]) ? 'G' : 'S'; lvl = +fm[2]; }
  return { mon, dow, time, fam, lvl };
}
function slotKey(s) {
  const g = parseGroup(s);
  if (g.mon == null || g.dow == null || g.time == null || g.fam == null || g.lvl == null) return null;
  return `${g.mon}-${g.dow}-${g.time}-${g.fam}${g.lvl}`;
}

// Name tokens (>=4 chars, non-stopword) for trainer/coordinator matching.
const STOP = new Set(['semi', 'private', 'con', 'conv', 'conversation', 'general', 'gen', 'genral', 'genera', 'starter', 'str', 'replace', 'teacher', 'account', 'new', 'sales', 'week', 'night', 'business', 'bundel', 'placement', 'test', 'onboarding', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']);
function nameTokens(...parts) {
  const set = new Set();
  for (const p of parts) {
    for (const t of String(p || '').toLowerCase().replace(/\(z\.?[cm]\)|\(zc\)|\(zm\)/g, ' ').split(/[^a-z]+/)) {
      if (t.length >= 4 && !STOP.has(t)) set.add(t);
    }
  }
  return set;
}
// Does the name carry a real "(trainer)" paren (letters inside)?
const hasTrainer = (g) => /\([^)]*[a-zA-Z؀-ۿ][^)]*\)/.test(String(g || ''));

module.exports = { cleanGroupCode, canonKey, slotKey, parseGroup, nameTokens, hasTrainer };
