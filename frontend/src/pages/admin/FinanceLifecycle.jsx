import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GitBranch, Search, User, Calendar, Tag, Activity, RefreshCw,
  ChevronLeft, Wallet, GraduationCap, ArrowUpRight, Repeat, X, Coins, Phone, Star,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import ModernButton from '../../components/ui/ModernButton';

/**
 * Admin → Finance Lifecycle (Phase 3)
 *
 * Per-client timeline view. Phase 4 will use the same data store
 * (client_lifecycle_events) to drive level transitions; this page is the
 * read-only window onto what the ingestion + matching pipeline produced.
 */

const EVENT_META = {
  enrollment:     { label: 'تسجيل جديد',  icon: Star,         color: 'emerald' },
  renewal:        { label: 'تجديد',       icon: Repeat,       color: 'blue'    },
  upgrade:        { label: 'ترقية مستوى', icon: ArrowUpRight, color: 'violet'  },
  installment:    { label: 'قسط',         icon: Coins,        color: 'amber'   },
  refund:         { label: 'استرداد',     icon: X,            color: 'rose'    },
  session:        { label: 'جلسة',        icon: Activity,     color: 'cyan'    },
  recommendation: { label: 'توصية',       icon: User,         color: 'fuchsia' },
};

function fmtAmount(amount, currency) {
  if (amount == null) return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return `${n.toLocaleString('ar-EG')} ${currency || ''}`.trim();
}

function fmtDate(d) {
  if (!d) return '—';
  return d.slice(0, 10);
}

// ─── STATS TILES ──────────────────────────────────────────────────────────────
function StatTile({ label, value, icon: Icon, color = 'blue' }) {
  const palettes = {
    blue:    'from-blue-50 to-blue-100 text-blue-900 border-blue-200',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-900 border-emerald-200',
    violet:  'from-violet-50 to-violet-100 text-violet-900 border-violet-200',
    amber:   'from-amber-50 to-amber-100 text-amber-900 border-amber-200',
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

// ─── TIMELINE ─────────────────────────────────────────────────────────────────
function Timeline({ events }) {
  if (!events?.length) {
    return (
      <div className="p-8 text-center text-gray-400">
        <Activity className="w-12 h-12 mx-auto mb-2 opacity-30" />
        <p className="text-sm">لا توجد أحداث لهذا العميل</p>
      </div>
    );
  }
  return (
    <div className="relative">
      <div className="absolute right-4 top-3 bottom-3 w-0.5 bg-gradient-to-b from-violet-200 to-blue-200" />
      <ul className="space-y-3 py-2">
        {events.map(e => {
          const meta = EVENT_META[e.event_type] || { label: e.event_type, icon: Activity, color: 'blue' };
          const Icon = meta.icon;
          const palette = {
            emerald: 'bg-emerald-100 text-emerald-700',
            blue:    'bg-blue-100    text-blue-700',
            violet:  'bg-violet-100  text-violet-700',
            amber:   'bg-amber-100   text-amber-700',
            rose:    'bg-rose-100    text-rose-700',
            cyan:    'bg-cyan-100    text-cyan-700',
            fuchsia: 'bg-fuchsia-100 text-fuchsia-700',
          }[meta.color] || 'bg-gray-100 text-gray-700';

          return (
            <li key={e.id} className="relative pr-12 pl-4">
              <span className={`absolute right-1 top-3 w-8 h-8 rounded-full flex items-center justify-center ${palette} ring-4 ring-white`}>
                <Icon size={16} />
              </span>
              <div className="bg-white border-2 border-gray-100 hover:border-gray-200 rounded-xl p-3">
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-black text-gray-900">{meta.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      <Calendar size={11} className="inline ml-0.5" /> {fmtDate(e.event_date)}
                      {e.product_name ? <> · <span className="font-bold">{e.product_name}</span></> : null}
                    </p>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold tabular-nums">{fmtAmount(e.amount, e.currency)}</p>
                    {e.level_raw ? (
                      <span className="inline-block mt-1 text-[10px] font-black bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded-full">
                        <GraduationCap size={11} className="inline ml-0.5" /> {e.level_raw}
                      </span>
                    ) : null}
                  </div>
                </div>
                {e.category || e.status ? (
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-bold">
                    {e.category ? <span className="bg-gray-100 px-2 py-0.5 rounded-full text-gray-600">{e.category}</span> : null}
                    {e.status   ? <span className="bg-gray-100 px-2 py-0.5 rounded-full text-gray-600">{e.status}</span>   : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function FinanceLifecycle() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);

  const statsQ = useQuery({
    queryKey: ['finance', 'lifecycle-stats'],
    queryFn: () => api.get('/finance/lifecycle/stats').then(r => r.data),
    refetchInterval: 30_000,
  });

  const searchQ = useQuery({
    queryKey: ['finance', 'lifecycle-search', q],
    queryFn: () => api.get('/finance/lifecycle/search-clients', { params: { q } }).then(r => r.data),
    enabled: q.trim().length >= 2,
    staleTime: 5_000,
  });

  const timelineQ = useQuery({
    queryKey: ['finance', 'lifecycle-client', selectedClient?.id],
    queryFn: () => api.get(`/finance/lifecycle/client/${selectedClient.id}`).then(r => r.data),
    enabled: !!selectedClient?.id,
  });

  const regenerateMut = useMutation({
    mutationFn: () => api.post('/finance/lifecycle/regenerate-all').then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance', 'lifecycle-stats'] });
      if (selectedClient?.id) qc.invalidateQueries({ queryKey: ['finance', 'lifecycle-client', selectedClient.id] });
    },
  });

  const stats = statsQ.data || {};
  const clients = searchQ.data?.clients || [];

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="رحلة العميل"
        subtitle="تاريخ كل عميل المالى — الأساس لنظام انتقال المستويات القادم"
        icon={GitBranch}
        gradient="cyan"
        actions={
          <ModernButton
            variant="glass"
            icon={RefreshCw}
            onClick={() => regenerateMut.mutate()}
            disabled={regenerateMut.isPending}
          >
            {regenerateMut.isPending ? 'جارى...' : 'إعادة بناء الأحداث'}
          </ModernButton>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="إجمالى الأحداث"    value={stats.total}             icon={Activity}      color="blue" />
        <StatTile label="عملاء لهم تاريخ"   value={stats.distinct_clients}  icon={User}          color="emerald" />
        <StatTile
          label="تسجيلات جديدة"
          value={stats.by_type?.find(t => t.event_type === 'enrollment')?.n || 0}
          icon={Star}
          color="emerald"
        />
        <StatTile
          label="ترقيات مستوى"
          value={stats.by_type?.find(t => t.event_type === 'upgrade')?.n || 0}
          icon={ArrowUpRight}
          color="violet"
        />
      </div>

      {regenerateMut.data ? (
        <div className="text-xs bg-emerald-50 border-2 border-emerald-200 rounded-lg p-2 font-mono">
          ✅ تمت معالجة {regenerateMut.data.attempted} معاملة: ok={regenerateMut.data.ok} skipped={regenerateMut.data.skipped} errors={regenerateMut.data.errors}
        </div>
      ) : null}

      {/* Top levels */}
      {stats.by_level?.length ? (
        <SectionCard title="أكثر المستويات تكراراً" icon={GraduationCap}>
          <div className="flex flex-wrap gap-2">
            {stats.by_level.slice(0, 20).map(l => (
              <span key={l.level_raw} className="text-xs font-bold bg-violet-50 border border-violet-200 text-violet-700 rounded-full px-3 py-1">
                {l.level_raw} <span className="opacity-60">({Number(l.n).toLocaleString('ar-EG')})</span>
              </span>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-3">
            * النصوص دى مستخرجة بشكل خام من اسم المنتج. الـ Phase 4 هتحوّلها لنظام مستويات موحّد.
          </p>
        </SectionCard>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Search panel */}
        <SectionCard title="ابحث عن عميل" icon={Search} className="lg:col-span-1">
          <div className="relative mb-3">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="ابحث بالاسم أو الهاتف..."
              className="w-full pr-9 pl-3 py-2 border-2 border-gray-200 rounded-lg text-sm focus:border-cyan-400 outline-none"
            />
          </div>
          {q.trim().length < 2 ? (
            <p className="text-xs text-gray-400 text-center py-6">اكتب حرفين على الأقل</p>
          ) : searchQ.isLoading ? (
            <p className="text-xs text-gray-400 text-center py-6">جارى البحث...</p>
          ) : clients.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">لا يوجد عملاء لهم أحداث مالية</p>
          ) : (
            <ul className="space-y-1 max-h-96 overflow-y-auto">
              {clients.map(c => (
                <li key={c.id}>
                  <button
                    onClick={() => setSelectedClient(c)}
                    className={`w-full text-right rounded-lg p-2 transition ${
                      selectedClient?.id === c.id
                        ? 'bg-cyan-100 border-2 border-cyan-300'
                        : 'border-2 border-gray-100 hover:border-cyan-200 hover:bg-cyan-50'
                    }`}
                  >
                    <p className="font-bold text-sm">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.phone || '—'} · {c.events} حدث</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Timeline panel */}
        <SectionCard
          title={selectedClient ? `${selectedClient.name} — رحلة العميل` : 'اختر عميل لعرض رحلته'}
          icon={GitBranch}
          className="lg:col-span-2"
        >
          {!selectedClient ? (
            <div className="p-8 text-center text-gray-400">
              <GitBranch className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">ابحث عن عميل من اللوحة على اليمين</p>
            </div>
          ) : timelineQ.isLoading ? (
            <p className="text-center text-gray-400 text-sm py-8">جارى التحميل...</p>
          ) : timelineQ.isError ? (
            <p className="text-center text-rose-500 text-sm py-8">
              {timelineQ.error?.response?.data?.error || timelineQ.error?.message}
            </p>
          ) : (
            <>
              <div className="mb-4 bg-gray-50 rounded-lg p-3 text-xs">
                <p><Phone size={11} className="inline ml-0.5" /> <span className="font-bold">{timelineQ.data?.client?.phone || '—'}</span></p>
                {timelineQ.data?.client?.group_name ? (
                  <p className="mt-1"><Tag size={11} className="inline ml-0.5" /> {timelineQ.data.client.group_name}</p>
                ) : null}
              </div>
              <Timeline events={timelineQ.data?.events || []} />
            </>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
