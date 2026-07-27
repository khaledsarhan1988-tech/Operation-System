import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Grid3x3, Search, RefreshCw, AlertCircle, Activity, UserCircle, ClipboardCheck } from 'lucide-react';
import api from '../../api/axios';

// Column identity for the monitoring matrix: the same task shared by several
// employees is ONE column, even though each employee owns a distinct template row.
const colKey = (t) => `${(t.title || '').trim()}|${t.due_time || ''}`;

/**
 * PerformanceMatrix — «متابعة القوالب اليومية لكل موظف».
 *
 * Shared between the admin dashboard and every team-leader page. The
 * /todos/templates-performance endpoint is already role-scoped server-side
 * (admin → their management, leader → their own team), so the SAME component
 * shows each viewer exactly their people with no client-side filtering needed.
 *
 * Props:
 *   onCellClick(instanceId) — called when a cell with a real instance is
 *     clicked; the parent opens its own task-detail modal (so this component
 *     stays modal-agnostic and both pages reuse their existing modal).
 *   emptyHint — small helper line shown when there are no active templates.
 */
export default function PerformanceMatrix({ onCellClick, emptyHint }) {
  const [windowDays, setWindowDays] = useState(7);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [searchEmp, setSearchEmp] = useState('');
  const qc = useQueryClient();
  const hasRange = !!(rangeFrom || rangeTo);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['todos', 'templates-performance', windowDays, rangeFrom, rangeTo],
    queryFn: () => api.get('/todos/templates-performance', {
      // An explicit range wins over the rolling "last N days" preset.
      params: hasRange
        ? { ...(rangeFrom ? { from: rangeFrom } : {}), ...(rangeTo ? { to: rangeTo } : {}) }
        : { days: windowDays },
    }).then(r => r.data),
    staleTime: 30 * 1000,
  });

  const filteredEmployees = useMemo(() => {
    if (!data?.employees) return [];
    const q = searchEmp.trim().toLowerCase();
    if (!q) return data.employees;
    return data.employees.filter(e => (e.user_name || '').toLowerCase().includes(q));
  }, [data, searchEmp]);

  // Column set = UNION of every employee's templates (keyed by title+time).
  const columns = useMemo(() => {
    const map = new Map();
    for (const e of data?.employees || []) {
      for (const t of e.templates || []) {
        const key = colKey(t);
        if (!map.has(key)) map.set(key, { key, title: t.title, due_time: t.due_time, retired: t.is_retired });
        else if (!t.is_retired) map.get(key).retired = false;
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.due_time || '99:99').localeCompare(b.due_time || '99:99')
      || (a.title || '').localeCompare(b.title || '')
    );
  }, [data]);

  function cellStyle(today) {
    if (!today) return 'bg-gray-50 text-gray-400';
    if (today.status === 'completed')   return 'bg-emerald-100 text-emerald-700 border-emerald-300';
    if (today.status === 'in_progress') return 'bg-blue-100 text-blue-700 border-blue-300';
    if (today.status === 'cancelled')   return 'bg-gray-100 text-gray-500 border-gray-300';
    if (today.is_overdue)               return 'bg-red-100 text-red-700 border-red-300';
    if (today.status === 'on_hold')     return 'bg-amber-100 text-amber-700 border-amber-300';
    return 'bg-blue-50 text-blue-600 border-blue-200';
  }
  function cellIcon(today) {
    if (!today) return '·';
    if (today.status === 'completed')   return '✓';
    if (today.status === 'in_progress') return '⏳';
    if (today.status === 'cancelled')   return '×';
    if (today.is_overdue)               return '!';
    if (today.status === 'on_hold')     return '⏸';
    return '○';
  }
  function rateColor(rate) {
    if (rate >= 80) return 'bg-emerald-500 text-white';
    if (rate >= 50) return 'bg-amber-500 text-white';
    if (rate > 0)   return 'bg-orange-500 text-white';
    return 'bg-red-500 text-white';
  }

  return (
    <div className="space-y-4">
      {/* Header / controls */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
              <Grid3x3 size={18} className="text-orange-500" />
              متابعة القوالب اليومية لكل موظف
            </h3>
            {data && (
              <p className="text-xs text-gray-500 mt-0.5">
                {data.total_employees} موظف · {data.total_templates} قالب نشط · إحصائيات{' '}
                {data.custom_range
                  ? <>من <b>{data.window_start}</b> إلى <b>{data.window_end}</b> ({data.window_days} يوم)</>
                  : <>آخر {data.window_days} أيام</>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text" value={searchEmp} onChange={e => setSearchEmp(e.target.value)}
                placeholder="بحث بالاسم..."
                className="pl-3 pr-8 py-1.5 rounded-lg border border-gray-300 text-sm w-44"
              />
            </div>
            <select value={windowDays} onChange={e => setWindowDays(parseInt(e.target.value))}
              disabled={hasRange}
              title={hasRange ? 'معطّل — في مدى تاريخ محدد' : ''}
              className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400">
              <option value={1}>اليوم فقط</option>
              <option value={3}>آخر 3 أيام</option>
              <option value={7}>آخر 7 أيام</option>
              <option value={14}>آخر 14 يوم</option>
              <option value={30}>آخر 30 يوم</option>
            </select>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-gray-500">من</span>
              <input type="date" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-gray-300 text-xs" />
              <span className="text-xs font-bold text-gray-500">إلى</span>
              <input type="date" value={rangeTo} onChange={e => setRangeTo(e.target.value)}
                min={rangeFrom || undefined}
                className="px-2 py-1.5 rounded-lg border border-gray-300 text-xs" />
              {hasRange && (
                <button onClick={() => { setRangeFrom(''); setRangeTo(''); }}
                  className="text-[11px] text-rose-500 font-bold hover:underline">مسح</button>
              )}
            </div>
            <button onClick={() => qc.invalidateQueries({ queryKey: ['todos', 'templates-performance'] })}
              className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50">
              <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-300 font-bold">✓ مكتملة</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-300 font-bold">⏳ قيد التنفيذ</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200 font-bold">○ لسه ما بدأتش</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-700 border border-red-300 font-bold">! متأخرة (فات وقتها)</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300 font-bold">⏸ معلّقة</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-50 text-gray-400 border border-gray-200 font-bold">· ما اتعملش</span>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-2xl p-12 text-center text-gray-400">جاري التحميل...</div>
      ) : !data?.employees?.length ? (
        <div className="bg-white rounded-2xl p-12 text-center">
          <ClipboardCheck size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-bold mb-1">لا توجد قوالب يومية مفعّلة</p>
          {emptyHint && <p className="text-xs text-gray-400">{emptyHint}</p>}
        </div>
      ) : (
        <>
          {/* Templates summary — رؤوس الأعمدة */}
          {data.templates_summary?.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
              <h4 className="font-bold text-gray-800 text-sm mb-3 flex items-center gap-2">
                <Activity size={14} className="text-violet-500" />
                ملخص القوالب اليومية ({data.templates_summary.length})
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {data.templates_summary.map((t, i) => (
                  <div key={i} className="bg-gradient-to-br from-violet-50 to-white border border-violet-200 rounded-lg p-2.5">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-bold text-gray-800 truncate" title={t.title}>{t.title}</span>
                      <span className="text-[10px] text-violet-600 font-mono whitespace-nowrap">{t.due_time || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-gray-600">
                        {t.completed_today} / {t.total_assigned} موظف
                      </span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${rateColor(t.completion_rate)}`}>
                        {t.completion_rate}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Matrix */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-start font-bold text-gray-700 sticky right-0 bg-gray-50 z-10 min-w-[180px] border-l border-gray-200">
                      الموظف
                    </th>
                    <th className="px-2 py-2 text-center font-bold text-gray-700 whitespace-nowrap">
                      {data?.custom_range && data?.reference_date && data.reference_date !== data.date
                        ? <>يوم<br /><span className="text-[9px] font-mono text-gray-400">{data.reference_date}</span></>
                        : 'اليوم'}
                    </th>
                    <th className="px-2 py-2 text-center font-bold text-gray-700 whitespace-nowrap">
                      {data?.custom_range ? `المدى (${data.window_days} يوم)` : `آخر ${data?.window_days ?? windowDays} يوم`}
                    </th>
                    {columns.map(c => (
                      <th key={c.key} className="px-2 py-2 text-center font-bold text-gray-700 whitespace-nowrap min-w-[70px]">
                        <div className="text-[10px] truncate max-w-[100px]" title={c.title}>{c.title}</div>
                        <div className="text-[9px] text-gray-400 font-mono">{c.due_time || '—'}</div>
                        {c.retired && (
                          <div className="text-[8px] text-gray-400 font-bold" title="اتوقفت من الجدول — معروضة عشان فيها شغل متسجّل في الفترة دي">
                            متوقّفة
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map(emp => {
                    const winTotal = emp.templates.reduce((s, t) => s + (t.stats_window?.total || 0), 0);
                    const winDone  = emp.templates.reduce((s, t) => s + (t.stats_window?.completed || 0), 0);
                    const winRate  = winTotal > 0 ? Math.round((winDone / winTotal) * 100) : 0;
                    return (
                      <tr key={emp.user_id} className="border-t border-gray-100 hover:bg-orange-50/30">
                        <td className="px-3 py-2 sticky right-0 bg-white hover:bg-orange-50/30 z-10 border-l border-gray-200">
                          <div className="flex items-center gap-2">
                            <UserCircle size={14} className="text-gray-400 flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="font-bold text-gray-800 text-xs truncate">{emp.user_name}</p>
                              {emp.department && (
                                <p className="text-[10px] text-gray-500 truncate">{emp.department}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <div className={`inline-flex items-center justify-center w-12 h-7 rounded-md text-xs font-black ${rateColor(emp.today_rate)}`}>
                            {emp.today_rate}%
                          </div>
                          <p className="text-[9px] text-gray-500 mt-0.5">{emp.today_completed}/{emp.today_total}</p>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <div className={`inline-flex items-center justify-center w-12 h-7 rounded-md text-xs font-black ${rateColor(winRate)}`}>
                            {winRate}%
                          </div>
                          <p className="text-[9px] text-gray-500 mt-0.5">{winDone}/{winTotal}</p>
                        </td>
                        {(() => {
                          const byKey = new Map(emp.templates.map(t => [colKey(t), t]));
                          return columns.map(c => {
                            const t = byKey.get(c.key);
                            if (!t) {
                              return (
                                <td key={c.key} className="px-1 py-1.5 text-center">
                                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg border border-dashed border-gray-200 text-gray-300 text-[10px]"
                                       title={`${c.title} — مش مسندة للموظف ده`}>—</div>
                                </td>
                              );
                            }
                            const hasInstance = !!t.today?.instance_id;
                            return (
                              <td key={c.key} className="px-1 py-1.5 text-center">
                                <button
                                  type="button"
                                  disabled={!hasInstance}
                                  onClick={() => hasInstance && onCellClick?.(t.today.instance_id)}
                                  className={`inline-flex flex-col items-center justify-center w-12 h-12 rounded-lg border transition ${cellStyle(t.today)} ${
                                    hasInstance ? 'cursor-pointer hover:ring-2 hover:ring-orange-400 hover:scale-105' : 'cursor-default'}`}
                                  title={`${t.title} (${t.due_time || '—'})${t.is_retired ? '\n⏸ اتوقفت من الجدول — الشغل ده متسجّل قبل الإيقاف' : ''}\nاليوم: ${t.today.status}${t.today.is_overdue ? ' — متأخرة' : ''}\n${data?.custom_range ? `${data.window_start} → ${data.window_end}` : `آخر ${data?.window_days ?? windowDays} يوم`}: ${t.stats_window.completed}/${t.stats_window.total} (${t.stats_window.rate}%)${hasInstance ? '\n\n🔍 اضغط لكل التفاصيل والتعليقات' : ''}`}
                                >
                                  <span className="text-base leading-none font-bold">{cellIcon(t.today)}</span>
                                  {t.stats_window.total > 0 && (
                                    <span className="text-[8px] mt-0.5 font-bold opacity-70">{t.stats_window.rate}%</span>
                                  )}
                                </button>
                              </td>
                            );
                          });
                        })()}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[11px] text-gray-500 px-2 flex items-start gap-1.5">
            <AlertCircle size={12} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <span>
              <b>اضغط على أي مربع</b> لفتح كل تفاصيل المهمة — الحالة، اتعملت إمتى بالظبط، والتعليقات.
              التمرير بالماوس بيعرض ملخص سريع + معدل الإنجاز خلال {data?.custom_range ? `المدى المحدد (${data.window_start} → ${data.window_end})` : `آخر ${data?.window_days ?? windowDays} أيام`}.
              المهام "المتأخرة" هي اللي فات وقتها (due_time) ومش متعملة لسه.
            </span>
          </p>
        </>
      )}
    </div>
  );
}
