'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, CalendarDays, Check, X, AlertTriangle, CalendarOff, Activity } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import EmptyState from '../../components/ui/EmptyState';
import HolidayBanner from '../../components/ui/HolidayBanner';

// ─── helpers ────────────────────────────────────────────────────────────────
const SECTIONS = { all: 'الكل', general: 'عام', private: 'خاص', semi: 'شبه خاص', phone_call: 'فون كول' };
const DOW_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
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
// short group label from a lecture group_name (strip date/day/time prefix noise)
const shortGroup = g => {
  if (!g) return '';
  const noParen = String(g).replace(/\([^)]*\)/g, '').trim();
  const m = noParen.match(/(General\s?\d|Con\s?\d|Conversation\s?\d|Starter\s?\d|Con_\d|General_?\d)/i);
  return m ? m[1].replace(/_/g, ' ') : noParen.split('_').slice(-2).join(' ');
};

// Build per-hour cells for a day: booked (a lecture overlaps) / free (in a free slot) / off.
function buildHourCells(day) {
  const lec = (day.lectures || [])
    .map(l => { const s = parseTime12(l.time), d = parseDur(l.duration); return s >= 0 && d > 0 ? { s, e: s + d, l } : null; })
    .filter(Boolean);
  const free = (day.free_slots || []).map(f => [f.start_min, f.end_min]);
  const spans = [...lec.map(x => [x.s, x.e]), ...free];
  if (!spans.length) return [];
  let lo = Math.min(...spans.map(x => x[0])), hi = Math.max(...spans.map(x => x[1]));
  lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60;
  const cells = [];
  for (let h = lo; h < hi; h += 60) {
    const booked = lec.find(x => x.s < h + 60 && x.e > h);
    const isFree = free.some(f => f[0] < h + 60 && f[1] > h);
    cells.push({ start: h, status: booked ? 'booked' : (isFree ? 'free' : 'off') });
  }
  return cells;
}

// ─── main page ────────────────────────────────────────────────────────────────
export default function TrainerDetails() {
  const today = new Date();
  const [section, setSection] = useState('semi');
  const [from, setFrom] = useState(fmtISO(today));
  const [to, setTo] = useState(fmtISO(addDays(today, 30)));

  const validRange = from && to && from <= to;
  const { data, isLoading } = useQuery({
    queryKey: ['trainer-details', from, to, section],
    queryFn: () => api.get('/reports/trainer-utilization', {
      params: { from, to, section },
    }).then(r => r.data),
    enabled: validRange,
    staleTime: 60 * 1000,
  });

  const dates = useMemo(() => data?.dates || [], [data]);
  const trainers = useMemo(
    () => (data?.trainers || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar')),
    [data]
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
          <span className="text-xs font-bold text-gray-500">من</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 bg-gray-50 focus:bg-white outline-none" />
          <span className="text-xs font-bold text-gray-500">إلى</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 bg-gray-50 focus:bg-white outline-none" />
        </div>
        <div className="text-xs text-gray-400 flex items-center gap-1">
          <CalendarDays size={13} /> {fmtArDate(from)} → {fmtArDate(to)} · {trainers.length} مدرب
        </div>
      </div>

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
          <TrainerCard key={`${t.id}-${t.section}`} trainer={t} dates={dates} />
        ))}
      </div>
    </div>
  );
}

// ─── one trainer card ──────────────────────────────────────────────────────────
function TrainerCard({ trainer: t, dates }) {
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
      </div>
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
  const cells = buildHourCells(day);
  const lectures = (day.lectures || []).slice().sort((a, b) => parseTime12(a.time) - parseTime12(b.time));
  return (
    <div className="w-[150px] shrink-0 rounded-xl border border-gray-100 bg-white flex flex-col">
      {/* day header */}
      <div className="px-2 py-1.5 text-center border-b border-gray-100 bg-slate-50/60">
        <div className="font-bold text-xs text-gray-800">{dow} {fmtArDate(date)}</div>
        <div className="text-[10px] mt-0.5">
          <span className="text-emerald-700">متاح {fmtMins(Math.max(0, (day.available_min || 0) - (day.booked_min || 0)))}</span>
          {' · '}
          <span className="text-rose-700">محجوز {fmtMins(day.booked_min)}</span>
        </div>
      </div>
      {/* hour cells */}
      <div className="p-1.5 flex flex-col gap-1">
        {cells.length === 0 && <div className="text-[10px] text-gray-300 text-center py-2">—</div>}
        {cells.map(c => {
          if (c.status === 'off') {
            return <div key={c.start} className="rounded-md py-1 text-center text-[11px] bg-gray-50 text-gray-300">{fmt12(c.start)}</div>;
          }
          const booked = c.status === 'booked';
          return (
            <div key={c.start}
              className={`rounded-md py-1 text-center text-[11px] font-semibold flex items-center justify-center gap-1 ${
                booked ? 'bg-rose-50 text-rose-700 border border-rose-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
              }`}>
              {booked ? <X size={10} /> : <Check size={10} />} {fmt12(c.start)}
            </div>
          );
        })}
      </div>
      {/* booked activities */}
      {lectures.length > 0 && (
        <div className="border-t border-gray-100 px-2 py-2">
          <div className="text-[10px] text-gray-500 mb-1">المحاضرات المحجوزة</div>
          <div className="flex flex-col gap-0.5">
            {lectures.map((l, i) => (
              <div key={i} className="text-[10px] text-gray-700 leading-snug">
                <span className="text-rose-600 font-semibold">{fmt12(parseTime12(l.time))}</span>{' '}
                <span className="text-gray-500">{shortGroup(l.group_name)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
