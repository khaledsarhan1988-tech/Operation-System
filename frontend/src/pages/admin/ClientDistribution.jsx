import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload, Users, CheckCircle, XCircle, Clock, RefreshCw,
  ChevronDown, Plus, Trash2, History, ArrowLeft,
  UserCheck, Shuffle, AlertCircle, FileSpreadsheet, X, Eye,
  Calendar,
} from 'lucide-react';
import api from '../../api/axios';

const LINES      = ['Ahmed Hassan', 'Dardasha'];
const PRIORITIES = ['عادية', 'هامة', 'عاجلة'];

// DD/MM/YYYY  ↔  YYYY-MM-DD
function dmyToISO(dmy) {
  if (!dmy) return '';
  const [d, m, y] = dmy.split('/');
  if (!y) return '';
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function isoToDMY(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ─── small helpers ────────────────────────────────────────────────────────────
const STATUS_BADGE = {
  pending:   { label: 'معلقة',  cls: 'bg-amber-100  text-amber-800' },
  confirmed: { label: 'مؤكدة',  cls: 'bg-green-100  text-green-800' },
  cancelled: { label: 'ملغاة',  cls: 'bg-red-100    text-red-800'   },
};
const MATCH_BADGE = {
  existing_coordinator: { label: 'منسق موجود',   cls: 'bg-blue-100  text-blue-800'   },
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
  const hasDateRange = session?.date_from || session?.date_to;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 border-b">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-gray-900">تفاصيل جلسة التوزيع #{session?.id}</h3>
              <div className="flex items-center flex-wrap gap-2 mt-1">
                <span className="text-xs text-gray-500">{session?.line}</span>
                <span className="text-xs text-gray-400">·</span>
                <span className="text-xs text-gray-500">{session?.total_clients} عميل</span>
                <span className="text-xs text-gray-400">·</span>
                <Badge type={session?.status} map={STATUS_BADGE} />
              </div>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg flex-shrink-0"><X size={18} /></button>
          </div>

          {/* Date range banner */}
          {hasDateRange && (
            <div className="mt-3 flex items-center gap-2.5 bg-primary/5 border border-primary/20 rounded-xl px-4 py-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Calendar size={14} className="text-primary" />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500">تم التوزيع بناءً على الفترة الزمنية</p>
                <p className="text-sm font-bold text-primary">
                  {session.date_from && session.date_to
                    ? `${session.date_from}  ←  ${session.date_to}`
                    : session.date_from
                    ? `من ${session.date_from}`
                    : `حتى ${session.date_to}`}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1 p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold text-gray-600">العميل</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-600">الموبايل</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-600">تاريخ الاشتراك</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-600">الموظف</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-600">النوع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">{item.client_name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{item.client_phone || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{item.client_date || '—'}</td>
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

// ─── COORDINATOR STATS component ──────────────────────────────────────────────
function CoordinatorStats() {
  const [statsLine, setStatsLine] = useState('');

  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ['dist-coordinator-stats', statsLine],
    queryFn: () =>
      api.get('/distribution/coordinator-stats', { params: statsLine ? { line: statsLine } : {} })
        .then(r => r.data),
  });

  const progressColor = (pct) => {
    if (pct >= 80) return 'bg-green-500';
    if (pct >= 50) return 'bg-blue-500';
    return 'bg-amber-500';
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header row with line filter */}
      <div className="px-5 py-3 border-b bg-gray-50 flex items-center justify-between gap-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">
          <UserCheck size={18} className="text-primary" />
          حالة المنسقين
        </h3>
        <select
          value={statsLine}
          onChange={e => setStatsLine(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="">كل الخطوط</option>
          {LINES.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="animate-spin text-primary" size={28} />
        </div>
      ) : isError ? (
        <div className="text-center py-12 text-red-500 text-sm">حدث خطأ أثناء تحميل البيانات</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">لا توجد بيانات توزيع بعد</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2.5 text-start font-semibold text-gray-600">المنسق</th>
                <th className="px-4 py-2.5 text-center font-semibold text-gray-600">جديدة</th>
                <th className="px-4 py-2.5 text-center font-semibold text-gray-600">قيد المتابعة</th>
                <th className="px-4 py-2.5 text-center font-semibold text-gray-600">منتهية</th>
                <th className="px-4 py-2.5 text-center font-semibold text-gray-600">الإجمالي</th>
                <th className="px-4 py-2.5 text-start font-semibold text-gray-600 min-w-[140px]">نسبة الإنجاز</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(row => {
                const pct = row.total > 0 ? Math.round((row.closed_count / row.total) * 100) : 0;
                return (
                  <tr key={row.assigned_to} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-semibold text-gray-900">{row.assigned_to}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-50 text-blue-700 font-bold text-xs">
                        {row.new_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-50 text-amber-700 font-bold text-xs">
                        {row.in_progress_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-green-50 text-green-700 font-bold text-xs">
                        {row.closed_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-gray-900">{row.total}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2">
                          <div
                            className={`${progressColor(pct)} rounded-full h-2 transition-all`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-gray-600 w-9 text-left">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function ClientDistribution() {
  const qc = useQueryClient();

  // ── state ──
  const [tab,            setTab]           = useState('new');    // 'new' | 'history' | 'coords'
  const [step,           setStep]          = useState('upload'); // 'upload' | 'preview' | 'done'
  const [dragging,       setDragging]      = useState(false);
  const [file,           setFile]          = useState(null);
  const [fileBase64,     setFileBase64]    = useState(null);
  const [availableDates, setAvailableDates] = useState([]);
  const [selectedDates,  setSelectedDates] = useState(new Set());
  const [dateRangeFrom,  setDateRangeFrom] = useState(''); // YYYY-MM-DD
  const [dateRangeTo,    setDateRangeTo]   = useState(''); // YYYY-MM-DD
  const [line,           setLine]          = useState('Ahmed Hassan');
  const [taskType,       setTaskType]      = useState('متابعة مشترك جديد');
  const [priority,       setPriority]      = useState('عادية');
  const [preview,        setPreview]       = useState(null);
  const [overrides,      setOverrides]     = useState({});
  const [doneResult,     setDoneResult]    = useState(null);
  const [showTTMgr,      setShowTTMgr]     = useState(false);
  const [detailId,       setDetailId]      = useState(null);
  const [histPage,       setHistPage]      = useState(1);
  // Preview-step date filter
  const [pvDateFrom,     setPvDateFrom]    = useState(''); // YYYY-MM-DD
  const [pvDateTo,       setPvDateTo]      = useState(''); // YYYY-MM-DD

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
    mutationFn: payload => api.post('/distribution/preview', payload),
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
    mutationFn: ({ sid, itemIds }) => {
      const body = itemIds ? { item_ids: itemIds } : {};
      return api.post(`/distribution/sessions/${sid}/confirm`, body);
    },
    onSuccess: ({ data }) => {
      setDoneResult(data);
      setStep('done');
      qc.invalidateQueries(['dist-sessions']);
    },
  });

  // ── handlers ──
  const resetUpload = useCallback(() => {
    setStep('upload');
    setFile(null);
    setFileBase64(null);
    setAvailableDates([]);
    setSelectedDates(new Set());
    setDateRangeFrom('');
    setDateRangeTo('');
    setPreview(null);
    setOverrides({});
    setDoneResult(null);
    setPvDateFrom('');
    setPvDateTo('');
  }, []);

  // Start another batch from the SAME file — keep fileBase64 + availableDates
  const startAnotherBatch = useCallback(() => {
    setStep('upload');
    setPreview(null);
    setOverrides({});
    setDoneResult(null);
    setPvDateFrom('');
    setPvDateTo('');
    setDateRangeFrom('');
    setDateRangeTo('');
    // file, fileBase64, availableDates intentionally kept
  }, []);

  // min/max ISO dates derived from available dates
  const { minISO, maxISO } = useMemo(() => {
    if (!availableDates.length) return { minISO: '', maxISO: '' };
    return {
      minISO: dmyToISO(availableDates[0]),
      maxISO: dmyToISO(availableDates[availableDates.length - 1]),
    };
  }, [availableDates]);

  // When date range changes, update selectedDates to match
  useEffect(() => {
    if (!availableDates.length) return;
    if (!dateRangeFrom && !dateRangeTo) {
      setSelectedDates(new Set(availableDates));
      return;
    }
    const from = dateRangeFrom ? new Date(dateRangeFrom) : null;
    const to   = dateRangeTo   ? new Date(dateRangeTo)   : null;
    const filtered = availableDates.filter(dmy => {
      const iso = dmyToISO(dmy);
      if (!iso) return false;
      const dt = new Date(iso);
      if (from && dt < from) return false;
      if (to   && dt > to)   return false;
      return true;
    });
    setSelectedDates(new Set(filtered));
  }, [dateRangeFrom, dateRangeTo, availableDates]);

  const onFileDrop = useCallback(f => {
    if (!f) return;
    if (!f.name.match(/\.xlsx?$/i)) return alert('يرجى رفع ملف Excel فقط (.xlsx)');
    setFile(f);
    setAvailableDates([]);
    setSelectedDates(new Set());
    const reader = new FileReader();
    reader.onload = (e) => {
      const b64 = e.target.result.split(',')[1];
      setFileBase64(b64);
      api.post('/distribution/scan-dates', { file_base64: b64 })
        .then(r => {
          setAvailableDates(r.data.dates);
          setSelectedDates(new Set(r.data.dates));
        })
        .catch(() => {}); // silent fail — user can still analyze without date filter
    };
    reader.readAsDataURL(f);
  }, []);

  const handleDrop = useCallback(e => {
    e.preventDefault(); setDragging(false);
    onFileDrop(e.dataTransfer.files[0]);
  }, [onFileDrop]);

  const handleAnalyse = () => {
    if (!fileBase64) return;
    const payload = {
      file_base64: fileBase64,
      filename: file?.name || 'file.xlsx',
      line,
      task_type: taskType,
      priority,
    };
    if (selectedDates.size > 0 && selectedDates.size < availableDates.length) {
      payload.dates = [...selectedDates];
    }
    previewMut.mutate(payload);
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

  // ── Preview-step date filter ───────────────────────────────────────────────
  const filteredDisplayItems = useMemo(() => {
    if (!pvDateFrom && !pvDateTo) return displayItems;
    const from = pvDateFrom ? new Date(pvDateFrom) : null;
    const to   = pvDateTo   ? new Date(pvDateTo)   : null;
    return displayItems.filter(item => {
      if (!item.client_date) return false; // exclude items with no date when filter is active
      const [d, m, y] = item.client_date.split('/');
      if (!y) return false;
      const dt = new Date(+y, +m - 1, +d);
      if (from && dt < from) return false;
      if (to   && dt > to)   return false;
      return true;
    });
  }, [displayItems, pvDateFrom, pvDateTo]);

  const pvFiltered    = pvDateFrom || pvDateTo;
  const pvMatched     = filteredDisplayItems.filter(i => i.match_type === 'existing_coordinator').length;
  const pvDistributed = filteredDisplayItems.filter(i => i.match_type === 'auto_distributed').length;
  const pvAgents      = new Set(filteredDisplayItems.map(i => i.assigned_to)).size;

  // min/max dates from all display items for the preview range pickers
  const pvMinDate = useMemo(() => {
    const dates = displayItems.map(i => i.client_date).filter(Boolean);
    if (!dates.length) return '';
    const iso = dates.map(dmyToISO).filter(Boolean).sort();
    return iso[0] || '';
  }, [displayItems]);
  const pvMaxDate = useMemo(() => {
    const dates = displayItems.map(i => i.client_date).filter(Boolean);
    if (!dates.length) return '';
    const iso = dates.map(dmyToISO).filter(Boolean).sort();
    return iso[iso.length - 1] || '';
  }, [displayItems]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      {/* ── Modals ── */}
      {showTTMgr && <TaskTypeManager onClose={() => setShowTTMgr(false)} />}
      {detailId  && <HistoryDetail sessionId={detailId} onClose={() => setDetailId(null)} />}

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">توزيع العملاء الجدد</h1>
          <p className="text-sm text-gray-500 mt-1">رفع شيت العملاء وتوزيعهم تلقائياً على المنسقين</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setTab('new'); setStep('upload'); }}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
              tab === 'new' ? 'bg-primary text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Upload size={16} className="inline ml-1.5" />
            توزيع جديد
          </button>
          <button
            onClick={() => setTab('coords')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
              tab === 'coords' ? 'bg-primary text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <UserCheck size={16} className="inline ml-1.5" />
            حالة المنسقين
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
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-5">
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

              {/* Date filter — shown only after scan */}
              {availableDates.length > 0 && (
                <div className="border border-primary/20 bg-primary/3 rounded-2xl p-4 space-y-4">
                  {/* Header */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Calendar size={16} className="text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-800">تصفية بالتاريخ</p>
                        <p className="text-xs text-gray-500">
                          اختر نطاق زمني من <span className="font-semibold text-gray-700">{availableDates[0]}</span> إلى <span className="font-semibold text-gray-700">{availableDates[availableDates.length - 1]}</span>
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => { setDateRangeFrom(''); setDateRangeTo(''); }}
                      className="text-xs px-3 py-1.5 rounded-xl bg-white border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition flex items-center gap-1.5 shadow-sm"
                    >
                      <X size={12} /> تحديد الكل
                    </button>
                  </div>

                  {/* Range pickers */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-gray-600">من تاريخ</label>
                      <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-xl px-3 py-2.5 focus-within:ring-2 focus-within:ring-primary/40 transition">
                        <Calendar size={14} className="text-gray-400 flex-shrink-0" />
                        <input
                          type="date"
                          value={dateRangeFrom}
                          min={minISO} max={maxISO}
                          onChange={e => setDateRangeFrom(e.target.value)}
                          className="flex-1 text-sm text-gray-800 focus:outline-none bg-transparent"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-gray-600">إلى تاريخ</label>
                      <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-xl px-3 py-2.5 focus-within:ring-2 focus-within:ring-primary/40 transition">
                        <Calendar size={14} className="text-gray-400 flex-shrink-0" />
                        <input
                          type="date"
                          value={dateRangeTo}
                          min={minISO} max={maxISO}
                          onChange={e => setDateRangeTo(e.target.value)}
                          className="flex-1 text-sm text-gray-800 focus:outline-none bg-transparent"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Result summary */}
                  <div className={`flex items-center justify-between rounded-xl px-4 py-2.5 ${
                    selectedDates.size === 0
                      ? 'bg-red-50 border border-red-200'
                      : 'bg-emerald-50 border border-emerald-200'
                  }`}>
                    <div className="flex items-center gap-2">
                      <CheckCircle size={15} className={selectedDates.size === 0 ? 'text-red-400' : 'text-emerald-500'} />
                      <span className={`text-sm font-semibold ${selectedDates.size === 0 ? 'text-red-700' : 'text-emerald-800'}`}>
                        {selectedDates.size === 0
                          ? 'لا يوجد عملاء في هذا النطاق'
                          : <>سيتم تضمين <span className="font-black text-lg mx-0.5">{selectedDates.size}</span> يوم</>
                        }
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">
                      من إجمالي {availableDates.length} يوم في الملف
                    </span>
                  </div>
                </div>
              )}

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

              {/* Active agents chips */}
              {agentsData.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">المنسقين النشطين</p>
                  <div className="flex flex-wrap gap-2">
                    {agentsData.map(a => (
                      <div key={a.id} className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5">
                        <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
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
                  <p className="text-sm text-red-700">
                    {previewMut.error?.response?.data?.error
                      || (typeof previewMut.error?.response?.data === 'string' && previewMut.error.response.data)
                      || previewMut.error?.message
                      || 'حدث خطأ'}
                    {previewMut.error?.response?.status && (
                      <span className="text-xs opacity-60 mr-2">[{previewMut.error.response.status}]</span>
                    )}
                  </p>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  disabled={!fileBase64 || previewMut.isPending}
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

              {/* ── Date filter bar ── */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Calendar size={15} className="text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-800">فلتر التوزيع بالتاريخ</p>
                      <p className="text-xs text-gray-400">اختر نطاق زمني ليتم توزيع عملائه فقط — أو اتركه فارغاً لتوزيع الجميع</p>
                    </div>
                  </div>
                  {pvFiltered && (
                    <button onClick={() => { setPvDateFrom(''); setPvDateTo(''); }}
                      className="text-xs px-3 py-1.5 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition flex items-center gap-1.5 font-semibold">
                      <X size={12} /> توزيع الكل ({displayItems.length})
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-500">من تاريخ</label>
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-primary/30 transition">
                      <Calendar size={13} className="text-gray-400 flex-shrink-0" />
                      <input type="date" value={pvDateFrom}
                        min={pvMinDate} max={pvMaxDate}
                        onChange={e => setPvDateFrom(e.target.value)}
                        className="flex-1 text-sm text-gray-800 focus:outline-none bg-transparent" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-500">إلى تاريخ</label>
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-primary/30 transition">
                      <Calendar size={13} className="text-gray-400 flex-shrink-0" />
                      <input type="date" value={pvDateTo}
                        min={pvMinDate} max={pvMaxDate}
                        onChange={e => setPvDateTo(e.target.value)}
                        className="flex-1 text-sm text-gray-800 focus:outline-none bg-transparent" />
                    </div>
                  </div>
                </div>
                {pvFiltered && (
                  <div className={`flex items-center justify-between rounded-xl px-4 py-2.5 ${
                    filteredDisplayItems.length === 0 ? 'bg-red-50 border border-red-200' : 'bg-emerald-50 border border-emerald-200'
                  }`}>
                    <div className="flex items-center gap-2">
                      <CheckCircle size={14} className={filteredDisplayItems.length === 0 ? 'text-red-400' : 'text-emerald-500'} />
                      <span className={`text-sm font-semibold ${filteredDisplayItems.length === 0 ? 'text-red-700' : 'text-emerald-800'}`}>
                        {filteredDisplayItems.length === 0
                          ? 'لا يوجد عملاء في هذا النطاق'
                          : <><span className="font-black text-base mx-0.5">{filteredDisplayItems.length}</span> عميل سيتم توزيعه</>}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">من إجمالي {displayItems.length} عميل</span>
                  </div>
                )}
              </div>

              {/* Summary KPI cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'إجمالي العملاء',    value: pvFiltered ? filteredDisplayItems.length : preview.total,  icon: Users,     color: 'text-blue-600   bg-blue-50'   },
                  { label: 'منسق موجود',        value: pvFiltered ? pvMatched     : preview.matched,              icon: UserCheck, color: 'text-green-600  bg-green-50'  },
                  { label: 'توزيع تلقائي',      value: pvFiltered ? pvDistributed : preview.distributed,          icon: Shuffle,   color: 'text-purple-600 bg-purple-50' },
                  { label: 'المنسقين المشاركين', value: pvFiltered ? pvAgents      : agentSummaryLive.length,      icon: Users,     color: 'text-amber-600  bg-amber-50'  },
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

              {/* Client distribution table — compact scrollable */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800 text-sm">تفاصيل التوزيع</h3>
                  <span className="text-xs text-gray-500">
                    {pvFiltered
                      ? <><span className="font-bold text-primary">{filteredDisplayItems.length}</span> من {displayItems.length} عميل</>
                      : <>{displayItems.length} عميل — يمكنك تغيير الموظف لأي عميل</>}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 text-start font-semibold text-gray-500 w-8">#</th>
                        <th className="px-3 py-2 text-start font-semibold text-gray-500">اسم العميل</th>
                        <th className="px-3 py-2 text-start font-semibold text-gray-500">الموبايل</th>
                        <th className="px-3 py-2 text-start font-semibold text-gray-500">تاريخ الاشتراك</th>
                        <th className="px-3 py-2 text-start font-semibold text-gray-500">النوع</th>
                        <th className="px-3 py-2 text-start font-semibold text-gray-500">الموظف المُعين</th>
                      </tr>
                    </thead>
                  </table>
                  <div className="max-h-[360px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-gray-100">
                        {filteredDisplayItems.map((item, idx) => (
                          <tr key={item.id} className="hover:bg-blue-50/40 transition-colors">
                            <td className="px-3 py-1.5 text-gray-400 w-8">{idx + 1}</td>
                            <td className="px-3 py-1.5 font-medium text-gray-900 max-w-[180px] truncate">{item.client_name}</td>
                            <td className="px-3 py-1.5 font-mono text-gray-500">{item.client_phone || '—'}</td>
                            <td className="px-3 py-1.5 text-gray-500">{item.client_date || '—'}</td>
                            <td className="px-3 py-1.5">
                              <Badge type={item.match_type} map={MATCH_BADGE} />
                            </td>
                            <td className="px-3 py-1.5">
                              <div className="relative">
                                <select
                                  value={item.assigned_to}
                                  onChange={e => handleOverride(item.id, e.target.value)}
                                  className="border border-gray-300 rounded-lg px-2 py-1 text-xs font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none pr-5 min-w-[100px]"
                                >
                                  {agentsData.map(a => (
                                    <option key={a.id} value={a.full_name}>{a.full_name}</option>
                                  ))}
                                  {!agentsData.find(a => a.full_name === item.assigned_to) && (
                                    <option value={item.assigned_to}>{item.assigned_to}</option>
                                  )}
                                </select>
                                <ChevronDown size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                              </div>
                            </td>
                          </tr>
                        ))}
                        {filteredDisplayItems.length === 0 && (
                          <tr>
                            <td colSpan={6} className="text-center py-10 text-gray-400 text-sm">
                              لا يوجد عملاء في هذا النطاق الزمني
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Actions bar */}
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
                    onClick={() => confirmMut.mutate({
                      sid: preview.session_id,
                      itemIds: pvFiltered ? filteredDisplayItems.map(i => i.id) : null,
                    })}
                    disabled={confirmMut.isPending || filteredDisplayItems.length === 0}
                    className="btn-primary flex items-center gap-2 px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
                  >
                    {confirmMut.isPending
                      ? <RefreshCw size={16} className="animate-spin" />
                      : <CheckCircle size={16} />}
                    {confirmMut.isPending ? 'جاري التأكيد...' : `تأكيد التوزيع (${filteredDisplayItems.length} عميل)`}
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
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Success banner */}
              <div className="bg-gradient-to-l from-emerald-500 to-green-600 px-8 py-8 text-center">
                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="text-white" size={36} />
                </div>
                <h2 className="text-xl font-bold text-white">تم التوزيع بنجاح!</h2>
                <p className="text-white/80 mt-1 text-sm">
                  تم إنشاء <span className="font-black text-white text-lg">{doneResult.remarks_created}</span> مهمة جديدة للمنسقين
                </p>
              </div>

              {/* Next action cards */}
              <div className="p-6 space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">ماذا تريد أن تفعل الآن؟</p>

                {/* Option 1: Another batch from same file */}
                {fileBase64 && (
                  <button
                    onClick={startAnotherBatch}
                    className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/40 transition text-right group"
                  >
                    <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center flex-shrink-0 shadow-sm group-hover:scale-105 transition">
                      <Calendar size={20} className="text-white" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900 text-sm">توزيع دفعة أخرى من نفس الملف</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        اختر نطاق تاريخ مختلف (مثلاً فبراير) من <span className="font-semibold text-gray-700">{file?.name}</span>
                      </p>
                    </div>
                    <ArrowLeft size={18} className="text-primary flex-shrink-0 mr-auto" />
                  </button>
                )}

                {/* Option 2: New file */}
                <button
                  onClick={resetUpload}
                  className="w-full flex items-center gap-4 p-4 rounded-2xl border border-gray-200 hover:bg-gray-50 transition text-right group"
                >
                  <div className="w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 group-hover:bg-gray-200 transition">
                    <Upload size={20} className="text-gray-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-gray-800 text-sm">رفع ملف جديد</p>
                    <p className="text-xs text-gray-400 mt-0.5">ابدأ توزيعاً جديداً بملف Excel مختلف</p>
                  </div>
                  <ArrowLeft size={18} className="text-gray-400 flex-shrink-0 mr-auto" />
                </button>

                {/* Option 3: View history */}
                <button
                  onClick={() => setTab('history')}
                  className="w-full flex items-center gap-4 p-4 rounded-2xl border border-gray-200 hover:bg-gray-50 transition text-right group"
                >
                  <div className="w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 group-hover:bg-gray-200 transition">
                    <History size={20} className="text-gray-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-gray-800 text-sm">عرض سجل التوزيع</p>
                    <p className="text-xs text-gray-400 mt-0.5">مراجعة جميع عمليات التوزيع السابقة</p>
                  </div>
                  <ArrowLeft size={18} className="text-gray-400 flex-shrink-0 mr-auto" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════ TAB: COORDINATOR STATS ══════════════════════════ */}
      {tab === 'coords' && <CoordinatorStats />}

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
                  <button disabled={histPage <= 1} onClick={() => setHistPage(p => p - 1)}
                    className="px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50 disabled:opacity-40">
                    السابق
                  </button>
                  <span className="px-3 py-1.5 text-sm text-gray-600">صفحة {histPage}</span>
                  <button disabled={histPage * 15 >= histData?.total} onClick={() => setHistPage(p => p + 1)}
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
