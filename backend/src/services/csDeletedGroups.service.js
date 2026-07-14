'use strict';

/**
 * Deleted-groups review pipeline (owner-gated).
 *
 * A group can appear in the completed-level files (cs_completed_levels) yet have
 * been DELETED by management before it really ran — it must NOT count as a
 * consumed level. We can't decide this automatically for every case (a real group
 * recorded with a slightly-off date looks identical to a deleted one), so:
 *
 *   1. Auto-match every completed-level group against the "All Batches" reference
 *      (cs_all_batches_ref) by exact canon OR date-tolerant slot (+ trainer for
 *      named groups). Matched → definitely real, never suggested.
 *   2. The UNMATCHED groups are SUGGESTIONS. The owner (who knows which groups he
 *      deleted) confirms the truly-deleted ones → cs_deleted_groups(status=confirmed).
 *   3. buildInactiveGroupMap excludes ONLY confirmed canon_keys. No automation ever
 *      writes 'confirmed' — the human is the gate, so there is zero false-positive
 *      risk to real clients' level counts.
 *
 * The lecture signal (does the group have real main lectures?) is shown as a HINT
 * to help the owner review — it does NOT auto-exclude anything.
 */

const db = require('../config/database');
const { saveNow } = require('../config/database');
const { canonKey, slotKey, nameTokens, hasTrainer } = require('../utils/csBatchMatch');
const { isIgnoredGroup } = require('../utils/csGroupHelpers');

// Build the All-Batches reference match structures (canon set, slot set, slot→tokens).
function buildRef() {
  const refCanon = new Set(), refSlot = new Set(), refSlotTok = new Map();
  for (const r of db.prepare(`SELECT group_name_raw g, trainer_col t, canon_key ck, slot_key sk FROM cs_all_batches_ref`).all()) {
    if (r.ck) refCanon.add(r.ck);
    if (r.sk) {
      refSlot.add(r.sk);
      const tk = refSlotTok.get(r.sk) || new Set();
      nameTokens(r.g, r.t).forEach(x => tk.add(x));
      refSlotTok.set(r.sk, tk);
    }
  }
  return { refCanon, refSlot, refSlotTok };
}

// 'exact' | 'slot' | 'none'
function matchAllBatches(ref, group) {
  const ck = canonKey(group);
  if (ref.refCanon.has(ck)) return 'exact';
  const sk = slotKey(group);
  if (!sk || !ref.refSlot.has(sk)) return 'none';
  if (!hasTrainer(group)) return 'slot';                 // bare stub → slot alone is enough
  const mine = nameTokens(group);                        // named → need trainer/coord overlap at slot
  const tks = ref.refSlotTok.get(sk) || new Set();
  for (const t of mine) if (tks.has(t)) return 'slot';
  return 'none';
}

// canon → true if the group has real MAIN lectures (exact OR slot-tolerant). A HINT.
function buildLectureIndex() {
  const lecCanon = new Set(), lecSlot = new Set();
  for (const r of db.prepare(`SELECT DISTINCT group_name g FROM lectures WHERE session_type='main' AND group_name IS NOT NULL`).all()) {
    lecCanon.add(canonKey(r.g));
    const sk = slotKey(r.g); if (sk) lecSlot.add(sk);
  }
  return { lecCanon, lecSlot };
}
function hasLectures(lec, group) {
  if (lec.lecCanon.has(canonKey(group))) return true;
  const sk = slotKey(group); return !!sk && lec.lecSlot.has(sk);
}

// Set of confirmed-deleted canon keys — the ONLY thing that drives exclusion.
function getConfirmedKeys() {
  const set = new Set();
  try {
    for (const r of db.prepare(`SELECT canon_key FROM cs_deleted_groups WHERE status='confirmed'`).all()) set.add(r.canon_key);
  } catch (_) { /* table may not exist on older deploys */ }
  return set;
}

// The review list: completed-level groups with NO All-Batches match, annotated.
// Excludes ones the owner already decided (confirmed OR rejected) unless includeDecided.
function getSuggestions({ includeDecided = false } = {}) {
  const ref = buildRef();
  const lec = buildLectureIndex();
  const decided = new Map();
  try { for (const r of db.prepare(`SELECT canon_key, status FROM cs_deleted_groups`).all()) decided.set(r.canon_key, r.status); } catch (_) {}

  // distinct groups + client counts + dept
  const rows = db.prepare(`
    SELECT group_name_raw g, dept, COUNT(DISTINCT client_phone_norm) clients
      FROM cs_completed_levels
     WHERE group_name_raw IS NOT NULL AND TRIM(group_name_raw) <> ''
     GROUP BY group_name_raw`).all();

  const byCanon = new Map();   // collapse name-variants of one group
  for (const r of rows) {
    const label = String(r.g).split(/[\r\n]/)[0].trim();
    if (isIgnoredGroup(label)) continue;
    const ck = canonKey(r.g);
    if (!ck) continue;
    if (matchAllBatches(ref, r.g) !== 'none') continue;   // matched the reference → real, skip
    const cur = byCanon.get(ck) || { canon_key: ck, label, dept: r.dept, clients: 0, has_lectures: false };
    cur.clients += r.clients;
    if (hasLectures(lec, r.g)) cur.has_lectures = true;
    if (label.length > cur.label.length) cur.label = label;   // prefer the fullest label
    byCanon.set(ck, cur);
  }

  const out = [];
  for (const s of byCanon.values()) {
    const status = decided.get(s.canon_key) || 'pending';
    if (!includeDecided && status !== 'pending') continue;
    out.push({ ...s, status });
  }
  // most-likely-deleted first: no lectures, then more clients affected.
  out.sort((a, b) => (a.has_lectures - b.has_lectures) || (b.clients - a.clients) || a.label.localeCompare(b.label));
  return out;
}

// Owner action: confirm (exclude) or reject (keep) a group, keyed by canon.
function setDeletedStatus({ canonKey: ck, label, dept, status, userId, userName, note }) {
  if (!ck) throw new Error('canon_key required');
  if (!['confirmed', 'rejected'].includes(status)) throw new Error("status must be 'confirmed' or 'rejected'");
  db.prepare(`
    INSERT INTO cs_deleted_groups (canon_key, label, dept, status, marked_by, marked_by_name, note, marked_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','+2 hours'), datetime('now','+2 hours'))
    ON CONFLICT(canon_key) DO UPDATE SET
      label = excluded.label, dept = excluded.dept, status = excluded.status,
      marked_by = excluded.marked_by, marked_by_name = excluded.marked_by_name,
      note = excluded.note, updated_at = datetime('now','+2 hours')
  `).run(ck, label || null, dept || null, status, userId || null, userName || null, note || null);
  saveNow();
  return { canon_key: ck, status };
}

// Remove a decision entirely (back to "pending" / not excluded).
function clearDecision(ck) {
  db.prepare(`DELETE FROM cs_deleted_groups WHERE canon_key = ?`).run(ck);
  saveNow();
  return { canon_key: ck, status: 'pending' };
}

// The confirmed-deleted list (for display).
function listDeleted() {
  try {
    return db.prepare(`SELECT canon_key, label, dept, status, marked_by_name, note, updated_at
                         FROM cs_deleted_groups ORDER BY updated_at DESC`).all();
  } catch (_) { return []; }
}

module.exports = {
  getConfirmedKeys, getSuggestions, setDeletedStatus, clearDecision, listDeleted,
  matchAllBatches, buildRef,
};
