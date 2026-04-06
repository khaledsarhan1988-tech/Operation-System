import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import api from '../../api/axios';
import Badge from '../../components/ui/Badge';
import { Clock, User, MapPin, Timer } from 'lucide-react';

function SessionCard({ session: s }) {
  return (
    <div className="card hover:shadow-card-hover transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <p className="text-sm font-medium text-gray-800 line-clamp-2 flex-1 me-2">{s.group_name}</p>
        <div className="flex gap-1 flex-shrink-0">
          <Badge value={s.session_type} ns="schedule" />
          {s.side_session_category && <Badge value={s.side_session_category} ns="schedule" />}
        </div>
      </div>
      <div className="space-y-1 text-xs text-gray-500">
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

export default function TodaySchedule() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [activeTab, setActiveTab] = useState('side');

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['agent-schedule', date],
    queryFn: () => api.get(`/agent/schedule?date=${date}`).then(r => r.data),
  });

  const main = sessions?.filter(s => s.session_type === 'main') || [];
  const side = sessions?.filter(s => s.session_type === 'side') || [];
  const current = activeTab === 'main' ? main : side;

  return (
    <div className="space-y-5 animate-fadeIn">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900">{t('nav.todaySchedule')}</h1>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="input w-44"
        />
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
          {isAr ? 'جانبية' : 'Side'}
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold
            ${activeTab === 'side' ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'}`}>
            {side.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('main')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all border-2
            ${activeTab === 'main'
              ? 'bg-accent text-white border-accent shadow-md'
              : 'bg-white text-gray-600 border-gray-200 hover:border-accent hover:text-accent'}`}
        >
          {isAr ? 'رئيسية' : 'Main'}
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold
            ${activeTab === 'main' ? 'bg-white/20 text-white' : 'bg-accent/10 text-accent'}`}>
            {main.length}
          </span>
        </button>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="text-center py-16 text-gray-400">{t('common.loading')}</div>
      )}

      {!isLoading && current.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📅</p>
          <p>{t('schedule.noSchedule')}</p>
        </div>
      )}

      {!isLoading && current.length > 0 && (
        <div className="grid md:grid-cols-2 gap-3">
          {current.map((s, i) => (
            <SessionCard key={i} session={s} />
          ))}
        </div>
      )}

    </div>
  );
}
