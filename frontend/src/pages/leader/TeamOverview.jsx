import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Modal from '../../components/ui/Modal';

function AssignModal({ open, onClose, onAssign }) {
  const { t } = useTranslation();
  const [remarkId, setRemarkId] = useState('');
  const [agentName, setAgentName] = useState('');

  const { data: agents } = useQuery({
    queryKey: ['leader-team'],
    queryFn: () => api.get('/leader/team').then(r => r.data),
  });

  const handleAssign = async () => {
    if (!remarkId || !agentName) return;
    await api.post('/leader/assign', { remark_id: parseInt(remarkId), agent_name: agentName });
    onAssign?.();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t('leader.assign')}>
      <div className="space-y-4">
        <div>
          <label className="label">Remark ID</label>
          <input type="number" className="input" value={remarkId} onChange={e => setRemarkId(e.target.value)} />
        </div>
        <div>
          <label className="label">{t('leader.selectAgent')}</label>
          <select className="input" value={agentName} onChange={e => setAgentName(e.target.value)}>
            <option value="">— Select —</option>
            {agents?.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
          </select>
        </div>
        <div className="flex gap-3">
          <button onClick={handleAssign} className="btn-primary flex-1">{t('leader.assign')}</button>
          <button onClick={onClose} className="btn-outline">{t('tasks.cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

export default function TeamOverview() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showAssign, setShowAssign] = useState(false);

  const { data: team, isLoading, refetch } = useQuery({
    queryKey: ['leader-team'],
    queryFn: () => api.get('/leader/team').then(r => r.data),
  });

  const handleExport = () => {
    window.open(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/export/team-performance`, '_blank');
  };

  const columns = [
    { key: 'name',            label: t('leader.agent') },
    { key: 'total',           label: t('leader.totalTasks') },
    { key: 'pending',         label: t('leader.pending'),   render: v => <span className="font-semibold text-warning">{v}</span> },
    { key: 'done',            label: t('leader.completed'), render: v => <span className="text-success font-semibold">{v}</span> },
    { key: 'completed_today', label: 'Today',              render: v => <span className="text-primary font-semibold">{v}</span> },
    { key: 'overdue',         label: t('leader.overdue'),   render: v => v > 0 ? <span className="font-semibold text-danger">{v}</span> : '—' },
  ];

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-text-primary">{t('leader.teamOverview')}</h1>
        <div className="flex gap-2">
          <button onClick={() => refetch()} className="btn-outline flex items-center gap-2 text-sm">
            <RefreshCw size={14} />
          </button>
          <button onClick={handleExport} className="btn-outline flex items-center gap-2 text-sm">
            <Download size={14} /> {t('common.export')}
          </button>
          <button onClick={() => setShowAssign(true)} className="btn-primary text-sm">
            {t('leader.assign')}
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

      <AssignModal open={showAssign} onClose={() => setShowAssign(false)} onAssign={() => qc.invalidateQueries(['leader-team'])} />
    </div>
  );
}
