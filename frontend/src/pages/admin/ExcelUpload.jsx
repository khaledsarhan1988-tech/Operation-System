import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, CheckCircle, AlertCircle, Clock, FileSpreadsheet, RefreshCw, Trash2, X } from 'lucide-react';
import api from '../../api/axios';

const FILE_TYPES = [
  { key: 'data',          labelAr: 'الموظفون',              labelEn: 'Employees',             file: 'Data.xlsx' },
  { key: 'trainees',      labelAr: 'المتدربون النشطون',     labelEn: 'Active Trainees',        file: 'Active Batches Trainees.xlsx' },
  { key: 'batches',       labelAr: 'المجموعات',             labelEn: 'Batches',                file: 'Batches.xlsx' },
  { key: 'remarks',       labelAr: 'الملاحظات',             labelEn: 'Remarks',                file: 'Remarks.xlsx' },
  { key: 'lectures',      labelAr: 'المحاضرات الرئيسية',   labelEn: 'Main Lectures',          file: 'Lectures.xlsx' },
  { key: 'side_sessions', labelAr: 'الجلسات الجانبية',    labelEn: 'Side Sessions',          file: 'Side Sessions.xlsx' },
  { key: 'absent',        labelAr: 'الغيابات',             labelEn: 'Absent Students',        file: 'Absent.xlsx' },
];

function UploadZone({ fileType, onSuccess }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState(null); // null | 'uploading' | 'success' | 'error'
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const inputRef = useRef();

  const upload = async (file) => {
    if (!file) return;
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setStatus('error');
      setMessage(isAr ? 'يجب أن يكون الملف بصيغة Excel (.xlsx أو .xls)' : 'File must be Excel format (.xlsx or .xls)');
      return;
    }

    setStatus('uploading');
    setProgress(0);
    setMessage('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await api.post(`/upload/${fileType.key}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
        },
      });
      setStatus('success');
      setMessage(
        isAr
          ? `تم الرفع بنجاح — ${res.data.inserted ?? 0} سجل مُدرج`
          : `Upload successful — ${res.data.inserted ?? 0} records inserted`
      );
      onSuccess?.();
    } catch (err) {
      setStatus('error');
      setMessage(err.response?.data?.error || (isAr ? 'فشل الرفع' : 'Upload failed'));
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    upload(e.dataTransfer.files[0]);
  };

  const handleFile = (e) => upload(e.target.files[0]);

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
          ${dragOver ? 'border-accent bg-accent/10' : 'border-gray-300 hover:border-primary bg-gray-50 hover:bg-blue-50'}`}
      >
        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
        <FileSpreadsheet className="w-12 h-12 mx-auto text-gray-400 mb-3" />
        <p className="text-sm font-medium text-gray-600">
          {isAr
            ? 'اسحب ملف Excel هنا أو انقر للاختيار'
            : 'Drag & drop an Excel file here, or click to browse'}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          {isAr ? `الملف المتوقع: ${fileType.file}` : `Expected file: ${fileType.file}`}
        </p>
      </div>

      {/* Progress bar */}
      {status === 'uploading' && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{isAr ? 'جارٍ الرفع...' : 'Uploading...'}</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Result message */}
      {status === 'success' && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span>{message}</span>
        </div>
      )}
      {status === 'error' && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}

function SyncHistory() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['syncs'],
    queryFn: () => api.get('/admin/syncs').then(r => r.data),
  });

  const fileLabel = (key) => {
    const ft = FILE_TYPES.find(f => f.key === key);
    return ft ? (isAr ? ft.labelAr : ft.labelEn) : key;
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(isAr ? 'ar-EG' : 'en-GB');
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">
          {isAr ? 'سجل المزامنة' : 'Sync History'}
        </h3>
        <button onClick={() => refetch()} className="btn-secondary text-xs flex items-center gap-1">
          <RefreshCw className="w-3 h-3" />
          {isAr ? 'تحديث' : 'Refresh'}
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-gray-400 text-sm">
          {isAr ? 'جارٍ التحميل...' : 'Loading...'}
        </div>
      ) : !data?.syncs?.length ? (
        <div className="text-center py-8 text-gray-400 text-sm">
          {isAr ? 'لا توجد عمليات مزامنة بعد' : 'No syncs yet'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary text-white">
                <th className="table-header">{isAr ? 'الملف' : 'File'}</th>
                <th className="table-header">{isAr ? 'السجلات' : 'Records'}</th>
                <th className="table-header">{isAr ? 'الحالة' : 'Status'}</th>
                <th className="table-header">{isAr ? 'المستخدم' : 'User'}</th>
                <th className="table-header">{isAr ? 'التاريخ' : 'Date'}</th>
              </tr>
            </thead>
            <tbody>
              {data.syncs.map((s) => (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="table-cell font-medium">{fileLabel(s.file_type)}</td>
                  <td className="table-cell">{s.records_inserted ?? '—'}</td>
                  <td className="table-cell">
                    {s.status === 'success' ? (
                      <span className="badge badge-success">
                        {isAr ? 'ناجح' : 'Success'}
                      </span>
                    ) : (
                      <span className="badge badge-danger">
                        {isAr ? 'فشل' : 'Failed'}
                      </span>
                    )}
                  </td>
                  <td className="table-cell">{s.synced_by ?? '—'}</td>
                  <td className="table-cell text-gray-500">{formatDate(s.synced_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── FILES STATUS PANEL ───────────────────────────────────────────────────────
function FilesStatusPanel({ onClearSuccess }) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const queryClient = useQueryClient();
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState(null);

  const { data: statusData, isLoading, refetch } = useQuery({
    queryKey: ['upload-status'],
    queryFn: () => api.get('/admin/upload-status').then(r => r.data),
    staleTime: 30 * 1000,
  });

  const fmtDate = (iso) => {
    if (!iso) return null;
    try { return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return iso; }
  };

  const handleClear = async () => {
    setClearing(true);
    setClearMsg(null);
    try {
      await api.delete('/admin/clear-excel-data');
      setClearMsg({ ok: true, text: 'تم مسح كل البيانات بنجاح ✅' });
      setConfirmClear(false);
      refetch();
      queryClient.invalidateQueries({ queryKey: ['syncs'] });
      onClearSuccess?.();
    } catch (err) {
      setClearMsg({ ok: false, text: err.response?.data?.error || 'فشل المسح' });
    } finally {
      setClearing(false);
    }
  };

  const fileInfo = FILE_TYPES.map(ft => {
    const s = statusData?.find(x => x.key === ft.key);
    const hasData = (s?.current_count ?? 0) > 0;
    const lastUpload = s?.last_upload ? fmtDate(s.last_upload) : null;
    return { ...ft, hasData, lastUpload, count: s?.current_count ?? 0 };
  });

  const allUploaded = fileInfo.every(f => f.hasData);
  const missingCount = fileInfo.filter(f => !f.hasData).length;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden h-fit">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-l from-[#1e3a5f]/5 to-white flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-800">حالة الملفات</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {isLoading ? 'جاري التحميل...' : allUploaded
              ? 'جميع الملفات مرفوعة ✅'
              : `${missingCount} ملف ناقص`}
          </p>
        </div>
        <button onClick={() => refetch()}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600">
          <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* File list */}
      <div className="divide-y divide-gray-50 px-1 py-1">
        {fileInfo.map(ft => (
          <div key={ft.key} className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl my-0.5 transition-colors
            ${ft.hasData ? 'hover:bg-green-50/50' : 'hover:bg-red-50/50 bg-red-50/30'}`}>
            {/* Status dot */}
            <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0
              ${ft.hasData ? 'bg-emerald-100' : 'bg-red-100'}`}>
              {ft.hasData
                ? <CheckCircle size={12} className="text-emerald-600" />
                : <AlertCircle size={12} className="text-red-500" />}
            </div>
            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-800 truncate">{ft.labelAr}</p>
              <p className="text-[10px] text-gray-400 font-mono truncate">{ft.file}</p>
              {ft.hasData ? (
                <p className="text-[10px] text-emerald-600 mt-0.5 font-medium">
                  {ft.count.toLocaleString('ar-EG')} سجل
                  {ft.lastUpload && <span className="text-gray-400 mr-1">· {ft.lastUpload}</span>}
                </p>
              ) : (
                <p className="text-[10px] text-red-500 mt-0.5 font-medium">لم يُرفع بعد</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Clear button */}
      <div className="px-4 py-3 border-t border-gray-100 space-y-2">
        {clearMsg && (
          <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg
            ${clearMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {clearMsg.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
            {clearMsg.text}
          </div>
        )}

        {!confirmClear ? (
          <button onClick={() => setConfirmClear(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl
              bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold transition-colors border border-red-200">
            <Trash2 size={13} />
            مسح كل البيانات
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-center text-red-600 font-semibold">
              ⚠️ هيتم مسح كل البيانات نهائياً!
            </p>
            <div className="flex gap-2">
              <button onClick={handleClear} disabled={clearing}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg
                  bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors disabled:opacity-60">
                {clearing ? <RefreshCw size={11} className="animate-spin" /> : <Trash2 size={11} />}
                {clearing ? 'جاري المسح...' : 'تأكيد المسح'}
              </button>
              <button onClick={() => setConfirmClear(false)}
                className="flex-1 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-bold transition-colors">
                إلغاء
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function ExcelUpload() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['syncs'] });
    queryClient.invalidateQueries({ queryKey: ['upload-status'] });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {isAr ? 'رفع ملفات Excel' : 'Excel File Upload'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {isAr
            ? 'ارفع ملفات Excel لتحديث بيانات النظام. البيانات القديمة ستُستبدل (مع الحفاظ على بيانات المتابعة).'
            : 'Upload Excel files to update system data. Existing data will be replaced (follow-up data preserved).'}
        </p>
      </div>

      {/* Two-column layout: status panel + upload area */}
      <div className="flex gap-5 items-start">

        {/* ── LEFT: Files status panel ── */}
        <div className="w-64 flex-shrink-0">
          <FilesStatusPanel onClearSuccess={handleSuccess} />
        </div>

        {/* ── RIGHT: Tab upload area ── */}
        <div className="flex-1 space-y-5">
          {/* Tab bar */}
          <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-0">
            {FILE_TYPES.map((ft, i) => (
              <button
                key={ft.key}
                onClick={() => setActiveTab(i)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors
                  ${activeTab === i
                    ? 'border-primary text-primary bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
              >
                {isAr ? ft.labelAr : ft.labelEn}
              </button>
            ))}
          </div>

          {/* Active tab content */}
          <div className="card">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-800">
                {isAr ? FILE_TYPES[activeTab].labelAr : FILE_TYPES[activeTab].labelEn}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {isAr ? 'الملف المتوقع:' : 'Expected file:'}{' '}
                <code className="bg-gray-100 px-1 rounded">{FILE_TYPES[activeTab].file}</code>
              </p>
            </div>
            <UploadZone fileType={FILE_TYPES[activeTab]} onSuccess={handleSuccess} />
          </div>

          {/* Sync history */}
          <SyncHistory />
        </div>
      </div>
    </div>
  );
}
