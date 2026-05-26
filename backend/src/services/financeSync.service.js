'use strict';

/**
 * Finance Sync Engine — Phase 1.
 *
 * Polls Center App's Finance Transactions API and mirrors every transaction
 * into the local finance_* tables (see migration in app.js). Designed for three
 * modes that share the same upsert primitives:
 *
 *   1. pollIncremental()  — fires every 30s via setInterval (see app.js).
 *                            Uses `since=<cursor>` to fetch only rows changed
 *                            since the last successful poll. Tiny batches.
 *
 *   2. runBackfill({from,to,reset?}) — manual / startup catch-up. Walks the
 *                            full date range in pages of 500. Sets cursor to
 *                            max(updated_at) when finished so subsequent polls
 *                            pick up correctly.
 *
 *   3. runReconciliation() — daily 03:00 Cairo. Pulls IDs from a window
 *                            (last 90 days by default) and deletes local rows
 *                            that no longer exist upstream (the API has no
 *                            tombstones so this is how we catch deletions).
 *
 * Concurrency: a single in-process `_running` mutex serializes everything.
 * If a tick takes >30s, the next interval fires silently no-op until the
 * previous run completes. This is critical — sql.js WASM is single-threaded
 * and concurrent transactions corrupt its bind state.
 *
 * The cursor lives in `finance_sync_state` (single row, id=1). The engine
 * NEVER advances the cursor past a row it failed to write — partial pages
 * are safe to re-process because upserts are keyed on the Center App UUID.
 */

const db = require('../config/database');
const { saveNow } = require('../config/database');
const centerApp = require('./centerAppClient.service');
// Phase 2: auto-match newly-inserted transactions to academy clients.
// Phase 3: generate lifecycle events when a match is found.
// Both are wired here so the sync engine stays the single owner of "what
// happens when a new transaction arrives". Loaded lazily to avoid a circular
// require if either service ever imports from this file.
let _matcher = null;
let _lifecycle = null;
function getMatcher() {
  if (!_matcher) _matcher = require('./financeMatcher.service');
  return _matcher;
}
function getLifecycle() {
  if (!_lifecycle) _lifecycle = require('./clientLifecycle.service');
  return _lifecycle;
}

const PAGE_LIMIT = 500;             // API max — fewer round trips
const RECONCILE_WINDOW_DAYS = 90;   // how far back reconciliation looks
const MIN_CURSOR = '1970-01-01T00:00:00Z';

let _running = false;     // mutex: one sync at a time
let _missedKeyWarned = false;  // log "missing key" exactly once per process

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function nowIsoUtc() {
  return new Date().toISOString();
}

// Returns the current sync_state row, creating it if a previous startup
// somehow lost the seed row (defense in depth — migration always seeds it).
function getState() {
  let row = db.prepare(`SELECT * FROM finance_sync_state WHERE id = 1`).get();
  if (!row) {
    db.prepare(`INSERT INTO finance_sync_state (id) VALUES (1)`).run();
    row = db.prepare(`SELECT * FROM finance_sync_state WHERE id = 1`).get();
  }
  return row;
}

function maxIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

// ─── SYNC LOG ─────────────────────────────────────────────────────────────────

function openLog(mode, triggeredBy, cursorBefore) {
  const r = db.prepare(`
    INSERT INTO finance_sync_log (started_at, mode, cursor_before, triggered_by, status)
    VALUES (?, ?, ?, ?, 'running')
  `).run(nowIsoUtc(), mode, cursorBefore || null, triggeredBy || 'system');
  return r.lastInsertRowid;
}

function closeLog(logId, patch) {
  const fields = [];
  const params = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`);
    params.push(v);
  }
  fields.push(`finished_at = ?`);
  params.push(nowIsoUtc());
  params.push(logId);
  db.prepare(`UPDATE finance_sync_log SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

// ─── UPSERT PRIMITIVES ────────────────────────────────────────────────────────

// Field list mirrors the API brief 1:1. Keep in sync with the migration.
const TX_COLS = [
  'id','date','client_name','client_phone','type','amount','currency','category',
  'status','discount_label','discount_pct','job','classify','note','has_installments',
  'product_id','product_name','deal_type','governorate',
  'agent_id','agent_name','created_by','created_by_name','approved_by','approved_by_name',
  'approved_at','rejection_reason','department_id','department_name',
  'created_at','updated_at','synced_at','raw_json'
];

const _upsertTxStmt = () => db.prepare(`
  INSERT INTO finance_transactions (${TX_COLS.join(', ')})
  VALUES (${TX_COLS.map(() => '?').join(', ')})
  ON CONFLICT(id) DO UPDATE SET
    date              = excluded.date,
    client_name       = excluded.client_name,
    client_phone      = excluded.client_phone,
    type              = excluded.type,
    amount            = excluded.amount,
    currency          = excluded.currency,
    category          = excluded.category,
    status            = excluded.status,
    discount_label    = excluded.discount_label,
    discount_pct      = excluded.discount_pct,
    job               = excluded.job,
    classify          = excluded.classify,
    note              = excluded.note,
    has_installments  = excluded.has_installments,
    product_id        = excluded.product_id,
    product_name      = excluded.product_name,
    deal_type         = excluded.deal_type,
    governorate       = excluded.governorate,
    agent_id          = excluded.agent_id,
    agent_name        = excluded.agent_name,
    created_by        = excluded.created_by,
    created_by_name   = excluded.created_by_name,
    approved_by       = excluded.approved_by,
    approved_by_name  = excluded.approved_by_name,
    approved_at       = excluded.approved_at,
    rejection_reason  = excluded.rejection_reason,
    department_id     = excluded.department_id,
    department_name   = excluded.department_name,
    created_at        = excluded.created_at,
    updated_at        = excluded.updated_at,
    synced_at         = excluded.synced_at,
    raw_json          = excluded.raw_json
`);

// matched_client_id is deliberately NOT touched by upsert. Phase 2 owns it.

function rowExists(id) {
  return !!db.prepare(`SELECT 1 FROM finance_transactions WHERE id = ? LIMIT 1`).get(id);
}

// Coerce booleans/numbers to the storage shape the API/DB agreed on.
function normalizeTx(tx) {
  return {
    id:                tx.id,
    date:              tx.date || null,
    client_name:       tx.client_name || null,
    client_phone:      tx.client_phone || null,
    type:              tx.type || null,
    amount:            tx.amount != null ? String(tx.amount) : null,
    currency:          tx.currency || null,
    category:          tx.category || null,
    status:            tx.status || null,
    discount_label:    tx.discount_label || null,
    discount_pct:      tx.discount_pct != null ? String(tx.discount_pct) : null,
    job:               tx.job || null,
    classify:          tx.classify || null,
    note:              tx.note || null,
    has_installments:  tx.has_installments ? 1 : 0,
    product_id:        tx.product_id || null,
    product_name:      tx.product_name || null,
    deal_type:         tx.deal_type || null,
    governorate:       tx.governorate || null,
    agent_id:          tx.agent_id || null,
    agent_name:        tx.agent_name || null,
    created_by:        tx.created_by || null,
    created_by_name:   tx.created_by_name || null,
    approved_by:       tx.approved_by || null,
    approved_by_name:  tx.approved_by_name || null,
    approved_at:       tx.approved_at || null,
    rejection_reason:  tx.rejection_reason || null,
    department_id:     tx.department_id || null,
    department_name:   tx.department_name || null,
    created_at:        tx.created_at || null,
    updated_at:        tx.updated_at || null,
  };
}

/**
 * Upsert a batch of transactions inside ONE db.transaction. Returns
 * { inserted, updated, maxUpdatedAt } so the caller can advance the cursor.
 *
 * Installments are replaced wholesale per transaction (delete-then-insert)
 * because the API has no installment IDs we can key on. Cheap — a transaction
 * has 0-12 installments typically.
 */
function upsertBatch(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return { inserted: 0, updated: 0, maxUpdatedAt: null, insertedIds: [] };
  }

  const upsertTx = _upsertTxStmt();
  const deleteInst = db.prepare(`DELETE FROM finance_installments WHERE transaction_id = ?`);
  const insertInst = db.prepare(`
    INSERT INTO finance_installments (transaction_id, installment_no, amount, due_date, paid, paid_at, note, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = nowIsoUtc();
  let inserted = 0;
  let updated = 0;
  let maxUpdatedAt = null;
  const insertedIds = [];   // Phase 2 hook target — newly-inserted only

  const tx = db.transaction(() => {
    for (const raw of transactions) {
      if (!raw || !raw.id) continue;  // skip malformed rows defensively
      const existed = rowExists(raw.id);
      const n = normalizeTx(raw);
      const values = [
        n.id, n.date, n.client_name, n.client_phone, n.type, n.amount, n.currency,
        n.category, n.status, n.discount_label, n.discount_pct, n.job, n.classify,
        n.note, n.has_installments, n.product_id, n.product_name, n.deal_type,
        n.governorate, n.agent_id, n.agent_name, n.created_by, n.created_by_name,
        n.approved_by, n.approved_by_name, n.approved_at, n.rejection_reason,
        n.department_id, n.department_name, n.created_at, n.updated_at,
        now,                              // synced_at
        JSON.stringify(raw),              // raw_json
      ];
      upsertTx.run(...values);
      if (existed) {
        updated++;
      } else {
        inserted++;
        insertedIds.push(raw.id);
      }

      // Refresh installments. Empty/missing array → just clear out old rows.
      deleteInst.run(raw.id);
      const insts = Array.isArray(raw.installments) ? raw.installments : [];
      for (const inst of insts) {
        insertInst.run(
          raw.id,
          inst.installment_no != null ? Number(inst.installment_no) : null,
          inst.amount != null ? String(inst.amount) : null,
          inst.due_date || null,
          inst.paid ? 1 : 0,
          inst.paid_at || null,
          inst.note || null,
          now,
        );
      }

      if (n.updated_at) maxUpdatedAt = maxIso(maxUpdatedAt, n.updated_at);
    }
  });
  tx();

  return { inserted, updated, maxUpdatedAt, insertedIds };
}

/**
 * Hook fired after every successful batch upsert. Runs auto-matching on the
 * newly-inserted rows (Phase 2), and when a match is found generates the
 * client lifecycle event (Phase 3).
 *
 * Errors are caught per-row inside matchBatch — they never fail the sync.
 * Runs OUTSIDE the upsert transaction so a matcher hiccup doesn't roll back
 * the sync write.
 */
function runPostInsertHooks(insertedIds) {
  if (!Array.isArray(insertedIds) || insertedIds.length === 0) return;
  try {
    const matcher = getMatcher();
    const lifecycle = getLifecycle();
    matcher.matchBatch(insertedIds, {
      onMatched: (clientId, txId) => {
        // Phase 3: lifecycle event from the matched transaction
        try { lifecycle.regenerateFromTransactionId(txId); }
        catch (e) { console.error('[FinanceSync] lifecycle regen error:', e.message); }
      },
    });
  } catch (e) {
    console.error('[FinanceSync] post-insert hook error:', e.message);
  }
}

// ─── INCREMENTAL POLL ─────────────────────────────────────────────────────────

/**
 * Fetch everything that changed since the stored cursor, upsert it, advance
 * the cursor. Returns a summary even on no-op so the caller can log freshness.
 *
 * Safe to call repeatedly — does nothing if a previous run is still in flight.
 */
async function pollIncremental({ triggeredBy = 'cron' } = {}) {
  if (!centerApp.isConfigured()) {
    if (!_missedKeyWarned) {
      console.warn('[FinanceSync] CENTER_APP_API_KEY not set — polling disabled. Set it in Railway env and redeploy.');
      _missedKeyWarned = true;
    }
    return { skipped: 'not_configured' };
  }

  if (_running) {
    return { skipped: 'already_running' };
  }
  _running = true;

  const state = getState();
  const cursorBefore = state.cursor || MIN_CURSOR;
  const logId = openLog('incremental', triggeredBy, cursorBefore);

  let fetched = 0, inserted = 0, updated = 0, pages = 0;
  let cursorAfter = cursorBefore;
  let lastError = null;

  try {
    // The API returns newest-first by updated_at. We page until we get a page
    // with fewer than PAGE_LIMIT rows OR until a row's updated_at <= cursor
    // (which means we've caught up). In practice incremental polls return
    // 0-10 rows so we usually break after page 1.
    let page = 1;
    let stop = false;

    while (!stop) {
      const resp = await centerApp.listTransactions({
        since: cursorBefore,
        page,
        limit: PAGE_LIMIT,
      });
      pages++;
      const list = Array.isArray(resp?.transactions) ? resp.transactions : [];
      fetched += list.length;

      const { inserted: ins, updated: upd, maxUpdatedAt, insertedIds } = upsertBatch(list);
      inserted += ins;
      updated += upd;
      if (maxUpdatedAt) cursorAfter = maxIso(cursorAfter, maxUpdatedAt);
      runPostInsertHooks(insertedIds);

      // Stop conditions: short page OR no rows OR safety cap.
      if (list.length < PAGE_LIMIT) stop = true;
      if (page >= 20) stop = true;        // safety: 20 * 500 = 10k rows/poll max
      page++;
    }

    // Persist new cursor + success flags
    db.prepare(`
      UPDATE finance_sync_state
         SET cursor = ?,
             last_poll_at = ?,
             last_success_at = ?,
             last_error = NULL,
             total_synced = total_synced + ?,
             consecutive_errors = 0
       WHERE id = 1
    `).run(cursorAfter, nowIsoUtc(), nowIsoUtc(), inserted + updated);

    closeLog(logId, {
      rows_fetched: fetched,
      rows_inserted: inserted,
      rows_updated: updated,
      pages_fetched: pages,
      cursor_after: cursorAfter,
      status: 'success',
    });

    if (inserted + updated > 0) saveNow();
    return { mode: 'incremental', fetched, inserted, updated, pages, cursor: cursorAfter };
  } catch (err) {
    lastError = err;
    const msg = (err && err.message) ? err.message.slice(0, 500) : String(err).slice(0, 500);
    try {
      db.prepare(`
        UPDATE finance_sync_state
           SET last_poll_at = ?,
               last_error = ?,
               last_error_at = ?,
               consecutive_errors = consecutive_errors + 1
         WHERE id = 1
      `).run(nowIsoUtc(), msg, nowIsoUtc());
      closeLog(logId, {
        rows_fetched: fetched,
        rows_inserted: inserted,
        rows_updated: updated,
        pages_fetched: pages,
        cursor_after: cursorAfter,
        status: 'error',
        error: msg,
      });
    } catch (_) { /* logging failures are non-fatal */ }
    console.error('[FinanceSync] incremental poll error:', msg);
    return { mode: 'incremental', error: msg, fetched, inserted, updated, pages };
  } finally {
    _running = false;
  }
}

// ─── BACKFILL ─────────────────────────────────────────────────────────────────

/**
 * Walk a date range page by page and upsert everything. Use for the initial
 * load (no `since` cursor yet) and for manual catch-up from the admin UI.
 *
 * Params:
 *   from   YYYY-MM-DD   inclusive lower bound on transaction.date (optional)
 *   to     YYYY-MM-DD   inclusive upper bound (optional)
 *   reset  bool         if true, resets the cursor before starting (full re-pull)
 *
 * Unlike incremental, backfill walks ALL pages within the range until done.
 * Cursor is set to max(updated_at) seen across the whole run so subsequent
 * incremental polls don't refetch backfilled rows.
 */
async function runBackfill({ from, to, reset = false, triggeredBy = 'manual' } = {}) {
  if (!centerApp.isConfigured()) {
    return { skipped: 'not_configured' };
  }
  if (_running) {
    return { skipped: 'already_running' };
  }
  _running = true;

  if (reset) {
    db.prepare(`UPDATE finance_sync_state SET cursor = NULL, backfill_completed = 0 WHERE id = 1`).run();
  }
  db.prepare(`UPDATE finance_sync_state SET backfill_started_at = ?, backfill_finished_at = NULL WHERE id = 1`)
    .run(nowIsoUtc());

  const state = getState();
  const cursorBefore = state.cursor || MIN_CURSOR;
  const logId = openLog('backfill', triggeredBy, cursorBefore);

  let fetched = 0, inserted = 0, updated = 0, pages = 0;
  let cursorAfter = cursorBefore;

  try {
    let page = 1;
    // Hard ceiling on total pages — protects against runaway loops if `total`
    // somehow keeps growing. 10k pages × 500 rows/page = 5M rows, plenty.
    const MAX_PAGES = 10_000;
    let total = Infinity;

    while (page <= MAX_PAGES) {
      const resp = await centerApp.listTransactions({ from, to, page, limit: PAGE_LIMIT });
      pages++;
      if (Number.isFinite(resp?.total)) total = resp.total;
      const list = Array.isArray(resp?.transactions) ? resp.transactions : [];
      fetched += list.length;

      const { inserted: ins, updated: upd, maxUpdatedAt, insertedIds } = upsertBatch(list);
      inserted += ins;
      updated += upd;
      if (maxUpdatedAt) cursorAfter = maxIso(cursorAfter, maxUpdatedAt);
      runPostInsertHooks(insertedIds);

      // Persist partial progress every page — if we crash mid-backfill, the
      // next manual run picks up from a sane state. ALSO advance cursor so
      // even an aborted backfill leaves incremental polling functional.
      db.prepare(`UPDATE finance_sync_state SET cursor = ?, last_success_at = ? WHERE id = 1`)
        .run(cursorAfter, nowIsoUtc());

      if (list.length < PAGE_LIMIT) break;     // last page
      if (page * PAGE_LIMIT >= total) break;   // covered all rows
      page++;
    }

    db.prepare(`
      UPDATE finance_sync_state
         SET backfill_completed = 1,
             backfill_finished_at = ?,
             last_error = NULL,
             consecutive_errors = 0,
             total_synced = total_synced + ?
       WHERE id = 1
    `).run(nowIsoUtc(), inserted + updated);

    closeLog(logId, {
      rows_fetched: fetched,
      rows_inserted: inserted,
      rows_updated: updated,
      pages_fetched: pages,
      cursor_after: cursorAfter,
      status: 'success',
    });

    saveNow();
    return { mode: 'backfill', fetched, inserted, updated, pages, cursor: cursorAfter };
  } catch (err) {
    const msg = (err && err.message) ? err.message.slice(0, 500) : String(err).slice(0, 500);
    try {
      db.prepare(`
        UPDATE finance_sync_state
           SET last_error = ?, last_error_at = ?, consecutive_errors = consecutive_errors + 1
         WHERE id = 1
      `).run(msg, nowIsoUtc());
      closeLog(logId, {
        rows_fetched: fetched,
        rows_inserted: inserted,
        rows_updated: updated,
        pages_fetched: pages,
        cursor_after: cursorAfter,
        status: 'partial',
        error: msg,
      });
    } catch (_) {}
    console.error('[FinanceSync] backfill error:', msg);
    return { mode: 'backfill', error: msg, fetched, inserted, updated, pages };
  } finally {
    _running = false;
  }
}

// ─── RECONCILIATION ───────────────────────────────────────────────────────────

/**
 * Daily delete-detection. The API returns only living rows, so any local
 * transaction that the API no longer returns within RECONCILE_WINDOW_DAYS is
 * either deleted upstream or fell off the window — we delete locally so our
 * mirror stays a faithful copy.
 *
 * Strategy:
 *   1. Compute a `from` date = today - RECONCILE_WINDOW_DAYS.
 *   2. Walk the API with from=that, no to, paginated.
 *   3. Collect every id we see into a Set.
 *   4. Find local rows where date >= from AND id NOT IN the set → delete.
 *   5. Update reconciliation log.
 *
 * Why a window: the full table could be huge. 90 days covers the vast
 * majority of deletion cases (deletion is rare and usually shortly after
 * creation). Anything older that gets deleted will just become stale data —
 * acceptable trade-off for keeping the daily job bounded.
 */
async function runReconciliation({ windowDays = RECONCILE_WINDOW_DAYS, triggeredBy = 'cron' } = {}) {
  if (!centerApp.isConfigured()) {
    return { skipped: 'not_configured' };
  }
  if (_running) {
    return { skipped: 'already_running' };
  }
  _running = true;

  const fromDate = new Date(Date.now() - windowDays * 86400_000)
    .toISOString().slice(0, 10);
  const logId = openLog('reconciliation', triggeredBy, null);
  let fetched = 0, pages = 0, deleted = 0;

  try {
    const seenIds = new Set();
    let page = 1;
    let total = Infinity;

    while (page <= 10_000) {
      const resp = await centerApp.listTransactions({ from: fromDate, page, limit: PAGE_LIMIT });
      pages++;
      if (Number.isFinite(resp?.total)) total = resp.total;
      const list = Array.isArray(resp?.transactions) ? resp.transactions : [];
      fetched += list.length;
      for (const tx of list) if (tx && tx.id) seenIds.add(tx.id);
      if (list.length < PAGE_LIMIT) break;
      if (page * PAGE_LIMIT >= total) break;
      page++;
    }

    // Find local rows that fall in the window but aren't in the API's set.
    const localRows = db.prepare(
      `SELECT id FROM finance_transactions WHERE date >= ?`
    ).all(fromDate);

    const toDelete = localRows.map(r => r.id).filter(id => !seenIds.has(id));
    if (toDelete.length > 0) {
      const delStmt = db.prepare(`DELETE FROM finance_transactions WHERE id = ?`);
      const tx = db.transaction(() => {
        for (const id of toDelete) {
          delStmt.run(id);
          deleted++;
        }
      });
      tx();
    }

    closeLog(logId, {
      rows_fetched: fetched,
      rows_inserted: 0,
      rows_updated: 0,
      rows_skipped: deleted,           // reuse rows_skipped to surface delete count
      pages_fetched: pages,
      status: 'success',
    });

    if (deleted > 0) saveNow();
    return { mode: 'reconciliation', fetched, pages, deleted, window_from: fromDate };
  } catch (err) {
    const msg = (err && err.message) ? err.message.slice(0, 500) : String(err).slice(0, 500);
    try {
      closeLog(logId, {
        rows_fetched: fetched,
        pages_fetched: pages,
        status: 'error',
        error: msg,
      });
    } catch (_) {}
    console.error('[FinanceSync] reconciliation error:', msg);
    return { mode: 'reconciliation', error: msg, fetched, pages };
  } finally {
    _running = false;
  }
}

// ─── PUBLIC: STATUS ───────────────────────────────────────────────────────────

/**
 * Snapshot of sync health for the admin UI.
 */
function getStatus() {
  const state = getState();
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM finance_transactions)                        AS total_transactions,
      (SELECT COUNT(*) FROM finance_transactions WHERE status='pending')  AS pending,
      (SELECT COUNT(*) FROM finance_transactions WHERE status='approved') AS approved,
      (SELECT COUNT(*) FROM finance_transactions WHERE status='paid')     AS paid,
      (SELECT COUNT(*) FROM finance_transactions WHERE status='rejected') AS rejected,
      (SELECT COUNT(*) FROM finance_installments)                         AS total_installments
  `).get();

  const lastLogs = db.prepare(`
    SELECT id, started_at, finished_at, mode, status, rows_fetched,
           rows_inserted, rows_updated, rows_skipped, pages_fetched,
           cursor_before, cursor_after, error, triggered_by
      FROM finance_sync_log
     ORDER BY started_at DESC
     LIMIT 20
  `).all();

  return {
    configured: centerApp.isConfigured(),
    running: _running,
    state,
    counts,
    recent_logs: lastLogs,
  };
}

module.exports = {
  pollIncremental,
  runBackfill,
  runReconciliation,
  getStatus,
  // Exposed for tests
  _internals: { upsertBatch, normalizeTx, getState },
};
