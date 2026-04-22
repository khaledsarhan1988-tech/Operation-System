import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Phone, Calendar, Clock, RefreshCw, X, Plus,
  PhoneCall, MessageCircle, StickyNote, MapPin,
  CheckCircle2, ChevronRight, AlertTriangle,
} from 'lucide-react';
import api from '../../api/axios';

// ─── constants ────────────────────────────────────────────────────────────────
const STAGES = [
  {
    key: 'جديدة',
    label: 'جديدة',
    dot: 'bg-blue-500',
    badge: 'bg-blue-100 text-blue-800',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    colBorder: 'border-t-4 border-t-blue-500',
  },
  {
    key: 'قيد المتابعة',
    label: 'قيد المتابعة',
    dot: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-800',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    colBorder: 'border-t-4 border-t-amber-500',
  },
  {
    key: 'بانتظار الرد',
    label: 'بانتظار الرد',
    dot: 'bg-purple-500',
    badge: 'bg-purple-100 text-purple-800',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    colBorder: 'border-t-4 border-t-purple-500',
  },
  {
    key: 'مكتملة',
    label: 'مكتملة',
    dot: 'bg-green-500',
    badge: 'bg-green-100 text-green-800',
    bg: 'bg-green-50',
    border: 'border-green-200',
    colBorder: 'border-t-4 border-t-green-500',
  },
];

const PRIORITY_LEFT = {
  'عاجلة': 'border-r-[3px] border-r-red-500',
  'هامة':  'border-r-[3px] border-r-orange-400',
  'عادية': 'border-r-[3px] border-r-gray-200',
};
const PRIORITY_DOT = {
  'عاجلة': 'bg-red-500',
  'هامة':  'bg-orange-400',
  'عادية': 'bg-gray-300',
};
const SLA_CLS = {
  breached: 'bg-red-100 text-red-700',
  at_risk:  'bg-orange-100 text-orange-700',
  on_time:  'bg-green-100 text-green-700',
};
const SLA_LBL = { breached: '⚠ متأخر', at_risk: '⏳ قريب', on_time: '✓ OK' };

const LOG_TYPES = [
  { value: 'call',    label: 'مكالمة هاتفية',  Icon: PhoneCall    },
  { value: 'message', label: 'رسالة واتساب',    Icon: MessageCircle },
  { value: 'note',    label: 'ملاحظة',          Icon: StickyNote   },
  { value: 'visit',   label: 'زيارة',           Icon: MapPin       },
];
const OUTCOMES = [
  'تم التواصل', 'لم يرد', 'مشغول', 'خارج النطاق',
  'رقم خاطئ', 'وعد بالمتابعة', 'تم الحل',
];

// ─── helpers ──────────────────────────────────────────────────────────────────
function daysAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 86_400_000);
  if (diff === 0) return 'اليوم';
  if (diff === 1) return 'أمس';
  return `منذ ${diff} يوم`;
}
function fmtDateTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString('ar-EG', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// ─── ClientCard ───────────────────────────────────────────────────────────────
function ClientCard({ remark, stageKey, onSelect, onMoveStage }) {
  return (
    <div
      onClick={() => onSelect(remark)}
      className={`bg-white rounded-xl shadow-sm hover:shadow-md transition-all cursor-pointer select-none ${PRIORITY_LEFT[remark.priority] || 'border-r-[3px] border-r-gray-200'}`}
    >
      <div className="p-3 space-y-2.5">
        {/* row 1: task type + SLA */}
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium truncate max-w-[130px]">
            {remark.task_type || '—'}
          </span>
          <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0 ${SLA_CLS[remark.sla_status] || 'bg-gray-100 text-gray-600'}`}>
            {SLA_LBL[remark.sla_status] || '—'}
          </span>
        </div>

        {/* client name */}
        <p className="font-bold text-gray-900 text-sm leading-tight">
          {remark.client_name || '—'}
        </p>

        {/* phone */}
        {remark.client_phone && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Phone size={11} className="flex-shrink-0" />
            <span className="font-mono tracking-wide">{remark.client_phone}</span>
          </div>
        )}

        {/* footer row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-[11px] text-gray-400">
            <Calendar size={11} />
            {daysAgo(remark.added_at)}
          </div>
          <div className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[remark.priority] || 'bg-gray-300'}`} />
            <span className="text-[11px] text-gray-500">{remark.priority}</span>
          </div>
        </div>

        {/* next follow-up chip */}
        {remark.next_followup_at && (
          <div className="flex items-center gap-1 text-[11px] text-purple-700 bg-purple-50 rounded-lg px-2 py-1">
            <Clock size={11} />
            <span>موعد: {fmtDateTime(remark.next_followup_at)}</span>
          </div>
        )}

        {/* move-stage selector */}
        <div onClick={e => e.stopPropagation()}>
          <select
            defaultValue=""
            onChange={e => { if (e.target.value) { onMoveStage(remark.id, e.target.value); e.target.value = ''; } }}
            className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 text-gray-500 focus:outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer"
          >
            <option value="">↓ تغيير المرحلة</option>
            {STAGES.filter(s => s.key !== stageKey).map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

// ─── KanbanColumn ─────────────────────────────────────────────────────────────
function KanbanColumn({ stage, cards, onSelect, onMoveStage }) {
  return (
    <div className={`rounded-2xl bg-white border border-gray-200 ${stage.colBorder} flex flex-col min-h-[480px]`}>
      {/* header */}
      <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${stage.dot}`} />
          <span className="font-bold text-sm text-gray-800">{stage.label}</span>
        </div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${stage.badge}`}>
          {cards.length}
        </span>
      </div>

      {/* cards */}
      <div className="p-2 space-y-2 flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
        {cards.length === 0 ? (
          <div className="text-center py-10 text-gray-300 text-xs select-none">لا توجد مهام</div>
        ) : cards.map(card => (
          <ClientCard
            key={card.id}
            remark={card}
            stageKey={stage.key}
            onSelect={onSelect}
            onMoveStage={onMoveStage}
          />
        ))}
      </div>
    </div>
  );
}

// ─── ClientDetailModal ────────────────────────────────────────────────────────
function ClientDetailModal({ remark: initialRemark, onClose, onUpdate }) {
  const qc = useQueryClient();
  const [localRemark, setLocalRemark] = useState(initialRemark);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    interaction_type: 'call', outcome: '', notes: '', next_followup_at: '', status: '',
  });

  const { data: logs = [], isLoading: logsLoading, refetch: refetchLogs } = useQuery({
    queryKey: ['remark-logs', localRemark.id],
    queryFn: () => api.get(`/agent/tasks/${localRemark.id}/logs`).then(r => r.data),
  });

  const logMut = useMutation({
    mutationFn: payload => api.post(`/agent/tasks/${localRemark.id}/log`, payload),
    onSuccess: ({ data }) => {
      setLocalRemark(data.remark);
      refetchLogs();
      qc.invalidateQueries(['agent-pipeline']);
      setForm({ interaction_type: 'call', outcome: '', notes: '', next_followup_at: '', status: '' });
      setShowForm(false);
    },
  });

  const stageMut = useMutation({
    mutationFn: stage => api.put(`/agent/tasks/${localRemark.id}`, { status: stage }),
    onSuccess: ({ data }) => {
      setLocalRemark(data);
      qc.invalidateQueries(['agent-pipeline']);
    },
  });

  const activeStageKey = localRemark.status;
  const activeStageIdx = STAGES.findIndex(s => s.key === activeStageKey);
  const effectiveIdx = activeStageIdx === -1 ? 0 : activeStageIdx;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col"
        dir="rtl"
        onClick={e => e.stopPropagation()}
      >
        {/* ── header ── */}
        <div className="px-5 py-4 border-b flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 text-lg truncate">{localRemark.client_name || '—'}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {localRemark.client_phone && (
                <span className="flex items-center gap-1 text-sm text-gray-500">
                  <Phone size={13} />
                  <span className="font-mono">{localRemark.client_phone}</span>
                </span>
              )}
              <span className="text-xs text-gray-400 truncate">{localRemark.task_type}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${SLA_CLS[localRemark.sla_status] || 'bg-gray-100 text-gray-600'}`}>
                {SLA_LBL[localRemark.sla_status]} · SLA
              </span>
              {localRemark.next_followup_at && (
                <span className="flex items-center gap-1 text-xs text-purple-600 bg-purple-50 rounded-full px-2 py-0.5">
                  <Clock size={11} />
                  {fmtDateTime(localRemark.next_followup_at)}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* ── pipeline stepper ── */}
        <div className="px-5 py-3 border-b bg-gray-50 overflow-x-auto">
          <div className="flex items-center gap-1 min-w-max">
            {STAGES.map((s, i) => {
              const isActive = i === effectiveIdx;
              const isDone   = i < effectiveIdx;
              return (
                <div key={s.key} className="flex items-center gap-1">
                  <button
                    onClick={() => stageMut.mutate(s.key)}
                    disabled={stageMut.isPending}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                      isActive
                        ? `${s.badge} shadow-sm scale-105`
                        : isDone
                        ? 'text-green-600 bg-green-50'
                        : 'text-gray-400 hover:bg-gray-200 hover:text-gray-700'
                    }`}
                  >
                    {isDone
                      ? <CheckCircle2 size={12} className="text-green-500" />
                      : <div className={`w-2 h-2 rounded-full ${isActive ? s.dot : 'bg-gray-300'}`} />
                    }
                    {s.label}
                  </button>
                  {i < STAGES.length - 1 && (
                    <ChevronRight size={12} className="text-gray-300 flex-shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── scrollable body ── */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">

          {/* log new interaction */}
          <div className="px-5 py-4">
            {!showForm ? (
              <button
                onClick={() => setShowForm(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-primary hover:text-primary transition"
              >
                <Plus size={16} /> تسجيل تواصل جديد
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-gray-800">تسجيل تواصل</p>
                  <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600 block mb-1">نوع التواصل</label>
                    <select
                      value={form.interaction_type}
                      onChange={e => setForm(p => ({ ...p, interaction_type: e.target.value }))}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      {LOG_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 block mb-1">النتيجة</label>
                    <select
                      value={form.outcome}
                      onChange={e => setForm(p => ({ ...p, outcome: e.target.value }))}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <option value="">— اختر النتيجة —</option>
                      {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600 block mb-1">تحديث المرحلة (اختياري)</label>
                    <select
                      value={form.status}
                      onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <option value="">— لا تغيير —</option>
                      {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 block mb-1">موعد المتابعة</label>
                    <input
                      type="datetime-local"
                      value={form.next_followup_at}
                      onChange={e => setForm(p => ({ ...p, next_followup_at: e.target.value }))}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">ملاحظات</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                    placeholder="أضف ملاحظات حول التواصل..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                  />
                </div>

                {logMut.isError && (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle size={13} />
                    {logMut.error?.response?.data?.error || 'حدث خطأ'}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition">
                    إلغاء
                  </button>
                  <button
                    disabled={logMut.isPending}
                    onClick={() => logMut.mutate(form)}
                    className="btn-primary px-5 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
                  >
                    {logMut.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                    حفظ
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* interaction timeline */}
          <div className="px-5 py-4">
            <p className="text-sm font-bold text-gray-800 mb-3">
              سجل التواصل
              {logs.length > 0 && (
                <span className="text-xs text-gray-400 font-normal mr-2">({logs.length} سجل)</span>
              )}
            </p>
            {logsLoading ? (
              <div className="flex justify-center py-6">
                <RefreshCw className="animate-spin text-gray-300" size={20} />
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-gray-300 text-sm">لم يتم تسجيل أي تواصل بعد</div>
            ) : (
              <div className="space-y-3">
                {logs.map(log => {
                  const typeObj = LOG_TYPES.find(t => t.value === log.interaction_type);
                  const Icon = typeObj?.Icon || PhoneCall;
                  return (
                    <div key={log.id} className="flex gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center mt-0.5">
                        <Icon size={14} className="text-gray-500" />
                      </div>
                      <div className="flex-1 bg-gray-50 rounded-xl p-3 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="text-xs font-semibold text-gray-700">
                            {typeObj?.label || log.interaction_type}
                            {log.outcome && (
                              <span className={`mr-1.5 px-1.5 py-0.5 rounded-full font-medium
                                ${log.outcome === 'تم التواصل' || log.outcome === 'تم الحل'
                                  ? 'bg-green-100 text-green-700'
                                  : log.outcome === 'لم يرد' || log.outcome === 'رقم خاطئ'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-gray-100 text-gray-600'
                                }`}>
                                {log.outcome}
                              </span>
                            )}
                          </span>
                          <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtDateTime(log.created_at)}</span>
                        </div>
                        {log.notes && <p className="text-sm text-gray-700 leading-relaxed">{log.notes}</p>}
                        {log.next_followup_at && (
                          <div className="flex items-center gap-1 mt-1.5 text-xs text-purple-600">
                            <Clock size={11} />
                            <span>موعد المتابعة: {fmtDateTime(log.next_followup_at)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function Pipeline() {
  const [selected, setSelected] = useState(null);
  const qc = useQueryClient();

  const { data: pipeline, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['agent-pipeline'],
    queryFn: () => api.get('/agent/pipeline').then(r => r.data),
    refetchInterval: 120_000,
  });

  const moveMut = useMutation({
    mutationFn: ({ id, stage }) => api.put(`/agent/tasks/${id}`, { status: stage }),
    onSuccess: () => qc.invalidateQueries(['agent-pipeline']),
  });

  const handleMove = useCallback((id, stage) => moveMut.mutate({ id, stage }), [moveMut]);

  const totalOpen = STAGES
    .filter(s => s.key !== 'مكتملة')
    .reduce((sum, s) => sum + (pipeline?.[s.key]?.length || 0), 0);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">بايبلاين العملاء</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isLoading ? '...' : `${totalOpen} مهمة نشطة`}
            {' · '}اضغط على أي بطاقة لتسجيل التواصل وتحديث الحالة
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition disabled:opacity-50"
        >
          <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
          تحديث
        </button>
      </div>

      {/* Stats bar */}
      {!isLoading && (
        <div className="grid grid-cols-4 gap-3">
          {STAGES.map(s => (
            <div key={s.key} className={`rounded-xl border ${s.border} ${s.bg} px-4 py-3 flex items-center justify-between`}>
              <div>
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className="text-2xl font-bold text-gray-900">{pipeline?.[s.key]?.length ?? 0}</p>
              </div>
              <div className={`w-3 h-3 rounded-full ${s.dot}`} />
            </div>
          ))}
        </div>
      )}

      {/* Kanban board */}
      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <RefreshCw className="animate-spin text-primary" size={32} />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STAGES.map(stage => (
            <KanbanColumn
              key={stage.key}
              stage={stage}
              cards={pipeline?.[stage.key] || []}
              onSelect={setSelected}
              onMoveStage={handleMove}
            />
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <ClientDetailModal
          remark={selected}
          onClose={() => setSelected(null)}
          onUpdate={() => {
            qc.invalidateQueries(['agent-pipeline']);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
