import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X, GitCompare, ArrowUp, ArrowDown, Minus, TrendingUp, TrendingDown,
  Sparkles, ShieldAlert, CheckCircle2,
} from 'lucide-react';
import api from '../../api/axios';

const MONTH_NAMES_AR = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function trendIcon(d) {
  if (d > 0) return <ArrowUp size={12} className="text-emerald-500" />;
  if (d < 0) return <ArrowDown size={12} className="text-red-500" />;
  return <Minus size={12} className="text-gray-400" />;
}

function avatarGradient(name = '') {
  const grads = [
    'from-indigo-500 to-purple-600',
    'from-blue-500 to-cyan-600',
    'from-emerald-500 to-teal-600',
    'from-rose-500 to-pink-600',
    'from-amber-500 to-orange-600',
    'from-violet-500 to-fuchsia-600',
    'from-sky-500 to-indigo-600',
    'from-teal-500 to-emerald-600',
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return grads[Math.abs(h) % grads.length];
}

export default function CompareMonthsModal({ open, onClose, frozenList = [], department = '' }) {
  // Default: latest month vs previous (if available)
  const sortedList = [...frozenList].sort((a, b) => (b.year - a.year) || (b.month - a.month));
  const [aSel, setASel] = useState(() => sortedList[1] ? `${sortedList[1].year}-${sortedList[1].month}` : '');
  const [bSel, setBSel] = useState(() => sortedList[0] ? `${sortedList[0].year}-${sortedList[0].month}` : '');

  const [aY, aM] = aSel.split('-').map(Number);
  const [bY, bM] = bSel.split('-').map(Number);

  const { data, isLoading } = useQuery({
    queryKey: ['compare-months', aY, aM, bY, bM, department],
    queryFn: () => api.get('/admin/snapshots/compare', {
      params: { a_year: aY, a_month: aM, b_year: bY, b_month: bM, department: department || undefined },
    }).then(r => r.data),
    enabled: open && !!aY && !!aM && !!bY && !!bM,
  });

  if (!open) return null;

  const inputCls = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-100 rounded-xl">
              <GitCompare size={18} className="text-violet-600" />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900">مقارنة شهرين</h2>
              <p className="text-xs text-gray-400 font-bold mt-0.5">قارن أداء الفريق بين أي شهرين مجمّدين</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
        </div>

        {/* Period selectors */}
        <div className="p-5 bg-gray-50/40 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black text-gray-500">من</span>
            <select value={aSel} onChange={e => setASel(e.target.value)} className={inputCls}>
              <option value="">— اختر —</option>
              {sortedList.map(p => (
                <option key={p.period_label} value={`${p.year}-${p.month}`}>
                  {MONTH_NAMES_AR[p.month]} {p.year}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl text-gray-300">↔</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-black text-gray-500">إلى</span>
            <select value={bSel} onChange={e => setBSel(e.target.value)} className={inputCls}>
              <option value="">— اختر —</option>
              {sortedList.map(p => (
                <option key={p.period_label} value={`${p.year}-${p.month}`}>
                  {MONTH_NAMES_AR[p.month]} {p.year}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="text-center py-12 text-gray-400 text-sm font-bold">جاري التحميل...</p>
          ) : !data ? (
            <p className="text-center py-12 text-gray-400 text-sm font-bold">اختر شهرين لبدء المقارنة</p>
          ) : (
            <div className="p-5 space-y-5">
              {/* Summary stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'متوسط من', value: `${data.a.avg_overall}%`, sub: `${data.a.agents} موظف`, color: 'gray' },
                  { label: 'متوسط إلى', value: `${data.b.avg_overall}%`, sub: `${data.b.agents} موظف`, color: 'gray' },
                  { label: 'تحسّنوا',   value: data.summary.improved, sub: 'موظف ↗', color: 'emerald' },
                  { label: 'تراجعوا',  value: data.summary.declined,  sub: 'موظف ↘', color: 'rose' },
                  { label: 'ثابتون',    value: data.summary.stable,   sub: 'موظف ━', color: 'gray' },
                ].map((s, i) => {
                  const colorMap = {
                    gray:    'border-gray-200 bg-gray-50',
                    emerald: 'border-emerald-200 bg-emerald-50',
                    rose:    'border-rose-200 bg-rose-50',
                  };
                  const txtMap = {
                    gray:    'text-gray-700',
                    emerald: 'text-emerald-700',
                    rose:    'text-rose-700',
                  };
                  return (
                    <div key={i} className={`rounded-2xl p-3 border ${colorMap[s.color]}`}>
                      <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">{s.label}</p>
                      <p className={`text-2xl font-black ${txtMap[s.color]}`}>{s.value}</p>
                      <p className="text-[10px] text-gray-500 font-bold mt-0.5">{s.sub}</p>
                    </div>
                  );
                })}
              </div>

              {/* Delta avg banner */}
              <div className={`rounded-2xl p-4 border-2 ${
                data.delta_avg > 0  ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white'
                : data.delta_avg < 0 ? 'border-rose-200 bg-gradient-to-br from-rose-50 to-white'
                : 'border-gray-200 bg-gray-50'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-black text-gray-500 uppercase tracking-wider mb-1">إجمالي تغيير متوسط القسم</p>
                    <p className={`text-3xl font-black ${
                      data.delta_avg > 0 ? 'text-emerald-700' :
                      data.delta_avg < 0 ? 'text-rose-700' : 'text-gray-700'
                    }`}>
                      {data.delta_avg > 0 ? '+' : ''}{data.delta_avg}%
                    </p>
                  </div>
                  <div className="text-5xl">
                    {data.delta_avg > 0 ? '📈' : data.delta_avg < 0 ? '📉' : '━'}
                  </div>
                </div>
              </div>

              {/* Detailed comparison table */}
              <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-black text-gray-700">
                    تفاصيل لكل موظف ({data.rows.length})
                  </p>
                </div>
                <div className="max-h-[40vh] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50/60 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-right text-[11px] font-black text-gray-500">الموظف</th>
                        <th className="px-3 py-3 text-center text-[11px] font-black text-gray-500">من</th>
                        <th className="px-3 py-3 text-center text-[11px] font-black text-gray-500">إلى</th>
                        <th className="px-3 py-3 text-center text-[11px] font-black text-gray-500">التغيير</th>
                        <th className="px-3 py-3 text-center text-[11px] font-black text-gray-500">الحالة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.rows.map((r, i) => {
                        const dlt = r.delta_overall;
                        const status = r.a && r.b
                          ? (dlt > 0 ? 'تحسّن' : dlt < 0 ? 'تراجع' : 'ثابت')
                          : (r.a ? 'اختفى' : 'جديد');
                        const statusBg = r.a && r.b
                          ? (dlt > 0 ? 'bg-emerald-100 text-emerald-700' : dlt < 0 ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-600')
                          : (r.a ? 'bg-amber-100 text-amber-700' : 'bg-violet-100 text-violet-700');
                        const initial = (r.agent_name?.[0] || '?').toUpperCase();
                        return (
                          <tr key={i} className="hover:bg-gray-50/40">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2.5">
                                <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${avatarGradient(r.agent_name)} text-white font-black text-xs flex items-center justify-center`}>
                                  {initial}
                                </div>
                                <div>
                                  <p className="font-black text-gray-800 text-xs">{r.agent_name}</p>
                                  <p className="text-[10px] text-gray-400 font-bold">{r.department}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-center">
                              {r.a ? (
                                <span className="inline-flex px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-black">
                                  {r.a.overall}%
                                </span>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-3 py-3 text-center">
                              {r.b ? (
                                <span className="inline-flex px-2 py-0.5 rounded-lg bg-indigo-100 text-indigo-700 text-xs font-black">
                                  {r.b.overall}%
                                </span>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-3 py-3 text-center">
                              {dlt != null ? (
                                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-black ${
                                  dlt > 0 ? 'bg-emerald-100 text-emerald-700' :
                                  dlt < 0 ? 'bg-rose-100 text-rose-700' :
                                  'bg-gray-100 text-gray-600'
                                }`}>
                                  {trendIcon(dlt)}
                                  {dlt > 0 ? '+' : ''}{dlt}%
                                </span>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`inline-flex px-2.5 py-1 rounded-xl text-[10px] font-black ${statusBg}`}>
                                {status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
