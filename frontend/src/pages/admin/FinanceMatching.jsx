import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Link as LinkIcon, RefreshCw, Search, Check, X, Users, AlertCircle,
  CheckCircle2, HelpCircle, UserX, Play, Phone, Wallet,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import ModernButton from '../../components/ui/ModernButton';

/**
 * Admin → Finance Matching (Phase 2)
 *
 * Resolves transactions arriving from Center App to academy clients. The
 * automatic matcher runs on every poll; this page is for inspecting results
 * and resolving ambiguous / unmatched cases manually.
 */

const STATE_TABS = [
  { key: 'ambiguous',     label: 'يحتاج مراجعة',  icon: HelpCircle,    color: 'amber'   },
  { key: 'unmatched',     label: 'غير مطابق',     icon: UserX,         color: 'rose'    },
  { key: 'matched',       label: 'مطابَق',         icon: CheckCircle2,  color: 'emerald' },
  { key: 'not_attempted', label: 'لم يجرَّب بعد',   icon: AlertCircle,   color: 'gray'    },
];

const METHOD_LABEL = {
  auto_phone: 'بالهاتف',
  auto_name:  'بالاسم',
  manual:     'يدوى',
  ambiguous:  'يحتاج مراجعة',
  unmatched:  'غير مطابق',
};

const METHOD_BADGE = {
  auto_phone: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  auto_name:  'bg-blue-100    text-blue-700    border-blue-300',
  manual:     'bg-violet-100  text-violet-700  border-violet-300',
  ambiguous:  'bg-amber-100   text-amber-700   border-amber-300',
  unmatched:  'bg-rose-100    text-rose-700    border-rose-300',
};

function fmtAmount(amount, currency) {
  if (amount == null) return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return `${n.toLocaleString('ar-EG')} ${currency || ''}`.trim();
}

// ─── STAT TILE ────────────────────────────────────────────────────────────────
function StatTile({ label, value, icon: Icon, color = 'blue' }) {
  const palettes = {
    blue:    'from-blue-50 to-blue-100 text-blue-900 border-blue-200',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-900 border-emerald-200',
    amber:   'from-amber-50 to-amber-100 text-amber-900 border-amber-200',
    rose:    'from-rose-50 to-rose-100 text-rose-900 border-rose-200',
    violet:  'from-violet-50 to-violet-100 text-violet-900 border-violet-200',
    gray:    'from-gray-50 to-gray-100 text-gray-900 border-gray-200',
  };
  return (
    <div className={`bg-gradient-to-br ${palettes[color]} border-2 rounded-2xl p-4 flex items-center gap-3`}>
      {Icon && <Icon size={28} className="flex-shrink-0 opacity-80" />}
      <div className="min-w-0">
        <p className="text-xs font-bold opacity-70">{label}</p>
        <p className="text-2xl font-black tabular-nums">{value != null ? Number(value).toLocaleString('ar-EG') : '—'}</p>
      </div>
    </div>
  );
}

// ─── MANUAL MATCH DIALOG ─────────────────────────────────────────────────────
function ManualMatchDialog({ tx, onClose, onMatched }) {
  const [q, setQ] = useState(tx.client_name || '');

  const candidatesQ = useQuery({
    queryKey: ['finance', 'match-candidates', tx.id],
    queryFn: () => api.get(`/finance/match/candidates/${encodeURIComponent(tx.id)}`).then(r => r.data),
    enabled: !!tx.id,
  });
  const searchQ = useQuery({
    queryKey: ['finance', 'match-client-search', q],
    queryFn: () => api.get('/finance/match/clients/search', { params: { q } }).then(r => r.data),
    enabled: q.trim().length >= 2,
    staleTime: 5_000,
  });

  const matchMut = useMutation({
    mutationFn: (clientId) => api.post(
      `/finance/match/transaction/${encodeURIComponent(tx.id)}/manual`,
      { client_id: clientId },
    ).then(r => r.data),
    onSuccess: () => {
      onMatched();
      onClose();
    },
  });

  const candidates = candidatesQ.data?.candidates || [];
  const searchResults = searchQ.data?.clients || [];

  // Hide already-listed candidates from search results
  const candIds = new Set(candidates.map(c => c.client_id));
  const extra = searchResults.filter(c => !candIds.has(c.id));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-black text-gray-900">مطابقة يدوية</h3>
              <p className="text-sm text-gray-600 mt-1">
                المعاملة: <span className="font-bold">{tx.client_name}</span> · {tx.client_phone || '—'} ·{' '}
                <span className="text-gray-500">{fmtAmount(tx.amount, tx.currency)}</span>
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
              <X size={20} />
            </button>
          </div>
          <div className="relative mt-3">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="ابحث بالاسم أو الهاتف..."
              className="w-full pr-9 pl-3 py-2.5 border-2 border-gray-200 rounded-lg text-sm focus:border-violet-400 outline-none"
            />
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {candidates.length > 0 ? (
            <div>
              <h4 className="text-sm font-black text-gray-700 mb-2">المرشحون التلقائيون</h4>
              <ul className="space-y-2">
                {candidates.map(c => (
                  <li key={c.client_id}>
                    <button
                      onClick={() => matchMut.mutate(c.client_id)}
                      disabled={matchMut.isPending}
                      className="w-full text-right border-2 border-amber-200 hover:border-amber-400 hover:bg-amber-50 rounded-xl p-3 transition"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-gray-900">{c.name}</p>
                          <p className="text-xs text-gray-600 mt-0.5">
                            {c.phone || '—'} · {c.group_name || '—'} · {c.line}
                          </p>
                        </div>
                        <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
                          {c.method === 'phone' ? 'هاتف' : 'اسم'}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {extra.length > 0 ? (
            <div>
              <h4 className="text-sm font-black text-gray-700 mb-2">نتائج البحث</h4>
              <ul className="space-y-2">
                {extra.map(c => (
                  <li key={c.id}>
                    <button
                      onClick={() => matchMut.mutate(c.id)}
                      disabled={matchMut.isPending}
                      className="w-full text-right border-2 border-gray-200 hover:border-violet-400 hover:bg-violet-50 rounded-xl p-3 transition"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-gray-900">{c.name}</p>
                          <p className="text-xs text-gray-600 mt-0.5">
                            {c.phone || '—'} · {c.group_name || '—'} · {c.line}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {candidates.length === 0 && extra.length === 0 && q.trim().length >= 2 ? (
            <p className="text-center text-gray-500 text-sm py-8">لا يوجد نتائج للبحث</p>
          ) : null}

          {matchMut.isError ? (
            <div className="bg-rose-50 border-2 border-rose-200 rounded-lg p-2 text-xs text-rose-700">
              ❌ {matchMut.error?.response?.data?.error || matchMut.error?.message}
            </div>
          ) : null}
        </div>

        <div className="p-4 border-t bg-gray-50 flex justify-between gap-2">
          <ModernButton
            variant="danger"
            icon={X}
            onClick={() => matchMut.mutate(null)}
            disabled={matchMut.isPending || !tx.matched_client_id}
          >
            إلغاء المطابقة
          </ModernButton>
          <ModernButton variant="secondary" onClick={onClose}>
            إغلاق
          </ModernButton>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function FinanceMatching() {
  const qc = useQueryClient();
  const [state, setState] = useState('ambiguous');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [dialogTx, setDialogTx] = useState(null);

  const statsQ = useQuery({
    queryKey: ['finance', 'match-stats'],
    queryFn: () => api.get('/finance/match/stats').then(r => r.data),
    refetchInterval: 10_000,
  });

  const listQ = useQuery({
    queryKey: ['finance', 'match-transactions', state, search, page],
    queryFn: () => api.get('/finance/match/transactions', {
      params: { state, q: search || undefined, page, limit: 50 },
    }).then(r => r.data),
    keepPreviousData: true,
  });

  const runAllMut = useMutation({
    mutationFn: (scope) => api.post('/finance/match/run-all', { scope }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance', 'match-stats'] });
      qc.invalidateQueries({ queryKey: ['finance', 'match-transactions'] });
    },
  });

  const retryMut = useMutation({
    mutationFn: (txId) => api.post(`/finance/match/transaction/${encodeURIComponent(txId)}`, { force: true }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance', 'match-stats'] });
      qc.invalidateQueries({ queryKey: ['finance', 'match-transactions'] });
    },
  });

  const stats = statsQ.data || {};
  const transactions = listQ.data?.transactions || [];
  const total = listQ.data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / 50));

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['finance', 'match-stats'] });
    qc.invalidateQueries({ queryKey: ['finance', 'match-transactions'] });
  };

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="مطابقة العملاء"
        subtitle="ربط معاملات Center App بعملاء الأكاديمية"
        icon={LinkIcon}
        gradient="violet"
        actions={
          <div className="flex gap-2">
            <ModernButton variant="glass" icon={RefreshCw} onClick={refreshAll}>تحديث</ModernButton>
            <ModernButton
              variant="glass"
              icon={Play}
              onClick={() => runAllMut.mutate('unattempted')}
              disabled={runAllMut.isPending}
            >
              {runAllMut.isPending ? 'جارى...' : 'مطابقة الجديد'}
            </ModernButton>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatTile label="الإجمالى"          value={stats.total}         icon={Wallet}       color="gray" />
        <StatTile label="مطابَق"             value={stats.matched}       icon={CheckCircle2} color="emerald" />
        <StatTile label="بالهاتف"           value={stats.auto_phone}    icon={Phone}        color="emerald" />
        <StatTile label="بالاسم"            value={stats.auto_name}     icon={Users}        color="blue" />
        <StatTile label="يدوى"              value={stats.manual}        icon={LinkIcon}     color="violet" />
        <StatTile label="يحتاج مراجعة"      value={stats.ambiguous}     icon={HelpCircle}   color="amber" />
        <StatTile label="غير مطابق"         value={stats.unmatched}     icon={UserX}        color="rose" />
      </div>

      {/* Re-run controls */}
      <SectionCard title="إعادة تشغيل التلقائى" icon={Play}>
        <div className="flex flex-wrap gap-2 items-center">
          <ModernButton
            variant="secondary"
            onClick={() => runAllMut.mutate('unmatched')}
            disabled={runAllMut.isPending}
          >
            إعادة محاولة "غير مطابق" + "يحتاج مراجعة"
          </ModernButton>
          <ModernButton
            variant="amber"
            onClick={() => runAllMut.mutate('all')}
            disabled={runAllMut.isPending}
          >
            إعادة محاولة الكل (قد تكون بطيئة)
          </ModernButton>
          {runAllMut.data ? (
            <span className="text-xs bg-emerald-50 border border-emerald-200 rounded px-2 py-1 font-mono">
              ✅ تمت محاولة {runAllMut.data.attempted}: matched={runAllMut.data.matched} ambiguous={runAllMut.data.ambiguous} unmatched={runAllMut.data.unmatched}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          المطابقة التلقائية بتشتغل لوحدها على كل معاملة جديدة. الأزرار دى للحالات الخاصة (لما تضاف عملاء جديدين مثلاً).
        </p>
      </SectionCard>

      {/* Tabs + filter */}
      <SectionCard
        title="المعاملات حسب الحالة"
        icon={Search}
        noBodyPad
      >
        <div className="border-b">
          <div className="flex flex-wrap gap-1 p-2">
            {STATE_TABS.map(t => (
              <button
                key={t.key}
                onClick={() => { setState(t.key); setPage(1); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition ${
                  state === t.key
                    ? 'bg-violet-100 text-violet-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <t.icon size={16} />
                {t.label}
                {state === t.key && stats[t.key === 'not_attempted' ? 'not_attempted' : t.key] != null ? (
                  <span className="text-[10px] bg-white px-1.5 py-0.5 rounded-full">
                    {Number(stats[t.key === 'not_attempted' ? 'not_attempted' : t.key]).toLocaleString('ar-EG')}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="px-3 pb-3">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="ابحث بالاسم أو الهاتف..."
                className="w-full pr-9 pl-3 py-2 border-2 border-gray-200 rounded-lg text-sm focus:border-violet-400 outline-none"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-black text-gray-600">
              <tr>
                <th className="p-2 text-right">التاريخ</th>
                <th className="p-2 text-right">العميل (Center)</th>
                <th className="p-2 text-right">الهاتف</th>
                <th className="p-2 text-right">المنتج</th>
                <th className="p-2 text-right">المبلغ</th>
                <th className="p-2 text-right">الحالة</th>
                <th className="p-2 text-right">المطابقة</th>
                <th className="p-2 text-right">العميل المطابَق</th>
                <th className="p-2 text-right">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {listQ.isLoading ? (
                <tr><td colSpan={9} className="text-center py-8 text-gray-400">جارى التحميل...</td></tr>
              ) : transactions.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-gray-400">لا توجد معاملات</td></tr>
              ) : transactions.map(t => (
                <tr key={t.id} className="border-t hover:bg-gray-50">
                  <td className="p-2 whitespace-nowrap font-mono text-xs">{t.date || '—'}</td>
                  <td className="p-2 font-bold text-gray-900">{t.client_name || '—'}</td>
                  <td className="p-2 text-xs font-mono">{t.client_phone || '—'}</td>
                  <td className="p-2 text-xs">{t.product_name || '—'}</td>
                  <td className="p-2 tabular-nums whitespace-nowrap">{fmtAmount(t.amount, t.currency)}</td>
                  <td className="p-2"><span className="text-xs px-2 py-0.5 rounded-full bg-gray-100">{t.status || '—'}</span></td>
                  <td className="p-2 whitespace-nowrap">
                    {t.match_method ? (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${METHOD_BADGE[t.match_method] || ''}`}>
                        {METHOD_LABEL[t.match_method] || t.match_method}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="p-2">
                    {t.matched_client_name ? (
                      <div>
                        <p className="font-bold text-emerald-700">{t.matched_client_name}</p>
                        <p className="text-[10px] text-gray-500 font-mono">{t.matched_client_phone}</p>
                      </div>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    <button
                      onClick={() => setDialogTx(t)}
                      className="text-xs font-bold px-2 py-1 bg-violet-100 hover:bg-violet-200 text-violet-700 rounded-full"
                    >
                      مطابقة يدوية
                    </button>
                    {t.match_method === 'unmatched' || t.match_method === 'ambiguous' ? (
                      <button
                        onClick={() => retryMut.mutate(t.id)}
                        disabled={retryMut.isPending}
                        className="text-xs font-bold px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-full mr-1"
                      >
                        إعادة محاولة
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 ? (
          <div className="p-3 border-t flex items-center justify-between text-sm">
            <span className="text-gray-500">
              صفحة {page} من {pages} · {total.toLocaleString('ar-EG')} معاملة
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-gray-50"
              >السابق</button>
              <button
                onClick={() => setPage(p => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-gray-50"
              >التالى</button>
            </div>
          </div>
        ) : null}
      </SectionCard>

      {dialogTx ? (
        <ManualMatchDialog
          tx={dialogTx}
          onClose={() => setDialogTx(null)}
          onMatched={refreshAll}
        />
      ) : null}
    </div>
  );
}
