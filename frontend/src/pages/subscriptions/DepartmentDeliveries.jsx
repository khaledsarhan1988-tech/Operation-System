import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Search, Users, RefreshCw } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../auth/AuthContext';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';

/**
 * Enrollment — Department Deliveries (تسليمات الأقسام) as ONE page with a tab
 * per department (جينرال / سيمي برايفت / برايفت).
 *
 * URL: /subscriptions/enrollment   (also /subscriptions/deliveries/:dept → tab)
 * Roles: admin & agent see all tabs; a leader sees only their own department.
 * The backend scopes the rows per role regardless.
 *
 * One row per client: memberships, manual status, active groups, inactive
 * (past) groups, remaining levels, expected time, journey-end date, coordinator.
 */

const ALL_DEPTS = ['General', 'Semi', 'Private'];

const DEPT_META = {
  General: { label: 'جينرال',      color: 'cyan'    },
  Semi:    { label: 'سيمي برايفت', color: 'emerald' },
  Private: { label: 'برايفت',      color: 'violet'  },
};

const STATUS_OPTIONS = [
  { value: 'active',     label: 'نشط',            cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'churned',    label: 'منسحب',          cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  { value: 'postponed',  label: 'مؤجل',           cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'exit_level', label: 'خروج بمستوى',    cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  { value: 'refund',     label: 'استرداد',        cls: 'bg-slate-100 text-slate-700 border-slate-300' },
];
const STATUS_CLS = Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s.cls]));

export default function DepartmentDeliveries() {
  const params = useParams();
  const qc = useQueryClient();
  const { user } = useAuth();

  // A leader is locked to their own department; everyone else sees all tabs.
  const isScopedLeader = user?.role === 'leader' && user?.department !== 'All' && user?.management !== 'All';
  let allowedDepts = isScopedLeader ? ALL_DEPTS.filter(d => d === user?.department) : ALL_DEPTS;
  if (!allowedDepts.length) allowedDepts = ALL_DEPTS;

  const initialDept = (params.dept && allowedDepts.includes(params.dept)) ? params.dept : allowedDepts[0];
  const [activeDept, setActiveDept] = useState(initialDept);

  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [coordinator, setCoordinator] = useState('');
  const [firstFrom, setFirstFrom] = useState('');
  const [firstTo, setFirstTo] = useState('');
  const [lastFrom, setLastFrom] = useState('');
  const [lastTo, setLastTo] = useState('');
  const [remMin, setRemMin] = useState('');
  const [remMax, setRemMax] = useState('');
  const [page, setPage] = useState(1);

  const meta = DEPT_META[activeDept] || { label: activeDept, color: 'violet' };

  // Any filter change resets to page 1.
  const onFilter = (setter) => (val) => { setPage(1); setter(val); };

  const clearColumnFilters = () => {
    setPage(1);
    setCoordinator(''); setFirstFrom(''); setFirstTo('');
    setLastFrom(''); setLastTo(''); setRemMin(''); setRemMax('');
  };

  const listQ = useQuery({
    queryKey: ['cs-deliveries', activeDept, search, statusFilter, coordinator, firstFrom, firstTo, lastFrom, lastTo, remMin, remMax, page],
    queryFn: () => api.get('/cs/deliveries', {
      params: {
        dept: activeDept, q: search, status: statusFilter, page, page_size: 25,
        coordinator,
        first_from: firstFrom, first_to: firstTo,
        last_from: lastFrom, last_to: lastTo,
        remaining_min: remMin, remaining_max: remMax,
      },
    }).then(r => r.data),
    keepPreviousData: true,
  });

  const setStatusMut = useMutation({
    mutationFn: ({ phone, status }) =>
      api.patch(`/cs/deliveries/${encodeURIComponent(phone)}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cs-deliveries'] }),
    onError: (e) => alert('فشل تحديث الحالة: ' + (e.response?.data?.error || e.message)),
  });

  // Admin-only: refresh the underlying data (Finance API → Membership Excel →
  // Drive levels), then reload the table. Runs the 3 imports sequentially; a
  // failure in one step is captured and does not block the others.
  const ingestAll = useMutation({
    mutationFn: async () => {
      const finance    = await api.post('/cs/ingest/finance').then(r => r.data?.result || {}).catch(e => ({ error: e.response?.data?.error || e.message }));
      const membership = await api.post('/cs/ingest/membership').then(() => ({ ok: true })).catch(e => ({ error: e.response?.data?.error || e.message }));
      const levels     = await api.post('/cs/ingest/levels').then(() => ({ ok: true })).catch(e => ({ error: e.response?.data?.error || e.message }));
      return { finance, membership, levels };
    },
    onSuccess: (out) => {
      qc.invalidateQueries({ queryKey: ['cs-deliveries'] });
      const f = out.finance || {};
      const step = (label, res) => res?.error ? `❌ ${label}: ${res.error}` : `✅ ${label}`;
      alert(
        'تحديث البيانات:\n' +
        (f.error ? `❌ Finance API: ${f.error}`
                 : `✅ Finance API: processed=${f.processed ?? 0} matched=${f.matched_to_client ?? 0}`) + '\n' +
        step('Membership Excel', out.membership) + '\n' +
        step('المستويات من Drive', out.levels)
      );
    },
    onError: (e) => alert('فشل التحديث الشامل: ' + (e.response?.data?.error || e.message)),
  });

  const data = listQ.data || {};
  const items = data.items || [];
  const totalPages = data.total_pages || 1;
  const coordinators = data.coordinators || [];

  const submitSearch = (e) => { e.preventDefault(); setPage(1); setSearch(q.trim()); };
  const switchTab = (d) => {
    setActiveDept(d); setPage(1); setSearch(''); setQ(''); setStatusFilter('');
    clearColumnFilters();
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" dir="rtl">
      <PageHero
        title="Customer Services Department — تسليمات الأقسام"
        subtitle="كل العملاء وعضوياتهم ومجموعاتهم النشطة والسابقة والمستويات المتبقية"
        icon={GraduationCap}
        color={meta.color}
      />

      {user?.role === 'admin' && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => ingestAll.mutate()}
            disabled={ingestAll.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${ingestAll.isPending ? 'animate-spin' : ''}`} />
            {ingestAll.isPending ? 'جاري تحديث البيانات...' : 'تحديث البيانات (استيراد شامل)'}
          </button>
        </div>
      )}

      {/* Department tabs */}
      <div className="mt-4 flex flex-wrap gap-1 border-b border-slate-200">
        {allowedDepts.map(d => (
          <button
            key={d}
            onClick={() => switchTab(d)}
            className={`px-5 py-2.5 text-sm font-medium rounded-t-lg -mb-px border-b-2 transition-colors ${
              activeDept === d
                ? 'border-violet-600 text-violet-700 bg-violet-50'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {DEPT_META[d]?.label || d}
          </button>
        ))}
      </div>

      <SectionCard title={`عملاء ${meta.label}`} icon={Users} className="mt-4">
        {/* Filters */}
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
          <form onSubmit={submitSearch} className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ابحث بالاسم أو الهاتف..."
                className="pr-8 pl-3 py-2 text-sm border border-slate-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
            </div>
            <button type="submit" className="px-3 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700">
              بحث
            </button>
          </form>

          <select
            value={statusFilter}
            onChange={(e) => { setPage(1); setStatusFilter(e.target.value); }}
            className="py-2 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200"
          >
            <option value="">كل الحالات</option>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          {/* Coordinator */}
          <select
            value={coordinator}
            onChange={(e) => onFilter(setCoordinator)(e.target.value)}
            className="py-2 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200 max-w-[12rem]"
          >
            <option value="">كل المنسقين</option>
            {coordinators.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* First lecture date range */}
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <span className="whitespace-nowrap">أول محاضرة:</span>
            <input type="date" value={firstFrom} onChange={(e) => onFilter(setFirstFrom)(e.target.value)}
              className="py-1.5 px-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" dir="ltr" />
            <span>→</span>
            <input type="date" value={firstTo} onChange={(e) => onFilter(setFirstTo)(e.target.value)}
              className="py-1.5 px-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" dir="ltr" />
          </div>

          {/* Last lecture date range */}
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <span className="whitespace-nowrap">آخر محاضرة:</span>
            <input type="date" value={lastFrom} onChange={(e) => onFilter(setLastFrom)(e.target.value)}
              className="py-1.5 px-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" dir="ltr" />
            <span>→</span>
            <input type="date" value={lastTo} onChange={(e) => onFilter(setLastTo)(e.target.value)}
              className="py-1.5 px-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" dir="ltr" />
          </div>

          {/* Remaining levels range */}
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <span className="whitespace-nowrap">المتبقي:</span>
            <input type="number" min="0" value={remMin} onChange={(e) => onFilter(setRemMin)(e.target.value)} placeholder="من"
              className="w-16 py-1.5 px-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" />
            <span>→</span>
            <input type="number" min="0" value={remMax} onChange={(e) => onFilter(setRemMax)(e.target.value)} placeholder="إلى"
              className="w-16 py-1.5 px-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>

          {(coordinator || firstFrom || firstTo || lastFrom || lastTo || remMin || remMax) && (
            <button onClick={clearColumnFilters} className="px-3 py-2 text-xs rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
              مسح الفلاتر
            </button>
          )}

          <span className="text-xs text-slate-500 mr-auto">
            {listQ.isLoading ? 'جاري التحميل...' : `${data.total || 0} عميل`}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead>
              <tr className="text-slate-500 border-b border-slate-100">
                <th className="px-3 py-3 font-medium">العميل</th>
                <th className="px-3 py-3 font-medium">العضويات</th>
                <th className="px-3 py-3 font-medium">الحالة</th>
                <th className="px-3 py-3 font-medium">المجموعات النشطة</th>
                <th className="px-3 py-3 font-medium">عدد المحاضرات</th>
                <th className="px-3 py-3 font-medium">تاريخ أول/آخر محاضرة</th>
                <th className="px-3 py-3 font-medium">المجموعات المنتهية</th>
                <th className="px-3 py-3 font-medium">المستويات المتبقية</th>
                <th className="px-3 py-3 font-medium">الوقت المتبقي المتوقع</th>
                <th className="px-3 py-3 font-medium">تاريخ انتهاء الرحلة</th>
                <th className="px-3 py-3 font-medium">المنسق</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.phone} className="border-b border-slate-50 hover:bg-slate-50/60 align-top">
                  <td className="px-3 py-3">
                    <div className="font-medium text-slate-800">{it.name || '—'}</div>
                    <div className="text-xs text-slate-400 font-mono" dir="ltr">{it.phone}</div>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center justify-center min-w-7 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold">
                      {it.membership_count}
                    </span>
                    {it.paid_months != null && (
                      <div className="text-[11px] text-slate-400 mt-1">
                        {it.months_list && it.months_list.length > 1
                          ? `${it.months_list.join('+')} = ${it.paid_months} شهر`
                          : `${it.paid_months} شهر`}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <select
                      value={it.status}
                      disabled={setStatusMut.isPending}
                      onChange={(e) => setStatusMut.mutate({ phone: it.phone, status: e.target.value })}
                      className={`text-xs rounded-full border px-2 py-1 focus:outline-none ${STATUS_CLS[it.status] || ''}`}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    {it.active_groups?.length ? (
                      <div className="flex flex-col gap-1">
                        {it.active_groups.map((g, i) => (
                          <span key={i} className="text-xs bg-emerald-50 text-emerald-700 rounded px-1.5 py-0.5 font-mono break-all">{g}</span>
                        ))}
                      </div>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {it.active_groups_meta?.length ? (
                      <div className="flex flex-col gap-1">
                        {it.active_groups_meta.map((m, i) => (
                          <span key={i} className="inline-flex items-center justify-center min-w-7 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">
                            {m.lectures}
                          </span>
                        ))}
                      </div>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    {it.active_groups_meta?.length ? (
                      <div className="flex flex-col gap-1">
                        {it.active_groups_meta.map((m, i) => (
                          (m.start_date || m.end_date) ? (
                            <span key={i} className="text-[11px] font-mono text-slate-600 whitespace-nowrap" dir="ltr">
                              {m.start_date || '—'} → {m.end_date || '—'}
                            </span>
                          ) : <span key={i} className="text-slate-300 text-xs">—</span>
                        ))}
                      </div>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    {it.inactive_groups?.length ? (
                      <div className="flex flex-col gap-1">
                        {it.inactive_groups.map((g, i) => (
                          <span key={i} className="text-xs bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 font-mono break-all">{g}</span>
                        ))}
                      </div>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`inline-flex items-center justify-center min-w-7 px-2 py-0.5 rounded-full text-xs font-semibold ${
                      it.remaining_levels > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {it.remaining_levels == null ? '—' : it.remaining_levels}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center whitespace-nowrap">
                    {it.expected_remaining_label ? (
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs text-slate-700">{it.expected_remaining_label}</span>
                        {it.is_intensive && (
                          <span className="text-[10px] bg-fuchsia-50 text-fuchsia-700 rounded px-1.5 py-0.5">مكثف</span>
                        )}
                      </div>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-center whitespace-nowrap">
                    {it.expected_finish_date ? (
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs font-mono text-slate-700" dir="ltr">{it.expected_finish_date}</span>
                        {it.is_overdue && (
                          <span className="text-[10px] bg-rose-100 text-rose-700 rounded px-1.5 py-0.5 font-semibold">⚠ متأخر</span>
                        )}
                      </div>
                    ) : it.is_overdue ? (
                      <span className="text-[10px] bg-rose-100 text-rose-700 rounded px-1.5 py-0.5 font-semibold">⚠ متأخر</span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-slate-700">{it.coordinator || <span className="text-slate-300">—</span>}</td>
                </tr>
              ))}
              {!listQ.isLoading && items.length === 0 && (
                <tr><td colSpan={11} className="px-3 py-10 text-center text-slate-400">لا يوجد عملاء مطابقون</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-3 flex items-center justify-center gap-2 border-t border-slate-100">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
            >السابق</button>
            <span className="text-sm text-slate-500">صفحة {page} من {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
            >التالي</button>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
