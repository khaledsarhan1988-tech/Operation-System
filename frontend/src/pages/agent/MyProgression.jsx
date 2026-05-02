import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, Trophy, Target, Sparkles, Award, Calendar,
  CheckCircle2, Zap, ShieldAlert, Users, ArrowUp, ArrowDown, Minus,
  Crown, Flame, Gem,
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

export default function MyProgression() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-progression'],
    queryFn: () => api.get('/agent/my-progression').then(r => r.data),
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
    </div>
  );
}
