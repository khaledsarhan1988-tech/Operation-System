import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Users, Globe, ClipboardList, AlertTriangle, Clock, RefreshCw, Video } from 'lucide-react';
import api from '../../api/axios';
import StatCard from '../../components/ui/StatCard';

export default function AdminDashboard() {
  const { t } = useTranslation();

  const { data: kpis, isLoading, refetch } = useQuery({
    queryKey: ['admin-kpis'],
    queryFn: () => api.get('/admin/kpis').then(r => r.data),
    refetchInterval: 60000,
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">{t('nav.dashboard')}</h1>
        <button onClick={() => refetch()} className="btn-outline flex items-center gap-2 text-sm">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={t('stats.totalClients')}      value={kpis?.total_clients}         icon={Users}        color="primary" />
        <StatCard label={t('stats.activeGroups')}      value={kpis?.total_batches}         icon={Globe}        color="success" />
        <StatCard label={t('stats.totalTasks')}        value={kpis?.total_remarks}         icon={ClipboardList}color="primary" />
        <StatCard label={t('stats.pending')}           value={kpis?.pending_remarks}       icon={Clock}        color="warning" />
        <StatCard label={t('stats.overdue')}           value={kpis?.overdue_remarks}       icon={AlertTriangle}color="danger" />
        <StatCard label={t('stats.totalAgents')}       value={kpis?.total_agents}          icon={Users}        color="primary" />
        <StatCard label={t('stats.absentPending')}     value={kpis?.absent_pending}        icon={AlertTriangle}color="danger" />
        <StatCard label={t('stats.sessionChecksToday')}value={kpis?.session_checks_today}  icon={Video}        color="success" />
      </div>

      <div className="card">
        <h2 className="font-semibold text-text-primary mb-2">System Status</h2>
        <div className="flex items-center gap-3 text-sm">
          <div className="w-2 h-2 rounded-full bg-success" />
          <span className="text-text-secondary">Last sync: {kpis?.last_sync ? new Date(kpis.last_sync).toLocaleString() : 'Never'}</span>
        </div>
      </div>
    </div>
  );
}
