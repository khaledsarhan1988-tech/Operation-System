'use client';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, Plus, Pencil, Trash2, X, Search, Sun, Moon,
  Phone, Briefcase, CheckCircle, XCircle, ChevronDown,
} from 'lucide-react';
import api from '../../api/axios';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DEPTS = {
  customer_services: 'إدارة خدمة العملاء',
  education:         'الإدارة التعليمية',
};

const SECTIONS = {
  general:    'عام',
  private:    'خاص',
  semi:       'شبه خاص',
  phone_call: 'فون كول',
};

const SHIFTS = {
  morning: 'صباحي',
  evening: 'مسائي',
};

const DEPT_SECTIONS = {
  customer_services: ['general', 'private', 'semi'],
  education:         ['general', 'private', 'semi', 'phone_call'],
};

const DEPT_COLORS = {
  customer_services: { bg: 'bg-blue-600',   light: 'bg-blue-50',   border: 'border-blue-200',  text: 'text-blue-700',  dot: 'bg-blue-500' },
  education:         { bg: 'bg-emerald-600', light: 'bg-emerald-50',border: 'border-emerald-200',text: 'text-emerald-700',dot: 'bg-emerald-500' },
};

const SECTION_COLORS = {
  general:    'bg-sky-100 text-sky-800 border-sky-200',
  private:    'bg-violet-100 text-violet-800 border-violet-200',
  semi:       'bg-amber-100 text-amber-800 border-amber-200',
  phone_call: 'bg-pink-100 text-pink-800 border-pink-200',
};

// ─── EMPTY FORM ───────────────────────────────────────────────────────────────
const emptyForm = { name: '', department: 'customer_services', section: 'general', shift: '', job_title: '', phone: '', status: 'active', notes: '' };

// ─── MEMBER MODAL ─────────────────────────────────────────────────────────────
function MemberModal({ initial, onSave, onClose, loading }) {
  const [form, setForm] = useState(initial ?? emptyForm);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Reset section when dept changes if invalid
  useEffect(() => {
    if (!DEPT_SECTIONS[form.department]?.includes(form.section)) {
      set('section', DEPT_SECTIONS[form.department][0]);
    }
    if (form.department !== 'education') set('shift', '');
  }, [form.department]);

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 bg-white';
  const labelCls = 'block text-xs font-semibold text-gray-600 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">{initial ? 'تعديل موظف' : 'إضافة موظف جديد'}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-all"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
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

          {/* Shift — education only */}
          {form.department === 'education' && (
            <div>
              <label className={labelCls}>الشيفت</label>
              <select className={inputCls} value={form.shift} onChange={e => set('shift', e.target.value)}>
                <option value="">— اختر الشيفت —</option>
                {Object.entries(SHIFTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
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
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-all">إلغاء</button>
          <button
            onClick={() => onSave(form)}
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
      const key = m.shift || 'none';
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

// ─── MEMBER ROW ───────────────────────────────────────────────────────────────
function MemberRow({ member: m, onEdit, onDelete }) {
  const isActive = m.status === 'active';
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
    <div className="space-y-5 animate-fadeIn" dir="rtl">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">فريق العمل</h1>
          <p className="text-sm text-gray-400 mt-1">دليل موظفي الأكاديمية</p>
        </div>
        <button
          onClick={() => setEditMember(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-all shadow-sm"
        >
          <Plus size={16} /> إضافة موظف
        </button>
      </div>

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
            <div className="text-center py-16 text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-3 text-gray-200" />
              <p className="text-sm font-medium">لا يوجد موظفين</p>
              <p className="text-xs mt-1">اضغط "إضافة موظف" لإضافة أول موظف</p>
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
