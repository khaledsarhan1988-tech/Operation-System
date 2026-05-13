import { useState, useRef } from 'react';
import { Upload, CheckCircle, AlertCircle, FileSpreadsheet, Activity, Clock, Hash, TrendingUp } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

export default function RemarksMonitor() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const fileInputRef = useRef(null);

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
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
      setResult(data);
      setHistory(h => [{ ...data, file_name: file.name, uploaded_at: new Date().toLocaleString('ar-EG') }, ...h]);
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
        subtitle="رفع Snapshot جديد لمتابعة نشاط الـ Remarks وتسجيل الأحداث"
        icon={Activity}
        gradient="from-violet-500 to-fuchsia-500"
      />

      {/* Upload Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Upload size={20} className="text-violet-600" />
          رفع Snapshot جديد
        </h2>

        <div className="space-y-4">
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition
              ${file ? 'border-violet-400 bg-violet-50' : 'border-gray-300 hover:border-violet-400 hover:bg-violet-50/50'}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              onChange={handleFileChange}
              className="hidden"
            />
            <FileSpreadsheet size={48} className={`mx-auto mb-3 ${file ? 'text-violet-600' : 'text-gray-400'}`} />
            {file ? (
              <div>
                <p className="font-semibold text-gray-800">{file.name}</p>
                <p className="text-xs text-gray-500 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-gray-700">اضغط لاختيار ملف Remarks.xlsx</p>
                <p className="text-xs text-gray-500 mt-1">ملف .xlsx فقط — حد أقصى 30MB</p>
              </div>
            )}
          </div>

          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600
              hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-40 disabled:cursor-not-allowed
              transition shadow-sm"
          >
            {uploading ? 'جاري الرفع...' : 'رفع وتسجيل الـ Snapshot'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-red-900">فشل الرفع</p>
            <p className="text-sm text-red-700 mt-1 whitespace-pre-wrap">{error}</p>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle size={22} className="text-emerald-600" />
            <h3 className="font-bold text-emerald-900">{result.message}</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Hash}       label="رقم الـ Snapshot"    value={`#${result.snapshot_id}`} color="emerald" />
            <StatCard icon={FileSpreadsheet} label="عدد الـ Remarks" value={result.total_remarks}  color="blue" />
            <StatCard icon={TrendingUp} label="الأحداث المسجلة"      value={result.events_generated} color="violet" />
            <StatCard icon={Clock}      label="آخر Snapshot سابق"
                      value={result.prev_snapshot_id ? `#${result.prev_snapshot_id}` : 'أول رفعة'}
                      color="amber" />
          </div>
          <p className="text-xs text-emerald-700 mt-3">
            وقت الـ Snapshot: {result.snapshot_at} — Line: {result.line}
          </p>
        </div>
      )}

      {/* Recent uploads in this session */}
      {history.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h3 className="font-bold text-gray-800 mb-3">رفعات هذه الجلسة</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">#</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">الملف</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">وقت الرفع</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">Snapshot</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">Remarks</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">أحداث</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500">{history.length - i}</td>
                    <td className="px-3 py-2 font-mono text-xs">{h.file_name}</td>
                    <td className="px-3 py-2 text-gray-600">{h.uploaded_at}</td>
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
