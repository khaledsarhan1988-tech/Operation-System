'use strict';

// Role hierarchy: admin > leader > agent = enrollment = enrollment_leader
const HIERARCHY = { admin: 3, leader: 2, agent: 1, enrollment: 1, enrollment_leader: 1 };

/**
 * requireRole('agent')  — allows agent, leader, admin
 * requireRole('leader') — allows leader, admin
 * requireRole('admin')  — allows admin only
 */
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    const userLevel = HIERARCHY[req.user.role] || 0;
    const minLevel  = HIERARCHY[minRole] || 99;
    if (userLevel < minLevel) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

/**
 * requireAnyRole(['enrollment', 'enrollment_leader', 'admin'])
 * Allows any of the listed roles exactly.
 */
function requireAnyRole(roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

/**
 * requireSuperAdmin — admin role + management='All'.
 * Use for global/cross-department ops (system settings, KPI weights,
 * DB diagnostics, audit logs). Department-scoped admins are blocked.
 */
function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  if (req.user.role !== 'admin' || req.user.management !== 'All') {
    return res.status(403).json({ error: 'Forbidden: super-admin only' });
  }
  next();
}

module.exports = { requireRole, requireAnyRole, requireSuperAdmin };
