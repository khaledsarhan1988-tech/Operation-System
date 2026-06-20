import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Tag, Search, X, RefreshCw, Plus, Pencil, Trash2, Save, AlertTriangle,
  Download, DollarSign,
} from 'lucide-react';
import api from '../../api/axios';
import SectionCard from '../../components/ui/SectionCard';

// «العضويات وأسعارها» as an embeddable SECTION (no PageHero) — rendered inside
// the كشف العملاء page under its own tab, beside «قائمة العمليات».

const EMPTY = { code: '', price_ahmed_hassan: '', price_dardasha: '', months: '', note: '' };

function fmt(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  return isNaN(n) ? v : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// ─── ADD / EDIT MODAL ─────────────────────────────────────────────────────────
function FormModal({ open, row, onClose, onSaved }) {
  const isEdit = !!row;
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  const key = open ? (row?.id ?? 'new') : 'closed';
  const [syncedKey, setSyncedKey] = useState(null);
  if (open && syncedKey !== key) {
    setForm(isEdit
      ? { code: row.code ?? '', price_ahmed_hassan: row.price_ahmed_hassan ?? '', price_dardasha: row.price_dardasha ?? '', months: row.months ?? '', note: row.note ?? '' }
      : EMPTY);
    setError('');
    setSyncedKey(key);
  }

  const save = useMutation({
    mutationFn: () => isEdit
      ? api.put(`/membership-prices/${row.id}`, form).then(r => r.data)
      : api.post('/membership-prices', form).then(r => r.data),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err) => setError(err?.response?.data?.error || 'فشل الحفظ'),
  });

  if (!open) return null;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose} dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">{isEdit ? <Pencil size={20} /> : <Plus size={20} />}</div>
            <h2 className="text-lg font-black">{isEdit ? 'تعديل عضوية' : 'إضافة عضوية'}</h2>
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
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-gray-500 mb-1">الكود / العضوية (Code)</label>
              <input value={form.code} onChange={(e) => set('code', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-200 focus:border-violet-400 outline-none" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1">سعر Ahmed Hassan</label>
              <input type="number" value={form.price_ahmed_hassan} onChange={(e) => set('price_ahmed_hassan', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-200 focus:border-violet-400 outline-none" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1">سعر Dardasha</label>
              <input type="number" value={form.price_dardasha} onChange={(e) => set('price_dardasha', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-200 focus:border-violet-400 outline-none" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1">عدد الشهور (Months)</label>
              <input value={form.months} onChange={(e) => set('months', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-200 focus:border-violet-400 outline-none" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1">ملاحظة</label>
              <input value={form.note} onChange={(e) => set('note', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-200 focus:border-violet-400 outline-none" />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition">إلغاء</button>
            <button onClick={() => { setError(''); save.mutate(); }} disabled={!form.code.trim() || save.isPending}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-black text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition disabled:opacity-50">
              {save.isPending ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />} حفظ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DELETE CONFIRM ───────────────────────────────────────────────────────────
function DeleteConfirm({ row, onClose, onDeleted }) {
  const del = useMutation({
    mutationFn: () => api.delete(`/membership-prices/${row.id}`).then(r => r.data),
    onSuccess: () => { onDeleted(); onClose(); },
  });
  if (!row) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose} dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 className="w-7 h-7 text-rose-600" /></div>
        <h3 className="text-lg font-black text-gray-800 mb-2">حذف العضوية؟</h3>
        <p className="text-sm text-gray-500 mb-5">«{row.code}» — لا يمكن التراجع.</p>
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

// ─── SECTION ──────────────────────────────────────────────────────────────────
export default function MembershipPricesSection() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);
  const [seedMsg, setSeedMsg] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['membership-prices', q],
    queryFn: () => api.get('/membership-prices/list', { params: { q } }).then(r => r.data),
  });
  const rows = data?.rows || [];
  const afterMutate = () => qc.invalidateQueries({ queryKey: ['membership-prices'] });

  const seed = useMutation({
    mutationFn: () => api.post('/membership-prices/seed').then(r => r.data),
    onSuccess: (d) => { setSeedMsg(`تم: أُضيف ${d.added} عضوية جديدة (الإجمالي ${d.total}).`); afterMutate(); },
    onError: (err) => setSeedMsg(err?.response?.data?.error || 'فشل الملء'),
  });

  return (
    <div className="space-y-4" dir="rtl">
      {seedMsg && (
        <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-2xl p-3 flex items-center justify-between text-sm font-bold text-fuchsia-800">
          <span>{seedMsg}</span>
          <button onClick={() => setSeedMsg('')} className="p-1 hover:bg-fuchsia-100 rounded-lg"><X size={16} /></button>
        </div>
      )}

      <SectionCard
        title={`العضويات وأسعارها (${rows.length})`}
        icon={Tag}
        accent="violet"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => seed.mutate()} disabled={seed.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-fuchsia-700 bg-fuchsia-50 hover:bg-fuchsia-100 border border-fuchsia-200 rounded-lg transition disabled:opacity-50">
              {seed.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />} ملء من الأكواد
            </button>
            <button onClick={() => { setEditRow(null); setFormOpen(true); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg transition">
              <Plus size={14} /> إضافة عضوية
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
          <input type="text" placeholder="بحث بالكود..." value={q} onChange={(e) => setQ(e.target.value)}
            className="w-full pl-3 pr-9 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-200 focus:border-violet-400 outline-none" />
        </div>

        {isLoading ? (
          <div className="text-center py-10"><RefreshCw className="w-8 h-8 text-violet-500 animate-spin mx-auto" /></div>
        ) : rows.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">لا توجد عضويات — اضغط «ملء من الأكواد» أو «إضافة عضوية».</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 border-b border-gray-100 text-xs">
                  <th className="text-right font-bold py-2 px-3">الكود</th>
                  <th className="text-right font-bold py-2 px-3">سعر Ahmed Hassan</th>
                  <th className="text-right font-bold py-2 px-3">سعر Dardasha</th>
                  <th className="text-right font-bold py-2 px-3">الشهور</th>
                  <th className="text-right font-bold py-2 px-3">ملاحظة</th>
                  <th className="py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="py-2 px-3 font-black text-gray-800">{r.code}</td>
                    <td className="py-2 px-3 font-bold text-emerald-700">{fmt(r.price_ahmed_hassan)}</td>
                    <td className="py-2 px-3 font-bold text-sky-700">{fmt(r.price_dardasha)}</td>
                    <td className="py-2 px-3 text-gray-600">{r.months || '—'}</td>
                    <td className="py-2 px-3 text-gray-500">{r.note || '—'}</td>
                    <td className="py-2 px-3">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => { setEditRow(r); setFormOpen(true); }} className="p-1.5 text-violet-600 hover:bg-violet-50 rounded-lg transition"><Pencil size={16} /></button>
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
