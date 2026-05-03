import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Phone, Mail, Users, Search, ArrowRight } from 'lucide-react';
import api from '../../api/axios';
import Badge from '../../components/ui/Badge';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';
import ModernButton from '../../components/ui/ModernButton';

function ClientCard({ client, onClick }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-2xl border border-gray-100 p-4 text-right hover:-translate-y-0.5 hover:shadow-lg hover:border-indigo-200 transition-all w-full"
    >
      <div className="flex items-start justify-between mb-3 gap-2">
        <h3 className="font-black text-gray-800 truncate">{client.name}</h3>
        {client.group_name && (
          <span className="text-[10px] font-black px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-lg max-w-[55%] truncate flex-shrink-0">
            {client.group_name}
          </span>
        )}
      </div>
      <div className="space-y-1.5 text-xs font-bold text-gray-500">
        {client.phone && (
          <div className="flex items-center gap-2"><Phone size={12} className="text-gray-400" /> {client.phone}</div>
        )}
        {client.email && (
          <div className="flex items-center gap-2 truncate"><Mail size={12} className="text-gray-400" /> {client.email}</div>
        )}
        {client.registration_time && (
          <div className="flex items-center gap-2"><Users size={12} className="text-gray-400" /> {t('clients.registrationDate')}: {client.registration_time}</div>
        )}
      </div>
    </button>
  );
}

function ClientDetail({ clientId, onBack }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => api.get(`/clients/${clientId}`).then(r => r.data),
    enabled: !!clientId,
  });

  if (isLoading) return <div className="py-8 text-center text-text-secondary">{t('common.loading')}</div>;
  if (!data) return null;
  const { client, batch, remarks, absences } = data;

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title={client.name}
        subtitle="تفاصيل العميل الكاملة"
        icon={Users}
        gradient="cyan"
        actions={
          <ModernButton variant="glass" icon={ArrowRight} onClick={onBack}>
            رجوع
          </ModernButton>
        }
      />

      <SectionCard title="معلومات العميل" icon={Users} accent="cyan">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-gray-500 font-bold">{t('clients.phone')}:</span> <span className="font-black text-gray-800">{client.phone || '—'}</span></div>
          <div><span className="text-gray-500 font-bold">{t('clients.email')}:</span> <span className="font-black text-gray-800">{client.email || '—'}</span></div>
          <div><span className="text-gray-500 font-bold">{t('clients.group')}:</span> <span className="font-black text-gray-800">{client.group_name || '—'}</span></div>
          <div><span className="text-gray-500 font-bold">{t('clients.registrationDate')}:</span> <span className="font-black text-gray-800">{client.registration_time || '—'}</span></div>
        </div>
      </SectionCard>

      {batch && (
        <SectionCard title="معلومات المجموعة" icon={Users} accent="indigo">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-500 font-bold">Course:</span> <span className="font-black text-gray-800">{batch.course}</span></div>
            <div><span className="text-gray-500 font-bold">Status:</span> <Badge value={batch.status} /></div>
            <div><span className="text-gray-500 font-bold">Trainer:</span> <span className="font-black text-gray-800">{batch.trainers}</span></div>
            <div><span className="text-gray-500 font-bold">Trainees:</span> <span className="font-black text-gray-800">{batch.trainee_count}/{batch.max_trainees}</span></div>
            <div><span className="text-gray-500 font-bold">Start:</span> <span className="font-black text-gray-800">{batch.start_date?.slice(0,10)}</span></div>
            <div><span className="text-gray-500 font-bold">Coordinator:</span> <span className="font-black text-gray-800">{batch.coordinators}</span></div>
          </div>
        </SectionCard>
      )}

      {remarks?.length > 0 && (
        <SectionCard title={`${t('tasks.title')} (${remarks.length})`} icon={Users} accent="amber">
          <div className="space-y-2">
            {remarks.slice(0, 5).map(r => (
              <div key={r.id} className="flex items-start gap-2.5 text-sm p-3 bg-gray-50 rounded-xl border border-gray-100">
                <Badge value={r.priority} />
                <div className="flex-1 min-w-0">
                  <p className="font-black text-gray-800">{r.task_type}</p>
                  {r.details && <p className="text-gray-500 text-xs font-bold mt-0.5 line-clamp-2">{r.details}</p>}
                </div>
                <Badge value={r.status} className="ms-auto" />
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {absences?.length > 0 && (
        <SectionCard title={`${t('absent.title')} (${absences.length})`} icon={Users} accent="rose">
          <div className="space-y-2 text-sm">
            {absences.map((a, i) => (
              <div key={i} className="flex gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100 items-center">
                <span className="text-gray-500 font-bold text-xs">{a.date?.slice(0,10)}</span>
                <span className="font-black text-gray-800">Lecture #{a.lecture_no}</span>
                <Badge value={a.follow_up_status} ns="absent" className="ms-auto" />
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

export default function ClientSearch() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [by, setBy] = useState('name');
  const [selectedId, setSelectedId] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['clients-search', q, by],
    queryFn: () => api.get('/clients/search', { params: { q, by } }).then(r => r.data),
    enabled: q.length >= 2,
  });

  if (selectedId) return <ClientDetail clientId={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title={t('nav.clientSearch')}
        subtitle="ابحث عن أي عميل بالاسم أو رقم الهاتف"
        icon={Search}
        gradient="cyan"
      />

      {/* Search bar */}
      <div className="bg-white/80 backdrop-blur-md border border-gray-100 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-2 flex-1 min-w-[260px]">
            <Search size={14} className="text-gray-400" />
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('clients.searchPlaceholder')}
              className="bg-transparent text-sm font-bold text-gray-700 focus:outline-none flex-1"
            />
          </div>
          <select className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30" value={by} onChange={e => setBy(e.target.value)}>
            <option value="name">{t('clients.byName')}</option>
            <option value="phone">{t('clients.byPhone')}</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="bg-white rounded-3xl border border-gray-100 py-12 text-center text-gray-400 text-sm font-bold">
          {t('common.loading')}
        </div>
      )}

      {!isLoading && data?.total === 0 && q.length >= 2 && (
        <div className="bg-white rounded-3xl border border-gray-100">
          <EmptyState
            icon={Search}
            accent="gray"
            title={t('clients.noResults')}
            message={`لم يتم العثور على نتائج لـ "${q}"`}
          />
        </div>
      )}

      {data?.total > 0 && (
        <>
          <p className="text-xs font-black text-gray-500 px-1">{data.total} نتيجة</p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.data.map(c => (
              <ClientCard key={c.id} client={c} onClick={() => setSelectedId(c.id)} />
            ))}
          </div>
        </>
      )}

      {!q && (
        <div className="bg-white rounded-3xl border border-gray-100">
          <EmptyState
            icon={Search}
            accent="blue"
            title="ابدأ البحث"
            message={t('clients.searchPlaceholder')}
          />
        </div>
      )}
    </div>
  );
}
