import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Users, ClipboardList, UserX, Globe, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import api from '../../api/axios';
import StatCard from '../../components/ui/StatCard';

export default function LeaderDashboard() {
  const { t } = useTranslation();

  const { data: team } = useQuery({
    queryKey: ['leader-team'],
    queryFn: () => api.get('/leader/team').then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: groups } = useQuery({
    queryKey: ['leader-groups'],
    queryFn: () => api.get('/leader/groups').then(r => r.data),
  });

  const { data: absentReport } = useQuery({
    queryKey: ['leader-absent', { status: 'pending', page: 1 }],
    queryFn: () => api.get('/leader/absent-report?status=pending&limit=1').then(r => r.data),
  });

  const totalTasks  = team?.reduce((a, b) => a + (b.total || 0), 0) || 0;
  const totalPending = team?.reduce((a, b) => a + (b.pending || 0), 0) || 0;

  const barData = team?.slice(0, 8).map(a => ({
    name: a.name?.split(' ')[0],
    pending: a.pending || 0,
    done:    a.done    || 0,
  })) || [];

  const COLORS = ['#E67E22', '#27AE60'];

  return (
    <div className="space-y-6 animate-fadeIn">
      <h1 className="text-xl font-bold text-text-primary">{t('nav.dashboard')}</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={t('stats.totalTasks')}   value={totalTasks}          icon={ClipboardList} color="primary" />
        <StatCard label={t('stats.pending')}       value={totalPending}        icon={AlertTriangle} color="warning" />
        <StatCard label={t('stats.absentPending')} value={absentReport?.total} icon={UserX}         color="danger"  />
        <StatCard label={t('stats.activeGroups')}  value={groups?.length}      icon={Globe}         color="success" />
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="font-semibold text-text-primary mb-4">{t('leader.teamOverview')}</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="pending" fill="#E67E22" name={t('tasks.pending')} radius={[4,4,0,0]} />
              <Bar dataKey="done"    fill="#27AE60" name={t('tasks.done')}    radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2 className="font-semibold text-text-primary mb-4">Tasks Distribution</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={[
                  { name: t('tasks.pending'), value: totalPending },
                  { name: t('tasks.done'),    value: totalTasks - totalPending },
                ]}
                cx="50%" cy="50%"
                innerRadius={60} outerRadius={90}
                dataKey="value"
              >
                {COLORS.map((color, i) => <Cell key={i} fill={color} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
