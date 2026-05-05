import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Target, Plus, X, Edit2, Trash2, User, Building2, Globe,
  Calendar, TrendingUp, Save, AlertTriangle, Trophy,
} from 'lucide-react';
import api from '../../api/axios';

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

function TargetEditor({ open, onClose, target, onSuccess }) {
  const isEdit = !!target;
  const qc = useQueryClient();

  const [agentName, setAgentName] = useState(target?.agent_name || '');
  const [department, setDepartment] = useState(target?.department || '');
  const [tMain, setTMain] = useState(target?.target_main_absent_rate ?? '');
  const [tZoom, setTZoom] = useState(target?.target_zoom_absent_rate ?? '');
  const [eff, setEff] = useState(target?.effective_from || new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(target?.notes || '');
  const [scope, setScope] = useState(
    target?.agent_name ? 'agent' :
    target?.department ? 'department' : 'global'
  );

  const { data: users = [] } = useQuery({
    queryKey: ['users-agents'],
    queryFn: () => api.get('/admin/users').then(r => r.data.filter(u => u.role === 'agent' && u.is_active)),
    enabled: open && scope === 'agent',
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
    enabled: open && !!baselineKey,
    staleTime: 60_000,
  });

  const saveM = useMutation({
    mutationFn: (body) => isEdit
      ? api.put(`/admin/targets/${target.id}`, body)
      : api.post('/admin/targets', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['targets'] }); onSuccess?.(); },
  });

  if (!open) return null;

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
      effective_from: eff,
      notes: notes || null,
    };
    saveM.mutate(body);
  };

  const inputCls = 'w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
            <Target size={18} className="text-emerald-600" />
            {isEdit ? 'تعديل هدف' : 'إضافة هدف جديد'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
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
              baseline?.found
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}>
              {baseline?.found ? (
                <>
                  📊 القاعدي من <strong>{baseline.snapshot_label}</strong> ({baseline.from_date} → {baseline.to_date}):{' '}
                  غياب أساسي <strong>{baseline.main_absent_rate}%</strong> · زووم <strong>{baseline.zoom_absent_rate}%</strong>
                </>
              ) : baseline?.reason === 'no_official_snapshot' ? (
                <>⚠ مفيش Snapshot Official محفوظة. ابعت Snapshot Official من صفحة "تقارير الجودة" الأول.</>
              ) : baseline?.reason === 'agent_not_in_snapshot' ? (
                <>⚠ الموظف ده مش موجود في آخر Snapshot Official ({baseline.snapshot_label}).</>
              ) : baseline?.reason === 'dept_not_in_snapshot' ? (
                <>⚠ القسم ده مش موجود في آخر Snapshot Official ({baseline.snapshot_label}).</>
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
            <button onClick={onClose} className="flex-1 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl font-black text-sm text-gray-700">
              إلغاء
            </button>
            <button
              onClick={handleSave}
              disabled={saveM.isPending || (scope === 'agent' && !agentName) || (scope === 'department' && !department)}
              className="flex-1 px-4 py-2.5 bg-[#1e3a5f] hover:bg-[#2c4a7a] disabled:opacity-50 rounded-xl font-black text-sm text-white flex items-center justify-center gap-2"
            >
              {saveM.isPending ? '...جاري' : (<><Save size={14} /> حفظ</>)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TargetsManagement() {
  const qc = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: targets = [], isLoading } = useQuery({
    queryKey: ['targets'],
    queryFn: () => api.get('/admin/targets').then(r => r.data),
  });

  const delM = useMutation({
    mutationFn: (id) => api.delete(`/admin/targets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['targets'] }),
  });

  const grouped = {
    agent: targets.filter(t => t.scope === 'agent'),
    department: targets.filter(t => t.scope === 'department'),
    global: targets.filter(t => t.scope === 'global'),
  };

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

        <div className="relative z-10 flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/15 backdrop-blur rounded-2xl">
              <Target size={26} />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight">معايير الأداء</h1>
              <p className="text-white/70 text-sm font-bold mt-0.5">حدّد معايير الأداء الشهرية لكل موظف، قسم، أو عامة</p>
            </div>
          </div>

          <button
            onClick={() => { setEditing(null); setEditorOpen(true); }}
            className="px-4 py-2.5 bg-white/15 hover:bg-white/25 backdrop-blur transition-all rounded-xl font-black text-sm flex items-center gap-2 border border-white/30"
          >
            <Plus size={16} />
            هدف جديد
          </button>
        </div>
      </div>

      {/* Priority hint */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
        <div className="p-1.5 bg-blue-100 rounded-lg">
          <Trophy size={14} className="text-blue-600" />
        </div>
        <div className="text-xs font-bold text-blue-900 leading-relaxed">
          <strong className="font-black">قاعدة الأولوية:</strong> هدف الموظف يتقدم على هدف القسم، الذي يتقدم على الهدف العام.
          تُجمَّد الأهداف المُطبقة وقت تجميد الـ snapshot، فلن تتأثر التقارير القديمة بأي تعديل لاحق.
        </div>
      </div>

      {/* Sections */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400 text-sm font-bold">جارٍ التحميل...</div>
      ) : (
        <>
          {[
            { key: 'agent',      title: 'معايير الموظفين', emptyText: 'لا توجد معايير فردية' },
            { key: 'department', title: 'معايير الأقسام',  emptyText: 'لا توجد معايير على مستوى القسم' },
            { key: 'global',     title: 'المعايير العامة',  emptyText: 'لا يوجد معيار عام' },
          ].map(section => (
            <div key={section.key} className="bg-white border border-gray-100 rounded-3xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-black text-gray-700">{section.title}</h3>
                <span className="text-[11px] text-gray-400 font-black">{grouped[section.key].length}</span>
              </div>
              {grouped[section.key].length === 0 ? (
                <p className="text-center py-8 text-gray-400 text-sm font-bold">{section.emptyText}</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {grouped[section.key].map(t => (
                    <div key={t.id} className="px-6 py-4 hover:bg-gray-50/40 transition-colors">
                      <div className="flex items-center gap-4 flex-wrap">
                        <ScopeBadge scope={t.scope} />
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-gray-900 text-sm">
                            {t.agent_name || t.department || 'الكل'}
                          </p>
                          <p className="text-[10px] text-gray-400 font-bold mt-0.5 flex items-center gap-1">
                            <Calendar size={10} /> ساري من {t.effective_from}
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
                        </div>

                        <div className="flex items-center gap-1">
                          <button onClick={() => { setEditing(t); setEditorOpen(true); }}
                                  className="p-2 hover:bg-blue-50 rounded-lg text-blue-600">
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => { if (confirm('حذف هذا الهدف؟')) delM.mutate(t.id); }}
                                  className="p-2 hover:bg-red-50 rounded-lg text-red-500">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <TargetEditor
        open={editorOpen}
        target={editing}
        onClose={() => { setEditorOpen(false); setEditing(null); }}
        onSuccess={() => { setEditorOpen(false); setEditing(null); }}
      />
    </div>
  );
}
