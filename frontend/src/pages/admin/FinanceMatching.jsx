import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Link as LinkIcon, RefreshCw, Search, Check, X, Users, AlertCircle,
  CheckCircle2, HelpCircle, UserX, Play, Phone, Wallet, List, Pencil,
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
  { key: 'all',           label: 'الكل',           icon: List,          color: 'violet'  },
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

// Classify (line tag) badge colors — comes from Center App's classify field.
const CLASSIFY_BADGE = {
  'Ahmed Hassan': 'bg-emerald-100 text-emerald-700 border-emerald-300',
  'Dardasha':     'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-300',
};
function classifyLabel(c) {
  if (!c) return null;
  const trimmed = String(c).trim();
  if (!trimmed || trimmed === '-' || trimmed === '.' || trimmed === '0') return null;
  return trimmed;
}

// Transaction status badge colors — pending stands out in red for action visibility
const STATUS_BADGE = {
  pending:  'bg-rose-100    text-rose-700    border border-rose-300',
  approved: 'bg-blue-100    text-blue-700    border border-blue-300',
  paid:     'bg-emerald-100 text-emerald-700 border border-emerald-300',
  rejected: 'bg-gray-200    text-gray-600    border border-gray-300',
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

// ─── CLASSIFY CELL ─────────────────────────────────────────────────────────
// One cell in the matching table that shows the line tag (classify) for a tx.
// Priority:
//   1. tx.classify when it's a known value
//   2. fall back to the matched client's line if the tx is matched
//   3. otherwise show a dropdown so the admin can pick a line manually
//      (POSTs to PATCH /classify and then triggers a global refresh)
function ClassifyCell({ tx, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const explicit = classifyLabel(tx.classify);
  const fromMatch = !explicit && tx.matched_client_line
    ? (CLASSIFY_BADGE[tx.matched_client_line] ? tx.matched_client_line : null)
    : null;
  const finalLabel = explicit || fromMatch;

  const setClassify = async (val) => {
    try {
      setSaving(true);
      setError(null);
      await api.patch(
        `/finance/match/transaction/${encodeURIComponent(tx.id)}/classify`,
        { classify: val },
      );
      setEditing(false);
      if (typeof onSaved === 'function') onSaved();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'فشل التحديث');
    } finally {
      setSaving(false);
    }
  };

  // ── EDIT MODE: dropdown with confirm/cancel ─────────────────────────────
  if (editing || !finalLabel) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <select
            disabled={saving}
            defaultValue={explicit || ''}
            onChange={(e) => { if (e.target.value !== undefined) setClassify(e.target.value || null); }}
            className="text-xs border border-gray-200 rounded-md px-1.5 py-0.5 bg-white hover:border-violet-300 focus:border-violet-400 outline-none disabled:opacity-50"
          >
            <option value="">— اختر —</option>
            <option value="Ahmed Hassan">Ahmed Hassan</option>
            <option value="Dardasha">Dardasha</option>
          </select>
          {finalLabel && (
            <button
              onClick={() => { setEditing(false); setError(null); }}
              title="إلغاء"
              className="text-gray-400 hover:text-gray-700 p-0.5"
            >
              <X size={12} />
            </button>
          )}
        </div>
        {error && <span className="text-[10px] text-rose-600">{error}</span>}
      </div>
    );
  }

  // ── DISPLAY MODE: badge + edit button ───────────────────────────────────
  const cls = CLASSIFY_BADGE[finalLabel] || 'bg-gray-100 text-gray-700 border-gray-300';
  return (
    <div className="flex items-center gap-1 group">
      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${cls}`}>
        {finalLabel}
      </span>
      {!explicit && fromMatch && (
        <span className="text-[10px] text-gray-400" title="من بيانات العميل المطابَق">
          (من العميل)
        </span>
      )}
      <button
        onClick={() => { setEditing(true); setError(null); }}
        title="تعديل"
        className="text-gray-400 hover:text-violet-600 p-0.5 opacity-60 group-hover:opacity-100 transition"
      >
        <Pencil size={11} />
      </button>
    </div>
  );
}

// ─── MANUAL MATCH DIALOG ─────────────────────────────────────────────────────
function ManualMatchDialog({ tx, onClose, onMatched }) {
  const [q, setQ] = useState(tx.client_name || '');
  // Local mirror so the Line dropdown reflects updates immediately while a
  // PATCH is in flight. Reset whenever the tx prop changes.
  const [localClassify, setLocalClassify] = useState(classifyLabel(tx.classify));
  const [classifySaving, setClassifySaving] = useState(false);

  const candidatesQ = useQuery({
    queryKey: ['finance', 'match-candidates', tx.id],
    queryFn: () => api.get(`/finance/match/candidates/${encodeURIComponent(tx.id)}`).then(r => r.data),
    enabled: !!tx.id,
  });
  const suggestionsQ = useQuery({
    queryKey: ['finance', 'match-suggestions', tx.id],
    queryFn: () => api.get(`/finance/match/suggestions/${encodeURIComponent(tx.id)}`).then(r => r.data),
    enabled: !!tx.id,
    staleTime: 30_000,
  });
  const searchQ = useQuery({
    queryKey: ['finance', 'match-client-search', q],
    queryFn: () => api.get('/finance/match/clients/search', { params: { q } }).then(r => r.data),
    enabled: q.trim().length >= 2,
    staleTime: 5_000,
  });

  // Persist a manual Line override on the transaction. Used both by the
  // explicit dropdown at the top of the dialog and as an auto-side-effect
  // when the admin picks a candidate (the candidate's line becomes the
  // transaction's classify if classify isn't already set).
  const patchClassify = async (val) => {
    setClassifySaving(true);
    try {
      await api.patch(
        `/finance/match/transaction/${encodeURIComponent(tx.id)}/classify`,
        { classify: val },
      );
      setLocalClassify(val);
    } finally {
      setClassifySaving(false);
    }
  };

  // Manual match: optionally set classify first (when the chosen candidate
  // sits on a known line and the tx classify is still empty), then run the
  // existing manualMatch endpoint. Accepts either a regular clientId or a
  // subscriptionId (archive entry that gets materialised server-side).
  const matchMut = useMutation({
    mutationFn: async ({ clientId, subscriptionId, lineHint }) => {
      if (
        lineHint &&
        !localClassify &&
        CLASSIFY_BADGE[lineHint]
      ) {
        try { await patchClassify(lineHint); } catch (_) { /* best-effort */ }
      }
      const body = subscriptionId
        ? { subscription_id: subscriptionId }
        : { client_id: clientId };
      return api.post(
        `/finance/match/transaction/${encodeURIComponent(tx.id)}/manual`,
        body,
      ).then(r => r.data);
    },
    onSuccess: () => {
      onMatched();
      onClose();
    },
  });

  const candidates = candidatesQ.data?.candidates || [];
  const sameNameSugg    = suggestionsQ.data?.suggestions?.same_name      || [];
  const similarPhoneSugg = suggestionsQ.data?.suggestions?.similar_phone || [];
  const archiveSugg      = suggestionsQ.data?.suggestions?.archive       || [];
  const searchResults = searchQ.data?.clients || [];

  // Hide already-listed entries from search results
  const listedIds = new Set([
    ...candidates.map(c => c.client_id),
    ...sameNameSugg.map(c => c.id),
    ...similarPhoneSugg.map(c => c.id),
  ]);
  const extra = searchResults.filter(c => !listedIds.has(c.id));

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

          {/* Line (classify) inline editor — saves immediately on change */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs font-bold text-gray-600">Line (Classify):</span>
            <select
              value={localClassify || ''}
              disabled={classifySaving}
              onChange={(e) => patchClassify(e.target.value || null).catch(() => {})}
              className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white hover:border-violet-300 focus:border-violet-400 outline-none disabled:opacity-50"
            >
              <option value="">— بدون —</option>
              <option value="Ahmed Hassan">Ahmed Hassan</option>
              <option value="Dardasha">Dardasha</option>
            </select>
            {classifySaving && <span className="text-[11px] text-gray-400">جارٍ الحفظ...</span>}
            {localClassify && CLASSIFY_BADGE[localClassify] && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${CLASSIFY_BADGE[localClassify]}`}>
                {localClassify}
              </span>
            )}
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {/* ── SMART SUGGESTIONS: same-name matches ──────────────────────── */}
          {sameNameSugg.length > 0 ? (
            <div>
              <h4 className="text-sm font-black text-gray-700 mb-2 flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-600" />
                اقتراح ذكي — نفس الاسم بالظبط
              </h4>
              <ul className="space-y-2">
                {sameNameSugg.map(c => (
                  <li key={'sn-' + c.id}>
                    <button
                      onClick={() => matchMut.mutate({ clientId: c.id, lineHint: c.line })}
                      disabled={matchMut.isPending}
                      className="w-full text-right border-2 border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50 rounded-xl p-3 transition"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-gray-900">{c.name}</p>
                          <p className="text-xs text-gray-600 mt-0.5">
                            {c.phone || '—'} · {c.group_name || '—'} · {c.line}
                          </p>
                        </div>
                        <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full">
                          اسم متطابق
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ── ARCHIVE: subscription_clients matches (historical roster) ─── */}
          {archiveSugg.length > 0 ? (
            <div>
              <h4 className="text-sm font-black text-gray-700 mb-2 flex items-center gap-2">
                <span className="text-violet-600">📚</span>
                من الأرشيف — Customer Subscriptions
              </h4>
              <ul className="space-y-2">
                {archiveSugg.map(c => (
                  <li key={'arch-' + c.id}>
                    <button
                      onClick={() => matchMut.mutate({ subscriptionId: c.id, lineHint: c.line })}
                      disabled={matchMut.isPending}
                      className="w-full text-right border-2 border-violet-200 hover:border-violet-400 hover:bg-violet-50 rounded-xl p-3 transition"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-gray-900">{c.name}</p>
                          <p className="text-xs text-gray-600 mt-0.5">
                            {c.phone_raw || c.phone || '—'} · {c.group_name || '—'}
                            {c.group_status ? ' · ' + c.group_status : ''} · {c.line}
                          </p>
                          {c.source_file ? (
                            <p className="text-[10px] text-violet-500 font-mono mt-0.5">
                              📁 {c.source_file}
                            </p>
                          ) : null}
                        </div>
                        <span className="text-xs font-bold text-violet-700 bg-violet-100 px-2 py-1 rounded-full">
                          أرشيف
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ── SMART SUGGESTIONS: similar phone (typo tolerance) ─────────── */}
          {similarPhoneSugg.length > 0 ? (
            <div>
              <h4 className="text-sm font-black text-gray-700 mb-2 flex items-center gap-2">
                <Phone size={16} className="text-amber-600" />
                اقتراح ذكي — تليفون قريب (احتمال typo)
              </h4>
              <ul className="space-y-2">
                {similarPhoneSugg.map(c => (
                  <li key={'sp-' + c.id}>
                    <button
                      onClick={() => matchMut.mutate({ clientId: c.id, lineHint: c.line })}
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
                          فرق {c.distance} {c.distance === 1 ? 'رقم' : 'أرقام'}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {candidates.length > 0 ? (
            <div>
              <h4 className="text-sm font-black text-gray-700 mb-2">المرشحون التلقائيون</h4>
              <ul className="space-y-2">
                {candidates.map(c => (
                  <li key={c.client_id}>
                    <button
                      onClick={() => matchMut.mutate({ clientId: c.client_id, lineHint: c.line })}
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
                      onClick={() => matchMut.mutate({ clientId: c.id, lineHint: c.line })}
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
            onClick={() => matchMut.mutate({ clientId: null })}
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
  const [state, setState] = useState('all');
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

  const fixLinesMut = useMutation({
    mutationFn: () => api.post('/finance/match/fix-lines').then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance', 'match-stats'] });
      qc.invalidateQueries({ queryKey: ['finance', 'match-transactions'] });
    },
  });

  const subscriptionStatusQ = useQuery({
    queryKey: ['finance', 'subscriptions-status'],
    queryFn: () => api.get('/finance/subscriptions/status').then(r => r.data),
    refetchInterval: 30_000,
  });

  const syncSubscriptionsMut = useMutation({
    mutationFn: () => api.post('/finance/subscriptions/sync').then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance', 'subscriptions-status'] });
    },
  });

  // Unified "do everything" workflow: sync archive → fix lines → re-match all.
  // Runs the three operations sequentially and surfaces the combined results
  // so the admin doesn't have to remember which button does what.
  const runEverythingMut = useMutation({
    mutationFn: async () => {
      const sync   = await api.post('/finance/subscriptions/sync').then(r => r.data).catch(e => ({ error: e?.response?.data?.error || e.message }));
      const fix    = await api.post('/finance/match/fix-lines').then(r => r.data).catch(e => ({ error: e?.response?.data?.error || e.message }));
      return { sync, fix };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance', 'subscriptions-status'] });
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

      {/* Re-run controls — single unified button */}
      <SectionCard title="إعادة تشغيل التلقائى" icon={Play}>
        <div className="flex flex-wrap gap-2 items-center">
          <ModernButton
            variant="primary"
            onClick={() => {
              if (window.confirm(
                'هيتم تنفيذ كل العمليات بالترتيب:\n\n' +
                '1️⃣ مزامنة Customer Subscriptions (Archive) — ~30 ثانية\n' +
                '2️⃣ تصحيح Lines بناءً على batches\n' +
                '3️⃣ إعادة المطابقة الكاملة\n\n' +
                'تتابع؟'
              )) {
                runEverythingMut.mutate();
              }
            }}
            disabled={runEverythingMut.isPending}
          >
            {runEverythingMut.isPending
              ? '⏳ جارٍ التنفيذ... (قد تستغرق دقيقة)'
              : '🚀 تنفيذ شامل (مزامنة + إصلاح + مطابقة)'}
          </ModernButton>
          {subscriptionStatusQ.data ? (
            <span className="text-xs bg-violet-50 border border-violet-200 rounded px-2 py-1 font-mono">
              📚 {(subscriptionStatusQ.data.rows_total_current || 0).toLocaleString('ar-EG')} عميل في الأرشيف
              {subscriptionStatusQ.data.last_finished_at ? (
                <> · آخر مزامنة: {new Date(subscriptionStatusQ.data.last_finished_at).toLocaleString('ar-EG', { hour12: false })}</>
              ) : ' · لم تتم بعد'}
            </span>
          ) : null}
          {runEverythingMut.data ? (
            <span className="text-xs bg-emerald-50 border border-emerald-200 rounded px-2 py-1 font-mono">
              ✅ تم —
              {runEverythingMut.data.sync && !runEverythingMut.data.sync.error ? (
                <> أرشيف: {runEverythingMut.data.sync.files_processed || 0} ملف، {runEverythingMut.data.sync.rows_total || 0} صف</>
              ) : null}
              {runEverythingMut.data.fix && !runEverythingMut.data.fix.error ? (
                <> · line: {runEverythingMut.data.fix.clients_updated || 0} عميل ·
                  مطابقة: matched={runEverythingMut.data.fix.rematch?.matched ?? 0}
                  / unmatched={runEverythingMut.data.fix.rematch?.unmatched ?? 0}</>
              ) : null}
            </span>
          ) : null}
          {runEverythingMut.data?.sync?.error ? (
            <span className="text-xs bg-rose-50 border border-rose-200 rounded px-2 py-1 text-rose-700">
              ❌ مزامنة الأرشيف: {runEverythingMut.data.sync.error}
            </span>
          ) : null}
          {runEverythingMut.data?.fix?.error ? (
            <span className="text-xs bg-rose-50 border border-rose-200 rounded px-2 py-1 text-rose-700">
              ❌ إصلاح + مطابقة: {runEverythingMut.data.fix.error}
            </span>
          ) : null}
          {runEverythingMut.isError ? (
            <span className="text-xs bg-rose-50 border border-rose-200 rounded px-2 py-1 text-rose-700">
              ❌ {runEverythingMut.error?.response?.data?.error || runEverythingMut.error?.message}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          المطابقة التلقائية بتشتغل لوحدها على كل معاملة جديدة. الزرار ده للحالات الخاصة (لما تضاف عملاء جديدين، أو الـ archive يتحدث).
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
                {state === t.key && stats[t.key === 'all' ? 'total' : t.key] != null ? (
                  <span className="text-[10px] bg-white px-1.5 py-0.5 rounded-full">
                    {Number(stats[t.key === 'all' ? 'total' : t.key]).toLocaleString('ar-EG')}
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
                <th className="p-2 text-right">Line (Classify)</th>
                <th className="p-2 text-right">المطابقة</th>
                <th className="p-2 text-right">العميل المطابَق</th>
                <th className="p-2 text-right">نتائج البحث</th>
                <th className="p-2 text-right">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {listQ.isLoading ? (
                <tr><td colSpan={11} className="text-center py-8 text-gray-400">جارى التحميل...</td></tr>
              ) : transactions.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-8 text-gray-400">لا توجد معاملات</td></tr>
              ) : transactions.map(t => (
                <tr key={t.id} className="border-t hover:bg-gray-50">
                  <td className="p-2 whitespace-nowrap font-mono text-xs">{t.date || '—'}</td>
                  <td className="p-2 font-bold text-gray-900">{t.client_name || '—'}</td>
                  <td className="p-2 text-xs font-mono">{t.client_phone || '—'}</td>
                  <td className="p-2 text-xs">{t.product_name || '—'}</td>
                  <td className="p-2 tabular-nums whitespace-nowrap">{fmtAmount(t.amount, t.currency)}</td>
                  <td className="p-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[t.status] || 'bg-gray-100 text-gray-600'}`}>
                      {t.status || '—'}
                    </span>
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    <ClassifyCell tx={t} onSaved={refreshAll} />
                  </td>
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
                    {t.has_search_results === 1 ? (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-300">
                        🟢 يوجد
                      </span>
                    ) : t.has_search_results === 0 ? (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full border bg-gray-100 text-gray-500 border-gray-300">
                        ⚪ لا يوجد
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
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
