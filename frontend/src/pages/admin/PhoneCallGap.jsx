'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PhoneCall, AlertTriangle, Users, TrendingDown, Search, UserPlus, CalendarPlus, CheckCircle2 } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import EmptyState from '../../components/ui/EmptyState';

const SECTIONS = { all: 'كل الأقسام', general: 'عام', semi: 'شبه خاص', private: 'خاص' };
const SEC_TONE = {
  general: 'border-blue-200 bg-blue-50 text-blue-800',
  semi:    'border-amber-200 bg-amber-50 text-amber-800',
  private: 'border-violet-200 bg-violet-50 text-violet-800',
};
const num = n => (n ?? 0).toLocaleString('en-US');

export default function PhoneCallGap() {
  const [section, setSection] = useState('all');
  const [callsPerHour, setCallsPerHour] = useState(4);
  const [onlyGap, setOnlyGap] = useState(true);
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['phone-call-gap', section, callsPerHour],
    queryFn: () => api.get('/reports/phone-call-gap', {
      params: { section, calls_per_hour: callsPerHour },
    }).then(r => r.data),
    staleTime: 60 * 1000,
  });

  const totals = data?.totals || {};
  const sections = data?.sections || [];
  const rows = useMemo(() => {
    let r = data?.groups || [];
    if (onlyGap) r = r.filter(x => x.gap > 0);
    if (q.trim()) { const s = q.trim().toLowerCase(); r = r.filter(x => (x.group_name || '').toLowerCase().includes(s) || (x.coordinator || '').toLowerCase().includes(s)); }
    return r;
  }, [data, onlyGap, q]);

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="فجوة الفون كول"
        subtitle="المطلوب من جلسات الفون كول (متدربين × 7) مقابل الموجود فعلًا — لكل قسم + كام مدرّب ناقص"
        icon={PhoneCall}
        gradient="rose"
      />

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">القسم</span>
          <select value={section} onChange={e => setSection(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 font-semibold text-gray-700 bg-gray-50">
            {Object.entries(SECTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">مكالمات/ساعة عمل</span>
          <input type="number" min="1" value={callsPerHour} onChange={e => setCallsPerHour(Math.max(1, +e.target.value || 1))} className="w-16 px-2 py-2 rounded-lg border border-gray-200 text-center" />
        </div>
        <label className="flex items-center gap-1.5 text-xs font-bold text-gray-500 cursor-pointer">
          <input type="checkbox" checked={onlyGap} onChange={e => setOnlyGap(e.target.checked)} /> العجز فقط
        </label>
        <div className="relative mr-auto">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="مجموعة / منسق..." className="pr-8 pl-2 py-2 rounded-lg border border-gray-200 text-xs w-52" />
        </div>
      </div>

      {/* Top summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SumCard icon={Users} label="مجموعات" value={num(totals.groups)} tone="bg-white border-gray-200 text-gray-800" />
        <SumCard icon={PhoneCall} label="مطلوب / موجود" value={`${num(totals.required)} / ${num(totals.actual)}`} tone="bg-white border-gray-200 text-gray-800" />
        <SumCard icon={CalendarPlus} label="جلسات ناقصة (محتاجة جدولة)" value={num(totals.gap)} tone="bg-rose-50 border-rose-200 text-rose-800" />
        <SumCard icon={UserPlus} label="مدربين ناقصين (سعة)" value={num(totals.trainers_needed)} tone="bg-emerald-50 border-emerald-200 text-emerald-800" />
      </div>

      {/* Interpretation banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-[12px] text-blue-800 flex items-start gap-2">
        <AlertTriangle size={15} className="text-blue-500 shrink-0 mt-0.5" />
        <span>
          <b>«جلسات ناقصة»</b> = جلسات فون كول المفروض تتعمل ولسه ماتجدولتش.{' '}
          <b>«مدربين ناقصين»</b> = الناقص فعلًا في السعة (ذروة الطلب الأسبوعي مقابل سعة المدربين الحاليين).{' '}
          لو «مدربين ناقصين = 0» والسعة تكفي ⟵ <b>العجز محتاج جدولة مش تعيين.</b>
        </span>
      </div>

      {/* Per-section cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {sections.map(s => (
          <div key={s.section} className={`rounded-2xl border p-4 ${SEC_TONE[s.section] || 'border-gray-200 bg-white'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-black text-base">{s.label}</span>
              <span className="text-[11px] opacity-70">{s.groups} مجموعة</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center mb-3">
              <Mini label="مطلوب" value={num(s.required)} />
              <Mini label="موجود" value={num(s.actual)} />
              <Mini label="ناقصة جدولة" value={num(s.gap)} strong />
            </div>
            <div className="text-[11px] space-y-1 border-t border-current/10 pt-2">
              <div>السعة: <b>{s.capacity_trainers}</b> مدرب × {s.per_trainer_weekly_calls} = <b>{num(s.capacity_weekly_calls)}</b> مكالمة/أسبوع</div>
              <div>ذروة الطلب: <b>{num(s.peak_weekly_demand)}</b> مكالمة/أسبوع {s.peak_week ? `(${s.peak_week})` : ''}</div>
              <div className="flex flex-wrap gap-x-3 opacity-80">{Object.entries(s.by_pair || {}).map(([k, v]) => <span key={k}>{k}: <b>{v}</b></span>)}</div>
              {s.capacity_sufficient ? (
                <div className="mt-1.5 inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 rounded-lg px-2 py-1 font-bold">
                  <CheckCircle2 size={13} /> السعة تكفي — العجز محتاج جدولة
                </div>
              ) : (
                <div className="mt-1.5 inline-flex items-center gap-1 bg-rose-100 text-rose-800 rounded-lg px-2 py-1 font-bold">
                  <UserPlus size={13} /> ناقص {s.trainers_needed} مدرب (عجز ذروة {num(s.peak_shortfall)}/أسبوع)
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Groups table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right" style={{ minWidth: '860px' }}>
            <thead><tr className="bg-gray-50 border-b border-gray-100 text-[11px] text-gray-500">
              {['المجموعة', 'القسم', 'المنسق', 'الطلاب', 'أيام الأساسي', 'أيام الفون كول', 'مطلوب', 'موجود', 'العجز'].map(h =>
                <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-10 text-gray-400">جارٍ التحميل…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="py-12"><EmptyState title="لا توجد مجموعات بعجز" /></td></tr>
              ) : rows.map((r, i) => (
                <tr key={i} className={`hover:bg-gray-50/60 ${r.gap > 0 ? 'bg-rose-50/30' : ''}`}>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-700 max-w-[240px] truncate" title={r.group_name} dir="ltr">{r.group_name}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${SEC_TONE[r.section]}`}>{SECTIONS[r.section]}</span></td>
                  <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{r.coordinator || '—'}</td>
                  <td className="px-3 py-2 text-center font-bold">{r.trainees}</td>
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{r.main_pair}</td>
                  <td className="px-3 py-2 text-xs text-blue-700 whitespace-nowrap font-semibold">{r.side_pair}</td>
                  <td className="px-3 py-2 text-center">{r.required}</td>
                  <td className="px-3 py-2 text-center text-gray-600">{r.actual}</td>
                  <td className="px-3 py-2 text-center font-black text-rose-700">{r.gap || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && <div className="px-4 py-2 text-[11px] text-gray-400 border-t">عرض {rows.length} مجموعة</div>}
      </div>
    </div>
  );
}

function SumCard({ icon: Icon, label, value, tone }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold opacity-80 mb-1"><Icon size={13} />{label}</div>
      <div className="text-2xl font-black">{value}</div>
    </div>
  );
}
function Mini({ label, value, strong }) {
  return (
    <div className={`rounded-lg py-1.5 ${strong ? 'bg-white/80' : 'bg-white/50'}`}>
      <div className={`text-base font-black ${strong ? 'text-rose-700' : ''}`}>{value}</div>
      <div className="text-[10px] opacity-70">{label}</div>
    </div>
  );
}
