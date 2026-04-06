import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';

function FollowUpModal({ absent, open, onClose, onSaved }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(absent?.follow_up_status || 'pending');
  const [note, setNote] = useState(absent?.follow_up_note || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/agent/absent/${absent.id}`, { follow_up_status: status, follow_up_note: note });
      onSaved?.();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('absent.updateFollowUp')}>
      <div className="space-y-4">
        <div>
          <p className="label">{t('absent.student')}</p>
          <p className="font-medium">{absent?.student_name || '—'}</p>
          <p className="text-sm text-text-secondary">{absent?.group_name}</p>
        </div>
        <div>
          <label className="label">{t('absent.followUpStatus')}</label>
          <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="pending">{t('absent.pending')}</option>
            <option value="contacted">{t('absent.contacted')}</option>
            <option value="resolved">{t('absent.resolved')}</option>
          </select>
        </div>
        <div>
          <label className="label">{t('absent.followUpNote')}</label>
          <textarea className="input h-20 resize-none" value={note} onChange={e => setNote(e.target.value)} />
        </div>
        <div className="flex gap-3">
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
            {saving ? t('common.loading') : t('tasks.save')}
          </button>
          <button onClick={onClose} className="btn-outline">{t('tasks.cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

export default function AbsentFollowUp() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');
  const [selected, setSelected] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['agent-absent', page, filterStatus],
    queryFn: () => api.get('/agent/absent', {
      params: { page, limit: 25, follow_up_status: filterStatus }
    }).then(r => r.data),
  });

  const handleExport = () => {
    window.open(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/export/absent`, '_blank');
  };

  const columns = [
    { key: 'student_name', label: t('absent.student'), render: v => v || '—' },
    { key: 'phone', label: t('clients.phone') },
    { key: 'group_name', label: t('absent.group'), render: v => <span className="text-xs truncate max-w-[200px] block">{v}</span> },
    { key: 'date', label: t('absent.date'), render: v => v?.slice(0,10) },
    { key: 'lecture_no', label: t('absent.lectureNo') },
    { key: 'follow_up_status', label: t('absent.followUpStatus'), render: v => <Badge value={v} ns="absent" /> },
    { key: 'follow_up_note', label: t('absent.followUpNote'), render: v => <span className="text-xs text-text-secondary line-clamp-1">{v || '—'}</span> },
  ];

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">{t('nav.absentFollowUp')}</h1>
        <button onClick={handleExport} className="btn-outline flex items-center gap-2 text-sm">
          <Download size={15} /> {t('common.export')}
        </button>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2">
        {['', 'pending', 'contacted', 'resolved'].map(s => (
          <button
            key={s}
            onClick={() => { setFilterStatus(s); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filterStatus === s
                ? 'bg-primary text-white'
                : 'bg-surface text-text-secondary hover:bg-border'
            }`}
          >
            {s ? t(`absent.${s}`) : t('common.all')}
          </button>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        <DataTable
          columns={columns}
          data={data?.data}
          total={data?.total || 0}
          page={page}
          limit={25}
          onPageChange={setPage}
          loading={isLoading}
          emptyMsg={t('absent.noAbsent')}
          onRowClick={row => setSelected(row)}
        />
      </div>

      {selected && (
        <FollowUpModal
          absent={selected}
          open={!!selected}
          onClose={() => setSelected(null)}
          onSaved={() => qc.invalidateQueries(['agent-absent'])}
        />
      )}
    </div>
  );
}
