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

/**
 * requireManagement('Customer Services') — admin whose management is 'All' OR
 * matches the required department (primary `management` or any of the
 * comma-separated `extra_managements`). Use to keep a department-scoped admin
 * on their OWN department's sensitive routes while blocking admins of other
 * departments. Mirrors the frontend PrivateRoute `requireManagement` guard.
 */
function requireManagement(required) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    const mgmts = [req.user.management, ...String(req.user.extra_managements || '').split(',')]
      .map(s => String(s || '').trim()).filter(Boolean);
    if (req.user.role !== 'admin' || !(mgmts.includes('All') || mgmts.includes(required))) {
      return res.status(403).json({ error: 'Forbidden: department admin only' });
    }
    next();
  };
}

/**
 * requirePageOrManagement(pageKey, requiredMgmt) — passes when EITHER:
 *   (a) the user was granted this specific page via users.extra_pages (CSV of
 *       page keys) — lets a NON-admin data-entry/accounts user reach ONE
 *       admin-gated page (e.g. كشف العملاء = 'sales-register') WITHOUT being
 *       made an admin, OR
 *   (b) the user is an admin for the required department: role='admin' AND
 *       (management 'All' | requiredMgmt | any of extra_managements). When
 *       `requiredMgmt` is null/omitted, ANY admin passes (preserves an
 *       existing requireRole('admin') gate while adding the page-grant path).
 * extra_pages / extra_managements travel in the JWT (login + refresh), so
 * req.user carries them. Mirrors the frontend PrivateRoute requirePage +
 * requireManagement guards. Only admins can set extra_pages (UserManagement),
 * so the grant itself stays controlled.
 */
function requirePageOrManagement(pageKey, requiredMgmt = null) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    // (a) Page-grant path — any role whose extra_pages includes the key.
    const pages = String(req.user.extra_pages || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    if (pageKey && pages.includes(pageKey)) return next();
    // (b) Department-admin path.
    if (req.user.role === 'admin') {
      if (!requiredMgmt) return next(); // any admin
      const mgmts = [req.user.management, ...String(req.user.extra_managements || '').split(',')]
        .map(s => String(s || '').trim()).filter(Boolean);
      if (mgmts.includes('All') || mgmts.includes(requiredMgmt)) return next();
    }
    return res.status(403).json({ error: 'Forbidden: requires page grant or department admin' });
  };
}

module.exports = { requireRole, requireAnyRole, requireSuperAdmin, requireManagement, requirePageOrManagement };
