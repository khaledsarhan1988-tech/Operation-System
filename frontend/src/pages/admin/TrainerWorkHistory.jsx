import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  History, CalendarDays, Search, Loader2, Users, Clock, Plus,
  CheckCircle, XCircle, X,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────
const SECTIONS = {
  all:        'الكل',
  general:    'عام',
  private:    'خاص',
  semi:       'شبه خاص',
  phone_call: 'فون كول',
};

const SECTION_BADGE = {
  general:    'bg-sky-100 text-sky-800 border-sky-200',
  private:    'bg-violet-100 text-violet-800 border-violet-200',
  semi:       'bg-amber-100 text-amber-800 border-amber-200',
  phone_call: 'bg-pink-100 text-pink-800 border-pink-200',
  all:        'bg-gray-100 text-gray-700 border-gray-200',
};

const SHIFT_KIND_LABEL = {
  morning: 'صباحي',
  evening: 'مسائي',
};

const EMPLOYMENT_LABEL = {
  full_time: 'Full Time',
  part_time: 'Part Time',
};

// Overall (aggregated) employment — combines all shifts' work_days. When a
// trainer has multiple Part-Time shifts whose days union to a full week,
// they're shown as "Full Time موزّع" (split).
function OverallEmpBadge({ type, split, daysCovered }) {
  if (type === 'full_time' && split) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border bg-violet-100 text-violet-800 border-violet-200"
        title="مجموع أيام الشيفتات يغطّي أسبوع العمل بالكامل">
        Full Time <span className="text-[10px] font-normal opacity-80">موزّع</span>
      </span>
    );
  }
  if (type === 'full_time') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border bg-blue-100 text-blue-800 border-blue-200">Full Time</span>;
  }
  if (type === 'part_time') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border bg-gray-100 text-gray-700 border-gray-200">
        Part Time <span className="text-[10px] font-normal opacity-70">({daysCovered}/6)</span>
      </span>
    );
  }
  return <span className="text-xs text-gray-300">—</span>;
}

// Convert raw minutes into "h س m د" (or just minutes if < 60).
function fmtMins(mins) {
  if (!mins || mins <= 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} د`;
  if (m === 0) return `${h} س`;
  return `${h} س ${m} د`;
}

// First day of the current Cairo-time month → 'YYYY-MM-01'
function defaultFromDate() {
  const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

// Last day of the current Cairo-time month → 'YYYY-MM-DD'
function defaultToDate() {
  const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

function SectionBadge({ value }) {
  const cls = SECTION_BADGE[value] || 'bg-gray-100 text-gray-700 border-gray-200';
  const label = SECTIONS[value] || value || '—';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${cls}`}>{label}</span>;
}

function StatusBadge({ value }) {
  return value === 'active' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border bg-emerald-100 text-emerald-700 border-emerald-200">
      <CheckCircle size={11} /> نشط
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border bg-gray-100 text-gray-500 border-gray-200">
      <XCircle size={11} /> غير نشط
    </span>
  );
}

function SkeletonRows({ cols = 11, rows = 6 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i} className="animate-pulse border-b border-gray-50">
      {Array.from({ length: cols }).map((__, j) => (
        <td key={j} className="px-3 py-3">
          <div className="h-3.5 bg-gray-100 rounded-full" style={{ width: `${50 + (j * 11 % 40)}%` }} />
        </td>
      ))}
    </tr>
  ));
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function TrainerWorkHistory() {
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate,   setToDate]   = useState(defaultToDate);
  const [section,  setSection]  = useState('all');
  const [trainer,  setTrainer]  = useState('');
  const [search,   setSearch]   = useState('');

  // ── trainer dropdown options — all education team members
  const { data: teamData } = useQuery({
    queryKey: ['team', 'education'],
    queryFn: () => api.get('/team', { params: { department: 'education', status: 'all' } }).then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const trainerOptions = useMemo(
    () => (teamData || []).map(t => t.name).sort((a, b) => a.localeCompare(b, 'ar')),
    [teamData]
  );

  // ── report data
  const { data, isLoading, isError } = useQuery({
    queryKey: ['trainer-work-history', fromDate, toDate, section, trainer],
    queryFn: () => api.get('/reports/trainer-work-history', {
      params: { from: fromDate, to: toDate, section, trainer },
    }).then(r => r.data),
    staleTime: 60 * 1000,
  });

  const rows    = useMemo(() => data?.rows ?? [], [data]);
  const summary = data?.summary || { trainers_count: 0, shifts_count: 0, total_extra_min: 0 };

  // ── client-side trainer-name search (in addition to dropdown)
  const filteredRows = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter(r => (r.trainer_name || '').toLowerCase().includes(q));
  }, [rows, search]);

  const inputCls  = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]';
  const selectCls = inputCls + ' min-w-[160px]';

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="سجل عمل المدربين"
        subtitle={isLoading
          ? 'جاري التحميل...'
          : `${summary.shifts_count} شيفت لـ ${summary.trainers_count} مدرب`}
        icon={History}
        gradient="violet"
        stats={[
          { label: 'عدد المدربين',       value: summary.trainers_count,   icon: Users },
          { label: 'إجمالي الشيفتات',    value: summary.shifts_count,     icon: Clock },
          { label: 'ساعات إضافية (دقيقة)', value: summary.total_extra_min, icon: Plus },
        ]}
      />

      <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
        {/* ── FILTERS ── */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1">من تاريخ</label>
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3">
                <CalendarDays size={14} className="text-gray-400" />
                <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                  className="py-2 text-sm text-gray-700 focus:outline-none bg-transparent" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1">إلى تاريخ</label>
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3">
                <CalendarDays size={14} className="text-gray-400" />
                <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                  className="py-2 text-sm text-gray-700 focus:outline-none bg-transparent" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1">القسم</label>
              <select value={section} onChange={e => setSection(e.target.value)} className={selectCls}>
                {Object.entries(SECTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1">المدرب</label>
              <select value={trainer} onChange={e => setTrainer(e.target.value)} className={selectCls}>
                <option value="">— الكل —</option>
                {trainerOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[11px] font-bold text-gray-500 mb-1">بحث سريع باسم المدرب</label>
              <div className="relative">
                <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="اكتب جزء من الاسم..."
                  className={`${inputCls} w-full pr-10`} />
              </div>
            </div>
            {(section !== 'all' || trainer || search) && (
              <button
                onClick={() => { setSection('all'); setTrainer(''); setSearch(''); }}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs text-gray-500 hover:text-red-600 border border-gray-200 rounded-xl hover:border-red-200 transition-all font-medium"
              ><X size={12} /> مسح الفلاتر</button>
            )}
          </div>
        </div>

        {/* ── TABLE ── */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right" style={{ minWidth: '1240px' }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['المدرب', 'القسم', '#', 'نوع الشيفت', 'بداية العمل', 'نهاية العمل', 'المواعيد', 'أيام العمل', 'الدوام', 'الدوام الإجمالي', 'ساعات إضافية', 'الحالة']
                  .map(h => <th key={h} className="px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? <SkeletonRows cols={12} rows={6} /> :
               isError    ? (
                 <tr><td colSpan={12} className="text-center py-12 text-sm text-red-600">حدث خطأ أثناء تحميل البيانات</td></tr>
               ) :
               filteredRows.length === 0 ? (
                 <tr>
                   <td colSpan={12} className="text-center py-12">
                     <div className="flex flex-col items-center gap-2 text-gray-400">
                       <History className="w-8 h-8 text-gray-300" />
                       <p className="text-sm font-medium">لا توجد شيفتات في الفترة المحددة</p>
                     </div>
                   </td>
                 </tr>
               ) :
               filteredRows.map((r, i) => (
                 <tr key={i} className="hover:bg-gray-50/60 transition-colors">
                   <td className="px-3 py-3 font-semibold text-gray-900 whitespace-nowrap">{r.trainer_name}</td>
                   <td className="px-3 py-3 whitespace-nowrap"><SectionBadge value={r.section} /></td>
                   <td className="px-3 py-3 text-xs text-gray-500 font-mono text-center">{r.shift_index}</td>
                   <td className="px-3 py-3 text-xs text-gray-700 whitespace-nowrap">
                     {SHIFT_KIND_LABEL[r.shift_kind] || r.shift_kind || '—'}
                   </td>
                   <td className="px-3 py-3 text-xs text-gray-600 font-mono whitespace-nowrap" dir="ltr">{r.start_date || '—'}</td>
                   <td className="px-3 py-3 text-xs whitespace-nowrap" dir="ltr">
                     {r.end_date
                       ? <span className="text-gray-600 font-mono">{r.end_date}</span>
                       : <span className="text-emerald-700 font-bold font-sans">لسه شغال</span>}
                   </td>
                   <td className="px-3 py-3 text-xs text-gray-600 font-mono whitespace-nowrap" dir="ltr">
                     {r.shift_start && r.shift_end
                       ? `⁦${r.shift_start} → ${r.shift_end}⁩`
                       : '—'}
                   </td>
                   <td className="px-3 py-3 text-xs text-gray-600" style={{ maxWidth: '220px' }}>
                     {r.work_days_ar || '—'}
                   </td>
                   <td className="px-3 py-3 text-xs text-gray-700 whitespace-nowrap">
                     {EMPLOYMENT_LABEL[r.employment_type] || '—'}
                   </td>
                   <td className="px-3 py-3 whitespace-nowrap">
                     <OverallEmpBadge
                       type={r.overall_employment_type}
                       split={r.overall_employment_split}
                       daysCovered={r.overall_days_covered}
                     />
                   </td>
                   <td className="px-3 py-3 whitespace-nowrap">
                     {r.extra_minutes > 0 ? (
                       <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 text-xs font-black border border-amber-200">
                         {fmtMins(r.extra_minutes)}
                       </span>
                     ) : (
                       <span className="text-xs text-gray-300">—</span>
                     )}
                   </td>
                   <td className="px-3 py-3 whitespace-nowrap"><StatusBadge value={r.status} /></td>
                 </tr>
               ))}
            </tbody>
          </table>
        </div>

        {/* ── FOOTER ── */}
        <div className="px-6 py-3 bg-gray-50/40 border-t border-gray-100">
          <p className="text-xs text-gray-400 leading-relaxed">
            صف لكل شيفت يتقاطع مع الفترة المحددة. الساعات الإضافية محسوبة من جدول ساعات العمل الإضافية،
            وبيتم احتسابها لكل شيفت بناءً على وقوع التاريخ ضمن نطاق الشيفت نفسه.
          </p>
        </div>
      </div>
    </div>
  );
}
