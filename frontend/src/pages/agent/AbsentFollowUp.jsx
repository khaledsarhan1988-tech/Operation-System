import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Search, BookOpen, Monitor, RefreshCw, Copy, Check, UserX, Calendar } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import ModernButton from '../../components/ui/ModernButton';

// ─── Follow-up modal (works for both main and zoom absences) ────────────────
function FollowUpModal({ absent, open, onClose, onSaved, isZoom }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(absent?.follow_up_status || 'pending');
  const [note, setNote]     = useState(absent?.follow_up_note   || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const url = isZoom ? `/agent/absent-zoom/${absent.id}` : `/agent/absent/${absent.id}`;
      await api.put(url, { follow_up_status: status, follow_up_note: note });
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

  const [sessionType, setSessionType] = useState('main');
  const [searchDraft, setSearchDraft] = useState('');
  const [applied, setApplied] = useState({
    q: '', follow_up_status: '', from_date: '', to_date: '', department: '', coordinator: '',
  });
  const [filters, setFilters] = useState({
    follow_up_status: '', from_date: '', to_date: '', department: '', coordinator: '',
  });

  const [page, setPage]             = useState(1);
  const [selected, setSelected]     = useState(null);   // absence modal (main or zoom)

  // ── Inline editing state ──────────────────────────────────────────────────
  const [inlineEdits, setInlineEdits] = useState({});   // { [id]: { status, note } }
  const [savingIds,   setSavingIds]   = useState(new Set());
  const [copiedKey,   setCopiedKey]   = useState(null); // e.g. 'phone-42' | 'group-42'

  const handleCopy = (text, key) => {
    navigator.clipboard.writeText(String(text)).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const getEdit = (row) =>
    inlineEdits[row.id] ?? { status: row.follow_up_status || 'pending', note: row.follow_up_note || '' };

  const setEditField = (id, field, value) =>
    setInlineEdits(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), [field]: value } }));

  const isDirty = (row) => {
    const e = inlineEdits[row.id];
    if (!e) return false;
    const origStatus = row.follow_up_status || 'pending';
    const origNote   = row.follow_up_note   || '';
    return (e.status !== undefined && e.status !== origStatus) ||
           (e.note   !== undefined && e.note   !== origNote);
  };

  // ── Queries ───────────────────────────────────────────────────────────────
  const isZoom = sessionType === 'side';

  // Both tabs use the same shape — only the endpoint changes
  const endpoint = isZoom ? '/agent/absent-zoom' : '/agent/absent';
  const queryKey = isZoom ? 'agent-absent-zoom' : 'agent-absent-main';
  const params   = { page, limit: 25, ...(isZoom ? {} : { session_type: 'main' }), ...applied };

  const { data, isLoading } = useQuery({
    queryKey: [queryKey, params],
    queryFn:  () => api.get(endpoint, { params }).then(r => r.data),
    keepPreviousData: true,
  });

  const handleInlineSave = async (row) => {
    const edit = getEdit(row);
    const putUrl = isZoom ? `/agent/absent-zoom/${row.id}` : `/agent/absent/${row.id}`;
    setSavingIds(prev => new Set(prev).add(row.id));
    try {
      await api.put(putUrl, {
        follow_up_status: edit.status,
        follow_up_note:   edit.note,
      });
      qc.invalidateQueries({ queryKey: [queryKey], exact: false });
      setInlineEdits(prev => { const n = { ...prev }; delete n[row.id]; return n; });
    } finally {
      setSavingIds(prev => { const n = new Set(prev); n.delete(row.id); return n; });
    }
  };

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

  // ── Columns ───────────────────────────────────────────────────────────────
  // Both tabs (Main + Zoom) share the same student-level columns.
  const columns = [
    {
      key: 'student_name',
      label: t('absent.student'),
      render: v => <span className="font-medium">{v || '—'}</span>,
    },
    {
      key: 'phone',
      label: t('clients.phone'),
      render: (v, row) => (
        <div className="flex items-center gap-1">
          <span className="font-mono text-sm">{v || '—'}</span>
          {v && (
            <button
              onClick={e => { e.stopPropagation(); handleCopy(v, `phone-${row.id}`); }}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-500 transition-colors flex-shrink-0"
              title="نسخ الرقم"
            >
              {copiedKey === `phone-${row.id}`
                ? <Check size={13} className="text-green-500" />
                : <Copy size={13} />}
            </button>
          )}
        </div>
      ),
    },
    {
      key: 'group_name',
      label: t('absent.group'),
      render: (v, row) => (
        <div className="flex items-start gap-1">
          <span className="text-xs font-mono break-all leading-relaxed text-gray-700">{v}</span>
          {v && (
            <button
              onClick={e => { e.stopPropagation(); handleCopy(v, `group-${row.id}`); }}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-500 transition-colors flex-shrink-0 mt-0.5"
              title="نسخ كود المجموعة"
            >
              {copiedKey === `group-${row.id}`
                ? <Check size={13} className="text-green-500" />
                : <Copy size={13} />}
            </button>
          )}
        </div>
      ),
    },
    {
      key: 'date',
      label: t('absent.date'),
      render: v => v?.slice(0, 10),
    },
    {
      key: 'lecture_no',
      label: t('absent.lectureNo'),
    },
    {
      key: 'follow_up_status',
      label: t('absent.followUpStatus'),
      render: (v, row) => {
        const edit = getEdit(row);
        return (
          <select
            value={edit.status}
            onClick={e => e.stopPropagation()}
            onChange={e => { e.stopPropagation(); setEditField(row.id, 'status', e.target.value); }}
            className={`text-xs border rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer transition-colors ${
              edit.status === 'resolved'  ? 'border-green-300 text-green-700 bg-green-50' :
              edit.status === 'contacted' ? 'border-blue-300  text-blue-700  bg-blue-50'  :
                                            'border-orange-300 text-orange-700 bg-orange-50'
            }`}
          >
            <option value="pending">معلقة</option>
            <option value="contacted">تم التواصل</option>
            <option value="resolved">تم الحل</option>
          </select>
        );
      },
    },
    {
      key: 'follow_up_note',
      label: t('absent.followUpNote'),
      render: (v, row) => {
        const edit    = getEdit(row);
        const dirty   = isDirty(row);
        const saving  = savingIds.has(row.id);
        return (
          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <input
              value={edit.note}
              onChange={e => setEditField(row.id, 'note', e.target.value)}
              placeholder="أضف ملاحظة..."
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-primary/30 w-36 placeholder:text-gray-300"
            />
            {dirty && (
              <button
                onClick={() => handleInlineSave(row)}
                disabled={saving}
                className="p-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white transition-colors disabled:opacity-50 flex-shrink-0"
                title="حفظ"
              >
                {saving
                  ? <RefreshCw size={12} className="animate-spin" />
                  : <Check size={12} />}
              </button>
            )}
          </div>
        );
      },
    },
  ];

  // (Zoom tab uses the SAME columns as Main now — single shared column set above.)

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title={t('nav.absentFollowUp')}
        subtitle="متابعة وتوثيق غياب الطلاب"
        icon={UserX}
        gradient="rose"
        actions={
          <ModernButton variant="glass" icon={Download} onClick={handleExport}>
            {t('common.export')}
          </ModernButton>
        }
      />

      {/* Session type tabs */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => switchTab('main')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black transition-all ${
            sessionType === 'main' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <BookOpen size={15} /> المحاضرات الأساسية
        </button>
        <button
          onClick={() => switchTab('side')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black transition-all ${
            sessionType === 'side' ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <Monitor size={15} /> الجلسات الجانبية (Zoom)
        </button>
      </div>

      {/* Search + filters */}
      <div className="bg-white/80 backdrop-blur-md border border-gray-100 rounded-2xl p-4 shadow-sm space-y-3">
        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-2 flex-1 min-w-[260px]">
            <Search size={14} className="text-gray-400" />
            <input
              type="text"
              value={searchDraft}
              onChange={e => setSearchDraft(e.target.value)}
              placeholder="بحث باسم الطالب, المجموعة, أو الموبايل..."
              className="bg-transparent text-sm font-bold text-gray-700 focus:outline-none flex-1"
            />
          </div>
          <ModernButton type="submit" variant="primary" size="sm" icon={Search}>بحث</ModernButton>
          {hasActiveFilters && (
            <ModernButton type="button" variant="ghost" size="sm" onClick={handleClear} className="!text-red-500">
              مسح
            </ModernButton>
          )}
          {data?.total != null && (
            <span className="text-xs text-gray-500 whitespace-nowrap font-bold">
              إجمالي <span className="font-black text-gray-700">{data.total}</span>
            </span>
          )}
        </form>

        <div className="flex flex-wrap gap-3 pt-3 border-t border-gray-100">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-400 font-black uppercase tracking-wider flex items-center gap-1">
              <Calendar size={10} /> من تاريخ
            </label>
            <input type="date" value={filters.from_date}
              onChange={e => setFilters(f => ({ ...f, from_date: e.target.value }))}
              className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-400 font-black uppercase tracking-wider flex items-center gap-1">
              <Calendar size={10} /> إلى تاريخ
            </label>
            <input type="date" value={filters.to_date}
              onChange={e => setFilters(f => ({ ...f, to_date: e.target.value }))}
              className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-400 font-black uppercase tracking-wider">حالة المتابعة</label>
            <select value={filters.follow_up_status}
              onChange={e => setFilters(f => ({ ...f, follow_up_status: e.target.value }))}
              className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 w-36">
              {Object.entries(FOLLOW_UP_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <SectionCard title="قائمة الغيابات" icon={UserX} accent="rose" noBodyPad>
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
      </SectionCard>

      {/* Absence follow-up modal (works for both main and zoom) */}
      {selected && (
        <FollowUpModal
          absent={selected}
          open={!!selected}
          onClose={() => setSelected(null)}
          isZoom={isZoom}
          onSaved={() => qc.invalidateQueries({ queryKey: [queryKey], exact: false })}
        />
      )}
    </div>
  );
}
