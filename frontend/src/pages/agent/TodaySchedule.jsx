import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import api from '../../api/axios';
import Badge from '../../components/ui/Badge';
import { Clock, User, MapPin, Timer } from 'lucide-react';

export default function TodaySchedule() {
  const { t } = useTranslation();
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['agent-schedule', date],
    queryFn: () => api.get(`/agent/schedule?date=${date}`).then(r => r.data),
  });

  const main = sessions?.filter(s => s.session_type === 'main') || [];
  const side = sessions?.filter(s => s.session_type === 'side') || [];

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-text-primary">{t('nav.todaySchedule')}</h1>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="input w-44"
        />
      </div>

      {isLoading && <p className="text-center py-8 text-text-secondary">{t('common.loading')}</p>}

      {!isLoading && !sessions?.length && (
        <div className="text-center py-16 text-text-secondary">
          <p className="text-4xl mb-3">📅</p>
          <p>{t('schedule.noSchedule')}</p>
        </div>
      )}

      {main.length > 0 && (
        <div>
          <h2 className="font-semibold text-text-primary mb-3 flex items-center gap-2">
            <Badge value="main" ns="schedule" /> {t('schedule.main')} ({main.length})
          </h2>
          <div className="grid md:grid-cols-2 gap-3">
            {main.map((s, i) => (
              <SessionCard key={i} session={s} />
            ))}
          </div>
        </div>
      )}

      {side.length > 0 && (
        <div>
          <h2 className="font-semibold text-text-primary mb-3 flex items-center gap-2">
            <Badge value="side" ns="schedule" /> {t('schedule.side')} ({side.length})
          </h2>
          <div className="grid md:grid-cols-2 gap-3">
            {side.map((s, i) => (
              <SessionCard key={i} session={s} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionCard({ session: s }) {
  const { t } = useTranslation();
  return (
    <div className="card hover:shadow-card-hover transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <p className="text-sm font-medium text-text-primary line-clamp-2 flex-1 me-2">{s.group_name}</p>
        <div className="flex gap-1 flex-shrink-0">
          <Badge value={s.session_type} ns="schedule" />
          {s.side_session_category && <Badge value={s.side_session_category} ns="schedule" />}
        </div>
      </div>
      <div className="space-y-1 text-xs text-text-secondary">
        <div className="flex items-center gap-1.5"><Clock size={12} />{s.time}</div>
        {s.trainer && <div className="flex items-center gap-1.5"><User size={12} />{s.trainer}</div>}
        {s.duration && <div className="flex items-center gap-1.5"><Timer size={12} />{s.duration}</div>}
        {s.location && <div className="flex items-center gap-1.5"><MapPin size={12} />{s.location}</div>}
      </div>
      {s.status && (
        <div className="mt-2">
          <Badge value={s.status} />
        </div>
      )}
    </div>
  );
}
