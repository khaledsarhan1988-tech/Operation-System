'use strict';

/**
 * «عملاء غير مسجلين في كشف العملاء» — TEMPORARY review page (owner 2026-07-22).
 *
 * Lists every client who appears in a REAL group but has NO membership row in
 * cs_sales_register, graded by the evidence found for each one so the owner
 * reviews facts rather than guesses:
 *
 *   need   — no trace at all in the register       → register the membership
 *   likely — unique name + phone differs by ≤2     → almost certainly a typo
 *   review — name matches but the name is common,  → owner's judgement
 *            or the phone is completely different
 *   staff  — matches فريق العمل / an impossible
 *            client journey (>13 levels)           → not a client
 *
 * Phones go through the same normalization + alias fold as تسليمات الأقسام, so
 * the "00" prefix fix and multi-number register cells are already accounted for.
 * Per-client notes live in cs_unregistered_notes (drop it with the page).
 *
 * Read-only over the cs_* data; the only write is the note.
 */

const db = require('../config/database');
const { saveNow } = require('../config/database');
const { csPrimaryPhone } = require('../utils/csPhoneNormalize');
const { isIgnoredGroup } = require('../utils/csGroupHelpers');
const csDel = require('./csDeliveries.service');

// Everything first seen BEFORE this date is the one-off backlog the owner
// cleaned in July 2026. It stays visible but is tagged `legacy` so the page can
// default to what appeared AFTER the cleanup — the cases that still need acting
// on. Owner decision 2026-07-24.
const LEGACY_CUTOFF = '2026-07-24';

const digits = (s) => String(s || '').replace(/\D/g, '');
const normName = (s) => String(s || '').split(/[\r\n]/)[0]
  .replace(/[ـً-ْ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();

// edit distance between two phone strings (cheap, capped)
function digitDist(a, b) {
  a = digits(a); b = digits(b);
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}

function getUnregisteredClients() {
  const alias = csDel.buildPhoneAliasMap();

  // ── register indexes ──
  const registered = new Set(), regByName = new Map(), nameCount = new Map();
  for (const r of db.prepare(`SELECT mobile_no, client_name, courses FROM cs_sales_register
                               WHERE mobile_no IS NOT NULL AND TRIM(mobile_no) <> ''`).all()) {
    const p = csPrimaryPhone(r.mobile_no); if (!p) continue;
    registered.add(p); registered.add(alias.get(p) || p);
    const n = normName(r.client_name);
    if (n && n.length > 4) {
      nameCount.set(n, (nameCount.get(n) || 0) + 1);
      if (!regByName.has(n)) regByName.set(n, r);
    }
  }
  for (const [sec, pri] of alias) if (registered.has(sec)) registered.add(pri);

  // ── staff index ──
  const staffTail = new Map(), staffName = new Map();
  for (const r of db.prepare(`SELECT name, phone, job_title, department FROM team_members`).all()) {
    const d = digits(r.phone); if (d.length >= 9) staffTail.set(d.slice(-9), r);
    const n = normName(r.name); if (n && n.length > 4) staffName.set(n, r);
  }
  for (const r of db.prepare(`SELECT full_name, role FROM users`).all()) {
    const n = normName(r.full_name);
    if (n && n.length > 4 && !staffName.has(n)) staffName.set(n, { name: r.full_name, job_title: r.role, department: 'مستخدم نظام' });
  }

  // ── everyone seen in a REAL group ──
  const seen = new Map();
  const note = (phone, name, group, when) => {
    const p0 = csPrimaryPhone(phone); if (!p0) return;
    const pn = alias.get(p0) || p0;
    const g = String(group || '').split(/[\r\n]/)[0].trim();
    if (!g || isIgnoredGroup(g)) return;
    let e = seen.get(pn);
    if (!e) { e = { name: null, groups: new Set(), first: '', last: '' }; seen.set(pn, e); }
    if (!e.name && name) e.name = String(name).split(/[\r\n]/)[0].trim();
    e.groups.add(g);
    if (when) { if (!e.first || when < e.first) e.first = when; if (when > e.last) e.last = when; }
  };
  for (const r of db.prepare(`SELECT name, phone, group_name, synced_at FROM clients
                               WHERE phone IS NOT NULL AND group_name IS NOT NULL`).all())
    note(r.phone, r.name, r.group_name, String(r.synced_at || '').slice(0, 10));
  for (const r of db.prepare(`SELECT client_name_raw n, client_phone_norm p, group_name_raw g, registration_date rd
                                FROM cs_completed_levels WHERE client_phone_norm IS NOT NULL`).all())
    note(r.p, r.n, r.g, String(r.rd || '').slice(0, 10));
  try {
    for (const r of db.prepare(`SELECT client_name_raw n, client_phone_norm p, group_name_raw g, first_seen fs, last_seen ls
                                  FROM cs_client_group_history`).all()) {
      note(r.p, r.n, r.g, r.fs || ''); note(r.p, r.n, r.g, r.ls || '');
    }
  } catch (_) { /* optional table */ }

  // ── notes ──
  const notes = new Map();
  try {
    for (const r of db.prepare(`SELECT client_phone_norm p, note, updated_by_name, updated_at FROM cs_unregistered_notes`).all())
      notes.set(r.p, r);
  } catch (_) { /* optional table */ }

  // ── grade ──
  const items = [];
  for (const [pn, e] of seen) {
    if (registered.has(pn)) continue;
    const d = digits(pn), tail = d.length >= 9 ? d.slice(-9) : null;
    const n = normName(e.name);
    const groups = [...e.groups];
    const row = {
      phone: pn, name: e.name || '', groups_count: groups.length, groups,
      first_seen: e.first || null, last_seen: e.last || null,
      // No first_seen at all → treat as legacy; an undated row is old data, and
      // calling it "new" would put it in the daily-watch list forever.
      is_legacy: !e.first || e.first < LEGACY_CUTOFF,
      note: notes.get(pn)?.note || '', note_by: notes.get(pn)?.updated_by_name || null,
      note_at: notes.get(pn)?.updated_at || null,
    };
    const st = (tail && staffTail.get(tail)) || (n && staffName.get(n));
    if (st || groups.length > 13) {
      items.push({ ...row, category: 'staff', evidence: st ? `${st.name || ''} — ${st.job_title || ''}` : 'رحلة غير منطقية لعميل', action: 'تجاهل — مش عميل' });
      continue;
    }
    const byName = n && n.length > 4 ? regByName.get(n) : null;
    if (byName) {
      const dup = nameCount.get(n) || 0;
      const dist = digitDist(pn, byName.mobile_no);
      const ev = `الكشف: ${byName.mobile_no} — ${byName.client_name || ''}${byName.courses ? ` (${byName.courses})` : ''}`;
      if (dup === 1 && dist <= 2) {
        items.push({ ...row, category: 'likely', evidence: `${ev} · فرق ${dist} خانة`, action: 'الأرجح خطأ كتابة رقم — صحّحه أو أضِفه كموبايل إضافي' });
      } else {
        items.push({ ...row, category: 'review', evidence: `${ev}${dup > 1 ? ` · الاسم متكرر (${dup} عملاء)` : ' · الرقم مختلف تمامًا'}`, action: 'قرارك: نفس الشخص أم لا' });
      }
      continue;
    }
    items.push({ ...row, category: 'need', evidence: 'مفيش أي أثر له في كشف العملاء', action: 'تسجيل العضوية' });
  }

  items.sort((a, b) => (b.groups_count - a.groups_count) || String(b.last_seen || '').localeCompare(String(a.last_seen || '')));
  const counts = { all: items.length, need: 0, likely: 0, review: 0, staff: 0, with_note: 0, legacy: 0, fresh: 0 };
  for (const i of items) {
    counts[i.category]++;
    if (i.note) counts.with_note++;
    if (i.is_legacy) counts.legacy++; else counts.fresh++;
  }
  return { counts, cutoff: LEGACY_CUTOFF, total_in_groups: seen.size, registered: seen.size - items.length, items };
}

function setNote({ phone, note, userId, userName }) {
  const pn = csPrimaryPhone(phone);
  if (!pn) throw new Error('Invalid phone');
  const txt = String(note == null ? '' : note).trim();
  if (!txt) {
    db.prepare(`DELETE FROM cs_unregistered_notes WHERE client_phone_norm = ?`).run(pn);
  } else {
    db.prepare(`
      INSERT INTO cs_unregistered_notes (client_phone_norm, note, updated_by, updated_by_name, updated_at)
      VALUES (?, ?, ?, ?, datetime('now', '+2 hours'))
      ON CONFLICT(client_phone_norm) DO UPDATE SET
        note = excluded.note, updated_by = excluded.updated_by,
        updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at
    `).run(pn, txt, userId || null, userName || null);
  }
  saveNow();
  return { phone: pn, note: txt };
}

module.exports = { getUnregisteredClients, setNote };
