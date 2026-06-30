import { useState, useMemo, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  UserX, Users, Video, CalendarDays, TrendingDown, XCircle,
  AlertTriangle, CheckCircle2, Activity, Search, Layers, Building2,
  X, Phone, Hash, ChevronDown, ChevronLeft,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

/* ─── Utilities ──────────────────────────────────────────────────────────── */
const PERIODS = [
  { value: 'all',   label: 'كل الوقت' },
  { value: 'today', label: 'اليوم' },
  { value: 'week',  label: 'هذا الأسبوع' },
  { value: 'month', label: 'هذا الشهر' },
];

function periodToRange(period) {
  const today = new Date();
  // Local-date ISO (avoid UTC offset bug)
  const iso = d => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  if (period === 'today') return { from: iso(today), to: iso(today) };
  if (period === 'week') {
    // Start of current week (Saturday — common Arab week start)
    const start = new Date(today);
    const dayOfWeek = start.getDay(); // 0=Sun..6=Sat
    const diff = (dayOfWeek + 1) % 7;  // distance back to Saturday
    start.setDate(start.getDate() - diff);
    return { from: iso(start), to: iso(today) };
  }
  if (period === 'month') {
    // First day of current calendar month
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
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

/* ─── Per-coordinator MOVEMENT breakdown (section-periods) ──────────────────── */
const SEC_LABEL = { all: 'الكل', general: 'عام', private: 'خاص', semi: 'شبه خاص', phone_call: 'فون كول', phone_call_general: 'فون كول عام', phone_call_semi: 'فون كول شبه خاص', phone_call_private: 'فون كول خاص' };
const SEC_CLS = {
  general: 'bg-sky-50 text-sky-700 border-sky-200',
  private: 'bg-violet-50 text-violet-700 border-violet-200',
  semi:    'bg-amber-50 text-amber-700 border-amber-200',
  phone_call: 'bg-pink-50 text-pink-700 border-pink-200',
  phone_call_general: 'bg-pink-50 text-pink-700 border-pink-200',
  phone_call_semi:    'bg-rose-50 text-rose-700 border-rose-200',
  phone_call_private: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  all:     'bg-gray-50 text-gray-600 border-gray-200',
};
function CoordinatorSegments({ coordinator, from, to }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['coord-segments', coordinator, from, to],
    queryFn: () => api.get('/reports/attendance-absence/segments', {
      params: { coordinator, from_date: from || undefined, to_date: to || undefined },
    }).then(r => r.data),
    staleTime: 30 * 1000,
  });
  const segs = data?.segments || [];
  const noteFor = (g) => {
    const toTxt = g.to || '—';
    if (g.ended_by === 'transition') return `هذه الأرقام حتى ${toTxt} — انتقل إلى قسم ${SEC_LABEL[g.next_section] || g.next_section || '—'}`;
    if (g.ended_by === 'left_work')  return `حتى ${toTxt} — ترك العمل`;
    return `حتى ${toTxt}`;
  };
  const noteCls = (e) => e === 'transition' ? 'bg-amber-50 text-amber-700 border border-amber-200'
                       : e === 'left_work'  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                       :                      'bg-emerald-50 text-emerald-700 border border-emerald-200';
  if (isLoading) return <div className="px-6 py-4 text-xs text-gray-400">جارٍ تحميل تفصيل الحركات…</div>;
  if (isError)   return <div className="px-6 py-4 text-xs text-rose-500">تعذّر تحميل التفصيل</div>;
  if (!segs.length) return <div className="px-6 py-4 text-xs text-gray-400">لا توجد فترات بأرقام في هذه المدة.</div>;
  return (
    <div className="px-6 py-3">
      <div className="text-[11px] font-bold text-slate-600 mb-2 flex items-center gap-1.5">
        <Layers size={12} /> تفصيل الحركات — {coordinator}
        {data?.employment && (data.employment.start_date || data.employment.end_date) && (
          <span className="text-[10px] font-normal text-gray-400" dir="ltr">
            ({data.employment.start_date || '—'} → {data.employment.end_date || 'حتى الآن'})
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {segs.map((g, idx) => (
          <div key={idx} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 bg-white rounded-lg border border-slate-200 px-3 py-2">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${SEC_CLS[String(g.section || '').toLowerCase()] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
              {SEC_LABEL[String(g.section || '').toLowerCase()] || g.section || '—'}
            </span>
            <span className="text-[11px] text-gray-600 font-mono" dir="ltr">{g.from || '?'} → {g.to || '?'}</span>
            <span className="text-[11px] text-gray-700">
              <b className="text-sky-700">أساسي</b> {g.main_absent}/{g.main_expected} <span className="text-gray-400">({g.main_absence_rate}%)</span>
            </span>
            <span className="text-[11px] text-gray-700">
              <b className="text-indigo-700">زوم</b> {g.zoom_absent}/{g.zoom_expected} <span className="text-gray-400">({g.zoom_absence_rate}%)</span>
            </span>
            <span className={`ms-auto text-[10px] px-2 py-0.5 rounded-full font-bold ${noteCls(g.ended_by)}`}>
              {noteFor(g)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Main Page ───────────────────────────────────────────────────────────── */
export default function AttendanceAbsenceReport() {
  const [period, setPeriod] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [coordQuery, setCoordQuery] = useState('');
  const [department, setDepartment] = useState('');  // '' = all
  // Detail modal — opened by clicking an absent number cell
  const [detail, setDetail] = useState(null); // { coordinator, type: 'main' | 'zoom', count, rateRow }
  // Expanded coordinator — shows their per-movement (section-period) breakdown.
  const [expanded, setExpanded] = useState(null); // coordinator name | null

  const hasDateRange = dateFrom || dateTo;
  const effective = useMemo(() => {
    if (hasDateRange) return { from: dateFrom || undefined, to: dateTo || undefined };
    const r = periodToRange(period);
    return { from: r.from || undefined, to: r.to || undefined };
  }, [hasDateRange, dateFrom, dateTo, period]);

  const queryParams = useMemo(() => {
    const p = { from_date: effective.from, to_date: effective.to };
    if (department) p.department = department;
    return p;
  }, [effective.from, effective.to, department]);

  const { data: raw, isLoading } = useQuery({
    queryKey: ['attendance-absence', queryParams],
    queryFn: () => api.get('/reports/attendance-absence', { params: queryParams }).then(r => r.data),
    staleTime: 60 * 1000,
  });


  // Split multi-name coordinator fields (e.g. "Mostafa, fouad") per row.
  // current_department arrives as a comma-separated string matching the
  // order of coordinator names — we split it in parallel.
  const data = useMemo(() => {
    if (!raw) return [];
    const map = new Map();
    raw.forEach(r => {
      const coords = (r.coordinator || '--').includes(',')
        ? r.coordinator.split(',').map(c => c.trim()).filter(Boolean)
        : [r.coordinator?.trim() || '--'];
      const depts = (r.current_department || '').split(',').map(d => d.trim());
      coords.forEach((c, i) => {
        if (!map.has(c)) {
          map.set(c, {
            coordinator: c,
            current_department: depts[i] || '',
            section: r.section || null,
            status: r.status || null,
            main_expected: 0, main_absent: 0,
            zoom_expected: 0, zoom_absent: 0,
          });
        } else {
          const ex = map.get(c);
          if (depts[i] && !ex.current_department) ex.current_department = depts[i];
          // section/status come from the coordinator's own (single-name) row;
          // multi-name concat rows carry null, so prefer any non-null value.
          if (r.section && !ex.section) ex.section = r.section;
          if (r.status && !ex.status)   ex.status  = r.status;
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

  /* ─── Per-department aggregation (derived from the SAME per-coordinator data
        so the cards always equal the table — grouped by each coordinator's
        فريق العمل section). ─────────────────────────────────────────────── */
  const SECTION_TO_DEPT = { general: 'General', private: 'Private', semi: 'Semi' };
  const deptAgg = useMemo(() => {
    const acc = {};
    data.forEach(r => {
      const dep = SECTION_TO_DEPT[String(r.section || '').toLowerCase()];
      if (!dep) return; // skip 'all'/unknown sections
      if (!acc[dep]) acc[dep] = { department: dep, coordinators: 0, main_expected: 0, main_absent: 0, zoom_expected: 0, zoom_absent: 0 };
      acc[dep].coordinators += 1;
      acc[dep].main_expected += r.main_expected;
      acc[dep].main_absent   += r.main_absent;
      acc[dep].zoom_expected += r.zoom_expected;
      acc[dep].zoom_absent   += r.zoom_absent;
    });
    return ['General', 'Private', 'Semi'].filter(d => acc[d]).map(d => {
      const a = acc[d];
      return {
        ...a,
        main_absence_rate: a.main_expected > 0 ? Math.round((a.main_absent / a.main_expected) * 100) : 0,
        zoom_absence_rate: a.zoom_expected > 0 ? Math.round((a.zoom_absent / a.zoom_expected) * 100) : 0,
      };
    });
  }, [data]);

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

  const filterEl = (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl px-3 py-1.5">
        <Search size={13} className="text-white/70" />
        <input
          type="search"
          placeholder="بحث باسم المنسق..."
          value={coordQuery}
          onChange={e => setCoordQuery(e.target.value)}
          className="bg-transparent text-white placeholder-white/50 text-xs font-bold focus:outline-none w-40"
        />
      </div>
      <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl px-3 py-1.5">
        <Building2 size={13} className="text-white/70" />
        <select
          value={department}
          onChange={e => setDepartment(e.target.value)}
          className="bg-transparent text-white text-xs font-bold focus:outline-none cursor-pointer border-0"
        >
          <option value="" className="text-gray-700">كل الأقسام</option>
          <option value="General" className="text-gray-700">General</option>
          <option value="Private" className="text-gray-700">Private</option>
          <option value="Semi" className="text-gray-700">Semi</option>
        </select>
      </div>
      <select
        value={period}
        onChange={e => setPeriod(e.target.value)}
        disabled={!!hasDateRange}
        className={`bg-white/10 backdrop-blur-md border border-white/20 rounded-xl px-3 py-1.5 text-white text-xs font-bold focus:outline-none cursor-pointer ${hasDateRange ? 'opacity-40 cursor-not-allowed' : ''}`}
      >
        {PERIODS.map(p => <option key={p.value} value={p.value} className="text-gray-700">{p.label}</option>)}
      </select>
      <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl px-3 py-1.5">
        <CalendarDays size={13} className="text-white/70" />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="bg-transparent text-white text-xs font-bold focus:outline-none border-0 p-0" />
        <span className="text-[10px] text-white/60 font-bold">←</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="bg-transparent text-white text-xs font-bold focus:outline-none border-0 p-0" />
        {hasDateRange && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-white/70 hover:text-white transition-colors">
            <XCircle size={14} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="تقارير الحضور والغياب"
        subtitle="إحصائيات الحضور الأساسية والزووم كولز لكل منسق"
        icon={Activity}
        gradient="cyan"
        actions={filterEl}
      />

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

      {/* ─── Per-Department Averages ─────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-3 bg-gradient-to-l from-violet-50/40 to-white border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-violet-100 rounded-lg">
              <Layers size={14} className="text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-700">متوسط النسب لكل قسم</p>
              <p className="text-[10px] text-gray-500">نسبة موزّونة (مجموع الغياب ÷ مجموع المتوقع)</p>
            </div>
          </div>
        </div>
        <div className="p-4">
          {!deptAgg || deptAgg.length === 0 ? (
            <p className="text-center py-6 text-gray-400 text-xs font-bold">لا توجد بيانات</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {deptAgg.map(d => {
                const deptCls = {
                  General: { bg: 'bg-blue-50',    bd: 'border-blue-200',    fg: 'text-blue-700'    },
                  Private: { bg: 'bg-violet-50',  bd: 'border-violet-200',  fg: 'text-violet-700'  },
                  Semi:    { bg: 'bg-orange-50',  bd: 'border-orange-200',  fg: 'text-orange-700'  },
                }[d.department] || { bg: 'bg-gray-50', bd: 'border-gray-200', fg: 'text-gray-700' };
                const rateBadge = (r) => r >= 30 ? 'text-rose-700 bg-rose-100'
                                       : r >= 15 ? 'text-amber-700 bg-amber-100'
                                       : r > 0   ? 'text-emerald-700 bg-emerald-100'
                                       :           'text-gray-500 bg-gray-100';
                return (
                  <div key={d.department}
                       className={`rounded-xl border ${deptCls.bd} ${deptCls.bg} p-3`}>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className={`text-xs font-black ${deptCls.fg}`}>{d.department}</span>
                      <span className="text-[10px] font-bold text-gray-500">
                        {d.coordinators || 0} منسق
                      </span>
                    </div>
                    {/* غياب أساسي — clickable */}
                    <button
                      type="button"
                      onClick={() => d.main_absent > 0 && setDetail({ scope: 'dept', dept: d.department, type: 'main', count: d.main_absent })}
                      disabled={d.main_absent === 0}
                      title={d.main_absent > 0 ? 'اضغط لعرض تفاصيل الغياب الأساسي لهذا القسم' : ''}
                      className={`block w-full text-right mb-2 -mx-1 px-1 py-0.5 rounded-md transition-all ${
                        d.main_absent > 0 ? 'hover:bg-white/50 cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] font-bold text-gray-600 inline-flex items-center gap-1">
                          <UserX size={10} className="text-rose-500" /> غياب أساسي
                        </span>
                        <span className={`text-[11px] font-black px-1.5 py-0.5 rounded-md ${rateBadge(d.main_absence_rate)}`}>
                          {d.main_absence_rate}%
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono">
                        {d.main_absent.toLocaleString('en-US')} / {d.main_expected.toLocaleString('en-US')}
                      </div>
                    </button>
                    {/* غياب زووم — clickable */}
                    <button
                      type="button"
                      onClick={() => d.zoom_absent > 0 && setDetail({ scope: 'dept', dept: d.department, type: 'zoom', count: d.zoom_absent })}
                      disabled={d.zoom_absent === 0}
                      title={d.zoom_absent > 0 ? 'اضغط لعرض تفاصيل غياب الزووم كولز لهذا القسم' : ''}
                      className={`block w-full text-right -mx-1 px-1 py-0.5 rounded-md transition-all ${
                        d.zoom_absent > 0 ? 'hover:bg-white/50 cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] font-bold text-gray-600 inline-flex items-center gap-1">
                          <TrendingDown size={10} className="text-violet-500" /> غياب زووم
                        </span>
                        <span className={`text-[11px] font-black px-1.5 py-0.5 rounded-md ${rateBadge(d.zoom_absence_rate)}`}>
                          {d.zoom_absence_rate}%
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono">
                        {d.zoom_absent.toLocaleString('en-US')} / {d.zoom_expected.toLocaleString('en-US')}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
                const isExp = expanded === r.coordinator;
                return (
                  <Fragment key={i}>
                  <tr className={`hover:bg-gray-50/60 transition-colors ${isExp ? 'bg-slate-50/70' : ''}`}>
                    {/* Coordinator cell — expand toggle + avatar + name + "moved" badge */}
                    <td className="px-5 py-3.5 sticky right-0 bg-white hover:bg-gray-50/60 z-10">
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => setExpanded(isExp ? null : r.coordinator)}
                          title="عرض تفصيل الحركات (فترات الأقسام)"
                          className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0"
                        >
                          {isExp ? <ChevronDown size={15} /> : <ChevronLeft size={15} />}
                        </button>
                        <div className={`w-9 h-9 rounded-full ${colorFromName(r.coordinator)} text-white font-bold text-xs flex items-center justify-center flex-shrink-0 shadow-sm`}>
                          {initialsOf(r.coordinator)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-bold text-gray-900 text-sm truncate">{r.coordinator}</p>
                            {/* Show "moved to X" badge if filtered dept and current_department differs */}
                            {department && r.current_department && r.current_department !== department && (
                              <span
                                title={`المنسق دلوقتي في قسم ${r.current_department} — البيانات دي من فترة كان فيها في ${department}`}
                                className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap"
                              >
                                <AlertTriangle size={9} />
                                انتقل إلى {r.current_department}
                              </span>
                            )}
                          </div>
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
                    {/* Main — absent (clickable) */}
                    <td className="px-4 py-3.5">
                      {r.main_absent > 0 ? (
                        <button
                          type="button"
                          onClick={() => setDetail({ scope: 'coord', coordinator: r.coordinator, type: 'main', count: r.main_absent })}
                          title="اضغط لعرض تفاصيل الغياب"
                          className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-black border tabular-nums cursor-pointer hover:shadow-md hover:scale-105 transition-all ${mainC.bg} ${mainC.text} ${mainC.border}`}
                        >
                          {r.main_absent.toLocaleString('en-US')}
                        </button>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-black border tabular-nums bg-gray-50 text-gray-400 border-gray-100">
                          0
                        </span>
                      )}
                    </td>
                    {/* Main — rate */}
                    <td className="px-4 py-3.5">
                      <AbsenceRateCell rate={r.main_absence_rate} absent={r.main_absent} expected={r.main_expected} />
                    </td>

                    {/* Zoom — expected */}
                    <td className="px-4 py-3.5 text-gray-700 font-semibold tabular-nums border-r border-gray-100">
                      {r.zoom_expected.toLocaleString('en-US')}
                    </td>
                    {/* Zoom — absent (clickable) */}
                    <td className="px-4 py-3.5">
                      {r.zoom_absent > 0 ? (
                        <button
                          type="button"
                          onClick={() => setDetail({ scope: 'coord', coordinator: r.coordinator, type: 'zoom', count: r.zoom_absent })}
                          title="اضغط لعرض تفاصيل غياب الزووم"
                          className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-black border tabular-nums cursor-pointer hover:shadow-md hover:scale-105 transition-all ${zoomC.bg} ${zoomC.text} ${zoomC.border}`}
                        >
                          {r.zoom_absent.toLocaleString('en-US')}
                        </button>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-black border tabular-nums bg-gray-50 text-gray-400 border-gray-100">
                          0
                        </span>
                      )}
                    </td>
                    {/* Zoom — rate */}
                    <td className="px-4 py-3.5">
                      <AbsenceRateCell rate={r.zoom_absence_rate} absent={r.zoom_absent} expected={r.zoom_expected} />
                    </td>
                  </tr>
                  {isExp && (
                    <tr>
                      <td colSpan={7} className="p-0 bg-slate-50/50 border-b border-slate-200">
                        <CoordinatorSegments
                          coordinator={r.coordinator}
                          from={effective.from}
                          to={effective.to}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
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

      {/* Detail modal — opened by clicking an absent number or a dept absence row */}
      {detail && (
        <AbsenceDetailModal
          scope={detail.scope}
          coordinator={detail.coordinator}
          deptOverride={detail.dept}
          type={detail.type}
          count={detail.count}
          from={effective.from}
          to={effective.to}
          department={department}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

/* ─── Absence Detail Modal ─────────────────────────────────────────────────── */
// Two scopes:
//   - 'coord': filter by specific coordinator (existing behavior)
//   - 'dept':  filter by department only (no coordinator filter) — shows the
//             coordinator column so the user can see WHO had each absence
function AbsenceDetailModal({ scope = 'coord', coordinator, deptOverride, type, count, from, to, department, onClose }) {
  const endpoint = type === 'main' ? '/reports/absent-list' : '/reports/absent-side-list';
  const effectiveDept = scope === 'dept' ? (deptOverride || department) : department;
  const { data, isLoading } = useQuery({
    queryKey: ['absence-detail', endpoint, scope, coordinator, deptOverride, from, to, effectiveDept],
    queryFn: () => api.get(endpoint, {
      params: {
        coordinator: scope === 'coord' ? coordinator : undefined,
        from_date: from || undefined,
        to_date:   to   || undefined,
        department: effectiveDept || undefined,
        // Match the per-coordinator table / cards: only count events within the
        // coordinator's employment window, attributed to فريق العمل members.
        roster_window: 1,
        page: 1,
        limit: 1000,
      },
    }).then(r => r.data),
    staleTime: 30 * 1000,
  });

  const rows = data?.rows || [];
  const total = data?.total ?? rows.length;
  const typeLabel = type === 'main' ? 'الجلسات الأساسية' : 'الزووم كولز';
  const accentCls = type === 'main' ? 'bg-sky-500' : 'bg-indigo-500';
  const accentTone = type === 'main' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200';
  const headerTitle = scope === 'dept'
    ? `تفاصيل غياب قسم ${effectiveDept} — ${typeLabel}`
    : `تفاصيل الغياب — ${typeLabel}`;
  const headerSubtitle = scope === 'dept'
    ? `إجمالي: ${count || 0}`
    : `المنسق: ${coordinator} · إجمالي: ${count || 0}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/40">
          <div className="flex items-center gap-3">
            <div className={`${accentCls} w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm`}>
              {type === 'main' ? <Users size={18} /> : <Video size={18} />}
            </div>
            <div>
              <div className="text-sm font-bold text-gray-900">{headerTitle}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                {headerSubtitle}
                {total !== count && total < count && (
                  <span className="text-amber-600 mr-1">(عرض {total})</span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-all">
            <X size={16} />
          </button>
        </div>

        {/* Filters summary */}
        {(from || to) && (
          <div className="px-5 py-2 bg-blue-50/40 border-b border-gray-100 text-[11px] text-gray-600 flex items-center gap-2">
            <CalendarDays size={12} className="text-blue-500" />
            الفترة: <span className="font-semibold" dir="ltr">{from || '...'} → {to || '...'}</span>
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1,2,3,4,5,6].map(i => <div key={i} className="h-12 bg-gray-100 animate-pulse rounded-lg" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              <UserX size={32} className="text-gray-300 mx-auto mb-2" />
              مفيش تفاصيل غياب لـ {coordinator} في الفترة دي
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50/80 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-right font-bold text-gray-600 w-[40px]">#</th>
                  <th className="px-3 py-2 text-right font-bold text-gray-600">اسم الطالب</th>
                  <th className="px-3 py-2 text-right font-bold text-gray-600">رقم التليفون</th>
                  <th className="px-3 py-2 text-right font-bold text-gray-600">المجموعة</th>
                  <th className="px-3 py-2 text-right font-bold text-gray-600">التاريخ</th>
                  <th className="px-3 py-2 text-right font-bold text-gray-600 hidden sm:table-cell">الوقت</th>
                  {scope === 'dept' && (
                    <th className="px-3 py-2 text-right font-bold text-gray-600">المنسق</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r, i) => (
                  <tr key={r.id || i} className="hover:bg-slate-50/40 transition-colors">
                    <td className="px-3 py-2.5 text-gray-400 tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2.5 font-semibold text-gray-900 max-w-[180px] truncate">
                      {r.student_name || '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.phone ? (
                        <a
                          href={`tel:${r.phone}`}
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline font-mono"
                          dir="ltr"
                        >
                          <Phone size={11} />
                          {r.phone}
                        </a>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 max-w-[200px] truncate" title={r.group_name}>
                      {r.group_name || '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-gray-700" dir="ltr">
                        {r.date || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <span className="font-mono text-gray-500" dir="ltr">
                        {r.time || '—'}
                      </span>
                    </td>
                    {scope === 'dept' && (
                      <td className="px-3 py-2.5 text-gray-700 max-w-[140px] truncate" title={r.coordinators}>
                        {r.coordinators || '—'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">
            {rows.length} صف
            <span className={`mr-2 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${accentTone}`}>
              <Hash size={9} className="inline ml-1 -mt-0.5" />
              {typeLabel}
            </span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-gray-200 hover:bg-gray-300 text-xs font-semibold text-gray-700 transition-all"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
