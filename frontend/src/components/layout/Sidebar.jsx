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
    <div
      className="flex flex-col h-full w-72 relative overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, #0F172A 0%, #1E1B4B 100%)',
        boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.05), 4px 0 24px -8px rgba(15, 23, 42, 0.4)',
      }}
    >
      {/* Decorative gradient orb in background */}
      <div
        className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #6366F1 0%, transparent 70%)' }}
      />
      <div
        className="absolute bottom-0 left-0 w-72 h-72 rounded-full opacity-15 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #A855F7 0%, transparent 70%)' }}
      />

      {/* Brand header */}
      <div className="relative z-10 flex items-center gap-3 px-5 py-5 border-b border-white/5">
        <div
          className="h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: 'linear-gradient(180deg, #FFFFFF 0%, #F1F5F9 100%)',
            boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.8), 0 4px 12px -2px rgba(0,0,0,0.3)',
          }}
        >
          <img src="/logo.png" alt="Logo" className="h-9 w-9 object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-white font-extrabold text-base leading-tight truncate tracking-tight">
            {t('app.name')}
          </p>
          <p className="text-slate-400 text-[11px] truncate mt-0.5 font-semibold">
            {t('app.tagline')}
          </p>
        </div>
      </div>

      {/* User card — raised, gradient avatar */}
      <div className="relative z-10 px-3 py-3 border-b border-white/5">
        <div
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
          style={{
            background: 'linear-gradient(180deg, rgba(51, 65, 85, 0.6) 0%, rgba(30, 41, 59, 0.6) 100%)',
            boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.05), 0 2px 6px -1px rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <div className={`avatar avatar-md bg-gradient-to-br ${gradient}`}>
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white text-sm font-bold truncate leading-tight">
              {user?.full_name}
            </p>
            <p className="text-slate-400 text-[11px] truncate font-semibold mt-0.5">
              {t(`roles.${user?.role}`, user?.role)}
              {user?.management ? ` · ${managementMap[user?.management] || user?.management}` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="relative z-10 flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {links.map((item, i) => {
          if (item.type === 'section') {
            return (
              <div key={i} className="px-3 pt-5 pb-2 flex items-center gap-2">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-white/10" />
                <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-[0.15em]">
                  {item.label}
                </p>
                <div className="h-px flex-1 bg-gradient-to-l from-transparent via-white/10 to-white/10" />
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
                  ? `sidebar-link ms-4 ${isActive ? 'active' : ''}`
                  : `sidebar-link ${isActive ? 'active' : ''}`
              }
            >
              <span className="si-icon">
                <Icon size={sub ? 15 : 17} strokeWidth={2.2} />
              </span>
              <span className={`flex-1 ${sub ? 'text-xs' : 'text-sm'} truncate`}>
                {t(label, label)}
              </span>
            </NavLink>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="relative z-10 p-3 border-t border-white/5">
        <button
          onClick={handleLogout}
          className="w-full inline-flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold
                     text-rose-300 hover:text-white transition-all duration-200 group"
          style={{
            background: 'linear-gradient(180deg, rgba(244, 63, 94, 0.08) 0%, rgba(225, 29, 72, 0.05) 100%)',
            border: '1px solid rgba(244, 63, 94, 0.15)',
          }}
        >
          <span
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg flex-shrink-0 transition-all duration-200"
            style={{
              background: 'linear-gradient(180deg, rgba(244, 63, 94, 0.2) 0%, rgba(225, 29, 72, 0.15) 100%)',
              boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.08)',
            }}
          >
            <LogOut size={17} strokeWidth={2.2} />
          </span>
          <span>{t('nav.logout')}</span>
        </button>
      </div>
    </div>
  );
}
