import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Kanban as KanbanIcon, Plus, X, Trash2, Edit3, Send, Filter, Search,
  AlertCircle, Calendar, MessageSquare, Users as UsersIcon, RefreshCw,
  UserCircle, Star, Clock, Zap, CheckCircle2,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

const PRIORITY_CFG = {
  urgent: { label: 'عاجل',  emoji: '🔴', cls: 'border-red-300 bg-red-50',     dot: 'bg-red-500' },
  high:   { label: 'مرتفع', emoji: '🟠', cls: 'border-orange-300 bg-orange-50', dot: 'bg-orange-500' },
  normal: { label: 'عادي',  emoji: '🔵', cls: 'border-blue-300 bg-blue-50',   dot: 'bg-blue-500' },
  low:    { label: 'منخفض', emoji: '⚪', cls: 'border-gray-300 bg-gray-50',    dot: 'bg-gray-400' },
};

const COLUMNS = [
  { key: 'new',         label: 'جديدة',       icon: '📥', accent: 'border-blue-400 bg-blue-50/40' },
  { key: 'in_progress', label: 'قيد التنفيذ', icon: '🔄', accent: 'border-amber-400 bg-amber-50/40' },
  { key: 'on_hold',     label: 'معلّقة',      icon: '⏸️', accent: 'border-gray-400 bg-gray-50/40' },
  { key: 'completed',   label: 'مكتملة',      icon: '✅', accent: 'border-emerald-400 bg-emerald-50/40' },
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function LeaderTodos() {
  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [openId, setOpenId] = useState(null);
  const qc = useQueryClient();

  const { data: todosData, isLoading } = useQuery({
    queryKey: ['todos', 'all'],
    queryFn: () => api.get('/todos', { params: { limit: 1000 } }).then(r => r.data),
    staleTime: 20 * 1000,
  });

  const { data: summary } = useQuery({
    queryKey: ['todos', 'team-summary'],
    queryFn: () => api.get('/todos/team-summary').then(r => r.data),
    staleTime: 30 * 1000,
  });

  const { data: usersData } = useQuery({
    queryKey: ['todos', 'assignable-users'],
    queryFn: () => api.get('/todos/assignable-users').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const moveStatus = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/todos/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos'] }),
  });

  const filtered = useMemo(() => {
    const list = todosData?.todos || [];
    return list.filter(t => {
      if (filterPriority && t.priority !== filterPriority) return false;
      if (filterAssignee && String(t.assigned_to) !== String(filterAssignee)) return false;
      if (search) {
        const q = search.toLowerCase();
        return (t.title || '').toLowerCase().includes(q)
          || (t.description || '').toLowerCase().includes(q)
          || (t.assigned_to_name || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [todosData, filterPriority, filterAssignee, search]);

  const byColumn = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map(c => [c.key, []]));
    filtered.forEach(t => {
      const col = t.status === 'cancelled' ? 'on_hold' : t.status;
      if (map[col]) map[col].push(t);
    });
    return map;
  }, [filtered]);

  function onDragStart(e, todo) {
    e.dataTransfer.setData('todo-id', String(todo.id));
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  function onDrop(e, status) {
    e.preventDefault();
    const id = e.dataTransfer.getData('todo-id');
    const todo = filtered.find(t => String(t.id) === id);
    if (!todo || todo.status === status) return;
    moveStatus.mutate({ id, status });
  }

  const activeFilters = (filterPriority ? 1 : 0) + (filterAssignee ? 1 : 0) + (search ? 1 : 0);

  return (
    <div className="space-y-4">
      <PageHero
        title="مهام الفريق"
        subtitle="لوحة Kanban — اسحب البطاقات بين الأعمدة لتغيير الحالة"
        icon={KanbanIcon}
        gradient="from-indigo-500 to-purple-600"
      />

      {/* Top bar */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="بحث في العنوان / الوصف / المسؤول..."
            className="w-full pl-3 pr-8 py-1.5 rounded-lg border border-gray-300 text-sm outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>

        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm bg-white">
          <option value="">كل الأهمية</option>
          {Object.entries(PRIORITY_CFG).map(([k, c]) => (
            <option key={k} value={k}>{c.emoji} {c.label}</option>
          ))}
        </select>

        <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm bg-white">
          <option value="">كل الموظفين</option>
          {(usersData?.users || []).map(u => (
            <option key={u.id} value={u.id}>{u.full_name}</option>
          ))}
        </select>

        {activeFilters > 0 && (
          <button onClick={() => { setSearch(''); setFilterPriority(''); setFilterAssignee(''); }}
            className="px-2 py-1.5 rounded-lg text-xs text-indigo-600 hover:bg-indigo-50">مسح ({activeFilters})</button>
        )}

        <button onClick={() => qc.invalidateQueries({ queryKey: ['todos'] })}
          className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm flex items-center gap-1.5">
          <RefreshCw size={14} /> تحديث
        </button>

        <button onClick={() => setCreating(true)}
          className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white text-sm font-bold flex items-center gap-1.5 ml-auto">
          <Plus size={14} /> مهمة جديدة
        </button>
      </div>

      {/* Team Summary */}
      {summary?.rows && summary.rows.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <UsersIcon size={16} className="text-indigo-600" />
            <h3 className="font-bold text-gray-800 text-sm">ملخص الفريق</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {summary.rows.slice(0, 12).map(r => (
              <button
                key={r.assigned_to}
                onClick={() => setFilterAssignee(String(r.assigned_to))}
                className="bg-gray-50 hover:bg-indigo-50 border border-gray-200 hover:border-indigo-300 rounded-lg p-2 text-right transition"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <UserCircle size={12} className="text-gray-400" />
                  <span className="text-xs font-bold text-gray-700 truncate">{r.assigned_to_name || '—'}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="text-blue-600 font-bold">{r.open_count} مفتوحة</span>
                  {r.overdue > 0 && <span className="text-red-600 font-bold">{r.overdue} متأخر</span>}
                  {r.urgent_open > 0 && <span className="text-orange-600 font-bold">{r.urgent_open} عاجل</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {COLUMNS.map(col => (
          <div key={col.key}
               onDragOver={onDragOver}
               onDrop={(e) => onDrop(e, col.key)}
               className={`bg-white rounded-2xl shadow-sm border-2 ${col.accent} min-h-[400px] flex flex-col`}>
            <div className="px-4 py-3 border-b border-current/10 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <span>{col.icon}</span>
                {col.label}
              </h3>
              <span className="text-xs font-bold text-gray-500 bg-white px-2 py-0.5 rounded-full">
                {byColumn[col.key]?.length || 0}
              </span>
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-360px)]">
              {isLoading ? (
                <p className="text-center text-xs text-gray-400 py-8">جاري التحميل...</p>
              ) : byColumn[col.key].length === 0 ? (
                <p className="text-center text-xs text-gray-400 py-8">فاضي</p>
              ) : (
                byColumn[col.key].map(t => (
                  <KanbanCard key={t.id} todo={t}
                    onDragStart={(e) => onDragStart(e, t)}
                    onClick={() => setOpenId(t.id)}
                    onEdit={() => setEditing(t)}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {(creating || editing) && (
        <TodoEditModal todo={editing} usersData={usersData}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['todos'] }); setCreating(false); setEditing(null); }}
        />
      )}
      {openId && (
        <TodoDetailModal id={openId}
          onClose={() => setOpenId(null)}
          onEdit={(t) => { setOpenId(null); setEditing(t); }}
          onDeleted={() => { qc.invalidateQueries({ queryKey: ['todos'] }); setOpenId(null); }}
        />
      )}
    </div>
  );
}

// ─── Kanban Card ──────────────────────────────────────────────────────────────
function KanbanCard({ todo, onDragStart, onClick, onEdit }) {
  const p = PRIORITY_CFG[todo.priority] || PRIORITY_CFG.normal;
  const overdue = todo.status !== 'completed' && todo.due_date && todo.due_date < todayStr();
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={`bg-white rounded-lg border ${p.cls} ${overdue ? 'ring-2 ring-red-300' : ''} p-2.5 cursor-grab active:cursor-grabbing hover:shadow-md transition group`}
    >
      <div className="flex items-start gap-2">
        <span className={`w-1 self-stretch ${p.dot} rounded-full flex-shrink-0`}></span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-1">
            <h4 className="font-bold text-xs text-gray-800 line-clamp-2">{todo.title}</h4>
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="opacity-0 group-hover:opacity-100 transition p-0.5 hover:bg-gray-100 rounded">
              <Edit3 size={11} className="text-gray-400" />
            </button>
          </div>
          {todo.description && (
            <p className="text-[10px] text-gray-500 line-clamp-2 mt-1">{todo.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-500 flex-wrap">
            {todo.assigned_to_name && (
              <span className="inline-flex items-center gap-0.5 bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-bold">
                <UserCircle size={10} /> {todo.assigned_to_name}
              </span>
            )}
            {todo.due_date && (
              <span className={`inline-flex items-center gap-0.5 ${overdue ? 'text-red-600 font-bold' : ''}`}>
                <Calendar size={10} /> {todo.due_date}
              </span>
            )}
            {todo.priority === 'urgent' && (
              <span className="inline-flex items-center gap-0.5 bg-red-500 text-white px-1.5 py-0.5 rounded font-bold">
                <Star size={9} /> عاجل
              </span>
            )}
            {todo.parent_todo_id && (
              <span className="inline-flex items-center gap-0.5 bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-bold" title="مهمة يومية متكررة">🔁 يومي</span>
            )}
            {todo.comment_count > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <MessageSquare size={10} /> {todo.comment_count}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Reused: Edit + Detail Modal (same as agent's) ────────────────────────────
function TodoEditModal({ todo, usersData, onClose, onSaved }) {
  const isEdit = !!todo;
  const isInstance = !!todo?.parent_todo_id;
  const [title, setTitle] = useState(todo?.title || '');
  const [description, setDescription] = useState(todo?.description || '');
  const [priority, setPriority] = useState(todo?.priority || 'normal');
  const [status, setStatus] = useState(todo?.status || 'new');
  const [dueDate, setDueDate] = useState(todo?.due_date || '');
  const [dueTime, setDueTime] = useState(todo?.due_time || '');
  const [assignedTo, setAssignedTo] = useState(todo?.assigned_to || '');
  const [isRecurring, setIsRecurring] = useState(todo?.is_recurring === 1);
  const [recurrencePattern, setRecurrencePattern] = useState(todo?.recurrence_pattern || 'daily');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    if (!title.trim()) { setError('العنوان مطلوب'); return; }
    setSubmitting(true); setError(null);
    try {
      const body = {
        title, description, priority, status,
        due_date: dueDate || null, due_time: dueTime || null,
        assigned_to: assignedTo || null,
        is_recurring: isRecurring && !isInstance ? 1 : 0,
        recurrence_pattern: isRecurring && !isInstance ? recurrencePattern : null,
      };
      if (isEdit) await api.patch(`/todos/${todo.id}`, body);
      else        await api.post('/todos', body);
      onSaved();
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-gradient-to-r from-indigo-50 to-purple-50 border-b flex items-center justify-between">
          <h3 className="font-bold text-gray-900">{isEdit ? 'تعديل المهمة' : 'مهمة جديدة'}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-white rounded-lg"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>}
          <Field label="العنوان *">
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} autoFocus
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-indigo-300 outline-none" />
          </Field>
          <Field label="الوصف">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-indigo-300 outline-none resize-none" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الأهمية">
              <select value={priority} onChange={e => setPriority(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white">
                {Object.entries(PRIORITY_CFG).map(([k, c]) => (<option key={k} value={k}>{c.emoji} {c.label}</option>))}
              </select>
            </Field>
            <Field label="الحالة">
              <select value={status} onChange={e => setStatus(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white">
                <option value="new">جديدة</option>
                <option value="in_progress">قيد التنفيذ</option>
                <option value="on_hold">معلّقة</option>
                <option value="completed">مكتملة</option>
                <option value="cancelled">ملغاة</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="تاريخ الاستحقاق">
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
            </Field>
            <Field label="الوقت">
              <input type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
            </Field>
          </div>
          <Field label="مُكلّف لـ *">
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white">
              <option value="">— اختار —</option>
              {(usersData?.users || []).map(u => (
                <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
              ))}
            </select>
          </Field>

          <div className="bg-indigo-50/50 border border-indigo-200 rounded-lg p-3">
            {isInstance ? (
              <p className="text-xs text-indigo-700">
                🔁 هذه نسخة يومية من قالب متكرر. عدّل القالب لتغيير التكرار.
              </p>
            ) : (
              <>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isRecurring}
                    onChange={e => setIsRecurring(e.target.checked)}
                    className="w-4 h-4 accent-indigo-500" />
                  <span className="text-sm font-bold text-gray-800">🔁 مهمة متكررة</span>
                </label>
                {isRecurring && (
                  <select value={recurrencePattern} onChange={e => setRecurrencePattern(e.target.value)}
                    className="mt-2 w-full px-3 py-2 rounded-lg border border-indigo-300 text-sm bg-white">
                    <option value="daily">كل يوم</option>
                    <option value="weekly:sat,sun,mon,tue,wed,thu">أيام العمل (سبت - خميس)</option>
                    <option value="weekly:sat,sun,mon,tue,wed">سبت - أربعاء</option>
                    <option value="weekly:fri,sat">عطلة (جمعة - سبت)</option>
                    <option value="weekly:sun">كل أحد</option>
                    <option value="weekly:mon">كل إثنين</option>
                    <option value="weekly:tue">كل ثلاثاء</option>
                    <option value="weekly:wed">كل أربعاء</option>
                    <option value="weekly:thu">كل خميس</option>
                    <option value="weekly:fri">كل جمعة</option>
                    <option value="weekly:sat">كل سبت</option>
                  </select>
                )}
              </>
            )}
          </div>
        </div>
        <div className="px-5 py-3 bg-gray-50 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-100">إلغاء</button>
          <button onClick={save} disabled={submitting} className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-bold disabled:opacity-50">
            {submitting ? 'جاري الحفظ...' : (isEdit ? 'تحديث' : 'حفظ')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-gray-600 block mb-1">{label}</span>
      {children}
    </label>
  );
}

function TodoDetailModal({ id, onClose, onEdit, onDeleted }) {
  const qc = useQueryClient();
  const [newComment, setNewComment] = useState('');
  const { data } = useQuery({
    queryKey: ['todos', id],
    queryFn: () => api.get(`/todos/${id}`).then(r => r.data),
  });
  const addCommentMut = useMutation({
    mutationFn: () => api.post(`/todos/${id}/comments`, { comment: newComment }),
    onSuccess: () => { setNewComment(''); qc.invalidateQueries({ queryKey: ['todos', id] }); },
  });
  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/todos/${id}`),
    onSuccess: () => onDeleted(),
  });
  if (!data) return null;
  const t = data.todo;
  const p = PRIORITY_CFG[t.priority] || PRIORITY_CFG.normal;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-gradient-to-r from-indigo-50 to-purple-50 border-b flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${p.cls}`}>{p.emoji} {p.label}</span>
            </div>
            <h3 className="font-bold text-gray-900 text-lg">{t.title}</h3>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => onEdit(t)} className="p-1.5 hover:bg-white rounded-lg"><Edit3 size={16} /></button>
            <button onClick={() => { if (confirm('حذف المهمة؟')) deleteMut.mutate(); }} className="p-1.5 hover:bg-red-50 rounded-lg"><Trash2 size={16} className="text-red-500" /></button>
            <button onClick={onClose} className="p-1.5 hover:bg-white rounded-lg"><X size={18} /></button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {t.description && (
            <div>
              <p className="text-xs font-bold text-gray-500 mb-1">الوصف</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{t.description}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <DetailRow label="المُكلّف بها" value={t.assigned_to_name || '—'} />
            <DetailRow label="أنشأها" value={t.created_by_name || '—'} />
            <DetailRow label="تاريخ الاستحقاق" value={t.due_date || '—'} />
            <DetailRow label="الحالة" value={t.status} />
          </div>
          <div className="border-t pt-3">
            <p className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1">
              <MessageSquare size={12} /> التعليقات ({data.comments.length})
            </p>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {data.comments.map(c => (
                <div key={c.id} className="bg-gray-50 rounded-lg p-2 text-sm">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-xs">{c.user_name}</span>
                    <span className="text-[10px] text-gray-500">{c.created_at?.replace('T', ' ').slice(0, 16)}</span>
                  </div>
                  <p className="text-xs whitespace-pre-wrap">{c.comment}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <input type="text" value={newComment} onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newComment.trim()) addCommentMut.mutate(); }}
                placeholder="اكتب تعليق..." className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:ring-2 focus:ring-indigo-300" />
              <button onClick={() => addCommentMut.mutate()} disabled={!newComment.trim()}
                className="px-3 py-2 rounded-lg bg-indigo-500 text-white disabled:opacity-40"><Send size={14} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm text-gray-800 font-semibold">{value}</p>
    </div>
  );
}
