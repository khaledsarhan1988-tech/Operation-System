import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Users, Globe, ClipboardList, AlertTriangle, Clock, RefreshCw, Video,
  LayoutDashboard, CheckCircle2, Activity,
} from 'lucide-react';
import api from '../../api/axios';
import StatCard from '../../components/ui/StatCard';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import ModernButton from '../../components/ui/ModernButton';

export default function AdminDashboard() {
  const { t } = useTranslation();

  const { data: kpis, isLoading, refetch } = useQuery({
    queryKey: ['admin-kpis'],
    queryFn: () => api.get('/admin/kpis').then(r => r.data),
    refetchInterval: 60000,
  });

  const base = '/admin/dashboard/details';
  const lastSyncStr = kpis?.last_sync ? new Date(kpis.last_sync).toLocaleString('ar-EG') : 'لم يتم';

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title={t('nav.dashboard')}
        subtitle="نظرة عامة على المؤشّرات الرئيسية"
        icon={LayoutDashboard}
        gradient="navy"
        actions={
          <ModernButton variant="glass" icon={RefreshCw} onClick={() => refetch()}>
            تحديث
          </ModernButton>
        }
      />

      {/* KPI grid — preserved data unchanged */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={t('stats.totalClients')}       value={kpis?.total_clients}        icon={Users}         color="primary" to={`${base}/clients`}              loading={isLoading} />
        <StatCard label={t('stats.activeGroups')}       value={kpis?.total_batches}        icon={Globe}         color="emerald" to={`${base}/batches`}              loading={isLoading} />
        <StatCard label={t('stats.totalTasks')}         value={kpis?.total_remarks}        icon={ClipboardList} color="primary" to={`${base}/remarks`}              loading={isLoading} />
        <StatCard label={t('stats.pending')}            value={kpis?.pending_remarks}      icon={Clock}         color="amber"   to={`${base}/pending-remarks`}      loading={isLoading} />
        <StatCard label={t('stats.overdue')}            value={kpis?.overdue_remarks}      icon={AlertTriangle} color="rose"    to={`${base}/overdue-remarks`}      loading={isLoading} />
        <StatCard label={t('stats.totalAgents')}        value={kpis?.total_agents}         icon={Users}         color="cyan"    to={`${base}/agents`}               loading={isLoading} />
        <StatCard label={t('stats.absentPending')}      value={kpis?.absent_pending}       icon={AlertTriangle} color="rose"    to={`${base}/absent-pending`}       loading={isLoading} />
        <StatCard label={t('stats.sessionChecksToday')} value={kpis?.session_checks_today} icon={Video}         color="emerald" to={`${base}/session-checks-today`} loading={isLoading} />
      </div>

      {/* System status — modern card */}
      <SectionCard title="حالة النظام" subtitle="آخر مزامنة وأنشطة السيرفر" icon={Activity} accent="emerald">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2.5">
            <span className="relative inline-flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-sm font-black text-emerald-800">السيستم يعمل بشكل طبيعي</span>
          </div>

          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5">
            <CheckCircle2 size={14} className="text-gray-500" />
            <span className="text-xs font-black text-gray-600">آخر مزامنة:</span>
            <span className="text-xs font-black text-gray-800">{lastSyncStr}</span>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
