import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Eye, EyeOff, Pencil, Trash2, ToggleLeft, ToggleRight, UserCog, Paperclip } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Modal from '../../components/ui/Modal';
import Badge from '../../components/ui/Badge';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import ModernButton from '../../components/ui/ModernButton';
import UserAvatar from '../../components/ui/UserAvatar';
import AvatarUploadDialog from '../../components/ui/AvatarUploadDialog';
import { useAuth } from '../../auth/AuthContext';

const EMPTY_FORM = {
  username: '', password: '', full_name: '',
  role: 'agent', department: 'All', extra_departments: [],
  management: 'Customer Services', extra_managements: [],
  extra_pages: [],
  line: 'Ahmed Hassan', language: 'ar', is_active: 1,
  start_date: '', end_date: '',
};

// Per-PAGE grants: give a user ONE specific report page without changing their
// role/management. The `value` must match the router's requirePage key + the
// Sidebar grant key.
// Pages an admin can grant to ANY user (any role) without changing their role.
// `value` is the page key stored in users.extra_pages; it must match the
// requirePage gate / grantedLinks mapping in router.jsx + Sidebar.jsx.
const GRANTABLE_PAGES = [
  // الإشغال والمدربين — umbrella (grants all trainer pages) + each page on its own.
  { value: 'occupancy-trainers',     label: 'الإشغال والمدربين — كل الصفحات' },
  { value: 'trainer-utilization',    label: 'الإشغال والمدربين — إشغال المدربين' },
  { value: 'trainer-dashboard',      label: 'الإشغال والمدربين — لوحة المدربين' },
  { value: 'find-available-trainer', label: 'الإشغال والمدربين — ابحث عن مدرب' },
  { value: 'trainer-work-history',   label: 'الإشغال والمدربين — سجل عمل المدربين' },
  { value: 'phone-call-gap',         label: 'الإشغال والمدربين — فجوة الفون كول' },
  { value: 'trainer-details',        label: 'الإشغال والمدربين — تفاصيل المدربين' },
  { value: 'trainer-recruitment',    label: 'الإشغال والمدربين — توظيف المدربين' },
  { value: 'trainer-org-chart',      label: 'الإشغال والمدربين — الهيكل التنظيمي للمحاضرين' },
  { value: 'cs-deliveries',          label: 'تسليمات الأقسام — Customer Services Department' },
  { value: 'cs-enrollment',          label: 'تسليمات الأقسام — Enrollment' },
  { value: 'enr-groups',             label: 'تسليمات الأقسام — Enr Groups' },
  { value: 'sales-register',         label: 'كشف العملاء' },
];

// Sections a LEADER can manage. Matches users.department values used by the
// org chart. ('All' / 'Appointments' aren't in this list because they're not
// real sections in the customer-services org-chart pipeline.)
const EXTRA_DEPT_OPTIONS = [
  { value: 'General', label: 'عام' },
  { value: 'Private', label: 'خاص' },
  { value: 'Semi',    label: 'شبه خاص' },
];

// Managements a MANAGER (admin) can be given additional access to.
// The primary `management` field still picks ONE; these checkboxes add
// further ones. 'All' isn't listed — it implicitly covers everything.
const MANAGEMENT_OPTIONS = [
  { value: 'Customer Services', label: 'خدمة العملاء' },
  { value: 'Education',         label: 'التعليم' },
  { value: 'Quality',           label: 'الجودة' },
  { value: 'Enrollment',        label: 'Enrollment' },
  { value: 'Finance',           label: 'الإدارة المالية' },
];

function UserModal({ open, onClose, user, onSaved }) {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  // Only Admin/Manager (role='admin') may edit the employment dates. Leaders
  // who reach /leader/users see them read-only.
  const canEditDates = currentUser?.role === 'admin';
  const [form, setForm] = useState(user ? {
    username: user.username, password: '',
    full_name: user.full_name, role: user.role,
    department: user.department,
    extra_departments: (user.extra_departments || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    management: user.management || 'Customer Services',
    extra_managements: (user.extra_managements || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    extra_pages: (user.extra_pages || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    line: user.line || 'Ahmed Hassan', language: user.language,
    is_active: user.is_active,
    start_date: (user.start_date || '').slice(0, 10),
    end_date: (user.end_date || '').slice(0, 10),
  } : { ...EMPTY_FORM });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pagesOpen, setPagesOpen] = useState(false);   // صفحات إضافية dropdown

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      if (user) {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        await api.put(`/admin/users/${user.id}`, payload);
      } else {
        await api.post('/admin/users', form);
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={user ? t('admin.editUser') : t('admin.addUser')}>
      <div className="space-y-4">
        {error && <p className="text-sm text-danger bg-danger/10 p-3 rounded-lg">{error}</p>}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('admin.username')}</label>
            <input className="input" value={form.username} onChange={e => set('username', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('admin.fullName')}</label>
            <input className="input" value={form.full_name} onChange={e => set('full_name', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">{t('admin.password')} {user && '(اتركها فارغة للإبقاء على نفس الباسورد)'}</label>
          <div className="relative">
            <input type={showPw ? 'text' : 'password'} className="input pe-10" value={form.password}
              onChange={e => set('password', e.target.value)} autoComplete="new-password" />
            <button type="button" onClick={() => setShowPw(v => !v)}
              className="absolute end-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-500">
              {showPw ? <EyeOff size={15}/> : <Eye size={15}/>}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('admin.role')}</label>
            <select className="input" value={form.role} onChange={e => {
              const r = e.target.value;
              set('role', r);
              if (r === 'admin') { set('department', 'All'); set('management', 'All'); }
            }}>
              <option value="agent">{t('admin.agent')}</option>
              <option value="leader">{t('admin.leader')}</option>
              <option value="admin">{t('admin.admin')}</option>
              <option value="enrollment">Enrollment</option>
              <option value="enrollment_leader">Enrollment Leader</option>
            </select>
          </div>
          <div>
            <label className="label">{t('admin.department')}</label>
            <select className="input" value={form.department} onChange={e => set('department', e.target.value)}>
              <option value="All">جميع الأقسام</option>
              <option value="General">{t('common.general')}</option>
              <option value="Private">{t('common.private')}</option>
              <option value="Semi">{t('common.semi')}</option>
            </select>
            {form.role === 'leader' && form.department === 'All' && (
              <p className="text-xs text-amber-600 mt-1 font-medium">⚠ قائد الفريق يحتاج قسم محدد (General / Private / Semi)</p>
            )}
          </div>
          {/* Extra sections — only meaningful for leaders. Lets ONE leader
              oversee multiple org-chart columns (e.g. General + Private). */}
          {form.role === 'leader' && (
            <div className="col-span-2">
              <label className="label">أقسام إضافية تحت إشرافي (اختياري)</label>
              <div className="flex flex-wrap gap-2 p-2 rounded-lg border border-border bg-surface">
                {EXTRA_DEPT_OPTIONS
                  .filter(o => o.value !== form.department)  /* hide the primary */
                  .map(o => {
                    const selected = form.extra_departments.includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => {
                          const next = selected
                            ? form.extra_departments.filter(v => v !== o.value)
                            : [...form.extra_departments, o.value];
                          set('extra_departments', next);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition
                          ${selected
                            ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-200'}`}
                      >
                        {selected ? '✓ ' : ''}{o.label}
                      </button>
                    );
                  })}
              </div>
              {form.extra_departments.length > 0 && (
                <p className="text-xs text-indigo-600 mt-1.5 font-medium">
                  💡 المستخدم هيظهر كقائد لـ <b>{form.department}</b> + <b>{form.extra_departments.join(', ')}</b> في الهيكل التنظيمي
                </p>
              )}
            </div>
          )}
          <div>
            <label className="label">الإدارة</label>
            <select className="input" value={form.management} onChange={e => set('management', e.target.value)}>
              <option value="All">جميع الإدارات</option>
              <option value="Customer Services">خدمة العملاء</option>
              <option value="Education">التعليم</option>
              <option value="Quality">الجودة</option>
              <option value="Enrollment">Enrollment</option>
              <option value="Finance">الإدارة المالية</option>
            </select>
          </div>
          {/* Additional managements — only meaningful when the primary
              management is NOT 'All' (which already covers everything). */}
          {form.management !== 'All' && (
            <div>
              <label className="label">إدارات إضافية (اختياري)</label>
              <div className="flex flex-wrap gap-2">
                {MANAGEMENT_OPTIONS
                  .filter(o => o.value !== form.management)
                  .map(o => {
                    const selected = form.extra_managements.includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => {
                          const next = selected
                            ? form.extra_managements.filter(v => v !== o.value)
                            : [...form.extra_managements, o.value];
                          set('extra_managements', next);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                          selected
                            ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {selected ? '✓ ' : ''}{o.label}
                      </button>
                    );
                  })}
              </div>
              {form.extra_managements.length > 0 && (
                <p className="text-xs text-violet-600 mt-1.5 font-medium">
                  💡 المستخدم هيشوف صفحات إدارة <b>{form.management}</b> + <b>{form.extra_managements.join(', ')}</b>
                </p>
              )}
            </div>
          )}
          {/* Per-page grants — give a user specific pages without changing their
              role (e.g. a CS/enrollment user who needs trainer-occupancy or
              deliveries). Rendered as a multi-select dropdown ("صفحات إضافية"). */}
          <div>
            <label className="label">صفحات إضافية (اختياري) — بدون تغيير الدور</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setPagesOpen(o => !o)}
                className="input flex items-center justify-between w-full text-right"
              >
                <span className={form.extra_pages.length ? 'text-gray-800 font-semibold' : 'text-gray-400'}>
                  {form.extra_pages.length
                    ? `${form.extra_pages.length} صفحة مُختارة`
                    : 'اختر صفحات…'}
                </span>
                <span className={`transition-transform text-gray-400 ${pagesOpen ? 'rotate-180' : ''}`}>▾</span>
              </button>
              {pagesOpen && (
                <>
                  {/* invisible backdrop closes the dropdown on outside click */}
                  <div className="fixed inset-0 z-10" onClick={() => setPagesOpen(false)} />
                  <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto py-1">
                    {GRANTABLE_PAGES.map(o => {
                      const selected = form.extra_pages.includes(o.value);
                      return (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => set('extra_pages', selected
                            ? form.extra_pages.filter(v => v !== o.value)
                            : [...form.extra_pages, o.value])}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-right hover:bg-gray-50 ${selected ? 'bg-teal-50' : ''}`}
                        >
                          <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-[10px] ${
                            selected ? 'bg-teal-600 border-teal-600 text-white' : 'border-gray-300 text-transparent'
                          }`}>✓</span>
                          <span className="font-medium text-gray-700">{o.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            {form.extra_pages.length > 0 && (
              <p className="text-xs text-teal-600 mt-1.5 font-medium">
                💡 المستخدم هيشوف <b>{form.extra_pages.map(v => (GRANTABLE_PAGES.find(g => g.value === v) || {}).label || v).join('، ')}</b> — من غير ما يتغيّر دوره
              </p>
            )}
          </div>
          <div>
            <label className="label">Line</label>
            <select className="input" value={form.line} onChange={e => set('line', e.target.value)}>
              <option value="All">All</option>
              <option value="Ahmed Hassan">Ahmed Hassan</option>
              <option value="Dardasha">Dardasha</option>
            </select>
          </div>
          <div>
            <label className="label">{t('admin.language')}</label>
            <select className="input" value={form.language} onChange={e => set('language', e.target.value)}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </div>
          {/* Employment dates — start = hire date, end = termination date.
              An empty end date means the user is still on the job. When the
              end date passes the account is auto-deactivated (cannot log in). */}
          <div>
            <label className="label">تاريخ التعيين</label>
            <input type="date" className="input disabled:bg-gray-100 disabled:text-gray-400" value={form.start_date}
              onChange={e => set('start_date', e.target.value)} disabled={!canEditDates} />
            <p className="text-xs text-gray-500 mt-1">
              {canEditDates ? 'إذا تُرك فارغاً يُسجَّل تاريخ إنشاء الحساب تلقائياً.' : 'يُعدَّل بواسطة Admin / Manager فقط.'}
            </p>
          </div>
          <div>
            <label className="label">تاريخ ترك العمل</label>
            <input type="date" className="input disabled:bg-gray-100 disabled:text-gray-400" value={form.end_date}
              onChange={e => set('end_date', e.target.value)} disabled={!canEditDates} />
            <p className="text-xs text-gray-500 mt-1">
              {canEditDates
                ? 'اتركه فارغاً إذا كان الموظف ما زال على رأس عمله. بعد هذا التاريخ يتوقف الحساب تلقائياً.'
                : 'يُعدَّل بواسطة Admin / Manager فقط.'}
            </p>
          </div>
        </div>
        {user && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-surface border border-border">
            <label className="label mb-0 flex-1">الحالة</label>
            <button
              type="button"
              onClick={() => {
                const next = form.is_active ? 0 : 1;
                // Mirror the server's end_date rule in the form: deactivating
                // stamps today (if empty), reactivating clears it.
                if (next === 0) {
                  setForm(f => ({
                    ...f,
                    is_active: 0,
                    end_date: f.end_date || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10),
                  }));
                } else {
                  setForm(f => ({ ...f, is_active: 1, end_date: '' }));
                }
              }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                form.is_active
                  ? 'bg-success/15 text-success hover:bg-success/25'
                  : 'bg-danger/15 text-danger hover:bg-danger/25'
              }`}
            >
              {form.is_active
                ? <><ToggleRight size={16}/> نشط — اضغط لإيقاف التفعيل</>
                : <><ToggleLeft size={16}/> غير نشط — اضغط للتفعيل</>
              }
            </button>
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
            {saving ? t('common.loading') : t('tasks.save')}
          </button>
          <button onClick={onClose} className="btn-outline">{t('tasks.cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

export default function UserManagement() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user: currentUser, patchUser } = useAuth();
  const [selected, setSelected] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [avatarTarget, setAvatarTarget] = useState(null);
  const isAdmin = currentUser?.role === 'admin';

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get('/admin/users').then(r => r.data),
  });

  // ── Filters (client-side) ──────────────────────────────────────────────
  const [fName, setFName]           = useState('');
  const [fStatus, setFStatus]       = useState('all');   // all | active | inactive
  const [fHireFrom, setFHireFrom]   = useState('');
  const [fHireTo, setFHireTo]       = useState('');
  const [fLeaveFrom, setFLeaveFrom] = useState('');
  const [fLeaveTo, setFLeaveTo]     = useState('');
  const resetFilters = () => {
    setFName(''); setFStatus('all');
    setFHireFrom(''); setFHireTo(''); setFLeaveFrom(''); setFLeaveTo('');
  };

  const filteredUsers = useMemo(() => {
    let list = users || [];
    const q = fName.trim().toLowerCase();
    if (q) list = list.filter(u =>
      (u.full_name || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q));
    if (fStatus === 'active')   list = list.filter(u => u.is_active);
    if (fStatus === 'inactive') list = list.filter(u => !u.is_active);
    const inRange = (val, from, to) => {
      if (!val) return false;                 // no date → excluded once a range is set
      const d = String(val).slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    };
    if (fHireFrom || fHireTo)   list = list.filter(u => inRange(u.start_date, fHireFrom, fHireTo));
    if (fLeaveFrom || fLeaveTo) list = list.filter(u => inRange(u.end_date, fLeaveFrom, fLeaveTo));
    return list;
  }, [users, fName, fStatus, fHireFrom, fHireTo, fLeaveFrom, fLeaveTo]);

  const handleDelete = async (row) => {
    if (!window.confirm(`هل أنت متأكد من حذف المستخدم "${row.full_name}" نهائياً؟`)) return;
    setDeletingId(row.id);
    try {
      await api.delete(`/admin/users/${row.id}`);
      qc.invalidateQueries(['admin-users']);
    } catch (e) {
      alert(e.response?.data?.error || 'حدث خطأ');
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleStatus = async (row) => {
    setTogglingId(row.id);
    try {
      await api.patch(`/admin/users/${row.id}/status`);
      qc.invalidateQueries(['admin-users']);
    } catch (e) {
      alert(e.response?.data?.error || 'حدث خطأ');
    } finally {
      setTogglingId(null);
    }
  };

  const columns = [
    {
      key: 'avatar_url',
      label: 'الصورة',
      render: (_, row) => (
        <UserAvatar name={row.full_name} avatarUrl={row.avatar_url} size="sm" />
      ),
    },
    { key: 'username', label: t('admin.username') },
    { key: 'full_name', label: t('admin.fullName') },
    { key: 'role', label: t('admin.role'), render: (v, row) => {
      // admin بـ management != 'All' = "مدير" (department-scoped)
      // admin بـ management = 'All' = "مسؤول" (Super Admin)
      const isManager = v === 'admin' && row.management && row.management !== 'All';
      const label = isManager ? 'مدير' : t(`roles.${v}`, v);
      const cls = isManager ? 'bg-amber-100 text-amber-700' : 'bg-primary/10 text-primary';
      return <span className={`badge ${cls}`}>{label}</span>;
    } },
    { key: 'department', label: t('admin.department') },
    { key: 'management', label: 'الإدارة', render: v => {
      const map = { 'Customer Services': 'خدمة العملاء', 'Education': 'التعليم', 'Quality': 'الجودة', 'Enrollment': 'Enrollment', 'Finance': 'الإدارة المالية' };
      return <span className="badge bg-accent/10 text-accent">{map[v] || v}</span>;
    }},
    { key: 'line', label: 'Line', render: v => <span className="badge bg-primary/10 text-primary">{v || 'Ahmed Hassan'}</span> },
    { key: 'language', label: t('admin.language'), render: v => v === 'ar' ? 'العربية' : 'English' },
    {
      key: 'is_active', label: 'الحالة', render: (v, row) => (
        <button
          onClick={e => { e.stopPropagation(); handleToggleStatus(row); }}
          disabled={togglingId === row.id}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            v ? 'bg-success/15 text-success hover:bg-success/25' : 'bg-danger/15 text-danger hover:bg-danger/25'
          }`}
        >
          {togglingId === row.id ? '...' : v ? 'نشط' : 'غير نشط'}
        </button>
      )
    },
    { key: 'start_date', label: 'تاريخ التعيين', render: v => v ? v.slice(0,10) : '—' },
    { key: 'end_date', label: 'تاريخ ترك العمل', render: v => v
        ? <span className="badge bg-danger/10 text-danger">{v.slice(0,10)}</span>
        : <span className="text-gray-400">على رأس العمل</span>
    },
    { key: 'created_at', label: 'تاريخ الإنشاء', render: v => v?.slice(0,10) },
    {
      key: 'id', label: '', render: (_, row) => (
        <div className="flex items-center gap-1">
          {isAdmin && (
            <button
              onClick={e => { e.stopPropagation(); setAvatarTarget(row); }}
              className="p-1.5 rounded-lg hover:bg-accent/10 text-accent transition-colors"
              title="رفع/تعديل الصورة الشخصية (Attachment)"
            >
              <Paperclip size={15} />
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); setSelected(row); setShowModal(true); }}
            className="p-1.5 rounded-lg hover:bg-primary/10 text-primary transition-colors"
            title="تعديل"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); handleDelete(row); }}
            disabled={deletingId === row.id}
            className="p-1.5 rounded-lg hover:bg-danger/10 text-danger transition-colors"
            title="حذف"
          >
            <Trash2 size={15} />
          </button>
        </div>
      )
    },
  ];

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title={t('admin.users')}
        subtitle="إدارة كاملة لحسابات المستخدمين والصلاحيات"
        icon={UserCog}
        gradient="navy"
        actions={
          <ModernButton variant="amber" icon={Plus} onClick={() => { setSelected(null); setShowModal(true); }}>
            {t('admin.addUser')}
          </ModernButton>
        }
      />

      {/* ── Filters ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="text-xs text-slate-500 mb-1">بحث بالاسم</label>
          <input
            value={fName}
            onChange={e => setFName(e.target.value)}
            placeholder="اسم المستخدم أو الاسم الكامل..."
            className="w-56 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-slate-500 mb-1">الحالة</label>
          <select
            value={fStatus}
            onChange={e => setFStatus(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="all">الكل</option>
            <option value="active">نشط</option>
            <option value="inactive">غير نشط</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-slate-500 mb-1">تاريخ التعيين (من)</label>
          <input type="date" value={fHireFrom} onChange={e => setFHireFrom(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-slate-500 mb-1">تاريخ التعيين (إلى)</label>
          <input type="date" value={fHireTo} onChange={e => setFHireTo(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-slate-500 mb-1">تاريخ ترك العمل (من)</label>
          <input type="date" value={fLeaveFrom} onChange={e => setFLeaveFrom(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-slate-500 mb-1">تاريخ ترك العمل (إلى)</label>
          <input type="date" value={fLeaveTo} onChange={e => setFLeaveTo(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <button onClick={resetFilters}
          className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
          إعادة تعيين
        </button>
        <span className="text-xs text-slate-500 mr-auto self-center">
          {filteredUsers.length} من {users?.length || 0} مستخدم
        </span>
      </div>

      <SectionCard title="قائمة المستخدمين" subtitle={`${filteredUsers.length} مستخدم`} icon={UserCog} accent="indigo" noBodyPad>
        <DataTable
          columns={columns}
          data={filteredUsers}
          total={filteredUsers.length}
          page={1}
          limit={1000}
          onPageChange={() => {}}
          loading={isLoading}
        />
      </SectionCard>

      <UserModal
        key={selected?.id ?? 'new'}
        open={showModal}
        user={selected}
        onClose={() => setShowModal(false)}
        onSaved={() => qc.invalidateQueries(['admin-users'])}
      />

      {avatarTarget && (
        <AvatarUploadDialog
          open={!!avatarTarget}
          onClose={() => setAvatarTarget(null)}
          name={avatarTarget.full_name}
          avatarUrl={avatarTarget.avatar_url}
          endpoint={{
            upload: `/admin/users/${avatarTarget.id}/avatar`,
            remove: `/admin/users/${avatarTarget.id}/avatar`,
          }}
          onSaved={(newUrl) => {
            qc.invalidateQueries(['admin-users']);
            // If admin edited their own avatar, update auth context too
            if (avatarTarget.id === currentUser?.id) patchUser({ avatar_url: newUrl });
          }}
        />
      )}

    </div>
  );
}
