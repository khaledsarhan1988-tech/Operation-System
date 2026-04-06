import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Download } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import SearchBar from '../../components/ui/SearchBar';
import RemarkForm from '../../components/remarks/RemarkForm';

export default function MyTasks() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage]       = useState(1);
  const [status, setStatus]   = useState('');
  const [priority, setPriority] = useState('');
  const [q, setQ]             = useState('');
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['my-tasks', page, status, priority, q],
    queryFn: () => api.get('/agent/tasks', {
      params: { page, limit: 25, status, priority, q, sort: 'added_at', order: 'desc' }
    }).then(r => r.data),
    keepPreviousData: true,
  });

  const handleExport = () => {
    window.open(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/export/remarks`, '_blank');
  };

  const columns = [
    { key: 'client_name', label: t('tasks.client') },
    { key: 'client_phone', label: t('tasks.phone') },
    { key: 'task_type', label: t('tasks.taskType') },
    { key: 'priority',   label: t('tasks.priority'),  render: v => <Badge value={v} /> },
    { key: 'status',     label: 'Status',             render: v => <Badge value={v} /> },
    { key: 'sla_status', label: 'SLA',                render: v => <Badge value={v} ns="sla" /> },
    { key: 'added_at',   label: t('tasks.addedAt'),   render: v => v ? v.slice(0, 10) : '—' },
  ];

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">{t('nav.myTasks')}</h1>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-outline flex items-center gap-2 text-sm">
            <Download size={15} /> {t('common.export')}
          </button>
          <button onClick={() => { setSelected(null); setShowForm(true); }} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={15} /> {t('tasks.addTask')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-3">
        <div className="flex flex-wrap gap-3">
          <SearchBar value={q} onChange={setQ} className="flex-1 min-w-48" />
          <select className="input w-36" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{t('common.all')}</option>
            <option value="pending">{t('tasks.pending')}</option>
            <option value="done">{t('tasks.done')}</option>
          </select>
          <select className="input w-36" value={priority} onChange={e => { setPriority(e.target.value); setPage(1); }}>
            <option value="">{t('common.all')}</option>
            <option value="عاجلة">{t('tasks.urgent')}</option>
            <option value="هامة">{t('tasks.important')}</option>
            <option value="عادية">{t('tasks.normal')}</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <DataTable
          columns={columns}
          data={data?.data}
          total={data?.total || 0}
          page={page}
          limit={25}
          onPageChange={setPage}
          loading={isLoading}
          emptyMsg={t('tasks.noTasks')}
          onRowClick={row => { setSelected(row); setShowForm(true); }}
        />
      </div>

      <RemarkForm
        open={showForm}
        remark={selected}
        onClose={() => setShowForm(false)}
        onSaved={() => qc.invalidateQueries(['my-tasks'])}
      />
    </div>
  );
}
