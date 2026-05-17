import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, Circle, Star, Sun, Calendar, CalendarDays, Clock,
  Plus, X, Trash2, Edit3, AlertCircle, Zap, ChevronDown, ChevronUp,
  MessageSquare, Send, ListTodo, Sparkles, Filter,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

const PRIORITY_CFG = {
  urgent: { label: 'عاجل',   color: 'bg-red-100 text-red-700 border-red-200',       dot: 'bg-red-500',     emoji: '🔴' },
  high:   { label: 'مرتفع',  color: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-500',  emoji: '🟠' },
  normal: { label: 'عادي',   color: 'bg-blue-100 text-blue-700 border-blue-200',    dot: 'bg-blue-400',    emoji: '🔵' },
  low:    { label: 'منخفض',  color: 'bg-gray-100 text-gray-600 border-gray-200',    dot: 'bg-gray-400',    emoji: '⚪' },
};

const STATUS_CFG = {
  new:         { label: 'جديدة',     color: 'bg-blue-50 text-blue-700' },
  in_progress: { label: 'قيد التنفيذ', color: 'bg-amber-50 text-amber-700' },
  on_hold:     { label: 'معلّقة',    color: 'bg-gray-100 text-gray-700' },
  completed:   { label: 'مكتملة',    color: 'bg-emerald-50 text-emerald-700' },
  cancelled:   { label: 'ملغاة',     color: 'bg-rose-50 text-rose-700' },
};

const BUCKETS = [
  { key: 'overdue',   label: 'متأخّر',        icon: AlertCircle,  color: 'text-red-600' },
  { key: 'today',     label: 'اليوم',         icon: Sun,          color: 'text-amber-600' },
  { key: 'tomorrow',  label: 'الغد',          icon: Calendar,     color: 'text-blue-600' },
  { key: 'this_week', label: 'هذا الأسبوع',   icon: CalendarDays, color: 'text-violet-600' },
  { key: 'later',     label: 'لاحقاً',         icon: Clock,        color: 'text-gray-500' },
  { key: 'completed', label: 'مكتملة',        icon: CheckCircle2, color: 'text-emerald-600' },
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Confetti ─────────────────────────────────────────────────────────────────
function fireConfetti() {
  const colors = ['#ec4899', '#a855f7', '#3b82f6', '#22c55e', '#f59e0b'];
  for (let i = 0; i < 30; i++) {
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed; width: 8px; height: 8px; pointer-events: none; z-index: 9999;
      left: ${50 + (Math.random() - 0.5) * 30}vw; top: ${50}vh;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      transition: all 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = `translate(${(Math.random() - 0.5) * 600}px, ${-Math.random() * 400 - 100}px) rotate(${Math.random() * 720}deg)`;
      el.style.opacity = '0';
    });
    setTimeout(() => el.remove(), 1300);
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MyTodos() {
  const [activeBucket, setActiveBucket] = useState('today');
  const [editing, setEditing]   = useState(null);   // todo being edited
  const [creating, setCreating] = useState(false);  // show create modal
  const [openId, setOpenId]     = useState(null);   // detail panel
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['todos', 'bucket', activeBucket],
    queryFn: () => api.get('/todos', { params: { bucket: activeBucket } }).then(r => r.data),
    staleTime: 30 * 1000,
  });

  const { data: stats } = useQuery({
    queryKey: ['todos', 'stats'],
    queryFn: () => api.get('/todos/stats').then(r => r.data),
    staleTime: 30 * 1000,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, currentStatus }) => api.patch(`/todos/${id}`, {
      status: currentStatus === 'completed' ? 'in_progress' : 'completed',
    }),
    onSuccess: (res, vars) => {
      if (vars.currentStatus !== 'completed') fireConfetti();
      qc.invalidateQueries({ queryKey: ['todos'] });
    },
  });

  const todos = data?.todos || [];

  return (
    <div className="space-y-5">
      <PageHero
        title="مهامي اليوم"
        subtitle="نظام إدارة المهام الشخصية والمكلّف بها"
        icon={ListTodo}
        gradient="from-rose-500 to-pink-500"
      />

      {/* Greeting + Quick Stats */}
      <div className="bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 border border-orange-200 rounded-2xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg">
              <Sparkles size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800">صباح الخير 👋</h2>
              <p className="text-sm text-gray-600">
                {stats?.due_today_count > 0
                  ? `عندك ${stats.due_today_count} مهمة لازم تخلصها النهاردة`
                  : 'مفيش مهام مطلوبة اليوم — وقت لإنجاز الـ later! ✨'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white font-bold text-sm flex items-center gap-2 shadow-md transition"
          >
            <Plus size={16} />
            مهمة جديدة
          </button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
            <MiniStat label="متأخّر"      value={stats.overdue_count    || 0} icon={AlertCircle} color="text-red-600" />
            <MiniStat label="اليوم"        value={stats.due_today_count  || 0} icon={Sun}         color="text-amber-600" />
            <MiniStat label="قيد التنفيذ"  value={stats.in_progress_count|| 0} icon={Zap}         color="text-blue-600" />
            <MiniStat label="عاجل مفتوح"  value={stats.urgent_open      || 0} icon={Star}        color="text-rose-600" />
            <MiniStat label="مكتملة"      value={stats.completed_count  || 0} icon={CheckCircle2} color="text-emerald-600" />
          </div>
        )}
      </div>

      {/* Buckets tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {BUCKETS.map(b => {
          const Icon = b.icon;
          const isActive = activeBucket === b.key;
          return (
            <button
              key={b.key}
              onClick={() => setActiveBucket(b.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap transition
                ${isActive ? 'bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-md' : 'bg-white border border-gray-200 hover:bg-gray-50 text-gray-700'}`}
            >
              <Icon size={14} className={isActive ? 'text-white' : b.color} />
              {b.label}
            </button>
          );
        })}
      </div>

      {/* Todo list */}
      <div className="space-y-2">
        {isLoading ? (
          <p className="text-center py-12 text-gray-400 text-sm">جاري التحميل...</p>
        ) : todos.length === 0 ? (
          <EmptyState bucket={activeBucket} />
        ) : (
          todos.map(t => (
            <TodoCard
              key={t.id}
              todo={t}
              onToggle={() => toggleMutation.mutate({ id: t.id, currentStatus: t.status })}
              onEdit={() => setEditing(t)}
              onOpen={() => setOpenId(t.id)}
            />
          ))
        )}
      </div>

      {/* Modals */}
      {(creating || editing) && (
        <TodoEditModal
          todo={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['todos'] });
            setCreating(false); setEditing(null);
          }}
        />
      )}
      {openId && (
        <TodoDetailModal
          id={openId}
          onClose={() => setOpenId(null)}
          onEdit={(t) => { setOpenId(null); setEditing(t); }}
          onDeleted={() => {
            qc.invalidateQueries({ queryKey: ['todos'] });
            setOpenId(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Components ───────────────────────────────────────────────────────────────
function MiniStat({ label, value, icon: Icon, color }) {
  return (
    <div className="bg-white/70 backdrop-blur rounded-lg px-3 py-2 flex items-center gap-2 border border-white">
      <Icon size={14} className={color} />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-gray-500 font-bold truncate">{label}</p>
        <p className={`text-lg font-black ${color} tabular-nums leading-tight`}>{value}</p>
      </div>
    </div>
  );
}

function TodoCard({ todo, onToggle, onEdit, onOpen }) {
  const p = PRIORITY_CFG[todo.priority] || PRIORITY_CFG.normal;
  const done = todo.status === 'completed';
  const overdue = !done && todo.due_date && todo.due_date < todayStr();

  return (
    <div className={`bg-white rounded-xl border ${overdue ? 'border-red-200' : 'border-gray-100'} hover:border-rose-300 hover:shadow-sm transition group p-3 flex items-center gap-3`}>
      <button
        onClick={onToggle}
        className="flex-shrink-0 hover:scale-110 transition"
        title={done ? 'إعادة فتح' : 'إنهاء'}
      >
        {done ? (
          <CheckCircle2 size={26} className="text-emerald-500" />
        ) : (
          <Circle size={26} className="text-gray-300 hover:text-rose-400" />
        )}
      </button>

      <div className="flex-1 min-w-0 cursor-pointer" onClick={onOpen}>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={`w-1.5 h-1.5 rounded-full ${p.dot} flex-shrink-0`}></span>
          <h3 className={`font-bold text-sm ${done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
            {todo.title}
          </h3>
          {todo.priority === 'urgent' && !done && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500 text-white">عاجل</span>
          )}
        </div>
        {todo.description && (
          <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{todo.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500">
          {todo.due_date && (
            <span className={`inline-flex items-center gap-1 ${overdue ? 'text-red-600 font-bold' : ''}`}>
              <Calendar size={11} />
              {todo.due_date}
              {todo.due_time && ` • ${todo.due_time}`}
            </span>
          )}
          {todo.comment_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare size={11} /> {todo.comment_count}
            </span>
          )}
          {todo.assigned_to_name && todo.assigned_to !== todo.created_by && (
            <span className="inline-flex items-center gap-1 text-violet-600">
              مكلّف من {todo.created_by_name}
            </span>
          )}
        </div>
      </div>

      <button onClick={onEdit} className="opacity-0 group-hover:opacity-100 transition p-1.5 hover:bg-gray-100 rounded-lg" title="تعديل">
        <Edit3 size={14} className="text-gray-500" />
      </button>
    </div>
  );
}

function EmptyState({ bucket }) {
  const messages = {
    overdue:   { icon: '🎉', text: 'مفيش مهام متأخّرة — كل حاجة تمام!' },
    today:     { icon: '☀️', text: 'مفيش مهام اليوم — استمتع بوقتك!' },
    tomorrow:  { icon: '🌟', text: 'مفيش مهام لبكرة — وقت للتخطيط!' },
    this_week: { icon: '📆', text: 'مفيش مهام هذا الأسبوع' },
    later:     { icon: '🌤️', text: 'مفيش مهام لاحقة' },
    completed: { icon: '✨', text: 'لسه ما خلّصتش أي مهام' },
  };
  const m = messages[bucket] || { icon: '📝', text: 'مفيش مهام هنا' };
  return (
    <div className="text-center py-16">
      <div className="text-5xl mb-3">{m.icon}</div>
      <p className="text-gray-500 font-bold">{m.text}</p>
    </div>
  );
}

// ─── Edit / Create Modal ──────────────────────────────────────────────────────
function TodoEditModal({ todo, onClose, onSaved }) {
  const isEdit = !!todo;
  const [title, setTitle] = useState(todo?.title || '');
  const [description, setDescription] = useState(todo?.description || '');
  const [priority, setPriority] = useState(todo?.priority || 'normal');
  const [status, setStatus] = useState(todo?.status || 'new');
  const [dueDate, setDueDate] = useState(todo?.due_date || '');
  const [dueTime, setDueTime] = useState(todo?.due_time || '');
  const [assignedTo, setAssignedTo] = useState(todo?.assigned_to || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const titleRef = useRef(null);

  const { data: usersData } = useQuery({
    queryKey: ['todos', 'assignable-users'],
    queryFn: () => api.get('/todos/assignable-users').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    setTimeout(() => titleRef.current?.focus(), 100);
  }, []);

  // Keyboard: Esc closes, Cmd/Ctrl+Enter saves
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  async function save() {
    if (!title.trim()) { setError('العنوان مطلوب'); return; }
    setSubmitting(true); setError(null);
    try {
      const body = {
        title, description, priority, status,
        due_date: dueDate || null,
        due_time: dueTime || null,
        assigned_to: assignedTo || null,
      };
      if (isEdit) {
        await api.patch(`/todos/${todo.id}`, body);
      } else {
        await api.post('/todos', body);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-gradient-to-r from-rose-50 to-pink-50 border-b flex items-center justify-between">
          <h3 className="font-bold text-gray-900">{isEdit ? 'تعديل المهمة' : 'مهمة جديدة'}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-white rounded-lg"><X size={18} className="text-gray-600" /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>}

          <Field label="العنوان *">
            <input ref={titleRef} type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="مثلاً: اتصل بأحمد 5 مساءً" autoFocus
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-rose-300 outline-none" />
          </Field>

          <Field label="الوصف">
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="تفاصيل اختيارية..." rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-rose-300 outline-none resize-none" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="الأهمية">
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white">
                {Object.entries(PRIORITY_CFG).map(([k, c]) => (
                  <option key={k} value={k}>{c.emoji} {c.label}</option>
                ))}
              </select>
            </Field>
            <Field label="الحالة">
              <select value={status} onChange={e => setStatus(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white">
                {Object.entries(STATUS_CFG).map(([k, c]) => (
                  <option key={k} value={k}>{c.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="تاريخ الاستحقاق">
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
            </Field>
            <Field label="الوقت (اختياري)">
              <input type="time" value={dueTime} onChange={e => setDueTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
            </Field>
          </div>

          {usersData?.users && usersData.users.length > 1 && (
            <Field label="مُكلّف لـ">
              <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white">
                <option value="">— نفسي —</option>
                {usersData.users.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <div className="px-5 py-3 bg-gray-50 border-t flex items-center justify-between gap-2">
          <span className="text-[10px] text-gray-500">⌘+Enter للحفظ • Esc للإغلاق</span>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-100">إلغاء</button>
            <button onClick={save} disabled={submitting}
              className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-rose-500 to-pink-500 text-white text-sm font-bold disabled:opacity-50">
              {submitting ? 'جاري الحفظ...' : (isEdit ? 'تحديث' : 'حفظ')}
            </button>
          </div>
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

// ─── Detail Modal (with comments) ─────────────────────────────────────────────
function TodoDetailModal({ id, onClose, onEdit, onDeleted }) {
  const qc = useQueryClient();
  const [newComment, setNewComment] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['todos', id],
    queryFn: () => api.get(`/todos/${id}`).then(r => r.data),
  });

  const addCommentMut = useMutation({
    mutationFn: () => api.post(`/todos/${id}/comments`, { comment: newComment }),
    onSuccess: () => {
      setNewComment('');
      qc.invalidateQueries({ queryKey: ['todos', id] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/todos/${id}`),
    onSuccess: () => onDeleted(),
  });

  if (isLoading || !data) return null;
  const t = data.todo;
  const p = PRIORITY_CFG[t.priority] || PRIORITY_CFG.normal;
  const s = STATUS_CFG[t.status] || STATUS_CFG.new;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-gradient-to-r from-rose-50 to-pink-50 border-b flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${p.color}`}>{p.emoji} {p.label}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${s.color}`}>{s.label}</span>
            </div>
            <h3 className="font-bold text-gray-900 text-lg">{t.title}</h3>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => onEdit(t)} className="p-1.5 hover:bg-white rounded-lg" title="تعديل"><Edit3 size={16} className="text-gray-600" /></button>
            <button onClick={() => { if (confirm('حذف المهمة؟')) deleteMut.mutate(); }} className="p-1.5 hover:bg-red-50 rounded-lg" title="حذف"><Trash2 size={16} className="text-red-500" /></button>
            <button onClick={onClose} className="p-1.5 hover:bg-white rounded-lg"><X size={18} className="text-gray-600" /></button>
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
            <DetailRow label="تاريخ الاستحقاق" value={t.due_date ? `${t.due_date}${t.due_time ? ' ' + t.due_time : ''}` : '—'} />
            <DetailRow label="المُكلّف بها" value={t.assigned_to_name || '—'} />
            <DetailRow label="أنشأها" value={t.created_by_name || '—'} />
            <DetailRow label="أُنشئت في" value={t.created_at?.replace('T', ' ').slice(0, 16) || '—'} />
            {t.completed_at && <DetailRow label="اكتملت في" value={t.completed_at.replace('T', ' ').slice(0, 16)} />}
          </div>

          {/* Comments */}
          <div className="border-t pt-3">
            <p className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1">
              <MessageSquare size={12} /> التعليقات ({data.comments.length})
            </p>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {data.comments.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-3">لا توجد تعليقات</p>
              )}
              {data.comments.map(c => (
                <div key={c.id} className="bg-gray-50 rounded-lg p-2 text-sm">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-xs text-gray-700">{c.user_name || '—'}</span>
                    <span className="text-[10px] text-gray-500">{c.created_at?.replace('T', ' ').slice(0, 16)}</span>
                  </div>
                  <p className="text-gray-800 whitespace-pre-wrap text-xs">{c.comment}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <input
                type="text"
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newComment.trim()) addCommentMut.mutate(); }}
                placeholder="اكتب تعليق..."
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-rose-300 outline-none"
              />
              <button
                onClick={() => addCommentMut.mutate()}
                disabled={!newComment.trim() || addCommentMut.isPending}
                className="px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white disabled:opacity-40">
                <Send size={14} />
              </button>
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
