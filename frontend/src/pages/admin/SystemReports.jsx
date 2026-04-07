import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Users, AlertTriangle, BookOpen, Layers, UserX, AlertCircle, MessageSquare,
  RefreshCw, ChevronDown, ChevronUp, X, Clock, UserCheck, Eye,
} from 'lucide-react';
import api from '../../api/axios';

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, icon: Icon, iconClass, loading, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4 ${onClick ? 'cursor-pointer hover:shadow-md hover:border-blue-200 transition-all' : ''}`}
    >
      <div className={`p-3 rounded-xl ${iconClass}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        {loading ? (
          <div className="h-7 w-12 bg-gray-200 animate-pulse rounded" />
        ) : (
          <p className="text-2xl font-bold text-gray-800">{value ?? '—'}</p>
        )}
      </div>
      {onClick && <Eye className="w-4 h-4 text-gray-300 flex-shrink-0" />}
    </div>
  );
}

// ─── GROUPS MODAL ─────────────────────────────────────────────────────────────
function GroupsModal({ title, groups, onClose }) {
  const [expandedGroup,  setExpandedGroup]  = useState(null); // lectures
  const [traineesGroup,  setTraineesGroup]  = useState(null); // trainees popup

  const { data: lecturesData, isLoading: lecturesLoading } = useQuery({
    queryKey: ['group-lectures', expandedGroup],
    queryFn: () => api.get('/reports/group-lectures', { params: { group_name: expandedGroup } }).then(r => r.data),
    enabled: !!expandedGroup,
  });

  const { data: traineesData, isLoading: traineesLoading } = useQuery({
    queryKey: ['group-trainees', traineesGroup],
    queryFn: () => api.get('/reports/group-trainees', { params: { group_name: traineesGroup } }).then(r => r.data),
    enabled: !!traineesGroup,
  });

  const fmtDate = (d) => {
    if (!d) return '—';
    if (typeof d === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}/.test(d)) return d.split(',')[0].trim();
    try { const p = new Date(d); return isNaN(p) ? d : p.toLocaleDateString('ar-EG'); } catch { return d; }
  };

  const hasLectures = (g) => (g.scheduled_lectures ?? 0) > 0 || (g.completed_lectures ?? 0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-400 mt-0.5">{groups.length} مجموعة</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead>
              <tr className="bg-gray-50">
                {['اسم المجموعة','الكورس','القسم','المتدربين','المحاضرات','تاريخ البداية','تاريخ النهاية','المنسق',''].map(h => (
                  <th key={h} className="px-3 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {groups.length === 0 && (
                <tr><td colSpan={9} className="text-center py-10 text-gray-400">لا توجد مجموعات</td></tr>
              )}
              {groups.map((g, i) => (
                <>
                  <tr key={g.external_id ?? i} className="hover:bg-gray-50 transition">
                    <td className="px-3 py-2.5 font-medium text-gray-800 max-w-[200px] truncate">{g.group_name}</td>
                    <td className="px-3 py-2.5 text-gray-600">{g.course ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">{g.dept_type ?? '—'}</span>
                    </td>

                    {/* ── عدد المتدربين قابل للضغط ── */}
                    <td className="px-3 py-2.5 text-center relative">
                      <button
                        onClick={() => setTraineesGroup(traineesGroup === g.group_name ? null : g.group_name)}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm hover:bg-indigo-200 transition"
                        title="عرض المتدربين"
                      >
                        {g.trainee_count ?? 0}
                      </button>

                      {/* Popup المتدربين */}
                      {traineesGroup === g.group_name && (
                        <div className="absolute z-30 top-10 right-0 w-64 bg-white rounded-xl shadow-2xl border border-gray-100 p-3 text-right">
                          <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-gray-100">
                            <button onClick={() => setTraineesGroup(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                            <span className="text-xs font-bold text-gray-700">المتدربين ({traineesData?.length ?? '...'})</span>
                          </div>
                          {traineesLoading ? (
                            <div className="text-center text-xs text-gray-400 py-3">جاري التحميل...</div>
                          ) : !traineesData?.length ? (
                            <div className="text-center text-xs text-gray-400 py-3">لا يوجد متدربين مسجلين</div>
                          ) : (
                            <div className="max-h-48 overflow-y-auto space-y-1.5">
                              {traineesData.map((t, idx) => (
                                <div key={idx} className="flex items-center justify-between gap-2 text-xs bg-gray-50 rounded-lg px-2 py-1.5">
                                  <span className="text-blue-600 font-mono">{t.phone ?? '—'}</span>
                                  <span className="font-medium text-gray-800 truncate">{t.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* ── المحاضرات المكتملة/المجدولة ── */}
                    <td className="px-3 py-2.5">
                      <span className="text-green-600 font-medium">{g.completed_lectures ?? 0}</span>
                      <span className="text-gray-400 mx-1">/</span>
                      <span className="text-gray-700">{g.scheduled_lectures ?? 0}</span>
                    </td>

                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(g.start_date)}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(g.end_date)}</td>
                    <td className="px-3 py-2.5 text-gray-600">{g.coordinators ?? '—'}</td>

                    {/* ── زر المحاضرات — أحمر لو مفيش، أزرق لو فيه ── */}
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => setExpandedGroup(expandedGroup === g.group_name ? null : g.group_name)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-white text-xs transition whitespace-nowrap ${
                          hasLectures(g)
                            ? 'bg-[#1e3a5f] hover:bg-[#15294a]'
                            : 'bg-red-500 hover:bg-red-600'
                        }`}
                      >
                        <BookOpen size={12} />
                        المحاضرات
                        {expandedGroup === g.group_name ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </td>
                  </tr>

                  {/* ── تفاصيل المحاضرات ── */}
                  {expandedGroup === g.group_name && (
                    <tr key={`lec-${g.group_name}`}>
                      <td colSpan={9} className="bg-blue-50/60 px-6 py-4">
                        {lecturesLoading ? (
                          <div className="text-center text-sm text-gray-400 py-4">جاري التحميل...</div>
                        ) : !lecturesData?.lectures?.length ? (
                          <div className="text-center text-sm text-red-400 py-4">⚠ لا توجد محاضرات مسجلة لهذه المجموعة</div>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border border-blue-100">
                            <table className="w-full text-xs text-right">
                              <thead>
                                <tr className="bg-blue-100">
                                  {['#','النوع','التاريخ','الوقت','المدة','المدرب','الحالة','الحضور'].map(h => (
                                    <th key={h} className="px-2 py-2 font-semibold text-blue-800 whitespace-nowrap">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-blue-50 bg-white">
                                {lecturesData.lectures.map((l, idx) => (
                                  <tr key={l.id ?? idx} className="hover:bg-blue-50/40">
                                    <td className="px-2 py-1.5 text-gray-500">{idx + 1}</td>
                                    <td className="px-2 py-1.5">
                                      <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${l.session_type === 'main' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                                        {l.session_type === 'main' ? 'أساسية' : 'جانبية'}
                                      </span>
                                    </td>
                                    <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{fmtDate(l.date)}</td>
                                    <td className="px-2 py-1.5 text-gray-600">{l.time ?? '—'}</td>
                                    <td className="px-2 py-1.5 text-gray-600">{l.duration ?? '—'}</td>
                                    <td className="px-2 py-1.5 text-gray-700">{l.trainer ?? '—'}</td>
                                    <td className="px-2 py-1.5 text-gray-700">{l.status ?? '—'}</td>
                                    <td className="px-2 py-1.5 text-gray-700">{l.attendance ?? '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition">إغلاق</button>
        </div>
      </div>
    </div>
  );
}

// ─── URGENCY BADGE ─────────────────────────────────────────────────────────────
function UrgencyBadge({ level }) {
  const map = {
    urgent:    { label: 'عاجل',     className: 'bg-red-100 text-red-700' },
    important: { label: 'مهم',      className: 'bg-orange-100 text-orange-700' },
    normal:    { label: 'عادي',     className: 'bg-yellow-100 text-yellow-700' },
    overdue:   { label: 'متأخر جداً', className: 'bg-red-200 text-red-900' },
    ok:        { label: 'بخير',     className: 'bg-green-100 text-green-700' },
  };
  const cfg = map[level] || map.ok;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

// ─── EMPTY STATE ──────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <tr>
      <td colSpan={99} className="text-center py-8 text-gray-400 text-sm">لا توجد بيانات</td>
    </tr>
  );
}

// ─── SKELETON ROWS ────────────────────────────────────────────────────────────
function SkeletonRows({ cols = 5, rows = 4 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i} className="animate-pulse">
      {Array.from({ length: cols }).map((__, j) => (
        <td key={j} className="px-3 py-3">
          <div className="h-4 bg-gray-200 rounded" />
        </td>
      ))}
    </tr>
  ));
}

// ─── SECTION HEADER ───────────────────────────────────────────────────────────
function SectionHeader({ title }) {
  return (
    <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">{title}</h2>
  );
}

// ─── TABLE WRAPPER ────────────────────────────────────────────────────────────
function TableWrapper({ children }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100 shadow-sm bg-white">
      <table className="w-full text-sm text-right">{children}</table>
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 text-right whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({ children, className = '' }) {
  return <td className={`px-3 py-2.5 text-gray-700 ${className}`}>{children ?? '—'}</td>;
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function SystemReports() {
  const today = new Date().toISOString().slice(0, 10);

  const [filters, setFilters] = useState({
    from_date:  '',
    to_date:    '',
    department: 'All',
    employee:   '',
  });
  const [applied, setApplied] = useState({});
  const [errorsTab, setErrorsTab] = useState('remarks');
  const [remarksOpen,  setRemarksOpen]  = useState(true);
  const [expiredOpen,  setExpiredOpen]  = useState(true);
  const [errorsOpen,   setErrorsOpen]   = useState(true);
  const [groupsModal,  setGroupsModal]  = useState(null); // { title, groups }

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['reports', applied],
    queryFn: () => api.get('/reports/dashboard', { params: applied }).then(r => r.data),
  });

  const { data: usersData } = useQuery({
    queryKey: ['users-agents'],
    queryFn: () => api.get('/admin/users').then(r => r.data),
  });
  const agents = (usersData ?? []).filter(u => u.role === 'agent');

  const kpis = data?.kpis ?? {};

  const handleApply = () => {
    const clean = {};
    if (filters.from_date)              clean.from_date  = filters.from_date;
    if (filters.to_date)                clean.to_date    = filters.to_date;
    if (filters.department && filters.department !== 'All') clean.department = filters.department;
    if (filters.employee)               clean.employee   = filters.employee;
    setApplied(clean);
  };

  const handleReset = () => {
    setFilters({ from_date: '', to_date: '', department: 'All', employee: '' });
    setApplied({});
  };

  const fmtDate = (d) => {
    if (!d) return '—';
    try {
      // Handle format: "31/03/2026, 12:59 PM" — extract date part only
      if (typeof d === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}/.test(d)) {
        return d.split(',')[0].trim();
      }
      const parsed = new Date(d);
      if (isNaN(parsed.getTime())) return d;
      return parsed.toLocaleDateString('ar-EG');
    } catch { return d; }
  };

  return (
    <div className="space-y-6 animate-fadeIn" dir="rtl">

      {/* ── PAGE HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">تقارير خدمة العملاء</h1>
          <p className="text-sm text-gray-500 mt-0.5">لوحة متابعة شاملة بمؤشرات الأداء والأخطاء</p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition"
        >
          <RefreshCw size={14} />
          تحديث
        </button>
      </div>

      {/* ── FILTER BAR ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          {/* From date */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">من تاريخ</label>
            <input
              type="date"
              value={filters.from_date}
              max={today}
              onChange={e => setFilters(f => ({ ...f, from_date: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          {/* To date */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={filters.to_date}
              max={today}
              onChange={e => setFilters(f => ({ ...f, to_date: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          {/* Department */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">القسم</label>
            <select
              value={filters.department}
              onChange={e => setFilters(f => ({ ...f, department: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="All">الكل</option>
              <option value="General">عام</option>
              <option value="Private">خاص</option>
              <option value="Semi">شبه خاص</option>
            </select>
          </div>
          {/* Employee dropdown */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">الموظف / المنسق</label>
            <select
              value={filters.employee}
              onChange={e => setFilters(f => ({ ...f, employee: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="">الكل</option>
              {agents.map(u => (
                <option key={u.id} value={u.full_name}>{u.full_name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleApply}
            className="px-5 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-medium hover:bg-[#15294a] transition"
          >
            تطبيق الفلاتر
          </button>
          <button
            onClick={handleReset}
            className="px-5 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition"
          >
            إعادة تعيين
          </button>
        </div>
      </div>

      {/* ── KPI CARDS ── */}
      {/* المجموعات - صف مستقل بـ 3 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          label="مجموعات نشطة"
          value={kpis.active_groups}
          icon={Users}
          iconClass="bg-green-100 text-green-600"
          loading={isLoading}
          onClick={() => setGroupsModal({ title: 'مجموعات نشطة', groups: data?.active_groups_list ?? [] })}
        />
        <KpiCard
          label="بانتظار تسجيل المتدربين"
          value={kpis.waiting_trainees}
          icon={UserCheck}
          iconClass="bg-yellow-100 text-yellow-600"
          loading={isLoading}
          onClick={() => setGroupsModal({ title: 'بانتظار تسجيل المتدربين', groups: data?.waiting_trainees_list ?? [] })}
        />
        <KpiCard
          label="بانتظار تسجيل المحاضرات"
          value={kpis.waiting_lectures}
          icon={Clock}
          iconClass="bg-orange-100 text-orange-600"
          loading={isLoading}
          onClick={() => setGroupsModal({ title: 'بانتظار تسجيل المحاضرات', groups: data?.waiting_lectures_list ?? [] })}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="مجموعات منتهية ونشطة"
          value={kpis.expired_active_groups}
          icon={AlertTriangle}
          iconClass="bg-red-100 text-red-600"
          loading={isLoading}
        />
        <KpiCard
          label="المحاضرات الأساسية"
          value={kpis.main_lectures}
          icon={BookOpen}
          iconClass="bg-blue-100 text-blue-600"
          loading={isLoading}
        />
        <KpiCard
          label="الجلسات الجانبية"
          value={kpis.side_sessions}
          icon={Layers}
          iconClass="bg-purple-100 text-purple-600"
          loading={isLoading}
        />
        <KpiCard
          label="غياب المحاضرات الأساسية"
          value={kpis.absent_main}
          icon={UserX}
          iconClass="bg-orange-100 text-orange-600"
          loading={isLoading}
        />
        <KpiCard
          label="غياب الجلسات الجانبية"
          value={kpis.absent_side}
          icon={UserX}
          iconClass="bg-yellow-100 text-yellow-600"
          loading={isLoading}
        />
        <KpiCard
          label="ملاحظات مفتوحة"
          value={kpis.open_remarks}
          icon={MessageSquare}
          iconClass="bg-red-100 text-red-600"
          loading={isLoading}
        />
        <KpiCard
          label="مجموعات بها أخطاء"
          value={
            isLoading ? undefined :
            (data?.groups_with_errors?.remarks_errors?.length ?? 0) +
            (data?.groups_with_errors?.lectures_errors?.length ?? 0) +
            (data?.groups_with_errors?.side_session_errors?.length ?? 0)
          }
          icon={AlertCircle}
          iconClass="bg-gray-100 text-gray-600"
          loading={isLoading}
        />
      </div>

      {/* ── OPEN REMARKS TABLE ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
          <h2 className="text-base font-bold text-gray-800">الملاحظات المفتوحة</h2>
          <button
            onClick={() => setRemarksOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-sm text-gray-600 transition"
          >
            {remarksOpen ? (
              <><ChevronUp size={16} /> طي القائمة</>
            ) : (
              <><ChevronDown size={16} /> عرض القائمة <span className="mr-1 bg-red-100 text-red-700 rounded-full px-2 text-xs font-bold">{data?.open_remarks_list?.length ?? 0}</span></>
            )}
          </button>
        </div>
        {remarksOpen && <TableWrapper>
          <thead>
            <tr>
              <Th>اسم العميل</Th>
              <Th>تفاصيل</Th>
              <Th>التصنيف</Th>
              <Th>الحالة</Th>
              <Th>الأهمية</Th>
              <Th>مستوى الإلحاح</Th>
              <Th>آخر تحديث</Th>
              <Th>مسؤول</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              <SkeletonRows cols={8} />
            ) : !data?.open_remarks_list?.length ? (
              <EmptyState />
            ) : (
              data.open_remarks_list.map((r) => {
                // compute urgency on frontend for display in remarks table
                const hoursOpen = r.added_at
                  ? (Date.now() - new Date(r.added_at).getTime()) / 3600000
                  : 0;
                let urgency = 'ok';
                if (hoursOpen >= 72)       urgency = 'overdue';
                else if (hoursOpen >= 48)  urgency = 'normal';
                else if (hoursOpen >= 24)  urgency = 'important';
                else if (hoursOpen >= 3)   urgency = 'urgent';

                return (
                  <tr key={r.id} className="hover:bg-gray-50 transition">
                    <Td className="font-medium">{r.client_name}</Td>
                    <Td className="max-w-xs truncate">{r.details}</Td>
                    <Td>
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 whitespace-nowrap">
                        {r.category ?? '—'}
                      </span>
                    </Td>
                    <Td>{r.status}</Td>
                    <Td>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${
                        r.priority === 'عاجلة' ? 'bg-red-100 text-red-700' :
                        r.priority === 'هامة'  ? 'bg-orange-100 text-orange-700' :
                                                  'bg-gray-100 text-gray-600'
                      }`}>
                        {r.priority ?? '—'}
                      </span>
                    </Td>
                    <Td><UrgencyBadge level={urgency} /></Td>
                    <Td>{fmtDate(r.last_updated)}</Td>
                    <Td>{r.assigned_to}</Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrapper>}
      </div>

      {/* ── EXPIRED ACTIVE GROUPS TABLE ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
          <h2 className="text-base font-bold text-gray-800">مجموعات منتهية ولا تزال نشطة</h2>
          <button
            onClick={() => setExpiredOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-sm text-gray-600 transition"
          >
            {expiredOpen ? (
              <><ChevronUp size={16} /> طي القائمة</>
            ) : (
              <><ChevronDown size={16} /> عرض القائمة <span className="mr-1 bg-orange-100 text-orange-700 rounded-full px-2 text-xs font-bold">{data?.expired_groups_list?.length ?? 0}</span></>
            )}
          </button>
        </div>
        {expiredOpen && <TableWrapper>
          <thead>
            <tr>
              <Th>اسم المجموعة</Th>
              <Th>تاريخ البداية</Th>
              <Th>تاريخ النهاية</Th>
              <Th>القسم</Th>
              <Th>المنسق</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              <SkeletonRows cols={5} />
            ) : !data?.expired_groups_list?.length ? (
              <EmptyState />
            ) : (
              data.expired_groups_list.map((g, i) => (
                <tr key={g.id ?? i} className="hover:bg-gray-50 transition">
                  <Td className="font-medium">{g.group_name}</Td>
                  <Td>{fmtDate(g.start_date)}</Td>
                  <Td className="text-red-600 font-medium">{fmtDate(g.end_date)}</Td>
                  <Td>{g.dept_type}</Td>
                  <Td>{g.coordinators}</Td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrapper>}
      </div>

      {/* ── ERRORS REPORT (TABBED) ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
          <h2 className="text-base font-bold text-gray-800">تقرير الأخطاء</h2>
          <button
            onClick={() => setErrorsOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-sm text-gray-600 transition"
          >
            {errorsOpen ? (
              <><ChevronUp size={16} /> طي القائمة</>
            ) : (
              <><ChevronDown size={16} /> عرض القائمة</>
            )}
          </button>
        </div>

        {errorsOpen && <>
        {/* Tab buttons */}
        <div className="flex gap-2 mb-4 border-b border-gray-200">
          {[
            { key: 'remarks',  label: 'ملاحظات' },
            { key: 'lectures', label: 'محاضرات' },
            { key: 'side',     label: 'جلسات جانبية' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setErrorsTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition -mb-px ${
                errorsTab === tab.key
                  ? 'border-[#1e3a5f] text-[#1e3a5f]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {!isLoading && (
                <span className="mr-1.5 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5">
                  {tab.key === 'remarks'  ? (data?.groups_with_errors?.remarks_errors?.length ?? 0)      : ''}
                  {tab.key === 'lectures' ? (data?.groups_with_errors?.lectures_errors?.length ?? 0)     : ''}
                  {tab.key === 'side'     ? (data?.groups_with_errors?.side_session_errors?.length ?? 0) : ''}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab: Remarks errors */}
        {errorsTab === 'remarks' && (
          <TableWrapper>
            <thead>
              <tr>
                <Th>اسم العميل</Th>
                <Th>الحالة</Th>
                <Th>ساعات مفتوحة</Th>
                <Th>مستوى الإلحاح</Th>
                <Th>مسؤول</Th>
                <Th>تاريخ الإضافة</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <SkeletonRows cols={6} />
              ) : !data?.groups_with_errors?.remarks_errors?.length ? (
                <EmptyState />
              ) : (
                data.groups_with_errors.remarks_errors.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 transition">
                    <Td className="font-medium">{r.client_name}</Td>
                    <Td>{r.status}</Td>
                    <Td>{r.hours_open} ساعة</Td>
                    <Td><UrgencyBadge level={r.urgency_level} /></Td>
                    <Td>{r.assigned_to}</Td>
                    <Td>{fmtDate(r.added_at)}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrapper>
        )}

        {/* Tab: Lectures errors */}
        {errorsTab === 'lectures' && (
          <TableWrapper>
            <thead>
              <tr>
                <Th>اسم المجموعة</Th>
                <Th>المحاضرات المجدولة</Th>
                <Th>المحاضرات المكتملة</Th>
                <Th>المحاضرات الناقصة</Th>
                <Th>القسم</Th>
                <Th>المنسق</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <SkeletonRows cols={6} />
              ) : !data?.groups_with_errors?.lectures_errors?.length ? (
                <EmptyState />
              ) : (
                data.groups_with_errors.lectures_errors.map((g, i) => (
                  <tr key={g.group_name ?? i} className="hover:bg-gray-50 transition">
                    <Td className="font-medium">{g.group_name}</Td>
                    <Td>{g.scheduled_lectures}</Td>
                    <Td>{g.completed_lectures}</Td>
                    <Td>
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                        -{g.missing_lectures}
                      </span>
                    </Td>
                    <Td>{g.dept_type}</Td>
                    <Td>{g.coordinators}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrapper>
        )}

        {/* Tab: Side session errors */}
        {errorsTab === 'side' && (
          <TableWrapper>
            <thead>
              <tr>
                <Th>اسم المجموعة</Th>
                <Th>عدد المتدربين</Th>
                <Th>الجلسات الفعلية</Th>
                <Th>الجلسات المطلوبة</Th>
                <Th>الفرق</Th>
                <Th>القسم</Th>
                <Th>المنسق</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <SkeletonRows cols={7} />
              ) : !data?.groups_with_errors?.side_session_errors?.length ? (
                <EmptyState />
              ) : (
                data.groups_with_errors.side_session_errors.map((g, i) => (
                  <tr key={g.group_name ?? i} className="hover:bg-gray-50 transition">
                    <Td className="font-medium">{g.group_name}</Td>
                    <Td>{g.trainee_count}</Td>
                    <Td>{g.side_count}</Td>
                    <Td>{g.expected_side_count}</Td>
                    <Td>
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
                        -{g.expected_side_count - g.side_count}
                      </span>
                    </Td>
                    <Td>{g.dept_type}</Td>
                    <Td>{g.coordinators}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrapper>
        )}
        </>}
      </div>

      {/* ── GROUPS MODAL ── */}
      {groupsModal && (
        <GroupsModal
          title={groupsModal.title}
          groups={groupsModal.groups}
          onClose={() => setGroupsModal(null)}
        />
      )}
    </div>
  );
}
