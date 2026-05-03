import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Save, Award, AlertTriangle, MessageSquare, ThumbsUp, ThumbsDown, Lightbulb,
} from 'lucide-react';
import api from '../../api/axios';

const STATUS_OPTIONS = [
  { value: 'achieved',     label: '✅ تم تحقيقه',  color: '#10B981', bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
  { value: 'partially',    label: '🟡 جزئياً',       color: '#F59E0B', bg: 'bg-amber-100',   text: 'text-amber-700',   border: 'border-amber-200' },
  { value: 'not_achieved', label: '❌ لم يتحقق',    color: '#EF4444', bg: 'bg-rose-100',    text: 'text-rose-700',    border: 'border-rose-200' },
];

/**
 * EvaluateGoalModal — leader fills the evaluation:
 *   - Achieved value
 *   - Status (achieved/partially/not_achieved)
 *   - Reason (REQUIRED — why this score)
 *   - Strengths (نقاط القوة)
 *   - Weaknesses (نقاط الضعف)
 *   - Optional general note
 *
 * After submit, the agent loses ability to edit/delete this goal.
 */
export default function EvaluateGoalModal({ open, onClose, goal, onSuccess }) {
  const qc = useQueryClient();
  const [status, setStatus]            = useState('achieved');
  const [achievedValue, setAchieved]   = useState('');
  const [reason, setReason]            = useState('');
  const [strengths, setStrengths]      = useState('');
  const [weaknesses, setWeaknesses]    = useState('');
  const [leaderNote, setLeaderNote]    = useState('');

  useEffect(() => {
    if (open && goal) {
      setStatus(goal.result_status === 'pending' ? 'achieved' : goal.result_status);
      setAchieved(goal.achieved_value ?? '');
      setReason(goal.evaluation_reason || '');
      setStrengths(goal.strengths || '');
      setWeaknesses(goal.weaknesses || '');
      setLeaderNote(goal.leader_note || '');
    }
  }, [open, goal]);

  const saveM = useMutation({
    mutationFn: () => api.put(`/custom-goals/team/${goal.id}/evaluate`, {
      result_status:     status,
      achieved_value:    achievedValue === '' ? null : achievedValue,
      evaluation_reason: reason,
      strengths,
      weaknesses,
      leader_note:       leaderNote,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-custom-goals'] });
      qc.invalidateQueries({ queryKey: ['my-custom-goals'] });
      qc.invalidateQueries({ queryKey: ['my-progression'] });
      onSuccess?.();
    },
  });

  if (!open || !goal) return null;

  const inputCls = 'w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30';
  const unitLabel = goal.unit === 'custom' ? (goal.unit_custom || '') : goal.unit;
  const reasonOk = reason.trim().length >= 5;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 rounded-xl">
              <Award size={18} className="text-emerald-600" />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900">
                {goal.result_status === 'pending' ? 'تقييم الهدف' : 'إعادة تقييم الهدف'}
              </h2>
              <p className="text-[11px] text-gray-400 font-bold">
                {goal.agent_name} · {goal.title}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Goal context */}
          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3">
            <p className="text-xs font-black text-gray-700 mb-1">📌 {goal.title}</p>
            {goal.description && (
              <p className="text-[11px] text-gray-500 font-bold mb-2">{goal.description}</p>
            )}
            <div className="text-[11px] text-gray-500 font-bold">
              {goal.target_value != null && (
                <span>🎯 الهدف: <span className="text-gray-800">{goal.target_value}{unitLabel}</span></span>
              )}
            </div>
          </div>

          {/* Status selection */}
          <div>
            <label className="text-xs font-black text-gray-500 mb-2 block">حالة التقييم *</label>
            <div className="grid grid-cols-3 gap-2">
              {STATUS_OPTIONS.map(opt => {
                const active = status === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setStatus(opt.value)}
                    className={`p-3 rounded-xl border-2 transition-all text-xs font-black ${
                      active
                        ? `${opt.bg} ${opt.text} ${opt.border} shadow-sm scale-[1.02]`
                        : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Achieved value */}
          <div>
            <label className="text-xs font-black text-gray-500 mb-1.5 block">
              القيمة المُحققة (اختياري)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number" min="0" max="100000" value={achievedValue}
                onChange={e => setAchieved(e.target.value)}
                placeholder={goal.target_value != null ? `الهدف كان ${goal.target_value}` : 'مثال: 75'}
                className={inputCls + ' flex-1'}
              />
              <span className="text-sm font-black text-gray-700 min-w-[40px]">{unitLabel}</span>
            </div>
          </div>

          {/* Reason — REQUIRED */}
          <div>
            <label className="text-xs font-black text-gray-500 mb-1.5 block flex items-center gap-1.5">
              <MessageSquare size={11} className="text-blue-500" />
              سبب التقييم *
              <span className="text-[10px] text-gray-400 font-bold">(يظهر للموظف)</span>
            </label>
            <textarea
              value={reason} onChange={e => setReason(e.target.value.slice(0, 1000))}
              rows={3} maxLength={1000}
              placeholder="مثال: حقق 75% من الهدف بسبب إنجازه السريع للمهام المُسندة..."
              className={inputCls}
            />
            <p className="text-[10px] text-gray-400 font-bold text-left mt-1">
              {reason.length}/1000 {reason.length > 0 && reason.length < 5 && '— الحد الأدنى 5 أحرف'}
            </p>
          </div>

          {/* Strengths */}
          <div>
            <label className="text-xs font-black text-gray-500 mb-1.5 block flex items-center gap-1.5">
              <ThumbsUp size={11} className="text-emerald-500" />
              نقاط القوة (اختياري)
            </label>
            <textarea
              value={strengths} onChange={e => setStrengths(e.target.value.slice(0, 1000))}
              rows={2} maxLength={1000}
              placeholder={'مثال:\n- التزام عالي بالمواعيد\n- تواصل ممتاز مع العملاء'}
              className={inputCls}
            />
          </div>

          {/* Weaknesses */}
          <div>
            <label className="text-xs font-black text-gray-500 mb-1.5 block flex items-center gap-1.5">
              <ThumbsDown size={11} className="text-rose-500" />
              نقاط للتحسين (اختياري)
            </label>
            <textarea
              value={weaknesses} onChange={e => setWeaknesses(e.target.value.slice(0, 1000))}
              rows={2} maxLength={1000}
              placeholder={'مثال:\n- يحتاج لتحسين سرعة الاستجابة\n- توثيق المتابعات بشكل أفضل'}
              className={inputCls}
            />
          </div>

          {/* General note */}
          <div>
            <label className="text-xs font-black text-gray-500 mb-1.5 block flex items-center gap-1.5">
              <Lightbulb size={11} className="text-amber-500" />
              ملاحظة تحفيزية (اختياري)
            </label>
            <textarea
              value={leaderNote} onChange={e => setLeaderNote(e.target.value.slice(0, 500))}
              rows={2} maxLength={500}
              placeholder="مثال: استمر، أنت في طريقك للنجاح!"
              className={inputCls}
            />
          </div>

          {!reasonOk && reason.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-bold text-amber-800 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5" />
              سبب التقييم لازم يكون 5 أحرف على الأقل
            </div>
          )}
          {saveM.isError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-800 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5" />
              {saveM.error?.response?.data?.error || 'حدث خطأ'}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2 flex-shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl font-black text-sm text-gray-700">
            إلغاء
          </button>
          <button
            onClick={() => saveM.mutate()}
            disabled={saveM.isPending || !reasonOk}
            className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl font-black text-sm text-white flex items-center justify-center gap-2"
          >
            <Save size={14} /> {saveM.isPending ? '...جارٍ' : 'حفظ التقييم'}
          </button>
        </div>
      </div>
    </div>
  );
}
