import { useQuery } from '@tanstack/react-query';
import {
  Database, Download, RefreshCw, CheckCircle, AlertTriangle,
  HardDrive, Clock, FileText, Snowflake, Server,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import ModernButton from '../../components/ui/ModernButton';

export default function DbStatus() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['db-status'],
    queryFn: () => api.get('/admin/db-status').then(r => r.data),
    staleTime: 0,
  });

  const handleBackup = async () => {
    try {
      const res = await api.get('/admin/backup/download', { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `academy-backup-${new Date().toISOString().slice(0, 10)}.db`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (e) {
      alert('فشل التنزيل: ' + (e?.response?.data?.error || e.message));
    }
  };

  const persistent = data?.looks_persistent;

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="حالة قاعدة البيانات"
        subtitle="معلومات عن مكان تخزين البيانات وهل هى دائمة أم لا"
        icon={Database}
        gradient="blue"
        actions={
          <div className="flex gap-2">
            <ModernButton variant="glass" icon={RefreshCw} onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? 'جارى...' : 'تحديث'}
            </ModernButton>
            <ModernButton variant="glass" icon={Download} onClick={handleBackup}>
              تحميل نسخة احتياطية
            </ModernButton>
          </div>
        }
      />

      {isLoading ? (
        <p className="text-center py-12 text-gray-400 text-sm font-bold">جارى التحميل...</p>
      ) : !data ? null : (
        <>
          {/* Persistence status banner */}
          {persistent ? (
            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-5 flex items-start gap-3">
              <CheckCircle size={24} className="text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-black text-emerald-800 mb-1">
                  ✅ قاعدة البيانات على volume دائم
                </h3>
                <p className="text-sm text-emerald-700 font-bold">
                  البيانات بتاعتك آمنة ومش هتتمسح مع أى redeploy على Railway.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-5">
              <div className="flex items-start gap-3 mb-3">
                <AlertTriangle size={24} className="text-rose-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-base font-black text-rose-800 mb-1">
                    ⚠️ قاعدة البيانات على ذاكرة مؤقتة (Ephemeral)
                  </h3>
                  <p className="text-sm text-rose-700 font-bold">
                    الـ DB دلوقتى متخزن جوه الـ container — كل ما Railway يعمل redeploy، البيانات بتتمسح!
                  </p>
                </div>
              </div>
              <div className="bg-white border border-rose-200 rounded-xl p-4 text-sm">
                <h4 className="font-black text-rose-900 mb-2">🔧 الحل: اضبط Railway Volume</h4>
                <ol className="text-rose-800 font-bold space-y-1.5 mr-5 list-decimal">
                  <li>ادخل على <strong>Railway Dashboard</strong> → اختار المشروع</li>
                  <li>اختار الـ <strong>Backend service</strong></li>
                  <li>روح <strong>Variables</strong> → أضف: <code className="bg-rose-100 px-1.5 py-0.5 rounded text-xs">DB_PATH = /data/academy.db</code></li>
                  <li>روح <strong>Settings</strong> → <strong>Volumes</strong> → اضغط <strong>"+ New Volume"</strong></li>
                  <li>اكتب: <strong>Mount path:</strong> <code className="bg-rose-100 px-1.5 py-0.5 rounded text-xs">/data</code></li>
                  <li>احفظ — الـ service هيعمل redeploy تلقائى</li>
                  <li><strong className="text-rose-900">ملحوظة:</strong> الـ DB الحالى هيتمسح مع التحويل، لازم ترفع الـ Excels تانى. احفظ نسخة احتياطية الأول!</li>
                </ol>
              </div>
            </div>
          )}

          {/* DB info cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SectionCard title="مكان التخزين" icon={HardDrive} accent="blue">
              <div className="space-y-2 text-sm">
                <InfoRow label="DB Path" value={<code className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{data.db_path}</code>} />
                <InfoRow label="الملف موجود؟" value={data.file_exists ? '✅ نعم' : '❌ لا'} />
                <InfoRow label="حجم الملف" value={data.file_size_human || '—'} />
                <InfoRow label="آخر تعديل" value={data.file_modified_at ? new Date(data.file_modified_at).toLocaleString('ar-EG') : '—'} />
                <InfoRow label="Railway Volume Env" value={data.railway_volume_env ? '✅ مفعّل' : '❌ غير مفعّل'} />
              </div>
            </SectionCard>

            <SectionCard title="عدد السجلات بكل جدول" icon={Server} accent="violet">
              <div className="space-y-1 text-sm">
                {Object.entries(data.table_counts).map(([table, count]) => (
                  <div key={table} className="flex justify-between items-center px-3 py-1.5 bg-gray-50 rounded-lg">
                    <code className="text-xs font-mono text-gray-700">{table}</code>
                    <span className={`font-black ${count === null ? 'text-gray-400' : count === 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
                      {count === null ? 'N/A' : count.toLocaleString('en-US')}
                    </span>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          {/* Recent snapshots */}
          <SectionCard title="آخر 10 Quality Snapshots محفوظة" icon={Snowflake} accent="cyan">
            {data.recent_snapshots.length === 0 ? (
              <p className="text-center py-6 text-gray-400 text-sm font-bold">
                مفيش snapshots محفوظة فى الـ DB حالياً
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-xs font-black text-gray-500">ID</th>
                      <th className="px-4 py-2 text-xs font-black text-gray-500">الاسم</th>
                      <th className="px-4 py-2 text-xs font-black text-gray-500">الفترة</th>
                      <th className="px-4 py-2 text-xs font-black text-gray-500">المالك</th>
                      <th className="px-4 py-2 text-xs font-black text-gray-500">تاريخ الحفظ</th>
                      <th className="px-4 py-2 text-xs font-black text-gray-500">Official</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.recent_snapshots.map(s => (
                      <tr key={s.id} className="hover:bg-gray-50/40">
                        <td className="px-4 py-2 font-mono text-gray-500">{s.id}</td>
                        <td className="px-4 py-2 font-bold">{s.snapshot_label}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{s.from_date} → {s.to_date}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{s.frozen_by_name || '—'}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{s.frozen_at ? new Date(s.frozen_at).toLocaleString('ar-EG') : '—'}</td>
                        <td className="px-4 py-2">
                          {s.is_official
                            ? <span className="text-[10px] font-black px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">📌 Official</span>
                            : <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-600">draft</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <div className="text-[11px] text-gray-500 text-center font-bold">
            💡 ينصح بتحميل نسخة احتياطية كل أسبوع وحفظها فى مكان آمن خارج Railway.
          </div>
        </>
      )}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between items-center px-3 py-1.5 bg-gray-50 rounded-lg gap-3">
      <span className="text-xs font-bold text-gray-600 flex-shrink-0">{label}</span>
      <span className="text-xs font-black text-gray-900 truncate">{value}</span>
    </div>
  );
}
