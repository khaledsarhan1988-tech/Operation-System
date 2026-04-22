import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload, Users, CheckCircle, XCircle, Clock, RefreshCw,
  ChevronDown, Plus, Trash2, History, ArrowLeft,
  UserCheck, Shuffle, AlertCircle, FileSpreadsheet, X, Eye,
} from 'lucide-react';
import api from '../../api/axios';

const LINES     = ['Ahmed Hassan', 'Dardasha'];
const PRIORITIES = ['عادية', 'هامة', 'عاجلة'];

// ─── small helpers ────────────────────────────────────────────────────────────
const STATUS_BADGE = {
  pending:   { label: 'معلقة',   cls: 'bg-amber-100  text-amber-800'  },
  confirmed: { label: 'مؤكدة',   cls: 'bg-green-100  text-green-800'  },
  cancelled: { label: 'ملغاة',   cls: 'bg-red-100    text-red-800'    },
};
const MATCH_BADGE = {
  existing_coordinator: { label: 'منسق موجود',  cls: 'bg-blue-100  text-blue-800'  },
  auto_distributed:     { label: 'توزيع تلقائي', cls: 'bg-purple-100 text-purple-800' },
};

function Badge({ type, map }) {
  const d = map[type] ?? { label: type, cls: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${d.cls}`}>
      {d.label}
    </span>
  );
}

// ─── TASK-TYPE MANAGER modal ──────────────────────────────────────────────────
function TaskTypeManager({ onClose }) {
  const qc   = useQueryClient();
  const [name, setName] = useState('');
  const { data: types = [] } = useQuery({
    queryKey: ['dist-task-types'],
    queryFn: () => api.get('/distribution/task-types').then(r => r.data),
  });

  const add = useMutation({
    mutationFn: n => api.post('/distribution/task-types', { name: n }),
    onSuccess: () => { qc.invalidateQueries(['dist-task-types']); setName(''); },
  });
  const del = useMutation({
    mutationFn: id => api.delete(`/distribution/task-types/${id}`),
    onSuccess: () => qc.invalidateQueries(['dist-task-types']),
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-bold text-gray-900">إدارة أنواع المهام</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Add new */}
          <div className="flex gap-2">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && name.trim() && add.mutate(name.trim())}
              placeholder="اسم نوع المهمة الجديد..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              disabled={!name.trim() || add.isPending}
              onClick={() => add.mutate(name.trim())}
              className="btn-primary px-4 text-sm disabled:opacity-50"
            >
              <Plus size={16} />
            </button>
          </div>
          {add.isError && (
            <p className="text-xs text-red-600">{add.error?.response?.data?.error || 'حدث خطأ'}</p>
          )}
          {/* List */}
          <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
            {types.map(t => (
              <li key={t.id} className="flex items-center justify-between py-2.5">
                <span className="text-sm text-gray-800">{t.name}</span>
                {t.is_default
                  ? <span className="text-xs text-gray-400 italic">افتراضي</span>
                  : (
                    <button
                      onClick={() => del.mutate(t.id)}
                      className="p-1 hover:bg-red-50 rounded-lg text-red-500"
                    >
                      <Trash2 size={15} />
                    </button>
                  )
                }
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ─── HISTORY DETAIL modal ─────────────────────────────────────────────────────
function HistoryDetail({ sessionId, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['dist-session', sessionId],
    queryFn: () => api.get(`/distribution/sessions/${sessionId}`).then(r => r.data),
  });

  if (isLoading) return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <RefreshCw className="animate-spin text-white" size={32} />
    </div>
  );

  const session = data;
  const items   = data?.items || [];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h3 className="font-bold text-gray-900">تفاصيل جلسة التوزيع #{session?.id}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {session?.line} · {session?.total_clients} عميل ·{' '}
              <Badge type={session?.status} map={STATUS_BADGE} />
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold text-gray-600">العميل</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-600">الموبايل</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-600">الموظف</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-600">النوع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">{item.client_name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{item.client_phone || '—'}</td>
                    <td className="px-3 py-2 font-semibold">{item.assigned_to}</td>
                    <td className="px-3 py-2"><Badge type={item.match_type} map={MATCH_BADGE} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function ClientDistribution() {
  const qc = useQueryClient();

  // ── state ──
  const [tab,        setTab]        = useState('new');    // 'new' | 'history'
  const [step,       setStep]       = useState('upload'); // 'upload' | 'preview' | 'done'
  const [dragging,   setDragging]   = useState(false);
  const [file,       setFile]       = useState(null);
  const [line,       setLine]       = useState('Ahmed Hassan');
  const [taskType,   setTaskType]   = useState('متابعة مشترك جديد');
  const [priority,   setPriority]   = useState('عادية');
  const [preview,    setPreview]    = useState(null);    // API response
  const [overrides,  setOverrides]  = useState({});     // itemId → agentName
  const [doneResult, setDoneResult] = useState(null);
  const [showTTMgr,  setShowTTMgr]  = useState(false);
  const [detailId,   setDetailId]   = useState(null);
  const [histPage,   setHistPage]   = useState(1);

  const fileRef = useRef();

  // ── queries ──
  const { data: taskTypes = [] } = useQuery({
    queryKey: ['dist-task-types'],
    queryFn: () => api.get('/distribution/task-types').then(r => r.data),
  });
  const { data: agentsData = [] } = useQuery({
    queryKey: ['dist-agents', line],
    queryFn: () => api.get('/distribution/agents', { params: { line } }).then(r => r.data),
  });
  const { data: histData, isLoading: histLoading } = useQuery({
    queryKey: ['dist-sessions', histPage],
    queryFn: () => api.get('/distribution/sessions', { params: { page: histPage, limit: 15 } }).then(r => r.data),
    enabled: tab === 'history',
  });

  // ── mutations ──
  const previewMut = useMutation({
    mutationFn: fd => api.post('/distribution/preview', fd, {
      headers: { 'Content-Type': undefined },
    }),
    onSuccess: ({ data }) => {
      setPreview(data);
      setOverrides({});
      setStep('preview');
    },
  });

  const overrideMut = useMutation({
    mutationFn: ({ sid, iid, agent }) =>
      api.put(`/distribution/sessions/${sid}/items/${iid}`, { assigned_to: agent }),
  });

  const cancelMut = useMutation({
    mutationFn: sid => api.delete(`/distribution/sessions/${sid}`),
    onSuccess: () => { resetUpload(); qc.invalidateQueries(['dist-sessions']); },
  });

  const confirmMut = useMutation({
    mutationFn: sid => api.post(`/distribution/sessions/${sid}/confirm`),
    onSuccess: ({ data }) => {
      setDoneResult(data);
      setStep('done');
      qc.invalidateQueries(['dist-sessions']);
    },
  });

  // ── handlers ──
  const resetUpload = useCallback(() => {
    setStep('upload'); setFile(null); setPreview(null);
    setOverrides({}); setDoneResult(null);
  }, []);

  const onFileDrop = useCallback(f => {
    if (!f) return;
    if (!f.name.match(/\.xlsx?$/i)) return alert('يرجى رفع ملف Excel فقط (.xlsx)');
    setFile(f);
  }, []);

  const handleDrop = useCallback(e => {
    e.preventDefault(); setDragging(false);
    onFileDrop(e.dataTransfer.files[0]);
  }, [onFileDrop]);

  const handleAnalyse = () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('line', line);
    fd.append('task_type', taskType);
    fd.append('priority', priority);
    previewMut.mutate(fd);
  };

  const handleOverride = useCallback((itemId, agent) => {
    setOverrides(prev => ({ ...prev, [itemId]: agent }));
    overrideMut.mutate({ sid: preview.session_id, iid: itemId, agent });
  }, [preview, overrideMut]);

  // Reflect overrides in items list for display
  const displayItems = preview
    ? preview.items.map(it => ({ ...it, assigned_to: overrides[it.id] ?? it.assigned_to }))
    : [];

  // Recalculate agent summary from displayItems
  const agentSummaryLive = preview
    ? (() => {
        const map = {};
        preview.agent_summary.forEach(a => {
          map[a.full_name] = { ...a, new_clients: 0 };
        });
        displayItems.forEach(it => {
          if (!map[it.assigned_to])
            map[it.assigned_to] = { full_name: it.assigned_to, current_tasks: 0, new_clients: 0 };
          map[it.assigned_to].new_clients++;
        });
        return Object.values(map).filter(a => a.new_clients > 0);
      })()
    : [];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      {/* ── Modals ── */}
      {showTTMgr && <TaskTypeManager onClose={() => setShowTTMgr(false)} />}
      {detailId  && <HistoryDetail sessionId={detailId} onClose={() => setDetailId(null)} />}

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">توزيع العملاء الجدد</h1>
          <p className="text-sm text-gray-500 mt-1">رفع شيت العملاء وتوزيعهم تلقائياً على الأجنتس</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setTab('new');     setStep('upload'); }}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
              tab === 'new' ? 'bg-primary text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Upload size={16} className="inline ml-1.5" />
            توزيع جديد
          </button>
          <button
            onClick={() => setTab('history')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
              tab === 'history' ? 'bg-primary text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <History size={16} className="inline ml-1.5" />
            السجل
          </button>
        </div>
      </div>

      {/* ═══════════════════ TAB: NEW DISTRIBUTION ═══════════════════════════ */}
      {tab === 'new' && (
        <>
          {/* ── STEP: UPLOAD ────────────────────────────────────────────── */}
          {step === 'upload' && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-6">
              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors ${
                  dragging   ? 'border-primary bg-primary/5'
                  : file     ? 'border-green-400 bg-green-50'
                  : 'border-gray-300 hover:border-primary hover:bg-gray-50'
                }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={e => onFileDrop(e.target.files[0])}
                />
                {file ? (
                  <div className="space-y-2">
                    <CheckCircle className="mx-auto text-green-500" size={40} />
                    <p className="font-semibold text-green-700">{file.name}</p>
                    <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB — اضغط لاختيار ملف آخر</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <FileSpreadsheet className="mx-auto text-gray-400" size={40} />
                    <p className="font-semibold text-gray-700">اسحب الشيت هنا أو اضغط للاختيار</p>
                    <p className="text-xs text-gray-400">Excel (.xlsx) — الأعمدة: التاريخ · الخط · الاسم · الموبايل</p>
                  </div>
                )}
              </div>

              {/* Settings row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Line */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600">الخط</label>
                  <select
                    value={line}
                    onChange={e => setLine(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    {LINES.map(l => <option key={l}>{l}</option>)}
                  </select>
                </div>

                {/* Task type */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-gray-600">نوع المهمة</label>
                    <button
                      onClick={() => setShowTTMgr(true)}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <Plus size={12} /> إدارة
                    </button>
                  </div>
                  <select
                    value={taskType}
                    onChange={e => setTaskType(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    {taskTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                </div>

                {/* Priority */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600">الأولوية</label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
              </div>

              {/* Agents preview */}
              {agentsData.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">الأجنتس النشطين — الحمل الحالي</p>
                  <div className="flex flex-wrap gap-2">
                    {agentsData.map(a => (
                      <div key={a.id} className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                          {a.full_name[0]}
                        </div>
                        <span className="text-xs font-semibold text-gray-700">{a.full_name}</span>
                        <span className="text-xs bg-gray-200 text-gray-600 rounded-full px-1.5">{a.open_tasks}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {previewMut.isError && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-700">{previewMut.error?.response?.data?.error || 'حدث خطأ'}</p>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  disabled={!file || previewMut.isPending}
                  onClick={handleAnalyse}
                  className="btn-primary px-6 py-2.5 text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                >
                  {previewMut.isPending ? <RefreshCw size={16} className="animate-spin" /> : <Shuffle size={16} />}
                  {previewMut.isPending ? 'جاري التحليل...' : 'تحليل وتوزيع'}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: PREVIEW ───────────────────────────────────────────── */}
          {step === 'preview' && preview && (
            <div className="space-y-5">
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'إجمالي العملاء',    value: preview.total,       icon: Users,     color: 'text-blue-600   bg-blue-50'  },
                  { label: 'منسق موجود',        value: preview.matched,     icon: UserCheck, color: 'text-green-600  bg-green-50' },
                  { label: 'توزيع تلقائي',      value: preview.distributed, icon: Shuffle,   color: 'text-purple-600 bg-purple-50'},
                  { label: 'الأجنتس المشاركين', value: agentSummaryLive.length, icon: Users, color: 'text-amber-600  bg-amber-50' },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-3 shadow-sm">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color.split(' ')[1]}`}>
                      <Icon size={20} className={color.split(' ')[0]} />
                    </div>
                    <div>
                      <p className="text-xl font-bold text-gray-900">{value}</p>
                      <p className="text-xs text-gray-500">{label}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Agent workload cards */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <Users size={18} className="text-primary" /> توزيع الحمل على الأجنتس
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {agentSummaryLive.map(a => (
                    <div key={a.full_name} className="bg-gray-50 rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                          {a.full_name[0]}
                        </div>
                        <span className="text-sm font-semibold text-gray-800 truncate">{a.full_name}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>مهام حالية</span>
                        <span className="font-bold text-gray-700">{a.current_tasks}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">عملاء جدد</span>
                        <span className="font-bold text-green-600">+{a.new_clients}</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div
                          className="bg-primary rounded-full h-1.5 transition-all"
                          style={{ width: `${Math.min(100, ((a.current_tasks + a.new_clients) / Math.max(1, ...agentSummaryLive.map(x => x.current_tasks + x.new_clients))) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Client distribution table */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b bg-gray-50 flex items-center justify-between">
                  <h3 className="font-bold text-gray-800">تفاصيل التوزيع</h3>
                  <span className="text-xs text-gray-500">{displayItems.length} عميل — يمكنك تغيير الموظف لأي عميل</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-2.5 text-start font-semibold text-gray-600">#</th>
                        <th className="px-4 py-2.5 text-start font-semibold text-gray-600">اسم العميل</th>
                        <th className="px-4 py-2.5 text-start font-semibold text-gray-600">الموبايل</th>
                        <th className="px-4 py-2.5 text-start font-semibold text-gray-600">نوع التوزيع</th>
                        <th className="px-4 py-2.5 text-start font-semibold text-gray-600">الموظف المُعين</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {displayItems.map((item, idx) => (
                        <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                          <td className="px-4 py-2.5 font-medium text-gray-900">{item.client_name}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{item.client_phone || '—'}</td>
                          <td className="px-4 py-2.5">
                            <Badge type={item.match_type} map={MATCH_BADGE} />
                          </td>
                          <td className="px-4 py-2.5">
                            {/* Inline agent selector */}
                            <div className="relative">
                              <select
                                value={item.assigned_to}
                                onChange={e => handleOverride(item.id, e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none pr-6"
                              >
                                {agentsData.map(a => (
                                  <option key={a.id} value={a.full_name}>{a.full_name}</option>
                                ))}
                                {/* Include current if not in agentsData */}
                                {!agentsData.find(a => a.full_name === item.assigned_to) && (
                                  <option value={item.assigned_to}>{item.assigned_to}</option>
                                )}
                              </select>
                              <ChevronDown size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
                <button
                  onClick={() => cancelMut.mutate(preview.session_id)}
                  disabled={cancelMut.isPending}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition disabled:opacity-50"
                >
                  <XCircle size={16} /> إلغاء التوزيع
                </button>
                <div className="flex items-center gap-2">
                  <button onClick={resetUpload} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-100 transition">
                    <ArrowLeft size={16} /> رفع ملف آخر
                  </button>
                  <button
                    onClick={() => confirmMut.mutate(preview.session_id)}
                    disabled={confirmMut.isPending}
                    className="btn-primary flex items-center gap-2 px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
                  >
                    {confirmMut.isPending
                      ? <RefreshCw size={16} className="animate-spin" />
                      : <CheckCircle size={16} />}
                    {confirmMut.isPending ? 'جاري التأكيد...' : `تأكيد التوزيع (${displayItems.length} عميل)`}
                  </button>
                </div>
              </div>
              {confirmMut.isError && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <AlertCircle size={16} className="text-red-500" />
                  <p className="text-sm text-red-700">{confirmMut.error?.response?.data?.error || 'حدث خطأ'}</p>
                </div>
              )}
            </div>
          )}

          {/* ── STEP: DONE ──────────────────────────────────────────────── */}
          {step === 'done' && doneResult && (
            <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-sm space-y-5">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="text-green-500" size={36} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">تم التوزيع بنجاح!</h2>
                <p className="text-gray-500 mt-1">
                  تم إنشاء <span className="font-bold text-primary">{doneResult.remarks_created}</span> مهمة جديدة للأجنتس
                </p>
              </div>
              <div className="flex justify-center gap-3">
                <button
                  onClick={resetUpload}
                  className="btn-primary px-6 py-2.5 text-sm font-semibold flex items-center gap-2"
                >
                  <Upload size={16} /> توزيع جديد
                </button>
                <button
                  onClick={() => setTab('history')}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition flex items-center gap-2"
                >
                  <History size={16} /> عرض السجل
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════ TAB: HISTORY ════════════════════════════════════ */}
      {tab === 'history' && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-gray-50">
            <h3 className="font-bold text-gray-800">سجل عمليات التوزيع</h3>
          </div>
          {histLoading ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="animate-spin text-primary" size={28} />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-2.5 text-start font-semibold text-gray-600">#</th>
                      <th className="px-4 py-2.5 text-start font-semibold text-gray-600">الخط</th>
                      <th className="px-4 py-2.5 text-start font-semibold text-gray-600">نوع المهمة</th>
                      <th className="px-4 py-2.5 text-start font-semibold text-gray-600">العملاء</th>
                      <th className="px-4 py-2.5 text-start font-semibold text-gray-600">تأكيد / تلقائي</th>
                      <th className="px-4 py-2.5 text-start font-semibold text-gray-600">الحالة</th>
                      <th className="px-4 py-2.5 text-start font-semibold text-gray-600">بواسطة</th>
                      <th className="px-4 py-2.5 text-start font-semibold text-gray-600">التاريخ</th>
                      <th className="px-4 py-2.5 text-start font-semibold text-gray-600"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(histData?.sessions || []).map(s => (
                      <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-xs text-gray-400">{s.id}</td>
                        <td className="px-4 py-3 font-medium">{s.line}</td>
                        <td className="px-4 py-3 text-xs text-gray-600">{s.task_type}</td>
                        <td className="px-4 py-3">
                          <span className="font-bold text-gray-900">{s.total_clients}</span>
                          <span className="text-xs text-gray-400 mr-1">عميل</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          <span className="text-blue-600">{s.matched}</span>
                          {' / '}
                          <span className="text-purple-600">{s.distributed}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge type={s.status} map={STATUS_BADGE} />
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">{s.created_by_name || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {s.created_at ? new Date(s.created_at).toLocaleDateString('ar-EG') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setDetailId(s.id)}
                            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500"
                          >
                            <Eye size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!histData?.sessions?.length && (
                      <tr>
                        <td colSpan={9} className="text-center text-gray-400 py-10 text-sm">
                          لا توجد عمليات توزيع بعد
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              {histData?.total > 15 && (
                <div className="flex justify-center gap-2 p-4 border-t">
                  <button disabled={histPage <= 1} onClick={() => setHistPage(p => p-1)}
                    className="px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50 disabled:opacity-40">
                    السابق
                  </button>
                  <span className="px-3 py-1.5 text-sm text-gray-600">صفحة {histPage}</span>
                  <button disabled={histPage * 15 >= histData?.total} onClick={() => setHistPage(p => p+1)}
                    className="px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50 disabled:opacity-40">
                    التالي
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
