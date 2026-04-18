import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  UserX, Users, Video, CalendarDays, TrendingDown, XCircle,
  AlertTriangle, CheckCircle2, Activity,
} from 'lucide-react';
import api from '../../api/axios';

/* ─── Utilities ──────────────────────────────────────────────────────────── */
const PERIODS = [
  { value: 'all',   label: 'كل الوقت' },
  { value: 'today', label: 'اليوم' },
  { value: 'week',  label: 'هذا الأسبوع' },
  { value: 'month', label: 'هذا الشهر' },
];

function periodToRange(period) {
  const today = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  if (period === 'today') return { from: iso(today), to: iso(today) };
  if (period === 'week') {
    const start = new Date(today); start.setDate(today.getDate() - 6);
    return { from: iso(start), to: iso(today) };
  }
  if (period === 'month') {
    const start = new Date(today); start.setDate(today.getDate() - 29);
    return { from: iso(start), to: iso(today) };
  }
  return { from: '', to: '' };
}

function rateColor(rate) {
  if (rate >= 30) return { bar: 'bg-red-500',     text: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-200'     };
  if (rate >= 15) return { bar: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200'   };
  if (rate > 0)   return { bar: 'bg-yellow-400',  text: 'text-yellow-700',  bg: 'bg-yellow-50',  border: 'border-yellow-200'  };
  return            { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' };
}

function initialsOf(name) {
  if (!name || name === '--') return '؟';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
}

function colorFromName(name) {
  if (!name) return 'bg-gray-500';
  const palette = [
    'bg-blue-500', 'bg-emerald-500', 'bg-purple-500',
    'bg-rose-500', 'bg-amber-500', 'bg-indigo-500',
    'bg-pink-500', 'bg-teal-500', 'bg-orange-500',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

/* ─── Reusable KPI Card ──────────────────────────────────────────────────── */
function KpiCard({ icon: Icon, label, value, accent, sublabel, trend }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border ${accent.border} ${accent.bg} px-5 py-4 transition-all hover:shadow-md`}>
      <div className="flex items-center gap-4">
        <div className={`p-2.5 rounded-xl ${accent.iconBg}`}>
          <Icon size={22} className={accent.iconColor} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-semibold ${accent.text} opacity-80 truncate`}>{label}</p>
          <p className={`text-2xl font-black ${accent.text} leading-tight`}>{value}</p>
          {sublabel && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{sublabel}</p>}
        </div>
        {trend != null && (
          <div className={`text-sm font-black ${accent.text} tabular-nums`}>{trend}%</div>
        )}
      </div>
      {/* decorative watermark icon */}
      <Icon size={78} className={`${accent.iconColor} absolute -bottom-4 -left-4 opacity-[0.06] pointer-events-none`} />
    </div>
  );
}

/* ─── Absence Cell — progress bar + % ─────────────────────────────────────── */
function AbsenceRateCell({ rate, absent, expected }) {
  const c = rateColor(rate);
  return (
    <div className="flex items-center gap-2.5 min-w-[160px]">
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className={`${c.bar} h-2 rounded-full transition-all`} style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
      <span className={`text-xs font-black tabular-nums w-9 text-left ${c.text}`}>{rate}%</span>
    </div>
  );
}

/* ─── Main Page ───────────────────────────────────────────────────────────── */
export default function AttendanceAbsenceReport() {
  const [period, setPeriod] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [coordQuery, setCoordQuery] = useState('');

  const hasDateRange = dateFrom || dateTo;
  const effective = useMemo(() => {
    if (hasDateRange) return { from: dateFrom || undefined, to: dateTo || undefined };
    const r = periodToRange(period);
    return { from: r.from || undefined, to: r.to || undefined };
  }, [hasDateRange, dateFrom, dateTo, period]);

  const { data: raw, isLoading } = useQuery({
    queryKey: ['attendance-absence', effective.from, effective.to],
    queryFn: () => api.get('/reports/attendance-absence', {
      params: { from_date: effective.from, to_date: effective.to },
    }).then(r => r.data),
    staleTime: 60 * 1000,
  });

  // Split multi-name coordinator fields (e.g. "Mostafa, fouad") per row
  const data = useMemo(() => {
    if (!raw) return [];
    const map = new Map();
    raw.forEach(r => {
      const coords = (r.coordinator || '--').includes(',')
        ? r.coordinator.split(',').map(c => c.trim()).filter(Boolean)
        : [r.coordinator?.trim() || '--'];
      coords.forEach(c => {
        if (!map.has(c)) {
          map.set(c, {
            coordinator: c,
            main_expected: 0, main_absent: 0,
            zoom_expected: 0, zoom_absent: 0,
          });
        }
        const row = map.get(c);
        row.main_expected += r.main_expected || 0;
        row.main_absent   += r.main_absent   || 0;
        row.zoom_expected += r.zoom_expected || 0;
        row.zoom_absent   += r.zoom_absent   || 0;
      });
    });
    return Array.from(map.values())
      .map(r => ({
        ...r,
        main_absence_rate: r.main_expected > 0 ? Math.round((r.main_absent / r.main_expected) * 100) : 0,
        zoom_absence_rate: r.zoom_expected > 0 ? Math.round((r.zoom_absent / r.zoom_expected) * 100) : 0,
      }))
      .filter(r => coordQuery ? r.coordinator.toLowerCase().includes(coordQuery.toLowerCase()) : true)
      .sort((a, b) => (b.main_absent + b.zoom_absent) - (a.main_absent + a.zoom_absent));
  }, [raw, coordQuery]);

  /* ─── Totals ──────────────────────────────────────────────────── */
  const totals = useMemo(() => {
    const sum = data.reduce((acc, r) => ({
      main_expected: acc.main_expected + r.main_expected,
      main_absent:   acc.main_absent   + r.main_absent,
      zoom_expected: acc.zoom_expected + r.zoom_expected,
      zoom_absent:   acc.zoom_absent   + r.zoom_absent,
    }), { main_expected: 0, main_absent: 0, zoom_expected: 0, zoom_absent: 0 });
    return {
      ...sum,
      main_rate: sum.main_expected > 0 ? Math.round((sum.main_absent / sum.main_expected) * 100) : 0,
      zoom_rate: sum.zoom_expected > 0 ? Math.round((sum.zoom_absent / sum.zoom_expected) * 100) : 0,
    };
  }, [data]);

  const selectCls = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]';

  return (
    <div className="space-y-5 animate-fadeIn" dir="rtl">
      {/* ─── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-[#1e3a5f] to-[#2d5a8e] rounded-xl shadow-md">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-900">تقارير الحضور والغياب</h1>
            <p className="text-xs text-gray-400 mt-0.5">إحصائيات الحضور الأساسية والزووم كولز لكل منسق</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="search"
            placeholder="🔍 ابحث باسم المنسق..."
            value={coordQuery}
            onChange={e => setCoordQuery(e.target.value)}
            className={`${selectCls} w-52`}
          />

          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            disabled={!!hasDateRange}
            className={`${selectCls} ${hasDateRange ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>

          <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-1.5">
            <CalendarDays size={14} className="text-gray-400" />
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="border-0 p-0 text-xs focus:ring-0 outline-none bg-transparent text-gray-700"
              placeholder="من"
            />
            <span className="text-xs text-gray-300">←</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="border-0 p-0 text-xs focus:ring-0 outline-none bg-transparent text-gray-700"
              placeholder="إلى"
            />
            {hasDateRange && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="text-gray-400 hover:text-red-500 transition-colors"
                title="مسح التاريخ"
              >
                <XCircle size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── KPI Summary Row (6 cards in 2 rows) ────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Row 1: Main Sessions */}
        <KpiCard
          icon={Users}
          label="إجمالي الحضور المتوقع — الجلسات الأساسية"
          value={totals.main_expected.toLocaleString('en-US')}
          sublabel="إجمالي الطلاب المتوقع حضورهم"
          accent={{
            bg: 'bg-gradient-to-br from-sky-50 to-white',
            border: 'border-sky-200',
            text: 'text-sky-900',
            iconBg: 'bg-sky-100',
            iconColor: 'text-sky-600',
          }}
        />
        <KpiCard
          icon={UserX}
          label="إجمالي الغياب — الجلسات الأساسية"
          value={totals.main_absent.toLocaleString('en-US')}
          sublabel="إجمالي الطلاب الغائبين"
          accent={{
            bg: 'bg-gradient-to-br from-rose-50 to-white',
            border: 'border-rose-200',
            text: 'text-rose-900',
            iconBg: 'bg-rose-100',
            iconColor: 'text-rose-600',
          }}
        />
        <KpiCard
          icon={TrendingDown}
          label="نسبة الغياب — الأساسية"
          value={`${totals.main_rate}%`}
          sublabel={totals.main_rate >= 30 ? 'مرتفع جداً' : totals.main_rate >= 15 ? 'متوسط' : totals.main_rate > 0 ? 'منخفض' : 'ممتاز'}
          accent={rateColor(totals.main_rate).bar === 'bg-emerald-500' ? {
            bg: 'bg-gradient-to-br from-emerald-50 to-white',
            border: 'border-emerald-200',
            text: 'text-emerald-900',
            iconBg: 'bg-emerald-100',
            iconColor: 'text-emerald-600',
          } : totals.main_rate >= 30 ? {
            bg: 'bg-gradient-to-br from-red-50 to-white',
            border: 'border-red-200',
            text: 'text-red-900',
            iconBg: 'bg-red-100',
            iconColor: 'text-red-600',
          } : {
            bg: 'bg-gradient-to-br from-amber-50 to-white',
            border: 'border-amber-200',
            text: 'text-amber-900',
            iconBg: 'bg-amber-100',
            iconColor: 'text-amber-600',
          }}
        />

        {/* Row 2: Zoom/Side Sessions */}
        <KpiCard
          icon={Video}
          label="إجمالي الحضور المتوقع — الزووم كولز"
          value={totals.zoom_expected.toLocaleString('en-US')}
          sublabel="إجمالي الجلسات الجانبية المتوقعة"
          accent={{
            bg: 'bg-gradient-to-br from-indigo-50 to-white',
            border: 'border-indigo-200',
            text: 'text-indigo-900',
            iconBg: 'bg-indigo-100',
            iconColor: 'text-indigo-600',
          }}
        />
        <KpiCard
          icon={UserX}
          label="إجمالي الغياب — الزووم كولز"
          value={totals.zoom_absent.toLocaleString('en-US')}
          sublabel="إجمالي الطلاب الغائبين"
          accent={{
            bg: 'bg-gradient-to-br from-fuchsia-50 to-white',
            border: 'border-fuchsia-200',
            text: 'text-fuchsia-900',
            iconBg: 'bg-fuchsia-100',
            iconColor: 'text-fuchsia-600',
          }}
        />
        <KpiCard
          icon={TrendingDown}
          label="نسبة الغياب — الزووم كولز"
          value={`${totals.zoom_rate}%`}
          sublabel={totals.zoom_rate >= 30 ? 'مرتفع جداً' : totals.zoom_rate >= 15 ? 'متوسط' : totals.zoom_rate > 0 ? 'منخفض' : 'ممتاز'}
          accent={rateColor(totals.zoom_rate).bar === 'bg-emerald-500' ? {
            bg: 'bg-gradient-to-br from-emerald-50 to-white',
            border: 'border-emerald-200',
            text: 'text-emerald-900',
            iconBg: 'bg-emerald-100',
            iconColor: 'text-emerald-600',
          } : totals.zoom_rate >= 30 ? {
            bg: 'bg-gradient-to-br from-red-50 to-white',
            border: 'border-red-200',
            text: 'text-red-900',
            iconBg: 'bg-red-100',
            iconColor: 'text-red-600',
          } : {
            bg: 'bg-gradient-to-br from-amber-50 to-white',
            border: 'border-amber-200',
            text: 'text-amber-900',
            iconBg: 'bg-amber-100',
            iconColor: 'text-amber-600',
          }}
        />
      </div>

      {/* ─── Data Table ──────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
        {/* Subheader legend */}
        <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-3 bg-gradient-to-l from-gray-50/50 to-white border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-[#1e3a5f]/10 rounded-lg">
              <Users size={14} className="text-[#1e3a5f]" />
            </div>
            <p className="text-sm font-bold text-gray-700">
              تفاصيل لكل منسق
              {data.length > 0 && (
                <span className="text-xs text-gray-400 font-normal mr-2">({data.length} منسق)</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> ممتاز ({'<'}15%)</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> متوسط (15-30%)</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /> مرتفع ({'≥'}30%)</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-100">
                <th rowSpan={2} className="px-5 py-3 text-xs font-bold text-gray-500 text-right sticky right-0 bg-gray-50/80 z-10">المنسق</th>
                <th colSpan={3} className="px-4 py-2 text-xs font-bold text-sky-700 border-r border-gray-200 bg-sky-50/60">
                  <div className="flex items-center justify-center gap-1.5">
                    <Users size={14} /> الجلسات الأساسية
                  </div>
                </th>
                <th colSpan={3} className="px-4 py-2 text-xs font-bold text-indigo-700 border-r border-gray-200 bg-indigo-50/60">
                  <div className="flex items-center justify-center gap-1.5">
                    <Video size={14} /> الزووم كولز
                  </div>
                </th>
              </tr>
              <tr className="bg-gray-50/80 border-b border-gray-100">
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 border-r border-gray-200">متوقع</th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500">غياب</th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500">نسبة الغياب</th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 border-r border-gray-200">متوقع</th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500">غياب</th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500">نسبة الغياب</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className="h-3 bg-gray-100 rounded-full w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : !data.length ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <CheckCircle2 size={36} className="text-gray-300" />
                      <p className="text-sm">لا توجد بيانات لعرضها</p>
                      <p className="text-xs">جرب تغيير الفترة الزمنية أو مسح الفلاتر</p>
                    </div>
                  </td>
                </tr>
              ) : data.map((r, i) => {
                const mainC = rateColor(r.main_absence_rate);
                const zoomC = rateColor(r.zoom_absence_rate);
                return (
                  <tr key={i} className="hover:bg-gray-50/60 transition-colors">
                    {/* Coordinator cell — avatar + name */}
                    <td className="px-5 py-3.5 sticky right-0 bg-white hover:bg-gray-50/60 z-10">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-9 h-9 rounded-full ${colorFromName(r.coordinator)} text-white font-bold text-xs flex items-center justify-center flex-shrink-0 shadow-sm`}>
                          {initialsOf(r.coordinator)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900 text-sm truncate">{r.coordinator}</p>
                          <p className="text-[10px] text-gray-400">
                            إجمالي الغياب: {r.main_absent + r.zoom_absent}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Main — expected */}
                    <td className="px-4 py-3.5 text-gray-700 font-semibold tabular-nums border-r border-gray-100">
                      {r.main_expected.toLocaleString('en-US')}
                    </td>
                    {/* Main — absent */}
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-black border tabular-nums ${
                        r.main_absent > 0 ? `${mainC.bg} ${mainC.text} ${mainC.border}` : 'bg-gray-50 text-gray-400 border-gray-100'
                      }`}>
                        {r.main_absent.toLocaleString('en-US')}
                      </span>
                    </td>
                    {/* Main — rate */}
                    <td className="px-4 py-3.5">
                      <AbsenceRateCell rate={r.main_absence_rate} absent={r.main_absent} expected={r.main_expected} />
                    </td>

                    {/* Zoom — expected */}
                    <td className="px-4 py-3.5 text-gray-700 font-semibold tabular-nums border-r border-gray-100">
                      {r.zoom_expected.toLocaleString('en-US')}
                    </td>
                    {/* Zoom — absent */}
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-black border tabular-nums ${
                        r.zoom_absent > 0 ? `${zoomC.bg} ${zoomC.text} ${zoomC.border}` : 'bg-gray-50 text-gray-400 border-gray-100'
                      }`}>
                        {r.zoom_absent.toLocaleString('en-US')}
                      </span>
                    </td>
                    {/* Zoom — rate */}
                    <td className="px-4 py-3.5">
                      <AbsenceRateCell rate={r.zoom_absence_rate} absent={r.zoom_absent} expected={r.zoom_expected} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Footer totals */}
            {data.length > 0 && (
              <tfoot>
                <tr className="bg-gradient-to-l from-[#1e3a5f]/5 to-transparent border-t-2 border-[#1e3a5f]/20 font-bold">
                  <td className="px-5 py-3.5 sticky right-0 bg-[#f4f6fa] z-10 text-[#1e3a5f]">الإجمالي</td>
                  <td className="px-4 py-3.5 text-[#1e3a5f] tabular-nums border-r border-gray-200">{totals.main_expected.toLocaleString('en-US')}</td>
                  <td className="px-4 py-3.5 text-rose-700 tabular-nums">{totals.main_absent.toLocaleString('en-US')}</td>
                  <td className="px-4 py-3.5"><AbsenceRateCell rate={totals.main_rate} absent={totals.main_absent} expected={totals.main_expected} /></td>
                  <td className="px-4 py-3.5 text-[#1e3a5f] tabular-nums border-r border-gray-200">{totals.zoom_expected.toLocaleString('en-US')}</td>
                  <td className="px-4 py-3.5 text-fuchsia-700 tabular-nums">{totals.zoom_absent.toLocaleString('en-US')}</td>
                  <td className="px-4 py-3.5"><AbsenceRateCell rate={totals.zoom_rate} absent={totals.zoom_absent} expected={totals.zoom_expected} /></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Info footer */}
      {!isLoading && data.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-gray-500 px-2">
          <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p>
            <strong>ملاحظة:</strong> الإحصائيات تعتمد على المحاضرات الأساسية والجلسات الجانبية المؤكدة (مدتها ≤ ١٥ دقيقة).
            الجلسات التي لا تحتوي على بيانات حضور تُحسب كغياب كامل.
          </p>
        </div>
      )}
    </div>
  );
}
