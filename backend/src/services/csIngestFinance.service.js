'use strict';

/**
 * cs_* — Ingestion from finance_transactions (Center App Finance API).
 *
 * This is the third source of cs_subscriptions, alongside Excel Membership
 * and Drive Level Files. It reads finance_transactions populated by the
 * existing financeSync.service.js (Phase 1 of Finance Integration) and
 * upserts matching rows into cs_subscriptions with source='finance_api'.
 *
 * Rules:
 *   - Only `type IN ('new_enrollment','renewal','upgrade')` → create sub
 *   - Only `status IN ('approved','paid')` → ingested
 *   - `installment` rows are skipped (just payment events, not new subscriptions)
 *   - `refund`/`session`/`recommendation` rows are skipped
 *   - Idempotent via UNIQUE(source, source_ref). source_ref = finance_tx.id
 *
 * Dedup with Excel Membership:
 *   - Both can have the same purchase. Excel rows are kept (audit trail) but
 *     when a Finance API row for the same (phone, month, dept, ~date) lands,
 *     the Excel row is marked is_ignored=1 reason='superseded_by_finance_api'
 *     so the aggregator doesn't double-count.
 */

const db = require('../config/database');
const { saveNow } = require('../config/database');
const { csPrimaryPhone } = require('../utils/csPhoneNormalize');
const { parseCourseString } = require('../utils/csArabicParser');
const { matchClientByPhone } = require('./csIngestMembership.service');

const VALID_TYPES   = new Set(['new_enrollment', 'renewal', 'upgrade']);
const VALID_STATUSES = new Set(['approved', 'paid']);

function nowCairo() {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

const _upsertSubStmt = () => db.prepare(`
  INSERT INTO cs_subscriptions (
    client_id, client_phone_raw, client_phone_norm, client_name_raw,
    source, source_ref, product_name_raw,
    dept, months, total_levels, is_installment,
    amount, currency, subscription_date,
    is_ignored, ignore_reason, notes,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source, source_ref) DO UPDATE SET
    client_id         = excluded.client_id,
    client_phone_raw  = excluded.client_phone_raw,
    client_phone_norm = excluded.client_phone_norm,
    client_name_raw   = excluded.client_name_raw,
    product_name_raw  = excluded.product_name_raw,
    dept              = excluded.dept,
    months            = excluded.months,
    total_levels      = excluded.total_levels,
    is_installment    = excluded.is_installment,
    amount            = excluded.amount,
    currency          = excluded.currency,
    subscription_date = excluded.subscription_date,
    is_ignored        = excluded.is_ignored,
    ignore_reason     = excluded.ignore_reason,
    updated_at        = excluded.updated_at
`);

// ─── Excel dedup ──────────────────────────────────────────────────────────────

/**
 * After ingesting a Finance row for (phone, dept, months, date), mark any
 * matching Excel rows as superseded. "Matching" = same phone + same dept +
 * same months count + date within ±60 days.
 *
 * This prevents double-counting in csClientPlan aggregatePaid().
 */
function _markExcelSuperseded({ phoneNorm, dept, months, date }) {
  if (!phoneNorm || !dept || !months) return 0;
  const info = db.prepare(`
    UPDATE cs_subscriptions
       SET is_ignored = 1,
           ignore_reason = 'superseded_by_finance_api',
           updated_at = ?
     WHERE source = 'excel_membership'
       AND is_ignored = 0
       AND client_phone_norm = ?
       AND dept = ?
       AND months = ?
       AND (
         ? IS NULL
         OR subscription_date IS NULL
         OR ABS(julianday(?) - julianday(subscription_date)) <= 60
       )
  `).run(nowCairo(), phoneNorm, dept, months, date, date);
  return info.changes;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Walk finance_transactions and upsert subscription rows.
 *
 * Options:
 *   - sinceDate: 'YYYY-MM-DD' — only process rows with date >= this. Default
 *     null (process everything).
 *   - dryRun: true → analyze without writing.
 *   - limit: max rows to process per call (default 100k)
 *
 * Returns a summary.
 */
function runIngestion({ sinceDate = null, dryRun = false, limit = 100_000 } = {}) {
  const t0 = Date.now();

  const where = [];
  const params = [];
  // Only ingest valid types and successful statuses.
  where.push(`type IN ('new_enrollment','renewal','upgrade')`);
  where.push(`status IN ('approved','paid')`);
  if (sinceDate && /^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) {
    where.push(`date >= ?`);
    params.push(sinceDate);
  }

  const txs = db.prepare(`
    SELECT id, date, client_name, client_phone, type, amount, currency,
           product_name, status
      FROM finance_transactions
     WHERE ${where.join(' AND ')}
     ORDER BY date ASC, id ASC
     LIMIT ?
  `).all(...params, limit);

  let inserted = 0, ignored = 0, unparsed = 0,
      matchedClient = 0, unmatchedClient = 0,
      supersededExcel = 0;
  const stmt = _upsertSubStmt();
  const now = nowCairo();

  for (const tx of txs) {
    const phoneNorm = csPrimaryPhone(tx.client_phone);
    const parsed    = parseCourseString(tx.product_name);

    if (parsed.isIgnored) {
      ignored++;
      if (!dryRun) {
        const clientId = phoneNorm ? matchClientByPhone(phoneNorm) : null;
        stmt.run(
          clientId, tx.client_phone || null, phoneNorm, tx.client_name || null,
          'finance_api', tx.id, tx.product_name || null,
          null, null, null, 0,
          tx.amount || null, tx.currency || null, tx.date || null,
          1, parsed.reason || 'ignored_product', null,
          now, now,
        );
      }
      continue;
    }

    if (!parsed.dept || !parsed.months) {
      unparsed++;
      if (!dryRun) {
        const clientId = phoneNorm ? matchClientByPhone(phoneNorm) : null;
        stmt.run(
          clientId, tx.client_phone || null, phoneNorm, tx.client_name || null,
          'finance_api', tx.id, tx.product_name || null,
          parsed.dept, parsed.months, parsed.months, parsed.isInstallment ? 1 : 0,
          tx.amount || null, tx.currency || null, tx.date || null,
          0, parsed.reason || 'unparsed', null,
          now, now,
        );
      }
      continue;
    }

    const clientId = phoneNorm ? matchClientByPhone(phoneNorm) : null;
    if (clientId) matchedClient++; else unmatchedClient++;

    if (!dryRun) {
      stmt.run(
        clientId, tx.client_phone || null, phoneNorm, tx.client_name || null,
        'finance_api', tx.id, tx.product_name || null,
        parsed.dept, parsed.months, parsed.months, parsed.isInstallment ? 1 : 0,
        tx.amount || null, tx.currency || null, tx.date || null,
        0, null, null,
        now, now,
      );
      // De-dup with Excel: if this same purchase exists in excel_membership,
      // mark those as superseded to avoid double-counting.
      const n = _markExcelSuperseded({
        phoneNorm, dept: parsed.dept, months: parsed.months, date: tx.date,
      });
      supersededExcel += n;
      inserted++;
    }
  }

  if (!dryRun) saveNow();

  return {
    source: 'finance_api',
    scanned_transactions: txs.length,
    processed: inserted,
    ignored,
    unparsed,
    matched_to_client: matchedClient,
    unmatched_to_client: unmatchedClient,
    excel_rows_superseded: supersededExcel,
    since_date: sinceDate,
    dry_run: dryRun,
    duration_ms: Date.now() - t0,
  };
}

module.exports = {
  runIngestion,
};
