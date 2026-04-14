import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Users, ClipboardList, UserX, Globe, AlertTriangle, AlertOctagon } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import api from '../../api/axios';
import StatCard from '../../components/ui/StatCard';

const PROB_STATUS = {
  new:         { label: 'جديد',       cls: 'bg-red-100 text-red-700 border-red-200' },
  reported:    { label: 'تم الإبلاغ', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  in_progress: { label: 'قيد الحل',   cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  wont_repeat: { label: 'لن تتكرر',   cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  exception:   { label: 'استثناء',    cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  resolved:    { label: 'تم حلها',    cls: 'bg-green-100 text-green-700 border-green-200' },
};

export default function LeaderDashboard() {
  const { t } = useTranslation();
  const [fEmployee, setFEmployee] = useState('');

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

  const { data: codeProblems } = useQuery({
    queryKey: ['leader-code-problems', fEmployee],
    queryFn: () => api.get('/reports/code-problems', {
      params: fEmployee ? { employee: fEmployee } : {},
    }).then(r => r.data),
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

  const totalTasks   = team?.reduce((a, b) => a + (b.total || 0), 0) || 0;
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

      {/* Code Problems */}
      <div className="card">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <AlertOctagon size={18} className="text-danger" />
            <h2 className="font-semibold text-text-primary">أكواد فيها مشكلة</h2>
            {allProblems.length > 0 && (
              <span className="bg-red-100 text-red-700 text-xs font-bold px-2.5 py-1 rounded-full border border-red-200">
                {allProblems.length}
              </span>
            )}
          </div>

          {/* Employee filter */}
          <select
            value={fEmployee}
            onChange={e => setFEmployee(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-white text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">كل الموظفين</option>
            {(team ?? []).map(a => (
              <option key={a.id} value={a.name}>{a.name}</option>
            ))}
          </select>
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
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {p.coordinators && (
                      <span className="text-xs text-text-secondary hidden sm:block">{p.coordinators}</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cfg.cls}`}>
                      {cfg.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
