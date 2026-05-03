/**
 * TeamProgression — Leader's view of their department's progression.
 *
 * Reuses the same backend endpoints (snapshots/heatmap, /history, /leaderboard,
 * /employee/:name) but always sends `?department=<leader's department>` so
 * results are scoped automatically. Read-only — no freeze, no notes editing.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart2, TrendingUp, TrendingDown, Minus, Trophy, Sparkles, Target, ShieldAlert,
  Users, Calendar, Zap, X, Filter, Crown, Gem, CheckCircle2, AlertTriangle,
  ArrowUp, ArrowDown, Award, MessageSquare, Download,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Area, AreaChart,
} from 'recharts';
import api from '../../api/axios';
import { useAuth } from '../../auth/AuthContext';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';
import ModernButton from '../../components/ui/ModernButton';

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
  top_performer:       { emoji: '🥇', label: 'بطل القسم' },
  top_3_performer:     { emoji: '🥈', label: 'ضمن أعلى 3' },
  rising_star:         { emoji: '🚀', label: 'النجم الصاعد' },
  streak_3:            { emoji: '🔥', label: '3 شهور متتالية' },
  streak_6:            { emoji: '🔥🔥', label: '6 شهور متتالية' },
  perfect_sla:         { emoji: '💎', label: 'التزام مثالي' },
  perfect_completion:  { emoji: '🎯', label: 'إنجاز كامل' },
  consistent:          { emoji: '🛡️', label: 'الثابت' },
  target_master:       { emoji: '🏆', label: 'محقق الأهداف' },
  excellence:          { emoji: '🎓', label: 'تميّز' },
};

const LINE_PALETTE = ['#10B981', '#3B82F6', '#A855F7', '#F59E0B', '#EC4899',
  '#06B6D4', '#F97316', '#84CC16', '#14B8A6', '#6366F1'];

function pad2(n) { return String(n).padStart(2, '0'); }
function monthShortAr(year, month) { return `${MONTH_NAMES_AR_SHORT[month]} ${String(year).slice(2)}`; }

function lerpColor(c1, c2, t) {
  const h2r = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const r2h = ([r, g, b]) => '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
  const a = h2r(c1), b = h2r(c2);
  return r2h(a.map((v, i) => v + (b[i] - v) * t));
}
function heatColor(v) {
  if (v == null) return '#F3F4F6';
  const x = Math.max(0, Math.min(100, v));
  if (x < 50) return lerpColor('#FEE2E2', '#FEF3C7', x / 50);
  return lerpColor('#FEF3C7', '#D1FAE5', (x - 50) / 50);
}
function heatTextColor(v) {
  if (v == null) return '#9CA3AF';
  const x = Math.max(0, Math.min(100, v));
  if (x < 40) return '#991B1B';
  if (x < 70) return '#92400E';
  return '#065F46';
}

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

function trendIcon(d) {
  if (d > 0) return <ArrowUp size={12} className="text-emerald-500" />;
  if (d < 0) return <ArrowDown size={12} className="text-red-500" />;
  return <Minus size={12} className="text-gray-400" />;
}

function Avatar({ name, size = 'sm' }) {
  const initial = (name?.[0] || '?').toUpperCase();
  const sz = size === 'lg' ? 'w-14 h-14 text-xl' : size === 'md' ? 'w-10 h-10 text-sm' : 'w-7 h-7 text-xs';
  return (
    <div className={`${sz} rounded-full flex items-center justify-center text-white font-black bg-gradient-to-br ${avatarGradient(name)} shadow-md flex-shrink-0`}>
      {initial}
    </div>
  );
}

// ─── Drawer (read-only) ───────────────────────────────────────────────────────

function ReadOnlyDrawer({ agent, onClose }) {
  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ['leader-employee-snapshots', agent],
    queryFn: () => api.get(`/admin/snapshots/employee/${encodeURIComponent(agent)}`).then(r => r.data),
    enabled: !!agent,
  });

  const latest = snapshots[0];
  const sparkData = useMemo(() =>
    [...snapshots].reverse().slice(-12).map(s => ({
      name: monthShortAr(s.year, s.month),
      v: s.overall_score,
      target: s.target_overall,
      dept: s.dept_avg_overall,
    })), [snapshots]);

  const allBadges = {};
  snapshots.forEach(s => (s.achievements || []).forEach(b => allBadges[b] = (allBadges[b] || 0) + 1));

  if (!agent) return null;

  return (
    <div className="fixed inset-0 z-50 flex" dir="rtl">
      <button onClick={onClose} className="flex-1 bg-black/40 backdrop-blur-sm" />
      <div className="w-full max-w-md bg-white shadow-2xl overflow-y-auto animate-slide-in-right">
        <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex items-center justify-between mb-4">
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl"><X size={18} /></button>
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
          <div className="p-6 text-center text-gray-400 text-sm font-bold">لا توجد بيانات</div>
        ) : (
          <div className="p-5 space-y-5">
            <div className="bg-gradient-to-br from-gray-50 to-white border border-gray-100 rounded-2xl p-4">
              <div className="text-center mb-4 py-3 bg-white rounded-xl">
                <p className="text-[10px] text-gray-400 font-black uppercase tracking-wider">الأداء العام</p>
                <p className="text-4xl font-black text-[#1e3a5f] mt-1">{latest.overall_score}<span className="text-lg">%</span></p>
                {latest.rank_in_dept && (
                  <p className="text-[11px] font-black text-indigo-600 mt-1">المركز {latest.rank_in_dept} من {latest.total_in_dept}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { label: 'الإنجاز', v: latest.completion_rate, color: 'emerald' },
                  { label: 'SLA',     v: latest.sla_rate,        color: 'cyan' },
                  { label: 'متابعة', v: latest.followup_rate,    color: 'amber' },
                  { label: 'أعطال',  v: latest.fix_rate,         color: 'pink' },
                ].map((k, i) => (
                  <div key={i} className={`bg-${k.color}-50 border border-${k.color}-100 rounded-xl p-2.5`}>
                    <p className="font-bold text-gray-500 text-[10px]">{k.label}</p>
                    <p className={`text-lg font-black text-${k.color}-700`}>{k.v}%</p>
                  </div>
                ))}
              </div>
            </div>

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
                        <linearGradient id="leaderSparkGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="#6366F1" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="v" stroke="#6366F1" strokeWidth={2} fill="url(#leaderSparkGrad)" />
                      <Line type="monotone" dataKey="dept" stroke="#94A3B8" strokeDasharray="3 3" strokeWidth={1.5} dot={false} />
                      <XAxis dataKey="name" hide reversed />
                      <YAxis hide domain={[0, 100]} />
                      <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11, fontWeight: 700 }} formatter={(v, n) => [`${v}%`, n === 'v' ? 'الموظف' : 'متوسط القسم']} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {Object.keys(allBadges).length > 0 && (
              <div className="bg-white border border-gray-100 rounded-2xl p-4">
                <p className="text-xs font-black text-gray-700 mb-3 flex items-center gap-2">
                  <Award size={14} className="text-amber-500" /> الإنجازات
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

            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-xs font-black text-gray-700 flex items-center gap-2">
                  <Calendar size={14} className="text-blue-500" /> جميع الشهور
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
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {snapshots.map(s => (
                      <tr key={s.id} className="hover:bg-gray-50/50">
                        <td className="px-3 py-2 font-black text-gray-700">{MONTH_NAMES_AR_SHORT[s.month]} {String(s.year).slice(2)}</td>
                        <td className="px-3 py-2 text-center font-black text-emerald-600">{s.completion_rate}%</td>
                        <td className="px-3 py-2 text-center font-black text-cyan-600">{s.sla_rate}%</td>
                        <td className="px-3 py-2 text-center font-black text-indigo-600">{s.overall_score}%</td>
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

// ─── Leaderboard card (small, reusable) ───────────────────────────────────────

function LeaderCard({ icon: Icon, title, accent, items, valueKey = 'overall_score', onAgentClick }) {
  const accentMap = {
    amber:   { ring: 'border-amber-200',   bg: 'from-amber-50 to-white',   icon: 'bg-amber-100 text-amber-600',     value: 'text-amber-600' },
    violet:  { ring: 'border-violet-200',  bg: 'from-violet-50 to-white',  icon: 'bg-violet-100 text-violet-600',   value: 'text-violet-600' },
    rose:    { ring: 'border-rose-200',    bg: 'from-rose-50 to-white',    icon: 'bg-rose-100 text-rose-600',       value: 'text-rose-600' },
    cyan:    { ring: 'border-cyan-200',    bg: 'from-cyan-50 to-white',    icon: 'bg-cyan-100 text-cyan-600',       value: 'text-cyan-600' },
    emerald: { ring: 'border-emerald-200', bg: 'from-emerald-50 to-white', icon: 'bg-emerald-100 text-emerald-600', value: 'text-emerald-600' },
  };
  const a = accentMap[accent] || accentMap.amber;

  return (
    <div className={`relative overflow-hidden rounded-3xl border ${a.ring} bg-gradient-to-br ${a.bg} p-5 hover:-translate-y-0.5 hover:shadow-xl transition-all duration-200`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-xl ${a.icon}`}><Icon size={18} strokeWidth={2.5} /></div>
        <h3 className="text-sm font-black text-gray-700">{title}</h3>
      </div>
      {(!items || items.length === 0) ? (
        <p className="text-center text-gray-400 text-sm py-6 font-bold">لا توجد بيانات</p>
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

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function TeamProgression() {
  const { user } = useAuth();
  const department = user?.department && user.department !== 'All' ? user.department : '';

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  const [period, setPeriod] = useState('6m');
  const [kpi, setKpi] = useState('overall_score');
  const [drawerAgent, setDrawerAgent] = useState(null);

  const range = useMemo(() => {
    const ty = currentYear, tm = currentMonth;
    if (period === '3m') {
      let fy = ty, fm = tm - 2; while (fm < 1) { fm += 12; fy--; } return { from_year: fy, from_month: fm, to_year: ty, to_month: tm };
    }
    if (period === '6m') {
      let fy = ty, fm = tm - 5; while (fm < 1) { fm += 12; fy--; } return { from_year: fy, from_month: fm, to_year: ty, to_month: tm };
    }
    if (period === 'ytd') return { from_year: ty, from_month: 1, to_year: ty, to_month: tm };
    return {};
  }, [period, currentYear, currentMonth]);

  // List for hero stats
  const { data: frozenList = [] } = useQuery({
    queryKey: ['snapshots-list-leader'],
    queryFn: () => api.get('/admin/snapshots/list').then(r => r.data),
  });

  const { data: heatmap = { periods: [], agents: [] } } = useQuery({
    queryKey: ['leader-heatmap', range, kpi, department],
    queryFn: () => api.get('/admin/snapshots/heatmap', {
      params: { ...range, department: department || undefined, kpi },
    }).then(r => r.data),
  });

  const latestPeriod = frozenList[0];
  const { data: leaderboard } = useQuery({
    queryKey: ['leader-leaderboard', latestPeriod?.year, latestPeriod?.month, department],
    queryFn: () => api.get('/admin/snapshots/leaderboard', {
      params: { year: latestPeriod.year, month: latestPeriod.month, department: department || undefined },
    }).then(r => r.data),
    enabled: !!latestPeriod,
  });

  // Auto-pick top 5 agents to display
  const [selectedAgents, setSelectedAgents] = useState([]);
  useEffect(() => {
    if (selectedAgents.length === 0 && heatmap.agents?.length > 0) {
      setSelectedAgents(heatmap.agents.slice(0, 5).map(a => a.agent_name));
    }
  }, [heatmap.agents]);

  const deptAvg = useMemo(() => {
    const m = {};
    heatmap.periods?.forEach(p => {
      const vals = heatmap.agents.map(a => a.cells[p.label]?.value).filter(v => v != null);
      if (vals.length > 0) m[p.label] = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
    });
    return m;
  }, [heatmap]);

  const chartData = useMemo(() => {
    return heatmap.periods.map(p => {
      const row = { name: monthShortAr(p.year, p.month), period_label: p.label };
      selectedAgents.forEach(a => {
        const cell = heatmap.agents.find(d => d.agent_name === a)?.cells[p.label];
        row[a] = cell ? cell.value : null;
      });
      if (deptAvg[p.label] != null) row['__dept_avg__'] = deptAvg[p.label];
      return row;
    });
  }, [heatmap, selectedAgents, deptAvg]);

  function toggleAgent(name) {
    setSelectedAgents(curr => curr.includes(name) ? curr.filter(a => a !== name) : [...curr, name]);
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
    link.download = `team-progression-${kpi}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="تطوّر فريقي"
        subtitle={`نظرة شاملة على أداء فريق ${department || ''} عبر الشهور`}
        icon={BarChart2}
        gradient="navy"
        actions={
          <ModernButton variant="glass" icon={Download} onClick={exportCSV}>
            CSV
          </ModernButton>
        }
        stats={[
          { label: 'موظف نشط', value: heatmap.agents?.length || 0, icon: Users },
          { label: 'متوسط الأداء', value: leaderboard?.summary?.avg_score || 0, icon: Trophy, suffix: '%' },
          { label: 'حقّقوا الأهداف', value: leaderboard?.summary?.targets_met || 0, icon: Target },
          { label: 'تحسّن الشهر', value: leaderboard?.summary?.month_delta || 0, icon: leaderboard?.summary?.month_delta >= 0 ? TrendingUp : TrendingDown, suffix: '%', signed: true },
        ]}
      />

      {/* Period picker */}
      <div className="bg-white/80 backdrop-blur-md border border-gray-100 rounded-2xl p-4 sticky top-2 z-30 shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="p-1.5 bg-gray-50 rounded-lg">
            <Filter size={14} className="text-gray-500" />
          </div>
          {[
            { key: '3m',  label: 'آخر 3 شهور' },
            { key: '6m',  label: 'آخر 6 شهور' },
            { key: 'ytd', label: 'السنة الحالية' },
            { key: 'all', label: 'كل المدة' },
          ].map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all ${
                period === p.key
                  ? 'bg-[#1e3a5f] text-white shadow-lg shadow-[#1e3a5f]/30'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Leaderboard */}
      {leaderboard && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <LeaderCard icon={Crown}       title="الأفضل أداءً"     accent="amber"   items={leaderboard.top}            onAgentClick={setDrawerAgent} />
          <LeaderCard icon={Sparkles}    title="الأكثر تحسناً"    accent="violet"  items={leaderboard.improved}        valueKey="score" onAgentClick={setDrawerAgent} />
          <LeaderCard icon={Trophy}      title="حقّقوا الأهداف"   accent="emerald" items={leaderboard.targetMasters}   onAgentClick={setDrawerAgent} />
          <LeaderCard icon={Gem}         title="التزام مثالي"    accent="cyan"    items={leaderboard.perfectSla}      valueKey="sla_rate" onAgentClick={setDrawerAgent} />
        </div>
      )}

      {/* Chart */}
      <SectionCard title="تطوّر أداء الفريق" icon={TrendingUp} accent="indigo">
        {/* KPI tabs */}
        <div className="flex items-center gap-1 border-b border-gray-100 -mx-6 px-6 mb-5 overflow-x-auto">
          {KPI_DEFS.map(k => {
            const active = kpi === k.key;
            const Icon = k.icon;
            return (
              <button key={k.key} onClick={() => setKpi(k.key)}
                className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-black whitespace-nowrap transition-all ${
                  active ? 'text-gray-900' : 'text-gray-400 hover:text-gray-700'
                }`}>
                <Icon size={13} style={{ color: active ? k.color : undefined }} />
                {k.label}
                {active && <span className="absolute bottom-0 inset-x-0 h-0.5 rounded-full" style={{ background: k.color }} />}
              </button>
            );
          })}
        </div>

        <div className="flex gap-5 flex-col lg:flex-row">
          <div className="flex-1 min-w-0" style={{ height: 320 }}>
            {chartData.length === 0 ? (
              <EmptyState icon={TrendingUp} accent="gray" title="لا توجد بيانات" message="لم يتم تجميد أي شهر بعد لقسمك." />
            ) : (
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="name" stroke="#9CA3AF" tick={{ fontSize: 11, fontWeight: 700 }} reversed />
                  <YAxis domain={[0, 100]} stroke="#9CA3AF" tick={{ fontSize: 11, fontWeight: 700 }} unit="%" />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(15, 23, 42, 0.95)', border: 'none', borderRadius: 12, color: '#fff',
                      fontWeight: 700, fontSize: 12, direction: 'rtl',
                    }}
                    formatter={(v, n) => [v == null ? '—' : `${v}%`, n === '__dept_avg__' ? 'متوسط الفريق' : n]}
                  />
                  <Line type="monotone" dataKey="__dept_avg__" stroke="#94A3B8" strokeWidth={2} strokeDasharray="6 4" dot={false} name="متوسط الفريق" isAnimationActive={false} />
                  {selectedAgents.map((a, i) => (
                    <Line key={a} type="monotone" dataKey={a}
                          stroke={LINE_PALETTE[i % LINE_PALETTE.length]}
                          strokeWidth={2.5} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                          activeDot={{ r: 6, strokeWidth: 2 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="lg:w-64 flex-shrink-0 border-r border-gray-100 lg:pr-5">
            <p className="text-[10px] text-gray-400 font-black uppercase tracking-wider mb-3">الموظفون المعروضون</p>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {heatmap.agents.map((a, i) => {
                const isSelected = selectedAgents.includes(a.agent_name);
                const colorIdx = selectedAgents.indexOf(a.agent_name);
                return (
                  <button key={a.agent_name} onClick={() => toggleAgent(a.agent_name)}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-right transition-all ${
                      isSelected ? 'bg-gray-50 hover:bg-gray-100' : 'hover:bg-gray-50 opacity-60'
                    }`}>
                    <span className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ background: isSelected ? LINE_PALETTE[colorIdx % LINE_PALETTE.length] : '#E5E7EB' }} />
                    <span className="text-xs font-black text-gray-700 truncate flex-1">{a.agent_name}</span>
                    <span className="text-xs font-black text-gray-500">{a.avg ?? 0}%</span>
                    {a.trend != null && trendIcon(a.trend)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Heatmap */}
      <SectionCard title="مقارنة شهر-شهر" subtitle="اضغط على اسم الموظف لتفاصيله" icon={BarChart2} accent="indigo" noBodyPad>
        {heatmap.agents.length === 0 ? (
          <EmptyState icon={BarChart2} accent="gray" title="لا توجد بيانات" message="فريقك لم يحصل على snapshots بعد." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/60 border-b border-gray-100">
                  <th className="px-4 py-3 text-right text-[11px] font-black text-gray-500 sticky right-0 bg-gray-50/60 z-10 min-w-[180px]">الموظف</th>
                  {heatmap.periods.map(p => (
                    <th key={p.label} className="px-2 py-3 text-center text-[11px] font-black text-gray-500 min-w-[70px]">
                      {monthShortAr(p.year, p.month)}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-center text-[11px] font-black text-gray-500 bg-gray-100/60">المتوسط</th>
                  <th className="px-3 py-3 text-center text-[11px] font-black text-gray-500 bg-gray-100/60">الاتجاه</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {heatmap.agents.map(a => {
                  const status = a.avg >= 80 ? '🟢' : a.avg >= 50 ? '🟡' : '🔴';
                  return (
                    <tr key={a.agent_name} className="hover:bg-gray-50/30 transition-colors">
                      <td className="px-4 py-3 sticky right-0 bg-white z-10">
                        <button onClick={() => setDrawerAgent(a.agent_name)} className="flex items-center gap-2.5 text-right w-full hover:text-[#1e3a5f]">
                          <span className="text-base">{status}</span>
                          <Avatar name={a.agent_name} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-black text-gray-800 truncate">{a.agent_name}</p>
                            <p className="text-[10px] text-gray-400 font-bold">{a.department}</p>
                          </div>
                        </button>
                      </td>
                      {heatmap.periods.map(p => {
                        const cell = a.cells[p.label];
                        const v = cell?.value;
                        return (
                          <td key={p.label} className="px-1.5 py-1.5 text-center">
                            {cell ? (
                              <div className="w-full px-2 py-2 rounded-lg font-black text-xs relative"
                                   style={{ background: heatColor(v), color: heatTextColor(v) }}
                                   title={`${a.agent_name} — ${monthShortAr(p.year, p.month)}: ${v}%`}>
                                {v}
                                {cell.met_target === 1 && <span className="absolute -top-1 -right-1 text-[10px]">🎯</span>}
                              </div>
                            ) : (
                              <div className="w-full px-2 py-2 rounded-lg text-gray-300 text-xs font-black"
                                   style={{ background: 'repeating-linear-gradient(45deg, #F9FAFB, #F9FAFB 4px, #F3F4F6 4px, #F3F4F6 8px)' }}>—</div>
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
        )}
      </SectionCard>

      {drawerAgent && <ReadOnlyDrawer agent={drawerAgent} onClose={() => setDrawerAgent(null)} />}
    </div>
  );
}
