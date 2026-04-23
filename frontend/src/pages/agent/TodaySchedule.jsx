import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import api from '../../api/axios';
import Badge from '../../components/ui/Badge';
import { Clock, User, MapPin, Timer, Search, RefreshCw, X } from 'lucide-react';

// ─── SessionCard (main lectures) ─────────────────────────────────────────────
function SessionCard({ session: s }) {
  return (
    <div className="card hover:shadow-card-hover transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <p className="text-sm font-medium text-gray-800 line-clamp-2 flex-1 me-2">{s.group_name}</p>
        <div className="flex gap-1 flex-shrink-0">
          {s.side_session_category
            ? <Badge value={s.side_session_category} ns="schedule" />
            : <Badge value={s.session_type} ns="schedule" />}
        </div>
      </div>
      <div className="space-y-1 text-xs text-gray-500">
        <div className="flex items-center gap-1.5"><Clock size={12} />{s.time}</div>
        {s.trainer  && <div className="flex items-center gap-1.5"><User  size={12} />{s.trainer}</div>}
        {s.duration && <div className="flex items-center gap-1.5"><Timer size={12} />{s.duration}</div>}
        {s.location && <div className="flex items-center gap-1.5"><MapPin size={12} />{s.location}</div>}
      </div>
      {s.status && <div className="mt-2"><Badge value={s.status} /></div>}
    </div>
  );
}

// ─── ZoomTable — table view matching admin modal ──────────────────────────────
function ZoomTable() {
  const [searchDraft, setSearchDraft] = useState('');
  const [filters,     setFilters]     = useState({ from_date: '', to_date: '', trainer: '' });
  const [applied,     setApplied]     = useState({ q: '', from_date: '', to_date: '', trainer: '' });
  const [page,        setPage]        = useState(1);
  const LIMIT = 25;

  const params = { page, limit: LIMIT, ...applied };

  const { data, isLoading } = useQuery({
    queryKey: ['agent-zoom-sessions', params],
    queryFn:  () => api.get('/agent/zoom-sessions', { params }).then(r => r.data),
    keepPreviousData: true,
  });

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setApplied({ ...filters, q: searchDraft });
  };

  const handleClear = () => {
    setSearchDraft('');
    setFilters({ from_date: '', to_date: '', trainer: '' });
    setApplied({ q: '', from_date: '', to_date: '', trainer: '' });
    setPage(1);
  };

  const hasFilter = applied.q || applied.from_date || applied.to_date || applied.trainer;
  const total     = data?.total ?? 0;
  const rows      = data?.data  ?? [];

  return (
    <div className="space-y-3">

      {/* Search + total */}
      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchDraft}
            onChange={e => setSearchDraft(e.target.value)}
            placeholder="بحث باسم المجموعة..."
            className="input pr-9 w-full text-sm"
          />
        </div>
        <button type="submit" className="btn-primary px-5 text-sm">بحث</button>
        {hasFilter && (
          <button type="button" onClick={handleClear}
            className="btn-outline px-3 text-sm text-red-500 border-red-200 hover:bg-red-50">
            <X size={14} />
          </button>
        )}
        <span className="text-sm text-gray-500 whitespace-nowrap">
          إجمالي <span className="font-bold text-gray-700">{total}</span>
        </span>
      </form>

      {/* Filters row */}
      <div className="flex flex-wrap gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
        {/* Trainer */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">اسم المدرب</label>
          <input
            value={filters.trainer}
            onChange={e => setFilters(f => ({ ...f, trainer: e.target.value }))}
            placeholder="المدرب..."
            className="input text-sm w-36"
          />
        </div>
        {/* From date */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">من تاريخ</label>
          <input type="date" value={filters.from_date}
            onChange={e => setFilters(f => ({ ...f, from_date: e.target.value }))}
            className="input text-sm w-40" />
        </div>
        {/* To date */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">إلى تاريخ</label>
          <input type="date" value={filters.to_date}
            onChange={e => setFilters(f => ({ ...f, to_date: e.target.value }))}
            className="input text-sm w-40" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <RefreshCw className="animate-spin text-primary" size={24} />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">لا توجد جلسات</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-semibold text-gray-600">المجموعة</th>
                    <th className="px-4 py-2.5 text-start font-semibold text-gray-600">التاريخ</th>
                    <th className="px-4 py-2.5 text-start font-semibold text-gray-600">الوقت</th>
                    <th className="px-4 py-2.5 text-start font-semibold text-gray-600">المدة</th>
                    <th className="px-4 py-2.5 text-start font-semibold text-gray-600">المدرب</th>
                    <th className="px-4 py-2.5 text-start font-semibold text-gray-600">الحالة</th>
                    <th className="px-4 py-2.5 text-start font-semibold text-gray-600">القسم</th>
                    <th className="px-4 py-2.5 text-start font-semibold text-gray-600">المنسق</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-xs font-mono text-gray-700 max-w-[220px] break-all">{r.group_name}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{r.date}</td>
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{r.time || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          <Timer size={11} className="text-gray-400" />{r.duration || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-gray-700">{r.trainer || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          r.status === 'مؤكدة'        ? 'bg-green-100 text-green-700' :
                          r.status === 'غير مؤكدة'    ? 'bg-gray-100 text-gray-600'  :
                          r.status === 'ملغاة'         ? 'bg-red-100  text-red-600'   :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {r.status || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {r.dept_type && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                            {r.dept_type}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{r.coordinators || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {total > LIMIT && (
              <div className="flex justify-center gap-2 p-4 border-t">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50 disabled:opacity-40">السابق</button>
                <span className="px-3 py-1.5 text-sm text-gray-600">صفحة {page}</span>
                <button disabled={page * LIMIT >= total} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50 disabled:opacity-40">التالي</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function TodaySchedule() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const [date,      setDate]      = useState(format(new Date(), 'yyyy-MM-dd'));
  const [activeTab, setActiveTab] = useState('side');

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['agent-schedule', date],
    queryFn:  () => api.get(`/agent/schedule?date=${date}`).then(r => r.data),
    enabled:  activeTab === 'main',
  });

  const main = sessions?.filter(s => s.session_type === 'main') || [];

  return (
    <div className="space-y-5 animate-fadeIn">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900">{t('nav.todaySchedule')}</h1>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="input w-44" />
      </div>

      {/* Tabs */}
      <div className="flex gap-3">
        <button
          onClick={() => setActiveTab('side')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all border-2
            ${activeTab === 'side'
              ? 'bg-primary text-white border-primary shadow-md'
              : 'bg-white text-gray-600 border-gray-200 hover:border-primary hover:text-primary'}`}
        >
          {isAr ? 'زووم كول' : 'Zoom Call'}
        </button>

        <button
          onClick={() => setActiveTab('main')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all border-2
            ${activeTab === 'main'
              ? 'bg-accent text-white border-accent shadow-md'
              : 'bg-white text-gray-600 border-gray-200 hover:border-accent hover:text-accent'}`}
        >
          {isAr ? 'رئيسية' : 'Main'}
          {sessions && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold
              ${activeTab === 'main' ? 'bg-white/20 text-white' : 'bg-accent/10 text-accent'}`}>
              {main.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Zoom tab: full table with filters ── */}
      {activeTab === 'side' && <ZoomTable />}

      {/* ── Main tab: cards (unchanged) ── */}
      {activeTab === 'main' && (
        <>
          {isLoading && (
            <div className="text-center py-16 text-gray-400">{t('common.loading')}</div>
          )}
          {!isLoading && main.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <p className="text-4xl mb-3">📅</p>
              <p>{t('schedule.noSchedule')}</p>
            </div>
          )}
          {!isLoading && main.length > 0 && (
            <div className="grid md:grid-cols-2 gap-3">
              {main.map((s, i) => <SessionCard key={i} session={s} />)}
            </div>
          )}
        </>
      )}

    </div>
  );
}
