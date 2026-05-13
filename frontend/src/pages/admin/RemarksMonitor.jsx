import { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, CheckCircle, AlertCircle, FileSpreadsheet, Activity, Clock, Hash, TrendingUp, Camera, Database, ChevronDown, ChevronUp, Globe, Trash2, RefreshCw } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import { useAuth } from '../../auth/AuthContext';

const AVAILABLE_LINES = ['Ahmed Hassan', 'Dardasha'];

export default function RemarksMonitor() {
  const { user } = useAuth();
  const isAdminAllLines = user?.line === 'All';
  const [selectedLine, setSelectedLine] = useState(
    isAdminAllLines ? 'Ahmed Hassan' : (user?.line || 'Ahmed Hassan')
  );
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const fileInputRef = useRef(null);

  const loadSnapshots = useCallback(async () => {
    setLoadingSnapshots(true);
    try {
      const { data } = await api.get('/remarks-monitor/snapshots', { params: { line: selectedLine } });
      setSnapshots(data.snapshots || []);
    } catch (err) {
      console.error('Failed to load snapshots:', err);
    } finally {
      setLoadingSnapshots(false);
    }
  }, [selectedLine]);

  useEffect(() => { loadSnapshots(); }, [loadSnapshots]);

  async function handleDelete(id) {
    if (!confirm(`هل أنت متأكد من حذف Snapshot #${id}؟ هيمسح كل الـ rows والـ events بتاعته.`)) return;
    setDeletingId(id);
    try {
      await api.delete(`/remarks-monitor/snapshots/${id}`, { data: { line: selectedLine } });
      await loadSnapshots();
    } catch (err) {
      const msg = err.response?.data?.details || err.response?.data?.error || err.message;
      setError(`فشل الحذف: ${msg}`);
    } finally {
      setDeletingId(null);
    }
  }

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
  }

  async function handleSnapshotFromDb() {
    setSnapshotting(true);
    setError(null);
    setResult(null);

    try {
      const { data } = await api.post('/remarks-monitor/snapshot-from-db', { line: selectedLine });
      setResult(data);
      await loadSnapshots();
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
    formData.append('line', selectedLine);

    try {
      const { data } = await api.post('/remarks-monitor/upload', formData);
      setResult({ ...data, source: 'upload' });
      await loadSnapshots();
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

      {/* Line Selector — visible only when user can pick (admin with 'All') */}
      {isAdminAllLines && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100">
              <Globe size={18} className="text-blue-600" />
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-600 block mb-1">اختر الـ Line</label>
              <select
                value={selectedLine}
                onChange={e => setSelectedLine(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-800
                  focus:ring-2 focus:ring-violet-300 focus:border-violet-400 outline-none font-semibold"
              >
                {AVAILABLE_LINES.map(line => (
                  <option key={line} value={line}>{line}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

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

      {/* All Snapshots — persistent from DB */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-800">سجل الـ Snapshots — {selectedLine}</h3>
          <button
            onClick={loadSnapshots}
            disabled={loadingSnapshots}
            className="p-2 rounded-lg hover:bg-gray-100 transition disabled:opacity-40"
            title="تحديث"
          >
            <RefreshCw size={16} className={`text-gray-600 ${loadingSnapshots ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {loadingSnapshots && snapshots.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">جاري التحميل...</p>
        ) : snapshots.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">لا توجد Snapshots بعد — اضغط الزرار البنفسجي عشان تبدأ</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">Snapshot</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">وقت الإنشاء</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">المُنشئ</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">Remarks</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">أحداث</th>
                  <th className="px-3 py-2 text-start font-semibold text-gray-700">ملاحظات</th>
                  <th className="px-3 py-2 text-end font-semibold text-gray-700"></th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 font-bold text-violet-700">#{s.id}</td>
                    <td className="px-3 py-2 text-gray-700 text-xs whitespace-nowrap">{s.snapshot_at}</td>
                    <td className="px-3 py-2 text-gray-700 text-xs">{s.uploaded_by_name || '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{s.total_remarks}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold
                        ${s.events_count === 0 ? 'bg-gray-100 text-gray-600' :
                          s.events_count > 1000 ? 'bg-amber-100 text-amber-700' :
                          'bg-violet-100 text-violet-700'}`}>
                        {s.events_count}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs max-w-xs truncate" title={s.notes}>{s.notes || '—'}</td>
                    <td className="px-3 py-2 text-end">
                      <button
                        onClick={() => handleDelete(s.id)}
                        disabled={deletingId === s.id}
                        className="p-1.5 rounded-lg hover:bg-red-50 disabled:opacity-40 transition"
                        title="حذف"
                      >
                        <Trash2 size={14} className="text-red-500" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
