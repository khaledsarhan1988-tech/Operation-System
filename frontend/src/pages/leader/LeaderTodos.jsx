import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Kanban as KanbanIcon, Plus, X, Trash2, Edit3, Send, Filter, Search,
  AlertCircle, Calendar, MessageSquare, Users as UsersIcon, RefreshCw,
  UserCircle, Star, Clock, Zap, CheckCircle2, Lock,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import { useAuth } from '../../auth/AuthContext';
import PerformanceMatrix from '../../components/todos/PerformanceMatrix';

// Same content-ownership rule as the backend: only the creator (or super-admin)
// can edit the title/desc/date/etc. Everyone else can only flip the status.
function userOwnsTodo(user, todo) {
  if (!todo) return true;
  if (user?.role === 'admin' && user?.management === 'All') return true;
  return Number(user?.id) === Number(todo.created_by);
}

const PRIORITY_CFG = {
  urgent: { label: 'عاجل',  emoji: '🔴', cls: 'border-red-300 bg-red-50',     dot: 'bg-red-500' },
  high:   { label: 'مرتفع', emoji: '🟠', cls: 'border-orange-300 bg-orange-50', dot: 'bg-orange-500' },
  normal: { label: 'عادي',  emoji: '🔵', cls: 'border-blue-300 bg-blue-50',   dot: 'bg-blue-500' },
  low:    { label: 'منخفض', emoji: '⚪', cls: 'border-gray-300 bg-gray-50',    dot: 'bg-gray-400' },
};

// COLUMNS — Kanban swim-lanes.
//
// "missed" is a VIRTUAL column: it isn't a real status value. Tasks land here
// purely because their effective_end < today AND they're still open. Dropping
// INTO this column is a no-op (handled in onDrop) — to "resolve" a missed
// task the user drags it to in_progress/completed, or completes via the modal.
//
// "on_hold" status is folded into "in_progress" visually so paused work
// still has a home; "cancelled" rows are hidden entirely.
const COLUMNS = [
  { key: 'new',         label: 'جديدة',           icon: '📥', accent: 'border-blue-400 bg-blue-50/40'   },
  { key: 'in_progress', label: 'قيد التنفيذ',     icon: '🔄', accent: 'border-amber-400 bg-amber-50/40' },
  { key: 'missed',      label: 'لم يتم إنجازها', icon: '⚠️', accent: 'border-red-400 bg-red-50/40'     },
  { key: 'completed',   label: 'مكتملة',          icon: '✅', accent: 'border-emerald-400 bg-emerald-50/40' },
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Format minutes-late → Arabic short form ("45 د" / "2 س 15 د" / "1 يوم 3 س")
function formatMinutesLate(mins) {
  const n = Math.max(0, Math.round(Number(mins) || 0));
  if (n === 0) return '';
  if (n < 60) return `${n} د`;
  const h = Math.floor(n / 60);
  const remMin = n % 60;
  if (h < 24) return remMin > 0 ? `${h} س ${remMin} د` : `${h} س`;
  const days = Math.floor(h / 24);
  const remH  = h % 24;
  return remH > 0 ? `${days} يوم ${remH} س` : `${days} يوم`;
}
function formatTimeOnly(dt) {
  if (!dt) return '';
  const m = String(dt).match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

export default function LeaderTodos() {
  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState('matrix'); // 'matrix' (like the admin board) | 'kanban'
  const qc = useQueryClient();

  // Kanban = daily-workflow instances. Fetch ONLY the recent window (last 7
  // days) so the board reflects the current week — not the thousands of
  // ancient auto-generated instances that accumulate forever (which used to
  // fill the 1000-row cap with old "missed" cards and hide everything current).
  const { data: todosData, isLoading } = useQuery({
    queryKey: ['todos', 'kanban'],
    queryFn: () => api.get('/todos', {
      params: { task_kind: 'workflow', due_from: daysAgoStr(7), due_to: todayStr(), limit: 5000 },
    }).then(r => r.data),
    staleTime: 20 * 1000,
  });

  // One-off (manual) tasks are fetched SEPARATELY. The combined list is capped
  // at 1000 rows and daily instances (thousands, sorted oldest-first) crowd out
  // recent one-off tasks — so a manager's freshly-assigned task to a leader was
  // silently truncated and never appeared. task_kind=extra returns only manual
  // tasks (always few), so they can't be pushed off the end.
  const { data: extraData } = useQuery({
    queryKey: ['todos', 'extra'],
    queryFn: () => api.get('/todos', { params: { task_kind: 'extra', limit: 1000 } }).then(r => r.data),
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

  // Same client-side filters, applied to the dedicated one-off list.
  const filteredExtras = useMemo(() => {
    const list = extraData?.todos || [];
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
  }, [extraData, filterPriority, filterAssignee, search]);

  // Kanban shows DAILY WORKFLOW tasks only (instances of recurring templates).
  // Manual/one-off "extra" tasks get their own dedicated section above the
  // board so leaders don't have to hunt through ~143 daily cards to find them.
  const kanbanTodos = useMemo(
    () => filtered.filter(t => t.parent_todo_id != null).sort((a, b) => {
      // Order daily cards by scheduled time (due_time "HH:MM") so each column
      // reads in workflow order (10:00 → 10:15 → …); no-time tasks sink last.
      const ta = a.due_time || '99:99';
      const tb = b.due_time || '99:99';
      return ta.localeCompare(tb) || (a.title || '').localeCompare(b.title || '');
    }),
    [filtered]
  );
  const byColumn = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map(c => [c.key, []]));
    const today = todayStr();
    kanbanTodos.forEach(t => {
      // "missed" wins over the actual status: any open daily task whose
      // effective_end is in the past gets shown here so the leader can act.
      const effectiveEnd = t.due_date_end || t.due_date;
      const isMissed = effectiveEnd && effectiveEnd < today
                       && t.status !== 'completed' && t.status !== 'cancelled';
      let col;
      if (isMissed)                        col = 'missed';
      else if (t.status === 'cancelled')   return;            // hide cancelled
      else if (t.status === 'on_hold')     col = 'in_progress'; // paused → folded into active
      else                                 col = t.status;
      if (map[col]) map[col].push(t);
    });
    return map;
  }, [kanbanTodos]);

  function onDragStart(e, todo) {
    e.dataTransfer.setData('todo-id', String(todo.id));
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  function onDrop(e, status) {
    e.preventDefault();
    // "missed" is a virtual/filter column, not a real status — dropping cards
    // here has no meaning. To "fix" a missed task the user drags it to
    // in_progress or completed (or marks it done from the modal).
    if (status === 'missed') return;
    const id = e.dataTransfer.getData('todo-id');
    const todo = kanbanTodos.find(t => String(t.id) === id);
    if (!todo || todo.status === status) return;
    moveStatus.mutate({ id, status });
  }

  const activeFilters = (filterPriority ? 1 : 0) + (filterAssignee ? 1 : 0) + (search ? 1 : 0);

  return (
    <div className="space-y-4">
      <PageHero
        title="مهام الفريق"
        subtitle="متابعة إنجاز فريقك للمهام اليومية + المهام المُكلّف بها من الإدارة"
        icon={KanbanIcon}
        gradient="from-indigo-500 to-purple-600"
      />

      {/* View switcher — same daily-templates matrix the admin sees, scoped to
          this leader's team; plus the classic Kanban board. */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-1.5 flex gap-1.5">
        <button
          onClick={() => setView('matrix')}
          className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition flex items-center justify-center gap-2
            ${view === 'matrix' ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md' : 'text-gray-600 hover:bg-gray-50'}`}>
          📋 متابعة القوالب اليومية
        </button>
        <button
          onClick={() => setView('kanban')}
          className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition flex items-center justify-center gap-2
            ${view === 'kanban' ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-50'}`}>
          🗂️ لوحة كانبان
        </button>
      </div>

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

      {/* Extra (non-daily) tasks — the leader's own + manager-assigned one-off
          work. Shown in BOTH views so it's never hidden behind a tab. */}
      <ExtraTasksSection
        todos={filteredExtras}
        onCardClick={(id) => setOpenId(id)}
        onEdit={(t) => setEditing(t)}
      />

      {/* ── MATRIX VIEW (default) — same board the admin has ── */}
      {view === 'matrix' && (
        <PerformanceMatrix
          onCellClick={setOpenId}
          emptyHint="القوالب اليومية بتظهر هنا لما الإدارة تعيّن جدول أعمال لفريقك"
        />
      )}

      {/* ── KANBAN VIEW ── */}
      {view === 'kanban' && (<>
      {/* Team Summary — per-person card with completion-rate progress bar */}
      {summary?.rows && summary.rows.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <UsersIcon size={16} className="text-indigo-600" />
            <h3 className="font-bold text-gray-800 text-sm">ملخص الفريق</h3>
            <span className="text-[10px] text-gray-400 mr-auto">
              {summary.rows.length} موظف — اضغط على كارت لتصفية المهام
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
            {summary.rows.map(r => {
              const rate = r.completion_rate ?? 0;
              const rateColor =
                rate >= 80 ? 'bg-emerald-500' :
                rate >= 50 ? 'bg-amber-500'   :
                rate > 0   ? 'bg-orange-500'  : 'bg-gray-300';
              const isActive = String(filterAssignee) === String(r.assigned_to);
              return (
                <button
                  key={r.assigned_to}
                  onClick={() => setFilterAssignee(isActive ? '' : String(r.assigned_to))}
                  className={`bg-gray-50 hover:bg-indigo-50 border rounded-lg p-2 text-right transition
                    ${isActive ? 'border-indigo-500 ring-2 ring-indigo-200 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <UserCircle size={12} className="text-gray-400 flex-shrink-0" />
                    <span className="text-xs font-bold text-gray-700 truncate">{r.assigned_to_name || '—'}</span>
                  </div>
                  {/* Completion-rate progress bar */}
                  <div className="mb-1.5">
                    <div className="flex items-center justify-between text-[10px] mb-0.5">
                      <span className="text-gray-500">نسبة الإنجاز</span>
                      <span className="font-bold text-gray-700">{rate}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className={`h-full ${rateColor} transition-all`} style={{ width: `${rate}%` }} />
                    </div>
                    <div className="text-[9px] text-gray-400 mt-0.5">
                      {r.completed || 0} مكتمل من {r.total || 0}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
                    <span className="text-blue-600 font-bold">{r.open_count} مفتوحة</span>
                    {r.extra_open > 0 && <span className="text-purple-600 font-bold">{r.extra_open} إضافية</span>}
                    {r.overdue > 0 && <span className="text-red-600 font-bold">{r.overdue} متأخر</span>}
                    {r.urgent_open > 0 && <span className="text-orange-600 font-bold">{r.urgent_open} عاجل</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Kanban Board — daily workflow tasks only */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-3">
        <div className="flex items-center gap-2 mb-2 px-1">
          <KanbanIcon size={16} className="text-indigo-600" />
          <h3 className="font-bold text-gray-800 text-sm">المهام اليومية (Kanban)</h3>
          <span className="text-[10px] text-gray-400">{kanbanTodos.length} مهمة</span>
        </div>
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
      </div>
      </>)}

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

// ─── Extra Tasks Section ─────────────────────────────────────────────────────
// Manual one-off tasks (NOT daily workflow). Lives above the Kanban so leaders
// see new admin/manager-assigned work at a glance instead of hunting through
// hundreds of recurring daily cards.
function ExtraTasksSection({ todos, onCardClick, onEdit }) {
  // Extras = one-off manual tasks. NOT recurring templates, NOT daily instances.
  const extras = useMemo(
    () => (todos || []).filter(t =>
      (t.is_recurring === 0 || t.is_recurring == null) && t.parent_todo_id == null
    ),
    [todos]
  );
  // Quick split by status for clarity
  const openExtras = extras.filter(t => t.status !== 'completed' && t.status !== 'cancelled');
  const doneExtras = extras.filter(t => t.status === 'completed');

  if (extras.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-3">
        <div className="flex items-center gap-2">
          <span className="w-1 h-5 bg-purple-500 rounded-full"></span>
          <Zap size={16} className="text-purple-500" />
          <h3 className="font-bold text-gray-800 text-sm">المهام الإضافية (غير اليومية)</h3>
          <span className="mr-auto text-[10px] text-gray-500">لا توجد مهام إضافية حالياً</span>
        </div>
      </div>
    );
  }

  // NOTE: outer uses `bg-white` (auto dark-mode mapped via globals.css to
  // #111827). Old gradient `from-purple-50 to-indigo-50` had no dark override
  // and looked invisible in dark mode. Purple accent now comes from a left
  // border bar + colored title text, both of which read in both themes.
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 relative overflow-hidden">
      {/* Accent strip on the right edge (RTL) */}
      <div className="absolute top-0 right-0 bottom-0 w-1.5 bg-gradient-to-b from-purple-500 to-indigo-500"></div>
      <div className="flex items-center gap-2 mb-3 pr-2">
        <Zap size={18} className="text-purple-500" />
        <h3 className="font-bold text-gray-800 text-sm">المهام الإضافية (غير اليومية)</h3>
        <span className="text-[11px] bg-purple-100 text-purple-700 font-bold px-2.5 py-1 rounded-full border border-purple-200">
          {openExtras.length} مفتوحة
        </span>
        {doneExtras.length > 0 && (
          <span className="text-[11px] bg-emerald-100 text-emerald-700 font-bold px-2.5 py-1 rounded-full border border-emerald-200">
            {doneExtras.length} مكتملة
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
        {extras.map(t => (
          <ExtraCard key={t.id} todo={t}
            onClick={() => onCardClick(t.id)}
            onEdit={() => onEdit(t)} />
        ))}
      </div>
    </div>
  );
}

function ExtraCard({ todo, onClick, onEdit }) {
  const p = PRIORITY_CFG[todo.priority] || PRIORITY_CFG.normal;
  // Time-aware lateness from the backend (`late_by_minutes`) — fall back to
  // a date-only check on older API responses.
  const done = todo.status === 'completed';
  const lateMinutes = Number(todo.late_by_minutes) || 0;
  const effectiveEnd = todo.due_date_end || todo.due_date;
  const overdue = !done && (lateMinutes > 0 || (effectiveEnd && effectiveEnd < todayStr()));
  const completedLate = done && lateMinutes > 0;
  const lateLabel = lateMinutes > 0 ? formatMinutesLate(lateMinutes) : '';
  const statusCfg = {
    new:         { label: 'جديدة',       cls: 'bg-blue-100 text-blue-700' },
    in_progress: { label: 'قيد التنفيذ', cls: 'bg-amber-100 text-amber-700' },
    on_hold:     { label: 'معلّقة',      cls: 'bg-gray-200 text-gray-700' },
    completed:   { label: 'مكتملة',      cls: 'bg-emerald-100 text-emerald-700' },
    cancelled:   { label: 'ملغاة',       cls: 'bg-red-100 text-red-700' },
  }[todo.status] || { label: todo.status, cls: 'bg-gray-100 text-gray-700' };
  // Border-only priority styling (no light bg fill — that has no dark-mode
  // override and looked invisible). The colored side-bar (dot) gives the
  // priority hint visually.
  const priorityBorder = {
    urgent: 'border-red-400',
    high:   'border-orange-400',
    normal: 'border-blue-300',
    low:    'border-gray-300',
  }[todo.priority] || 'border-gray-200';
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-lg border-2 ${priorityBorder} ${overdue ? 'ring-2 ring-red-400' : ''} p-2.5 cursor-pointer hover:shadow-md transition group`}
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
          <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-gray-500 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded font-bold ${statusCfg.cls}`}>{statusCfg.label}</span>
            {todo.assigned_to_name && (
              <span className="inline-flex items-center gap-0.5 bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-bold">
                <UserCircle size={10} /> {todo.assigned_to_name}
              </span>
            )}
            {todo.due_date && (
              <span className={`inline-flex items-center gap-0.5 ${overdue ? 'text-red-600 font-bold' : ''}`}>
                <Calendar size={10} />
                {todo.due_date_end && todo.due_date_end !== todo.due_date
                  ? <>{todo.due_date} → {todo.due_date_end}</>
                  : todo.due_date}
              </span>
            )}
            {todo.due_time && (
              <span className="inline-flex items-center gap-0.5 bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">
                <Clock size={10} /> {todo.due_time.slice(0, 5)}
              </span>
            )}
            {lateLabel && (
              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-bold border
                ${overdue ? 'bg-red-500 text-white border-red-600' : 'bg-amber-100 text-amber-800 border-amber-200'}`}
                title={done ? 'اكتمل بعد الموعد' : 'متأخر عن الموعد'}>
                <AlertCircle size={9} /> متأخر {lateLabel}
              </span>
            )}
            {done && todo.completed_at && (
              <span className={`inline-flex items-center gap-0.5 ${completedLate ? 'text-amber-700 font-bold' : 'text-emerald-600'}`}
                title={`اكتمل في ${todo.completed_at?.replace('T', ' ')}`}>
                <CheckCircle2 size={10} /> اتعملت {formatTimeOnly(todo.completed_at)}
              </span>
            )}
            {todo.priority === 'urgent' && (
              <span className="inline-flex items-center gap-0.5 bg-red-500 text-white px-1.5 py-0.5 rounded font-bold">
                <Star size={9} /> عاجل
              </span>
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

// ─── Kanban Card ──────────────────────────────────────────────────────────────
function KanbanCard({ todo, onDragStart, onClick, onEdit }) {
  const p = PRIORITY_CFG[todo.priority] || PRIORITY_CFG.normal;
  // Backend computes `late_by_minutes` time-aware (using due_time). Fall back
  // to a coarser date-only check for clients on stale schemas.
  const done = todo.status === 'completed';
  const lateMinutes = Number(todo.late_by_minutes) || 0;
  const effectiveEnd = todo.due_date_end || todo.due_date;
  const overdueOpen = !done && (lateMinutes > 0 || (effectiveEnd && effectiveEnd < todayStr()));
  const completedLate = done && lateMinutes > 0;
  const lateLabel  = lateMinutes > 0 ? formatMinutesLate(lateMinutes) : '';
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={`bg-white rounded-lg border ${p.cls} ${overdueOpen ? 'ring-2 ring-red-300' : completedLate ? 'ring-1 ring-amber-300' : ''} p-2.5 cursor-grab active:cursor-grabbing hover:shadow-md transition group`}
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
              <span className={`inline-flex items-center gap-0.5 ${overdueOpen ? 'text-red-600 font-bold' : ''}`}>
                <Calendar size={10} />
                {todo.due_date_end && todo.due_date_end !== todo.due_date
                  ? <>{todo.due_date} → {todo.due_date_end}</>
                  : todo.due_date}
              </span>
            )}
            {todo.due_time && (
              <span className="inline-flex items-center gap-0.5 bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">
                <Clock size={10} /> {todo.due_time.slice(0, 5)}
              </span>
            )}
            {/* Lateness badge */}
            {lateLabel && (
              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-bold border
                ${overdueOpen ? 'bg-red-500 text-white border-red-600' : 'bg-amber-100 text-amber-800 border-amber-200'}`}
                title={done ? 'اكتمل بعد الموعد' : 'متأخر عن الموعد'}>
                <AlertCircle size={9} /> متأخر {lateLabel}
              </span>
            )}
            {/* Completion time */}
            {done && todo.completed_at && (
              <span className={`inline-flex items-center gap-0.5 ${completedLate ? 'text-amber-700 font-bold' : 'text-emerald-600'}`}
                title={`اكتمل في ${todo.completed_at?.replace('T', ' ')}`}>
                <CheckCircle2 size={10} /> اتعملت {formatTimeOnly(todo.completed_at)}
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
  const { user } = useAuth();
  const isEdit = !!todo;
  const isInstance = !!todo?.parent_todo_id;
  // Only the creator can edit content — assignees get a status-only view.
  const lockContent = isEdit && !userOwnsTodo(user, todo);
  const [title, setTitle] = useState(todo?.title || '');
  const [description, setDescription] = useState(todo?.description || '');
  const [priority, setPriority] = useState(todo?.priority || 'normal');
  const [status, setStatus] = useState(todo?.status || 'new');
  const [dueDate, setDueDate] = useState(todo?.due_date || '');
  // Multi-day range: empty end-date = single-day task
  const [dueDateEnd, setDueDateEnd] = useState(todo?.due_date_end || '');
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
        due_date: dueDate || null,
        due_date_end: dueDateEnd || null,
        due_time: dueTime || null,
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
          {lockContent && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
              <Lock size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                <b>هذه المهمة من إنشاء {todo.created_by_name || 'مدير النظام'}</b>
                <br />
                يمكنك فقط تغيير حالتها (مكتملة / قيد التنفيذ / إلخ). لتعديل المحتوى رجاء التواصل مع منشئها.
              </p>
            </div>
          )}
          <Field label="العنوان *">
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} autoFocus
              readOnly={lockContent}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-indigo-300 outline-none read-only:bg-gray-50 read-only:cursor-not-allowed" />
          </Field>
          <Field label="الوصف">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              readOnly={lockContent}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-indigo-300 outline-none resize-none read-only:bg-gray-50 read-only:cursor-not-allowed" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الأهمية">
              <select value={priority} onChange={e => setPriority(e.target.value)}
                disabled={lockContent}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white disabled:bg-gray-50 disabled:cursor-not-allowed">
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
          <div className="grid grid-cols-3 gap-3">
            <Field label="من تاريخ">
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                disabled={lockContent}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm disabled:bg-gray-50 disabled:cursor-not-allowed" />
            </Field>
            <Field label="إلى تاريخ (اختياري)">
              <input type="date" value={dueDateEnd} onChange={e => setDueDateEnd(e.target.value)}
                min={dueDate || undefined} disabled={!dueDate || lockContent}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed" />
            </Field>
            <Field label="الوقت">
              <input type="time" value={dueTime} onChange={e => setDueTime(e.target.value)}
                disabled={lockContent}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm disabled:bg-gray-50 disabled:cursor-not-allowed" />
            </Field>
          </div>
          {dueDate && dueDateEnd && (
            <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-1">
              💡 المهمة هتظهر للمنسق طوال الفترة من <b>{dueDate}</b> إلى <b>{dueDateEnd}</b>
            </p>
          )}
          <Field label="مُكلّف لـ *">
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
              disabled={lockContent}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white disabled:bg-gray-50 disabled:cursor-not-allowed">
              <option value="">— اختار —</option>
              {(usersData?.users || []).map(u => (
                <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
              ))}
            </select>
          </Field>

          {!lockContent && (
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
          )}
        </div>
        <div className="px-5 py-3 bg-gray-50 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-100">إلغاء</button>
          <button onClick={save} disabled={submitting} className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-bold disabled:opacity-50">
            {submitting ? 'جاري الحفظ...' : (isEdit ? (lockContent ? 'حفظ الحالة' : 'تحديث') : 'حفظ')}
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
  const { user } = useAuth();
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
  const canDelete = userOwnsTodo(user, t);
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
            <button onClick={() => onEdit(t)} className="p-1.5 hover:bg-white rounded-lg" title={canDelete ? 'تعديل' : 'تعديل الحالة فقط'}><Edit3 size={16} /></button>
            {canDelete && (
              <button onClick={() => { if (confirm('حذف المهمة؟')) deleteMut.mutate(); }} className="p-1.5 hover:bg-red-50 rounded-lg"><Trash2 size={16} className="text-red-500" /></button>
            )}
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
