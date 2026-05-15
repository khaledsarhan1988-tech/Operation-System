import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Cloud, CloudDownload, RefreshCw, CheckCircle, XCircle,
  AlertCircle, FileSpreadsheet, Eye, Play, AlertTriangle, Calendar,
  FolderPlus,
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
                  {hasFile && (
                    <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium">
                      <CheckCircle className="w-3 h-3" /> {isAr ? 'جاهز' : 'Ready'}
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
    mutationFn: () => api.post('/drive/sync', { line: selectedLine, date }).then(r => r.data),
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

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
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
          title={filesAvailableCount === 0 ? (isAr ? 'اعمل Preview الأول' : 'Preview files first') : ''}
        >
          {syncMutation.isPending
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : <Play className="w-4 h-4" />}
          {syncMutation.isPending
            ? (isAr ? 'جارٍ الاستيراد...' : 'Importing...')
            : (isAr ? `استيراد الآن (${filesAvailableCount})` : `Sync Now (${filesAvailableCount})`)}
        </button>
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
    </div>
  );
}
