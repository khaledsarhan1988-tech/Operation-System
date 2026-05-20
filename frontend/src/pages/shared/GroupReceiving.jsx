import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck, Search, CheckCircle, Loader2,
  AlertTriangle, Circle, Users, Check, CalendarDays, X,
} from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../auth/AuthContext';
import CopyButton from '../../components/ui/CopyButton';
import PageHero from '../../components/ui/PageHero';

// ─── STATUS CONFIG ─────────────────────────────────────────────────────────────
const STATUS_CFG = {
  not_approved: { label: 'غير معتمدة', emoji: '⚪', badge: 'bg-slate-100 text-slate-600 border-slate-200',     dot: 'bg-slate-400'  },
  approved:     { label: 'معتمدة',     emoji: '✅', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  changed:      { label: 'العدد اتغير', emoji: '⚠️', badge: 'bg-red-100 text-red-700 border-red-200',           dot: 'bg-red-500'    },
};

function DeptBadge({ dept }) {
  const map = {
    'Semi':    'bg-amber-100 text-amber-800 border-amber-200',
    'Private': 'bg-violet-100 text-violet-800 border-violet-200',
    'General': 'bg-sky-100 text-sky-800 border-sky-200',
  };
  const cls = map[dept] ?? 'bg-gray-100 text-gray-600 border-gray-200';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${cls}`}>{dept ?? '—'}</span>;
}

function SkeletonRows({ cols = 8, rows = 6 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i} className="animate-pulse border-b border-gray-50">
      {Array.from({ length: cols }).map((__, j) => (
        <td key={j} className="px-4 py-3">
          <div className="h-3.5 bg-gray-100 rounded-full" style={{ width: `${55 + (j * 11 % 40)}%` }} />
        </td>
      ))}
    </tr>
  ));
}

// ─── CLIENTS MODAL ─────────────────────────────────────────────────────────────
// Opened by clicking a group's "العدد الحالي" cell — lists the registered
// clients (name + phone) of that group.
function ClientsModal({ group, onClose }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['group-clients', group.group_name, group.line],
    queryFn: () => api.get('/group-approvals/clients', {
      params: { group_name: group.group_name, line: group.line },
    }).then(r => r.data),
  });
  const clients = data?.clients ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()} dir="rtl">
        <div className="px-5 py-4 bg-gradient-to-l from-[#1e3a5f]/10 to-[#1e3a5f]/5 border-b border-[#1e3a5f]/10 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-[#1e3a5f] uppercase tracking-wide mb-1">عملاء المجموعة</p>
            <p className="text-sm font-black text-gray-900 leading-tight break-all" dir="ltr">{group.group_name}</p>
            {!isLoading && !isError && <p className="text-xs text-gray-500 mt-1">{clients.length} عميل</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 flex-shrink-0">
            <X size={15} className="text-gray-500" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : isError ? (
            <div className="p-10 text-center text-sm text-red-600">تعذّر تحميل بيانات العملاء</div>
          ) : clients.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-400">لا يوجد عملاء مسجلين لهذه المجموعة</div>
          ) : (
            <table className="w-full text-sm text-right">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 w-10">#</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">اسم العميل</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">رقم الهاتف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {clients.map((c, i) => (
                  <tr key={i} className="hover:bg-gray-50/60">
                    <td className="px-4 py-2.5 text-xs text-gray-400">{i + 1}</td>
                    <td className="px-4 py-2.5 font-semibold text-gray-800">{c.name || '—'}</td>
                    <td className="px-4 py-2.5">
                      {c.phone ? (
                        <CopyButton text={c.phone} className="text-gray-600 hover:text-blue-600 font-mono" dir="ltr" size={11}>
                          <span dir="ltr">{c.phone}</span>
                        </CopyButton>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function GroupReceiving() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [search,    setSearch]    = useState('');
  const [statusTab, setStatusTab] = useState('');     // '' | not_approved | approved | changed
  const [fromDate,  setFromDate]  = useState('2026-06-06'); // only groups starting on/after this
  const [busyKey,   setBusyKey]   = useState(null);   // group_name|line currently being approved
  const [errMsg,    setErrMsg]    = useState(null);
  const [clientModal, setClientModal] = useState(null); // { group_name, line } | null

  // ── data — `from_date` filters to groups starting on/after the chosen date
  const { data, isLoading } = useQuery({
    queryKey: ['group-approvals', user?.id, fromDate],
    queryFn: () => api.get('/group-approvals', { params: { from_date: fromDate } }).then(r => r.data),
    enabled: !!user?.id,
    staleTime: 2 * 60 * 1000,
  });

  const groups  = useMemo(() => data?.groups ?? [], [data]);
  const summary = data?.summary ?? { total: 0, approved: 0, not_approved: 0, changed: 0 };

  // ── mutations
  const approveMut = useMutation({
    mutationFn: ({ group_name, line }) => api.post('/group-approvals', { group_name, line }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['group-approvals'] }),
    onError:   (e) => setErrMsg(e?.response?.data?.error || 'حدث خطأ أثناء الاعتماد'),
  });

  const bulkMut = useMutation({
    mutationFn: () => api.post('/group-approvals/bulk', { from_date: fromDate }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['group-approvals'] }),
    onError:   (e) => setErrMsg(e?.response?.data?.error || 'حدث خطأ أثناء الاعتماد الجماعي'),
  });

  const approveOne = async (g) => {
    setErrMsg(null);
    const key = `${g.group_name}|${g.line}`;
    setBusyKey(key);
    try { await approveMut.mutateAsync({ group_name: g.group_name, line: g.line }); }
    finally { setBusyKey(null); }
  };

  const approveBulk = async () => {
    if (summary.not_approved === 0 || bulkMut.isPending) return;
    setErrMsg(null);
    await bulkMut.mutateAsync();
  };

  // ── filtering
  const filtered = useMemo(() => groups.filter(g => {
    if (statusTab && g.status !== statusTab) return false;
    if (search && !g.group_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [groups, statusTab, search]);

  const selectCls = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]';
  const hasFilters = search || statusTab;

  const TABS = [
    { key: '',             label: 'الكل',        count: summary.total },
    { key: 'not_approved', label: 'غير معتمدة',  count: summary.not_approved },
    { key: 'changed',      label: 'العدد اتغير', count: summary.changed },
    { key: 'approved',     label: 'معتمدة',      count: summary.approved },
  ];

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="استلام المجموعات"
        subtitle={isLoading ? 'جاري التحميل...' : `${summary.total} مجموعة نشطة`}
        icon={ClipboardCheck}
        gradient="cyan"
        stats={[
          { label: 'الإجمالي',     value: summary.total,        icon: Users },
          { label: 'معتمدة',       value: summary.approved,     icon: CheckCircle },
          { label: 'غير معتمدة',   value: summary.not_approved, icon: Circle },
          { label: 'العدد اتغير',  value: summary.changed,      icon: AlertTriangle },
        ]}
        actions={
          <button
            onClick={approveBulk}
            disabled={summary.not_approved === 0 || bulkMut.isPending}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/15 hover:bg-white/25 border border-white/20 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {bulkMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            اعتماد كل غير المعتمدة{summary.not_approved > 0 ? ` (${summary.not_approved})` : ''}
          </button>
        }
      />

      {errMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {errMsg}
        </div>
      )}

      <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
        {/* ── TABS + FILTERS ── */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100">
          <div className="flex flex-wrap gap-2 mb-4">
            {TABS.map(t => (
              <button key={t.key || 'all'}
                onClick={() => setStatusTab(t.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all
                  ${statusTab === t.key
                    ? 'bg-[#1e3a5f] text-white border-[#1e3a5f] shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              >
                {t.label}
                <span className={`text-xs px-2 py-0.5 rounded-full font-black ${
                  statusTab === t.key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {t.count}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="بحث باسم المجموعة..."
                className="w-full bg-white border border-gray-200 rounded-xl pr-10 pl-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
              />
            </div>
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-1.5 whitespace-nowrap">
              <CalendarDays className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <label className="text-xs font-bold text-gray-500">المجموعات من تاريخ</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                className="text-sm text-gray-700 focus:outline-none bg-transparent"
              />
              {fromDate && (
                <button onClick={() => setFromDate('')} title="عرض كل التواريخ"
                  className="text-gray-400 hover:text-red-600 text-xs font-bold">✕</button>
              )}
            </div>
            {hasFilters && (
              <button
                onClick={() => { setSearch(''); setStatusTab(''); }}
                className={`${selectCls} text-gray-500 hover:text-red-600 hover:border-red-200 font-medium whitespace-nowrap`}
              >✕ مسح الكل</button>
            )}
          </div>
        </div>

        {/* ── TABLE ── */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right" style={{ minWidth: '880px' }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['اسم المجموعة', 'المنسق', 'القسم', 'الكورس', 'العدد الحالي', 'العدد المعتمد', 'الحالة', 'إجراء'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? <SkeletonRows cols={8} rows={6} /> :
               !filtered.length ? (
                 <tr>
                   <td colSpan={8} className="text-center py-12">
                     <div className="flex flex-col items-center gap-2 text-gray-400">
                       <ClipboardCheck className="w-8 h-8 text-gray-300" />
                       <p className="text-sm font-medium">لا توجد مجموعات</p>
                     </div>
                   </td>
                 </tr>
               ) :
               filtered.map((g) => {
                 const key  = `${g.group_name}|${g.line}`;
                 const cfg  = STATUS_CFG[g.status];
                 const busy = busyKey === key && approveMut.isPending;
                 const rowBg =
                   g.status === 'changed'      ? 'bg-red-50/40' :
                   g.status === 'not_approved' ? 'bg-slate-50/40' : '';
                 const btnLabel =
                   g.status === 'changed'      ? 'اعتماد العدد الجديد' :
                   g.status === 'approved'     ? 'إعادة اعتماد' : 'اعتماد';
                 const btnCls =
                   g.status === 'approved'
                     ? 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                     : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700';
                 return (
                   <tr key={key} className={`hover:bg-gray-50/60 transition-colors ${rowBg}`}>
                     <td className="px-4 py-3 font-semibold text-gray-900 text-xs" style={{ maxWidth: '240px' }}>
                       <CopyButton text={g.group_name ?? ''} className="text-right hover:text-blue-600 transition-colors" dir="ltr">
                         <span className="break-all">{g.group_name ?? '—'}</span>
                       </CopyButton>
                     </td>
                     <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{g.coordinators ?? '--'}</td>
                     <td className="px-4 py-3 whitespace-nowrap"><DeptBadge dept={g.dept_type} /></td>
                     <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{g.course ?? '—'}</td>
                     <td className="px-4 py-3 whitespace-nowrap">
                       <button
                         onClick={() => setClientModal({ group_name: g.group_name, line: g.line })}
                         title="عرض أسماء العملاء وأرقام هواتفهم"
                         className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-black border border-blue-200 hover:bg-blue-100 transition-colors cursor-pointer"
                       >
                         {g.current_count ?? 0}
                       </button>
                     </td>
                     <td className="px-4 py-3 whitespace-nowrap">
                       {g.approved_count == null ? (
                         <span className="text-gray-300 text-xs">—</span>
                       ) : (
                         <span className="inline-flex items-center gap-1.5">
                           <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-lg bg-gray-100 text-gray-800 text-sm font-black">
                             {g.approved_count}
                           </span>
                           {g.status === 'changed' && (
                             <span className={`text-xs font-black ${g.diff > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                               {g.diff > 0 ? '+' : ''}{g.diff}
                             </span>
                           )}
                         </span>
                       )}
                     </td>
                     <td className="px-4 py-3 whitespace-nowrap">
                       <span
                         className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold border ${cfg.badge}`}
                         title={g.approved_at ? `اعتمدها: ${g.approved_by_name || '—'} · ${String(g.updated_at || g.approved_at).slice(0, 16).replace('T', ' ')}` : ''}
                       >
                         <span>{cfg.emoji}</span>
                         <span>{cfg.label}</span>
                       </span>
                     </td>
                     <td className="px-4 py-3 whitespace-nowrap">
                       <button
                         onClick={() => approveOne(g)}
                         disabled={busy}
                         className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all disabled:opacity-60 disabled:cursor-not-allowed ${btnCls}`}
                       >
                         {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                         {btnLabel}
                       </button>
                     </td>
                   </tr>
                 );
               })}
            </tbody>
          </table>
        </div>

        {/* ── FOOTER ── */}
        <div className="px-6 py-3 bg-gray-50/40 border-t border-gray-100">
          <p className="text-xs text-gray-400 leading-relaxed">
            عند اعتماد مجموعة يتم حفظ عدد عملائها الحالي كأساس. لو العدد اتغير بعد كده (زيادة أو نقصان)
            هتلاقي كود فيه مشكلة في تقرير «أكواد بها مشكلة» — والحل إنك تعيد اعتماد العدد الجديد من هنا.
          </p>
        </div>
      </div>

      {/* ── CLIENTS MODAL ── */}
      {clientModal && (
        <ClientsModal group={clientModal} onClose={() => setClientModal(null)} />
      )}
    </div>
  );
}
