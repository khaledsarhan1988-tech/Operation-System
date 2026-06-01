import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, Plus, Trash2, Calendar, AlertCircle, Pencil,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import { useAuth } from '../../auth/AuthContext';

/**
 * Holiday admin page.
 *
 * Use case: when an official holiday (Eid, national day, etc.) shifts ALL
 * lectures in a date range to other days, the bulk reschedule that lands in
 * the system is auto-classified as `reason='official_holiday'` instead of
 * needing per-row admin approval. The admin maintains the list of holiday
 * ranges here.
 *
 * Visibility: anyone can VIEW. Only super-admin can ADD/DELETE.
 */
export default function HolidaysManagement() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isSuperAdmin = user?.role === 'admin' && user?.management === 'All';

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);   // holiday being edited | null

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['holidays'],
    queryFn: () => api.get('/holidays').then(r => r.data),
    staleTime: 60 * 1000,
  });

  const delMut = useMutation({
    mutationFn: (id) => api.delete(`/holidays/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['holidays'] }),
  });

  return (
    <div className="space-y-5">
      <PageHero
        title="الإجازات الرسمية"
        subtitle="تواريخ الإجازات اللى بتسبب ترحيل جماعي للمحاضرات — السيستم بيستخدمها لتلقائياً يصنّف الـ reschedule كسبب رسمي بدل إنه يطلب موافقة"
        icon={Sparkles}
        gradient="from-sky-500 to-cyan-500"
      />

      {/* Toolbar */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-3 flex items-center gap-3">
        <div className="flex-1">
          <p className="text-xs text-gray-500">
            {isLoading ? 'جاري التحميل...' : `إجمالي ${rows.length} إجازة مسجلة`}
          </p>
        </div>
        {isSuperAdmin && (
          <button onClick={() => setShowAdd(true)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white font-bold text-sm inline-flex items-center gap-2">
            <Plus size={14} /> إضافة إجازة
          </button>
        )}
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        {isLoading ? (
          <p className="text-center text-gray-400 py-12 text-sm">جاري التحميل...</p>
        ) : rows.length === 0 ? (
          <div className="text-center py-12">
            <Sparkles size={32} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">لا توجد إجازات مسجلة</p>
            {isSuperAdmin && (
              <p className="text-xs text-gray-400 mt-1">اضغط "إضافة إجازة" للبدء</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {rows.map(h => {
              const days = Math.round(
                (new Date(h.end_date + 'T12:00:00') - new Date(h.start_date + 'T12:00:00')) / 86400000
              ) + 1;
              return (
                <div key={h.id} className="px-4 py-3 hover:bg-sky-50/30 flex items-center gap-3 group">
                  <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center flex-shrink-0">
                    <Sparkles size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-800">{h.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                      <Calendar size={11} />
                      <span>{h.start_date}</span>
                      <span className="text-gray-400">←</span>
                      <span>{h.end_date}</span>
                      <span className="text-sky-600 font-bold">({days} يوم)</span>
                    </div>
                    {h.notes && (
                      <p className="text-[11px] text-gray-500 mt-1 italic">{h.notes}</p>
                    )}
                  </div>
                  {h.created_by_name && (
                    <span className="text-[10px] text-gray-400">أضافها {h.created_by_name}</span>
                  )}
                  {isSuperAdmin && (
                    <button onClick={() => setEditing(h)}
                      className="opacity-0 group-hover:opacity-100 transition p-2 rounded-lg hover:bg-sky-50 text-sky-600"
                      title="تعديل">
                      <Pencil size={14} />
                    </button>
                  )}
                  {isSuperAdmin && (
                    <button onClick={() => {
                      if (confirm(`حذف إجازة "${h.name}"؟ المحاضرات اللى اتـ rescheduled لسببها هتفضل مسجلة بس بدون ربط بالإجازة.`)) {
                        delMut.mutate(h.id);
                      }
                    }}
                      className="opacity-0 group-hover:opacity-100 transition p-2 rounded-lg hover:bg-red-50 text-red-500"
                      title="حذف">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Non-admin info banner */}
      {!isSuperAdmin && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
          <AlertCircle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-800">
            عرض فقط — إضافة/حذف الإجازات الرسمية متاحة للمدير العام (Super Admin) فقط.
          </p>
        </div>
      )}

      {(showAdd || editing) && (
        <HolidayModal
          holiday={editing}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['holidays'] }); setShowAdd(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function HolidayModal({ holiday, onClose, onSaved }) {
  const isEdit = !!holiday;
  const [name, setName]   = useState(holiday?.name || '');
  const [start, setStart] = useState(holiday?.start_date || '');
  const [end, setEnd]     = useState(holiday?.end_date || '');
  const [notes, setNotes] = useState(holiday?.notes || '');
  const [error, setError] = useState(null);

  const addMut = useMutation({
    mutationFn: () => isEdit
      ? api.put(`/holidays/${holiday.id}`, { name, start_date: start, end_date: end, notes })
      : api.post('/holidays', { name, start_date: start, end_date: end, notes }),
    onSuccess: () => onSaved(),
    onError: (err) => setError(err.response?.data?.error || err.message),
  });

  const canSave = name.trim() && start && end && (end >= start);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-gradient-to-r from-sky-50 to-cyan-50 border-b">
          <h3 className="font-bold text-gray-900 text-base flex items-center gap-2">
            <Sparkles size={18} className="text-sky-600" /> {isEdit ? 'تعديل إجازة رسمية' : 'إضافة إجازة رسمية'}
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            كل المحاضرات اللى اتم ترحيلها من تواريخ داخل المدى دي هتتسجّل تلقائياً بسبب "إجازة رسمية"
          </p>
        </div>

        <div className="p-5 space-y-3">
          {error && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              {error}
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">اسم الإجازة *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="مثلاً: عيد الفطر"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">من تاريخ *</label>
              <input type="date" value={start} onChange={e => setStart(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">إلى تاريخ *</label>
              <input type="date" value={end} onChange={e => setEnd(e.target.value)}
                min={start || undefined}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">ملاحظات (اختياري)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm resize-none" />
          </div>
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-100">
            إلغاء
          </button>
          <button onClick={() => addMut.mutate()}
            disabled={!canSave || addMut.isPending}
            className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-sky-500 to-cyan-500 text-white text-sm font-bold disabled:opacity-50">
            {addMut.isPending ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}
