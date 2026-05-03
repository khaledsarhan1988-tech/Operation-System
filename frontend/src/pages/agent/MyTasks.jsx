import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Download, ClipboardList, Search } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import RemarkForm from '../../components/remarks/RemarkForm';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import ModernButton from '../../components/ui/ModernButton';

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

  const inputCls = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30';

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title={t('nav.myTasks')}
        subtitle="عرض وإدارة كل المهام المسندة إليك"
        icon={ClipboardList}
        gradient="navy"
        actions={
          <>
            <ModernButton variant="glass" icon={Download} onClick={handleExport}>
              {t('common.export')}
            </ModernButton>
            <ModernButton variant="amber" icon={Plus} onClick={() => { setSelected(null); setShowForm(true); }}>
              {t('tasks.addTask')}
            </ModernButton>
          </>
        }
      />

      {/* Filters */}
      <div className="bg-white/80 backdrop-blur-md border border-gray-100 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-2 flex-1 min-w-[200px]">
            <Search size={14} className="text-gray-400" />
            <input
              type="text"
              value={q}
              onChange={e => { setQ(e.target.value); setPage(1); }}
              placeholder="بحث..."
              className="bg-transparent text-sm font-bold text-gray-700 focus:outline-none flex-1"
            />
          </div>
          <select className={inputCls} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{t('common.all')}</option>
            <option value="pending">{t('tasks.pending')}</option>
            <option value="done">{t('tasks.done')}</option>
          </select>
          <select className={inputCls} value={priority} onChange={e => { setPriority(e.target.value); setPage(1); }}>
            <option value="">{t('common.all')}</option>
            <option value="عاجلة">{t('tasks.urgent')}</option>
            <option value="هامة">{t('tasks.important')}</option>
            <option value="عادية">{t('tasks.normal')}</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <SectionCard title="المهام" subtitle={`${data?.total || 0} مهمة`} icon={ClipboardList} accent="indigo" noBodyPad>
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
      </SectionCard>

      <RemarkForm
        open={showForm}
        remark={selected}
        onClose={() => setShowForm(false)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['my-tasks'], exact: false })}
      />
    </div>
  );
}
