import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, CheckCircle, AlertCircle, Clock, FileSpreadsheet, RefreshCw } from 'lucide-react';
import api from '../../api/axios';

const FILE_TYPES = [
  { key: 'employees',     labelAr: 'الموظفون',              labelEn: 'Employees',             file: 'Data.xlsx' },
  { key: 'trainees',      labelAr: 'المتدربون النشطون',     labelEn: 'Active Trainees',        file: 'Active Batches Trainees.xlsx' },
  { key: 'batches',       labelAr: 'المجموعات',             labelEn: 'Batches',                file: 'Batches.xlsx' },
  { key: 'remarks',       labelAr: 'الملاحظات',             labelEn: 'Remarks',                file: 'Remarks.xlsx' },
  { key: 'lectures',      labelAr: 'المحاضرات الرئيسية',   labelEn: 'Main Lectures',          file: 'Lectures.xlsx' },
  { key: 'sideSessions',  labelAr: 'الجلسات الجانبية',    labelEn: 'Side Sessions',          file: 'Side Sessions.xlsx' },
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

export default function ExcelUpload() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['syncs'] });
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
  );
}
