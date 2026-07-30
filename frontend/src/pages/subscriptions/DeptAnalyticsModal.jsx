import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, GraduationCap, Users, CalendarCheck, Search, Download } from 'lucide-react';
import api from '../../api/axios';
import { downloadCsv } from '../../utils/csv';

/**
 * Department Deliveries — analytics modal (per dept). Answers:
 *  1) how many clients have remaining levels,
 *  2) whether each is in an upcoming group,
 *  3) their last group + its level,
 *  4) how many graduate in a chosen date range.
 * Numbers come from /cs/deliveries/analytics (reuses the deliveries computation).
 */

const DEPT_LABEL = { General: 'جينرال', Semi: 'سيمي برايفت', Private: 'برايفت' };

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// The native date picker renders in the browser's locale, so "08/04/2026" is
// month-first for some users and day-first for others. We echo the picked value
// as an unambiguous Arabic date (day + month name + year) right under it.
function readableDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  return `${Number(m[3])} ${AR_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// A date range where "from" is after "to" would silently match almost nothing.
// Normalise so the smaller date is always the lower bound.
function orderRange(from, to) {
  if (from && to && from > to) return [to, from];
  return [from, to];
}

// Native date input + an unambiguous readable echo beneath it.
function DateField({ value, onChange }) {
  return (
    <span className="inline-flex flex-col">
      <input type="date" value={value} onChange={onChange}
        className="py-1.5 px-2 border border-slate-200 rounded-lg" dir="ltr" />
      <span className="text-[10px] text-slate-400 text-center mt-0.5 h-3">{readableDate(value)}</span>
    </span>
  );
}

export default function DeptAnalyticsModal({ dept, onClose }) {
  const [gradFrom, setGradFrom] = useState('');
  const [gradTo, setGradTo] = useState('');

  // Client-list filters (applied client-side on the loaded rows).
  const [fSearch, setFSearch] = useState('');
  const [fUpcoming, setFUpcoming] = useState('');   // '' | 'yes' | 'no'
  const [fRemMin, setFRemMin] = useState('');
  const [fRemMax, setFRemMax] = useState('');
  const [fLevel, setFLevel] = useState('');
  const [fLastFrom, setFLastFrom] = useState('');
  const [fLastTo, setFLastTo] = useState('');

  // Reversed range → no silent near-empty result; treat smaller date as lower.
  const [gFrom, gTo] = orderRange(gradFrom, gradTo);
  const q = useQuery({
    queryKey: ['dept-analytics', dept, gFrom, gTo],
    queryFn: () => api.get('/cs/deliveries/analytics', {
      params: { dept, grad_from: gFrom, grad_to: gTo },
    }).then(r => r.data),
    keepPreviousData: true,
  });
  const data = q.data || {};
  const clients = data.clients || [];
  const graduating = data.graduating || [];

  // Distinct levels present (for the level dropdown), sorted.
  const levels = [...new Set(clients.map(c => c.last_level).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), 'ar'));

  const remMin = fRemMin === '' ? null : Number(fRemMin);
  const remMax = fRemMax === '' ? null : Number(fRemMax);
  const filteredClients = clients.filter(c => {
    if (fSearch) {
      const s = fSearch.trim().toLowerCase();
      if (!(String(c.name || '').toLowerCase().includes(s) || String(c.phone || '').includes(s))) return false;
    }
    if (fUpcoming === 'yes' && !c.in_upcoming) return false;
    if (fUpcoming === 'no' && c.in_upcoming) return false;
    if (remMin != null && (c.remaining == null || c.remaining < remMin)) return false;
    if (remMax != null && (c.remaining == null || c.remaining > remMax)) return false;
    if (fLevel && c.last_level !== fLevel) return false;
    const [lFrom, lTo] = orderRange(fLastFrom, fLastTo);
    if (lFrom && (!c.last_date || c.last_date < lFrom)) return false;
    if (lTo && (!c.last_date || c.last_date > lTo)) return false;
    return true;
  });
  const anyFilter = fSearch || fUpcoming || fRemMin !== '' || fRemMax !== '' || fLevel || fLastFrom || fLastTo;
  const clearFilters = () => {
    setFSearch(''); setFUpcoming(''); setFRemMin(''); setFRemMax(''); setFLevel(''); setFLastFrom(''); setFLastTo('');
  };

  const exportCsv = () => {
    const headers = ['العميل', 'الموبايل', 'المتبقّي', 'مجموعة قادمة؟', 'آخر مجموعة', 'المستوى', 'آخر محاضرة'];
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = filteredClients.map(c => [
      c.name, c.phone, c.remaining, c.in_upcoming ? 'نعم' : 'لا', c.last_group, c.last_level, c.last_date,
    ]);
    const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n');
    downloadCsv(csv, `تحليلات-${dept}-متبقي-مستويات.csv`);
  };

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
                <DateField value={gradFrom} onChange={e => setGradFrom(e.target.value)} />
                <span>→</span>
                <DateField value={gradTo} onChange={e => setGradTo(e.target.value)} />
                <span className="text-[10px] text-slate-400 mr-1">(شهر/يوم/سنة)</span>
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
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <div className="text-sm font-semibold text-slate-700">
                العملاء الذين لهم مستويات متبقية ({anyFilter ? `${filteredClients.length} من ${clients.length}` : clients.length})
              </div>
              <button onClick={exportCsv} disabled={!filteredClients.length}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                <Download className="w-3.5 h-3.5" /> تصدير Excel ({filteredClients.length})
              </button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <div className="relative">
                <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input value={fSearch} onChange={e => setFSearch(e.target.value)} placeholder="ابحث بالاسم أو الموبايل..."
                  className="pr-8 pl-3 py-1.5 text-xs border border-slate-200 rounded-lg w-56 focus:outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
              <select value={fUpcoming} onChange={e => setFUpcoming(e.target.value)}
                className="py-1.5 px-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-200">
                <option value="">مجموعة قادمة: الكل</option>
                <option value="yes">على مجموعة قادمة</option>
                <option value="no">بلا مجموعة قادمة</option>
              </select>
              <select value={fLevel} onChange={e => setFLevel(e.target.value)}
                className="py-1.5 px-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-200 max-w-[10rem]">
                <option value="">كل المستويات</option>
                {levels.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <span>المتبقّي:</span>
                <input type="number" min="0" value={fRemMin} onChange={e => setFRemMin(e.target.value)} placeholder="من"
                  className="w-14 py-1.5 px-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" />
                <span>→</span>
                <input type="number" min="0" value={fRemMax} onChange={e => setFRemMax(e.target.value)} placeholder="إلى"
                  className="w-14 py-1.5 px-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <span className="whitespace-nowrap">آخر محاضرة:</span>
                <DateField value={fLastFrom} onChange={e => setFLastFrom(e.target.value)} />
                <span>→</span>
                <DateField value={fLastTo} onChange={e => setFLastTo(e.target.value)} />
                <span className="text-[10px] text-slate-400 mr-1">(شهر/يوم/سنة)</span>
              </div>
              {anyFilter && (
                <button onClick={clearFilters} className="px-3 py-1.5 text-xs rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">مسح الفلاتر</button>
              )}
            </div>

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
                  {filteredClients.map((c, i) => (
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
                  {!q.isLoading && filteredClients.length === 0 && (
                    <tr><td colSpan={6} className="px-2 py-8 text-center text-slate-400">
                      {clients.length === 0 ? 'لا يوجد عملاء لهم مستويات متبقية' : 'لا يوجد عملاء مطابقون للفلاتر'}
                    </td></tr>
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
