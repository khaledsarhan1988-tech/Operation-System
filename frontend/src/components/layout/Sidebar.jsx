import { useState, useMemo } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import {
  LayoutDashboard, ClipboardList, Search, UserX, Calendar,
  Video, Users, BarChart2, Globe, UserCog, Upload, FileText,
  LogOut, Headphones, GraduationCap, ShieldCheck, AlertTriangle, Activity, Shuffle, Kanban,
  TrendingUp, Target, Settings, Award, Snowflake, Goal, Database, ChevronDown, Sparkles, BarChart3,
  Cloud, History, Network, ListTodo
} from 'lucide-react';

// ─── COLOR PALETTE ─────────────────────────────────────────────────────────
// Each link gets a brand color used for its icon container — this gives the
// sidebar a vibrant, app-launcher feel instead of one monolithic indigo.
// Idle: subtle tint of the color (~15%). Hover: ramps up. Active: full gradient.
const COLOR_MAP = {
  blue:    { from: '#3B82F6', to: '#06B6D4', glow: 'rgba(59, 130, 246, 0.5)' },
  indigo:  { from: '#6366F1', to: '#8B5CF6', glow: 'rgba(99, 102, 241, 0.5)' },
  purple:  { from: '#A855F7', to: '#EC4899', glow: 'rgba(168, 85, 247, 0.5)' },
  pink:    { from: '#EC4899', to: '#F43F5E', glow: 'rgba(236, 72, 153, 0.5)' },
  rose:    { from: '#F43F5E', to: '#EF4444', glow: 'rgba(244, 63, 94, 0.5)' },
  red:     { from: '#EF4444', to: '#F97316', glow: 'rgba(239, 68, 68, 0.5)' },
  orange:  { from: '#F97316', to: '#F59E0B', glow: 'rgba(249, 115, 22, 0.5)' },
  amber:   { from: '#F59E0B', to: '#EAB308', glow: 'rgba(245, 158, 11, 0.5)' },
  yellow:  { from: '#EAB308', to: '#84CC16', glow: 'rgba(234, 179, 8, 0.5)' },
  green:   { from: '#22C55E', to: '#10B981', glow: 'rgba(34, 197, 94, 0.5)' },
  emerald: { from: '#10B981', to: '#14B8A6', glow: 'rgba(16, 185, 129, 0.5)' },
  teal:    { from: '#14B8A6', to: '#06B6D4', glow: 'rgba(20, 184, 166, 0.5)' },
  cyan:    { from: '#06B6D4', to: '#3B82F6', glow: 'rgba(6, 182, 212, 0.5)' },
  sky:     { from: '#0EA5E9', to: '#6366F1', glow: 'rgba(14, 165, 233, 0.5)' },
  violet:  { from: '#8B5CF6', to: '#A855F7', glow: 'rgba(139, 92, 246, 0.5)' },
  fuchsia: { from: '#D946EF', to: '#EC4899', glow: 'rgba(217, 70, 239, 0.5)' },
  slate:   { from: '#64748B', to: '#475569', glow: 'rgba(100, 116, 139, 0.4)' },
};

// ─── LINKS ─────────────────────────────────────────────────────────────────
const AGENT_LINKS = [
  { to: '/agent',                    label: 'nav.dashboard',        icon: LayoutDashboard, end: true, color: 'blue' },
  { to: '/agent/schedule',           label: 'nav.todaySchedule',    icon: Calendar,        color: 'orange' },
  { to: '/agent/absent',             label: 'nav.absentFollowUp',   icon: UserX,           color: 'rose' },
  { to: '/agent/side-session-check', label: 'nav.sideSessionCheck', icon: Video,           color: 'purple' },
  { to: '/agent/clients',            label: 'nav.clientSearch',     icon: Search,          color: 'cyan' },
  { to: '/agent/code-problems',      label: 'nav.codeProblems',     icon: AlertTriangle,   color: 'amber' },
  { to: '/agent/pipeline',           label: 'nav.clientPipeline',   icon: Kanban,          color: 'emerald' },
  { to: '/agent/tasks',              label: 'nav.myTasks',          icon: ClipboardList,   color: 'indigo' },
  { to: '/agent/todos',              label: 'مهامي',                icon: ListTodo,        color: 'pink' },
  { to: '/agent/my-progression',     label: 'nav.myProgression',    icon: TrendingUp,      color: 'violet' },
  { to: '/agent/targets',            label: 'nav.targets',          icon: Target,          color: 'green' },
];

const ENROLLMENT_LINKS = [
  { to: '/enrollment/pipeline', label: 'nav.clientPipeline', icon: Kanban, color: 'emerald' },
];

const ENROLLMENT_LEADER_LINKS = [
  { to: '/enrollment-leader/pipeline', label: 'nav.clientPipeline', icon: Kanban, color: 'emerald' },
];

const LEADER_LINKS = [
  { to: '/leader',                              label: 'nav.dashboard',        icon: LayoutDashboard, end: true, color: 'blue' },
  { to: '/leader/team',                         label: 'nav.team',             icon: Users,           color: 'purple' },
  { to: '/leader/org-chart',                    label: 'الهيكل التنظيمي',       icon: Network,         color: 'indigo' },
  { to: '/leader/groups',                       label: 'nav.groupCoverage',    icon: Globe,           color: 'cyan' },
  { to: '/leader/absent',                       label: 'nav.absentReport',     icon: UserX,           color: 'rose' },
  { to: '/leader/performance',                  label: 'nav.performance',      icon: BarChart2,       color: 'green' },
  { to: '/leader/tasks',                        label: 'nav.taskDistribution', icon: ClipboardList,   color: 'indigo' },
  { to: '/leader/code-problems',                label: 'nav.codeProblems',     icon: AlertTriangle,   color: 'amber' },
  { to: '/leader/pipeline',                     label: 'nav.clientPipeline',   icon: Kanban,          color: 'emerald' },
  { type: 'section', label: 'nav.reportsSection' },
  { to: '/leader/reports/fix-report',           label: 'nav.fixReports',          icon: FileText, color: 'orange' },
  { to: '/leader/reports/attendance-absence',   label: 'nav.attendanceReports',   icon: Activity, color: 'teal' },
  { to: '/leader/targets',                      label: 'nav.targets',             icon: Target,   color: 'green' },
];

const REPORT_LINKS = [
  { to: '/admin/reports/customer-services',     label: 'nav.csReports',          icon: Headphones,    color: 'rose',    management: 'Customer Services' },
  { to: '/admin/reports/fix-report',            label: 'nav.fixReports',         icon: FileText,      color: 'orange',  management: 'Customer Services', sub: true },
  { to: '/admin/reports/attendance-absence',    label: 'nav.attendanceReports',  icon: Activity,      color: 'teal',    management: 'Customer Services', sub: true },
  { to: '/admin/reports/education',             label: 'nav.educationReports',   icon: GraduationCap, color: 'violet',  management: 'Education' },
  { to: '/admin/reports/trainer-utilization',   label: 'nav.trainerUtilization', icon: Activity,      color: 'teal',    management: 'Education', sub: true },
  { to: '/admin/reports/find-available-trainer', label: 'nav.findAvailableTrainer', icon: Sparkles,    color: 'cyan',    management: 'Education', sub: true },
  { to: '/admin/reports/trainer-dashboard',      label: 'nav.trainerDashboard',     icon: BarChart3,   color: 'indigo',  management: 'Education', sub: true },
  { to: '/admin/reports/quality',               label: 'nav.qualityReports',     icon: ShieldCheck,   color: 'green',   management: 'Quality' },
  { to: '/admin/reports/quality-snapshots',     label: 'nav.qualitySnapshots',   icon: Snowflake,     color: 'cyan',    management: 'Quality', sub: true },
];

const managementMap = {
  'Customer Services': 'خدمة العملاء',
  'Education': 'التعليم',
  'Quality': 'الجودة',
  'All': 'جميع الإدارات',
};

function getAdminLinks(user) {
  const isSuperAdmin = user?.management === 'All';
  const base = [
    { to: '/admin',              label: 'nav.dashboard',     icon: LayoutDashboard, end: true, color: 'blue' },
    { to: '/admin/users',        label: 'nav.users',         icon: UserCog,         color: 'indigo' },
    // Excel upload + Drive sync — Super Admin (management='All') only.
    // Department managers don't see these in the sidebar AND backend rejects them.
    ...(isSuperAdmin ? [
      { to: '/admin/upload',       label: 'nav.excelUpload',   icon: Upload,          color: 'orange' },
      { to: '/admin/drive-sync',   label: 'مزامنة Drive',      icon: Cloud,           color: 'sky' },
      { to: '/admin/drive-sync/history', label: 'تاريخ المزامنات', icon: History,    color: 'cyan',  sub: true },
    ] : []),
    { to: '/admin/team',         label: 'nav.team',          icon: Users,           color: 'purple' },
    { to: '/admin/org-chart',    label: 'الهيكل التنظيمي',    icon: Network,         color: 'indigo' },
    { to: '/admin/control',      label: 'nav.controlPanel',       icon: LayoutDashboard, color: 'pink' },
    { to: '/admin/distribution', label: 'nav.clientDistribution', icon: Shuffle,         color: 'cyan' },
    { to: '/admin/pipeline',     label: 'nav.clientPipeline',     icon: Kanban,          color: 'emerald' },
    { to: '/admin/employee-progression', label: 'nav.employeeProgression', icon: TrendingUp, color: 'violet' },
    { to: '/admin/targets',      label: 'nav.targets',            icon: Target,          color: 'green' },
    // System-wide config — super-admin (management='All') only.
    // Department-scoped admins (Customer Services / Quality / Education) don't see these.
    ...(isSuperAdmin ? [
      { to: '/admin/settings',  label: 'nav.systemSettings', icon: Settings, color: 'slate' },
      { to: '/admin/db-status', label: 'nav.dbStatus',       icon: Database, color: 'blue'  },
    ] : []),
    { type: 'section', label: 'nav.reportsSection' },
  ];
  const mgmt = user?.management;
  const reports = mgmt === 'All'
    ? REPORT_LINKS
    : REPORT_LINKS.filter(r => r.management === mgmt || r.management === 'All');

  const monitoring = [
    { type: 'section', label: 'المراقبة' },
    { to: '/admin/remarks-monitor', label: 'مراقبة الـ Remarks', icon: Activity, color: 'fuchsia' },
    { to: '/admin/remarks-monitor/category', label: 'توزيع التصنيفات', icon: BarChart3, color: 'pink', sub: true },
  ];

  return [...base, ...reports, ...monitoring];
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

// Build CSS variables for a colored link — used for icon container bg/glow
function colorVars(color) {
  const c = COLOR_MAP[color] || COLOR_MAP.indigo;
  return {
    '--link-from': c.from,
    '--link-to':   c.to,
    '--link-glow': c.glow,
  };
}

export default function Sidebar({ mobile, onClose }) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const links = user?.role === 'admin'
    ? getAdminLinks(user)
    : user?.role === 'leader'            ? LEADER_LINKS
    : user?.role === 'enrollment_leader' ? ENROLLMENT_LEADER_LINKS
    : user?.role === 'enrollment'        ? ENROLLMENT_LINKS
    : AGENT_LINKS;

  // Group sub-items under their parent so we can collapse them by default.
  // A "parent" is any non-sub link that's followed by sub:true links until
  // the next non-sub link or section header. Sections reset the grouping.
  const grouped = useMemo(() => {
    const out = [];
    let lastParent = null;
    for (const item of links) {
      if (item.type === 'section') { out.push(item); lastParent = null; continue; }
      if (item.sub && lastParent) {
        lastParent.children.push(item);
      } else {
        const node = { ...item, children: [] };
        out.push(node);
        lastParent = node;
      }
    }
    return out;
  }, [links]);

  // Tracks per-parent overrides set by the user when they click the chevron.
  // Map<routeKey, 'open' | 'closed'> — if absent, falls back to the route-based
  // default (parent is open when the current route matches it or a child).
  // We need a real override (not just a Set of "opened") because the user
  // should be able to MANUALLY COLLAPSE a parent whose route they're on.
  const [overrides, setOverrides] = useState(() => new Map());

  const isParentOpen = (node) => {
    const o = overrides.get(node.to);
    if (o === 'closed') return false;
    if (o === 'open')   return true;
    // No user override — use route-based default
    if (location.pathname === node.to) return true;
    if (node.children?.some(c => c.to && (location.pathname === c.to || location.pathname.startsWith(c.to + '/')))) return true;
    return false;
  };

  // Toggle takes the current open state so we know which direction to flip to.
  const toggleExpand = (key, currentlyOpen) => {
    setOverrides(prev => {
      const next = new Map(prev);
      next.set(key, currentlyOpen ? 'closed' : 'open');
      return next;
    });
  };

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
        background: 'linear-gradient(165deg, #0B1120 0%, #1E1B4B 55%, #1A0F2E 100%)',
        boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.06), 8px 0 32px -8px rgba(15, 23, 42, 0.5)',
      }}
    >
      {/* Decorative gradient orbs in background */}
      <div
        className="absolute top-0 right-0 w-72 h-72 rounded-full opacity-25 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #6366F1 0%, transparent 70%)' }}
      />
      <div
        className="absolute bottom-32 left-0 w-72 h-72 rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #A855F7 0%, transparent 70%)' }}
      />
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full opacity-10 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #EC4899 0%, transparent 70%)' }}
      />

      {/* Brand header */}
      <div className="relative z-10 flex items-center gap-3 px-5 py-5 border-b border-white/[0.06]">
        <div
          className="h-11 w-11 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{
            background: 'linear-gradient(180deg, #FFFFFF 0%, #E2E8F0 100%)',
            boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.9), 0 8px 16px -4px rgba(99, 102, 241, 0.4)',
          }}
        >
          <img src="/logo.png" alt="Logo" className="h-9 w-9 object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-white font-extrabold text-base leading-tight truncate tracking-tight">
            {t('app.name')}
          </p>
          <p className="text-slate-400 text-[11px] truncate mt-0.5 font-bold">
            {t('app.tagline')}
          </p>
        </div>
      </div>

      {/* User card — glassmorphism */}
      <div className="relative z-10 px-3 py-3 border-b border-white/[0.06]">
        <div
          className="flex items-center gap-3 px-3 py-3 rounded-xl backdrop-blur-md"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
            boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.08), 0 4px 12px -2px rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div className={`avatar avatar-md bg-gradient-to-br ${gradient}`}>
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white text-sm font-extrabold truncate leading-tight tracking-tight">
              {user?.full_name}
            </p>
            <p className="text-slate-400 text-[11px] truncate font-bold mt-0.5">
              {/* Department-scoped admin reads as "مدير" / "Manager" — matches
                  the convention used in the UserManagement table. */}
              {(() => {
                const roleKey = (user?.role === 'admin' && user?.management && user.management !== 'All')
                  ? 'manager'
                  : user?.role;
                return t(`roles.${roleKey}`, roleKey);
              })()}
              {user?.management ? ` · ${managementMap[user?.management] || user?.management}` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="relative z-10 flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {grouped.map((item, i) => {
          if (item.type === 'section') {
            return (
              <div key={i} className="px-3 pt-5 pb-2 flex items-center gap-2">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-white/15" />
                <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-[0.18em]">
                  {t(item.label, item.label)}
                </p>
                <div className="h-px flex-1 bg-gradient-to-l from-transparent via-white/15 to-white/15" />
              </div>
            );
          }
          const { to, label, icon: Icon, end, color, children = [] } = item;
          const hasChildren = children.length > 0;
          const isOpen = hasChildren && isParentOpen(item);

          return (
            <div key={to}>
              {/* Parent row — clicking the main area navigates AND auto-expands.
                  A small chevron at the end lets the user toggle without navigating. */}
              <div className="relative">
                <NavLink
                  to={to}
                  end={end}
                  onClick={() => {
                    // Clicking the parent's main row navigates + ensures it's open
                    // (so the user sees their context). Use the chevron to collapse.
                    if (hasChildren && !isOpen) toggleExpand(to, false);
                    if (mobile) onClose?.();
                  }}
                  style={colorVars(color)}
                  className={({ isActive }) =>
                    `sidebar-link-v2 ${isActive ? 'active' : ''} ${hasChildren ? 'pe-10' : ''}`
                  }
                >
                  <span className="si-icon-v2">
                    <Icon size={18} strokeWidth={2.4} />
                  </span>
                  <span className="flex-1 text-sm truncate font-bold">
                    {t(label, label)}
                  </span>
                </NavLink>
                {hasChildren && (
                  <button
                    type="button"
                    aria-label={isOpen ? 'طي' : 'فتح'}
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleExpand(to, isOpen); }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                  >
                    <ChevronDown
                      size={14}
                      strokeWidth={2.6}
                      className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                )}
              </div>

              {/* Children — only when expanded */}
              {hasChildren && isOpen && (
                <div className="mt-1 space-y-1 animate-fadeIn">
                  {children.map((child) => (
                    <NavLink
                      key={child.to}
                      to={child.to}
                      end={child.end}
                      onClick={mobile ? onClose : undefined}
                      style={colorVars(child.color)}
                      className={({ isActive }) =>
                        `sidebar-link-v2 ms-4 ${isActive ? 'active' : ''}`
                      }
                    >
                      <span className="si-icon-v2">
                        <child.icon size={15} strokeWidth={2.4} />
                      </span>
                      <span className="flex-1 text-xs truncate font-bold">
                        {t(child.label, child.label)}
                      </span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="relative z-10 p-3 border-t border-white/[0.06]">
        <button
          onClick={handleLogout}
          className="w-full inline-flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-extrabold
                     text-rose-100 hover:text-white transition-all duration-200 group"
          style={{
            background: 'linear-gradient(135deg, rgba(244, 63, 94, 0.15) 0%, rgba(225, 29, 72, 0.08) 100%)',
            border: '1px solid rgba(244, 63, 94, 0.25)',
            boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.05), 0 4px 12px -4px rgba(244, 63, 94, 0.3)',
          }}
        >
          <span
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg flex-shrink-0 transition-all duration-200"
            style={{
              background: 'linear-gradient(180deg, #F43F5E 0%, #E11D48 100%)',
              boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.25), 0 4px 8px -2px rgba(244, 63, 94, 0.5)',
              color: '#FFFFFF',
            }}
          >
            <LogOut size={17} strokeWidth={2.4} />
          </span>
          <span>{t('nav.logout')}</span>
        </button>
      </div>
    </div>
  );
}
