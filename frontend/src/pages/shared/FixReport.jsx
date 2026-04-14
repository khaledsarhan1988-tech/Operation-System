import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, AlertCircle, X, FileText, XCircle } from 'lucide-react';
import api from '../../api/axios';

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

function DetailModal({ coordinator, period, dateFrom, dateTo, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['fix-detail', coordinator, period, dateFrom, dateTo],
    queryFn: () => api.get('/reports/fix-report/detail', {
      params: { coordinator, period, date_from: dateFrom || undefined, date_to: dateTo || undefined },
    }).then(r => r.data),
  });

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
                  const cfg = STATUS_CFG[r.status];
                  return (
                    <tr key={i} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3 text-xs font-semibold text-gray-900" style={{ maxWidth: '220px', wordBreak: 'break-word' }}>
                        <button onClick={() => navigator.clipboard.writeText(r.group_name)} title="انقر للنسخ" className="text-right hover:text-blue-600 transition-colors cursor-copy">{r.group_name}</button>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border bg-yellow-100 text-yellow-800 border-yellow-200">{r.problem_type}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{r.session_type === 'main' ? 'أساسي' : 'جانبي'}</td>
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
                      <td className="px-4 py-3 text-xs text-gray-600" style={{ maxWidth: '180px', wordBreak: 'break-word' }}>{r.note || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{r.updated_at?.slice(0, 16) ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{r.updated_by_name ?? '—'}</td>
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

  const { data, isLoading } = useQuery({
    queryKey: ['fix-report', period, dateFrom, dateTo],
    queryFn: () => api.get('/reports/fix-report', {
      params: {
        period: hasDateRange ? undefined : period,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      },
    }).then(r => r.data),
    staleTime: 60 * 1000,
  });

  const totalFixed   = data?.reduce((a, r) => a + (r.fixed   || 0), 0) ?? 0;
  const totalToday   = data?.reduce((a, r) => a + (r.fixed_today || 0), 0) ?? 0;
  const totalAll     = data?.reduce((a, r) => a + (r.total   || 0), 0) ?? 0;
  const pct = totalAll > 0 ? Math.round((totalFixed / totalAll) * 100) : 0;

  const selectCls = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]';
  const dateCls  = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]';

  return (
    <div className="space-y-5 animate-fadeIn" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-xl">
            <FileText className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-900">تقارير إصلاح الأكواد</h1>
            <p className="text-xs text-gray-400 mt-0.5">إجمالي ما تم إصلاحه لكل منسق</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period — disabled when date range is active */}
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            disabled={!!hasDateRange}
            className={`${selectCls} ${hasDateRange ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>

          {/* Date range */}
          <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-1.5">
            <span className="text-xs text-gray-400 whitespace-nowrap">من</span>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className={`${dateCls} border-0 p-0 text-xs focus:ring-0`}
            />
            <span className="text-xs text-gray-400 whitespace-nowrap">إلى</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className={`${dateCls} border-0 p-0 text-xs focus:ring-0`}
            />
            {hasDateRange && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="text-gray-400 hover:text-red-500 transition-colors mr-1"
                title="مسح التاريخ"
              >
                <XCircle size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Summary boxes */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4 flex items-center gap-4">
          <div className="p-2 bg-emerald-100 rounded-xl"><CheckCircle size={20} className="text-emerald-600" /></div>
          <div>
            <p className="text-xs text-emerald-600 font-semibold">إجمالي تم إصلاحه</p>
            <p className="text-2xl font-black text-emerald-700">{totalFixed}</p>
          </div>
          <div className="mr-auto text-sm font-bold text-emerald-500">{pct}%</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-2xl px-5 py-4 flex items-center gap-4">
          <div className="p-2 bg-blue-100 rounded-xl"><CheckCircle size={20} className="text-blue-500" /></div>
          <div>
            <p className="text-xs text-blue-500 font-semibold">تم إصلاحه اليوم</p>
            <p className="text-2xl font-black text-blue-600">{totalToday}</p>
          </div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-2xl px-5 py-4 flex items-center gap-4">
          <div className="p-2 bg-gray-100 rounded-xl"><AlertCircle size={20} className="text-gray-500" /></div>
          <div>
            <p className="text-xs text-gray-500 font-semibold">إجمالي المشاكل المتابعة</p>
            <p className="text-2xl font-black text-gray-700">{totalAll}</p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm text-right">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {['المنسق', 'إجمالي المشاكل', 'تم إصلاحه اليوم', 'إجمالي تم إصلاحه', 'النسبة'].map(h => (
                <th key={h} className="px-5 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 5 }).map((__, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-3 bg-gray-100 rounded-full w-3/4" /></td>
                  ))}
                </tr>
              ))
            ) : !data?.length ? (
              <tr><td colSpan={5} className="text-center py-12 text-gray-400 text-sm">لا توجد بيانات</td></tr>
            ) : data.map((r, i) => {
              const rowPct = r.total > 0 ? Math.round((r.fixed / r.total) * 100) : 0;
              return (
                <tr key={i} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-5 py-4 font-bold text-gray-900 text-sm">{r.coordinator || '—'}</td>
                  <td className="px-5 py-4 text-gray-600 font-semibold">{r.total}</td>
                  <td className="px-5 py-4">
                    <button
                      onClick={() => r.fixed_today > 0 && setDetail({ coordinator: r.coordinator, period: 'today', dateFrom: '', dateTo: '' })}
                      disabled={r.fixed_today === 0}
                      className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black border transition-all ${
                        r.fixed_today > 0
                          ? 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200 cursor-pointer'
                          : 'bg-gray-50 text-gray-400 border-gray-200 cursor-default'
                      }`}
                    >{r.fixed_today}</button>
                  </td>
                  <td className="px-5 py-4">
                    <button
                      onClick={() => r.fixed > 0 && setDetail({ coordinator: r.coordinator, period, dateFrom, dateTo })}
                      disabled={r.fixed === 0}
                      className={`inline-flex items-center px-3 py-1 rounded-xl text-xs font-black border transition-all ${
                        r.fixed > 0
                          ? 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200 cursor-pointer'
                          : 'bg-gray-50 text-gray-400 border-gray-200 cursor-default'
                      }`}
                    >
                      {r.fixed}
                    </button>
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

      {detail && (
        <DetailModal
          coordinator={detail.coordinator}
          period={detail.period}
          dateFrom={detail.dateFrom}
          dateTo={detail.dateTo}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
