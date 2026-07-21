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
const { requireRole, requirePageOrManagement } = require('../middleware/roles');

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
    const startRow = clampInt(req.body?.start_row ?? req.query?.start_row, 1, 100000, 1);
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

    const startRow = clampInt(req.query.start_row, 1, 100000, 1);
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

// ─── INGESTION: Finance API (Center App) ──────────────────────────────────────

/**
 * POST /api/cs/ingest/finance
 * Walk finance_transactions and create matching cs_subscriptions rows
 * (source='finance_api'). Auto-marks duplicate Excel rows as superseded.
 * Admin only.
 *
 * Body / query:
 *   since_date='YYYY-MM-DD'  — only process newer txs (default: all)
 *   dry_run=1                — analyze without writing
 */
router.post('/ingest/finance', requireRole('admin'), (req, res) => {
  try {
    const csFinance = require('../services/csIngestFinance.service');
    const sinceDate = req.body?.since_date || req.query?.since_date || null;
    const dryRun    = (req.body?.dry_run ?? req.query?.dry_run) === '1'
                  || (req.body?.dry_run ?? req.query?.dry_run) === true;
    const result = csFinance.runIngestion({ sinceDate, dryRun });
    res.json({ ok: true, result });
  } catch (e) {
    console.error('POST /cs/ingest/finance error:', e.message);
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

// ─── REMINDERS + NOTES ────────────────────────────────────────────────────────

/**
 * GET /api/cs/reminders/by-phone/:phone
 * All reminders for a client. ?include_deleted=1 (admin/leader only).
 */
router.get('/reminders/by-phone/:phone', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const { csPrimaryPhone } = require('../utils/csPhoneNormalize');
    const csRem = require('../services/csReminders.service');
    const phoneNorm = csPrimaryPhone(req.params.phone);
    if (!phoneNorm) return res.status(400).json({ ok: false, error: 'Invalid phone' });

    const includeDeleted = (req.query.include_deleted === '1') &&
                           (req.user.role === 'admin' || req.user.role === 'leader');
    res.json({ ok: true, phone: phoneNorm, reminders: csRem.listForClient({ phoneNorm, includeDeleted }) });
  } catch (e) {
    console.error('GET /cs/reminders/by-phone error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/cs/reminders/pending/mine
 * Pending reminders within the current user's scope.
 */
router.get('/reminders/pending/mine', (req, res) => {
  try {
    const csRem = require('../services/csReminders.service');
    res.json({ ok: true, reminders: csRem.pendingForUser(req.user, { limit: 500 }) });
  } catch (e) {
    console.error('GET /cs/reminders/pending/mine error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/cs/reminders
 * Body: { phone, reminder_at, note, severity?, reminder_type? }
 * Any authenticated user can add (within their scope).
 */
router.post('/reminders', (req, res) => {
  try {
    const { csPrimaryPhone } = require('../utils/csPhoneNormalize');
    const csRem = require('../services/csReminders.service');
    const { phone, reminder_at, note, severity, reminder_type = 'manual' } = req.body || {};
    const phoneNorm = csPrimaryPhone(phone);
    if (!phoneNorm)    return res.status(400).json({ ok: false, error: 'Invalid phone' });
    if (!reminder_at)  return res.status(400).json({ ok: false, error: 'reminder_at required' });
    if (!note)         return res.status(400).json({ ok: false, error: 'note required' });

    // Resolve client_id
    const cRow = db.prepare(`SELECT id FROM clients WHERE phone = ? OR phone = ? OR phone = '0' || ? LIMIT 1`)
      .get(phoneNorm, phoneNorm.replace(/^0/, ''), phoneNorm.replace(/^0/, ''));

    const id = csRem.addReminder({
      clientId: cRow?.id || null,
      phoneNorm,
      reminderAt: reminder_at,
      note,
      severity: severity || null,
      reminderType: reminder_type,
      createdByUserId: req.user.id,
    });
    res.json({ ok: true, reminder_id: id });
  } catch (e) {
    console.error('POST /cs/reminders error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * PATCH /api/cs/reminders/:id
 * Body: any of { reminder_at, severity, note, status, snoozed_until }
 */
router.patch('/reminders/:id', (req, res) => {
  try {
    const csRem = require('../services/csReminders.service');
    const reminderId = parseInt(req.params.id, 10);
    if (!Number.isFinite(reminderId)) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const updated = csRem.editReminder({ reminderId, fields: req.body || {}, byUserId: req.user.id });
    if (!updated) return res.status(404).json({ ok: false, error: 'Reminder not found or already deleted' });
    res.json({ ok: true });
  } catch (e) {
    console.error('PATCH /cs/reminders error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/cs/reminders/:id/done
 * Mark as done.
 */
router.post('/reminders/:id/done', (req, res) => {
  try {
    const csRem = require('../services/csReminders.service');
    const reminderId = parseInt(req.params.id, 10);
    if (!Number.isFinite(reminderId)) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const ok = csRem.setReminderStatus({ reminderId, status: 'done', byUserId: req.user.id });
    if (!ok) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /cs/reminders/:id/done error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * DELETE /api/cs/reminders/:id
 * Soft delete. Admin OR manager (management='All') only.
 */
router.delete('/reminders/:id', (req, res) => {
  try {
    const csRem = require('../services/csReminders.service');
    const reminderId = parseInt(req.params.id, 10);
    if (!Number.isFinite(reminderId)) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const ok = csRem.deleteReminder({ reminderId, byUser: req.user });
    if (!ok) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'FORBIDDEN') return res.status(403).json({ ok: false, error: e.message });
    console.error('DELETE /cs/reminders error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

/**
 * GET /api/cs/notifications/mine
 * Active notifications for the current user (as recipient).
 *   ?include_read=1 — also include already-read ones
 *   ?include_resolved=1 — also include resolved notifications (history)
 */
router.get('/notifications/mine', (req, res) => {
  try {
    const includeRead     = req.query.include_read === '1';
    const includeResolved = req.query.include_resolved === '1';

    const where = ['nr.user_id = ?'];
    const params = [req.user.id];
    if (!includeResolved) where.push('n.is_active = 1');
    if (!includeRead)     where.push('nr.is_read = 0');

    const rows = db.prepare(`
      SELECT n.id, n.client_id, n.client_phone_norm, n.notif_type, n.severity,
             n.title, n.message, n.meta_json, n.triggered_at, n.is_active,
             n.resolved_at, n.resolution_reason,
             nr.role_context, nr.is_read, nr.read_at,
             (SELECT c.name FROM clients c WHERE c.id = n.client_id LIMIT 1) AS client_name
        FROM cs_notifications n
        INNER JOIN cs_notif_recipients nr ON nr.notif_id = n.id
       WHERE ${where.join(' AND ')}
       ORDER BY
         CASE n.severity
           WHEN 'critical' THEN 1 WHEN 'urgent' THEN 2
           WHEN 'warning'  THEN 3 WHEN 'info'   THEN 4
           ELSE 5
         END ASC,
         n.triggered_at DESC
       LIMIT 500
    `).all(...params);
    res.json({ ok: true, notifications: rows });
  } catch (e) {
    console.error('GET /cs/notifications/mine error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/cs/notifications/:id/read
 * Mark a notification as read by the current user.
 */
router.post('/notifications/:id/read', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const now = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const info = db.prepare(`
      UPDATE cs_notif_recipients
         SET is_read = 1, read_at = ?
       WHERE notif_id = ? AND user_id = ? AND is_read = 0
    `).run(now, id, req.user.id);
    res.json({ ok: true, updated: info.changes });
  } catch (e) {
    console.error('POST /cs/notifications/:id/read error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/cs/notifications/read-all
 * Mark all of the current user's active notifications as read.
 */
router.post('/notifications/read-all', (req, res) => {
  try {
    const now = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const info = db.prepare(`
      UPDATE cs_notif_recipients
         SET is_read = 1, read_at = ?
       WHERE user_id = ? AND is_read = 0
    `).run(now, req.user.id);
    res.json({ ok: true, updated: info.changes });
  } catch (e) {
    console.error('POST /cs/notifications/read-all error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/cs/alerts/run-now
 * Manually trigger the alert sweep. Admin only.
 *   ?dry_run=1 → analyze without writing notifications
 */
router.post('/alerts/run-now', requireRole('admin'), (req, res) => {
  try {
    const csAlerts = require('../services/csAlerts.service');
    const dryRun = (req.query.dry_run === '1') || (req.body?.dry_run === true);
    const result = csAlerts.runOnce({ dryRun });
    res.json({ ok: true, result });
  } catch (e) {
    console.error('POST /cs/alerts/run-now error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/cs/notifications/by-phone/:phone
 * All notifications (active + resolved) for one client. For the client-profile UI.
 */
router.get('/notifications/by-phone/:phone', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const { csPrimaryPhone } = require('../utils/csPhoneNormalize');
    const phoneNorm = csPrimaryPhone(req.params.phone);
    if (!phoneNorm) return res.status(400).json({ ok: false, error: 'Invalid phone' });
    const rows = db.prepare(`
      SELECT id, notif_type, severity, title, message, meta_json,
             triggered_at, is_active, resolved_at, resolution_reason
        FROM cs_notifications
       WHERE client_phone_norm = ?
       ORDER BY is_active DESC, triggered_at DESC
    `).all(phoneNorm);
    res.json({ ok: true, phone: phoneNorm, notifications: rows });
  } catch (e) {
    console.error('GET /cs/notifications/by-phone error:', e.message);
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

// ─── ADMIN/LEADER DASHBOARD AGGREGATES ────────────────────────────────────────

/**
 * GET /api/cs/dashboard/overview
 * Big-picture stats: totals, by-dept, by-severity, active notifs, pending-counts.
 */
router.get('/dashboard/overview', requireRole('admin', 'leader'), (req, res) => {
  try {
    const subsSummary = db.prepare(`
      SELECT
        COUNT(*)                                              AS total_subs,
        COUNT(DISTINCT client_phone_norm)                     AS distinct_clients,
        SUM(CASE WHEN dept='General' THEN 1 ELSE 0 END)       AS general,
        SUM(CASE WHEN dept='Private' THEN 1 ELSE 0 END)       AS private_,
        SUM(CASE WHEN dept='Semi'    THEN 1 ELSE 0 END)       AS semi,
        SUM(CASE WHEN is_installment=1 THEN 1 ELSE 0 END)     AS installments,
        SUM(CASE WHEN is_ignored=1 THEN 1 ELSE 0 END)         AS ignored
      FROM cs_subscriptions
    `).get();

    const levelSummary = db.prepare(`
      SELECT
        COUNT(*) AS rows_total,
        COUNT(DISTINCT client_phone_norm) AS distinct_clients,
        SUM(CASE WHEN track='Starter'      THEN 1 ELSE 0 END) AS starter,
        SUM(CASE WHEN track='General'      THEN 1 ELSE 0 END) AS general,
        SUM(CASE WHEN track='Conversation' THEN 1 ELSE 0 END) AS conversation
      FROM cs_completed_levels
    `).get();

    const notifSummary = db.prepare(`
      SELECT
        SUM(CASE WHEN severity='critical' AND is_active=1 THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN severity='urgent'   AND is_active=1 THEN 1 ELSE 0 END) AS urgent,
        SUM(CASE WHEN severity='warning'  AND is_active=1 THEN 1 ELSE 0 END) AS warning,
        SUM(CASE WHEN severity='info'     AND is_active=1 THEN 1 ELSE 0 END) AS info,
        SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) AS total_active
      FROM cs_notifications
    `).get();

    const remindSummary = db.prepare(`
      SELECT
        SUM(CASE WHEN status='pending'  AND deleted_at IS NULL THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='done'     AND deleted_at IS NULL THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN status='snoozed'  AND deleted_at IS NULL THEN 1 ELSE 0 END) AS snoozed,
        SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted
      FROM cs_reminders
    `).get();

    const coordSummary = db.prepare(`
      SELECT COUNT(DISTINCT client_phone_norm) AS assigned_clients,
             COUNT(DISTINCT coordinator_id)    AS distinct_coords
      FROM cs_client_coordinator
      WHERE unassigned_at IS NULL
    `).get();

    res.json({
      ok: true,
      subscriptions: subsSummary,
      completed_levels: levelSummary,
      notifications: notifSummary,
      reminders: remindSummary,
      coordinators: coordSummary,
    });
  } catch (e) {
    console.error('GET /cs/dashboard/overview error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/cs/dashboard/extra-courses
 * Clients who reached Conversation 5 and have remaining paid months —
 * eligible for extra courses (business / conversation extras).
 */
router.get('/dashboard/extra-courses', requireRole('admin', 'leader'), (req, res) => {
  try {
    // Phones with completed Conversation 5 (level_order=13)
    const con5Phones = db.prepare(`
      SELECT DISTINCT client_phone_norm, client_name_raw
        FROM cs_completed_levels
       WHERE level_order = 13
    `).all();

    const out = [];
    const csPlan = require('../services/csClientPlan.service');
    for (const r of con5Phones) {
      const plan = csPlan.getClientPlan(r.client_phone_norm);
      if (plan && plan.extra_courses_eligible) {
        out.push({
          phone: r.client_phone_norm,
          name: r.client_name_raw || plan.completed?.[0]?.client_name_raw || null,
          paid_months: plan.summary.paid_months,
          completed_count: plan.summary.completed_count,
          overflow_months: plan.summary.overflow_months,
          depts: plan.summary.depts_paid,
        });
      }
    }
    res.json({ ok: true, total: out.length, clients: out });
  } catch (e) {
    console.error('GET /cs/dashboard/extra-courses error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/cs/dashboard/at-risk
 * Clients with the most-severe active notifications, paginated by severity.
 */
router.get('/dashboard/at-risk', requireRole('admin', 'leader'), (req, res) => {
  try {
    const sev = (req.query.severity || '').trim();
    const where = ['n.is_active = 1'];
    const params = [];
    if (['critical', 'urgent', 'warning', 'info'].includes(sev)) {
      where.push('n.severity = ?'); params.push(sev);
    }

    const rows = db.prepare(`
      SELECT n.id, n.client_id, n.client_phone_norm, n.notif_type, n.severity,
             n.title, n.message, n.meta_json, n.triggered_at,
             (SELECT c.name FROM clients c WHERE c.id = n.client_id LIMIT 1) AS client_name,
             (SELECT tm.name FROM cs_client_coordinator cc
                 LEFT JOIN team_members tm ON tm.id = cc.coordinator_id
                WHERE cc.unassigned_at IS NULL AND cc.client_phone_norm = n.client_phone_norm
                LIMIT 1) AS coordinator_name
        FROM cs_notifications n
       WHERE ${where.join(' AND ')}
       ORDER BY
         CASE n.severity WHEN 'critical' THEN 1 WHEN 'urgent' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END,
         n.triggered_at DESC
       LIMIT 500
    `).all(...params);

    res.json({ ok: true, total: rows.length, clients: rows });
  } catch (e) {
    console.error('GET /cs/dashboard/at-risk error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── DEPARTMENT DELIVERIES (تسليمات الأقسام) ──────────────────────────────────

/**
 * GET /api/cs/deliveries?dept=General|Private|Semi&q=&status=&page=&page_size=
 * Per-department client deliveries table: membership count, manual status,
 * active groups, inactive (past) groups, remaining levels, coordinator.
 * Visible to admin / leader / coordinator (agent).
 */
// READ guard: the usual roles OR a holder of the «تسليمات الأقسام» page grant
// (extra_pages: cs-deliveries) — granting a page must open its API too (owner
// rule; live case: an Enrollment user with the granted page searched a client
// and saw an empty table because the route rejected role 'enrollment').
const deliveriesRead = (req, res, next) => {
  if (['admin', 'leader', 'agent'].includes(req.user?.role)) return next();
  const pages = String(req.user?.extra_pages || '').split(',').map(s => s.trim());
  if (pages.includes('cs-deliveries')) return next();
  return res.status(403).json({ error: 'Forbidden' });
};
router.get('/deliveries', deliveriesRead, (req, res) => {
  try {
    const svc = require('../services/csDeliveries.service');
    const result = svc.getDepartmentDeliveries({
      dept:         (req.query.dept || '').trim(),
      q:            (req.query.q || '').trim(),
      status:       (req.query.status || '').trim(),
      coordinator:  (req.query.coordinator || '').trim(),
      firstFrom:    (req.query.first_from || '').trim(),
      firstTo:      (req.query.first_to || '').trim(),
      lastFrom:     (req.query.last_from || '').trim(),
      lastTo:       (req.query.last_to || '').trim(),
      remainingMin: req.query.remaining_min,
      remainingMax: req.query.remaining_max,
      page:         req.query.page,
      pageSize:     req.query.page_size,
      user:         req.user,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('GET /cs/deliveries error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * PATCH /api/cs/deliveries/:phone/status
 * Set the MANUAL delivery status for one client.
 * Body: { status: 'active'|'churned'|'postponed'|'exit_level'|'refund', note? }
 */
router.patch('/deliveries/:phone/status', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const svc = require('../services/csDeliveries.service');
    const result = svc.setDeliveryStatus({
      phone:    req.params.phone,
      status:   req.body?.status,
      note:     req.body?.note,
      userId:   req.user?.id,
      userName: req.user?.full_name || req.user?.name || null,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('PATCH /cs/deliveries/:phone/status error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * PUT /api/cs/deliveries/:phone/settle   — تسوية: close a membership by an
 * owner-approved deal (e.g. remaining levels converted to a Business level).
 * Body: { dept: 'General'|'Private'|'Semi', note? }. Admin only.
 * DELETE with ?dept= reverses it.
 */
router.put('/deliveries/:phone/settle', requireRole('admin', 'enrollment'), (req, res) => {
  try {
    const svc = require('../services/csDeliveries.service');
    res.json({ ok: true, ...svc.setSettlement({
      phone: req.params.phone, dept: req.body?.dept, note: req.body?.note,
      userId: req.user?.id, userName: req.user?.full_name || req.user?.name || null,
    }) });
  } catch (e) {
    console.error('PUT /cs/deliveries/:phone/settle error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.delete('/deliveries/:phone/settle', requireRole('admin', 'enrollment'), (req, res) => {
  try {
    const svc = require('../services/csDeliveries.service');
    res.json({ ok: true, ...svc.clearSettlement({ phone: req.params.phone, dept: req.query?.dept || req.body?.dept }) });
  } catch (e) {
    console.error('DELETE /cs/deliveries/:phone/settle error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * PUT /api/cs/deliveries/:phone/exclude-group — استبعاد مجموعة يدويًّا من حساب
 * عميل واحد (borderline journeys the owner reviews himself). Body: { group, note? }.
 * DELETE with ?group= restores it. Admin only.
 */
router.put('/deliveries/:phone/exclude-group', requireRole('admin', 'enrollment'), (req, res) => {
  try {
    const svc = require('../services/csDeliveries.service');
    res.json({ ok: true, ...svc.excludeClientGroup({
      phone: req.params.phone, group: req.body?.group, note: req.body?.note,
      userId: req.user?.id, userName: req.user?.full_name || req.user?.name || null,
    }) });
  } catch (e) {
    console.error('PUT /cs/deliveries/:phone/exclude-group error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.delete('/deliveries/:phone/exclude-group', requireRole('admin', 'enrollment'), (req, res) => {
  try {
    const svc = require('../services/csDeliveries.service');
    res.json({ ok: true, ...svc.restoreClientGroup({ phone: req.params.phone, group: req.query?.group || req.body?.group }) });
  } catch (e) {
    console.error('DELETE /cs/deliveries/:phone/exclude-group error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── ENR GROUPS (مجموعات الـ Enrollment) ──────────────────────────────────────

// Enr Groups access guard: any admin OR a user granted the 'enr-groups' page.
// requirePageOrManagement with no requiredMgmt → any admin passes (same as the
// old requireRole('admin')) PLUS extra_pages grant holders. Applied to every
// /enr-groups route below so a scoped non-admin can use the page without full
// admin rights. (Owner decision 2026-07-04.)
const enrGuard = requirePageOrManagement('enr-groups');
// «المستويات الشغّالة» has its OWN grant key (`enr-levels`) so it can be granted
// independently of Enr Groups. Any admin passes; otherwise the user needs the
// 'enr-levels' page in extra_pages. Applied to the 3 levels-overview endpoints.
const levelsGuard = requirePageOrManagement('enr-levels');

/**
 * GET /api/cs/enr-groups?dept=General|Private|Semi&q=&page=&page_size=
 * Group-oriented view: every ACTIVE group that has STARTED (≥1 registered main
 * lecture), with the clients inside it and the group's first/last lecture dates.
 * Admin, OR granted 'enr-groups'.
 */
router.get('/enr-groups', enrGuard, (req, res) => {
  try {
    const svc = require('../services/csEnrGroups.service');
    const result = svc.getEnrGroups({
      dept:      (req.query.dept || '').trim(),
      q:         (req.query.q || '').trim(),
      status:    (req.query.status || '').trim(),
      firstFrom: (req.query.first_from || '').trim(),
      firstTo:   (req.query.first_to || '').trim(),
      lastFrom:  (req.query.last_from || '').trim(),
      lastTo:    (req.query.last_to || '').trim(),
      page:      req.query.page,
      pageSize:  req.query.page_size,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('GET /cs/enr-groups error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/cs/enr-groups/levels-overview?dept=General|Private|Semi&q=&status=&page=&page_size=
 * Level-oriented view (المستويات الشغّالة): every active/waiting group in the
 * dept with its level + code + day + first/last lecture date + trainer +
 * student count, sorted by the level ladder. Admin, OR granted 'enr-groups'.
 */
router.get('/enr-groups/levels-overview', levelsGuard, (req, res) => {
  try {
    const svc = require('../services/csEnrGroups.service');
    const result = svc.getLevelsOverview({
      dept:      (req.query.dept || '').trim(),
      q:         (req.query.q || '').trim(),
      status:    (req.query.status || '').trim(),
      firstFrom: (req.query.first_from || '').trim(),
      firstTo:   (req.query.first_to || '').trim(),
      lastFrom:  (req.query.last_from || '').trim(),
      lastTo:    (req.query.last_to || '').trim(),
      days:      (req.query.days || '').trim(),
      level:     (req.query.level || '').trim(),
      page:      req.query.page,
      pageSize:  req.query.page_size,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('GET /cs/enr-groups/levels-overview error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/cs/enr-groups/levels-overview/clients?group=&line=&dept=
 * Clients of one group with the SAME membership numbers as تسليمات الأقسام
 * (paid/taken/remaining/state + ended groups). Admin, OR granted 'enr-groups'.
 */
router.get('/enr-groups/levels-overview/clients', levelsGuard, (req, res) => {
  try {
    const svc = require('../services/csEnrGroups.service');
    res.json({ ok: true, ...svc.getLevelsGroupClients({
      group: (req.query.group || '').trim(),
      line:  (req.query.line || '').trim(),
      dept:  (req.query.dept || '').trim(),
    }) });
  } catch (e) {
    console.error('GET /cs/enr-groups/levels-overview/clients error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/cs/enr-groups/levels-overview/lectures?group=&line=
 * Registered sessions of one group: main lectures + phone-call (side) sessions.
 * Admin, OR granted 'enr-groups'.
 */
router.get('/enr-groups/levels-overview/lectures', levelsGuard, (req, res) => {
  try {
    const svc = require('../services/csEnrGroups.service');
    res.json({ ok: true, ...svc.getLevelsGroupLectures({
      group: (req.query.group || '').trim(),
      line:  (req.query.line || '').trim(),
    }) });
  } catch (e) {
    console.error('GET /cs/enr-groups/levels-overview/lectures error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── ENR GROUPS — transition (next group + dispositions), admin only ──────────
const enrTx = () => require('../services/csEnrTransition.service');

/** Next-group options = active groups that haven't started (optionally per dept). */
router.get('/enr-groups/next-options', enrGuard, (req, res) => {
  try { res.json({ ok: true, ...enrTx().getNextGroupOptions({ dept: req.query.dept, line: req.query.line }) }); }
  catch (e) { console.error('GET /cs/enr-groups/next-options:', e.message); res.status(400).json({ ok: false, error: e.message }); }
});

/** Ended/historical groups (left batches but have transition activity). */
router.get('/enr-groups/ended', enrGuard, (req, res) => {
  try { res.json({ ok: true, ...enrTx().getEndedGroups({ q: req.query.q }) }); }
  catch (e) { console.error('GET /cs/enr-groups/ended:', e.message); res.status(400).json({ ok: false, error: e.message }); }
});

/** Transition context for one current group: clients + moved/disposition status. */
router.get('/enr-groups/transition', enrGuard, (req, res) => {
  try { res.json({ ok: true, ...enrTx().getTransition({ group: req.query.group, line: req.query.line, dept: req.query.dept }) }); }
  catch (e) { console.error('GET /cs/enr-groups/transition:', e.message); res.status(400).json({ ok: false, error: e.message }); }
});

/** «محتاج تجديد» — clients whose membership is at/near its end (remaining ≤ 1). */
router.get('/enr-groups/renewals', enrGuard, (req, res) => {
  try { res.json({ ok: true, ...require('../services/csDeliveries.service').getRenewalNeeded({ dept: req.query.dept }) }); }
  catch (e) { console.error('GET /cs/enr-groups/renewals:', e.message); res.status(400).json({ ok: false, error: e.message }); }
});

/** Search كشف العملاء (cs_sales_register) to add brand-new members. */
router.get('/enr-groups/sales-search', enrGuard, (req, res) => {
  try { res.json({ ok: true, ...enrTx().searchSalesRegister({ q: req.query.q, limit: req.query.limit }) }); }
  catch (e) { console.error('GET /cs/enr-groups/sales-search:', e.message); res.status(400).json({ ok: false, error: e.message }); }
});

/** Roster of a next group. */
router.get('/enr-groups/next-roster', enrGuard, (req, res) => {
  try { res.json({ ok: true, ...enrTx().getNextRoster({ nextGroup: req.query.next_group, nextLine: req.query.next_line }) }); }
  catch (e) { console.error('GET /cs/enr-groups/next-roster:', e.message); res.status(400).json({ ok: false, error: e.message }); }
});

/** Add members to a next group's roster. */
router.post('/enr-groups/next-members', enrGuard, (req, res) => {
  try {
    res.json({ ok: true, ...enrTx().addNextMembers({
      nextGroup: req.body?.next_group, nextLine: req.body?.next_line,
      sourceGroup: req.body?.source_group, sourceLine: req.body?.source_line,
      members: req.body?.members, addedFrom: req.body?.added_from, user: req.user,
    }) });
  } catch (e) { console.error('POST /cs/enr-groups/next-members:', e.message); res.status(400).json({ ok: false, error: e.message }); }
});

router.delete('/enr-groups/next-members/:id', enrGuard, (req, res) => {
  try { res.json({ ok: true, ...enrTx().removeNextMember({ id: req.params.id, user: req.user }) }); }
  catch (e) { console.error('DELETE /cs/enr-groups/next-members:', e.message); res.status(400).json({ ok: false, error: e.message }); }
});

/** Set a disposition for a not-moved client (optional first follow-up/note entry). */
router.post('/enr-groups/disposition', enrGuard, (req, res) => {
  try {
    const b = req.body || {};
    const entry = (b.followup_date || b.followup_time || b.followup_method || b.note) ? {
      followupDate: b.followup_date, followupTime: b.followup_time, followupMethod: b.followup_method, note: b.note,
    } : null;
    res.json({ ok: true, ...enrTx().setDisposition({
      sourceGroup: b.source_group, sourceLine: b.source_line, dept: b.dept,
      clientName: b.client_name, clientPhone: b.client_phone, disposition: b.disposition, entry, user: req.user,
    }) });
  } catch (e) { console.error('POST /cs/enr-groups/disposition:', e.message); res.status(400).json({ ok: false, error: e.message }); }
});

/** Add a follow-up/note entry to an existing disposition. */
router.post('/enr-groups/disposition/:id/entry', enrGuard, (req, res) => {
  try {
    const b = req.body || {};
    res.json({ ok: true, ...enrTx().addDispositionEntry({
      dispositionId: req.params.id,
      followupDate: b.followup_date, followupTime: b.followup_time, followupMethod: b.followup_method, note: b.note, user: req.user,
    }) });
  } catch (e) { console.error('POST /cs/enr-groups/disposition/:id/entry:', e.message); res.status(400).json({ ok: false, error: e.message }); }
});

router.delete('/enr-groups/disposition/entry/:entryId', enrGuard, (req, res) => {
  try { res.json({ ok: true, ...enrTx().removeDispositionEntry({ entryId: req.params.entryId, user: req.user }) }); }
  catch (e) { console.error('DELETE /cs/enr-groups/disposition/entry:', e.message); res.status(400).json({ ok: false, error: e.message }); }
});

router.delete('/enr-groups/disposition/:id', enrGuard, (req, res) => {
  try { res.json({ ok: true, ...enrTx().clearDisposition({ id: req.params.id, user: req.user }) }); }
  catch (e) { console.error('DELETE /cs/enr-groups/disposition:', e.message); res.status(400).json({ ok: false, error: e.message }); }
});

/** The three disposition lists (postponed/no_answer/unsuccessful) for the tabs. */
router.get('/enr-groups/dispositions', enrGuard, (req, res) => {
  try {
    res.json({ ok: true, ...enrTx().getDispositions({
      type: req.query.type, q: req.query.q, dept: req.query.dept,
      from: req.query.from, to: req.query.to, page: req.query.page, pageSize: req.query.page_size,
    }) });
  } catch (e) { console.error('GET /cs/enr-groups/dispositions:', e.message); res.status(400).json({ ok: false, error: e.message }); }
});

/** Activity log (audit) for Enr Groups — global or per-group. */
router.get('/enr-groups/activity', enrGuard, (req, res) => {
  try {
    res.json({ ok: true, ...enrTx().getActivityLog({
      group: req.query.group, line: req.query.line, q: req.query.q,
      actor: req.query.actor, action: req.query.action,
      from: req.query.from, to: req.query.to, page: req.query.page, pageSize: req.query.page_size,
    }) });
  } catch (e) { console.error('GET /cs/enr-groups/activity:', e.message); res.status(400).json({ ok: false, error: e.message }); }
});

/**
 * GET /api/cs/deliveries/analytics?dept=General|Private|Semi&grad_from=&grad_to=
 * Per-department analytics: clients with remaining levels (+ upcoming-group flag +
 * last group/level) and how many graduate in a date range. Admin only.
 */
// Same read guard as the deliveries list: roles OR the cs-deliveries page grant
// (owner 2026-07-21: analytics opens for anyone the page opens for).
router.get('/deliveries/analytics', deliveriesRead, (req, res) => {
  try {
    const svc = require('../services/csDeliveriesReport.service');
    res.json({ ok: true, ...svc.getDeptAnalytics({
      dept: (req.query.dept || '').trim(),
      gradFrom: (req.query.grad_from || '').trim(),
      gradTo: (req.query.grad_to || '').trim(),
    }) });
  } catch (e) {
    console.error('GET /cs/deliveries/analytics error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── ENROLLMENT (manual data-entry grid) ──────────────────────────────────────

/** GET /api/cs/enrollment?dept=General — rows for the department grid. */
router.get('/enrollment', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const svc = require('../services/csEnrollment.service');
    res.json({ ok: true, rows: svc.listRows((req.query.dept || 'General').trim()) });
  } catch (e) {
    console.error('GET /cs/enrollment error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/cs/enrollment/options?dept=General&level=G%203 — dropdown lists. */
router.get('/enrollment/options', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const svc = require('../services/csEnrollment.service');
    res.json({ ok: true, ...svc.getOptions((req.query.dept || 'General').trim(), (req.query.level || '').trim()) });
  } catch (e) {
    console.error('GET /cs/enrollment/options error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/cs/enrollment/clients-search?q= — clients (name+phone) for the roster picker. */
router.get('/enrollment/clients-search', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const svc = require('../services/csEnrollment.service');
    res.json({ ok: true, clients: svc.searchClients({ q: req.query.q }) });
  } catch (e) {
    console.error('GET /cs/enrollment/clients-search error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/cs/enrollment/:id/students — assigned roster for a row. */
router.get('/enrollment/:id/students', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const svc = require('../services/csEnrollment.service');
    res.json({ ok: true, students: svc.listStudents(parseInt(req.params.id, 10)) });
  } catch (e) {
    console.error('GET /cs/enrollment/:id/students error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** PUT /api/cs/enrollment/:id/students — replace roster; syncs num_students. */
router.put('/enrollment/:id/students', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const svc = require('../services/csEnrollment.service');
    res.json({ ok: true, ...svc.setStudents(parseInt(req.params.id, 10), req.body?.students || []) });
  } catch (e) {
    console.error('PUT /cs/enrollment/:id/students error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/cs/enrollment/teacher-slots?teacher=&days=Sat- Tue&dept=General — available 1.5h slots. */
router.get('/enrollment/teacher-slots', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const svc = require('../services/csEnrollment.service');
    res.json({ ok: true, ...svc.teacherSlots({
      teacher: (req.query.teacher || '').trim(),
      days:    (req.query.days || '').trim(),
      dept:    (req.query.dept || 'General').trim(),
    }) });
  } catch (e) {
    console.error('GET /cs/enrollment/teacher-slots error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/cs/enrollment/teacher-suggestion?level=G%203 — previous-group teacher hint. */
router.get('/enrollment/teacher-suggestion', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const svc = require('../services/csEnrollment.service');
    res.json({ ok: true, ...svc.suggestTeacher({ level: (req.query.level || '').trim() }) });
  } catch (e) {
    console.error('GET /cs/enrollment/teacher-suggestion error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/cs/enrollment — create a row. Body: { dept, ...fields }. */
router.post('/enrollment', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const svc = require('../services/csEnrollment.service');
    res.json({ ok: true, row: svc.createRow((req.body?.dept || 'General').trim(), req.body || {}, req.user) });
  } catch (e) {
    console.error('POST /cs/enrollment error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** PUT /api/cs/enrollment/:id — update a row. */
router.put('/enrollment/:id', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const svc = require('../services/csEnrollment.service');
    res.json({ ok: true, row: svc.updateRow(parseInt(req.params.id, 10), req.body || {}) });
  } catch (e) {
    console.error('PUT /cs/enrollment/:id error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * PATCH /api/cs/enrollment/:id/generate — set Generate (Start|Pending).
 * "Start" needs >= 7 students. Only admin / leader / enrollment_leader.
 */
router.patch('/enrollment/:id/generate', requireRole('admin', 'leader', 'enrollment_leader'), (req, res) => {
  try {
    const svc = require('../services/csEnrollment.service');
    res.json({ ok: true, row: svc.setGenerate(parseInt(req.params.id, 10), (req.body?.status || '').trim()) });
  } catch (e) {
    console.error('PATCH /cs/enrollment/:id/generate error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** DELETE /api/cs/enrollment/:id — delete a row. */
router.delete('/enrollment/:id', requireRole('admin', 'leader', 'agent'), (req, res) => {
  try {
    const svc = require('../services/csEnrollment.service');
    res.json({ ok: true, ...svc.deleteRow(parseInt(req.params.id, 10)) });
  } catch (e) {
    console.error('DELETE /cs/enrollment/:id error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── CLIENT↔GROUP MEMBERSHIP HISTORY ─────────────────────────────────────────
// Explicit backfill trigger (also runs automatically once via ingest/levels).
// Re-runnable: upserts are idempotent; `force_drive=1` re-walks the Drive files.
router.post('/history/backfill', requireRole('admin'), async (req, res) => {
  try {
    const svc = require('../services/csClientGroupHistory.service');
    const out = { local: svc.backfillFromLocal() };
    if ((req.body?.force_drive ?? req.query?.force_drive) === '1') {
      out.drive = await svc.backfillFromDrive({ from: req.body?.from, to: req.body?.to });
    } else {
      out.ensure = await svc.ensureBackfilled();
    }
    res.json({ ok: true, ...out });
  } catch (e) {
    console.error('POST /cs/history/backfill error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── DELETED GROUPS REVIEW (owner-gated exclusion) ────────────────────────────
// Suggestions = completed-level groups with NO match in the All-Batches reference.
// The owner confirms the truly-deleted ones; only confirmed groups are excluded
// from consumed-level counts (in buildInactiveGroupMap). Admin only.

router.get('/deleted-groups/suggestions', requireRole('admin'), (req, res) => {
  try {
    const includeDecided = req.query.include_decided === '1';
    const list = require('../services/csDeletedGroups.service').getSuggestions({ includeDecided });
    res.json({ ok: true, count: list.length, suggestions: list });
  } catch (e) {
    console.error('GET /cs/deleted-groups/suggestions error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/deleted-groups', requireRole('admin'), (req, res) => {
  try {
    res.json({ ok: true, groups: require('../services/csDeletedGroups.service').listDeleted() });
  } catch (e) {
    console.error('GET /cs/deleted-groups error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/deleted-groups/decide', requireRole('admin'), (req, res) => {
  try {
    const { canon_key, label, dept, status, note } = req.body || {};
    const r = require('../services/csDeletedGroups.service').setDeletedStatus({
      canonKey: canon_key, label, dept, status, note,
      userId: req.user?.id, userName: req.user?.full_name || req.user?.username,
    });
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error('POST /cs/deleted-groups/decide error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.delete('/deleted-groups/:canonKey', requireRole('admin'), (req, res) => {
  try {
    res.json({ ok: true, ...require('../services/csDeletedGroups.service').clearDecision(req.params.canonKey) });
  } catch (e) {
    console.error('DELETE /cs/deleted-groups/:canonKey error:', e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
