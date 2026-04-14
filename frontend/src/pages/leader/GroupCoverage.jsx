import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';

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

  const selectCls = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] min-w-[180px]';

  const columns = [
    { key: 'external_id',  label: '#',                    render: v => <span className="text-text-secondary text-xs">{v}</span> },
    { key: 'group_name',   label: t('leader.groupName'),  render: v => <span className="text-xs font-mono">{v}</span> },
    { key: 'course',       label: t('leader.course') },
    { key: 'dept_type',    label: 'Type',                 render: v => v ? <Badge value={v === 'General' ? 'نشطة' : 'مجدولة'} /> : '—' },
    { key: 'trainers',     label: 'Trainer',              render: v => <span className="text-xs">{v}</span> },
    { key: 'coordinators', label: t('leader.coordinator'), render: v => <span className="text-xs">{v}</span> },
    { key: 'trainee_count',        label: t('leader.trainees'),  render: (v, row) => `${v}/${row.max_trainees}` },
    { key: 'completed_lectures',   label: 'Lectures',            render: (v, row) => `${v}/${row.scheduled_lectures}` },
    { key: 'start_date',           label: t('leader.startDate'), render: v => v?.slice(0,10) },
    { key: 'status',               label: 'Status',              render: v => <Badge value={v} /> },
  ];

  return (
    <div className="space-y-5 animate-fadeIn" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-text-primary">{t('nav.groupCoverage')}</h1>
        <div className="flex items-center gap-3">
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
          <p className="text-text-secondary text-sm">{groups?.length || 0} active groups</p>
        </div>
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
