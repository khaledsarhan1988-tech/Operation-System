import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { hasPageGrant } from '../utils/pageGrants';

const ROLE_HIERARCHY = { admin: 3, leader: 2, agent: 1 };

// Role home pages
const ROLE_HOME = {
  admin:             '/admin',
  leader:            '/leader',
  agent:             '/agent',
  enrollment:        '/enrollment',
  enrollment_leader: '/enrollment-leader',
};

export default function PrivateRoute({ children, minRole, allowedRoles, superAdmin, requireManagement, onlyUsername, requirePage }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Explicit allowed-roles list (for parallel roles like enrollment)
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={ROLE_HOME[user.role] || '/login'} replace />;
  }

  // Hierarchy check (for existing agent/leader/admin routes)
  if (minRole && ROLE_HIERARCHY[user.role] < ROLE_HIERARCHY[minRole]) {
    return <Navigate to={ROLE_HOME[user.role] || '/login'} replace />;
  }

  // Super-admin gate — admin role + management='All' (system-wide).
  // Department-scoped admins (Customer Services / Quality / Education) get
  // bounced back to their dashboard so they can't reach system-config pages
  // by URL even though the sidebar item is hidden.
  if (superAdmin && (user.role !== 'admin' || user.management !== 'All')) {
    return <Navigate to={ROLE_HOME[user.role] || '/login'} replace />;
  }

  // Department-management gate — admin whose management is 'All' OR matches the
  // required department (primary `management` or any of `extra_managements`).
  // Lets a department-scoped admin reach their OWN department's pages (e.g. the
  // Customer-Services admin sees CS clients/sales) while bouncing admins of
  // OTHER departments. Server-side authz remains the real control.
  if (requireManagement) {
    const mgmts = [user.management, ...String(user.extra_managements || '').split(',')]
      .map(s => String(s || '').trim()).filter(Boolean);
    if (user.role !== 'admin' || !(mgmts.includes('All') || mgmts.includes(requireManagement))) {
      return <Navigate to={ROLE_HOME[user.role] || '/login'} replace />;
    }
  }

  // Single-owner gate — a page locked to ONE specific account (case-insensitive
  // username). Anyone else who hits the URL directly is bounced to their home.
  // Used for private owner-only pages (e.g. trainer salary definitions).
  if (onlyUsername && String(user.username || '').toLowerCase() !== String(onlyUsername).toLowerCase()) {
    return <Navigate to={ROLE_HOME[user.role] || '/login'} replace />;
  }

  // Per-PAGE grant — allow a non-admin to reach a specific page when their
  // users.extra_pages list includes this page key (admins always pass). Lets a
  // CS agent see e.g. the trainer-occupancy pages without changing their role.
  // hasPageGrant resolves the `occupancy-trainers` umbrella into its individual
  // trainer pages (backward-compat) and always passes admins.
  if (requirePage && !hasPageGrant(user, requirePage)) {
    return <Navigate to={ROLE_HOME[user.role] || '/login'} replace />;
  }

  return children;
}
