import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Target, Plus, X, Edit2, Trash2, User, Building2, Globe,
  Calendar, TrendingUp, Save, AlertTriangle, Trophy,
  Activity, History as HistoryIcon, BarChart3, Award,
  CheckCircle, XCircle, Clock,
} from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../auth/AuthContext';
import GoalFormModal from '../../components/custom-goals/GoalFormModal';
import CustomGoalCard from '../../components/custom-goals/CustomGoalCard';

const DEPTS = ['General', 'Private', 'Semi'];

const SCOPE_DEFS = {
  agent:      { label: 'موظف محدد',  icon: User,      color: 'violet'  },
  department: { label: 'قسم كامل',   icon: Building2, color: 'blue'    },
  global:     { label: 'عام (الكل)', icon: Globe,     color: 'emerald' },
};

function ScopeBadge({ scope }) {
  const def = SCOPE_DEFS[scope] || SCOPE_DEFS.global;
  const Icon = def.icon;
  const colorMap = {
    violet:  'bg-violet-100 text-violet-700 border-violet-200',
    blue:    'bg-blue-100 text-blue-700 border-blue-200',
    emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-black border ${colorMap[def.color]}`}>
      <Icon size={12} />
      {def.label}
    </span>
  );
}

function TargetForm({ target, onSuccess, onCancel, inline = false }) {
  const isEdit = !!target;
  const qc = useQueryClient();

  const [agentName, setAgentName] = useState(target?.agent_name || '');
  const [department, setDepartment] = useState(target?.department || '');
  const [tMain, setTMain] = useState(target?.target_main_absent_rate ?? '');
  const [tZoom, setTZoom] = useState(target?.target_zoom_absent_rate ?? '');
  const [bonus, setBonus] = useState(target?.bonus_points ?? 5);
  const [eff, setEff] = useState(target?.effective_from || new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(target?.notes || '');
  const [scope, setScope] = useState(
    target?.agent_name ? 'agent' :
    target?.department ? 'department' : 'global'
  );

  const { data: users = [] } = useQuery({
    queryKey: ['users-agents'],
    queryFn: () => api.get('/admin/users').then(r => r.data.filter(u => u.role === 'agent' && u.is_active)),
    enabled: scope === 'agent',
  });

  // Pull baseline from latest Official quality snapshot for the selected
  // agent (or department), so the form can pre-fill placeholders + warn
  // when the entered target is not actually an improvement.
  const baselineKey =
    scope === 'agent'      && agentName  ? { type: 'agent', value: agentName } :
    scope === 'department' && department ? { type: 'dept',  value: department } :
    null;

  const { data: baseline } = useQuery({
    queryKey: ['target-baseline', baselineKey?.type, baselineKey?.value],
    queryFn: () => api.get('/admin/targets/baseline', {
      params: baselineKey.type === 'agent'
        ? { agent_name: baselineKey.value }
        : { department: baselineKey.value },
    }).then(r => r.data),
    enabled: !!baselineKey,
    staleTime: 60_000,
  });

  const resetForm = () => {
    setAgentName(''); setDepartment('');
    setTMain(''); setTZoom(''); setBonus(5);
    setNotes('');
  };

  const saveM = useMutation({
    mutationFn: (body) => isEdit
      ? api.put(`/admin/targets/${target.id}`, body)
      : api.post('/admin/targets', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['targets'] });
      if (inline && !isEdit) resetForm();
      onSuccess?.();
    },
  });

  const handleSave = () => {
    const tMainNum = parseInt(tMain, 10);
    const tZoomNum = parseInt(tZoom, 10);
    if (!Number.isFinite(tMainNum) || !Number.isFinite(tZoomNum)) {
      alert('من فضلك ادخل قيمة صحيحة لهدفي الغياب الأساسي والزووم.');
      return;
    }

    // Warning only — don't block. The user explicitly asked for this UX.
    if (baseline?.found) {
      const issues = [];
      if (tMainNum >= baseline.main_absent_rate) {
        issues.push(`• هدف الغياب الأساسي (${tMainNum}%) ≥ القاعدي (${baseline.main_absent_rate}%) — مش بيمثل تحسن.`);
      }
      if (tZoomNum >= baseline.zoom_absent_rate) {
        issues.push(`• هدف غياب الزووم (${tZoomNum}%) ≥ القاعدي (${baseline.zoom_absent_rate}%) — مش بيمثل تحسن.`);
      }
      if (issues.length && !window.confirm(`⚠ تحذير:\n\n${issues.join('\n')}\n\nتأكد إنك عايز تحفظ؟`)) {
        return;
      }
    }

    const body = {
      agent_name: scope === 'agent' ? agentName : null,
      department: scope === 'department' ? department : null,
      target_main_absent_rate: tMainNum,
      target_zoom_absent_rate: tZoomNum,
      bonus_points: parseInt(bonus, 10) || 5,
      effective_from: eff,
      notes: notes || null,
    };
    saveM.mutate(body);
  };

  const inputCls = 'w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30';

  const formBody = (
    <>
          {/* Scope tabs */}
          {!isEdit && (
            <div>
              <label className="text-xs font-black text-gray-500 mb-2 block">نطاق الهدف</label>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(SCOPE_DEFS).map(([k, def]) => {
                  const Icon = def.icon;
                  return (
                    <button
                      key={k}
                      onClick={() => setScope(k)}
                      className={`p-3 rounded-xl border-2 transition-all ${
                        scope === k ? 'border-[#1e3a5f] bg-[#1e3a5f]/5' : 'border-gray-100 hover:border-gray-200'
                      }`}
                    >
                      <Icon size={18} className={`mx-auto mb-1 ${scope === k ? 'text-[#1e3a5f]' : 'text-gray-400'}`} />
                      <p className={`text-[11px] font-black ${scope === k ? 'text-[#1e3a5f]' : 'text-gray-500'}`}>{def.label}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {scope === 'agent' && (
            <div>
              <label className="text-xs font-black text-gray-500 mb-1 block">الموظف</label>
              <select value={agentName} onChange={e => setAgentName(e.target.value)} className={inputCls} disabled={isEdit}>
                <option value="">اختر موظفاً...</option>
                {users.map(u => <option key={u.id} value={u.full_name}>{u.full_name} — {u.department}</option>)}
              </select>
            </div>
          )}

          {scope === 'department' && (
            <div>
              <label className="text-xs font-black text-gray-500 mb-1 block">القسم</label>
              <select value={department} onChange={e => setDepartment(e.target.value)} className={inputCls} disabled={isEdit}>
                <option value="">اختر قسماً...</option>
                <option value="General">General</option>
                <option value="Private">Private</option>
                <option value="Semi">Semi</option>
              </select>
            </div>
          )}

          {/* Baseline banner — shows the source snapshot for this agent/dept */}
          {baselineKey && (
            <div className={`rounded-xl p-3 text-xs font-bold border ${
              baseline?.found && !baseline?.fallback
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : baseline?.found && baseline?.fallback
                ? 'bg-blue-50 border-blue-200 text-blue-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}>
              {baseline?.found && !baseline?.fallback ? (
                <>
                  📊 القاعدي من <strong>{baseline.snapshot_label}</strong> ({baseline.from_date} → {baseline.to_date}):{' '}
                  غياب أساسي <strong>{baseline.main_absent_rate}%</strong> · زووم <strong>{baseline.zoom_absent_rate}%</strong>
                </>
              ) : baseline?.found && baseline?.fallback === 'department_average' ? (
                <>
                  ℹ️ موظف جديد — لسه مفيش قاعدي فردي ليه. استخدمنا متوسط قسم{' '}
                  <strong>{baseline.department}</strong> كمرجع من <strong>{baseline.snapshot_label}</strong>:{' '}
                  غياب أساسي <strong>{baseline.main_absent_rate}%</strong> · زووم <strong>{baseline.zoom_absent_rate}%</strong>.
                  حدّد أهداف تساعد على تحقيق هدف القسم.
                </>
              ) : baseline?.reason === 'no_official_snapshot' ? (
                <>⚠ مفيش Snapshot Official محفوظة. ممكن تحدد الأهداف يدوياً، أو تحفظ Snapshot Official من تقارير الجودة الأول.</>
              ) : baseline?.reason === 'agent_not_in_snapshot' ? (
                <>ℹ️ موظف جديد — مش موجود في آخر Snapshot Official ولا قسمه فيها. حدّد الأهداف يدوياً.</>
              ) : baseline?.reason === 'dept_not_in_snapshot' ? (
                <>⚠ القسم ده مش موجود في آخر Snapshot Official ({baseline.snapshot_label}). حدّد الأهداف يدوياً.</>
              ) : (
                <>جاري تحميل القاعدي...</>
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-black text-gray-500 mb-1 block">هدف غياب أساسي (%)</label>
            <input
              type="number" min="0" max="100"
              value={tMain}
              onChange={e => setTMain(e.target.value)}
              placeholder={baseline?.found ? `أقل من ${baseline.main_absent_rate}` : 'مثال: 20'}
              className={inputCls}
            />
          </div>

          <div>
            <label className="text-xs font-black text-gray-500 mb-1 block">هدف غياب زووم (%)</label>
            <input
              type="number" min="0" max="100"
              value={tZoom}
              onChange={e => setTZoom(e.target.value)}
              placeholder={baseline?.found ? `أقل من ${baseline.zoom_absent_rate}` : 'مثال: 40'}
              className={inputCls}
            />
          </div>

          <div>
            <label className="text-xs font-black text-gray-500 mb-1 block">نقاط مكافأة</label>
            <input
              type="number" min="0" max="100"
              value={bonus}
              onChange={e => setBonus(e.target.value)}
              placeholder="5"
              className={inputCls}
            />
            <p className="text-[10px] text-gray-500 font-bold mt-1">
              تنضاف للـ overall_score لو الموظف حقق هدفي الغياب الأساسي والزووم.
            </p>
          </div>

          <div>
            <label className="text-xs font-black text-gray-500 mb-1 block">يبدأ من تاريخ</label>
            <input type="date" value={eff} onChange={e => setEff(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="text-xs font-black text-gray-500 mb-1 block">ملاحظات (اختياري)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                      className={inputCls} placeholder="مثال: هدف ربع سنوي للقسم..." />
          </div>

          {saveM.isError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-800 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5" />
              {saveM.error?.response?.data?.error || 'حدث خطأ'}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {onCancel && (
              <button onClick={onCancel} className="flex-1 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl font-black text-sm text-gray-700">
                إلغاء
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saveM.isPending || (scope === 'agent' && !agentName) || (scope === 'department' && !department)}
              className="flex-1 px-4 py-2.5 bg-[#1e3a5f] hover:bg-[#2c4a7a] disabled:opacity-50 rounded-xl font-black text-sm text-white flex items-center justify-center gap-2"
            >
              {saveM.isPending ? '...جاري' : (<><Save size={14} /> حفظ</>)}
            </button>
          </div>
    </>
  );

  if (inline) {
    return (
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 space-y-4 max-w-2xl mx-auto" dir="rtl">
        {formBody}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
            <Target size={18} className="text-emerald-600" />
            {isEdit ? 'تعديل هدف' : 'إضافة هدف جديد'}
          </h2>
          <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {formBody}
        </div>
      </div>
    </div>
  );
}

// Modal wrapper around TargetForm — used for editing existing targets.
function TargetEditor({ open, onClose, target, onSuccess }) {
  if (!open) return null;
  return <TargetForm target={target} onCancel={onClose} onSuccess={onSuccess} />;
}

export default function TargetsManagement() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState('active'); // active | set | history
  const [editing, setEditing] = useState(null);
  const [customGoalOpen, setCustomGoalOpen] = useState(false);

  // Page subtitle adjusts to the viewer:
  // - admin → set targets
  // - leader → see their dept's target
  // - agent → see their own target
  const subtitle =
    isAdmin                  ? 'حدّد معايير الأداء الشهرية لكل موظف، قسم، أو عامة' :
    user?.role === 'leader'  ? 'هدف قسمك + أهداف موظفي القسم للفترة الحالية' :
                               'هدفك الفردي + هدف قسمك للفترة الحالية';

  const tabs = [
    { key: 'active',  label: 'الأهداف الحالية', icon: Activity },
    isAdmin && { key: 'set', label: 'إضافة هدف جديد', icon: Plus },
    { key: 'history', label: 'السجل والتطور',   icon: HistoryIcon },
  ].filter(Boolean);

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      {/* Header */}
      <div
        className="relative overflow-hidden rounded-3xl p-6 text-white"
        style={{
          background: 'linear-gradient(135deg, #064e3b 0%, #047857 50%, #10b981 100%)',
          boxShadow: '0 20px 50px -12px rgba(16, 185, 129, 0.35)',
        }}
      >
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full opacity-20 blur-3xl"
             style={{ background: 'radial-gradient(circle, #34d399 0%, transparent 70%)' }} />

        <div className="relative z-10 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/15 backdrop-blur rounded-2xl">
              <Target size={26} />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight">معايير الأداء</h1>
              <p className="text-white/70 text-sm font-bold mt-0.5">{subtitle}</p>
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={() => setCustomGoalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 backdrop-blur border border-white/20 text-white text-sm font-black transition shadow-sm"
            >
              <Plus size={16} />
              هدف فردي مخصص
            </button>
          )}
        </div>
      </div>

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

      {tab === 'active'  && <ActiveTargetsTab onEdit={setEditing} canManage={isAdmin} />}
      {tab === 'set'     && isAdmin && <TargetForm inline onSuccess={() => setTab('active')} />}
      {tab === 'history' && <HistoryTargetsTab canFilter={isAdmin} />}

      {/* Edit modal — opens when a row's edit button is clicked (admin only) */}
      <TargetEditor
        open={!!editing}
        target={editing}
        onClose={() => setEditing(null)}
        onSuccess={() => setEditing(null)}
      />

      {/* Custom-goal modal — admin assigns a custom goal to any agent */}
      <GoalFormModal
        open={customGoalOpen}
        mode="leader"
        onClose={() => setCustomGoalOpen(false)}
        onSuccess={() => setCustomGoalOpen(false)}
      />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Custom goals section — rendered inside ActiveTargetsTab. Pulls from /custom-goals
// endpoints with role-aware filtering (admin: all, leader: own dept, agent: own only).
// ═════════════════════════════════════════════════════════════════════════════
function CustomGoalsSection() {
  const { user } = useAuth();
  const isAdmin  = user?.role === 'admin';
  const isLeader = user?.role === 'leader';
  const isAgent  = user?.role === 'agent';

  // Reuse the same query keys as the modal/EvaluateGoals/MyProgression so a save
  // from anywhere invalidates this section's cache automatically.
  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ['team-custom-goals'],
    queryFn: () => api.get('/custom-goals/team').then(r => r.data),
    enabled: isAdmin || isLeader,
  });

  const { data: mineData, isLoading: mineLoading } = useQuery({
    queryKey: ['my-custom-goals'],
    queryFn: () => api.get('/custom-goals/mine').then(r => r.data),
    enabled: isAgent,
  });

  const isLoading = teamLoading || mineLoading;
  const goals = isAgent ? (mineData || []) : (teamData?.rows || []);

  // Hide section entirely for non-admin when empty — admin still sees the empty card.
  if (!isLoading && goals.length === 0 && !isAdmin) return null;

  return (
    <div className="bg-white border border-gray-100 rounded-3xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-black text-gray-700">الأهداف الفردية المخصصة</h3>
        <span className="text-[11px] text-gray-400 font-black">{goals.length}</span>
      </div>
      {isLoading ? (
        <p className="text-center py-8 text-gray-400 text-sm font-bold">جارٍ التحميل...</p>
      ) : goals.length === 0 ? (
        <p className="text-center py-8 text-gray-400 text-sm font-bold">لا توجد أهداف فردية مخصصة</p>
      ) : (
        <div className="p-4 space-y-3">
          {goals.map(g => (
            <CustomGoalCard
              key={g.id}
              goal={g}
              variant={isAgent ? 'agent' : 'leader'}
              showAgentName={!isAgent}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 1: ACTIVE TARGETS — current goals with evaluate/edit/delete
// ═════════════════════════════════════════════════════════════════════════════
function ActiveTargetsTab({ onEdit, canManage }) {
  const qc = useQueryClient();

  const { data: targets = [], isLoading } = useQuery({
    queryKey: ['targets', 'active'],
    queryFn: () => api.get('/admin/targets', { params: { mode: 'active' } }).then(r => r.data),
  });

  const delM = useMutation({
    mutationFn: (id) => api.delete(`/admin/targets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['targets'] }),
  });

  const evalM = useMutation({
    mutationFn: (id) => api.post(`/admin/targets/${id}/evaluate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['targets'] }),
    onError: (err) => {
      const body = err?.response?.data;
      alert(body?.message || body?.error || 'فشل التقييم');
    },
  });

  const grouped = {
    agent:      targets.filter(t => t.scope === 'agent'),
    department: targets.filter(t => t.scope === 'department'),
    global:     targets.filter(t => t.scope === 'global'),
  };

  if (isLoading) {
    return <div className="text-center py-12 text-gray-400 text-sm font-bold">جارٍ التحميل...</div>;
  }

  const handleEvaluate = (t) => {
    const who = t.agent_name || t.department || 'الكل';
    if (window.confirm(`متأكد عاوز تقفل تقييم هدف ${who} لـ ${t.period_label}؟ هيتم حساب النتيجة النهائية وتوزيع المكافأة لو الهدف اتحقق.`)) {
      evalM.mutate(t.id);
    }
  };

  // For non-admins, hide sections that have no data — they don't need to see
  // empty buckets that aren't relevant to their role.
  const sections = [
    { key: 'agent',      title: 'معايير الموظفين', emptyText: 'لا توجد معايير فردية' },
    { key: 'department', title: 'معايير الأقسام',  emptyText: 'لا توجد معايير على مستوى القسم' },
    { key: 'global',     title: 'المعايير العامة',  emptyText: 'لا يوجد معيار عام' },
  ].filter(s => canManage || grouped[s.key].length > 0);

  return (
    <div className="space-y-5">
      {canManage && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
          <div className="p-1.5 bg-blue-100 rounded-lg">
            <Trophy size={14} className="text-blue-600" />
          </div>
          <div className="text-xs font-bold text-blue-900 leading-relaxed">
            <strong className="font-black">قاعدة الأولوية:</strong> هدف الموظف يتقدم على هدف القسم، الذي يتقدم على الهدف العام.
            تُجمَّد الأهداف المُطبقة وقت تجميد الـ snapshot، فلن تتأثر التقارير القديمة بأي تعديل لاحق.
          </div>
        </div>
      )}

      {sections.length === 0 && (
        <div className="bg-white border border-gray-100 rounded-3xl p-12 text-center">
          <div className="inline-flex p-3 bg-gray-100 rounded-2xl mb-3">
            <Target size={20} className="text-gray-400" />
          </div>
          <p className="font-black text-gray-700">لا يوجد هدف معتمد ليك حالياً</p>
          <p className="text-xs text-gray-500 font-bold mt-1">الإدارة هتحدد هدفك في بداية الشهر</p>
        </div>
      )}

      {sections.map(section => (
        <div key={section.key} className="bg-white border border-gray-100 rounded-3xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-black text-gray-700">{section.title}</h3>
            <span className="text-[11px] text-gray-400 font-black">{grouped[section.key].length}</span>
          </div>
          {grouped[section.key].length === 0 ? (
            <p className="text-center py-8 text-gray-400 text-sm font-bold">{section.emptyText}</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {grouped[section.key].map(t => {
                const periodOver = t.period_end && new Date(t.period_end) < new Date();
                return (
                  <div key={t.id} className="px-6 py-4 hover:bg-gray-50/40 transition-colors">
                    <div className="flex items-center gap-4 flex-wrap">
                      <ScopeBadge scope={t.scope} />
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-gray-900 text-sm">
                          {t.agent_name || t.department || 'الكل'}
                        </p>
                        <p className="text-[10px] text-gray-400 font-bold mt-0.5 flex items-center gap-1">
                          <Calendar size={10} /> {t.period_label || `ساري من ${t.effective_from}`}
                          {t.set_by_name && <> · بواسطة {t.set_by_name}</>}
                        </p>
                        {t.notes && <p className="text-xs text-gray-500 font-bold mt-1 italic">{t.notes}</p>}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-1 bg-rose-50 border border-rose-200 rounded-lg text-[11px] font-black text-rose-700">
                          غياب أساسي ≤ {t.target_main_absent_rate ?? '—'}%
                        </span>
                        <span className="px-2.5 py-1 bg-violet-50 border border-violet-200 rounded-lg text-[11px] font-black text-violet-700">
                          غياب زووم ≤ {t.target_zoom_absent_rate ?? '—'}%
                        </span>
                        <span className="px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-lg text-[11px] font-black text-amber-700">
                          🏆 +{t.bonus_points ?? 5} نقطة
                        </span>
                      </div>

                      {canManage && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleEvaluate(t)}
                            disabled={evalM.isPending || !periodOver || !t.target_main_absent_rate}
                            className="p-2 hover:bg-emerald-50 rounded-lg text-emerald-600 disabled:opacity-30 disabled:hover:bg-transparent"
                            title={periodOver ? 'تقييم نهائي' : 'الفترة لسه فعّالة'}
                          >
                            <Award size={14} />
                          </button>
                          <button onClick={() => onEdit(t)}
                                  className="p-2 hover:bg-blue-50 rounded-lg text-blue-600">
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => { if (confirm('حذف هذا الهدف؟')) delM.mutate(t.id); }}
                                  className="p-2 hover:bg-red-50 rounded-lg text-red-500">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {/* Custom (non-KPI) goals — appears in the same tab so all role views surface them */}
      <CustomGoalsSection />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 3: HISTORY — evaluated targets with summary stats
// ═════════════════════════════════════════════════════════════════════════════
function HistoryTargetsTab({ canFilter = true }) {
  const [filterDept, setFilterDept] = useState('All');

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['targets', 'history', filterDept],
    queryFn: () => api.get('/admin/targets/history', {
      params: { dept_type: filterDept !== 'All' ? filterDept : undefined },
    }).then(r => r.data),
    staleTime: 30_000,
  });

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
      {/* Filter (admin only — non-admins are already scoped server-side) */}
      {canFilter && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3 flex-wrap shadow-sm">
          <span className="text-xs font-black text-gray-700">فلتر:</span>
          <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className={inputCls}>
            <option value="All">كل الأقسام</option>
            {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'إجمالي الأهداف',  value: summary.total,                 icon: Target,        tone: 'gray' },
          { label: 'تحققت ✓',          value: summary.met,                   icon: CheckCircle,   tone: 'emerald' },
          { label: 'فشلت ✗',           value: summary.missed,                icon: XCircle,       tone: 'rose' },
          { label: 'جزئي ⚠',           value: summary.partial,               icon: AlertTriangle, tone: 'amber' },
          { label: 'نسبة النجاح %',    value: `${summary.success_rate}%`,    icon: BarChart3,     tone: 'blue' },
        ].map((s, i) => (
          <div key={i} className={`bg-white border border-${s.tone}-200 rounded-2xl p-4 text-center shadow-sm`}>
            <s.icon size={20} className={`mx-auto text-${s.tone}-500 mb-1`} />
            <div className={`text-2xl font-black text-${s.tone}-700`}>{s.value}</div>
            <div className="text-[10px] font-bold text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <p className="text-center py-12 text-gray-400 text-sm font-bold">جارٍ التحميل...</p>
      ) : history.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-3xl p-12 text-center">
          <div className="inline-flex p-3 bg-gray-100 rounded-2xl mb-3">
            <HistoryIcon size={20} className="text-gray-400" />
          </div>
          <p className="font-black text-gray-700">لا يوجد سجل</p>
          <p className="text-xs text-gray-500 font-bold mt-1">لسه مفيش أهداف اتقيمت</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-3xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-xs font-black text-gray-500">النطاق</th>
                  <th className="px-4 py-2 text-xs font-black text-gray-500">الاسم</th>
                  <th className="px-4 py-2 text-xs font-black text-gray-500">الفترة</th>
                  <th className="px-4 py-2 text-xs font-black text-gray-500">الهدف (أساسي/زووم)</th>
                  <th className="px-4 py-2 text-xs font-black text-gray-500">الفعلي (أساسي/زووم)</th>
                  <th className="px-4 py-2 text-xs font-black text-gray-500">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map(g => (
                  <tr key={g.id} className="hover:bg-gray-50/40">
                    <td className="px-4 py-2"><ScopeBadge scope={g.scope} /></td>
                    <td className="px-4 py-2 font-bold">{g.agent_name || g.department || 'الكل'}</td>
                    <td className="px-4 py-2 text-xs text-gray-600">{g.period_label}</td>
                    <td className="px-4 py-2 text-xs font-mono text-gray-700">
                      {g.target_main_absent_rate}% / {g.target_zoom_absent_rate}%
                    </td>
                    <td className="px-4 py-2 text-xs font-mono text-gray-900 font-black">
                      {g.actual_main_absent_rate}% / {g.actual_zoom_absent_rate}%
                    </td>
                    <td className="px-4 py-2"><StatusPill status={g.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    met:     { bg: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle,   label: 'متحقق ✓' },
    missed:  { bg: 'bg-rose-100 text-rose-700 border-rose-200',          icon: XCircle,       label: 'غير متحقق' },
    partial: { bg: 'bg-amber-100 text-amber-700 border-amber-200',       icon: AlertTriangle, label: 'جزئي' },
    active:  { bg: 'bg-blue-100 text-blue-700 border-blue-200',          icon: Clock,         label: 'فعّال' },
  };
  const m = map[status] || map.active;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-black ${m.bg}`}>
      <Icon size={12} /> {m.label}
    </span>
  );
}
