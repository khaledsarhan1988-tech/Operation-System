import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ClipboardList, Clock, CheckCircle, AlertTriangle, Zap,
  LayoutDashboard, Calendar, CheckCircle2,
} from 'lucide-react';
import api from '../../api/axios';
import StatCard from '../../components/ui/StatCard';
import Badge from '../../components/ui/Badge';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';
import { format } from 'date-fns';

export default function AgentDashboard() {
  const { t } = useTranslation();
  const today = format(new Date(), 'yyyy-MM-dd');
  const todayLabelAr = new Date().toLocaleDateString('ar-EG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const { data: stats } = useQuery({
    queryKey: ['agent-stats'],
    queryFn: () => api.get('/agent/stats').then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: urgentTasks } = useQuery({
    queryKey: ['agent-urgent-tasks'],
    queryFn: () => api.get('/agent/tasks?priority=عاجلة&status=pending&limit=5').then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: schedule } = useQuery({
    queryKey: ['agent-schedule', today],
    queryFn: () => api.get(`/agent/schedule?date=${today}`).then(r => r.data),
  });

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title={t('nav.dashboard')}
        subtitle={todayLabelAr}
        icon={LayoutDashboard}
        gradient="navy"
      />

      {/* Stats — same data, modern cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={t('stats.totalTasks')}    value={stats?.total}           icon={ClipboardList} color="primary" />
        <StatCard label={t('stats.pending')}        value={stats?.pending}         icon={Clock}         color="amber"   />
        <StatCard label={t('stats.completedToday')} value={stats?.completed_today} icon={CheckCircle}   color="emerald" />
        <StatCard label={t('stats.overdue')}        value={stats?.overdue}         icon={AlertTriangle} color="rose"    />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Urgent Tasks */}
        <SectionCard title={t('stats.urgentPending')} icon={Zap} accent="rose">
          {urgentTasks?.data?.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              accent="emerald"
              title="مفيش مهام عاجلة"
              message="ممتاز! كل المهام العاجلة منتهية."
              compact
            />
          ) : (
            <div className="space-y-2.5">
              {urgentTasks?.data?.map(task => (
                <div key={task.id} className="flex items-start gap-3 p-3.5 bg-gray-50 hover:bg-gray-100/70 rounded-2xl border border-gray-100 transition-colors">
                  <Badge value={task.sla_status} ns="sla" className="mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-gray-800 truncate">{task.client_name}</p>
                    <p className="text-xs text-gray-500 font-bold truncate">{task.task_type}</p>
                    {task.details && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{task.details}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Today's Schedule */}
        <SectionCard title={t('nav.todaySchedule')} icon={Calendar} accent="blue">
          {!schedule?.length ? (
            <EmptyState
              icon={Calendar}
              accent="blue"
              title="مفيش جلسات النهارده"
              message="جدولك فاضي."
              compact
            />
          ) : (
            <div className="space-y-2.5">
              {schedule.slice(0, 5).map((s, i) => (
                <div key={i} className="flex items-center gap-3 p-3.5 bg-gray-50 hover:bg-gray-100/70 rounded-2xl border border-gray-100 transition-colors">
                  <div className="text-xs font-mono font-black text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1 w-20 text-center flex-shrink-0">
                    {s.time}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black text-gray-800 truncate">{s.group_name}</p>
                    <p className="text-xs text-gray-500 font-bold">{s.trainer}</p>
                  </div>
                  <Badge value={s.session_type} ns="schedule" />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
