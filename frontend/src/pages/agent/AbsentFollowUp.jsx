import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Search, BookOpen, Monitor } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';

function FollowUpModal({ absent, open, onClose, onSaved }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(absent?.follow_up_status || 'pending');
  const [note, setNote]     = useState(absent?.follow_up_note   || '');
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

const FOLLOW_UP_LABELS = { '': 'الكل', pending: 'معلقة', contacted: 'تم التواصل', resolved: 'تم الحل' };

export default function AbsentFollowUp() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // Tab: main | side
  const [sessionType, setSessionType] = useState('main');

  // Search & filters (draft = what user types, applied = what's sent to API)
  const [searchDraft, setSearchDraft] = useState('');
  const [applied, setApplied] = useState({
    q: '', follow_up_status: '', from_date: '', to_date: '', department: '', coordinator: '',
  });

  // Filter bar state
  const [filters, setFilters] = useState({
    follow_up_status: '', from_date: '', to_date: '', department: '', coordinator: '',
  });

  const [page, setPage]         = useState(1);
  const [selected, setSelected] = useState(null);

  const params = {
    page, limit: 25,
    session_type: sessionType,
    ...applied,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['agent-absent', params],
    queryFn: () => api.get('/agent/absent', { params }).then(r => r.data),
    keepPreviousData: true,
  });

  const filterOpts = data?.filter_opts ?? { departments: [], coordinators: [] };

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setApplied({ ...filters, q: searchDraft });
  };

  const handleClear = () => {
    setSearchDraft('');
    setFilters({ follow_up_status: '', from_date: '', to_date: '', department: '', coordinator: '' });
    setApplied({ q: '', follow_up_status: '', from_date: '', to_date: '', department: '', coordinator: '' });
    setPage(1);
  };

  const switchTab = (type) => {
    setSessionType(type);
    setPage(1);
  };

  const handleExport = () => {
    window.open(
      `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/export/absent`,
      '_blank'
    );
  };

  const hasActiveFilters = applied.q || applied.follow_up_status || applied.from_date ||
    applied.to_date || applied.department || applied.coordinator;

  const columns = [
    { key: 'student_name',      label: t('absent.student'),        render: v => <span className="font-medium">{v || '—'}</span> },
    { key: 'phone',             label: t('clients.phone'),         render: v => <span className="font-mono text-sm">{v || '—'}</span> },
    { key: 'group_name',        label: t('absent.group'),          render: v => (
        <span className="text-xs font-mono break-all leading-relaxed text-gray-700">{v}</span>
      )
    },
    { key: 'date',              label: t('absent.date'),           render: v => v?.slice(0, 10) },
    { key: 'lecture_no',        label: t('absent.lectureNo') },
    { key: 'follow_up_status',  label: t('absent.followUpStatus'), render: v => <Badge value={v} ns="absent" /> },
    { key: 'follow_up_note',    label: t('absent.followUpNote'),   render: v => <span className="text-xs text-text-secondary line-clamp-1">{v || '—'}</span> },
  ];

  return (
    <div className="space-y-4 animate-fadeIn">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">{t('nav.absentFollowUp')}</h1>
        <button onClick={handleExport} className="btn-outline flex items-center gap-2 text-sm">
          <Download size={15} /> {t('common.export')}
        </button>
      </div>

      {/* Session type tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => switchTab('main')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            sessionType === 'main'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <BookOpen size={15} />
          المحاضرات الأساسية
        </button>
        <button
          onClick={() => switchTab('side')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            sessionType === 'side'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <Monitor size={15} />
          الجلسات الجانبية (Zoom)
        </button>
      </div>

      {/* Search bar + total */}
      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchDraft}
            onChange={e => setSearchDraft(e.target.value)}
            placeholder="بحث باسم الطالب, المجموعة, أو الموبايل..."
            className="input pr-9 w-full text-sm"
          />
        </div>
        <button type="submit" className="btn-primary px-5 text-sm">بحث</button>
        {hasActiveFilters && (
          <button type="button" onClick={handleClear} className="btn-outline px-4 text-sm text-red-500 border-red-200 hover:bg-red-50">
            مسح
          </button>
        )}
        {data?.total != null && (
          <span className="text-sm text-gray-500 whitespace-nowrap">
            إجمالي <span className="font-bold text-gray-700">{data.total}</span>
          </span>
        )}
      </form>

      {/* Filter row */}
      <div className="flex flex-wrap gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
        {/* From date */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">من تاريخ</label>
          <input
            type="date"
            value={filters.from_date}
            onChange={e => setFilters(f => ({ ...f, from_date: e.target.value }))}
            className="input text-sm w-40"
          />
        </div>

        {/* To date */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">إلى تاريخ</label>
          <input
            type="date"
            value={filters.to_date}
            onChange={e => setFilters(f => ({ ...f, to_date: e.target.value }))}
            className="input text-sm w-40"
          />
        </div>

        {/* Department */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">القسم</label>
          <select
            value={filters.department}
            onChange={e => setFilters(f => ({ ...f, department: e.target.value }))}
            className="input text-sm w-32"
          >
            <option value="">الكل</option>
            {filterOpts.departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Coordinator */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">المنسق</label>
          <select
            value={filters.coordinator}
            onChange={e => setFilters(f => ({ ...f, coordinator: e.target.value }))}
            className="input text-sm w-36"
          >
            <option value="">الكل</option>
            {filterOpts.coordinators.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Follow-up status */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">حالة المتابعة</label>
          <select
            value={filters.follow_up_status}
            onChange={e => setFilters(f => ({ ...f, follow_up_status: e.target.value }))}
            className="input text-sm w-36"
          >
            {Object.entries(FOLLOW_UP_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
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
