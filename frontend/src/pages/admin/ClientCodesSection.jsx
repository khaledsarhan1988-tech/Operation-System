import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Hash, Search, X, RefreshCw, Plus, Pencil, Trash2, Save, AlertTriangle, Download,
} from 'lucide-react';
import api from '../../api/axios';
import SectionCard from '../../components/ui/SectionCard';

// «Clients Codes» — registry of client codes, embedded as a tab inside كشف العملاء.
const EMPTY = { code: '', client_name: '', mobile_no: '', note: '' };

function FormModal({ open, row, onClose, onSaved }) {
  const isEdit = !!row;
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [syncedKey, setSyncedKey] = useState(null);

  // Suggest the next code (max+1) when adding a new one.
  const { data: nextData } = useQuery({
    queryKey: ['client-codes', 'next'],
    queryFn: () => api.get('/client-codes/next-code').then(r => r.data),
    enabled: open && !isEdit,
    staleTime: 0,
  });

  const key = open ? (row?.id ?? `new:${nextData?.next ?? ''}`) : 'closed';
  if (open && syncedKey !== key) {
    setForm(isEdit
      ? { code: row.code ?? '', client_name: row.client_name ?? '', mobile_no: row.mobile_no ?? '', note: row.note ?? '' }
      : { ...EMPTY, code: nextData?.next ?? '' });
    setError('');
    setSyncedKey(key);
  }

  const save = useMutation({
    mutationFn: () => isEdit
      ? api.put(`/client-codes/${row.id}`, form).then(r => r.data)
      : api.post('/client-codes', form).then(r => r.data),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err) => setError(err?.response?.data?.error || 'فشل الحفظ'),
  });

  if (!open) return null;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose} dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-sky-600 to-cyan-600 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">{isEdit ? <Pencil size={20} /> : <Plus size={20} />}</div>
            <h2 className="text-lg font-black">{isEdit ? 'تعديل كود عميل' : 'كود عميل جديد'}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/15 rounded-xl transition"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          {error && (
            <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-3 flex items-center gap-2 text-sm font-bold text-rose-700">
              <AlertTriangle size={16} /> {error}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1">الكود (Code){!isEdit ? ' — مقترح تلقائي' : ''}</label>
              <input value={form.code} onChange={(e) => set('code', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1">الموبايل</label>
              <input value={form.mobile_no} onChange={(e) => set('mobile_no', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-gray-500 mb-1">اسم العميل</label>
              <input value={form.client_name} onChange={(e) => set('client_name', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-gray-500 mb-1">ملاحظة</label>
              <input value={form.note} onChange={(e) => set('note', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition">إلغاء</button>
            <button onClick={() => { setError(''); save.mutate(); }} disabled={!form.code.trim() || save.isPending}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-black text-white bg-sky-600 hover:bg-sky-700 rounded-xl transition disabled:opacity-50">
              {save.isPending ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />} حفظ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirm({ row, onClose, onDeleted }) {
  const del = useMutation({
    mutationFn: () => api.delete(`/client-codes/${row.id}`).then(r => r.data),
    onSuccess: () => { onDeleted(); onClose(); },
  });
  if (!row) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose} dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 className="w-7 h-7 text-rose-600" /></div>
        <h3 className="text-lg font-black text-gray-800 mb-2">حذف الكود؟</h3>
        <p className="text-sm text-gray-500 mb-5">«{row.code}» — {row.client_name || ''}</p>
        <div className="flex justify-center gap-3">
          <button onClick={onClose} className="px-5 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition">إلغاء</button>
          <button onClick={() => del.mutate()} disabled={del.isPending}
            className="inline-flex items-center gap-2 px-5 py-2 text-sm font-black text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition disabled:opacity-50">
            {del.isPending ? <RefreshCw size={16} className="animate-spin" /> : <Trash2 size={16} />} حذف
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ClientCodesSection() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);
  const [msg, setMsg] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['client-codes', 'list', q],
    queryFn: () => api.get('/client-codes/list', { params: { q } }).then(r => r.data),
  });
  const rows = data?.rows || [];
  const afterMutate = () => qc.invalidateQueries({ queryKey: ['client-codes'] });

  const seed = useMutation({
    mutationFn: () => api.post('/client-codes/seed').then(r => r.data),
    onSuccess: (d) => { setMsg(`تم: أُضيف ${d.added} كود (الإجمالي ${d.total}).`); afterMutate(); },
    onError: (err) => setMsg(err?.response?.data?.error || 'فشل الملء'),
  });

  return (
    <div className="space-y-4" dir="rtl">
      {msg && (
        <div className="bg-sky-50 border border-sky-200 rounded-2xl p-3 flex items-center justify-between text-sm font-bold text-sky-800">
          <span>{msg}</span>
          <button onClick={() => setMsg('')} className="p-1 hover:bg-sky-100 rounded-lg"><X size={16} /></button>
        </div>
      )}
      <SectionCard
        title={`Clients Codes (${rows.length})`}
        icon={Hash}
        accent="cyan"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => seed.mutate()} disabled={seed.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-cyan-700 bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 rounded-lg transition disabled:opacity-50">
              {seed.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />} ملء من السجل
            </button>
            <button onClick={() => { setEditRow(null); setFormOpen(true); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition">
              <Plus size={14} /> كود جديد
            </button>
            <button onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition">
              <RefreshCw size={14} /> تحديث
            </button>
          </div>
        }
      >
        <div className="relative max-w-sm mb-4">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input type="text" placeholder="بحث بالكود / الاسم / الموبايل..." value={q} onChange={(e) => setQ(e.target.value)}
            className="w-full pl-3 pr-9 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none" />
        </div>
        {isLoading ? (
          <div className="text-center py-10"><RefreshCw className="w-8 h-8 text-sky-500 animate-spin mx-auto" /></div>
        ) : rows.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">لا توجد أكواد — اضغط «ملء من السجل» أو «كود جديد».</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 border-b border-gray-100 text-xs">
                  <th className="text-right font-bold py-2 px-3">الكود</th>
                  <th className="text-right font-bold py-2 px-3">اسم العميل</th>
                  <th className="text-right font-bold py-2 px-3">الموبايل</th>
                  <th className="text-right font-bold py-2 px-3">ملاحظة</th>
                  <th className="py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="py-2 px-3 font-mono font-black text-gray-800">{r.code}</td>
                    <td className="py-2 px-3 text-gray-700">{r.client_name || '—'}</td>
                    <td className="py-2 px-3 font-mono text-xs text-gray-600">{r.mobile_no || '—'}</td>
                    <td className="py-2 px-3 text-gray-500">{r.note || '—'}</td>
                    <td className="py-2 px-3">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => { setEditRow(r); setFormOpen(true); }} className="p-1.5 text-sky-600 hover:bg-sky-50 rounded-lg transition"><Pencil size={16} /></button>
                        <button onClick={() => setDeleteRow(r)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <FormModal open={formOpen} row={editRow} onClose={() => setFormOpen(false)} onSaved={afterMutate} />
      <DeleteConfirm row={deleteRow} onClose={() => setDeleteRow(null)} onDeleted={afterMutate} />
    </div>
  );
}
