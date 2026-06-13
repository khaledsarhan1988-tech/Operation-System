import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, CheckCircle2, XCircle, Clock, AlertCircle, Search,
  RefreshCw, FileText, X, Send, Sparkles, ScanSearch, Database, Trash2,
  FileCheck2, ShieldAlert, Cloud, History, ArrowRight, MapPin,
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
  const [openKey, setOpenKey] = useState(null);
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
  const openRow = openKey ? rows.find(r => r.group_key === openKey) : null;

  return (
    <div className="space-y-5">
      <PageHero
        title="إعادة جدولة المحاضرات"
        subtitle="سجل كامل بكل المحاضرات اللى اتغير ميعادها — مع اعتماد المدير ومتابعة الإجازات الرسمية"
        icon={CalendarClock}
        gradient="from-indigo-500 to-purple-600"
      />

      {/* Data source policy banner — establishes that ALL rows below are
          Drive-sourced. Live DB detection was removed by design. */}
      <div className="bg-gradient-to-r from-emerald-50 to-cyan-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-3">
        <div className="bg-emerald-500 text-white rounded-lg p-2 flex-shrink-0">
          <Cloud size={16} />
        </div>
        <div className="flex-1 text-xs leading-relaxed">
          <p className="font-bold text-emerald-900 mb-0.5">
            مصدر البيانات: Google Drive فقط
          </p>
          <p className="text-emerald-800">
            كل سجل في الجدول جاي من مقارنة ملفات Excel الفعلية المخزنة على Drive (يوم D vs يوم D+1).
            الكشف اللحظي من قاعدة البيانات اتعطّل ومش بيكتب سجلات جديدة.
            لو حابب تعيد مراجعة الانتظار من الصفر، استخدم زر <b>"مسح سجلات الانتظار"</b> ثم <b>"الفحص الحقيقي من Drive"</b>
            — السجلات المعتمدة والمرفوضة هتفضل محفوظة.
          </p>
        </div>
      </div>

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
            <WipePendingButton
              pendingCount={counts.pending || 0}
              preservedCount={(counts.approved || 0) + (counts.rejected || 0) + (counts.auto || 0)}
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
                  <tr key={r.group_key} className="border-t border-gray-100 hover:bg-indigo-50/30 cursor-pointer"
                      onClick={() => setOpenKey(r.group_key)}>
                    <td className="px-3 py-2.5 font-semibold text-gray-800">
                      <div className="flex items-center gap-1.5">
                        <span>{r.group_name}</span>
                        {/* Multi-pair badge — signals this chain has more than
                            one reschedule pair folded together. Click row to
                            see all pairs in the timeline. */}
                        {r.pair_count > 1 && (
                          <span className="text-[10px] bg-purple-100 text-purple-700 border border-purple-200 rounded-full px-1.5 py-0.5 font-bold"
                                title={`${r.pair_count} عمليات إعادة جدولة متتابعة`}>
                            ×{r.pair_count}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border
                        ${r.session_type === 'main' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200'}`}>
                        {r.session_type === 'main' ? 'أساسية' : 'زووم'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.trainer_changed ? (
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
          onClose={() => setOpenKey(null)}
          onChanged={() => { qc.invalidateQueries({ queryKey: ['reschedules'] }); }}
        />
      )}
      {showDiagnostic && (
        <DiagnosticModal
          initialFrom={from}
          initialTo={to}
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
function DiagnosticModal({ initialFrom, initialTo, onClose, onBackfilled }) {
  // Pre-fill from the parent page's filter bar (so the admin doesn't have
  // to re-type dates they already entered). Empty defaults fall back to
  // backend's "last 30 days" window.
  const [from, setFrom] = useState(initialFrom || '');
  const [to, setTo]     = useState(initialTo   || '');
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

  // TRUE Drive-based backfill: compares the first file that has data in the
  // range with the last (the empty holiday days between are skipped) and diffs
  // the full schedule. It reads only the two boundary files, so the whole range
  // goes in ONE fast request — no chunking, no timeout, no Network Error.
  const driveBackfillMut = useMutation({
    mutationFn: () => api
      .post('/reschedules/backfill-from-drive', { from, to }, { timeout: 180000 })
      .then(r => ({ ...r.data, fromDrive: true })),
    onSuccess: (res) => { setResult(res); onBackfilled(); refetch(); },
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
          {/* Date range — pre-filled from the parent page's filter bar.
              Empty fields fall back to backend default (last 30 days). */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">
                من تاريخ {!from && <span className="text-gray-400 font-normal">(افتراضي: آخر 30 يوم)</span>}
              </label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">
                إلى تاريخ {!to && <span className="text-gray-400 font-normal">(افتراضي: النهاردة)</span>}
              </label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
            </div>
          </div>
          {(from || to) && (
            <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-1">
              ✓ التاريخ اتنقل تلقائياً من فلتر الصفحة. تقدر تعدّله لو حبيت.
            </p>
          )}

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
                          السيستم بيقارن <b>أول ملف فيه بيانات</b> في الفترة بـ <b>آخر ملف فيه بيانات</b>
                          (بيتخطّى أيام الإجازة الفاضية اللى بينهم)، ويقارن جدول كل مجموعة بالكامل. أي
                          محاضرة اتأجّلت لتاريخ بعدين = reschedule <b>حقيقي</b>.
                          <br />
                          <span className="text-emerald-700 font-semibold">✓ المحاضرات اللى تاريخها الأصلي جوه إجازة رسمية بتتجاهل تلقائياً.</span>
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

              {/* Error feedback — without this the page stays silent when the
                  Drive scan times out (60s) or the server errors, which looks
                  like "nothing happened". Surface the real reason instead. */}
              {(driveBackfillMut.isError || backfillMut.isError) && (() => {
                const err = driveBackfillMut.error || backfillMut.error;
                const isTimeout = err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '');
                const serverMsg = err?.response?.data?.error;
                return (
                  <div className="bg-rose-50 border-2 border-rose-300 rounded-xl p-4 text-sm">
                    <p className="font-bold text-rose-900 mb-1 flex items-center gap-2">
                      <ShieldAlert size={16} /> فشل الفحص
                    </p>
                    {isTimeout ? (
                      <p className="text-rose-700 leading-relaxed">
                        الطلب أخد وقت أطول من المسموح فاتلغى. جرّب فترة أصغر أو حاول تاني.
                      </p>
                    ) : (
                      <p className="text-rose-700 leading-relaxed">
                        {serverMsg || err?.message || 'حصل خطأ غير متوقع أثناء الفحص. راجع لوج السيرفر.'}
                      </p>
                    )}
                  </div>
                );
              })()}

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
                  {result.summary?.skipped_holiday > 0 && (
                    <p className="text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded px-2 py-1 mt-2">
                      🗓 اتجاهل {result.summary.skipped_holiday} محاضرة تاريخها الأصلي جوه إجازة رسمية (تأجيل متوقّع).
                    </p>
                  )}
                  {result.summary?.compared?.length > 0 && (
                    <div className="text-[11px] text-gray-500 mt-2">
                      اتقارن: {result.summary.compared.map((c, i) => (
                        <span key={i} className="inline-block mx-1">
                          {c.line}/{c.session_type === 'main' ? 'محاضرات' : 'زوم'} ({c.before} → {c.after})
                        </span>
                      ))}
                    </div>
                  )}
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

  // Smart targeting — only act on the pairs that still need a decision.
  // This protects past approvals/rejections from being silently overwritten
  // when a NEW reschedule joins an already-decided chain. Falls back to
  // all pair_ids only if there are no pending ones (degenerate case).
  const pendingIds = row.pending_pair_ids?.length ? row.pending_pair_ids : row.pair_ids;
  const approveMut = useMutation({
    mutationFn: () => api.patch(`/reschedules/group/approve`, { pair_ids: pendingIds }),
    onSuccess: () => { onChanged(); onClose(); },
  });
  const rejectMut = useMutation({
    mutationFn: () => api.patch(`/reschedules/group/reject`, { pair_ids: pendingIds, reason: rejectReason }),
    onSuccess: () => { onChanged(); onClose(); },
  });
  // Notes still target every pair in the chain — they're descriptive
  // context, not a decision. Old notes remain accessible via approved_summary.
  const notesMut = useMutation({
    mutationFn: () => api.patch(`/reschedules/group/notes`, { pair_ids: row.pair_ids, notes }),
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
              {row.pair_count > 1 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-100 text-purple-700 border border-purple-200"
                      title="عدد عمليات إعادة الجدولة المتتابعة في هذه السلسلة">
                  ×{row.pair_count} نقل
                </span>
              )}
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

          {/* Decision-state breakdown — only meaningful when the chain has
              more than one pair AND at least two different statuses (e.g.
              some pairs approved + a newer pair pending). Shows the user
              "here's what you already decided, here's what's new." */}
          {row.pair_count > 1 && (row.approved_summary || row.rejected_summary || row.auto_summary) && row.pending_summary && (
            <div className="grid grid-cols-1 gap-2">
              {row.approved_summary && (
                <DecisionBanner
                  kind="approved"
                  summary={row.approved_summary}
                />
              )}
              {row.rejected_summary && (
                <DecisionBanner
                  kind="rejected"
                  summary={row.rejected_summary}
                />
              )}
              {row.auto_summary && (
                <DecisionBanner
                  kind="auto"
                  summary={row.auto_summary}
                />
              )}
              {row.pending_summary && (
                <DecisionBanner
                  kind="pending"
                  summary={row.pending_summary}
                />
              )}
            </div>
          )}

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

          {/* Full chronological story — every reschedule for this group
              across the full alias chain. Tells the user "this group's
              lecture on X was cancelled, then Y was cancelled, then Z is
              currently scheduled with new name…" */}
          {isSuperAdmin && (
            <GroupTimelineSection group={row.group_name} line={row.line} />
          )}

          {/* Verify-source section — confirms the group still exists in the
              current synced Excel state (so the admin knows the row reflects
              real data, not a sync artifact). */}
          {isSuperAdmin && (
            <VerifySourceSection group={row.group_name} line={row.line} />
          )}

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
              <p className="text-xs font-bold text-gray-700 mb-2 flex items-center justify-between gap-2">
                <span>قرار المدير</span>
                {/* Tell the admin exactly what will be affected — important
                    when a chain has mixed statuses (old approved + new pending). */}
                {pendingIds.length < (row.pair_ids?.length || 0) && (
                  <span className="text-[10px] font-normal text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                    القرار هيطبق فقط على {pendingIds.length} نقل جديد — القرارات السابقة محفوظة
                  </span>
                )}
                {pendingIds.length === row.pair_ids?.length && row.pair_count > 1 && (
                  <span className="text-[10px] font-normal text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-0.5">
                    القرار هيطبق على {pendingIds.length} نقل
                  </span>
                )}
              </p>
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

// ─── Verify Source — confirms the group exists in current lectures table ────
// Lazy-loaded: the admin clicks "تحقق من المصدر" and only THEN does the
// fetch run. Avoids hammering the API for every modal open.
function VerifySourceSection({ group, line }) {
  const [show, setShow] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['verify-source', group, line],
    queryFn: () => api.get('/reschedules/verify-source', {
      params: { group, line },
    }).then(r => r.data),
    enabled: show,
  });

  if (!show) {
    return (
      <button onClick={() => setShow(true)}
        className="w-full px-3 py-2.5 rounded-xl border-2 border-dashed border-indigo-300 text-sm font-bold text-indigo-700 hover:bg-indigo-50 inline-flex items-center justify-center gap-2">
        <FileCheck2 size={14} />
        🔍 تحقق من البيانات في ملف Excel الحالي
      </button>
    );
  }

  if (isLoading) {
    return <div className="text-center text-xs text-gray-400 py-4">جاري الفحص...</div>;
  }
  if (!data) return null;

  const totalLectures   = data.lectures.count;
  const mainCount       = data.lectures.by_session_type.main || 0;
  const sideCount       = data.lectures.by_session_type.side || 0;
  const reschedCount    = data.reschedules.count;

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
          <FileCheck2 size={14} /> النتيجة من ملف Excel الحالي
        </p>
        <button onClick={() => setShow(false)} className="p-1 hover:bg-white rounded">
          <X size={12} className="text-gray-500" />
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-white rounded p-2 border border-gray-200">
          <p className="text-[10px] text-gray-500">إجمالي محاضرات</p>
          <p className="text-lg font-black text-indigo-700">{totalLectures}</p>
        </div>
        <div className="bg-white rounded p-2 border border-gray-200">
          <p className="text-[10px] text-blue-600">أساسية</p>
          <p className="text-lg font-black text-blue-700">{mainCount}</p>
        </div>
        <div className="bg-white rounded p-2 border border-gray-200">
          <p className="text-[10px] text-fuchsia-600">زوم</p>
          <p className="text-lg font-black text-fuchsia-700">{sideCount}</p>
        </div>
      </div>

      {/* Verdict */}
      {totalLectures === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
          ⚠ المجموعة <b>{group}</b> مش موجودة في ملف Excel الحالي ضمن آخر 30 يوم.
          ممكن تكون اتشالت من الملف بعد ما الـ reschedule اتسجل، أو الـ sync ما اتعملش.
        </div>
      ) : (
        <div className="bg-emerald-50 border border-emerald-200 rounded p-2 text-xs text-emerald-800">
          ✓ المجموعة موجودة في ملف Excel — <b>{totalLectures}</b> محاضرة في آخر 30 يوم.
          البيانات اللى الـ reschedule اتسجل عليها أصلية ومن المصدر.
        </div>
      )}

      {/* Lectures list */}
      {totalLectures > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-bold text-indigo-700">
            عرض كل محاضرات المجموعة ({totalLectures})
          </summary>
          <div className="mt-2 max-h-60 overflow-y-auto space-y-1">
            {data.lectures.rows.map(l => (
              <div key={l.id} className={`p-2 rounded border ${
                l.session_type === 'side'
                  ? 'bg-fuchsia-50 border-fuchsia-200'
                  : 'bg-blue-50 border-blue-200'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gray-800">{l.date}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white text-gray-600 border">
                    {l.session_type === 'main' ? 'أساسية' : 'زوم'}
                  </span>
                </div>
                <p className="text-gray-600 mt-0.5">
                  {l.time} · {l.duration} · {l.trainer}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Matching batches (sanity check that the group exists in batches table) */}
      {data.matches.count > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-bold text-indigo-700">
            الـ batches المطابقة ({data.matches.count})
          </summary>
          <div className="mt-2 space-y-1">
            {data.matches.rows.map((b, i) => (
              <div key={i} className="bg-white p-2 rounded border border-gray-200">
                <p className="font-bold text-gray-800">{b.group_name}</p>
                <p className="text-[10px] text-gray-500">
                  {b.line} · {b.status} · {b.dept_type} · أيام: {b.training_schedule || '—'}
                </p>
                {b.coordinators && (
                  <p className="text-[10px] text-gray-500">منسق: {b.coordinators}</p>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
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

// ─── Decision Banner — visual block per status sub-range of a chain ────────
// When a chain has mixed statuses (e.g. some pairs approved + a newer pair
// pending), each status gets its own banner so the admin can see at a
// glance: "approved up to X by Y on date Z with note W — pending Q from R".
function DecisionBanner({ kind, summary }) {
  if (!summary) return null;
  const VISUAL = {
    approved: {
      Icon: CheckCircle2,
      title: 'اعتماد سابق',
      borderCls: 'border-emerald-300',
      bgCls: 'bg-emerald-50',
      iconCls: 'text-emerald-600',
      titleCls: 'text-emerald-900',
      textCls: 'text-emerald-800',
      subTextCls: 'text-emerald-700',
      noteBgCls: 'bg-white/70 border-emerald-200',
    },
    pending: {
      Icon: Clock,
      title: 'جديد في الانتظار',
      borderCls: 'border-amber-300',
      bgCls: 'bg-amber-50',
      iconCls: 'text-amber-600',
      titleCls: 'text-amber-900',
      textCls: 'text-amber-800',
      subTextCls: 'text-amber-700',
      noteBgCls: 'bg-white/70 border-amber-200',
    },
    rejected: {
      Icon: XCircle,
      title: 'تم الرفض',
      borderCls: 'border-red-300',
      bgCls: 'bg-red-50',
      iconCls: 'text-red-600',
      titleCls: 'text-red-900',
      textCls: 'text-red-800',
      subTextCls: 'text-red-700',
      noteBgCls: 'bg-white/70 border-red-200',
    },
    auto: {
      Icon: Sparkles,
      title: 'إجازة رسمية (تلقائي)',
      borderCls: 'border-sky-300',
      bgCls: 'bg-sky-50',
      iconCls: 'text-sky-600',
      titleCls: 'text-sky-900',
      textCls: 'text-sky-800',
      subTextCls: 'text-sky-700',
      noteBgCls: 'bg-white/70 border-sky-200',
    },
  };
  const v = VISUAL[kind] || VISUAL.pending;
  const Icon = v.Icon;

  return (
    <div className={`border-2 rounded-xl p-3 ${v.borderCls} ${v.bgCls}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={14} className={v.iconCls} />
        <p className={`font-bold text-xs ${v.titleCls}`}>
          {v.title} ({summary.count} نقل)
        </p>
      </div>
      <p className={`text-xs ${v.textCls}`}>
        من <b className="font-mono">{summary.first_old_date}</b>
        <span className="mx-1">←</span>
        إلى <b className="font-mono">{summary.last_new_date}</b>
      </p>
      {kind === 'approved' && summary.approver_name && (
        <p className={`text-[10px] mt-1 ${v.subTextCls}`}>
          القرار من <b>{summary.approver_name}</b>
          {summary.approved_at && (
            <span> بتاريخ {summary.approved_at.replace('T', ' ').slice(0, 16)}</span>
          )}
        </p>
      )}
      {kind === 'approved' && summary.note && (
        <p className={`text-[11px] mt-1.5 rounded p-1.5 border ${v.noteBgCls} ${v.textCls}`}>
          <FileText size={10} className="inline -mt-0.5 ml-1" />
          <b>ملاحظة الاعتماد:</b> {summary.note}
        </p>
      )}
      {kind === 'rejected' && summary.reason && (
        <p className={`text-[11px] mt-1.5 rounded p-1.5 border ${v.noteBgCls} ${v.textCls}`}>
          <b>سبب الرفض:</b> {summary.reason}
        </p>
      )}
      {kind === 'pending' && (
        <p className={`text-[10px] mt-1 ${v.subTextCls} italic`}>
          الموافقة/الرفض هتطبق فقط على الجزء ده — القرارات السابقة محفوظة.
        </p>
      )}
    </div>
  );
}

// ─── Group Timeline — full chronological story of one group ─────────────────
// Fetches /timeline for the group (which chases group_renames so all aliases
// are merged). Shows: summary card (date range + weekday breakdown +
// latest scheduled lecture), then chronological event list. Each event is
// either "cancelled (moved to X)" or "scheduled (moved from Y)".
function GroupTimelineSection({ group, line }) {
  const { data, isLoading } = useQuery({
    queryKey: ['timeline', group, line],
    queryFn: () => api.get('/reschedules/timeline', {
      params: { group, line },
    }).then(r => r.data),
  });

  if (isLoading) {
    return (
      <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-center text-xs text-purple-400">
        جاري بناء القصة الكاملة للمجموعة...
      </div>
    );
  }
  if (!data) return null;

  const {
    aliases = [],
    current_name = null,
    total_reschedules = 0,
    date_range,
    cancelled_by_weekday = {},
    latest_scheduled,
    events = [],
  } = data;

  // Weekday breakdown summary text — "1 يوم الأحد بتاريخ 17 مايو، 1 يوم الأربعاء بتاريخ 20 مايو"
  const weekdayBreakdown = Object.values(cancelled_by_weekday);

  // ── Clean the event stream ────────────────────────────────────────────────
  // When a date appears as a "rescheduled-to" target AND later gets cancelled
  // itself (e.g. 20/05 was the destination of 17→20, but then 20→24 happened),
  // the "rescheduled" event for 20/05 is redundant noise — the user only
  // cares that 20/05 got cancelled. Hide it.
  const cancelledDates = new Set(
    events.filter(e => e.kind === 'cancelled').map(e => `${e.date}|${e.session_type}`)
  );
  const visibleEvents = events.filter(ev => {
    if (ev.kind === 'rescheduled' && cancelledDates.has(`${ev.date}|${ev.session_type}`)) {
      return false;
    }
    return true;
  });

  // The "original trainer" for the chain — first cancelled event's trainer.
  // Used to flag the final destination when the chain ended with a different
  // trainer (gives the user the "trainer was changed" signal directly in
  // the narrative).
  const firstCancelledTrainer = events.find(e => e.kind === 'cancelled')?.trainer || '';

  return (
    <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border-2 border-purple-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="bg-purple-500 text-white rounded-lg p-1.5">
          <History size={14} />
        </div>
        <p className="text-sm font-bold text-purple-900">
          القصة الكاملة لإعادة جدولة المجموعة
        </p>
      </div>

      {/* Alias chain — if the group was renamed, show all known names */}
      {aliases.length > 1 && (
        <div className="bg-white border border-purple-200 rounded-lg p-2 text-xs">
          <p className="font-bold text-purple-700 mb-1">المجموعة معروفة بـ {aliases.length} أسماء:</p>
          <div className="space-y-1">
            {aliases.map((a, i) => {
              const isCurrent = current_name && a === current_name;
              return (
                <div key={i} className={`flex items-center gap-1.5 ${isCurrent ? 'bg-emerald-50 -mx-1 px-1 py-0.5 rounded' : ''}`}>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${isCurrent ? 'bg-emerald-200 text-emerald-800' : 'bg-purple-100 text-purple-700'}`}>
                    {i + 1}
                  </span>
                  <span className={`font-mono break-all ${isCurrent ? 'text-emerald-800 font-bold' : 'text-gray-700'}`}>{a}</span>
                  {isCurrent && (
                    <span className="text-[9px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap flex items-center gap-0.5">
                      ✓ الاسم الحالي
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white border border-purple-200 rounded-lg p-2.5 text-center">
          <p className="text-[10px] text-purple-600 font-bold uppercase mb-0.5">إجمالى إعادة الجدولة</p>
          <p className="text-2xl font-black text-purple-800">{total_reschedules}</p>
        </div>
        <div className="bg-white border border-purple-200 rounded-lg p-2.5 text-center">
          <p className="text-[10px] text-purple-600 font-bold uppercase mb-0.5">الفترة الإجمالية</p>
          <p className="text-xs font-black text-purple-800 leading-tight">
            {date_range ? (
              <>
                من <b>{date_range.from}</b>
                <br />
                إلى <b>{date_range.to}</b>
              </>
            ) : '—'}
          </p>
        </div>
      </div>

      {/* Weekday breakdown — "1 يوم الأحد، 1 يوم الأربعاء" */}
      {weekdayBreakdown.length > 0 && (
        <div className="bg-white border border-purple-200 rounded-lg p-3">
          <p className="text-xs font-bold text-purple-800 mb-2 flex items-center gap-1.5">
            <CalendarClock size={12} /> الأيام اللى اتلغت وتم نقلها:
          </p>
          <div className="space-y-1.5">
            {weekdayBreakdown.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="inline-flex items-center justify-center bg-red-100 text-red-700 rounded-full w-6 h-6 font-black text-[11px] flex-shrink-0">
                  {w.count}
                </span>
                <div className="flex-1">
                  <span className="font-bold text-gray-800">يوم {w.label_ar}</span>
                  <span className="text-gray-500 mr-1">·</span>
                  <span className="text-gray-600">
                    {w.dates.map((d, j) => (
                      <span key={j}>
                        {j > 0 && '، '}
                        <span className="font-mono text-red-700">{d}</span>
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Latest scheduled — the "current destination" */}
      {latest_scheduled && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-3">
          <p className="text-xs font-bold text-emerald-800 mb-1 flex items-center gap-1.5">
            <MapPin size={12} /> آخر محاضرة مجدولة (الحالة الحالية):
          </p>
          <div className="flex items-center justify-between gap-2 text-xs">
            <div>
              <p className="font-black text-emerald-900 text-base">{latest_scheduled.date}</p>
              <p className="text-emerald-700">
                <Clock size={10} className="inline -mt-0.5" /> {latest_scheduled.time || '—'}
                · {latest_scheduled.trainer || '—'}
              </p>
            </div>
            <span className={`text-[10px] px-2 py-1 rounded-full font-bold border
              ${latest_scheduled.status === 'مؤكدة'
                ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                : 'bg-amber-100 text-amber-700 border-amber-300'}`}>
              {latest_scheduled.status || 'مجدولة'}
            </span>
          </div>
          {latest_scheduled.group_name !== group && (
            <p className="text-[10px] text-purple-700 mt-1.5 italic">
              ⚠ الاسم الحالي مختلف: <span className="font-mono break-all">{latest_scheduled.group_name}</span>
            </p>
          )}
        </div>
      )}

      {/* Chronological event timeline — uses the cleaned set so the user
          doesn't see "20/05 was scheduled" right before "20/05 was cancelled"
          on the very next line. */}
      {visibleEvents.length > 0 && (
        <details className="bg-white border border-purple-200 rounded-lg" open={visibleEvents.length <= 6}>
          <summary className="cursor-pointer p-2.5 text-xs font-bold text-purple-800 flex items-center gap-1.5">
            <History size={12} /> سرد القصة بالتواريخ ({visibleEvents.length} حدث)
          </summary>
          <div className="border-t border-purple-100 p-2 space-y-1.5 max-h-80 overflow-y-auto">
            {visibleEvents.map((ev, i) => (
              <TimelineEvent
                key={i}
                ev={ev}
                firstCancelledTrainer={firstCancelledTrainer}
              />
            ))}
          </div>
        </details>
      )}

      {visibleEvents.length === 0 && (
        <p className="text-xs text-purple-500 text-center py-2">
          لا توجد أحداث إعادة جدولة لهذه المجموعة في السجلات.
        </p>
      )}
    </div>
  );
}

// Tiny visual badge that classifies a timeline event's decision state.
// Renders inline next to the date so the user can scan the chain and
// immediately see which parts are decided vs still need a call.
function ApprovalStatusPill({ status }) {
  const MAP = {
    approved: { Icon: CheckCircle2, label: 'معتمد',     cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
    rejected: { Icon: XCircle,      label: 'مرفوض',     cls: 'bg-red-100 text-red-700 border-red-300' },
    pending:  { Icon: Clock,        label: 'في الانتظار', cls: 'bg-amber-100 text-amber-700 border-amber-300' },
    auto:     { Icon: Sparkles,     label: 'تلقائي',    cls: 'bg-sky-100 text-sky-700 border-sky-300' },
  };
  const m = MAP[status] || MAP.pending;
  const Icon = m.Icon;
  return (
    <span className={`text-[9px] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full font-bold border ${m.cls}`}
          title={m.label}>
      <Icon size={9} /> {m.label}
    </span>
  );
}

// One row in the timeline. Two flavors: cancelled vs rescheduled. The
// rescheduled flavor compares its trainer to firstCancelledTrainer so the
// chain's "final destination" shows a clear "trainer was changed" badge
// when the chain ended with a different trainer than it started with.
function TimelineEvent({ ev, firstCancelledTrainer = '' }) {
  if (ev.kind === 'cancelled') {
    return (
      <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded p-2">
        <div className="bg-red-500 text-white rounded p-1 flex-shrink-0">
          <XCircle size={12} />
        </div>
        <div className="flex-1 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-red-800">{ev.date}</span>
            <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">
              {ev.weekday?.ar}
            </span>
            <span className="text-red-700">{ev.time || ''}</span>
            <span className="text-red-600">— محاضرة اتلغت</span>
            <ApprovalStatusPill status={ev.approval_status} />
          </div>
          <p className="text-[11px] text-red-700 mt-0.5">
            المدرب: <b>{ev.trainer || '—'}</b>
            {ev.moved_to && (
              <span className="text-gray-600 mr-1">
                <ArrowRight size={10} className="inline -mt-0.5 mx-1" />
                نُقلت إلى <b className="text-emerald-700">{ev.moved_to}</b>
                {ev.moved_to_time && <span className="text-gray-500"> · {ev.moved_to_time}</span>}
              </span>
            )}
          </p>
          {/* Coordinator who was responsible AT THE TIME of cancellation,
              resolved from coordinator_history. Multiple coords possible
              when a group has parallel co-coordinators. */}
          {ev.coordinators_at_time?.length > 0 && (
            <p className="text-[11px] text-gray-600 mt-0.5">
              المنسق وقت الإلغاء: <b className="text-gray-800">{ev.coordinators_at_time.join('، ')}</b>
            </p>
          )}
          {ev.reason === 'official_holiday' && (
            <p className="text-[10px] text-sky-700 mt-0.5">
              <Sparkles size={9} className="inline" /> سبب: إجازة رسمية (تم اعتمادها تلقائياً)
            </p>
          )}
        </div>
      </div>
    );
  }

  // rescheduled (new side of a pair) — only renders if the date was NOT
  // later cancelled (filtered upstream), so this is always a "final
  // destination" in its date-line.
  const trainerChanged =
    firstCancelledTrainer &&
    ev.trainer &&
    firstCancelledTrainer.trim() !== ev.trainer.trim();

  return (
    <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded p-2">
      <div className="bg-emerald-500 text-white rounded p-1 flex-shrink-0">
        <CheckCircle2 size={12} />
      </div>
      <div className="flex-1 text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-emerald-800">{ev.date}</span>
          <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">
            {ev.weekday?.ar}
          </span>
          <span className="text-emerald-700">{ev.time || ''}</span>
          <span className="text-emerald-600">— محاضرة مجدولة بدلاً منها</span>
          <ApprovalStatusPill status={ev.approval_status} />
          {/* Trainer-changed badge — explicit signal that the chain
              ended with a different trainer than it started with. */}
          {trainerChanged && (
            <span className="text-[10px] bg-amber-100 text-amber-800 border border-amber-300 rounded-full px-2 py-0.5 font-bold inline-flex items-center gap-1">
              ⚠ تم تغيير المدرب
            </span>
          )}
        </div>
        <p className="text-[11px] text-emerald-700 mt-0.5">
          المدرب: <b>{ev.trainer || '—'}</b>
          {trainerChanged && (
            <span className="text-amber-700 mr-1">
              (كان: <b>{firstCancelledTrainer}</b>)
            </span>
          )}
          {ev.moved_from && (
            <span className="text-gray-600 mr-1">
              · بديلاً عن <b className="text-red-700">{ev.moved_from}</b>
            </span>
          )}
        </p>
        {/* Coordinator(s) responsible at the time of the new schedule */}
        {ev.coordinators_at_time?.length > 0 && (
          <p className="text-[11px] text-gray-600 mt-0.5">
            المنسق وقت الجدولة: <b className="text-gray-800">{ev.coordinators_at_time.join('، ')}</b>
          </p>
        )}
        {ev.name_changed && ev.current_name && (
          <p className="text-[10px] text-purple-700 mt-0.5 italic">
            الاسم الحالي: <span className="font-mono break-all">{ev.current_name}</span>
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Wipe PENDING-only Reschedules button ────────────────────────────────────
// Targeted reset for the "في الانتظار" tab. Approved / rejected / auto rows
// are PRESERVED — the past decision trail is never touched. After the wipe,
// the admin runs "الفحص الحقيقي من Drive" to surface the latest fresh set
// of pending reschedules for review. Double-confirm guards against typos.
function WipePendingButton({ pendingCount, preservedCount, onDone }) {
  const wipeMut = useMutation({
    mutationFn: () => api.post('/reschedules/wipe-pending', { confirm: true }).then(r => r.data),
    onSuccess: (res) => {
      alert(res.message || `تم مسح ${res.deleted} سجل في الانتظار.`);
      onDone();
    },
    onError: (err) => alert(err.response?.data?.error || err.message),
  });

  // Disabled when nothing pending — avoids confusing the admin
  const disabled = wipeMut.isPending || pendingCount === 0;

  return (
    <button
      onClick={() => {
        const c1 = confirm(
          `⚠ هتمسح ${pendingCount} سجل من تاب "في الانتظار" فقط.\n\n` +
          `✓ آمن: ${preservedCount} سجل (معتمد / مرفوض / إجازة) هتفضل محفوظة بدون تأثير.\n\n` +
          'الهدف: تبدأ من جديد لمراجعة تأجيلات جديدة من Drive.\n\n' +
          'العملية دي لا يمكن التراجع عنها للسجلات المنتظرة. متأكد؟'
        );
        if (!c1) return;
        const c2 = prompt('اكتب كلمة "مسح" للتأكيد النهائي:');
        if (c2 === 'مسح') wipeMut.mutate();
        else if (c2 !== null) alert('تم الإلغاء — النص اللى كتبته مش مطابق.');
      }}
      disabled={disabled}
      title={pendingCount === 0
        ? 'مفيش سجلات في الانتظار للمسح'
        : `مسح ${pendingCount} سجل في الانتظار فقط — السجلات المعتمدة والمرفوضة محفوظة`}
      className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-bold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
      <ShieldAlert size={14} />
      {wipeMut.isPending ? 'جاري المسح...' : `مسح سجلات الانتظار (${pendingCount})`}
    </button>
  );
}
