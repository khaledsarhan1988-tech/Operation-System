import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Cloud, CloudDownload, RefreshCw, CheckCircle, XCircle,
  AlertCircle, FileSpreadsheet, Eye, Play, AlertTriangle, Calendar,
  FolderPlus, History, Trash2,
} from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../auth/AuthContext';
import PageHero from '../../components/ui/PageHero';

const FILE_TYPES = [
  { key: 'trainees',      labelAr: 'المتدربون النشطون',     labelEn: 'Active Trainees',   folder: 'Active Batches Trainees' },
  { key: 'batches',       labelAr: 'المجموعات',             labelEn: 'Batches',           folder: 'Batches' },
  { key: 'remarks',       labelAr: 'الملاحظات',             labelEn: 'Remarks',           folder: 'Remarks' },
  { key: 'lectures',      labelAr: 'المحاضرات الرئيسية',   labelEn: 'Main Lectures',     folder: 'Lecture Main Session' },
  { key: 'side_sessions', labelAr: 'الجلسات الجانبية',    labelEn: 'Side Sessions',     folder: 'Lecture Side Session' },
  { key: 'absent',        labelAr: 'الغيابات الرئيسية',     labelEn: 'Main Absent',       folder: 'Absent Student Main Session' },
  { key: 'absent_zoom',   labelAr: 'غيابات الزووم',        labelEn: 'Zoom Absent',       folder: 'Absent Student Side Session' },
];

const AVAILABLE_LINES = ['Ahmed Hassan', 'Dardasha'];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString();
}

// ─── STATUS BANNER ────────────────────────────────────────────────────────────
function ConnectionBanner() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['drive', 'status'],
    queryFn: () => api.get('/drive/status').then(r => r.data),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex items-center gap-3">
        <RefreshCw className="w-5 h-5 text-gray-400 animate-spin" />
        <span className="text-sm text-gray-600">
          {isAr ? 'جارٍ التحقق من اتصال Drive...' : 'Checking Drive connection...'}
        </span>
      </div>
    );
  }

  if (isError || !data?.connected) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-3">
        <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-900">
            {isAr ? 'فشل الاتصال بـ Google Drive' : 'Failed to connect to Google Drive'}
          </p>
          <p className="text-xs text-red-700 mt-1">
            {error?.response?.data?.error || error?.message || data?.error}
          </p>
        </div>
        <button onClick={() => refetch()} className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 rounded text-red-700">
          {isAr ? 'إعادة المحاولة' : 'Retry'}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-3">
      <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-emerald-900">
          {isAr ? 'متصل بـ Google Drive' : 'Connected to Google Drive'}
        </p>
        <p className="text-[11px] text-emerald-700 mt-0.5">
          {isAr ? 'الفولدر الرئيسي:' : 'Root folder:'}{' '}
          <code className="bg-emerald-100 px-1 rounded">{data.rootFolder?.name}</code>
        </p>
      </div>
      <button
        onClick={() => refetch()}
        disabled={isFetching}
        className="text-xs px-2 py-1 bg-emerald-100 hover:bg-emerald-200 rounded text-emerald-700 disabled:opacity-50"
      >
        <RefreshCw className={`w-3 h-3 inline ${isFetching ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}

// ─── PREVIEW TABLE ────────────────────────────────────────────────────────────
function FilePreviewTable({ files, isLoading, isAr }) {
  if (isLoading) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        <RefreshCw className="w-5 h-5 inline animate-spin mr-2" />
        {isAr ? 'جارٍ القراءة من Drive...' : 'Reading from Drive...'}
      </div>
    );
  }
  if (!files) return null;

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'النوع' : 'Type'}</th>
            <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'الفولدر' : 'Folder'}</th>
            <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'اسم الملف' : 'File'}</th>
            <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'آخر تعديل' : 'Modified'}</th>
            <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'الحالة' : 'Status'}</th>
          </tr>
        </thead>
        <tbody>
          {FILE_TYPES.map(ft => {
            const file = files[ft.key];
            const hasFile = file && file.id;
            const hasError = file && file.error;
            return (
              <tr key={ft.key} className="border-t border-gray-100">
                <td className="px-3 py-2 font-medium">{isAr ? ft.labelAr : ft.labelEn}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{ft.folder}</td>
                <td className="px-3 py-2 text-xs">
                  {hasFile ? (
                    <span className="font-mono text-gray-800">{file.name}</span>
                  ) : (
                    <span className="text-gray-400 italic">{isAr ? '— لا يوجد —' : '— none —'}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {hasFile ? formatTime(file.modifiedTime) : '—'}
                </td>
                <td className="px-3 py-2">
                  {hasFile && file.changed === false && (
                    <span
                      className="inline-flex items-center gap-1 text-gray-500 text-xs font-medium"
                      title={file.lastImportAt ? `${isAr ? 'آخر استيراد:' : 'Last imported:'} ${formatTime(file.lastImportAt)}` : ''}
                    >
                      <CheckCircle className="w-3 h-3 text-gray-400" /> {isAr ? 'بدون تغيير' : 'Unchanged'}
                    </span>
                  )}
                  {hasFile && file.changed !== false && (
                    <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium">
                      <CheckCircle className="w-3 h-3" /> {isAr ? 'جاهز للاستيراد' : 'Ready'}
                    </span>
                  )}
                  {hasError && (
                    <span className="inline-flex items-center gap-1 text-red-600 text-xs font-medium" title={file.error}>
                      <AlertCircle className="w-3 h-3" /> {isAr ? 'خطأ' : 'Error'}
                    </span>
                  )}
                  {!hasFile && !hasError && (
                    <span className="inline-flex items-center gap-1 text-gray-400 text-xs">
                      <span className="w-3 h-3 inline-block rounded-full border border-gray-300" />
                      {isAr ? 'فاضي' : 'Empty'}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── SYNC RESULTS TABLE ───────────────────────────────────────────────────────
function SyncResultsTable({ results, isAr }) {
  if (!results || results.length === 0) return null;
  const STATUS_STYLE = {
    imported: { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', label: isAr ? 'تم الاستيراد' : 'Imported' },
    skipped:  { icon: AlertCircle, color: 'text-gray-500',    bg: 'bg-gray-50',    label: isAr ? 'تم التخطي'   : 'Skipped'  },
    failed:   { icon: XCircle,     color: 'text-red-600',     bg: 'bg-red-50',     label: isAr ? 'فشل'          : 'Failed'   },
  };
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'النوع' : 'Type'}</th>
            <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'الحالة' : 'Status'}</th>
            <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'الملف' : 'File'}</th>
            <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'صفوف' : 'Rows'}</th>
            <th className="px-3 py-2 text-start font-semibold text-gray-700">{isAr ? 'ملاحظات' : 'Notes'}</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const ft = FILE_TYPES.find(f => f.key === r.fileType);
            const s = STATUS_STYLE[r.status] || STATUS_STYLE.failed;
            const Icon = s.icon;
            return (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-3 py-2 font-medium">{ft ? (isAr ? ft.labelAr : ft.labelEn) : r.fileType}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${s.bg} ${s.color} text-xs font-semibold`}>
                    <Icon className="w-3 h-3" /> {s.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs font-mono text-gray-600">{r.filename || '—'}</td>
                <td className="px-3 py-2 text-xs font-semibold">{typeof r.rows_imported === 'number' ? r.rows_imported : '—'}</td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {r.reason === 'folder_missing' && (isAr ? 'الفولدر غير موجود' : 'Folder missing')}
                  {r.reason === 'folder_empty'   && (isAr ? 'الفولدر فاضي'      : 'Folder empty')}
                  {r.reason === 'unchanged'      && (
                    <span title={r.lastImportAt ? `${isAr ? 'آخر استيراد:' : 'Last imported:'} ${formatTime(r.lastImportAt)}` : ''}>
                      {isAr ? 'بدون تغيير منذ آخر استيراد' : 'No changes since last import'}
                    </span>
                  )}
                  {r.reason === 'anomaly_detected' && r.anomaly && (
                    <span className="text-amber-700 font-semibold inline-flex items-center gap-1" title={r.anomaly.message}>
                      <AlertTriangle className="w-3 h-3" />
                      {isAr ? '⚠ بيانات غير طبيعية — مرفوضة' : '⚠ Anomaly — rejected'}
                      <span className="text-gray-500 font-normal">({r.anomaly.lastRows} → {r.anomaly.newRows})</span>
                    </span>
                  )}
                  {r.error && <span className="text-red-600" title={r.error}>{r.error}</span>}
                  {r.warnings && r.warnings.length > 0 && (
                    <span className="text-amber-600">
                      <AlertTriangle className="w-3 h-3 inline" /> {r.warnings.length} {isAr ? 'تنبيه' : 'warnings'}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
// ── Delete imported data by sync date (admin tool) ───────────────────────────
const ROLLBACK_LABELS = {
  lectures: 'المحاضرات', absent_students: 'غياب أساسي', absent_zoom_students: 'غياب زوم',
  batches: 'المجموعات', clients: 'العملاء', employees: 'الموظفين', remarks: 'الريماركات',
};
function ImportByDatePanel({ isAr }) {
  const [d, setD] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const doPreview = async () => {
    if (!d) return;
    setBusy(true); setMsg(null); setPreview(null);
    try { setPreview((await api.get('/drive/import-by-date', { params: { date: d } })).data); }
    catch (e) { setMsg({ err: e.response?.data?.error || e.message }); }
    setBusy(false);
  };
  const doDelete = async () => {
    if (!d || !preview || !preview.total) return;
    if (!window.confirm(isAr
      ? `سيتم حذف ${preview.total} صف اتسجّل من الدرايف يوم ${d} (مع نسخة احتياطية قابلة للتراجع). متأكد؟`
      : `Delete ${preview.total} rows synced on ${d}? They are backed up (reversible).`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = (await api.post('/drive/import-by-date/delete', { date: d })).data;
      setMsg({ ok: isAr ? `تم حذف ${r.total_deleted} صف (محفوظين كنسخة احتياطية). ارفع الشيتات الصح من جديد.` : `Deleted ${r.total_deleted} rows (backed up). Now re-upload the correct sheets.` });
      setPreview(null);
    } catch (e) { setMsg({ err: e.response?.data?.error || e.message }); }
    setBusy(false);
  };
  const doRestore = async () => {
    if (!d) return;
    if (!window.confirm(isAr ? `استرجاع بيانات يوم ${d} من النسخة الاحتياطية؟` : `Restore ${d} from backup?`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = (await api.post('/drive/import-by-date/restore', { date: d })).data;
      setMsg({ ok: isAr ? `تم استرجاع ${r.restored} صف من النسخة الاحتياطية.` : `Restored ${r.restored} rows from backup.` });
    } catch (e) { setMsg({ err: e.response?.data?.error || e.message }); }
    setBusy(false);
  };

  return (
    <div className="bg-white rounded-xl shadow p-4 mt-6 border border-rose-200">
      <h2 className="font-bold text-rose-700 mb-1 flex items-center gap-2">
        <Trash2 className="w-5 h-5" /> {isAr ? 'حذف بيانات استيراد يوم معيّن' : 'Delete imported data by date'}
      </h2>
      <p className="text-xs text-gray-500 mb-3 leading-5">
        {isAr
          ? 'لو رفعت شيتات غلط في يوم معيّن: اختر تاريخ اليوم، اعمل «معاينة» لتشوف كام صف دخل، ثم «حذف». كل صف بياخد نسخة احتياطية قبل الحذف (قابل للتراجع بزرار «استرجاع»). بعد الحذف ارفع الشيتات الصح من جديد.'
          : 'If you uploaded wrong sheets on a day: pick the date, Preview, then Delete. Every row is backed up first (reversible via Restore). Then re-upload the correct sheets.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={d} onChange={(e) => { setD(e.target.value); setPreview(null); setMsg(null); }}
          className="border rounded-lg px-3 py-2 text-sm" dir="ltr" />
        <button onClick={doPreview} disabled={!d || busy}
          className="px-3 py-2 text-sm rounded-lg bg-slate-700 text-white disabled:opacity-50">{isAr ? 'معاينة' : 'Preview'}</button>
        {preview && (
          <button onClick={doDelete} disabled={busy || preview.total === 0}
            className="px-3 py-2 text-sm rounded-lg bg-rose-600 text-white disabled:opacity-50">{isAr ? `حذف (${preview.total})` : `Delete (${preview.total})`}</button>
        )}
        <button onClick={doRestore} disabled={!d || busy}
          className="px-3 py-2 text-sm rounded-lg bg-amber-100 text-amber-700 disabled:opacity-50">{isAr ? 'استرجاع (تراجع)' : 'Restore'}</button>
      </div>
      {preview && (
        <div className="mt-3 text-sm">
          <div className="font-semibold mb-1">{isAr ? `إجمالي: ${preview.total} صف` : `Total: ${preview.total} rows`}</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(preview.counts).filter(([, v]) => v > 0).map(([k, v]) => (
              <span key={k} className="px-2 py-0.5 bg-slate-100 rounded text-xs">{(isAr ? (ROLLBACK_LABELS[k] || k) : k)}: {v}</span>
            ))}
            {preview.total === 0 && <span className="text-gray-400 text-xs">{isAr ? 'لا توجد بيانات اتسجّلت في هذا اليوم' : 'No data synced on this day'}</span>}
          </div>
        </div>
      )}
      {msg && <div className={`mt-3 text-sm ${msg.err ? 'text-red-600' : 'text-emerald-600'}`}>{msg.err || msg.ok}</div>}
    </div>
  );
}

export default function DriveSync() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const userLine = user?.line || 'Ahmed Hassan';
  const canChooseLine = userLine === 'All';

  const [selectedLine, setSelectedLine] = useState(canChooseLine ? 'Ahmed Hassan' : userLine);
  const [date, setDate] = useState(todayStr());
  const [previewedAt, setPreviewedAt] = useState(null);
  const [forceReimport, setForceReimport] = useState(false);

  // ── Backfill / recovery (replay a date range, day by day) ──────────────────
  // Runs as a client-side loop over the existing per-day /drive/sync (force) so
  // each request stays short (no 60s axios-timeout abort on a long server loop).
  const [backfillFrom, setBackfillFrom] = useState('2026-05-16');
  const [backfillTo, setBackfillTo] = useState(todayStr());
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillProg, setBackfillProg] = useState(null); // {done,total,ok,failed,current}
  const [backfillDone, setBackfillDone] = useState(null);  // {ok,failed,total}

  const enumerateDays = (fromStr, toStr) => {
    const out = [];
    const f = new Date(`${fromStr}T12:00:00Z`);
    const t = new Date(`${toStr}T12:00:00Z`);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || t < f) return out;
    for (let d = new Date(f); d <= t; d.setUTCDate(d.getUTCDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  };

  const runBackfill = async () => {
    const days = enumerateDays(backfillFrom, backfillTo);
    if (!days.length) return;
    const lines = canChooseLine ? AVAILABLE_LINES : [userLine];
    const tasks = [];
    lines.forEach(l => days.forEach(dt => tasks.push({ line: l, date: dt })));
    const confirmMsg = isAr
      ? `هتعيد مزامنة ${days.length} يوم × ${lines.length} لاين = ${tasks.length} عملية (إجباري). دي بتاخد دقائق — متقفلش الصفحة. تكمّل؟`
      : `This will re-sync ${days.length} day(s) × ${lines.length} line(s) = ${tasks.length} operations (forced). Takes a few minutes — keep this page open. Continue?`;
    // eslint-disable-next-line no-alert
    if (!window.confirm(confirmMsg)) return;
    setBackfillRunning(true);
    setBackfillDone(null);
    let ok = 0, failed = 0;
    for (let i = 0; i < tasks.length; i++) {
      const { line, date } = tasks[i];
      setBackfillProg({ done: i, total: tasks.length, ok, failed, current: `${line} — ${date}` });
      try {
        await api.post('/drive/sync', { line, date, force: true }, { timeout: 120000 });
        ok++;
      } catch (_) {
        failed++;
      }
    }
    setBackfillProg(null);
    setBackfillRunning(false);
    setBackfillDone({ ok, failed, total: tasks.length });
    queryClient.invalidateQueries({ queryKey: ['syncs'] });
    queryClient.invalidateQueries({ queryKey: ['upload-status'] });
  };

  // Preview query — disabled by default, triggered by button
  const previewQuery = useQuery({
    queryKey: ['drive', 'files', selectedLine, date],
    queryFn: () => api.get('/drive/files', { params: { line: selectedLine, date } }).then(r => r.data),
    enabled: false,
  });

  const handlePreview = () => {
    setPreviewedAt(new Date());
    previewQuery.refetch();
  };

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: () => api.post('/drive/sync', {
      line: selectedLine,
      date,
      force: forceReimport,
    }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syncs'] });
      queryClient.invalidateQueries({ queryKey: ['upload-status'] });
      // Refresh preview to show new modified times
      previewQuery.refetch();
    },
  });

  // Prepare-folders mutation — pre-creates Line/YYYY/MM/DD/<7 file type folders> on Drive
  const prepareMutation = useMutation({
    mutationFn: () => api.post('/drive/prepare-folders', { line: selectedLine, date }).then(r => r.data),
    onSuccess: () => {
      // After creating folders, refresh preview so the empty folders show up
      if (previewedAt) previewQuery.refetch();
    },
  });

  const previewData = previewQuery.data;
  const syncData = syncMutation.data;

  const filesAvailableCount = useMemo(() => {
    if (!previewData?.files) return 0;
    return Object.values(previewData.files).filter(f => f && f.id).length;
  }, [previewData]);

  // Files that actually need re-importing (changed since last import). When
  // forceReimport is on, all present files are eligible regardless.
  const filesToImportCount = useMemo(() => {
    if (!previewData?.files) return 0;
    return Object.values(previewData.files).filter(f => {
      if (!f || !f.id) return false;
      if (forceReimport) return true;
      return f.changed !== false;
    }).length;
  }, [previewData, forceReimport]);

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir={isAr ? 'rtl' : 'ltr'}>
      <PageHero
        title={isAr ? 'مزامنة من Google Drive' : 'Google Drive Sync'}
        subtitle={isAr
          ? 'استورد آخر نسخة من ملفات الجودة المرفوعة على Drive مباشرةً إلى السيستم.'
          : 'Import the latest Quality team files from Drive directly into the system.'}
        icon={Cloud}
        gradient="blue"
      />

      <ConnectionBanner />

      {/* Selectors */}
      <div className="bg-white rounded-xl border-2 border-primary/20 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">
            {isAr ? 'الـ Line' : 'Line'}
          </label>
          {canChooseLine ? (
            <select
              value={selectedLine}
              onChange={(e) => setSelectedLine(e.target.value)}
              className="input w-full font-semibold"
            >
              {AVAILABLE_LINES.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          ) : (
            <p className="text-base font-bold text-primary py-2">{userLine}</p>
          )}
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">
            <Calendar className="w-3 h-3 inline mr-1" />
            {isAr ? 'التاريخ' : 'Date'}
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input w-full font-semibold"
          />
        </div>
      </div>

      {/* Prepare folders button — own row so it's visually distinct */}
      <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 flex items-center gap-3">
        <FolderPlus className="w-5 h-5 text-sky-700 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-sky-900">
            {isAr ? 'تجهيز فولدرات اليوم على Drive' : 'Prepare today\'s folders on Drive'}
          </p>
          <p className="text-[11px] text-sky-700 mt-0.5">
            {isAr
              ? 'يعمل مسار السنة/الشهر/اليوم + 7 فولدرات لأنواع الملفات (لو موجودين بيتسابوا زي ما هما).'
              : 'Creates year/month/day path + 7 file-type folders (existing ones are kept).'}
          </p>
        </div>
        <button
          onClick={() => prepareMutation.mutate()}
          disabled={prepareMutation.isPending}
          className="btn-secondary text-sm flex items-center gap-2 flex-shrink-0"
        >
          {prepareMutation.isPending
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : <FolderPlus className="w-4 h-4" />}
          {prepareMutation.isPending
            ? (isAr ? 'جارٍ الإنشاء...' : 'Creating...')
            : (isAr ? 'إنشاء الفولدرات' : 'Create Folders')}
        </button>
      </div>

      {/* Prepare folders result message */}
      {prepareMutation.isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
          {prepareMutation.error?.response?.data?.error || prepareMutation.error?.message}
        </div>
      )}
      {prepareMutation.data && !prepareMutation.isPending && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {isAr
            ? `تم! ${prepareMutation.data.summary.created} فولدر جديد، ${prepareMutation.data.summary.existing} موجود من قبل.`
            : `Done! ${prepareMutation.data.summary.created} new, ${prepareMutation.data.summary.existing} already existed.`}
        </div>
      )}

      {/* Backfill / recovery — replay a date range to rebuild data the sync wiped */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <History className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              {isAr ? 'استرجاع البيانات (Backfill)' : 'Backfill / Recover data'}
            </p>
            <p className="text-[11px] text-amber-700 mt-0.5">
              {isAr
                ? 'يعيد مزامنة كل يوم في المدى من Drive (إجباري) عشان يعيد بناء أي بيانات اتمسحت قبل كده. شغّلها مرة واحدة، وسيبها تخلّص (متقفلش الصفحة).'
                : 'Re-syncs every day in the range from Drive (forced) to rebuild any history a previous sync wiped. Run once and let it finish (keep this page open).'}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-amber-800 block mb-1">{isAr ? 'من تاريخ' : 'From'}</label>
            <input
              type="date"
              value={backfillFrom}
              onChange={(e) => setBackfillFrom(e.target.value)}
              disabled={backfillRunning}
              className="input w-full font-semibold"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-amber-800 block mb-1">{isAr ? 'إلى تاريخ' : 'To'}</label>
            <input
              type="date"
              value={backfillTo}
              onChange={(e) => setBackfillTo(e.target.value)}
              disabled={backfillRunning}
              className="input w-full font-semibold"
            />
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={runBackfill}
            disabled={backfillRunning}
            className="btn-primary bg-amber-600 hover:bg-amber-700 border-amber-600 flex items-center gap-2"
          >
            {backfillRunning
              ? <RefreshCw className="w-4 h-4 animate-spin" />
              : <History className="w-4 h-4" />}
            {backfillRunning
              ? (isAr ? 'جارٍ الاسترجاع...' : 'Recovering...')
              : (isAr ? 'ابدأ الاسترجاع' : 'Start Backfill')}
          </button>
          {backfillProg && (
            <span className="text-xs text-amber-800 font-medium">
              {backfillProg.done}/{backfillProg.total} — {backfillProg.current}
              {' · '}{isAr ? 'تم' : 'OK'} {backfillProg.ok}
              {backfillProg.failed > 0 && ` · ${isAr ? 'فشل' : 'fail'} ${backfillProg.failed}`}
            </span>
          )}
        </div>
        {backfillDone && (
          <div className="bg-white border border-amber-200 rounded-lg p-3 text-sm text-amber-900 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            {isAr
              ? `خلص الاسترجاع: ${backfillDone.ok}/${backfillDone.total} نجحت${backfillDone.failed > 0 ? `، ${backfillDone.failed} فشلت` : ''}. راجع التقارير دلوقتي.`
              : `Backfill done: ${backfillDone.ok}/${backfillDone.total} succeeded${backfillDone.failed > 0 ? `, ${backfillDone.failed} failed` : ''}. Check the reports now.`}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={handlePreview}
          disabled={previewQuery.isFetching}
          className="btn-secondary flex items-center gap-2"
        >
          <Eye className="w-4 h-4" />
          {previewQuery.isFetching
            ? (isAr ? 'جارٍ التحميل...' : 'Loading...')
            : (isAr ? 'عرض الملفات المتاحة' : 'Preview Available Files')}
        </button>
        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending || filesAvailableCount === 0}
          className="btn-primary flex items-center gap-2"
          title={filesAvailableCount === 0
            ? (isAr ? 'اعمل Preview الأول' : 'Preview files first')
            : (filesToImportCount === 0 && !forceReimport
              ? (isAr ? 'مفيش ملفات اتغيّرت — فعّل "إعادة استيراد إجبارية" لو عاوز تستورد كل حاجة' : 'No changes — enable "Force re-import" to import all')
              : '')}
        >
          {syncMutation.isPending
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : <Play className="w-4 h-4" />}
          {syncMutation.isPending
            ? (isAr ? 'جارٍ الاستيراد...' : 'Importing...')
            : forceReimport
              ? (isAr ? `استيراد إجباري (${filesAvailableCount})` : `Force Import (${filesAvailableCount})`)
              : (isAr ? `استيراد المتغيّر (${filesToImportCount})` : `Sync Changes (${filesToImportCount})`)}
        </button>

        {/* Force re-import toggle */}
        <label
          className="ms-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white cursor-pointer hover:bg-gray-50"
          title={isAr
            ? 'لو مفعّل، السيستم هيستورد كل الملفات الموجودة حتى لو ما تغيّرتش (هياخد وقت أكتر).'
            : 'When on, re-imports every file even if unchanged (slower).'}
        >
          <input
            type="checkbox"
            checked={forceReimport}
            onChange={(e) => setForceReimport(e.target.checked)}
            className="rounded"
          />
          <span className="text-xs font-medium text-gray-700">
            {isAr ? 'إعادة استيراد إجبارية' : 'Force re-import'}
          </span>
        </label>
      </div>

      {/* Preview results */}
      {previewQuery.isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
          {previewQuery.error?.response?.data?.error || previewQuery.error?.message}
        </div>
      )}
      {(previewQuery.isFetching || previewData) && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-800">
              <FileSpreadsheet className="w-4 h-4 inline mr-1" />
              {isAr ? 'الملفات على Drive' : 'Files on Drive'}
            </h2>
            {previewedAt && (
              <span className="text-[11px] text-gray-400">
                {isAr ? 'آخر تحديث:' : 'Last refresh:'} {previewedAt.toLocaleTimeString()}
              </span>
            )}
          </div>
          <FilePreviewTable files={previewData?.files} isLoading={previewQuery.isFetching} isAr={isAr} />
        </div>
      )}

      {/* Sync results */}
      {syncMutation.isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
          {syncMutation.error?.response?.data?.error || syncMutation.error?.message}
        </div>
      )}

      {/* Anomaly warning banner — appears when Smart Validation rejected any files */}
      {syncData && (() => {
        const anomalies = (syncData.results || []).filter(r => r.reason === 'anomaly_detected');
        if (anomalies.length === 0) return null;
        return (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-bold text-amber-900 text-sm">
                  {isAr ? `⚠ تم رفض ${anomalies.length} ملف بسبب بيانات غير طبيعية` : `⚠ ${anomalies.length} file(s) rejected — anomalous data`}
                </h3>
                <p className="text-xs text-amber-800 mt-1">
                  {isAr
                    ? 'الـ Smart Validation منع استيراد الملفات دي عشان حماية بياناتك من الحذف غير المقصود. راجع التفاصيل تحت، ولو متأكد إن البيانات الجديدة صحيحة، فعّل "إعادة استيراد إجبارية" واعمل Sync تاني.'
                    : 'Smart Validation rejected these files to protect your data from accidental loss. Review the details below — if the new data is correct, enable "Force re-import" and sync again.'}
                </p>
              </div>
            </div>

            <div className="bg-white border border-amber-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-amber-50">
                  <tr>
                    <th className="px-3 py-1.5 text-start font-semibold text-amber-900">{isAr ? 'الملف' : 'File'}</th>
                    <th className="px-3 py-1.5 text-start font-semibold text-amber-900">{isAr ? 'سبب الرفض' : 'Reason'}</th>
                    <th className="px-3 py-1.5 text-start font-semibold text-amber-900">{isAr ? 'آخر استيراد' : 'Last import'}</th>
                    <th className="px-3 py-1.5 text-start font-semibold text-amber-900">{isAr ? 'الملف الجديد' : 'New file'}</th>
                    <th className="px-3 py-1.5 text-start font-semibold text-amber-900">{isAr ? 'التغير' : 'Change'}</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.map((r, i) => {
                    const ft = FILE_TYPES.find(f => f.key === r.fileType);
                    const a = r.anomaly || {};
                    const REASON = {
                      empty_or_near_empty: isAr ? 'ملف فاضي تقريباً' : 'Empty / near-empty',
                      large_drop:          isAr ? 'هبوط كبير' : 'Large drop',
                      large_surge:         isAr ? 'قفزة كبيرة' : 'Large surge',
                    }[a.code] || a.code;
                    return (
                      <tr key={i} className="border-t border-amber-100">
                        <td className="px-3 py-1.5 font-medium">{ft ? (isAr ? ft.labelAr : ft.labelEn) : r.fileType}</td>
                        <td className="px-3 py-1.5">
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-semibold">
                            {REASON}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-gray-700">{a.lastRows?.toLocaleString() ?? '—'} {isAr ? 'صف' : 'rows'}</td>
                        <td className="px-3 py-1.5 text-gray-700 font-semibold">{a.newRows?.toLocaleString() ?? '—'} {isAr ? 'صف' : 'rows'}</td>
                        <td className="px-3 py-1.5">
                          <span className={`font-bold ${(a.changePct ?? 0) < 0 ? 'text-red-600' : 'text-amber-700'}`}>
                            {typeof a.changePct === 'number' ? `${a.changePct > 0 ? '+' : ''}${a.changePct}%` : '—'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => {
                  setForceReimport(true);
                  setTimeout(() => syncMutation.mutate(), 100); // small delay so the toggle is visible
                }}
                disabled={syncMutation.isPending}
                className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md font-semibold inline-flex items-center gap-1 disabled:opacity-50"
              >
                {syncMutation.isPending
                  ? <RefreshCw className="w-3 h-3 animate-spin" />
                  : <Play className="w-3 h-3" />}
                {isAr ? 'تأكيد الاستيراد رغم التحذير' : 'Import anyway'}
              </button>
              <span className="text-[11px] text-amber-700">
                {isAr ? '← يستخدم زي ما يبدو لو إنت متأكد إن البيانات الجديدة صح' : '← only if you are sure the new data is correct'}
              </span>
            </div>
          </div>
        );
      })()}

      {syncData && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-800">
              <CloudDownload className="w-4 h-4 inline mr-1" />
              {isAr ? 'نتائج الاستيراد' : 'Sync Results'}
            </h2>
            <div className="flex gap-2 text-xs">
              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-semibold">
                {isAr ? 'تم:' : 'OK:'} {syncData.summary.imported}
              </span>
              <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded font-semibold">
                {isAr ? 'تخطي:' : 'Skip:'} {syncData.summary.skipped}
              </span>
              {syncData.summary.failed > 0 && (
                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded font-semibold">
                  {isAr ? 'فشل:' : 'Fail:'} {syncData.summary.failed}
                </span>
              )}
            </div>
          </div>
          <SyncResultsTable results={syncData.results} isAr={isAr} />
        </div>
      )}

      <ImportByDatePanel isAr={isAr} />
    </div>
  );
}
