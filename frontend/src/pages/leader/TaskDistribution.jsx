import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';

export default function TaskDistribution() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [agentFilter, setAgentFilter] = useState('');

  const { data: team } = useQuery({
    queryKey: ['leader-team'],
    queryFn: () => api.get('/leader/team').then(r => r.data),
  });

  const handleExport = () => {
    const params = new URLSearchParams();
    if (agentFilter) params.set('agent', agentFilter);
    window.open(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/export/remarks?${params}`, '_blank');
  };

  const handleAssign = async (remarkId, agentName) => {
    await api.post('/leader/assign', { remark_id: remarkId, agent_name: agentName });
    qc.invalidateQueries(['leader-team']);
  };

  const columns = [
    { key: 'name', label: t('leader.agent') },
    { key: 'total', label: t('leader.totalTasks') },
    { key: 'pending', label: t('leader.pending'), render: v => <span className="font-bold text-warning">{v}</span> },
    { key: 'overdue', label: t('leader.overdue'), render: v => v > 0 ? <span className="font-bold text-danger">{v}</span> : '—' },
    { key: 'urgent', label: t('tasks.urgent'), render: v => v > 0 ? <span className="font-bold text-danger">{v}</span> : '—' },
  ];

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-text-primary">{t('nav.taskDistribution')}</h1>
        <button onClick={handleExport} className="btn-outline flex items-center gap-2 text-sm">
          <Download size={14} /> {t('common.export')}
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        <DataTable
          columns={columns}
          data={team}
          total={team?.length || 0}
          page={1}
          limit={100}
          onPageChange={() => {}}
          loading={false}
        />
      </div>
    </div>
  );
}
