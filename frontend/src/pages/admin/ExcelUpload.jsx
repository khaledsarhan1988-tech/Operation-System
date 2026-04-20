import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, CheckCircle, AlertCircle, Clock, FileSpreadsheet, RefreshCw, Trash2, X, AlertTriangle } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../auth/AuthContext';

const FILE_TYPES = [
  { key: 'data',          labelAr: 'الموظفون',              labelEn: 'Employees',             file: 'Data.xlsx' },
  { key: 'trainees',      labelAr: 'المتدربون النشطون',     labelEn: 'Active Trainees',        file: 'Active Batches Trainees.xlsx' },
  { key: 'batches',       labelAr: 'المجموعات',             labelEn: 'Batches',                file: 'Batches.xlsx' },
  { key: 'remarks',       labelAr: 'الملاحظات',             labelEn: 'Remarks',                file: 'Remarks.xlsx' },
  { key: 'lectures',      labelAr: 'المحاضرات الرئيسية',   labelEn: 'Main Lectures',          file: 'Lectures.xlsx' },
  { key: 'side_sessions', labelAr: 'الجلسات الجانبية',    labelEn: 'Side Sessions',          file: 'Side Sessions.xlsx' },
  { key: 'absent',        labelAr: 'الغيابات',             labelEn: 'Absent Students',        file: 'Absent.xlsx' },
];

const AVAILABLE_LINES = ['Ahmed Hassan', 'Dardasha'];

// ─── WARNINGS MODAL ───────────────────────────────────────────────────────────
function WarningsModal({ warnings, onClose }) {
  if (!warnings || !warnings.length) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-amber-50 border-b border-amber-200 flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-bold text-amber-900">تنبيه: بيانات مكررة بين الـ Lines</h3>
            <p className="text-xs text-amber-700 mt-1">
              تم اكتشاف external_ids موجودة فى lines أخرى. البيانات اترفعت بنجاح، لكن راجع التكرارات دى.
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-amber-100 rounded">
            <X size={18} className="text-amber-700" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {warnings.map((w, i) => (
            <div key={i} className="space-y-2">
              <p className="text-sm font-semibold text-gray-800">{w.message}</p>
              {w.details && w.details.length > 0 && (
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-start font-semibold text-gray-700">External ID</th>
                        <th className="px-3 py-2 text-start font-semibold text-gray-700">موجود فى Line</th>
                        <th className="px-3 py-2 text-start font-semibold text-gray-700">تم رفعه على Line</th>
                      </tr>
                    </thead>
                    <tbody>
                      {w.details.map((d, j) => (
                        <tr key={j} className="border-t border-gray-100">
                          <td className="px-3 py-1.5 font-mono">{d.external_id}</td>
                          <td className="px-3 py-1.5">{d.exists_in_line}</td>
                          <td className="px-3 py-1.5 font-semibold text-primary">{d.uploading_to_line}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50">
          <button onClick={onClose} className="btn-primary text-sm px-6">تم</button>
        </div>
      </div>
    </div>
  );
}

function UploadZone({ fileType, selectedLine, onSuccess, onWarnings }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState(null);
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
    if (!selectedLine) {
      setStatus('error');
      setMessage(isAr ? 'اختر الـ Line الأول' : 'Select a line first');
      return;
    }

    setStatus('uploading');
    setProgress(0);
    setMessage('');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('line', selectedLine);

    try {
      const res = await api.post(`/upload/${fileType.key}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
        },
      });
      setStatus('success');
      const lineLabel = res.data.line || selectedLine;
      setMessage(
        isAr
          ? `تم الرفع بنجاح على ${lineLabel} — ${res.data.inserted ?? 0} سجل مُدرج`
          : `Upload successful to ${lineLabel} — ${res.data.inserted ?? 0} records inserted`
      );
      if (res.data.warnings && res.data.warnings.length > 0) {
        onWarnings?.(res.data.warnings);
      }
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
        {selectedLine && (
          <p className="text-xs font-semibold text-primary mt-2">
            {isAr ? 'سيتم الرفع على Line:' : 'Uploading to line:'} {selectedLine}
          </p>
        )}
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
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['syncs'],
    queryFn: () => api.get('/admin/syncs').then(r => r.data),
  });

  const fileLabel = (key) => {
    const ft = FILE_TYPES.find(f => f.key === key);
    return ft ? ft.labelAr : key;
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return iso; }
  };

  const syncs = data?.syncs ?? [];

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">سجل المزامنة</h3>
        <button onClick={() => refetch()} className="btn-secondary text-xs flex items-center gap-1">
          <RefreshCw className="w-3 h-3" />
          تحديث
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-gray-400 text-sm">جارٍ التحميل...</div>
      ) : !syncs.length ? (
        <div className="text-center py-8 text-gray-400 text-sm">لا توجد عمليات مزامنة بعد</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary text-white">
                <th className="table-header">الملف</th>
                <th className="table-header">السجلات</th>
                <th className="table-header">الحالة</th>
                <th className="table-header">التاريخ والوقت</th>
              </tr>
            </thead>
            <tbody>
              {syncs.map((s) => (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="table-cell font-medium">{fileLabel(s.file_type)}</td>
                  <td className="table-cell">{s.rows_imported ?? '—'}</td>
                  <td className="table-cell">
                    {s.status === 'success'
                      ? <span className="badge badge-success">ناجح ✅</span>
                      : <span className="badge badge-danger">فشل ❌</span>}
                  </td>
                  <td className="table-cell text-gray-500 font-mono text-xs">{formatDate(s.created_at)}</td>
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

  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [fileAction, setFileAction] = useState({});
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

  const refresh = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['syncs'] });
    onClearSuccess?.();
  };

  const handleClearAll = async () => {
    setClearingAll(true);
    setClearMsg(null);
    try {
      await api.delete('/admin/clear-excel-data');
      setClearMsg({ ok: true, text: 'تم مسح كل البيانات بنجاح ✅' });
      setConfirmClearAll(false);
      refresh();
    } catch (err) {
      setClearMsg({ ok: false, text: err.response?.data?.error || 'فشل المسح' });
    } finally {
      setClearingAll(false);
    }
  };

  const handleClearFile = async (key) => {
    setFileAction(prev => ({ ...prev, [key]: 'clearing' }));
    setClearMsg(null);
    try {
      await api.delete(`/admin/clear-excel-data/${key}`);
      setClearMsg({ ok: true, text: `تم مسح البيانات بنجاح ✅` });
      setFileAction(prev => ({ ...prev, [key]: null }));
      refresh();
    } catch (err) {
      setClearMsg({ ok: false, text: err.response?.data?.error || 'فشل المسح' });
      setFileAction(prev => ({ ...prev, [key]: null }));
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

      <div className="divide-y divide-gray-50 px-1 py-1">
        {fileInfo.map(ft => {
          const action = fileAction[ft.key];
          const isConfirming = action === 'confirm';
          const isClearing = action === 'clearing';

          return (
            <div key={ft.key} className={`px-3 py-2.5 rounded-xl my-0.5 transition-colors
              ${ft.hasData ? 'hover:bg-green-50/50' : 'hover:bg-red-50/50 bg-red-50/30'}`}>

              <div className="flex items-start gap-2.5">
                <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0
                  ${ft.hasData ? 'bg-emerald-100' : 'bg-red-100'}`}>
                  {isClearing
                    ? <RefreshCw size={10} className="text-gray-400 animate-spin" />
                    : ft.hasData
                      ? <CheckCircle size={12} className="text-emerald-600" />
                      : <AlertCircle size={12} className="text-red-500" />}
                </div>

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

                {ft.hasData && !isConfirming && !isClearing && (
                  <button
                    onClick={() => setFileAction(prev => ({ ...prev, [ft.key]: 'confirm' }))}
                    title="مسح بيانات هذا الملف"
                    className="flex-shrink-0 p-1 rounded-md hover:bg-red-100 text-gray-300 hover:text-red-500 transition-colors">
                    <Trash2 size={11} />
                  </button>
                )}
              </div>

              {isConfirming && (
                <div className="mt-2 flex gap-1.5 items-center">
                  <span className="text-[10px] text-red-600 font-semibold flex-1">مسح نهائياً؟</span>
                  <button
                    onClick={() => handleClearFile(ft.key)}
                    className="px-2 py-0.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold transition-colors">
                    تأكيد
                  </button>
                  <button
                    onClick={() => setFileAction(prev => ({ ...prev, [ft.key]: null }))}
                    className="px-2 py-0.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 text-[10px] font-bold transition-colors">
                    إلغاء
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-4 py-3 border-t border-gray-100 space-y-2">
        {clearMsg && (
          <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg
            ${clearMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {clearMsg.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
            {clearMsg.text}
            <button onClick={() => setClearMsg(null)} className="mr-auto">
              <X size={11} />
            </button>
          </div>
        )}

        {!confirmClearAll ? (
          <button onClick={() => setConfirmClearAll(true)}
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
              <button onClick={handleClearAll} disabled={clearingAll}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg
                  bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors disabled:opacity-60">
                {clearingAll ? <RefreshCw size={11} className="animate-spin" /> : <Trash2 size={11} />}
                {clearingAll ? 'جاري المسح...' : 'تأكيد المسح'}
              </button>
              <button onClick={() => setConfirmClearAll(false)}
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
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [warnings, setWarnings] = useState([]);

  // Line selection — required
  const userLine = user?.line || 'Ahmed Hassan';
  const canChooseLine = userLine === 'All';
  const [selectedLine, setSelectedLine] = useState(canChooseLine ? 'Ahmed Hassan' : userLine);

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

      {/* Line selector banner */}
      <div className="bg-white rounded-xl border-2 border-primary/20 p-4 flex items-center gap-4">
        <div className="flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-primary font-bold text-sm">L</span>
          </div>
        </div>
        <div className="flex-1">
          <label className="text-xs font-semibold text-gray-500 block mb-1">
            {isAr ? 'الـ Line للرفع' : 'Target Line'}
          </label>
          {canChooseLine ? (
            <select
              value={selectedLine}
              onChange={(e) => setSelectedLine(e.target.value)}
              className="input max-w-xs font-semibold"
            >
              {AVAILABLE_LINES.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          ) : (
            <p className="text-base font-bold text-primary">{userLine}</p>
          )}
          <p className="text-[11px] text-gray-400 mt-1">
            {isAr
              ? canChooseLine
                ? '⚠ اختر الـ Line قبل رفع الملفات. كل Line بياناته منفصلة.'
                : 'مسموحلك ترفع فقط على Line الخاص بك.'
              : 'Each line has isolated data.'}
          </p>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex gap-5 items-start">
        <div className="w-64 flex-shrink-0">
          <FilesStatusPanel onClearSuccess={handleSuccess} />
        </div>

        <div className="flex-1 space-y-5">
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
            <UploadZone
              fileType={FILE_TYPES[activeTab]}
              selectedLine={selectedLine}
              onSuccess={handleSuccess}
              onWarnings={setWarnings}
            />
          </div>

          <SyncHistory />
        </div>
      </div>

      {/* Warnings modal */}
      <WarningsModal warnings={warnings} onClose={() => setWarnings([])} />
    </div>
  );
}
