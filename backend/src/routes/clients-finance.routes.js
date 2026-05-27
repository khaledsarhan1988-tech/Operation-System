'use strict';

/**
 * Clients (Finance) routes — standalone read-only feed for the admin Clients page.
 *
 * Reads straight from the existing `finance_transactions` table (synced by the
 * Finance Integration in services/financeSync.service.js). No writes, no
 * impact on the sync engine, no changes to existing routes.
 *
 * Mount: /api/clients-finance
 * Access: admin role (and above).
 */

const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function isIsoDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// Allowed enum values mirror the Center App Finance API contract.
const ALLOWED_STATUS = new Set(['pending', 'approved', 'paid', 'rejected']);
const ALLOWED_TYPE   = new Set([
  'new_enrollment', 'renewal', 'upgrade', 'installment',
  'recommendation', 'session', 'refund',
]);

// ─── GET /transactions — paginated list with filters ──────────────────────────
router.get('/transactions', (req, res) => {
  try {
    const {
      q          = '',
      from       = '',
      to         = '',
      status     = '',
      type       = '',
      agent      = '',
      department = '',
      currency   = '',
    } = req.query;

    const page  = clampInt(req.query.page,  1, 100000, 1);
    const limit = clampInt(req.query.limit, 1, 500,    50);
    const offset = (page - 1) * limit;

    const where  = [];
    const params = [];

    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      where.push(`(client_name LIKE ? COLLATE NOCASE OR client_phone LIKE ?)`);
      params.push(term, term);
    }
    if (isIsoDate(from)) { where.push(`date >= ?`); params.push(from); }
    if (isIsoDate(to))   { where.push(`date <= ?`); params.push(to);   }
    if (status && ALLOWED_STATUS.has(status)) {
      where.push(`status = ?`); params.push(status);
    }
    if (type && ALLOWED_TYPE.has(type)) {
      where.push(`type = ?`); params.push(type);
    }
    if (agent && agent.trim()) {
      where.push(`agent_name = ?`); params.push(agent.trim());
    }
    if (department && department.trim()) {
      where.push(`department_name = ?`); params.push(department.trim());
    }
    if (currency && currency.trim()) {
      where.push(`currency = ?`); params.push(currency.trim().toUpperCase());
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM finance_transactions ${whereSql}`
    ).get(...params);
    const total = totalRow?.cnt || 0;

    const rows = db.prepare(`
      SELECT
        id, date, client_name, client_phone,
        type, amount, currency, category, status,
        discount_label, discount_pct,
        has_installments, product_id, product_name,
        deal_type, governorate,
        agent_id, agent_name,
        created_by, created_by_name,
        approved_by, approved_by_name, approved_at, rejection_reason,
        department_id, department_name,
        created_at, updated_at, synced_at
      FROM finance_transactions
      ${whereSql}
      ORDER BY date DESC, updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      transactions: rows,
    });
  } catch (e) {
    console.error('GET /clients-finance/transactions error:', e.message);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

// ─── GET /transactions/:id — single transaction + installments ────────────────
router.get('/transactions/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid transaction id' });
    }

    const tx = db.prepare(`
      SELECT
        id, date, client_name, client_phone,
        type, amount, currency, category, status,
        discount_label, discount_pct, job, classify, note,
        has_installments, product_id, product_name,
        deal_type, governorate,
        agent_id, agent_name,
        created_by, created_by_name,
        approved_by, approved_by_name, approved_at, rejection_reason,
        department_id, department_name,
        created_at, updated_at, synced_at,
        raw_json
      FROM finance_transactions
      WHERE id = ?
    `).get(id);

    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const installments = db.prepare(`
      SELECT installment_no, amount, due_date, paid, paid_at, note
      FROM finance_installments
      WHERE transaction_id = ?
      ORDER BY installment_no ASC, id ASC
    `).all(id);

    res.json({ transaction: tx, installments });
  } catch (e) {
    console.error('GET /clients-finance/transactions/:id error:', e.message);
    res.status(500).json({ error: 'Failed to load transaction details' });
  }
});

// ─── GET /filters — distinct values for filter dropdowns ──────────────────────
router.get('/filters', (req, res) => {
  try {
    const agents = db.prepare(`
      SELECT DISTINCT agent_name FROM finance_transactions
      WHERE agent_name IS NOT NULL AND TRIM(agent_name) != ''
      ORDER BY agent_name COLLATE NOCASE
    `).all().map(r => r.agent_name);

    const departments = db.prepare(`
      SELECT DISTINCT department_name FROM finance_transactions
      WHERE department_name IS NOT NULL AND TRIM(department_name) != ''
      ORDER BY department_name COLLATE NOCASE
    `).all().map(r => r.department_name);

    const currencies = db.prepare(`
      SELECT DISTINCT currency FROM finance_transactions
      WHERE currency IS NOT NULL AND TRIM(currency) != ''
      ORDER BY currency COLLATE NOCASE
    `).all().map(r => r.currency);

    res.json({
      agents,
      departments,
      currencies,
      statuses: ['pending', 'approved', 'paid', 'rejected'],
      types: [
        'new_enrollment', 'renewal', 'upgrade', 'installment',
        'recommendation', 'session', 'refund',
      ],
    });
  } catch (e) {
    console.error('GET /clients-finance/filters error:', e.message);
    res.status(500).json({ error: 'Failed to load filter options' });
  }
});

// ─── GET /summary — small dashboard at top of page ────────────────────────────
router.get('/summary', (req, res) => {
  try {
    const totals = db.prepare(`
      SELECT
        COUNT(*) AS total_tx,
        COUNT(DISTINCT client_phone) AS unique_clients,
        SUM(CASE WHEN status='pending'  THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status='paid'     THEN 1 ELSE 0 END) AS paid,
        SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected
      FROM finance_transactions
    `).get();
    res.json(totals || {});
  } catch (e) {
    console.error('GET /clients-finance/summary error:', e.message);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

module.exports = router;
