import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Search, Users } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';

/**
 * Department Deliveries (تسليمات الأقسام).
 *
 * URL: /subscriptions/deliveries/:dept   (dept = General | Private | Semi)
 * Roles: admin, leader, agent (coordinator) — backend scopes the data.
 *
 * One row per client showing: memberships count, manual status,
 * active groups, inactive (past) groups, remaining levels, coordinator.
 */

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
  const { dept } = useParams();
  const qc = useQueryClient();
  const meta = DEPT_META[dept] || { label: dept, color: 'violet' };

  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const listQ = useQuery({
    queryKey: ['cs-deliveries', dept, search, statusFilter, page],
    queryFn: () => api.get('/cs/deliveries', {
      params: { dept, q: search, status: statusFilter, page, page_size: 25 },
    }).then(r => r.data),
    keepPreviousData: true,
  });

  const setStatusMut = useMutation({
    mutationFn: ({ phone, status }) =>
      api.patch(`/cs/deliveries/${encodeURIComponent(phone)}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cs-deliveries', dept] }),
    onError: (e) => alert('فشل تحديث الحالة: ' + (e.response?.data?.error || e.message)),
  });

  const data = listQ.data || {};
  const items = data.items || [];
  const totalPages = data.total_pages || 1;

  const submitSearch = (e) => { e.preventDefault(); setPage(1); setSearch(q.trim()); };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" dir="rtl">
      <PageHero
        title={`تسليمات قسم ${meta.label}`}
        subtitle="كل العملاء وعضوياتهم ومجموعاتهم النشطة والسابقة والمستويات المتبقية"
        icon={GraduationCap}
        color={meta.color}
      />

      <SectionCard title="العملاء" icon={Users} className="mt-4">
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
                <th className="px-3 py-3 font-medium">المجموعات غير النشطة</th>
                <th className="px-3 py-3 font-medium">المستويات المتبقية</th>
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
                      <div className="text-[11px] text-slate-400 mt-1">{it.paid_months} شهر</div>
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
                  <td className="px-3 py-3 text-slate-700">{it.coordinator || <span className="text-slate-300">—</span>}</td>
                </tr>
              ))}
              {!listQ.isLoading && items.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">لا يوجد عملاء مطابقون</td></tr>
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
