import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, ClipboardList, Filter } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import ModernButton from '../../components/ui/ModernButton';

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

  const columns = [
    { key: 'name',    label: t('leader.agent') },
    { key: 'total',   label: t('leader.totalTasks') },
    { key: 'pending', label: t('leader.pending'), render: v => <span className="font-black text-amber-600">{v}</span> },
    { key: 'overdue', label: t('leader.overdue'), render: v => v > 0 ? <span className="font-black text-red-600">{v}</span> : '—' },
    { key: 'urgent',  label: t('tasks.urgent'),   render: v => v > 0 ? <span className="font-black text-red-600">{v}</span> : '—' },
  ];

  const filterEl = (
    <>
      <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl pr-3 py-1">
        <Filter size={13} className="text-white/70" />
        <select
          value={coordinator}
          onChange={e => setCoordinator(e.target.value)}
          className="bg-transparent text-white text-xs font-bold focus:outline-none cursor-pointer min-w-[160px] py-1"
        >
          <option value="" className="text-gray-700">كل المنسقين</option>
          {(allTeam ?? []).map((a, i) => (
            <option key={i} value={a.name} className="text-gray-700">{a.name}</option>
          ))}
        </select>
      </div>
      <ModernButton variant="glass" icon={Download} onClick={handleExport}>
        {t('common.export')}
      </ModernButton>
    </>
  );

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title={t('nav.taskDistribution')}
        subtitle="توزيع المهام على فريقك"
        icon={ClipboardList}
        gradient="navy"
        actions={filterEl}
      />

      <SectionCard title="توزيع المهام" icon={ClipboardList} accent="indigo" noBodyPad>
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
    </div>
  );
}
