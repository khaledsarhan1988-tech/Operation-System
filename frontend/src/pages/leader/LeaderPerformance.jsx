import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart2, CheckCircle, Clock, AlertTriangle, Zap, Download } from 'lucide-react';
import api from '../../api/axios';

export default function LeaderPerformance() {
  const [from, setFrom]   = useState('');
  const [to, setTo]       = useState('');
  const [coord, setCoord] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['leader-performance', from, to, coord],
    queryFn: () =>
      api.get('/leader/performance', {
        params: {
          from: from || undefined,
          to:   to   || undefined,
          coordinator: coord || undefined,
        },
      }).then(r => r.data),
    staleTime: 30_000,
  });

  const totalTasks   = data.reduce((s, r) => s + (r.total   || 0), 0);
  const totalDone    = data.reduce((s, r) => s + (r.done    || 0), 0);
  const totalPending = data.reduce((s, r) => s + (r.pending || 0), 0);
  const totalOverdue = data.reduce((s, r) => s + (r.overdue || 0), 0);
  const pct = totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0;

  const inputCls = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]';

  return (
    <div className="space-y-5 animate-fadeIn" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-xl">
            <BarChart2 className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-900">أداء الفريق</h1>
            <p className="text-xs text-gray-400 mt-0.5">إحصائيات أداء كل موظف</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder="بحث باسم المنسق..."
            value={coord}
            onChange={e => setCoord(e.target.value)}
            className={inputCls}
          />
          <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-1.5">
            <span className="text-xs text-gray-400 whitespace-nowrap">من</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="text-xs text-gray-700 focus:outline-none border-0 p-0" />
            <span className="text-xs text-gray-400 whitespace-nowrap">إلى</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="text-xs text-gray-700 focus:outline-none border-0 p-0" />
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-50 border border-gray-200 rounded-2xl px-5 py-4 flex items-center gap-4">
          <div className="p-2 bg-gray-100 rounded-xl"><BarChart2 size={20} className="text-gray-500" /></div>
          <div>
            <p className="text-xs text-gray-500 font-semibold">إجمالي المهام</p>
            <p className="text-2xl font-black text-gray-700">{totalTasks.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4 flex items-center gap-4">
          <div className="p-2 bg-emerald-100 rounded-xl"><CheckCircle size={20} className="text-emerald-600" /></div>
          <div>
            <p className="text-xs text-emerald-600 font-semibold">مكتملة</p>
            <p className="text-2xl font-black text-emerald-700">{totalDone.toLocaleString()}</p>
          </div>
          <div className="mr-auto text-sm font-bold text-emerald-500">{pct}%</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-center gap-4">
          <div className="p-2 bg-amber-100 rounded-xl"><Clock size={20} className="text-amber-600" /></div>
          <div>
            <p className="text-xs text-amber-600 font-semibold">قيد التنفيذ</p>
            <p className="text-2xl font-black text-amber-700">{totalPending.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 flex items-center gap-4">
          <div className="p-2 bg-red-100 rounded-xl"><AlertTriangle size={20} className="text-red-500" /></div>
          <div>
            <p className="text-xs text-red-500 font-semibold">متأخرة</p>
            <p className="text-2xl font-black text-red-600">{totalOverdue.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm text-right">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {['الموظف', 'إجمالي المهام', 'مكتملة', 'قيد التنفيذ', 'متأخرة', 'عاجلة', 'نسبة الإنجاز'].map(h => (
                <th key={h} className="px-5 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-3 bg-gray-100 rounded-full w-3/4" /></td>
                  ))}
                </tr>
              ))
            ) : !data.length ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm">لا توجد بيانات</td></tr>
            ) : data.map((r, i) => {
              const rowPct = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
              return (
                <tr key={i} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-5 py-4 font-bold text-gray-900">{r.name}</td>
                  <td className="px-5 py-4 text-gray-700 font-semibold">{(r.total || 0).toLocaleString()}</td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black border bg-emerald-100 text-emerald-700 border-emerald-200">
                      {(r.done || 0).toLocaleString()}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black border ${
                      r.pending > 0 ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-gray-50 text-gray-400 border-gray-200'
                    }`}>{r.pending || 0}</span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black border ${
                      r.overdue > 0 ? 'bg-red-100 text-red-700 border-red-200' : 'bg-gray-50 text-gray-400 border-gray-200'
                    }`}>{r.overdue || 0}</span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-black border ${
                      r.urgent > 0 ? 'bg-orange-100 text-orange-700 border-orange-200' : 'bg-gray-50 text-gray-400 border-gray-200'
                    }`}>
                      {r.urgent > 0 && <Zap size={10} />}
                      {r.urgent || 0}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-2" style={{ minWidth: '80px' }}>
                        <div
                          className={`h-2 rounded-full transition-all ${rowPct >= 80 ? 'bg-emerald-500' : rowPct >= 50 ? 'bg-amber-500' : 'bg-red-400'}`}
                          style={{ width: `${rowPct}%` }}
                        />
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
    </div>
  );
}
