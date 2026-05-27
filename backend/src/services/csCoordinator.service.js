'use strict';

/**
 * cs_* — Coordinator assignment for the subscription tracker.
 *
 * "Coordinator" here means an enrollment/scheduling team member (إدارة المواعيد)
 * — the staff person who follows up with the client about taking their next
 * level, even after the level is finished. These people typically have "Enr"
 * (or "Schedule") in their name on team_members.
 *
 * Default-assignment rule (user-confirmed): the "last known" coordinator is
 * the team_member whose name appears as the most recent assigned_to in
 * distribution_items for that client's phone. If none, the client is left
 * unassigned and the admin/leader assigns manually.
 *
 * History rule: every change writes a NEW row to cs_client_coordinator.
 * The current assignment is the row with unassigned_at IS NULL. Previous
 * assignments have unassigned_at set to the moment they were replaced.
 */

const db = require('../config/database');
const { saveNow } = require('../config/database');

function nowCairo() {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

// ─── Coordinator eligibility ──────────────────────────────────────────────────

/**
 * List team_members that are eligible to be a subscription-tracker coordinator.
 * Per the user, these are enrollment/scheduling staff — their names usually
 * contain "Enr" or "Schedule" (case-insensitive). We do NOT hard-restrict; the
 * UI shows them sorted with eligible first, others below.
 */
function listEligibleCoordinators() {
  return db.prepare(`
    SELECT id, name, department, section, line, status,
           CASE
             WHEN LOWER(name) LIKE '%enr%' OR LOWER(name) LIKE '%schedule%' OR LOWER(name) LIKE '%booking%' THEN 1
             ELSE 0
           END AS is_enrollment
    FROM team_members
    WHERE status = 'active'
    ORDER BY is_enrollment DESC, name COLLATE NOCASE ASC
  `).all();
}

// ─── Current assignment ───────────────────────────────────────────────────────

/**
 * Get the CURRENT coordinator assignment for a client (by phone_norm or client_id).
 * Returns the row joined with team_members info, or null.
 */
function getCurrentAssignment({ clientId = null, phoneNorm = null }) {
  if (!clientId && !phoneNorm) return null;
  const where = [];
  const params = [];
  if (clientId)  { where.push('cc.client_id = ?');         params.push(clientId); }
  if (phoneNorm) { where.push('cc.client_phone_norm = ?'); params.push(phoneNorm); }

  const row = db.prepare(`
    SELECT cc.id, cc.client_id, cc.client_phone_norm,
           cc.coordinator_id, cc.assigned_at, cc.assignment_reason, cc.notes,
           tm.name AS coordinator_name,
           tm.section AS coordinator_section,
           tm.department AS coordinator_department
      FROM cs_client_coordinator cc
      LEFT JOIN team_members tm ON tm.id = cc.coordinator_id
     WHERE cc.unassigned_at IS NULL AND (${where.join(' OR ')})
     ORDER BY cc.assigned_at DESC, cc.id DESC
     LIMIT 1
  `).get(...params);
  return row || null;
}

/**
 * Full assignment history (most recent first) for a client.
 */
function getAssignmentHistory({ clientId = null, phoneNorm = null }) {
  if (!clientId && !phoneNorm) return [];
  const where = [];
  const params = [];
  if (clientId)  { where.push('cc.client_id = ?');         params.push(clientId); }
  if (phoneNorm) { where.push('cc.client_phone_norm = ?'); params.push(phoneNorm); }

  return db.prepare(`
    SELECT cc.id, cc.client_id, cc.client_phone_norm,
           cc.coordinator_id, cc.assigned_at, cc.unassigned_at,
           cc.assigned_by_user_id, cc.assignment_reason, cc.notes,
           tm.name AS coordinator_name,
           u.full_name AS assigned_by_user_name
      FROM cs_client_coordinator cc
      LEFT JOIN team_members tm ON tm.id = cc.coordinator_id
      LEFT JOIN users u ON u.id = cc.assigned_by_user_id
     WHERE ${where.join(' OR ')}
     ORDER BY cc.assigned_at DESC, cc.id DESC
  `).all(...params);
}

// ─── Auto-discovery of "last known" coordinator ───────────────────────────────

/**
 * Find a coordinator by reading the most recent distribution_items row for
 * this client's phone. Returns { team_member_id, name, source } or null.
 *
 * Strategy:
 *   1. Look up distribution_items.assigned_to where client_phone matches.
 *   2. Map that name to team_members.id (case-insensitive, trim).
 *   3. Skip if no team_member match.
 */
function findLastKnownCoordinator(phoneNorm) {
  if (!phoneNorm) return null;
  // Phone in distribution_items might be without leading 0 or with country code.
  // We try multiple forms.
  const stripped = phoneNorm.replace(/^0/, '');
  const row = db.prepare(`
    SELECT di.assigned_to, di.created_at
      FROM distribution_items di
     WHERE di.client_phone = ?
        OR di.client_phone = ?
        OR di.client_phone = '0' || ?
        OR di.client_phone LIKE ?
     ORDER BY di.created_at DESC, di.id DESC
     LIMIT 5
  `).all(phoneNorm, stripped, stripped, `%${stripped}%`);

  for (const r of row) {
    if (!r.assigned_to) continue;
    const tm = db.prepare(`
      SELECT id, name FROM team_members
       WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
       LIMIT 1
    `).get(r.assigned_to);
    if (tm) return { team_member_id: tm.id, name: tm.name, source: 'distribution_items', source_date: r.created_at };
  }
  return null;
}

// ─── Assignment writes ────────────────────────────────────────────────────────

/**
 * Assign a coordinator to a client. If the client already has a current
 * assignment, close it (unassigned_at = now) and insert a new row.
 *
 *   args:
 *     - clientId, phoneNorm
 *     - coordinatorId    (team_members.id)
 *     - assignedByUserId (users.id)
 *     - reason           ('auto_last_known' | 'manual' | 'reassign')
 *     - notes            (optional)
 *
 * Returns the new assignment row id.
 */
function assignCoordinator({ clientId = null, phoneNorm = null, coordinatorId, assignedByUserId = null, reason = 'manual', notes = null }) {
  if (!coordinatorId) throw new Error('coordinatorId is required');
  if (!clientId && !phoneNorm) throw new Error('clientId or phoneNorm is required');

  const now = nowCairo();

  // Close any existing current assignment for this client (by either key)
  const closeWhere = [];
  const closeParams = [];
  if (clientId)  { closeWhere.push('client_id = ?');         closeParams.push(clientId); }
  if (phoneNorm) { closeWhere.push('client_phone_norm = ?'); closeParams.push(phoneNorm); }
  db.prepare(`
    UPDATE cs_client_coordinator
       SET unassigned_at = ?
     WHERE unassigned_at IS NULL AND (${closeWhere.join(' OR ')})
  `).run(now, ...closeParams);

  const info = db.prepare(`
    INSERT INTO cs_client_coordinator (
      client_id, client_phone_norm, coordinator_id,
      assigned_at, unassigned_at,
      assigned_by_user_id, assignment_reason, notes
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
  `).run(clientId, phoneNorm, coordinatorId, now, assignedByUserId, reason, notes);

  // Audit
  db.prepare(`
    INSERT INTO cs_audit_log (client_id, client_phone_norm, event_type, event_data, actor_user_id, actor_name)
    VALUES (?, ?, 'coord_changed', ?, ?, NULL)
  `).run(clientId, phoneNorm, JSON.stringify({ coordinator_id: coordinatorId, reason, notes }), assignedByUserId);

  saveNow();
  return info.lastInsertRowid;
}

/**
 * Bulk auto-assignment: walk all client_phone_norm values in cs_subscriptions /
 * cs_completed_levels that have no current assignment, look up the "last known"
 * coordinator from distribution_items, and assign if found. Useful for the
 * initial backfill after ingestion.
 *
 * Returns { scanned, assigned, skipped_no_match }.
 */
function bulkAutoAssign({ limit = 100000 } = {}) {
  const phones = db.prepare(`
    SELECT DISTINCT client_phone_norm FROM (
      SELECT client_phone_norm FROM cs_subscriptions WHERE client_phone_norm IS NOT NULL
      UNION
      SELECT client_phone_norm FROM cs_completed_levels WHERE client_phone_norm IS NOT NULL
    )
    LIMIT ?
  `).all(limit).map(r => r.client_phone_norm);

  let scanned = 0, assigned = 0, skipped = 0;
  for (const phone of phones) {
    scanned++;
    const current = getCurrentAssignment({ phoneNorm: phone });
    if (current) continue; // already has one — don't override

    const lk = findLastKnownCoordinator(phone);
    if (!lk) { skipped++; continue; }

    // Resolve client_id from phone (best-effort, read-only)
    const cRow = db.prepare(`
      SELECT id FROM clients
       WHERE phone = ? OR phone = ? OR phone = ('0' || ?)
       LIMIT 1
    `).get(phone, phone.replace(/^0/, ''), phone.replace(/^0/, ''));
    const clientId = cRow ? cRow.id : null;

    assignCoordinator({
      clientId, phoneNorm: phone,
      coordinatorId: lk.team_member_id,
      assignedByUserId: null,
      reason: 'auto_last_known',
      notes: `Auto-assigned from distribution_items on ${lk.source_date}`,
    });
    assigned++;
  }
  return { scanned, assigned, skipped_no_match: skipped };
}

module.exports = {
  listEligibleCoordinators,
  getCurrentAssignment,
  getAssignmentHistory,
  findLastKnownCoordinator,
  assignCoordinator,
  bulkAutoAssign,
};
