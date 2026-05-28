import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, AlertTriangle, BellRing, Users, BookOpen, RefreshCw,
  DollarSign, GraduationCap, CheckCircle, Coins, Clock, Award,
} from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../auth/AuthContext';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import ModernButton from '../../components/ui/ModernButton';

/**
 * Admin / Leader dashboard for the subscription tracker.
 *
 * URL: /subscriptions/dashboard
 * Roles: admin, leader. Anyone else gets redirected to /subscriptions/my-clients.
 */

const SEVERITY_STYLE = {
  critical: { bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-800',    label: 'حازم' },
  urgent:   { bg: 'bg-orange-50',  border: 'border-orange-200',  text: 'text-orange-800',  label: 'قوي' },
  warning:  { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-800',   label: 'ناعم' },
  info:     { bg: 'bg-cyan-50',    border: 'border-cyan-200',    text: 'text-cyan-800',    label: 'معلومات' },
};

export default function CsDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState('all');  // all / critical / urgent / warning / info

  const overviewQ = useQuery({
    queryKey: ['cs-dashboard-overview'],
    queryFn: () => api.get('/cs/dashboard/overview').then(r => r.data),
  });

  const atRiskQ = useQuery({
    queryKey: ['cs-dashboard-at-risk', filter],
    queryFn: () => api.get('/cs/dashboard/at-risk', { params: { severity: filter === 'all' ? '' : filter } }).then(r => r.data),
  });

  const extraQ = useQuery({
    queryKey: ['cs-dashboard-extra'],
    queryFn: () => api.get('/cs/dashboard/extra-courses').then(r => r.data),
  });

  const ingestExcel = useMutation({
    mutationFn: () => api.post('/cs/ingest/membership'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cs-dashboard-overview'] });
      qc.invalidateQueries({ queryKey: ['cs-dashboard-at-risk'] });
      alert('تم استيراد ملف Membership بنجاح');
    },
    onError: (e) => alert('فشل الاستيراد: ' + (e.response?.data?.error || e.message)),
  });

  const ingestFinance = useMutation({
    mutationFn: () => api.post('/cs/ingest/finance'),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['cs-dashboard-overview'] });
      qc.invalidateQueries({ queryKey: ['cs-dashboard-at-risk'] });
      const r = res.data?.result || {};
      alert(`تم: processed=${r.processed} matched=${r.matched_to_client} superseded_excel=${r.excel_rows_superseded}`);
    },
    onError: (e) => alert('فشل الاستيراد: ' + (e.response?.data?.error || e.message)),
  });

  const ingestLevels = useMutation({
    mutationFn: () => api.post('/cs/ingest/levels'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cs-dashboard-overview'] });
      alert('تم استيراد ملفات المستويات من Drive بنجاح');
    },
    onError: (e) => alert('فشل الاستيراد: ' + (e.response?.data?.error || e.message)),
  });

  const runAlerts = useMutation({
    mutationFn: () => api.post('/cs/alerts/run-now'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cs-dashboard-overview'] });
      qc.invalidateQueries({ queryKey: ['cs-dashboard-at-risk'] });
      alert('تم تشغيل فاحص التنبيهات');
    },
    onError: (e) => alert('فشل: ' + (e.response?.data?.error || e.message)),
  });

  const autoAssign = useMutation({
    mutationFn: () => api.post('/cs/coordinator/auto-assign-all'),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['cs-dashboard-overview'] });
      const r = res.data?.result || {};
      alert(`تم: scanned=${r.scanned} assigned=${r.assigned} skipped=${r.skipped_no_match}`);
    },
    onError: (e) => alert('فشل: ' + (e.response?.data?.error || e.message)),
  });

  const o = overviewQ.data || {};
  const subs   = o.subscriptions || {};
  const lvls   = o.completed_levels || {};
  const notifs = o.notifications || {};
  const rems   = o.reminders || {};
  const coords = o.coordinators || {};

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" dir="rtl">
      <PageHero
        title="لوحة متابعة الاشتراكات"
        subtitle="نظرة شاملة على كل العملاء والتنبيهات النشطة"
        icon={LayoutDashboard}
        color="violet"
      />

      {/* Admin actions */}
      {user?.role === 'admin' && (
        <SectionCard title="إجراءات الاستيراد والصيانة" icon={RefreshCw} className="mt-4">
          <div className="p-3 flex flex-wrap gap-2">
            <ModernButton onClick={() => ingestFinance.mutate()} disabled={ingestFinance.isLoading}>
              {ingestFinance.isLoading ? '...جاري الاستيراد' : 'استيراد من Finance API (Center App)'}
            </ModernButton>
            <ModernButton onClick={() => ingestExcel.mutate()} disabled={ingestExcel.isLoading}>
              {ingestExcel.isLoading ? '...جاري الاستيراد' : 'استيراد ملف Membership Excel'}
            </ModernButton>
            <ModernButton onClick={() => ingestLevels.mutate()} disabled={ingestLevels.isLoading}>
              {ingestLevels.isLoading ? '...جاري الاستيراد' : 'استيراد ملفات المستويات من Drive'}
            </ModernButton>
            <ModernButton onClick={() => runAlerts.mutate()} disabled={runAlerts.isLoading}>
              {runAlerts.isLoading ? '...' : 'فحص التنبيهات الآن'}
            </ModernButton>
            <ModernButton onClick={() => autoAssign.mutate()} disabled={autoAssign.isLoading}>
              {autoAssign.isLoading ? '...' : 'ربط منسقين تلقائياً'}
            </ModernButton>
          </div>
        </SectionCard>
      )}

      {/* Big tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <BigTile label="اشتراكات" value={subs.total_subs} sub={`${subs.distinct_clients || 0} عميل`} icon={DollarSign} color="blue" />
        <BigTile label="مستويات مستكملة" value={lvls.rows_total} sub={`${lvls.distinct_clients || 0} عميل`} icon={CheckCircle} color="emerald" />
        <BigTile label="تنبيهات نشطة" value={notifs.total_active} sub={`${notifs.critical || 0} حازم`} icon={BellRing} color="rose" />
        <BigTile label="تذكيرات معلقة" value={rems.pending} icon={Clock} color="amber" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
        <Tile label="General" value={subs.general} icon={GraduationCap} color="cyan" />
        <Tile label="Private" value={subs.private_} icon={GraduationCap} color="violet" />
        <Tile label="Semi" value={subs.semi} icon={GraduationCap} color="emerald" />
      </div>

      {/* Notifications by severity */}
      <SectionCard title="التنبيهات النشطة" icon={AlertTriangle} className="mt-4"
        action={
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="px-2 py-1 border-2 rounded text-sm"
          >
            <option value="all">الكل</option>
            <option value="critical">حازم</option>
            <option value="urgent">قوي</option>
            <option value="warning">ناعم</option>
            <option value="info">معلوماتي</option>
          </select>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-right">العميل</th>
                <th className="px-3 py-2 text-right">الموبايل</th>
                <th className="px-3 py-2 text-right">النوع</th>
                <th className="px-3 py-2 text-right">الشدة</th>
                <th className="px-3 py-2 text-right">المنسق</th>
                <th className="px-3 py-2 text-right">العنوان</th>
                <th className="px-3 py-2 text-right">منذ</th>
              </tr>
            </thead>
            <tbody>
              {atRiskQ.isLoading ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">...جاري التحميل</td></tr>
              ) : (atRiskQ.data?.clients?.length || 0) === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">مفيش تنبيهات</td></tr>
              ) : atRiskQ.data.clients.map(n => {
                const s = SEVERITY_STYLE[n.severity] || SEVERITY_STYLE.info;
                return (
                  <tr
                    key={n.id}
                    onClick={() => navigate(`/subscriptions/client/${encodeURIComponent(n.client_phone_norm)}`)}
                    className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer"
                  >
                    <td className="px-3 py-2 font-bold">{n.client_name || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{n.client_phone_norm}</td>
                    <td className="px-3 py-2 text-xs">{n.notif_type}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${s.bg} ${s.text} ${s.border}`}>{s.label}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">{n.coordinator_name || '—'}</td>
                    <td className="px-3 py-2 text-xs max-w-xs truncate" title={n.message}>{n.title}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{String(n.triggered_at || '').slice(5, 16)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Extra Courses Eligible */}
      <SectionCard title="عملاء مؤهلين لكورسات إضافية" icon={Award} className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-right">الاسم</th>
                <th className="px-3 py-2 text-right">الموبايل</th>
                <th className="px-3 py-2 text-right">شهور مدفوعة</th>
                <th className="px-3 py-2 text-right">مستويات مأخوذة</th>
                <th className="px-3 py-2 text-right">شهور متبقية</th>
                <th className="px-3 py-2 text-right">الأقسام</th>
              </tr>
            </thead>
            <tbody>
              {extraQ.isLoading ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">...جاري التحميل</td></tr>
              ) : (extraQ.data?.clients?.length || 0) === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">مفيش عملاء مؤهلين حالياً</td></tr>
              ) : extraQ.data.clients.map(c => (
                <tr
                  key={c.phone}
                  onClick={() => navigate(`/subscriptions/client/${encodeURIComponent(c.phone)}`)}
                  className="border-b border-gray-100 hover:bg-cyan-50 cursor-pointer"
                >
                  <td className="px-3 py-2 font-bold">{c.name || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.phone}</td>
                  <td className="px-3 py-2 tabular-nums">{c.paid_months}</td>
                  <td className="px-3 py-2 tabular-nums">{c.completed_count}</td>
                  <td className="px-3 py-2 tabular-nums font-bold text-cyan-700">{c.overflow_months}</td>
                  <td className="px-3 py-2 text-xs">{(c.depts || []).join('، ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function BigTile({ label, value, sub, icon: Icon, color = 'blue' }) {
  const palette = {
    blue:    'from-blue-50 to-blue-100 text-blue-900 border-blue-200',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-900 border-emerald-200',
    rose:    'from-rose-50 to-rose-100 text-rose-900 border-rose-200',
    amber:   'from-amber-50 to-amber-100 text-amber-900 border-amber-200',
  };
  return (
    <div className={`bg-gradient-to-br ${palette[color]} border-2 rounded-2xl p-4`}>
      <div className="flex items-center justify-between">
        <Icon size={28} className="opacity-70" />
        <p className="text-3xl font-black tabular-nums">{value != null ? Number(value).toLocaleString('ar-EG') : '—'}</p>
      </div>
      <p className="text-sm font-bold mt-2">{label}</p>
      {sub && <p className="text-[11px] opacity-70 mt-1">{sub}</p>}
    </div>
  );
}

function Tile({ label, value, icon: Icon, color = 'blue' }) {
  const palette = {
    cyan:    'bg-cyan-50 text-cyan-900 border-cyan-200',
    violet:  'bg-violet-50 text-violet-900 border-violet-200',
    emerald: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  };
  return (
    <div className={`${palette[color]} border-2 rounded-xl p-3 flex items-center gap-2`}>
      <Icon size={20} className="opacity-70" />
      <div>
        <p className="text-[11px] font-bold opacity-70">{label}</p>
        <p className="text-xl font-black tabular-nums">{value != null ? Number(value).toLocaleString('ar-EG') : '—'}</p>
      </div>
    </div>
  );
}
