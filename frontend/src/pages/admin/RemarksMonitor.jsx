import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Upload, CheckCircle, AlertCircle, FileSpreadsheet, Activity, Clock, Hash,
  TrendingUp, Camera, Database, ChevronDown, ChevronUp, Globe, Trash2, RefreshCw,
  Search, Filter, X, BarChart3, AlertTriangle, MessageSquare, UserCircle,
  ArrowLeft, ArrowRight,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import { useAuth } from '../../auth/AuthContext';

const AVAILABLE_LINES = ['Ahmed Hassan', 'Dardasha'];
const PAGE_SIZE = 50;
const SPARK_LEN = 8;

const EVENT_LABEL = {
  created:          { ar: 'تم الإنشاء',     color: 'bg-blue-100 text-blue-700 border-blue-200',     icon: '🆕' },
  note_added:       { ar: 'ملاحظة جديدة',   color: 'bg-violet-100 text-violet-700 border-violet-200', icon: '💬' },
  status_changed:   { ar: 'تغيير الحالة',   color: 'bg-amber-100 text-amber-700 border-amber-200',  icon: '🔄' },
  reassigned:       { ar: 'إعادة تعيين',    color: 'bg-cyan-100 text-cyan-700 border-cyan-200',     icon: '↪️' },
  priority_changed: { ar: 'تغيير الأهمية',  color: 'bg-rose-100 text-rose-700 border-rose-200',     icon: '⚡' },
  category_changed: { ar: 'تغيير التصنيف',  color: 'bg-indigo-100 text-indigo-700 border-indigo-200', icon: '🏷️' },
  resolved:         { ar: 'تم الإنهاء',     color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: '✅' },
};

function formatRelative(hours) {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} دقيقة`;
  if (hours < 24) return `${Math.round(hours)} ساعة`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return rest ? `${days} يوم ${rest}س` : `${days} يوم`;
}

function silenceColor(hours) {
  if (hours == null)          return 'text-gray-400';
  if (hours <= 4)             return 'text-emerald-600';
  if (hours <= 24)            return 'text-amber-600';
  return 'text-red-600';
}

// ─── SPARKLINE ────────────────────────────────────────────────────────────────
function Sparkline({ data, onClick }) {
  if (!data || data.length === 0) {
    return <span className="text-xs text-gray-300">—</span>;
  }
  const max = Math.max(1, ...data.map(d => d.events));
  return (
    <button
      onClick={onClick}
      className="flex items-end gap-0.5 h-6 hover:opacity-80 transition cursor-pointer"
      title="اضغط لعرض الـ Timeline"
    >
      {data.map((d, i) => {
        const ratio = d.events === 0 ? 0 : Math.max(0.15, d.events / max);
        const color =
          d.events === 0 ? 'bg-gray-200' :
          d.events <= 2  ? 'bg-violet-400' :
          d.events <= 5  ? 'bg-violet-600' :
          'bg-violet-800';
        return (
          <div
            key={i}
            className={`w-2 rounded-sm ${color}`}
            style={{ height: `${Math.max(15, ratio * 100)}%` }}
            title={`${new Date(d.snapshot_at).toLocaleString('ar-EG')} — ${d.events} نشاط`}
          />
        );
      })}
    </button>
  );
}

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────
function StatusBadge({ value }) {
  if (!value) return <span className="text-gray-400">—</span>;
  const isDone = value === 'منتهية';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold
      ${isDone ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
      {value}
    </span>
  );
}

function PriorityBadge({ value }) {
  if (!value) return <span className="text-gray-400">—</span>;
  const map = {
    'عالية': 'bg-red-100 text-red-700',
    'هامة':  'bg-orange-100 text-orange-700',
    'عادية': 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold
      ${map[value] || 'bg-gray-100 text-gray-700'}`}>{value}</span>
  );
}

// ─── TIMELINE MODAL ───────────────────────────────────────────────────────────
function TimelineModal({ externalId, line, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/remarks-monitor/timeline/${externalId}`, { params: { line } })
      .then(r => { if (!cancelled) { setData(r.data); setError(null); } })
      .catch(e => { if (!cancelled) setError(e.response?.data?.error || e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [externalId, line]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-gradient-to-r from-violet-50 to-fuchsia-50 border-b flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900">Timeline لـ Remark #{externalId}</h3>
            {data?.remark && (
              <p className="text-xs text-gray-600 mt-1">
                {data.remark.task_type || '—'} • {data.remark.assigned_to || '—'} • {data.total_events} حدث
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white rounded-lg">
            <X size={18} className="text-gray-600" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading && <p className="text-center text-gray-500 py-12">جاري التحميل...</p>}
          {error && (
            <div className="m-5 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {data && !loading && (
            <>
              {/* Current state summary */}
              <div className="px-5 py-3 bg-gray-50 border-b">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <SummaryItem label="الحالة" value={<StatusBadge value={data.remark.status} />} />
                  <SummaryItem label="الأهمية" value={<PriorityBadge value={data.remark.priority} />} />
                  <SummaryItem label="التصنيف" value={data.remark.category || '—'} />
                  <SummaryItem label="معينة لـ" value={data.remark.assigned_to || '—'} />
                  <SummaryItem label="العميل"  value={data.remark.client_name || '—'} />
                  <SummaryItem label="رقم الهاتف" value={<span className="font-mono">{data.remark.client_phone || '—'}</span>} />
                  <SummaryItem label="وقت الإضافة" value={data.remark.added_at || '—'} />
                  <SummaryItem label="آخر تحديث" value={data.remark.last_updated || '—'} />
                </div>
                {data.remark.details && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs text-gray-500 mb-1">التفاصيل:</p>
                    <p className="text-sm text-gray-800">{data.remark.details}</p>
                  </div>
                )}
              </div>

              {/* Events timeline */}
              <div className="p-5">
                <h4 className="font-bold text-gray-800 mb-3 text-sm">سلسلة الأحداث ({data.total_events})</h4>
                {data.events.length === 0 ? (
                  <p className="text-center text-gray-500 py-8 text-sm">لا توجد أحداث مسجلة</p>
                ) : (
                  <div className="space-y-2">
                    {data.events.map(ev => {
                      const cfg = EVENT_LABEL[ev.event_type] || { ar: ev.event_type, color: 'bg-gray-100', icon: '•' };
                      return (
                        <div key={ev.id} className={`flex gap-3 p-3 rounded-lg border ${cfg.color}`}>
                          <span className="text-xl flex-shrink-0">{cfg.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-bold text-sm">{cfg.ar}</span>
                              <span className="text-xs opacity-70 whitespace-nowrap">
                                {ev.occurred_at?.replace('T', ' ').slice(0, 16) || '—'}
                              </span>
                            </div>
                            {ev.event_data && <EventDetails type={ev.event_type} data={ev.event_data} />}
                            <p className="text-[10px] opacity-50 mt-1">
                              Snapshot #{ev.to_snapshot_id} • {ev.snapshot_at?.replace('T', ' ').slice(0, 16) || '—'}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryItem({ label, value }) {
  return (
    <div>
      <span className="text-gray-500">{label}:</span>{' '}
      <span className="font-semibold text-gray-800">{value}</span>
    </div>
  );
}

function EventDetails({ type, data }) {
  if (!data) return null;
  if (type === 'note_added') {
    return (
      <p className="text-sm mt-1 whitespace-pre-wrap break-words bg-white/50 rounded p-2 border border-current/10">
        {data.text || '—'}
      </p>
    );
  }
  if (type === 'status_changed' || type === 'reassigned' || type === 'priority_changed' || type === 'category_changed') {
    return (
      <p className="text-sm mt-1">
        <span className="opacity-60 line-through">{data.from || 'فاضي'}</span>
        <span className="mx-2">←</span>
        <span className="font-bold">{data.to || 'فاضي'}</span>
      </p>
    );
  }
  if (type === 'created') {
    return (
      <p className="text-xs mt-1 opacity-70">
        {[data.task_type, data.assigned_to, data.priority].filter(Boolean).join(' • ')}
      </p>
    );
  }
  return null;
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function RemarksMonitor() {
  const { user } = useAuth();
  const isAdminAllLines = user?.line === 'All';
  const [selectedLine, setSelectedLine] = useState(
    isAdminAllLines ? 'Ahmed Hassan' : (user?.line || 'Ahmed Hassan')
  );

  // Snapshot management state
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapResult, setSnapResult] = useState(null);
  const [snapError, setSnapError] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showSnapMgmt, setShowSnapMgmt] = useState(false);
  const fileInputRef = useRef(null);

  // Dashboard state
  const [dashboard, setDashboard] = useState(null);
  const [loadingDash, setLoadingDash] = useState(false);
  const [dashError, setDashError] = useState(null);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({ task_type: '', category: '', priority: '', status: '', assigned_to: '', search: '', sort: 'last_activity_desc' });
  const [showFilters, setShowFilters] = useState(false);
  const [filterOptions, setFilterOptions] = useState({ tasks: [], categories: [], assignees: [] });
  const [timelineFor, setTimelineFor] = useState(null);

  // ─── DATA LOADING ─────────────────────────────────────────────────────────
  const loadSnapshots = useCallback(async () => {
    try {
      const { data } = await api.get('/remarks-monitor/snapshots', { params: { line: selectedLine } });
      setSnapshots(data.snapshots || []);
    } catch (err) { console.error('Failed to load snapshots:', err); }
  }, [selectedLine]);

  const loadFilters = useCallback(async () => {
    try {
      const { data } = await api.get('/remarks-monitor/filters', { params: { line: selectedLine } });
      setFilterOptions({ tasks: data.tasks || [], categories: data.categories || [], assignees: data.assignees || [] });
    } catch (err) { console.error('Failed to load filters:', err); }
  }, [selectedLine]);

  const loadDashboard = useCallback(async () => {
    setLoadingDash(true); setDashError(null);
    try {
      const params = {
        line: selectedLine, limit: PAGE_SIZE, offset: page * PAGE_SIZE, sparkline: SPARK_LEN,
        ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v && String(v).trim())),
      };
      const { data } = await api.get('/remarks-monitor/dashboard', { params });
      setDashboard(data);
    } catch (err) {
      setDashError(err.response?.data?.error || err.message);
      setDashboard(null);
    } finally { setLoadingDash(false); }
  }, [selectedLine, page, filters]);

  useEffect(() => { loadSnapshots(); loadFilters(); }, [loadSnapshots, loadFilters]);
  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  // ─── ACTIONS ──────────────────────────────────────────────────────────────
  async function handleSnapshotFromDb() {
    setSnapshotting(true); setSnapError(null); setSnapResult(null);
    try {
      const { data } = await api.post('/remarks-monitor/snapshot-from-db', { line: selectedLine });
      setSnapResult(data);
      await Promise.all([loadSnapshots(), loadDashboard()]);
    } catch (err) {
      setSnapError(err.response?.data?.details || err.response?.data?.error || err.message);
    } finally { setSnapshotting(false); }
  }

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setSnapResult(null); setSnapError(null);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true); setSnapError(null); setSnapResult(null);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('line', selectedLine);
    try {
      const { data } = await api.post('/remarks-monitor/upload', formData);
      setSnapResult({ ...data, source: 'upload' });
      await Promise.all([loadSnapshots(), loadDashboard()]);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setSnapError(err.response?.data?.details || err.response?.data?.error || err.message);
    } finally { setUploading(false); }
  }

  async function handleDelete(id) {
    if (!confirm(`هل أنت متأكد من حذف Snapshot #${id}؟`)) return;
    setDeletingId(id);
    try {
      await api.delete(`/remarks-monitor/snapshots/${id}`, { data: { line: selectedLine } });
      await Promise.all([loadSnapshots(), loadDashboard()]);
    } catch (err) {
      setSnapError(err.response?.data?.details || err.response?.data?.error || err.message);
    } finally { setDeletingId(null); }
  }

  function updateFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value }));
    setPage(0);
  }

  function clearFilters() {
    setFilters({ task_type: '', category: '', priority: '', status: '', assigned_to: '', search: '', sort: 'last_activity_desc' });
    setPage(0);
  }

  const activeFilterCount = useMemo(() => {
    return Object.entries(filters).filter(([k, v]) => k !== 'sort' && v && String(v).trim()).length;
  }, [filters]);

  const stats = useMemo(() => {
    if (!dashboard) return null;
    const remarks = dashboard.remarks || [];
    return {
      total:    dashboard.total,
      open:     remarks.filter(r => r.status !== 'منتهية').length,
      stalled:  remarks.filter(r => r.silence_hours != null && r.silence_hours > 24).length,
      activeNow: remarks.filter(r => r.silence_hours != null && r.silence_hours <= 1).length,
    };
  }, [dashboard]);

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <PageHero
        title="مراقبة الـ Remarks"
        subtitle="لوحة متابعة نشاط الـ Remarks والأحداث عبر الوقت"
        icon={Activity}
        gradient="from-violet-500 to-fuchsia-500"
      />

      {/* Top action bar: line + snapshot button */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 flex flex-wrap items-center gap-3">
        {isAdminAllLines && (
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-blue-600" />
            <select
              value={selectedLine}
              onChange={e => { setSelectedLine(e.target.value); setPage(0); }}
              className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-800 text-sm font-semibold
                focus:ring-2 focus:ring-violet-300 outline-none"
            >
              {AVAILABLE_LINES.map(line => <option key={line} value={line}>{line}</option>)}
            </select>
          </div>
        )}

        <button
          onClick={handleSnapshotFromDb}
          disabled={snapshotting}
          className="px-4 py-1.5 rounded-lg font-bold text-white text-sm bg-gradient-to-r from-violet-600 to-fuchsia-600
            hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-40 transition shadow-sm flex items-center gap-2"
        >
          <Camera size={14} />
          {snapshotting ? 'جاري...' : 'خذ Snapshot الآن'}
        </button>

        <button
          onClick={() => loadDashboard()}
          disabled={loadingDash}
          className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm flex items-center gap-2"
        >
          <RefreshCw size={14} className={loadingDash ? 'animate-spin' : ''} />
          تحديث
        </button>

        <button
          onClick={() => setShowSnapMgmt(s => !s)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm flex items-center gap-2 ml-auto"
        >
          <Database size={14} />
          إدارة الـ Snapshots ({snapshots.length})
          {showSnapMgmt ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Snapshot success/error */}
      {snapResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle size={18} className="text-emerald-600" />
            <span className="font-bold text-emerald-900 text-sm">{snapResult.message}</span>
            <span className="text-xs text-emerald-700">
              — Snapshot #{snapResult.snapshot_id} • {snapResult.events_generated} حدث جديد
            </span>
          </div>
          <button onClick={() => setSnapResult(null)} className="p-1 hover:bg-emerald-100 rounded">
            <X size={14} className="text-emerald-700" />
          </button>
        </div>
      )}
      {snapError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1">
            <AlertCircle size={18} className="text-red-600 flex-shrink-0" />
            <span className="text-sm text-red-700">{snapError}</span>
          </div>
          <button onClick={() => setSnapError(null)} className="p-1 hover:bg-red-100 rounded">
            <X size={14} className="text-red-700" />
          </button>
        </div>
      )}

      {/* Snapshot Management (collapsible) */}
      {showSnapMgmt && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 space-y-4">
          <h3 className="font-bold text-gray-800">إدارة الـ Snapshots</h3>

          {/* Upload section */}
          <div className="border border-gray-200 rounded-xl">
            <button
              onClick={() => setShowUpload(s => !s)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition rounded-t-xl"
            >
              <div className="flex items-center gap-2">
                <Upload size={16} className="text-gray-600" />
                <span className="font-semibold text-sm">رفع ملف Excel بديل</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">احتياطي</span>
              </div>
              {showUpload ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {showUpload && (
              <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-3">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer text-sm
                    ${file ? 'border-violet-400 bg-violet-50' : 'border-gray-300 hover:border-violet-400'}`}
                >
                  <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleFileChange} className="hidden" />
                  <FileSpreadsheet size={28} className={`mx-auto mb-1 ${file ? 'text-violet-600' : 'text-gray-400'}`} />
                  {file
                    ? <span className="font-semibold">{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
                    : <span className="text-gray-600">اختر ملف Remarks.xlsx</span>}
                </div>
                <button
                  onClick={handleUpload}
                  disabled={!file || uploading}
                  className="w-full py-2 rounded-lg text-white text-sm bg-gray-700 hover:bg-gray-800 disabled:opacity-40"
                >
                  {uploading ? 'جاري الرفع...' : 'رفع'}
                </button>
              </div>
            )}
          </div>

          {/* Snapshots list */}
          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-2">سجل الـ Snapshots</h4>
            <div className="overflow-x-auto border border-gray-200 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-start text-gray-700">Snapshot</th>
                    <th className="px-3 py-2 text-start text-gray-700">وقت الإنشاء</th>
                    <th className="px-3 py-2 text-start text-gray-700">المُنشئ</th>
                    <th className="px-3 py-2 text-start text-gray-700">Remarks</th>
                    <th className="px-3 py-2 text-start text-gray-700">أحداث</th>
                    <th className="px-3 py-2 text-end text-gray-700"></th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">لا توجد Snapshots</td></tr>
                  ) : snapshots.map(s => (
                    <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 font-bold text-violet-700">#{s.id}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">{s.snapshot_at}</td>
                      <td className="px-3 py-2 text-xs">{s.uploaded_by_name || '—'}</td>
                      <td className="px-3 py-2">{s.total_remarks}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold
                          ${s.events_count === 0 ? 'bg-gray-100 text-gray-600' :
                            s.events_count > 1000 ? 'bg-amber-100 text-amber-700' :
                            'bg-violet-100 text-violet-700'}`}>
                          {s.events_count}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-end">
                        <button
                          onClick={() => handleDelete(s.id)}
                          disabled={deletingId === s.id}
                          className="p-1.5 rounded hover:bg-red-50 disabled:opacity-40"
                          title="حذف"
                        >
                          <Trash2 size={13} className="text-red-500" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={MessageSquare} label="إجمالي" value={stats.total.toLocaleString('ar-EG')} color="blue" />
          <StatCard icon={AlertCircle}   label="مفتوحة (في الصفحة)" value={stats.open} color="amber" />
          <StatCard icon={Activity}      label="نشطة الآن" value={stats.activeNow} color="emerald" />
          <StatCard icon={AlertTriangle} label="ساكنة > 24س" value={stats.stalled} color="red" />
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <button
          onClick={() => setShowFilters(s => !s)}
          className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition rounded-t-2xl"
        >
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-600" />
            <span className="font-semibold text-sm">الفلاتر</span>
            {activeFilterCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-violet-100 text-violet-700 font-bold">
                {activeFilterCount} نشط
              </span>
            )}
          </div>
          {showFilters ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showFilters && (
          <div className="px-5 pb-5 pt-2 border-t border-gray-100 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <FilterField label="بحث (رقم/عميل/تليفون)">
                <div className="relative">
                  <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={filters.search}
                    onChange={e => updateFilter('search', e.target.value)}
                    placeholder="اكتب للبحث..."
                    className="w-full pl-3 pr-8 py-1.5 rounded-lg border border-gray-300 text-sm outline-none focus:ring-2 focus:ring-violet-300"
                  />
                </div>
              </FilterField>
              <FilterField label="المهمة (الفلتر)">
                <select value={filters.task_type} onChange={e => updateFilter('task_type', e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm bg-white">
                  <option value="">الكل</option>
                  {filterOptions.tasks.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </FilterField>
              <FilterField label="التصنيف">
                <select value={filters.category} onChange={e => updateFilter('category', e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm bg-white">
                  <option value="">الكل</option>
                  {filterOptions.categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </FilterField>
              <FilterField label="الأهمية">
                <select value={filters.priority} onChange={e => updateFilter('priority', e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm bg-white">
                  <option value="">الكل</option>
                  <option value="عالية">عالية</option>
                  <option value="هامة">هامة</option>
                  <option value="عادية">عادية</option>
                </select>
              </FilterField>
              <FilterField label="الحالة">
                <select value={filters.status} onChange={e => updateFilter('status', e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm bg-white">
                  <option value="">الكل</option>
                  <option value="غير منتهية">غير منتهية</option>
                  <option value="منتهية">منتهية</option>
                </select>
              </FilterField>
              <FilterField label="معينة لـ">
                <select value={filters.assigned_to} onChange={e => updateFilter('assigned_to', e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm bg-white">
                  <option value="">الكل</option>
                  {filterOptions.assignees.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </FilterField>
              <FilterField label="ترتيب">
                <select value={filters.sort} onChange={e => updateFilter('sort', e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg border border-gray-300 text-sm bg-white">
                  <option value="last_activity_desc">الأحدث نشاطاً</option>
                  <option value="silence_desc">الأكثر سكوتاً</option>
                  <option value="events_desc">الأكثر أحداثاً</option>
                  <option value="priority_desc">حسب الأهمية</option>
                </select>
              </FilterField>
            </div>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="text-xs text-violet-700 hover:underline">
                مسح الفلاتر
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <BarChart3 size={16} className="text-violet-600" />
            الـ Remarks
            {dashboard && <span className="text-xs text-gray-500 font-normal">({dashboard.total.toLocaleString('ar-EG')})</span>}
          </h3>
          {dashboard?.snapshots_meta?.length > 0 && (
            <div className="text-xs text-gray-500">
              النشاط آخر {dashboard.snapshots_meta.length} Snapshot
            </div>
          )}
        </div>

        {dashError && (
          <div className="m-5 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {dashError}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">#</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">المهمة</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">معينة لـ</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">الحالة</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">الأهمية</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">العميل</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">النشاط</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">آخر نشاط</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">أحداث</th>
              </tr>
            </thead>
            <tbody>
              {loadingDash && (!dashboard || !dashboard.remarks.length) ? (
                <tr><td colSpan={9} className="px-3 py-12 text-center text-gray-400">جاري التحميل...</td></tr>
              ) : !dashboard?.remarks?.length ? (
                <tr><td colSpan={9} className="px-3 py-12 text-center text-gray-400">
                  لا توجد Remarks مطابقة. {!dashboard?.latest_snapshot && 'خذ Snapshot أولاً.'}
                </td></tr>
              ) : dashboard.remarks.map(r => (
                <tr key={r.external_id} className="border-t border-gray-100 hover:bg-violet-50/30">
                  <td className="px-3 py-2 font-mono text-xs font-bold text-violet-700">
                    <button onClick={() => setTimelineFor(r.external_id)} className="hover:underline">
                      #{r.external_id}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.task_type || '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <UserCircle size={12} className="text-gray-400" />
                      {r.assigned_to || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2"><StatusBadge value={r.status} /></td>
                  <td className="px-3 py-2"><PriorityBadge value={r.priority} /></td>
                  <td className="px-3 py-2 text-xs">
                    <div className="truncate max-w-[150px]">{r.client_name || '—'}</div>
                    <div className="font-mono text-[10px] text-gray-500">{r.client_phone || ''}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Sparkline data={r.sparkline} onClick={() => setTimelineFor(r.external_id)} />
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className={`font-semibold ${silenceColor(r.silence_hours)}`}>
                      {formatRelative(r.silence_hours)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => setTimelineFor(r.external_id)}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold
                              bg-violet-100 text-violet-700 hover:bg-violet-200 transition">
                      {r.total_events}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {dashboard && dashboard.total > PAGE_SIZE && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-sm">
            <span className="text-gray-600">
              {page * PAGE_SIZE + 1} - {Math.min((page + 1) * PAGE_SIZE, dashboard.total)} من {dashboard.total.toLocaleString('ar-EG')}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-30"
              >
                <ArrowRight size={14} />
              </button>
              <span className="text-xs text-gray-700 px-2">صفحة {page + 1}</span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= dashboard.total}
                className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-30"
              >
                <ArrowLeft size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Timeline Modal */}
      {timelineFor && (
        <TimelineModal
          externalId={timelineFor}
          line={selectedLine}
          onClose={() => setTimelineFor(null)}
        />
      )}
    </div>
  );
}

function FilterField({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-600 block mb-1">{label}</span>
      {children}
    </label>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  const map = {
    blue:    'bg-blue-50 border-blue-200 text-blue-700',
    amber:   'bg-amber-50 border-amber-200 text-amber-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    red:     'bg-red-50 border-red-200 text-red-700',
  };
  return (
    <div className={`rounded-xl border p-3 ${map[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} />
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
