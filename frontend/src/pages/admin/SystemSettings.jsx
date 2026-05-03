import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings, Sliders, Activity, Building2, Save, AlertTriangle,
  Lock, Trash2, Edit2, MessageSquare, Target, RefreshCw,
  TrendingUp, TrendingDown, Minus, Filter, ChevronDown, ChevronUp,
  Download,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar,
} from 'recharts';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';
import ModernButton from '../../components/ui/ModernButton';

const MONTH_NAMES_AR = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTH_NAMES_AR_SHORT = ['', 'ينا', 'فبر', 'مار', 'أبر', 'مايو', 'يون',
  'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'];

const ACTION_LABELS = {
  freeze:         { label: 'تجميد شهر',     icon: Lock,         color: 'amber'   },
  freeze_bulk:    { label: 'تجميد متعدد',  icon: Lock,         color: 'amber'   },
  overwrite:      { label: 'استبدال',       icon: RefreshCw,    color: 'blue'    },
  delete:         { label: 'حذف',           icon: Trash2,       color: 'rose'    },
  note_add:       { label: 'إضافة ملاحظة',  icon: MessageSquare,color: 'cyan'    },
  note_edit:      { label: 'تعديل ملاحظة',  icon: Edit2,        color: 'indigo'  },
  note_delete:    { label: 'حذف ملاحظة',    icon: Trash2,       color: 'rose'    },
  target_change:  { label: 'تعديل هدف',     icon: Target,       color: 'emerald' },
  weights_change: { label: 'تعديل أوزان',  icon: Sliders,      color: 'violet'  },
};

const DEPT_COLORS = { General: '#3B82F6', Private: '#A855F7', Semi: '#F97316' };

// ─── WEIGHTS TAB ──────────────────────────────────────────────────────────────

function WeightsTab() {
  const qc = useQueryClient();
  const { data: weights, isLoading } = useQuery({
    queryKey: ['kpi-weights'],
    queryFn: () => api.get('/admin/snapshots/weights').then(r => r.data),
  });

  const [c, setC]       = useState(50);
  const [f, setF]       = useState(25);
  const [x, setX]       = useState(25);
  const [s, setS]       = useState(0);
  const [touched, setTouched] = useState(false);

  // Sync from server when first loaded
  useMemo(() => {
    if (weights && !touched) {
      setC(weights.weight_completion ?? 50);
      setF(weights.weight_followup   ?? 25);
      setX(weights.weight_fix        ?? 25);
      setS(weights.weight_sla        ?? 0);
    }
  }, [weights, touched]);

  const sum = c + f + x + s;
  const norm = sum > 0 ? sum : 1;

  const saveM = useMutation({
    mutationFn: () => api.put('/admin/snapshots/weights', {
      weight_completion: c, weight_followup: f, weight_fix: x, weight_sla: s,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kpi-weights'] });
      setTouched(false);
    },
  });

  const sliders = [
    { v: c, set: setC, label: 'الإنجاز (Completion)',     color: '#10B981', icon: '✓' },
    { v: f, set: setF, label: 'متابعة الغياب (Follow-up)', color: '#F59E0B', icon: '👥' },
    { v: x, set: setX, label: 'حل الأعطال (Fix Rate)',    color: '#EC4899', icon: '🔧' },
    { v: s, set: setS, label: 'الالتزام (SLA)',            color: '#06B6D4', icon: '⚡' },
  ];

  return (
    <div className="space-y-5">
      <SectionCard
        title="معادلة الأداء العام (Overall Score)"
        subtitle="حدد وزن كل مؤشر — المجموع يُطبيع تلقائياً إلى 100%"
        icon={Sliders}
        accent="violet"
      >
        {isLoading ? (
          <p className="text-sm text-gray-400 font-bold">جارٍ التحميل...</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              {sliders.map((row, i) => {
                const pct = sum > 0 ? Math.round((row.v / norm) * 100) : 0;
                return (
                  <div key={i} className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-black text-gray-700">
                        <span className="ml-1">{row.icon}</span>
                        {row.label}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-black" style={{ color: row.color }}>{row.v}</span>
                        <span className="text-[10px] font-black text-gray-400 px-2 py-0.5 bg-white rounded-md">≈ {pct}%</span>
                      </div>
                    </div>
                    <input
                      type="range" min="0" max="100"
                      value={row.v}
                      onChange={e => { row.set(+e.target.value); setTouched(true); }}
                      className="w-full"
                      style={{ accentColor: row.color }}
                    />
                    <div className="h-1.5 bg-white rounded-full mt-2 overflow-hidden">
                      <div className="h-full transition-all" style={{ width: `${pct}%`, background: row.color }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Preview */}
            <div className="bg-gradient-to-br from-indigo-50 via-violet-50 to-fuchsia-50 border border-indigo-100 rounded-2xl p-4">
              <p className="text-xs font-black text-indigo-900 mb-2">📐 المعادلة الفعلية:</p>
              <p className="font-mono text-sm font-black text-gray-800 leading-relaxed">
                Overall = <span className="text-emerald-600">{Math.round((c / norm) * 100)}%</span> × Completion +{' '}
                <span className="text-amber-600">{Math.round((f / norm) * 100)}%</span> × Followup +{' '}
                <span className="text-pink-600">{Math.round((x / norm) * 100)}%</span> × Fix +{' '}
                <span className="text-cyan-600">{Math.round((s / norm) * 100)}%</span> × SLA
              </p>
            </div>

            {sum === 0 && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-800 flex items-center gap-2">
                <AlertTriangle size={14} /> يجب أن يكون مجموع الأوزان أكبر من صفر.
              </div>
            )}

            <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-100 flex-wrap gap-2">
              <p className="text-xs text-gray-500 font-bold">
                ⚠️ التعديل سيُطبَّق على الـ snapshots الجديدة فقط — القديمة محفوظة بالأوزان وقت تجميدها.
              </p>
              <div className="flex items-center gap-2">
                {touched && (
                  <ModernButton
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setC(weights?.weight_completion ?? 50);
                      setF(weights?.weight_followup   ?? 25);
                      setX(weights?.weight_fix        ?? 25);
                      setS(weights?.weight_sla        ?? 0);
                      setTouched(false);
                    }}
                  >
                    إلغاء
                  </ModernButton>
                )}
                <ModernButton
                  variant="primary"
                  icon={Save}
                  onClick={() => saveM.mutate()}
                  disabled={!touched || sum === 0}
                  loading={saveM.isPending}
                >
                  حفظ الأوزان
                </ModernButton>
              </div>
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}

// ─── AUDIT LOG TAB ────────────────────────────────────────────────────────────

function AuditTab() {
  const [action, setAction] = useState('');
  const [from, setFrom]     = useState('');
  const [to, setTo]         = useState('');
  const [expanded, setExpanded] = useState(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', action, from, to],
    queryFn: () => api.get('/admin/snapshots/audit', {
      params: {
        action: action || undefined,
        from: from || undefined,
        to: to || undefined,
        limit: 200,
      },
    }).then(r => r.data),
  });

  const toggle = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const inputCls = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30';

  return (
    <div className="space-y-4">
      <SectionCard
        title="سجل عمليات النظام"
        subtitle={`${data?.total || 0} عملية مسجّلة`}
        icon={Activity}
        accent="indigo"
        actions={
          <ModernButton
            variant="secondary"
            size="sm"
            icon={Download}
            onClick={async () => {
              try {
                const r = await api.get('/admin/snapshots/audit/export', {
                  params: {
                    action: action || undefined,
                    from:   from   || undefined,
                    to:     to     || undefined,
                  },
                  responseType: 'blob',
                });
                const blobUrl = URL.createObjectURL(r.data);
                const link = document.createElement('a');
                link.href = blobUrl;
                link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
                link.click();
                URL.revokeObjectURL(blobUrl);
              } catch (e) {
                alert('تعذّر تنزيل السجل: ' + (e.response?.data?.error || e.message));
              }
            }}
          >
            تنزيل CSV
          </ModernButton>
        }
      >
        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap mb-4 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-1.5">
            <Filter size={13} className="text-gray-400" />
            <select value={action} onChange={e => setAction(e.target.value)} className={inputCls}>
              <option value="">كل العمليات</option>
              {Object.entries(ACTION_LABELS).map(([k, def]) => (
                <option key={k} value={k}>{def.label}</option>
              ))}
            </select>
          </div>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
          <span className="text-xs text-gray-400">←</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
        </div>

        {/* List */}
        {isLoading ? (
          <p className="text-sm text-gray-400 font-bold text-center py-6">جارٍ التحميل...</p>
        ) : !data?.rows?.length ? (
          <EmptyState
            icon={Activity}
            accent="gray"
            title="لا توجد سجلات"
            message="غيّر الفلاتر أو ابدأ في تجميد شهور لتظهر العمليات هنا."
          />
        ) : (
          <div className="space-y-2">
            {data.rows.map(r => {
              const def = ACTION_LABELS[r.action] || { label: r.action, icon: Activity, color: 'gray' };
              const Icon = def.icon;
              const isOpen = expanded.has(r.id);
              return (
                <div key={r.id} className="bg-gray-50 border border-gray-100 rounded-2xl overflow-hidden">
                  <button onClick={() => toggle(r.id)} className="w-full flex items-center gap-3 p-3 text-right hover:bg-gray-100/50 transition-colors">
                    <div className={`p-1.5 rounded-lg bg-${def.color}-100 text-${def.color}-600`}>
                      <Icon size={14} strokeWidth={2.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-gray-800">
                        {def.label}
                        {r.year && r.month && (
                          <span className="text-xs text-gray-500 mr-2 font-bold">
                            — {MONTH_NAMES_AR[r.month]} {r.year}
                          </span>
                        )}
                        {r.agent_name && (
                          <span className="text-xs text-gray-500 mr-2 font-bold">· {r.agent_name}</span>
                        )}
                      </p>
                      <p className="text-[10px] text-gray-400 font-bold">
                        {r.user_name || 'النظام'} · {new Date(r.created_at).toLocaleString('ar-EG')}
                      </p>
                    </div>
                    {r.details && (
                      isOpen ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />
                    )}
                  </button>
                  {isOpen && r.details && (
                    <div className="px-3 pb-3 bg-white border-t border-gray-100">
                      <pre className="text-[10px] text-gray-700 font-mono bg-gray-50 p-2 rounded-lg overflow-x-auto mt-2 leading-relaxed" dir="ltr">
                        {JSON.stringify(r.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── DEPARTMENT ROLLUP TAB ────────────────────────────────────────────────────

function DeptRollupTab() {
  const today = new Date();
  const [fromYear, setFromYear]   = useState(today.getFullYear());
  const [fromMonth, setFromMonth] = useState(Math.max(1, today.getMonth() - 5));
  const [toYear, setToYear]       = useState(today.getFullYear());
  const [toMonth, setToMonth]     = useState(today.getMonth() + 1);

  const { data, isLoading } = useQuery({
    queryKey: ['dept-rollup', fromYear, fromMonth, toYear, toMonth],
    queryFn: () => api.get('/admin/snapshots/dept-rollup', {
      params: { from_year: fromYear, from_month: fromMonth, to_year: toYear, to_month: toMonth },
    }).then(r => r.data),
  });

  // Build chart data
  const chartData = useMemo(() => {
    if (!data?.periods) return [];
    return data.periods.map(p => {
      const row = { name: `${MONTH_NAMES_AR_SHORT[p.month]} ${String(p.year).slice(2)}` };
      data.departments.forEach(d => {
        row[d.department] = d.cells[p.label]?.avg_overall ?? null;
      });
      return row;
    });
  }, [data]);

  // Bar data: total tasks per dept
  const barData = useMemo(() => {
    if (!data?.departments) return [];
    return data.departments.map(d => {
      const allCells = Object.values(d.cells);
      return {
        name: d.department,
        Done: allCells.reduce((s, c) => s + (c.total_done || 0), 0),
        Pending: allCells.reduce((s, c) => s + ((c.total_tasks || 0) - (c.total_done || 0)), 0),
      };
    });
  }, [data]);

  return (
    <div className="space-y-5">
      {/* Period filters */}
      <SectionCard title="الفترة الزمنية" icon={Filter} accent="cyan">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-black text-gray-500">من</span>
          <select value={fromYear} onChange={e => setFromYear(+e.target.value)} className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30">
            {[today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={fromMonth} onChange={e => setFromMonth(+e.target.value)} className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{MONTH_NAMES_AR[m]}</option>)}
          </select>

          <span className="text-xs font-black text-gray-500 mr-3">إلى</span>
          <select value={toYear} onChange={e => setToYear(+e.target.value)} className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30">
            {[today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={toMonth} onChange={e => setToMonth(+e.target.value)} className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{MONTH_NAMES_AR[m]}</option>)}
          </select>
        </div>
      </SectionCard>

      {/* Department comparison cards */}
      {!isLoading && data?.departments?.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {data.departments.map(d => {
            const color = DEPT_COLORS[d.department] || '#64748B';
            return (
              <div key={d.department}
                   className="rounded-3xl p-5 border-2 transition-all hover:-translate-y-0.5 hover:shadow-lg"
                   style={{ borderColor: `${color}30`, background: `linear-gradient(135deg, ${color}08, white 50%)` }}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-black text-gray-800 text-base">{d.department}</h3>
                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-black" style={{ background: `${color}15`, color }}>
                    {d.total_agents} موظف
                  </span>
                </div>
                <p className="text-3xl font-black mb-1" style={{ color }}>
                  {d.avg_overall}<span className="text-base">%</span>
                </p>
                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">متوسط الأداء</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Chart */}
      <SectionCard title="تطوّر متوسط الأقسام" subtitle="مقارنة الأقسام عبر الفترة المحددة" icon={TrendingUp} accent="indigo">
        {isLoading ? (
          <p className="text-sm text-gray-400 font-bold text-center py-8">جارٍ التحميل...</p>
        ) : !chartData.length ? (
          <EmptyState icon={TrendingUp} accent="gray" title="لا توجد بيانات" message="جمّد بعض الشهور لتظهر مقارنة الأقسام هنا." />
        ) : (
          <div style={{ height: 300 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="name" stroke="#9CA3AF" tick={{ fontSize: 11, fontWeight: 700 }} reversed />
                <YAxis domain={[0, 100]} stroke="#9CA3AF" tick={{ fontSize: 11, fontWeight: 700 }} unit="%" />
                <Tooltip
                  contentStyle={{ background: 'rgba(15, 23, 42, 0.95)', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 700, fontSize: 12 }}
                  formatter={(v) => [`${v}%`]}
                />
                <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
                {data.departments.map(d => (
                  <Line
                    key={d.department}
                    type="monotone"
                    dataKey={d.department}
                    stroke={DEPT_COLORS[d.department] || '#64748B'}
                    strokeWidth={2.5}
                    dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                    activeDot={{ r: 6 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      {/* Bar chart: tasks done */}
      {!isLoading && barData.length > 0 && (
        <SectionCard title="إجمالي المهام منجزة vs قيد التنفيذ" icon={Building2} accent="emerald">
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={barData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="name" stroke="#9CA3AF" tick={{ fontSize: 11, fontWeight: 700 }} />
                <YAxis stroke="#9CA3AF" tick={{ fontSize: 11, fontWeight: 700 }} />
                <Tooltip contentStyle={{ background: 'rgba(15, 23, 42, 0.95)', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 700, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
                <Bar dataKey="Done" fill="#10B981" radius={[8, 8, 0, 0]} />
                <Bar dataKey="Pending" fill="#F59E0B" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function SystemSettings() {
  const [tab, setTab] = useState('weights');

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="إعدادات النظام"
        subtitle="معادلة الأداء، سجل العمليات، ومقارنة الأقسام"
        icon={Settings}
        gradient="slate"
      />

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'weights',    label: 'معادلة الأداء',    icon: Sliders },
          { key: 'audit',      label: 'سجل العمليات',     icon: Activity },
          { key: 'dept',       label: 'مقارنة الأقسام',   icon: Building2 },
        ].map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black transition-all border ${
                active
                  ? 'bg-[#1e3a5f] text-white border-[#1e3a5f] shadow-lg shadow-[#1e3a5f]/30'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-[#1e3a5f] hover:text-[#1e3a5f]'
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'weights' && <WeightsTab />}
      {tab === 'audit'   && <AuditTab />}
      {tab === 'dept'    && <DeptRollupTab />}
    </div>
  );
}
