import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Users, Search, Filter, Bell, ChevronLeft, ChevronRight, BellRing,
  Phone, AlertTriangle, CheckCircle, Clock,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';

/**
 * Coordinator's clients overview. URL: /subscriptions/my-clients
 *
 * Lists clients scoped to the current user (per server-side filter):
 *   - admin: all subscriptions
 *   - leader: dept's clients
 *   - everyone else: their own assigned clients
 *
 * Each row shows: name + phone + paid / completed / pending counts + days
 * silent + a quick badge for any active notification.
 */

const SEVERITY_BADGE = {
  critical: 'bg-rose-100 text-rose-700 border-rose-300',
  urgent:   'bg-orange-100 text-orange-700 border-orange-300',
  warning:  'bg-amber-100 text-amber-700 border-amber-300',
  info:     'bg-cyan-100 text-cyan-700 border-cyan-300',
};

export default function CsMyClients() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [dept, setDept] = useState('');

  const subsQ = useQuery({
    queryKey: ['cs-subscriptions', { q, page, dept }],
    queryFn: () => api.get('/cs/subscriptions', { params: { q, page, dept, limit: 50, is_ignored: '0' } }).then(r => r.data),
    keepPreviousData: true,
  });

  const summaryQ = useQuery({
    queryKey: ['cs-subs-summary'],
    queryFn: () => api.get('/cs/subscriptions/summary').then(r => r.data),
  });

  const notifsQ = useQuery({
    queryKey: ['cs-my-notifs'],
    queryFn: () => api.get('/cs/notifications/mine').then(r => r.data),
  });

  // De-duplicate by phone (multiple subscriptions per client = one row)
  const clients = useMemo(() => {
    const subs = subsQ.data?.subscriptions || [];
    const seen = new Map();
    for (const s of subs) {
      const key = s.client_phone_norm || s.client_phone_raw || `id:${s.id}`;
      if (!seen.has(key)) {
        seen.set(key, {
          phone: s.client_phone_norm || s.client_phone_raw,
          name: s.client_name_raw,
          client_id: s.client_id,
          paid_months_total: s.months || 0,
          subs_count: 1,
          depts: new Set([s.dept].filter(Boolean)),
          earliest: s.subscription_date || s.created_at,
        });
      } else {
        const row = seen.get(key);
        row.paid_months_total += (s.months || 0);
        row.subs_count++;
        if (s.dept) row.depts.add(s.dept);
        const cur = row.earliest;
        const next = s.subscription_date || s.created_at;
        if (next && next < cur) row.earliest = next;
      }
    }
    return Array.from(seen.values()).map(c => ({ ...c, depts: [...c.depts] }));
  }, [subsQ.data]);

  // Map of phone → highest-severity notification (for badge)
  const notifByPhone = useMemo(() => {
    const m = new Map();
    const all = notifsQ.data?.notifications || [];
    const sevRank = { critical: 4, urgent: 3, warning: 2, info: 1 };
    for (const n of all) {
      if (!n.client_phone_norm) continue;
      const prev = m.get(n.client_phone_norm);
      if (!prev || (sevRank[n.severity] || 0) > (sevRank[prev.severity] || 0)) m.set(n.client_phone_norm, n);
    }
    return m;
  }, [notifsQ.data]);

  const summary = summaryQ.data?.summary || {};
  const total   = subsQ.data?.total || 0;
  const pages   = subsQ.data?.pages || 1;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" dir="rtl">
      <PageHero
        title="عملاء المتابعة (الاشتراكات)"
        subtitle="متابعة العملاء وحالة الاشتراكات والتذكيرات"
        icon={Users}
        color="violet"
      />

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
        <Tile label="إجمالي الاشتراكات" value={summary.total} color="blue" />
        <Tile label="General" value={summary.general} color="cyan" />
        <Tile label="Private" value={summary.private_} color="violet" />
        <Tile label="Semi" value={summary.semi} color="emerald" />
        <Tile label="بالأقساط" value={summary.installment} color="amber" />
        <Tile label="بدون عميل مطابق" value={summary.unmatched} color="rose" />
      </div>

      {/* Notifications strip */}
      {(notifsQ.data?.notifications?.length || 0) > 0 && (
        <SectionCard title="تنبيهات نشطة لك" icon={BellRing} className="mt-4">
          <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {notifsQ.data.notifications.slice(0, 9).map(n => {
              const cls = SEVERITY_BADGE[n.severity] || SEVERITY_BADGE.info;
              return (
                <button
                  key={n.id}
                  onClick={() => navigate(`/subscriptions/client/${encodeURIComponent(n.client_phone_norm)}`)}
                  className={`text-right p-2 border-2 rounded-lg ${cls} hover:scale-[1.02] transition`}
                >
                  <p className="text-xs font-bold opacity-70">{n.client_phone_norm}</p>
                  <p className="text-sm font-bold mt-1">{n.title}</p>
                  {n.message && <p className="text-xs mt-1 opacity-80 line-clamp-2">{n.message}</p>}
                </button>
              );
            })}
          </div>
        </SectionCard>
      )}

      <SectionCard title="قائمة العملاء" icon={Users} className="mt-4">
        {/* Filters */}
        <div className="p-3 flex flex-wrap gap-2 items-center border-b border-gray-100">
          <div className="flex-1 min-w-[200px] relative">
            <Search size={16} className="absolute right-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={q}
              onChange={e => { setQ(e.target.value); setPage(1); }}
              placeholder="بحث بالاسم أو الموبايل..."
              className="w-full pr-9 pl-3 py-2 border-2 rounded-lg focus:border-blue-400 outline-none text-sm"
            />
          </div>
          <select
            value={dept}
            onChange={e => { setDept(e.target.value); setPage(1); }}
            className="px-3 py-2 border-2 rounded-lg outline-none text-sm"
          >
            <option value="">كل الأقسام</option>
            <option value="General">General</option>
            <option value="Private">Private</option>
            <option value="Semi">Semi</option>
          </select>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-right">الاسم</th>
                <th className="px-3 py-2 text-right">الموبايل</th>
                <th className="px-3 py-2 text-right">القسم</th>
                <th className="px-3 py-2 text-right">شهور مدفوعة</th>
                <th className="px-3 py-2 text-right">عدد الاشتراكات</th>
                <th className="px-3 py-2 text-right">تنبيه نشط</th>
              </tr>
            </thead>
            <tbody>
              {subsQ.isLoading ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">جاري التحميل...</td></tr>
              ) : clients.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">مفيش عملاء</td></tr>
              ) : clients.map(c => {
                const notif = notifByPhone.get(c.phone);
                return (
                  <tr
                    key={c.phone}
                    onClick={() => navigate(`/subscriptions/client/${encodeURIComponent(c.phone)}`)}
                    className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer"
                  >
                    <td className="px-3 py-2 font-bold">{c.name || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{c.phone}</td>
                    <td className="px-3 py-2">{c.depts.join('، ') || '—'}</td>
                    <td className="px-3 py-2 tabular-nums font-bold">{c.paid_months_total}</td>
                    <td className="px-3 py-2 tabular-nums">{c.subs_count}</td>
                    <td className="px-3 py-2">
                      {notif ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${SEVERITY_BADGE[notif.severity] || SEVERITY_BADGE.info}`}>
                          {notif.title?.slice(0, 30) || notif.notif_type}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-3 flex items-center justify-between border-t border-gray-100 text-sm">
          <span className="text-gray-600">المجموع: <strong>{total}</strong></span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1 disabled:opacity-30"
            >
              <ChevronRight size={18} />
            </button>
            <span className="px-3">{page} / {pages}</span>
            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page >= pages}
              className="p-1 disabled:opacity-30"
            >
              <ChevronLeft size={18} />
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function Tile({ label, value, color = 'blue' }) {
  const palette = {
    blue:    'from-blue-50 to-blue-100 text-blue-900 border-blue-200',
    cyan:    'from-cyan-50 to-cyan-100 text-cyan-900 border-cyan-200',
    violet:  'from-violet-50 to-violet-100 text-violet-900 border-violet-200',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-900 border-emerald-200',
    amber:   'from-amber-50 to-amber-100 text-amber-900 border-amber-200',
    rose:    'from-rose-50 to-rose-100 text-rose-900 border-rose-200',
  };
  return (
    <div className={`bg-gradient-to-br ${palette[color]} border-2 rounded-2xl p-3`}>
      <p className="text-[11px] font-bold opacity-70">{label}</p>
      <p className="text-2xl font-black tabular-nums">{value != null ? Number(value).toLocaleString('ar-EG') : '—'}</p>
    </div>
  );
}
