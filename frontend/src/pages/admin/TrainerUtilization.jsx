'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CalendarDays, ChevronLeft, ChevronRight, X,
  Activity, Sun, Moon, Clock, User, Search,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import EmptyState from '../../components/ui/EmptyState';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const SECTIONS = {
  all:        'الكل',
  general:    'عام',
  private:    'خاص',
  semi:       'شبه خاص',
  phone_call: 'فون كول',
};
const DOW_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const DOW_SHORT = ['أحد', 'إثن', 'ثلاث', 'أربع', 'خميس', 'جمعة', 'سبت'];

const fmtISO = d => d.toISOString().slice(0, 10);
const startOfWeek = (d) => {
  // Saturday-start (matches Egyptian academic week)
  const c = new Date(d); c.setHours(12, 0, 0, 0);
  const dow = c.getDay();           // Sun=0 ... Sat=6
  const diff = (dow + 1) % 7;       // back to most recent Saturday
  c.setDate(c.getDate() - diff);
  return c;
};
const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const dowFromISO = iso => new Date(iso + 'T12:00:00').getDay();
const fmtArDate = iso => {
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

// Color mapping — soft modern palette (matches Tailwind tokens used elsewhere)
function utilCellStyle(util, isWorkDay) {
  if (!isWorkDay) return { bg: 'bg-slate-100/70', text: 'text-slate-300', border: 'border-slate-100' };
  if (util == null) return { bg: 'bg-sky-100',  text: 'text-sky-700',  border: 'border-sky-200' };
  if (util === 0)   return { bg: 'bg-sky-100',  text: 'text-sky-700',  border: 'border-sky-200' };
  if (util <= 25)   return { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' };
  if (util <= 50)   return { bg: 'bg-emerald-200', text: 'text-emerald-800', border: 'border-emerald-300' };
  if (util <= 75)   return { bg: 'bg-emerald-400', text: 'text-white',       border: 'border-emerald-500' };
  if (util <= 90)   return { bg: 'bg-amber-300',   text: 'text-amber-950',   border: 'border-amber-400' };
  if (util <= 100)  return { bg: 'bg-amber-500',   text: 'text-white',       border: 'border-amber-600' };
  return                   { bg: 'bg-rose-500',    text: 'text-white',       border: 'border-rose-600' };
}

const SECTION_TONE = {
  general:    'bg-sky-50 text-sky-700 border-sky-200',
  private:    'bg-violet-50 text-violet-700 border-violet-200',
  semi:       'bg-amber-50 text-amber-700 border-amber-200',
  phone_call: 'bg-pink-50 text-pink-700 border-pink-200',
  all:        'bg-slate-100 text-slate-600 border-slate-200',
};

// ─── DAY DETAIL MODAL ─────────────────────────────────────────────────────────
// Format minutes-since-midnight as "04:15 PM" for the free-slots view.
function fmtMinsToClock(m) {
  if (m == null) return '';
  const mod = ((m % 1440) + 1440) % 1440;
  const h24 = Math.floor(mod / 60), mm = mod % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12; if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2,'0')}:${String(mm).padStart(2,'0')} ${ampm}`;
}

function DayDetailModal({ trainer, date, onClose }) {
  const day = trainer.days[date];
  const [view, setView] = useState('booked'); // 'booked' | 'free'
  if (!day) return null;
  const dow = DOW_AR[dowFromISO(date)];
  const lectures = (day.lectures || []).slice().sort((a, b) =>
    String(a.time || '').localeCompare(String(b.time || ''))
  );
  const freeSlots = day.free_slots || [];
  const freeMin = day.free_min ?? freeSlots.reduce((s, f) => s + (f.duration_min || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <div className="text-sm text-gray-500">{trainer.name}</div>
            <div className="font-bold text-gray-900 mt-0.5">{dow} — {fmtArDate(date)}</div>
            <div className="text-xs text-gray-400 mt-0.5">{trainer.shift_summary}</div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Stat row — 4 boxes; "المحجوز" and "المتاح" are clickable to switch view */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {/* السعة */}
            <div className="bg-emerald-50 rounded-xl p-2.5 text-center border border-emerald-100">
              <div className="text-[10px] text-emerald-700 font-semibold mb-0.5">السعة</div>
              <div className="text-base font-bold text-emerald-900">{fmtMins(day.available_min)}</div>
            </div>
            {/* المحجوز — clickable */}
            <button
              type="button"
              onClick={() => day.is_work_day && setView('booked')}
              disabled={!day.is_work_day}
              className={`rounded-xl p-2.5 text-center border transition-all ${
                view === 'booked'
                  ? 'bg-amber-100 border-amber-400 ring-2 ring-amber-300'
                  : 'bg-amber-50 border-amber-100 hover:bg-amber-100'
              } ${!day.is_work_day ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="text-[10px] text-amber-700 font-semibold mb-0.5">المحجوز</div>
              <div className="text-base font-bold text-amber-900">{fmtMins(day.booked_min)}</div>
            </button>
            {/* المتاح — clickable */}
            <button
              type="button"
              onClick={() => day.is_work_day && setView('free')}
              disabled={!day.is_work_day}
              className={`rounded-xl p-2.5 text-center border transition-all ${
                view === 'free'
                  ? 'bg-sky-100 border-sky-400 ring-2 ring-sky-300'
                  : 'bg-sky-50 border-sky-100 hover:bg-sky-100'
              } ${!day.is_work_day ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="text-[10px] text-sky-700 font-semibold mb-0.5">المتاح</div>
              <div className="text-base font-bold text-sky-900">{fmtMins(freeMin)}</div>
            </button>
            {/* الإشغال */}
            <div className="bg-blue-50 rounded-xl p-2.5 text-center border border-blue-100">
              <div className="text-[10px] text-blue-700 font-semibold mb-0.5">الإشغال</div>
              <div className="text-base font-bold text-blue-900">
                {day.utilization_pct != null ? `${day.utilization_pct}%` : '—'}
              </div>
            </div>
          </div>

          {/* Content */}
          {!day.is_work_day ? (
            <div className="text-center py-6 text-sm text-slate-400">يوم خارج الشيفت</div>
          ) : view === 'booked' ? (
            // ── BOOKED VIEW ────────────────────────────────────────────
            lectures.length === 0 ? (
              <div className="text-center py-6 text-sm text-emerald-600 font-semibold">
                ✓ كل اليوم فاضي — مفيش محاضرات محجوزة
              </div>
            ) : (
              <div>
                <div className="text-xs font-bold text-gray-700 mb-2 flex items-center gap-2">
                  <Clock size={12} /> المحاضرات في اليوم ({lectures.length})
                </div>
                <div className="space-y-2">
                  {lectures.map((l, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50/70 border border-gray-100">
                      <div className="flex-shrink-0 text-xs font-mono font-bold text-gray-700 min-w-[70px]" dir="ltr">{l.time}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-gray-900 truncate">{l.group_name}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-gray-500" dir="ltr">{l.duration}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                            l.session_type === 'main'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-purple-100 text-purple-700'
                          }`}>
                            {l.session_type === 'main' ? 'محاضرة' : 'زوم كول'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            // ── FREE VIEW ──────────────────────────────────────────────
            freeSlots.length === 0 ? (
              <div className="text-center py-6 text-sm text-amber-600 font-semibold">
                ⚠ مفيش وقت فاضي — اليوم مكتمل
              </div>
            ) : (
              <div>
                <div className="text-xs font-bold text-gray-700 mb-2 flex items-center gap-2">
                  <Clock size={12} /> الأوقات الفاضية ({freeSlots.length})
                </div>
                <div className="space-y-2">
                  {freeSlots.map((f, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-sky-50/60 border border-sky-100">
                      {/* Time range pill */}
                      <div className="flex-shrink-0 flex items-center gap-1.5 text-xs font-mono font-bold text-sky-900" dir="ltr">
                        <span>{fmtMinsToClock(f.start_min)}</span>
                        <span className="text-sky-400">→</span>
                        <span>{fmtMinsToClock(f.end_min)}</span>
                      </div>
                      <div className="flex-1" />
                      {/* Duration badge */}
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-bold whitespace-nowrap">
                        {fmtMins(f.duration_min)} فاضي
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
          <button onClick={onClose} className="w-full py-2 rounded-xl bg-gray-200 hover:bg-gray-300 text-sm font-semibold text-gray-700 transition-all">
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function TrainerUtilization() {
  // Default: current week (Sat → Fri, 7 days)
  const [weekStart, setWeekStart] = useState(() => fmtISO(startOfWeek(new Date())));
  const [weekCount, setWeekCount] = useState(1); // 1 / 2 / 4 weeks
  const [section, setSection]     = useState('all');
  const [trainerName, setTrainerName] = useState(''); // '' = all trainers
  const [detail, setDetail]       = useState(null); // { trainer, date }

  // Reset trainer selection when section changes — the dropdown options change
  // so the previous selection might no longer be visible.
  const handleSectionChange = (next) => {
    setSection(next);
    setTrainerName('');
  };

  // Fetch the list of active education trainers — used to populate the dropdown.
  // Filtered client-side by the selected section.
  const { data: teamList = [] } = useQuery({
    queryKey: ['team-trainers-education'],
    queryFn: () => api.get('/team', { params: { department: 'education', status: 'active' } }).then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const trainerOptions = useMemo(() => {
    return teamList
      .filter(t => section === 'all' || t.section === section)
      // only trainers with at least one configured shift can appear in the heatmap
      .filter(t => t.shift || t.shift2)
      .map(t => ({
        value: t.name,
        label: String(t.name || '').replace(/\([^)]*\)/g, '').trim() || t.name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }, [teamList, section]);

  // Compute date range
  const fromDate = weekStart;
  const toDate   = useMemo(() => {
    const start = new Date(weekStart + 'T12:00:00');
    return fmtISO(addDays(start, weekCount * 7 - 1));
  }, [weekStart, weekCount]);

  const { data, isLoading } = useQuery({
    queryKey: ['trainer-utilization', fromDate, toDate, section, trainerName],
    queryFn: () => api.get('/reports/trainer-utilization', {
      params: { from: fromDate, to: toDate, section, search: trainerName },
    }).then(r => r.data),
    staleTime: 60 * 1000,
  });

  const dates    = useMemo(() => data?.dates    || [], [data]);
  const trainers = useMemo(() => data?.trainers || [], [data]);

  const shiftWeek = (delta) => {
    const start = new Date(weekStart + 'T12:00:00');
    setWeekStart(fmtISO(addDays(start, delta * 7)));
  };

  // Build week-grouped column structure for header row
  const weekGroups = useMemo(() => {
    const groups = [];
    for (let w = 0; w < weekCount; w++) {
      groups.push({
        label: `أسبوع ${w + 1}`,
        days: dates.slice(w * 7, w * 7 + 7),
      });
    }
    return groups;
  }, [dates, weekCount]);

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="إشغال المدربين"
        subtitle="خريطة الأوقات المتاحة والمحجوزة لكل مدرب"
        icon={Activity}
        gradient="navy"
      />

      {/* ── Filters ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        {/* Week navigator */}
        <div className="flex items-center gap-1 bg-gray-50 rounded-xl p-1 border border-gray-200">
          <button onClick={() => shiftWeek(-1)} className="p-2 rounded-lg hover:bg-white text-gray-600 transition-all" title="الأسبوع السابق">
            <ChevronRight size={16} />
          </button>
          <div className="px-3 py-1.5 text-xs font-bold text-gray-700 flex items-center gap-2 min-w-[180px] justify-center">
            <CalendarDays size={13} className="text-gray-400" />
            {fmtArDate(fromDate)} → {fmtArDate(toDate)}
          </div>
          <button onClick={() => shiftWeek(1)} className="p-2 rounded-lg hover:bg-white text-gray-600 transition-all" title="الأسبوع التالي">
            <ChevronLeft size={16} />
          </button>
        </div>

        {/* Week count */}
        <div className="flex items-center gap-1 bg-gray-50 rounded-xl p-1 border border-gray-200">
          {[1, 2, 4].map(n => (
            <button
              key={n}
              onClick={() => setWeekCount(n)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                weekCount === n
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-white'
              }`}
            >
              {n} أسبوع
            </button>
          ))}
        </div>

        {/* Section */}
        <select
          value={section}
          onChange={e => handleSectionChange(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        >
          {Object.entries(SECTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {/* Trainer dropdown — only active education trainers, filtered by section */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <select
            value={trainerName}
            onChange={e => setTrainerName(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl pr-9 pl-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-white appearance-none"
          >
            <option value="">كل المدربين ({trainerOptions.length})</option>
            {trainerOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Today button */}
        <button
          onClick={() => setWeekStart(fmtISO(startOfWeek(new Date())))}
          className="px-3 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold border border-blue-200 transition-all"
        >
          هذا الأسبوع
        </button>

        {/* Find available trainer — Phase 2 entry point */}
        <Link
          to="/admin/reports/find-available-trainer"
          className="ms-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-l from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-bold transition-all shadow-sm hover:shadow-md"
        >
          <Search size={14} />
          ابحث عن مدرب متاح
        </Link>
      </div>

      {/* ── Heatmap ── */}
      {isLoading ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => <div key={i} className="h-14 bg-gray-100 animate-pulse rounded-xl" />)}
        </div>
      ) : trainers.length === 0 ? (
        <div className="bg-white rounded-3xl border border-gray-100">
          <EmptyState
            icon={Activity}
            accent="gray"
            title="لا يوجد مدربين"
            message="ما فيش مدربين في الإدارة التعليمية ليهم شيفت مسجل في الفترة دي"
          />
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
          <table className="min-w-full text-xs" dir="rtl">
            {/* ── Column headers ── */}
            <thead>
              <tr className="bg-gradient-to-l from-slate-50 to-white border-b-2 border-slate-100">
                <th className="text-right px-4 py-3 font-bold text-gray-700 sticky right-0 bg-white border-l border-slate-100 min-w-[200px]">
                  المدرب
                </th>
                {weekGroups.map((g, gi) => (
                  g.days.map((d, di) => {
                    const isFirstOfWeek = di === 0 && gi > 0;
                    return (
                      <th
                        key={d}
                        className={`px-1 py-2 font-semibold text-gray-500 min-w-[50px] ${
                          isFirstOfWeek ? 'border-r-2 border-slate-200' : ''
                        }`}
                      >
                        <div className="text-[10px] text-gray-400">{DOW_SHORT[dowFromISO(d)]}</div>
                        <div className="text-[10px] font-bold text-gray-600 mt-0.5">{fmtArDate(d)}</div>
                      </th>
                    );
                  })
                ))}
                <th className="text-center px-3 py-2 font-bold text-gray-700 min-w-[80px] border-r-2 border-slate-200">
                  المتوسط
                </th>
              </tr>
            </thead>

            {/* ── Rows ── */}
            <tbody>
              {trainers.map(t => (
                <tr key={t.id} className="border-b border-gray-50 hover:bg-slate-50/40 transition-colors">
                  {/* Trainer cell */}
                  <td className="px-4 py-2 sticky right-0 bg-white border-l border-slate-100">
                    <div className="font-bold text-gray-900 text-xs">{t.name}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold border ${SECTION_TONE[t.section] || SECTION_TONE.all}`}>
                        {SECTIONS[t.section] || t.section}
                      </span>
                      {t.shift_summary?.includes('مسائي') ? (
                        <Moon size={10} className="text-indigo-400" />
                      ) : t.shift_summary?.includes('صباحي') ? (
                        <Sun size={10} className="text-amber-400" />
                      ) : null}
                    </div>
                  </td>

                  {/* Day cells */}
                  {weekGroups.map((g, gi) => (
                    g.days.map((d, di) => {
                      const dayInfo = t.days[d];
                      if (!dayInfo) return <td key={d} className="p-1" />;
                      const style = utilCellStyle(dayInfo.utilization_pct, dayInfo.is_work_day);
                      const isFirstOfWeek = di === 0 && gi > 0;
                      const showText = dayInfo.is_work_day;
                      return (
                        <td
                          key={d}
                          className={`p-1 ${isFirstOfWeek ? 'border-r-2 border-slate-200' : ''}`}
                        >
                          <button
                            onClick={() => setDetail({ trainer: t, date: d })}
                            disabled={!dayInfo.is_work_day}
                            className={`w-full aspect-square min-h-[44px] rounded-lg border ${style.bg} ${style.border} flex items-center justify-center text-xs font-bold ${style.text} hover:scale-105 hover:shadow-md transition-all duration-150 ${!dayInfo.is_work_day ? 'cursor-default' : 'cursor-pointer'}`}
                            title={
                              !dayInfo.is_work_day
                                ? 'يوم خارج الشيفت'
                                : `${fmtMins(dayInfo.booked_min)} / ${fmtMins(dayInfo.available_min)} محجوز`
                            }
                          >
                            {showText && (dayInfo.utilization_pct != null ? `${dayInfo.utilization_pct}%` : '—')}
                          </button>
                        </td>
                      );
                    })
                  ))}

                  {/* Average column */}
                  <td className="text-center px-3 py-2 border-r-2 border-slate-200">
                    {(() => {
                      const total = t.totals;
                      if (total.utilization_pct == null) {
                        return <span className="text-slate-300">—</span>;
                      }
                      const style = utilCellStyle(total.utilization_pct, true);
                      return (
                        <div className={`inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-xs font-bold border ${style.bg} ${style.border} ${style.text}`}>
                          {total.utilization_pct}%
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Legend ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center justify-center gap-4 flex-wrap text-xs">
        <span className="text-gray-500 font-semibold">دليل الألوان:</span>
        {[
          { lbl: 'فاضي', cls: 'bg-sky-100 border-sky-200 text-sky-700' },
          { lbl: '1-25%', cls: 'bg-emerald-100 border-emerald-200 text-emerald-700' },
          { lbl: '26-50%', cls: 'bg-emerald-200 border-emerald-300 text-emerald-800' },
          { lbl: '51-75%', cls: 'bg-emerald-400 border-emerald-500 text-white' },
          { lbl: '76-90%', cls: 'bg-amber-300 border-amber-400 text-amber-950' },
          { lbl: '91-100%', cls: 'bg-amber-500 border-amber-600 text-white' },
          { lbl: 'زيادة', cls: 'bg-rose-500 border-rose-600 text-white' },
          { lbl: 'خارج الشيفت', cls: 'bg-slate-100 border-slate-200 text-slate-400' },
        ].map(item => (
          <div key={item.lbl} className="flex items-center gap-1.5">
            <span className={`inline-block w-5 h-5 rounded-md border ${item.cls}`} />
            <span className="text-gray-600 font-semibold">{item.lbl}</span>
          </div>
        ))}
      </div>

      {/* ── Detail modal ── */}
      {detail && (
        <DayDetailModal
          trainer={detail.trainer}
          date={detail.date}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
