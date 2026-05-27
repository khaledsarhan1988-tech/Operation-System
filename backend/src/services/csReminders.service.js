'use strict';

/**
 * cs_* — Reminders + per-reminder notes service.
 *
 * Permissions (user-confirmed 2026-05-27):
 *   - Add / list:  coordinator (own clients), leader (dept), admin (all)
 *   - Edit:        same as add (anyone authorized can edit)
 *   - Delete:      admin OR manager (management='All') only
 *
 * Soft delete: deleted_at is set; rows are hidden from list queries by default
 * but visible to admin/leader if requested (?include_deleted=1).
 */

const db = require('../config/database');
const { saveNow } = require('../config/database');

function nowCairo() {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

// ─── User → team_member mapping (for "is this coordinator allowed?") ──────────

/**
 * Find the team_member record bound to a users.id (via team_members.user_id).
 * Returns the team_member row or null.
 */
function findTeamMemberForUser(userId) {
  if (!userId) return null;
  return db.prepare(`SELECT id, name, department, section FROM team_members WHERE user_id = ? LIMIT 1`).get(userId);
}

/**
 * Determine which clients the current user can touch.
 *   - admin: all
 *   - leader: clients assigned to any coordinator whose section matches the
 *             leader's department (best-effort — leaders supervise an area)
 *   - everyone else: only clients currently assigned to THEIR team_member id
 *
 * Returns either { all: true } or { phoneList: [...phones...] }.
 */
function scopeForUser(user) {
  if (!user) return { phoneList: [] };
  if (user.role === 'admin') return { all: true };

  const myTeam = findTeamMemberForUser(user.id);

  if (user.role === 'leader') {
    // Leader sees clients of their entire department (Customer Services etc.)
    // We approximate by getting all team_members in the same section/dept,
    // then collecting their assigned clients.
    const teamIds = db.prepare(`
      SELECT id FROM team_members
       WHERE (
        LOWER(department) = LOWER(?) OR LOWER(section) = LOWER(?)
       )
    `).all(user.department || '', user.department || '').map(r => r.id);
    if (!teamIds.length) return { phoneList: [] };
    const placeholders = teamIds.map(() => '?').join(',');
    const phones = db.prepare(`
      SELECT DISTINCT client_phone_norm FROM cs_client_coordinator
       WHERE unassigned_at IS NULL AND coordinator_id IN (${placeholders})
    `).all(...teamIds).map(r => r.client_phone_norm).filter(Boolean);
    return { phoneList: phones };
  }

  // agent / enrollment / enrollment_leader → their own assigned clients only
  if (!myTeam) return { phoneList: [] };
  const phones = db.prepare(`
    SELECT DISTINCT client_phone_norm FROM cs_client_coordinator
     WHERE unassigned_at IS NULL AND coordinator_id = ?
  `).all(myTeam.id).map(r => r.client_phone_norm).filter(Boolean);
  return { phoneList: phones };
}

/**
 * Can the given user delete reminders? Admin OR users.management='All'.
 */
function canDelete(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.management === 'All') return true;
  return false;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Add a reminder. Auto-resolves coordinator_id from the current assignment.
 *
 *   args: { clientId?, phoneNorm, reminderAt, severity?, note, reminderType?,
 *           createdByUserId }
 */
function addReminder(args) {
  const {
    clientId = null, phoneNorm, reminderAt, severity = null,
    note, reminderType = 'manual', createdByUserId,
  } = args;
  if (!phoneNorm)   throw new Error('phoneNorm is required');
  if (!reminderAt)  throw new Error('reminderAt is required');
  if (!note)        throw new Error('note is required');

  // Try to attach the active coordinator at time of creation (for history)
  const coord = db.prepare(`
    SELECT coordinator_id FROM cs_client_coordinator
     WHERE unassigned_at IS NULL
       AND (client_phone_norm = ? OR (? IS NOT NULL AND client_id = ?))
     ORDER BY assigned_at DESC LIMIT 1
  `).get(phoneNorm, clientId, clientId);

  const now = nowCairo();
  const info = db.prepare(`
    INSERT INTO cs_reminders (
      client_id, client_phone_norm, coordinator_id, created_by_user_id,
      reminder_at, reminder_type, severity, note, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    clientId, phoneNorm, coord?.coordinator_id || null, createdByUserId,
    reminderAt, reminderType, severity, note,
    now, now,
  );

  db.prepare(`
    INSERT INTO cs_audit_log (client_id, client_phone_norm, event_type, event_data, actor_user_id)
    VALUES (?, ?, 'reminder_added', ?, ?)
  `).run(clientId, phoneNorm, JSON.stringify({ reminder_id: info.lastInsertRowid, severity, reminder_at: reminderAt }), createdByUserId);

  saveNow();
  return info.lastInsertRowid;
}

/**
 * Edit an existing reminder. Anyone who can see it can edit it (per user spec).
 * Returns true if updated, false if not found / soft-deleted.
 */
function editReminder({ reminderId, fields, byUserId }) {
  const allowed = ['reminder_at', 'severity', 'note', 'status', 'snoozed_until'];
  const sets = [];
  const params = [];
  for (const k of allowed) {
    if (k in fields) { sets.push(`${k} = ?`); params.push(fields[k]); }
  }
  if (!sets.length) return false;

  // Always bump updated_at + updated_by
  sets.push(`updated_at = ?`); params.push(nowCairo());
  sets.push(`updated_by_user_id = ?`); params.push(byUserId);

  const info = db.prepare(`
    UPDATE cs_reminders
       SET ${sets.join(', ')}
     WHERE id = ? AND deleted_at IS NULL
  `).run(...params, reminderId);

  if (info.changes > 0) {
    const r = db.prepare(`SELECT client_id, client_phone_norm FROM cs_reminders WHERE id = ?`).get(reminderId);
    db.prepare(`
      INSERT INTO cs_audit_log (client_id, client_phone_norm, event_type, event_data, actor_user_id)
      VALUES (?, ?, 'reminder_edited', ?, ?)
    `).run(r?.client_id, r?.client_phone_norm, JSON.stringify({ reminder_id: reminderId, fields }), byUserId);
    saveNow();
    return true;
  }
  return false;
}

/**
 * Mark reminder as done (or snoozed). Convenience over editReminder.
 */
function setReminderStatus({ reminderId, status, byUserId, snoozedUntil = null }) {
  if (!['pending', 'done', 'snoozed'].includes(status)) throw new Error('Invalid status');
  const now = nowCairo();
  const info = db.prepare(`
    UPDATE cs_reminders
       SET status = ?,
           done_at = CASE WHEN ? = 'done' THEN ? ELSE done_at END,
           done_by_user_id = CASE WHEN ? = 'done' THEN ? ELSE done_by_user_id END,
           snoozed_until = ?,
           updated_at = ?, updated_by_user_id = ?
     WHERE id = ? AND deleted_at IS NULL
  `).run(status, status, now, status, byUserId, snoozedUntil, now, byUserId, reminderId);

  if (info.changes > 0) saveNow();
  return info.changes > 0;
}

/**
 * Soft-delete a reminder. Returns true if deleted, false if not allowed/not found.
 */
function deleteReminder({ reminderId, byUser }) {
  if (!canDelete(byUser)) {
    const err = new Error('Forbidden: only admin or manager can delete reminders');
    err.code = 'FORBIDDEN';
    throw err;
  }
  const now = nowCairo();
  const info = db.prepare(`
    UPDATE cs_reminders
       SET deleted_at = ?, deleted_by_user_id = ?
     WHERE id = ? AND deleted_at IS NULL
  `).run(now, byUser.id, reminderId);

  if (info.changes > 0) {
    const r = db.prepare(`SELECT client_id, client_phone_norm FROM cs_reminders WHERE id = ?`).get(reminderId);
    db.prepare(`
      INSERT INTO cs_audit_log (client_id, client_phone_norm, event_type, event_data, actor_user_id)
      VALUES (?, ?, 'reminder_deleted', ?, ?)
    `).run(r?.client_id, r?.client_phone_norm, JSON.stringify({ reminder_id: reminderId }), byUser.id);
    saveNow();
    return true;
  }
  return false;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

function listForClient({ phoneNorm, includeDeleted = false }) {
  if (!phoneNorm) return [];
  const where = ['r.client_phone_norm = ?'];
  if (!includeDeleted) where.push('r.deleted_at IS NULL');
  return db.prepare(`
    SELECT r.*, tm.name AS coordinator_name,
           u1.full_name AS created_by_name,
           u2.full_name AS updated_by_name,
           u3.full_name AS done_by_name,
           u4.full_name AS deleted_by_name
      FROM cs_reminders r
      LEFT JOIN team_members tm ON tm.id = r.coordinator_id
      LEFT JOIN users u1 ON u1.id = r.created_by_user_id
      LEFT JOIN users u2 ON u2.id = r.updated_by_user_id
      LEFT JOIN users u3 ON u3.id = r.done_by_user_id
      LEFT JOIN users u4 ON u4.id = r.deleted_by_user_id
     WHERE ${where.join(' AND ')}
     ORDER BY r.reminder_at DESC, r.id DESC
  `).all(phoneNorm);
}

/**
 * Get pending reminders for a user (their own scope).
 *   includeOverdue: include rows where reminder_at < now
 */
function pendingForUser(user, { includeOverdue = true, limit = 200 } = {}) {
  const scope = scopeForUser(user);
  if (!scope.all && !(scope.phoneList && scope.phoneList.length)) return [];

  const whereParts = ['r.deleted_at IS NULL', `r.status = 'pending'`];
  const params = [];
  if (!scope.all) {
    whereParts.push(`r.client_phone_norm IN (${scope.phoneList.map(() => '?').join(',')})`);
    params.push(...scope.phoneList);
  }
  return db.prepare(`
    SELECT r.id, r.client_id, r.client_phone_norm, r.reminder_at, r.severity,
           r.note, r.status, r.coordinator_id, r.created_at,
           tm.name AS coordinator_name
      FROM cs_reminders r
      LEFT JOIN team_members tm ON tm.id = r.coordinator_id
     WHERE ${whereParts.join(' AND ')}
     ORDER BY r.reminder_at ASC, r.id ASC
     LIMIT ?
  `).all(...params, limit);
}

module.exports = {
  // CRUD
  addReminder,
  editReminder,
  setReminderStatus,
  deleteReminder,
  // Queries
  listForClient,
  pendingForUser,
  // Scope helpers
  scopeForUser,
  canDelete,
  findTeamMemberForUser,
};
