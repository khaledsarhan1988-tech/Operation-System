import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  History, RefreshCw, CheckCircle, XCircle, AlertTriangle, Clock,
  Bot, User, X, FileSpreadsheet, Eye, TrendingUp, Calendar, Zap,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const FILE_TYPE_LABELS = {
  trainees:      { ar: 'المتدربون النشطون', en: 'Active Trainees' },
  batches:       { ar: 'المجموعات',         en: 'Batches' },
  remarks:       { ar: 'الملاحظات',         en: 'Remarks' },
  lectures:      { ar: 'المحاضرات الرئيسية', en: 'Main Lectures' },
  side_sessions: { ar: 'الجلسات الجانبية',  en: 'Side Sessions' },
  absent:        { ar: 'الغيابات الرئيسية', en: 'Main Absent' },
  absent_zoom:   { ar: 'غيابات الزووم',    en: 'Zoom Absent' },
};

function timeAgo(iso, isAr) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60)   return isAr ? `${seconds} ثانية` : `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)   return isAr ? `${minutes} دقيقة` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)     return isAr ? `${hours} ساعة` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30)      return isAr ? `${days} يوم` : `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatFullTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); }
  catch { return iso; }
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s - m * 60;
  return `${m}m ${rs}s`;
}

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sublabel, icon: IconCmp, gradient, loading }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-4 text-white"
      style={{ background: gradient, boxShadow: '0 8px 24px -8px rgba(15,23,42,0.2)' }}
    >
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
          <IconCmp className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-white/75">{label}</p>
          <p className="text-2xl font-bold leading-tight">
            {loading ? <span className="inline-block w-12 h-6 bg-white/20 rounded animate-pulse" /> : value}
          </p>
          {sublabel && <p className="text-[11px] text-white/70 mt-0.5">{sublabel}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── DAILY MINI-BAR-CHART ─────────────────────────────────────────────────────
function DailyImportsChart({ runs, isAr }) {
  // Aggregate runs into the last 7 days
  const days = useMemo(() => {
    const map = new Map();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      map.set(key, { date: key, imported: 0, skipped: 0, failed: 0, runs: 0 });
    }
    runs.forEach((r) => {
      const key = (r.started_at || '').slice(0, 10);
      const entry = map.get(key);
      if (entry) {
        entry.imported += r.imported || 0;
        entry.skipped  += r.skipped  || 0;
        entry.failed   += r.failed   || 0;
        entry.runs     += 1;
      }
    });
    return Array.from(map.values());
  }, [runs]);

  const maxImported = Math.max(1, ...days.map((d) => d.imported));

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-gray-800">
          <TrendingUp className="w-4 h-4 inline mr-1" />
          {isAr ? 'الاستيرادات آخر 7 أيام' : 'Last 7 days'}
        </h3>
        <span className="text-[11px] text-gray-400">
          {isAr ? 'مجموع الملفات المستوردة لكل يوم' : 'Files imported per day'}
        </span>
      </div>

      <div className="flex items-end gap-2 h-32">
        {days.map((d, i) => {
          const heightPct = d.imported > 0 ? Math.max(8, (d.imported / maxImported) * 100) : 4;
          const dayLabel = new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' });
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
              <span className="text-[10px] font-semibold text-gray-700">{d.imported}</span>
              <div
                className={`w-full rounded-t-md transition-all ${
                  d.failed > 0 ? 'bg-red-400' : d.imported > 0 ? 'bg-sky-500' : 'bg-gray-200'
                }`}
                style={{ height: `${heightPct}%` }}
                title={`${d.date}: imported=${d.imported}, skipped=${d.skipped}, failed=${d.failed}, runs=${d.runs}`}
              />
              <span className="text-[10px] text-gray-400">{dayLabel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── DETAILS MODAL ────────────────────────────────────────────────────────────
function RunDetailsModal({ runId, onClose, isAr }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['drive-run-details', runId],
    queryFn: () => api.get(`/drive/sync-runs/${runId}`).then((r) => r.data),
    enabled: runId !== null,
  });

  if (runId === null) return null;

  const lines = data?.details?.lines || [];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-start gap-3 bg-gradient-to-r from-sky-50 to-cyan-50">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 text-base">
              <FileSpreadsheet className="w-4 h-4 inline mr-1" />
              {isAr ? `تفاصيل مزامنة #${runId}` : `Sync Run #${runId} Details`}
            </h3>
            {data && (
              <p className="text-xs text-gray-600 mt-0.5">
                {formatFullTime(data.started_at)} · {formatDuration(data.duration_ms)}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={18} className="text-gray-600" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {isLoading && (
            <div className="text-center py-8 text-gray-400 text-sm">
              <RefreshCw className="w-5 h-5 inline animate-spin mr-2" />
              {isAr ? 'جارٍ التحميل...' : 'Loading...'}
            </div>
          )}
          {isError && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded">
              {error?.response?.data?.error || error?.message}
            </div>
          )}
          {data && data.error_msg && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-3 rounded">
              <strong>{isAr ? 'خطأ:' : 'Error:'}</strong> {data.error_msg}
            </div>
          )}

          {lines.length === 0 && data && !isLoading && (
            <p className="text-sm text-gray-400 italic">
              {isAr ? 'مفيش تفاصيل لكل line.' : 'No per-line details.'}
            </p>
          )}

          {lines.map((lineRes, idx) => (
            <div key={idx} className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <h4 className="font-semibold text-sm text-gray-800">{lineRes.line}</h4>
                <div className="flex gap-2 text-xs">
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-semibold">
                    {isAr ? 'تم:' : 'OK:'} {lineRes.summary?.imported ?? 0}
                  </span>
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded font-semibold">
                    {isAr ? 'تخطي:' : 'Skip:'} {lineRes.summary?.skipped ?? 0}
                  </span>
                  {(lineRes.summary?.failed ?? 0) > 0 && (
                    <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded font-semibold">
                      {isAr ? 'فشل:' : 'Fail:'} {lineRes.summary?.failed}
                    </span>
                  )}
                </div>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-white">
                  <tr>
                    <th className="px-3 py-2 text-start font-semibold text-gray-600">{isAr ? 'النوع' : 'Type'}</th>
                    <th className="px-3 py-2 text-start font-semibold text-gray-600">{isAr ? 'الحالة' : 'Status'}</th>
                    <th className="px-3 py-2 text-start font-semibold text-gray-600">{isAr ? 'الملف' : 'File'}</th>
                    <th className="px-3 py-2 text-start font-semibold text-gray-600">{isAr ? 'صفوف' : 'Rows'}</th>
                  </tr>
                </thead>
                <tbody>
                  {(lineRes.results || []).map((r, i) => {
                    const lbl = FILE_TYPE_LABELS[r.fileType];
                    const STATUS = {
                      imported: { c: 'text-emerald-600', icon: CheckCircle, t: isAr ? 'تم' : 'OK' },
                      skipped:  { c: 'text-gray-500',    icon: AlertTriangle, t: isAr ? 'تخطي' : 'Skip' },
                      failed:   { c: 'text-red-600',     icon: XCircle, t: isAr ? 'فشل' : 'Fail' },
                    }[r.status] || { c: 'text-gray-400', icon: AlertTriangle, t: r.status };
                    const Icon = STATUS.icon;
                    return (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-1.5">{lbl ? (isAr ? lbl.ar : lbl.en) : r.fileType}</td>
                        <td className={`px-3 py-1.5 ${STATUS.c}`}>
                          <Icon className="w-3 h-3 inline mr-1" /> {STATUS.t}
                          {r.reason === 'unchanged'        && <span className="text-gray-400 ms-1">({isAr ? 'بدون تغيير' : 'unchanged'})</span>}
                          {r.reason === 'folder_empty'    && <span className="text-gray-400 ms-1">({isAr ? 'فولدر فاضي' : 'empty'})</span>}
                          {r.reason === 'folder_missing'  && <span className="text-gray-400 ms-1">({isAr ? 'فولدر مفقود' : 'missing'})</span>}
                          {r.reason === 'anomaly_detected' && (
                            <span className="text-amber-700 font-semibold ms-1" title={r.anomaly?.message}>
                              ({isAr ? 'بيانات غير طبيعية' : 'anomaly'}: {r.anomaly?.lastRows} → {r.anomaly?.newRows})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-gray-700">{r.filename || '—'}</td>
                        <td className="px-3 py-1.5 font-semibold">{typeof r.rows_imported === 'number' ? r.rows_imported.toLocaleString() : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex justify-end">
          <button onClick={onClose} className="btn-secondary text-sm px-6">
            {isAr ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function DriveSyncHistory() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const [selectedRunId, setSelectedRunId] = useState(null);
  const [filter, setFilter] = useState('all'); // all | success | partial | error
  const [triggerFilter, setTriggerFilter] = useState('all'); // all | cron | manual

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['drive-sync-runs'],
    queryFn: () => api.get('/drive/sync-runs?limit=200').then((r) => r.data),
    refetchInterval: 60_000, // refresh every 60s
  });

  const runs = data?.runs || [];

  // Filtered list for the table
  const filteredRuns = useMemo(() => {
    return runs.filter((r) => {
      if (filter !== 'all'        && r.status  !== filter)        return false;
      if (triggerFilter !== 'all' && r.trigger !== triggerFilter) return false;
      return true;
    });
  }, [runs, filter, triggerFilter]);

  // Stats for the KPI cards.
  // Date.now() is impure under React 19 strict rules, so we capture the time
  // once per render outside the useMemo and pass it as a dependency. The
  // useMemo recomputes whenever `runs` changes (the 60s refetch interval
  // naturally bounds how stale these "last 24h / 7d" windows can get).
  const nowMs = Date.now();
  const stats = useMemo(() => {
    const last24h = nowMs - 24 * 60 * 60 * 1000;
    const last7d  = nowMs -  7 * 24 * 60 * 60 * 1000;

    const runs24 = runs.filter((r) => new Date(r.started_at).getTime() >= last24h);
    const runs7d = runs.filter((r) => new Date(r.started_at).getTime() >= last7d);

    const success7d  = runs7d.filter((r) => r.status === 'success').length;
    const failed7d   = runs7d.filter((r) => r.status === 'error' || r.status === 'partial').length;
    const totalImp7d = runs7d.reduce((s, r) => s + (r.imported || 0), 0);

    const successRate = runs7d.length > 0 ? Math.round((success7d / runs7d.length) * 100) : null;
    const latest = runs[0];

    return {
      total24: runs24.length,
      total7d: runs7d.length,
      success7d,
      failed7d,
      totalImported7d: totalImp7d,
      successRate,
      latest,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, nowMs]);

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir={isAr ? 'rtl' : 'ltr'}>
      <PageHero
        title={isAr ? 'تاريخ المزامنات' : 'Sync History'}
        subtitle={isAr
          ? 'كل عمليات المزامنة من Google Drive — يدوي وتلقائي. اضغط على أي عملية لرؤية التفاصيل الكاملة.'
          : 'All Drive sync runs — manual and cron. Click any row to view full details.'}
        icon={History}
        gradient="sky"
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={isAr ? 'آخر 24 ساعة' : 'Last 24h'}
          value={stats.total24}
          sublabel={isAr ? 'عملية مزامنة' : 'sync runs'}
          icon={Clock}
          gradient="linear-gradient(135deg, #0369a1 0%, #0ea5e9 100%)"
          loading={isLoading}
        />
        <KpiCard
          label={isAr ? 'آخر 7 أيام' : 'Last 7 days'}
          value={stats.total7d}
          sublabel={isAr ? `${stats.success7d} نجح / ${stats.failed7d} فشل` : `${stats.success7d} ok / ${stats.failed7d} failed`}
          icon={Calendar}
          gradient="linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)"
          loading={isLoading}
        />
        <KpiCard
          label={isAr ? 'نسبة النجاح' : 'Success rate'}
          value={stats.successRate !== null ? `${stats.successRate}%` : '—'}
          sublabel={isAr ? 'آخر 7 أيام' : 'last 7 days'}
          icon={CheckCircle}
          gradient="linear-gradient(135deg, #15803d 0%, #22c55e 100%)"
          loading={isLoading}
        />
        <KpiCard
          label={isAr ? 'ملفات مستوردة' : 'Files imported'}
          value={stats.totalImported7d}
          sublabel={isAr ? 'آخر 7 أيام' : 'last 7 days'}
          icon={Zap}
          gradient="linear-gradient(135deg, #7c2d12 0%, #ea580c 100%)"
          loading={isLoading}
        />
      </div>

      {/* Chart */}
      <DailyImportsChart runs={runs} isAr={isAr} />

      {/* Filters + refresh */}
      <div className="card !p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 text-xs">
          <span className="text-gray-500 font-medium ms-1">{isAr ? 'الحالة:' : 'Status:'}</span>
          {['all', 'success', 'partial', 'error'].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                filter === s
                  ? 'bg-primary text-white font-semibold'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s === 'all'     ? (isAr ? 'الكل' : 'All') :
               s === 'success' ? (isAr ? 'نجح' : 'Success') :
               s === 'partial' ? (isAr ? 'جزئي' : 'Partial') :
                                 (isAr ? 'فشل' : 'Failed')}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 text-xs ms-auto">
          <span className="text-gray-500 font-medium ms-1">{isAr ? 'المصدر:' : 'Source:'}</span>
          {['all', 'cron', 'manual'].map((s) => (
            <button
              key={s}
              onClick={() => setTriggerFilter(s)}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                triggerFilter === s
                  ? 'bg-primary text-white font-semibold'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s === 'all'    ? (isAr ? 'الكل' : 'All') :
               s === 'cron'   ? (isAr ? 'تلقائي' : 'Auto') :
                                (isAr ? 'يدوي' : 'Manual')}
            </button>
          ))}
        </div>

        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700 disabled:opacity-50 inline-flex items-center gap-1"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} /> {isAr ? 'تحديث' : 'Refresh'}
        </button>
      </div>

      {/* Runs table */}
      <div className="card !p-0 overflow-hidden">
        {isLoading ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            <RefreshCw className="w-5 h-5 inline animate-spin mr-2" />
            {isAr ? 'جارٍ التحميل...' : 'Loading...'}
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
            {isAr ? 'مفيش عمليات مزامنة تطابق الفلتر دلوقتي.' : 'No sync runs match the current filter.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">#</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'الوقت' : 'When'}</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'المصدر' : 'Source'}</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'الحالة' : 'Status'}</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'تم' : 'OK'}</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'تخطي' : 'Skip'}</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'فشل' : 'Fail'}</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'المدة' : 'Duration'}</th>
                  <th className="px-3 py-2 text-end font-semibold text-gray-700">{isAr ? 'تفاصيل' : 'Details'}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((r) => {
                  const STATUS = {
                    success: { c: 'text-emerald-700 bg-emerald-50', icon: CheckCircle, t: isAr ? 'نجح' : 'Success' },
                    partial: { c: 'text-amber-700 bg-amber-50',     icon: AlertTriangle, t: isAr ? 'جزئي' : 'Partial' },
                    error:   { c: 'text-red-700 bg-red-50',         icon: XCircle, t: isAr ? 'فشل' : 'Failed' },
                  }[r.status] || { c: 'text-gray-600 bg-gray-50', icon: AlertTriangle, t: r.status };
                  const StatusIcon = STATUS.icon;
                  const TriggerIcon = r.trigger === 'cron' ? Bot : User;
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => setSelectedRunId(r.id)}
                    >
                      <td className="px-3 py-2 text-gray-400 font-mono">#{r.id}</td>
                      <td className="px-3 py-2">
                        <span title={formatFullTime(r.started_at)}>{timeAgo(r.started_at, isAr)}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 text-xs">
                          <TriggerIcon className="w-3 h-3 text-gray-500" />
                          {r.trigger === 'cron' ? (isAr ? 'تلقائي' : 'Auto') : (isAr ? 'يدوي' : 'Manual')}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${STATUS.c}`}>
                          <StatusIcon className="w-3 h-3" /> {STATUS.t}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-semibold text-emerald-700">{(r.imported || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-gray-500">{(r.skipped || 0).toLocaleString()}</td>
                      <td className={`px-3 py-2 font-semibold ${(r.failed || 0) > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {(r.failed || 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{formatDuration(r.duration_ms)}</td>
                      <td className="px-3 py-2 text-end">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedRunId(r.id); }}
                          className="text-primary hover:text-primary-dark inline-flex items-center gap-1 text-xs font-medium"
                        >
                          <Eye className="w-3 h-3" /> {isAr ? 'عرض' : 'View'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Details modal */}
      <RunDetailsModal runId={selectedRunId} onClose={() => setSelectedRunId(null)} isAr={isAr} />
    </div>
  );
}
