import { useState, useRef } from 'react';
import { Upload, CheckCircle, AlertCircle, FileSpreadsheet, Activity, Clock, Hash, TrendingUp, Camera, Database, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

export default function RemarksMonitor() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [showUpload, setShowUpload] = useState(false);
  const fileInputRef = useRef(null);

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
  }

  function pushHistory(data, source, fileName) {
    setHistory(h => [{
      ...data,
      source,
      file_name: fileName || (source === 'db' ? '— البيانات الحالية —' : ''),
      uploaded_at: new Date().toLocaleString('ar-EG'),
    }, ...h]);
  }

  async function handleSnapshotFromDb() {
    setSnapshotting(true);
    setError(null);
    setResult(null);

    try {
      const { data } = await api.post('/remarks-monitor/snapshot-from-db');
      setResult(data);
      pushHistory(data, 'db');
    } catch (err) {
      const msg = err.response?.data?.details || err.response?.data?.error || err.message;
      setError(msg);
    } finally {
      setSnapshotting(false);
    }
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const { data } = await api.post('/remarks-monitor/upload', formData);
      setResult({ ...data, source: 'upload' });
      pushHistory(data, 'upload', file.name);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      const msg = err.response?.data?.details || err.response?.data?.error || err.message;
      setError(msg);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHero
        title="مراقبة الـ Remarks"
        subtitle="تتبع نشاط الـ Remarks وتسجيل الأحداث عبر Snapshots"
        icon={Activity}
        gradient="from-violet-500 to-fuchsia-500"
      />

      {/* Primary: Snapshot from current DB */}
      <div className="bg-gradient-to-br from-violet-50 via-fuchsia-50 to-pink-50 rounded-2xl shadow-sm border-2 border-violet-200 p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg">
            <Camera size={28} className="text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
              <Database size={20} className="text-violet-600" />
              Snapshot من البيانات الحالية
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              يأخذ Snapshot من الـ Remarks الموجودة فعلاً في السيستم (بعد آخر رفعة عادية).
              <span className="block mt-1 text-violet-700 font-semibold">
                ✓ الطريقة الموصى بها — أأمن وأسرع
              </span>
            </p>
            <button
              onClick={handleSnapshotFromDb}
              disabled={snapshotting}
              className="px-6 py-3 rounded-xl font-bold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600
                hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-40 disabled:cursor-not-allowed
                transition shadow-md hover:shadow-lg flex items-center gap-2"
            >
              <Camera size={18} />
              {snapshotting ? 'جاري الإنشاء...' : 'خذ Snapshot من البيانات الحالية'}
            </button>
          </div>
        </div>
      </div>

      {/* Secondary: Upload (collapsible) */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <button
          onClick={() => setShowUpload(s => !s)}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition rounded-t-2xl"
        >
          <div className="flex items-center gap-2">
            <Upload size={18} className="text-gray-500" />
            <span className="font-semibold text-gray-700">أو ارفع ملف Excel جديد</span>
            <span className="text-xs text-gray-500 px-2 py-0.5 rounded-full bg-gray-100">احتياطي</span>
          </div>
          {showUpload ? <ChevronUp size={18} className="text-gray-500" /> : <ChevronDown size={18} className="text-gray-500" />}
        </button>

        {showUpload && (
          <div className="px-6 pb-6 pt-2 border-t border-gray-100 space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                <strong>تنبيه:</strong> الرفع المباشر هنا منفصل عن نظام رفع Remarks العادي.
                يستخدم فقط في الحالات الاستثنائية. الأفضل دائماً استخدام "Snapshot من البيانات الحالية" بعد الرفع العادي.
              </p>
            </div>

            <div
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition
                ${file ? 'border-violet-400 bg-violet-50' : 'border-gray-300 hover:border-violet-400 hover:bg-violet-50/50'}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                onChange={handleFileChange}
                className="hidden"
              />
              <FileSpreadsheet size={40} className={`mx-auto mb-2 ${file ? 'text-violet-600' : 'text-gray-400'}`} />
              {file ? (
                <div>
                  <p className="font-semibold text-gray-800 text-sm">{file.name}</p>
                  <p className="text-xs text-gray-500 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-gray-700 text-sm">اضغط لاختيار ملف Remarks.xlsx</p>
                  <p className="text-xs text-gray-500 mt-1">.xlsx — حد أقصى 30MB</p>
                </div>
              )}
            </div>

            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="w-full py-2.5 rounded-xl font-semibold text-white bg-gray-700 hover:bg-gray-800
                disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
            >
              {uploading ? 'جاري الرفع...' : 'رفع وتسجيل الـ Snapshot'}
            </button>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-red-900">فشل العملية</p>
            <p className="text-sm text-red-700 mt-1 whitespace-pre-wrap">{error}</p>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CheckCircle size={22} className="text-emerald-600" />
              <h3 className="font-bold text-emerald-900">{result.message}</h3>
            </div>
            <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 font-bold">
              {result.source === 'db' ? '📸 من البيانات' : '📤 من ملف'}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Hash}            label="رقم الـ Snapshot"    value={`#${result.snapshot_id}`} color="emerald" />
            <StatCard icon={FileSpreadsheet} label="عدد الـ Remarks"      value={result.total_remarks}     color="blue" />
            <StatCard icon={TrendingUp}      label="الأحداث المسجلة"      value={result.events_generated}  color="violet" />
            <StatCard icon={Clock}           label="آخر Snapshot سابق"
                      value={result.prev_snapshot_id ? `#${result.prev_snapshot_id}` : 'أول رفعة'}
                      color="amber" />
          </div>
          <p className="text-xs text-emerald-700 mt-3">
            وقت الـ Snapshot: {result.snapshot_at} — Line: {result.line}
          </p>
        </div>
      )}

      {/* Recent in session */}
      {history.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h3 className="font-bold text-gray-800 mb-3">سجل الجلسة الحالية</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">#</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">المصدر</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">وقت الإنشاء</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">Snapshot</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">Remarks</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">أحداث</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500">{history.length - i}</td>
                    <td className="px-3 py-2">
                      {h.source === 'db' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-violet-100 text-violet-700 font-bold">
                          <Database size={12} /> البيانات الحالية
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 font-bold">
                          <Upload size={12} /> {h.file_name}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{h.uploaded_at}</td>
                    <td className="px-3 py-2 font-bold text-violet-700">#{h.snapshot_id}</td>
                    <td className="px-3 py-2">{h.total_remarks}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-violet-100 text-violet-700">
                        {h.events_generated}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  const colorMap = {
    emerald: 'bg-emerald-100 text-emerald-700',
    blue:    'bg-blue-100 text-blue-700',
    violet:  'bg-violet-100 text-violet-700',
    amber:   'bg-amber-100 text-amber-700',
  };
  return (
    <div className="bg-white rounded-lg border border-emerald-200 p-3">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-md ${colorMap[color]}`}>
          <Icon size={14} />
        </div>
        <span className="text-xs text-gray-600">{label}</span>
      </div>
      <p className="text-lg font-bold text-gray-800 mt-1">{value}</p>
    </div>
  );
}
