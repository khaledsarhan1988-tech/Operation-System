import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ListTodo, Plus, BarChart3, Users as UsersIcon, AlertTriangle, CheckCircle2,
  Zap, Clock, Calendar, AlertCircle, TrendingUp, Search, X, Edit3, Trash2,
  Send, MessageSquare, UserCircle, Star, Filter, Download, RefreshCw,
  Sparkles, ClipboardCheck, ChevronDown, ChevronUp, Check,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

const PRIORITY_CFG = {
  urgent: { label: 'عاجل',  emoji: '🔴', color: '#ef4444', bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200' },
  high:   { label: 'مرتفع', emoji: '🟠', color: '#f97316', bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200' },
  normal: { label: 'عادي',  emoji: '🔵', color: '#3b82f6', bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200' },
  low:    { label: 'منخفض', emoji: '⚪', color: '#9ca3af', bg: 'bg-gray-50',    text: 'text-gray-700',    border: 'border-gray-200' },
};

const STATUS_CFG = {
  new:         { label: 'جديدة',       color: '#60a5fa' },
  in_progress: { label: 'قيد التنفيذ', color: '#f59e0b' },
  on_hold:     { label: 'معلّقة',      color: '#6b7280' },
  completed:   { label: 'مكتملة',      color: '#10b981' },
  cancelled:   { label: 'ملغاة',       color: '#ef4444' },
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Default Daily Workflow (11 tasks for Customer Services) ──────────────────
const DEFAULT_DAILY_WORKFLOW = [
  { title: 'Whatsapp', description: 'اللي خلصت بس Resolved بنصفر الواتساب + بنعمل المسجات كلها', due_time: '10:00', priority: 'high' },
  { title: 'Remarks', description: 'بنصفر الريماركات', due_time: '10:15', priority: 'high' },
  { title: 'Attend (Call / Session / Task)', description: 'حضور المكالمات والجلسات والتاسكات', due_time: '10:30', priority: 'high' },
  { title: 'Class Visit', description: 'زيارة الفصول', due_time: '11:30', priority: 'normal' },
  { title: 'Whatsapp + Remarks (جولة 2)', description: 'اللي خلصت بس resolved بنصفر الواتساب والريماركات ثاني + بنعمل المسجات كلها', due_time: '12:00', priority: 'high' },
  { title: 'Report', description: 'بتسحب ريبورت وتظبط اكوادك', due_time: '12:30', priority: 'high' },
  { title: 'System Quality', description: 'حل المشاكل اللي موجودة عند كل واحد في السيستم', due_time: '13:00', priority: 'high' },
  { title: 'Meeting / On Boarding / End Group', description: 'لو ف اي حاجة مع عميل مش واضحة بتدخل ميتنج توضحها، ولو عندك أوبيوردنج أو دا يوم الإند جروب بتاعك', due_time: '14:00', priority: 'high' },
  { title: 'Task + Retention', description: 'تاسك + ريتنشن', due_time: '15:00', priority: 'high' },
  { title: 'Whatsapp + Remarks (جولة 3)', description: 'اللي خلصت بس resolved بنصفر الواتساب والريماركات + بنعمل المسجات كلها', due_time: '16:00', priority: 'high' },
  { title: 'Submission Sheet', description: 'شيت مستر خالد اللي بنضيف فيه داتا كل العملا اللي معانا', due_time: '17:00', priority: 'high' },
];

export default function AdminTodos() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const qc = useQueryClient();

  const { data: todosData, isLoading } = useQuery({
    queryKey: ['todos', 'admin-all'],
    queryFn: () => api.get('/todos', { params: { limit: 1000 } }).then(r => r.data),
    staleTime: 30 * 1000,
  });

  const { data: stats } = useQuery({
    queryKey: ['todos', 'stats'],
    queryFn: () => api.get('/todos/stats').then(r => r.data),
    staleTime: 30 * 1000,
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

  const todos = todosData?.todos || [];

  // ── Aggregations ──
  const priorityBreakdown = useMemo(() => {
    const map = { urgent: 0, high: 0, normal: 0, low: 0 };
    todos.forEach(t => { if (t.status !== 'completed' && t.status !== 'cancelled') map[t.priority] = (map[t.priority] || 0) + 1; });
    return Object.entries(map).map(([k, v]) => ({ name: PRIORITY_CFG[k].label, value: v, color: PRIORITY_CFG[k].color, key: k }));
  }, [todos]);

  const statusBreakdown = useMemo(() => {
    const map = {};
    todos.forEach(t => { map[t.status] = (map[t.status] || 0) + 1; });
    return Object.entries(map).map(([k, v]) => ({ name: STATUS_CFG[k]?.label || k, value: v, color: STATUS_CFG[k]?.color || '#9ca3af' }));
  }, [todos]);

  const last7Days = useMemo(() => {
    const days = [];
    const todayD = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayD);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayName = d.toLocaleDateString('ar-EG', { weekday: 'short' });
      const created = todos.filter(t => (t.created_at || '').slice(0, 10) === key).length;
      const completed = todos.filter(t => (t.completed_at || '').slice(0, 10) === key).length;
      days.push({ date: key.slice(5), day: dayName, أنشئت: created, أكتملت: completed });
    }
    return days;
  }, [todos]);

  const filtered = useMemo(() => {
    return todos.filter(t => {
      if (filterStatus && t.status !== filterStatus) return false;
      if (filterPriority && t.priority !== filterPriority) return false;
      if (filterAssignee && String(t.assigned_to) !== String(filterAssignee)) return false;
      if (search) {
        const q = search.toLowerCase();
        return (t.title || '').toLowerCase().includes(q)
          || (t.description || '').toLowerCase().includes(q)
          || (t.assigned_to_name || '').toLowerCase().includes(q)
          || (t.created_by_name || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [todos, filterStatus, filterPriority, filterAssignee, search]);

  function exportCsv() {
    if (!filtered.length) return;
    const headers = ['#', 'العنوان', 'الحالة', 'الأهمية', 'المسؤول', 'أنشأها', 'تاريخ الاستحقاق', 'تاريخ الإنشاء', 'تاريخ الإنجاز'];
    const rows = filtered.map(t => [
      t.id, t.title || '', STATUS_CFG[t.status]?.label || t.status,
      PRIORITY_CFG[t.priority]?.label || t.priority,
      t.assigned_to_name || '', t.created_by_name || '',
      t.due_date || '', t.created_at?.slice(0, 16) || '', t.completed_at?.slice(0, 16) || '',
    ]);
    const escape = (v) => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\r\n');
    const bom = '﻿';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `todos-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const activeFilters = (filterStatus ? 1 : 0) + (filterPriority ? 1 : 0) + (filterAssignee ? 1 : 0) + (search ? 1 : 0);

  return (
    <div className="space-y-5">
      <PageHero
        title="إدارة المهام — Dashboard"
        subtitle="نظرة شاملة على كل المهام في إدارتك مع تحليلات وأداء الفريق"
        icon={BarChart3}
        gradient="from-violet-500 to-fuchsia-500"
      />

      {/* Daily Workflow Setup CTA */}
      <button
        onClick={() => setShowWorkflow(true)}
        className="w-full bg-gradient-to-r from-orange-50 via-amber-50 to-yellow-50 border-2 border-orange-300 rounded-2xl p-4 hover:from-orange-100 hover:via-amber-100 hover:to-yellow-100 transition group text-right"
      >
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 shadow-lg group-hover:scale-105 transition">
            <ClipboardCheck size={24} className="text-white" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-orange-900 text-base flex items-center gap-2">
              <Sparkles size={16} className="text-orange-600" />
              إعداد جدول الأعمال اليومي القياسي
            </h3>
            <p className="text-xs text-orange-700 mt-1">
              طبّق {DEFAULT_DAILY_WORKFLOW.length} مهمة يومية متكررة على أي عدد من الموظفين دفعة واحدة — تظهر تلقائياً كل يوم في صفحة "مهامي" بتاعتهم.
            </p>
          </div>
          <ChevronDown size={18} className="text-orange-500 group-hover:translate-x-1 transition" />
        </div>
      </button>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <StatCard icon={ListTodo}      label="الإجمالي"     value={stats.total || 0}             color="violet" />
          <StatCard icon={AlertCircle}   label="جديدة"         value={stats.new_count || 0}         color="blue" />
          <StatCard icon={Zap}           label="قيد التنفيذ" value={stats.in_progress_count || 0} color="amber" />
          <StatCard icon={Clock}         label="معلّقة"       value={stats.on_hold_count || 0}     color="gray" />
          <StatCard icon={CheckCircle2}  label="مكتملة"      value={stats.completed_count || 0}   color="emerald" />
          <StatCard icon={Star}          label="عاجلة"        value={stats.urgent_open || 0}       color="red" />
          <StatCard icon={AlertTriangle} label="متأخّرة"     value={stats.overdue_count || 0}     color="rose" />
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Daily chart */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 lg:col-span-2">
          <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
            <TrendingUp size={16} className="text-violet-600" />
            النشاط — آخر 7 أيام
          </h3>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={last7Days} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="أنشئت"  fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="أكتملت" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Priority Pie */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
          <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
            <Star size={16} className="text-rose-500" />
            توزيع الأهمية (مفتوحة)
          </h3>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={priorityBreakdown.filter(d => d.value > 0)} dataKey="value" nameKey="name"
                  outerRadius={70} innerRadius={35}>
                  {priorityBreakdown.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-1.5 justify-center text-[10px]">
            {priorityBreakdown.map(p => (
              <span key={p.key} className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: p.color }}></span>
                {p.name}: {p.value}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Team Performance */}
      {summary?.rows && summary.rows.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
          <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
            <UsersIcon size={16} className="text-indigo-600" />
            أداء الفريق — Top Performers
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">#</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">الموظف</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">الإجمالي</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">المفتوحة</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">المكتملة</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">العاجلة</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">المتأخرة</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">معدّل الإنجاز</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r, i) => {
                  const rate = r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0;
                  return (
                    <tr key={r.assigned_to} className="border-t border-gray-100 hover:bg-violet-50/30 cursor-pointer"
                        onClick={() => setFilterAssignee(String(r.assigned_to))}>
                      <td className="px-3 py-2 font-bold text-gray-500">{i + 1}</td>
                      <td className="px-3 py-2 font-semibold flex items-center gap-1.5">
                        <UserCircle size={14} className="text-gray-400" />
                        {r.assigned_to_name}
                      </td>
                      <td className="px-3 py-2">{r.total}</td>
                      <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">{r.open_count}</span></td>
                      <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">{r.completed}</span></td>
                      <td className="px-3 py-2">{r.urgent_open > 0 ? <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold">{r.urgent_open}</span> : '—'}</td>
                      <td className="px-3 py-2">{r.overdue > 0 ? <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">{r.overdue}</span> : '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden min-w-[60px]">
                            <div className={`h-2 ${rate >= 75 ? 'bg-emerald-500' : rate >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
                                 style={{ width: `${rate}%` }}></div>
                          </div>
                          <span className="text-xs font-bold tabular-nums">{rate}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Full List with filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Filter size={16} className="text-violet-600" />
            كل المهام
            <span className="text-xs text-gray-500 font-normal">({filtered.length} من {todos.length})</span>
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="بحث..." className="pl-3 pr-8 py-1.5 rounded-lg border border-gray-300 text-sm w-44" />
            </div>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm bg-white">
              <option value="">كل الحالات</option>
              {Object.entries(STATUS_CFG).map(([k, c]) => (<option key={k} value={k}>{c.label}</option>))}
            </select>
            <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm bg-white">
              <option value="">كل الأهمية</option>
              {Object.entries(PRIORITY_CFG).map(([k, c]) => (<option key={k} value={k}>{c.emoji} {c.label}</option>))}
            </select>
            <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm bg-white">
              <option value="">كل الموظفين</option>
              {(usersData?.users || []).map(u => (<option key={u.id} value={u.id}>{u.full_name}</option>))}
            </select>
            {activeFilters > 0 && (
              <button onClick={() => { setSearch(''); setFilterStatus(''); setFilterPriority(''); setFilterAssignee(''); }}
                className="px-2 py-1.5 rounded-lg text-xs text-violet-600 hover:bg-violet-50">مسح</button>
            )}
            <button onClick={exportCsv} disabled={!filtered.length}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1 disabled:opacity-40">
              <Download size={12} /> Export
            </button>
            <button onClick={() => qc.invalidateQueries({ queryKey: ['todos'] })}
              className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50"><RefreshCw size={13} /></button>
            <button onClick={() => setCreating(true)}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-sm font-bold flex items-center gap-1">
              <Plus size={13} /> جديدة
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">#</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">العنوان</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">الحالة</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">الأهمية</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">المسؤول</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">أنشأها</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">التاريخ</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">جاري التحميل...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">لا توجد مهام</td></tr>
              ) : filtered.map(t => {
                const p = PRIORITY_CFG[t.priority] || PRIORITY_CFG.normal;
                const s = STATUS_CFG[t.status] || STATUS_CFG.new;
                const overdue = t.status !== 'completed' && t.due_date && t.due_date < todayStr();
                return (
                  <tr key={t.id} className="border-t border-gray-100 hover:bg-violet-50/30 cursor-pointer" onClick={() => setOpenId(t.id)}>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">#{t.id}</td>
                    <td className="px-3 py-2 font-semibold">{t.title}</td>
                    <td className="px-3 py-2">
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: s.color + '22', color: s.color }}>
                        {s.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${p.bg} ${p.text} ${p.border}`}>
                        {p.emoji} {p.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">{t.assigned_to_name || '—'}</td>
                    <td className="px-3 py-2 text-xs">{t.created_by_name || '—'}</td>
                    <td className={`px-3 py-2 text-xs ${overdue ? 'text-red-600 font-bold' : ''}`}>
                      {t.due_date || '—'}
                    </td>
                    <td className="px-3 py-2 text-end">
                      <button onClick={(e) => { e.stopPropagation(); setEditing(t); }}
                        className="p-1 rounded hover:bg-gray-100"><Edit3 size={13} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
      {showWorkflow && (
        <DailyWorkflowModal
          users={usersData?.users || []}
          onClose={() => setShowWorkflow(false)}
          onApplied={() => { qc.invalidateQueries({ queryKey: ['todos'] }); }}
        />
      )}
    </div>
  );
}

// ─── Daily Workflow Modal ─────────────────────────────────────────────────────
function DailyWorkflowModal({ users, onClose, onApplied }) {
  const [tasks, setTasks] = useState(DEFAULT_DAILY_WORKFLOW.map((t, i) => ({ ...t, id: i, enabled: true })));
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [deptFilter, setDeptFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('agent');  // default: agents only
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      if (deptFilter && u.department !== deptFilter) return false;
      if (roleFilter && u.role !== roleFilter) return false;
      if (search && !u.full_name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [users, deptFilter, roleFilter, search]);

  function toggleUser(id) {
    setSelectedUserIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }
  function toggleAll() {
    const allIds = filteredUsers.map(u => u.id);
    const allSelected = allIds.every(id => selectedUserIds.includes(id));
    if (allSelected) {
      setSelectedUserIds(s => s.filter(id => !allIds.includes(id)));
    } else {
      setSelectedUserIds(s => [...new Set([...s, ...allIds])]);
    }
  }
  function updateTask(id, key, value) {
    setTasks(ts => ts.map(t => t.id === id ? { ...t, [key]: value } : t));
  }
  function removeTask(id) {
    setTasks(ts => ts.filter(t => t.id !== id));
  }
  function addTask() {
    setTasks(ts => [...ts, { id: Date.now(), title: '', description: '', due_time: '09:00', priority: 'normal', enabled: true }]);
  }

  async function apply() {
    const activeTasks = tasks.filter(t => t.enabled && t.title.trim());
    if (activeTasks.length === 0) { setResult({ error: 'لا توجد مهام مفعّلة' }); return; }
    if (selectedUserIds.length === 0) { setResult({ error: 'لم تختار أي مستخدم' }); return; }
    if (!confirm(`سيتم إنشاء ${activeTasks.length} قالب لـ ${selectedUserIds.length} مستخدم (= ${activeTasks.length * selectedUserIds.length} قالب). متابعة؟`)) return;

    setSubmitting(true); setResult(null);
    try {
      const { data } = await api.post('/todos/bulk-templates', {
        templates: activeTasks.map(t => ({
          title: t.title,
          description: t.description || null,
          due_time: t.due_time || null,
          priority: t.priority,
          recurrence_pattern: 'daily',
        })),
        user_ids: selectedUserIds,
      });
      setResult(data);
      onApplied();
    } catch (err) {
      setResult({ error: err.response?.data?.error || err.message });
    } finally { setSubmitting(false); }
  }

  const activeCount = tasks.filter(t => t.enabled && t.title.trim()).length;
  const allFilteredSelected = filteredUsers.length > 0 && filteredUsers.every(u => selectedUserIds.includes(u.id));

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-gradient-to-r from-orange-500 to-amber-500 text-white flex items-center justify-between">
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2">
              <ClipboardCheck size={20} />
              إعداد جدول الأعمال اليومي
            </h3>
            <p className="text-xs opacity-90 mt-0.5">القوالب هتظهر تلقائياً كل يوم لكل مستخدم تختاره</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto flex-1 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">

          {/* LEFT: Tasks */}
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-gray-800 text-sm">
                📋 القوالب ({activeCount} مفعّلة من {tasks.length})
              </h4>
              <button onClick={addTask}
                className="text-xs px-2 py-1 rounded bg-orange-100 hover:bg-orange-200 text-orange-700 font-bold flex items-center gap-1">
                <Plus size={12} /> إضافة
              </button>
            </div>
            <div className="space-y-1.5 max-h-[55vh] overflow-y-auto pr-1">
              {tasks.map(t => (
                <div key={t.id} className={`p-2.5 rounded-lg border ${t.enabled ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-50'}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <input type="checkbox" checked={t.enabled} onChange={e => updateTask(t.id, 'enabled', e.target.checked)}
                      className="w-4 h-4 accent-orange-500 flex-shrink-0" />
                    <input type="text" value={t.title} onChange={e => updateTask(t.id, 'title', e.target.value)}
                      placeholder="عنوان المهمة"
                      className="flex-1 px-2 py-1 text-sm font-bold border border-gray-200 rounded" />
                    <input type="time" value={t.due_time || ''} onChange={e => updateTask(t.id, 'due_time', e.target.value)}
                      className="px-2 py-1 text-xs border border-gray-200 rounded w-24" />
                    <select value={t.priority} onChange={e => updateTask(t.id, 'priority', e.target.value)}
                      className="px-1 py-1 text-xs border border-gray-200 rounded">
                      <option value="urgent">🔴</option>
                      <option value="high">🟠</option>
                      <option value="normal">🔵</option>
                      <option value="low">⚪</option>
                    </select>
                    <button onClick={() => removeTask(t.id)} className="p-1 hover:bg-red-50 rounded text-red-500">
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <input type="text" value={t.description || ''} onChange={e => updateTask(t.id, 'description', e.target.value)}
                    placeholder="وصف اختياري"
                    className="w-full px-2 py-1 text-xs text-gray-600 border border-gray-100 rounded" />
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: Users */}
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-gray-800 text-sm">
                👥 المستخدمين ({selectedUserIds.length} مختار من {filteredUsers.length})
              </h4>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
                className="px-2 py-1.5 text-xs border border-gray-200 rounded">
                <option value="">كل الأدوار</option>
                <option value="agent">موظف</option>
                <option value="leader">مشرف</option>
                <option value="admin">مدير/مسؤول</option>
              </select>
              <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
                className="px-2 py-1.5 text-xs border border-gray-200 rounded">
                <option value="">كل الأقسام</option>
                <option value="General">General</option>
                <option value="Private">Private</option>
                <option value="Semi">Semi</option>
                <option value="Appointments">Appointments</option>
                <option value="All">All</option>
              </select>
            </div>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍 بحث بالاسم..."
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded" />

            <button onClick={toggleAll}
              className="w-full px-3 py-1.5 text-xs font-bold rounded bg-orange-100 text-orange-700 hover:bg-orange-200 flex items-center justify-center gap-1">
              <Check size={12} /> {allFilteredSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
            </button>

            <div className="space-y-1 max-h-[40vh] overflow-y-auto pr-1 border border-gray-200 rounded-lg p-2">
              {filteredUsers.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">لا يوجد مستخدمين بالفلتر ده</p>
              ) : filteredUsers.map(u => (
                <label key={u.id} className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm
                  ${selectedUserIds.includes(u.id) ? 'bg-orange-100' : 'hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={selectedUserIds.includes(u.id)}
                    onChange={() => toggleUser(u.id)}
                    className="w-4 h-4 accent-orange-500" />
                  <span className="flex-1 font-semibold">{u.full_name}</span>
                  <span className="text-[10px] text-gray-500">{u.role}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100">{u.department}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Result + Actions */}
        {result && (
          <div className={`px-5 py-3 ${result.error ? 'bg-red-50 border-t border-red-200 text-red-700' : 'bg-emerald-50 border-t border-emerald-200 text-emerald-800'} text-sm flex items-center gap-2`}>
            {result.error
              ? <><AlertCircle size={16} /> {result.error}</>
              : <><CheckCircle2 size={16} /> {result.message} — موزعة على {result.total_users} مستخدم</>}
          </div>
        )}

        <div className="px-5 py-3 bg-gray-50 border-t flex items-center justify-between">
          <p className="text-xs text-gray-600">
            ⚡ <strong>{activeCount * selectedUserIds.length}</strong> قالب سيتم إنشاؤها ({activeCount} مهمة × {selectedUserIds.length} مستخدم)
          </p>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-100">إغلاق</button>
            <button onClick={apply} disabled={submitting || activeCount === 0 || selectedUserIds.length === 0}
              className="px-5 py-1.5 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-sm disabled:opacity-40 flex items-center gap-1.5">
              <Sparkles size={14} />
              {submitting ? 'جاري التطبيق...' : 'طبّق على المختارين'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  const map = {
    violet:  'bg-violet-50 border-violet-200 text-violet-700',
    blue:    'bg-blue-50 border-blue-200 text-blue-700',
    amber:   'bg-amber-50 border-amber-200 text-amber-700',
    gray:    'bg-gray-50 border-gray-200 text-gray-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    red:     'bg-red-50 border-red-200 text-red-700',
    rose:    'bg-rose-50 border-rose-200 text-rose-700',
  };
  return (
    <div className={`rounded-xl border p-3 ${map[color]}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={13} />
        <span className="text-[10px] font-bold truncate">{label}</span>
      </div>
      <p className="text-2xl font-black leading-tight tabular-nums">{value}</p>
    </div>
  );
}

// ─── Reused Modals (compact versions, same APIs as agent/leader) ──────────────
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
        title, description, priority, status, due_date: dueDate || null, due_time: dueTime || null, assigned_to: assignedTo || null,
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
        <div className="px-5 py-4 bg-gradient-to-r from-violet-50 to-fuchsia-50 border-b flex items-center justify-between">
          <h3 className="font-bold text-gray-900">{isEdit ? 'تعديل المهمة' : 'مهمة جديدة'}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>}
          <label className="block">
            <span className="text-xs font-bold text-gray-600 block mb-1">العنوان *</span>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} autoFocus
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-gray-600 block mb-1">الوصف</span>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm resize-none" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-bold text-gray-600 block mb-1">الأهمية</span>
              <select value={priority} onChange={e => setPriority(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white">
                {Object.entries(PRIORITY_CFG).map(([k, c]) => (<option key={k} value={k}>{c.emoji} {c.label}</option>))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-gray-600 block mb-1">الحالة</span>
              <select value={status} onChange={e => setStatus(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white">
                {Object.entries(STATUS_CFG).map(([k, c]) => (<option key={k} value={k}>{c.label}</option>))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-bold text-gray-600 block mb-1">تاريخ</span>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-gray-600 block mb-1">الوقت</span>
              <input type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-bold text-gray-600 block mb-1">مُكلّف لـ</span>
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white">
              <option value="">— نفسي —</option>
              {(usersData?.users || []).map(u => (<option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>))}
            </select>
          </label>

          <div className="bg-violet-50/50 border border-violet-200 rounded-lg p-3">
            {isInstance ? (
              <p className="text-xs text-violet-700">
                🔁 هذه نسخة يومية من قالب متكرر. عدّل القالب لتغيير التكرار.
              </p>
            ) : (
              <>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isRecurring}
                    onChange={e => setIsRecurring(e.target.checked)}
                    className="w-4 h-4 accent-violet-500" />
                  <span className="text-sm font-bold text-gray-800">🔁 مهمة متكررة</span>
                </label>
                {isRecurring && (
                  <select value={recurrencePattern} onChange={e => setRecurrencePattern(e.target.value)}
                    className="mt-2 w-full px-3 py-2 rounded-lg border border-violet-300 text-sm bg-white">
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
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg border border-gray-300 text-sm">إلغاء</button>
          <button onClick={save} disabled={submitting} className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-sm font-bold disabled:opacity-50">
            {submitting ? '...' : (isEdit ? 'تحديث' : 'حفظ')}
          </button>
        </div>
      </div>
    </div>
  );
}

function TodoDetailModal({ id, onClose, onEdit, onDeleted }) {
  const qc = useQueryClient();
  const [newComment, setNewComment] = useState('');
  const { data } = useQuery({ queryKey: ['todos', id], queryFn: () => api.get(`/todos/${id}`).then(r => r.data) });
  const addCommentMut = useMutation({
    mutationFn: () => api.post(`/todos/${id}/comments`, { comment: newComment }),
    onSuccess: () => { setNewComment(''); qc.invalidateQueries({ queryKey: ['todos', id] }); },
  });
  const deleteMut = useMutation({ mutationFn: () => api.delete(`/todos/${id}`), onSuccess: () => onDeleted() });
  if (!data) return null;
  const t = data.todo;
  const p = PRIORITY_CFG[t.priority] || PRIORITY_CFG.normal;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-gradient-to-r from-violet-50 to-fuchsia-50 border-b flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${p.bg} ${p.text} ${p.border}`}>{p.emoji} {p.label}</span>
            <h3 className="font-bold text-gray-900 text-lg mt-1">{t.title}</h3>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => onEdit(t)} className="p-1.5 hover:bg-white rounded-lg"><Edit3 size={16} /></button>
            <button onClick={() => { if (confirm('حذف؟')) deleteMut.mutate(); }} className="p-1.5 hover:bg-red-50 rounded-lg"><Trash2 size={16} className="text-red-500" /></button>
            <button onClick={onClose} className="p-1.5 hover:bg-white rounded-lg"><X size={18} /></button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-3">
          {t.description && <p className="text-sm whitespace-pre-wrap">{t.description}</p>}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><span className="text-gray-500">المسؤول: </span><strong>{t.assigned_to_name || '—'}</strong></div>
            <div><span className="text-gray-500">المُنشئ: </span><strong>{t.created_by_name || '—'}</strong></div>
            <div><span className="text-gray-500">الاستحقاق: </span><strong>{t.due_date || '—'}</strong></div>
            <div><span className="text-gray-500">الحالة: </span><strong>{STATUS_CFG[t.status]?.label}</strong></div>
          </div>
          <div className="border-t pt-3">
            <p className="text-xs font-bold text-gray-500 mb-2">التعليقات ({data.comments.length})</p>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {data.comments.map(c => (
                <div key={c.id} className="bg-gray-50 rounded p-2 text-sm">
                  <div className="flex justify-between mb-1"><strong className="text-xs">{c.user_name}</strong><span className="text-[10px] text-gray-500">{c.created_at?.slice(0, 16).replace('T', ' ')}</span></div>
                  <p className="text-xs whitespace-pre-wrap">{c.comment}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <input value={newComment} onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newComment.trim()) addCommentMut.mutate(); }}
                placeholder="تعليق..." className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm" />
              <button onClick={() => addCommentMut.mutate()} disabled={!newComment.trim()}
                className="px-3 py-2 rounded-lg bg-violet-500 text-white disabled:opacity-40"><Send size={14} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
