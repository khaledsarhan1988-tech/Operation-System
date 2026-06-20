import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, Search, Calendar, Filter, X, ChevronLeft, ChevronRight,
  Eye, RefreshCw, Plus, Pencil, Trash2, Save, CreditCard, Hash,
  AlertTriangle, DollarSign, Upload, CheckCircle, Tag,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import MembershipPricesSection from './MembershipPricesSection';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function fmtAmount(amount) {
  if (amount == null || amount === '') return '—';
  const n = Number(amount);
  if (isNaN(n)) return amount;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Empty form — keys MUST match backend SALE_FIELDS.
const EMPTY_FORM = {
  code: '', entry_date: '', client_name: '', mobile_no: '', agent_name: '',
  department: '', courses: '', price: '', months: '', payment_way: '',
  paid_status: '', pages: '', shift: '', groups: '', total_price: '',
  total_paid_same_month: '', discount: '', chrismss_discount_ah: '',
  chrismss_discount_dar: '', offer_individual: '', refund_deduction: '',
  khaled_deduction: '', new_prices: '', new_courses: '', balance: '', noted1: '',
  noted2: '', tamkeen: '', installment_date: '', note: '',
};
const EMPTY_INST = { sales_man: '', department: '', months: '', paid_or_not: '', amount: '', pay_date: '', note: '' };

// Fixed controlled vocabularies (mirror the backend normalizer). Using <select>
// for these two makes it impossible to re-introduce spelling/case variants.
// "Daradasha AUE" is a DISTINCT brand from "Dardasha" (owner decision).
const BRANDS = ['Ahmed Hassan', 'Dardasha', 'Go English', 'Work Shop Offline', 'Daradasha AUE'];
const PAID_STATUSES = ['Paid', 'Not Paid', 'Fake'];

// ─── FORM MODAL (create / edit) ───────────────────────────────────────────────
function SaleFormModal({ open, editId, options, onClose, onSaved }) {
  const isEdit = !!editId;
  const [form, setForm] = useState(EMPTY_FORM);
  const [installments, setInstallments] = useState([]);
  const [error, setError] = useState('');

  // Load the row being edited. (React Query v5 removed onSuccess on useQuery —
  // we read `data` and populate via useEffect below.)
  const { data: rowData, isLoading: loadingRow } = useQuery({
    queryKey: ['cs-sales', 'one', editId],
    queryFn: () => api.get(`/cs-sales-register/${editId}`).then(r => r.data),
    enabled: open && isEdit,
  });

  // Populate the form: edit → from the fetched row once it arrives; add → blank.
  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      if (!rowData) return; // wait for the fetch
      const s = rowData.sale || {};
      setForm({ ...EMPTY_FORM, ...Object.fromEntries(Object.keys(EMPTY_FORM).map(k => [k, s[k] ?? ''])) });
      setInstallments((rowData.installments || []).map(i => ({
        sales_man: i.sales_man ?? '', department: i.department ?? '', months: i.months ?? '',
        paid_or_not: i.paid_or_not ?? '', amount: i.amount ?? '', pay_date: i.pay_date ?? '',
        note: i.note ?? '',
      })));
    } else {
      setForm(EMPTY_FORM); setInstallments([]); setError('');
    }
  }, [open, isEdit, editId, rowData]);

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, installments };
      return isEdit
        ? api.put(`/cs-sales-register/${editId}`, payload).then(r => r.data)
        : api.post('/cs-sales-register', payload).then(r => r.data);
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err) => setError(err?.response?.data?.error || 'فشل الحفظ'),
  });

  if (!open) return null;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setInst = (idx, k, v) => setInstallments(list => list.map((it, i) => i === idx ? { ...it, [k]: v } : it));
  const addInst = () => setInstallments(list => [...list, { ...EMPTY_INST }]);
  const rmInst = (idx) => setInstallments(list => list.filter((_, i) => i !== idx));

  const opt = (k) => options?.[k] || [];

  // Field renderer — `list` enables a datalist (pick existing or type new);
  // `select` (a fixed array) renders a hard <select> instead (no free text).
  // IMPORTANT: call this as a function — {F({...})} — NOT as <F/>. Rendering it
  // as a component would give it a fresh identity each render (it's defined
  // inside SaleFormModal) and remount the input on every keystroke, losing
  // focus. Calling it inlines plain host elements, so focus is preserved.
  const F = ({ k, label, type = 'text', list, select, span = 1 }) => (
    <div className={span === 2 ? 'sm:col-span-2' : span === 4 ? 'sm:col-span-2 lg:col-span-4' : ''}>
      <label className="block text-[11px] font-bold text-gray-500 mb-1">{label}</label>
      {select ? (
        <select
          value={form[k] ?? ''}
          onChange={(e) => set(k, e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
        >
          <option value="">—</option>
          {select.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      ) : (
        <>
          <input
            type={type}
            value={form[k] ?? ''}
            onChange={(e) => set(k, e.target.value)}
            list={list ? `dl-${k}` : undefined}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
          />
          {list && (
            <datalist id={`dl-${k}`}>
              {opt(list).map(v => <option key={v} value={v} />)}
            </datalist>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose} dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">{isEdit ? <Pencil size={20} /> : <Plus size={20} />}</div>
            <h2 className="text-lg font-black">{isEdit ? 'تعديل عملية' : 'إضافة عملية جديدة'}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/15 rounded-xl transition"><X size={20} /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-6 space-y-5">
          {loadingRow ? (
            <div className="text-center py-10"><RefreshCw className="w-8 h-8 text-emerald-500 animate-spin mx-auto" /></div>
          ) : (
            <>
              {error && (
                <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-3 flex items-center gap-2 text-sm font-bold text-rose-700">
                  <AlertTriangle size={16} /> {error}
                </div>
              )}

              <SectionCard title="بيانات العملية" icon={CreditCard} accent="emerald">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {F({ k: 'code', label: 'الكود (Code)' })}
                  {F({ k: 'entry_date', label: 'التاريخ (Data)' })}
                  {F({ k: 'client_name', label: 'اسم العميل', span: 2 })}
                  {F({ k: 'mobile_no', label: 'الموبايل' })}
                  {F({ k: 'agent_name', label: 'الموظف (Agent)', list: 'agents' })}
                  {F({ k: 'department', label: 'القسم (Department)', list: 'departments' })}
                  {F({ k: 'courses', label: 'الكورس (Courses)', list: 'courses' })}
                  {F({ k: 'price', label: 'السعر (Price)', type: 'number' })}
                  {F({ k: 'months', label: 'الشهر (Months)', list: 'months' })}
                  {F({ k: 'payment_way', label: 'طريقة الدفع', list: 'payment_ways' })}
                  {F({ k: 'paid_status', label: 'حالة الدفع', select: PAID_STATUSES })}
                  {F({ k: 'pages', label: 'البراند (Pages)', select: BRANDS })}
                  {F({ k: 'shift', label: 'الفترة (Shift)', list: 'shifts' })}
                  {F({ k: 'groups', label: 'المجموعة (Groups)' })}
                </div>
              </SectionCard>

              <SectionCard title="الإجماليات والخصومات" icon={DollarSign} accent="amber">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {F({ k: 'total_price', label: 'Total Price', type: 'number' })}
                  {F({ k: 'total_paid_same_month', label: 'Total Paid In Same Months', type: 'number' })}
                  {F({ k: 'discount', label: 'Discount' })}
                  {F({ k: 'offer_individual', label: 'Offer Individual' })}
                  {F({ k: 'chrismss_discount_ah', label: 'Chrismss Discount Ahmed Hassan', type: 'number' })}
                  {F({ k: 'chrismss_discount_dar', label: 'Chrismss Discount Dardasha', type: 'number' })}
                  {F({ k: 'refund_deduction', label: 'Amount Deduction For Refund', type: 'number' })}
                  {F({ k: 'khaled_deduction', label: 'Dedecutin From Khaled Only', type: 'number' })}
                  {F({ k: 'new_prices', label: 'New Prices' })}
                  {F({ k: 'new_courses', label: 'New Courses' })}
                  {F({ k: 'balance', label: 'Balance (الرصيد المتبقي)', type: 'number' })}
                </div>
              </SectionCard>

              <SectionCard title="الحالة والملاحظات" icon={Filter} accent="cyan">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {F({ k: 'noted1', label: 'Noted #1' })}
                  {F({ k: 'noted2', label: 'Noted #2', list: 'noted' })}
                  {F({ k: 'tamkeen', label: 'Tamkeen', list: 'tamkeen' })}
                  {F({ k: 'installment_date', label: 'تاريخ القسط (Date)' })}
                  {F({ k: 'note', label: 'Note', span: 4 })}
                </div>
              </SectionCard>

              {/* Installments */}
              <SectionCard
                title={`الأقساط (${installments.length})`}
                icon={CreditCard}
                accent="violet"
                actions={
                  <button onClick={addInst} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg transition">
                    <Plus size={14} /> إضافة قسط
                  </button>
                }
              >
                {installments.length === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-4">لا توجد أقساط — اضغط «إضافة قسط» لإضافة دفعة</p>
                ) : (
                  <div className="space-y-3">
                    {installments.map((ins, idx) => (
                      <div key={idx} className="border border-gray-200 rounded-2xl p-3 bg-gray-50/50">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-black text-violet-700">قسط #{idx + 1}</span>
                          <button onClick={() => rmInst(idx)} className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg transition"><Trash2 size={14} /></button>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {[
                            ['sales_man', 'Sales Man'], ['department', 'Department'], ['months', 'Months'],
                            ['paid_or_not', 'Paid or Not Paid'], ['amount', 'Amount'], ['pay_date', 'Date'],
                            ['note', 'Note'],
                          ].map(([k, lbl]) => (
                            <div key={k}>
                              <label className="block text-[10px] font-bold text-gray-500 mb-0.5">{lbl}</label>
                              <input
                                value={ins[k] ?? ''}
                                onChange={(e) => setInst(idx, k, e.target.value)}
                                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-violet-200 outline-none"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-end gap-3 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition">إلغاء</button>
          <button
            onClick={() => { setError(''); save.mutate(); }}
            disabled={save.isPending}
            className="inline-flex items-center gap-2 px-5 py-2 text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition disabled:opacity-50"
          >
            {save.isPending ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            {isEdit ? 'حفظ التعديلات' : 'إضافة'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CSV IMPORT MODAL (one-time historical upload) ───────────────────────────
function ImportModal({ open, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [wipe, setWipe] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [needWipe, setNeedWipe] = useState(false);

  const run = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('wipe', wipe ? '1' : '0');
      return api.post('/cs-sales-register/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
    },
    onSuccess: (data) => { setResult(data); setError(''); setNeedWipe(false); onImported(); },
    onError: (err) => {
      const d = err?.response?.data;
      if (d?.code === 'ALREADY_IMPORTED') { setNeedWipe(true); setError(d.error); }
      else setError(d?.error || 'فشل الرفع');
    },
  });

  if (!open) return null;
  const close = () => { setFile(null); setWipe(false); setError(''); setResult(null); setNeedWipe(false); onClose(); };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={close} dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-sky-600 to-indigo-600 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl"><Upload size={20} /></div>
            <h2 className="text-lg font-black">رفع كشف العملاء (CSV)</h2>
          </div>
          <button onClick={close} className="p-2 hover:bg-white/15 rounded-xl transition"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-4">
          {result ? (
            <div className="space-y-3">
              <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-emerald-600" />
                <p className="text-sm font-black text-emerald-800">تم الرفع بنجاح</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Stat label="صفوف مُدخَلة" value={result.inserted} />
                <Stat label="أقساط" value={result.instCount} />
                <Stat label="صفوف فارغة (متخطّاة)" value={result.skippedEmpty} />
                {result.wiped ? <Stat label="مُستبدَلة" value={result.wiped} /> : null}
                <Stat label="إجمالي العمليات بالجدول" value={result.totalParent} />
                <Stat label="إجمالي الأقساط بالجدول" value={result.totalInst} />
              </div>
              <button onClick={close} className="w-full py-2.5 text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition">تمام</button>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600 leading-relaxed">
                ارفع ملف CSV المُصدَّر من تاب «كشف العملاء». الرفع لمرة واحدة — كل صف عملية، مع الأقساط.
              </p>
              <label className="block">
                <span className="text-xs font-bold text-gray-500">ملف CSV</span>
                <input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setError(''); setNeedWipe(false); }}
                  className="mt-1 block w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100" />
              </label>

              {(needWipe || wipe) && (
                <label className="flex items-center gap-2 text-sm font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} className="w-4 h-4" />
                  استبدال البيانات المرفوعة سابقًا (حذف صفوف «sheet» القديمة ثم إعادة الرفع)
                </label>
              )}

              {error && (
                <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-3 flex items-start gap-2 text-sm font-bold text-rose-700">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /> <span>{error}</span>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <button onClick={close} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition">إلغاء</button>
                <button onClick={() => { setError(''); run.mutate(); }} disabled={!file || run.isPending}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-black text-white bg-sky-600 hover:bg-sky-700 rounded-xl transition disabled:opacity-50">
                  {run.isPending ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                  رفع
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
function Stat({ label, value }) {
  return (
    <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
      <p className="text-[11px] text-gray-500 font-bold">{label}</p>
      <p className="text-lg font-black text-gray-800">{(Number(value) || 0).toLocaleString('en-US')}</p>
    </div>
  );
}

// ─── DELETE CONFIRM ───────────────────────────────────────────────────────────
function DeleteConfirm({ row, onClose, onDeleted }) {
  const del = useMutation({
    mutationFn: () => api.delete(`/cs-sales-register/${row.id}`).then(r => r.data),
    onSuccess: () => { onDeleted(); onClose(); },
  });
  if (!row) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose} dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-rose-100 text-rose-600 rounded-2xl"><Trash2 size={22} /></div>
          <div>
            <h3 className="text-lg font-black text-gray-800">حذف العملية</h3>
            <p className="text-xs text-gray-500 font-bold mt-0.5">الكود {row.code || '—'} · {row.client_name || '—'}</p>
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-5">هل أنت متأكد من حذف هذه العملية وكل أقساطها؟ لا يمكن التراجع.</p>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition">إلغاء</button>
          <button onClick={() => del.mutate()} disabled={del.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-black text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition disabled:opacity-50">
            {del.isPending ? <RefreshCw size={16} className="animate-spin" /> : <Trash2 size={16} />}
            حذف
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PAGINATION ───────────────────────────────────────────────────────────────
function Pagination({ page, pages, total, onPageChange }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 mt-4 px-2">
      <p className="text-xs font-bold text-gray-500">
        صفحة <span className="text-gray-800">{page}</span> من <span className="text-gray-800">{pages}</span>
        <span className="mx-2 text-gray-300">·</span>
        إجمالي <span className="text-gray-800">{total.toLocaleString('en-US')}</span> عملية
      </p>
      <div className="flex items-center gap-1">
        <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}
          className="p-2 border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition"><ChevronRight size={16} /></button>
        <span className="px-3 py-1.5 text-sm font-bold bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-200 min-w-[40px] text-center">{page}</span>
        <button onClick={() => onPageChange(Math.min(pages, page + 1))} disabled={page >= pages}
          className="p-2 border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition"><ChevronLeft size={16} /></button>
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function ClientSalesRegister() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({
    q: '', department: '', payment_way: '', paid_status: '', pages: '',
    courses: '', agent: '', source: '', from: '', to: '', page: 1, limit: 50,
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [view, setView] = useState('operations'); // 'operations' | 'memberships'

  const params = useMemo(() => {
    const p = { page: filters.page, limit: filters.limit };
    for (const k of ['q', 'department', 'payment_way', 'paid_status', 'pages', 'courses', 'agent', 'source', 'from', 'to']) {
      if (filters[k]) p[k] = filters[k];
    }
    return p;
  }, [filters]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['cs-sales', 'list', params],
    queryFn: () => api.get('/cs-sales-register/list', { params }).then(r => r.data),
    keepPreviousData: true,
  });

  const { data: options } = useQuery({
    queryKey: ['cs-sales', 'options'],
    queryFn: () => api.get('/cs-sales-register/options').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const rows = data?.rows || [];
  const total = data?.total || 0;
  const pages = data?.pages || 1;

  const update = (k, v) => setFilters(f => ({ ...f, [k]: v, page: 1 }));
  const onReset = () => setFilters({
    q: '', department: '', payment_way: '', paid_status: '', pages: '',
    courses: '', agent: '', source: '', from: '', to: '', page: 1, limit: 50,
  });
  const afterMutate = () => {
    qc.invalidateQueries({ queryKey: ['cs-sales', 'list'] });
    qc.invalidateQueries({ queryKey: ['cs-sales', 'options'] });
  };

  const openAdd  = () => { setEditId(null); setFormOpen(true); };
  const openEdit = (id) => { setEditId(id); setFormOpen(true); };

  return (
    <div className="p-6 space-y-5" dir="rtl">
      <PageHero
        title="كشف العملاء"
        subtitle="سجل مبيعات العملاء — إدخال ومتابعة العمليات داخل النظام"
        icon={Users}
        gradient="emerald"
        actions={view === 'operations' ? (
          <>
            <button onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-black text-sky-700 bg-white hover:bg-sky-50 rounded-xl transition shadow-sm">
              <Upload size={18} /> رفع CSV
            </button>
            <button onClick={openAdd}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-black text-emerald-700 bg-white hover:bg-emerald-50 rounded-xl transition shadow-sm">
              <Plus size={18} /> إضافة عملية
            </button>
          </>
        ) : null}
        stats={[{ label: 'إجمالي العمليات', value: total, icon: Hash }]}
      />

      {/* Tabs — switch between the operations list and the membership prices */}
      <div className="flex items-center gap-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-1.5 w-fit">
        {[
          ['operations', 'قائمة العمليات', CreditCard],
          ['memberships', 'العضويات وأسعارها', Tag],
        ].map(([key, label, Icon]) => (
          <button key={key} onClick={() => setView(key)}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-black rounded-xl transition ${
              view === key ? 'bg-emerald-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100'
            }`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {view === 'memberships' ? <MembershipPricesSection /> : (
      <>
      {/* Filters */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="text" placeholder="بحث بالاسم / الموبايل / الكود..." value={filters.q}
              onChange={(e) => update('q', e.target.value)}
              className="w-full pl-3 pr-9 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
          </div>
          {[
            ['department', 'كل الأقسام', 'departments'],
            ['payment_way', 'كل طرق الدفع', 'payment_ways'],
            ['paid_status', 'كل حالات الدفع', null, PAID_STATUSES],
            ['pages', 'كل البراندات', null, BRANDS],
            ['courses', 'كل الكورسات', 'courses'],
            ['agent', 'كل الموظفين', 'agents'],
            ['source', 'كل المصادر', 'sources'],
          ].map(([k, ph, optKey, fixed]) => (
            <select key={k} value={filters[k]} onChange={(e) => update(k, e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none">
              <option value="">{ph}</option>
              {(fixed || options?.[optKey] || []).map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          ))}
          <div className="relative">
            <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="date" value={filters.from} onChange={(e) => update('from', e.target.value)}
              className="w-full pl-3 pr-9 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 outline-none" />
          </div>
          <div className="relative">
            <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="date" value={filters.to} onChange={(e) => update('to', e.target.value)}
              className="w-full pl-3 pr-9 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 outline-none" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <button onClick={onReset} className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition">
            <X size={14} /> مسح الفلاتر
          </button>
          <p className="text-xs text-gray-500 font-bold"><Filter size={12} className="inline ml-1" /> الفلاتر تُطبَّق تلقائياً</p>
        </div>
      </div>

      {/* Table */}
      <SectionCard
        title="قائمة العمليات"
        subtitle={isFetching ? 'جارٍ التحديث...' : `${total.toLocaleString('en-US')} عملية`}
        icon={CreditCard}
        accent="emerald"
        actions={
          <button onClick={() => refetch()} disabled={isFetching}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition disabled:opacity-50">
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} /> تحديث
          </button>
        }
        noBodyPad
      >
        {isLoading ? (
          <div className="text-center py-16"><RefreshCw className="w-10 h-10 text-emerald-400 animate-spin mx-auto mb-4" /><p className="text-sm font-bold text-gray-500">جارٍ تحميل العمليات...</p></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16"><Users className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-sm font-bold text-gray-500">لا توجد عمليات مطابقة للفلاتر</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" dir="ltr">
              <thead className="bg-gradient-to-b from-gray-50 to-white border-b-2 border-gray-200">
                <tr className="text-xs text-gray-700 font-black uppercase tracking-wider">
                  <th className="px-3 py-3 text-left">Code</th>
                  <th className="px-3 py-3 text-left">Date</th>
                  <th className="px-3 py-3 text-left">Client</th>
                  <th className="px-3 py-3 text-left">Phone</th>
                  <th className="px-3 py-3 text-left">Course</th>
                  <th className="px-3 py-3 text-right">Price</th>
                  <th className="px-3 py-3 text-left">Months</th>
                  <th className="px-3 py-3 text-left">Payment</th>
                  <th className="px-3 py-3 text-left">Paid</th>
                  <th className="px-3 py-3 text-left">Agent</th>
                  <th className="px-3 py-3 text-left">Dept</th>
                  <th className="px-3 py-3 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-emerald-50/40 transition">
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-700">{r.code || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{r.entry_date || '—'}</td>
                    <td className="px-3 py-2.5 font-bold text-gray-900">{r.client_name || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{r.mobile_no || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-700">{r.courses || '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-700">{fmtAmount(r.price)}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">{r.months || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">{r.payment_way || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">{r.paid_status || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-700">{r.agent_name || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-700">{r.department || '—'}</td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      <button onClick={() => openEdit(r.id)} className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-lg transition" title="تعديل"><Pencil size={15} /></button>
                      <button onClick={() => setDeleteRow(r)} className="p-1.5 text-rose-600 hover:bg-rose-100 rounded-lg transition" title="حذف"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Pagination page={filters.page} pages={pages} total={total} onPageChange={(p) => setFilters(f => ({ ...f, page: p }))} />
      </>
      )}

      <SaleFormModal
        open={formOpen}
        editId={editId}
        options={options}
        onClose={() => setFormOpen(false)}
        onSaved={afterMutate}
      />
      <DeleteConfirm row={deleteRow} onClose={() => setDeleteRow(null)} onDeleted={afterMutate} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={afterMutate} />
    </div>
  );
}
