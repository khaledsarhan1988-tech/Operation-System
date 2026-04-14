import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';

export default function TaskDistribution() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [coordinator, setCoordinator] = useState('');

  const { data: allTeam } = useQuery({
    queryKey: ['leader-team-all'],
    queryFn: () => api.get('/leader/team').then(r => r.data),
  });

  const { data: team, isLoading } = useQuery({
    queryKey: ['leader-team', coordinator],
    queryFn: () => api.get('/leader/team', { params: coordinator ? { coordinator } : {} }).then(r => r.data),
  });

  const handleExport = () => {
    const params = new URLSearchParams();
    if (coordinator) params.set('coordinator', coordinator);
    window.open(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/export/remarks?${params}`, '_blank');
  };

  const selectCls = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] min-w-[180px]';

  const columns = [
    { key: 'name',    label: t('leader.agent') },
    { key: 'total',   label: t('leader.totalTasks') },
    { key: 'pending', label: t('leader.pending'), render: v => <span className="font-bold text-warning">{v}</span> },
    { key: 'overdue', label: t('leader.overdue'), render: v => v > 0 ? <span className="font-bold text-danger">{v}</span> : '—' },
    { key: 'urgent',  label: t('tasks.urgent'),   render: v => v > 0 ? <span className="font-bold text-danger">{v}</span> : '—' },
  ];

  return (
    <div className="space-y-5 animate-fadeIn" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-text-primary">{t('nav.taskDistribution')}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={coordinator}
            onChange={e => setCoordinator(e.target.value)}
            className={`${selectCls} ${coordinator ? 'ring-2 ring-[#1e3a5f]/30 border-[#1e3a5f] font-bold' : ''}`}
          >
            <option value="">كل المنسقين</option>
            {(allTeam ?? []).map((a, i) => (
              <option key={i} value={a.name}>{a.name}</option>
            ))}
          </select>
          <button onClick={handleExport} className="btn-outline flex items-center gap-2 text-sm">
            <Download size={14} /> {t('common.export')}
          </button>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <DataTable
          columns={columns}
          data={team}
          total={team?.length || 0}
          page={1}
          limit={100}
          onPageChange={() => {}}
          loading={isLoading}
        />
      </div>
    </div>
  );
}
