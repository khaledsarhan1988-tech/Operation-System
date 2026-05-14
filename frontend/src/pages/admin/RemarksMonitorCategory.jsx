import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity, Clock, Search, RefreshCw, Globe, X, ArrowLeft, ArrowRight,
  AlertCircle, UserCircle, Layers, TrendingUp, AlertTriangle, MessageSquare,
  Copy, Check,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import { useAuth } from '../../auth/AuthContext';

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
      };
      if (assigneeFilter) params.assigned_to = assigneeFilter;
      if (search.trim())  params.search = search.trim();
      const { data } = await api.get('/remarks-monitor/category-distribution', { params });
      setData(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setData(null);
    } finally { setLoading(false); }
  }, [selectedLine, category, page, sort, assigneeFilter, search]);

  useEffect(() => { loadFilters(); }, [loadFilters]);
  useEffect(() => { load(); }, [load]);

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
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={MessageSquare} label="الإجمالي"             value={stats.total.toLocaleString('ar-EG')} color="fuchsia" />
          <StatCard icon={TrendingUp}    label="متوسط الأحداث/Remark" value={stats.avg_events} color="violet" />
          <StatCard icon={Activity}      label="نشطة الآن (آخر ساعة)" value={stats.active} color="emerald" />
          <StatCard icon={AlertTriangle} label="ساكنة > 24 ساعة"       value={stats.stalled} color="red" />
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Layers size={16} className="text-fuchsia-600" />
            Remarks بتصنيف "{category}"
            {data && <span className="text-xs text-gray-500 font-normal">({data.total.toLocaleString('ar-EG')})</span>}
          </h3>
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
              ) : data.remarks.map(r => (
                <tr key={r.external_id} className="border-t border-gray-100 hover:bg-fuchsia-50/30">
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
              ))}
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
    </div>
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
