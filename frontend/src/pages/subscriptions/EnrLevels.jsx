import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart2, Search, Users } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';

/**
 * المستويات الشغّالة — level-oriented view of the Enr Groups population: for
 * every active/waiting group in a department, its level + code + day + first/
 * last lecture date + trainer + student count, sorted by the level ladder
 * (Starter → General → Conversation). Read-only.
 *
 * URL: /subscriptions/enr-levels  (same access as Enr Groups)
 */

const ALL_DEPTS = ['General', 'Semi', 'Private'];

const DEPT_META = {
  General: { label: 'جينرال',      color: 'cyan'    },
  Semi:    { label: 'سيمي برايفت', color: 'emerald' },
  Private: { label: 'برايفت',      color: 'violet'  },
};

const STATUS_OPTIONS = [
  { value: 'started',          label: 'نشطة',                    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'waiting_lectures', label: 'بانتظار تسجيل المحاضرات', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'waiting_trainees', label: 'بانتظار تسجيل المتدربين', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
];
const STATUS_META = Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s]));

export default function EnrLevels() {
  const [activeDept, setActiveDept] = useState('General');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const meta = DEPT_META[activeDept] || { label: activeDept, color: 'violet' };

  const listQ = useQuery({
    queryKey: ['enr-levels', activeDept, search, statusFilter, page],
    queryFn: () => api.get('/cs/enr-groups/levels-overview', {
      params: { dept: activeDept, q: search, status: statusFilter, page, page_size: 50 },
    }).then(r => r.data),
    keepPreviousData: true,
  });

  const data = listQ.data || {};
  const items = data.items || [];
  const totalPages = data.total_pages || 1;

  const submitSearch = (e) => { e.preventDefault(); setPage(1); setSearch(q.trim()); };
  const switchTab = (d) => { setActiveDept(d); setPage(1); setSearch(''); setQ(''); setStatusFilter(''); };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" dir="rtl">
      <PageHero
        title="المستويات الشغّالة"
        subtitle="كل المستويات الشغّالة في القسم — نشطة أو بانتظار المحاضرات/المتدربين — مرتّبة حسب المستوى"
        icon={BarChart2}
        color={meta.color}
      />

      {/* Department tabs */}
      <div className="mt-4 flex flex-wrap gap-1 border-b border-slate-200">
        {ALL_DEPTS.map(d => (
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

      <SectionCard title={`مستويات ${meta.label}`} icon={Users} className="mt-4">
        {/* Filters */}
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
          <form onSubmit={submitSearch} className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ابحث بكود المجموعة أو المدرب..."
                className="pr-8 pl-3 py-2 text-sm border border-slate-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
            </div>
            <button type="submit" className="px-3 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700">بحث</button>
          </form>
          <select
            value={statusFilter}
            onChange={(e) => { setPage(1); setStatusFilter(e.target.value); }}
            className="py-2 px-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200"
          >
            <option value="">كل الحالات</option>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <span className="text-xs text-slate-500 mr-auto">
            {listQ.isLoading ? 'جاري التحميل...' : `${data.total || 0} مجموعة`}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead>
              <tr className="text-slate-500 border-b border-slate-100">
                <th className="px-3 py-3 font-medium">المستوى</th>
                <th className="px-3 py-3 font-medium">كود المجموعة</th>
                <th className="px-3 py-3 font-medium">اليوم</th>
                <th className="px-3 py-3 font-medium">تاريخ البداية</th>
                <th className="px-3 py-3 font-medium">تاريخ النهاية</th>
                <th className="px-3 py-3 font-medium">المدرب</th>
                <th className="px-3 py-3 font-medium">عدد الطلاب</th>
                <th className="px-3 py-3 font-medium">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {listQ.isLoading ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">جاري التحميل...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">لا توجد مجموعات</td></tr>
              ) : items.map((it, i) => {
                const st = STATUS_META[it.status];
                return (
                  <tr key={`${it.group_name}|${it.line}|${i}`} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-3 py-3">
                      {it.level
                        ? <span className="inline-block px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold" dir="ltr">{it.level}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-slate-800 font-medium" dir="ltr">{it.group_name}</div>
                      {it.line ? <div className="text-[11px] text-slate-400" dir="ltr">{it.line}</div> : null}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap" dir="ltr">{it.day || '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap" dir="ltr">{it.start_date || '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap" dir="ltr">{it.end_date || '—'}</td>
                    <td className="px-3 py-3">
                      {it.trainer
                        ? <span dir="ltr">{it.trainer}</span>
                        : <span className="text-rose-600 text-xs font-medium">لا يوجد مدرب</span>}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1 text-slate-700">
                        <Users className="w-3.5 h-3.5 text-slate-400" /> {it.student_count}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {st
                        ? <span className={`inline-block px-2 py-0.5 rounded-lg border text-xs ${st.cls}`}>{st.label}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                );
              })}
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
