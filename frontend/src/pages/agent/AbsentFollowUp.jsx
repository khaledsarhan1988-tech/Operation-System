import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Search, BookOpen, Monitor, RefreshCw, Phone } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';

// ─── Follow-up modal (main absences) ─────────────────────────────────────────
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

// ─── Zoom absence detail modal (individual students) ─────────────────────────
function ZoomDetailModal({ row, open, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['zoom-absent-detail', row?.group_name, row?.session_date],
    queryFn: () => api.get('/agent/absent-zoom-detail', {
      params: { group_name: row.group_name, session_date: row.session_date },
    }).then(r => r.data),
    enabled: open && !!row,
  });

  const students = data?.data ?? [];

  return (
    <Modal open={open} onClose={onClose} title={`غائبون — ${row?.session_date?.slice(0,10) || ''}`}>
      <div className="space-y-3">
        {/* Group info */}
        <div className="p-3 bg-gray-50 rounded-xl text-xs text-gray-600 font-mono break-all">
          {row?.group_name}
        </div>

        {/* Stats row */}
        <div className="flex gap-3">
          <div className="flex-1 text-center p-2 bg-gray-50 rounded-lg">
            <p className="text-lg font-bold text-gray-800">{row?.trainee_count ?? 0}</p>
            <p className="text-xs text-gray-500">إجمالي</p>
          </div>
          <div className="flex-1 text-center p-2 bg-green-50 rounded-lg">
            <p className="text-lg font-bold text-green-600">{row?.present_count ?? 0}</p>
            <p className="text-xs text-gray-500">حضور</p>
          </div>
          <div className="flex-1 text-center p-2 bg-red-50 rounded-lg">
            <p className="text-lg font-bold text-red-600">{row?.absent_count ?? 0}</p>
            <p className="text-xs text-gray-500">غياب</p>
          </div>
        </div>

        {/* Students list */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <RefreshCw className="animate-spin text-primary" size={22} />
          </div>
        ) : students.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">لا تتوفر تفاصيل فردية لهذه الجلسة</div>
        ) : (
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b text-xs font-semibold text-gray-600 flex justify-between">
              <span>اسم العميل</span>
              <span>الموبايل</span>
            </div>
            <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {students.map((s, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
                  <span className="text-sm font-medium text-gray-800">{s.student_name || '—'}</span>
                  {s.phone ? (
                    <a href={`tel:${s.phone}`}
                       className="flex items-center gap-1.5 text-sm font-mono text-blue-600 hover:underline">
                      <Phone size={12} />
                      {s.phone}
                    </a>
                  ) : (
                    <span className="text-gray-400 text-sm">—</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

const FOLLOW_UP_LABELS = { '': 'الكل', pending: 'معلقة', contacted: 'تم التواصل', resolved: 'تم الحل' };

export default function AbsentFollowUp() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [sessionType, setSessionType] = useState('main');
  const [searchDraft, setSearchDraft] = useState('');
  const [applied, setApplied] = useState({
    q: '', follow_up_status: '', from_date: '', to_date: '', department: '', coordinator: '',
  });
  const [filters, setFilters] = useState({
    follow_up_status: '', from_date: '', to_date: '', department: '', coordinator: '',
  });

  const [page, setPage]           = useState(1);
  const [selected, setSelected]   = useState(null);   // main absence modal
  const [zoomDetail, setZoomDetail] = useState(null); // zoom detail modal

  const isZoom = sessionType === 'side';

  const mainParams = { page, limit: 25, session_type: 'main', ...applied };
  const zoomParams = { page, limit: 25, from_date: applied.from_date, to_date: applied.to_date, q: applied.q };

  const { data: mainData, isLoading: mainLoading } = useQuery({
    queryKey: ['agent-absent-main', mainParams],
    queryFn:  () => api.get('/agent/absent', { params: mainParams }).then(r => r.data),
    keepPreviousData: true,
    enabled: !isZoom,
  });

  const { data: zoomData, isLoading: zoomLoading } = useQuery({
    queryKey: ['agent-absent-zoom', zoomParams],
    queryFn:  () => api.get('/agent/absent-zoom', { params: zoomParams }).then(r => r.data),
    keepPreviousData: true,
    enabled: isZoom,
  });

  const data       = isZoom ? zoomData    : mainData;
  const isLoading  = isZoom ? zoomLoading : mainLoading;

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

  const switchTab = (type) => { setSessionType(type); setPage(1); };

  const handleExport = () => {
    window.open(
      `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/export/absent`,
      '_blank'
    );
  };

  const hasActiveFilters = applied.q || applied.follow_up_status || applied.from_date ||
    applied.to_date || applied.department || applied.coordinator;

  // ── Columns ──────────────────────────────────────────────────────────────────
  const mainColumns = [
    { key: 'student_name',      label: t('absent.student'),        render: v => <span className="font-medium">{v || '—'}</span> },
    { key: 'phone',             label: t('clients.phone'),         render: v => <span className="font-mono text-sm">{v || '—'}</span> },
    { key: 'group_name',        label: t('absent.group'),          render: v => <span className="text-xs font-mono break-all leading-relaxed text-gray-700">{v}</span> },
    { key: 'date',              label: t('absent.date'),           render: v => v?.slice(0, 10) },
    { key: 'lecture_no',        label: t('absent.lectureNo') },
    { key: 'follow_up_status',  label: t('absent.followUpStatus'), render: v => <Badge value={v} ns="absent" /> },
    { key: 'follow_up_note',    label: t('absent.followUpNote'),   render: v => <span className="text-xs text-text-secondary line-clamp-1">{v || '—'}</span> },
  ];

  const zoomColumns = [
    { key: 'group_name',    label: 'المجموعة',  render: v => <span className="text-xs font-mono break-all leading-relaxed text-gray-700">{v}</span> },
    { key: 'session_date',  label: 'التاريخ',   render: v => v?.slice(0, 10) },
    { key: 'trainer',       label: 'المدرب',    render: v => <span className="text-sm">{v || '—'}</span> },
    { key: 'coordinators',  label: 'المنسق',    render: v => <span className="text-sm">{v || '—'}</span> },
    { key: 'trainee_count', label: 'إجمالي',   render: v => <span className="font-bold text-gray-700">{v}</span> },
    { key: 'present_count', label: 'حضور',     render: v => <span className="font-bold text-green-600">{v}</span> },
    {
      key: 'absent_count',
      label: 'غياب',
      render: (v, row) => (
        <button
          onClick={e => { e.stopPropagation(); setZoomDetail(row); }}
          className="font-bold text-red-600 hover:text-red-800 hover:underline transition-colors cursor-pointer"
          title="اضغط لرؤية أسماء الغائبين"
        >
          {v}
        </button>
      ),
    },
  ];

  const columns = isZoom ? zoomColumns : mainColumns;

  // Total absent for Zoom tab
  const totalAbsent = zoomData?.total_absent ?? 0;

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
            sessionType === 'main' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <BookOpen size={15} /> المحاضرات الأساسية
        </button>
        <button
          onClick={() => switchTab('side')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            sessionType === 'side' ? 'bg-purple-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <Monitor size={15} /> الجلسات الجانبية (Zoom)
        </button>
      </div>

      {/* Zoom total absent badge */}
      {isZoom && zoomData && (
        <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl">
          <div className="text-center px-4 py-1.5 bg-red-600 text-white rounded-lg">
            <span className="text-lg font-bold">{totalAbsent}</span>
            <span className="text-xs mr-1">عميل غائب</span>
          </div>
          <p className="text-sm text-red-700 font-medium">
            إجمالي الغيابات في جلسات الزووم
            {applied.from_date && applied.to_date && ` (${applied.from_date} → ${applied.to_date})`}
          </p>
        </div>
      )}

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
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">من تاريخ</label>
          <input type="date" value={filters.from_date}
            onChange={e => setFilters(f => ({ ...f, from_date: e.target.value }))}
            className="input text-sm w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">إلى تاريخ</label>
          <input type="date" value={filters.to_date}
            onChange={e => setFilters(f => ({ ...f, to_date: e.target.value }))}
            className="input text-sm w-40" />
        </div>
        {!isZoom && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">حالة المتابعة</label>
            <select value={filters.follow_up_status}
              onChange={e => setFilters(f => ({ ...f, follow_up_status: e.target.value }))}
              className="input text-sm w-36">
              {Object.entries(FOLLOW_UP_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
        )}
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
          onRowClick={isZoom ? undefined : row => setSelected(row)}
        />
      </div>

      {/* Main absence follow-up modal */}
      {!isZoom && selected && (
        <FollowUpModal
          absent={selected}
          open={!!selected}
          onClose={() => setSelected(null)}
          onSaved={() => qc.invalidateQueries(['agent-absent-main'])}
        />
      )}

      {/* Zoom detail modal (individual students) */}
      {zoomDetail && (
        <ZoomDetailModal
          row={zoomDetail}
          open={!!zoomDetail}
          onClose={() => setZoomDetail(null)}
        />
      )}
    </div>
  );
}
