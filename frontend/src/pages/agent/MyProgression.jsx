import { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp, Trophy, Target, Sparkles, Award, Calendar,
  CheckCircle2, Zap, ShieldAlert, Users, ArrowUp, ArrowDown, Minus,
  Crown, Flame, Gem, Edit2, Save, X, Heart, Lightbulb, Trash2,
} from 'lucide-react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, BarChart, Bar,
} from 'recharts';
import api from '../../api/axios';

const MONTH_NAMES_AR = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTH_NAMES_AR_SHORT = ['', 'ينا', 'فبر', 'مار', 'أبر', 'مايو', 'يون',
  'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'];

const BADGE_DEFS = {
  top_performer:       { emoji: '🥇', label: 'بطل القسم',    color: 'amber' },
  top_3_performer:     { emoji: '🥈', label: 'ضمن أعلى 3',    color: 'slate' },
  rising_star:         { emoji: '🚀', label: 'النجم الصاعد',  color: 'violet' },
  streak_3:            { emoji: '🔥', label: '3 شهور متتالية', color: 'orange' },
  streak_6:            { emoji: '🔥🔥', label: '6 شهور متتالية', color: 'red' },
  perfect_sla:         { emoji: '💎', label: 'التزام مثالي',  color: 'cyan' },
  perfect_completion:  { emoji: '🎯', label: 'إنجاز كامل',    color: 'emerald' },
  consistent:          { emoji: '🛡️', label: 'الثابت',       color: 'blue' },
  target_master:       { emoji: '🏆', label: 'محقق الأهداف',  color: 'amber' },
  excellence:          { emoji: '🎓', label: 'تميّز',         color: 'fuchsia' },
};

function trendIcon(delta) {
  if (delta > 0)  return <ArrowUp size={14} className="text-emerald-300" />;
  if (delta < 0)  return <ArrowDown size={14} className="text-rose-300" />;
  return <Minus size={14} className="text-white/60" />;
}

function KpiCard({ label, value, target, deptAvg, color, icon: Icon }) {
  const v = value ?? 0;
  const t = target ?? 0;
  const d = deptAvg ?? 0;
  const reached = t > 0 && v >= t;

  return (
    <div className="bg-white border border-gray-100 rounded-3xl p-5 hover:shadow-lg transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg" style={{ background: `${color}15` }}>
            <Icon size={14} style={{ color }} />
          </div>
          <p className="text-xs font-black text-gray-700">{label}</p>
        </div>
        {t > 0 && (
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
            reached ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {reached ? 'تحقق ✓' : `الهدف ${t}%`}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2 mb-3">
        <p className="text-3xl font-black" style={{ color }}>{v}<span className="text-base">%</span></p>
      </div>

      <div className="space-y-2">
        <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="absolute inset-y-0 right-0 rounded-full transition-all"
               style={{ width: `${v}%`, background: color }} />
          {t > 0 && (
            <div className="absolute inset-y-0 w-0.5 bg-red-500"
                 style={{ right: `${t}%` }} title={`الهدف ${t}%`} />
          )}
        </div>
        <div className="flex items-center justify-between text-[10px] text-gray-400 font-bold">
          {d > 0 && <span>متوسط القسم: {d}%</span>}
          {t > 0 && <span>الهدف: {t}%</span>}
        </div>
      </div>
    </div>
  );
}

// ─── PERSONAL GOALS CARD ──────────────────────────────────────────────────────

function PersonalGoalsCard({ personalGoals, latest, onEdit, onClear, deleting }) {
  const hasGoals = !!personalGoals;
  const goal = personalGoals || { goal_completion: 90, goal_followup: 85, goal_fix: 95, goal_overall: 90 };

  const rows = [
    { label: 'الإنجاز',       value: latest?.completion_rate, goal: goal.goal_completion, color: '#10B981' },
    { label: 'متابعة الغياب', value: latest?.followup_rate,   goal: goal.goal_followup,   color: '#F59E0B' },
    { label: 'حل الأعطال',    value: latest?.fix_rate,        goal: goal.goal_fix,        color: '#EC4899' },
    { label: 'الأداء العام',  value: latest?.overall_score,   goal: goal.goal_overall,    color: '#8B5CF6' },
  ];

  return (
    <div className="bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 border-2 border-violet-200 rounded-3xl p-6 relative overflow-hidden">
      <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full opacity-10 blur-3xl"
           style={{ background: 'radial-gradient(circle, #8B5CF6 0%, transparent 70%)' }} />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-violet-100 rounded-2xl">
              <Heart size={20} className="text-violet-600" strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="text-base font-black text-gray-800">أهدافي الشخصية</h3>
              <p className="text-[11px] text-gray-500 font-bold mt-0.5">
                {hasGoals
                  ? '💪 تحدي شخصي يساعدك على تحقيق أداء أفضل'
                  : '✨ حدد أهدافك الخاصة لتحفيز نفسك'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasGoals && (
              <button onClick={onClear} disabled={deleting}
                      className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-500 disabled:opacity-50">
                <Trash2 size={14} />
              </button>
            )}
            <button onClick={onEdit}
                    className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-lg shadow-violet-500/30">
              {hasGoals ? <Edit2 size={13} /> : <Sparkles size={13} />}
              {hasGoals ? 'تعديل' : 'حدد أهدافك'}
            </button>
          </div>
        </div>

        {hasGoals ? (
          <div className="space-y-3.5">
            {rows.map((r, i) => {
              const v = r.value ?? 0;
              const pct = Math.min(100, (v / r.goal) * 100);
              const reached = v >= r.goal;
              return (
                <div key={i} className="bg-white border border-violet-100 rounded-2xl p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-black text-gray-700">{r.label}</span>
                    <div className="flex items-center gap-2 text-xs font-black">
                      <span className="text-gray-500">{v}%</span>
                      <span className="text-gray-300">/</span>
                      <span style={{ color: r.color }}>هدفك: {r.goal}%</span>
                      {reached && <span className="text-emerald-500">✓</span>}
                    </div>
                  </div>
                  <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="absolute inset-y-0 right-0 rounded-full transition-all"
                         style={{ width: `${pct}%`, background: r.color }} />
                  </div>
                  {!reached && r.goal > 0 && (
                    <p className="text-[10px] text-gray-400 font-bold mt-1.5 text-left">
                      تبقّى {Math.max(0, r.goal - v)}% للوصول لهدفك
                    </p>
                  )}
                </div>
              );
            })}

            {personalGoals.notes && (
              <div className="bg-violet-100/50 border border-violet-200 rounded-2xl p-3 flex items-start gap-2">
                <Lightbulb size={14} className="text-violet-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs font-bold text-violet-900 italic leading-relaxed">{personalGoals.notes}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6 bg-white/60 rounded-2xl border border-dashed border-violet-300">
            <Sparkles size={28} className="mx-auto text-violet-400 mb-2" />
            <p className="text-sm font-black text-violet-900">حدد أهدافك الشخصية الآن</p>
            <p className="text-[11px] text-gray-500 font-bold mt-1 max-w-md mx-auto leading-relaxed">
              أهدافك الشخصية ما تأثرش على تقييم الإدارة — هي حافز شخصي ليك تتحدى نفسك وتوصل لأعلى أداء
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── EDIT MODAL ───────────────────────────────────────────────────────────────

function EditGoalsModal({ open, current, onClose, onSaved }) {
  const qc = useQueryClient();
  const [gc, setGc] = useState(90);
  const [gf, setGf] = useState(85);
  const [gx, setGx] = useState(95);
  const [go, setGo] = useState(90);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      setGc(current?.goal_completion ?? 90);
      setGf(current?.goal_followup   ?? 85);
      setGx(current?.goal_fix        ?? 95);
      setGo(current?.goal_overall    ?? 90);
      setNotes(current?.notes || '');
    }
  }, [open, current]);

  const saveM = useMutation({
    mutationFn: () => api.put('/agent/my-goals', {
      goal_completion: gc, goal_followup: gf, goal_fix: gx, goal_overall: go, notes,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-progression'] });
      onSaved?.();
    },
  });

  if (!open) return null;

  const sliders = [
    { v: gc, set: setGc, label: 'الإنجاز',       color: '#10B981', icon: '✓' },
    { v: gf, set: setGf, label: 'متابعة الغياب', color: '#F59E0B', icon: '👥' },
    { v: gx, set: setGx, label: 'حل الأعطال',    color: '#EC4899', icon: '🔧' },
    { v: go, set: setGo, label: 'الأداء العام',  color: '#8B5CF6', icon: '🏆' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-violet-100 rounded-xl">
              <Heart size={18} className="text-violet-600" />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900">أهدافي الشخصية</h2>
              <p className="text-[11px] text-gray-400 font-bold">حدّد التحدّي اللي تطمح ليه</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-3">
            {sliders.map((s, i) => (
              <div key={i} className="bg-gray-50 rounded-2xl p-3 border border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-black text-gray-700">
                    <span className="ml-1">{s.icon}</span>
                    {s.label}
                  </span>
                  <span className="text-lg font-black" style={{ color: s.color }}>{s.v}%</span>
                </div>
                <input
                  type="range" min="0" max="100" value={s.v}
                  onChange={e => s.set(+e.target.value)}
                  className="w-full"
                  style={{ accentColor: s.color }}
                />
              </div>
            ))}
          </div>

          <div>
            <label className="text-xs font-black text-gray-500 mb-1.5 block flex items-center gap-1.5">
              <Lightbulb size={12} /> ملاحظات تحفيزية (اختياري)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value.slice(0, 300))}
              rows={2}
              maxLength={300}
              placeholder="مثال: عايز أوصل للمركز الأول هذا الشهر..."
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
            <p className="text-[10px] text-gray-400 font-bold text-left mt-1">{notes.length}/300</p>
          </div>

          {saveM.isError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-800">
              {saveM.error?.response?.data?.error || 'حدث خطأ'}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={onClose}
                    className="flex-1 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl font-black text-sm text-gray-700">
              إلغاء
            </button>
            <button onClick={() => saveM.mutate()} disabled={saveM.isPending}
                    className="flex-1 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-xl font-black text-sm text-white flex items-center justify-center gap-2">
              <Save size={14} /> {saveM.isPending ? '...جاري' : 'حفظ التحدي'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MyProgression() {
  const qc = useQueryClient();
  const [editGoalsOpen, setEditGoalsOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['my-progression'],
    queryFn: () => api.get('/agent/my-progression').then(r => r.data),
  });

  const clearM = useMutation({
    mutationFn: () => api.delete('/agent/my-goals'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-progression'] }),
  });

  const snapshots = data?.snapshots || [];
  const latest = snapshots[0];
  const prev = snapshots[1];

  // Build chart data (chronological)
  const chartData = useMemo(() =>
    [...snapshots].reverse().map(s => ({
      name: `${MONTH_NAMES_AR_SHORT[s.month]} ${String(s.year).slice(2)}`,
      score: s.overall_score,
      completion: s.completion_rate,
      sla: s.sla_rate,
      followup: s.followup_rate,
      fix: s.fix_rate,
      dept: s.dept_avg_overall,
      target: s.target_overall,
    }))
  , [snapshots]);

  const lifetimeBadges = data?.lifetime_badges || {};
  const badgeKeys = Object.keys(lifetimeBadges).sort((a, b) => lifetimeBadges[b] - lifetimeBadges[a]);

  const deltaScore = latest && prev ? latest.overall_score - prev.overall_score : 0;

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      {/* Hero */}
      <div
        className="relative overflow-hidden rounded-3xl p-6 text-white"
        style={{
          background: 'linear-gradient(135deg, #4c1d95 0%, #6d28d9 50%, #8b5cf6 100%)',
          boxShadow: '0 20px 50px -12px rgba(139, 92, 246, 0.4)',
        }}
      >
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full opacity-20 blur-3xl"
             style={{ background: 'radial-gradient(circle, #c084fc 0%, transparent 70%)' }} />
        <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full opacity-20 blur-3xl"
             style={{ background: 'radial-gradient(circle, #ec4899 0%, transparent 70%)' }} />

        <div className="relative z-10">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/15 backdrop-blur rounded-2xl">
                <TrendingUp size={26} />
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight">تطوّري</h1>
                <p className="text-white/70 text-sm font-bold mt-0.5">
                  {data?.agent_name} · {data?.department} · {snapshots.length} شهر مُسجّل
                </p>
              </div>
            </div>
          </div>

          {latest ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Big main score */}
              <div className="md:col-span-1 bg-white/10 backdrop-blur border border-white/15 rounded-2xl p-5 text-center">
                <p className="text-[10px] text-white/70 font-black uppercase tracking-wider mb-1">أدائي الحالي</p>
                <p className="text-5xl font-black leading-none">{latest.overall_score}<span className="text-2xl">%</span></p>
                {prev && (
                  <p className="mt-2 text-xs font-black flex items-center justify-center gap-1">
                    {trendIcon(deltaScore)}
                    {deltaScore > 0 ? '+' : ''}{deltaScore}%
                    <span className="text-white/60 font-bold">من الشهر السابق</span>
                  </p>
                )}
              </div>

              {/* Quick KPIs */}
              <div className="md:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'الإنجاز',     v: latest.completion_rate, icon: CheckCircle2 },
                  { label: 'الالتزام',    v: latest.sla_rate,        icon: Zap },
                  { label: 'متابعة الغياب', v: latest.followup_rate, icon: Users },
                  { label: 'حل الأعطال',  v: latest.fix_rate,        icon: ShieldAlert },
                ].map((k, i) => (
                  <div key={i} className="bg-white/10 backdrop-blur border border-white/15 rounded-2xl px-3 py-3 text-center">
                    <k.icon size={14} className="mx-auto text-white/70 mb-1" />
                    <p className="text-[10px] text-white/70 font-black mb-1">{k.label}</p>
                    <p className="text-xl font-black">{k.v}<span className="text-xs">%</span></p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-white/10 backdrop-blur border border-white/15 rounded-2xl p-8 text-center">
              <p className="text-lg font-black mb-1">لا توجد بيانات بعد</p>
              <p className="text-sm text-white/70 font-bold">سيظهر تقدمك هنا بمجرد تجميد أول شهر بواسطة الإدارة.</p>
            </div>
          )}

          {latest?.rank_in_dept && (
            <div className="mt-4 flex items-center justify-center gap-2 bg-white/10 backdrop-blur border border-white/15 rounded-2xl py-2">
              <Trophy size={14} className="text-amber-300" />
              <p className="text-sm font-black">المركز <span className="text-amber-300 text-lg">{latest.rank_in_dept}</span> من {latest.total_in_dept} في القسم</p>
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400 text-sm font-bold">جارٍ التحميل...</div>
      ) : !latest ? null : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="نسبة الإنجاز"   value={latest.completion_rate} target={latest.target_completion} deptAvg={latest.dept_avg_completion} color="#10B981" icon={CheckCircle2} />
            <KpiCard label="الالتزام (SLA)" value={latest.sla_rate}        target={null}                     deptAvg={null}                       color="#06B6D4" icon={Zap} />
            <KpiCard label="متابعة الغياب"  value={latest.followup_rate}   target={latest.target_followup}   deptAvg={latest.dept_avg_followup}   color="#F59E0B" icon={Users} />
            <KpiCard label="حل الأعطال"    value={latest.fix_rate}        target={latest.target_fix}        deptAvg={latest.dept_avg_fix}        color="#EC4899" icon={ShieldAlert} />
          </div>

          {/* Personal goals — set by the employee themselves (motivational, not used for met_target) */}
          <PersonalGoalsCard
            personalGoals={data?.personal_goals}
            latest={latest}
            onEdit={() => setEditGoalsOpen(true)}
            onClear={() => {
              if (confirm('هل تريد مسح أهدافك الشخصية؟')) clearM.mutate();
            }}
            deleting={clearM.isPending}
          />

          {/* Chart */}
          {chartData.length > 1 && (
            <div className="bg-white border border-gray-100 rounded-3xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={20} className="text-violet-600" />
                <h3 className="text-base font-black text-gray-800">مساري عبر الشهور</h3>
              </div>
              <div style={{ height: 320 }}>
                <ResponsiveContainer>
                  <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="myScoreGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                    <XAxis dataKey="name" stroke="#9CA3AF" tick={{ fontSize: 11, fontWeight: 700 }} reversed />
                    <YAxis domain={[0, 100]} stroke="#9CA3AF" tick={{ fontSize: 11, fontWeight: 700 }} unit="%" />
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(15, 23, 42, 0.95)',
                        border: 'none', borderRadius: '12px', color: '#fff',
                        fontWeight: 700, fontSize: 12, direction: 'rtl',
                      }}
                      formatter={(v, n) => {
                        const labels = { score: 'أدائي', dept: 'متوسط القسم', target: 'الهدف' };
                        return [`${v}%`, labels[n] || n];
                      }}
                    />
                    <Area type="monotone" dataKey="score" stroke="#8B5CF6" strokeWidth={3} fill="url(#myScoreGrad)" name="score" />
                    <Line type="monotone" dataKey="dept"   stroke="#94A3B8" strokeWidth={2} strokeDasharray="6 4" dot={false} name="dept" />
                    <Line type="monotone" dataKey="target" stroke="#EF4444" strokeWidth={1.5} strokeDasharray="3 3" dot={false} name="target" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-center gap-5 mt-3 text-[10px] font-black text-gray-500">
                <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-violet-500 rounded-full" /> أدائي</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-slate-400" style={{ borderTop: '1px dashed #94A3B8' }} /> متوسط القسم</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-red-400" style={{ borderTop: '1px dashed #EF4444' }} /> الهدف</span>
              </div>
            </div>
          )}

          {/* Achievements */}
          {badgeKeys.length > 0 && (
            <div className="bg-gradient-to-br from-amber-50 via-white to-orange-50 border border-amber-200 rounded-3xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Award size={20} className="text-amber-600" />
                <h3 className="text-base font-black text-gray-800">إنجازاتي</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {badgeKeys.map(key => {
                  const def = BADGE_DEFS[key] || { emoji: '🏷️', label: key };
                  const count = lifetimeBadges[key];
                  return (
                    <div key={key} className="bg-white border border-gray-100 rounded-2xl p-3 text-center hover:shadow-md transition-all">
                      <div className="text-3xl mb-1.5">{def.emoji}</div>
                      <p className="text-xs font-black text-gray-800">{def.label}</p>
                      <p className="text-[10px] font-black text-gray-400 mt-1">×{count}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Months table */}
          <div className="bg-white border border-gray-100 rounded-3xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
              <Calendar size={18} className="text-blue-600" />
              <h3 className="text-base font-black text-gray-800">سجل كل الشهور</h3>
              <span className="text-xs text-gray-400 font-black mr-auto">{snapshots.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50/60 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-right text-[11px] font-black text-gray-500">الشهر</th>
                    <th className="px-3 py-3 text-center text-[11px] font-black text-gray-500">الإنجاز</th>
                    <th className="px-3 py-3 text-center text-[11px] font-black text-gray-500">SLA</th>
                    <th className="px-3 py-3 text-center text-[11px] font-black text-gray-500">المتابعة</th>
                    <th className="px-3 py-3 text-center text-[11px] font-black text-gray-500">الأعطال</th>
                    <th className="px-3 py-3 text-center text-[11px] font-black text-gray-500">العام</th>
                    <th className="px-3 py-3 text-center text-[11px] font-black text-gray-500">المركز</th>
                    <th className="px-3 py-3 text-center text-[11px] font-black text-gray-500">الإنجازات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {snapshots.map(s => (
                    <tr key={s.id} className="hover:bg-gray-50/40">
                      <td className="px-4 py-3 font-black text-gray-800">{MONTH_NAMES_AR[s.month]} {s.year}</td>
                      <td className="px-3 py-3 text-center font-black text-emerald-600">{s.completion_rate}%</td>
                      <td className="px-3 py-3 text-center font-black text-cyan-600">{s.sla_rate}%</td>
                      <td className="px-3 py-3 text-center font-black text-amber-600">{s.followup_rate}%</td>
                      <td className="px-3 py-3 text-center font-black text-pink-600">{s.fix_rate}%</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-black ${
                          s.overall_score >= 85 ? 'bg-emerald-100 text-emerald-700' :
                          s.overall_score >= 70 ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                        }`}>{s.overall_score}%</span>
                      </td>
                      <td className="px-3 py-3 text-center text-xs font-black text-gray-700">
                        {s.rank_in_dept ? `${s.rank_in_dept}/${s.total_in_dept}` : '—'}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex items-center gap-0.5 justify-center">
                          {(s.achievements || []).slice(0, 4).map((b, i) => (
                            <span key={i} title={BADGE_DEFS[b]?.label || b} className="text-base">
                              {BADGE_DEFS[b]?.emoji || '🏷️'}
                            </span>
                          ))}
                          {(s.achievements || []).length > 4 && (
                            <span className="text-[10px] text-gray-400 font-black">+{s.achievements.length - 4}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <EditGoalsModal
        open={editGoalsOpen}
        current={data?.personal_goals}
        onClose={() => setEditGoalsOpen(false)}
        onSaved={() => setEditGoalsOpen(false)}
      />
    </div>
  );
}
