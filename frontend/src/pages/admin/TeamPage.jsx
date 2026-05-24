'use client';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Users, Plus, Pencil, Trash2, X, Search, Sun, Moon,
  Phone, Briefcase, CheckCircle, XCircle, ChevronDown, UserX,
  Clock, Calendar as CalendarIcon,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import EmptyState from '../../components/ui/EmptyState';
import ModernButton from '../../components/ui/ModernButton';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DEPTS = {
  customer_services: 'إدارة خدمة العملاء',
  education:         'الإدارة التعليمية',
  appointments:      'إدارة المواعيد',
};

const SECTIONS = {
  all:        'الكل',
  general:    'عام',
  private:    'خاص',
  semi:       'شبه خاص',
  phone_call: 'فون كول',
};

const SHIFTS = {
  morning: 'صباحي',
  evening: 'مسائي',
};

const EMPLOYMENT_TYPES = {
  full_time: 'Full Time',
  part_time: 'Part Time',
};

// Days of the week (Saturday → Thursday, no Friday)
const ALL_DAYS = ['saturday','sunday','monday','tuesday','wednesday','thursday'];

// Day pairs — selecting one day in a pair auto-selects its partner
const DAY_PAIRS = [
  { key: 'sat_tue', label: 'السبت + الثلاثاء',  days: ['saturday', 'tuesday']  },
  { key: 'sun_wed', label: 'الأحد + الأربعاء',  days: ['sunday',   'wednesday'] },
  { key: 'mon_thu', label: 'الاثنين + الخميس', days: ['monday',   'thursday']  },
];

const DEPT_SECTIONS = {
  customer_services: ['all', 'general', 'private', 'semi'],
  education:         ['all', 'general', 'private', 'semi', 'phone_call'],
  appointments:      ['all', 'general', 'private', 'semi'],
};

// Teachable courses — three independent tracks. Each value = highest level
// the trainer can teach (0 = not capable, max = all levels).
const COURSES = [
  { key: 'starter',      label: 'Starter',      max: 3 },
  { key: 'general',      label: 'General',      max: 5 },
  { key: 'conversation', label: 'Conversation', max: 5 },
];
const COURSE_FIELD = (key) => `teachable_${key}`;

const DEPT_COLORS = {
  customer_services: { bg: 'bg-blue-600',    light: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  education:         { bg: 'bg-emerald-600', light: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  appointments:      { bg: 'bg-orange-500',  light: 'bg-orange-50',  border: 'border-orange-200',  text: 'text-orange-700',  dot: 'bg-orange-500' },
};

const SECTION_COLORS = {
  general:    'bg-sky-100 text-sky-800 border-sky-200',
  private:    'bg-violet-100 text-violet-800 border-violet-200',
  semi:       'bg-amber-100 text-amber-800 border-amber-200',
  phone_call: 'bg-pink-100 text-pink-800 border-pink-200',
};

// ─── EMPTY FORM ───────────────────────────────────────────────────────────────
const emptyForm = {
  name: '', department: 'customer_services', section: 'general',
  line: 'Ahmed Hassan',
  shift: '', shift_start: '', shift_end: '', shift_rests: [], voice_notes: [],
  shift_start_date: '', shift_end_date: '',
  employment_type: '', work_days: '',
  shift2: '', shift2_start: '', shift2_end: '', shift2_rests: [], shift2_voice_notes: [],
  shift2_start_date: '', shift2_end_date: '',
  shift2_employment_type: '', shift2_work_days: '',
  job_title: '', phone: '', status: 'active', notes: '',
  // Teachable courses — default = max level (all unlocked) so new trainers
  // can teach everything until explicitly limited.
  teachable_starter: 3, teachable_general: 5, teachable_conversation: 5,
};

const LINES = {
  'All':          'الكل (الأكاديمية الرئيسية + دردشة)',
  'Ahmed Hassan': 'Ahmed Hassan (الأكاديمية الرئيسية)',
  'Dardasha':     'Dardasha (دردشة)',
};

// Safely parse a JSON-stored rests array — accepts string, array, or null/garbage.
function parseRests(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Hydrate a freshly-loaded member: parse rests strings into arrays so the form
// can edit them, leave everything else as-is.
function hydrateMember(member) {
  if (!member) return emptyForm;
  return {
    ...emptyForm,
    ...member,
    shift_rests:        parseRests(member.shift_rests),
    shift2_rests:       parseRests(member.shift2_rests),
    voice_notes:        parseRests(member.voice_notes),
    shift2_voice_notes: parseRests(member.shift2_voice_notes),
  };
}

// Build the dynamic `shifts` array that the UI uses for unlimited-shift
// editing. Prefers `member.shifts` (returned by the new backend) and falls
// back to the legacy `shift / shift2` columns for members not yet migrated.
function initialShifts(member) {
  if (!member) return [];
  if (Array.isArray(member.shifts) && member.shifts.length > 0) {
    return member.shifts.map(s => ({
      shift:            s.shift           || '',
      shift_start:      s.start           || '',
      shift_end:        s.end             || '',
      shift_rests:      parseRests(s.rests),
      voice_notes:      parseRests(s.voice_notes),
      employment_type:  s.employment_type || '',
      work_days:        s.work_days       || '',
      shift_start_date: s.start_date      || '',
      shift_end_date:   s.end_date        || '',
    }));
  }
  const out = [];
  if (member.shift) out.push({
    shift: member.shift, shift_start: member.shift_start || '', shift_end: member.shift_end || '',
    shift_rests: parseRests(member.shift_rests), voice_notes: parseRests(member.voice_notes),
    employment_type: member.employment_type || '', work_days: member.work_days || '',
    shift_start_date: member.shift_start_date || '', shift_end_date: member.shift_end_date || '',
  });
  if (member.shift2) out.push({
    shift: member.shift2, shift_start: member.shift2_start || '', shift_end: member.shift2_end || '',
    shift_rests: parseRests(member.shift2_rests), voice_notes: parseRests(member.shift2_voice_notes),
    employment_type: member.shift2_employment_type || '', work_days: member.shift2_work_days || '',
    shift_start_date: member.shift2_start_date || '', shift_end_date: member.shift2_end_date || '',
  });
  return out;
}

// Empty shift slot used when adding a new shift via the "+ إضافة شيفت" button.
const EMPTY_SHIFT = {
  shift: '', shift_start: '', shift_end: '', shift_rests: [], voice_notes: [],
  employment_type: '', work_days: '', shift_start_date: '', shift_end_date: '',
};

// ─── SHIFT SECTION (reusable for shift 1 and shift 2) ─────────────────────────
function ShiftSection({
  title, shiftValue, startValue, endValue, restsValue, voiceNotesValue, employmentValue, daysValue,
  startDateValue, endDateValue,
  onShiftChange, onStartChange, onEndChange, onRestsChange, onVoiceNotesChange, onEmploymentChange, onDaysChange,
  onStartDateChange, onEndDateChange,
  onRemove, inputCls, labelCls,
}) {
  const rests = Array.isArray(restsValue) ? restsValue : [];
  const updateRest = (index, key, value) => {
    const next = rests.map((r, i) => (i === index ? { ...r, [key]: value } : r));
    onRestsChange(next);
  };
  const addRest    = () => onRestsChange([...rests, { start: '', end: '' }]);
  const removeRest = (index) => onRestsChange(rests.filter((_, i) => i !== index));

  // Voice-note blocks: same shape as rests, but a separate list with distinct
  // visual treatment (purple) so the user can tell them apart at a glance.
  const voiceNotes = Array.isArray(voiceNotesValue) ? voiceNotesValue : [];
  const updateVN = (index, key, value) => {
    const next = voiceNotes.map((r, i) => (i === index ? { ...r, [key]: value } : r));
    onVoiceNotesChange(next);
  };
  const addVN    = () => onVoiceNotesChange([...voiceNotes, { start: '', end: '' }]);
  const removeVN = (index) => onVoiceNotesChange(voiceNotes.filter((_, i) => i !== index));

  // When the user actively changes the shift, apply sensible default times so
  // the AM/PM marker matches the shift kind:
  //   morning → 10:00 AM → 06:00 PM
  //   evening → 04:00 PM → 12:00 AM (midnight, treated as end-of-day)
  // The first render is skipped so that loading an existing employee never
  // overwrites their already-saved times.
  const isFirstShiftRender = useRef(true);
  useEffect(() => {
    if (isFirstShiftRender.current) {
      isFirstShiftRender.current = false;
      return;
    }
    if (!shiftValue) {
      if (startValue) onStartChange('');
      if (endValue)   onEndChange('');
      return;
    }
    if (shiftValue === 'morning') {
      onStartChange('10:00');  // 10 AM
      onEndChange('18:00');    // 6 PM
    } else if (shiftValue === 'evening') {
      onStartChange('16:00');  // 4 PM
      onEndChange('00:00');    // 12 AM (midnight, same shift day)
    }
  }, [shiftValue]);

  // Auto-fill all days for Full Time, clear for no employment type
  useEffect(() => {
    if (employmentValue === 'full_time') {
      onDaysChange(ALL_DAYS.join(','));
    } else if (!employmentValue) {
      onDaysChange('');
    }
  }, [employmentValue]);

  const selectedDays = (daysValue || '').split(',').filter(Boolean);
  const isPairSelected = (pair) => pair.days.every(d => selectedDays.includes(d));
  const togglePair = (pair) => {
    if (employmentValue !== 'part_time') return;
    const next = isPairSelected(pair)
      ? selectedDays.filter(d => !pair.days.includes(d))
      : [...new Set([...selectedDays, ...pair.days])];
    const ordered = ALL_DAYS.filter(d => next.includes(d));
    onDaysChange(ordered.join(','));
  };

  return (
    <div className="space-y-3 border border-gray-200 rounded-xl p-3 bg-gray-50/40">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-gray-700">{title}</div>
        {onRemove && (
          <button type="button" onClick={onRemove}
                  className="text-xs font-semibold text-red-500 hover:text-red-700 transition-all">
            × حذف الشيفت
          </button>
        )}
      </div>

      <div>
        <label className={labelCls}>الشيفت</label>
        <select className={inputCls} value={shiftValue} onChange={e => onShiftChange(e.target.value)}>
          <option value="">— اختر الشيفت —</option>
          {Object.entries(SHIFTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {shiftValue && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>الساعة من</label>
            <input type="time" className={inputCls} value={startValue || ''}
                   onChange={e => onStartChange(e.target.value)} dir="ltr" />
          </div>
          <div>
            <label className={labelCls}>الساعة إلى</label>
            <input type="time" className={inputCls} value={endValue || ''}
                   onChange={e => onEndChange(e.target.value)} dir="ltr" />
          </div>
        </div>
      )}

      {/* Shift dates — start_date required, end_date optional (empty = still active) */}
      {shiftValue && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>
              تاريخ البداية <span className="text-red-500">*</span>
            </label>
            <input type="date" className={inputCls} value={startDateValue || ''}
                   onChange={e => onStartDateChange(e.target.value)} dir="ltr" required />
          </div>
          <div>
            <label className={labelCls}>
              تاريخ النهاية
              <span className="text-[10px] text-gray-400 mr-2">(فاضي = لسه على رأس عمله)</span>
            </label>
            <input type="date" className={inputCls} value={endDateValue || ''}
                   onChange={e => onEndDateChange(e.target.value)} dir="ltr" />
          </div>
        </div>
      )}

      {/* Rest periods — multiple per shift */}
      {shiftValue && (
        <div>
          <label className={labelCls}>وقت الراحة</label>
          <div className="space-y-2">
            {rests.map((rest, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                <div>
                  <div className="text-[10px] text-gray-400 mb-0.5">من</div>
                  <input type="time" className={inputCls} value={rest.start || ''}
                         onChange={e => updateRest(i, 'start', e.target.value)} dir="ltr" />
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 mb-0.5">إلى</div>
                  <input type="time" className={inputCls} value={rest.end || ''}
                         onChange={e => updateRest(i, 'end', e.target.value)} dir="ltr" />
                </div>
                <button type="button" onClick={() => removeRest(i)}
                        title="حذف وقت الراحة"
                        className="h-[42px] w-[42px] flex items-center justify-center rounded-xl border border-red-200 text-red-500 hover:bg-red-50 transition-all">
                  <X size={14} />
                </button>
              </div>
            ))}
            <button type="button" onClick={addRest}
                    className="w-full py-2 rounded-xl border-2 border-dashed border-gray-300 text-xs font-semibold text-gray-500 hover:bg-gray-50 hover:border-gray-400 transition-all">
              + إضافة وقت راحة
            </button>
          </div>
        </div>
      )}

      {/* Voice Note blocks — dedicated WORK time inside the shift (not break) */}
      {shiftValue && (
        <div>
          <label className={labelCls}>
            وقت Voice Note
            <span className="text-[10px] text-gray-400 mr-2">(من ضمن وقت العمل — يحجب المحاضرات)</span>
          </label>
          <div className="space-y-2">
            {voiceNotes.map((vn, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                <div>
                  <div className="text-[10px] text-violet-500 mb-0.5">من</div>
                  <input type="time"
                         className={`${inputCls} bg-violet-50/50 border-violet-200 focus:border-violet-400 focus:ring-violet-500/30`}
                         value={vn.start || ''}
                         onChange={e => updateVN(i, 'start', e.target.value)} dir="ltr" />
                </div>
                <div>
                  <div className="text-[10px] text-violet-500 mb-0.5">إلى</div>
                  <input type="time"
                         className={`${inputCls} bg-violet-50/50 border-violet-200 focus:border-violet-400 focus:ring-violet-500/30`}
                         value={vn.end || ''}
                         onChange={e => updateVN(i, 'end', e.target.value)} dir="ltr" />
                </div>
                <button type="button" onClick={() => removeVN(i)}
                        title="حذف Voice Note"
                        className="h-[42px] w-[42px] flex items-center justify-center rounded-xl border border-violet-200 text-violet-500 hover:bg-violet-50 transition-all">
                  <X size={14} />
                </button>
              </div>
            ))}
            <button type="button" onClick={addVN}
                    className="w-full py-2 rounded-xl border-2 border-dashed border-violet-300 text-xs font-semibold text-violet-600 hover:bg-violet-50 hover:border-violet-400 transition-all">
              + إضافة Voice Note
            </button>
          </div>
        </div>
      )}

      <div>
        <label className={labelCls}>الدوام</label>
        <div className="flex gap-3">
          {Object.entries(EMPLOYMENT_TYPES).map(([k, v]) => (
            <button key={k} type="button"
              onClick={() => onEmploymentChange(employmentValue === k ? '' : k)}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${
                employmentValue === k
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
            >{v}</button>
          ))}
        </div>
      </div>

      {employmentValue && (
        <div>
          <label className={labelCls}>
            أيام العمل
            {employmentValue === 'full_time' && (
              <span className="text-[10px] text-gray-400 mr-2">(كل الأيام — Full Time)</span>
            )}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {DAY_PAIRS.map(pair => {
              const selected = isPairSelected(pair);
              const locked = employmentValue === 'full_time';
              return (
                <button key={pair.key} type="button"
                  onClick={() => togglePair(pair)}
                  disabled={locked}
                  className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-all ${
                    selected
                      ? 'bg-emerald-500 text-white border-emerald-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                  } ${locked ? 'opacity-80 cursor-not-allowed' : ''}`}
                >{pair.label}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── EXTRA SHIFTS SECTION ─────────────────────────────────────────────────────
// One-off after-shift-end hour blocks. Use case: trainer's shift_end_date was
// 21/5 but they're coming on 24/5 for 4h and 25/5 for 1h. Each row adds to
// the trainer's daily capacity in utilization reports — even if the day is
// outside their regular shift window.
//
// CRUD lives in dedicated endpoints, NOT in the main member-save payload, so
// edits here persist immediately (no need to press the main "Save" button).
function ExtraShiftsSection({ memberId, inputCls, labelCls }) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['team-extra-shifts', memberId],
    queryFn: () => api.get(`/team/${memberId}/extra-shifts`).then(r => r.data),
  });

  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [durationHours, setDurationHours] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);

  const addMut = useMutation({
    mutationFn: (body) => api.post(`/team/${memberId}/extra-shifts`, body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-extra-shifts', memberId] });
      setDate(''); setStartTime(''); setEndTime(''); setDurationHours(''); setNotes('');
      setError(null);
    },
    onError: (err) => setError(err.response?.data?.error || 'تعذّر الإضافة'),
  });

  const delMut = useMutation({
    mutationFn: (entryId) => api.delete(`/team/extra-shifts/${entryId}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-extra-shifts', memberId] }),
  });

  // Format minutes → "4 س" / "1 س 30 د" / "45 د"
  const fmtMins = (n) => {
    n = Math.max(0, Math.round(Number(n) || 0));
    if (n === 0) return '0';
    if (n < 60) return `${n} د`;
    const h = Math.floor(n / 60);
    const rem = n % 60;
    return rem > 0 ? `${h} س ${rem} د` : `${h} س`;
  };

  function submit() {
    setError(null);
    if (!date) { setError('من فضلك اختر التاريخ'); return; }
    const body = { date, notes };
    if (startTime && endTime) {
      body.start_time = startTime;
      body.end_time   = endTime;
    } else if (durationHours) {
      const mins = Math.round(Number(durationHours) * 60);
      if (!Number.isFinite(mins) || mins <= 0) { setError('عدد ساعات غير صالح'); return; }
      body.duration_min = mins;
    } else {
      setError('حدد وقت بداية ونهاية، أو عدد ساعات');
      return;
    }
    addMut.mutate(body);
  }

  return (
    <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Clock size={16} className="text-amber-600" />
        <h4 className="text-sm font-bold text-amber-900">ساعات إضافية (one-off)</h4>
        <span className="mr-auto text-[10px] text-amber-700">تظهر في حساب نسبة التشغيل لليوم المحدد</span>
      </div>
      <p className="text-[11px] text-amber-700/80 mb-3 leading-relaxed">
        💡 لو الموظف خلص شيفته (تاريخ نهاية الشيفت)، لكن بيدخل أيام محددة لساعات إضافية —
        ضيف كل يوم هنا. الساعات بتتحسب في utilization من غير ما تفتح شيفت جديد.
      </p>

      {/* Existing entries */}
      {isLoading ? (
        <p className="text-xs text-gray-500 text-center py-2">جاري التحميل...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-2 italic">لا توجد ساعات إضافية مسجلة</p>
      ) : (
        <ul className="space-y-1.5 mb-3">
          {rows.map(r => (
            <li key={r.id} className="bg-white border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2 text-xs">
              <CalendarIcon size={12} className="text-amber-600 flex-shrink-0" />
              <span className="font-bold text-gray-800">{r.date}</span>
              {r.start_time && r.end_time ? (
                <span className="text-gray-600">{r.start_time} → {r.end_time}</span>
              ) : null}
              <span className="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded">
                {fmtMins(r.duration_min)}
              </span>
              {r.notes && <span className="text-gray-500 truncate flex-1">— {r.notes}</span>}
              <button type="button"
                onClick={() => { if (confirm('حذف الإدخال؟')) delMut.mutate(r.id); }}
                className="mr-auto p-1 hover:bg-red-50 rounded text-red-500"
                title="حذف">
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add form */}
      <div className="border-t border-amber-200 pt-3 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={labelCls}>التاريخ <span className="text-red-500">*</span></label>
            <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>من (اختياري)</label>
            <input type="time" className={inputCls} value={startTime} onChange={e => setStartTime(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>إلى (اختياري)</label>
            <input type="time" className={inputCls} value={endTime} onChange={e => setEndTime(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={labelCls}>أو عدد ساعات</label>
            <input type="number" step="0.25" min="0" placeholder="مثلاً 4"
              className={inputCls} value={durationHours}
              onChange={e => setDurationHours(e.target.value)}
              disabled={!!(startTime && endTime)} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>ملاحظة (اختياري)</label>
            <input className={inputCls} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="مثلاً: عوض درس / تعديل" />
          </div>
        </div>
        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>}
        <button type="button"
          onClick={submit}
          disabled={addMut.isPending || !date}
          className="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2">
          <Plus size={14} />
          {addMut.isPending ? 'جاري الإضافة...' : 'إضافة ساعات إضافية'}
        </button>
      </div>
    </div>
  );
}

// ─── TEACHABLE COURSES SECTION ────────────────────────────────────────────────
// Three rows of pill buttons — Starter / General / Conversation. Each pill is
// a highest level. Lower levels visually "lit" to show they're covered.
// Cascade rule: picking any General level forces Starter to its max (= 3).
function TeachableCoursesSection({ form, setForm, labelCls }) {
  const setLevel = (courseKey, value) => {
    setForm(f => {
      const next = { ...f, [COURSE_FIELD(courseKey)]: value };
      // Cascade: any General level >= 1 implies the trainer can teach all Starter
      if (courseKey === 'general' && value > 0) {
        next.teachable_starter = 3;
      }
      return next;
    });
  };

  const Pill = ({ active, covered, onClick, children, tone = 'level' }) => {
    let cls = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all';
    if (active) {
      cls += tone === 'all'      ? ' bg-emerald-600 text-white border-emerald-600 shadow-sm'
          :  tone === 'none'     ? ' bg-gray-700 text-white border-gray-700'
          :  ' bg-blue-600 text-white border-blue-600 shadow-sm';
    } else if (covered) {
      cls += ' bg-blue-50 text-blue-600 border-blue-100';
    } else {
      cls += ' bg-white text-gray-500 border-gray-200 hover:bg-gray-50';
    }
    return (
      <button type="button" onClick={onClick} className={cls}>
        {children}
      </button>
    );
  };

  return (
    <div className="space-y-3 border border-gray-200 rounded-xl p-3 bg-gray-50/40">
      <div className="text-xs font-bold text-gray-700">الدورات القابلة للتدريس</div>
      <p className="text-[11px] text-gray-500 -mt-1">اختار أعلى مستوى يقدر المدرب يدرسه. كل المستويات الأقل تُعتبر مغطاة تلقائياً.</p>

      {COURSES.map(course => {
        const value = Number(form[COURSE_FIELD(course.key)] ?? course.max);
        return (
          <div key={course.key}>
            <label className={labelCls}>{course.label}</label>
            <div className="flex flex-wrap gap-2">
              <Pill tone="none" active={value === 0} onClick={() => setLevel(course.key, 0)}>
                غير قادر
              </Pill>
              {Array.from({ length: course.max }, (_, i) => i + 1).map(level => (
                <Pill
                  key={level}
                  active={value === level}
                  covered={value > level}
                  onClick={() => setLevel(course.key, level)}
                >
                  {course.label} {level}
                </Pill>
              ))}
              <Pill
                tone="all"
                active={value === course.max}
                onClick={() => setLevel(course.key, course.max)}
              >
                كل المستويات
              </Pill>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── MEMBER MODAL ─────────────────────────────────────────────────────────────
function MemberModal({ initial, onSave, onClose, loading }) {
  const [form, setForm] = useState(() => hydrateMember(initial));
  // Unlimited shifts — array of {shift, shift_start, shift_end, ...} objects.
  const [shifts, setShifts] = useState(() => initialShifts(initial));
  const set = (k, v) => setForm(f => {
    // Education trainers are line-agnostic — auto-force line='All' whenever
    // the department is set to 'education'. Other departments keep manual
    // line selection.
    if (k === 'department' && v === 'education') {
      return { ...f, department: v, line: 'All' };
    }
    return { ...f, [k]: v };
  });

  // Per-shift handlers
  const updateShift = (idx, key, value) => {
    setShifts(s => s.map((sh, i) => (i === idx ? { ...sh, [key]: value } : sh)));
  };
  const addShift = () => {
    setShifts(s => [...s, { ...EMPTY_SHIFT }]);
  };
  const removeShift = (idx) => {
    setShifts(s => s.filter((_, i) => i !== idx));
  };

  // Reset section when dept changes if invalid; clear shifts if leaving education
  useEffect(() => {
    if (!DEPT_SECTIONS[form.department]?.includes(form.section)) {
      set('section', DEPT_SECTIONS[form.department][0]);
    }
    if (form.department !== 'education') {
      setShifts([]);
    }
  }, [form.department]);

  // Convert rests arrays back to JSON strings before sending to backend.
  // Sends the new `shifts:[]` array — the backend stores it as JSON and
  // also mirrors the first two entries to the legacy shift_*/shift2_* cols.
  const handleSave = () => {
    for (let i = 0; i < shifts.length; i++) {
      const sh = shifts[i];
      if (sh.shift && !sh.shift_start_date) {
        alert(`من فضلك أدخل تاريخ بداية الشيفت رقم ${i + 1}`);
        return;
      }
      if (sh.shift_start_date && sh.shift_end_date && sh.shift_end_date < sh.shift_start_date) {
        alert(`تاريخ نهاية الشيفت رقم ${i + 1} يجب أن يكون بعد تاريخ البداية`);
        return;
      }
    }
    const shiftsPayload = shifts
      .filter(sh => sh.shift)
      .map(sh => ({
        shift:           sh.shift,
        start:           sh.shift_start,
        end:             sh.shift_end,
        rests:           JSON.stringify(sh.shift_rests || []),
        voice_notes:     JSON.stringify(sh.voice_notes || []),
        employment_type: sh.employment_type,
        work_days:       sh.work_days,
        start_date:      sh.shift_start_date,
        end_date:        sh.shift_end_date,
      }));
    onSave({ ...form, shifts: shiftsPayload });
  };

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 bg-white';
  const labelCls = 'block text-xs font-semibold text-gray-600 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[calc(100vh-2rem)] my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-base font-bold text-gray-900">{initial ? 'تعديل موظف' : 'إضافة موظف جديد'}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-all"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Name */}
          <div>
            <label className={labelCls}>الاسم <span className="text-red-500">*</span></label>
            <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="اسم الموظف" />
          </div>

          {/* Department */}
          <div>
            <label className={labelCls}>الإدارة <span className="text-red-500">*</span></label>
            <select className={inputCls} value={form.department} onChange={e => set('department', e.target.value)}>
              {Object.entries(DEPTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          {/* Section */}
          <div>
            <label className={labelCls}>القسم <span className="text-red-500">*</span></label>
            <select className={inputCls} value={form.section} onChange={e => set('section', e.target.value)}>
              {DEPT_SECTIONS[form.department].map(s => <option key={s} value={s}>{SECTIONS[s]}</option>)}
            </select>
          </div>

          {/* Line — splits the org chart (e.g. Private → "خاص" vs "خاص دردشة").
              Education trainers are line-agnostic so the field is locked to 'All'. */}
          <div>
            <label className={labelCls}>الـ Line</label>
            <select
              className={inputCls}
              value={form.line || (form.department === 'education' ? 'All' : 'Ahmed Hassan')}
              onChange={e => set('line', e.target.value)}
              disabled={form.department === 'education'}
              title={form.department === 'education' ? 'مدربو الإدارة التعليمية لكل الـ Lines' : ''}
            >
              {Object.entries(LINES).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            {form.department === 'education' && (
              <p className="mt-1 text-xs text-slate-500">مدربو الإدارة التعليمية متاحون لكل الـ Lines تلقائياً.</p>
            )}
          </div>

          {/* Shifts — unlimited dynamic list, education only */}
          {form.department === 'education' && shifts.map((sh, idx) => {
            const ord = ['الأول','الثاني','الثالث','الرابع','الخامس','السادس','السابع','الثامن','التاسع','العاشر'];
            const title = `الشيفت ${ord[idx] || `رقم ${idx + 1}`}`;
            return (
              <ShiftSection
                key={idx}
                title={title}
                shiftValue={sh.shift}
                startValue={sh.shift_start}
                endValue={sh.shift_end}
                restsValue={sh.shift_rests}
                voiceNotesValue={sh.voice_notes}
                employmentValue={sh.employment_type}
                daysValue={sh.work_days}
                startDateValue={sh.shift_start_date}
                endDateValue={sh.shift_end_date}
                onShiftChange={(v) => updateShift(idx, 'shift', v)}
                onStartChange={(v) => updateShift(idx, 'shift_start', v)}
                onEndChange={(v) => updateShift(idx, 'shift_end', v)}
                onRestsChange={(v) => updateShift(idx, 'shift_rests', v)}
                onVoiceNotesChange={(v) => updateShift(idx, 'voice_notes', v)}
                onEmploymentChange={(v) => updateShift(idx, 'employment_type', v)}
                onDaysChange={(v) => updateShift(idx, 'work_days', v)}
                onStartDateChange={(v) => updateShift(idx, 'shift_start_date', v)}
                onEndDateChange={(v) => updateShift(idx, 'shift_end_date', v)}
                onRemove={() => removeShift(idx)}
                inputCls={inputCls} labelCls={labelCls}
              />
            );
          })}

          {/* Add another shift — visible whenever the dept is education */}
          {form.department === 'education' && (
            <button type="button"
              onClick={addShift}
              className="w-full py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-sm font-semibold text-gray-500 hover:bg-gray-50 hover:border-gray-400 transition-all"
            >
              {shifts.length === 0 ? '+ إضافة الشيفت الأول' : '+ إضافة شيفت آخر'}
            </button>
          )}

          {/* Extra one-off hours — only on EDIT and only for education
              (the API needs the member's id to attach entries). Used for
              trainers who already ended their main shift but come back for
              a few hours on specific days. */}
          {form.department === 'education' && initial?.id && (
            <ExtraShiftsSection memberId={initial.id} inputCls={inputCls} labelCls={labelCls} />
          )}

          {/* Teachable courses — education only */}
          {form.department === 'education' && (
            <TeachableCoursesSection form={form} setForm={setForm} labelCls={labelCls} />
          )}

          {/* Job title + Phone */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>المسمى الوظيفي</label>
              <select className={inputCls} value={form.job_title} onChange={e => set('job_title', e.target.value)}>
                <option value="">— اختر المسمى —</option>
                <option value="منسق">منسق</option>
                <option value="مدرب">مدرب</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>رقم التليفون</label>
              <input className={inputCls} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="01xxxxxxxxx" dir="ltr" />
            </div>
          </div>

          {/* Status */}
          <div>
            <label className={labelCls}>الحالة</label>
            <div className="flex gap-3">
              {[['active','نشط'],['inactive','غير نشط']].map(([k, v]) => (
                <button key={k} type="button"
                  onClick={() => set('status', k)}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${
                    form.status === k
                      ? k === 'active' ? 'bg-green-500 text-white border-green-500' : 'bg-red-400 text-white border-red-400'
                      : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                  }`}
                >{v}</button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className={labelCls}>ملاحظات</label>
            <textarea className={`${inputCls} resize-none`} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="ملاحظات اختيارية..." />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-all">إلغاء</button>
          <button
            onClick={handleSave}
            disabled={!form.name.trim() || loading}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-all disabled:opacity-50"
          >{loading ? 'جاري الحفظ...' : 'حفظ'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── DELETE CONFIRM ───────────────────────────────────────────────────────────
function DeleteConfirm({ name, onConfirm, onCancel, loading }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
          <Trash2 className="w-5 h-5 text-red-600" />
        </div>
        <div>
          <p className="font-bold text-gray-900 text-base">حذف الموظف</p>
          <p className="text-sm text-gray-500 mt-1">هل تريد حذف <span className="font-semibold text-gray-800">{name}</span>؟ لا يمكن التراجع.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">إلغاء</button>
          <button onClick={onConfirm} disabled={loading} className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold disabled:opacity-50">
            {loading ? 'جاري الحذف...' : 'حذف'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SECTION GROUP ────────────────────────────────────────────────────────────
function SectionGroup({ section, members, dept, onEdit, onDelete }) {
  const [open, setOpen] = useState(true);
  const colors = DEPT_COLORS[dept];

  const grouped = {};
  if (dept === 'education') {
    members.forEach(m => {
      const key = m.shift ? m.shift.toLowerCase() : 'none';
      (grouped[key] = grouped[key] || []).push(m);
    });
  }

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden">
      {/* Section header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-gray-50 hover:bg-gray-100 transition-all"
      >
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border ${SECTION_COLORS[section]}`}>
            {SECTIONS[section]}
          </span>
          <span className="text-xs text-gray-500 font-medium">{members.length} موظف</span>
        </div>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="divide-y divide-gray-50">
          {dept === 'education' ? (
            // Education: group by shift
            Object.entries(SHIFTS).map(([shiftKey, shiftLabel]) => {
              const rows = (grouped[shiftKey] || []);
              if (rows.length === 0) return null;
              return (
                <div key={shiftKey}>
                  <div className="flex items-center gap-2 px-5 py-2 bg-gray-50/50">
                    {shiftKey === 'morning'
                      ? <Sun size={13} className="text-amber-500" />
                      : <Moon size={13} className="text-indigo-500" />}
                    <span className="text-xs font-bold text-gray-600">{shiftLabel}</span>
                    <span className="text-xs text-gray-400">({rows.length})</span>
                  </div>
                  {rows.map(m => <MemberRow key={m.id} member={m} onEdit={onEdit} onDelete={onDelete} showShift={false} />)}
                </div>
              );
            }).concat(
              grouped['none']?.length
                ? [(
                  <div key="none">
                    <div className="flex items-center gap-2 px-5 py-2 bg-gray-50/50">
                      <span className="text-xs font-bold text-gray-400">بدون شيفت</span>
                    </div>
                    {grouped['none'].map(m => <MemberRow key={m.id} member={m} onEdit={onEdit} onDelete={onDelete} />)}
                  </div>
                )] : []
            )
          ) : (
            members.map(m => <MemberRow key={m.id} member={m} onEdit={onEdit} onDelete={onDelete} />)
          )}
        </div>
      )}
    </div>
  );
}

// ─── computeOverallEmployment ─────────────────────────────────────────────────
// A trainer with multiple shifts whose days+times line up is effectively
// Full Time (split across shifts). "Full Time موزّع" requires BOTH:
//   1. Combined work_days = the full work week (6 days), AND
//   2. All contributing shifts use the SAME (start, end) times.
// If days are 6/6 but times differ between shifts, that's still Part Time
// (varying schedule) — surfaced via days_covered + uniform_times.
function computeOverallEmployment(member) {
  let shifts = member?.shifts;
  if (!Array.isArray(shifts) || shifts.length === 0) {
    shifts = [];
    if (member?.shift)  shifts.push({
      work_days: member.work_days, start: member.shift_start, end: member.shift_end,
    });
    if (member?.shift2) shifts.push({
      work_days: member.shift2_work_days, start: member.shift2_start, end: member.shift2_end,
    });
  }
  const daysUnion = new Set();
  const timeKeys  = new Set();
  let contributing = 0;
  for (const sh of shifts) {
    if (!sh) continue;
    const list = String(sh.work_days || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
    if (list.length === 0) continue;
    contributing += 1;
    list.forEach(d => daysUnion.add(d));
    const start = sh.start || '';
    const end   = sh.end   || '';
    if (start && end) timeKeys.add(`${start}|${end}`);
  }
  if (daysUnion.size === 0) return null;
  const allDays      = ALL_DAYS.every(d => daysUnion.has(d));
  const uniformTimes = timeKeys.size <= 1;
  return {
    type:           (allDays && uniformTimes) ? 'full_time' : 'part_time',
    split:          contributing > 1,
    uniform_times:  uniformTimes,
    days_covered:   daysUnion.size,
  };
}

// ─── MEMBER ROW ───────────────────────────────────────────────────────────────
function MemberRow({ member: m, onEdit, onDelete }) {
  const isActive = m.status === 'active';
  const overall  = computeOverallEmployment(m);
  return (
    <div className={`flex items-center gap-4 px-5 py-3 hover:bg-gray-50/60 transition-colors ${!isActive ? 'opacity-60' : ''}`}>
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold ${isActive ? 'bg-gradient-to-br from-blue-400 to-blue-600' : 'bg-gradient-to-br from-gray-300 to-gray-400'}`}>
        {m.name.charAt(0)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-900 text-sm">{m.name}</span>
          {/* Status badge — always visible */}
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-bold border ${
            isActive
              ? 'bg-green-50 text-green-700 border-green-200'
              : 'bg-red-50 text-red-600 border-red-200'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-500' : 'bg-red-400'}`} />
            {isActive ? 'نشط' : 'غير نشط'}
          </span>
          {/* Overall employment — shows "Full Time موزّع" when this trainer
              works the full week split across multiple Part-Time shifts. */}
          {overall && overall.type === 'full_time' && overall.split && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-bold border bg-violet-50 text-violet-700 border-violet-200"
              title="مجموع أيام الشيفتات يغطّي أسبوع العمل بالكامل">
              Full Time <span className="text-[10px] font-normal opacity-80">موزّع</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          {m.job_title && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Briefcase size={11} />{m.job_title}
            </span>
          )}
          {m.phone && (
            <span className="flex items-center gap-1 text-xs text-gray-500 font-mono" dir="ltr">
              <Phone size={11} />{m.phone}
            </span>
          )}
          {m.notes && <span className="text-xs text-gray-400 truncate max-w-[200px]">{m.notes}</span>}
        </div>
      </div>

      {/* Actions — always visible */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => onEdit(m)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-semibold transition-all border border-blue-100"
        >
          <Pencil size={12} /> تعديل
        </button>
        <button
          onClick={() => onDelete(m)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold transition-all border border-red-100"
        >
          <Trash2 size={12} /> حذف
        </button>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function TeamPage() {
  const qc = useQueryClient();
  const [activeDept, setActiveDept] = useState('customer_services');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editMember,   setEditMember]   = useState(null);   // member obj or true (new)
  const [deleteMember, setDeleteMember] = useState(null);   // member obj

  const { data: all = [], isLoading } = useQuery({
    queryKey: ['team-members'],
    queryFn: () => api.get('/team', { params: { status: 'all' } }).then(r => r.data),
    staleTime: 2 * 60 * 1000,
  });

  // Deep-link: visiting `/admin/team?edit=<member_id>` auto-opens the edit
  // modal for that trainer (used by the trainer-work-history report so the
  // user can jump straight from a row to editing the trainer). Switches the
  // active dept tab to match the trainer, then clears the URL param so a
  // refresh doesn't keep re-triggering the modal.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || !all.length || editMember) return;
    const m = all.find(x => String(x.id) === String(editId));
    if (m) {
      setActiveDept(m.department);
      setEditMember(m);
      const next = new URLSearchParams(searchParams);
      next.delete('edit');
      setSearchParams(next, { replace: true });
    }
  }, [all, searchParams, editMember, setSearchParams]);

  const saveMutation = useMutation({
    mutationFn: (form) =>
      form.id
        ? api.put(`/team/${form.id}`, form).then(r => r.data)
        : api.post('/team', form).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries(['team-members']); setEditMember(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/team/${id}`),
    onSuccess: () => { qc.invalidateQueries(['team-members']); setDeleteMember(null); },
  });

  // Filter
  const visible = all.filter(m => {
    if (m.department !== activeDept) return false;
    if (!showInactive && m.status === 'inactive') return false;
    if (search.trim() && !m.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  // Stats per dept
  const deptCount = (dept) => all.filter(m => m.department === dept && m.status === 'active').length;

  // Group by section
  const bySection = {};
  DEPT_SECTIONS[activeDept].forEach(s => { bySection[s] = []; });
  visible.forEach(m => { (bySection[m.section] = bySection[m.section] || []).push(m); });

  const totalVisible = visible.length;

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="فريق العمل"
        subtitle="دليل موظفي الأكاديمية"
        icon={Users}
        gradient="navy"
        actions={
          <ModernButton variant="amber" icon={Plus} onClick={() => setEditMember(true)}>
            إضافة موظف
          </ModernButton>
        }
      />

      {/* ── Dept Tabs ── */}
      <div className="flex gap-3">
        {Object.entries(DEPTS).map(([key, label]) => {
          const c = DEPT_COLORS[key];
          const active = activeDept === key;
          return (
            <button key={key} onClick={() => setActiveDept(key)}
              className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl text-sm font-bold transition-all border ${
                active
                  ? `${c.bg} text-white border-transparent shadow-md`
                  : `bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50`
              }`}
            >
              <Users size={16} />
              {label}
              <span className={`text-xs px-2 py-0.5 rounded-full font-black ${active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>
                {deptCount(key)}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Search + filters ── */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="بحث باسم الموظف..."
            className="w-full bg-white border border-gray-200 rounded-xl pr-9 pl-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
        </div>
        <button
          onClick={() => setShowInactive(v => !v)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
            showInactive ? 'bg-gray-700 text-white border-gray-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {showInactive ? <XCircle size={15} /> : <CheckCircle size={15} />}
          {showInactive ? 'إخفاء غير النشطين' : 'عرض غير النشطين'}
        </button>
        <span className="text-xs text-gray-400 font-medium">{totalVisible} موظف</span>
      </div>

      {/* ── Sections ── */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {DEPT_SECTIONS[activeDept].map(section => (
            <SectionGroup
              key={section}
              section={section}
              members={bySection[section] || []}
              dept={activeDept}
              onEdit={setEditMember}
              onDelete={setDeleteMember}
            />
          ))}
          {totalVisible === 0 && (
            <div className="bg-white rounded-3xl border border-gray-100">
              <EmptyState
                icon={UserX}
                accent="gray"
                title="لا يوجد موظفين"
                message="اضغط 'إضافة موظف' لإضافة أول موظف للقسم"
              />
            </div>
          )}
        </div>
      )}

      {/* ── Modals ── */}
      {editMember !== null && (
        <MemberModal
          initial={editMember === true ? null : editMember}
          onSave={(form) => saveMutation.mutate(editMember === true ? form : { ...form, id: editMember.id })}
          onClose={() => setEditMember(null)}
          loading={saveMutation.isPending}
        />
      )}
      {deleteMember && (
        <DeleteConfirm
          name={deleteMember.name}
          onConfirm={() => deleteMutation.mutate(deleteMember.id)}
          onCancel={() => setDeleteMember(null)}
          loading={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
