import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, CheckCircle2, XCircle, Clock, AlertCircle, Search,
  RefreshCw, FileText, X, Send, Sparkles, ScanSearch, Database, Trash2,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import { useAuth } from '../../auth/AuthContext';

// Approval status tabs + their visual treatment.
// activeBg uses STATIC class names (Tailwind JIT won't pick up dynamically
// constructed `bg-${color}-500` strings, so the class would never make it
// into the CSS bundle and the buttons would render uncoloured).
const TABS = [
  { key: 'pending',  label: 'في الانتظار',  icon: Clock,         activeBg: 'bg-amber-500'   },
  { key: 'approved', label: 'تمت الموافقة', icon: CheckCircle2,  activeBg: 'bg-emerald-500' },
  { key: 'rejected', label: 'مرفوضة',       icon: XCircle,       activeBg: 'bg-red-500'     },
  { key: 'auto',     label: 'إجازة رسمية',  icon: Sparkles,      activeBg: 'bg-sky-500'     },
  { key: 'all',      label: 'الكل',          icon: CalendarClock, activeBg: 'bg-indigo-500'  },
];

const STATUS_VISUAL = {
  pending:  { label: 'في الانتظار',  cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  approved: { label: 'تمت الموافقة', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  rejected: { label: 'مرفوضة',       cls: 'bg-red-100 text-red-800 border-red-200' },
  auto:     { label: 'إجازة رسمية',   cls: 'bg-sky-100 text-sky-800 border-sky-200' },
};

export default function LectureReschedules() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab]         = useState('pending');
  const [search, setSearch]   = useState('');
  const [trainer, setTrainer] = useState('');
  const [from, setFrom]       = useState('');
  const [to, setTo]           = useState('');
  const [openId, setOpenId]   = useState(null);
  const [showDiagnostic, setShowDiagnostic] = useState(false);

  // Super-admin actions (approve/reject/notes) only available to admin+All
  const isSuperAdmin = user?.role === 'admin' && user?.management === 'All';

  const { data, isLoading } = useQuery({
    queryKey: ['reschedules', tab, search, trainer, from, to],
    queryFn: () => api.get('/reschedules', {
      params: {
        status: tab,
        group:   search || undefined,
        trainer: trainer || undefined,
        from:    from || undefined,
        to:      to   || undefined,
      },
    }).then(r => r.data),
    staleTime: 30 * 1000,
  });

  const rows   = data?.rows   || [];
  const counts = data?.counts || {};
  const openRow = openId ? rows.find(r => r.id === openId) : null;

  return (
    <div className="space-y-5">
      <PageHero
        title="إعادة جدولة المحاضرات"
        subtitle="سجل كامل بكل المحاضرات اللى اتغير ميعادها — مع اعتماد المدير ومتابعة الإجازات الرسمية"
        icon={CalendarClock}
        gradient="from-indigo-500 to-purple-600"
      />

      {/* Tabs */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-1.5 flex gap-1.5 flex-wrap">
        {TABS.map(t => {
          const Icon = t.icon;
          const isActive = tab === t.key;
          const cnt = counts[t.key] || (t.key === 'all'
            ? Object.values(counts).reduce((s, n) => s + n, 0) : 0);
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 min-w-[120px] px-3 py-2.5 rounded-xl text-sm font-bold transition flex items-center justify-center gap-2
                ${isActive
                  ? `${t.activeBg} text-white shadow-md`
                  : 'text-gray-600 hover:bg-gray-50'}`}>
              <Icon size={14} />
              {t.label}
              {cnt > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold
                  ${isActive ? 'bg-white/30 text-white' : 'bg-gray-100 text-gray-700'}`}>
                  {cnt}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="بحث في اسم المجموعة..."
            className="w-full pl-3 pr-8 py-1.5 rounded-lg border border-gray-300 text-sm" />
        </div>
        <input type="text" value={trainer} onChange={e => setTrainer(e.target.value)}
          placeholder="اسم المدرب"
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm min-w-[140px]" />
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
        <span className="text-xs text-gray-400">إلى</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
        <button onClick={() => qc.invalidateQueries({ queryKey: ['reschedules'] })}
          className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm flex items-center gap-1.5">
          <RefreshCw size={14} /> تحديث
        </button>
        {isSuperAdmin && (
          <>
            <CleanupFalsePositivesButton
              onDone={() => qc.invalidateQueries({ queryKey: ['reschedules'] })}
            />
            <button onClick={() => setShowDiagnostic(true)}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-bold flex items-center gap-1.5 mr-auto">
              <ScanSearch size={14} /> فحص ذكي للبيانات التاريخية
            </button>
          </>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 font-bold">
              <tr>
                <th className="px-3 py-2 text-right">المجموعة</th>
                <th className="px-3 py-2 text-right">النوع</th>
                <th className="px-3 py-2 text-right">المدرب</th>
                <th className="px-3 py-2 text-center">من تاريخ</th>
                <th className="px-3 py-2 text-center">إلى تاريخ</th>
                <th className="px-3 py-2 text-center">الحالة</th>
                <th className="px-3 py-2 text-center">السبب</th>
                <th className="px-3 py-2 text-center">اكتشف في</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">جاري التحميل...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">
                  لا توجد عمليات إعادة جدولة في هذه القائمة
                </td></tr>
              ) : rows.map(r => {
                const sv = STATUS_VISUAL[r.approval_status] || { label: r.approval_status, cls: 'bg-gray-100 text-gray-700 border-gray-200' };
                return (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-indigo-50/30 cursor-pointer"
                      onClick={() => setOpenId(r.id)}>
                    <td className="px-3 py-2.5 font-semibold text-gray-800">{r.group_name}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border
                        ${r.session_type === 'main' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200'}`}>
                        {r.session_type === 'main' ? 'أساسية' : 'زووم'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.old_trainer !== r.new_trainer ? (
                        <span>
                          <span className="text-red-600">{r.old_trainer}</span>
                          <span className="text-gray-400 mx-1">←</span>
                          <span className="text-emerald-600">{r.new_trainer}</span>
                        </span>
                      ) : (
                        <span className="text-gray-700">{r.old_trainer || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="text-xs font-bold text-red-600">{r.old_date}</div>
                      <div className="text-[10px] text-gray-500">{r.old_time || ''}</div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="text-xs font-bold text-emerald-600">{r.new_date}</div>
                      <div className="text-[10px] text-gray-500">{r.new_time || ''}</div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full font-bold border ${sv.cls}`}>
                        {sv.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-xs">
                      {r.reschedule_reason === 'official_holiday' ? (
                        <span className="inline-flex items-center gap-1 text-sky-700 font-bold" title={r.holiday_name}>
                          <Sparkles size={11} /> {r.holiday_name || 'إجازة'}
                        </span>
                      ) : <span className="text-gray-300">يدوي</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center text-[11px] text-gray-500">
                      {r.detected_at?.slice(0, 10)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail modal */}
      {openRow && (
        <RescheduleDetailModal
          row={openRow}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setOpenId(null)}
          onChanged={() => { qc.invalidateQueries({ queryKey: ['reschedules'] }); }}
        />
      )}
      {showDiagnostic && (
        <DiagnosticModal
          onClose={() => setShowDiagnostic(false)}
          onBackfilled={() => { qc.invalidateQueries({ queryKey: ['reschedules'] }); }}
        />
      )}
    </div>
  );
}

// ─── Diagnostic Modal — "Smart Scan" for historical reschedules ──────────────
// Explains the feature's limitation (only detects reschedules going forward
// from deploy day) and offers a heuristic backfill: lectures whose date
// doesn't fall on the batch's training_schedule weekdays. These get added
// as "pending" reschedules with reason='anomaly_detected' so the admin can
// review and approve/reject like any other entry.
function DiagnosticModal({ onClose, onBackfilled }) {
  const [from, setFrom] = useState('');   // empty = backend default (30d)
  const [to, setTo]     = useState('');
  const [result, setResult] = useState(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['reschedules-diagnostic', from, to],
    queryFn: () => api.get('/reschedules/diagnostic', {
      params: { from: from || undefined, to: to || undefined },
    }).then(r => r.data),
  });

  const backfillMut = useMutation({
    mutationFn: () => api.post('/reschedules/backfill', { from, to }).then(r => r.data),
    onSuccess: (res) => { setResult(res); onBackfilled(); refetch(); },
  });

  // TRUE Drive-based backfill: walks the historical Excel files day-by-day
  // and diffs them. This is the slow but ACCURATE option — actual reschedules
  // with real old_date + new_date recovered from the file snapshots.
  const driveBackfillMut = useMutation({
    mutationFn: () => api.post('/reschedules/backfill-from-drive', { from, to }).then(r => r.data),
    onSuccess: (res) => { setResult({ ...res, fromDrive: true }); onBackfilled(); refetch(); },
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-gradient-to-r from-indigo-50 to-purple-50 border-b flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2">
              <ScanSearch size={18} className="text-indigo-600" />
              فحص ذكي للبيانات التاريخية
            </h3>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              السيستم بيـ detect الـ reschedules اللى تحصل من تاريخ تفعيله. للبيانات الأقدم،
              بنستخدم heuristic بيدور على المحاضرات اللى تاريخها مش في أيام الـ training_schedule
              للمجموعة — مؤشّر قوي على إن المحاضرة اتـ rescheduled.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white rounded-lg">
            <X size={18} className="text-gray-600" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">من تاريخ (افتراضي: آخر 30 يوم)</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">إلى تاريخ</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
            </div>
          </div>

          {isLoading ? (
            <p className="text-center text-gray-400 py-8">جاري التحليل...</p>
          ) : !data ? null : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold text-blue-700 uppercase mb-1">عمليات رفع</p>
                  <p className="text-2xl font-black text-blue-900">{data.syncs.count}</p>
                  <p className="text-[10px] text-blue-700 mt-1">
                    {data.syncs.latest ? `آخر: ${data.syncs.latest.slice(0,10)}` : 'لا توجد'}
                  </p>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold text-emerald-700 uppercase mb-1">Reschedules مكتشف</p>
                  <p className="text-2xl font-black text-emerald-900">{data.reschedules.total}</p>
                  <p className="text-[10px] text-emerald-700 mt-1">
                    {data.reschedules.by_status.pending || 0} في الانتظار
                  </p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold text-amber-700 uppercase mb-1">Anomalies مشبوهة</p>
                  <p className="text-2xl font-black text-amber-900">{data.suspects.count}</p>
                  <p className="text-[10px] text-amber-700 mt-1">
                    {data.suspects.batches_affected} مجموعة
                  </p>
                </div>
              </div>

              {/* Explanation banner */}
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-800 leading-relaxed">
                <p className="font-bold mb-1">📋 تفسير الأرقام:</p>
                <ul className="list-disc pr-4 space-y-1">
                  <li><b>Reschedules مكتشف</b>: الـ rows اللى تم رصدها عبر الـ Drive Sync من بعد التفعيل النهارده.</li>
                  <li><b>Anomalies مشبوهة</b>: محاضرات تاريخها مش في أيام الـ training_schedule — مؤشر على إن فيه reschedule حصل في الماضي.</li>
                </ul>
              </div>

              {/* Suspect batches list */}
              {data.suspects.per_batch.length > 0 && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 border-b border-amber-200">
                    🔍 المجموعات اللى فيها محاضرات بأيام غير متوقعة
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
                    {data.suspects.per_batch.map((b, i) => (
                      <div key={i} className="p-3 hover:bg-gray-50">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-bold text-sm text-gray-800">{b.group_name}</p>
                          <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded font-bold">{b.line}</span>
                        </div>
                        <p className="text-[11px] text-gray-500 mb-2">
                          الأيام المعتمدة: <b>{b.expected_days}</b> · {b.lectures.length} محاضرة مشبوهة
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {b.lectures.map((l, j) => (
                            <span key={j} className="text-[10px] bg-amber-100 text-amber-800 px-2 py-1 rounded border border-amber-200">
                              {l.date} ({l.weekday}) {l.time}
                              {l.session_type === 'side' && <span className="text-fuchsia-700 mr-1">·zoom</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Two backfill options: heuristic (fast, approximate) and
                  Drive-based (slow, accurate — true reschedule recovery) */}
              {!result && (
                <div className="space-y-3">
                  {/* OPTION 1 — RECOMMENDED: True Drive backfill */}
                  <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border-2 border-indigo-300 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <div className="bg-indigo-500 text-white rounded-lg p-2 flex-shrink-0">
                        <Sparkles size={16} />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-indigo-900 mb-1">
                          🎯 الفحص الحقيقي من ملفات Drive (موصى به)
                        </p>
                        <p className="text-xs text-indigo-700 mb-3 leading-relaxed">
                          السيستم هيقرا كل ملف Excel من تاريخ لتاريخ، ويقارن محاضرات يوم 16
                          في ملف 16 مع محاضرات يوم 16 في ملف 17، وكذا. كل اختلاف = reschedule
                          <b> حقيقي</b> بتاريخ أصلي وتاريخ جديد فعلي.
                          <br />
                          <span className="text-amber-700 font-semibold">⏱ بياخد دقيقة أو اتنين لأنه بيـ download كل الملفات.</span>
                        </p>
                        <button onClick={() => driveBackfillMut.mutate()}
                          disabled={driveBackfillMut.isPending}
                          className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
                          <Sparkles size={14} />
                          {driveBackfillMut.isPending ? 'جاري قراءة الملفات من Drive...' : '🔍 ابدأ الفحص الحقيقي من Drive'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* OPTION 2 — Quick heuristic */}
                  {data.suspects.count > 0 && (
                    <details className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                      <summary className="cursor-pointer text-xs font-bold text-gray-700">
                        ⚡ بديل سريع: heuristic بناءً على training_schedule ({data.suspects.count} انومالي)
                      </summary>
                      <p className="text-[11px] text-gray-600 my-2">
                        يحوّل الـ {data.suspects.count} انومالي لـ pending reschedules بدون قراءة الملفات.
                        ⚠ التاريخ الأصلي مش معروف فبيتسجل = التاريخ الجديد (أقل دقة).
                      </p>
                      <button onClick={() => backfillMut.mutate()}
                        disabled={backfillMut.isPending}
                        className="px-3 py-1.5 rounded-lg bg-gray-500 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                        <Database size={11} />
                        {backfillMut.isPending ? 'جاري...' : 'استخدم heuristic بدلاً منه'}
                      </button>
                    </details>
                  )}
                </div>
              )}

              {result && result.fromDrive && (
                <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4">
                  <p className="text-sm font-bold text-emerald-900 mb-2">
                    ✅ تم الفحص الحقيقي من Drive
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-white rounded p-2">
                      <p className="text-gray-500">أيام مفحوصة</p>
                      <p className="text-lg font-black text-gray-800">{result.summary?.days_scanned || 0}</p>
                    </div>
                    <div className="bg-white rounded p-2">
                      <p className="text-gray-500">أيام فيها ملفات</p>
                      <p className="text-lg font-black text-gray-800">{result.summary?.days_with_data || 0}</p>
                    </div>
                    <div className="bg-white rounded p-2">
                      <p className="text-gray-500">Reschedules مكتشف</p>
                      <p className="text-lg font-black text-emerald-700">{result.summary?.inserted || 0}</p>
                    </div>
                    <div className="bg-white rounded p-2">
                      <p className="text-gray-500">موجود من قبل</p>
                      <p className="text-lg font-black text-gray-800">{result.summary?.skipped_existing || 0}</p>
                    </div>
                  </div>
                  {result.sample_log?.length > 0 && (
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer font-bold text-emerald-800">
                        عينة من الـ reschedules اللى اتلاقت ({Math.min(result.sample_log.length, 50)})
                      </summary>
                      <div className="mt-2 max-h-60 overflow-y-auto space-y-1">
                        {result.sample_log.map((l, i) => (
                          <div key={i} className="bg-white rounded p-2 border border-emerald-200">
                            <p className="font-bold text-gray-800">{l.group}</p>
                            <p className="text-gray-600">
                              <span className="text-red-600 line-through">{l.old}</span>
                              <span className="text-gray-400 mx-1">←</span>
                              <span className="text-emerald-600 font-bold">{l.new}</span>
                            </p>
                            <p className="text-[10px] text-gray-500">
                              {l.trainer} · ملف {l.from_file_date} → {l.to_file_date}
                              {l.holiday && <span className="text-sky-600 mr-1">· {l.holiday}</span>}
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  <p className="text-xs text-emerald-700 mt-3">
                    راجع كل reschedule في تاب "في الانتظار" وقرر موافقة / رفض.
                  </p>
                </div>
              )}

              {result && !result.fromDrive && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800">
                  ✅ <b>{result.inserted}</b> انومالي اتم تحويلها. <b>{result.skipped}</b> كانت موجودة قبل كده.
                  راجعها في تاب "في الانتظار".
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Detail Modal with approve/reject + admin notes ──────────────────────────
function RescheduleDetailModal({ row, isSuperAdmin, onClose, onChanged }) {
  const [notes, setNotes]           = useState(row.admin_notes || '');
  const [rejectReason, setReject]   = useState('');
  const [showRejectBox, setRBox]    = useState(false);
  const sv = STATUS_VISUAL[row.approval_status] || STATUS_VISUAL.pending;

  const approveMut = useMutation({
    mutationFn: () => api.patch(`/reschedules/${row.id}/approve`),
    onSuccess: () => { onChanged(); onClose(); },
  });
  const rejectMut = useMutation({
    mutationFn: () => api.patch(`/reschedules/${row.id}/reject`, { reason: rejectReason }),
    onSuccess: () => { onChanged(); onClose(); },
  });
  const notesMut = useMutation({
    mutationFn: () => api.patch(`/reschedules/${row.id}/notes`, { notes }),
    onSuccess: () => onChanged(),
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-gradient-to-r from-indigo-50 to-purple-50 border-b flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${sv.cls}`}>{sv.label}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-700 border border-indigo-200">
                {row.session_type === 'main' ? 'محاضرة أساسية' : 'زووم/Side'}
              </span>
              {row.reschedule_reason === 'official_holiday' && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold bg-sky-100 text-sky-700 border border-sky-200">
                  <Sparkles size={10} /> سبب: إجازة رسمية ({row.holiday_name})
                </span>
              )}
            </div>
            <h3 className="font-bold text-gray-900 text-lg">{row.group_name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{row.line}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white rounded-lg"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Before/After */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-red-700 uppercase mb-1">الموعد الأصلي (اتلغى)</p>
              <p className="text-lg font-black text-red-800">{row.old_date}</p>
              <p className="text-sm text-red-700 mt-1">
                <Clock size={11} className="inline -mt-0.5" /> {row.old_time || '—'} · {row.old_duration || ''}
              </p>
              <p className="text-xs text-red-600 mt-1">المدرب: <b>{row.old_trainer || '—'}</b></p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-emerald-700 uppercase mb-1">الموعد الجديد</p>
              <p className="text-lg font-black text-emerald-800">{row.new_date}</p>
              <p className="text-sm text-emerald-700 mt-1">
                <Clock size={11} className="inline -mt-0.5" /> {row.new_time || '—'} · {row.new_duration || ''}
              </p>
              <p className="text-xs text-emerald-600 mt-1">المدرب: <b>{row.new_trainer || '—'}</b></p>
            </div>
          </div>

          {/* Detection meta */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-gray-600 grid grid-cols-2 gap-2">
            <div>
              <span className="text-gray-500">اكتشف في:</span>{' '}
              <b className="text-gray-800">{row.detected_at?.replace('T', ' ').slice(0, 16)}</b>
            </div>
            {row.approved_at && (
              <div>
                <span className="text-gray-500">قرار في:</span>{' '}
                <b className="text-gray-800">{row.approved_at?.replace('T', ' ').slice(0, 16)}</b>
              </div>
            )}
            {row.approved_by_name && (
              <div className="col-span-2">
                <span className="text-gray-500">القرار من:</span>{' '}
                <b className="text-gray-800">{row.approved_by_name}</b>
              </div>
            )}
            {row.rejection_reason && (
              <div className="col-span-2 bg-red-50 border border-red-200 rounded p-2 text-red-700">
                <b>سبب الرفض:</b> {row.rejection_reason}
              </div>
            )}
          </div>

          {/* Admin notes — read by all, edit by super-admin only */}
          <div className={`border rounded-xl p-3 ${isSuperAdmin ? 'bg-amber-50/50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              <FileText size={14} className="text-amber-600" />
              <p className="text-xs font-bold text-amber-800">ملاحظات المدير</p>
              {!isSuperAdmin && <span className="text-[10px] text-gray-500">(عرض فقط)</span>}
            </div>
            {isSuperAdmin ? (
              <>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="ملاحظات داخلية للمدير العام (لن يراها المنسق/الموظف)..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-amber-300 text-xs bg-white" />
                <button onClick={() => notesMut.mutate()}
                  disabled={notesMut.isPending || notes === (row.admin_notes || '')}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1.5">
                  <Send size={11} /> حفظ الملاحظة
                </button>
              </>
            ) : (
              <p className="text-xs text-gray-600 whitespace-pre-wrap">
                {row.admin_notes || <span className="text-gray-400 italic">لا توجد ملاحظات</span>}
              </p>
            )}
          </div>

          {/* Approve/Reject (super-admin only, only when pending) */}
          {isSuperAdmin && row.approval_status === 'pending' && (
            <div className="border-t pt-4">
              <p className="text-xs font-bold text-gray-700 mb-2">قرار المدير</p>
              {!showRejectBox ? (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => approveMut.mutate()}
                    disabled={approveMut.isPending}
                    className="py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2">
                    <CheckCircle2 size={15} />
                    {approveMut.isPending ? 'جاري...' : 'موافقة'}
                  </button>
                  <button onClick={() => setRBox(true)}
                    className="py-2.5 rounded-lg bg-gradient-to-r from-red-500 to-red-600 text-white font-bold text-sm inline-flex items-center justify-center gap-2">
                    <XCircle size={15} />
                    رفض
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea value={rejectReason} onChange={e => setReject(e.target.value)}
                    placeholder="سبب الرفض (اختياري)..."
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-red-300 text-xs bg-white" />
                  <div className="flex gap-2">
                    <button onClick={() => setRBox(false)}
                      className="flex-1 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">
                      إلغاء
                    </button>
                    <button onClick={() => rejectMut.mutate()}
                      disabled={rejectMut.isPending}
                      className="flex-1 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-bold text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2">
                      <XCircle size={14} />
                      تأكيد الرفض
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Read-only banner for non-super-admins */}
          {!isSuperAdmin && row.approval_status === 'pending' && (
            <div className="border-t pt-4">
              <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
                <AlertCircle size={14} className="flex-shrink-0" />
                <span>الموافقة/الرفض متاح للمدير العام فقط — في انتظار قراره.</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Cleanup False Positives button ──────────────────────────────────────────
// Excel imports occasionally produce 1-minute time-column jitter (e.g.
// "18:00:00" → "18:01:00"). The old detection logic flagged those as
// reschedules; the new logic ignores them. This button retroactively
// deletes any existing rows that match the same pattern.
function CleanupFalsePositivesButton({ onDone }) {
  const cleanupMut = useMutation({
    mutationFn: () => api.post('/reschedules/cleanup-false-positives').then(r => r.data),
    onSuccess: (res) => {
      alert(res.message || `تم حذف ${res.deleted} false positive.`);
      onDone();
    },
    onError: (err) => alert(err.response?.data?.error || err.message),
  });

  return (
    <button
      onClick={() => {
        if (confirm(
          'هحذف الـ rows اللى:\n' +
          '• نفس اليوم + فرق وقت أقل من 30 دقيقة (Excel jitter)\n' +
          '• المحاضرة اتحركت لتاريخ سابق (مش reschedule حقيقي)\n\n' +
          'متأكد؟'
        )) {
          cleanupMut.mutate();
        }
      }}
      disabled={cleanupMut.isPending}
      className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold flex items-center gap-1.5 disabled:opacity-50">
      <Trash2 size={14} />
      {cleanupMut.isPending ? 'جاري...' : 'مسح False Positives'}
    </button>
  );
}
