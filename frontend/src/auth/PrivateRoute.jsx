import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

const ROLE_HIERARCHY = { admin: 3, leader: 2, agent: 1 };

// Role home pages
const ROLE_HOME = { admin: '/admin', leader: '/leader', agent: '/agent' };

export default function PrivateRoute({ children, minRole }) {
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

  if (minRole && ROLE_HIERARCHY[user.role] < ROLE_HIERARCHY[minRole]) {
    return <Navigate to={ROLE_HOME[user.role] || '/login'} replace />;
  }

  return children;
}
