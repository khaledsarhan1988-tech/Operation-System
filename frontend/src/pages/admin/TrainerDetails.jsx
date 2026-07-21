'use client';
import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Users, CalendarDays, Check, X, AlertTriangle, CalendarOff, Activity } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import EmptyState from '../../components/ui/EmptyState';
import HolidayBanner from '../../components/ui/HolidayBanner';

// ─── helpers ────────────────────────────────────────────────────────────────
const SECTIONS = { all: 'الكل', general: 'عام', private: 'خاص', semi: 'شبه خاص', phone_call: 'فون كول', phone_call_general: 'فون كول عام', phone_call_semi: 'فون كول شبه خاص', phone_call_private: 'فون كول خاص' };
const DOW_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
// Day-pair filter — each group meets twice a week on a fixed pair. getDay(): 0=Sun..6=Sat.
const DAY_PAIRS = {
  all:     { label: 'كل الأيام',    dows: null },
  sat_tue: { label: 'سبت وثلاثاء',  dows: [6, 2] },
  sun_wed: { label: 'أحد وأربعاء',  dows: [0, 3] },
  mon_thu: { label: 'إثنين وخميس',  dows: [1, 4] },
};
const fmtISO = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const dowFromISO = iso => new Date(iso + 'T12:00:00').getDay();
const fmtArDate = iso => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };
const fmtMins = mins => {
  if (mins == null || mins <= 0) return '0';
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h === 0) return `${m}د`;
  if (m === 0) return `${h}س`;
  return `${h}س ${m}د`;
};
const parseTime12 = t => {
  if (!t) return -1;
  const m = String(t).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return -1;
  let h = +m[1], min = +m[2];
  if ((m[3] || '').toUpperCase() === 'PM' && h < 12) h += 12;
  if ((m[3] || '').toUpperCase() === 'AM' && h === 12) h = 0;
  return h * 60 + min;
};
const parseDur = d => { if (!d) return 0; const m = String(d).match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : 0; };
const fmt12 = m => {
  if (m == null) return '';
  const mod = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(mod / 60), mm = mod % 60;
  const ap = h >= 12 ? 'م' : 'ص';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${ap}`;
};
// recurring free-slot counting: a "معاد" = one bookable slot of the section's
// group duration (عام = 90د، خاص/شبه خاص = 60د) inside a pair-pattern free range.
const slotDurFor = sec => (sec === 'general' ? 90 : 60);
const rangeMin = str => {
  const p = String(str).split('→').map(x => x.trim());
  let s = parseTime12(p[0]), e = parseTime12(p[1]);
  if (e <= s) e += 1440;   // crosses midnight (e.g. → 12:00 AM)
  return Math.max(0, e - s);
};
const countMeaad = (pairPatterns, sec) => {
  const dur = slotDurFor(sec);
  let n = 0;
  for (const pp of (pairPatterns || [])) for (const sl of (pp.slots || [])) n += Math.floor(rangeMin(sl) / dur);
  return n;
};

// Build the day's timeline as EXACT blocks (no hour-bucket approximation): each
// lecture is a booked block at its real start/end, each free_slot a green block.
// Sorted chronologically. This is minute-accurate — a 1.5h lecture (7–8:30) and the
// gap after it (8:30–9) render as two distinct blocks, never a mislabeled "hour".
function buildBlocks(day) {
  const lec = (day.lectures || [])
    .map(l => { const s = parseTime12(l.time), d = parseDur(l.duration); return s >= 0 && d > 0 ? { s, e: s + d, type: 'booked', group: String(l.group_name || '').trim() } : null; })
    .filter(Boolean);
  const free = (day.free_slots || []).map(f => ({ s: f.start_min, e: f.end_min, type: 'free' }));
  return [...lec, ...free].sort((a, b) => a.s - b.s || a.e - b.e);
}

// ─── main page ────────────────────────────────────────────────────────────────
export default function TrainerDetails() {
  const today = new Date();
  // Deep-link: ?trainer=<name> (from المستويات الشغّالة) opens the page showing
  // ONLY that trainer. Section starts at 'الكل' so the trainer is found whatever
  // their section; matching = stripParens + compact (the constitution's rule —
  // no fuzzy matching).
  const [searchParams] = useSearchParams();
  const trainerParam = (searchParams.get('trainer') || '').trim();
  const [nameFilter, setNameFilter] = useState(trainerParam);
  const [section, setSection] = useState(trainerParam ? 'all' : 'semi');
  const [dayPair, setDayPair] = useState('all');
  const [from, setFrom] = useState(fmtISO(today));
  const [to, setTo] = useState(fmtISO(addDays(today, 30)));
  const compactName = (n) => String(n || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, '').toLowerCase();

  const validRange = !!(from && to && from <= to);
  const { data, isLoading } = useQuery({
    queryKey: ['trainer-details', from, to, section],
    queryFn: () => api.get('/reports/trainer-utilization', {
      params: { from, to, section },
    }).then(r => r.data),
    enabled: validRange,
    staleTime: 60 * 1000,
  });

  const dates = useMemo(() => data?.dates || [], [data]);
  // Day-pair filter — restrict the displayed day columns to the chosen pair.
  const visibleDates = useMemo(() => {
    const p = DAY_PAIRS[dayPair];
    if (!p?.dows) return dates;
    const set = new Set(p.dows);
    return dates.filter(d => set.has(dowFromISO(d)));
  }, [dates, dayPair]);
  const trainers = useMemo(() => {
    const all = (data?.trainers || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
    if (!nameFilter) return all;
    const key = compactName(nameFilter);
    return all.filter(t => compactName(t.name) === key);
  }, [data, nameFilter]);

  // Recurring free slots over 4 consecutive weeks (day-pair patterns) — reuses
  // /find-available-trainer no-window mode (the system's agreed recurring logic).
  const { data: faData } = useQuery({
    queryKey: ['trainer-details-recurring', from, section],
    queryFn: () => api.get('/reports/find-available-trainer', {
      params: { section, days: 'saturday,sunday,monday,tuesday,wednesday,thursday', weeks_count: 4, start_date: from },
    }).then(r => r.data),
    enabled: validRange,
    staleTime: 60 * 1000,
  });
  // map: stripped-name → { count, pairs:[{label, slots:[]}] }
  const recurringByName = useMemo(() => {
    const m = {};
    for (const r of (faData?.results || [])) {
      const key = String(r.name || '').replace(/\([^)]*\)/g, '').trim().toLowerCase();
      const pairs = (r.pair_patterns || []).filter(pp => (pp.slots || []).length);
      m[key] = { count: countMeaad(r.pair_patterns, r.section), pairs };
    }
    return m;
  }, [faData]);
  const sectionTotal = useMemo(
    () => trainers.reduce((s, t) => s + (recurringByName[String(t.name || '').replace(/\([^)]*\)/g, '').trim().toLowerCase()]?.count || 0), 0),
    [trainers, recurringByName]
  );

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="تفاصيل المدربين"
        subtitle="محاضرات كل مدرّب وأوقاته المتاحة يومًا بيوم — حسب القسم والفترة"
        icon={Users}
        gradient="navy"
      />

      <HolidayBanner dates={data?.holiday_dates} />

      {/* ── Single-trainer deep-link notice ── */}
      {nameFilter && (
        <div className="bg-violet-50 border border-violet-200 rounded-2xl px-5 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-violet-800 text-sm font-bold">
            <Users size={16} className="text-violet-600" />
            معروض مدرب واحد: <span dir="ltr">{nameFilter}</span>
          </div>
          <button
            type="button"
            onClick={() => setNameFilter('')}
            className="px-3 py-1.5 text-xs rounded-lg border border-violet-300 text-violet-700 hover:bg-violet-100"
          >
            عرض كل المدربين
          </button>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">القسم</span>
          <select
            value={section}
            onChange={e => setSection(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 bg-gray-50 focus:bg-white outline-none"
          >
            {Object.entries(SECTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">الأيام</span>
          <select
            value={dayPair}
            onChange={e => setDayPair(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 bg-gray-50 focus:bg-white outline-none"
          >
            {Object.entries(DAY_PAIRS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">من</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 bg-gray-50 focus:bg-white outline-none" />
          <span className="text-xs font-bold text-gray-500">إلى</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 bg-gray-50 focus:bg-white outline-none" />
        </div>
        <div className="text-xs text-gray-400 flex items-center gap-1">
          <CalendarDays size={13} /> {fmtArDate(from)} → {fmtArDate(to)} · {trainers.length} مدرب
          {dayPair !== 'all' && <span className="text-blue-500 font-semibold">· {DAY_PAIRS[dayPair].label} ({visibleDates.length} يوم)</span>}
        </div>
      </div>

      {/* ── Section recurring-availability summary ── */}
      {validRange && trainers.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-emerald-800">
            <CalendarDays size={18} className="text-emerald-600" />
            <span className="font-bold text-sm">مواعيد القسم الفاضية المتكررة — تقبل مجموعة جديدة 4 أسابيع متتالية</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-black text-emerald-700">{sectionTotal}</span>
            <span className="text-sm text-emerald-700 font-semibold">معاد فاضي</span>
            <span className="text-[11px] text-emerald-600">
              (أزواج الأيام · عام=ساعة ونص، خاص/شبه خاص=ساعة · 4 أسابيع من {fmtArDate(from)})
            </span>
          </div>
        </div>
      )}

      {!validRange && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">حدّد فترة صحيحة (من ≤ إلى).</div>
      )}

      {isLoading && validRange && (
        <div className="text-center py-16 text-gray-400 text-sm">جارٍ التحميل…</div>
      )}

      {!isLoading && validRange && trainers.length === 0 && (
        <EmptyState title="لا يوجد مدربون في هذا القسم خلال الفترة" />
      )}

      {/* ── Per-trainer cards ── */}
      <div className="space-y-5">
        {trainers.map(t => (
          <TrainerCard
            key={`${t.id}-${t.section}`}
            trainer={t}
            dates={visibleDates}
            recurring={recurringByName[String(t.name || '').replace(/\([^)]*\)/g, '').trim().toLowerCase()]}
          />
        ))}
      </div>
    </div>
  );
}

// ─── one trainer card ──────────────────────────────────────────────────────────
function TrainerCard({ trainer: t, dates, recurring }) {
  const tot = t.totals || {};
  const stats = [
    { label: 'إجمالي العمل', value: fmtMins(tot.available_min), tone: 'text-gray-900' },
    { label: 'المحجوز', value: fmtMins(tot.booked_min), tone: 'text-rose-700' },
    { label: 'المتاح الفاضي', value: fmtMins(Math.max(0, (tot.available_min || 0) - (tot.booked_min || 0))), tone: 'text-emerald-700' },
    { label: 'الإشغال', value: tot.utilization_pct != null ? `${tot.utilization_pct}%` : '—', tone: 'text-blue-700' },
    { label: 'أيام العمل', value: tot.work_days ?? '—', tone: 'text-gray-900' },
  ];
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      {/* header */}
      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3 bg-slate-50/40">
        <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
          {(t.name || '?').trim().charAt(0)}
        </div>
        <div className="flex-1 min-w-[150px]">
          <div className="font-bold text-gray-900 text-sm flex items-center gap-2">
            {t.name}
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 font-semibold">{SECTIONS[t.section] || t.section}</span>
            {t.out_of_shift_hours > 0 && (
              <span title="محاضرات خارج الشيفت — منفصلة، غير محتسبة في النسبة"
                className="text-[10px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-semibold">
                خارج الشيفت {t.out_of_shift_hours}س
              </span>
            )}
          </div>
          <div className="text-[11px] text-gray-500">{t.shift_summary || '—'}</div>
        </div>
        {/* recurring free slots (4 consecutive weeks, day-pairs) */}
        <div className="text-center px-3 py-1.5 rounded-xl border bg-emerald-50 border-emerald-200 min-w-[120px]">
          <div className="text-xl font-black text-emerald-700 leading-none">{recurring?.count ?? 0}</div>
          <div className="text-[10px] text-emerald-700 mt-0.5">معاد فاضي · 4 أسابيع</div>
        </div>
      </div>
      {/* recurring slot details (which day-pair + time) */}
      {recurring?.pairs?.length > 0 && (
        <div className="px-5 py-2 border-b border-gray-100 bg-emerald-50/30 flex flex-wrap gap-x-4 gap-y-1">
          {recurring.pairs.map((pp, i) => (
            <span key={i} className="text-[11px] text-emerald-800">
              <span className="font-semibold">{pp.label}:</span>{' '}
              <span dir="ltr">{pp.slots.join('، ')}</span>
            </span>
          ))}
        </div>
      )}
      {/* stats */}
      <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-5 gap-2 border-b border-gray-100">
        {stats.map(s => (
          <div key={s.label} className="bg-gray-50 rounded-lg px-2 py-2 text-center">
            <div className="text-[10px] text-gray-500">{s.label}</div>
            <div className={`text-base font-bold ${s.tone}`}>{s.value}</div>
          </div>
        ))}
      </div>
      {/* day columns — horizontal scroll */}
      <div className="overflow-x-auto p-3">
        <div className="flex gap-2 min-w-min">
          {dates.map(date => (
            <DayColumn key={date} date={date} day={t.days?.[date]} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── one day column ──────────────────────────────────────────────────────────
function DayColumn({ date, day }) {
  const dow = DOW_AR[dowFromISO(date)];
  const hasLectures = day && (day.lectures || []).length > 0;
  const off = !day || (!day.is_work_day && !hasLectures);
  if (off) {
    return (
      <div className="w-[150px] shrink-0 rounded-xl border border-amber-100 bg-amber-50/60 flex flex-col">
        <div className="px-2 py-1.5 text-center border-b border-amber-100">
          <div className="font-bold text-xs text-gray-700">{dow} {fmtArDate(date)}</div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center py-8 text-amber-600 gap-1">
          <CalendarOff size={20} />
          <span className="text-[10px]">لا يعمل هذا اليوم</span>
        </div>
      </div>
    );
  }
  const blocks = buildBlocks(day);
  return (
    <div className="w-[160px] shrink-0 rounded-xl border border-gray-100 bg-white flex flex-col">
      {/* day header */}
      <div className="px-2 py-1.5 text-center border-b border-gray-100 bg-slate-50/60">
        <div className="font-bold text-xs text-gray-800">{dow} {fmtArDate(date)}</div>
        <div className="text-[10px] mt-0.5">
          <span className="text-emerald-700">متاح {fmtMins(Math.max(0, (day.available_min || 0) - (day.booked_min || 0)))}</span>
          {' · '}
          <span className="text-rose-700">محجوز {fmtMins(day.booked_min)}</span>
        </div>
      </div>
      {/* exact time blocks (booked = red, free = green) */}
      <div className="p-1.5 flex flex-col gap-1">
        {blocks.length === 0 && <div className="text-[10px] text-gray-300 text-center py-2">—</div>}
        {blocks.map((b, i) => {
          const booked = b.type === 'booked';
          return (
            <div key={i}
              className={`rounded-md px-1.5 py-1 text-[10px] font-semibold border leading-snug ${
                booked ? 'bg-rose-50 text-rose-700 border-rose-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'
              }`}>
              <div className="flex items-center gap-1">
                {booked ? <X size={9} /> : <Check size={9} />}
                <span dir="ltr">{fmt12(b.s)} - {fmt12(b.e)}</span>
              </div>
              {booked
                ? <div className="text-[9px] text-gray-600 mt-0.5 break-all leading-tight font-mono" dir="ltr" title={b.group}>{b.group}</div>
                : <div className="text-[9px] text-emerald-600 mt-0.5">متاح</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
