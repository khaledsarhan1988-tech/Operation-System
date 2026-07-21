import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart2, Search, Users, X, PhoneCall, BookOpen } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../auth/AuthContext';
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

// Day chips — values match the backend's English day labels; OR semantics
// (a row matches if ANY selected day is among the group's days).
const DAY_OPTIONS = [
  { value: 'Sat', label: 'سبت'    },
  { value: 'Sun', label: 'أحد'    },
  { value: 'Mon', label: 'اثنين'  },
  { value: 'Tue', label: 'ثلاثاء' },
  { value: 'Wed', label: 'أربعاء' },
  { value: 'Thu', label: 'خميس'   },
  { value: 'Fri', label: 'جمعة'   },
];

// Membership-state chips — same states as تسليمات الأقسام (balance is computed
// by the SAME csDeliveries functions, so تسوية/استبعاد there shows here too).
const BAL_STATE = {
  ok:         { label: 'سارية',            cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  last_level: { label: 'آخر مستوى مدفوع',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  exhausted:  { label: 'العضوية خلصت',     cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  settled:    { label: 'تسوية',            cls: 'bg-violet-50 text-violet-700 border-violet-200' },
};

// Generic modal shell.
function Modal({ title, icon: Icon, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose} dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl mt-10 mb-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2 font-bold text-slate-800 text-sm">
            {Icon ? <Icon className="w-4 h-4 text-violet-600" /> : null}
            {title}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── الطلاب — نفس أرقام تسليمات الأقسام (عضوية/منتهية/متبقي) ────────────────
function ClientsModal({ group, dept, onClose }) {
  const q = useQuery({
    queryKey: ['enr-levels-clients', group.group_name, group.line, dept],
    queryFn: () => api.get('/cs/enr-groups/levels-overview/clients', {
      params: { group: group.group_name, line: group.line || '', dept },
    }).then(r => r.data),
  });
  const items = q.data?.items || [];
  return (
    <Modal title={`طلاب المجموعة — ${group.group_name}`} icon={Users} onClose={onClose}>
      <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-50">
        الأرقام محسوبة بنفس حساب «تسليمات الأقسام» — أي تسوية أو استبعاد هناك ينعكس هنا تلقائيًا
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-right">
          <thead>
            <tr className="text-slate-500 border-b border-slate-100">
              <th className="px-3 py-2.5 font-medium">الاسم</th>
              <th className="px-3 py-2.5 font-medium">الموبايل</th>
              <th className="px-3 py-2.5 font-medium">العضوية (شهور)</th>
              <th className="px-3 py-2.5 font-medium">المستهلك</th>
              <th className="px-3 py-2.5 font-medium">المتبقي</th>
              <th className="px-3 py-2.5 font-medium">الحالة</th>
              <th className="px-3 py-2.5 font-medium">المجموعات المنتهية</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">جاري التحميل...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">لا يوجد طلاب مسجّلون</td></tr>
            ) : items.map((c, i) => {
              const st = BAL_STATE[c.state];
              return (
                <tr key={`${c.phone || c.name}|${i}`} className="border-b border-slate-50 hover:bg-slate-50/60 align-top">
                  <td className="px-3 py-2.5 text-slate-800">{c.name || '—'}</td>
                  <td className="px-3 py-2.5" dir="ltr">{c.phone || '—'}</td>
                  <td className="px-3 py-2.5">{c.paid_months ?? '—'}</td>
                  <td className="px-3 py-2.5">{c.groups_taken ?? '—'}</td>
                  <td className="px-3 py-2.5 font-semibold">{c.remaining ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    {st ? <span className={`inline-block px-2 py-0.5 rounded-lg border text-xs ${st.cls}`}>{st.label}</span> : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {(c.inactive_groups || []).length === 0 ? <span className="text-slate-400">—</span> : (
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {c.inactive_groups.map((g, j) => (
                          <span key={j} className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]" dir="ltr">{g}</span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// ─── محاضرات المجموعة — أساسية + فون كول ────────────────────────────────────
function LecturesModal({ group, onClose }) {
  const q = useQuery({
    queryKey: ['enr-levels-lectures', group.group_name, group.line],
    queryFn: () => api.get('/cs/enr-groups/levels-overview/lectures', {
      params: { group: group.group_name, line: group.line || '' },
    }).then(r => r.data),
  });
  const d = q.data || {};
  const Table = ({ rows }) => (
    <table className="w-full text-sm text-right">
      <thead>
        <tr className="text-slate-500 border-b border-slate-100">
          <th className="px-3 py-2 font-medium">التاريخ</th>
          <th className="px-3 py-2 font-medium">الوقت</th>
          <th className="px-3 py-2 font-medium">المدة</th>
          <th className="px-3 py-2 font-medium">المدرب</th>
          <th className="px-3 py-2 font-medium">الحالة</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">لا توجد جلسات</td></tr>
        ) : rows.map((l, i) => (
          <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60">
            <td className="px-3 py-2 whitespace-nowrap" dir="ltr">{l.date || '—'}</td>
            <td className="px-3 py-2 whitespace-nowrap" dir="ltr">{l.time || '—'}</td>
            <td className="px-3 py-2 whitespace-nowrap" dir="ltr">{l.duration || '—'}</td>
            <td className="px-3 py-2" dir="ltr">{l.trainer || '—'}</td>
            <td className="px-3 py-2 text-xs">{l.status || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <Modal title={`جلسات المجموعة — ${group.group_name}`} icon={BookOpen} onClose={onClose}>
      {q.isLoading ? (
        <div className="px-3 py-10 text-center text-slate-400">جاري التحميل...</div>
      ) : (
        <div className="p-3 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1 text-sm font-bold text-slate-700">
              <BookOpen className="w-4 h-4 text-indigo-500" />
              محاضرات أساسية ({d.main_count ?? 0})
            </div>
            <div className="overflow-x-auto border border-slate-100 rounded-xl"><Table rows={d.main || []} /></div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1 text-sm font-bold text-slate-700">
              <PhoneCall className="w-4 h-4 text-rose-500" />
              فون كول ({d.side_count ?? 0})
            </div>
            <div className="overflow-x-auto border border-slate-100 rounded-xl"><Table rows={d.side || []} /></div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function EnrLevels() {
  const [activeDept, setActiveDept] = useState('General');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [firstFrom, setFirstFrom] = useState('');
  const [firstTo, setFirstTo] = useState('');
  const [lastFrom, setLastFrom] = useState('');
  const [lastTo, setLastTo] = useState('');
  const [selDays, setSelDays] = useState([]);          // OR-matched day values
  const [levelFilter, setLevelFilter] = useState('');
  const [page, setPage] = useState(1);
  const [clientsFor, setClientsFor] = useState(null);   // row → students modal
  const [lecturesFor, setLecturesFor] = useState(null); // row → lectures modal

  const { user } = useAuth();
  // «تفاصيل المدربين» lives on /admin/reports/* for admins and on the neutral
  // granted path /reports/* for everyone else (requirePage guards it there).
  const trainerDetailsPath = user?.role === 'admin' ? '/admin/reports/trainer-details' : '/reports/trainer-details';

  const meta = DEPT_META[activeDept] || { label: activeDept, color: 'violet' };

  const listQ = useQuery({
    queryKey: ['enr-levels', activeDept, search, statusFilter, firstFrom, firstTo, lastFrom, lastTo, selDays.join(','), levelFilter, page],
    queryFn: () => api.get('/cs/enr-groups/levels-overview', {
      params: {
        dept: activeDept, q: search, status: statusFilter, page, page_size: 50,
        first_from: firstFrom, first_to: firstTo,
        last_from: lastFrom, last_to: lastTo,
        days: selDays.join(','), level: levelFilter,
      },
    }).then(r => r.data),
    keepPreviousData: true,
  });

  const data = listQ.data || {};
  const items = data.items || [];
  const levels = data.levels || [];
  const levelCounts = data.level_counts || {};
  const totalPages = data.total_pages || 1;

  const submitSearch = (e) => { e.preventDefault(); setPage(1); setSearch(q.trim()); };
  const toggleDay = (d) => {
    setPage(1);
    setSelDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  };
  const clearFilters = () => {
    setPage(1);
    setFirstFrom(''); setFirstTo(''); setLastFrom(''); setLastTo('');
    setSelDays([]); setLevelFilter(''); setStatusFilter(''); setQ(''); setSearch('');
  };
  const hasFilters = firstFrom || firstTo || lastFrom || lastTo || selDays.length || levelFilter || statusFilter || search;
  const switchTab = (d) => { setActiveDept(d); clearFilters(); };

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
        {/* Level chips — click a level to show only its groups (owner 2026-07-21) */}
        <div className="p-3 flex flex-wrap items-center gap-1.5 border-b border-slate-100">
          <button
            type="button"
            onClick={() => { setPage(1); setLevelFilter(''); }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
              !levelFilter
                ? 'bg-violet-600 text-white border-violet-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'
            }`}
          >
            الكل
          </button>
          {levels.map(l => (
            <button
              key={l}
              type="button"
              onClick={() => { setPage(1); setLevelFilter(levelFilter === l ? '' : l); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                levelFilter === l
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:border-indigo-300'
              }`}
              dir="ltr"
            >
              {l}{levelCounts[l] != null ? ` (${levelCounts[l]})` : ''}
            </button>
          ))}
        </div>

        {/* Filters — row 1: search + status */}
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

        {/* Filters — row 2: date ranges + days + clear */}
        <div className="p-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100">
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <span className="whitespace-nowrap">تاريخ البداية:</span>
            <input type="date" value={firstFrom} onChange={(e) => { setPage(1); setFirstFrom(e.target.value); }}
              className="py-1.5 px-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" dir="ltr" />
            <span>→</span>
            <input type="date" value={firstTo} onChange={(e) => { setPage(1); setFirstTo(e.target.value); }}
              className="py-1.5 px-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" dir="ltr" />
          </div>
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <span className="whitespace-nowrap">تاريخ النهاية:</span>
            <input type="date" value={lastFrom} onChange={(e) => { setPage(1); setLastFrom(e.target.value); }}
              className="py-1.5 px-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" dir="ltr" />
            <span>→</span>
            <input type="date" value={lastTo} onChange={(e) => { setPage(1); setLastTo(e.target.value); }}
              className="py-1.5 px-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" dir="ltr" />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500 whitespace-nowrap">الأيام:</span>
            {DAY_OPTIONS.map(d => (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  selDays.includes(d.value)
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          {hasFilters ? (
            <button type="button" onClick={clearFilters}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
              مسح الفلاتر
            </button>
          ) : null}
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
                      <button type="button" onClick={() => setLecturesFor(it)}
                        className="text-slate-800 font-medium hover:text-violet-700 hover:underline text-right" dir="ltr"
                        title="عرض محاضرات المجموعة (أساسية + فون كول)">
                        {it.group_name}
                      </button>
                      {it.line ? <div className="text-[11px] text-slate-400" dir="ltr">{it.line}</div> : null}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap" dir="ltr">{it.day || '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap" dir="ltr">{it.start_date || '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap" dir="ltr">{it.end_date || '—'}</td>
                    <td className="px-3 py-3">
                      {it.trainer
                        ? <Link to={`${trainerDetailsPath}?trainer=${encodeURIComponent(it.trainer)}`}
                            className="text-violet-700 hover:underline" dir="ltr"
                            title="فتح تفاصيل المدرب">
                            {it.trainer}
                          </Link>
                        : <span className="text-rose-600 text-xs font-medium">لا يوجد مدرب</span>}
                    </td>
                    <td className="px-3 py-3">
                      <button type="button" onClick={() => setClientsFor(it)}
                        className="inline-flex items-center gap-1 text-slate-700 hover:text-violet-700 hover:underline"
                        title="عرض طلاب المجموعة (عضوية / منتهية / متبقي)">
                        <Users className="w-3.5 h-3.5 text-slate-400" /> {it.student_count}
                      </button>
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

      {clientsFor ? <ClientsModal group={clientsFor} dept={activeDept} onClose={() => setClientsFor(null)} /> : null}
      {lecturesFor ? <LecturesModal group={lecturesFor} onClose={() => setLecturesFor(null)} /> : null}
    </div>
  );
}
