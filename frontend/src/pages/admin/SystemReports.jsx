import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Users, AlertTriangle, BookOpen, Layers, UserX, AlertCircle, MessageSquare, RefreshCw,
} from 'lucide-react';
import api from '../../api/axios';

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, icon: Icon, iconClass, loading }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4">
      <div className={`p-3 rounded-xl ${iconClass}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        {loading ? (
          <div className="h-7 w-12 bg-gray-200 animate-pulse rounded" />
        ) : (
          <p className="text-2xl font-bold text-gray-800">{value ?? '—'}</p>
        )}
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

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['reports', applied],
    queryFn: () => api.get('/reports/dashboard', { params: applied }).then(r => r.data),
  });

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
          {/* Employee search */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">الموظف / المنسق</label>
            <input
              type="text"
              placeholder="بحث بالاسم..."
              value={filters.employee}
              onChange={e => setFilters(f => ({ ...f, employee: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="المجموعات النشطة"
          value={kpis.active_groups}
          icon={Users}
          iconClass="bg-green-100 text-green-600"
          loading={isLoading}
        />
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
        <SectionHeader title="الملاحظات المفتوحة" />
        <TableWrapper>
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
        </TableWrapper>
      </div>

      {/* ── EXPIRED ACTIVE GROUPS TABLE ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <SectionHeader title="مجموعات منتهية ولا تزال نشطة" />
        <TableWrapper>
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
        </TableWrapper>
      </div>

      {/* ── ERRORS REPORT (TABBED) ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <SectionHeader title="تقرير الأخطاء" />

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
      </div>
    </div>
  );
}
