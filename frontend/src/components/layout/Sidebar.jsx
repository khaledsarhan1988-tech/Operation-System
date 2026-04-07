import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import {
  LayoutDashboard, ClipboardList, Search, UserX, Calendar,
  Video, Users, BarChart2, Globe, UserCog, Upload, FileText,
  LogOut, ChevronRight
} from 'lucide-react';

const AGENT_LINKS = [
  { to: '/agent',              label: 'nav.dashboard',      icon: LayoutDashboard, end: true },
  { to: '/agent/tasks',        label: 'nav.myTasks',        icon: ClipboardList },
  { to: '/agent/clients',      label: 'nav.clientSearch',   icon: Search },
  { to: '/agent/absent',       label: 'nav.absentFollowUp', icon: UserX },
  { to: '/agent/schedule',     label: 'nav.todaySchedule',  icon: Calendar },
  { to: '/agent/side-sessions',label: 'nav.sideSessionCheck',icon: Video },
];

const LEADER_LINKS = [
  { to: '/leader',             label: 'nav.dashboard',       icon: LayoutDashboard, end: true },
  { to: '/leader/team',        label: 'nav.team',            icon: Users },
  { to: '/leader/absent',      label: 'nav.absentReport',    icon: UserX },
  { to: '/leader/groups',      label: 'nav.groupCoverage',   icon: Globe },
  { to: '/leader/tasks',       label: 'nav.taskDistribution',icon: ClipboardList },
  { to: '/leader/performance', label: 'nav.performance',     icon: BarChart2 },
  { to: '/leader/users',       label: 'nav.users',           icon: UserCog },
  { to: '/leader/upload',      label: 'nav.excelUpload',     icon: Upload },
];

const ADMIN_LINKS = [
  { to: '/admin',              label: 'nav.dashboard',    icon: LayoutDashboard, end: true },
  { to: '/admin/users',        label: 'nav.users',        icon: UserCog },
  { to: '/admin/upload',       label: 'nav.excelUpload',  icon: Upload },
  { to: '/admin/reports',      label: 'nav.systemReports',icon: FileText },
  // Admin can also access leader views
  { to: '/leader',             label: 'nav.team',         icon: Users },
];

const ROLE_LINKS = { agent: AGENT_LINKS, leader: LEADER_LINKS, admin: ADMIN_LINKS };

const managementMap = {
  'Customer Services': 'خدمة العملاء',
  'Education': 'التعليم',
  'Quality': 'الجودة',
};

export default function Sidebar({ mobile, onClose }) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const links = ROLE_LINKS[user?.role] || AGENT_LINKS;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-text w-64">
      {/* Logo */}
      <div className="flex items-center gap-3 p-5 border-b border-white/10">
        <div className="h-11 w-11 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-md">
          <img src="/logo.png" alt="Logo" className="h-9 w-9 object-contain" />
        </div>
        <div className="min-w-0">
          <p className="text-white font-bold text-sm leading-tight truncate">{t('app.name')}</p>
          <p className="text-sidebar-text/70 text-xs truncate">{t('app.tagline')}</p>
        </div>
      </div>

      {/* User info */}
      <div className="px-4 py-3 border-b border-white/10">
        <p className="text-white text-sm font-semibold truncate">{user?.full_name}</p>
        <p className="text-sidebar-text/60 text-xs">
          {t(`roles.${user?.role}`, user?.role)} · {managementMap[user?.management] || user?.management}
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={mobile ? onClose : undefined}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          >
            <Icon size={18} />
            <span className="flex-1 text-sm">{t(label)}</span>
          </NavLink>
        ))}
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-white/10">
        <button onClick={handleLogout} className="sidebar-link w-full text-danger/80 hover:text-danger">
          <LogOut size={18} />
          <span className="text-sm">{t('nav.logout')}</span>
        </button>
      </div>
    </div>
  );
}
