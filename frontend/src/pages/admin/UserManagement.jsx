import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Eye, EyeOff, Pencil, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import api from '../../api/axios';
import DataTable from '../../components/ui/DataTable';
import Modal from '../../components/ui/Modal';
import Badge from '../../components/ui/Badge';

const EMPTY_FORM = {
  username: '', password: '', full_name: '',
  role: 'agent', department: 'All', language: 'ar', is_active: 1,
};

function UserModal({ open, onClose, user, onSaved }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(user ? {
    username: user.username, password: '',
    full_name: user.full_name, role: user.role,
    department: user.department, language: user.language,
    is_active: user.is_active,
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
            <input className="input" value={form.username} onChange={e => set('username', e.target.value)} disabled={!!user} />
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
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">{t('admin.role')}</label>
            <select className="input" value={form.role} onChange={e => {
              const r = e.target.value;
              set('role', r);
              if (r === 'admin' || r === 'leader') set('department', 'All');
            }}>
              <option value="agent">{t('admin.agent')}</option>
              <option value="leader">{t('admin.leader')}</option>
              <option value="admin">{t('admin.admin')}</option>
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
          </div>
          <div>
            <label className="label">{t('admin.language')}</label>
            <select className="input" value={form.language} onChange={e => set('language', e.target.value)}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
        {user && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-surface border border-border">
            <label className="label mb-0 flex-1">الحالة</label>
            <button
              type="button"
              onClick={() => set('is_active', form.is_active ? 0 : 1)}
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
  const [selected, setSelected] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

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
    { key: 'username', label: t('admin.username') },
    { key: 'full_name', label: t('admin.fullName') },
    { key: 'role', label: t('admin.role'), render: v => <span className="badge bg-primary/10 text-primary">{t(`roles.${v}`, v)}</span> },
    { key: 'department', label: t('admin.department') },
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
    { key: 'created_at', label: 'تاريخ الإنشاء', render: v => v?.slice(0,10) },
    {
      key: 'id', label: '', render: (_, row) => (
        <div className="flex items-center gap-1">
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
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">{t('admin.users')}</h1>
        <button onClick={() => { setSelected(null); setShowModal(true); }} className="btn-primary flex items-center gap-2 text-sm">
          <Plus size={15} /> {t('admin.addUser')}
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        <DataTable
          columns={columns}
          data={users}
          total={users?.length || 0}
          page={1}
          limit={100}
          onPageChange={() => {}}
          loading={isLoading}
        />
      </div>

      <UserModal
        key={selected?.id ?? 'new'}
        open={showModal}
        user={selected}
        onClose={() => setShowModal(false)}
        onSaved={() => qc.invalidateQueries(['admin-users'])}
      />
    </div>
  );
}
