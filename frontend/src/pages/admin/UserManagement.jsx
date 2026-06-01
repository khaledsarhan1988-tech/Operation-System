import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Eye, EyeOff, Pencil, Trash2, ToggleLeft, ToggleRight, UserCog, Paperclip, History } from 'lucide-react';
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
  line: 'Ahmed Hassan', language: 'ar', is_active: 1,
  start_date: '', end_date: '',
};

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
    line: user.line || 'Ahmed Hassan', language: user.language,
    is_active: user.is_active,
    start_date: (user.start_date || '').slice(0, 10),
    end_date: (user.end_date || '').slice(0, 10),
  } : { ...EMPTY_FORM });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
  const [historyUser, setHistoryUser] = useState(null);
  const isAdmin = currentUser?.role === 'admin';

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get('/admin/users').then(r => r.data),
  });

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
      const map = { 'Customer Services': 'خدمة العملاء', 'Education': 'التعليم', 'Quality': 'الجودة' };
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
          {isAdmin && (
            <button
              onClick={e => { e.stopPropagation(); setHistoryUser(row); }}
              className="p-1.5 rounded-lg hover:bg-violet-100 text-violet-600 transition-colors"
              title="سجل تنقلات الأقسام"
            >
              <History size={15} />
            </button>
          )}
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

      <SectionCard title="قائمة المستخدمين" subtitle={`${users?.length || 0} مستخدم`} icon={UserCog} accent="indigo" noBodyPad>
        <DataTable
          columns={columns}
          data={users}
          total={users?.length || 0}
          page={1}
          limit={100}
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

      {/* ── Dept history modal ── */}
      {historyUser && (
        <DeptHistoryModal
          user={historyUser}
          onClose={() => setHistoryUser(null)}
        />
      )}
    </div>
  );
}

// ─── DEPT HISTORY MODAL ──────────────────────────────────────────────────────
// Detects overlaps, gaps, and multiple "current" records in a list of history
// rows. Returns an array of issue objects, empty when everything is consistent.
function validateDeptHistory(rows) {
  const issues = [];
  if (!rows || rows.length === 0) return issues;
  const norm = rows
    .map(r => ({
      ...r,
      from: (r.effective_from || '').slice(0, 10),
      to:   (r.effective_to || '').slice(0, 10) || null,
    }))
    .filter(r => r.from)
    .sort((a, b) => a.from.localeCompare(b.from));

  // Multiple open (effective_to IS NULL)
  const openCount = norm.filter(r => !r.to).length;
  if (openCount > 1) {
    issues.push({
      type: 'multiple_open',
      severity: 'error',
      message: `${openCount} سجلات "حالية" — لازم سجل واحد بس بدون "إلى تاريخ"`,
    });
  }
  // Open records that aren't the latest
  for (let i = 0; i < norm.length - 1; i++) {
    if (!norm[i].to) {
      issues.push({
        type: 'open_not_last',
        severity: 'error',
        message: `سجل ${norm[i].department} (${norm[i].from}) بدون "إلى" لكن في سجلات بعده`,
      });
    }
  }
  // Overlap and gap detection
  for (let i = 0; i < norm.length - 1; i++) {
    const a = norm[i];
    const b = norm[i + 1];
    if (!a.to) continue;
    if (a.to > b.from) {
      issues.push({
        type: 'overlap',
        severity: 'error',
        message: `تداخل بين ${a.department} (${a.from} → ${a.to}) و ${b.department} (${b.from} → ${b.to || 'لسه'})`,
      });
    } else if (a.to < b.from) {
      issues.push({
        type: 'gap',
        severity: 'warning',
        message: `فجوة بين ${a.to} و ${b.from} — مفيش سجل في الفترة دي`,
      });
    }
  }
  // Records where to <= from
  for (const r of norm) {
    if (r.to && r.to <= r.from) {
      issues.push({
        type: 'invalid_dates',
        severity: 'error',
        message: `سجل ${r.department}: تاريخ النهاية (${r.to}) قبل أو يساوي البداية (${r.from})`,
      });
    }
  }
  return issues;
}

function DeptHistoryModal({ user, onClose }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null); // null | 'new' | rowId
  const [form, setForm] = useState({ department: '', effective_from: '', effective_to: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['dept-history', user.id],
    queryFn: () => api.get(`/admin/users/${user.id}/dept-history`).then(r => r.data),
  });
  const rows = data?.history || [];
  const issues = validateDeptHistory(rows);
  const hasErrors = issues.some(i => i.severity === 'error');

  const saveMutation = useMutation({
    mutationFn: (payload) => {
      if (editing === 'new') {
        return api.post(`/admin/users/${user.id}/dept-history`, payload).then(r => r.data);
      }
      return api.put(`/admin/dept-history/${editing}`, payload).then(r => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries(['dept-history', user.id]);
      setEditing(null);
      setForm({ department: '', effective_from: '', effective_to: '' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (rid) => api.delete(`/admin/dept-history/${rid}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries(['dept-history', user.id]),
  });

  const startEdit = (row) => {
    setEditing(row.id);
    setForm({
      department: row.department,
      effective_from: (row.effective_from || '').slice(0, 10),
      effective_to:   (row.effective_to || '').slice(0, 10),
    });
  };
  const startNew = () => {
    setEditing('new');
    setForm({ department: 'Private', effective_from: '', effective_to: '' });
  };
  const handleSave = () => {
    if (!form.department || !form.effective_from) {
      alert('القسم وتاريخ البداية مطلوبين');
      return;
    }
    saveMutation.mutate({
      department: form.department,
      effective_from: form.effective_from,
      effective_to: form.effective_to || null,
    });
  };

  const inputCls = 'border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30';
  const DEPTS_OPTS = ['General', 'Private', 'Semi'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-violet-50/40">
          <div className="flex items-center gap-3">
            <div className="bg-violet-500 w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm">
              <History size={18} />
            </div>
            <div>
              <div className="text-sm font-bold text-gray-900">سجل تنقلات الأقسام</div>
              <div className="text-[11px] text-gray-500 mt-0.5">المستخدم: <span className="font-semibold">{user.full_name}</span></div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/60 rounded-lg">
            <span className="text-lg">×</span>
          </button>
        </div>

        {/* Info note */}
        <div className="px-5 py-2 bg-amber-50/40 border-b border-amber-100 text-[11px] text-amber-800">
          💡 سجل التنقلات بيستخدمه نظام تقارير الحضور والغياب لاحتساب نسب الغياب
          حسب قسم المنسق وقت كل غياب. ابدأ بأقدم سجل واتركها متتالية.
        </div>

        {/* Validation banner */}
        {issues.length > 0 && (
          <div className={`px-5 py-3 border-b ${hasErrors ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'}`}>
            <div className={`text-xs font-bold mb-1.5 flex items-center gap-1.5 ${hasErrors ? 'text-rose-800' : 'text-amber-800'}`}>
              {hasErrors ? '🔴 مشاكل لازم تتصلح:' : '⚠ تنبيهات:'}
            </div>
            <ul className="space-y-1">
              {issues.map((iss, i) => (
                <li key={i} className={`text-[11px] flex items-start gap-1.5 ${iss.severity === 'error' ? 'text-rose-700' : 'text-amber-700'}`}>
                  <span className="mt-0.5 shrink-0">{iss.severity === 'error' ? '✗' : '!'}</span>
                  <span>{iss.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {issues.length === 0 && rows.length >= 2 && !isLoading && (
          <div className="px-5 py-2 bg-emerald-50/60 border-b border-emerald-100 text-[11px] text-emerald-800 flex items-center gap-1.5">
            ✅ كل السجلات متتالية بدون تداخل أو فجوة — النظام هيقرأ البيانات صح
          </div>
        )}

        {/* Body */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {isLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-14 bg-gray-100 animate-pulse rounded-xl" />)}
            </div>
          ) : (
            <>
              {rows.length === 0 && editing !== 'new' && (
                <div className="text-center py-8 text-sm text-gray-400">
                  مفيش سجلات
                </div>
              )}
              {rows.map(r => (
                <div key={r.id} className="border border-gray-200 rounded-xl p-3">
                  {editing === r.id ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1">القسم</label>
                          <select className={inputCls + ' w-full'} value={form.department} onChange={e => setForm({...form, department: e.target.value})}>
                            {DEPTS_OPTS.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1">من تاريخ</label>
                          <input type="date" className={inputCls + ' w-full'} value={form.effective_from} onChange={e => setForm({...form, effective_from: e.target.value})} />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1">إلى (فاضي = لسه)</label>
                          <input type="date" className={inputCls + ' w-full'} value={form.effective_to} onChange={e => setForm({...form, effective_to: e.target.value})} />
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 hover:bg-gray-200">
                          إلغاء
                        </button>
                        <button onClick={handleSave} disabled={saveMutation.isPending} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                          حفظ
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-bold border ${
                        r.department === 'Private' ? 'bg-violet-50 text-violet-700 border-violet-200'
                        : r.department === 'Semi' ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-sky-50 text-sky-700 border-sky-200'
                      }`}>
                        {r.department}
                      </span>
                      <span className="text-xs text-gray-600 font-mono" dir="ltr">
                        {(r.effective_from || '').slice(0, 10)} → {(r.effective_to || '').slice(0, 10) || 'لسه'}
                      </span>
                      {!r.effective_to && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold">حالي</span>
                      )}
                      <div className="ms-auto flex gap-1">
                        <button onClick={() => startEdit(r)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => { if (confirm('حذف السجل ده؟')) deleteMutation.mutate(r.id); }} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-600">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* New record form */}
              {editing === 'new' && (
                <div className="border-2 border-dashed border-blue-300 rounded-xl p-3 bg-blue-50/40 space-y-2">
                  <div className="text-xs font-bold text-blue-700 mb-1">سجل جديد</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 mb-1">القسم</label>
                      <select className={inputCls + ' w-full'} value={form.department} onChange={e => setForm({...form, department: e.target.value})}>
                        {DEPTS_OPTS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 mb-1">من تاريخ *</label>
                      <input type="date" className={inputCls + ' w-full'} value={form.effective_from} onChange={e => setForm({...form, effective_from: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 mb-1">إلى (فاضي = لسه)</label>
                      <input type="date" className={inputCls + ' w-full'} value={form.effective_to} onChange={e => setForm({...form, effective_to: e.target.value})} />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 hover:bg-gray-200">
                      إلغاء
                    </button>
                    <button onClick={handleSave} disabled={saveMutation.isPending} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                      حفظ
                    </button>
                  </div>
                </div>
              )}

              {editing !== 'new' && (
                <button
                  onClick={startNew}
                  className="w-full py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-xs font-bold text-gray-500 hover:bg-gray-50 hover:border-blue-400 hover:text-blue-600 transition-all"
                >
                  + إضافة سجل تنقل جديد
                </button>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
          <button onClick={onClose} className="w-full py-2 rounded-xl bg-gray-200 hover:bg-gray-300 text-sm font-semibold text-gray-700">
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
