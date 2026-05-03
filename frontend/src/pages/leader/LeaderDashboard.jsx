import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Users, ClipboardList, UserX, Globe, AlertTriangle, LayoutDashboard,
  BarChart3, PieChart as PieIcon, Filter,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import api from '../../api/axios';
import StatCard from '../../components/ui/StatCard';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';

export default function LeaderDashboard() {
  const { t } = useTranslation();
  const [coordinator, setCoordinator] = useState('');

  // list for dropdown (always unfiltered)
  const { data: allTeam } = useQuery({
    queryKey: ['leader-team-all'],
    queryFn: () => api.get('/leader/team').then(r => r.data),
  });

  const { data: team } = useQuery({
    queryKey: ['leader-team', coordinator],
    queryFn: () => api.get('/leader/team', { params: coordinator ? { coordinator } : {} }).then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: groups } = useQuery({
    queryKey: ['leader-groups', coordinator],
    queryFn: () => api.get('/leader/groups', { params: coordinator ? { coordinator } : {} }).then(r => r.data),
  });

  const { data: absentReport } = useQuery({
    queryKey: ['leader-absent-dash', coordinator],
    queryFn: () => api.get('/leader/absent-report', {
      params: { status: 'pending', limit: 1, ...(coordinator ? { coordinator } : {}) }
    }).then(r => r.data),
  });

  const totalTasks   = team?.reduce((a, b) => a + (b.total || 0), 0) || 0;
  const totalPending = team?.reduce((a, b) => a + (b.pending || 0), 0) || 0;

  const barData = team?.slice(0, 8).map(a => ({
    name: a.name?.split(' ')[0],
    pending: a.pending || 0,
    done:    a.done    || 0,
  })) || [];

  const COLORS = ['#F59E0B', '#10B981'];

  const filterEl = (
    <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl pr-3 py-1">
      <Filter size={14} className="text-white/70" />
      <select
        value={coordinator}
        onChange={e => setCoordinator(e.target.value)}
        className="bg-transparent text-white text-sm font-bold focus:outline-none cursor-pointer min-w-[160px] py-1"
      >
        <option value="" className="text-gray-700">كل المنسقين</option>
        {(allTeam ?? []).map((a, i) => (
          <option key={i} value={a.name} className="text-gray-700">{a.name}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title={t('nav.dashboard')}
        subtitle="نظرة سريعة على فريقك ومجموعاتك"
        icon={LayoutDashboard}
        gradient="navy"
        actions={filterEl}
      />

      {/* Stats — preserved data unchanged */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={t('stats.totalTasks')}    value={totalTasks}          icon={ClipboardList} color="primary" />
        <StatCard label={t('stats.pending')}        value={totalPending}        icon={AlertTriangle} color="amber"   />
        <StatCard label={t('stats.absentPending')} value={absentReport?.total} icon={UserX}         color="rose"    />
        <StatCard label={t('stats.activeGroups')}  value={groups?.length}      icon={Globe}         color="emerald" />
      </div>

      {/* Charts — modernized cards, same data */}
      <div className="grid lg:grid-cols-2 gap-5">
        <SectionCard title={t('leader.teamOverview')} icon={BarChart3} accent="indigo">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fontWeight: 700 }} stroke="#94A3B8" />
              <YAxis tick={{ fontSize: 11, fontWeight: 700 }} stroke="#94A3B8" />
              <Tooltip
                contentStyle={{
                  background: 'rgba(15, 23, 42, 0.95)',
                  border: 'none', borderRadius: 12, color: '#fff',
                  fontWeight: 700, fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
              <Bar dataKey="pending" fill={COLORS[0]} name={t('tasks.pending')} radius={[8, 8, 0, 0]} />
              <Bar dataKey="done"    fill={COLORS[1]} name={t('tasks.done')}    radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="توزيع المهام" icon={PieIcon} accent="violet">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={[
                  { name: t('tasks.pending'), value: totalPending },
                  { name: t('tasks.done'),    value: totalTasks - totalPending },
                ]}
                cx="50%" cy="50%"
                innerRadius={60} outerRadius={95}
                dataKey="value"
                paddingAngle={2}
              >
                {COLORS.map((color, i) => <Cell key={i} fill={color} />)}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: 'rgba(15, 23, 42, 0.95)',
                  border: 'none', borderRadius: 12, color: '#fff',
                  fontWeight: 700, fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>
    </div>
  );
}
