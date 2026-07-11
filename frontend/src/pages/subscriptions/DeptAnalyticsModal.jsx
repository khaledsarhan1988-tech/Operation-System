import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, GraduationCap, Users, CalendarCheck } from 'lucide-react';
import api from '../../api/axios';

/**
 * Department Deliveries — analytics modal (per dept). Answers:
 *  1) how many clients have remaining levels,
 *  2) whether each is in an upcoming group,
 *  3) their last group + its level,
 *  4) how many graduate in a chosen date range.
 * Numbers come from /cs/deliveries/analytics (reuses the deliveries computation).
 */

const DEPT_LABEL = { General: 'جينرال', Semi: 'سيمي برايفت', Private: 'برايفت' };

export default function DeptAnalyticsModal({ dept, onClose }) {
  const [gradFrom, setGradFrom] = useState('');
  const [gradTo, setGradTo] = useState('');

  const q = useQuery({
    queryKey: ['dept-analytics', dept, gradFrom, gradTo],
    queryFn: () => api.get('/cs/deliveries/analytics', {
      params: { dept, grad_from: gradFrom, grad_to: gradTo },
    }).then(r => r.data),
    keepPreviousData: true,
  });
  const data = q.data || {};
  const clients = data.clients || [];
  const graduating = data.graduating || [];

  const Stat = ({ icon: Icon, label, value, cls }) => (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${cls}`}>
      <Icon className="w-5 h-5 flex-shrink-0" />
      <div>
        <div className="text-2xl font-bold leading-none">{q.isLoading ? '…' : value}</div>
        <div className="text-xs mt-1 opacity-80">{label}</div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="font-semibold text-slate-800 flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-violet-600" /> تحليلات القسم — {DEPT_LABEL[dept] || dept}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* KPIs (Q1 + Q2) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat icon={Users} label="عملاء لهم مستويات متبقية" value={data.total_with_remaining ?? 0}
              cls="bg-amber-50 text-amber-800 border-amber-200" />
            <Stat icon={CalendarCheck} label="منهم على مجموعة قادمة" value={data.with_remaining_in_upcoming ?? 0}
              cls="bg-emerald-50 text-emerald-800 border-emerald-200" />
            <Stat icon={CalendarCheck} label="منهم بلا مجموعة قادمة" value={data.with_remaining_not_upcoming ?? 0}
              cls="bg-rose-50 text-rose-800 border-rose-200" />
          </div>

          {/* Q4 — graduating in a date range */}
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-slate-700">التخرج في الفترة:</span>
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <span>من</span>
                <input type="date" value={gradFrom} onChange={e => setGradFrom(e.target.value)}
                  className="py-1.5 px-2 border border-slate-200 rounded-lg" dir="ltr" />
                <span>→</span>
                <input type="date" value={gradTo} onChange={e => setGradTo(e.target.value)}
                  className="py-1.5 px-2 border border-slate-200 rounded-lg" dir="ltr" />
              </div>
              <span className="inline-flex items-center gap-2 mr-auto text-sm">
                <span className="text-slate-500">هيتخرجوا:</span>
                <span className="inline-flex items-center justify-center min-w-8 px-3 py-1 rounded-full bg-violet-100 text-violet-700 text-lg font-bold">
                  {q.isLoading ? '…' : (data.graduating_count ?? 0)}
                </span>
              </span>
            </div>
            {(gradFrom || gradTo) && graduating.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead><tr className="text-slate-500 border-b border-slate-100">
                    <th className="px-2 py-2 font-medium">العميل</th>
                    <th className="px-2 py-2 font-medium">آخر مجموعة</th>
                    <th className="px-2 py-2 font-medium">المستوى</th>
                    <th className="px-2 py-2 font-medium">تاريخ التخرج (آخر محاضرة)</th>
                  </tr></thead>
                  <tbody>
                    {graduating.map((g, i) => (
                      <tr key={(g.phone || i) + ''} className="border-b border-slate-50">
                        <td className="px-2 py-2"><div className="text-slate-800">{g.name || '—'}</div><div className="text-slate-400 font-mono" dir="ltr">{g.phone}</div></td>
                        <td className="px-2 py-2 font-mono text-slate-600 break-all max-w-[16rem]">{g.last_group || '—'}</td>
                        <td className="px-2 py-2 text-slate-700">{g.last_level || '—'}</td>
                        <td className="px-2 py-2 font-mono text-slate-600" dir="ltr">{g.grad_date || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Q3 — clients with remaining levels: upcoming? + last group + level */}
          <div>
            <div className="text-sm font-semibold text-slate-700 mb-2">العملاء الذين لهم مستويات متبقية ({clients.length})</div>
            <div className="overflow-x-auto border border-slate-100 rounded-xl">
              <table className="w-full text-xs text-right">
                <thead><tr className="text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-2 py-2.5 font-medium">العميل</th>
                  <th className="px-2 py-2.5 font-medium">المتبقّي</th>
                  <th className="px-2 py-2.5 font-medium">مجموعة قادمة؟</th>
                  <th className="px-2 py-2.5 font-medium">آخر مجموعة</th>
                  <th className="px-2 py-2.5 font-medium">المستوى</th>
                  <th className="px-2 py-2.5 font-medium">آخر محاضرة</th>
                </tr></thead>
                <tbody>
                  {clients.map((c, i) => (
                    <tr key={(c.phone || i) + ''} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-2 py-2"><div className="text-slate-800">{c.name || '—'}</div><div className="text-slate-400 font-mono" dir="ltr">{c.phone}</div></td>
                      <td className="px-2 py-2 text-center">
                        <span className="inline-flex items-center justify-center min-w-6 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-semibold">{c.remaining}</span>
                      </td>
                      <td className="px-2 py-2">
                        {c.in_upcoming
                          ? <span className="text-[11px] rounded-full px-2 py-0.5 border bg-emerald-50 text-emerald-700 border-emerald-200">نعم</span>
                          : <span className="text-[11px] rounded-full px-2 py-0.5 border bg-rose-50 text-rose-700 border-rose-200">لا</span>}
                      </td>
                      <td className="px-2 py-2 font-mono text-slate-600 break-all max-w-[16rem]">{c.last_group || '—'}</td>
                      <td className="px-2 py-2 text-slate-700">{c.last_level || '—'}</td>
                      <td className="px-2 py-2 font-mono text-slate-500" dir="ltr">{c.last_date || '—'}</td>
                    </tr>
                  ))}
                  {!q.isLoading && clients.length === 0 && (
                    <tr><td colSpan={6} className="px-2 py-8 text-center text-slate-400">لا يوجد عملاء لهم مستويات متبقية</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
