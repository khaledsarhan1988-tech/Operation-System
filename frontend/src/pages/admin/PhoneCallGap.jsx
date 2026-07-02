'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PhoneCall, AlertTriangle, Users, TrendingDown, Search, UserPlus, CalendarPlus, CheckCircle2, Lightbulb, X, Clock } from 'lucide-react';
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
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [onlyGap, setOnlyGap] = useState(true);
  const [q, setQ] = useState('');
  const [showSugg, setShowSugg] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['phone-call-gap', section, callsPerHour, from, to],
    queryFn: () => api.get('/reports/phone-call-gap', {
      params: { section, calls_per_hour: callsPerHour, from: from || undefined, to: to || undefined },
    }).then(r => r.data),
    staleTime: 60 * 1000,
  });

  const totals = data?.totals || {};
  const sections = data?.sections || [];
  const suggestions = data?.suggestions || [];
  // hourly demand bars for the chosen section (or summed across all)
  const hourlyBars = useMemo(() => {
    const h = data?.hourly; if (!h) return [];
    const acc = {};
    const keys = section === 'all' ? Object.keys(h) : [section];
    for (const k of keys) for (const { hour, calls } of (h[k] || [])) acc[hour] = (acc[hour] || 0) + calls;
    return Object.entries(acc).map(([hour, calls]) => ({ hour: +hour, calls })).sort((a, b) => a.hour - b.hour);
  }, [data, section]);
  const maxBar = Math.max(1, ...hourlyBars.map(b => b.calls));
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
          <span className="text-xs font-bold text-gray-500">من</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2 py-2 rounded-lg border border-gray-200 text-xs text-gray-700 bg-gray-50" />
          <span className="text-xs font-bold text-gray-500">إلى</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2 py-2 rounded-lg border border-gray-200 text-xs text-gray-700 bg-gray-50" />
          {(from || to) && <button onClick={() => { setFrom(''); setTo(''); }} className="text-[11px] text-rose-500 font-bold hover:underline">مسح</button>}
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
        <button onClick={() => setShowSugg(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold shadow-sm">
          <Lightbulb size={15} /> اقتراحات
        </button>
      </div>

      {/* Suggestion #4 — hourly demand shape */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3 text-sm font-bold text-gray-700">
          <Clock size={15} className="text-rose-500" /> توزيع جلسات الفون كول بالساعة
          <span className="text-[11px] font-normal text-gray-400">(الطلب القادم — يوضّح ساعات الذروة)</span>
        </div>
        {hourlyBars.length === 0 ? <div className="text-center text-gray-300 text-xs py-6">—</div> : (
          <div className="flex items-end gap-2 h-36" dir="ltr">
            {hourlyBars.map(b => (
              <div key={b.hour} className="flex-1 flex flex-col items-center justify-end gap-1">
                <span className="text-[10px] font-bold text-rose-700">{num(b.calls)}</span>
                <div className="w-full rounded-t bg-gradient-to-t from-rose-400 to-rose-300" style={{ height: `${Math.max(4, (b.calls / maxBar) * 100)}%` }} />
                <span className="text-[10px] text-gray-500">{String(b.hour).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 text-[11px] text-blue-700 bg-blue-50 rounded-lg px-3 py-1.5">
          الطلب مركّز مساءً (16:00–00:00) = نفس ساعات شيفت مدربي الفون كول. لو ساعة معيّنة عالية جدًا فوق الباقي ⟵ اختناق وقتي محتمل رغم اتساع الأسبوع.
        </div>
      </div>

      {/* Top summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SumCard icon={Users} label="مجموعات" value={num(totals.groups)} tone="bg-white border-gray-200 text-gray-800" />
        <SumCard icon={PhoneCall} label="مطلوب / موجود (مكالمات)" value={`${num(totals.required)} / ${num(totals.actual)}`} tone="bg-white border-gray-200 text-gray-800" />
        <SumCard icon={CalendarPlus} label="جلسات ناقصة (محتاجة جدولة)" value={num(totals.gap)} tone="bg-rose-50 border-rose-200 text-rose-800" />
        <SumCard icon={UserPlus} label="مدربين زوم ناقصين (سعة)" value={num(totals.trainers_needed)} tone="bg-emerald-50 border-emerald-200 text-emerald-800" />
      </div>

      {/* Per-section DAY-PAIR hours balance — the main view */}
      <div className="space-y-3">
        {sections.map(s => (
          <div key={s.section} className={`rounded-2xl border p-4 ${SEC_TONE[s.section] || 'border-gray-200 bg-white'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <span className="font-black text-base">{s.label}</span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                <span><b>{s.main_trainers}</b> مدرب أساسي <span className="opacity-70">({(s.main_trainer_days || []).join('، ') || '—'})</span></span>
                <span><b>{s.zoom_trainers}</b> مدرب زوم <span className="opacity-70">({(s.zoom_trainer_days || []).join('، ') || '—'})</span></span>
                <span className={`font-black px-2 py-0.5 rounded ${s.total_balance_hours >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                  الإجمالي: {s.total_balance_hours >= 0 ? `زيادة +${s.total_balance_hours}` : `عجز ${s.total_balance_hours}`}س/أسبوع
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]" style={{ minWidth: '520px' }}>
                <thead><tr className="text-[10px] opacity-70 border-b border-current/10">
                  <th className="text-right py-1.5 font-semibold">أيام الزوم كول</th>
                  <th className="py-1.5 font-semibold">مجموعات</th>
                  <th className="py-1.5 font-semibold">ساعات مطلوبة</th>
                  <th className="py-1.5 font-semibold">ساعات متاحة</th>
                  <th className="py-1.5 font-semibold">العجز / الزيادة</th>
                </tr></thead>
                <tbody>
                  {(s.day_balance || []).map((d, i) => (
                    <tr key={i} className="border-b border-current/5 last:border-0">
                      <td className="text-right py-2 font-bold text-blue-700">{d.side_pair}</td>
                      <td className="text-center">{d.groups}</td>
                      <td className="text-center font-semibold">{d.demand_hours}س</td>
                      <td className="text-center font-semibold">{d.supply_hours}س</td>
                      <td className="text-center">
                        <span className={`inline-block px-2 py-0.5 rounded font-black ${d.balance >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                          {d.balance >= 0 ? `زيادة +${d.balance}` : `عجز ${d.balance}`}س
                          {d.balance < 0 && <span className="opacity-70 font-normal"> (~{Math.ceil(-d.balance / 14)} مدرب)</span>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Interpretation banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-[12px] text-blue-800 flex items-start gap-2">
        <AlertTriangle size={15} className="text-blue-500 shrink-0 mt-0.5" />
        <span>
          <b>ساعات مطلوبة</b> = زوم كول لمجموعات القسم على أيامها (ذروة الأسبوع × ¼س للمكالمة).{' '}
          <b>ساعات متاحة</b> = ساعات عمل مدربي الزوم في نفس اليومين.{' '}
          <b>العجز في يوم معيّن</b> يحتاج مدرّب زوم على نفس اليومين — حتى لو الإجمالي زيادة (الفائض في أيام تانية مايغطّيش يوم ناقص).
        </span>
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

      {/* Suggestions side drawer */}
      {showSugg && (
        <div className="fixed inset-0 z-50 flex" dir="rtl">
          <div className="flex-1 bg-black/30" onClick={() => setShowSugg(false)} />
          <div className="w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl animate-slideIn">
            <div className="sticky top-0 bg-amber-500 text-white px-5 py-3 flex items-center justify-between">
              <span className="font-black flex items-center gap-2"><Lightbulb size={18} /> اقتراحات السعة</span>
              <button onClick={() => setShowSugg(false)} className="p-1 hover:bg-white/20 rounded"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-[12px] text-gray-500">
                لكل قسم: مدربو الأساسي → المجموعات → ساعات الفون كول المطلوبة على الأيام العكسية، مقابل سعة مدربي الفون كول.
              </p>
              {suggestions.map(s => (
                <div key={s.section} className={`rounded-2xl border p-4 ${SEC_TONE[s.section]}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-black text-base">{s.label}</span>
                    <span className="text-[11px] opacity-80">{s.main_trainers} مدرب أساسي</span>
                  </div>
                  <div className="text-[11px] opacity-80 mb-3">
                    متوسط {s.avg_students} طالب/مجموعة · مدة المجموعة {s.group_duration_h}س
                    {s.main_trainers_missing_shift > 0 && <span className="text-rose-600 font-bold"> · {s.main_trainers_missing_shift} بدون بيانات شيفت</span>}
                  </div>

                  {/* ACTUAL (reliable) */}
                  <div className="bg-white/70 rounded-xl p-3 mb-2">
                    <div className="text-[11px] font-black mb-1 flex items-center gap-1"><CheckCircle2 size={12} /> الواقعي (المجموعات الحالية)</div>
                    <div className="text-[12px]">{s.actual.current_groups} مجموعة · طلب <b>{num(s.actual.weekly_demand_calls)}</b> / سعة <b>{num(s.actual.capacity_weekly_calls)}</b> مكالمة/أسبوع</div>
                    <div className={`mt-1 inline-block text-[11px] font-bold px-2 py-0.5 rounded ${s.actual.sufficient ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                      {s.actual.sufficient ? 'السعة تكفي ✓' : `ناقص ${s.actual.trainers_needed} مدرب`}
                    </div>
                  </div>

                  {/* POTENTIAL (planning ceiling) */}
                  <div className="bg-white/50 rounded-xl p-3">
                    <div className="text-[11px] font-black mb-1 flex items-center gap-1"><TrendingDown size={12} /> النظري (لو الأساسي اشتغل بأقصى سعة)</div>
                    <div className="text-[12px]">أقصى {s.potential.max_groups} مجموعة · طلب <b>{num(s.potential.weekly_demand_calls)}</b> / سعة <b>{num(s.potential.capacity_weekly_calls)}</b> مكالمة/أسبوع</div>
                    <div className={`mt-1 inline-block text-[11px] font-bold px-2 py-0.5 rounded ${s.potential.shortfall === 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                      {s.potential.shortfall === 0 ? 'السعة تكفي ✓' : `عجز ${num(s.potential.shortfall)}/أسبوع ← ~${s.potential.trainers_needed} مدرب`}
                    </div>
                    <div className="mt-1.5 text-[10px] text-gray-500 flex items-start gap-1">
                      <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                      تقديري — سقف أقصى من ساعات الشيفت{s.main_trainers_missing_shift > 0 ? ` (ناقص ${s.main_trainers_missing_shift} مدرب بدون بيانات شيفت فالرقم أقل من الواقع)` : ''}.
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
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
