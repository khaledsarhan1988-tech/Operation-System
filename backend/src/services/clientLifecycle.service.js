'use strict';

/**
 * Client Lifecycle Service — Phase 3.
 *
 * Derives a per-client event timeline from finance_transactions that have
 * been matched to an academy client (Phase 2 → `matched_client_id`).
 *
 * Each finance transaction becomes ONE lifecycle event:
 *   tx.type 'new_enrollment' → event_type 'enrollment'
 *   tx.type 'renewal'        → 'renewal'
 *   tx.type 'upgrade'        → 'upgrade'
 *   tx.type 'installment'    → 'installment'
 *   tx.type 'refund'         → 'refund'
 *   tx.type 'session'        → 'session'
 *   tx.type 'recommendation' → 'recommendation'
 *
 * `level_raw` is a best-effort extraction from product_name (e.g. "Adults A2"
 * → "A2", "General 3 - English" → "General 3"). It is intentionally STRING-
 * shaped and DOES NOT decide what level the client is on now — Phase 4 will
 * canonicalize and own the progression rules.
 *
 * Idempotency: events are UNIQUE on (source_transaction_id, event_type). Re-
 * generating from the same transaction updates the existing row instead of
 * duplicating.
 */

const db = require('../config/database');
const { saveNow } = require('../config/database');

// ─── EVENT TYPE MAPPING ──────────────────────────────────────────────────────

// Map finance_transactions.type → lifecycle event_type. Anything not in this
// map is skipped (we'd rather skip than guess a bad event type).
const TX_TYPE_TO_EVENT = {
  new_enrollment: 'enrollment',
  renewal:        'renewal',
  upgrade:        'upgrade',
  installment:    'installment',
  refund:         'refund',
  session:        'session',
  recommendation: 'recommendation',
};

// ─── LEVEL EXTRACTION (Phase 3 — RAW only, Phase 4 will canonicalize) ────────

// Patterns try strict ones first, then progressively looser ones. Anything
// matched is stored verbatim in level_raw — UI treats it as a label, not data.
// Phase 4 will parse this string into a canonical (track, position) tuple.
const LEVEL_PATTERNS = [
  // "Starter 1", "Starter-1", "starter1"
  /\b(starter)\s*[-_]?\s*([0-9])\b/i,
  // "General 5", "general-3"
  /\b(general)\s*[-_]?\s*([0-9])\b/i,
  // "Conversation 4", "conv 2"
  /\b(conversation|conv)\s*[-_]?\s*([0-9])\b/i,
  // CEFR-style "A1 / A2 / B1 / B2 / C1 / C2"
  /\b([ABC][12])\b/i,
];

function extractLevelRaw(productName) {
  if (!productName) return null;
  for (const re of LEVEL_PATTERNS) {
    const m = String(productName).match(re);
    if (!m) continue;
    if (m.length === 3) {
      const track = m[1].toLowerCase().replace('conv', 'conversation');
      return `${track[0].toUpperCase()}${track.slice(1)} ${m[2]}`;
    }
    if (m.length === 2) return m[1].toUpperCase();
  }
  return null;
}

// ─── PRIMITIVES ───────────────────────────────────────────────────────────────

function nowCairo() {
  // Match the rest of the app — Cairo wall-clock for created_at/updated_at.
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

const _upsertEventStmt = () => db.prepare(`
  INSERT INTO client_lifecycle_events (
    client_id, event_type, event_date, source_transaction_id,
    product_id, product_name, amount, currency, category,
    level_raw, level_canonical, status, notes, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_transaction_id, event_type) DO UPDATE SET
    client_id        = excluded.client_id,
    event_date       = excluded.event_date,
    product_id       = excluded.product_id,
    product_name     = excluded.product_name,
    amount           = excluded.amount,
    currency         = excluded.currency,
    category         = excluded.category,
    level_raw        = excluded.level_raw,
    -- level_canonical is owned by Phase 4 — do NOT overwrite an admin-set value
    status           = excluded.status,
    updated_at       = excluded.updated_at
`);

// ─── PUBLIC: regenerate from a transaction ───────────────────────────────────

/**
 * Build / refresh the lifecycle event for one transaction. Caller passes the
 * transaction row; we look up the matched client and either insert or update
 * the corresponding event.
 *
 * If the transaction has no `matched_client_id`, no event is created. If the
 * tx.type isn't recognized, no event is created (caller can detect this via
 * the return shape).
 */
function regenerateFromTransaction(tx) {
  if (!tx || !tx.id) return { status: 'invalid_tx' };
  if (!tx.matched_client_id) return { status: 'no_matched_client' };

  const eventType = TX_TYPE_TO_EVENT[tx.type];
  if (!eventType) return { status: 'unknown_tx_type', tx_type: tx.type };

  const now = nowCairo();
  const levelRaw = extractLevelRaw(tx.product_name);

  _upsertEventStmt().run(
    tx.matched_client_id,
    eventType,
    tx.date || tx.created_at || null,
    tx.id,
    tx.product_id || null,
    tx.product_name || null,
    tx.amount != null ? String(tx.amount) : null,
    tx.currency || null,
    tx.category || null,
    levelRaw,
    null,                       // level_canonical — Phase 4
    tx.status || null,
    null,                       // notes — admin-edited
    now,                        // created_at (ignored on UPDATE)
    now,                        // updated_at
  );
  return { status: 'ok', client_id: tx.matched_client_id, event_type: eventType, level_raw: levelRaw };
}

/**
 * Convenience: load a transaction by id and regenerate. Used by the matcher
 * hook (which only has the id at the point of call).
 */
function regenerateFromTransactionId(txId) {
  const tx = db.prepare(`SELECT * FROM finance_transactions WHERE id = ?`).get(txId);
  if (!tx) return { status: 'tx_not_found' };
  return regenerateFromTransaction(tx);
}

// ─── PUBLIC: bulk rebuild ─────────────────────────────────────────────────────

/**
 * Walk every matched transaction and (re)generate its lifecycle event. Use
 * after the initial Phase 2 backfill or whenever the level extractor is
 * tightened.
 */
function regenerateAll({ scope = 'matched', limit = 500_000 } = {}) {
  let where = 'matched_client_id IS NOT NULL';
  if (scope === 'all') where = '1=1';  // Phase 4 might want to skip even unmatched; we don't here

  const rows = db.prepare(`
    SELECT * FROM finance_transactions
     WHERE ${where}
     ORDER BY date ASC
     LIMIT ?
  `).all(limit);

  let ok = 0, skipped = 0, errors = 0;
  for (const tx of rows) {
    try {
      const r = regenerateFromTransaction(tx);
      if (r.status === 'ok') ok++; else skipped++;
    } catch (e) {
      errors++;
      console.error(`[Lifecycle] regenerate error for ${tx.id}:`, e.message);
    }
  }
  saveNow();
  return { scope, attempted: rows.length, ok, skipped, errors };
}

// ─── PUBLIC: queries ──────────────────────────────────────────────────────────

/**
 * Full timeline for one client, newest first.
 */
function getClientTimeline(clientId, { limit = 500 } = {}) {
  return db.prepare(`
    SELECT id, event_type, event_date, source_transaction_id,
           product_id, product_name, amount, currency, category,
           level_raw, level_canonical, status, notes, created_at, updated_at
      FROM client_lifecycle_events
     WHERE client_id = ?
     ORDER BY event_date DESC, id DESC
     LIMIT ?
  `).all(clientId, limit);
}

/**
 * Aggregated counts for the dashboard tile (events by type, last 30 days
 * vs all time).
 */
function getStats() {
  const byType = db.prepare(`
    SELECT event_type, COUNT(*) AS n
      FROM client_lifecycle_events
     GROUP BY event_type
     ORDER BY n DESC
  `).all();

  const byCategory = db.prepare(`
    SELECT category, COUNT(*) AS n
      FROM client_lifecycle_events
     WHERE category IS NOT NULL
     GROUP BY category
     ORDER BY n DESC
  `).all();

  const byLevel = db.prepare(`
    SELECT level_raw, COUNT(*) AS n
      FROM client_lifecycle_events
     WHERE level_raw IS NOT NULL
     GROUP BY level_raw
     ORDER BY n DESC
     LIMIT 30
  `).all();

  const total = db.prepare(`SELECT COUNT(*) AS n FROM client_lifecycle_events`).get()?.n || 0;
  const clients = db.prepare(`SELECT COUNT(DISTINCT client_id) AS n FROM client_lifecycle_events`).get()?.n || 0;

  return { total, distinct_clients: clients, by_type: byType, by_category: byCategory, by_level: byLevel };
}

module.exports = {
  // primitives
  extractLevelRaw,
  // single
  regenerateFromTransaction,
  regenerateFromTransactionId,
  // bulk
  regenerateAll,
  // queries
  getClientTimeline,
  getStats,
};
