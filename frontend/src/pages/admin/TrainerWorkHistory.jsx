import { useState, useMemo, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  History, CalendarDays, Search, Loader2, Users, Clock, Plus,
  CheckCircle, XCircle, X, Pencil, AlertCircle, Trash2, Wallet, MinusCircle,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import HolidayBanner from '../../components/ui/HolidayBanner';
import { MemberModal } from './TeamPage';

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

// Section display order for the grouped "مرتبات المدربين" view: General →
// Private → Semi → Phone Call → (anything else).
const SECTION_ORDER = { general: 0, private: 1, semi: 2, phone_call: 3, all: 8 };
const sectionRank = (s) => (s in SECTION_ORDER ? SECTION_ORDER[s] : 9);

// Salary-category badge colors. Full Time & Part Time get fixed colors; every
// other distinct label (Free Lance, Project, "Full Time 7 to 12", ...) gets a
// stable color picked from a palette by hashing its text, so each category
// keeps the same color across rows.
const SALARY_CAT_FIXED = {
  'Full Time': 'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Part Time': 'bg-sky-100 text-sky-800 border-sky-200',
};
const SALARY_CAT_PALETTE = [
  'bg-violet-100 text-violet-800 border-violet-200',
  'bg-amber-100 text-amber-800 border-amber-200',
  'bg-rose-100 text-rose-800 border-rose-200',
  'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200',
  'bg-indigo-100 text-indigo-800 border-indigo-200',
  'bg-lime-100 text-lime-800 border-lime-200',
  'bg-orange-100 text-orange-800 border-orange-200',
  'bg-teal-100 text-teal-800 border-teal-200',
  'bg-pink-100 text-pink-800 border-pink-200',
  'bg-cyan-100 text-cyan-800 border-cyan-200',
];
function salaryCatClass(value) {
  const key = String(value || '').trim();
  if (SALARY_CAT_FIXED[key]) return SALARY_CAT_FIXED[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SALARY_CAT_PALETTE[h % SALARY_CAT_PALETTE.length];
}

// ─── SALARY COMPUTATION ────────────────────────────────────────────────────────
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Money formatting: trim to ≤2 decimals, group thousands.
function fmtMoney(v) {
  const r = Math.round((Number(v) || 0) * 100) / 100;
  return r.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Which salary system applies to a section: Phone Call → "فون كول",
// everything else (General / Private / Semi) → "جلسات اساسيه".
function systemTargetForSection(section) {
  return section === 'phone_call' ? 'فون كول' : 'جلسات اساسيه';
}

// Find the salary-def row that matches a trainer's (section, salary_category).
function findSalaryRow(systems, section, salaryCategory) {
  if (!Array.isArray(systems) || !salaryCategory) return null;
  const target = systemTargetForSection(section);
  const sys = systems.find(s => String(s.name || '').trim().includes(target));
  if (!sys) return null;
  const cat = String(salaryCategory).trim();
  return (sys.rows || []).find(r => String(r.shift_type || '').trim() === cat) || null;
}

// Pay rates from a salary-def row. Base = the row's Total Amount. The hourly
// rate used for extra hours & deductions is fixed at a 30-day / 8-hour month
// (per the owner's rule): perHour = Total ÷ 30 ÷ 8, dayWage = Total ÷ 30.
function rowRates(row) {
  if (!row) return { base: 0, perHour: 0, dayWage: 0, found: false };
  const total = n(row.total_amount);
  return { base: total, perHour: total / 240, dayWage: total / 30, found: true };
}

// Sum deduction money for a list of {kind, amount} given the row's rates.
function deductionMoney(deds, perHour, dayWage) {
  let total = 0;
  for (const d of deds || []) {
    total += d.kind === 'days' ? n(d.amount) * dayWage : n(d.amount) * perHour;
  }
  return total;
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

// Arabic month names (Gregorian).
const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

// Build a month dropdown list (newest first): from May 2026 (the data start)
// up to 2 months ahead of the current Cairo month.
// Each item = { value:'YYYY-MM', label:'مايو 2026' }.
function buildMonths() {
  const now = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
  const endY = end.getUTCFullYear(), endM = end.getUTCMonth();
  const out = [];
  let y = 2026, m = 4; // May 2026 (month index 4)
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ value: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${AR_MONTHS[m]} ${y}` });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out.reverse();
}

// First & last calendar day of a 'YYYY-MM' month → { first, last } as ISO dates.
function monthBounds(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    first: `${y}-${String(m).padStart(2, '0')}-01`,
    last:  `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

// "HH:MM" (24h) → Arabic 12-hour with period qualifier.
//   "00:00" → "12 منتصف الليل"
//   "08:30" → "8:30 صباحاً"
//   "12:00" → "12 ظهراً"
//   "16:00" → "4 مساءً"
//   "21:45" → "9:45 مساءً"
// Returns the raw string unchanged if it can't be parsed.
function fmtTimeAr(t) {
  if (!t) return '';
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(t);
  const h24 = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  // Special-cased labels (cleanest reading for these edge times)
  if (h24 === 0  && mins === 0) return '12 منتصف الليل';
  if (h24 === 12 && mins === 0) return '12 ظهراً';
  let h12 = h24 % 12; if (h12 === 0) h12 = 12;
  // Period: AM = صباحاً, PM = مساءً. Noon and after → مساءً.
  const period = h24 < 12 ? 'صباحاً' : 'مساءً';
  return mins === 0 ? `${h12} ${period}` : `${h12}:${String(mins).padStart(2,'0')} ${period}`;
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

// ─── UNCONFIRMED LECTURES MODAL ────────────────────────────────────────────────
// Opens when a "ساعات غير مؤكدة" cell is clicked — lists the individual
// unconfirmed lectures making up that cell's total.
function UnconfirmedModal({ context, onClose }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['unconfirmed-lectures', context.trainer, context.from, context.to, context.shift_start, context.shift_end],
    queryFn: () => api.get('/reports/trainer-work-history/unconfirmed', {
      params: {
        trainer:     context.trainer,
        from:        context.from,
        to:          context.to,
        shift_start: context.shift_start,
        shift_end:   context.shift_end || '',
      },
    }).then(r => r.data),
  });
  const lectures = data?.lectures || [];
  const totalMin = lectures.reduce((acc, l) => {
    const m = String(l.duration || '').match(/^(\d{1,2}):(\d{2})$/);
    return acc + (m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0);
  }, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
        onClick={e => e.stopPropagation()} dir="rtl">
        <div className="px-5 py-4 bg-gradient-to-l from-red-50 to-red-100/50 border-b border-red-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-red-700 uppercase tracking-wide mb-1">محاضرات غير مؤكدة</p>
            <p className="text-sm font-black text-gray-900 leading-tight">{context.trainer}</p>
            {!isLoading && !isError && (
              <p className="text-xs text-gray-500 mt-1">
                {lectures.length} محاضرة · إجمالي {fmtMins(totalMin)}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/60 flex-shrink-0">
            <X size={15} className="text-gray-600" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : isError ? (
            <div className="p-10 text-center text-sm text-red-600">تعذّر تحميل المحاضرات</div>
          ) : lectures.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-400">لا توجد محاضرات غير مؤكدة لهذا الشيفت في الفترة</div>
          ) : (
            <table className="w-full text-sm text-right">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 w-10">#</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">اسم المجموعة</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">التاريخ</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">الوقت</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">المدّة</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">النوع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lectures.map((l, i) => (
                  <tr key={i} className="hover:bg-gray-50/60">
                    <td className="px-4 py-2.5 text-xs text-gray-400">{i + 1}</td>
                    <td className="px-4 py-2.5 font-semibold text-gray-800 text-xs break-all" dir="ltr">{l.group_name || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 font-mono whitespace-nowrap" dir="ltr">{l.date || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 font-mono whitespace-nowrap" dir="ltr">{l.time || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-700 font-mono whitespace-nowrap" dir="ltr">{l.duration || '—'}</td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                      {l.session_type === 'side'
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-purple-100 text-purple-700 border-purple-200">زووم كول</span>
                        : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-blue-100 text-blue-700 border-blue-200">أساسية</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function SkeletonRows({ cols = 11, rows = 6 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i} className="animate-pulse border-b border-gray-50">
      {Array.from({ length: cols }).map((__, j) => (
        <td key={j} className="px-2 py-2.5">
          <div className="h-3.5 bg-gray-100 rounded-full" style={{ width: `${50 + (j * 11 % 40)}%` }} />
        </td>
      ))}
    </tr>
  ));
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function TrainerWorkHistory({ title = 'سجل عمل المدربين', showSalaryCategory = false, groupBySection = false, monthPicker = false } = {}) {
  const qc = useQueryClient();
  // Column count for skeleton/empty/error rows. The salary variant adds the
  // category column (+1) and four payroll columns (+4).
  const colCount = showSalaryCategory ? 17 : 12;
  const [fromDate,    setFromDate]    = useState(defaultFromDate);
  const [toDate,      setToDate]      = useState(defaultToDate);
  const [section,     setSection]     = useState('all');
  const [trainer,     setTrainer]     = useState('');
  const [search,      setSearch]      = useState('');
  const [editMember,  setEditMember]  = useState(null);
  const [ucModal,     setUcModal]     = useState(null);  // { trainer, from, to, shift_start, shift_end }
  const [dedModal,    setDedModal]    = useState(null);  // { trainer_id, trainer_name, perHour, dayWage }

  // ── trainer dropdown options — all education team members
  // (also used as the source for the click-to-edit modal — we look up the
  // full member object by trainer_id here without an extra request).
  const { data: teamData } = useQuery({
    queryKey: ['team', 'education'],
    queryFn: () => api.get('/team', { params: { department: 'education', status: 'all' } }).then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const trainerOptions = useMemo(
    () => (teamData || []).map(t => t.name).sort((a, b) => a.localeCompare(b, 'ar')),
    [teamData]
  );

  // ── Save mutation for the in-place edit modal — mirrors TeamPage's flow
  // so changes invalidate BOTH the team-members cache (TeamPage refreshes
  // automatically) and this report (so the row reflects the new values).
  const saveMutation = useMutation({
    mutationFn: (form) =>
      form.id
        ? api.put(`/team/${form.id}`, form).then(r => r.data)
        : api.post('/team', form).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-members'] });
      qc.invalidateQueries({ queryKey: ['team', 'education'] });
      qc.invalidateQueries({ queryKey: ['trainer-work-history'] });
      setEditMember(null);
    },
  });

  // Click handler: look up the full member object from teamData and open
  // the shared MemberModal in this page (no navigation).
  const openTrainerEdit = (trainerId) => {
    const m = (teamData || []).find(t => String(t.id) === String(trainerId));
    if (m) setEditMember(m);
  };

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

  // ── Salary data (owner-only "مرتبات المدربين" variant only) ──
  const { data: salarySystems = [] } = useQuery({
    queryKey: ['trainer-salaries'],
    queryFn: () => api.get('/trainer-salaries').then(r => r.data).catch(() => []),
    enabled: showSalaryCategory,
    staleTime: 5 * 60 * 1000,
  });
  const { data: deductions = [] } = useQuery({
    queryKey: ['trainer-deductions', fromDate, toDate],
    queryFn: () => api.get('/trainer-salaries/deductions', { params: { from: fromDate, to: toDate } })
      .then(r => r.data).catch(() => []),
    enabled: showSalaryCategory,
    staleTime: 30 * 1000,
  });
  const deductionsByTrainer = useMemo(() => {
    const m = new Map();
    for (const d of deductions) {
      if (!m.has(d.trainer_id)) m.set(d.trainer_id, []);
      m.get(d.trainer_id).push(d);
    }
    return m;
  }, [deductions]);

  // Compute the salary breakdown for one report row.
  const salaryFor = (r) => {
    const row = findSalaryRow(salarySystems, r.section, r.salary_category);
    const { base, perHour, dayWage, found } = rowRates(row);
    const extraPay = (n(r.extra_minutes) / 60) * perHour;
    const ded = deductionMoney(deductionsByTrainer.get(r.trainer_id), perHour, dayWage);
    return { found, base, perHour, dayWage, extraPay, ded, net: base + extraPay - ded };
  };

  // ── client-side trainer-name search (in addition to dropdown)
  const filteredRows = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter(r => (r.trainer_name || '').toLowerCase().includes(q));
  }, [rows, search]);

  // When grouping is on (مرتبات المدربين), order rows by section so each
  // section's trainers sit together (General → Private → Semi → Phone Call),
  // then by name within the section. Otherwise keep the backend's name order.
  const displayRows = useMemo(() => {
    if (!groupBySection) return filteredRows;
    return [...filteredRows].sort((a, b) =>
      (sectionRank(a.section) - sectionRank(b.section)) ||
      String(a.trainer_name || '').localeCompare(String(b.trainer_name || ''), 'ar')
    );
  }, [filteredRows, groupBySection]);

  const inputCls  = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]';
  const selectCls = inputCls + ' min-w-[160px]';

  // Month dropdown (salary variant) — selecting a month sets from/to to its
  // first/last calendar day so the payroll covers a whole month.
  const months = useMemo(() => buildMonths(), []);
  const selectedMonth = (fromDate || '').slice(0, 7);
  const onMonthChange = (ym) => {
    const { first, last } = monthBounds(ym);
    setFromDate(first);
    setToDate(last);
  };

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title={title}
        subtitle={isLoading
          ? 'جاري التحميل...'
          : `${summary.shifts_count} شيفت لـ ${summary.trainers_count} مدرب`}
        icon={History}
        gradient="violet"
        stats={[
          { label: 'عدد المدربين',           value: summary.trainers_count,        icon: Users },
          { label: 'إجمالي الشيفتات',        value: summary.shifts_count,          icon: Clock },
          { label: 'ساعات إضافية (دقيقة)',     value: summary.total_extra_min,       icon: Plus },
          { label: 'ساعات غير مؤكدة (دقيقة)', value: summary.total_unconfirmed_min, icon: AlertCircle },
        ]}
      />

      <HolidayBanner dates={data?.holiday_dates} />

      <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
        {/* ── FILTERS ── */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100">
          <div className="flex flex-wrap items-end gap-3">
            {monthPicker ? (
              <div>
                <label className="block text-[11px] font-bold text-gray-500 mb-1">الشهر</label>
                <select value={selectedMonth} onChange={e => onMonthChange(e.target.value)} className={selectCls}>
                  {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            ) : (
              <>
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
              </>
            )}
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
          <table className="w-full text-sm text-right" style={{ minWidth: '1380px' }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {[
                  'المدرب', 'القسم', '#', 'نوع الشيفت', 'بداية العمل', 'نهاية العمل', 'المواعيد', 'أيام العمل', 'الدوام',
                  ...(showSalaryCategory ? ['فئة المرتب'] : []),
                  'ساعات إضافية', 'ساعات غير مؤكدة', 'الحالة',
                  ...(showSalaryCategory ? ['المرتب الأساسي', 'إضافي (ج)', 'الخصم', 'الصافي'] : []),
                ].map(h => <th key={h} className="px-2 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? <SkeletonRows cols={colCount} rows={6} /> :
               isError    ? (
                 <tr><td colSpan={colCount} className="text-center py-12 text-sm text-red-600">حدث خطأ أثناء تحميل البيانات</td></tr>
               ) :
               filteredRows.length === 0 ? (
                 <tr>
                   <td colSpan={colCount} className="text-center py-12">
                     <div className="flex flex-col items-center gap-2 text-gray-400">
                       <History className="w-8 h-8 text-gray-300" />
                       <p className="text-sm font-medium">لا توجد شيفتات في الفترة المحددة</p>
                     </div>
                   </td>
                 </tr>
               ) :
               displayRows.map((r, i) => {
                 const showHeader = groupBySection && (i === 0 || displayRows[i - 1].section !== r.section);
                 const sectionCount = showHeader ? displayRows.filter(x => x.section === r.section).length : 0;
                 return (
                 <Fragment key={i}>
                   {showHeader && (
                     <tr className="bg-gray-100/70 border-y border-gray-200">
                       <td colSpan={colCount} className="px-3 py-2">
                         <span className="inline-flex items-center gap-2 text-xs font-black text-gray-700">
                           <SectionBadge value={r.section} />
                           <span className="text-gray-400">({sectionCount})</span>
                         </span>
                       </td>
                     </tr>
                   )}
                 <tr className="hover:bg-gray-50/60 transition-colors">
                   <td className="px-2 py-2.5 font-semibold whitespace-nowrap">
                     <button
                       type="button"
                       onClick={() => openTrainerEdit(r.trainer_id)}
                       className="group inline-flex items-center gap-1.5 text-gray-900 hover:text-blue-600 transition-colors"
                       title="فتح نافذة تعديل الموظف"
                     >
                       <span className="border-b border-dashed border-transparent group-hover:border-blue-500">
                         {r.trainer_name}
                       </span>
                       <Pencil size={11} className="opacity-0 group-hover:opacity-70 transition-opacity" />
                     </button>
                   </td>
                   <td className="px-2 py-2.5 whitespace-nowrap"><SectionBadge value={r.section} /></td>
                   <td className="px-2 py-2.5 text-xs text-gray-500 font-mono text-center">{r.shift_index}</td>
                   <td className="px-2 py-2.5 text-xs text-gray-700 whitespace-nowrap">
                     {SHIFT_KIND_LABEL[r.shift_kind] || r.shift_kind || '—'}
                   </td>
                   <td className="px-2 py-2.5 text-xs text-gray-600 font-mono whitespace-nowrap" dir="ltr">{r.start_date || '—'}</td>
                   <td className="px-2 py-2.5 text-xs whitespace-nowrap" dir="ltr">
                     {r.end_date
                       ? <span className="text-gray-600 font-mono">{r.end_date}</span>
                       : <span className="text-emerald-700 font-bold font-sans">لسه شغال</span>}
                   </td>
                   <td className="px-2 py-2.5 text-xs text-gray-700 whitespace-nowrap">
                     {r.shift_start && r.shift_end
                       ? <span className="font-semibold">{fmtTimeAr(r.shift_start)} <span className="text-gray-400">←</span> {fmtTimeAr(r.shift_end)}</span>
                       : '—'}
                   </td>
                   <td className="px-2 py-2.5 text-xs text-gray-600" style={{ maxWidth: '220px' }}>
                     {r.work_days_ar || '—'}
                   </td>
                   <td className="px-2 py-2.5 text-xs text-gray-700 whitespace-nowrap">
                     {EMPLOYMENT_LABEL[r.employment_type] || '—'}
                   </td>
                   {showSalaryCategory && (
                     <td className="px-2 py-2.5 whitespace-nowrap">
                       {r.salary_category
                         ? <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${salaryCatClass(r.salary_category)}`}>{r.salary_category}</span>
                         : <span className="text-xs text-gray-300">—</span>}
                     </td>
                   )}
                   <td className="px-2 py-2.5 whitespace-nowrap">
                     {r.extra_minutes > 0 ? (
                       <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 text-xs font-black border border-amber-200">
                         {fmtMins(r.extra_minutes)}
                       </span>
                     ) : (
                       <span className="text-xs text-gray-300">—</span>
                     )}
                   </td>
                   <td className="px-2 py-2.5 whitespace-nowrap">
                     {r.unconfirmed_minutes > 0 ? (
                       <button
                         type="button"
                         onClick={() => setUcModal({
                           trainer:     r.trainer_name,
                           from:        fromDate,
                           to:          toDate,
                           shift_start: r.start_date,
                           shift_end:   r.end_date,
                         })}
                         title="انقر لعرض المحاضرات الغير مؤكدة"
                         className="inline-flex items-center justify-center px-2 py-0.5 rounded-lg bg-red-50 text-red-700 text-xs font-black border border-red-200 hover:bg-red-100 hover:border-red-300 transition-colors cursor-pointer"
                       >
                         {fmtMins(r.unconfirmed_minutes)}
                       </button>
                     ) : (
                       <span className="text-xs text-gray-300">—</span>
                     )}
                   </td>
                   <td className="px-2 py-2.5 whitespace-nowrap"><StatusBadge value={r.status} /></td>
                   {showSalaryCategory && (() => {
                     const s = salaryFor(r);
                     if (!s.found) {
                       return (
                         <>
                           <td className="px-2 py-2.5 text-xs text-gray-300 text-center" colSpan={4}>— لا توجد فئة مرتب مطابقة —</td>
                         </>
                       );
                     }
                     return (
                       <>
                         <td className="px-2 py-2.5 text-xs font-bold text-gray-800 whitespace-nowrap text-center" dir="ltr">{fmtMoney(s.base)}</td>
                         <td className="px-2 py-2.5 text-xs whitespace-nowrap text-center" dir="ltr">
                           {s.extraPay > 0
                             ? <span className="text-emerald-700 font-bold">+{fmtMoney(s.extraPay)}</span>
                             : <span className="text-gray-300">—</span>}
                         </td>
                         <td className="px-2 py-2.5 whitespace-nowrap text-center">
                           <button type="button"
                             onClick={() => setDedModal({ trainer_id: r.trainer_id, trainer_name: r.trainer_name, perHour: s.perHour, dayWage: s.dayWage })}
                             title="إضافة / تعديل الخصومات"
                             className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold border transition-colors ${
                               s.ded > 0
                                 ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                                 : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                             }`}>
                             <MinusCircle size={12} />
                             {s.ded > 0 ? `−${fmtMoney(s.ded)}` : 'خصم'}
                           </button>
                         </td>
                         <td className="px-2 py-2.5 text-xs font-black whitespace-nowrap text-center" dir="ltr">
                           <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-blue-50 text-blue-800 border border-blue-200">{fmtMoney(s.net)}</span>
                         </td>
                       </>
                     );
                   })()}
                 </tr>
                 </Fragment>
                 );
               })}
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

      {/* ── In-place edit modal — opens when a trainer's name is clicked ── */}
      {editMember && (
        <MemberModal
          initial={editMember}
          onSave={(form) => saveMutation.mutate({ ...form, id: editMember.id })}
          onClose={() => setEditMember(null)}
          loading={saveMutation.isPending}
        />
      )}

      {/* ── Unconfirmed lectures drill-down modal ── */}
      {ucModal && (
        <UnconfirmedModal context={ucModal} onClose={() => setUcModal(null)} />
      )}

      {/* ── Deductions modal (مرتبات المدربين only) ── */}
      {dedModal && (
        <DeductionModal context={{ ...dedModal, from: fromDate, to: toDate }} onClose={() => setDedModal(null)} />
      )}
    </div>
  );
}

// ─── DEDUCTIONS MODAL ──────────────────────────────────────────────────────────
// Add/remove a trainer's deductions (hours or days, by date) for the selected
// period. Money per entry is derived from the row's per-hour / day-wage passed
// in via context, so totals match the table.
function DeductionModal({ context, onClose }) {
  const qc = useQueryClient();
  const { trainer_id, trainer_name, perHour, dayWage, from, to } = context;
  const [kind, setKind]   = useState('hours');
  const [amount, setAmount] = useState('');
  const [date, setDate]   = useState(from || '');
  const [note, setNote]   = useState('');
  const [error, setError] = useState(null);

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['trainer-deductions', 'one', trainer_id, from, to],
    queryFn: () => api.get('/trainer-salaries/deductions', { params: { trainer_id, from, to } }).then(r => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['trainer-deductions'] });
  };
  const addMut = useMutation({
    mutationFn: () => api.post('/trainer-salaries/deductions', { trainer_id, kind, amount, date, note }),
    onSuccess: () => { invalidate(); setAmount(''); setNote(''); setError(null); },
    onError: (e) => setError(e.response?.data?.error || e.message),
  });
  const delMut = useMutation({
    mutationFn: (id) => api.delete(`/trainer-salaries/deductions/${id}`),
    onSuccess: invalidate,
  });

  const money = (d) => d.kind === 'days' ? n(d.amount) * dayWage : n(d.amount) * perHour;
  const total = list.reduce((a, d) => a + money(d), 0);
  const canAdd = Number(amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()} dir="rtl">
        <div className="px-5 py-4 bg-gradient-to-l from-red-50 to-rose-100/50 border-b border-red-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-red-700 mb-1">خصومات المدرب</p>
            <p className="text-sm font-black text-gray-900 leading-tight">{trainer_name}</p>
            <p className="text-[11px] text-gray-500 mt-1">
              سعر الساعة {fmtMoney(perHour)} ج · سعر اليوم {fmtMoney(dayWage)} ج
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/60 flex-shrink-0"><X size={15} className="text-gray-600" /></button>
        </div>

        {/* Add form */}
        <div className="p-4 border-b border-gray-100 space-y-3">
          {error && <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setKind('hours')}
              className={`flex-1 py-1.5 rounded-lg text-sm font-bold border ${kind === 'hours' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>ساعات</button>
            <button type="button" onClick={() => setKind('days')}
              className={`flex-1 py-1.5 rounded-lg text-sm font-bold border ${kind === 'days' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>أيام</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1">{kind === 'days' ? 'عدد الأيام' : 'عدد الساعات'}</label>
              <input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" placeholder="0" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1">التاريخ</label>
              <input type="date" value={date} min={from || undefined} max={to || undefined}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-gray-500 mb-1">ملاحظة (اختياري)</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" placeholder="السبب..." />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              ≈ {fmtMoney(kind === 'days' ? n(amount) * dayWage : n(amount) * perHour)} ج
            </span>
            <button type="button" onClick={() => addMut.mutate()} disabled={!canAdd || addMut.isPending}
              className="px-4 py-1.5 rounded-lg bg-red-600 text-white text-sm font-bold inline-flex items-center gap-1 disabled:opacity-50">
              <Plus size={14} /> إضافة خصم
            </button>
          </div>
        </div>

        {/* List */}
        <div className="max-h-[40vh] overflow-y-auto">
          {isLoading ? (
            <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : list.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">لا توجد خصومات في الفترة المحددة</p>
          ) : (
            <table className="w-full text-sm text-right">
              <thead><tr className="bg-gray-50 border-b border-gray-100 text-[11px] text-gray-500">
                <th className="px-3 py-2">النوع</th><th className="px-3 py-2">العدد</th>
                <th className="px-3 py-2">التاريخ</th><th className="px-3 py-2">قيمة (ج)</th>
                <th className="px-3 py-2">ملاحظة</th><th className="px-3 py-2"></th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {list.map(d => (
                  <tr key={d.id} className="hover:bg-gray-50/60">
                    <td className="px-3 py-2 text-xs">{d.kind === 'days' ? 'أيام' : 'ساعات'}</td>
                    <td className="px-3 py-2 text-xs font-mono" dir="ltr">{d.amount}</td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-600" dir="ltr">{d.date}</td>
                    <td className="px-3 py-2 text-xs font-bold text-red-700" dir="ltr">−{fmtMoney(money(d))}</td>
                    <td className="px-3 py-2 text-[11px] text-gray-500">{d.note || '—'}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => delMut.mutate(d.id)} className="p-1 rounded hover:bg-red-50 text-red-500" title="حذف">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t flex items-center justify-between">
          <span className="text-sm font-black text-red-700">إجمالي الخصم: −{fmtMoney(total)} ج</span>
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-100">تم</button>
        </div>
      </div>
    </div>
  );
}
