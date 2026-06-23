import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap, Search, Users, ListChecks, History, Archive, AlertTriangle } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import EnrTransitionModal from './EnrTransitionModal';

/**
 * Enr Groups (مجموعات الـ Enrollment) — group-oriented view, one tab per
 * department (جينرال / سيمي برايفت / برايفت). Each row is an ACTIVE group with a
 * STATUS (started / waiting lectures / waiting trainees); clicking a row opens
 * the transition screen (move clients to a next group + record dispositions).
 * A second top tab shows the disposition lists. Admin only.
 *
 * URL: /subscriptions/enr-groups
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

// Membership level-balance styling (same states as the transition modal).
const BAL_DOT = {
  ok:         'bg-emerald-100 text-emerald-700',
  last_level: 'bg-amber-100 text-amber-700',
  exhausted:  'bg-rose-100 text-rose-700',
};
const RENEW_STATE = {
  exhausted:  { label: 'العضوية خلصت',    cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  last_level: { label: 'آخر مستوى مدفوع', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};

const DISP_TABS = [
  { value: 'postponed',    label: 'التأجيلات',     cls: 'border-amber-500 text-amber-700 bg-amber-50' },
  { value: 'no_answer',    label: 'عدم الرد',      cls: 'border-purple-500 text-purple-700 bg-purple-50' },
  { value: 'unsuccessful', label: 'غير الناجحين',  cls: 'border-rose-500 text-rose-700 bg-rose-50' },
];
const METHOD_LABEL = { call: 'مكالمة', whatsapp: 'واتساب', visit: 'زيارة' };

const ACTION_OPTIONS = [
  { value: 'move_in',             label: 'نقل إلى مجموعة' },
  { value: 'move_out',           label: 'إزالة من مجموعة' },
  { value: 'disposition_set',    label: 'تحديد مصير' },
  { value: 'disposition_cleared',label: 'مسح مصير' },
  { value: 'entry_added',        label: 'إضافة ملاحظة/متابعة' },
  { value: 'entry_removed',      label: 'حذف ملاحظة' },
];
const ACTION_LABEL = Object.fromEntries(ACTION_OPTIONS.map(a => [a.value, a.label]));
const fmtDT = (s) => s ? String(s).replace('T', ' ').slice(0, 16) : '';

// ─── Disposition lists view (التأجيلات / عدم الرد / غير الناجحين) ──────────────
function DispositionsView() {
  const [type, setType] = useState('postponed');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const listQ = useQuery({
    queryKey: ['enr-dispositions', type, search, from, to, page],
    queryFn: () => api.get('/cs/enr-groups/dispositions', {
      params: { type, q: search, from, to, page, page_size: 25 },
    }).then(r => r.data),
    keepPreviousData: true,
  });
  const data = listQ.data || {};
  const items = data.items || [];
  const totalPages = data.total_pages || 1;
  const isPostponed = type === 'postponed';

  const switchType = (t) => { setType(t); setPage(1); setQ(''); setSearch(''); setFrom(''); setTo(''); };

  return (
    <SectionCard title="قوائم المتابعة" icon={ListChecks} className="mt-4">
      {/* disposition sub-tabs */}
      <div className="px-3 pt-3 flex flex-wrap gap-1 border-b border-slate-100">
        {DISP_TABS.map(t => (
          <button key={t.value} onClick={() => switchType(t.value)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 transition-colors ${
              type === t.value ? t.cls : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* filters */}
      <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(q.trim()); }} className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم/موبايل/مجموعة..."
              className="pr-8 pl-3 py-2 text-sm border border-slate-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>
          <button type="submit" className="px-3 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700">بحث</button>
        </form>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span className="whitespace-nowrap">{isPostponed ? 'تاريخ المتابعة:' : 'التاريخ:'}</span>
          <input type="date" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value); }}
            className="py-1.5 px-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" dir="ltr" />
          <span>→</span>
          <input type="date" value={to} onChange={(e) => { setPage(1); setTo(e.target.value); }}
            className="py-1.5 px-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" dir="ltr" />
        </div>
        <span className="text-xs text-slate-500 mr-auto">
          {listQ.isLoading ? 'جاري التحميل...' : `${data.total || 0} عميل`}
        </span>
      </div>

      {/* table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-right">
          <thead>
            <tr className="text-slate-500 border-b border-slate-100">
              <th className="px-3 py-3 font-medium">العميل</th>
              <th className="px-3 py-3 font-medium">المجموعة</th>
              <th className="px-3 py-3 font-medium">القسم</th>
              {isPostponed && <th className="px-3 py-3 font-medium">آخر متابعة</th>}
              <th className="px-3 py-3 font-medium">العدد</th>
              <th className="px-3 py-3 font-medium">آخر ملاحظة</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-slate-50 hover:bg-slate-50/60 align-top">
                <td className="px-3 py-3">
                  <div className="text-slate-800">{it.client_name || '—'}</div>
                  <div className="text-xs text-slate-400 font-mono" dir="ltr">{it.client_phone || ''}</div>
                </td>
                <td className="px-3 py-3 font-mono text-xs text-slate-600 break-all max-w-xs">{it.source_group_name || '—'}</td>
                <td className="px-3 py-3 text-slate-600">{DEPT_META[it.dept]?.label || it.dept || '—'}</td>
                {isPostponed && (
                  <td className="px-3 py-3 whitespace-nowrap font-mono text-xs text-slate-700" dir="ltr">
                    {it.last_entry?.followup_date
                      ? `${it.last_entry.followup_date}${it.last_entry.followup_time ? ' ' + it.last_entry.followup_time : ''}${it.last_entry.followup_method ? ' · ' + (METHOD_LABEL[it.last_entry.followup_method] || '') : ''}`
                      : '—'}
                  </td>
                )}
                <td className="px-3 py-3 text-center">
                  <span className="inline-flex items-center justify-center min-w-7 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">{it.entries_count || 0}</span>
                </td>
                <td className="px-3 py-3 text-slate-600 max-w-xs break-words">{it.last_entry?.note || <span className="text-slate-300">—</span>}</td>
              </tr>
            ))}
            {!listQ.isLoading && items.length === 0 && (
              <tr><td colSpan={isPostponed ? 6 : 5} className="px-3 py-10 text-center text-slate-400">لا يوجد عملاء في هذه القائمة</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="p-3 flex items-center justify-center gap-2 border-t border-slate-100">
          <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">السابق</button>
          <span className="text-sm text-slate-500">صفحة {page} من {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">التالي</button>
        </div>
      )}
    </SectionCard>
  );
}

// ─── Activity log view (السجل) ───────────────────────────────────────────────
function ActivityLogView() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [actor, setActor] = useState('');
  const [actorSearch, setActorSearch] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const listQ = useQuery({
    queryKey: ['enr-activity-all', search, actorSearch, action, from, to, page],
    queryFn: () => api.get('/cs/enr-groups/activity', {
      params: { q: search, actor: actorSearch, action, from, to, page, page_size: 30 },
    }).then(r => r.data),
    keepPreviousData: true,
  });
  const data = listQ.data || {};
  const items = data.items || [];
  const totalPages = data.total_pages || 1;

  return (
    <SectionCard title="سجل الحركات" icon={History} className="mt-4">
      <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(q.trim()); setActorSearch(actor.trim()); }} className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="عميل / موبايل / مجموعة..."
              className="pr-8 pl-3 py-2 text-sm border border-slate-200 rounded-lg w-56 focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>
          <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="الموظف"
            className="py-2 px-3 text-sm border border-slate-200 rounded-lg w-40 focus:outline-none focus:ring-2 focus:ring-violet-200" />
          <button type="submit" className="px-3 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700">بحث</button>
        </form>
        <select value={action} onChange={(e) => { setPage(1); setAction(e.target.value); }}
          className="py-2 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200">
          <option value="">كل الحركات</option>
          {ACTION_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span>التاريخ:</span>
          <input type="date" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value); }}
            className="py-1.5 px-2 border border-slate-200 rounded-lg" dir="ltr" />
          <span>→</span>
          <input type="date" value={to} onChange={(e) => { setPage(1); setTo(e.target.value); }}
            className="py-1.5 px-2 border border-slate-200 rounded-lg" dir="ltr" />
        </div>
        <span className="text-xs text-slate-500 mr-auto">{listQ.isLoading ? 'جاري التحميل...' : `${data.total || 0} حركة`}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-right">
          <thead>
            <tr className="text-slate-500 border-b border-slate-100">
              <th className="px-3 py-3 font-medium">الحركة</th>
              <th className="px-3 py-3 font-medium">العميل</th>
              <th className="px-3 py-3 font-medium">المجموعة</th>
              <th className="px-3 py-3 font-medium">التفاصيل</th>
              <th className="px-3 py-3 font-medium">الموظف</th>
              <th className="px-3 py-3 font-medium">الوقت</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-slate-50 hover:bg-slate-50/60 align-top">
                <td className="px-3 py-3 whitespace-nowrap text-slate-700">{ACTION_LABEL[it.action] || it.action}</td>
                <td className="px-3 py-3">
                  <div className="text-slate-800">{it.client_name || '—'}</div>
                  <div className="text-xs text-slate-400 font-mono" dir="ltr">{it.client_phone || ''}</div>
                </td>
                <td className="px-3 py-3 font-mono text-xs text-slate-600 break-all max-w-xs">
                  {it.source_group_name || '—'}{it.next_group_name ? ` → ${it.next_group_name}` : ''}
                </td>
                <td className="px-3 py-3 text-slate-600 max-w-xs break-words">{it.detail || <span className="text-slate-300">—</span>}</td>
                <td className="px-3 py-3 text-violet-700">{it.actor_name || '—'}</td>
                <td className="px-3 py-3 whitespace-nowrap font-mono text-xs text-slate-500" dir="ltr">{fmtDT(it.created_at)}</td>
              </tr>
            ))}
            {!listQ.isLoading && items.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">لا توجد حركات</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="p-3 flex items-center justify-center gap-2 border-t border-slate-100">
          <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">السابق</button>
          <span className="text-sm text-slate-500">صفحة {page} من {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">التالي</button>
        </div>
      )}
    </SectionCard>
  );
}

// ─── Ended/historical groups view (منتهية) ──────────────────────────────────
function EndedGroupsView({ onOpen }) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const listQ = useQuery({
    queryKey: ['enr-ended', search],
    queryFn: () => api.get('/cs/enr-groups/ended', { params: { q: search } }).then(r => r.data),
    keepPreviousData: true,
  });
  const items = listQ.data?.items || [];

  return (
    <SectionCard title="المجموعات المنتهية" icon={Archive} className="mt-4">
      <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
        <form onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }} className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم المجموعة..."
              className="pr-8 pl-3 py-2 text-sm border border-slate-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>
          <button type="submit" className="px-3 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700">بحث</button>
        </form>
        <span className="text-xs text-slate-500 mr-auto">
          {listQ.isLoading ? 'جاري التحميل...' : `${listQ.data?.count || 0} مجموعة`}
        </span>
      </div>
      <div className="px-3 pt-2 text-xs text-slate-400">مجموعات خرجت من القوائم النشطة لكن عليها نقل/مصائر — اضغط لفتح شاشتها.</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-right">
          <thead>
            <tr className="text-slate-500 border-b border-slate-100">
              <th className="px-3 py-3 font-medium">المجموعة</th>
              <th className="px-3 py-3 font-medium">القسم</th>
              <th className="px-3 py-3 font-medium">المنقولين</th>
              <th className="px-3 py-3 font-medium">المصائر</th>
              <th className="px-3 py-3 font-medium">آخر نشاط</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={`${it.group_name}|${it.line}|${idx}`} onClick={() => onOpen(it)}
                className="border-b border-slate-50 hover:bg-violet-50/50 cursor-pointer align-top">
                <td className="px-3 py-3">
                  <div className="font-mono text-xs text-slate-800 break-all">{it.group_name}</div>
                  {it.line && <span className="inline-block mt-1 text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{it.line}</span>}
                </td>
                <td className="px-3 py-3 text-slate-600">{DEPT_META[it.dept_type]?.label || it.dept_type || '—'}</td>
                <td className="px-3 py-3 text-center">
                  <span className="inline-flex items-center justify-center min-w-7 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold">{it.moved_count}</span>
                </td>
                <td className="px-3 py-3 text-center">
                  <span className="inline-flex items-center justify-center min-w-7 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">{it.disposition_count}</span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap font-mono text-xs text-slate-500" dir="ltr">{fmtDT(it.last_activity)}</td>
              </tr>
            ))}
            {!listQ.isLoading && items.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-400">لا توجد مجموعات منتهية عليها نشاط</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

// ─── Renewals view (محتاج تجديد) — clients whose membership remaining ≤ 1 ──────
function RenewalsView() {
  const [dept, setDept] = useState('');
  const listQ = useQuery({
    queryKey: ['enr-renewals', dept],
    queryFn: () => api.get('/cs/enr-groups/renewals', { params: { dept } }).then(r => r.data),
    keepPreviousData: true,
  });
  const items = listQ.data?.items || [];

  return (
    <SectionCard title="محتاج تجديد" icon={AlertTriangle} className="mt-4">
      <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
        <select value={dept} onChange={(e) => setDept(e.target.value)}
          className="py-2 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200">
          <option value="">كل الأقسام</option>
          {ALL_DEPTS.map(d => <option key={d} value={d}>{DEPT_META[d]?.label || d}</option>)}
        </select>
        <span className="text-xs text-slate-400">العملاء اللي متبقّي في عضويتهم مستوى واحد أو أقل — للتجديد الاستباقي.</span>
        <span className="text-xs text-slate-500 mr-auto">{listQ.isLoading ? 'جاري التحميل...' : `${listQ.data?.count || 0} عميل`}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-right">
          <thead>
            <tr className="text-slate-500 border-b border-slate-100">
              <th className="px-3 py-3 font-medium">العميل</th>
              <th className="px-3 py-3 font-medium">القسم</th>
              <th className="px-3 py-3 font-medium">المجموعة الحالية</th>
              <th className="px-3 py-3 font-medium">المنسق</th>
              <th className="px-3 py-3 font-medium">الحالة</th>
              <th className="px-3 py-3 font-medium">المتبقّي</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={`${it.phone || i}|${it.dept}`} className="border-b border-slate-50 hover:bg-slate-50/60 align-top">
                <td className="px-3 py-3">
                  <div className="text-slate-800">{it.name || '—'}</div>
                  <div className="text-xs text-slate-400 font-mono" dir="ltr">{it.phone || ''}</div>
                </td>
                <td className="px-3 py-3 text-slate-600">{DEPT_META[it.dept]?.label || it.dept || '—'}</td>
                <td className="px-3 py-3 font-mono text-xs text-slate-600 break-all max-w-xs">{it.group_name || '—'}</td>
                <td className="px-3 py-3 text-slate-700">{it.coordinator || <span className="text-slate-300">—</span>}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className={`inline-block text-[11px] rounded-full border px-2 py-0.5 ${RENEW_STATE[it.state]?.cls || ''}`}>
                    {RENEW_STATE[it.state]?.label || it.state}
                  </span>
                </td>
                <td className="px-3 py-3 text-center">
                  <span className={`inline-flex items-center justify-center min-w-7 px-2 py-0.5 rounded-full text-xs font-semibold ${BAL_DOT[it.state] || 'bg-slate-100 text-slate-600'}`}>
                    {it.remaining}
                  </span>
                </td>
              </tr>
            ))}
            {!listQ.isLoading && items.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">لا يوجد عملاء محتاجين تجديد</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

export default function EnrGroups() {
  const [view, setView] = useState('groups');         // 'groups' | 'lists' | 'log' | 'ended'
  const [activeDept, setActiveDept] = useState('General');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [firstFrom, setFirstFrom] = useState('');
  const [firstTo, setFirstTo] = useState('');
  const [lastFrom, setLastFrom] = useState('');
  const [lastTo, setLastTo] = useState('');
  const [page, setPage] = useState(1);
  const [selectedGroup, setSelectedGroup] = useState(null);   // row → transition modal

  const meta = DEPT_META[activeDept] || { label: activeDept, color: 'violet' };

  // Any filter change resets to page 1.
  const onFilter = (setter) => (val) => { setPage(1); setter(val); };
  const clearDateFilters = () => {
    setPage(1);
    setFirstFrom(''); setFirstTo(''); setLastFrom(''); setLastTo('');
  };

  const listQ = useQuery({
    queryKey: ['enr-groups', activeDept, search, statusFilter, firstFrom, firstTo, lastFrom, lastTo, page],
    enabled: view === 'groups',
    queryFn: () => api.get('/cs/enr-groups', {
      params: {
        dept: activeDept, q: search, status: statusFilter, page, page_size: 25,
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
    setActiveDept(d); setPage(1); setSearch(''); setQ(''); setStatusFilter(''); clearDateFilters();
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" dir="rtl">
      <PageHero
        title="Enr Groups — مجموعات الـ Enrollment"
        subtitle="المجموعات النشطة وحالتها، نقل العملاء للمجموعة القادمة، وقوائم المتابعة"
        icon={GraduationCap}
        color={meta.color}
      />

      {/* View tabs: groups vs disposition lists */}
      <div className="mt-4 flex flex-wrap gap-1 border-b border-slate-200">
        <button onClick={() => setView('groups')}
          className={`px-5 py-2.5 text-sm font-medium rounded-t-lg -mb-px border-b-2 transition-colors ${
            view === 'groups' ? 'border-violet-600 text-violet-700 bg-violet-50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
          }`}>
          <span className="inline-flex items-center gap-1.5"><Users className="w-4 h-4" /> المجموعات</span>
        </button>
        <button onClick={() => setView('lists')}
          className={`px-5 py-2.5 text-sm font-medium rounded-t-lg -mb-px border-b-2 transition-colors ${
            view === 'lists' ? 'border-violet-600 text-violet-700 bg-violet-50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
          }`}>
          <span className="inline-flex items-center gap-1.5"><ListChecks className="w-4 h-4" /> قوائم المتابعة</span>
        </button>
        <button onClick={() => setView('renewals')}
          className={`px-5 py-2.5 text-sm font-medium rounded-t-lg -mb-px border-b-2 transition-colors ${
            view === 'renewals' ? 'border-violet-600 text-violet-700 bg-violet-50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
          }`}>
          <span className="inline-flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> محتاج تجديد</span>
        </button>
        <button onClick={() => setView('ended')}
          className={`px-5 py-2.5 text-sm font-medium rounded-t-lg -mb-px border-b-2 transition-colors ${
            view === 'ended' ? 'border-violet-600 text-violet-700 bg-violet-50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
          }`}>
          <span className="inline-flex items-center gap-1.5"><Archive className="w-4 h-4" /> منتهية</span>
        </button>
        <button onClick={() => setView('log')}
          className={`px-5 py-2.5 text-sm font-medium rounded-t-lg -mb-px border-b-2 transition-colors ${
            view === 'log' ? 'border-violet-600 text-violet-700 bg-violet-50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
          }`}>
          <span className="inline-flex items-center gap-1.5"><History className="w-4 h-4" /> السجل</span>
        </button>
      </div>

      {view === 'log' ? (
        <ActivityLogView />
      ) : view === 'ended' ? (
        <EndedGroupsView onOpen={setSelectedGroup} />
      ) : view === 'renewals' ? (
        <RenewalsView />
      ) : view === 'lists' ? (
        <DispositionsView />
      ) : (
      <>
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

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => { setPage(1); setStatusFilter(e.target.value); }}
            className="py-2 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200"
          >
            <option value="">كل الحالات</option>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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
                <th className="px-3 py-3 font-medium">الحالة</th>
                <th className="px-3 py-3 font-medium">المنسق</th>
                <th className="px-3 py-3 font-medium">الطلاب</th>
                <th className="px-3 py-3 font-medium">عدد الطلاب</th>
                <th className="px-3 py-3 font-medium">العملاء المنقولين إليها</th>
                <th className="px-3 py-3 font-medium">تاريخ البداية</th>
                <th className="px-3 py-3 font-medium">تاريخ النهاية</th>
                <th className="px-3 py-3 font-medium">عدد المحاضرات</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={`${it.group_name}|${it.line}|${idx}`}
                  onClick={() => setSelectedGroup(it)}
                  className="border-b border-slate-50 hover:bg-violet-50/50 align-top cursor-pointer">
                  <td className="px-3 py-3">
                    <div className="font-mono text-xs text-slate-800 break-all">{it.group_name}</div>
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      {it.line && (
                        <span className="inline-block text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{it.line}</span>
                      )}
                      {it.renewal_count > 0 && (
                        <span className="inline-block text-[10px] bg-rose-50 text-rose-700 border border-rose-200 rounded px-1.5 py-0.5"
                          title="عملاء عضويتهم قربت تخلص (متبقّي 1 أو أقل)">
                          ⚠ {it.renewal_count} تجديد
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {STATUS_META[it.status] ? (
                      <span className={`inline-block text-[11px] rounded-full border px-2 py-0.5 ${STATUS_META[it.status].cls}`}>
                        {STATUS_META[it.status].label}
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-slate-700">{it.coordinator || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3">
                    {it.students?.length ? (
                      <div className="flex flex-col gap-1 max-w-xs">
                        {it.students.map((s, i) => (
                          <div key={i} className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-slate-700 truncate flex items-center gap-1 min-w-0">
                              {s.balance && s.balance.state !== 'unknown' && (
                                <span className={`text-[9px] rounded px-1 leading-tight flex-shrink-0 ${BAL_DOT[s.balance.state] || ''}`}
                                  title={`متبقّي ${s.balance.remaining}${s.balance.remaining_after_move != null ? ` · بعد النقل ${s.balance.remaining_after_move}` : ''}`}>
                                  {s.balance.remaining}
                                </span>
                              )}
                              <span className="truncate">{s.name || '—'}</span>
                            </span>
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
                  <td className="px-3 py-3">
                    {it.moved_in?.length ? (
                      <div className="flex flex-col gap-1 max-w-xs">
                        {it.moved_in.map((s, i) => (
                          <div key={i} className="flex items-center justify-between gap-2 text-xs bg-emerald-50/60 rounded px-1.5 py-0.5">
                            <span className="text-emerald-800 truncate">{s.name || '—'}</span>
                            <span className="text-emerald-500 font-mono whitespace-nowrap" dir="ltr">{s.phone || ''}</span>
                          </div>
                        ))}
                      </div>
                    ) : <span className="text-slate-300">—</span>}
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
                <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-400">لا توجد مجموعات مطابقة</td></tr>
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
      </>
      )}

      {selectedGroup && (
        <EnrTransitionModal group={selectedGroup} onClose={() => setSelectedGroup(null)} />
      )}
    </div>
  );
}
