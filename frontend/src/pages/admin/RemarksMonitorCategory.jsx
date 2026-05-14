import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity, Clock, Search, RefreshCw, Globe, X, ArrowLeft, ArrowRight,
  AlertCircle, UserCircle, Layers, TrendingUp, AlertTriangle, MessageSquare,
  Copy, Check, Trophy, BarChart3, Download, Zap, ChevronDown, ChevronUp,
  Settings, Sparkles, Bell, GitCompare, User, Filter,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import { useAuth } from '../../auth/AuthContext';

const THRESHOLD_STORAGE_KEY = 'remarksMonitor.thresholdHours';
const DEFAULT_THRESHOLD_HOURS = 24;

function getStoredThreshold() {
  try {
    const v = localStorage.getItem(THRESHOLD_STORAGE_KEY);
    const n = v ? parseInt(v, 10) : DEFAULT_THRESHOLD_HOURS;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD_HOURS;
  } catch { return DEFAULT_THRESHOLD_HOURS; }
}

const AVAILABLE_LINES = ['Ahmed Hassan', 'Dardasha'];
const PAGE_SIZE = 50;

const EVENT_LABEL = {
  created:          { ar: 'تم الإنشاء',     bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    icon: '🆕' },
  note_added:       { ar: 'ملاحظة جديدة',   bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200',  icon: '💬' },
  status_changed:   { ar: 'تغيير الحالة',   bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   icon: '🔄' },
  reassigned:       { ar: 'إعادة تعيين',    bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200',    icon: '↪️' },
  priority_changed: { ar: 'تغيير الأهمية',  bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200',    icon: '⚡' },
  category_changed: { ar: 'تغيير التصنيف',  bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200',  icon: '🏷️' },
  resolved:         { ar: 'تم الإنهاء',     bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: '✅' },
};

function fmtDuration(d) {
  if (!d || d.total_minutes == null) return '—';
  const parts = [];
  if (d.days)    parts.push(`${d.days} يوم`);
  if (d.hours)   parts.push(`${d.hours} س`);
  if (d.minutes || (!d.days && !d.hours)) parts.push(`${d.minutes} د`);
  return parts.join(' و ');
}

function fmtDurationFromMs(ms) {
  if (ms == null || isNaN(ms)) return '—';
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days    = Math.floor(totalMinutes / 1440);
  const hours   = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return fmtDuration({ days, hours, minutes, total_minutes: totalMinutes });
}

function silenceClass(totalMinutes) {
  if (totalMinutes == null)        return 'text-gray-400';
  if (totalMinutes <= 240)         return 'text-emerald-600';  // <= 4h
  if (totalMinutes <= 1440)        return 'text-amber-600';    // <= 24h
  return 'text-red-600';
}

// ─── Event Timeline Modal (with durations) ────────────────────────────────────
function EventDurationModal({ externalId, line, onClose }) {
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

  const eventsWithDurations = useMemo(() => {
    if (!data?.events) return [];
    const nowMs = Date.now();
    const sorted = [...data.events].sort((a, b) => {
      const ta = Date.parse(a.occurred_at) || 0;
      const tb = Date.parse(b.occurred_at) || 0;
      return ta - tb;
    });
    return sorted.map((ev, i) => {
      const tNow = Date.parse(ev.occurred_at);
      const next = sorted[i + 1];
      let durationMs = null;
      let isOngoing = false;
      if (next) {
        const tNext = Date.parse(next.occurred_at);
        if (!isNaN(tNow) && !isNaN(tNext)) durationMs = tNext - tNow;
      } else {
        if (!isNaN(tNow)) {
          durationMs = nowMs - tNow;
          isOngoing = true;
        }
      }
      return { ...ev, durationMs, isOngoing };
    });
  }, [data]);

  const currentHolder = data?.remark?.assigned_to || '—';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[88vh] overflow-hidden flex flex-col"
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-gradient-to-r from-violet-50 to-fuchsia-50 border-b flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900">تتبع نشاط Remark #{externalId}</h3>
            {data?.remark && (
              <p className="text-xs text-gray-600 mt-1">
                {data.remark.task_type || '—'} • معينة لـ <strong>{currentHolder}</strong> • {data.total_events} حدث
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
            <div className="m-5 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
          )}

          {data && !loading && (
            <div className="p-5">
              {eventsWithDurations.length === 0 ? (
                <p className="text-center text-gray-500 py-8">لا توجد أحداث</p>
              ) : (
                <ol className="relative border-r-2 border-gray-200 mr-4 space-y-4">
                  {eventsWithDurations.map((ev, i) => {
                    const cfg = EVENT_LABEL[ev.event_type] || { ar: ev.event_type, bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', icon: '•' };
                    return (
                      <li key={ev.id} className="mr-6 relative">
                        <span className={`absolute -right-[34px] top-1 w-5 h-5 rounded-full flex items-center justify-center text-xs
                          ${cfg.bg} ${cfg.border} border-2`}>
                          {cfg.icon}
                        </span>
                        <div className={`rounded-lg border p-3 ${cfg.bg} ${cfg.border}`}>
                          <div className="flex items-baseline justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2">
                              <span className={`font-bold text-sm ${cfg.text}`}>#{i + 1} {cfg.ar}</span>
                              {ev.isOngoing && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500 text-white font-bold animate-pulse">
                                  جارٍ الآن
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-gray-500 whitespace-nowrap">
                              {ev.occurred_at?.replace('T', ' ').slice(0, 16) || '—'}
                            </span>
                          </div>

                          {/* Event-specific data */}
                          {ev.event_type === 'note_added' && ev.event_data?.text && (
                            <p className="text-sm bg-white/70 rounded p-2 mt-1 whitespace-pre-wrap break-words">
                              {ev.event_data.text}
                            </p>
                          )}
                          {['status_changed', 'reassigned', 'priority_changed', 'category_changed'].includes(ev.event_type) && ev.event_data && (
                            <p className="text-sm mt-1">
                              <span className="opacity-60 line-through">{ev.event_data.from || 'فاضي'}</span>
                              <span className="mx-2">←</span>
                              <span className="font-bold">{ev.event_data.to || 'فاضي'}</span>
                            </p>
                          )}
                          {ev.event_type === 'created' && ev.event_data && (
                            <p className="text-xs mt-1 opacity-70">
                              {[ev.event_data.task_type, ev.event_data.assigned_to, ev.event_data.priority].filter(Boolean).join(' • ')}
                            </p>
                          )}

                          {/* DURATION — the key feature */}
                          <div className="mt-2 pt-2 border-t border-current/10 flex items-center justify-between text-xs">
                            <span className={`${cfg.text} font-semibold flex items-center gap-1`}>
                              <Clock size={12} />
                              {ev.isOngoing
                                ? <>قعد عند <strong>{currentHolder}</strong> لمدة:</>
                                : 'استمر:'}
                            </span>
                            <span className={`font-bold ${ev.isOngoing ? 'text-amber-700' : cfg.text}`}>
                              {fmtDurationFromMs(ev.durationMs)}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function RemarksMonitorCategory() {
  const { user } = useAuth();
  const isAdminAllLines = user?.line === 'All';
  const [selectedLine, setSelectedLine] = useState(
    isAdminAllLines ? 'Ahmed Hassan' : (user?.line || 'Ahmed Hassan')
  );
  const [category, setCategory] = useState('Inprogress');
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [assigneeOptions, setAssigneeOptions] = useState([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('last_event_desc');
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [openTimeline, setOpenTimeline] = useState(null);

  // New: thresholds, leaderboard, daily events, quick views
  const [thresholdHours, setThresholdHours] = useState(getStoredThreshold());
  const [showLeaderboard, setShowLeaderboard] = useState(true);
  const [showChart, setShowChart] = useState(true);
  const [leaderboard, setLeaderboard] = useState([]);
  const [dailyEvents, setDailyEvents] = useState([]);
  const [chartDays, setChartDays] = useState(30);
  const [activeQuickView, setActiveQuickView] = useState(null);
  const [extraFilters, setExtraFilters] = useState({});

  // Iteration 2: notifications, comparison, employee timeline, bottlenecks
  const [notifyResult, setNotifyResult] = useState(null);
  const [notifying, setNotifying] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showBottlenecks, setShowBottlenecks] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const [p1Start, setP1Start] = useState(weekAgo);
  const [p1End, setP1End] = useState(today);
  const [p2Start, setP2Start] = useState(twoWeeksAgo);
  const [p2End, setP2End] = useState(weekAgo);
  const [compareData, setCompareData] = useState(null);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [bottlenecks, setBottlenecks] = useState([]);
  const [employeeTimeline, setEmployeeTimeline] = useState(null);  // {assignee, events} when opened

  useEffect(() => {
    try { localStorage.setItem(THRESHOLD_STORAGE_KEY, String(thresholdHours)); } catch {}
  }, [thresholdHours]);

  const loadFilters = useCallback(async () => {
    try {
      const { data } = await api.get('/remarks-monitor/filters', { params: { line: selectedLine } });
      setCategoryOptions(data.categories || []);
      setAssigneeOptions(data.assignees || []);
    } catch (err) { console.error(err); }
  }, [selectedLine]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = {
        line: selectedLine,
        category,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        sort,
        ...extraFilters,
      };
      if (assigneeFilter) params.assigned_to = assigneeFilter;
      if (search.trim())  params.search = search.trim();
      const { data } = await api.get('/remarks-monitor/category-distribution', { params });
      setData(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setData(null);
    } finally { setLoading(false); }
  }, [selectedLine, category, page, sort, assigneeFilter, search, extraFilters]);

  const loadLeaderboard = useCallback(async () => {
    try {
      const { data } = await api.get('/remarks-monitor/leaderboard', {
        params: { line: selectedLine, category, stalled_minutes: thresholdHours * 60 },
      });
      setLeaderboard(data.leaderboard || []);
    } catch (err) { console.error('Leaderboard error:', err); }
  }, [selectedLine, category, thresholdHours]);

  const loadDailyEvents = useCallback(async () => {
    try {
      const { data } = await api.get('/remarks-monitor/daily-events', {
        params: { line: selectedLine, category, days: chartDays },
      });
      setDailyEvents(data.daily || []);
    } catch (err) { console.error('Daily events error:', err); }
  }, [selectedLine, category, chartDays]);

  useEffect(() => { loadFilters(); }, [loadFilters]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadLeaderboard(); }, [loadLeaderboard]);
  useEffect(() => { loadDailyEvents(); }, [loadDailyEvents]);

  function applyQuickView(view) {
    setActiveQuickView(view);
    setPage(0);
    setAssigneeFilter('');
    setSearch('');
    switch (view) {
      case 'oldest':
        setSort('first_event_asc');
        setExtraFilters({});
        break;
      case 'most_silent':
        setSort('time_since_last_desc');
        setExtraFilters({});
        break;
      case 'no_events':
        setSort('first_event_asc');
        setExtraFilters({ max_events: 0 });
        break;
      case 'stalled_threshold':
        setSort('time_since_last_desc');
        setExtraFilters({ min_silence_minutes: thresholdHours * 60 });
        break;
      case 'high_activity':
        setSort('events_desc');
        setExtraFilters({ min_events: 5 });
        break;
      case 'all':
      default:
        setSort('last_event_desc');
        setExtraFilters({});
        break;
    }
  }

  const loadBottlenecks = useCallback(async () => {
    try {
      const { data } = await api.get('/remarks-monitor/bottlenecks', {
        params: { line: selectedLine, category },
      });
      setBottlenecks(data.bottlenecks || []);
    } catch (err) { console.error('Bottlenecks error:', err); }
  }, [selectedLine, category]);

  useEffect(() => { loadBottlenecks(); }, [loadBottlenecks]);

  async function handleNotifyStale() {
    if (!confirm(`سيتم إرسال تنبيهات للموظفين اللي عندهم Remarks ساكتة أكتر من ${thresholdHours} ساعة. متابعة؟`)) return;
    setNotifying(true); setNotifyResult(null);
    try {
      const { data } = await api.post('/remarks-monitor/notify-stale', {
        line: selectedLine, category, threshold_hours: thresholdHours,
      });
      setNotifyResult(data);
      setTimeout(() => setNotifyResult(null), 6000);
    } catch (err) {
      setNotifyResult({ error: err.response?.data?.details || err.response?.data?.error || err.message });
    } finally { setNotifying(false); }
  }

  async function loadComparison() {
    setLoadingCompare(true);
    try {
      const { data } = await api.get('/remarks-monitor/compare-periods', {
        params: { line: selectedLine, category, p1_start: p1Start, p1_end: p1End, p2_start: p2Start, p2_end: p2End },
      });
      setCompareData(data);
    } catch (err) {
      setCompareData({ error: err.response?.data?.details || err.response?.data?.error || err.message });
    } finally { setLoadingCompare(false); }
  }

  async function openEmployeeTimeline(assignee) {
    setEmployeeTimeline({ assignee, loading: true, events: [] });
    try {
      const { data } = await api.get('/remarks-monitor/employee-timeline', {
        params: { line: selectedLine, assignee, category, days: 30 },
      });
      setEmployeeTimeline({ assignee, loading: false, events: data.events || [], total: data.total });
    } catch (err) {
      setEmployeeTimeline({ assignee, loading: false, events: [], error: err.message });
    }
  }

  function exportCsv() {
    if (!data?.remarks?.length) return;
    const headers = ['#', 'المهمة', 'العميل', 'رقم الهاتف', 'الأهمية', 'الحالة', 'التصنيف',
                     'معينة لـ', 'عدد الأحداث', 'أول حدث', 'آخر حدث', 'قعد عنده مدة (دقيقة)', 'المدى الفعّال (دقيقة)'];
    const rows = data.remarks.map(r => [
      r.external_id, r.task_type || '', r.client_name || '', r.client_phone || '',
      r.priority || '', r.status || '', r.category || '', r.assigned_to || '',
      r.total_events || 0,
      r.first_event_at || '', r.last_event_at || '',
      r.time_since_last?.total_minutes ?? '',
      r.active_span?.total_minutes ?? '',
    ]);
    const escape = (v) => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const csv = [headers, ...rows].map(row => row.map(escape).join(',')).join('\r\n');
    const bom = '﻿';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `remarks-monitor-${category}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const stats = useMemo(() => {
    if (!data?.remarks) return null;
    const remarks = data.remarks;
    const totalEvents = remarks.reduce((sum, r) => sum + (r.total_events || 0), 0);
    const stalled = remarks.filter(r => r.time_since_last?.total_minutes > 1440).length;
    const active  = remarks.filter(r => r.time_since_last?.total_minutes != null && r.time_since_last.total_minutes <= 60).length;
    return {
      total: data.total,
      avg_events: remarks.length ? Math.round((totalEvents / remarks.length) * 10) / 10 : 0,
      stalled,
      active,
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <PageHero
        title={`توزيع التصنيف "${category}"`}
        subtitle="تتبع الأحداث ومدتها لكل Remark — مع مين الآن وقعد عنده قد إيه"
        icon={Layers}
        gradient="from-fuchsia-500 to-pink-500"
      />

      {/* Top bar */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 flex flex-wrap items-center gap-3">
        {isAdminAllLines && (
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-blue-600" />
            <select
              value={selectedLine}
              onChange={e => { setSelectedLine(e.target.value); setPage(0); }}
              className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm font-semibold focus:ring-2 focus:ring-fuchsia-300 outline-none"
            >
              {AVAILABLE_LINES.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-600">التصنيف:</span>
          <select
            value={category}
            onChange={e => { setCategory(e.target.value); setPage(0); }}
            className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm font-semibold focus:ring-2 focus:ring-fuchsia-300 outline-none"
          >
            {categoryOptions.length === 0 && <option value={category}>{category}</option>}
            {categoryOptions.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
          {categoryOptions.length > 0 && <CopyListButton items={categoryOptions} getValue={(c) => c.name} />}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-600">معينة لـ:</span>
          <select
            value={assigneeFilter}
            onChange={e => { setAssigneeFilter(e.target.value); setPage(0); }}
            className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-fuchsia-300 outline-none"
          >
            <option value="">الكل</option>
            {assigneeOptions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-600">ترتيب:</span>
          <select
            value={sort}
            onChange={e => { setSort(e.target.value); setPage(0); }}
            className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-fuchsia-300 outline-none"
          >
            <option value="last_event_desc">آخر حدث (الأحدث)</option>
            <option value="time_since_last_desc">الأكثر سكوتاً</option>
            <option value="events_desc">الأكثر أحداثاً</option>
            <option value="first_event_asc">الأقدم</option>
          </select>
        </div>

        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="بحث برقم / عميل / تليفون / مسؤول..."
            className="w-full pl-3 pr-8 py-1.5 rounded-lg border border-gray-300 text-sm outline-none focus:ring-2 focus:ring-fuchsia-300"
          />
        </div>

        <button
          onClick={() => load()}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm flex items-center gap-2"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          تحديث
        </button>

        <button
          onClick={exportCsv}
          disabled={!data?.remarks?.length}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm flex items-center gap-2 font-bold"
          title="تصدير الجدول الحالي لـ Excel"
        >
          <Download size={14} />
          Export
        </button>
      </div>

      {/* Quick View buttons */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-gray-500 px-2">Quick Views:</span>
        <QuickBtn active={activeQuickView === 'all'}              onClick={() => applyQuickView('all')}             icon={Layers}        label="الكل" />
        <QuickBtn active={activeQuickView === 'oldest'}           onClick={() => applyQuickView('oldest')}          icon={Clock}         label="الأقدم" />
        <QuickBtn active={activeQuickView === 'most_silent'}      onClick={() => applyQuickView('most_silent')}     icon={AlertTriangle} label="الأكثر سكوتاً" />
        <QuickBtn active={activeQuickView === 'stalled_threshold'} onClick={() => applyQuickView('stalled_threshold')} icon={Zap}        label={`تجاوز ${thresholdHours}س`} color="red" />
        <QuickBtn active={activeQuickView === 'no_events'}        onClick={() => applyQuickView('no_events')}       icon={AlertCircle}   label="بدون أحداث" />
        <QuickBtn active={activeQuickView === 'high_activity'}    onClick={() => applyQuickView('high_activity')}   icon={Sparkles}      label="نشاط عالي (5+)" color="emerald" />

        <button
          onClick={handleNotifyStale}
          disabled={notifying}
          className="px-3 py-1 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white flex items-center gap-1.5"
          title={`إرسال تنبيهات للموظفين اللي عندهم Remarks ساكتة أكتر من ${thresholdHours} ساعة`}
        >
          <Bell size={12} />
          {notifying ? 'جاري الإرسال...' : `تنبيه السكوت`}
        </button>

        <div className="ml-auto flex items-center gap-2">
          <Settings size={14} className="text-gray-500" />
          <span className="text-xs font-semibold text-gray-600">عتبة السكوت:</span>
          <input
            type="number"
            min="1"
            max="720"
            value={thresholdHours}
            onChange={e => setThresholdHours(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-16 px-2 py-1 rounded-lg border border-gray-300 text-sm text-center"
          />
          <span className="text-xs text-gray-600">ساعة</span>
        </div>
      </div>

      {/* Notify result */}
      {notifyResult && (
        <div className={`rounded-xl p-3 flex items-center justify-between ${
          notifyResult.error ? 'bg-red-50 border border-red-200' : 'bg-emerald-50 border border-emerald-200'
        }`}>
          <div className="flex items-center gap-2 text-sm">
            {notifyResult.error ? (
              <><AlertCircle size={16} className="text-red-600" /><span className="text-red-700">{notifyResult.error}</span></>
            ) : (
              <><Check size={16} className="text-emerald-600" />
                <span className="text-emerald-800 font-semibold">{notifyResult.message}</span>
                <span className="text-emerald-700">
                  — {notifyResult.stale_count || 0} Remark متجاوزة، تم تنبيه {notifyResult.notifications_sent || 0} موظف ({notifyResult.assignees_notified} مسؤول)
                </span></>
            )}
          </div>
          <button onClick={() => setNotifyResult(null)} className="p-1 hover:bg-white/50 rounded">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={MessageSquare} label="الإجمالي"             value={stats.total.toLocaleString('ar-EG')} color="fuchsia" />
          <StatCard icon={TrendingUp}    label="متوسط الأحداث/Remark" value={stats.avg_events} color="violet" />
          <StatCard icon={Activity}      label="نشطة الآن (آخر ساعة)" value={stats.active} color="emerald" />
          <StatCard icon={AlertTriangle} label="ساكنة > 24 ساعة"       value={stats.stalled} color="red" />
        </div>
      )}

      {/* Leaderboard */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <button onClick={() => setShowLeaderboard(s => !s)}
          className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <Trophy size={16} className="text-amber-500" />
            <span className="font-bold text-gray-800">Leaderboard — أداء الموظفين ({leaderboard.length})</span>
          </div>
          {showLeaderboard ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showLeaderboard && (
          <div className="px-5 pb-5 pt-0 border-t border-gray-100">
            {leaderboard.length === 0 ? (
              <p className="text-center text-gray-500 py-6 text-sm">لا توجد بيانات للموظفين</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-start font-semibold text-gray-700">#</th>
                      <th className="px-3 py-2 text-start font-semibold text-gray-700">الموظف</th>
                      <th className="px-3 py-2 text-start font-semibold text-gray-700">Remarks</th>
                      <th className="px-3 py-2 text-start font-semibold text-gray-700">إجمالي الأحداث</th>
                      <th className="px-3 py-2 text-start font-semibold text-gray-700">نشط الآن</th>
                      <th className="px-3 py-2 text-start font-semibold text-gray-700">متجاوز العتبة</th>
                      <th className="px-3 py-2 text-start font-semibold text-gray-700">متوسط السكوت</th>
                      <th className="px-3 py-2 text-start font-semibold text-gray-700">أقدم Remark</th>
                      <th className="px-3 py-2 text-end font-semibold text-gray-700"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...leaderboard]
                      .sort((a, b) => (b.remarks_count || 0) - (a.remarks_count || 0))
                      .map((lb, i) => (
                      <tr key={lb.assigned_to} className="border-t border-gray-100 hover:bg-amber-50/30">
                        <td className="px-3 py-2 font-bold text-gray-500">{i + 1}</td>
                        <td className="px-3 py-2 font-semibold">{lb.assigned_to}</td>
                        <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-700 text-xs font-bold">{lb.remarks_count}</span></td>
                        <td className="px-3 py-2 text-violet-700 font-semibold">{lb.total_events}</td>
                        <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">{lb.active_count}</span></td>
                        <td className="px-3 py-2">
                          {lb.stalled_count > 0
                            ? <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold">{lb.stalled_count}</span>
                            : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs">{fmtDurationFromMs((lb.avg_silence_minutes || 0) * 60000)}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">{fmtDurationFromMs((lb.oldest_remark_age_minutes || 0) * 60000)}</td>
                        <td className="px-3 py-2 text-end flex gap-1 justify-end">
                          <button
                            onClick={(e) => { e.stopPropagation(); setAssigneeFilter(lb.assigned_to); setPage(0); setActiveQuickView(null); }}
                            className="text-xs px-2 py-1 rounded bg-fuchsia-100 hover:bg-fuchsia-200 text-fuchsia-700 font-semibold"
                            title="فلترة الجدول السفلي"
                          >
                            <Filter size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); openEmployeeTimeline(lb.assigned_to); }}
                            className="text-xs px-2 py-1 rounded bg-purple-100 hover:bg-purple-200 text-purple-700 font-semibold"
                            title="عرض Timeline الموظف"
                          >
                            <User size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-gray-400 mt-2">💡 اضغط على صف الموظف لفلترة الجدول السفلي على بياناته</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Daily Events Chart */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <button onClick={() => setShowChart(s => !s)}
          className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-blue-500" />
            <span className="font-bold text-gray-800">الأحداث على مدار الأيام (آخر {chartDays} يوم)</span>
          </div>
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <select value={chartDays} onChange={e => setChartDays(parseInt(e.target.value))}
              className="px-2 py-0.5 rounded border border-gray-300 text-xs">
              <option value={7}>7 أيام</option>
              <option value={14}>14 يوم</option>
              <option value={30}>30 يوم</option>
              <option value={60}>60 يوم</option>
              <option value={90}>90 يوم</option>
            </select>
            {showChart ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>
        {showChart && (
          <div className="px-5 pb-5 pt-0 border-t border-gray-100">
            {dailyEvents.length === 0 ? (
              <p className="text-center text-gray-500 py-8 text-sm">لا توجد أحداث في الفترة المحددة</p>
            ) : (
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={dailyEvents} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ fontWeight: 'bold' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="events_count"    name="عدد الأحداث"     fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="remarks_touched" name="Remarks متأثرة" fill="#ec4899" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottlenecks */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <button onClick={() => setShowBottlenecks(s => !s)}
          className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-orange-500" />
            <span className="font-bold text-gray-800">عنق الزجاجة — أنواع المهام الأكثر إشكالية ({bottlenecks.length})</span>
          </div>
          {showBottlenecks ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showBottlenecks && (
          <div className="px-5 pb-5 pt-0 border-t border-gray-100">
            {bottlenecks.length === 0 ? (
              <p className="text-center text-gray-500 py-6 text-sm">لا توجد بيانات كافية</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-orange-50">
                    <tr>
                      <th className="px-3 py-2 text-start font-semibold text-orange-900">#</th>
                      <th className="px-3 py-2 text-start font-semibold text-orange-900">نوع المهمة</th>
                      <th className="px-3 py-2 text-start font-semibold text-orange-900">Remarks</th>
                      <th className="px-3 py-2 text-start font-semibold text-orange-900">إجمالي الأحداث</th>
                      <th className="px-3 py-2 text-start font-semibold text-orange-900">{'ساكنة >24س'}</th>
                      <th className="px-3 py-2 text-start font-semibold text-orange-900">{'ساكنة >72س'}</th>
                      <th className="px-3 py-2 text-start font-semibold text-orange-900">متوسط السكوت</th>
                      <th className="px-3 py-2 text-start font-semibold text-orange-900">أقصى سكوت</th>
                      <th className="px-3 py-2 text-start font-semibold text-orange-900">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bottlenecks.slice(0, 10).map((b, i) => (
                      <tr key={b.task_type} className={`border-t border-gray-100 hover:bg-orange-50/40 ${i < 3 ? 'bg-orange-50/30' : ''}`}>
                        <td className="px-3 py-2 font-bold text-gray-500">{i + 1}</td>
                        <td className="px-3 py-2 font-semibold">{b.task_type}</td>
                        <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-700 text-xs font-bold">{b.remarks_count}</span></td>
                        <td className="px-3 py-2">{b.total_events}</td>
                        <td className="px-3 py-2">{b.stalled_24h > 0 ? <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">{b.stalled_24h}</span> : '—'}</td>
                        <td className="px-3 py-2">{b.stalled_72h > 0 ? <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold">{b.stalled_72h}</span> : '—'}</td>
                        <td className="px-3 py-2 text-xs">{fmtDurationFromMs((b.avg_silence_minutes || 0) * 60000)}</td>
                        <td className="px-3 py-2 text-xs text-red-700 font-semibold">{fmtDurationFromMs((b.max_silence || 0) * 60000)}</td>
                        <td className="px-3 py-2 font-bold text-orange-700">{Math.round(b.bottleneck_score)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-gray-400 mt-2">
                  💡 الـ Score = (stalled_24h × 2) + (stalled_72h × 5) + متوسط السكوت بالساعات. الأعلى = الأكثر إشكالية.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Period Comparison */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <button onClick={() => setShowCompare(s => !s)}
          className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <GitCompare size={16} className="text-purple-500" />
            <span className="font-bold text-gray-800">مقارنة بين فترتين</span>
          </div>
          {showCompare ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showCompare && (
          <div className="px-5 pb-5 pt-3 border-t border-gray-100 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-purple-50 rounded-xl p-3 border border-purple-200">
                <h4 className="font-bold text-purple-900 text-sm mb-2">الفترة 1 (الأحدث)</h4>
                <div className="flex gap-2 text-xs">
                  <input type="date" value={p1Start} onChange={e => setP1Start(e.target.value)}
                    className="flex-1 px-2 py-1 rounded border border-purple-300" />
                  <input type="date" value={p1End} onChange={e => setP1End(e.target.value)}
                    className="flex-1 px-2 py-1 rounded border border-purple-300" />
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                <h4 className="font-bold text-gray-700 text-sm mb-2">الفترة 2 (للمقارنة)</h4>
                <div className="flex gap-2 text-xs">
                  <input type="date" value={p2Start} onChange={e => setP2Start(e.target.value)}
                    className="flex-1 px-2 py-1 rounded border border-gray-300" />
                  <input type="date" value={p2End} onChange={e => setP2End(e.target.value)}
                    className="flex-1 px-2 py-1 rounded border border-gray-300" />
                </div>
              </div>
            </div>
            <button onClick={loadComparison} disabled={loadingCompare}
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold disabled:opacity-40 flex items-center gap-2">
              <GitCompare size={14} />
              {loadingCompare ? 'جاري المقارنة...' : 'قارن الفترتين'}
            </button>

            {compareData && !compareData.error && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                <ComparePeriodCard title="الفترة 1 (الأحدث)" data={compareData.period1} accent="purple" />
                <ComparePeriodCard title="الفترة 2 (للمقارنة)" data={compareData.period2} accent="gray" />
                <div className="md:col-span-2 bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm">
                  <strong className="text-blue-900">الفرق:</strong>{' '}
                  <CompareDiff label="الأحداث" v1={compareData.period1.total_events} v2={compareData.period2.total_events} />{' • '}
                  <CompareDiff label="Remarks متأثرة" v1={compareData.period1.unique_remarks} v2={compareData.period2.unique_remarks} />{' • '}
                  <CompareDiff label="أحداث/يوم" v1={compareData.period1.avg_events_per_day} v2={compareData.period2.avg_events_per_day} />
                </div>
              </div>
            )}
            {compareData?.error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{compareData.error}</div>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Layers size={16} className="text-fuchsia-600" />
            Remarks بتصنيف "{category}"
            {data && <span className="text-xs text-gray-500 font-normal">({data.total.toLocaleString('ar-EG')})</span>}
          </h3>
          {activeQuickView && activeQuickView !== 'all' && (
            <button onClick={() => applyQuickView('all')}
              className="text-xs text-violet-600 hover:underline">
              مسح Quick View
            </button>
          )}
        </div>

        {error && (
          <div className="m-5 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">#</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">المهمة</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">العميل</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">عدد الأحداث</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">آخر حدث</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">مع مين الآن</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">قعد عنده مدة</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700">المدى الفعّال</th>
                <th className="px-3 py-2 text-start font-semibold text-gray-700"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (!data || !data.remarks.length) ? (
                <tr><td colSpan={9} className="px-3 py-12 text-center text-gray-400">جاري التحميل...</td></tr>
              ) : !data?.remarks?.length ? (
                <tr><td colSpan={9} className="px-3 py-12 text-center text-gray-400">
                  لا توجد Remarks في هذا التصنيف
                </td></tr>
              ) : data.remarks.map(r => {
                const isStalled = r.time_since_last?.total_minutes != null
                  && r.time_since_last.total_minutes >= thresholdHours * 60;
                return (
                <tr key={r.external_id} className={`border-t border-gray-100 hover:bg-fuchsia-50/30 ${
                  isStalled ? 'bg-red-50/40' : ''
                }`}>
                  <td className="px-3 py-2 font-mono text-xs font-bold text-fuchsia-700">
                    <button onClick={() => setOpenTimeline(r.external_id)} className="hover:underline">
                      #{r.external_id}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.task_type || '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    <div className="truncate max-w-[150px]">{r.client_name || '—'}</div>
                    <div className="font-mono text-[10px] text-gray-500">{r.client_phone || ''}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-fuchsia-100 text-fuchsia-700">
                      {r.total_events}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">
                    {r.last_event_at ? r.last_event_at.replace('T', ' ').slice(0, 16) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <UserCircle size={12} className="text-gray-400" />
                      {r.assigned_to || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className={`font-bold ${silenceClass(r.time_since_last?.total_minutes)}`}>
                      {fmtDuration(r.time_since_last)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {fmtDuration(r.active_span)}
                  </td>
                  <td className="px-3 py-2 text-end">
                    <button
                      onClick={() => setOpenTimeline(r.external_id)}
                      className="text-xs px-2 py-1 rounded-lg bg-fuchsia-100 hover:bg-fuchsia-200 text-fuchsia-700 font-bold"
                    >
                      التفاصيل
                    </button>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total > PAGE_SIZE && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-sm">
            <span className="text-gray-600">
              {page * PAGE_SIZE + 1} - {Math.min((page + 1) * PAGE_SIZE, data.total)} من {data.total.toLocaleString('ar-EG')}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-30">
                <ArrowRight size={14} />
              </button>
              <span className="text-xs px-2">صفحة {page + 1}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= data.total}
                className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-30">
                <ArrowLeft size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {openTimeline && (
        <EventDurationModal
          externalId={openTimeline}
          line={selectedLine}
          onClose={() => setOpenTimeline(null)}
        />
      )}

      {/* Employee Timeline Modal */}
      {employeeTimeline && (
        <EmployeeTimelineModal
          data={employeeTimeline}
          onClose={() => setEmployeeTimeline(null)}
          onOpenRemark={(id) => { setEmployeeTimeline(null); setOpenTimeline(id); }}
        />
      )}
    </div>
  );
}

function EmployeeTimelineModal({ data, onClose, onOpenRemark }) {
  const eventsByDay = useMemo(() => {
    if (!data?.events) return [];
    const map = new Map();
    for (const ev of data.events) {
      const day = ev.occurred_at?.slice(0, 10) || '—';
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(ev);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[88vh] overflow-hidden flex flex-col"
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-gradient-to-r from-purple-50 to-pink-50 border-b flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <UserCircle size={20} className="text-purple-600" />
              Timeline الموظف: {data.assignee}
            </h3>
            <p className="text-xs text-gray-600 mt-1">آخر 30 يوم — {data.total || data.events?.length || 0} حدث</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white rounded-lg">
            <X size={18} className="text-gray-600" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {data.loading && <p className="text-center text-gray-500 py-12">جاري التحميل...</p>}
          {data.error && <div className="m-5 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{data.error}</div>}
          {!data.loading && eventsByDay.length === 0 && (
            <p className="text-center text-gray-500 py-12">لا توجد أحداث في الفترة</p>
          )}
          {!data.loading && eventsByDay.length > 0 && (
            <div className="p-5 space-y-4">
              {eventsByDay.map(([day, evs]) => (
                <div key={day}>
                  <h4 className="font-bold text-gray-800 mb-2 sticky top-0 bg-white py-1 text-sm">
                    📅 {day} <span className="text-xs text-gray-500 font-normal">({evs.length} حدث)</span>
                  </h4>
                  <div className="space-y-1.5">
                    {evs.map(ev => {
                      const cfg = EVENT_LABEL[ev.event_type] || { ar: ev.event_type, bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', icon: '•' };
                      return (
                        <div key={ev.id} className={`rounded-lg border p-2.5 ${cfg.bg} ${cfg.border} flex items-start gap-3`}>
                          <span className="text-lg">{cfg.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2 flex-wrap">
                              <span className={`font-bold text-xs ${cfg.text}`}>{cfg.ar}</span>
                              <button onClick={() => onOpenRemark(ev.external_id)}
                                className="text-xs font-mono font-bold text-fuchsia-700 hover:underline">
                                #{ev.external_id} • {ev.task_type || '—'}
                              </button>
                              <span className="text-xs text-gray-500">{ev.occurred_at?.slice(11, 16)}</span>
                            </div>
                            {ev.event_type === 'note_added' && ev.event_data?.text && (
                              <p className="text-xs mt-1 bg-white/70 rounded p-1.5 line-clamp-2">{ev.event_data.text}</p>
                            )}
                            {ev.client_name && (
                              <p className="text-[10px] text-gray-500 mt-0.5">عميل: {ev.client_name}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ComparePeriodCard({ title, data, accent }) {
  const accentMap = {
    purple: 'bg-purple-50 border-purple-200 text-purple-900',
    gray:   'bg-gray-50 border-gray-200 text-gray-800',
  };
  return (
    <div className={`rounded-xl border p-3 ${accentMap[accent]}`}>
      <h4 className="font-bold text-sm mb-2">{title} <span className="text-xs opacity-60">({data.start} → {data.end})</span></h4>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Metric label="إجمالي الأحداث"   value={data.total_events} />
        <Metric label="Remarks متأثرة"   value={data.unique_remarks} />
        <Metric label="متوسط يومي"      value={data.avg_events_per_day} />
      </div>
      {data.top_assignees && data.top_assignees.length > 0 && (
        <div className="mt-2 pt-2 border-t border-current/10">
          <p className="text-[10px] opacity-70 mb-1">أعلى 5 موظفين:</p>
          <div className="flex flex-wrap gap-1">
            {data.top_assignees.map(a => (
              <span key={a.assigned_to} className="text-[10px] px-1.5 py-0.5 rounded bg-white/50">
                {a.assigned_to} ({a.events_count})
              </span>
            ))}
          </div>
        </div>
      )}
      {data.by_type && data.by_type.length > 0 && (
        <div className="mt-2 pt-2 border-t border-current/10">
          <p className="text-[10px] opacity-70 mb-1">حسب نوع الحدث:</p>
          <div className="flex flex-wrap gap-1">
            {data.by_type.map(t => (
              <span key={t.event_type} className="text-[10px] px-1.5 py-0.5 rounded bg-white/50 font-mono">
                {t.event_type}: {t.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="bg-white/60 rounded p-1.5">
      <p className="opacity-70">{label}</p>
      <p className="font-bold text-lg">{value}</p>
    </div>
  );
}

function CompareDiff({ label, v1, v2 }) {
  const diff = (v1 || 0) - (v2 || 0);
  const pct = v2 ? Math.round(((v1 - v2) / v2) * 100) : (v1 ? 100 : 0);
  const color = diff > 0 ? 'text-emerald-700' : diff < 0 ? 'text-red-700' : 'text-gray-600';
  const sign = diff > 0 ? '+' : '';
  return (
    <span className="text-sm">
      <strong>{label}:</strong>{' '}
      <span className={color}>{sign}{diff} ({sign}{pct}%)</span>
    </span>
  );
}

function QuickBtn({ active, onClick, icon: Icon, label, color = 'violet' }) {
  const colorMap = {
    violet:  { active: 'bg-violet-600 text-white',  idle: 'bg-violet-50 text-violet-700 hover:bg-violet-100' },
    red:     { active: 'bg-red-600 text-white',     idle: 'bg-red-50 text-red-700 hover:bg-red-100' },
    emerald: { active: 'bg-emerald-600 text-white', idle: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
  };
  const c = colorMap[color] || colorMap.violet;
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition ${active ? c.active : c.idle}`}
    >
      <Icon size={12} />
      {label}
    </button>
  );
}

function CopyListButton({ items, getValue = (i) => i, title = 'نسخ كل القيم' }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy(e) {
    e.preventDefault();
    e.stopPropagation();
    const text = items.map(getValue).join('\n');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold transition
        ${copied ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600 hover:bg-fuchsia-100 hover:text-fuchsia-700'}`}
      title={title}
    >
      {copied
        ? <><Check size={11} /> تم النسخ</>
        : <><Copy size={11} /> نسخ ({items.length})</>}
    </button>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  const map = {
    fuchsia: 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700',
    violet:  'bg-violet-50 border-violet-200 text-violet-700',
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
