import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Plus, Save, X, Pencil, Trash2 } from 'lucide-react';
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

export default function Enrollment() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canGenerate = CAN_GENERATE_ROLES.includes(user?.role);
  const [activeDept, setActiveDept] = useState('General');
  const [editing, setEditing] = useState(null);   // row id | 'new' | null
  const [form, setForm] = useState(EMPTY);
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
  const editCells = () => COLS.map(c => (
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
  ));

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
                        {row[c.k] != null && row[c.k] !== '' ? String(row[c.k]) : <span className="text-slate-300">—</span>}
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
    </div>
  );
}
