import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, Users, Filter, UserPlus } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Modal from '../../components/ui/Modal';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import ModernButton from '../../components/ui/ModernButton';

function AssignModal({ open, onClose, onAssign }) {
  const { t } = useTranslation();
  const [remarkId, setRemarkId] = useState('');
  const [agentName, setAgentName] = useState('');

  const { data: agents } = useQuery({
    queryKey: ['leader-team-all'],
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
  const [coordinator, setCoordinator] = useState('');

  const { data: allTeam } = useQuery({
    queryKey: ['leader-team-all'],
    queryFn: () => api.get('/leader/team').then(r => r.data),
  });

  const { data: team, isLoading, refetch } = useQuery({
    queryKey: ['leader-team', coordinator],
    queryFn: () => api.get('/leader/team', { params: coordinator ? { coordinator } : {} }).then(r => r.data),
  });

  const handleExport = () => {
    window.open(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/export/team-performance`, '_blank');
  };

  const selectCls = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] min-w-[180px]';

  const columns = [
    { key: 'name',            label: t('leader.agent') },
    { key: 'total',           label: t('leader.totalTasks') },
    { key: 'pending',         label: t('leader.pending'),   render: v => <span className="font-semibold text-warning">{v}</span> },
    { key: 'done',            label: t('leader.completed'), render: v => <span className="text-success font-semibold">{v}</span> },
    { key: 'completed_today', label: 'Today',               render: v => <span className="text-primary font-semibold">{v}</span> },
    { key: 'overdue',         label: t('leader.overdue'),   render: v => v > 0 ? <span className="font-semibold text-danger">{v}</span> : '—' },
  ];

  const headerActions = (
    <>
      <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl pr-3 py-1">
        <Filter size={13} className="text-white/70" />
        <select
          value={coordinator}
          onChange={e => setCoordinator(e.target.value)}
          className="bg-transparent text-white text-xs font-bold focus:outline-none cursor-pointer min-w-[140px] py-1"
        >
          <option value="" className="text-gray-700">كل المنسقين</option>
          {(allTeam ?? []).map((a, i) => (
            <option key={i} value={a.name} className="text-gray-700">{a.name}</option>
          ))}
        </select>
      </div>
      <ModernButton variant="glass" icon={RefreshCw} onClick={() => refetch()}>تحديث</ModernButton>
      <ModernButton variant="glass" icon={Download} onClick={handleExport}>{t('common.export')}</ModernButton>
      <ModernButton variant="amber" icon={UserPlus} onClick={() => setShowAssign(true)}>{t('leader.assign')}</ModernButton>
    </>
  );

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title={t('leader.teamOverview')}
        subtitle="نظرة شاملة على أداء كل أفراد الفريق"
        icon={Users}
        gradient="navy"
        actions={headerActions}
      />

      <SectionCard title="فريق العمل" icon={Users} accent="indigo" noBodyPad>
        <DataTable
          columns={columns}
          data={team}
          total={team?.length || 0}
          page={1}
          limit={100}
          onPageChange={() => {}}
          loading={isLoading}
        />
      </SectionCard>

      <AssignModal open={showAssign} onClose={() => setShowAssign(false)} onAssign={() => qc.invalidateQueries(['leader-team'])} />
    </div>
  );
}
