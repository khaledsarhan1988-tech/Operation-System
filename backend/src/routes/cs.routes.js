'use strict';

/**
 * Client Subscription Tracker (cs_*) — main API surface.
 *
 * Mount: /api/cs
 * All routes require authentication. Per-route role checks are explicit.
 *
 * This router is intentionally additive — it does NOT touch any existing
 * route, table, or service in the academy system.
 */

const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

// ─── INGESTION: Excel Membership ──────────────────────────────────────────────

/**
 * POST /api/cs/ingest/membership
 * Triggers ingestion of the latest "Membership From Finance Department.xlsx"
 * from Drive. Admin only.
 *
 * Query / body params:
 *   start_row=1058   (default = business-rule starting row)
 *   dry_run=1        (parse + count but don't write)
 */
router.post('/ingest/membership', requireRole('admin'), async (req, res) => {
  try {
    const csIngest = require('../services/csIngestMembership.service');
    const startRow = clampInt(req.body?.start_row ?? req.query?.start_row, 1, 100000, 1058);
    const dryRun   = (req.body?.dry_run ?? req.query?.dry_run) === '1'
                  || (req.body?.dry_run ?? req.query?.dry_run) === true;
    const result = await csIngest.runIngestion({ startRow, dryRun });
    res.json({ ok: true, result });
  } catch (e) {
    console.error('POST /cs/ingest/membership error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/cs/ingest/membership/preview
 * Parses the file (no DB writes) and returns first N parsed rows for review.
 * Admin only.
 */
router.get('/ingest/membership/preview', requireRole('admin'), async (req, res) => {
  try {
    const csIngest = require('../services/csIngestMembership.service');
    const drive = require('../services/googleDrive.service');
    const { csPrimaryPhone } = require('../utils/csPhoneNormalize');
    const { parseCourseString } = require('../utils/csArabicParser');

    const startRow = clampInt(req.query.start_row, 1, 100000, 1058);
    const limit    = clampInt(req.query.limit, 1, 500, 25);

    const { file } = await csIngest.findMembershipFile();
    const buf = await drive.downloadFile(file.id);
    const parsed = csIngest.parseMembershipBuffer(buf);
    const inScope = parsed.rows.filter(r => r.rowNo >= startRow).slice(0, limit);

    const preview = inScope.map(r => ({
      rowNo: r.rowNo,
      name: r.name,
      phone_raw: r.phoneRaw,
      phone_norm: csPrimaryPhone(r.phoneRaw),
      courses: r.courses,
      parsed: parseCourseString(r.courses),
    }));

    res.json({
      ok: true,
      file: { id: file.id, name: file.name, modifiedTime: file.modifiedTime },
      sheet: parsed.sheetName,
      total_rows_in_sheet: parsed.totalRows,
      rows_in_scope_total: parsed.rows.filter(r => r.rowNo >= startRow).length,
      start_row: startRow,
      preview_count: preview.length,
      preview,
    });
  } catch (e) {
    console.error('GET /cs/ingest/membership/preview error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── SUBSCRIPTIONS LIST ───────────────────────────────────────────────────────

/**
 * GET /api/cs/subscriptions
 * List subscriptions with filters. Admin / Leader only.
 */
router.get('/subscriptions', requireRole('admin', 'leader'), (req, res) => {
  try {
    const {
      q = '', dept = '', source = '', is_installment = '', is_ignored = '',
      from = '', to = '',
    } = req.query;
    const page  = clampInt(req.query.page, 1, 100000, 1);
    const limit = clampInt(req.query.limit, 1, 200, 50);
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];

    if (q && q.trim()) {
      where.push('(client_name_raw LIKE ? COLLATE NOCASE OR client_phone_norm LIKE ? OR client_phone_raw LIKE ?)');
      const t = `%${q.trim()}%`;
      params.push(t, t, t);
    }
    if (dept && ['General', 'Private', 'Semi'].includes(dept)) {
      where.push('dept = ?'); params.push(dept);
    }
    if (source && ['excel_membership', 'finance_api'].includes(source)) {
      where.push('source = ?'); params.push(source);
    }
    if (is_installment === '1' || is_installment === '0') {
      where.push('is_installment = ?'); params.push(parseInt(is_installment, 10));
    }
    if (is_ignored === '1' || is_ignored === '0') {
      where.push('is_ignored = ?'); params.push(parseInt(is_ignored, 10));
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('subscription_date >= ?'); params.push(from); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to))   { where.push('subscription_date <= ?'); params.push(to); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = db.prepare(`SELECT COUNT(*) AS n FROM cs_subscriptions ${whereSql}`).get(...params).n;
    const rows = db.prepare(`
      SELECT id, client_id, client_phone_raw, client_phone_norm, client_name_raw,
             source, source_ref, product_name_raw,
             dept, months, total_levels, is_installment,
             amount, currency, subscription_date,
             is_ignored, ignore_reason,
             created_at, updated_at
      FROM cs_subscriptions
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({ ok: true, page, limit, total, pages: Math.ceil(total / limit), subscriptions: rows });
  } catch (e) {
    console.error('GET /cs/subscriptions error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/cs/subscriptions/summary
 * Quick counts for the dashboard tile.
 */
router.get('/subscriptions/summary', requireRole('admin', 'leader'), (req, res) => {
  try {
    const row = db.prepare(`
      SELECT
        COUNT(*)                                          AS total,
        SUM(CASE WHEN is_ignored = 1 THEN 1 ELSE 0 END)    AS ignored,
        SUM(CASE WHEN is_installment = 1 THEN 1 ELSE 0 END) AS installment,
        SUM(CASE WHEN dept = 'General' THEN 1 ELSE 0 END)   AS general,
        SUM(CASE WHEN dept = 'Private' THEN 1 ELSE 0 END)   AS private_,
        SUM(CASE WHEN dept = 'Semi'    THEN 1 ELSE 0 END)   AS semi,
        SUM(CASE WHEN client_id IS NULL THEN 1 ELSE 0 END) AS unmatched,
        SUM(CASE WHEN source = 'excel_membership' THEN 1 ELSE 0 END) AS from_excel,
        SUM(CASE WHEN source = 'finance_api'      THEN 1 ELSE 0 END) AS from_api
      FROM cs_subscriptions
    `).get();
    res.json({ ok: true, summary: row || {} });
  } catch (e) {
    console.error('GET /cs/subscriptions/summary error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
