import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Clock, CheckCircle, AlertTriangle, Zap, AlertOctagon } from 'lucide-react';
import api from '../../api/axios';
import StatCard from '../../components/ui/StatCard';
import Badge from '../../components/ui/Badge';
import { useAuth } from '../../auth/AuthContext';
import { format } from 'date-fns';

const PROB_STATUS = {
  new:         { label: 'جديد',       cls: 'bg-red-100 text-red-700 border-red-200' },
  reported:    { label: 'تم الإبلاغ', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  in_progress: { label: 'قيد الحل',   cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  wont_repeat: { label: 'لن تتكرر',   cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  exception:   { label: 'استثناء',    cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  resolved:    { label: 'تم حلها',    cls: 'bg-green-100 text-green-700 border-green-200' },
};

export default function AgentDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const today = format(new Date(), 'yyyy-MM-dd');

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

  const { data: codeProblems } = useQuery({
    queryKey: ['agent-code-problems', user?.id],
    queryFn: () => api.get('/reports/code-problems', { params: { coordinator_user_id: user?.id } }).then(r => r.data),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: statusData } = useQuery({
    queryKey: ['problem-statuses'],
    queryFn: () => api.get('/reports/problem-statuses').then(r => r.data),
    staleTime: 60 * 1000,
  });

  // Build status map
  const statusMap = {};
  (statusData ?? []).forEach(s => {
    statusMap[`${s.group_name}|${s.problem_type}|${s.session_type}`] = s;
  });

  const getStatusKey = (p, session) => {
    const stored = statusMap[`${p.group_name}|${p.problem_type}|${session}`];
    return p._resolved_status ?? stored?.status ?? 'new';
  };

  const allProblems = [
    ...(codeProblems?.main_problems ?? []).map(p => ({ ...p, _sess: 'main' })),
    ...(codeProblems?.zoom_problems ?? []).map(p => ({ ...p, _sess: 'side' })),
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-xl font-bold text-text-primary">{t('nav.dashboard')}</h1>
        <p className="text-text-secondary text-sm">{format(new Date(), 'EEEE, dd MMMM yyyy')}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={t('stats.totalTasks')}    value={stats?.total}           icon={ClipboardList} color="primary" />
        <StatCard label={t('stats.pending')}        value={stats?.pending}         icon={Clock}         color="warning" />
        <StatCard label={t('stats.completedToday')} value={stats?.completed_today} icon={CheckCircle}   color="success" />
        <StatCard label={t('stats.overdue')}        value={stats?.overdue}         icon={AlertTriangle} color="danger" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Urgent Tasks */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={18} className="text-danger" />
            <h2 className="font-semibold text-text-primary">{t('stats.urgentPending')}</h2>
          </div>
          {urgentTasks?.data?.length === 0 ? (
            <p className="text-text-secondary text-sm py-4 text-center">{t('tasks.noTasks')} ✓</p>
          ) : (
            <div className="space-y-2">
              {urgentTasks?.data?.map(task => (
                <div key={task.id} className="flex items-start gap-3 p-3 bg-surface rounded-lg border border-border">
                  <Badge value={task.sla_status} ns="sla" className="mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary truncate">{task.client_name}</p>
                    <p className="text-xs text-text-secondary truncate">{task.task_type}</p>
                    {task.details && <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">{task.details}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Today's Schedule */}
        <div className="card">
          <h2 className="font-semibold text-text-primary mb-4">{t('nav.todaySchedule')}</h2>
          {!schedule?.length ? (
            <p className="text-text-secondary text-sm py-4 text-center">{t('schedule.noSchedule')}</p>
          ) : (
            <div className="space-y-2">
              {schedule.slice(0, 5).map((s, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-surface rounded-lg border border-border">
                  <div className="text-xs font-mono text-primary font-semibold w-16 flex-shrink-0">{s.time}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-text-primary truncate">{s.group_name}</p>
                    <p className="text-xs text-text-secondary">{s.trainer}</p>
                  </div>
                  <Badge value={s.session_type} ns="schedule" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Code Problems */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertOctagon size={18} className="text-danger" />
            <h2 className="font-semibold text-text-primary">أكواد فيها مشكلة</h2>
          </div>
          {allProblems.length > 0 && (
            <span className="bg-red-100 text-red-700 text-xs font-bold px-2.5 py-1 rounded-full border border-red-200">
              {allProblems.length}
            </span>
          )}
        </div>
        {allProblems.length === 0 ? (
          <p className="text-text-secondary text-sm py-4 text-center">لا توجد مشاكل ✓</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {allProblems.map((p, i) => {
              const sk  = getStatusKey(p, p._sess);
              const cfg = PROB_STATUS[sk] ?? PROB_STATUS.new;
              return (
                <div key={i} className="flex items-center gap-3 p-3 bg-surface rounded-lg border border-border">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-text-primary truncate">{p.group_name}</p>
                    <p className="text-xs text-text-secondary truncate">{p.problem_type}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ${cfg.cls}`}>
                    {cfg.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
