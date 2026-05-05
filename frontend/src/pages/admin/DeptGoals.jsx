import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Target, Calendar, Layers, Plus, Save, Trash2, Award, AlertTriangle,
  CheckCircle, XCircle, Clock, TrendingDown, History as HistoryIcon, BarChart3,
  Activity, X, Pin, Zap,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, BarChart, Bar,
} from 'recharts';
import api from '../../api/axios';
import { useAuth } from '../../auth/AuthContext';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';
import ModernButton from '../../components/ui/ModernButton';

const DEPTS = ['General', 'Private', 'Semi'];
const DEPT_COLORS = {
  General: { bg: 'bg-blue-50',   bd: 'border-blue-200',   fg: 'text-blue-700',   chip: 'bg-blue-100 text-blue-700',     header: 'from-sky-500 to-blue-600' },
  Private: { bg: 'bg-violet-50', bd: 'border-violet-200', fg: 'text-violet-700', chip: 'bg-violet-100 text-violet-700', header: 'from-violet-500 to-fuchsia-600' },
  Semi:    { bg: 'bg-orange-50', bd: 'border-orange-200', fg: 'text-orange-700', chip: 'bg-orange-100 text-orange-700', header: 'from-orange-500 to-amber-600' },
};

export default function DeptGoals() {
  const { user } = useAuth();
  // Only admins from the Quality (or All) management can create goals + delete.
  // Everyone else (CS/Education admins, leaders) gets a view-only experience.
  const canManage = user?.role === 'admin' && (user?.management === 'Quality' || user?.management === 'All');

  const tabs = [
    { key: 'active',  label: 'الأهداف الحالية', icon: Activity },
    canManage && { key: 'set', label: 'وضع هدف جديد', icon: Plus },
    { key: 'history', label: 'السجل والتطور',  icon: HistoryIcon },
  ].filter(Boolean);

  const [tab, setTab] = useState('active'); // active | set | history

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="أهداف الجودة للأقسام"
        subtitle="حدد أهداف تقليل الغياب لكل قسم وتابع تنفيذها"
        icon={Target}
        gradient="emerald"
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-black transition ${
              tab === t.key ? 'bg-emerald-600 text-white shadow' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'active'  && <ActiveGoalsTab canManage={canManage} />}
      {tab === 'set'     && canManage && <SetGoalTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 1: ACTIVE GOALS — current goals with live progress
// ═════════════════════════════════════════════════════════════════════════════
function ActiveGoalsTab({ canManage }) {
  const queryClient = useQueryClient();
  const { data: active = [], isLoading } = useQuery({
    queryKey: ['dept-goals', 'active'],
    queryFn: () => api.get('/dept-goals', { params: { mode: 'active' } }).then(r => r.data),
    staleTime: 30_000,
  });

  const evalMu = useMutation({
    mutationFn: (id) => api.post(`/dept-goals/${id}/evaluate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dept-goals'] });
    },
    onError: (err) => {
      const errorBody = err?.response?.data;
      if (errorBody?.error === 'snapshot_required') {
        alert(errorBody.message);
      } else {
        alert('فشل التقييم: ' + (errorBody?.error || err?.message || 'خطأ غير معروف'));
      }
    },
  });

  const delMu = useMutation({
    mutationFn: (id) => api.delete(`/dept-goals/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dept-goals'] }),
  });

  const handleEvaluate = (g) => {
    if (window.confirm(`متأكد عاوز تقفل تقييم هدف ${g.dept_type} لـ ${g.period_label}؟ هيتم حساب النتيجة النهائية وتوزيع المكافأة لو الهدف اتحقق.`)) {
      evalMu.mutate(g.id);
    }
  };

  const handleDelete = (g) => {
    if (window.confirm(`متأكد عاوز تمسح هدف ${g.dept_type} لـ ${g.period_label}؟`)) {
      delMu.mutate(g.id);
    }
  };

  if (isLoading) return <p className="text-center py-12 text-gray-400 text-sm font-bold">جارى التحميل...</p>;
  if (active.length === 0) {
    return (
      <EmptyState
        icon={Target}
        accent="emerald"
        title="لا توجد أهداف فعّالة حالياً"
        message='اضغط على "وضع هدف جديد" لتحديد أول هدف'
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {active.map(g => (
        <ActiveGoalCard
          key={g.id}
          goal={g}
          onEvaluate={() => handleEvaluate(g)}
          onDelete={() => handleDelete(g)}
          busy={evalMu.isPending || delMu.isPending}
          canManage={canManage}
        />
      ))}
    </div>
  );
}

function ActiveGoalCard({ goal, onEvaluate, onDelete, busy, canManage }) {
  const c = DEPT_COLORS[goal.dept_type] || DEPT_COLORS.General;
  const periodOver = goal.days_remaining < 0;

  return (
    <div className={`bg-white border ${c.bd} rounded-2xl shadow-sm overflow-hidden`}>
      {/* Header — colored by department for at-a-glance distinction */}
      <div className={`bg-gradient-to-l ${c.header} text-white px-4 py-3 flex items-center gap-2`}>
        <Target size={16} />
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm font-black">
            {goal.dept_type}
            <span className="text-[10px] opacity-90 bg-white/20 px-2 py-0.5 rounded">
              {goal.period_type === 'weekly' ? 'أسبوعى' : goal.period_type === 'monthly' ? 'شهرى' : 'ربع سنوى'}
            </span>
          </div>
          <div className="text-[11px] opacity-90 font-bold">{goal.period_label}</div>
        </div>
        <div className="text-[11px] font-black">
          {periodOver
            ? <span className="bg-white/15 px-2 py-1 rounded">انتهى</span>
            : goal.days_remaining === 0
              ? <span className="bg-white/15 px-2 py-1 rounded">اليوم آخر يوم</span>
              : <span className="bg-white/15 px-2 py-1 rounded">{goal.days_remaining} يوم متبقى</span>
          }
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Main absent */}
        <ProgressRow
          label="غياب أساسى"
          baseline={goal.baseline_main_absent_rate}
          actual={goal.actual_main_absent_rate ?? 0}
          target={goal.target_main_absent_rate}
          actualCount={goal.actual_main_absent_count}
          actualExpected={goal.actual_main_expected}
        />
        {/* Zoom absent */}
        <ProgressRow
          label="غياب زووم"
          baseline={goal.baseline_zoom_absent_rate}
          actual={goal.actual_zoom_absent_rate ?? 0}
          target={goal.target_zoom_absent_rate}
          actualCount={goal.actual_zoom_absent_count}
          actualExpected={goal.actual_zoom_expected}
        />

        {/* Status pill */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <StatusPill status={goal.live_status} />
          <span className="text-[10px] text-gray-500 font-bold">
            بواسطة {goal.created_by_name || '—'} · مكافأة {goal.bonus_points} نقاط
          </span>
        </div>

        {goal.notes && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[11px] text-amber-800">
            {goal.notes}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="bg-gray-50 border-t border-gray-100 px-3 py-2 flex justify-end gap-2">
        {canManage && (
          <ModernButton variant="ghost" icon={Trash2} size="sm" onClick={onDelete} disabled={busy}>مسح</ModernButton>
        )}
        <ModernButton variant="primary" icon={Award} size="sm" onClick={onEvaluate} disabled={busy || !periodOver}>
          {periodOver ? 'تقييم نهائى' : 'لسه فعّال'}
        </ModernButton>
      </div>
    </div>
  );
}

function ProgressRow({ label, baseline, actual, target, actualCount, actualExpected }) {
  // Position percent on a 0..baseline scale (improvement direction = lower = better)
  // We map baseline at 0% (start), target at 100% (goal)
  // Below target is "exceeded" (great); above baseline is "regressed" (bad)
  const range = baseline - target;
  let progress = 0;
  if (range > 0) {
    progress = Math.max(0, Math.min(100, ((baseline - actual) / range) * 100));
  } else {
    progress = actual <= target ? 100 : 0;
  }
  const reached = actual <= target;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-black text-gray-700">{label}</span>
        <div className="flex items-center gap-2 text-[11px] font-bold">
          <span className="text-gray-500">قاعدى: <span className="text-gray-700">{baseline}%</span></span>
          <span className="text-emerald-600">هدف: <span className="font-black">{target}%</span></span>
        </div>
      </div>

      {/* Bar */}
      <div className="relative h-7 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
        <div
          className={`h-full transition-all ${reached ? 'bg-emerald-500' : progress > 0 ? 'bg-amber-500' : 'bg-rose-500'}`}
          style={{ width: `${Math.max(2, progress)}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-xs font-black ${progress > 30 ? 'text-white' : 'text-gray-700'}`}>
            الفعلى: {actual}%
            {(actualCount != null && actualExpected != null) && (
              <span className="ms-1 text-[10px] opacity-90 font-mono">({actualCount}/{actualExpected})</span>
            )}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between mt-1 text-[10px] font-bold text-gray-500">
        <span>تحسن مطلوب: {Math.max(0, baseline - target)} نقطة</span>
        <span className={reached ? 'text-emerald-600' : 'text-amber-600'}>
          {reached ? '✓ تم تحقيقه' : `${Math.max(0, actual - target)} نقطة باقية`}
        </span>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    met:     { bg: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle, label: 'متحقق ✓' },
    missed:  { bg: 'bg-rose-100 text-rose-700 border-rose-200', icon: XCircle,    label: 'غير متحقق' },
    partial: { bg: 'bg-amber-100 text-amber-700 border-amber-200', icon: AlertTriangle, label: 'جزئى' },
    active:  { bg: 'bg-blue-100 text-blue-700 border-blue-200',     icon: Clock,       label: 'فعّال' },
  };
  const m = map[status] || map.active;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-black ${m.bg}`}>
      <Icon size={12} /> {m.label}
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 2: SET GOAL — admin form
// ═════════════════════════════════════════════════════════════════════════════
function SetGoalTab() {
  const queryClient = useQueryClient();
  const now = new Date();
  const [periodType, setPeriodType] = useState('monthly');
  const [year, setYear]     = useState(now.getUTCFullYear());
  const [month, setMonth]   = useState(now.getUTCMonth() + 1);
  const [week, setWeek]     = useState(getISOWeek(now));
  const [quarter, setQuarter] = useState(Math.floor(now.getUTCMonth() / 3) + 1);

  const [goals, setGoals] = useState({
    General: { target_main: '', target_zoom: '', bonus_points: 5, notes: '' },
    Private: { target_main: '', target_zoom: '', bonus_points: 5, notes: '' },
    Semi:    { target_main: '', target_zoom: '', bonus_points: 5, notes: '' },
  });

  // Fetch baselines for all 3 depts in parallel — explicit hooks (no .map)
  const baselineParams = {
    period_type: periodType,
    year,
    month: periodType === 'monthly' ? month : undefined,
    week:  periodType === 'weekly' ? week : undefined,
    quarter: periodType === 'quarterly' ? quarter : undefined,
  };
  const baselineGeneral = useQuery({
    queryKey: ['dept-goal-baseline', 'General', baselineParams],
    queryFn: () => api.get('/dept-goals/baseline', { params: { dept_type: 'General', ...baselineParams } }).then(r => r.data),
    staleTime: 60_000,
  });
  const baselinePrivate = useQuery({
    queryKey: ['dept-goal-baseline', 'Private', baselineParams],
    queryFn: () => api.get('/dept-goals/baseline', { params: { dept_type: 'Private', ...baselineParams } }).then(r => r.data),
    staleTime: 60_000,
  });
  const baselineSemi = useQuery({
    queryKey: ['dept-goal-baseline', 'Semi', baselineParams],
    queryFn: () => api.get('/dept-goals/baseline', { params: { dept_type: 'Semi', ...baselineParams } }).then(r => r.data),
    staleTime: 60_000,
  });
  const baselineQueries = [baselineGeneral, baselinePrivate, baselineSemi];

  const saveMu = useMutation({
    mutationFn: (payload) => api.post('/dept-goals', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dept-goals'] });
    },
  });

  const handleSave = async () => {
    const payloads = DEPTS.filter(d =>
      goals[d].target_main !== '' && goals[d].target_zoom !== ''
    ).map(d => ({
      dept_type: d,
      period_type: periodType,
      year,
      month: periodType === 'monthly' ? month : undefined,
      week:  periodType === 'weekly' ? week : undefined,
      quarter: periodType === 'quarterly' ? quarter : undefined,
      target_main_absent_rate: parseInt(goals[d].target_main, 10),
      target_zoom_absent_rate: parseInt(goals[d].target_zoom, 10),
      bonus_points: parseInt(goals[d].bonus_points, 10) || 5,
      notes: goals[d].notes,
    }));

    if (payloads.length === 0) {
      alert('املأ هدف واحد على الأقل');
      return;
    }

    try {
      for (const p of payloads) {
        await saveMu.mutateAsync(p);
      }
      alert(`تم حفظ ${payloads.length} هدف بنجاح ✓`);
      // Reset form
      setGoals({
        General: { target_main: '', target_zoom: '', bonus_points: 5, notes: '' },
        Private: { target_main: '', target_zoom: '', bonus_points: 5, notes: '' },
        Semi:    { target_main: '', target_zoom: '', bonus_points: 5, notes: '' },
      });
    } catch (e) {
      alert('فشل الحفظ: ' + (e?.response?.data?.error || e.message));
    }
  };

  const inputCls = 'w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500';

  return (
    <div className="space-y-5">
      {/* Period selector */}
      <SectionCard title="اختر الفترة" icon={Calendar} accent="emerald">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="text-xs font-black text-gray-500 mb-1 block">نوع الفترة</label>
            <select value={periodType} onChange={e => setPeriodType(e.target.value)} className={inputCls}>
              <option value="weekly">أسبوعى</option>
              <option value="monthly">شهرى</option>
              <option value="quarterly">ربع سنوى</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-black text-gray-500 mb-1 block">السنة</label>
            <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value || now.getUTCFullYear(), 10))}
                   min={2024} max={2030} className={inputCls} />
          </div>
          {periodType === 'monthly' && (
            <div>
              <label className="text-xs font-black text-gray-500 mb-1 block">الشهر</label>
              <select value={month} onChange={e => setMonth(parseInt(e.target.value, 10))} className={inputCls}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m =>
                  <option key={m} value={m}>{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]}</option>
                )}
              </select>
            </div>
          )}
          {periodType === 'weekly' && (
            <div>
              <label className="text-xs font-black text-gray-500 mb-1 block">الأسبوع</label>
              <input type="number" value={week} onChange={e => setWeek(parseInt(e.target.value || 1, 10))}
                     min={1} max={53} className={inputCls} />
            </div>
          )}
          {periodType === 'quarterly' && (
            <div>
              <label className="text-xs font-black text-gray-500 mb-1 block">الربع</label>
              <select value={quarter} onChange={e => setQuarter(parseInt(e.target.value, 10))} className={inputCls}>
                <option value={1}>Q1 (Jan-Mar)</option>
                <option value={2}>Q2 (Apr-Jun)</option>
                <option value={3}>Q3 (Jul-Sep)</option>
                <option value={4}>Q4 (Oct-Dec)</option>
              </select>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Per-department goal forms */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {DEPTS.map((dept, i) => {
          const baseline = baselineQueries[i]?.data;
          const c = DEPT_COLORS[dept];
          const isFromSnapshot = baseline?.source === 'snapshot';
          return (
            <div key={dept} className={`bg-white border ${c.bd} rounded-2xl shadow-sm overflow-hidden`}>
              <div className={`${c.bg} px-4 py-3 border-b ${c.bd}`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h3 className={`text-sm font-black ${c.fg}`}>{dept}</h3>
                  {baseline && (
                    isFromSnapshot
                      ? <span className="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
                          <Pin size={10} /> Official
                        </span>
                      : <span className="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200" title={baseline?.warning}>
                          <Zap size={10} /> Live
                        </span>
                  )}
                </div>
                {baseline && (
                  <>
                    <p className="text-[10px] text-gray-600 font-bold">
                      قاعدى ({baseline.period_label}): غياب {baseline.main_rate}% / زووم {baseline.zoom_rate}%
                    </p>
                    {isFromSnapshot && baseline.snapshot_label && (
                      <p className="text-[10px] text-emerald-700 font-bold mt-0.5 truncate" title={baseline.snapshot_label}>
                        📸 {baseline.snapshot_label}
                      </p>
                    )}
                    {!isFromSnapshot && baseline.warning && (
                      <p className="text-[10px] text-amber-700 font-bold mt-0.5">
                        ⚠ بيانات live (مفيش snapshot رسمى)
                      </p>
                    )}
                  </>
                )}
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-xs font-black text-gray-600 mb-1 block">هدف غياب أساسى (%)</label>
                  <input type="number" min="0" max="100"
                         value={goals[dept].target_main}
                         placeholder={baseline ? `أقل من ${baseline.main_rate}` : '—'}
                         onChange={e => setGoals({...goals, [dept]: {...goals[dept], target_main: e.target.value}})}
                         className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-black text-gray-600 mb-1 block">هدف غياب زووم (%)</label>
                  <input type="number" min="0" max="100"
                         value={goals[dept].target_zoom}
                         placeholder={baseline ? `أقل من ${baseline.zoom_rate}` : '—'}
                         onChange={e => setGoals({...goals, [dept]: {...goals[dept], target_zoom: e.target.value}})}
                         className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-black text-gray-600 mb-1 block">نقاط مكافأة</label>
                  <input type="number" min="0" max="50"
                         value={goals[dept].bonus_points}
                         onChange={e => setGoals({...goals, [dept]: {...goals[dept], bonus_points: e.target.value}})}
                         className={inputCls} />
                  <p className="text-[10px] text-gray-500 mt-1">
                    تنضاف لـ overall_score لكل موظف فى القسم لو تحقق الهدف (شهرى فقط)
                  </p>
                </div>
                <div>
                  <label className="text-xs font-black text-gray-600 mb-1 block">ملاحظات (اختيارى)</label>
                  <textarea rows={2}
                            value={goals[dept].notes}
                            onChange={e => setGoals({...goals, [dept]: {...goals[dept], notes: e.target.value}})}
                            className={`${inputCls} resize-none`} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <ModernButton variant="primary" icon={Save} onClick={handleSave} disabled={saveMu.isPending}>
          {saveMu.isPending ? 'جارى الحفظ...' : 'حفظ الأهداف'}
        </ModernButton>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 3: HISTORY — past goals + month-over-month chart
// ═════════════════════════════════════════════════════════════════════════════
function HistoryTab() {
  const [filterDept, setFilterDept] = useState('All');
  const [filterPeriod, setFilterPeriod] = useState('monthly');

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['dept-goals', 'history', filterDept, filterPeriod],
    queryFn: () => api.get('/dept-goals/history', {
      params: {
        dept_type:   filterDept !== 'All' ? filterDept : undefined,
        period_type: filterPeriod,
      },
    }).then(r => r.data),
    staleTime: 30_000,
  });

  // Build chart data — group by period_label
  const chartData = useMemo(() => {
    const map = new Map();
    history.forEach(g => {
      if (!map.has(g.period_label)) map.set(g.period_label, { period: g.period_label });
      const row = map.get(g.period_label);
      row[`${g.dept_type}_main_actual`] = g.actual_main_absent_rate;
      row[`${g.dept_type}_main_target`] = g.target_main_absent_rate;
      row[`${g.dept_type}_zoom_actual`] = g.actual_zoom_absent_rate;
      row[`${g.dept_type}_zoom_target`] = g.target_zoom_absent_rate;
    });
    return Array.from(map.values());
  }, [history]);

  const summary = useMemo(() => {
    const total = history.length;
    const met = history.filter(g => g.status === 'met').length;
    const missed = history.filter(g => g.status === 'missed').length;
    const partial = history.filter(g => g.status === 'partial').length;
    return { total, met, missed, partial, success_rate: total > 0 ? Math.round((met / total) * 100) : 0 };
  }, [history]);

  const inputCls = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500';

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3 flex-wrap shadow-sm">
        <span className="text-xs font-black text-gray-700">فلتر:</span>
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className={inputCls}>
          <option value="All">كل الأقسام</option>
          {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)} className={inputCls}>
          <option value="monthly">شهرى</option>
          <option value="weekly">أسبوعى</option>
          <option value="quarterly">ربع سنوى</option>
        </select>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'إجمالى الأهداف',   value: summary.total,        icon: Target,      tone: 'gray' },
          { label: 'تحققت ✓',          value: summary.met,          icon: CheckCircle, tone: 'emerald' },
          { label: 'فشلت ✗',           value: summary.missed,       icon: XCircle,     tone: 'rose' },
          { label: 'جزئى ⚠',           value: summary.partial,      icon: AlertTriangle, tone: 'amber' },
          { label: 'نسبة النجاح %',    value: `${summary.success_rate}%`, icon: BarChart3,  tone: 'blue' },
        ].map((s, i) => (
          <div key={i} className={`bg-white border border-${s.tone}-200 rounded-2xl p-4 text-center shadow-sm`}>
            <s.icon size={20} className={`mx-auto text-${s.tone}-500 mb-1`} />
            <div className={`text-2xl font-black text-${s.tone}-700`}>{s.value}</div>
            <div className="text-[10px] font-bold text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <p className="text-center py-12 text-gray-400 text-sm font-bold">جارى التحميل...</p>
      ) : history.length === 0 ? (
        <EmptyState icon={HistoryIcon} accent="gray" title="لا يوجد سجل" message="لسه مفيش أهداف اتقيمت" />
      ) : (
        <>
          {/* Trend chart — main absence */}
          {chartData.length > 0 && (
            <SectionCard title="تطور غياب الأساسى عبر الأوقات (الفعلى vs الهدف)" icon={TrendingDown} accent="rose">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Line type="monotone" dataKey="General_main_actual" stroke="#1e40af" strokeWidth={2} name="General فعلى" />
                    <Line type="monotone" dataKey="General_main_target" stroke="#1e40af" strokeWidth={1} strokeDasharray="5 5" name="General هدف" />
                    <Line type="monotone" dataKey="Private_main_actual" stroke="#6b21a8" strokeWidth={2} name="Private فعلى" />
                    <Line type="monotone" dataKey="Private_main_target" stroke="#6b21a8" strokeWidth={1} strokeDasharray="5 5" name="Private هدف" />
                    <Line type="monotone" dataKey="Semi_main_actual" stroke="#9a3412" strokeWidth={2} name="Semi فعلى" />
                    <Line type="monotone" dataKey="Semi_main_target" stroke="#9a3412" strokeWidth={1} strokeDasharray="5 5" name="Semi هدف" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          )}

          {/* Trend chart — zoom absence */}
          {chartData.length > 0 && (
            <SectionCard title="تطور غياب الزووم عبر الأوقات (الفعلى vs الهدف)" icon={TrendingDown} accent="violet">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Line type="monotone" dataKey="General_zoom_actual" stroke="#1e40af" strokeWidth={2} name="General فعلى" />
                    <Line type="monotone" dataKey="General_zoom_target" stroke="#1e40af" strokeWidth={1} strokeDasharray="5 5" name="General هدف" />
                    <Line type="monotone" dataKey="Private_zoom_actual" stroke="#6b21a8" strokeWidth={2} name="Private فعلى" />
                    <Line type="monotone" dataKey="Private_zoom_target" stroke="#6b21a8" strokeWidth={1} strokeDasharray="5 5" name="Private هدف" />
                    <Line type="monotone" dataKey="Semi_zoom_actual" stroke="#9a3412" strokeWidth={2} name="Semi فعلى" />
                    <Line type="monotone" dataKey="Semi_zoom_target" stroke="#9a3412" strokeWidth={1} strokeDasharray="5 5" name="Semi هدف" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          )}

          {/* History table */}
          <SectionCard title="سجل الأهداف" icon={HistoryIcon} accent="emerald" noBodyPad>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-gray-50/60 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-xs font-black text-gray-500">القسم</th>
                    <th className="px-4 py-2 text-xs font-black text-gray-500">الفترة</th>
                    <th className="px-4 py-2 text-xs font-black text-gray-500">قاعدى أساسى</th>
                    <th className="px-4 py-2 text-xs font-black text-gray-500">هدف أساسى</th>
                    <th className="px-4 py-2 text-xs font-black text-gray-500">فعلى أساسى</th>
                    <th className="px-4 py-2 text-xs font-black text-gray-500">قاعدى زووم</th>
                    <th className="px-4 py-2 text-xs font-black text-gray-500">هدف زووم</th>
                    <th className="px-4 py-2 text-xs font-black text-gray-500">فعلى زووم</th>
                    <th className="px-4 py-2 text-xs font-black text-gray-500">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.map(g => {
                    const c = DEPT_COLORS[g.dept_type] || DEPT_COLORS.General;
                    return (
                      <tr key={g.id} className="hover:bg-gray-50/40">
                        <td className="px-4 py-2"><span className={`inline-flex px-2 py-0.5 rounded-md font-black text-xs ${c.chip}`}>{g.dept_type}</span></td>
                        <td className="px-4 py-2 font-bold">{g.period_label}</td>
                        <td className="px-4 py-2 text-gray-600">{g.baseline_main_absent_rate}%</td>
                        <td className="px-4 py-2 text-emerald-700 font-bold">{g.target_main_absent_rate}%</td>
                        <td className={`px-4 py-2 font-black ${g.actual_main_absent_rate <= g.target_main_absent_rate ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {g.actual_main_absent_rate}%
                        </td>
                        <td className="px-4 py-2 text-gray-600">{g.baseline_zoom_absent_rate}%</td>
                        <td className="px-4 py-2 text-emerald-700 font-bold">{g.target_zoom_absent_rate}%</td>
                        <td className={`px-4 py-2 font-black ${g.actual_zoom_absent_rate <= g.target_zoom_absent_rate ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {g.actual_zoom_absent_rate}%
                        </td>
                        <td className="px-4 py-2"><StatusPill status={g.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════
function getISOWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}
