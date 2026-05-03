import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Globe, Filter } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';

export default function GroupCoverage() {
  const { t } = useTranslation();
  const [coordinator, setCoordinator] = useState('');

  const { data: allTeam } = useQuery({
    queryKey: ['leader-team-all'],
    queryFn: () => api.get('/leader/team').then(r => r.data),
  });

  const { data: groups, isLoading } = useQuery({
    queryKey: ['leader-groups', coordinator],
    queryFn: () => api.get('/leader/groups', { params: coordinator ? { coordinator } : {} }).then(r => r.data),
  });

  const columns = [
    { key: 'external_id',  label: '#',                    render: v => <span className="text-gray-400 text-xs font-bold">{v}</span> },
    { key: 'group_name',   label: t('leader.groupName'),  render: v => <span className="text-xs font-mono font-black">{v}</span> },
    { key: 'course',       label: t('leader.course') },
    { key: 'dept_type',    label: 'Type',                 render: v => v ? <Badge value={v === 'General' ? 'نشطة' : 'مجدولة'} /> : '—' },
    { key: 'trainers',     label: 'Trainer',              render: v => <span className="text-xs">{v}</span> },
    { key: 'coordinators', label: t('leader.coordinator'), render: v => <span className="text-xs">{v}</span> },
    { key: 'trainee_count',        label: t('leader.trainees'),  render: (v, row) => `${v}/${row.max_trainees}` },
    { key: 'completed_lectures',   label: 'Lectures',            render: (v, row) => `${v}/${row.scheduled_lectures}` },
    { key: 'start_date',           label: t('leader.startDate'), render: v => v?.slice(0,10) },
    { key: 'status',               label: 'Status',              render: v => <Badge value={v} /> },
  ];

  const filterEl = (
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
  );

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title={t('nav.groupCoverage')}
        subtitle={`${groups?.length || 0} مجموعة نشطة`}
        icon={Globe}
        gradient="cyan"
        actions={filterEl}
      />

      <SectionCard title="جميع المجموعات" icon={Globe} accent="cyan" noBodyPad>
        <DataTable
          columns={columns}
          data={groups}
          total={groups?.length || 0}
          page={1}
          limit={200}
          onPageChange={() => {}}
          loading={isLoading}
        />
      </SectionCard>
    </div>
  );
}
