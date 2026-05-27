'use strict';

/**
 * cs_* — Auto-alert engine.
 *
 * Rules (user-confirmed 2026-05-27):
 *
 *   A. PAID + NO ACTIVE GROUP, > 7 DAYS
 *      → notif_type='paid_no_group_7d', severity='urgent'
 *      → recipients: coordinator
 *
 *   B. NO NEW LEVEL FOR 10 / 15 / 20 DAYS
 *      → notif_type='no_level_10d'/'_15d'/'_20d'
 *      → severity='warning' / 'urgent' / 'critical'
 *      → recipients: coordinator + leader + manager + admin
 *
 *   C. REACHED Conversation 5 + STILL HAS PAID-MONTHS LEFT
 *      → notif_type='extra_courses_available', severity='info'
 *      → recipients: coordinator
 *
 * Each (client_phone_norm, notif_type) has at most ONE active row at a time
 * (UNIQUE constraint with is_active). When the underlying condition no
 * longer holds, the row is resolved (is_active=0, resolved_at set, reason).
 */

const db = require('../config/database');
const { saveNow } = require('../config/database');
const csPlan = require('./csClientPlan.service');

function nowCairo() {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function daysAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

// ─── Recipient resolution ─────────────────────────────────────────────────────

/**
 * Resolve the user ids that should see a notification for a given client +
 * notif scope. Returns an array of { user_id, role_context }.
 *
 *   scope: 'coordinator_only' or 'coordinator_leader_admin'
 */
function resolveRecipients({ phoneNorm, scope }) {
  const out = [];

  // 1. The current coordinator (via cs_client_coordinator → team_members.user_id)
  const coord = db.prepare(`
    SELECT cc.coordinator_id, tm.user_id, tm.name, tm.department, tm.section
      FROM cs_client_coordinator cc
      LEFT JOIN team_members tm ON tm.id = cc.coordinator_id
     WHERE cc.unassigned_at IS NULL AND cc.client_phone_norm = ?
     ORDER BY cc.assigned_at DESC LIMIT 1
  `).get(phoneNorm);

  if (coord?.user_id) {
    out.push({ user_id: coord.user_id, role_context: 'coordinator' });
  }

  if (scope === 'coordinator_only') return out;

  // 2. All leaders covering the relevant dept (+ admins)
  // We use the coordinator's section as the dept hint. If unknown, fall back
  // to ALL leaders + admins (broad fan-out is safer than silent drop).
  const leaderSection = coord?.section || null;

  if (leaderSection) {
    const leaders = db.prepare(`
      SELECT id FROM users
       WHERE role = 'leader' AND is_active = 1
         AND (LOWER(department) = LOWER(?) OR LOWER(department) = 'all')
    `).all(leaderSection);
    for (const l of leaders) out.push({ user_id: l.id, role_context: 'leader' });
  } else {
    const allLeaders = db.prepare(`SELECT id FROM users WHERE role = 'leader' AND is_active = 1`).all();
    for (const l of allLeaders) out.push({ user_id: l.id, role_context: 'leader' });
  }

  // 3. Admins (always)
  const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin' AND is_active = 1`).all();
  for (const a of admins) out.push({ user_id: a.id, role_context: 'admin' });

  // Dedupe (admin can also be leader-equivalent etc.)
  const seen = new Set();
  return out.filter(r => {
    const key = `${r.user_id}|${r.role_context}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Notif upsert ─────────────────────────────────────────────────────────────

const _upsertNotifStmt = () => db.prepare(`
  INSERT INTO cs_notifications (
    client_id, client_phone_norm, notif_type, severity,
    title, message, meta_json, triggered_at, is_active
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(client_phone_norm, notif_type, is_active) DO UPDATE SET
    severity   = excluded.severity,
    title      = excluded.title,
    message    = excluded.message,
    meta_json  = excluded.meta_json
`);

const _addRecipientStmt = () => db.prepare(`
  INSERT INTO cs_notif_recipients (notif_id, user_id, role_context, is_read)
  VALUES (?, ?, ?, 0)
  ON CONFLICT(notif_id, user_id) DO NOTHING
`);

function _resolveActive({ phoneNorm, notifType, reason }) {
  db.prepare(`
    UPDATE cs_notifications
       SET is_active = 0, resolved_at = ?, resolution_reason = ?
     WHERE client_phone_norm = ? AND notif_type = ? AND is_active = 1
  `).run(nowCairo(), reason, phoneNorm, notifType);
}

function _triggerNotif({ phoneNorm, clientId, notifType, severity, title, message, meta, recipientsScope }) {
  const stmt = _upsertNotifStmt();
  const now = nowCairo();
  stmt.run(clientId, phoneNorm, notifType, severity, title, message, meta ? JSON.stringify(meta) : null, now);

  const notif = db.prepare(`
    SELECT id FROM cs_notifications
     WHERE client_phone_norm = ? AND notif_type = ? AND is_active = 1
     LIMIT 1
  `).get(phoneNorm, notifType);
  if (!notif) return null;

  const recipients = resolveRecipients({ phoneNorm, scope: recipientsScope });
  const rcpStmt = _addRecipientStmt();
  for (const r of recipients) rcpStmt.run(notif.id, r.user_id, r.role_context);

  db.prepare(`
    INSERT INTO cs_audit_log (client_id, client_phone_norm, event_type, event_data)
    VALUES (?, ?, 'notification_triggered', ?)
  `).run(clientId, phoneNorm, JSON.stringify({ notif_id: notif.id, type: notifType, severity, recipients: recipients.length }));

  return notif.id;
}

// ─── Active-group detection ───────────────────────────────────────────────────

/**
 * Does this client have an ACTIVE group right now? Reads from existing
 * clients + batches tables. Read-only.
 */
function hasActiveGroup(phoneNorm) {
  // Try to find a client row whose group_name maps to a non-ended batch.
  const stripped = phoneNorm.replace(/^0/, '');
  const row = db.prepare(`
    SELECT 1
      FROM clients c
     INNER JOIN batches b ON b.group_name = c.group_name
     WHERE (c.phone = ? OR c.phone = ? OR c.phone = '0' || ?)
       AND (b.status IS NULL OR b.status != 'منتهية')
     LIMIT 1
  `).get(phoneNorm, stripped, stripped);
  return !!row;
}

// ─── Earliest paid date ───────────────────────────────────────────────────────

/**
 * Earliest subscription date for a phone (proxy for "they paid since at
 * least this date"). Returns ISO date string or null.
 */
function earliestPaidDate(phoneNorm) {
  const r = db.prepare(`
    SELECT MIN(COALESCE(subscription_date, created_at)) AS d
      FROM cs_subscriptions
     WHERE client_phone_norm = ? AND is_ignored = 0 AND months IS NOT NULL
  `).get(phoneNorm);
  return r?.d || null;
}

// ─── Main scan ────────────────────────────────────────────────────────────────

/**
 * One sweep: evaluate every known phone and trigger/resolve notifications.
 *
 *   options:
 *     phoneList: array (default = all phones in cs_subscriptions ∪ cs_completed_levels)
 *     dryRun:    true → don't write, just summarize
 */
function runOnce({ phoneList = null, dryRun = false } = {}) {
  const t0 = Date.now();

  let phones = phoneList;
  if (!phones) {
    phones = db.prepare(`
      SELECT DISTINCT client_phone_norm FROM (
        SELECT client_phone_norm FROM cs_subscriptions  WHERE client_phone_norm IS NOT NULL
        UNION
        SELECT client_phone_norm FROM cs_completed_levels WHERE client_phone_norm IS NOT NULL
      )
    `).all().map(r => r.client_phone_norm).filter(Boolean);
  }

  const result = { scanned: 0, triggered: {}, resolved: 0, dry_run: dryRun };

  for (const phone of phones) {
    result.scanned++;
    const plan = csPlan.getClientPlan(phone);
    if (!plan) continue;

    const clientRow = db.prepare(`SELECT id, name FROM clients WHERE phone = ? OR phone = '0' || ? LIMIT 1`)
      .get(phone, phone.replace(/^0/, ''));
    const clientId = clientRow?.id || null;
    const meta = { paid_months: plan.summary.paid_months, completed: plan.summary.completed_count };

    // ── A. Paid + no active group + > 7 days since earliest paid date ──
    if ((plan.summary.paid_months || 0) > 0) {
      const earliest = earliestPaidDate(phone);
      const inGroup = hasActiveGroup(phone);
      const sevenDaysAgo = daysAgo(7);
      if (!inGroup && earliest && earliest <= sevenDaysAgo) {
        if (!dryRun) _triggerNotif({
          phoneNorm: phone, clientId,
          notifType: 'paid_no_group_7d',
          severity: 'urgent',
          title: 'عميل دفع ومفيش جروب نشط له',
          message: `العميل دفع منذ ${earliest} ولم يلتحق بأي جروب نشط حتى الآن.`,
          meta: { ...meta, earliest_paid_date: earliest },
          recipientsScope: 'coordinator_only',
        });
        result.triggered['paid_no_group_7d'] = (result.triggered['paid_no_group_7d'] || 0) + 1;
      } else if (inGroup) {
        if (!dryRun) _resolveActive({ phoneNorm: phone, notifType: 'paid_no_group_7d', reason: 'enrolled_group' });
        result.resolved++;
      }
    }

    // ── B. No new level for 10 / 15 / 20 days ──
    const dsl = plan.summary.days_since_last_level;
    if (dsl != null && plan.pending_levels.length > 0) {
      // 20-day critical (highest tier) — supersedes lower tiers
      if (dsl >= 20) {
        if (!dryRun) _triggerNotif({
          phoneNorm: phone, clientId,
          notifType: 'no_level_20d',
          severity: 'critical',
          title: 'عميل بدون مستوى جديد منذ 20 يوم',
          message: `لم يأخذ العميل مستوى جديد منذ ${dsl} يوم. آخر مستوى: ${plan.summary.max_reached_label || '—'}.`,
          meta: { ...meta, days_silent: dsl, max_reached: plan.summary.max_reached_label },
          recipientsScope: 'coordinator_leader_admin',
        });
        result.triggered['no_level_20d'] = (result.triggered['no_level_20d'] || 0) + 1;
        if (!dryRun) _resolveActive({ phoneNorm: phone, notifType: 'no_level_15d', reason: 'escalated' });
        if (!dryRun) _resolveActive({ phoneNorm: phone, notifType: 'no_level_10d', reason: 'escalated' });
      } else if (dsl >= 15) {
        if (!dryRun) _triggerNotif({
          phoneNorm: phone, clientId,
          notifType: 'no_level_15d',
          severity: 'urgent',
          title: 'عميل بدون مستوى جديد منذ 15 يوم',
          message: `لم يأخذ العميل مستوى جديد منذ ${dsl} يوم.`,
          meta: { ...meta, days_silent: dsl, max_reached: plan.summary.max_reached_label },
          recipientsScope: 'coordinator_leader_admin',
        });
        result.triggered['no_level_15d'] = (result.triggered['no_level_15d'] || 0) + 1;
        if (!dryRun) _resolveActive({ phoneNorm: phone, notifType: 'no_level_10d', reason: 'escalated' });
      } else if (dsl >= 10) {
        if (!dryRun) _triggerNotif({
          phoneNorm: phone, clientId,
          notifType: 'no_level_10d',
          severity: 'warning',
          title: 'عميل بدون مستوى جديد منذ 10 أيام',
          message: `لم يأخذ العميل مستوى جديد منذ ${dsl} يوم.`,
          meta: { ...meta, days_silent: dsl, max_reached: plan.summary.max_reached_label },
          recipientsScope: 'coordinator_leader_admin',
        });
        result.triggered['no_level_10d'] = (result.triggered['no_level_10d'] || 0) + 1;
      }
    } else if (dsl == null || plan.pending_levels.length === 0) {
      // No pending or no recent activity needed → resolve any active no_level_* alerts
      if (!dryRun) {
        _resolveActive({ phoneNorm: phone, notifType: 'no_level_10d', reason: 'completed_level' });
        _resolveActive({ phoneNorm: phone, notifType: 'no_level_15d', reason: 'completed_level' });
        _resolveActive({ phoneNorm: phone, notifType: 'no_level_20d', reason: 'completed_level' });
      }
    }

    // ── C. Reached Con 5 + has paid months overflow → extra courses ──
    if (plan.extra_courses_eligible) {
      if (!dryRun) _triggerNotif({
        phoneNorm: phone, clientId,
        notifType: 'extra_courses_available',
        severity: 'info',
        title: 'العميل وصل لأعلى مستوى — متبقى رصيد للكورسات الإضافية',
        message: `العميل أتم Conversation 5، وعنده ${plan.summary.overflow_months || 0} شهر/كورس متبقي يمكن استخدامه في كورسات Business / Conversation إضافية.`,
        meta: { ...meta, overflow_months: plan.summary.overflow_months },
        recipientsScope: 'coordinator_only',
      });
      result.triggered['extra_courses_available'] = (result.triggered['extra_courses_available'] || 0) + 1;
    } else {
      if (!dryRun) _resolveActive({ phoneNorm: phone, notifType: 'extra_courses_available', reason: 'manual_dismiss' });
    }
  }

  if (!dryRun) saveNow();
  result.duration_ms = Date.now() - t0;
  return result;
}

module.exports = {
  runOnce,
  resolveRecipients,
  hasActiveGroup,
  earliestPaidDate,
};
