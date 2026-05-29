'use strict';

/**
 * Internal Finance routes — Phase 1.
 *
 * Wraps the local mirror of Center App transactions for the academy admin UI.
 * Read operations serve straight from the local DB (no Center App round-trip);
 * write operations are limited to sync control (trigger / backfill / reconcile).
 *
 * Authorization (Phase 1): Super Admin only — admin role + management='All'.
 * In Phase 5 we'll relax this to also allow specific managers/leaders.
 */

const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/roles');
const financeSync = require('../services/financeSync.service');
const matcher = require('../services/financeMatcher.service');
const lifecycle = require('../services/clientLifecycle.service');
const subscriptionSync = require('../services/subscriptionSync.service');

const router = express.Router();
router.use(authenticate);
router.use(requireSuperAdmin);

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function isIsoDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// ─── SYNC CONTROL ─────────────────────────────────────────────────────────────

// GET /api/finance/sync/status — full health snapshot
router.get('/sync/status', (req, res) => {
  try {
    const status = financeSync.getStatus();
    res.json(status);
  } catch (e) {
    console.error('GET /finance/sync/status error:', e.message);
    res.status(500).json({ error: 'Failed to load sync status' });
  }
});

// POST /api/finance/sync/trigger — fire a one-off incremental poll
router.post('/sync/trigger', async (req, res) => {
  try {
    const r = await financeSync.pollIncremental({ triggeredBy: `manual:${req.user.id}` });
    res.json(r);
  } catch (e) {
    console.error('POST /finance/sync/trigger error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/finance/sync/backfill — body: { from?, to?, reset? }
router.post('/sync/backfill', async (req, res) => {
  const { from, to, reset } = req.body || {};
  if (from && !isIsoDate(from)) {
    return res.status(400).json({ error: 'from must be YYYY-MM-DD' });
  }
  if (to && !isIsoDate(to)) {
    return res.status(400).json({ error: 'to must be YYYY-MM-DD' });
  }
  try {
    const r = await financeSync.runBackfill({
      from: from || undefined,
      to: to || undefined,
      reset: !!reset,
      triggeredBy: `manual:${req.user.id}`,
    });
    res.json(r);
  } catch (e) {
    console.error('POST /finance/sync/backfill error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/finance/sync/reconcile — manual reconciliation, body: { windowDays? }
router.post('/sync/reconcile', async (req, res) => {
  const windowDays = clampInt(req.body?.windowDays, 1, 3650, 90);
  try {
    const r = await financeSync.runReconciliation({
      windowDays,
      triggeredBy: `manual:${req.user.id}`,
    });
    res.json(r);
  } catch (e) {
    console.error('POST /finance/sync/reconcile error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── READ-ONLY DATA ───────────────────────────────────────────────────────────

/**
 * GET /api/finance/transactions
 *   Query: from, to, status, type, currency, agent_id, department_id,
 *          q (phone/name substring), page (1+), limit (1..500)
 *   Returns: { page, limit, total, transactions: [...] }
 *
 * Serves from the LOCAL mirror — no Center App call. This is what every UI
 * feature should use; reach out to Center App only via the sync engine.
 */
router.get('/transactions', (req, res) => {
  try {
    const page  = clampInt(req.query.page, 1, 10_000, 1);
    const limit = clampInt(req.query.limit, 1, 500, 50);
    const offset = (page - 1) * limit;

    const wheres = [];
    const params = [];
    if (isIsoDate(req.query.from)) { wheres.push('date >= ?'); params.push(req.query.from); }
    if (isIsoDate(req.query.to))   { wheres.push('date <= ?'); params.push(req.query.to); }
    if (req.query.status)          { wheres.push('status = ?'); params.push(String(req.query.status)); }
    if (req.query.type)            { wheres.push('type = ?'); params.push(String(req.query.type)); }
    if (req.query.currency)        { wheres.push('currency = ?'); params.push(String(req.query.currency)); }
    if (req.query.agent_id)        { wheres.push('agent_id = ?'); params.push(String(req.query.agent_id)); }
    if (req.query.department_id)   { wheres.push('department_id = ?'); params.push(String(req.query.department_id)); }
    if (req.query.q) {
      const q = `%${String(req.query.q).trim()}%`;
      wheres.push('(client_name LIKE ? COLLATE NOCASE OR client_phone LIKE ?)');
      params.push(q, q);
    }

    const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

    const total = db.prepare(
      `SELECT COUNT(*) AS n FROM finance_transactions ${whereSql}`
    ).get(...params)?.n || 0;

    const rows = db.prepare(`
      SELECT id, date, client_name, client_phone, type, amount, currency, category,
             status, discount_label, discount_pct, has_installments,
             product_id, product_name, deal_type, governorate,
             agent_id, agent_name, created_by, created_by_name,
             approved_by, approved_by_name, approved_at, rejection_reason,
             department_id, department_name, created_at, updated_at,
             synced_at, matched_client_id
        FROM finance_transactions
        ${whereSql}
       ORDER BY date DESC, updated_at DESC
       LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({ page, limit, total, transactions: rows });
  } catch (e) {
    console.error('GET /finance/transactions error:', e.message);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

/**
 * GET /api/finance/transactions/:id
 *   Returns full row + installments[] + audit_events[] (whatever we have
 *   cached locally — Phase 1 doesn't auto-fetch the audit endpoint).
 */
router.get('/transactions/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id required' });

  try {
    const tx = db.prepare(`SELECT * FROM finance_transactions WHERE id = ?`).get(id);
    if (!tx) return res.status(404).json({ error: 'Not found' });

    const installments = db.prepare(`
      SELECT installment_no, amount, due_date, paid, paid_at, note
        FROM finance_installments
       WHERE transaction_id = ?
       ORDER BY installment_no ASC
    `).all(id);

    const audit = db.prepare(`
      SELECT event_type, event_at, actor_id, actor_name, details, fetched_at
        FROM finance_audit_events
       WHERE transaction_id = ?
       ORDER BY event_at ASC
    `).all(id);

    res.json({ transaction: tx, installments, audit });
  } catch (e) {
    console.error('GET /finance/transactions/:id error:', e.message);
    res.status(500).json({ error: 'Failed to load transaction' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — CLIENT MATCHING
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/finance/match/stats — counts by match_method bucket
router.get('/match/stats', (req, res) => {
  try {
    res.json(matcher.getMatchStats());
  } catch (e) {
    console.error('GET /finance/match/stats error:', e.message);
    res.status(500).json({ error: 'Failed to load match stats' });
  }
});

// GET /api/finance/match/transactions — list transactions filtered by match state
//   ?state=matched|ambiguous|unmatched|not_attempted   (default: all)
//   + standard q/page/limit
router.get('/match/transactions', (req, res) => {
  try {
    const page  = clampInt(req.query.page, 1, 10_000, 1);
    const limit = clampInt(req.query.limit, 1, 500, 50);
    const offset = (page - 1) * limit;
    const state = String(req.query.state || '').toLowerCase();

    const wheres = [];
    const params = [];
    if (state === 'matched')        wheres.push(`matched_client_id IS NOT NULL`);
    else if (state === 'ambiguous') wheres.push(`match_method = 'ambiguous'`);
    else if (state === 'unmatched') wheres.push(`match_method = 'unmatched'`);
    else if (state === 'not_attempted') wheres.push(`match_attempted_at IS NULL`);

    if (req.query.q) {
      const q = `%${String(req.query.q).trim()}%`;
      wheres.push('(client_name LIKE ? COLLATE NOCASE OR client_phone LIKE ?)');
      params.push(q, q);
    }

    const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM finance_transactions ${whereSql}`).get(...params)?.n || 0;
    const rows = db.prepare(`
      SELECT t.id, t.date, t.client_name, t.client_phone, t.type, t.amount, t.currency,
             t.status, t.product_name, t.classify,
             t.matched_client_id, t.match_method,
             t.match_confidence, t.match_attempted_at, t.matched_by,
             c.name AS matched_client_name, c.phone AS matched_client_phone,
             c.group_name AS matched_client_group, c.line AS matched_client_line,
             (CASE
                WHEN COALESCE(TRIM(t.client_name), '') = '' THEN NULL
                WHEN EXISTS(
                  SELECT 1 FROM clients sc
                  WHERE sc.name LIKE '%' || t.client_name || '%' COLLATE NOCASE
                  LIMIT 1
                ) THEN 1
                ELSE 0
              END) AS has_search_results
        FROM finance_transactions t
        LEFT JOIN clients c ON c.id = t.matched_client_id
        ${whereSql}
       ORDER BY CASE WHEN t.status = 'pending' THEN 0 ELSE 1 END,
                t.date DESC, t.updated_at DESC
       LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({ page, limit, total, transactions: rows });
  } catch (e) {
    console.error('GET /finance/match/transactions error:', e.message);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

// GET /api/finance/match/candidates/:tx_id — candidates for ambiguous matches
router.get('/match/candidates/:tx_id', (req, res) => {
  try {
    res.json({ candidates: matcher.getCandidatesForTx(req.params.tx_id) });
  } catch (e) {
    console.error('GET /finance/match/candidates error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/finance/match/transaction/:tx_id — auto-match a single tx, optionally forcing re-run
router.post('/match/transaction/:tx_id', (req, res) => {
  try {
    const lifecycleSvc = lifecycle;
    const r = matcher.matchTransaction(req.params.tx_id, {
      force: !!req.body?.force,
      onMatched: (clientId, txId) => {
        try { lifecycleSvc.regenerateFromTransactionId(txId); }
        catch (e) { console.error('lifecycle hook error:', e.message); }
      },
    });
    res.json(r);
  } catch (e) {
    console.error('POST /finance/match/transaction error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/finance/match/transaction/:tx_id/classify — admin overrides the
// line tag (classify) on a transaction.
//   body: { classify: 'Ahmed Hassan' | 'Dardasha' | null }   null → clear
// After updating, the caller usually runs re-match so the new line filter
// takes effect. We deliberately don't trigger that here to keep the action
// fast and predictable from the UI.
router.patch('/match/transaction/:tx_id/classify', (req, res) => {
  try {
    const txId = req.params.tx_id;
    const ALLOWED = ['Ahmed Hassan', 'Dardasha'];
    let value = req.body?.classify;
    if (value === null || value === undefined || value === '') value = null;
    if (value !== null && !ALLOWED.includes(value)) {
      return res.status(400).json({ error: `classify must be one of ${ALLOWED.join(', ')} or null` });
    }
    const tx = db.prepare(`SELECT id FROM finance_transactions WHERE id = ?`).get(txId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    db.prepare(`UPDATE finance_transactions SET classify = ? WHERE id = ?`).run(value, txId);
    res.json({ txId, classify: value });
  } catch (e) {
    console.error('PATCH /finance/match/transaction/:tx_id/classify error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/finance/match/transaction/:tx_id/manual — admin picks a client
//   body: { client_id: <id> | null, subscription_id: <id>? }
//     null  → unmatch
//     subscription_id → materialise the archive row into clients (or pick the
//                       existing matching row by phone+line), then match.
router.post('/match/transaction/:tx_id/manual', (req, res) => {
  try {
    let clientId = req.body?.client_id;
    const subscriptionId = req.body?.subscription_id;

    if (subscriptionId && !clientId) {
      const sub = db.prepare(
        `SELECT id, name, phone, phone_raw, group_name, line FROM subscription_clients WHERE id = ?`
      ).get(subscriptionId);
      if (!sub) {
        return res.status(404).json({ error: 'Subscription client not found' });
      }
      const phoneForClient = sub.phone_raw || sub.phone;
      const existing = db.prepare(
        `SELECT id FROM clients WHERE phone = ? AND line = ? LIMIT 1`
      ).get(phoneForClient, sub.line);
      if (existing) {
        clientId = existing.id;
      } else {
        const ins = db.prepare(
          `INSERT INTO clients (name, phone, group_name, line) VALUES (?, ?, ?, ?)`
        ).run(sub.name, phoneForClient, sub.group_name, sub.line);
        clientId = ins.lastInsertRowid;
      }
    }

    const lifecycleSvc = lifecycle;
    const r = matcher.manualMatch(req.params.tx_id, clientId, req.user.id, {
      onMatched: (cid, txId) => {
        try { lifecycleSvc.regenerateFromTransactionId(txId); }
        catch (e) { console.error('lifecycle hook error:', e.message); }
      },
    });
    res.json(r);
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMER SUBSCRIPTION ARCHIVE (Tier 2) — Ahmed Hassan-side only for now
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/finance/subscriptions/sync — pull the 38 historical-roster
// Excels from Drive into subscription_clients, then immediately re-run the
// matcher on every unmatched transaction so any archive hits land as real
// matches without a second click. Runs synchronously; ~30s on cold cache.
router.post('/subscriptions/sync', async (req, res) => {
  try {
    const triggeredBy = `manual:${req.user.id}`;
    const r = await subscriptionSync.syncAll({ triggeredBy });

    // Cascade: only the unmatched scope, since matched/manual rows are
    // already correct and shouldn't be perturbed.
    const lifecycleSvc = lifecycle;
    const rematch = matcher.matchAll({
      scope: 'unmatched',
      onMatched: (cid, txId) => {
        try { lifecycleSvc.regenerateFromTransactionId(txId); }
        catch (e) { console.error('lifecycle hook error:', e.message); }
      },
    });

    res.json({ ...r, rematch });
  } catch (e) {
    console.error('POST /finance/subscriptions/sync error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/finance/subscriptions/status — quick health probe
router.get('/subscriptions/status', (req, res) => {
  try { res.json(subscriptionSync.getStatus()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/finance/match/fix-lines — repair clients.line using batches as the
//   single source of truth. Updates any client whose group already lives in
//   batches under a different line, then triggers a full re-match so the
//   classify-based line filter picks up the corrected data.
//
//   This is a one-click rescue for the situation where the same trainees
//   Excel was uploaded to both line folders before the batches-aware sync
//   rule shipped (see sync.service.js syncTrainees). It does not touch
//   clients whose group is not in batches yet (legacy / brand-new groups).
router.post('/match/fix-lines', (req, res) => {
  try {
    // Find clients whose line disagrees with batches' line for the same group.
    const mismatched = db.prepare(`
      SELECT c.id, c.name, c.phone, c.group_name, c.line AS old_line, b.line AS new_line
        FROM clients c
        INNER JOIN (
          SELECT group_name, line FROM batches
            WHERE group_name IS NOT NULL AND group_name != ''
            GROUP BY group_name
        ) b ON b.group_name = c.group_name
       WHERE c.line != b.line
    `).all();

    let updated = 0;
    if (mismatched.length > 0) {
      const stmt = db.prepare(`UPDATE clients SET line = ? WHERE id = ?`);
      const tx = db.transaction(() => {
        for (const m of mismatched) { stmt.run(m.new_line, m.id); updated++; }
      });
      tx();
    }

    // Trigger a full re-match so the line filter picks up the fixed clients.
    const lifecycleSvc = lifecycle;
    const matchRes = matcher.matchAll({
      scope: 'all',
      onMatched: (cid, txId) => {
        try { lifecycleSvc.regenerateFromTransactionId(txId); }
        catch (e) { console.error('lifecycle hook error:', e.message); }
      },
    });

    res.json({
      clients_examined: mismatched.length,
      clients_updated: updated,
      sample: mismatched.slice(0, 5).map(m => ({
        name: m.name,
        phone: m.phone,
        group: m.group_name,
        from: m.old_line,
        to: m.new_line,
      })),
      rematch: matchRes,
    });
  } catch (e) {
    console.error('POST /finance/match/fix-lines error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/finance/match/run-all — bulk re-match
//   body: { scope: 'unattempted' | 'unmatched' | 'all' }   default 'unattempted'
router.post('/match/run-all', (req, res) => {
  try {
    const scope = ['unattempted', 'unmatched', 'all'].includes(req.body?.scope) ? req.body.scope : 'unattempted';
    const lifecycleSvc = lifecycle;
    const r = matcher.matchAll({
      scope,
      onMatched: (cid, txId) => {
        try { lifecycleSvc.regenerateFromTransactionId(txId); }
        catch (e) { console.error('lifecycle hook error:', e.message); }
      },
    });
    res.json(r);
  } catch (e) {
    console.error('POST /finance/match/run-all error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/finance/match/suggestions/:tx_id — smart suggestions for manual match
//   Returns:
//     - same_name:     clients whose tokenized name matches the transaction's
//     - similar_phone: clients whose normalized phone is within Levenshtein
//                      distance ≤ 2 of the transaction's phone (typo tolerance)
//   These are HINTS for the admin only — never auto-matched.
const { tokenizeName } = require('../services/financeMatcher.service');
const { normalizePhone, extractAllPhones } = require('../utils/phoneNormalize');

// Tiny Levenshtein implementation — fine for short Egyptian phone strings (≤ 14 chars).
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length, n = b.length;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

// Two names match if they share the same SET of tokens (order-agnostic).
function sameTokens(aTokens, bTokens) {
  if (aTokens.length === 0 || bTokens.length === 0) return false;
  if (aTokens.length !== bTokens.length) return false;
  const sa = [...aTokens].sort();
  const sb = [...bTokens].sort();
  return sa.every((t, i) => t === sb[i]);
}

router.get('/match/suggestions/:tx_id', (req, res) => {
  try {
    const txId = req.params.tx_id;
    const tx = db.prepare(
      `SELECT id, client_name, client_phone FROM finance_transactions WHERE id = ?`
    ).get(txId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const txTokens = tokenizeName(tx.client_name);
    const txPhones = extractAllPhones(tx.client_phone);
    const PHONE_DISTANCE_THRESHOLD = 2;

    // ── SAME NAME (token-exact, but discoverable for ANY phone difference) ──
    let sameName = [];
    if (txTokens.length > 0) {
      // Prefilter by the longest token for speed
      const longest = [...txTokens].sort((a, b) => b.length - a.length)[0];
      if (longest && longest.length >= 2) {
        const rows = db.prepare(
          `SELECT id, name, phone, group_name, line FROM clients
            WHERE name LIKE ? COLLATE NOCASE
            LIMIT 500`
        ).all(`%${longest}%`);
        sameName = rows.filter(c => sameTokens(tokenizeName(c.name), txTokens));
      }
    }

    // ── SIMILAR PHONE (Levenshtein ≤ 2 on normalized 11-digit form) ────────
    let similarPhone = [];
    if (txPhones.length > 0) {
      // Prefilter: any client whose phone column contains a 6-digit run
      // sharing 6 of the transaction's 9 trailing digits. Loose pre-filter
      // — exact-distance check happens in JS.
      const txTails = txPhones.map(p => p.slice(-9));
      const candidates = new Map();
      for (const tail of txTails) {
        // Prefix probing: try the first 6 digits of the tail to catch typos
        // in any of the last 3 positions
        const probe = tail.slice(0, 6);
        if (probe.length < 6) continue;
        const rows = db.prepare(
          `SELECT id, name, phone, group_name, line FROM clients
            WHERE phone LIKE ? LIMIT 500`
        ).all(`%${probe}%`);
        for (const c of rows) candidates.set(c.id, c);
      }

      const seenInSame = new Set(sameName.map(c => c.id));
      for (const c of candidates.values()) {
        if (seenInSame.has(c.id)) continue; // already in same_name
        const clientPhones = extractAllPhones(c.phone);
        if (clientPhones.length === 0) continue;
        let minDist = Infinity;
        for (const tp of txPhones) {
          for (const cp of clientPhones) {
            const d = levenshtein(tp, cp);
            if (d < minDist) minDist = d;
          }
        }
        if (minDist > 0 && minDist <= PHONE_DISTANCE_THRESHOLD) {
          similarPhone.push({ ...c, distance: minDist });
        }
      }
      // Sort closest-first then limit
      similarPhone.sort((a, b) => a.distance - b.distance);
      similarPhone = similarPhone.slice(0, 20);
    }

    // ── ARCHIVE: subscription_clients matches ──────────────────────────────
    // Surface historical-roster hits so the admin can recover ended-group
    // customers in one click. Match by phone (any digit suffix) OR by full
    // name token set (same rule as clients).
    let archive = [];
    {
      const archConds = [];
      const archParams = [];
      if (txPhones.length > 0) {
        for (const p of txPhones) {
          archConds.push(`phone_raw LIKE ?`);
          archParams.push(`%${p.slice(-9)}%`);
        }
      }
      if (txTokens.length > 0) {
        const longest = [...txTokens].sort((a, b) => b.length - a.length)[0];
        if (longest && longest.length >= 2) {
          archConds.push(`name LIKE ? COLLATE NOCASE`);
          archParams.push(`%${longest}%`);
        }
      }
      if (archConds.length > 0) {
        const archRows = db.prepare(
          `SELECT id, name, phone, phone_raw, group_name, group_status, line, source_file
             FROM subscription_clients
            WHERE ${archConds.join(' OR ')}
            LIMIT 500`
        ).all(...archParams);
        archive = archRows.filter(c => {
          const archPhones = extractAllPhones(c.phone_raw);
          const phoneHit = txPhones.length > 0 && archPhones.some(p => txPhones.includes(p));
          const nameHit = sameTokens(tokenizeName(c.name), txTokens);
          return phoneHit || nameHit;
        }).slice(0, 20).map(c => ({ ...c, match_kind: 'archive' }));
      }
    }

    res.json({
      tx: {
        id: tx.id,
        client_name: tx.client_name,
        client_phone: tx.client_phone,
      },
      suggestions: {
        same_name: sameName.slice(0, 20),
        similar_phone: similarPhone,
        archive,
      },
    });
  } catch (e) {
    console.error('GET /finance/match/suggestions error:', e.message);
    res.status(500).json({ error: 'Failed to load suggestions' });
  }
});

// GET /api/finance/match/clients/search — search academy clients for manual match UI
router.get('/match/clients/search', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ clients: [] });
    const like = `%${q}%`;
    const rows = db.prepare(`
      SELECT id, name, phone, group_name, line
        FROM clients
       WHERE name LIKE ? COLLATE NOCASE OR phone LIKE ?
       ORDER BY name ASC
       LIMIT 50
    `).all(like, like);
    res.json({ clients: rows });
  } catch (e) {
    console.error('GET /finance/match/clients/search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — CLIENT LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/finance/lifecycle/stats — counts by event_type/category/level
router.get('/lifecycle/stats', (req, res) => {
  try {
    res.json(lifecycle.getStats());
  } catch (e) {
    console.error('GET /finance/lifecycle/stats error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/finance/lifecycle/client/:client_id — full timeline for one client
router.get('/lifecycle/client/:client_id', (req, res) => {
  const cid = parseInt(req.params.client_id, 10);
  if (!Number.isFinite(cid)) return res.status(400).json({ error: 'invalid client_id' });
  try {
    const client = db.prepare(`SELECT id, name, phone, group_name, line FROM clients WHERE id = ?`).get(cid);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const events = lifecycle.getClientTimeline(cid, { limit: clampInt(req.query.limit, 1, 1000, 500) });
    res.json({ client, events });
  } catch (e) {
    console.error('GET /finance/lifecycle/client error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/finance/lifecycle/regenerate-all — rebuild every matched tx → event
router.post('/lifecycle/regenerate-all', (req, res) => {
  try {
    res.json(lifecycle.regenerateAll());
  } catch (e) {
    console.error('POST /finance/lifecycle/regenerate-all error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/finance/lifecycle/search-clients — quick client lookup
// Builds a tolerant phone search that handles the common variations:
// the stored value may be "1212207286" while the admin types
// "01212207286" (or vice versa, or with a country code). We feed the
// query through a set of normalised digit forms and OR them all into
// the LIKE filter so the row matches regardless of which form was kept.
router.get('/lifecycle/search-clients', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ clients: [] });

    const params = [`%${q}%`];                       // name match (always)
    const phoneClauses = [`c.phone LIKE ?`];
    params.push(`%${q}%`);                            // raw phone match

    const digits = q.replace(/\D+/g, '');
    if (digits.length >= 7) {
      const variants = new Set([digits]);
      if (digits.startsWith('0')) variants.add(digits.slice(1));
      else variants.add('0' + digits);
      if (digits.length > 9) variants.add(digits.slice(-9));  // last 9 digits
      for (const v of variants) {
        phoneClauses.push(`c.phone LIKE ?`);
        params.push(`%${v}%`);
      }
    }

    const where = `(c.name LIKE ? COLLATE NOCASE OR ${phoneClauses.join(' OR ')})`;
    const rows = db.prepare(`
      SELECT DISTINCT c.id, c.name, c.phone, c.group_name, c.line,
             (SELECT COUNT(*) FROM client_lifecycle_events WHERE client_id = c.id) AS events
        FROM clients c
       WHERE ${where}
       ORDER BY c.name ASC
       LIMIT 50
    `).all(...params);
    res.json({ clients: rows.filter(r => r.events > 0) });
  } catch (e) {
    console.error('GET /finance/lifecycle/search-clients error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/finance/sync/logs — paginated log of every sync run
router.get('/sync/logs', (req, res) => {
  const page  = clampInt(req.query.page, 1, 10_000, 1);
  const limit = clampInt(req.query.limit, 1, 200, 50);
  const offset = (page - 1) * limit;
  try {
    const total = db.prepare(`SELECT COUNT(*) AS n FROM finance_sync_log`).get()?.n || 0;
    const rows = db.prepare(`
      SELECT * FROM finance_sync_log
       ORDER BY started_at DESC
       LIMIT ? OFFSET ?
    `).all(limit, offset);
    res.json({ page, limit, total, logs: rows });
  } catch (e) {
    console.error('GET /finance/sync/logs error:', e.message);
    res.status(500).json({ error: 'Failed to load logs' });
  }
});

module.exports = router;
