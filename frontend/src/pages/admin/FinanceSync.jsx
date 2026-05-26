import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Wallet, RefreshCw, Play, AlertTriangle, CheckCircle, XCircle,
  Database, Clock, Activity, History, Download,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import ModernButton from '../../components/ui/ModernButton';

/**
 * Admin → Finance Sync (Phase 1)
 *
 * Read-only window into the Finance Transactions API mirror sync. Lets the
 * super-admin watch the polling loop, fire a manual incremental, run a
 * date-range backfill, and trigger reconciliation.
 *
 * This page does NOT show the transactions themselves yet — Phase 5 of the
 * roadmap covers reports/dashboards. Phase 1 is observability only.
 */

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('ar-EG', { hour12: false });
}

function fmtNumber(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('ar-EG');
}

// Maps mode → display label
const MODE_LABEL = {
  incremental:    'مزامنة فورية',
  backfill:       'سحب كامل',
  reconciliation: 'مطابقة',
  manual:         'يدوي',
};
const STATUS_LABEL = {
  running:  'قيد التشغيل',
  success:  'نجح',
  error:    'فشل',
  partial:  'جزئي',
};
const STATUS_COLOR = {
  running:  'bg-blue-100 text-blue-700 border-blue-300',
  success:  'bg-emerald-100 text-emerald-700 border-emerald-300',
  error:    'bg-rose-100 text-rose-700 border-rose-300',
  partial:  'bg-amber-100 text-amber-700 border-amber-300',
};

// ─── STAT TILE ────────────────────────────────────────────────────────────────
function StatTile({ label, value, icon: Icon, color = 'blue' }) {
  const palettes = {
    blue:    'from-blue-50 to-blue-100 text-blue-900 border-blue-200',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-900 border-emerald-200',
    amber:   'from-amber-50 to-amber-100 text-amber-900 border-amber-200',
    rose:    'from-rose-50 to-rose-100 text-rose-900 border-rose-200',
    purple:  'from-purple-50 to-purple-100 text-purple-900 border-purple-200',
    gray:    'from-gray-50 to-gray-100 text-gray-900 border-gray-200',
  };
  return (
    <div className={`bg-gradient-to-br ${palettes[color]} border-2 rounded-2xl p-4 flex items-center gap-3`}>
      {Icon && <Icon size={28} className="flex-shrink-0 opacity-80" />}
      <div className="min-w-0">
        <p className="text-xs font-bold opacity-70">{label}</p>
        <p className="text-2xl font-black tabular-nums">{value}</p>
      </div>
    </div>
  );
}

// ─── CONNECTION BANNER ────────────────────────────────────────────────────────
function StatusBanner({ data, isLoading, isError, error }) {
  if (isLoading) {
    return (
      <div className="bg-gray-50 border-2 border-gray-200 rounded-2xl p-4 flex items-center gap-3">
        <RefreshCw className="w-5 h-5 text-gray-400 animate-spin" />
        <span className="text-sm font-bold text-gray-600">جارٍ التحقق من حالة المزامنة...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-4 flex items-start gap-3">
        <XCircle className="w-6 h-6 text-rose-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-black text-rose-900">فشل الاتصال بـ API الداخلي</p>
          <p className="text-xs text-rose-700 mt-1">{error?.response?.data?.error || error?.message}</p>
        </div>
      </div>
    );
  }

  if (!data?.configured) {
    return (
      <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex items-start gap-3">
        <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-black text-amber-900">
            CENTER_APP_API_KEY غير مضبوط — المزامنة معطّلة
          </p>
          <p className="text-xs text-amber-800 mt-1">
            اضبط متغير البيئة <code className="bg-amber-100 px-1 rounded">CENTER_APP_API_KEY</code> فى Railway
            وأعد التشغيل لتفعيل المزامنة. حتى ذلك الحين الكود جاهز لكنه لا يستدعى أى endpoint خارجى.
          </p>
        </div>
      </div>
    );
  }

  const state = data.state || {};
  const errors = state.consecutive_errors || 0;
  const ok = !state.last_error && errors === 0;

  return (
    <div className={`border-2 rounded-2xl p-4 flex items-start gap-3 ${ok
      ? 'bg-emerald-50 border-emerald-300'
      : 'bg-rose-50 border-rose-300'
    }`}>
      {ok
        ? <CheckCircle className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
        : <XCircle className="w-6 h-6 text-rose-600 flex-shrink-0 mt-0.5" />}
      <div className="flex-1">
        <p className={`text-sm font-black ${ok ? 'text-emerald-900' : 'text-rose-900'}`}>
          {ok ? 'المزامنة شغّالة' : `آخر مزامنة فشلت — ${errors} محاولة فاشلة متتالية`}
        </p>
        <p className={`text-xs mt-1 ${ok ? 'text-emerald-700' : 'text-rose-700'}`}>
          آخر نجاح: <span className="font-bold">{fmtTime(state.last_success_at)}</span>
          {state.last_poll_at ? <> · آخر poll: <span className="font-bold">{fmtTime(state.last_poll_at)}</span></> : null}
        </p>
        {state.last_error ? (
          <p className="text-xs text-rose-700 mt-1 font-mono bg-rose-100 p-2 rounded">{state.last_error}</p>
        ) : null}
      </div>
      {data.running ? (
        <span className="text-xs font-bold px-2 py-1 bg-blue-100 text-blue-700 border border-blue-300 rounded-full">
          <RefreshCw className="w-3 h-3 inline animate-spin mr-1" />
          نشط
        </span>
      ) : null}
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function FinanceSync() {
  const qc = useQueryClient();

  // Auto-refresh every 5s — page is for live observability.
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['finance', 'sync-status'],
    queryFn: () => api.get('/finance/sync/status').then(r => r.data),
    refetchInterval: 5_000,
    staleTime: 0,
  });

  const triggerMut = useMutation({
    mutationFn: () => api.post('/finance/sync/trigger').then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance', 'sync-status'] }),
  });

  const reconcileMut = useMutation({
    mutationFn: (windowDays) => api.post('/finance/sync/reconcile', { windowDays }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance', 'sync-status'] }),
  });

  const backfillMut = useMutation({
    mutationFn: (body) => api.post('/finance/sync/backfill', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance', 'sync-status'] }),
  });

  const [backfillFrom, setBackfillFrom] = useState('');
  const [backfillTo, setBackfillTo] = useState('');
  const [backfillReset, setBackfillReset] = useState(false);

  const state = data?.state || {};
  const counts = data?.counts || {};
  const logs = data?.recent_logs || [];

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="مزامنة Center App"
        subtitle="تتبّع المعاملات المالية القادمة من نظام Center App بشكل فورى"
        icon={Wallet}
        gradient="emerald"
        actions={
          <ModernButton variant="glass" icon={RefreshCw} onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'جارى...' : 'تحديث'}
          </ModernButton>
        }
      />

      <StatusBanner data={data} isLoading={isLoading} isError={isError} error={error} />

      {/* Counts grid */}
      {data?.configured ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatTile label="إجمالى المعاملات" value={fmtNumber(counts.total_transactions)} icon={Database} color="blue" />
          <StatTile label="قيد المراجعة"     value={fmtNumber(counts.pending)}            icon={Clock}    color="amber" />
          <StatTile label="معتمدة"          value={fmtNumber(counts.approved)}           icon={CheckCircle} color="emerald" />
          <StatTile label="مدفوعة"          value={fmtNumber(counts.paid)}               icon={Wallet}   color="emerald" />
          <StatTile label="مرفوضة"          value={fmtNumber(counts.rejected)}           icon={XCircle}  color="rose" />
          <StatTile label="أقساط"           value={fmtNumber(counts.total_installments)} icon={Activity} color="purple" />
        </div>
      ) : null}

      {/* Sync state details */}
      {data?.configured ? (
        <SectionCard title="حالة المزامنة" icon={Activity}>
          <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="font-bold text-gray-500">المؤشر الحالى (cursor)</dt>
              <dd className="font-mono text-xs bg-gray-50 p-2 rounded mt-1 break-all">{state.cursor || '— (لم يبدأ بعد)'}</dd>
            </div>
            <div>
              <dt className="font-bold text-gray-500">آخر poll</dt>
              <dd className="mt-1">{fmtTime(state.last_poll_at)}</dd>
            </div>
            <div>
              <dt className="font-bold text-gray-500">آخر نجاح</dt>
              <dd className="mt-1">{fmtTime(state.last_success_at)}</dd>
            </div>
            <div>
              <dt className="font-bold text-gray-500">إجمالى المتزامن</dt>
              <dd className="mt-1 font-bold text-emerald-700">{fmtNumber(state.total_synced)}</dd>
            </div>
            <div>
              <dt className="font-bold text-gray-500">أخطاء متتالية</dt>
              <dd className={`mt-1 font-bold ${state.consecutive_errors ? 'text-rose-700' : 'text-emerald-700'}`}>
                {fmtNumber(state.consecutive_errors)}
              </dd>
            </div>
            <div>
              <dt className="font-bold text-gray-500">الـ backfill</dt>
              <dd className="mt-1">
                {state.backfill_completed
                  ? <span className="text-emerald-700 font-bold">مكتمل · {fmtTime(state.backfill_finished_at)}</span>
                  : state.backfill_started_at
                    ? <span className="text-amber-700 font-bold">جارى منذ {fmtTime(state.backfill_started_at)}</span>
                    : <span className="text-gray-500">لم يبدأ</span>}
              </dd>
            </div>
          </dl>
        </SectionCard>
      ) : null}

      {/* Manual controls */}
      {data?.configured ? (
        <SectionCard title="تحكم يدوى" icon={Play}>
          <div className="space-y-4">
            {/* Quick actions */}
            <div className="flex flex-wrap gap-2">
              <ModernButton
                variant="primary"
                icon={Play}
                onClick={() => triggerMut.mutate()}
                disabled={triggerMut.isPending || data.running}
              >
                {triggerMut.isPending ? 'جارى المزامنة...' : 'تشغيل مزامنة فورية الآن'}
              </ModernButton>
              <ModernButton
                variant="glass"
                icon={History}
                onClick={() => reconcileMut.mutate(90)}
                disabled={reconcileMut.isPending || data.running}
              >
                {reconcileMut.isPending ? 'جارى المطابقة...' : 'مطابقة آخر 90 يوماً'}
              </ModernButton>
            </div>

            {/* Trigger result */}
            {triggerMut.data ? (
              <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-2 font-mono">
                ✅ {JSON.stringify(triggerMut.data)}
              </div>
            ) : null}
            {triggerMut.isError ? (
              <div className="text-xs bg-rose-50 border border-rose-200 rounded-lg p-2 font-mono text-rose-700">
                ❌ {triggerMut.error?.response?.data?.error || triggerMut.error?.message}
              </div>
            ) : null}
            {reconcileMut.data ? (
              <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-2 font-mono">
                ✅ {JSON.stringify(reconcileMut.data)}
              </div>
            ) : null}

            {/* Backfill form */}
            <div className="border-t pt-4">
              <h4 className="font-black text-sm mb-2 flex items-center gap-2">
                <Download size={16} /> سحب كامل لنطاق تاريخى
              </h4>
              <p className="text-xs text-gray-500 mb-3">
                اتركهما فارغين لسحب كل التاريخ المتاح. (مرة واحدة عند البداية فقط؛ ثم المزامنة الفورية تتولى الأمر).
              </p>
              <div className="flex flex-wrap gap-2 items-end">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">من تاريخ</label>
                  <input
                    type="date"
                    value={backfillFrom}
                    onChange={e => setBackfillFrom(e.target.value)}
                    className="text-sm border-2 border-gray-200 rounded-lg px-3 py-2 focus:border-emerald-400 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">إلى تاريخ</label>
                  <input
                    type="date"
                    value={backfillTo}
                    onChange={e => setBackfillTo(e.target.value)}
                    className="text-sm border-2 border-gray-200 rounded-lg px-3 py-2 focus:border-emerald-400 outline-none"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs font-bold text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={backfillReset}
                    onChange={e => setBackfillReset(e.target.checked)}
                    className="w-4 h-4"
                  />
                  إعادة ضبط المؤشر (إعادة سحب كاملة)
                </label>
                <ModernButton
                  variant="primary"
                  icon={Download}
                  onClick={() => backfillMut.mutate({
                    from: backfillFrom || undefined,
                    to: backfillTo || undefined,
                    reset: backfillReset,
                  })}
                  disabled={backfillMut.isPending || data.running}
                >
                  {backfillMut.isPending ? 'جارى السحب...' : 'بدء السحب'}
                </ModernButton>
              </div>
              {backfillMut.data ? (
                <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-2 font-mono mt-3">
                  ✅ {JSON.stringify(backfillMut.data)}
                </div>
              ) : null}
              {backfillMut.isError ? (
                <div className="text-xs bg-rose-50 border border-rose-200 rounded-lg p-2 font-mono text-rose-700 mt-3">
                  ❌ {backfillMut.error?.response?.data?.error || backfillMut.error?.message}
                </div>
              ) : null}
            </div>
          </div>
        </SectionCard>
      ) : null}

      {/* Recent activity log */}
      {data?.configured && logs.length > 0 ? (
        <SectionCard title="آخر 20 عملية مزامنة" icon={History}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs font-black text-gray-600">
                <tr>
                  <th className="p-2 text-right">البدء</th>
                  <th className="p-2 text-right">النوع</th>
                  <th className="p-2 text-right">الحالة</th>
                  <th className="p-2 text-right">صفحات</th>
                  <th className="p-2 text-right">جلب</th>
                  <th className="p-2 text-right">إدراج</th>
                  <th className="p-2 text-right">تحديث</th>
                  <th className="p-2 text-right">آخرى</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id} className="border-t hover:bg-gray-50">
                    <td className="p-2 whitespace-nowrap font-mono text-xs">{fmtTime(l.started_at)}</td>
                    <td className="p-2 whitespace-nowrap font-bold">{MODE_LABEL[l.mode] || l.mode}</td>
                    <td className="p-2 whitespace-nowrap">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${STATUS_COLOR[l.status] || 'bg-gray-100 text-gray-700 border-gray-300'}`}>
                        {STATUS_LABEL[l.status] || l.status}
                      </span>
                    </td>
                    <td className="p-2 tabular-nums">{fmtNumber(l.pages_fetched)}</td>
                    <td className="p-2 tabular-nums">{fmtNumber(l.rows_fetched)}</td>
                    <td className="p-2 tabular-nums text-emerald-700 font-bold">{fmtNumber(l.rows_inserted)}</td>
                    <td className="p-2 tabular-nums text-blue-700 font-bold">{fmtNumber(l.rows_updated)}</td>
                    <td className="p-2 text-xs text-gray-600">
                      {l.error ? (
                        <span title={l.error} className="text-rose-700 font-mono">⚠️ {l.error.slice(0, 60)}{l.error.length > 60 ? '…' : ''}</span>
                      ) : l.triggered_by ? (
                        <span className="text-gray-500">{l.triggered_by}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
