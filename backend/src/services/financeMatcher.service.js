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
 *     method: 'phone' | null,
 *     candidates: [{ id, name, phone, group_name, line }, ...]
 *   }
 *
 * Phone-only matching rule (2026-05-28): the phone number is the source of
 * truth. If no client matches the transaction phone (after normalization),
 * the transaction is unmatched — it represents a new client to add. Name
 * matching was removed because identical names with different phones are
 * different people in practice.
 *
 * Line filter via `classify` (2026-05-28): Center App tags every transaction
 * with `classify` = 'Ahmed Hassan' | 'Dardasha' to indicate which operational
 * line the customer belongs to. When classify is one of these known values
 * we restrict the phone search to clients on that line — preventing a
 * Dardasha client from being matched to an Ahmed Hassan transaction (or vice
 * versa) just because they happen to share a phone-number suffix or were
 * registered before classify existed. When classify is empty/unknown we fall
 * back to searching all lines (legacy behaviour).
 */
const VALID_LINES = ['Ahmed Hassan', 'Dardasha'];

// Pull every digit out of a free-text phone field. Unlike normalizePhone /
// extractAllPhones (which only recognise Egyptian formats), this is format-
// agnostic: works for Saudi 966xxx, UAE 971xxx, etc. Returns the cleaned
// digit string or null if there aren't enough digits to be plausible.
function rawDigitSuffix(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/\D+/g, '');
  if (s.length < 7) return null;        // too short to be a phone
  return s.slice(-9);                   // last 9 digits — stable across formats
}

function findCandidates(tx) {
  // ── Egyptian-format normalisation pass ─────────────────────────────────
  const egPhones = extractAllPhones(tx.client_phone);

  // ── International fallback: format-agnostic raw-digit match ────────────
  // Center App also stores Saudi (966xxx) and UAE (971xxx) numbers for
  // Gulf-based clients. extractAllPhones returns [] for those, but the
  // clients table holds the same raw digits, so a last-9-digit suffix
  // comparison reliably catches them.
  const fallbackSuffix = egPhones.length === 0 ? rawDigitSuffix(tx.client_phone) : null;

  if (egPhones.length === 0 && !fallbackSuffix) {
    return { method: null, candidates: [] };
  }

  // Use the Center App `classify` value as a line filter when it's a known
  // line name. Anything else (NULL, "-", ".", "0", legacy rows) → no filter.
  const lineFilter = VALID_LINES.includes(tx.classify)
    ? ` AND line = ?`
    : '';
  const lineParams = VALID_LINES.includes(tx.classify) ? [tx.classify] : [];

  // Build the candidate phone-filter from whichever pass produced suffixes.
  const suffixes = egPhones.length > 0
    ? egPhones.map(p => p.slice(-9))
    : [fallbackSuffix];

  const phoneFilter = suffixes.map(() => `phone LIKE ?`).join(' OR ');
  const phoneParams = suffixes.map(s => `%${s}%`);
  const rows = db.prepare(`
    SELECT id, name, phone, group_name, line
      FROM clients
     WHERE (${phoneFilter})${lineFilter}
  `).all(...phoneParams, ...lineParams);

  let matches;
  if (egPhones.length > 0) {
    matches = rows.filter(c => {
      const clientPhones = extractAllPhones(c.phone);
      return clientPhones.some(p => egPhones.includes(p));
    });
  } else {
    // Fallback path: compare last-9 raw digits
    matches = rows.filter(c => {
      const cSuffix = rawDigitSuffix(c.phone);
      return cSuffix && cSuffix === fallbackSuffix;
    });
  }
  if (matches.length > 0) {
    return { method: 'phone', candidates: matches };
  }

  // ── TIER 2: Customer Subscription archive ──────────────────────────────
  // No hit in active clients. Try the historical mirror that includes
  // ended-group customers. When found, materialise the archive row into
  // clients so the rest of the matcher (matched_client_id, lifecycle, etc.)
  // works unchanged.
  const subSuffixes = egPhones.length > 0
    ? egPhones.map(p => p.slice(-9))
    : [fallbackSuffix];
  const subPhoneFilter = subSuffixes.map(() => `phone_raw LIKE ?`).join(' OR ');
  const subPhoneParams = subSuffixes.map(s => `%${s}%`);
  const subRows = db.prepare(`
    SELECT id, name, phone, phone_raw, group_name, group_status, line, client_code
      FROM subscription_clients
     WHERE (${subPhoneFilter})${lineFilter ? ' AND line = ?' : ''}
  `).all(...subPhoneParams, ...(lineFilter ? lineParams : []));

  let subMatches;
  if (egPhones.length > 0) {
    subMatches = subRows.filter(c => {
      const subPhones = extractAllPhones(c.phone_raw);
      return subPhones.some(p => egPhones.includes(p));
    });
  } else {
    subMatches = subRows.filter(c => {
      const sSuffix = rawDigitSuffix(c.phone_raw);
      return sSuffix && sSuffix === fallbackSuffix;
    });
  }

  if (subMatches.length === 0) {
    return { method: null, candidates: [] };
  }

  // Materialise into clients. We use INSERT-then-pick so the new row gets
  // a real clients.id we can return as a candidate. Duplicates by (phone,
  // line) are avoided by checking first.
  const materialised = [];
  const findClient = db.prepare(
    `SELECT id, name, phone, group_name, line FROM clients WHERE phone = ? AND line = ? LIMIT 1`
  );
  const insertClient = db.prepare(
    `INSERT INTO clients (name, phone, group_name, line) VALUES (?, ?, ?, ?)`
  );
  const txn = db.transaction(() => {
    for (const s of subMatches) {
      const existing = findClient.get(s.phone_raw || s.phone, s.line);
      if (existing) { materialised.push(existing); continue; }
      const r = insertClient.run(s.name, s.phone_raw || s.phone, s.group_name, s.line);
      materialised.push({
        id: r.lastInsertRowid,
        name: s.name,
        phone: s.phone_raw || s.phone,
        group_name: s.group_name,
        line: s.line,
      });
    }
  });
  txn();

  return { method: 'phone', candidates: materialised };
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

  // Manual matches are STICKY: an admin who manually paired a transaction
  // with a specific client has expressed an explicit intent that no auto-
  // matcher pass should erase — not even matchAll({scope:'all'}). To re-
  // evaluate a manual match, the admin must explicitly clear it (POST
  // /manual with client_id=null) first.
  if (tx.match_method === 'manual' && tx.matched_client_id) {
    return { txId, status: 'skipped_manual_protected', match_method: 'manual' };
  }

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

  // 1+ candidates — all matched by phone (after normalization). Multiple
  // records with the same phone in the clients table are the SAME PERSON
  // (e.g. registered in several groups), so we auto-match to the first one.
  const c = candidates[0];
  setMatchResult(txId, {
    matched_client_id: c.id,
    match_method: 'auto_phone',
    match_confidence: 'high',
    matched_by: null,
  });
  if (typeof onMatched === 'function') {
    try { onMatched(c.id, txId); } catch (e) { console.error('[FinanceMatcher] onMatched hook error:', e.message); }
  }
  return {
    txId,
    status: 'matched',
    client_id: c.id,
    method: 'auto_phone',
    matched_count: candidates.length,
  };
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
