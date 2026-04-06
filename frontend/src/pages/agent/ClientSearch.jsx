import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Phone, Mail, Users } from 'lucide-react';
import api from '../../api/axios';
import SearchBar from '../../components/ui/SearchBar';
import Badge from '../../components/ui/Badge';

function ClientCard({ client, onClick }) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onClick}
      className="card cursor-pointer hover:shadow-card-hover transition-shadow"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-text-primary">{client.name}</h3>
        {client.group_name && <span className="text-xs text-text-secondary max-w-[50%] text-end truncate">{client.group_name}</span>}
      </div>
      <div className="space-y-1 text-sm text-text-secondary">
        {client.phone && (
          <div className="flex items-center gap-2">
            <Phone size={13} /> {client.phone}
          </div>
        )}
        {client.email && (
          <div className="flex items-center gap-2">
            <Mail size={13} /> {client.email}
          </div>
        )}
        {client.registration_time && (
          <div className="flex items-center gap-2">
            <Users size={13} /> {t('clients.registrationDate')}: {client.registration_time}
          </div>
        )}
      </div>
    </div>
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
    <div className="space-y-4 animate-fadeIn">
      <button onClick={onBack} className="btn-outline text-sm">← Back</button>

      <div className="card">
        <h2 className="font-bold text-lg text-text-primary mb-3">{client.name}</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-text-secondary">{t('clients.phone')}:</span> {client.phone || '—'}</div>
          <div><span className="text-text-secondary">{t('clients.email')}:</span> {client.email || '—'}</div>
          <div><span className="text-text-secondary">{t('clients.group')}:</span> {client.group_name || '—'}</div>
          <div><span className="text-text-secondary">{t('clients.registrationDate')}:</span> {client.registration_time || '—'}</div>
        </div>
      </div>

      {batch && (
        <div className="card">
          <h3 className="font-semibold text-text-primary mb-2">Group Info</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-text-secondary">Course:</span> {batch.course}</div>
            <div><span className="text-text-secondary">Status:</span> <Badge value={batch.status} /></div>
            <div><span className="text-text-secondary">Trainer:</span> {batch.trainers}</div>
            <div><span className="text-text-secondary">Trainees:</span> {batch.trainee_count}/{batch.max_trainees}</div>
            <div><span className="text-text-secondary">Start:</span> {batch.start_date?.slice(0,10)}</div>
            <div><span className="text-text-secondary">Coordinator:</span> {batch.coordinators}</div>
          </div>
        </div>
      )}

      {remarks?.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-text-primary mb-2">{t('tasks.title')} ({remarks.length})</h3>
          <div className="space-y-2">
            {remarks.slice(0, 5).map(r => (
              <div key={r.id} className="flex items-start gap-2 text-sm p-2 bg-surface rounded-lg">
                <Badge value={r.priority} />
                <div>
                  <p className="font-medium">{r.task_type}</p>
                  {r.details && <p className="text-text-secondary text-xs">{r.details}</p>}
                </div>
                <Badge value={r.status} className="ms-auto" />
              </div>
            ))}
          </div>
        </div>
      )}

      {absences?.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-text-primary mb-2">{t('absent.title')} ({absences.length})</h3>
          <div className="space-y-1 text-sm">
            {absences.map((a, i) => (
              <div key={i} className="flex gap-3 p-2 bg-surface rounded-lg">
                <span className="text-text-secondary">{a.date?.slice(0,10)}</span>
                <span>Lecture #{a.lecture_no}</span>
                <Badge value={a.follow_up_status} ns="absent" className="ms-auto" />
              </div>
            ))}
          </div>
        </div>
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
    <div className="space-y-5 animate-fadeIn">
      <h1 className="text-xl font-bold text-text-primary">{t('nav.clientSearch')}</h1>

      <div className="flex gap-3">
        <SearchBar value={q} onChange={setQ} placeholder={t('clients.searchPlaceholder')} className="flex-1" />
        <select className="input w-32" value={by} onChange={e => setBy(e.target.value)}>
          <option value="name">{t('clients.byName')}</option>
          <option value="phone">{t('clients.byPhone')}</option>
        </select>
      </div>

      {isLoading && <p className="text-center text-text-secondary py-8">{t('common.loading')}</p>}

      {!isLoading && data?.total === 0 && q.length >= 2 && (
        <p className="text-center text-text-secondary py-8">{t('clients.noResults')}</p>
      )}

      {data?.total > 0 && (
        <>
          <p className="text-sm text-text-secondary">{data.total} results</p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.data.map(c => (
              <ClientCard key={c.id} client={c} onClick={() => setSelectedId(c.id)} />
            ))}
          </div>
        </>
      )}

      {!q && (
        <div className="text-center py-16 text-text-secondary">
          <p className="text-4xl mb-3">🔍</p>
          <p>{t('clients.searchPlaceholder')}</p>
        </div>
      )}
    </div>
  );
}
