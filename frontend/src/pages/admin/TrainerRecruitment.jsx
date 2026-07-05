'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, PhoneCall, Users, Search, ChevronDown, ChevronLeft, GraduationCap, Filter, X, Clock, Scale, UserCheck, ArrowLeftRight } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import EmptyState from '../../components/ui/EmptyState';

const SECTIONS = { all: 'كل الأقسام', general: 'عام', semi: 'شبه خاص', private: 'خاص' };
const SEC_TONE = {
  general: 'border-blue-200 bg-blue-50 text-blue-800',
  semi:    'border-amber-200 bg-amber-50 text-amber-800',
  private: 'border-violet-200 bg-violet-50 text-violet-800',
};
// day_pair values name the PHONE-CALL (side) day-pair; side_key matches group_list.side_key
const DAY_PAIRS = {
  all:     { label: 'كل الأيام',      sideKey: null },
  sat_tue: { label: 'سبت + ثلاثاء',   sideKey: '6,2' },
  sun_wed: { label: 'أحد + أربعاء',   sideKey: '0,3' },
  mon_thu: { label: 'إثنين + خميس',   sideKey: '1,4' },
};
const STATUS_OPTS = { all: 'تشمل بانتظار التسجيل', active: 'نشطة فقط' };
// Main-lecture day-pair → the inverse (phone-call/side) day-pair. Picking a main
// pair is just another label for the same axis, so it maps to the side filter.
const MAIN_DAY_PAIRS = { all: 'كل الأيام', sat_tue: 'سبت + ثلاثاء', sun_wed: 'أحد + أربعاء', mon_thu: 'إثنين + خميس' };
const MAIN_TO_SIDE = { sat_tue: 'mon_thu', sun_wed: 'sat_tue', mon_thu: 'sun_wed' };
const effDayPair = (side, main) => (main && main !== 'all') ? MAIN_TO_SIDE[main] : side;
const num = n => (n ?? 0).toLocaleString('en-US');
// Is the group's FIRST lecture date within the window [from,to]? (inner filter rule)
const firstInRange = (first, from, to) => {
  if (!from && !to) return true;
  if (!first) return false;
  if (from && first < from) return false;
  if (to && first > to) return false;
  return true;
};

export default function TrainerRecruitment() {
  const [view, setView] = useState('demand');   // 'demand' (phase 1) | 'supply' (phase 2)
  const [section, setSection] = useState('all');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dayPair, setDayPair] = useState('all');
  const [mainDayPair, setMainDayPair] = useState('all');
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState({});   // trainer name → expanded?

  const { data, isLoading } = useQuery({
    queryKey: ['trainer-recruitment', section, from, to, dayPair, mainDayPair, status],
    queryFn: () => api.get('/reports/trainer-recruitment', {
      params: {
        section,
        from: from || undefined, to: to || undefined,
        day_pair: effDayPair(dayPair, mainDayPair) === 'all' ? undefined : effDayPair(dayPair, mainDayPair),
        status: status === 'active' ? 'active' : undefined,
      },
    }).then(r => r.data),
    staleTime: 60 * 1000,
  });

  const totals = data?.totals || {};
  const sections = data?.sections || [];
  const trainers = useMemo(() => {
    let t = data?.trainers || [];
    if (q.trim()) { const s = q.trim().toLowerCase(); t = t.filter(x => (x.name || '').toLowerCase().includes(s)); }
    return t;
  }, [data, q]);

  const anyGlobalFilter = from || to || dayPair !== 'all' || mainDayPair !== 'all' || status !== 'all';

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="توظيف المدربين"
        subtitle="الطلب على الفون كول اللي بتولّده مجموعات كل مدرب أساسي (طلاب × 7 معاد/شهر) على الأيام العكسية — أساس تقدير الاحتياج"
        icon={UserPlus}
        gradient="rose"
      />

      {/* View toggle: demand (phase 1) · supply (phase 2) · balance (phase 3) */}
      <div className="flex gap-2">
        <TabBtn active={view === 'demand'} onClick={() => setView('demand')} icon={PhoneCall} label="الطلب" />
        <TabBtn active={view === 'supply'} onClick={() => setView('supply')} icon={Clock} label="السعة" />
        <TabBtn active={view === 'balance'} onClick={() => setView('balance')} icon={Scale} label="الميزان" />
        <TabBtn active={view === 'cross'} onClick={() => setView('cross')} icon={ArrowLeftRight} label="خارج القسم" />
      </div>

      {view === 'supply' && <SupplyView />}
      {view === 'balance' && <BalanceView />}
      {view === 'cross' && <CrossSectionView />}

      {view === 'demand' && (<>
      {/* Global filters */}
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
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">يوم المحاضرات الأساسية</span>
          <select value={mainDayPair} onChange={e => { setMainDayPair(e.target.value); if (e.target.value !== 'all') setDayPair('all'); }} className="px-3 py-2 rounded-lg border border-gray-200 font-semibold text-gray-700 bg-gray-50">
            {Object.entries(MAIN_DAY_PAIRS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">يوم الفون كول</span>
          <select value={dayPair} onChange={e => { setDayPair(e.target.value); if (e.target.value !== 'all') setMainDayPair('all'); }} className="px-3 py-2 rounded-lg border border-gray-200 font-semibold text-gray-700 bg-gray-50">
            {Object.entries(DAY_PAIRS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">الحالة</span>
          <select value={status} onChange={e => setStatus(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 font-semibold text-gray-700 bg-gray-50">
            {Object.entries(STATUS_OPTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {anyGlobalFilter && (
          <button onClick={() => { setFrom(''); setTo(''); setDayPair('all'); setMainDayPair('all'); setStatus('all'); }} className="text-[11px] text-rose-500 font-bold hover:underline">مسح الفلاتر</button>
        )}
        <div className="relative mr-auto">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="اسم المدرب..." className="pr-8 pl-2 py-2 rounded-lg border border-gray-200 text-xs w-44" />
        </div>
      </div>

      {/* Top summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SumCard icon={Users}     label="مدربين أساسيين" value={num(totals.trainers)} tone="bg-white border-gray-200 text-gray-800" />
        <SumCard icon={GraduationCap} label="مجموعات" value={num(totals.groups)} tone="bg-white border-gray-200 text-gray-800" />
        <SumCard icon={Users}     label="طلاب" value={num(totals.students)} tone="bg-white border-gray-200 text-gray-800" />
        <SumCard icon={PhoneCall} label="طلب فون كول / شهر" value={num(totals.demand_month)} tone="bg-rose-50 border-rose-200 text-rose-800" />
      </div>

      {/* Per-section demand summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {sections.map(s => (
          <div key={s.section} className={`rounded-2xl border p-4 ${SEC_TONE[s.section] || 'border-gray-200 bg-white'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-black text-base">{s.label}</span>
              <span className="text-[11px] opacity-80">{s.trainers} مدرب · {s.groups} مجموعة · {num(s.students)} طالب</span>
            </div>
            <div className="text-[12px] mb-1">إجمالي طلب الفون كول: <b>{num(s.demand_month)}</b> معاد/شهر</div>
            <div className="space-y-0.5">
              {Object.entries(s.demand_by_side_pair || {}).filter(([, v]) => v > 0).map(([lbl, v]) => (
                <div key={lbl} className="flex items-center justify-between text-[11px] bg-white/60 rounded px-2 py-0.5">
                  <span className="font-semibold text-blue-700">{lbl}</span>
                  <span className="font-black">{num(v)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Interpretation banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-[12px] text-blue-800">
        كل طالب محتاج <b>7 معادات فون كول في الشهر</b>، بتتعمل على <b>الزوج العكسي</b> لأيام محاضراته الأساسية.
        الفلاتر فوق بتتحكّم في <b>كل الصفحة</b>؛ وجوّه كل مدرب في <b>فلتر مستقل</b> لمجموعاته لوحدها.
      </div>

      {/* Trainers table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right" style={{ minWidth: '820px' }}>
            <thead><tr className="bg-gray-50 border-b border-gray-100 text-[11px] text-gray-500">
              <th className="px-3 py-2.5 font-semibold w-8"></th>
              {['المدرب', 'القسم', 'مجموعات', 'طلاب', 'أزواج التدريس', 'طلب الفون كول (الأيام العكسية)'].map(h =>
                <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400">جارٍ التحميل…</td></tr>
              ) : trainers.length === 0 ? (
                <tr><td colSpan={7} className="py-12"><EmptyState title="لا يوجد مدربون بهذه الفلاتر" /></td></tr>
              ) : trainers.map((t) => {
                const isOpen = !!open[t.name];
                return (
                  <>
                    <tr key={t.name} className="hover:bg-gray-50/60 cursor-pointer" onClick={() => setOpen(o => ({ ...o, [t.name]: !o[t.name] }))}>
                      <td className="px-3 py-2 text-gray-400">{isOpen ? <ChevronDown size={15} /> : <ChevronLeft size={15} />}</td>
                      <td className="px-3 py-2 font-mono text-[12px] text-gray-800 whitespace-nowrap" dir="ltr">{t.name}</td>
                      <td className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${SEC_TONE[t.section]}`}>{t.section_label}</span></td>
                      <td className="px-3 py-2 text-center font-bold">{t.groups}</td>
                      <td className="px-3 py-2 text-center font-bold">{num(t.students)}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                        {(t.teach_pairs || []).map((p, i) => (
                          <span key={i} className="inline-block">{p.main_pair} <span className="text-gray-400">({p.students})</span>{i < t.teach_pairs.length - 1 ? '، ' : ''}</span>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {Object.entries(t.demand_by_side_pair || {}).map(([lbl, v], i, arr) => (
                          <span key={lbl} className="inline-block">
                            <span className="text-blue-700 font-semibold">{lbl}</span>: <b className="text-rose-700">{num(v)}</b>{i < arr.length - 1 ? ' · ' : ''}
                          </span>
                        ))}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={t.name + '_d'} className="bg-gray-50/40">
                        <td></td>
                        <td colSpan={6} className="px-3 py-2">
                          <TrainerGroups groups={t.group_list} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
        {trainers.length > 0 && <div className="px-4 py-2 text-[11px] text-gray-400 border-t">عرض {trainers.length} مدرب — اضغط على أي صف لتفاصيل مجموعاته</div>}
      </div>

      {data?.params?.groups_without_main_trainer > 0 && (
        <div className="text-[11px] text-gray-400 px-1">
          ملاحظة: {data.params.groups_without_main_trainer} مجموعة (ضمن الفلاتر الحالية) من غير مدرب أساسي على الشيت الحالي — مستبعدة من الجدول.
        </div>
      )}
      </>)}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold border transition ${active ? 'bg-rose-500 text-white border-rose-500 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
      <Icon size={15} /> {label}
    </button>
  );
}

// PHASE 2 — supply side: phone-call trainers' monthly call capacity (own filters).
function SupplyView() {
  const [section, setSection] = useState('all');
  const [dayPair, setDayPair] = useState('all');
  const [mainDayPair, setMainDayPair] = useState('all');
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['trainer-recruitment-supply', section, dayPair, mainDayPair],
    queryFn: () => api.get('/reports/trainer-recruitment-supply', {
      params: { section, day_pair: effDayPair(dayPair, mainDayPair) === 'all' ? undefined : effDayPair(dayPair, mainDayPair) },
    }).then(r => r.data),
    staleTime: 60 * 1000,
  });

  const totals = data?.totals || {};
  const sections = data?.sections || [];
  const trainers = useMemo(() => {
    let t = data?.trainers || [];
    if (q.trim()) { const s = q.trim().toLowerCase(); t = t.filter(x => (x.name || '').toLowerCase().includes(s)); }
    return t;
  }, [data, q]);

  return (
    <div className="space-y-5">
      {/* filters: section + day-pair + search */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">القسم</span>
          <select value={section} onChange={e => setSection(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 font-semibold text-gray-700 bg-gray-50">
            {Object.entries(SECTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">يوم المحاضرات الأساسية</span>
          <select value={mainDayPair} onChange={e => { setMainDayPair(e.target.value); if (e.target.value !== 'all') setDayPair('all'); }} className="px-3 py-2 rounded-lg border border-gray-200 font-semibold text-gray-700 bg-gray-50">
            {Object.entries(MAIN_DAY_PAIRS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">يوم الفون كول</span>
          <select value={dayPair} onChange={e => { setDayPair(e.target.value); if (e.target.value !== 'all') setMainDayPair('all'); }} className="px-3 py-2 rounded-lg border border-gray-200 font-semibold text-gray-700 bg-gray-50">
            {Object.entries(DAY_PAIRS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="relative mr-auto">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="اسم المدرب..." className="pr-8 pl-2 py-2 rounded-lg border border-gray-200 text-xs w-44" />
        </div>
      </div>

      {/* summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <SumCard icon={Users}     label="مدربين فون كول" value={num(totals.trainers)} tone="bg-white border-gray-200 text-gray-800" />
        <SumCard icon={Clock}     label="ساعات / أسبوع" value={num(totals.weekly_hours)} tone="bg-white border-gray-200 text-gray-800" />
        <SumCard icon={PhoneCall} label="سعة / شهر (مكالمات)" value={num(totals.monthly_calls)} tone="bg-emerald-50 border-emerald-200 text-emerald-800" />
      </div>

      {/* per-section capacity */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {sections.map(s => (
          <div key={s.section} className={`rounded-2xl border p-4 ${SEC_TONE[s.section] || 'border-gray-200 bg-white'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-black text-base">{s.label}</span>
              <span className="text-[11px] opacity-80">{s.trainers} مدرب · {num(s.weekly_hours)}س/أسبوع</span>
            </div>
            <div className="text-[12px] mb-1">إجمالي السعة: <b>{num(s.monthly_calls)}</b> مكالمة/شهر</div>
            <div className="space-y-0.5">
              {Object.entries(s.capacity_by_side_pair || {}).map(([lbl, v]) => (
                <div key={lbl} className="flex items-center justify-between text-[11px] bg-white/60 rounded px-2 py-0.5">
                  <span className="font-semibold text-blue-700">{lbl}</span>
                  <span className="font-black">{num(v)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-[12px] text-emerald-800">
        السعة = صافي ساعات عمل كل مدرب فون كول × <b>4 مكالمات/ساعة</b> × <b>4 أسابيع</b> = مكالمات/شهر، موزّعة على أزواج أيام عمله.
      </div>

      {/* trainers table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right" style={{ minWidth: '760px' }}>
            <thead><tr className="bg-gray-50 border-b border-gray-100 text-[11px] text-gray-500">
              {['المدرب', 'القسم', 'ساعات/أسبوع', 'سعة/شهر', 'أيام العمل', 'السعة لكل زوج أيام'].map(h =>
                <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={6} className="text-center py-10 text-gray-400">جارٍ التحميل…</td></tr>
              ) : trainers.length === 0 ? (
                <tr><td colSpan={6} className="py-12"><EmptyState title="لا يوجد مدربو فون كول بهذه الفلاتر" /></td></tr>
              ) : trainers.map((t, i) => (
                <tr key={i} className="hover:bg-gray-50/60">
                  <td className="px-3 py-2 font-mono text-[12px] text-gray-800 whitespace-nowrap" dir="ltr">{t.name}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${SEC_TONE[t.section]}`}>{t.section_label}</span></td>
                  <td className="px-3 py-2 text-center font-bold">{num(t.weekly_hours)}</td>
                  <td className="px-3 py-2 text-center font-black text-emerald-700">{num(t.monthly_calls)}</td>
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{(t.work_days || []).join('، ') || '—'}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {(t.by_pair || []).filter(p => p.monthly_calls > 0).map((p, idx, arr) => (
                      <span key={p.pair_key} className="inline-block">
                        <span className="text-blue-700 font-semibold">{p.side_pair}</span>: <b className="text-emerald-700">{num(p.monthly_calls)}</b>{idx < arr.length - 1 ? ' · ' : ''}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {trainers.length > 0 && <div className="px-4 py-2 text-[11px] text-gray-400 border-t">عرض {trainers.length} مدرب فون كول</div>}
      </div>
    </div>
  );
}

// Phase 3 — balance: demand (phase 1) vs supply (phase 2) per section × day-pair,
// with BOTH the direct monthly deficit AND the peak-week realistic hire number.
function BalanceView() {
  const [section, setSection] = useState('all');
  const [dayPair, setDayPair] = useState('all');
  const [mainDayPair, setMainDayPair] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [missFilter, setMissFilter] = useState('all');   // all | partial | zero

  const { data, isLoading } = useQuery({
    queryKey: ['trainer-recruitment-balance', section, dayPair, mainDayPair, from, to],
    queryFn: () => api.get('/reports/trainer-recruitment-balance', {
      params: {
        section, day_pair: effDayPair(dayPair, mainDayPair) === 'all' ? undefined : effDayPair(dayPair, mainDayPair),
        from: from || undefined, to: to || undefined,
      },
    }).then(r => r.data),
    staleTime: 60 * 1000,
  });

  const totals = data?.totals || {};
  const sections = data?.sections || [];
  const missing = data?.groups_missing || [];
  const missCounts = data?.missing_counts || {};
  const missingShown = useMemo(() => missFilter === 'zero' ? missing.filter(g => g.zero) : missFilter === 'partial' ? missing.filter(g => !g.zero) : missing, [missing, missFilter]);

  return (
    <div className="space-y-5">
      {/* filters: section + day-pair */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">القسم</span>
          <select value={section} onChange={e => setSection(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 font-semibold text-gray-700 bg-gray-50">
            {Object.entries(SECTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">يوم المحاضرات الأساسية</span>
          <select value={mainDayPair} onChange={e => { setMainDayPair(e.target.value); if (e.target.value !== 'all') setDayPair('all'); }} className="px-3 py-2 rounded-lg border border-gray-200 font-semibold text-gray-700 bg-gray-50">
            {Object.entries(MAIN_DAY_PAIRS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">يوم الفون كول</span>
          <select value={dayPair} onChange={e => { setDayPair(e.target.value); if (e.target.value !== 'all') setMainDayPair('all'); }} className="px-3 py-2 rounded-lg border border-gray-200 font-semibold text-gray-700 bg-gray-50">
            {Object.entries(DAY_PAIRS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">أول محاضرة من</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2 py-2 rounded-lg border border-gray-200 text-xs text-gray-700 bg-gray-50" />
          <span className="text-xs font-bold text-gray-500">إلى</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2 py-2 rounded-lg border border-gray-200 text-xs text-gray-700 bg-gray-50" />
          {(from || to) && <button onClick={() => { setFrom(''); setTo(''); }} className="text-[11px] text-rose-500 font-bold hover:underline">مسح</button>}
        </div>
      </div>

      {/* summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SumCard icon={PhoneCall} label="طلب / شهر" value={num(totals.demand_monthly)} tone="bg-white border-gray-200 text-gray-800" />
        <SumCard icon={Clock}     label="سعة / شهر" value={num(totals.supply_monthly)} tone="bg-white border-gray-200 text-gray-800" />
        <SumCard icon={Scale}     label="إجمالي الجلسات الناقصة" value={num(missCounts.sessions)} tone="bg-rose-50 border-rose-200 text-rose-800" />
        <SumCard icon={UserCheck} label="مدربين محتاج توظيفهم (ذروة الأسبوع)" value={num(totals.trainers_needed)} tone="bg-amber-50 border-amber-200 text-amber-800" />
      </div>

      {/* interpretation */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-[12px] text-blue-800 space-y-1">
        <div><b>إجمالي الجلسات الناقصة</b> = مجموع (المطلوب − الموجود) لكل مجموعة في القائمة تحت — الجلسات اللي لسه محتاجة تتعمل فعلًا (بيتغيّر مع الفلاتر). جدول الأقسام تحته بيوضّح ميزان السعة (طلب مقابل سعة لكل زوج أيام).</div>
        <div><b>الاحتياج الفعلي للتوظيف</b> = بموديل «ذروة الأسبوع» (توزيع طلب كل مجموعة على أسابيع كورسها) — بيقارن أسبوع الذروة بالسعة الأسبوعية، فبيدّي رقم توظيف واقعي (مايضخّمش).</div>
      </div>

      {/* per-section balance */}
      {isLoading ? (
        <div className="text-center py-10 text-gray-400">جارٍ التحميل…</div>
      ) : sections.length === 0 ? (
        <EmptyState title="لا توجد بيانات" />
      ) : sections.map(s => (
        <div key={s.section} className={`rounded-2xl border p-4 ${SEC_TONE[s.section] || 'border-gray-200 bg-white'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <span className="font-black text-base">{s.label}</span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <span><b>{s.trainers}</b> مدرب فون كول</span>
              <span className={`font-black px-2 py-0.5 rounded ${s.capacity_sufficient ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {s.capacity_sufficient
                  ? 'السعة تكفي (ذروة الأسبوع) ✓'
                  : `محتاج ${s.trainers_needed} مدرب فون كول`}
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]" style={{ minWidth: '560px' }}>
              <thead><tr className="text-[10px] opacity-70 border-b border-current/10">
                <th className="text-right py-1.5 font-semibold">زوج أيام الفون كول</th>
                <th className="py-1.5 font-semibold">طلب / شهر</th>
                <th className="py-1.5 font-semibold">سعة / شهر</th>
                <th className="py-1.5 font-semibold">العجز / الزيادة (مباشر)</th>
                <th className="py-1.5 font-semibold">عجز الذروة (أسبوعي)</th>
              </tr></thead>
              <tbody>
                {(s.pairs || []).map((p, i) => (
                  <tr key={i} className="border-b border-current/5 last:border-0">
                    <td className="text-right py-2 font-bold text-blue-700">{p.side_pair}</td>
                    <td className="text-center font-semibold">{num(p.demand_monthly)}</td>
                    <td className="text-center font-semibold">{num(p.supply_monthly)}</td>
                    <td className="text-center">
                      <span className={`inline-block px-2 py-0.5 rounded font-black ${p.balance_monthly >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                        {p.balance_monthly >= 0 ? `زيادة +${num(p.balance_monthly)}` : `عجز ${num(p.balance_monthly)}`}
                      </span>
                    </td>
                    <td className="text-center text-gray-600">
                      {p.peak_shortfall_weekly > 0
                        ? <span className="text-amber-700 font-bold">{num(p.peak_shortfall_weekly)} <span className="opacity-70 font-normal">(~{p.trainers_hint} مدرب)</span></span>
                        : <span className="text-emerald-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[11px] opacity-80">
            ذروة الأسبوع: طلب <b>{num(s.peak_weekly_demand)}</b> مقابل سعة <b>{num(s.weekly_capacity)}</b> مكالمة/أسبوع
            {s.peak_shortfall > 0 && <span className="text-amber-700 font-bold"> · عجز {num(s.peak_shortfall)}/أسبوع</span>}
          </div>
        </div>
      ))}

      {/* المجموعات اللي فون كولها ناقص / بدون نهائي */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 p-4 border-b border-gray-100">
          <span className="font-black text-base text-gray-800">مجموعات فون كولها ناقص</span>
          <span className="text-[11px] text-gray-400">(الموجود أقل من المطلوب = طلاب × 7{(from || to) ? ' · ضمن الفترة المختارة' : ''} · الرقم الكبير في «ناقص» = ÷7، كل طالب = 7 مواعيد)</span>
          <div className="mr-auto flex items-center gap-1">
            {[['all', `الكل (${num(missCounts.total)})`], ['partial', `ناقص جزئيًا (${num(missCounts.partial)})`], ['zero', `بدون نهائي (${num(missCounts.zero)})`]].map(([k, lbl]) => (
              <button key={k} onClick={() => setMissFilter(k)}
                className={`text-[11px] px-2.5 py-1 rounded-lg font-bold border ${missFilter === k ? 'bg-rose-500 text-white border-rose-500' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>{lbl}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right" style={{ minWidth: '900px' }}>
            <thead><tr className="bg-gray-50 border-b border-gray-100 text-[11px] text-gray-500">
              {['المجموعة', 'المدرب الأساسي', 'القسم', 'الطلاب', 'مطلوب (×7)', 'موجود', 'ناقص', 'أول محاضرة', 'يوم الفون كول'].map(h =>
                <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-10 text-gray-400">جارٍ التحميل…</td></tr>
              ) : missingShown.length === 0 ? (
                <tr><td colSpan={9} className="py-10"><EmptyState title="لا توجد مجموعات ناقصة بهذه الفلاتر" /></td></tr>
              ) : missingShown.map((g, i) => (
                <tr key={i} className={`hover:bg-gray-50/60 ${g.zero ? 'bg-rose-50/40' : ''}`}>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-700 max-w-[240px] truncate" dir="ltr" title={g.group_name}>{g.group_name}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap" dir="ltr">{g.main_trainer || '—'}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${SEC_TONE[g.section]}`}>{g.section_label}</span></td>
                  <td className="px-3 py-2 text-center font-bold">{g.students}</td>
                  <td className="px-3 py-2 text-center text-gray-600">{num(g.required)}</td>
                  <td className="px-3 py-2 text-center font-semibold">{g.zero ? <span className="text-rose-700 font-black">0</span> : num(g.actual)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className="font-black text-rose-700 text-base">{num(Math.round(g.missing / 7))}</span>
                    <span className="text-[10px] text-gray-400 mr-1">({num(g.missing)} جلسة)</span>
                    {g.zero && <span className="block text-[9px] font-bold text-rose-600">بدون نهائي</span>}
                  </td>
                  <td className="px-3 py-2 text-center text-gray-500" dir="ltr">{g.first_date || '—'}</td>
                  <td className="px-3 py-2 text-center text-blue-700 font-semibold whitespace-nowrap">{g.side_pair}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {missingShown.length > 0 && <div className="px-4 py-2 text-[11px] text-gray-400 border-t">عرض {missingShown.length} مجموعة</div>}
      </div>
    </div>
  );
}

// «خارج القسم» — main trainers whose group students get phone-call sessions from
// phone-call trainers of a DIFFERENT section. Expand a row → per group → which
// phone-call trainer (+ their section) + session count.
function CrossSectionView() {
  const [section, setSection] = useState('all');
  const [dayPair, setDayPair] = useState('all');
  const [mainDayPair, setMainDayPair] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState({});
  const [openChip, setOpenChip] = useState({});   // "trainer|gi|pi" → show that phone-trainer's session dates

  const { data, isLoading } = useQuery({
    queryKey: ['trainer-recruitment-cross', section, dayPair, mainDayPair],
    queryFn: () => api.get('/reports/trainer-recruitment-cross-section', {
      params: { section, day_pair: effDayPair(dayPair, mainDayPair) === 'all' ? undefined : effDayPair(dayPair, mainDayPair) },
    }).then(r => r.data),
    staleTime: 60 * 1000,
  });

  const totals = data?.totals || {};
  const trainers = useMemo(() => {
    let t = data?.trainers || [];
    if (q.trim()) { const s = q.trim().toLowerCase(); t = t.filter(x => (x.name || '').toLowerCase().includes(s)); }
    return t;
  }, [data, q]);

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">القسم</span>
          <select value={section} onChange={e => setSection(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 font-semibold text-gray-700 bg-gray-50">
            {Object.entries(SECTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">يوم المحاضرات الأساسية</span>
          <select value={mainDayPair} onChange={e => { setMainDayPair(e.target.value); if (e.target.value !== 'all') setDayPair('all'); }} className="px-3 py-2 rounded-lg border border-gray-200 font-semibold text-gray-700 bg-gray-50">
            {Object.entries(MAIN_DAY_PAIRS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">يوم الفون كول</span>
          <select value={dayPair} onChange={e => { setDayPair(e.target.value); if (e.target.value !== 'all') setMainDayPair('all'); }} className="px-3 py-2 rounded-lg border border-gray-200 font-semibold text-gray-700 bg-gray-50">
            {Object.entries(DAY_PAIRS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="relative mr-auto">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="اسم المدرب..." className="pr-8 pl-2 py-2 rounded-lg border border-gray-200 text-xs w-44" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <SumCard icon={Users}          label="مدربين أساسيين متأثرين" value={num(totals.trainers)} tone="bg-white border-gray-200 text-gray-800" />
        <SumCard icon={GraduationCap}  label="مجموعات" value={num(totals.groups)} tone="bg-white border-gray-200 text-gray-800" />
        <SumCard icon={ArrowLeftRight} label="جلسات فون كول خارج القسم" value={num(totals.sessions)} tone="bg-rose-50 border-rose-200 text-rose-800" />
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-[12px] text-amber-800">
        الجدول بيعرض مدربي المحاضرات الأساسية اللي طلاب مجموعاتهم بياخدوا فون كول من <b>مدرب فون كول قسمه مختلف</b> عن قسم المجموعة.
        اضغط أي صف تشوف المجموعات + مدرب الفون كول اللي عملها وقسمه.
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right" style={{ minWidth: '640px' }}>
            <thead><tr className="bg-gray-50 border-b border-gray-100 text-[11px] text-gray-500">
              <th className="px-3 py-2.5 font-semibold w-8"></th>
              {['المدرب الأساسي', 'قسمه', 'مجموعات متأثرة', 'جلسات خارج القسم'].map(h =>
                <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={5} className="text-center py-10 text-gray-400">جارٍ التحميل…</td></tr>
              ) : trainers.length === 0 ? (
                <tr><td colSpan={5} className="py-12"><EmptyState title="لا يوجد مدربون بمواعيد خارج القسم" /></td></tr>
              ) : trainers.map(t => {
                const isOpen = !!open[t.name];
                return (
                  <>
                    <tr key={t.name} className="hover:bg-gray-50/60 cursor-pointer" onClick={() => setOpen(o => ({ ...o, [t.name]: !o[t.name] }))}>
                      <td className="px-3 py-2 text-gray-400">{isOpen ? <ChevronDown size={15} /> : <ChevronLeft size={15} />}</td>
                      <td className="px-3 py-2 font-mono text-[12px] text-gray-800 whitespace-nowrap" dir="ltr">{t.name}</td>
                      <td className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${SEC_TONE[t.section]}`}>{t.section_label}</span></td>
                      <td className="px-3 py-2 text-center font-bold">{t.groups}</td>
                      <td className="px-3 py-2 text-center font-black text-rose-700">{num(t.sessions)}</td>
                    </tr>
                    {isOpen && (
                      <tr key={t.name + '_d'} className="bg-gray-50/40">
                        <td></td>
                        <td colSpan={4} className="px-3 py-2">
                          <div className="space-y-2">
                            {t.group_list.map((g, gi) => (
                              <div key={gi} className="bg-white rounded-lg border border-gray-100 p-2.5">
                                <div className="flex flex-wrap items-center gap-2 mb-1.5 text-[12px]">
                                  <span className="font-mono text-gray-700 truncate max-w-[320px]" dir="ltr" title={g.group_name}>{g.group_name}</span>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${SEC_TONE[g.section]}`}>{g.section_label}</span>
                                  <span className="text-[11px] text-blue-700 font-semibold">فون كول: {g.side_pair}</span>
                                  <span className="mr-auto text-[11px] text-rose-700 font-black">{num(g.sessions)} جلسة</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {g.phone_trainers.map((p, pi) => {
                                    const ck = `${t.name}|${gi}|${pi}`;
                                    return (
                                      <button key={pi} onClick={() => setOpenChip(o => ({ ...o, [ck]: !o[ck] }))}
                                        className={`text-[11px] px-2 py-1 rounded-lg border font-semibold cursor-pointer hover:brightness-95 ${SEC_TONE[p.section]} ${openChip[ck] ? 'ring-2 ring-rose-300' : ''}`} dir="ltr" title="اضغط لعرض المواعيد">
                                        {p.name} <span className="opacity-70">({p.section_label})</span> · <b>{num(p.sessions)}</b>
                                      </button>
                                    );
                                  })}
                                </div>
                                {g.phone_trainers.map((p, pi) => {
                                  const ck = `${t.name}|${gi}|${pi}`;
                                  if (!openChip[ck]) return null;
                                  return (
                                    <div key={'l' + pi} className="mt-1.5 bg-rose-50/50 border border-rose-100 rounded-lg p-2">
                                      <div className="text-[11px] font-bold text-rose-700 mb-1" dir="ltr">{p.name} — {num(p.sessions)} موعد</div>
                                      <div className="flex flex-wrap gap-1">
                                        {(p.sessions_list || []).map((s, si) => (
                                          <span key={si} className="text-[10px] px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-700 whitespace-nowrap" dir="ltr">{s.date} · {s.time}</span>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
        {trainers.length > 0 && <div className="px-4 py-2 text-[11px] text-gray-400 border-t">عرض {trainers.length} مدرب — اضغط على أي صف للتفاصيل</div>}
      </div>

      {data?.params?.unresolved_sessions > 0 && (
        <div className="text-[11px] text-gray-400 px-1">
          ملاحظة: {num(data.params.unresolved_sessions)} جلسة جانبية قسم مدرّبها غير محدّد (حسابات تجريبية / CS / مدربون أساسيون يغطّون) — مستبعدة من الكشف.
        </div>
      )}
    </div>
  );
}

// Expanded per-trainer group list with its OWN independent local filter
// (day-pair + status + date) — filters this trainer's groups without touching the page.
function TrainerGroups({ groups }) {
  const [dp, setDp] = useState('all');
  const [st, setSt] = useState('all');
  const [lf, setLf] = useState('');
  const [lt, setLt] = useState('');

  const filtered = useMemo(() => {
    const sideKey = DAY_PAIRS[dp]?.sideKey;
    return (groups || []).filter(g => {
      if (sideKey && g.side_key !== sideKey) return false;
      if (st === 'active' && g.status !== 'نشطة') return false;
      if ((lf || lt) && !firstInRange(g.first_date, lf, lt)) return false;
      return true;
    });
  }, [groups, dp, st, lf, lt]);

  const subDemand = filtered.reduce((a, g) => a + (g.demand_month || 0), 0);
  const subStudents = filtered.reduce((a, g) => a + (g.trainees || 0), 0);
  const anyLocal = dp !== 'all' || st !== 'all' || lf || lt;

  return (
    <div>
      {/* local filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-2 text-[11px] bg-white rounded-lg border border-gray-100 px-2 py-1.5">
        <span className="flex items-center gap-1 font-bold text-gray-500"><Filter size={12} /> فلتر مجموعاته:</span>
        <select value={dp} onChange={e => setDp(e.target.value)} className="px-2 py-1 rounded border border-gray-200 bg-gray-50 text-gray-700">
          {Object.entries(DAY_PAIRS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={st} onChange={e => setSt(e.target.value)} className="px-2 py-1 rounded border border-gray-200 bg-gray-50 text-gray-700">
          {Object.entries(STATUS_OPTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="text-gray-400">أول محاضرة من</span>
        <input type="date" value={lf} onChange={e => setLf(e.target.value)} className="px-1.5 py-1 rounded border border-gray-200 bg-gray-50 text-gray-700" title="أول محاضرة من" />
        <span className="text-gray-400">إلى</span>
        <input type="date" value={lt} onChange={e => setLt(e.target.value)} className="px-1.5 py-1 rounded border border-gray-200 bg-gray-50 text-gray-700" title="أول محاضرة إلى" />
        {anyLocal && <button onClick={() => { setDp('all'); setSt('all'); setLf(''); setLt(''); }} className="text-rose-500 font-bold hover:underline flex items-center gap-0.5"><X size={11} /> مسح</button>}
        <span className="mr-auto text-gray-500">
          {filtered.length} مجموعة · {num(subStudents)} طالب · طلب <b className="text-rose-700">{num(subDemand)}</b>/شهر
        </span>
      </div>

      <table className="w-full text-[11px]">
        <thead><tr className="text-gray-400">
          <th className="text-right py-1 font-semibold">المجموعة</th>
          <th className="py-1 font-semibold">القسم</th>
          <th className="py-1 font-semibold">الحالة</th>
          <th className="py-1 font-semibold">طلاب</th>
          <th className="py-1 font-semibold">أيام الأساسي</th>
          <th className="py-1 font-semibold">أيام الفون كول</th>
          <th className="py-1 font-semibold">أول/آخر محاضرة</th>
          <th className="py-1 font-semibold">طلب/شهر</th>
        </tr></thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr><td colSpan={8} className="py-3 text-center text-gray-300">لا مجموعات بهذا الفلتر</td></tr>
          ) : filtered.map((g, gi) => (
            <tr key={gi} className="border-t border-gray-100">
              <td className="py-1 font-mono text-gray-700 max-w-[260px] truncate" dir="ltr" title={g.group_name}>{g.group_name}</td>
              <td className="py-1 text-center">{SECTIONS[g.section]}</td>
              <td className="py-1 text-center text-gray-500">{g.status}</td>
              <td className="py-1 text-center font-bold">{g.trainees}</td>
              <td className="py-1 text-center text-gray-500">{g.main_pair}</td>
              <td className="py-1 text-center text-blue-700 font-semibold">{g.side_pair}</td>
              <td className="py-1 text-center text-gray-400" dir="ltr">{g.first_date || '—'} → {g.last_date || '—'}</td>
              <td className="py-1 text-center font-black text-rose-700">{num(g.demand_month)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
