import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap, Search, Users } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';

/**
 * Enr Groups (مجموعات الـ Enrollment) — group-oriented view, one tab per
 * department (جينرال / سيمي برايفت / برايفت). Each row is an ACTIVE group that
 * has STARTED (≥1 registered main lecture); it lists the clients inside it and
 * the group's start/end dates (first/last lecture date). Admin only.
 *
 * URL: /subscriptions/enr-groups
 */

const ALL_DEPTS = ['General', 'Semi', 'Private'];

const DEPT_META = {
  General: { label: 'جينرال',      color: 'cyan'    },
  Semi:    { label: 'سيمي برايفت', color: 'emerald' },
  Private: { label: 'برايفت',      color: 'violet'  },
};

export default function EnrGroups() {
  const [activeDept, setActiveDept] = useState('General');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [firstFrom, setFirstFrom] = useState('');
  const [firstTo, setFirstTo] = useState('');
  const [lastFrom, setLastFrom] = useState('');
  const [lastTo, setLastTo] = useState('');
  const [page, setPage] = useState(1);

  const meta = DEPT_META[activeDept] || { label: activeDept, color: 'violet' };

  // Any filter change resets to page 1.
  const onFilter = (setter) => (val) => { setPage(1); setter(val); };
  const clearDateFilters = () => {
    setPage(1);
    setFirstFrom(''); setFirstTo(''); setLastFrom(''); setLastTo('');
  };

  const listQ = useQuery({
    queryKey: ['enr-groups', activeDept, search, firstFrom, firstTo, lastFrom, lastTo, page],
    queryFn: () => api.get('/cs/enr-groups', {
      params: {
        dept: activeDept, q: search, page, page_size: 25,
        first_from: firstFrom, first_to: firstTo,
        last_from: lastFrom, last_to: lastTo,
      },
    }).then(r => r.data),
    keepPreviousData: true,
  });

  const data = listQ.data || {};
  const items = data.items || [];
  const totalPages = data.total_pages || 1;

  const submitSearch = (e) => { e.preventDefault(); setPage(1); setSearch(q.trim()); };
  const switchTab = (d) => {
    setActiveDept(d); setPage(1); setSearch(''); setQ(''); clearDateFilters();
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" dir="rtl">
      <PageHero
        title="Enr Groups — مجموعات الـ Enrollment"
        subtitle="كل المجموعات النشطة التي بدأت، والعملاء بداخلها وتاريخ أول وآخر محاضرة"
        icon={GraduationCap}
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

      <SectionCard title={`مجموعات ${meta.label}`} icon={Users} className="mt-4">
        {/* Filters */}
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
          <form onSubmit={submitSearch} className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ابحث بكود المجموعة أو المنسق..."
                className="pr-8 pl-3 py-2 text-sm border border-slate-200 rounded-lg w-72 focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
            </div>
            <button type="submit" className="px-3 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700">
              بحث
            </button>
          </form>

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

          {(firstFrom || firstTo || lastFrom || lastTo) && (
            <button onClick={clearDateFilters} className="px-3 py-2 text-xs rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
              مسح الفلاتر
            </button>
          )}

          <span className="text-xs text-slate-500 mr-auto">
            {listQ.isLoading ? 'جاري التحميل...' : `${data.total || 0} مجموعة`}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead>
              <tr className="text-slate-500 border-b border-slate-100">
                <th className="px-3 py-3 font-medium">المجموعة</th>
                <th className="px-3 py-3 font-medium">المنسق</th>
                <th className="px-3 py-3 font-medium">الطلاب</th>
                <th className="px-3 py-3 font-medium">عدد الطلاب</th>
                <th className="px-3 py-3 font-medium">تاريخ البداية</th>
                <th className="px-3 py-3 font-medium">تاريخ النهاية</th>
                <th className="px-3 py-3 font-medium">عدد المحاضرات</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={`${it.group_name}|${it.line}|${idx}`} className="border-b border-slate-50 hover:bg-slate-50/60 align-top">
                  <td className="px-3 py-3">
                    <div className="font-mono text-xs text-slate-800 break-all">{it.group_name}</div>
                    {it.line && (
                      <span className="inline-block mt-1 text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{it.line}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-700">{it.coordinator || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3">
                    {it.students?.length ? (
                      <div className="flex flex-col gap-1 max-w-xs">
                        {it.students.map((s, i) => (
                          <div key={i} className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-slate-700 truncate">{s.name || '—'}</span>
                            <span className="text-slate-400 font-mono whitespace-nowrap" dir="ltr">{s.phone || ''}</span>
                          </div>
                        ))}
                      </div>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="inline-flex items-center justify-center min-w-7 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold">
                      {it.student_count}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center whitespace-nowrap">
                    {it.start_date
                      ? <span className="text-xs font-mono text-slate-700" dir="ltr">{it.start_date}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-center whitespace-nowrap">
                    {it.end_date
                      ? <span className="text-xs font-mono text-slate-700" dir="ltr">{it.end_date}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="inline-flex items-center justify-center min-w-7 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">
                      {it.lectures}
                    </span>
                  </td>
                </tr>
              ))}
              {!listQ.isLoading && items.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">لا توجد مجموعات مطابقة</td></tr>
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
