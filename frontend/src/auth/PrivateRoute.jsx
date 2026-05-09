import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

const ROLE_HIERARCHY = { admin: 3, leader: 2, agent: 1 };

// Role home pages
const ROLE_HOME = {
  admin:             '/admin',
  leader:            '/leader',
  agent:             '/agent',
  enrollment:        '/enrollment',
  enrollment_leader: '/enrollment-leader',
};

export default function PrivateRoute({ children, minRole, allowedRoles, superAdmin }) {
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

  return children;
}
