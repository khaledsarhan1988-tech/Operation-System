import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../ui/Modal';
import api from '../../api/axios';

const PRIORITIES = ['عاجلة', 'هامة', 'عادية'];
const TASK_TYPES = [
  'Attendance Zoom Call', 'Follow Up', 'Payment', 'Technical Issue',
  'Schedule Change', 'Complaint', 'Inquiry', 'Onboarding', 'Other'
];

export default function RemarkForm({ open, onClose, remark, onSaved }) {
  const { t } = useTranslation();
  const isEdit = !!remark?.id;

  const [form, setForm] = useState({
    task_type: '', client_name: '', client_phone: '',
    details: '', category: '', priority: 'عادية',
    notes: '', agent_notes: '', status: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (remark) {
      setForm({
        task_type: remark.task_type || '',
        client_name: remark.client_name || '',
        client_phone: remark.client_phone || '',
        details: remark.details || '',
        category: remark.category || '',
        priority: remark.priority || 'عادية',
        notes: remark.notes || '',
        agent_notes: remark.agent_notes || '',
        status: remark.status || '',
      });
    } else {
      setForm({ task_type: '', client_name: '', client_phone: '', details: '', category: '', priority: 'عادية', notes: '', agent_notes: '', status: '' });
    }
    setError('');
  }, [remark, open]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = async () => {
    if (!form.task_type || !form.client_name) {
      setError('Task type and client name are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await api.put(`/remarks/${remark.id}`, form);
      } else {
        await api.post('/remarks', form);
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleMarkDone = async () => {
    if (!remark?.id) return;
    setSaving(true);
    try {
      await api.put(`/remarks/${remark.id}`, { status: 'إنتهت' });
      onSaved?.();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('tasks.editTask') : t('tasks.addTask')}
    >
      <div className="space-y-4">
        {error && <p className="text-sm text-danger bg-danger/10 p-3 rounded-lg">{error}</p>}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('tasks.taskType')} *</label>
            <select className="input" value={form.task_type} onChange={e => set('task_type', e.target.value)}>
              <option value="">— {t('common.all')} —</option>
              {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('tasks.priority')}</label>
            <select className="input" value={form.priority} onChange={e => set('priority', e.target.value)}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('tasks.client')} *</label>
            <input className="input" value={form.client_name} onChange={e => set('client_name', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('tasks.phone')}</label>
            <input className="input" value={form.client_phone} onChange={e => set('client_phone', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">{t('tasks.details')}</label>
          <textarea className="input h-20 resize-none" value={form.details} onChange={e => set('details', e.target.value)} />
        </div>

        <div>
          <label className="label">{t('tasks.notes')}</label>
          <textarea className="input h-16 resize-none" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>

        {isEdit && (
          <div>
            <label className="label">{t('tasks.agentNotes')}</label>
            <textarea className="input h-16 resize-none" value={form.agent_notes} onChange={e => set('agent_notes', e.target.value)} />
          </div>
        )}

        {isEdit && (
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="غير منتهية">غير منتهية (Pending)</option>
              <option value="إنتهت">إنتهت (Done)</option>
            </select>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
            {saving ? t('common.loading') : t('tasks.save')}
          </button>
          {isEdit && form.status !== 'إنتهت' && (
            <button onClick={handleMarkDone} disabled={saving} className="btn-accent">
              {t('tasks.markDone')}
            </button>
          )}
          <button onClick={onClose} className="btn-outline">
            {t('tasks.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
