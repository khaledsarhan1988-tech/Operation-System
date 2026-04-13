import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Download, CheckCircle, BookOpen, Monitor, Clock, Save } from 'lucide-react';
import api from '../../api/axios';
import Badge from '../../components/ui/Badge';

// Parse time string (HH:MM or H:MM AM/PM) → total minutes from midnight
function parseTimeMins(t) {
  if (!t) return null;
  const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return parseInt(m24[1]) * 60 + parseInt(m24[2]);
  const m12 = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (m12) {
    let h = parseInt(m12[1]);
    const min = parseInt(m12[2]);
    if (m12[3].toUpperCase() === 'PM' && h < 12) h += 12;
    if (m12[3].toUpperCase() === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  }
  return null;
}

function calcDelay(scheduledTime, actualTime) {
  const scheduled = parseTimeMins(scheduledTime);
  const actual    = parseTimeMins(actualTime);
  if (scheduled === null || actual === null) return null;
  return actual - scheduled;
}

function DelayBadge({ delay }) {
  if (delay === null) return <span className="text-text-secondary text-sm">—</span>;
  if (delay === 0)    return <span className="text-success font-semibold text-sm">في الموعد ✓</span>;
  if (delay > 0)      return <span className="text-danger font-bold text-sm">متأخر {delay} دقيقة</span>;
  return <span className="text-blue-500 font-semibold text-sm">مبكر {Math.abs(delay)} دقيقة</span>;
}

// Build default form values for a session
function defaultForm(session) {
  return {
    trainer_present:     session.trainer_present   ?? 1,
    student_present:     session.student_present   ?? 1,
    lecture_start_time:  session.lecture_start_time || '',
    actual_duration_min: session.actual_duration_min ?? 15,
    notes:               session.check_notes || '',
  };
}

function SessionCheckCard({ session, onSave }) {
  const { t } = useTranslation();
  const isChecked = !!session.check_id;

  const [form, setForm] = useState(() => defaultForm(session));
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(isChecked);

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setSaved(false); };

  const delay = calcDelay(session.time, form.lecture_start_time);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(session, form);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  // Expose save for bulk-save
  SessionCheckCard._instances = SessionCheckCard._instances || {};

  const PresenceBtn = ({ label, value, selected, onClick }) => (
    <button
      onClick={onClick}
      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
        selected === value
          ? value === 1
            ? 'bg-success/10 border-success text-success'
            : 'bg-danger/10 border-danger text-danger'
          : 'bg-surface border-border text-text-secondary hover:bg-gray-100'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className={`card relative ${saved ? 'border-success/30' : ''}`}>
      {saved && (
        <div className="absolute top-3 end-3">
          <CheckCircle size={18} className="text-success" />
        </div>
      )}

      {/* Header */}
      <div className="mb-4 pe-6">
        <p className="text-sm font-semibold text-text-primary break-all">{session.group_name}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Clock size={13} className="text-text-secondary" />
          <span className="text-xs font-mono text-text-secondary">{session.time}</span>
          {session.side_session_category && <Badge value={session.side_session_category} ns="schedule" />}
          {session.trainer && <span className="text-xs text-text-secondary">· {session.trainer}</span>}
        </div>
      </div>

      {/* Presence buttons */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-text-secondary mb-1.5">{t('sideSession.trainerPresent')}</p>
          <div className="flex gap-2">
            <PresenceBtn label={t('sideSession.yes')} value={1} selected={form.trainer_present} onClick={() => set('trainer_present', 1)} />
            <PresenceBtn label={t('sideSession.no')}  value={0} selected={form.trainer_present} onClick={() => set('trainer_present', 0)} />
          </div>
        </div>
        <div>
          <p className="text-xs text-text-secondary mb-1.5">{t('sideSession.studentPresent')}</p>
          <div className="flex gap-2">
            <PresenceBtn label={t('sideSession.yes')} value={1} selected={form.student_present} onClick={() => set('student_present', 1)} />
            <PresenceBtn label={t('sideSession.no')}  value={0} selected={form.student_present} onClick={() => set('student_present', 0)} />
          </div>
        </div>
      </div>

      {/* Time row */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="label text-xs">وقت بداية المحاضرة الفعلية</label>
          <input
            type="time"
            className="input text-sm"
            value={form.lecture_start_time}
            onChange={e => set('lecture_start_time', e.target.value)}
          />
        </div>
        <div>
          <label className="label text-xs">إجمالي مدة التأخير</label>
          <div className="input text-sm flex items-center min-h-[38px] bg-gray-50">
            <DelayBadge delay={delay} />
          </div>
        </div>
      </div>

      {/* Duration */}
      <div className="mb-4">
        <label className="label text-xs">{t('sideSession.actualDuration')}</label>
        <input
          type="number"
          min="1"
          max="120"
          className="input text-sm"
          value={form.actual_duration_min}
          onChange={e => set('actual_duration_min', e.target.value)}
        />
      </div>

      {/* Notes */}
      <div className="mb-4">
        <label className="label text-xs">{t('sideSession.notes')}</label>
        <textarea
          className="input h-16 resize-none text-sm"
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
        />
      </div>

      <button onClick={handleSave} disabled={saving} className="btn-primary w-full text-sm">
        {saving ? t('common.loading') : saved ? `✓ ${t('sideSession.saved')}` : t('sideSession.save')}
      </button>
    </div>
  );
}

export default function SideSessionCheck() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [date, setDate]               = useState(format(new Date(), 'yyyy-MM-dd'));
  const [sessionType, setSessionType] = useState('side');
  const [bulkSaving, setBulkSaving]   = useState(false);
  const [bulkDone,   setBulkDone]     = useState(false);

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['side-session-check', date, sessionType],
    queryFn: () => api.get(`/agent/side-session-check?date=${date}&session_type=${sessionType}`).then(r => r.data),
    onSuccess: () => { setBulkDone(false); },
  });

  const handleSave = useCallback(async (session, form) => {
    const payload = {
      lecture_start_time:  form.lecture_start_time  || null,
      recording_start_time: null,
      actual_duration_min: form.actual_duration_min || null,
      notes:               form.notes               || null,
      trainer_present:     form.trainer_present,
      student_present:     form.student_present,
    };
    if (session.check_id) {
      await api.put(`/agent/side-session-check/${session.check_id}`, payload);
    } else {
      await api.post('/agent/side-session-check', {
        lecture_id: session.id,
        group_name: session.group_name,
        session_date: date,
        ...payload,
      });
    }
    qc.invalidateQueries(['side-session-check', date, sessionType]);
  }, [date, sessionType, qc]);

  // Bulk save: save ALL sessions at once with their current (default) values
  const handleBulkSave = async () => {
    if (!sessions?.length) return;
    setBulkSaving(true);
    try {
      // Save all sessions concurrently using default form values
      await Promise.all(
        sessions.map(session => handleSave(session, defaultForm(session)))
      );
      setBulkDone(true);
      await qc.invalidateQueries(['side-session-check', date, sessionType]);
    } finally {
      setBulkSaving(false);
    }
  };

  const handleExport = () => {
    window.open(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/export/side-sessions?date=${date}`, '_blank');
  };

  const checkedCount = sessions?.filter(s => s.check_id)?.length || 0;
  const total        = sessions?.length || 0;
  const allChecked   = total > 0 && checkedCount === total;

  return (
    <div className="space-y-4 animate-fadeIn">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-text-primary">{t('nav.sideSessionCheck')}</h1>
        <div className="flex gap-2">
          <input type="date" value={date} onChange={e => { setDate(e.target.value); setBulkDone(false); }} className="input w-44" />
          <button onClick={handleExport} className="btn-outline flex items-center gap-2 text-sm">
            <Download size={15} /> {t('common.export')}
          </button>
        </div>
      </div>

      {/* Session type tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => { setSessionType('main'); setBulkDone(false); }}
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
          onClick={() => { setSessionType('side'); setBulkDone(false); }}
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

      {/* Progress bar + bulk save */}
      {total > 0 && (
        <div className="card p-3 space-y-2">
          <div className="flex justify-between text-xs text-text-secondary mb-1">
            <span>{t('sideSession.todaySessions')}: {total}</span>
            <span>{checkedCount}/{total} — {Math.round((checkedCount / total) * 100)}%</span>
          </div>
          <div className="h-2 bg-surface rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 rounded-full ${sessionType === 'main' ? 'bg-blue-500' : 'bg-purple-500'}`}
              style={{ width: `${(checkedCount / total) * 100}%` }}
            />
          </div>

          {/* Bulk save button */}
          {!allChecked && (
            <button
              onClick={handleBulkSave}
              disabled={bulkSaving}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all
                ${bulkSaving
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-success text-white hover:bg-success/90 shadow-sm'
                }`}
            >
              <Save size={15} />
              {bulkSaving ? 'جاري الحفظ...' : `حفظ جميع الجلسات (${total - checkedCount} متبقية)`}
            </button>
          )}
          {(allChecked || bulkDone) && (
            <div className="flex items-center justify-center gap-2 py-2 text-success text-sm font-semibold">
              <CheckCircle size={16} /> تم حفظ جميع الجلسات ✓
            </div>
          )}
        </div>
      )}

      {isLoading && <p className="text-center py-8 text-text-secondary">{t('common.loading')}</p>}

      {!isLoading && !total && (
        <div className="text-center py-16 text-text-secondary">
          <p className="text-4xl mb-3">📋</p>
          <p>{t('sideSession.noSessions')}</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sessions?.map((s, i) => (
          <SessionCheckCard key={s.id ?? i} session={s} onSave={handleSave} />
        ))}
      </div>
    </div>
  );
}
