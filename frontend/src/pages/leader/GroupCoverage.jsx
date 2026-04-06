import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';

export default function GroupCoverage() {
  const { t } = useTranslation();

  const { data: groups, isLoading } = useQuery({
    queryKey: ['leader-groups'],
    queryFn: () => api.get('/leader/groups').then(r => r.data),
  });

  const columns = [
    { key: 'external_id', label: '#', render: v => <span className="text-text-secondary text-xs">{v}</span> },
    { key: 'group_name', label: t('leader.groupName'), render: v => <span className="text-xs font-mono">{v}</span> },
    { key: 'course', label: t('leader.course') },
    { key: 'dept_type', label: 'Type', render: v => v ? <Badge value={v === 'General' ? 'نشطة' : 'مجدولة'} /> : '—' },
    { key: 'trainers', label: 'Trainer', render: v => <span className="text-xs">{v}</span> },
    { key: 'coordinators', label: t('leader.coordinator'), render: v => <span className="text-xs">{v}</span> },
    { key: 'trainee_count', label: t('leader.trainees'), render: (v, row) => `${v}/${row.max_trainees}` },
    { key: 'completed_lectures', label: 'Lectures', render: (v, row) => `${v}/${row.scheduled_lectures}` },
    { key: 'start_date', label: t('leader.startDate'), render: v => v?.slice(0,10) },
    { key: 'status', label: 'Status', render: v => <Badge value={v} /> },
  ];

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">{t('nav.groupCoverage')}</h1>
        <p className="text-text-secondary text-sm">{groups?.length || 0} active groups</p>
      </div>
      <div className="card p-0 overflow-hidden">
        <DataTable
          columns={columns}
          data={groups}
          total={groups?.length || 0}
          page={1}
          limit={200}
          onPageChange={() => {}}
          loading={isLoading}
        />
      </div>
    </div>
  );
}
