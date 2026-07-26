import { useState, useMemo } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import {
  LayoutDashboard, ClipboardList, Search, UserX, Calendar,
  Video, Users, BarChart2, Globe, UserCog, Upload, FileText,
  LogOut, Headphones, GraduationCap, ShieldCheck, AlertTriangle, Activity, Shuffle, Kanban,
  TrendingUp, Target, Settings, Award, Snowflake, Goal, Database, ChevronDown, Sparkles, BarChart3,
  Cloud, History, Network, ListTodo, ClipboardCheck, CalendarClock, KeyRound, Wallet,
  Link as LinkIcon, GitBranch, PhoneCall, UserPlus,
} from 'lucide-react';
import UserAvatar from '../ui/UserAvatar';
import { expandGrants } from '../../utils/pageGrants';

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

// Enrollment — Department Deliveries (تسليمات الأقسام) as a single page with a
// tab per department. Shown to admin, leader and coordinator (agent); the
// backend scopes the data and the page shows only the leader's own dept tab.
// NOTE (2026-07-21, Owner): «Enrollment» was REMOVED from these base links —
// it belongs to the Enrollment department, so a Customer-Services coordinator
// (agent) / leader must NOT see it by default. It stays reachable via the
// Enrollment management (Enrollment tree in getAdminLinks) or the
// `cs-enrollment` page grant. Only the CS-department delivery stays here.
const DELIVERIES_LINKS = [
  { type: 'section', label: 'تسليمات الأقسام' },
  { to: '/subscriptions/cs-department', label: 'Customer Services Department', icon: GraduationCap, color: 'violet' },
];

const AGENT_LINKS = [
  { to: '/agent/profile',            label: 'صفحتي الشخصية',         icon: KeyRound,        color: 'slate' },
  { to: '/agent',                    label: 'nav.dashboard',        icon: LayoutDashboard, end: true, color: 'blue' },
  { to: '/agent/schedule',           label: 'nav.todaySchedule',    icon: Calendar,        color: 'orange' },
  { to: '/agent/absent',             label: 'nav.absentFollowUp',   icon: UserX,           color: 'rose' },
  { to: '/agent/side-session-check', label: 'nav.sideSessionCheck', icon: Video,           color: 'purple' },
  { to: '/agent/clients',            label: 'nav.clientSearch',     icon: Search,          color: 'cyan' },
  { to: '/agent/code-problems',      label: 'nav.codeProblems',     icon: AlertTriangle,   color: 'amber' },
  { to: '/agent/group-receiving',    label: 'استلام المجموعات',     icon: ClipboardCheck,  color: 'cyan' },
  { to: '/agent/pipeline',           label: 'nav.clientPipeline',   icon: Kanban,          color: 'emerald' },
  { to: '/agent/tasks',              label: 'nav.myTasks',          icon: ClipboardList,   color: 'indigo' },
  { to: '/agent/todos',              label: 'مهامي',                icon: ListTodo,        color: 'pink' },
  { to: '/agent/my-progression',     label: 'nav.myProgression',    icon: TrendingUp,      color: 'violet' },
  { to: '/agent/targets',            label: 'nav.targets',          icon: Target,          color: 'green' },
  ...DELIVERIES_LINKS,
];

const ENROLLMENT_LINKS = [
  { to: '/enrollment/pipeline', label: 'nav.clientPipeline', icon: Kanban, color: 'emerald' },
];

const ENROLLMENT_LEADER_LINKS = [
  { to: '/enrollment-leader/pipeline', label: 'nav.clientPipeline', icon: Kanban, color: 'emerald' },
];

const LEADER_LINKS = [
  { to: '/leader/profile',                      label: 'صفحتي الشخصية',         icon: KeyRound,        color: 'slate' },
  { to: '/leader',                              label: 'nav.dashboard',        icon: LayoutDashboard, end: true, color: 'blue' },
  // فريق العمل removed from leaders — restricted to مسؤول + مدير Enrollment (2026-07-04).
  { to: '/leader/org-chart',                    label: 'الهيكل التنظيمي',       icon: Network,         color: 'indigo' },
  { to: '/leader/groups',                       label: 'nav.groupCoverage',    icon: Globe,           color: 'cyan' },
  { to: '/leader/absent',                       label: 'nav.absentReport',     icon: UserX,           color: 'rose' },
  { to: '/leader/performance',                  label: 'nav.performance',      icon: BarChart2,       color: 'green' },
  { to: '/leader/tasks',                        label: 'nav.taskDistribution', icon: ClipboardList,   color: 'indigo' },
  { to: '/leader/todos',                        label: 'مهام الفريق',          icon: ListTodo,        color: 'pink' },
  { to: '/leader/code-problems',                label: 'nav.codeProblems',     icon: AlertTriangle,   color: 'amber' },
  { to: '/leader/group-receiving',              label: 'استلام المجموعات',     icon: ClipboardCheck,  color: 'cyan' },
  { to: '/leader/pipeline',                     label: 'nav.clientPipeline',   icon: Kanban,          color: 'emerald' },
  { to: '/agent/my-progression',                label: 'nav.myProgression',    icon: TrendingUp,      color: 'violet' },
  { type: 'section', label: 'nav.reportsSection' },
  { to: '/leader/reports/fix-report',           label: 'nav.fixReports',          icon: FileText, color: 'orange' },
  { to: '/leader/reports/attendance-absence',   label: 'nav.attendanceReports',   icon: Activity, color: 'teal' },
  { to: '/leader/targets',                      label: 'nav.targets',             icon: Target,   color: 'green' },
  ...DELIVERIES_LINKS,
];

const REPORT_LINKS = [
  { to: '/admin/reports/customer-services',     label: 'إدارة خدمة العملاء',      icon: Headphones,    color: 'rose',    management: 'Customer Services' },
  { to: '/admin/reports/fix-report',            label: 'nav.fixReports',         icon: FileText,      color: 'orange',  management: 'Customer Services', sub: true },
  { to: '/admin/reports/attendance-absence',    label: 'nav.attendanceReports',  icon: Activity,      color: 'teal',    management: 'Customer Services', sub: true },
  { to: '/admin/reports/education',             label: 'الإدارة التعليمية',       icon: GraduationCap, color: 'violet',  management: 'Education' },
  // «الإشغال والمدربين» is no longer a REPORT_LINKS entry — it moved into the
  // "Enrollment" department tree built in getAdminLinks (2026-07-04, Owner).
  { to: '/admin/reports/quality',               label: 'إدارة الجودة',            icon: ShieldCheck,   color: 'green',   management: 'Quality' },
  { to: '/admin/reports/quality-snapshots',     label: 'nav.qualitySnapshots',   icon: Snowflake,     color: 'cyan',    management: 'Quality', sub: true },
  { to: '/admin/reschedules',                    label: 'إعادة جدولة المحاضرات',     icon: CalendarClock, color: 'indigo',  management: 'Quality', sub: true },
  { to: '/admin/schedule-changes',               label: 'كشف تلاعب الجدول',          icon: AlertTriangle, color: 'rose',    management: 'Quality', sub: true },
  { to: '/admin/holidays',                       label: 'الإجازات الرسمية',          icon: Sparkles,    color: 'cyan',    management: 'Quality', sub: true },
];

const managementMap = {
  'Customer Services': 'خدمة العملاء',
  'Education': 'التعليم',
  'Quality': 'الجودة',
  'All': 'جميع الإدارات',
};

function getAdminLinks(user) {
  const isSuperAdmin = user?.management === 'All';
  // فريق العمل access = مسؤول (All) OR مدير Enrollment (management incl. Enrollment).
  const _mgmts = [user?.management, ...String(user?.extra_managements || '').split(',')]
    .map(s => String(s || '').trim()).filter(Boolean);
  const isEnrollmentMgr = _mgmts.includes('All') || _mgmts.includes('Enrollment');
  const base = [
    { to: '/admin/profile',      label: 'صفحتي الشخصية',      icon: KeyRound,        color: 'slate' },
    // 'حالة قاعدة البيانات' pinned as the 2nd item, right after the profile (super-admin only).
    ...(isSuperAdmin ? [{ to: '/admin/db-status', label: 'nav.dbStatus', icon: Database, color: 'blue' }] : []),
    // { to: '/admin', label: 'nav.dashboard', icon: LayoutDashboard, end: true, color: 'blue' }, // hidden per user request — route /admin still works
    // User management (add/delete/grant) — SUPER-ADMIN only ("مسؤول"). Hidden
    // from department managers ("مدير"); backend also enforces requireSuperAdmin.
    ...(isSuperAdmin ? [{ to: '/admin/users', label: 'nav.users', icon: UserCog, color: 'indigo' }] : []),
    // Excel upload + Drive sync — Super Admin (management='All') only.
    // Department managers don't see these in the sidebar AND backend rejects them.
    ...(isSuperAdmin ? [
      // { to: '/admin/upload', label: 'nav.excelUpload', icon: Upload, color: 'orange' }, // hidden per user request — route /admin/upload still works
      { to: '/admin/drive-sync',   label: 'مزامنة Drive',      icon: Cloud,           color: 'sky' },
      { to: '/admin/drive-sync/history', label: 'تاريخ المزامنات', icon: History,    color: 'cyan',  sub: true },
    ] : []),
    // ── Collapsible group: الفريق والهيكل التنظيمي (toggle-only header) ──
    { group: true, key: 'team-org', label: 'الفريق والهيكل التنظيمي', icon: Users, color: 'purple' },
    // فريق العمل — مسؤول + مدير Enrollment only (backend team API = requireManagement('Enrollment')).
    ...(isEnrollmentMgr ? [{ to: '/admin/team', label: 'nav.team', icon: Users, color: 'purple', sub: true }] : []),
    { to: '/admin/org-chart',    label: 'الهيكل التنظيمي',    icon: Network,         color: 'indigo', sub: true },
    // { to: '/admin/group-receiving', label: 'استلام المجموعات', icon: ClipboardCheck, color: 'cyan' }, // hidden per user request — route still works
    // { to: '/admin/control', label: 'nav.controlPanel', icon: LayoutDashboard, color: 'pink' }, // hidden per user request — route /admin/control still works
    // ── Collapsible group: إدارة العملاء (توزيع + بايبلاين), toggle-only header ──
    { group: true, key: 'clients', label: 'إدارة العملاء', icon: Users, color: 'cyan' },
    { to: '/admin/distribution', label: 'nav.clientDistribution', icon: Shuffle,         color: 'cyan',    sub: true },
    { to: '/admin/pipeline',     label: 'nav.clientPipeline',     icon: Kanban,          color: 'emerald', sub: true },
    // «كشف العملاء» moved into the owner-only «إدارة مالية» section (was here).
    // ── Collapsible group: تطوير الأداء والمهام (toggle-only header, no own page).
    //    The 4 pages below were moved here from their standalone positions.
    { group: true, key: 'perf-tasks', label: 'تطوير الأداء والمهام', icon: TrendingUp, color: 'violet' },
    { to: '/admin/employee-progression', label: 'nav.employeeProgression', icon: TrendingUp, color: 'violet', sub: true },
    { to: '/admin/todos',                label: 'إدارة المهام',            icon: ListTodo,   color: 'pink',   sub: true },
    { to: '/admin/targets',              label: 'nav.targets',             icon: Target,     color: 'green',  sub: true },
    ...(isSuperAdmin ? [
      { to: '/admin/settings',           label: 'nav.systemSettings',      icon: Settings,   color: 'slate',  sub: true },
    ] : []),
    // System-wide config — super-admin (management='All') only.
    // Department-scoped admins (Customer Services / Quality / Education) don't see these.
    // 'إعدادات النظام' moved into the 'تطوير الأداء والمهام' group; 'حالة قاعدة
    // البيانات' moved up to the 2nd position (both above).
    { type: 'section', label: 'الإدارات' },
  ];
  // A user's effective managements = primary + any extras assigned via
  // users.extra_managements. The sidebar shows a report's section when the
  // user's set includes that report's management (or either is 'All').
  const mgmt = user?.management;
  const extraMgmts = String(user?.extra_managements || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const userMgmts = new Set([mgmt, ...extraMgmts].filter(Boolean));
  const reports = (userMgmts.has('All')
    ? REPORT_LINKS
    : REPORT_LINKS.filter(r => r.management === 'All' || userMgmts.has(r.management))
  // Owner-locked items (e.g. مرتبات المدربين) appear only for that exact account.
  ).filter(r => !r.owner || String(user?.username || '').toLowerCase() === r.owner);

  const monitoring = [
    { type: 'section', label: 'المراقبة' },
    { to: '/admin/remarks-monitor', label: 'مراقبة الـ Remarks', icon: Activity, color: 'fuchsia' },
    { to: '/admin/remarks-monitor/category', label: 'توزيع التصنيفات', icon: BarChart3, color: 'pink', sub: true },
  ];

  // Finance / Center App sync — super-admin only.
  const financeSection = isSuperAdmin ? [
    { type: 'section', label: 'Center App' },
    { to: '/admin/finance/sync',      label: 'مزامنة Center App', icon: Wallet,    color: 'emerald' },
    { to: '/admin/finance/matching',  label: 'مطابقة العملاء',     icon: LinkIcon,  color: 'violet',  sub: true },
    { to: '/admin/finance/lifecycle', label: 'رحلة العميل',        icon: GitBranch, color: 'cyan',    sub: true },
  ] : [];

  // Clients section (العمليات المالية / لوحة الاشتراكات / قائمة العملاء) was
  // hidden from the sidebar per user request. The pages, routes, backend and
  // data are all left intact — only the nav links were removed. Center App
  // section above is deliberately untouched.

  // «إدارة مالية» section. Salary pages stay OWNER-ONLY (username='admin').
  // كشف العملاء opens to the owner + الإدارة المالية (Finance) admins; Finance
  // NON-admins (e.g. a وكيل/agent) get it from grantedLinks (neutral /reports).
  const isSalaryOwner = String(user?.username || '').toLowerCase() === 'admin';
  const isFinance = userMgmts.has('All') || userMgmts.has('Finance');
  // Collapsible group (click «إدارة مالية» to expand/collapse its pages), same
  // pattern as «الفريق والهيكل التنظيمي». Children are marked sub:true.
  const employeeSalaries = (isSalaryOwner || isFinance) ? [
    { group: true, key: 'finance', label: 'الإدارة المالية', icon: Wallet, color: 'amber' },
    ...(isSalaryOwner ? [
      { to: '/admin/reports/trainer-salaries', label: 'تعريف أنظمة المرتبات', icon: Wallet, color: 'amber', sub: true },
      { to: '/admin/salaries/trainers',        label: 'مرتبات المدربين',      icon: Wallet, color: 'amber', sub: true },
    ] : []),
    { to: '/admin/sales-register',           label: 'كشف العملاء',          icon: Wallet, color: 'emerald', sub: true },
  ] : [];

  // ─── تسليمات الأقسام + شجرة «Enrollment» (2026-07-04, Owner) ────────────────
  const hasMgmt = (m) => userMgmts.has('All') || userMgmts.has(m);
  // "Enrollment" department — a top-level COLLAPSIBLE tree for Enrollment
  // managers (+ super-admin):  Enrollment ▸ { تسليمات الأقسام ▸ pages,
  // الإشغال والمدربين ▸ pages }.  Level-1 header + two sub-group children, each
  // carrying its own pre-built `children`, so the 3-level render fires
  // (parent ▸ sub-group ▸ pages). The grouped reducer pushes sub:true items
  // as-is onto the header, preserving their nested children.
  const enrollmentTree = hasMgmt('Enrollment')
    ? [
        { group: true, key: 'enrollment-dept', label: 'Enrollment', icon: GraduationCap, color: 'cyan' },
        { sub: true, group: true, key: 'enr-deliveries', label: 'تسليمات الأقسام', icon: GraduationCap, color: 'emerald', children: [
            { to: '/subscriptions/cs-department', label: 'Customer Services Department', icon: GraduationCap, color: 'violet' },
            { to: '/subscriptions/enrollment', label: 'Enrollment', icon: GraduationCap, color: 'cyan' },
            { to: '/subscriptions/enr-groups', label: 'Enr Groups', icon: GraduationCap, color: 'emerald' },
            { to: '/subscriptions/enr-levels', label: 'المستويات الشغّالة', icon: BarChart2, color: 'amber' },
            ...(user?.role === 'admin' ? [{ to: '/subscriptions/deleted-groups', label: 'مراجعة المجموعات المحذوفة', icon: AlertTriangle, color: 'rose' }] : []),
    // TEMPORARY review page — remove with the feature when the owner is done.
    ...(['admin', 'enrollment'].includes(user?.role) ? [{ to: '/subscriptions/unregistered-clients', label: 'عملاء غير مسجلين', icon: UserX, color: 'amber' }] : []),
          ] },
        { sub: true, group: true, key: 'occupancy-trainers', label: 'الإشغال والمدربين', icon: Activity, color: 'teal', children: [
            { to: '/admin/reports/trainer-utilization',    label: 'nav.trainerUtilization',   icon: Activity,  color: 'teal'   },
            { to: '/admin/reports/find-available-trainer', label: 'nav.findAvailableTrainer', icon: Sparkles,  color: 'cyan'   },
            { to: '/admin/reports/trainer-dashboard',      label: 'nav.trainerDashboard',     icon: BarChart3, color: 'indigo' },
            { to: '/admin/reports/phone-call-gap',         label: 'فجوة الفون كول',            icon: PhoneCall, color: 'rose'   },
            { to: '/admin/reports/trainer-details',        label: 'تفاصيل المدربين',           icon: Users,     color: 'amber'  },
            { to: '/admin/reports/trainer-recruitment',    label: 'توظيف المدربين',            icon: UserPlus,  color: 'rose'   },
            { to: '/admin/reports/trainer-org-chart',      label: 'الهيكل التنظيمي للمحاضرين', icon: Network,   color: 'indigo' },
          ] },
      ]
    : [];

  // Order (Owner 2026-07-04): «الإدارات» = reports (خدمة العملاء/التعليمية/الجودة)
  // + الإدارة المالية + Enrollment — all together — THEN المراقبة + Center App.
  return [...base, ...reports, ...employeeSalaries, ...enrollmentTree, ...monitoring, ...financeSection];
}

// Avatar visuals are owned by the shared UserAvatar component now.

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
  const roleLinks = user?.role === 'admin'
    ? getAdminLinks(user)
    : user?.role === 'leader'            ? LEADER_LINKS
    : user?.role === 'enrollment_leader' ? ENROLLMENT_LEADER_LINKS
    : user?.role === 'enrollment'        ? ENROLLMENT_LINKS
    : AGENT_LINKS;
  // Per-PAGE grants (users.extra_pages) for NON-admins — show specific report
  // pages a user was given without changing their role. Links point to the
  // /agent-mounted copies (guarded by requirePage in the router). Admins already
  // get these via getAdminLinks (management-scoped), so skip them here.
  // expandGrants resolves the `occupancy-trainers` umbrella into each trainer
  // page key, so a user holding the umbrella OR an individual key sees the link.
  const grants = expandGrants(user?.extra_pages);
  const grantedLinks = [];
  // Per-PAGE grants (users.extra_pages) — show the SPECIFIC pages an admin
  // granted this user, for ANY role INCLUDING مدير/admin (Owner 2026-07-04:
  // «لما أحدد صفحات مختارة لأي يوزر، الصفحات دي هي اللي تتفتح عنده»). Grants are
  // ADDITIVE to whatever the role/management already shows; each link appears
  // only if its key is in the user's extra_pages (`grants.has`).
  const trainerLinks = [
    { key: 'trainer-utilization',    to: '/reports/trainer-utilization',    label: 'nav.trainerUtilization',   icon: Activity,  color: 'teal'   },
    { key: 'find-available-trainer', to: '/reports/find-available-trainer', label: 'nav.findAvailableTrainer', icon: Sparkles,  color: 'cyan'   },
    { key: 'trainer-dashboard',      to: '/reports/trainer-dashboard',      label: 'nav.trainerDashboard',     icon: BarChart3, color: 'indigo' },
    { key: 'trainer-work-history',   to: '/reports/trainer-work-history',   label: 'سجل عمل المدربين',          icon: FileText,  color: 'slate'  },
    { key: 'phone-call-gap',         to: '/reports/phone-call-gap',         label: 'فجوة الفون كول',            icon: PhoneCall, color: 'rose'   },
    { key: 'trainer-details',        to: '/reports/trainer-details',        label: 'تفاصيل المدربين',           icon: Users,     color: 'amber'  },
    { key: 'trainer-recruitment',    to: '/reports/trainer-recruitment',    label: 'توظيف المدربين',            icon: UserPlus,  color: 'rose'   },
    { key: 'trainer-org-chart',      to: '/reports/trainer-org-chart',      label: 'الهيكل التنظيمي للمحاضرين', icon: Network,   color: 'indigo' },
  ].filter(l => grants.has(l.key)).map(({ key, ...l }) => l);
  if (trainerLinks.length) {
    grantedLinks.push({ type: 'section', label: 'صفحات ممنوحة' }, ...trainerLinks);
  }
  // تسليمات الأقسام grants — role-neutral /subscriptions/* routes.
  const delGrants = [];
  if (grants.has('cs-deliveries'))
    delGrants.push({ to: '/subscriptions/cs-department', label: 'Customer Services Department', icon: GraduationCap, color: 'violet' });
  if (grants.has('cs-enrollment'))
    delGrants.push({ to: '/subscriptions/enrollment', label: 'Enrollment', icon: GraduationCap, color: 'cyan' });
  if (grants.has('enr-groups'))
    delGrants.push({ to: '/subscriptions/enr-groups', label: 'Enr Groups', icon: GraduationCap, color: 'emerald' });
  // المستويات الشغّالة — its OWN grant key (was bundled with enr-groups).
  if (grants.has('enr-levels'))
    delGrants.push({ to: '/subscriptions/enr-levels', label: 'المستويات الشغّالة', icon: BarChart2, color: 'amber' });
  if (delGrants.length) {
    grantedLinks.push({ type: 'section', label: 'تسليمات الأقسام — ممنوحة' }, ...delGrants);
  }
  // إدارة المستخدمين + فريق العمل — granted pages (neutral /reports mounts).
  const adminGrants = [];
  if (grants.has('users-management'))
    adminGrants.push({ to: '/reports/users', label: 'إدارة المستخدمين', icon: UserCog, color: 'indigo' });
  if (grants.has('team'))
    adminGrants.push({ to: '/reports/team', label: 'فريق العمل', icon: Users, color: 'purple' });
  if (adminGrants.length) {
    grantedLinks.push({ type: 'section', label: 'صلاحيات ممنوحة' }, ...adminGrants);
  }
  // كشف العملاء — Finance NON-admins only (e.g. وكيل); admins get it via getAdminLinks.
  if (user?.role !== 'admin') {
    const finMgmts = [user?.management, ...String(user?.extra_managements || '').split(',')]
      .map(s => String(s || '').trim()).filter(Boolean);
    if (finMgmts.includes('Finance') || finMgmts.includes('All')) {
      grantedLinks.push({ type: 'section', label: 'إدارة مالية' });
      grantedLinks.push({ to: '/reports/sales-register', label: 'كشف العملاء', icon: Wallet, color: 'emerald' });
    }
  }
  const baseLinks = [...roleLinks, ...grantedLinks];

  // Department-Deliveries scoping: a leader only sees their own department's
  // delivery link (unless they're an 'All' leader/super-admin). Admin & agent
  // see all dept links — the backend filters the actual rows per role.
  const links = useMemo(() => {
    if (user?.role !== 'leader') return baseLinks;
    if (user?.department === 'All' || user?.management === 'All') return baseLinks;
    return baseLinks.filter(l => {
      if (typeof l.to === 'string' && l.to.startsWith('/subscriptions/deliveries/')) {
        return l.to.split('/').pop() === user?.department;
      }
      return true;
    });
  }, [baseLinks, user]);

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

  // Recursively check whether the current route lands on any (deep) descendant.
  const anyDescendantActive = (node) =>
    !!node.children?.some(c =>
      (c.to && (location.pathname === c.to || location.pathname.startsWith(c.to + '/'))) ||
      anyDescendantActive(c)
    );

  const isParentOpen = (node) => {
    const k = node.to || node.key;
    const o = overrides.get(k);
    if (o === 'closed') return false;
    if (o === 'open')   return true;
    // No user override — use route-based default (open if any deep descendant is active)
    if (node.to && location.pathname === node.to) return true;
    if (anyDescendantActive(node)) return true;
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
          <UserAvatar name={user?.full_name} avatarUrl={user?.avatar_url} size="md" />
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
          const pk = to || item.key;   // parent key (group headers have no own `to`)

          return (
            <div key={pk}>
              {/* Parent row — a real page navigates (and auto-expands); a group
                  header (item.group, no `to`) only toggles its children. */}
              <div className="relative">
                {item.group ? (
                  <button
                    type="button"
                    onClick={() => toggleExpand(pk, isOpen)}
                    style={colorVars(color)}
                    className={`sidebar-link-v2 w-full ${isOpen ? 'active' : ''} ${hasChildren ? 'pe-10' : ''}`}
                  >
                    <span className="si-icon-v2">
                      <Icon size={18} strokeWidth={2.4} />
                    </span>
                    <span className="flex-1 text-sm truncate font-bold text-right">
                      {t(label, label)}
                    </span>
                  </button>
                ) : (
                  <NavLink
                    to={to}
                    end={end}
                    onClick={() => {
                      // Clicking the parent's main row navigates + ensures it's open
                      // (so the user sees their context). Use the chevron to collapse.
                      if (hasChildren && !isOpen) toggleExpand(pk, false);
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
                )}
                {hasChildren && (
                  <button
                    type="button"
                    aria-label={isOpen ? 'طي' : 'فتح'}
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleExpand(pk, isOpen); }}
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

              {/* Children — only when expanded. A child can itself be a
                  collapsible sub-group (child.group + its own children). */}
              {hasChildren && isOpen && (
                <div className="mt-1 space-y-1 animate-fadeIn">
                  {children.map((child) => {
                    const subKids = child.children || [];
                    if (child.group && subKids.length > 0) {
                      const ck = child.to || child.key;
                      const cOpen = isParentOpen(child);
                      const CIcon = child.icon;
                      return (
                        <div key={ck}>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => toggleExpand(ck, cOpen)}
                              style={colorVars(child.color)}
                              className={`sidebar-link-v2 ms-4 w-full pe-10 ${cOpen ? 'active' : ''}`}
                            >
                              <span className="si-icon-v2">
                                <CIcon size={15} strokeWidth={2.4} />
                              </span>
                              <span className="flex-1 text-xs truncate font-bold text-right">
                                {t(child.label, child.label)}
                              </span>
                            </button>
                            <button
                              type="button"
                              aria-label={cOpen ? 'طي' : 'فتح'}
                              onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleExpand(ck, cOpen); }}
                              className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                            >
                              <ChevronDown size={13} strokeWidth={2.6} className={`transition-transform duration-200 ${cOpen ? 'rotate-180' : ''}`} />
                            </button>
                          </div>
                          {cOpen && (
                            <div className="mt-1 space-y-1 animate-fadeIn">
                              {subKids.map((gc) => (
                                <NavLink
                                  key={gc.to}
                                  to={gc.to}
                                  end={gc.end}
                                  onClick={mobile ? onClose : undefined}
                                  style={colorVars(gc.color)}
                                  className={({ isActive }) => `sidebar-link-v2 ms-8 ${isActive ? 'active' : ''}`}
                                >
                                  <span className="si-icon-v2">
                                    <gc.icon size={14} strokeWidth={2.4} />
                                  </span>
                                  <span className="flex-1 text-xs truncate font-bold">
                                    {t(gc.label, gc.label)}
                                  </span>
                                </NavLink>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return (
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
                    );
                  })}
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
