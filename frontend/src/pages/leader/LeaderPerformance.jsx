import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart2, CheckCircle, Clock, AlertTriangle, Zap, Search, Calendar } from 'lucide-react';
import api from '../../api/axios';
import PageHero, { HeroStatPill } from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';

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

  const filterEl = (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl px-3 py-1.5">
        <Search size={13} className="text-white/70" />
        <input
          type="text"
          placeholder="بحث باسم المنسق..."
          value={coord}
          onChange={e => setCoord(e.target.value)}
          className="bg-transparent text-white placeholder-white/50 text-xs font-bold focus:outline-none w-44"
        />
      </div>
      <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl px-3 py-1.5">
        <Calendar size={13} className="text-white/70" />
        <span className="text-[10px] text-white/60 font-bold">من</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="bg-transparent text-white text-xs font-bold focus:outline-none border-0 p-0" />
        <span className="text-[10px] text-white/60 font-bold">إلى</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="bg-transparent text-white text-xs font-bold focus:outline-none border-0 p-0" />
      </div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="أداء الفريق"
        subtitle="إحصائيات أداء كل موظف"
        icon={BarChart2}
        gradient="navy"
        actions={filterEl}
        stats={[
          { label: 'إجمالي المهام', value: totalTasks, icon: BarChart2 },
          { label: 'مكتملة',         value: totalDone,    icon: CheckCircle, suffix: ` (${pct}%)` },
          { label: 'قيد التنفيذ',   value: totalPending, icon: Clock },
          { label: 'متأخرة',         value: totalOverdue, icon: AlertTriangle },
        ]}
      />

      {/* Table */}
      <SectionCard
        title="تفاصيل أداء الموظفين"
        icon={BarChart2}
        accent="indigo"
        noBodyPad
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead>
              <tr className="bg-gray-50/60 border-b border-gray-100">
                {['الموظف', 'إجمالي المهام', 'مكتملة', 'قيد التنفيذ', 'متأخرة', 'عاجلة', 'نسبة الإنجاز'].map(h => (
                  <th key={h} className="px-5 py-3 text-xs font-black text-gray-500 whitespace-nowrap">{h}</th>
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
                <tr><td colSpan={7} className="p-0">
                  <EmptyState
                    icon={BarChart2}
                    accent="gray"
                    title="لا توجد بيانات"
                    message="لم يتم العثور على نتائج بالفلاتر الحالية. جرّب تعديلها أو مسحها."
                  />
                </td></tr>
              ) : data.map((r, i) => {
                const rowPct = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
                return (
                  <tr key={i} className="hover:bg-gray-50/40 transition-colors">
                    <td className="px-5 py-4 font-black text-gray-900">{r.name}</td>
                    <td className="px-5 py-4 text-gray-700 font-black">{(r.total || 0).toLocaleString()}</td>
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
                        <span className="text-xs font-black text-gray-600 w-9 text-left">{rowPct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
