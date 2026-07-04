'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, PhoneCall, Users, Search, ChevronDown, ChevronLeft, GraduationCap, Filter, X } from 'lucide-react';
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
  const [section, setSection] = useState('all');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dayPair, setDayPair] = useState('all');
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState({});   // trainer name → expanded?

  const { data, isLoading } = useQuery({
    queryKey: ['trainer-recruitment', section, from, to, dayPair, status],
    queryFn: () => api.get('/reports/trainer-recruitment', {
      params: {
        section,
        from: from || undefined, to: to || undefined,
        day_pair: dayPair === 'all' ? undefined : dayPair,
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

  const anyGlobalFilter = from || to || dayPair !== 'all' || status !== 'all';

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="توظيف المدربين"
        subtitle="الطلب على الفون كول اللي بتولّده مجموعات كل مدرب أساسي (طلاب × 7 معاد/شهر) على الأيام العكسية — أساس تقدير الاحتياج"
        icon={UserPlus}
        gradient="rose"
      />

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
          <span className="text-xs font-bold text-gray-500">يوم الفون كول</span>
          <select value={dayPair} onChange={e => setDayPair(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 font-semibold text-gray-700 bg-gray-50">
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
          <button onClick={() => { setFrom(''); setTo(''); setDayPair('all'); setStatus('all'); }} className="text-[11px] text-rose-500 font-bold hover:underline">مسح الفلاتر</button>
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
