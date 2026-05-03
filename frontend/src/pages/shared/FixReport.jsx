import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, AlertCircle, X, FileText, XCircle, Copy, Check, Calendar } from 'lucide-react';
import api from '../../api/axios';
import { copyText } from '../../utils/clipboard';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handle = useCallback(async () => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [text]);
  return (
    <button
      onClick={handle}
      title="انقر للنسخ"
      className={`inline-flex items-center gap-1.5 group text-right transition-colors ${copied ? 'text-emerald-600' : 'text-gray-900 hover:text-blue-600'}`}
    >
      <span className="font-semibold text-xs">{text}</span>
      {copied
        ? <Check size={12} className="text-emerald-500 flex-shrink-0" />
        : <Copy size={12} className="opacity-0 group-hover:opacity-60 flex-shrink-0 transition-opacity" />
      }
    </button>
  );
}

const STATUS_CFG = {
  wont_repeat: { label: 'لن تتكرر', emoji: '✋', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  exception:   { label: 'استثناء',  emoji: '🔕', badge: 'bg-slate-100 text-slate-600 border-slate-200'     },
  resolved:    { label: 'تم حلها',  emoji: '✅', badge: 'bg-green-100 text-green-700 border-green-200'     },
};

const PERIODS = [
  { value: 'today', label: 'اليوم' },
  { value: 'week',  label: 'هذا الأسبوع' },
  { value: 'month', label: 'هذا الشهر' },
  { value: 'all',   label: 'كل الوقت' },
];

function DetailModal({ coordinator, period, items, onClose }) {
  // Items are already filtered by caller (same source as summary numbers).
  const isLoading = false;
  const data = items;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-l from-emerald-50 to-white flex-shrink-0">
          <div>
            <p className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-0.5">تفاصيل الإصلاحات</p>
            <p className="text-lg font-black text-gray-900">{coordinator}</p>
            <p className="text-xs text-gray-400 mt-0.5">{PERIODS.find(p => p.value === period)?.label}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 text-sm">جاري التحميل...</div>
          ) : !data?.length ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-gray-400">
              <CheckCircle size={32} className="text-green-300" />
              <p className="text-sm">لا توجد إصلاحات في هذه الفترة</p>
            </div>
          ) : (
            <table className="w-full text-sm text-right" dir="rtl">
              <thead className="sticky top-0">
                <tr className="bg-gray-50 border-b border-gray-100">
                  {['اسم المجموعة', 'نوع المشكلة', 'النوع', 'القسم', 'الحالة', 'ملحوظات', 'تاريخ الإصلاح', 'بواسطة'].map(h => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.map((r, i) => {
                  const status = r._resolved_status || r.status;
                  const cfg    = STATUS_CFG[status];
                  return (
                    <tr key={i} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3" style={{ maxWidth: '220px', wordBreak: 'break-word' }}>
                        <CopyButton text={r.group_name} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border bg-yellow-100 text-yellow-800 border-yellow-200">{r.problem_type}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{r._session_type === 'main' ? 'أساسي' : 'جانبي'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${
                          r.dept_type === 'Private' ? 'bg-violet-100 text-violet-800 border-violet-200' :
                          r.dept_type === 'Semi'    ? 'bg-amber-100 text-amber-800 border-amber-200'   :
                          'bg-sky-100 text-sky-800 border-sky-200'
                        }`}>{r.dept_type ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold border ${cfg?.badge}`}>
                          {cfg?.emoji} {cfg?.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600" style={{ maxWidth: '180px', wordBreak: 'break-word' }}>{r._status_note || r.note || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{(r._status_at || r.updated_at)?.slice(0, 16) ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{r._status_by || r.updated_by_name || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50 flex-shrink-0">
          <p className="text-xs text-gray-400">{data?.length ?? 0} إصلاح</p>
        </div>
      </div>
    </div>
  );
}

export default function FixReport() {
  const [period, setPeriod] = useState('today');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [detail, setDetail] = useState(null); // { coordinator, period, dateFrom, dateTo }

  const hasDateRange = dateFrom || dateTo;

  // Single source: all problems from code-problems with show_resolved=true.
  // Both totals AND fixed counts are derived from the same dataset so numbers
  // always match the "Code Problems" page exactly (no stale cps rows, no
  // JOIN duplication, no double-count from ghost entries).
  const { data: codeProbs, isLoading } = useQuery({
    queryKey: ['fix-report-code-probs'],
    queryFn: () => api.get('/reports/code-problems', { params: { show_resolved: true } }).then(r => r.data),
    staleTime: 60 * 1000,
  });

  const todayStr = new Date().toISOString().slice(0, 10);

  // Flatten all problems, tag session_type, drop ghost duplicates
  const allProblems = [
    ...(codeProbs?.main_problems ?? []).map(p => ({ ...p, _session_type: 'main' })),
    ...(codeProbs?.zoom_problems ?? []).map(p => ({ ...p, _session_type: 'side' })),
  ].filter(p => !p._ghost);

  // Aggregate per coordinator. Split multi-name coordinator fields
  // (e.g. "Mostafa, fouad" → ["Mostafa", "fouad"]) so each coordinator gets credit.
  const agg = {};
  allProblems.forEach(p => {
    const raw    = p.coordinators || '--';
    const coords = raw.includes(',') ? raw.split(',').map(c => c.trim()).filter(Boolean) : [raw.trim()];
    const isFixed      = ['resolved', 'wont_repeat', 'exception'].includes(p._resolved_status);
    const statusDate   = p._status_at ? String(p._status_at).slice(0, 10) : null;
    const isFixedToday = isFixed && statusDate === todayStr;

    coords.forEach(coord => {
      if (!agg[coord]) agg[coord] = { total: 0, fixed: 0, fixed_today: 0 };
      agg[coord].total += 1;
      if (isFixed)      agg[coord].fixed += 1;
      if (isFixedToday) agg[coord].fixed_today += 1;
    });
  });

  // Helper: pick fixed problems for a given coordinator + period (for detail modal)
  const pickFixed = (coord, periodKey) => allProblems.filter(p => {
    if (!['resolved', 'wont_repeat', 'exception'].includes(p._resolved_status)) return false;
    const raw    = p.coordinators || '--';
    const coords = raw.includes(',') ? raw.split(',').map(c => c.trim()).filter(Boolean) : [raw.trim()];
    if (!coords.includes(coord)) return false;
    if (periodKey === 'today') {
      const d = p._status_at ? String(p._status_at).slice(0, 10) : null;
      if (d !== todayStr) return false;
    }
    return true;
  });

  const data = Object.entries(agg).map(([coord, x]) => ({
    coordinator: coord,
    all_count:   x.total,
    fixed:       x.fixed,
    fixed_today: x.fixed_today,
    remaining:   Math.max(0, x.total - x.fixed),
  })).sort((a, b) => b.remaining - a.remaining || b.fixed - a.fixed);

  const totalAllCount = data.reduce((a, r) => a + r.all_count,   0);
  const totalFixed    = data.reduce((a, r) => a + r.fixed,        0);
  const totalRemain   = data.reduce((a, r) => a + r.remaining,    0);
  const totalToday    = data.reduce((a, r) => a + r.fixed_today,  0);
  const pct = totalAllCount > 0 ? Math.round((totalFixed / totalAllCount) * 100) : 0;

  const selectCls = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]';
  const dateCls  = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]';

  const filterEl = (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={period}
        onChange={e => setPeriod(e.target.value)}
        disabled={!!hasDateRange}
        className={`bg-white/10 backdrop-blur-md border border-white/20 rounded-xl px-3 py-1.5 text-white text-xs font-bold focus:outline-none cursor-pointer ${hasDateRange ? 'opacity-40 cursor-not-allowed' : ''}`}
      >
        {PERIODS.map(p => <option key={p.value} value={p.value} className="text-gray-700">{p.label}</option>)}
      </select>

      <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl px-3 py-1.5">
        <Calendar size={13} className="text-white/70" />
        <span className="text-[10px] text-white/60 font-bold">من</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="bg-transparent text-white text-xs font-bold focus:outline-none border-0 p-0" />
        <span className="text-[10px] text-white/60 font-bold">إلى</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="bg-transparent text-white text-xs font-bold focus:outline-none border-0 p-0" />
        {hasDateRange && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); }}
            className="text-white/70 hover:text-white transition-colors mr-1"
            title="مسح التاريخ"
          >
            <XCircle size={14} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="تقارير إصلاح الأكواد"
        subtitle="إجمالي ما تم إصلاحه لكل منسق"
        icon={FileText}
        gradient="emerald"
        actions={filterEl}
        stats={[
          { label: 'إجمالي المشاكل',   value: totalAllCount, icon: AlertCircle },
          { label: 'المتبقية',          value: totalRemain,   icon: AlertCircle },
          { label: 'إجمالي تم إصلاحه', value: totalFixed,    icon: CheckCircle, suffix: ` (${pct}%)` },
          { label: 'تم إصلاحه اليوم',  value: totalToday,    icon: CheckCircle },
        ]}
      />

      {/* Table */}
      <SectionCard title="تفاصيل الإصلاح لكل منسق" icon={FileText} accent="emerald" noBodyPad>
        <div className="overflow-x-auto">
        <table className="w-full text-sm text-right">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {['المنسق', 'إجمالي المشاكل', 'المتبقية', 'إجمالي تم إصلاحه', 'تم إصلاحه اليوم', 'النسبة'].map(h => (
                <th key={h} className="px-5 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-3 bg-gray-100 rounded-full w-3/4" /></td>
                  ))}
                </tr>
              ))
            ) : !data?.length ? (
              <tr><td colSpan={6} className="p-0">
                <EmptyState
                  icon={FileText}
                  accent="emerald"
                  title="لا توجد إصلاحات بعد"
                  message="غيّر الفلاتر أو الفترة لمشاهدة بيانات الإصلاح."
                />
              </td></tr>
            ) : data.map((r, i) => {
              const rowPct = r.all_count > 0 ? Math.round((r.fixed / r.all_count) * 100) : 0;
              return (
                <tr key={i} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-5 py-4 font-bold text-gray-900 text-sm">{r.coordinator || '—'}</td>
                  <td className="px-5 py-4 text-gray-700 font-semibold">{r.all_count}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black border ${
                      r.remaining > 0 ? 'bg-red-100 text-red-700 border-red-200' : 'bg-gray-50 text-gray-400 border-gray-200'
                    }`}>{r.remaining}</span>
                  </td>
                  <td className="px-5 py-4">
                    <button
                      onClick={() => r.fixed > 0 && setDetail({ coordinator: r.coordinator, period: 'all', items: pickFixed(r.coordinator, 'all') })}
                      disabled={r.fixed === 0}
                      className={`inline-flex items-center px-3 py-1 rounded-xl text-xs font-black border transition-all ${
                        r.fixed > 0
                          ? 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200 cursor-pointer'
                          : 'bg-gray-50 text-gray-400 border-gray-200 cursor-default'
                      }`}
                    >{r.fixed}</button>
                  </td>
                  <td className="px-5 py-4">
                    <button
                      onClick={() => r.fixed_today > 0 && setDetail({ coordinator: r.coordinator, period: 'today', items: pickFixed(r.coordinator, 'today') })}
                      disabled={r.fixed_today === 0}
                      className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black border transition-all ${
                        r.fixed_today > 0
                          ? 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200 cursor-pointer'
                          : 'bg-gray-50 text-gray-400 border-gray-200 cursor-default'
                      }`}
                    >{r.fixed_today}</button>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-2" style={{ minWidth: '80px' }}>
                        <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${rowPct}%` }} />
                      </div>
                      <span className="text-xs font-bold text-gray-600 w-9 text-left">{rowPct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </SectionCard>

      {detail && (
        <DetailModal
          coordinator={detail.coordinator}
          period={detail.period}
          items={detail.items}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
