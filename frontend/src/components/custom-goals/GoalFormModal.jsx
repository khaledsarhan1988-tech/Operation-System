import { useState, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { X, Save, Target, AlertTriangle, User as UserIcon } from 'lucide-react';
import api from '../../api/axios';

const MONTH_NAMES_AR = ['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const UNIT_OPTIONS = [
  { value: '%',     label: 'نسبة مئوية (%)' },
  { value: 'عميل',   label: 'عميل' },
  { value: 'تاسك',   label: 'تاسك' },
  { value: 'جلسة',   label: 'جلسة' },
  { value: 'نقطة',   label: 'نقطة' },
  { value: 'مجموعة', label: 'مجموعة' },
];

/**
 * GoalFormModal — used in both agent (mode='agent') and leader (mode='leader') views.
 *
 * Props:
 *   open, onClose
 *   goal               — null for create, object for edit
 *   mode               — 'agent' or 'leader'
 *   onSuccess          — callback after successful save
 */
export default function GoalFormModal({ open, onClose, goal, mode = 'agent', onSuccess }) {
  const qc = useQueryClient();
  const isEdit = !!goal;
  const today = new Date();

  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [unit, setUnit]               = useState('%');
  const [unitCustom, setUnitCustom]   = useState('');
  const [year, setYear]               = useState(today.getFullYear());
  const [month, setMonth]             = useState(today.getMonth() + 1);
  const [usePeriod, setUsePeriod]     = useState(true);
  const [agentId, setAgentId]         = useState('');

  // Leader: get list of team agents (only when creating new)
  const { data: teamAgents = [] } = useQuery({
    queryKey: ['team-agents-for-goals'],
    queryFn: () => api.get('/custom-goals/team-agents').then(r => r.data),
    enabled: open && mode === 'leader' && !isEdit,
  });

  useEffect(() => {
    if (open) {
      setTitle(goal?.title || '');
      setDescription(goal?.description || '');
      setTargetValue(goal?.target_value ?? '');
      setUnit(goal?.unit || '%');
      setUnitCustom(goal?.unit_custom || '');
      setUsePeriod(!!(goal?.year && goal?.month));
      setYear(goal?.year || today.getFullYear());
      setMonth(goal?.month || today.getMonth() + 1);
      setAgentId(goal?.user_id || '');
    }
  }, [open, goal]);

  const saveM = useMutation({
    mutationFn: (body) => {
      // Edit goes to mode-specific endpoint
      if (isEdit) {
        return mode === 'leader'
          ? api.put(`/custom-goals/team/${goal.id}`, body)
          : api.put(`/custom-goals/mine/${goal.id}`, body);
      }
      // Create
      return mode === 'leader'
        ? api.post('/custom-goals/team', { ...body, user_id: agentId })
        : api.post('/custom-goals/mine', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-custom-goals'] });
      qc.invalidateQueries({ queryKey: ['team-custom-goals'] });
      qc.invalidateQueries({ queryKey: ['my-progression'] });
      onSuccess?.();
    },
  });

  if (!open) return null;

  const inputCls = 'w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30';

  function handleSave() {
    if (mode === 'leader' && !isEdit && !agentId) {
      return alert('يرجى اختيار الموظف');
    }
    saveM.mutate({
      title, description, target_value: targetValue,
      unit, unit_custom: unit === 'custom' ? unitCustom : null,
      year:  usePeriod ? year  : null,
      month: usePeriod ? month : null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-100 rounded-xl">
              <Target size={18} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900">
                {isEdit ? 'تعديل هدف' : 'هدف جديد'}
              </h2>
              <p className="text-[11px] text-gray-400 font-bold">
                {mode === 'leader' ? 'تعيين هدف لموظف من فريقك' : 'تحدّي شخصي إضافي'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Leader: select agent */}
          {mode === 'leader' && !isEdit && (
            <div>
              <label className="text-xs font-black text-gray-500 mb-1.5 block flex items-center gap-1">
                <UserIcon size={11} /> الموظف
              </label>
              <select value={agentId} onChange={e => setAgentId(e.target.value)} className={inputCls}>
                <option value="">— اختر الموظف —</option>
                {teamAgents.map(a => (
                  <option key={a.id} value={a.id}>{a.full_name} — {a.department}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs font-black text-gray-500 mb-1.5 block">عنوان الهدف *</label>
            <input
              type="text" value={title} onChange={e => setTitle(e.target.value.slice(0, 120))}
              placeholder="مثال: Retention" maxLength={120} className={inputCls}
            />
          </div>

          <div>
            <label className="text-xs font-black text-gray-500 mb-1.5 block">الوصف (اختياري)</label>
            <textarea
              value={description} onChange={e => setDescription(e.target.value.slice(0, 500))}
              rows={2} maxLength={500}
              placeholder="مثال: نسبة العملاء اللي رجعوا للأكاديمية"
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-black text-gray-500 mb-1.5 block">القيمة المستهدفة</label>
              <input
                type="number" min="0" max="100000" value={targetValue}
                onChange={e => setTargetValue(e.target.value)} placeholder="مثال: 80"
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-xs font-black text-gray-500 mb-1.5 block">الوحدة</label>
              <select value={unit} onChange={e => setUnit(e.target.value)} className={inputCls}>
                {UNIT_OPTIONS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
          </div>

          {unit === 'custom' && (
            <div>
              <label className="text-xs font-black text-gray-500 mb-1.5 block">الوحدة المخصصة</label>
              <input
                type="text" value={unitCustom} onChange={e => setUnitCustom(e.target.value.slice(0, 30))}
                placeholder="اكتب الوحدة..." maxLength={30} className={inputCls}
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-xs font-bold text-gray-700 cursor-pointer select-none">
            <input type="checkbox" checked={usePeriod} onChange={e => setUsePeriod(e.target.checked)}
                   className="w-4 h-4 rounded text-indigo-600" />
            تحديد فترة زمنية للهدف
          </label>

          {usePeriod && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-xs font-black text-gray-500 mb-1.5 block">السنة</label>
                <input type="number" min="2020" max="2099" value={year}
                       onChange={e => setYear(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-black text-gray-500 mb-1.5 block">الشهر</label>
                <select value={month} onChange={e => setMonth(e.target.value)} className={inputCls}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <option key={m} value={m}>{MONTH_NAMES_AR[m]}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

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
            <button onClick={handleSave} disabled={saveM.isPending || !title.trim()}
                    className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl font-black text-sm text-white flex items-center justify-center gap-2">
              <Save size={14} /> {saveM.isPending ? '...جارٍ' : 'حفظ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
