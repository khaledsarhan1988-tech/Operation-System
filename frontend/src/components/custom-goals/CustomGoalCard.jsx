import {
  Award, Edit2, Trash2, Calendar, User as UserIcon, MessageSquare,
  ThumbsUp, ThumbsDown, Lightbulb, Clock,
} from 'lucide-react';

const MONTH_NAMES_AR = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const STATUS_DEFS = {
  pending:      { label: 'بانتظار التقييم',      emoji: '⏳', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  achieved:     { label: '✅ تم تحقيقه',          emoji: '🎉', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  partially:    { label: '🟡 جزئياً',              emoji: '⚖️', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  not_achieved: { label: '❌ لم يتحقق',           emoji: '😔', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
};

/**
 * CustomGoalCard — used in both agent's MyProgression and leader's evaluate page.
 *
 * Props:
 *   goal               — the goal object
 *   variant            — 'agent' | 'leader'
 *   onEdit, onDelete   — handlers (only when variant + status allows)
 *   onEvaluate         — leader only (for pending goals)
 *   showAgentName      — show "اسم الموظف" header (leader view)
 */
export default function CustomGoalCard({ goal, variant = 'agent', onEdit, onDelete, onEvaluate, showAgentName }) {
  const status = STATUS_DEFS[goal.result_status] || STATUS_DEFS.pending;
  const isPending = goal.result_status === 'pending';
  const unitLabel = goal.unit === 'custom' ? (goal.unit_custom || '') : goal.unit;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-l from-indigo-50/50 via-white to-white">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            {showAgentName && goal.agent_name && (
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                <UserIcon size={10} />
                {goal.agent_name} · {goal.agent_department}
              </p>
            )}
            <p className="font-black text-gray-800 text-sm">{goal.title}</p>
            {goal.description && (
              <p className="text-xs text-gray-500 font-bold mt-0.5 line-clamp-2">{goal.description}</p>
            )}
          </div>
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-black border whitespace-nowrap ${status.cls}`}>
            {status.label}
          </span>
        </div>

        <div className="flex items-center gap-3 mt-2 flex-wrap text-[11px] font-bold text-gray-500">
          {goal.target_value != null && (
            <span className="inline-flex items-center gap-1">
              🎯 الهدف: <span className="text-gray-800 font-black">{goal.target_value}{unitLabel}</span>
            </span>
          )}
          {goal.year && goal.month && (
            <span className="inline-flex items-center gap-1">
              <Calendar size={10} />
              {MONTH_NAMES_AR[goal.month]} {goal.year}
            </span>
          )}
          {goal.created_by_name && (
            <span className="inline-flex items-center gap-1">
              أُضيف بواسطة: <span className="text-gray-700">{goal.created_by_name}</span>
            </span>
          )}
        </div>
      </div>

      {/* Evaluation result */}
      {!isPending && (
        <div className="p-4 space-y-3">
          {goal.achieved_value != null && (
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
              <span className="text-xs font-black text-gray-600">الإنجاز الفعلي</span>
              <span className="text-lg font-black text-gray-900">
                {goal.achieved_value}{unitLabel}
              </span>
            </div>
          )}

          {goal.evaluation_reason && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
              <p className="text-[10px] font-black text-blue-700 mb-1 flex items-center gap-1.5">
                <MessageSquare size={11} /> سبب التقييم
              </p>
              <p className="text-xs text-blue-900 font-bold leading-relaxed">{goal.evaluation_reason}</p>
            </div>
          )}

          {goal.strengths && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
              <p className="text-[10px] font-black text-emerald-700 mb-1 flex items-center gap-1.5">
                <ThumbsUp size={11} /> نقاط القوة
              </p>
              <p className="text-xs text-emerald-900 font-bold leading-relaxed whitespace-pre-line">{goal.strengths}</p>
            </div>
          )}

          {goal.weaknesses && (
            <div className="bg-rose-50 border border-rose-100 rounded-xl p-3">
              <p className="text-[10px] font-black text-rose-700 mb-1 flex items-center gap-1.5">
                <ThumbsDown size={11} /> نقاط للتحسين
              </p>
              <p className="text-xs text-rose-900 font-bold leading-relaxed whitespace-pre-line">{goal.weaknesses}</p>
            </div>
          )}

          {goal.leader_note && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-start gap-2">
              <Lightbulb size={12} className="text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-900 font-bold leading-relaxed italic">{goal.leader_note}</p>
            </div>
          )}

          {goal.evaluator_name && (
            <p className="text-[10px] text-gray-400 font-bold flex items-center gap-1 pt-1">
              <Clock size={10} />
              تقييم بواسطة {goal.evaluator_name} · {new Date(goal.evaluated_at).toLocaleString('ar-EG')}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      {(onEdit || onDelete || onEvaluate) && (
        <div className="px-4 py-2.5 border-t border-gray-50 bg-gray-50/30 flex items-center gap-2 flex-wrap">
          {variant === 'leader' && isPending && onEvaluate && (
            <button onClick={() => onEvaluate(goal)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-black shadow-sm">
              <Award size={12} /> تقييم
            </button>
          )}
          {variant === 'leader' && !isPending && onEvaluate && (
            <button onClick={() => onEvaluate(goal)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-black shadow-sm">
              <Edit2 size={12} /> إعادة تقييم
            </button>
          )}
          {onEdit && (variant === 'leader' || isPending) && (
            <button onClick={() => onEdit(goal)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-black">
              <Edit2 size={12} /> تعديل
            </button>
          )}
          {onDelete && (variant === 'leader' || isPending) && (
            <button onClick={() => onDelete(goal)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-xs font-black">
              <Trash2 size={12} /> حذف
            </button>
          )}
          {variant === 'agent' && !isPending && (
            <span className="text-[10px] text-gray-400 font-bold italic">
              تم تقييمه — لا يمكن التعديل
            </span>
          )}
        </div>
      )}
    </div>
  );
}
