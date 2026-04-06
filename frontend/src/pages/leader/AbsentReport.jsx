import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import SearchBar from '../../components/ui/SearchBar';

export default function AbsentReport() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [group, setGroup] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['leader-absent', page, status, group],
    queryFn: () => api.get('/leader/absent-report', {
      params: { page, limit: 50, follow_up_status: status, group }
    }).then(r => r.data),
  });

  const handleExport = () => {
    const params = new URLSearchParams();
    if (group) params.set('group', group);
    window.open(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/export/absent?${params}`, '_blank');
  };

  const columns = [
    { key: 'student_name', label: t('absent.student'), render: v => v || '—' },
    { key: 'phone', label: t('clients.phone') },
    { key: 'group_name', label: t('absent.group'), render: v => <span className="text-xs max-w-[160px] block truncate">{v}</span> },
    { key: 'date', label: t('absent.date'), render: v => v?.slice(0,10) },
    { key: 'lecture_no', label: '#' },
    { key: 'follow_up_status', label: t('absent.followUpStatus'), render: v => <Badge value={v} ns="absent" /> },
    { key: 'follow_up_note', label: t('absent.followUpNote'), render: v => <span className="text-xs text-text-secondary">{v || '—'}</span> },
    { key: 'follow_up_by',   label: 'By', render: v => <span className="text-xs">{v || '—'}</span> },
  ];

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-text-primary">{t('nav.absentReport')}</h1>
        <button onClick={handleExport} className="btn-outline flex items-center gap-2 text-sm">
          <Download size={14} /> {t('common.export')}
        </button>
      </div>

      <div className="card p-3 flex flex-wrap gap-3">
        <SearchBar value={group} onChange={v => { setGroup(v); setPage(1); }}
          placeholder="Filter by group..." className="flex-1 min-w-48" />
        <div className="flex gap-2">
          {['', 'pending', 'contacted', 'resolved'].map(s => (
            <button key={s} onClick={() => { setStatus(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                status === s ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-border'
              }`}>
              {s ? t(`absent.${s}`) : t('common.all')}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <DataTable
          columns={columns}
          data={data?.data}
          total={data?.total || 0}
          page={page}
          limit={50}
          onPageChange={setPage}
          loading={isLoading}
          emptyMsg={t('absent.noAbsent')}
        />
      </div>
    </div>
  );
}
