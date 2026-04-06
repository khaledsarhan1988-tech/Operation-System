'use strict';

// Role hierarchy: admin > leader > agent
const HIERARCHY = { admin: 3, leader: 2, agent: 1 };

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

module.exports = { requireRole };
