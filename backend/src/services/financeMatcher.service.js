'use strict';

/**
 * Finance Matcher — Phase 2.
 *
 * Resolves every finance_transactions row to an academy clients.id by phone
 * first, then by token-exact name as a fallback. Outcomes per transaction:
 *
 *   1 candidate  → auto-match (match_method='auto_phone'|'auto_name', high conf)
 *   2+ candidates→ mark 'ambiguous', persist candidates for manual review
 *   0 candidates → mark 'unmatched'
 *
 * The transaction's `matched_client_id` is ONLY set when we're certain
 * (single candidate). Manual matching by the admin can override anything.
 *
 * Auto-matching is keyed on `match_attempted_at` — a row already attempted
 * is NOT re-tried automatically (cheap; avoids redoing the same query for
 * thousands of rows on every poll). Admin can force re-run via the UI.
 */

const db = require('../config/database');
const { saveNow } = require('../config/database');
const { normalizePhone, extractAllPhones } = require('../utils/phoneNormalize');

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }

// Tokenize an Arabic/English name for token-exact comparison: NFKC normalize,
// lower-case, collapse whitespace, strip diacritics. Returns an array of tokens.
function tokenizeName(name) {
  if (!name) return [];
  return String(name)
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ]/g, '')  // Arabic diacritics + tatweel
    .toLowerCase()
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Two names match if they share the same set of tokens (order-agnostic).
// "Mohamed Ahmed" matches "Ahmed Mohamed" but NOT "Mohamed Ahmed Aly".
// This is intentionally strict — fuzzy matching belongs in a manual review.
function namesMatchExact(a, b) {
  const ta = tokenizeName(a);
  const tb = tokenizeName(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.length !== tb.length) return false;
  const sa = [...ta].sort();
  const sb = [...tb].sort();
  return sa.every((t, i) => t === sb[i]);
}

// ─── CANDIDATE LOOKUP ─────────────────────────────────────────────────────────

/**
 * Given a transaction, return the set of academy clients that match — first
 * by phone, then by name. Result shape:
 *   {
 *     method: 'phone' | 'name' | null,
 *     candidates: [{ id, name, phone, group_name, line }, ...]
 *   }
 *
 * Phone takes priority: if ANY phone match exists, we ignore name matches
 * entirely. Mixing methods would lead to false positives (same name, wrong
 * person). Only when no phone match exists do we fall back to name.
 */
function findCandidates(tx) {
  const phones = extractAllPhones(tx.client_phone);
  const allClients = [];

  // ── PHONE PASS ─────────────────────────────────────────────────────────
  if (phones.length > 0) {
    // We can't directly index-search normalized phones (clients.phone is
    // stored raw), but the dataset is small enough (<100K rows) to load
    // candidates by approximate match and filter in JS.
    const rawPhones = phones.map(p => p.slice(-9));  // last 9 digits — most stable suffix
    const phoneFilter = rawPhones.map(() => `phone LIKE ?`).join(' OR ');
    const phoneParams = rawPhones.map(p => `%${p}%`);
    const rows = db.prepare(`
      SELECT id, name, phone, group_name, line
        FROM clients
       WHERE ${phoneFilter}
    `).all(...phoneParams);

    const matches = rows.filter(c => {
      const clientPhones = extractAllPhones(c.phone);
      return clientPhones.some(p => phones.includes(p));
    });
    if (matches.length > 0) {
      return { method: 'phone', candidates: matches };
    }
  }

  // ── NAME PASS ──────────────────────────────────────────────────────────
  const name = (tx.client_name || '').trim();
  if (!name) {
    return { method: null, candidates: [] };
  }

  // Pull every client whose name has a token in common with the tx name.
  // Cheaper than scanning the whole table; lets the JS filter do the
  // exact-set comparison.
  const tokens = tokenizeName(name);
  if (tokens.length === 0) return { method: null, candidates: [] };

  // Build a NAME LIKE filter on the longest token (most discriminating).
  const longest = tokens.slice().sort((a, b) => b.length - a.length)[0];
  if (!longest || longest.length < 2) return { method: null, candidates: [] };

  const rows = db.prepare(`
    SELECT id, name, phone, group_name, line
      FROM clients
     WHERE name LIKE ? COLLATE NOCASE
  `).all(`%${longest}%`);

  const matches = rows.filter(c => namesMatchExact(c.name, name));
  return { method: matches.length > 0 ? 'name' : null, candidates: matches };
}

// ─── PERSISTENCE ──────────────────────────────────────────────────────────────

function clearCandidates(txId) {
  db.prepare(`DELETE FROM finance_match_candidates WHERE transaction_id = ?`).run(txId);
}

function persistCandidates(txId, method, candidates) {
  const ins = db.prepare(`
    INSERT OR IGNORE INTO finance_match_candidates (transaction_id, client_id, method)
    VALUES (?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const c of candidates) ins.run(txId, c.id, method);
  });
  tx();
}

function setMatchResult(txId, { matched_client_id, match_method, match_confidence, matched_by }) {
  db.prepare(`
    UPDATE finance_transactions
       SET matched_client_id   = ?,
           match_method        = ?,
           match_confidence    = ?,
           match_attempted_at  = ?,
           matched_by          = ?
     WHERE id = ?
  `).run(
    matched_client_id != null ? matched_client_id : null,
    match_method || null,
    match_confidence || null,
    nowIso(),
    matched_by != null ? matched_by : null,
    txId,
  );
}

// ─── PUBLIC: matchTransaction ────────────────────────────────────────────────

/**
 * Resolve a single transaction. Idempotent: safe to re-run.
 * Returns the outcome summary.
 *
 * Options:
 *   force      — re-run even if match_attempted_at is set
 *   onMatched  — callback (clientId, txId) fired when matched (Phase 3 hook)
 */
function matchTransaction(txId, { force = false, onMatched = null } = {}) {
  const tx = db.prepare(`SELECT * FROM finance_transactions WHERE id = ?`).get(txId);
  if (!tx) return { txId, status: 'not_found' };

  // Skip if previously attempted and the result was deterministic, unless force.
  if (!force && tx.match_attempted_at && tx.match_method && tx.match_method !== 'unmatched') {
    return { txId, status: 'skipped_already_attempted', match_method: tx.match_method };
  }

  const { method, candidates } = findCandidates(tx);
  clearCandidates(txId);

  if (candidates.length === 0) {
    setMatchResult(txId, {
      matched_client_id: null,
      match_method: 'unmatched',
      match_confidence: null,
      matched_by: null,
    });
    return { txId, status: 'unmatched' };
  }

  if (candidates.length === 1) {
    const c = candidates[0];
    setMatchResult(txId, {
      matched_client_id: c.id,
      match_method: method === 'phone' ? 'auto_phone' : 'auto_name',
      match_confidence: method === 'phone' ? 'high' : 'medium',
      matched_by: null,
    });
    if (typeof onMatched === 'function') {
      try { onMatched(c.id, txId); } catch (e) { console.error('[FinanceMatcher] onMatched hook error:', e.message); }
    }
    return { txId, status: 'matched', client_id: c.id, method: method === 'phone' ? 'auto_phone' : 'auto_name' };
  }

  // Ambiguous: persist candidates for manual review, leave matched_client_id NULL.
  persistCandidates(txId, method, candidates);
  setMatchResult(txId, {
    matched_client_id: null,
    match_method: 'ambiguous',
    match_confidence: 'low',
    matched_by: null,
  });
  return { txId, status: 'ambiguous', candidate_count: candidates.length };
}

// ─── PUBLIC: matchBatch (used by sync engine) ─────────────────────────────────

/**
 * Match a list of newly-inserted transaction IDs. The sync engine calls this
 * after every successful batch upsert. Errors per-row do not abort the batch.
 */
function matchBatch(txIds, { onMatched = null } = {}) {
  if (!Array.isArray(txIds) || txIds.length === 0) return { attempted: 0 };
  let matched = 0, ambiguous = 0, unmatched = 0, errors = 0;
  for (const id of txIds) {
    try {
      const r = matchTransaction(id, { onMatched });
      if (r.status === 'matched') matched++;
      else if (r.status === 'ambiguous') ambiguous++;
      else if (r.status === 'unmatched') unmatched++;
    } catch (e) {
      errors++;
      console.error(`[FinanceMatcher] match error for ${id}:`, e.message);
    }
  }
  return { attempted: txIds.length, matched, ambiguous, unmatched, errors };
}

// ─── PUBLIC: matchAll (bulk re-match) ────────────────────────────────────────

/**
 * Re-attempt matching for every transaction in scope. `scope`:
 *   'unattempted'  — only rows where match_attempted_at IS NULL (default)
 *   'unmatched'    — also retry rows previously marked unmatched (e.g. after
 *                    importing new clients)
 *   'all'          — every row (force)
 */
function matchAll({ scope = 'unattempted', limit = 100_000, onMatched = null } = {}) {
  let where = 'match_attempted_at IS NULL';
  if (scope === 'unmatched') where = "(match_attempted_at IS NULL OR match_method='unmatched' OR match_method='ambiguous')";
  if (scope === 'all') where = '1=1';

  const ids = db.prepare(
    `SELECT id FROM finance_transactions WHERE ${where} LIMIT ?`
  ).all(limit).map(r => r.id);

  let matched = 0, ambiguous = 0, unmatched = 0, errors = 0;
  for (const id of ids) {
    try {
      const r = matchTransaction(id, { force: scope === 'all', onMatched });
      if (r.status === 'matched') matched++;
      else if (r.status === 'ambiguous') ambiguous++;
      else if (r.status === 'unmatched') unmatched++;
    } catch (e) {
      errors++;
      console.error(`[FinanceMatcher] matchAll error for ${id}:`, e.message);
    }
  }
  saveNow();
  return { scope, attempted: ids.length, matched, ambiguous, unmatched, errors };
}

// ─── PUBLIC: manualMatch ──────────────────────────────────────────────────────

/**
 * Admin picks a specific client for a transaction. Overrides any auto result.
 * If clientId is null, unmatch (clears matched_client_id and method).
 */
function manualMatch(txId, clientId, userId, { onMatched = null } = {}) {
  const tx = db.prepare(`SELECT id FROM finance_transactions WHERE id = ?`).get(txId);
  if (!tx) throw Object.assign(new Error('Transaction not found'), { status: 404 });

  if (clientId === null || clientId === undefined) {
    setMatchResult(txId, {
      matched_client_id: null,
      match_method: null,
      match_confidence: null,
      matched_by: userId,
    });
    clearCandidates(txId);
    saveNow();
    return { txId, status: 'unmatched_manually' };
  }

  const client = db.prepare(`SELECT id FROM clients WHERE id = ?`).get(clientId);
  if (!client) throw Object.assign(new Error('Client not found'), { status: 404 });

  setMatchResult(txId, {
    matched_client_id: clientId,
    match_method: 'manual',
    match_confidence: 'high',
    matched_by: userId,
  });
  clearCandidates(txId);
  saveNow();

  if (typeof onMatched === 'function') {
    try { onMatched(clientId, txId); } catch (e) { console.error('[FinanceMatcher] onMatched hook error:', e.message); }
  }
  return { txId, status: 'matched_manually', client_id: clientId };
}

// ─── PUBLIC: stats / listings ─────────────────────────────────────────────────

function getMatchStats() {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN matched_client_id IS NOT NULL THEN 1 ELSE 0 END)             AS matched,
      SUM(CASE WHEN match_method = 'auto_phone' THEN 1 ELSE 0 END)               AS auto_phone,
      SUM(CASE WHEN match_method = 'auto_name'  THEN 1 ELSE 0 END)               AS auto_name,
      SUM(CASE WHEN match_method = 'manual'     THEN 1 ELSE 0 END)               AS manual,
      SUM(CASE WHEN match_method = 'ambiguous'  THEN 1 ELSE 0 END)               AS ambiguous,
      SUM(CASE WHEN match_method = 'unmatched'  THEN 1 ELSE 0 END)               AS unmatched,
      SUM(CASE WHEN match_attempted_at IS NULL THEN 1 ELSE 0 END)                AS not_attempted
    FROM finance_transactions
  `).get();
  return counts;
}

function getCandidatesForTx(txId) {
  return db.prepare(`
    SELECT c.id AS client_id, c.name, c.phone, c.group_name, c.line, fmc.method, fmc.created_at
      FROM finance_match_candidates fmc
      JOIN clients c ON c.id = fmc.client_id
     WHERE fmc.transaction_id = ?
     ORDER BY c.name ASC
  `).all(txId);
}

module.exports = {
  // primitives
  normalizePhone,
  tokenizeName,
  findCandidates,
  // single-tx
  matchTransaction,
  manualMatch,
  // bulk
  matchBatch,
  matchAll,
  // queries
  getMatchStats,
  getCandidatesForTx,
};
