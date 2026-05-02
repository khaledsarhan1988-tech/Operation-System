import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart2, TrendingUp, TrendingDown, Minus, Lock, Download, Trophy,
  Sparkles, Target, ShieldAlert, Award, Users, Calendar, Zap, Star,
  ChevronLeft, X, Plus, Edit2, Trash2, MessageSquare, Filter, Crown,
  Flame, Gem, CheckCircle2, AlertTriangle, ArrowUp, ArrowDown, FileText,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend, Area, AreaChart,
} from 'recharts';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import api from '../../api/axios';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const MONTH_NAMES_AR = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const MONTH_NAMES_AR_SHORT = ['', 'ينا', 'فبر', 'مار', 'أبر', 'مايو', 'يون',
  'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'];

const KPI_DEFS = [
  { key: 'overall_score',   label: 'الأداء العام',  color: '#6366F1', icon: Trophy },
  { key: 'completion_rate', label: 'الإنجاز',       color: '#10B981', icon: CheckCircle2 },
  { key: 'sla_rate',        label: 'الالتزام (SLA)', color: '#06B6D4', icon: Zap },
  { key: 'followup_rate',   label: 'متابعة الغياب',  color: '#F59E0B', icon: Users },
  { key: 'fix_rate',        label: 'حل الأعطال',    color: '#EC4899', icon: ShieldAlert },
];

const BADGE_DEFS = {
  top_performer:       { emoji: '🥇', label: 'بطل القسم',         color: 'amber' },
  top_3_performer:     { emoji: '🥈', label: 'ضمن أعلى 3',         color: 'slate' },
  rising_star:         { emoji: '🚀', label: 'النجم الصاعد',       color: 'violet' },
  streak_3:            { emoji: '🔥', label: '3 شهور متتالية',     color: 'orange' },
  streak_6:            { emoji: '🔥🔥', label: '6 شهور متتالية',   color: 'red' },
  perfect_sla:         { emoji: '💎', label: 'التزام مثالي',       color: 'cyan' },
  perfect_completion:  { emoji: '🎯', label: 'إنجاز كامل',         color: 'emerald' },
  consistent:          { emoji: '🛡️', label: 'الثابت',            color: 'blue' },
  target_master:       { emoji: '🏆', label: 'محقق الأهداف',       color: 'amber' },
  excellence:          { emoji: '🎓', label: 'تميّز',             color: 'fuchsia' },
};

const DEPT_COLORS = {
  General: '#3B82F6',
  Private: '#A855F7',
  Semi:    '#F97316',
};

const LINE_PALETTE = ['#10B981', '#3B82F6', '#A855F7', '#F59E0B', '#EC4899',
  '#06B6D4', '#F97316', '#84CC16', '#14B8A6', '#6366F1'];

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function pad2(n) { return String(n).padStart(2, '0'); }
function periodLabel(year, month) { return `${year}-${pad2(month)}`; }
function monthShortAr(year, month) { return `${MONTH_NAMES_AR_SHORT[month]} ${String(year).slice(2)}`; }

function lerpColor(c1, c2, t) {
  const h2r = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const r2h = ([r, g, b]) => '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
  const a = h2r(c1), b = h2r(c2);
  return r2h(a.map((v, i) => v + (b[i] - v) * t));
}

// 0% → red, 50% → amber, 100% → emerald
function heatColor(value) {
  if (value == null) return '#F3F4F6';
  const v = Math.max(0, Math.min(100, value));
  if (v < 50) return lerpColor('#FEE2E2', '#FEF3C7', v / 50);
  return lerpColor('#FEF3C7', '#D1FAE5', (v - 50) / 50);
}

function heatTextColor(value) {
  if (value == null) return '#9CA3AF';
  const v = Math.max(0, Math.min(100, value));
  if (v < 40) return '#991B1B';
  if (v < 70) return '#92400E';
  return '#065F46';
}

// Generate avatar gradient from name (matches sidebar)
function avatarGradient(name = '') {
  const grads = [
    'from-indigo-500 to-purple-600',
    'from-blue-500 to-cyan-600',
    'from-emerald-500 to-teal-600',
    'from-rose-500 to-pink-600',
    'from-amber-500 to-orange-600',
    'from-violet-500 to-fuchsia-600',
    'from-sky-500 to-indigo-600',
    'from-teal-500 to-emerald-600',
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return grads[Math.abs(h) % grads.length];
}

function trendIcon(delta) {
  if (delta > 0)  return <ArrowUp size={12} className="text-emerald-500" />;
  if (delta < 0)  return <ArrowDown size={12} className="text-red-500" />;
  return <Minus size={12} className="text-gray-400" />;
}

// Animated counter (uses requestAnimationFrame)
function useCounter(target, duration = 800) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf, start;
    const step = (ts) => {
      if (!start) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function Avatar({ name, size = 'md' }) {
  const initial = (name?.[0] || '?').toUpperCase();
  const sz = size === 'lg' ? 'w-14 h-14 text-xl'
          : size === 'sm' ? 'w-7 h-7 text-xs'
          : 'w-10 h-10 text-sm';
  return (
    <div className={`${sz} rounded-full flex items-center justify-center text-white font-black bg-gradient-to-br ${avatarGradient(name)} shadow-md flex-shrink-0`}>
      {initial}
    </div>
  );
}

function StatPill({ value, suffix = '', icon: Icon, label, animated = true, signed = false }) {
  const numVal = Number(value) || 0;
  const display = animated ? useCounter(Math.abs(numVal)) : Math.abs(numVal);
  const sign = signed && numVal !== 0 ? (numVal > 0 ? '+' : '−') : '';
  const tone = signed
    ? numVal > 0 ? 'text-emerald-200' : numVal < 0 ? 'text-rose-200' : 'text-white'
    : 'text-white';
  return (
    <div className="bg-white/10 backdrop-blur-md border border-white/15 rounded-2xl px-4 py-3 flex items-center gap-3">
      {Icon && (
        <div className="p-2 bg-white/15 rounded-xl">
          <Icon size={18} className="text-white" />
        </div>
      )}
      <div>
        <p className="text-[10px] text-white/70 font-bold uppercase tracking-wider">{label}</p>
        <p className={`text-2xl font-black leading-none mt-0.5 ${tone}`}>
          {sign}{display}<span className="text-sm font-bold opacity-80">{suffix}</span>
        </p>
      </div>
    </div>
  );
}

function HeroBanner({ summary, onFreezeClick, onExport, onExportPdf, pdfBusy }) {
  return (
    <div
      className="relative overflow-hidden rounded-3xl p-6 text-white"
      style={{
        background: 'linear-gradient(135deg, #1e3a5f 0%, #2c4a7a 50%, #3b5fa0 100%)',
        boxShadow: '0 20px 50px -12px rgba(30, 58, 95, 0.5)',
      }}
    >
      {/* Decorative orbs */}
      <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full opacity-20 blur-3xl"
           style={{ background: 'radial-gradient(circle, #6366F1 0%, transparent 70%)' }} />
      <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full opacity-20 blur-3xl"
           style={{ background: 'radial-gradient(circle, #A855F7 0%, transparent 70%)' }} />

      <div className="relative z-10">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/15 backdrop-blur rounded-2xl">
              <BarChart2 size={26} />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight">تطوّر أداء الفريق</h1>
              <p className="text-white/70 text-sm font-bold mt-0.5">مقارنة شاملة لأداء الموظفين عبر الشهور</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onFreezeClick}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 transition-all rounded-xl font-black text-sm flex items-center gap-2 shadow-lg shadow-amber-500/40 hover:-translate-y-0.5"
            >
              <Lock size={16} />
              تجميد الشهر
            </button>
            <button
              onClick={onExportPdf}
              disabled={pdfBusy}
              className="px-4 py-2.5 bg-rose-500/90 hover:bg-rose-500 disabled:opacity-60 transition-all rounded-xl font-black text-sm flex items-center gap-2 shadow-lg shadow-rose-500/30 border border-rose-400/40"
            >
              <FileText size={16} />
              {pdfBusy ? '...جارٍ' : 'PDF'}
            </button>
            <button
              onClick={onExport}
              className="px-4 py-2.5 bg-white/10 hover:bg-white/20 transition-all rounded-xl font-black text-sm flex items-center gap-2 border border-white/30"
            >
              <Download size={16} />
              CSV
            </button>
          </div>
        </div>

        {/* Stat pills */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatPill icon={Calendar} label="شهور مجمّدة" value={summary?.months || 0} />
          <StatPill icon={Users}    label="موظف نشط"   value={summary?.agents || 0} />
          <StatPill icon={Trophy}   label="متوسط الإنجاز" value={summary?.avgScore || 0} suffix="%" />
          <StatPill
            icon={summary?.monthDelta >= 0 ? TrendingUp : TrendingDown}
            label="تحسّن الشهر"
            value={summary?.monthDelta || 0}
            suffix="%"
            signed
          />
        </div>
      </div>
    </div>
  );
}

function PeriodPicker({ value, onChange }) {
  const presets = [
    { key: '3m',  label: 'آخر 3 شهور' },
    { key: '6m',  label: 'آخر 6 شهور' },
    { key: 'ytd', label: 'السنة الحالية' },
    { key: 'all', label: 'كل المدة' },
  ];
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {presets.map(p => (
        <button
          key={p.key}
          onClick={() => onChange(p.key)}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all ${
            value === p.key
              ? 'bg-[#1e3a5f] text-white shadow-lg shadow-[#1e3a5f]/30'
              : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// Active filter chip with 180° rotation removal animation
function FilterChip({ label, value, color, onRemove }) {
  const [removing, setRemoving] = useState(false);
  const colorMap = {
    blue:    'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200',
    violet:  'bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-200',
    emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200',
    amber:   'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200',
  };
  const handleRemove = () => {
    setRemoving(true);
    setTimeout(() => onRemove(), 280);
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black border transition-all ${colorMap[color] || colorMap.blue} ${removing ? 'chip-removing' : ''}`}>
      <span className="opacity-60">{label}:</span>
      <span>{value}</span>
      <button onClick={handleRemove} className="hover:opacity-100 opacity-70">
        <X size={11} strokeWidth={3} />
      </button>
    </span>
  );
}

function FiltersBar({ employee, setEmployee, department, setDepartment, employees, period, setPeriod, onClear }) {
  const inputCls = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] font-bold';
  const periodLabels = { '3m': 'آخر 3 شهور', '6m': 'آخر 6 شهور', ytd: 'السنة الحالية', all: 'كل المدة' };
  const hasActiveFilter = employee || department || period !== '6m';

  return (
    <div className="bg-white/80 backdrop-blur-md border border-gray-100 rounded-2xl p-4 sticky top-2 z-30 shadow-sm">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-1.5 bg-gray-50 rounded-lg">
          <Filter size={14} className="text-gray-500" />
        </div>

        <select value={employee} onChange={e => setEmployee(e.target.value)} className={inputCls}>
          <option value="">جميع الموظفين</option>
          {employees.map(e => <option key={e.name} value={e.name}>{e.name}</option>)}
        </select>

        <select value={department} onChange={e => setDepartment(e.target.value)} className={inputCls}>
          <option value="">جميع الأقسام</option>
          <option value="General">General</option>
          <option value="Private">Private</option>
          <option value="Semi">Semi</option>
        </select>

        <PeriodPicker value={period} onChange={setPeriod} />

        {hasActiveFilter && (
          <button onClick={onClear} className="text-xs text-gray-400 hover:text-gray-700 font-bold flex items-center gap-1 mr-auto">
            <X size={12} /> مسح الكل
          </button>
        )}
      </div>

      {/* Active filter chips */}
      {hasActiveFilter && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 flex-wrap">
          <span className="text-[10px] text-gray-400 font-black uppercase tracking-wider">فلاتر نشطة</span>
          {employee && (
            <FilterChip label="الموظف" value={employee} color="violet" onRemove={() => setEmployee('')} />
          )}
          {department && (
            <FilterChip label="القسم" value={department} color="blue" onRemove={() => setDepartment('')} />
          )}
          {period !== '6m' && (
            <FilterChip label="الفترة" value={periodLabels[period]} color="amber" onRemove={() => setPeriod('6m')} />
          )}
        </div>
      )}
    </div>
  );
}

// KPI Tabs above the chart — underline style, single-select
function KpiTabs({ value, onChange }) {
  return (
    <div className="flex items-center gap-1 border-b border-gray-100 -mb-px overflow-x-auto">
      {KPI_DEFS.map(k => {
        const active = value === k.key;
        const Icon = k.icon;
        return (
          <button
            key={k.key}
            onClick={() => onChange(k.key)}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-black whitespace-nowrap transition-all ${
              active ? 'text-gray-900' : 'text-gray-400 hover:text-gray-700'
            }`}
          >
            <Icon size={13} style={{ color: active ? k.color : undefined }} />
            {k.label}
            {active && (
              <span
                className="absolute bottom-0 inset-x-0 h-0.5 rounded-full"
                style={{ background: k.color }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── LEADERBOARD CARDS ────────────────────────────────────────────────────────

function LeaderCard({ icon: Icon, title, accent, items, valueKey = 'overall_score', emptyText = 'لا يوجد بيانات', onAgentClick }) {
  const accentMap = {
    amber:   { ring: 'border-amber-200',   bg: 'from-amber-50 to-white',   icon: 'bg-amber-100 text-amber-600', value: 'text-amber-600' },
    violet:  { ring: 'border-violet-200',  bg: 'from-violet-50 to-white',  icon: 'bg-violet-100 text-violet-600', value: 'text-violet-600' },
    rose:    { ring: 'border-rose-200',    bg: 'from-rose-50 to-white',    icon: 'bg-rose-100 text-rose-600', value: 'text-rose-600' },
    cyan:    { ring: 'border-cyan-200',    bg: 'from-cyan-50 to-white',    icon: 'bg-cyan-100 text-cyan-600', value: 'text-cyan-600' },
    emerald: { ring: 'border-emerald-200', bg: 'from-emerald-50 to-white', icon: 'bg-emerald-100 text-emerald-600', value: 'text-emerald-600' },
  };
  const a = accentMap[accent] || accentMap.amber;

  return (
    <div className={`relative overflow-hidden rounded-3xl border ${a.ring} bg-gradient-to-br ${a.bg} p-5 hover:-translate-y-0.5 hover:shadow-xl transition-all duration-200`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-xl ${a.icon}`}>
          <Icon size={18} strokeWidth={2.5} />
        </div>
        <h3 className="text-sm font-black text-gray-700">{title}</h3>
      </div>

      {(!items || items.length === 0) ? (
        <p className="text-center text-gray-400 text-sm py-6 font-bold">{emptyText}</p>
      ) : (
        <div className="space-y-2.5">
          {items.slice(0, 3).map((it, i) => {
            const v = it[valueKey] ?? 0;
            const delta = it.delta;
            return (
              <button
                key={i}
                onClick={() => onAgentClick?.(it.agent_name)}
                className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/60 transition-all text-right"
              >
                <Avatar name={it.agent_name} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-gray-800 truncate">{it.agent_name}</p>
                  <p className="text-[10px] text-gray-500 font-bold truncate">{it.department}</p>
                </div>
                <div className="text-left">
                  <p className={`text-lg font-black ${a.value} leading-none`}>{v}<span className="text-xs">%</span></p>
                  {delta != null && (
                    <p className="text-[10px] font-black text-gray-500 flex items-center gap-0.5 justify-end mt-0.5">
                      {trendIcon(delta)}
                      {delta > 0 ? '+' : ''}{delta}%
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── MAIN CHART ───────────────────────────────────────────────────────────────

function MainChart({ data, selectedAgents, kpi, setKpi, periods, onAgentToggle, allAgents, deptAvg }) {
  // Build chart data: [{ period_label, [agent]: value, ... }]
  const chartData = useMemo(() => {
    return periods.map(p => {
      const row = { name: monthShortAr(p.year, p.month), period_label: p.label };
      selectedAgents.forEach(a => {
        const cell = data.find(d => d.agent_name === a && d.period_label === p.label);
        row[a] = cell ? cell[kpi] : null;
      });
      // Add dept avg as a synthetic series
      if (deptAvg && deptAvg[p.label] != null) {
        row['__dept_avg__'] = deptAvg[p.label];
      }
      return row;
    });
  }, [data, selectedAgents, kpi, periods, deptAvg]);

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 pt-5 flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-base font-black text-gray-800 flex items-center gap-2">
          <TrendingUp size={20} className="text-[#1e3a5f]" />
          تطوّر الأداء عبر الشهور
        </h3>
        <p className="text-xs text-gray-400 font-bold">
          {selectedAgents.length} موظف · {periods.length} شهر
        </p>
      </div>

      {/* KPI Tabs */}
      {setKpi && (
        <div className="px-6 mt-3">
          <KpiTabs value={kpi} onChange={setKpi} />
        </div>
      )}

      <div className="flex gap-5 flex-col lg:flex-row p-6 pt-5">
        {/* Chart */}
        <div className="flex-1 min-w-0" style={{ height: 340 }}>
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm font-bold">
              اختر موظفاً واحداً على الأقل لعرض الرسم البياني
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  {selectedAgents.map((a, i) => (
                    <linearGradient key={a} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={LINE_PALETTE[i % LINE_PALETTE.length]} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={LINE_PALETTE[i % LINE_PALETTE.length]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="name" stroke="#9CA3AF" tick={{ fontSize: 11, fontWeight: 700 }} reversed />
                <YAxis domain={[0, 100]} stroke="#9CA3AF" tick={{ fontSize: 11, fontWeight: 700 }} unit="%" />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(15, 23, 42, 0.95)',
                    border: 'none',
                    borderRadius: '12px',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 12,
                    direction: 'rtl',
                  }}
                  formatter={(v, n) => [v == null ? '—' : `${v}%`, n === '__dept_avg__' ? 'متوسط القسم' : n]}
                />
                {/* Dept avg dashed line */}
                {deptAvg && (
                  <Line
                    type="monotone"
                    dataKey="__dept_avg__"
                    stroke="#94A3B8"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                    name="متوسط القسم"
                    isAnimationActive={false}
                  />
                )}
                {selectedAgents.map((a, i) => (
                  <Line
                    key={a}
                    type="monotone"
                    dataKey={a}
                    stroke={LINE_PALETTE[i % LINE_PALETTE.length]}
                    strokeWidth={2.5}
                    dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                    activeDot={{ r: 6, strokeWidth: 2 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Side panel */}
        <div className="lg:w-64 flex-shrink-0 border-r border-gray-100 lg:pr-5">
          <p className="text-[10px] text-gray-400 font-black uppercase tracking-wider mb-3">الموظفون المعروضون</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {allAgents.map((a, i) => {
              const isSelected = selectedAgents.includes(a.agent_name);
              const colorIdx = selectedAgents.indexOf(a.agent_name);
              return (
                <button
                  key={a.agent_name}
                  onClick={() => onAgentToggle(a.agent_name)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-right transition-all ${
                    isSelected ? 'bg-gray-50 hover:bg-gray-100' : 'hover:bg-gray-50 opacity-60'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ background: isSelected ? LINE_PALETTE[colorIdx % LINE_PALETTE.length] : '#E5E7EB' }}
                  />
                  <span className="text-xs font-black text-gray-700 truncate flex-1">{a.agent_name}</span>
                  <span className="text-xs font-black text-gray-500">{a.avg ?? 0}%</span>
                  {a.trend != null && trendIcon(a.trend)}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── HEATMAP MATRIX ───────────────────────────────────────────────────────────

function HeatmapMatrix({ periods, agents, onAgentClick, onCellClick }) {
  if (!periods || periods.length === 0 || !agents || agents.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-gray-100 p-12 text-center text-gray-400 font-bold">
        لا توجد بيانات للعرض. ابدأ بتجميد شهر.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-base font-black text-gray-800 flex items-center gap-2">
          <BarChart2 size={20} className="text-[#1e3a5f]" />
          مقارنة شهر-شهر
        </h3>
        <p className="text-[11px] text-gray-400 font-bold">
          🎯 = حقّق الهدف · 📝 = ملاحظة · ↗ = تحسّن
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50/60 border-b border-gray-100">
              <th className="px-4 py-3 text-right text-[11px] font-black text-gray-500 uppercase tracking-wider sticky right-0 bg-gray-50/60 z-10 min-w-[180px]">الموظف</th>
              {periods.map(p => (
                <th key={p.label} className="px-2 py-3 text-center text-[11px] font-black text-gray-500 min-w-[70px]">
                  {monthShortAr(p.year, p.month)}
                </th>
              ))}
              <th className="px-3 py-3 text-center text-[11px] font-black text-gray-500 bg-gray-100/60">المتوسط</th>
              <th className="px-3 py-3 text-center text-[11px] font-black text-gray-500 bg-gray-100/60">الاتجاه</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {agents.map(a => {
              const status = a.avg >= 80 ? '🟢' : a.avg >= 50 ? '🟡' : '🔴';
              return (
                <tr key={a.agent_name} className="hover:bg-gray-50/30 transition-colors">
                  <td className="px-4 py-3 sticky right-0 bg-white hover:bg-gray-50/30 z-10">
                    <button onClick={() => onAgentClick(a.agent_name)} className="flex items-center gap-2.5 text-right w-full hover:text-[#1e3a5f]">
                      <span className="text-base">{status}</span>
                      <Avatar name={a.agent_name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-gray-800 truncate">{a.agent_name}</p>
                        <p className="text-[10px] text-gray-400 font-bold">{a.department}</p>
                      </div>
                    </button>
                  </td>
                  {periods.map(p => {
                    const cell = a.cells[p.label];
                    const v = cell?.value;
                    return (
                      <td key={p.label} className="px-1.5 py-1.5 text-center">
                        {cell ? (
                          <button
                            onClick={() => onCellClick?.(cell)}
                            className="w-full px-2 py-2 rounded-lg font-black text-xs transition-all hover:scale-105 hover:shadow-md relative"
                            style={{
                              background: heatColor(v),
                              color: heatTextColor(v),
                            }}
                            title={`${a.agent_name} — ${monthShortAr(p.year, p.month)}: ${v}%`}
                          >
                            {v}
                            {cell.met_target === 1 && <span className="absolute -top-1 -right-1 text-[10px]">🎯</span>}
                            {cell.notes_count > 0 && <span className="absolute -bottom-1 -right-1 text-[10px]">📝</span>}
                          </button>
                        ) : (
                          <div className="w-full px-2 py-2 rounded-lg text-gray-300 text-xs font-black" style={{ background: 'repeating-linear-gradient(45deg, #F9FAFB, #F9FAFB 4px, #F3F4F6 4px, #F3F4F6 8px)' }}>—</div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-center bg-gray-50/40">
                    <span className="text-sm font-black text-gray-700">{a.avg}%</span>
                  </td>
                  <td className="px-3 py-3 text-center bg-gray-50/40">
                    <span className="inline-flex items-center gap-1 text-sm font-black"
                          style={{ color: a.trend > 0 ? '#10B981' : a.trend < 0 ? '#EF4444' : '#9CA3AF' }}>
                      {trendIcon(a.trend)}
                      {a.trend > 0 ? '+' : ''}{a.trend}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── EMPLOYEE DETAIL DRAWER ───────────────────────────────────────────────────

function KpiBar({ label, value, target, deptAvg, color }) {
  const v = value ?? 0;
  const t = target ?? 0;
  const d = deptAvg ?? 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs font-bold">
        <span className="text-gray-600">{label}</span>
        <span className="text-gray-800 font-black">{v}%</span>
      </div>
      <div className="relative h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="absolute inset-y-0 right-0 rounded-full transition-all"
             style={{ width: `${v}%`, background: color }} />
        {t > 0 && (
          <div className="absolute inset-y-0 w-px bg-red-500"
               style={{ right: `${t}%` }} title={`الهدف ${t}%`} />
        )}
      </div>
      <div className="flex items-center justify-between text-[10px] text-gray-400 font-bold">
        <span>متوسط القسم: {d}%</span>
        <span>الهدف: {t}%</span>
      </div>
    </div>
  );
}

function EmployeeDrawer({ agent, onClose, onOpenNotes }) {
  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ['employee-snapshots', agent],
    queryFn: () => api.get(`/admin/snapshots/employee/${encodeURIComponent(agent)}`).then(r => r.data),
    enabled: !!agent,
  });

  if (!agent) return null;

  const latest = snapshots[0];
  const sparkData = useMemo(() =>
    [...snapshots].reverse().slice(-12).map(s => ({
      name: monthShortAr(s.year, s.month),
      v: s.overall_score,
      target: s.target_overall,
      dept: s.dept_avg_overall,
    }))
  , [snapshots]);

  // Aggregate badges
  const allBadges = {};
  snapshots.forEach(s => (s.achievements || []).forEach(b => allBadges[b] = (allBadges[b] || 0) + 1));

  return (
    <div className="fixed inset-0 z-50 flex" dir="rtl">
      <button onClick={onClose} className="flex-1 bg-black/40 backdrop-blur-sm" />
      <div className="w-full max-w-md bg-white shadow-2xl overflow-y-auto animate-slide-in-right">
        {/* Header */}
        <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex items-center justify-between mb-4">
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl">
              <X size={18} />
            </button>
            <h2 className="font-black text-gray-700 text-sm">تفاصيل الموظف</h2>
          </div>
          <div className="flex items-center gap-3">
            <Avatar name={agent} size="lg" />
            <div>
              <p className="text-lg font-black text-gray-900">{agent}</p>
              <p className="text-xs text-gray-500 font-bold mt-0.5">
                {latest?.department} · {snapshots.length} شهر مجمّد
              </p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="p-6 text-center text-gray-400 text-sm font-bold">جارٍ التحميل...</div>
        ) : !latest ? (
          <div className="p-6 text-center text-gray-400 text-sm font-bold">لا توجد بيانات لهذا الموظف</div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Latest period summary */}
            <div className="bg-gradient-to-br from-gray-50 to-white border border-gray-100 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-black text-gray-700">{MONTH_NAMES_AR[latest.month]} {latest.year}</h3>
                <div className="flex items-center gap-1.5">
                  {latest.met_target === 1 && (
                    <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-[10px] font-black flex items-center gap-1">
                      <Trophy size={10} /> حقّق الأهداف
                    </span>
                  )}
                  {latest.rank_in_dept && (
                    <span className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-[10px] font-black">
                      المركز {latest.rank_in_dept} من {latest.total_in_dept}
                    </span>
                  )}
                </div>
              </div>

              <div className="text-center mb-4 py-3 bg-white rounded-xl">
                <p className="text-[10px] text-gray-400 font-black uppercase tracking-wider">الأداء العام</p>
                <p className="text-4xl font-black text-[#1e3a5f] mt-1">{latest.overall_score}<span className="text-lg">%</span></p>
                {snapshots.length > 1 && (
                  <p className="text-[11px] font-black text-gray-500 mt-1 flex items-center justify-center gap-1">
                    {trendIcon(latest.overall_score - (snapshots[1]?.overall_score || 0))}
                    {latest.overall_score - (snapshots[1]?.overall_score || 0) > 0 ? '+' : ''}
                    {latest.overall_score - (snapshots[1]?.overall_score || 0)}% من الشهر السابق
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <KpiBar label="نسبة الإنجاز"   value={latest.completion_rate} target={latest.target_completion} deptAvg={latest.dept_avg_completion} color="#10B981" />
                <KpiBar label="الالتزام (SLA)" value={latest.sla_rate}        target={null}                     deptAvg={null}                       color="#06B6D4" />
                <KpiBar label="متابعة الغياب"  value={latest.followup_rate}   target={latest.target_followup}   deptAvg={latest.dept_avg_followup}   color="#F59E0B" />
                <KpiBar label="حل الأعطال"    value={latest.fix_rate}        target={latest.target_fix}        deptAvg={latest.dept_avg_fix}        color="#EC4899" />
              </div>
            </div>

            {/* Sparkline */}
            {sparkData.length > 1 && (
              <div className="bg-white border border-gray-100 rounded-2xl p-4">
                <p className="text-xs font-black text-gray-700 mb-3 flex items-center gap-2">
                  <TrendingUp size={14} className="text-indigo-500" />
                  تطوّر آخر {sparkData.length} شهور
                </p>
                <div style={{ height: 140 }}>
                  <ResponsiveContainer>
                    <AreaChart data={sparkData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="#6366F1" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="v" stroke="#6366F1" strokeWidth={2} fill="url(#sparkGrad)" />
                      <Line type="monotone" dataKey="dept" stroke="#94A3B8" strokeDasharray="3 3" strokeWidth={1.5} dot={false} />
                      <XAxis dataKey="name" hide reversed />
                      <YAxis hide domain={[0, 100]} />
                      <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11, fontWeight: 700 }} formatter={(v, n) => [`${v}%`, n === 'v' ? 'الموظف' : 'متوسط القسم']} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Achievements */}
            {Object.keys(allBadges).length > 0 && (
              <div className="bg-white border border-gray-100 rounded-2xl p-4">
                <p className="text-xs font-black text-gray-700 mb-3 flex items-center gap-2">
                  <Award size={14} className="text-amber-500" />
                  الإنجازات
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(allBadges).map(([key, count]) => {
                    const def = BADGE_DEFS[key] || { emoji: '🏷️', label: key };
                    return (
                      <div key={key} className="px-2.5 py-1.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-black text-gray-700 flex items-center gap-1.5">
                        <span>{def.emoji}</span>
                        <span>{def.label}</span>
                        {count > 1 && <span className="px-1.5 bg-amber-100 text-amber-700 rounded-full text-[9px]">×{count}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Months table */}
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-xs font-black text-gray-700 flex items-center gap-2">
                  <Calendar size={14} className="text-blue-500" />
                  جميع الشهور
                </p>
                <span className="text-[10px] text-gray-400 font-black">{snapshots.length}</span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-right text-[10px] font-black text-gray-500">الشهر</th>
                      <th className="px-3 py-2 text-center text-[10px] font-black text-gray-500">إنجاز</th>
                      <th className="px-3 py-2 text-center text-[10px] font-black text-gray-500">SLA</th>
                      <th className="px-3 py-2 text-center text-[10px] font-black text-gray-500">عام</th>
                      <th className="px-3 py-2 text-center text-[10px] font-black text-gray-500"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {snapshots.map(s => (
                      <tr key={s.id} className="hover:bg-gray-50/50">
                        <td className="px-3 py-2 font-black text-gray-700">{MONTH_NAMES_AR_SHORT[s.month]} {String(s.year).slice(2)}</td>
                        <td className="px-3 py-2 text-center font-black text-emerald-600">{s.completion_rate}%</td>
                        <td className="px-3 py-2 text-center font-black text-cyan-600">{s.sla_rate}%</td>
                        <td className="px-3 py-2 text-center font-black text-indigo-600">{s.overall_score}%</td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => onOpenNotes?.(s)} className="p-1 hover:bg-gray-100 rounded-md text-gray-400 hover:text-gray-700 relative">
                            <MessageSquare size={12} />
                            {s.notes_count > 0 && (
                              <span className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 text-white text-[8px] font-black rounded-full flex items-center justify-center">{s.notes_count}</span>
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FREEZE MODAL ─────────────────────────────────────────────────────────────

function FreezeModal({ open, onClose, onSuccess, existingMonths }) {
  const [mode, setMode] = useState('single');
  const today = new Date();
  const defaultYear = today.getFullYear();
  const defaultMonth = today.getMonth() === 0 ? 12 : today.getMonth();
  const defaultPrevYear = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();

  const [year, setYear] = useState(defaultPrevYear);
  const [month, setMonth] = useState(defaultMonth);
  const [overwrite, setOverwrite] = useState(false);
  const [bulkFromY, setBulkFromY] = useState(defaultPrevYear);
  const [bulkFromM, setBulkFromM] = useState(1);
  const [bulkToY, setBulkToY] = useState(defaultPrevYear);
  const [bulkToM, setBulkToM] = useState(defaultMonth);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const exists = mode === 'single' && existingMonths?.some(e => e.year === +year && e.month === +month);

  if (!open) return null;

  async function freezeSingle() {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.post('/admin/snapshots/freeze', { year: +year, month: +month, overwrite });
      setResult({ ok: true, ...r.data });
      onSuccess?.();
    } catch (e) {
      setResult({ ok: false, error: e.response?.data?.error || e.message, message: e.response?.data?.message });
    } finally { setBusy(false); }
  }
  async function freezeBulk() {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.post('/admin/snapshots/freeze-bulk', {
        from: { year: +bulkFromY, month: +bulkFromM },
        to:   { year: +bulkToY,   month: +bulkToM },
        overwrite,
      });
      setResult({ ok: true, bulk: true, ...r.data });
      onSuccess?.();
    } catch (e) {
      setResult({ ok: false, error: e.response?.data?.error || e.message });
    } finally { setBusy(false); }
  }

  const inputCls = 'w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
            <Lock size={18} className="text-amber-600" />
            تجميد بيانات الشهر
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
        </div>

        {/* Mode tabs */}
        <div className="px-5 pt-4">
          <div className="flex bg-gray-50 rounded-xl p-1">
            {['single', 'bulk'].map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setResult(null); }}
                className={`flex-1 px-3 py-2 text-xs font-black rounded-lg transition-all ${
                  mode === m ? 'bg-white text-[#1e3a5f] shadow-sm' : 'text-gray-500'
                }`}
              >
                {m === 'single' ? 'شهر واحد' : 'متعدد (Catch-up)'}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 space-y-4">
          {mode === 'single' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-black text-gray-500 mb-1 block">السنة</label>
                  <input type="number" value={year} onChange={e => setYear(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-black text-gray-500 mb-1 block">الشهر</label>
                  <select value={month} onChange={e => setMonth(e.target.value)} className={inputCls}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <option key={m} value={m}>{MONTH_NAMES_AR[m]}</option>
                    ))}
                  </select>
                </div>
              </div>
              {exists && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-bold text-amber-800 flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>هذا الشهر مجمّد بالفعل. فعّل خيار "استبدال" للإعادة.</span>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500 font-bold">حدد المدى الذي تريد تجميده — يتجاوز الموجود تلقائياً.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-black text-gray-500 mb-1 block">من — السنة</label>
                  <input type="number" value={bulkFromY} onChange={e => setBulkFromY(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-black text-gray-500 mb-1 block">من — الشهر</label>
                  <select value={bulkFromM} onChange={e => setBulkFromM(e.target.value)} className={inputCls}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <option key={m} value={m}>{MONTH_NAMES_AR[m]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-black text-gray-500 mb-1 block">إلى — السنة</label>
                  <input type="number" value={bulkToY} onChange={e => setBulkToY(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-black text-gray-500 mb-1 block">إلى — الشهر</label>
                  <select value={bulkToM} onChange={e => setBulkToM(e.target.value)} className={inputCls}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <option key={m} value={m}>{MONTH_NAMES_AR[m]}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-gray-700 select-none">
            <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} className="w-4 h-4 rounded text-[#1e3a5f]" />
            استبدال البيانات الموجودة
          </label>

          {/* Result */}
          {result && (
            <div className={`p-3 rounded-xl text-xs font-bold ${result.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
              {result.ok ? (
                result.bulk ? (
                  <div>
                    <p className="font-black mb-1">✅ اكتمل التجميد</p>
                    <ul className="space-y-0.5 mt-1.5">
                      {result.months.map(m => (
                        <li key={`${m.year}-${m.month}`}>
                          {MONTH_NAMES_AR_SHORT[m.month]} {m.year}: {m.status === 'ok' ? `${m.created} منشئ، ${m.updated} محدّث` : m.status}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p>✅ {result.created || 0} موظف منشئ · {result.updated || 0} محدّث · {result.skipped || 0} تم تخطّيه</p>
                )
              ) : (
                <p>❌ {result.error}{result.message ? ` · ${result.message}` : ''}</p>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button onClick={onClose} className="flex-1 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl font-black text-sm text-gray-700">
              إلغاء
            </button>
            <button
              onClick={mode === 'single' ? freezeSingle : freezeBulk}
              disabled={busy}
              className="flex-1 px-4 py-2.5 bg-[#1e3a5f] hover:bg-[#2c4a7a] disabled:opacity-50 rounded-xl font-black text-sm text-white flex items-center justify-center gap-2"
            >
              {busy ? '...جاري' : (<><Lock size={14} /> {mode === 'single' ? 'تجميد' : 'تجميد المدى'}</>)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── NOTES MODAL ──────────────────────────────────────────────────────────────

function NotesModal({ snapshot, onClose }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  const { data: notes = [] } = useQuery({
    queryKey: ['snapshot-notes', snapshot?.id],
    queryFn: () => api.get(`/admin/snapshots/${snapshot.id}/notes`).then(r => r.data),
    enabled: !!snapshot?.id,
  });

  const addM = useMutation({
    mutationFn: (note) => api.post(`/admin/snapshots/${snapshot.id}/notes`, { note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['snapshot-notes', snapshot.id] }); setText(''); },
  });
  const updM = useMutation({
    mutationFn: ({ id, note }) => api.put(`/admin/snapshots/notes/${id}`, { note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['snapshot-notes', snapshot.id] }); setEditingId(null); },
  });
  const delM = useMutation({
    mutationFn: (id) => api.delete(`/admin/snapshots/notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['snapshot-notes', snapshot.id] }),
  });

  if (!snapshot) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
              <MessageSquare size={18} className="text-blue-600" />
              ملاحظات إدارية
            </h2>
            <p className="text-xs text-gray-500 font-bold mt-0.5">
              {snapshot.agent_name} · {MONTH_NAMES_AR[snapshot.month]} {snapshot.year}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Add */}
          <div className="space-y-2">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="اكتب ملاحظة... (سبب، حالة استثنائية، إلخ)"
              rows={3}
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 font-bold text-gray-700"
            />
            <button
              onClick={() => text.trim() && addM.mutate(text.trim())}
              disabled={!text.trim() || addM.isPending}
              className="w-full px-4 py-2 bg-[#1e3a5f] hover:bg-[#2c4a7a] disabled:opacity-50 rounded-xl font-black text-xs text-white flex items-center justify-center gap-2"
            >
              <Plus size={14} /> إضافة ملاحظة
            </button>
          </div>

          {/* List */}
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {notes.length === 0 ? (
              <p className="text-center py-6 text-gray-400 text-sm font-bold">لا توجد ملاحظات بعد</p>
            ) : notes.map(n => (
              <div key={n.id} className="p-3 bg-gray-50 border border-gray-100 rounded-xl">
                {editingId === n.id ? (
                  <div className="space-y-2">
                    <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={2} className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold" />
                    <div className="flex gap-2">
                      <button onClick={() => updM.mutate({ id: n.id, note: editText })} className="flex-1 px-3 py-1 bg-emerald-500 text-white rounded-lg text-xs font-black">حفظ</button>
                      <button onClick={() => setEditingId(null)} className="flex-1 px-3 py-1 bg-gray-200 text-gray-700 rounded-lg text-xs font-black">إلغاء</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-gray-700 font-bold leading-relaxed mb-2">{n.note}</p>
                    <div className="flex items-center justify-between text-[10px] text-gray-400 font-bold">
                      <span>{n.created_by_name || 'مستخدم'} · {new Date(n.created_at).toLocaleString('ar-EG')}</span>
                      <div className="flex gap-1">
                        <button onClick={() => { setEditingId(n.id); setEditText(n.note); }} className="p-1 hover:bg-white rounded text-blue-600"><Edit2 size={11} /></button>
                        <button onClick={() => delM.mutate(n.id)} className="p-1 hover:bg-white rounded text-red-600"><Trash2 size={11} /></button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BRIEF PDF REPORT (rendered hidden, captured by html2canvas) ──────────────

function PdfReport({ summary, leaderboard, periodLabel }) {
  const todayStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

  const Section = ({ title, items, emptyText, valueKey = 'overall_score', accent }) => (
    <div style={{ marginBottom: 18, breakInside: 'avoid' }}>
      <h3 style={{ fontSize: 16, fontWeight: 900, color: accent, margin: '0 0 10px 0', borderRight: `4px solid ${accent}`, paddingRight: 10 }}>
        {title}
      </h3>
      {(!items || items.length === 0) ? (
        <p style={{ color: '#9CA3AF', fontSize: 13, fontWeight: 700, padding: 12, background: '#F9FAFB', borderRadius: 8, margin: 0 }}>
          {emptyText}
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F3F4F6', borderBottom: `2px solid ${accent}` }}>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: '#6B7280', fontSize: 11 }}>#</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: '#6B7280', fontSize: 11 }}>الموظف</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: '#6B7280', fontSize: 11 }}>القسم</th>
              <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 800, color: '#6B7280', fontSize: 11 }}>القيمة</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 5).map((it, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #F3F4F6' }}>
                <td style={{ padding: '8px 12px', fontWeight: 900, color: '#9CA3AF' }}>{i + 1}</td>
                <td style={{ padding: '8px 12px', fontWeight: 900, color: '#111827' }}>{it.agent_name}</td>
                <td style={{ padding: '8px 12px', fontWeight: 700, color: '#6B7280' }}>{it.department}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 900, color: accent, fontSize: 14 }}>
                  {it[valueKey] ?? 0}%{it.delta != null ? ` (${it.delta > 0 ? '+' : ''}${it.delta}%)` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div dir="rtl" style={{
      fontFamily: 'Arial, "Segoe UI", Tahoma, sans-serif',
      width: 794, // A4 width @ 96 dpi
      padding: 40,
      background: '#fff',
      color: '#111827',
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1e3a5f 0%, #3b5fa0 100%)',
        color: '#fff',
        padding: '24px 28px',
        borderRadius: 16,
        marginBottom: 24,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, opacity: 0.85 }}>AHMED HASSAN ACADEMY</div>
        <h1 style={{ fontSize: 26, fontWeight: 900, margin: '8px 0 4px 0' }}>تقرير تطوّر أداء الفريق</h1>
        <p style={{ fontSize: 13, fontWeight: 700, opacity: 0.85, margin: 0 }}>
          الفترة: {periodLabel} · تاريخ التقرير: {todayStr}
        </p>
      </div>

      {/* Summary Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'شهور مجمّدة',   value: summary?.months || 0,           color: '#6366F1' },
          { label: 'موظف نشط',      value: summary?.agents || 0,           color: '#10B981' },
          { label: 'متوسط الإنجاز', value: (summary?.avgScore || 0) + '%', color: '#F59E0B' },
          { label: 'تحسّن الشهر',   value: ((summary?.monthDelta ?? 0) >= 0 ? '+' : '') + (summary?.monthDelta ?? 0) + '%', color: (summary?.monthDelta ?? 0) >= 0 ? '#10B981' : '#EF4444' },
        ].map((s, i) => (
          <div key={i} style={{
            background: '#F9FAFB',
            border: '1px solid #E5E7EB',
            borderRadius: 12,
            padding: '14px 12px',
            textAlign: 'center',
          }}>
            <p style={{ fontSize: 10, fontWeight: 800, color: '#6B7280', margin: '0 0 6px 0', textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</p>
            <p style={{ fontSize: 22, fontWeight: 900, color: s.color, margin: 0 }}>{s.value}</p>
          </div>
        ))}
      </div>

      <Section title="🥇 الأفضل أداءً"        items={leaderboard?.top}            emptyText="لا توجد بيانات بعد" accent="#D97706" />
      <Section title="🚀 الأكثر تحسناً"        items={leaderboard?.improved}        emptyText="يحتاج إلى شهرين متتاليين على الأقل" valueKey="score" accent="#7C3AED" />
      <Section title="🏆 حقّقوا الأهداف"       items={leaderboard?.targetMasters}   emptyText="لم يحقّق أحد جميع الأهداف هذا الشهر" accent="#059669" />
      <Section title="💎 التزام مثالي (SLA)"  items={leaderboard?.perfectSla}      emptyText="لا يوجد التزام 100%"  valueKey="sla_rate" accent="#0891B2" />
      <Section title="⚠️ يحتاج اهتمام"        items={leaderboard?.attention}       emptyText="لا أحد تحت 70% — أداء جيد للجميع 👏" accent="#DC2626" />

      {/* Footer */}
      <div style={{
        marginTop: 30,
        paddingTop: 16,
        borderTop: '2px solid #E5E7EB',
        textAlign: 'center',
        color: '#9CA3AF',
        fontSize: 11,
        fontWeight: 700,
      }}>
        تم إنشاء التقرير تلقائياً من نظام إدارة الأكاديمية · {new Date().toLocaleString('ar-EG')}
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function EmployeeProgression() {
  const qc = useQueryClient();
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  const [employee, setEmployee] = useState('');
  const [department, setDepartment] = useState('');
  const [period, setPeriod] = useState('6m');
  const [kpi, setKpi] = useState('overall_score');
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [drawerAgent, setDrawerAgent] = useState(null);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [notesSnapshot, setNotesSnapshot] = useState(null);
  const [pdfRendering, setPdfRendering] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  // Compute date range from period preset
  const range = useMemo(() => {
    const ty = currentYear, tm = currentMonth;
    if (period === '3m') {
      let fy = ty, fm = tm - 2;
      while (fm < 1) { fm += 12; fy--; }
      return { from_year: fy, from_month: fm, to_year: ty, to_month: tm };
    }
    if (period === '6m') {
      let fy = ty, fm = tm - 5;
      while (fm < 1) { fm += 12; fy--; }
      return { from_year: fy, from_month: fm, to_year: ty, to_month: tm };
    }
    if (period === 'ytd') return { from_year: ty, from_month: 1, to_year: ty, to_month: tm };
    return {};
  }, [period, currentYear, currentMonth]);

  // List of frozen months (for hero stats + freeze modal)
  const { data: frozenList = [] } = useQuery({
    queryKey: ['snapshots-list'],
    queryFn: () => api.get('/admin/snapshots/list').then(r => r.data),
  });

  // Heatmap data (also drives the chart)
  const { data: heatmap = { periods: [], agents: [] } } = useQuery({
    queryKey: ['snapshots-heatmap', range, department, kpi],
    queryFn: () => api.get('/admin/snapshots/heatmap', {
      params: { ...range, department: department || undefined, kpi },
    }).then(r => r.data),
  });

  // Latest period's leaderboard
  const latestPeriod = frozenList[0];
  const { data: leaderboard } = useQuery({
    queryKey: ['snapshots-leaderboard', latestPeriod?.year, latestPeriod?.month, department],
    queryFn: () => api.get('/admin/snapshots/leaderboard', {
      params: { year: latestPeriod.year, month: latestPeriod.month, department: department || undefined },
    }).then(r => r.data),
    enabled: !!latestPeriod,
  });

  // History (for chart) — same data as heatmap but flat
  const { data: history = [] } = useQuery({
    queryKey: ['snapshots-history', range, department, employee],
    queryFn: () => api.get('/admin/snapshots/history', {
      params: { ...range, department: department || undefined, agent: employee || undefined },
    }).then(r => r.data),
  });

  // Auto-pick agents to display: top 5 from heatmap by avg
  useEffect(() => {
    if (selectedAgents.length === 0 && heatmap.agents?.length > 0) {
      setSelectedAgents(heatmap.agents.slice(0, 5).map(a => a.agent_name));
    }
  }, [heatmap.agents]);

  // Apply employee filter on chart
  const chartAgents = employee
    ? heatmap.agents.filter(a => a.agent_name === employee)
    : heatmap.agents;
  const effectiveSelected = employee ? [employee] : selectedAgents;

  // Compute dept avg per period (across all agents in heatmap)
  const deptAvg = useMemo(() => {
    const m = {};
    heatmap.periods?.forEach(p => {
      const vals = heatmap.agents
        .map(a => a.cells[p.label]?.value)
        .filter(v => v != null);
      if (vals.length > 0) {
        m[p.label] = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
      }
    });
    return m;
  }, [heatmap]);

  // Hero summary
  const summary = {
    months: frozenList.length,
    agents: heatmap.agents?.length || 0,
    avgScore: leaderboard?.summary?.avg_score || 0,
    targetsMet: leaderboard?.summary?.targets_met || 0,
    monthDelta: leaderboard?.summary?.month_delta || 0,
  };

  function toggleAgent(name) {
    setSelectedAgents(curr => curr.includes(name) ? curr.filter(a => a !== name) : [...curr, name]);
  }

  function clearFilters() {
    setEmployee('');
    setDepartment('');
    setPeriod('6m');
    setKpi('overall_score');
  }

  async function exportPDF() {
    if (pdfBusy) return;
    setPdfBusy(true);
    setPdfRendering(true);
    try {
      // Wait two animation frames for the hidden node to actually mount and lay out
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 80));

      const node = document.getElementById('pdf-export-canvas');
      if (!node) throw new Error('PDF render node missing');

      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowWidth: node.scrollWidth,
        windowHeight: node.scrollHeight,
      });

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth  = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth   = pageWidth;
      const imgHeight  = (canvas.height * imgWidth) / canvas.width;

      const imgData = canvas.toDataURL('image/jpeg', 0.93);

      if (imgHeight <= pageHeight) {
        pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
      } else {
        // Multi-page: paint full image but shift y per page so each page shows next chunk
        let position = 0;
        let heightLeft = imgHeight;
        while (heightLeft > 0) {
          pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
          heightLeft -= pageHeight;
          if (heightLeft > 0) {
            position -= pageHeight;
            pdf.addPage();
          }
        }
      }

      const ts = new Date().toISOString().slice(0, 10);
      pdf.save(`employee-progression-${ts}.pdf`);
    } catch (e) {
      alert('تعذّر إنشاء الـ PDF: ' + (e.message || 'خطأ غير معروف'));
    } finally {
      setPdfRendering(false);
      setPdfBusy(false);
    }
  }

  function exportCSV() {
    if (!heatmap.agents?.length) return;
    const headers = ['الموظف', 'القسم', ...heatmap.periods.map(p => `${MONTH_NAMES_AR_SHORT[p.month]} ${p.year}`), 'المتوسط', 'الاتجاه'];
    const rows = heatmap.agents.map(a => [
      a.agent_name, a.department,
      ...heatmap.periods.map(p => a.cells[p.label]?.value ?? ''),
      a.avg, a.trend,
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `employee-progression-${kpi}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <HeroBanner
        summary={summary}
        onFreezeClick={() => setFreezeOpen(true)}
        onExport={exportCSV}
        onExportPdf={exportPDF}
        pdfBusy={pdfBusy}
      />

      <FiltersBar
        employee={employee} setEmployee={setEmployee}
        department={department} setDepartment={setDepartment}
        period={period} setPeriod={setPeriod}
        employees={heatmap.agents.map(a => ({ name: a.agent_name }))}
        onClear={clearFilters}
      />

      {/* Leaderboard */}
      {leaderboard && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <LeaderCard
            icon={Crown}
            title="الأفضل أداءً"
            accent="amber"
            items={leaderboard.top}
            onAgentClick={setDrawerAgent}
          />
          <LeaderCard
            icon={Sparkles}
            title="الأكثر تحسناً"
            accent="violet"
            items={leaderboard.improved}
            valueKey="score"
            onAgentClick={setDrawerAgent}
          />
          <LeaderCard
            icon={Trophy}
            title="حقّقوا الأهداف"
            accent="emerald"
            items={leaderboard.targetMasters}
            onAgentClick={setDrawerAgent}
          />
          <LeaderCard
            icon={Gem}
            title="التزام مثالي"
            accent="cyan"
            items={leaderboard.perfectSla}
            valueKey="sla_rate"
            onAgentClick={setDrawerAgent}
          />
          <LeaderCard
            icon={ShieldAlert}
            title="يحتاج اهتمام"
            accent="rose"
            items={leaderboard.attention}
            onAgentClick={setDrawerAgent}
          />
        </div>
      )}

      {/* Main chart */}
      <MainChart
        data={history}
        selectedAgents={effectiveSelected}
        kpi={kpi}
        setKpi={setKpi}
        periods={heatmap.periods}
        allAgents={chartAgents}
        onAgentToggle={toggleAgent}
        deptAvg={deptAvg}
      />

      {/* Heatmap */}
      <HeatmapMatrix
        periods={heatmap.periods}
        agents={chartAgents}
        onAgentClick={setDrawerAgent}
        onCellClick={(cell) => { setNotesSnapshot(cell); }}
      />

      {/* Drawer */}
      {drawerAgent && (
        <EmployeeDrawer
          agent={drawerAgent}
          onClose={() => setDrawerAgent(null)}
          onOpenNotes={(snap) => { setNotesSnapshot(snap); }}
        />
      )}

      {/* Freeze modal */}
      <FreezeModal
        open={freezeOpen}
        onClose={() => setFreezeOpen(false)}
        existingMonths={frozenList}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['snapshots-list'] }) || qc.invalidateQueries({ queryKey: ['snapshots-heatmap'] }) || qc.invalidateQueries({ queryKey: ['snapshots-leaderboard'] }) || qc.invalidateQueries({ queryKey: ['snapshots-history'] })}
      />

      {/* Notes modal */}
      {notesSnapshot && (
        <NotesModal
          snapshot={{
            id: notesSnapshot.id,
            agent_name: notesSnapshot.agent_name || drawerAgent,
            year: notesSnapshot.year,
            month: notesSnapshot.month,
          }}
          onClose={() => setNotesSnapshot(null)}
        />
      )}

      {/* Hidden PDF capture target — rendered off-screen while pdfRendering = true */}
      {pdfRendering && (
        <div style={{ position: 'fixed', left: -10000, top: 0, zIndex: -1, pointerEvents: 'none' }}>
          <div id="pdf-export-canvas">
            <PdfReport
              summary={summary}
              leaderboard={leaderboard}
              periodLabel={
                latestPeriod
                  ? `${MONTH_NAMES_AR[latestPeriod.month]} ${latestPeriod.year}`
                  : 'لم يُجمَّد أي شهر'
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
