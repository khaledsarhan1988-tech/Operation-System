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

// ─── INGESTION: Drive Level Files ─────────────────────────────────────────────

/**
 * POST /api/cs/ingest/levels
 * Walk all dept folders (A-H Genaral / A-H Private / Private 2 in 1) and
 * ingest every level Excel found. Admin only.
 */
router.post('/ingest/levels', requireRole('admin'), async (req, res) => {
  try {
    const csLevels = require('../services/csIngestLevels.service');
    const onlyDept = req.body?.dept || req.query?.dept || null;
    const dryRun   = (req.body?.dry_run ?? req.query?.dry_run) === '1'
                  || (req.body?.dry_run ?? req.query?.dry_run) === true;
    const result = await csLevels.runIngestionAll({ onlyDept, dryRun });
    res.json({ ok: true, result });
  } catch (e) {
    console.error('POST /cs/ingest/levels error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── COMPLETED LEVELS ─────────────────────────────────────────────────────────

/**
 * GET /api/cs/completed-levels
 * Paginated list of every completed level row. Admin/Leader.
 */
router.get('/completed-levels', requireRole('admin', 'leader'), (req, res) => {
  try {
    const { q = '', dept = '', track = '', level = '' } = req.query;
    const page  = clampInt(req.query.page, 1, 100000, 1);
    const limit = clampInt(req.query.limit, 1, 500, 100);
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];

    if (q && q.trim()) {
      const t = `%${q.trim()}%`;
      where.push('(client_name_raw LIKE ? COLLATE NOCASE OR client_phone_norm LIKE ? OR group_name_raw LIKE ?)');
      params.push(t, t, t);
    }
    if (dept && ['General', 'Private', 'Semi'].includes(dept))      { where.push('dept = ?');   params.push(dept); }
    if (track && ['Starter', 'General', 'Conversation'].includes(track)) { where.push('track = ?'); params.push(track); }
    if (level && /^[1-5]$/.test(level)) { where.push('level_number = ?'); params.push(parseInt(level, 10)); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM cs_completed_levels ${whereSql}`).get(...params).n;

    const rows = db.prepare(`
      SELECT id, client_id, client_phone_norm, client_name_raw,
             track, level_number, level_order,
             drive_file_name, drive_folder, dept,
             group_name_raw, registration_date, synced_at
      FROM cs_completed_levels
      ${whereSql}
      ORDER BY level_order ASC, client_name_raw ASC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({ ok: true, page, limit, total, pages: Math.ceil(total / limit), rows });
  } catch (e) {
    console.error('GET /cs/completed-levels error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/cs/completed-levels/by-phone/:phone
 * Returns every completed level for a single client (by normalized phone).
 */
router.get('/completed-levels/by-phone/:phone', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const { csPrimaryPhone } = require('../utils/csPhoneNormalize');
    const phoneNorm = csPrimaryPhone(req.params.phone);
    if (!phoneNorm) return res.status(400).json({ ok: false, error: 'Invalid phone' });
    const rows = db.prepare(`
      SELECT id, track, level_number, level_order, drive_file_name, drive_folder,
             dept, group_name_raw, registration_date, synced_at
      FROM cs_completed_levels
      WHERE client_phone_norm = ?
      ORDER BY level_order ASC
    `).all(phoneNorm);
    res.json({ ok: true, phone: phoneNorm, levels: rows });
  } catch (e) {
    console.error('GET /cs/completed-levels/by-phone error:', e.message);
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

// ─── COORDINATORS ─────────────────────────────────────────────────────────────

/**
 * GET /api/cs/coordinators
 * Eligible team_members (enrollment / scheduling staff).
 */
router.get('/coordinators', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const csCoord = require('../services/csCoordinator.service');
    res.json({ ok: true, coordinators: csCoord.listEligibleCoordinators() });
  } catch (e) {
    console.error('GET /cs/coordinators error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/cs/coordinator/by-phone/:phone
 * Current coordinator + full history for one client.
 */
router.get('/coordinator/by-phone/:phone', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const { csPrimaryPhone } = require('../utils/csPhoneNormalize');
    const csCoord = require('../services/csCoordinator.service');
    const phoneNorm = csPrimaryPhone(req.params.phone);
    if (!phoneNorm) return res.status(400).json({ ok: false, error: 'Invalid phone' });
    const current = csCoord.getCurrentAssignment({ phoneNorm });
    const history = csCoord.getAssignmentHistory({ phoneNorm });
    res.json({ ok: true, phone: phoneNorm, current, history });
  } catch (e) {
    console.error('GET /cs/coordinator/by-phone error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/cs/coordinator/assign
 * Body: { phone, coordinator_id, notes? }
 * Assigns (or reassigns) a coordinator to a client. Admin/Leader only — agents
 * can only view, not change.
 */
router.post('/coordinator/assign', requireRole('admin', 'leader'), (req, res) => {
  try {
    const { csPrimaryPhone } = require('../utils/csPhoneNormalize');
    const csCoord = require('../services/csCoordinator.service');
    const { phone, coordinator_id, notes = null } = req.body || {};
    const phoneNorm = csPrimaryPhone(phone);
    if (!phoneNorm) return res.status(400).json({ ok: false, error: 'Invalid phone' });
    const coordId = parseInt(coordinator_id, 10);
    if (!Number.isFinite(coordId)) return res.status(400).json({ ok: false, error: 'Invalid coordinator_id' });

    // Resolve client_id from phone (best-effort)
    const cRow = db.prepare(`
      SELECT id FROM clients WHERE phone = ? OR phone = ? OR phone = '0' || ? LIMIT 1
    `).get(phoneNorm, phoneNorm.replace(/^0/, ''), phoneNorm.replace(/^0/, ''));

    const newId = csCoord.assignCoordinator({
      clientId: cRow?.id || null,
      phoneNorm,
      coordinatorId: coordId,
      assignedByUserId: req.user.id,
      reason: 'manual',
      notes,
    });
    res.json({ ok: true, assignment_id: newId });
  } catch (e) {
    console.error('POST /cs/coordinator/assign error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/cs/coordinator/auto-assign-all
 * Walk all known phones and auto-assign their last-known coordinator from
 * distribution_items, where available. Admin only.
 */
router.post('/coordinator/auto-assign-all', requireRole('admin'), (req, res) => {
  try {
    const csCoord = require('../services/csCoordinator.service');
    const result = csCoord.bulkAutoAssign({});
    res.json({ ok: true, result });
  } catch (e) {
    console.error('POST /cs/coordinator/auto-assign-all error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── PER-CLIENT PLAN (paid vs taken vs pending) ───────────────────────────────

/**
 * GET /api/cs/plan/by-phone/:phone
 * Returns the full subscription plan for one client: how many months paid,
 * which levels are completed, which are pending, and metadata for the UI.
 */
router.get('/plan/by-phone/:phone', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const csPlan = require('../services/csClientPlan.service');
    const result = csPlan.getClientPlan(req.params.phone);
    if (!result) return res.status(404).json({ ok: false, error: 'No data for this phone' });
    res.json({ ok: true, plan: result });
  } catch (e) {
    console.error('GET /cs/plan/by-phone error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
