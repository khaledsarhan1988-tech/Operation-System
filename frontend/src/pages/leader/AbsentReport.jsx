import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, UserX, Search, Filter } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import ModernButton from '../../components/ui/ModernButton';

export default function AbsentReport() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [group, setGroup] = useState('');
  const [coordinator, setCoordinator] = useState('');

  const { data: allTeam } = useQuery({
    queryKey: ['leader-team-all'],
    queryFn: () => api.get('/leader/team').then(r => r.data),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['leader-absent', page, status, group, coordinator],
    queryFn: () => api.get('/leader/absent-report', {
      params: { page, limit: 50, follow_up_status: status, group, ...(coordinator ? { coordinator } : {}) }
    }).then(r => r.data),
  });

  const handleExport = () => {
    const params = new URLSearchParams();
    if (group) params.set('group', group);
    if (coordinator) params.set('coordinator', coordinator);
    window.open(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/export/absent?${params}`, '_blank');
  };

  const inputCls = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30';

  const columns = [
    { key: 'student_name', label: t('absent.student'), render: v => v || '—' },
    { key: 'phone',        label: t('clients.phone') },
    { key: 'group_name',   label: t('absent.group'),  render: v => <span className="text-xs max-w-[160px] block truncate">{v}</span> },
    { key: 'date',         label: t('absent.date'),   render: v => v?.slice(0,10) },
    { key: 'lecture_no',   label: '#' },
    { key: 'follow_up_status', label: t('absent.followUpStatus'), render: v => <Badge value={v} ns="absent" /> },
    { key: 'follow_up_note',   label: t('absent.followUpNote'),   render: v => <span className="text-xs text-gray-500">{v || '—'}</span> },
    { key: 'follow_up_by',     label: 'By',                       render: v => <span className="text-xs">{v || '—'}</span> },
  ];

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title={t('nav.absentReport')}
        subtitle={`${data?.total || 0} حالة غياب`}
        icon={UserX}
        gradient="rose"
        actions={
          <ModernButton variant="glass" icon={Download} onClick={handleExport}>
            {t('common.export')}
          </ModernButton>
        }
      />

      {/* Filters */}
      <div className="bg-white/80 backdrop-blur-md border border-gray-100 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
            <Filter size={13} className="text-gray-400" />
            <select
              value={coordinator}
              onChange={e => { setCoordinator(e.target.value); setPage(1); }}
              className="bg-transparent text-sm font-bold text-gray-700 focus:outline-none cursor-pointer min-w-[140px]"
            >
              <option value="">كل المنسقين</option>
              {(allTeam ?? []).map((a, i) => (
                <option key={i} value={a.name}>{a.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-2 flex-1 min-w-[200px]">
            <Search size={13} className="text-gray-400" />
            <input
              type="text"
              value={group}
              onChange={e => { setGroup(e.target.value); setPage(1); }}
              placeholder="بحث باسم المجموعة..."
              className="bg-transparent text-sm font-bold text-gray-700 focus:outline-none flex-1"
            />
          </div>
        </div>

        <div className="flex gap-2 flex-wrap pt-1">
          {['', 'pending', 'contacted', 'resolved'].map(s => (
            <button key={s} onClick={() => { setStatus(s); setPage(1); }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all ${
                status === s
                  ? 'bg-[#1e3a5f] text-white shadow-lg shadow-[#1e3a5f]/30'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}>
              {s ? t(`absent.${s}`) : t('common.all')}
            </button>
          ))}
        </div>
      </div>

      <SectionCard title="قائمة الغيابات" icon={UserX} accent="rose" noBodyPad>
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
      </SectionCard>
    </div>
  );
}
