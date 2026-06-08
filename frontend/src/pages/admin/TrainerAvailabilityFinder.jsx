'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, CalendarDays, Clock, Users, CheckCircle2,
  XCircle, AlertTriangle, ChevronDown, Filter, Sparkles,
  GraduationCap, Sun, Moon,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import EmptyState from '../../components/ui/EmptyState';
import HolidayBanner from '../../components/ui/HolidayBanner';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SECTIONS = {
  all:        'الكل',
  general:    'عام',
  private:    'خاص',
  semi:       'شبه خاص',
  phone_call: 'فون كول',
};
const SECTION_TONE = {
  general:    'bg-sky-50 text-sky-700 border-sky-200',
  private:    'bg-violet-50 text-violet-700 border-violet-200',
  semi:       'bg-amber-50 text-amber-700 border-amber-200',
  phone_call: 'bg-pink-50 text-pink-700 border-pink-200',
  all:        'bg-slate-100 text-slate-600 border-slate-200',
};
const DAYS = [
  { key: 'saturday',  label: 'السبت' },
  { key: 'sunday',    label: 'الأحد' },
  { key: 'monday',    label: 'الإثنين' },
  { key: 'tuesday',   label: 'الثلاثاء' },
  { key: 'wednesday', label: 'الأربعاء' },
  { key: 'thursday',  label: 'الخميس' },
];
const DAY_AR = {
  saturday:'السبت', sunday:'الأحد', monday:'الإثنين',
  tuesday:'الثلاثاء', wednesday:'الأربعاء', thursday:'الخميس', friday:'الجمعة'
};
const COURSES = [
  { key: 'starter',      label: 'Starter',      max: 3 },
  { key: 'general',      label: 'General',      max: 5 },
  { key: 'conversation', label: 'Conversation', max: 5 },
];

const fmtArDate = iso => {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};
const fmtMins = mins => {
  if (mins == null || mins <= 0) return '0';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}د`;
  if (m === 0) return `${h}س`;
  return `${h}س ${m}د`;
};
const timeToMins = t => {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
};

// ─── TRAINER CARD ─────────────────────────────────────────────────────────────
function TrainerCard({ trainer }) {
  const [expanded, setExpanded] = useState(false);
  const { fully_available, partially_available, available_count, total_slots, slots } = trainer;

  let statusBadge;
  if (fully_available) {
    statusBadge = (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
        <CheckCircle2 size={13} /> متاح كلياً ({available_count}/{total_slots})
      </span>
    );
  } else if (partially_available) {
    statusBadge = (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold">
        <AlertTriangle size={13} /> متاح جزئياً ({available_count}/{total_slots})
      </span>
    );
  } else {
    statusBadge = (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold">
        <XCircle size={13} /> غير متاح ({available_count}/{total_slots})
      </span>
    );
  }

  return (
    <div
      className={`bg-white rounded-2xl border ${
        fully_available
          ? 'border-emerald-200 shadow-sm'
          : partially_available
          ? 'border-amber-200'
          : 'border-rose-100 opacity-80'
      } overflow-hidden transition-all hover:shadow-md`}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-right hover:bg-slate-50/60 transition-colors"
      >
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-sm shrink-0 ${
            fully_available
              ? 'bg-gradient-to-br from-emerald-400 to-emerald-600'
              : partially_available
              ? 'bg-gradient-to-br from-amber-400 to-amber-600'
              : 'bg-gradient-to-br from-slate-400 to-slate-500'
          }`}
        >
          {trainer.name?.charAt(0) || '?'}
        </div>

        <div className="flex-1 min-w-0 text-right">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-gray-900 text-sm">{trainer.name}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${SECTION_TONE[trainer.section] || SECTION_TONE.all}`}>
              {SECTIONS[trainer.section] || trainer.section}
            </span>
            {trainer.shift_summary?.includes('مسائي') ? <Moon size={11} className="text-indigo-400" />
              : trainer.shift_summary?.includes('صباحي') ? <Sun size={11} className="text-amber-400" /> : null}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5 truncate">{trainer.shift_summary}</div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {statusBadge}
          <ChevronDown size={15} className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 bg-slate-50/40 animate-fadeIn">
          {/* Teachable summary */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[10px] font-bold text-gray-600">قدراته:</span>
            {COURSES.map(c => {
              const v = trainer.teachable?.[c.key];
              if (v == null) return null;
              return (
                <span key={c.key} className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${
                  v === 0 ? 'bg-slate-100 text-slate-500'
                  : v === c.max ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-blue-100 text-blue-700'
                }`}>
                  {c.label} {v === 0 ? '✗' : v === c.max ? 'كاملة' : v}
                </span>
              );
            })}
          </div>

          {/* Slots */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {slots.map((s, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs ${
                  s.available
                    ? 'bg-emerald-50 border border-emerald-100'
                    : 'bg-rose-50 border border-rose-100'
                }`}
              >
                {s.available
                  ? <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                  : <XCircle      size={13} className="text-rose-500 shrink-0" />}
                <span className="font-mono font-semibold text-gray-700 text-[11px]" dir="ltr">
                  {fmtArDate(s.date)}
                </span>
                <span className="text-gray-500 text-[11px]">{DAY_AR[s.day]} (أسبوع {s.week})</span>
                {!s.available && (
                  <span className="text-rose-600 text-[10px] truncate ms-auto">{s.reason}</span>
                )}
                {s.available && s.free_slots?.length > 0 && (
                  <span className="text-emerald-700 text-[10px] truncate ms-auto" dir="ltr" title={s.free_slots.join('   •   ')}>
                    {s.free_slots.join('  •  ')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function TrainerAvailabilityFinder() {
  // Defaults
  const [section, setSection]       = useState('all');
  const [selectedDays, setSelDays]  = useState(['saturday']);
  const [fromTime, setFromTime]     = useState('18:00');
  const [toTime, setToTime]         = useState('19:30');
  const [weeksCount, setWeeksCount] = useState(4);
  const [startDate, setStartDate]   = useState('');
  const [courseFamily, setCFamily]  = useState('');
  const [courseLevel, setCLevel]    = useState('');
  const [filterMode, setFilterMode] = useState('all'); // all | full | partial | none
  const [submitted, setSubmitted]   = useState(false);

  const durationMin = useMemo(() => {
    const f = timeToMins(fromTime), t = timeToMins(toTime);
    if (f == null || t == null || t <= f) return 0;
    return t - f;
  }, [fromTime, toTime]);

  // Time window is OPTIONAL — both empty → "any free slot" mode (returns every
  // trainer that has any unbooked gap on the chosen days).
  const noWindow = !fromTime && !toTime;
  const canSubmit = selectedDays.length > 0 && (noWindow || durationMin > 0);

  const { data, isFetching } = useQuery({
    queryKey: ['find-available-trainer', section, selectedDays.join(','), fromTime, toTime, weeksCount, startDate, courseFamily, courseLevel],
    queryFn: () => api.get('/reports/find-available-trainer', {
      params: {
        section,
        days: selectedDays.join(','),
        from_time: fromTime,
        to_time: toTime,
        weeks_count: weeksCount,
        start_date: startDate || undefined,
        course_family: courseFamily || undefined,
        course_level: courseLevel || undefined,
      },
    }).then(r => r.data),
    enabled: submitted && canSubmit,
    staleTime: 30 * 1000,
  });

  const toggleDay = (day) => {
    setSelDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  const results = useMemo(() => data?.results || [], [data]);
  const summary = data?.summary;
  const filteredResults = useMemo(() => {
    if (filterMode === 'full')    return results.filter(r => r.fully_available);
    if (filterMode === 'partial') return results.filter(r => r.partially_available);
    if (filterMode === 'none')    return results.filter(r => r.available_count === 0);
    return results;
  }, [results, filterMode]);

  const labelCls = 'block text-xs font-bold text-gray-700 mb-1.5';
  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 bg-white';

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="ابحث عن مدرب متاح"
        subtitle="حدد الأيام والوقت والمدرب المطلوب → النظام بيعرضلك المدربين الفاضيين"
        icon={Search}
        gradient="navy"
      />

      <HolidayBanner dates={data?.excluded_holidays?.map(h => h.date)} />

      {/* ── FILTER CARD ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
          <Filter size={15} className="text-blue-500" />
          معايير البحث
        </div>

        {/* Row 1: section + weeks + start date */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>القسم</label>
            <select value={section} onChange={e => setSection(e.target.value)} className={inputCls}>
              {Object.entries(SECTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>عدد الأسابيع المتتالية</label>
            <select value={weeksCount} onChange={e => setWeeksCount(parseInt(e.target.value))} className={inputCls}>
              {[1,2,3,4,6,8,12].map(n => <option key={n} value={n}>{n} أسبوع</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>
              تاريخ البداية
              <span className="text-[10px] text-gray-400 mr-1">(اختياري — هذا الأسبوع لو فاضي)</span>
            </label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} dir="ltr" />
          </div>
        </div>

        {/* Row 2: days */}
        <div>
          <label className={labelCls}>
            <CalendarDays size={11} className="inline ml-1 -mt-0.5" />
            الأيام المطلوبة <span className="text-rose-500">*</span>
            <span className="text-[10px] text-gray-400 mr-1">(اختار يوم أو أكتر)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {DAYS.map(d => {
              const isOn = selectedDays.includes(d.key);
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => toggleDay(d.key)}
                  className={`px-4 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                    isOn
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >{d.label}</button>
              );
            })}
          </div>
        </div>

        {/* Row 3: time range */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>
              <Clock size={11} className="inline ml-1 -mt-0.5" />
              من الساعة <span className="text-[10px] text-gray-400">(اختياري)</span>
            </label>
            <input type="time" value={fromTime} onChange={e => setFromTime(e.target.value)} className={inputCls} dir="ltr" />
          </div>
          <div>
            <label className={labelCls}>
              إلى الساعة <span className="text-[10px] text-gray-400">(اختياري)</span>
            </label>
            <input type="time" value={toTime} onChange={e => setToTime(e.target.value)} className={inputCls} dir="ltr" />
          </div>
          <div className="flex items-end pb-1">
            <div className="w-full text-center px-3 py-2 rounded-xl bg-blue-50 border border-blue-100">
              {noWindow ? (
                <>
                  <div className="text-[10px] text-blue-700 font-bold">الوضع</div>
                  <div className="text-xs font-extrabold text-blue-900">كل الأوقات المتاحة</div>
                  <div className="text-[9px] text-blue-600 mt-0.5">سيب الوقت فاضي = كل المدربين اللي عندهم وقت فاضي</div>
                </>
              ) : (
                <>
                  <div className="text-[10px] text-blue-700 font-bold">المدة المحسوبة</div>
                  <div className="text-sm font-extrabold text-blue-900">{fmtMins(durationMin)}</div>
                  <button type="button" onClick={() => { setFromTime(''); setToTime(''); }}
                    className="mt-0.5 text-[10px] text-blue-600 hover:underline">مسح الوقت (عرض الكل)</button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Row 4: course family + level (optional) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className={labelCls}>
              <GraduationCap size={11} className="inline ml-1 -mt-0.5" />
              الدورة (اختياري)
              <span className="text-[10px] text-gray-400 mr-1">— يفلتر المدربين القادرين فقط</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setCFamily(''); setCLevel(''); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                  !courseFamily ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >بدون فلتر</button>
              {COURSES.map(c => (
                <button key={c.key} type="button"
                  onClick={() => setCFamily(c.key === courseFamily ? '' : c.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                    courseFamily === c.key ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >{c.label}</button>
              ))}
            </div>
          </div>
          {courseFamily && (
            <div>
              <label className={labelCls}>المستوى المطلوب</label>
              <select value={courseLevel} onChange={e => setCLevel(e.target.value)} className={inputCls}>
                <option value="">— اختر —</option>
                {Array.from(
                  { length: COURSES.find(c => c.key === courseFamily)?.max || 5 },
                  (_, i) => i + 1
                ).map(n => <option key={n} value={n}>{COURSES.find(c => c.key === courseFamily).label} {n}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={() => setSubmitted(true)}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            <Sparkles size={15} />
            ابحث عن مدربين متاحين
          </button>
        </div>
      </div>

      {/* ── RESULTS ── */}
      {submitted && (
        <>
          {/* Summary KPIs */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiBox label="إجمالي" value={summary.total_trainers} icon={Users}     tone="blue" />
              <KpiBox label="متاح كلياً" value={summary.fully_available} icon={CheckCircle2} tone="emerald" />
              <KpiBox label="متاح جزئياً" value={summary.partially_available} icon={AlertTriangle} tone="amber" />
              <KpiBox label="غير متاح" value={summary.not_available} icon={XCircle} tone="rose" />
            </div>
          )}

          {/* Filter chips */}
          {results.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs font-bold text-gray-700">عرض:</span>
              {[
                { k: 'all',     l: 'الكل' },
                { k: 'full',    l: 'متاح كلياً' },
                { k: 'partial', l: 'متاح جزئياً' },
                { k: 'none',    l: 'غير متاح' },
              ].map(({ k, l }) => (
                <button key={k} onClick={() => setFilterMode(k)}
                  className={`px-3 py-1 rounded-full text-xs font-bold border transition-all ${
                    filterMode === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >{l}</button>
              ))}
            </div>
          )}

          {/* Results list */}
          {isFetching ? (
            <div className="space-y-2">
              {[1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-xl" />)}
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="bg-white rounded-3xl border border-gray-100">
              <EmptyState
                icon={Search}
                accent="gray"
                title={results.length === 0 ? 'لا يوجد مدربين مطابقين' : 'لا توجد نتائج بهذا الفلتر'}
                message={results.length === 0
                  ? 'ما فيش مدربين مطابقين لمعاييرك. جرب توسع الفلتر أو تختار أيام أخرى.'
                  : 'غيّر فلتر العرض في الأعلى.'}
              />
            </div>
          ) : (
            <div className="space-y-2">
              {filteredResults.map(t => <TrainerCard key={t.id} trainer={t} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── KPI BOX ──────────────────────────────────────────────────────────────────
function KpiBox({ label, value, icon, tone }) {
  const IconComp = icon;
  const tones = {
    blue:    { bg: 'bg-blue-50',    border: 'border-blue-100',    text: 'text-blue-900',    iconBg: 'bg-blue-100',    iconText: 'text-blue-600' },
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-900', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600' },
    amber:   { bg: 'bg-amber-50',   border: 'border-amber-100',   text: 'text-amber-900',   iconBg: 'bg-amber-100',   iconText: 'text-amber-600' },
    rose:    { bg: 'bg-rose-50',    border: 'border-rose-100',    text: 'text-rose-900',    iconBg: 'bg-rose-100',    iconText: 'text-rose-600' },
  };
  const c = tones[tone] || tones.blue;
  return (
    <div className={`flex items-center gap-3 ${c.bg} ${c.border} border rounded-2xl p-3.5`}>
      <div className={`${c.iconBg} ${c.iconText} w-10 h-10 rounded-xl flex items-center justify-center shrink-0`}>
        <IconComp size={18} />
      </div>
      <div className="min-w-0">
        <div className={`text-[11px] ${c.iconText} font-bold`}>{label}</div>
        <div className={`text-xl font-extrabold ${c.text}`}>{value ?? 0}</div>
      </div>
    </div>
  );
}
