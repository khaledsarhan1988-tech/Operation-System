import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Plus, Save, X, Pencil, Trash2, Users } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../auth/AuthContext';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';

// Roles allowed to flip Generate → Start: مسؤول / مدير / enrollment_leader.
const CAN_GENERATE_ROLES = ['admin', 'leader', 'enrollment_leader'];
const GEN_CLS = {
  Start:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  Pending: 'bg-amber-100 text-amber-700 border-amber-200',
};

/**
 * Enrollment — manual data-entry grid, one tab per department.
 * URL: /subscriptions/enrollment
 *
 * Phase 1: full CRUD grid with dropdowns (Days/Level/Status static, Admin from
 * department users, Teacher from education trainers). Teacher availability
 * filtering + previous-group suggestion come in later phases.
 */

const ALL_DEPTS = ['General', 'Semi', 'Private'];
const DEPT_META = {
  General: { label: 'جينرال',      color: 'cyan'    },
  Semi:    { label: 'سيمي برايفت', color: 'emerald' },
  Private: { label: 'برايفت',      color: 'violet'  },
};

const EMPTY = {
  round_name: '', start_date: '', end_date: '', days: '', hours: '',
  num_students: '', group_code: '', level: '', status: '', admin: '', teacher: '',
};

const COLS = [
  { k: 'round_name',   label: 'اسم الراوند',  type: 'text' },
  { k: 'start_date',   label: 'بداية',         type: 'date' },
  { k: 'end_date',     label: 'نهاية',         type: 'date' },
  { k: 'days',         label: 'الأيام',        type: 'select', opt: 'days' },
  { k: 'hours',        label: 'الموعد',        type: 'text' },
  { k: 'num_students', label: 'عدد الطلاب',    type: 'number' },
  { k: 'group_code',   label: 'كود المجموعة',  type: 'text' },
  { k: 'level',        label: 'المستوى',       type: 'select', opt: 'levels' },
  { k: 'status',       label: 'الحالة',        type: 'select', opt: 'statuses' },
  { k: 'admin',        label: 'المنسق',        type: 'select', opt: 'coordinators' },
  { k: 'teacher',      label: 'المدرب',        type: 'select', opt: 'teachers' },
];

// Map the enrollment fields → the find-available-trainer params (Phase 2).
const DAYS_TO_KEYS = { 'Sat- Tue': 'saturday,tuesday', 'Mon- Thu': 'monday,thursday', 'Sun- Wed': 'sunday,wednesday' };
function to24(t) {
  const m = String(t).trim().match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return null;
  let h = +m[1]; const mn = +m[2]; const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
}
function parseHours(hours) {
  const parts = String(hours || '').split(/[_–-]/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const from = to24(parts[0]), to = to24(parts[parts.length - 1]);
  return (from && to) ? { from, to } : null;
}
function parseLevelFam(level) {
  const s = String(level || '').toLowerCase();
  const num = parseInt((s.match(/(\d+)/) || [])[1], 10) || null;
  let fam = null;
  if (/con/.test(s)) fam = 'conversation';
  else if (/str/.test(s)) fam = 'starter';
  else if (/g/.test(s)) fam = 'general';
  return (fam && num) ? { family: fam, level: num } : null;
}

// Side drawer to pick the clients (students) assigned to one enrollment row.
function StudentDrawer({ row, onClose, onSaved }) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState(null);   // key → { client_id, name, phone }

  // Stable, unique key per client (id first, then phone, then name) so two
  // different clients never collide — that's what made it act single-select.
  const keyOf = (c) => {
    const id = c?.id ?? c?.client_id;
    if (id != null && id !== '') return 'id:' + id;
    const ph = c?.phone ?? c?.client_phone;
    if (ph) return 'ph:' + ph;
    return 'nm:' + (c?.name ?? c?.client_name ?? '');
  };

  const assignedQ = useQuery({
    queryKey: ['enr-students', row.id],
    queryFn: () => api.get(`/cs/enrollment/${row.id}/students`).then(r => r.data),
  });
  const clientsQ = useQuery({
    queryKey: ['enr-clients', search],
    queryFn: () => api.get('/cs/enrollment/clients-search', { params: { q: search } }).then(r => r.data),
  });

  useEffect(() => {
    if (assignedQ.data && sel === null) {
      const m = {};
      (assignedQ.data.students || []).forEach(s => {
        m[keyOf(s)] = { client_id: s.client_id, name: s.client_name, phone: s.client_phone };
      });
      setSel(m);
    }
  }, [assignedQ.data, sel]);

  const saveMut = useMutation({
    mutationFn: () => api.put(`/cs/enrollment/${row.id}/students`, { students: Object.values(sel || {}) }),
    onSuccess: () => { onSaved && onSaved(); onClose(); },
    onError: (e) => alert('فشل الحفظ: ' + (e.response?.data?.error || e.message)),
  });

  const selMap = sel || {};
  const toggle = (c) => setSel(prev => {
    const m = { ...(prev || {}) };
    const k = keyOf(c);
    if (m[k]) delete m[k]; else m[k] = { client_id: c.id ?? null, name: c.name, phone: c.phone };
    return m;
  });
  const clients = clientsQ.data?.clients || [];
  const count = Object.keys(selMap).length;

  return (
    <div className="fixed inset-0 z-50 flex" dir="rtl">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[400px] max-w-full bg-white h-full shadow-2xl flex flex-col">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div className="font-semibold text-slate-800">طلاب المجموعة</div>
            <div className="text-xs text-slate-400 font-mono break-all">{row.group_code || '—'}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }} className="p-3 border-b border-slate-100 flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الموبايل..."
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" />
          <button className="px-3 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700">بحث</button>
        </form>

        <div className="px-3 py-2 text-xs text-slate-500 bg-slate-50 border-b border-slate-100">مختار: {count} طالب</div>

        <div className="flex-1 overflow-y-auto">
          {clientsQ.isLoading ? (
            <div className="p-4 text-center text-slate-400 text-sm">جاري التحميل...</div>
          ) : clients.length === 0 ? (
            <div className="p-4 text-center text-slate-400 text-sm">لا نتائج</div>
          ) : clients.map(c => {
            const checked = !!selMap[keyOf(c)];
            return (
              <label key={keyOf(c)} className="flex items-center gap-2 px-3 py-2 border-b border-slate-50 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={checked} onChange={() => toggle(c)} className="w-4 h-4 accent-violet-600" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-800 truncate">{c.name}</div>
                  <div className="text-xs text-slate-400 font-mono" dir="ltr">{c.phone || '—'}</div>
                </div>
              </label>
            );
          })}
        </div>

        <div className="p-3 border-t border-slate-100 flex gap-2">
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || sel === null}
            className="flex-1 px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            حفظ ({count})
          </button>
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

export default function Enrollment() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canGenerate = CAN_GENERATE_ROLES.includes(user?.role);
  const [activeDept, setActiveDept] = useState('General');
  const [editing, setEditing] = useState(null);   // row id | 'new' | null
  const [form, setForm] = useState(EMPTY);
  const [studentRow, setStudentRow] = useState(null);   // row whose roster drawer is open
  const meta = DEPT_META[activeDept] || { label: activeDept, color: 'violet' };

  const optionsQ = useQuery({
    queryKey: ['enroll-options', activeDept],
    queryFn: () => api.get('/cs/enrollment/options', { params: { dept: activeDept } }).then(r => r.data),
  });
  const rowsQ = useQuery({
    queryKey: ['enroll-rows', activeDept],
    queryFn: () => api.get('/cs/enrollment', { params: { dept: activeDept } }).then(r => r.data),
  });
  const opts = optionsQ.data || {};
  const rows = rowsQ.data?.rows || [];

  // Previous-group teacher suggestion (by the entered level).
  const suggestQ = useQuery({
    queryKey: ['teacher-suggestion', form.level],
    enabled: !!(editing && form.level),
    queryFn: () => api.get('/cs/enrollment/teacher-suggestion', { params: { level: form.level } }).then(r => r.data),
  });
  // Available 1.5h time slots for the chosen teacher on the selected days
  // (shift − rests − voice-notes). Drives the الموعد dropdown.
  const slotsQ = useQuery({
    queryKey: ['teacher-slots', form.teacher, form.days, activeDept],
    enabled: !!(editing && form.teacher && form.days),
    queryFn: () => api.get('/cs/enrollment/teacher-slots', {
      params: { teacher: form.teacher, days: form.days, dept: activeDept },
    }).then(r => r.data),
  });

  // Teacher options = level-capable trainers + always the current value.
  const teacherOptions = () => {
    let base = (opts.teachers || []).map(o => ({ value: o, label: o }));
    if (form.teacher && !base.some(o => o.value === form.teacher)) base = [{ value: form.teacher, label: form.teacher }, ...base];
    return base;
  };

  const saveMut = useMutation({
    mutationFn: (payload) => payload.id
      ? api.put(`/cs/enrollment/${payload.id}`, payload)
      : api.post('/cs/enrollment', { ...payload, dept: activeDept }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['enroll-rows', activeDept] }); setEditing(null); setForm(EMPTY); },
    onError: (e) => alert('فشل الحفظ: ' + (e.response?.data?.error || e.message)),
  });
  const delMut = useMutation({
    mutationFn: (id) => api.delete(`/cs/enrollment/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['enroll-rows', activeDept] }),
    onError: (e) => alert('فشل الحذف: ' + (e.response?.data?.error || e.message)),
  });
  const generateMut = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/cs/enrollment/${id}/generate`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['enroll-rows', activeDept] }),
    onError: (e) => alert('فشل التحويل: ' + (e.response?.data?.error || e.message)),
  });

  // Generate cell — badge for everyone; a Start/Pending toggle for privileged
  // roles when the group has >= 7 students.
  const genBadge = (status, title) => (
    <span title={title || ''} className={`inline-block text-xs rounded-full border px-2 py-0.5 ${GEN_CLS[status] || GEN_CLS.Pending}`}>
      {status || 'Pending'}
    </span>
  );
  const genCell = (row) => {
    const status = row.generate_status || 'Pending';
    const eligible = (Number(row.num_students) || 0) >= 7;
    if (canGenerate && eligible && row.id) {
      return (
        <select
          value={status}
          disabled={generateMut.isPending}
          onChange={(e) => generateMut.mutate({ id: row.id, status: e.target.value })}
          className={`text-xs rounded-full border px-2 py-1 focus:outline-none ${GEN_CLS[status] || ''}`}
        >
          <option value="Pending">Pending</option>
          <option value="Start">Start</option>
        </select>
      );
    }
    return genBadge(status, !eligible ? 'محتاج 7 طلاب أو أكثر' : '');
  };

  const startEdit = (row) => { setEditing(row.id); setForm({ ...EMPTY, ...row }); };
  const startNew  = () => { setEditing('new'); setForm(EMPTY); };
  const cancel    = () => { setEditing(null); setForm(EMPTY); };
  const save      = () => saveMut.mutate(editing === 'new' ? { ...form } : { ...form, id: editing });
  const switchTab = (d) => { setActiveDept(d); cancel(); };
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Editable cells for the current `form` (rendered inline → keeps focus).
  const editCells = () => COLS.map(c => {
    // Teacher cell — level-capable trainers + previous-group suggestion chips.
    if (c.k === 'teacher') {
      const tOpts = teacherOptions();
      const sugg = suggestQ.data?.suggestions || [];
      return (
        <td key={c.k} className="px-2 py-1 min-w-44 align-top">
          <select
            value={form.teacher ?? ''}
            onChange={(e) => setF('teacher', e.target.value)}
            className="w-full px-1 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-300"
          >
            <option value="">—</option>
            {tOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {sugg.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1 items-center">
              <span className="text-[10px] text-slate-400">اقتراح:</span>
              {sugg.map((s, i) => (
                <button key={i} type="button" onClick={() => setF('teacher', s.teacher)}
                  title={`من المجموعة السابقة: ${s.from_group}`}
                  className="text-[10px] bg-cyan-50 text-cyan-700 border border-cyan-200 rounded px-1.5 py-0.5 hover:bg-cyan-100">
                  {s.teacher}
                </button>
              ))}
            </div>
          )}
        </td>
      );
    }
    // Hours cell — a dropdown of the teacher's available 1.5h slots once a
    // teacher + days are chosen; plain text input otherwise.
    if (c.k === 'hours') {
      const slots = slotsQ.data?.slots || [];
      const ready = !!(form.teacher && form.days);
      if (ready && slots.length > 0) {
        const list = (form.hours && !slots.includes(form.hours)) ? [form.hours, ...slots] : slots;
        return (
          <td key={c.k} className="px-2 py-1 min-w-36 align-top">
            <select value={form.hours ?? ''} onChange={(e) => setF('hours', e.target.value)}
              className="w-full px-1 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-300">
              <option value="">—</option>
              {list.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </td>
        );
      }
      return (
        <td key={c.k} className="px-2 py-1 align-top">
          <input value={form.hours ?? ''} onChange={(e) => setF('hours', e.target.value)}
            className="w-full min-w-24 px-1.5 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-300" />
          {ready && slotsQ.isFetching && <div className="text-[10px] text-slate-400 mt-0.5">جاري حساب المواعيد...</div>}
          {ready && slotsQ.data && slots.length === 0 && <div className="text-[10px] text-rose-500 mt-0.5">مفيش مواعيد متاحة للمدرب في الأيام دي</div>}
        </td>
      );
    }
    return (
      <td key={c.k} className="px-2 py-1">
        {c.type === 'select' ? (
          <select
            value={form[c.k] ?? ''}
            onChange={(e) => setF(c.k, e.target.value)}
            className="w-full min-w-24 px-1 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-300"
          >
            <option value="">—</option>
            {(opts[c.opt] || []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input
            value={form[c.k] ?? ''}
            onChange={(e) => setF(c.k, e.target.value)}
            type={c.type}
            className="w-full min-w-24 px-1.5 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-300"
          />
        )}
      </td>
    );
  });

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto" dir="rtl">
      <PageHero
        title="Enrollment"
        subtitle="إدخال راوندات المجموعات يدوياً لكل قسم"
        icon={GraduationCap}
        color={meta.color}
      />

      {/* Department tabs */}
      <div className="mt-4 flex flex-wrap gap-1 border-b border-slate-200">
        {ALL_DEPTS.map(d => (
          <button
            key={d}
            onClick={() => switchTab(d)}
            className={`px-5 py-2.5 text-sm font-medium rounded-t-lg -mb-px border-b-2 transition-colors ${
              activeDept === d
                ? 'border-violet-600 text-violet-700 bg-violet-50'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {DEPT_META[d]?.label || d}
          </button>
        ))}
      </div>

      <SectionCard title={`راوندات ${meta.label}`} icon={GraduationCap} className="mt-4">
        <div className="p-3 flex items-center gap-2 border-b border-slate-100">
          <button
            onClick={startNew}
            disabled={editing !== null}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> إضافة صف
          </button>
          <span className="text-xs text-slate-500 mr-auto">
            {rowsQ.isLoading ? 'جاري التحميل...' : `${rows.length} صف`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="text-slate-500 bg-slate-50 border-b border-slate-200">
                {COLS.map(c => <th key={c.k} className="px-2 py-2.5 font-medium whitespace-nowrap">{c.label}</th>)}
                <th className="px-2 py-2.5 font-medium">Generate</th>
                <th className="px-2 py-2.5 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                editing === row.id ? (
                  <tr key={row.id} className="bg-violet-50/40 border-b border-slate-100">
                    {editCells()}
                    <td className="px-2 py-1 whitespace-nowrap">{genBadge(form.generate_status || 'Pending')}</td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      <button onClick={save} disabled={saveMut.isPending} className="text-emerald-600 hover:text-emerald-800 p-1" title="حفظ"><Save className="w-4 h-4" /></button>
                      <button onClick={cancel} className="text-slate-400 hover:text-slate-600 p-1" title="إلغاء"><X className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ) : (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    {COLS.map(c => (
                      <td key={c.k} className="px-2 py-2 whitespace-nowrap text-slate-700">
                        {c.k === 'num_students' ? (
                          <button
                            onClick={() => setStudentRow(row)}
                            title="إدارة طلاب المجموعة"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold"
                          >
                            <Users className="w-3 h-3" /> {row.num_students ?? 0}
                          </button>
                        ) : (
                          row[c.k] != null && row[c.k] !== '' ? String(row[c.k]) : <span className="text-slate-300">—</span>
                        )}
                      </td>
                    ))}
                    <td className="px-2 py-2 whitespace-nowrap">{genCell(row)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <button onClick={() => startEdit(row)} disabled={editing !== null} className="text-violet-600 hover:text-violet-800 p-1 disabled:opacity-40" title="تعديل"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => { if (confirm('حذف الصف؟')) delMut.mutate(row.id); }} disabled={editing !== null} className="text-rose-500 hover:text-rose-700 p-1 disabled:opacity-40" title="حذف"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                )
              ))}

              {editing === 'new' && (
                <tr className="bg-violet-50/40 border-b border-slate-100">
                  {editCells()}
                  <td className="px-2 py-1 whitespace-nowrap">{genBadge('Pending')}</td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <button onClick={save} disabled={saveMut.isPending} className="text-emerald-600 hover:text-emerald-800 p-1" title="حفظ"><Save className="w-4 h-4" /></button>
                    <button onClick={cancel} className="text-slate-400 hover:text-slate-600 p-1" title="إلغاء"><X className="w-4 h-4" /></button>
                  </td>
                </tr>
              )}

              {!rowsQ.isLoading && rows.length === 0 && editing !== 'new' && (
                <tr><td colSpan={COLS.length + 2} className="px-3 py-10 text-center text-slate-400">لا توجد صفوف بعد — اضغط «إضافة صف»</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {studentRow && (
        <StudentDrawer
          row={studentRow}
          onClose={() => setStudentRow(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['enroll-rows', activeDept] })}
        />
      )}
    </div>
  );
}
