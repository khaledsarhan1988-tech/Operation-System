import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight, User, Phone, Calendar, Clock, AlertTriangle, CheckCircle,
  Bell, BellRing, Plus, Edit3, Trash2, Check, UserCog, History,
  GraduationCap, BookOpen, DollarSign, ChevronDown, ChevronUp,
} from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../auth/AuthContext';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import ModernButton from '../../components/ui/ModernButton';
import Modal from '../../components/ui/Modal';

/**
 * Client Subscription Tracker — per-client profile page.
 *
 * URL: /subscriptions/client/:phone
 * Roles: any authenticated user, but visibility filters server-side (see
 * scopeForUser in csReminders.service.js).
 */

const TRACK_COLORS = {
  Starter:      'bg-amber-100 text-amber-700 border-amber-200',
  General:      'bg-blue-100  text-blue-700  border-blue-200',
  Conversation: 'bg-violet-100 text-violet-700 border-violet-200',
};

const SEVERITY_STYLE = {
  info:     { bg: 'bg-cyan-50',    border: 'border-cyan-200',    text: 'text-cyan-800',    label: 'معلومة' },
  warning:  { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-800',   label: 'تنبيه ناعم' },
  urgent:   { bg: 'bg-orange-50',  border: 'border-orange-200',  text: 'text-orange-800',  label: 'تنبيه قوي' },
  critical: { bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-800',    label: 'تنبيه حازم' },
  soft:     { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', label: 'ملحوظة' },
  medium:   { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-800',   label: 'متوسط' },
  hard:     { bg: 'bg-orange-50',  border: 'border-orange-200',  text: 'text-orange-800',  label: 'مهم' },
};

function fmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}
function fmtDateTime(d) {
  if (!d) return '—';
  return String(d).slice(0, 16).replace('T', ' ');
}

// ─── PLAN GRID ────────────────────────────────────────────────────────────────
function PlanGrid({ plan }) {
  if (!plan?.planned_levels?.length) {
    return (
      <div className="p-6 text-center text-gray-400">
        <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-30" />
        <p className="text-sm">مفيش خطة مستويات محسوبة لهذا العميل</p>
        <p className="text-xs mt-1">محتاج اشتراك مدفوع + مستوى أول مستلم في Drive</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
      {plan.planned_levels.map(l => {
        const done = l.status === 'completed';
        return (
          <div
            key={l.order}
            className={`p-3 rounded-lg border-2 text-center ${done
              ? 'bg-emerald-50 border-emerald-300'
              : 'bg-white border-dashed border-gray-300'}`}
          >
            <div className="flex items-center justify-center gap-1 mb-1">
              {done && <CheckCircle size={14} className="text-emerald-600" />}
              <span className="text-[10px] font-bold opacity-60">#{l.order}</span>
            </div>
            <p className={`text-sm font-bold ${done ? 'text-emerald-800' : 'text-gray-600'}`}>
              {l.track} {l.level}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ─── REMINDER FORM ────────────────────────────────────────────────────────────
function ReminderFormModal({ open, onClose, phone, onSaved }) {
  const [reminderAt, setReminderAt] = useState('');
  const [severity,   setSeverity]   = useState('soft');
  const [note,       setNote]       = useState('');
  const [saving,     setSaving]     = useState(false);
  const [err,        setErr]        = useState('');

  const handleSubmit = async () => {
    setErr('');
    if (!reminderAt || !note.trim()) {
      setErr('التاريخ والملحوظة مطلوبين');
      return;
    }
    setSaving(true);
    try {
      await api.post('/cs/reminders', {
        phone,
        reminder_at: reminderAt,
        severity,
        note: note.trim(),
        reminder_type: 'manual',
      });
      setReminderAt(''); setSeverity('soft'); setNote('');
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="إضافة تذكير جديد" size="md">
      <div className="space-y-4 p-4">
        <div>
          <label className="block text-sm font-bold mb-1">تاريخ التذكير *</label>
          <input
            type="datetime-local"
            value={reminderAt}
            onChange={e => setReminderAt(e.target.value)}
            className="w-full px-3 py-2 border-2 rounded-lg focus:border-blue-400 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-bold mb-1">شدة التذكير</label>
          <select
            value={severity}
            onChange={e => setSeverity(e.target.value)}
            className="w-full px-3 py-2 border-2 rounded-lg focus:border-blue-400 outline-none"
          >
            <option value="soft">ناعم</option>
            <option value="medium">متوسط</option>
            <option value="hard">مهم</option>
            <option value="critical">حازم</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-bold mb-1">الملحوظة (خاصة بهذا التذكير) *</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={4}
            placeholder="مثال: اتصلت بالعميل، قال هياخد المستوى الجاي يوم 5 الشهر الجاي"
            className="w-full px-3 py-2 border-2 rounded-lg focus:border-blue-400 outline-none resize-none"
          />
          <p className="text-xs text-gray-500 mt-1">كل تذكير له ملحوظته الخاصة — مش بتتعدل ملاحظة سابقة.</p>
        </div>
        {err && <p className="text-sm text-rose-600 font-bold">{err}</p>}
        <div className="flex justify-end gap-2">
          <ModernButton variant="ghost" onClick={onClose}>إلغاء</ModernButton>
          <ModernButton onClick={handleSubmit} disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'حفظ التذكير'}
          </ModernButton>
        </div>
      </div>
    </Modal>
  );
}

// ─── CHANGE COORDINATOR MODAL ─────────────────────────────────────────────────
function ChangeCoordinatorModal({ open, onClose, phone, current, onSaved }) {
  const [selected, setSelected] = useState('');
  const [notes,    setNotes]    = useState('');
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState('');

  const { data } = useQuery({
    queryKey: ['cs-coordinators'],
    queryFn: () => api.get('/cs/coordinators').then(r => r.data),
    enabled: open,
  });

  const coords = data?.coordinators || [];

  const submit = async () => {
    setErr('');
    if (!selected) { setErr('اختر منسق'); return; }
    setSaving(true);
    try {
      await api.post('/cs/coordinator/assign', {
        phone, coordinator_id: parseInt(selected, 10), notes: notes.trim() || null,
      });
      setSelected(''); setNotes('');
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="تغيير منسق العميل" size="md">
      <div className="space-y-4 p-4">
        {current && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-xs text-blue-600 font-bold mb-1">المنسق الحالي</p>
            <p className="font-bold text-blue-900">{current.coordinator_name}</p>
          </div>
        )}
        <div>
          <label className="block text-sm font-bold mb-1">المنسق الجديد *</label>
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            className="w-full px-3 py-2 border-2 rounded-lg focus:border-blue-400 outline-none"
          >
            <option value="">-- اختر --</option>
            <optgroup label="إدارة المواعيد (Enrollment)">
              {coords.filter(c => c.is_enrollment).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
            <optgroup label="باقي الموظفين">
              {coords.filter(c => !c.is_enrollment).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <div>
          <label className="block text-sm font-bold mb-1">سبب التغيير (اختياري)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border-2 rounded-lg focus:border-blue-400 outline-none resize-none"
          />
        </div>
        {err && <p className="text-sm text-rose-600 font-bold">{err}</p>}
        <div className="flex justify-end gap-2">
          <ModernButton variant="ghost" onClick={onClose}>إلغاء</ModernButton>
          <ModernButton onClick={submit} disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'تأكيد التغيير'}
          </ModernButton>
        </div>
      </div>
    </Modal>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function CsClientProfile() {
  const { phone } = useParams();
  const navigate  = useNavigate();
  const { user }  = useAuth();
  const qc        = useQueryClient();
  const [showAddReminder,   setShowAddReminder]   = useState(false);
  const [showChangeCoord,   setShowChangeCoord]   = useState(false);
  const [showCoordHistory,  setShowCoordHistory]  = useState(false);

  const canDelete = user?.role === 'admin' || user?.management === 'All';

  const planQ = useQuery({
    queryKey: ['cs-plan', phone],
    queryFn: () => api.get(`/cs/plan/by-phone/${encodeURIComponent(phone)}`).then(r => r.data),
  });
  const remQ = useQuery({
    queryKey: ['cs-reminders', phone],
    queryFn: () => api.get(`/cs/reminders/by-phone/${encodeURIComponent(phone)}`).then(r => r.data),
  });
  const coordQ = useQuery({
    queryKey: ['cs-coord', phone],
    queryFn: () => api.get(`/cs/coordinator/by-phone/${encodeURIComponent(phone)}`).then(r => r.data),
  });
  const notifQ = useQuery({
    queryKey: ['cs-notif', phone],
    queryFn: () => api.get(`/cs/notifications/by-phone/${encodeURIComponent(phone)}`).then(r => r.data),
  });

  const markDone = useMutation({
    mutationFn: (id) => api.post(`/cs/reminders/${id}/done`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cs-reminders', phone] }),
  });
  const delReminder = useMutation({
    mutationFn: (id) => api.delete(`/cs/reminders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cs-reminders', phone] }),
  });

  const plan      = planQ.data?.plan;
  const summary   = plan?.summary || {};
  const reminders = remQ.data?.reminders || [];
  const current   = coordQ.data?.current;
  const history   = coordQ.data?.history || [];
  const notifs    = (notifQ.data?.notifications || []).filter(n => n.is_active);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" dir="rtl">
      <ModernButton variant="ghost" onClick={() => navigate(-1)} className="mb-3">
        <ArrowRight size={16} /> رجوع
      </ModernButton>

      <PageHero
        title={plan?.completed?.[0]?.client_name_raw || `العميل ${phone}`}
        subtitle={<span className="flex items-center gap-2"><Phone size={14} /> {phone}</span>}
        icon={User}
        color="violet"
      />

      {/* Active Notifications strip */}
      {notifs.length > 0 && (
        <div className="mt-4 space-y-2">
          {notifs.map(n => {
            const s = SEVERITY_STYLE[n.severity] || SEVERITY_STYLE.warning;
            return (
              <div key={n.id} className={`${s.bg} ${s.border} border-2 rounded-xl p-3 flex items-start gap-3`}>
                <BellRing className={s.text} size={20} />
                <div className="flex-1 min-w-0">
                  <p className={`font-bold ${s.text}`}>{n.title || n.notif_type}</p>
                  {n.message && <p className={`text-sm ${s.text} opacity-80 mt-1`}>{n.message}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <StatTile label="مستويات مدفوعة" value={summary.paid_months} icon={DollarSign} color="blue" />
        <StatTile label="مستويات مستكملة" value={summary.completed_count} icon={CheckCircle} color="emerald" />
        <StatTile label="مستويات معلقة" value={summary.pending_count} icon={Clock} color="amber" />
        <StatTile label="أيام بدون مستوى جديد" value={summary.days_since_last_level ?? '—'} icon={AlertTriangle} color="rose" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        {/* LEFT: Plan + Levels */}
        <div className="lg:col-span-2 space-y-4">
          <SectionCard title="خطة المستويات" icon={GraduationCap}>
            <div className="p-3">
              <PlanGrid plan={plan} />
              {plan?.summary?.overflow_months > 0 && (
                <div className="mt-3 bg-cyan-50 border-2 border-cyan-200 rounded-lg p-3 text-sm">
                  <strong>🎯 العميل مؤهل لكورسات إضافية:</strong>{' '}
                  وصل لأعلى مستوى ({plan.summary.max_reached_label})، عنده {plan.summary.overflow_months} شهر/كورس متبقي للكورسات الإضافية (Business / Conversation).
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="التذكيرات والملحوظات" icon={Bell} action={
            <ModernButton size="sm" onClick={() => setShowAddReminder(true)}>
              <Plus size={14} /> تذكير جديد
            </ModernButton>
          }>
            <div className="p-3 space-y-2">
              {reminders.length === 0 ? (
                <p className="text-center text-gray-400 py-6">مفيش تذكيرات لسه</p>
              ) : reminders.map(r => {
                const s = SEVERITY_STYLE[r.severity] || SEVERITY_STYLE.soft;
                const isDeleted = !!r.deleted_at;
                return (
                  <div key={r.id} className={`${s.bg} ${s.border} border-2 rounded-xl p-3 ${isDeleted ? 'opacity-50 line-through' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs mb-1">
                          <span className={`px-2 py-0.5 rounded-full font-bold ${s.bg} ${s.text} border ${s.border}`}>
                            {s.label}
                          </span>
                          <span className="text-gray-500">
                            {fmtDateTime(r.reminder_at)}
                          </span>
                          {r.status === 'done' && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                              ✓ تم
                            </span>
                          )}
                        </div>
                        <p className={`text-sm ${s.text} whitespace-pre-wrap`}>{r.note}</p>
                        <p className="text-[11px] text-gray-500 mt-2">
                          عمله: <strong>{r.created_by_name || '—'}</strong>
                          {r.coordinator_name && ` (منسق: ${r.coordinator_name})`}
                          {' • '}{fmtDateTime(r.created_at)}
                          {r.updated_at && r.updated_at !== r.created_at && (
                            <> {' • '}آخر تعديل: {fmtDateTime(r.updated_at)} بواسطة {r.updated_by_name}</>
                          )}
                        </p>
                      </div>
                      {!isDeleted && (
                        <div className="flex items-center gap-1">
                          {r.status !== 'done' && (
                            <button
                              onClick={() => markDone.mutate(r.id)}
                              title="تم"
                              className="p-1.5 hover:bg-white rounded text-emerald-700"
                            >
                              <Check size={16} />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => { if (confirm('متأكد إنك عاوز تحذف؟')) delReminder.mutate(r.id); }}
                              title="حذف"
                              className="p-1.5 hover:bg-white rounded text-rose-700"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </div>

        {/* RIGHT: Coordinator + History */}
        <div className="space-y-4">
          <SectionCard title="المنسق المسؤول" icon={UserCog} action={
            user?.role === 'admin' || user?.role === 'leader' ? (
              <ModernButton size="sm" variant="ghost" onClick={() => setShowChangeCoord(true)}>
                <Edit3 size={14} /> تغيير
              </ModernButton>
            ) : null
          }>
            <div className="p-3">
              {current ? (
                <div className="bg-violet-50 border-2 border-violet-200 rounded-xl p-3">
                  <p className="text-xs text-violet-600 font-bold mb-1">المنسق الحالي</p>
                  <p className="text-lg font-black text-violet-900">{current.coordinator_name}</p>
                  <p className="text-xs text-violet-700 mt-1">{current.coordinator_section}</p>
                  <p className="text-[11px] text-gray-500 mt-2">منذ: {fmtDateTime(current.assigned_at)}</p>
                </div>
              ) : (
                <p className="text-center text-gray-400 py-4">مفيش منسق محدد بعد</p>
              )}

              {history.length > 1 && (
                <button
                  onClick={() => setShowCoordHistory(v => !v)}
                  className="mt-3 w-full text-sm text-blue-600 hover:bg-blue-50 rounded py-2 flex items-center justify-center gap-1"
                >
                  <History size={14} />
                  {showCoordHistory ? 'إخفاء' : 'عرض'} السجل ({history.length - 1})
                  {showCoordHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              )}

              {showCoordHistory && (
                <div className="mt-2 space-y-2">
                  {history.filter(h => h.unassigned_at).map(h => (
                    <div key={h.id} className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-xs">
                      <p className="font-bold text-gray-700">{h.coordinator_name}</p>
                      <p className="text-gray-500">
                        {fmtDate(h.assigned_at)} → {fmtDate(h.unassigned_at)}
                      </p>
                      {h.notes && <p className="text-gray-600 mt-1 italic">{h.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="الاشتراكات المدفوعة" icon={DollarSign}>
            <div className="p-3 space-y-2">
              {(plan?.paid?.breakdown || []).map(b => (
                <div key={b.id} className="bg-blue-50 border border-blue-200 rounded-lg p-2 text-xs">
                  <p className="font-bold text-blue-900">{b.dept} • {b.months} شهر</p>
                  {b.is_installment ? <span className="text-amber-700 text-[10px]">قسط</span> : null}
                  <p className="text-blue-700 mt-1 truncate" title={b.product_name_raw}>{b.product_name_raw}</p>
                  <p className="text-gray-500 mt-1 text-[10px]">{b.source} • {fmtDate(b.subscription_date || b.created_at)}</p>
                </div>
              ))}
              {(!plan?.paid?.breakdown || !plan.paid.breakdown.length) && (
                <p className="text-center text-gray-400 py-4">مفيش اشتراكات مسجلة</p>
              )}
            </div>
          </SectionCard>
        </div>
      </div>

      <ReminderFormModal
        open={showAddReminder}
        onClose={() => setShowAddReminder(false)}
        phone={phone}
        onSaved={() => qc.invalidateQueries({ queryKey: ['cs-reminders', phone] })}
      />
      <ChangeCoordinatorModal
        open={showChangeCoord}
        onClose={() => setShowChangeCoord(false)}
        phone={phone}
        current={current}
        onSaved={() => qc.invalidateQueries({ queryKey: ['cs-coord', phone] })}
      />
    </div>
  );
}

// ─── STATS TILE ───────────────────────────────────────────────────────────────
function StatTile({ label, value, icon: Icon, color = 'blue' }) {
  const palettes = {
    blue:    'from-blue-50 to-blue-100 text-blue-900 border-blue-200',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-900 border-emerald-200',
    violet:  'from-violet-50 to-violet-100 text-violet-900 border-violet-200',
    amber:   'from-amber-50 to-amber-100 text-amber-900 border-amber-200',
    rose:    'from-rose-50 to-rose-100 text-rose-900 border-rose-200',
  };
  return (
    <div className={`bg-gradient-to-br ${palettes[color]} border-2 rounded-2xl p-3 flex items-center gap-3`}>
      {Icon && <Icon size={24} className="opacity-80 flex-shrink-0" />}
      <div className="min-w-0">
        <p className="text-xs font-bold opacity-70">{label}</p>
        <p className="text-2xl font-black tabular-nums">{value != null ? String(value) : '—'}</p>
      </div>
    </div>
  );
}
