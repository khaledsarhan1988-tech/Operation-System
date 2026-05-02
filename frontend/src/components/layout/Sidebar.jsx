import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import {
  LayoutDashboard, ClipboardList, Search, UserX, Calendar,
  Video, Users, BarChart2, Globe, UserCog, Upload, FileText,
  LogOut, Headphones, GraduationCap, ShieldCheck, AlertTriangle, Activity, Shuffle, Kanban
} from 'lucide-react';

const AGENT_LINKS = [
  { to: '/agent',                    label: 'nav.dashboard',        icon: LayoutDashboard, end: true },
  { to: '/agent/schedule',           label: 'nav.todaySchedule',    icon: Calendar },
  { to: '/agent/absent',             label: 'nav.absentFollowUp',   icon: UserX },
  { to: '/agent/side-session-check', label: 'nav.sideSessionCheck', icon: Video },
  { to: '/agent/clients',            label: 'nav.clientSearch',     icon: Search },
  { to: '/agent/code-problems',      label: 'أكواد بها مشكلة',     icon: AlertTriangle },
  { to: '/agent/pipeline',           label: 'بايبلاين العملاء',     icon: Kanban },
  { to: '/agent/tasks',              label: 'nav.myTasks',          icon: ClipboardList },
];

const ENROLLMENT_LINKS = [
  { to: '/enrollment/pipeline', label: 'بايبلاين العملاء', icon: Kanban },
];

const ENROLLMENT_LEADER_LINKS = [
  { to: '/enrollment-leader/pipeline', label: 'بايبلاين العملاء', icon: Kanban },
];

const LEADER_LINKS = [
  { to: '/leader',                              label: 'nav.dashboard',        icon: LayoutDashboard, end: true },
  { to: '/leader/team',                         label: 'nav.team',             icon: Users },
  { to: '/leader/groups',                       label: 'nav.groupCoverage',    icon: Globe },
  { to: '/leader/absent',                       label: 'nav.absentReport',     icon: UserX },
  { to: '/leader/performance',                  label: 'nav.performance',      icon: BarChart2 },
  { to: '/leader/tasks',                        label: 'nav.taskDistribution', icon: ClipboardList },
  { to: '/leader/code-problems',                label: 'أكواد بها مشكلة',     icon: AlertTriangle },
  { to: '/leader/pipeline',                     label: 'بايبلاين العملاء',    icon: Kanban },
  { type: 'section', label: 'التقارير' },
  { to: '/leader/reports/fix-report',           label: 'تقارير الإصلاح',          icon: FileText },
  { to: '/leader/reports/attendance-absence',   label: 'تقارير الحضور والغياب',  icon: Activity },
];


const REPORT_LINKS = [
  { to: '/admin/reports/customer-services',     label: 'تقارير خدمة العملاء',     icon: Headphones,    management: 'Customer Services' },
  { to: '/admin/reports/fix-report',            label: 'تقارير الإصلاح',           icon: FileText,      management: 'Customer Services', sub: true },
  { to: '/admin/reports/attendance-absence',    label: 'تقارير الحضور والغياب',   icon: Activity,      management: 'Customer Services', sub: true },
  { to: '/admin/reports/education',             label: 'تقارير الإدارة التعليمية', icon: GraduationCap, management: 'Education' },
  { to: '/admin/reports/quality',               label: 'تقارير الجودة',            icon: ShieldCheck,   management: 'Quality' },
];

const managementMap = {
  'Customer Services': 'خدمة العملاء',
  'Education': 'التعليم',
  'Quality': 'الجودة',
  'All': 'جميع الإدارات',
};

function getAdminLinks(user) {
  const base = [
    { to: '/admin',         label: 'nav.dashboard', icon: LayoutDashboard, end: true },
    { to: '/admin/users',   label: 'nav.users',     icon: UserCog },
    { to: '/admin/upload',  label: 'nav.excelUpload', icon: Upload },
    { to: '/admin/team',    label: 'nav.team',      icon: Users },
    { to: '/admin/control',       label: 'لوحة التحكم',   icon: LayoutDashboard },
    { to: '/admin/distribution', label: 'توزيع العملاء', icon: Shuffle },
    { to: '/admin/pipeline',     label: 'بايبلاين العملاء', icon: Kanban },
    { type: 'section', label: 'التقارير' },
  ];
  const mgmt = user?.management;
  const reports = mgmt === 'All'
    ? REPORT_LINKS
    : REPORT_LINKS.filter(r => r.management === mgmt || r.management === 'All');
  return [...base, ...reports];
}

// Same gradient logic as Topbar so the same user has the same color across the UI
const AVATAR_GRADIENTS = [
  'from-indigo-500 to-purple-600',
  'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-fuchsia-600',
  'from-sky-500 to-indigo-600',
  'from-teal-500 to-emerald-600',
];
function gradientFor(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

export default function Sidebar({ mobile, onClose }) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const links = user?.role === 'admin'
    ? getAdminLinks(user)
    : user?.role === 'leader'            ? LEADER_LINKS
    : user?.role === 'enrollment_leader' ? ENROLLMENT_LEADER_LINKS
    : user?.role === 'enrollment'        ? ENROLLMENT_LINKS
    : AGENT_LINKS;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initial = user?.full_name?.[0]?.toUpperCase() || '?';
  const gradient = gradientFor(user?.full_name);

  return (
    <div className="flex flex-col h-full bg-sidebar w-64 border-e border-slate-800">
      {/* Brand header */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
        <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-md">
          <img src="/logo.png" alt="Logo" className="h-8 w-8 object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-white font-bold text-sm leading-tight truncate">{t('app.name')}</p>
          <p className="text-slate-400 text-[11px] truncate mt-0.5">{t('app.tagline')}</p>
        </div>
      </div>

      {/* User card — colored avatar + name + role */}
      <div className="px-3 py-3 border-b border-slate-800">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-slate-800/50">
          <div className={`avatar avatar-md bg-gradient-to-br ${gradient} ring-slate-700`}>
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white text-sm font-semibold truncate">{user?.full_name}</p>
            <p className="text-slate-400 text-[11px] truncate">
              {t(`roles.${user?.role}`, user?.role)}
              {user?.management ? ` · ${managementMap[user?.management] || user?.management}` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
        {links.map((item, i) => {
          if (item.type === 'section') {
            return (
              <div key={i} className="px-3 pt-5 pb-1.5">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.12em]">{item.label}</p>
              </div>
            );
          }
          const { to, label, icon: Icon, end, sub } = item;
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={mobile ? onClose : undefined}
              className={({ isActive }) =>
                sub
                  ? `sidebar-link ms-4 opacity-90 ${isActive ? 'active' : ''}`
                  : `sidebar-link ${isActive ? 'active' : ''}`
              }
            >
              <Icon size={sub ? 15 : 18} className="flex-shrink-0" />
              <span className={`flex-1 ${sub ? 'text-xs' : 'text-sm'}`}>{t(label, label)}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-slate-800">
        <button
          onClick={handleLogout}
          className="w-full inline-flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                     text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
        >
          <LogOut size={18} />
          <span>{t('nav.logout')}</span>
        </button>
      </div>
    </div>
  );
}
