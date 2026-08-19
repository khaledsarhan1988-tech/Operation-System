import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Receipt, Search, Save, RefreshCw, CheckCircle, AlertTriangle, Trash2, Pencil, Plus, UserPlus } from 'lucide-react';
import api from '../../api/axios';
import SectionCard from '../../components/ui/SectionCard';

// «حركة الإيصالات» — log a payment receipt; saving ALSO creates/updates a linked
// operation in قائمة العمليات (and a Clients-Codes entry for a new client). Owner + Finance.
const num = (v) => Number(String(v ?? '').replace(/,/g, '')) || 0;
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const fmt = (x) => r2(x).toLocaleString('en-US', { maximumFractionDigits: 2 });
function discountAmt(d, price) {
  const s = String(d ?? '').trim();
  if (!s) return 0;
  if (s.endsWith('%')) { const p = parseFloat(s.slice(0, -1)); return isFinite(p) ? (Number(price) || 0) * p / 100 : 0; }
  const a = parseFloat(s.replace(/,/g, '')); return isFinite(a) ? Math.abs(a) : 0;
}
const RECEIVER_CHANNELS = ['1012164464', '1281429649', '1012164327', '1015048618', '1015082452', '1094172559', '1016738176', '1012164368', '1040247384', '1040254359', 'Paytaps', 'CiB', 'QNB-USD'];
const STATUS_OPTS = ['', 'Approved', 'Pending', 'Rejected'];
const DONE_OPTS = ['', 'Done'];
const FW_OPTS = ['', 'Transfer'];
const EMPTY = {
  date: '', code: '', client_name: '', mobile_no: '', mobile_no2: '', client_wallet: '',
  receiver_channel: '', amount: '', timing: '', courses: '', price: '', discount: '',
  status: '', photo: '', tamkeen: '', operation_sys: '', system_status: '', financial_wallet: '',
  lectures_count: '',
};
// «Lecture(s)» = extra-lectures membership: variable price + a requested lecture
// count. Matches any code starting with "lecture" (singular or plural).
const isLectures = (c) => String(c || '').trim().toLowerCase().startsWith('lecture');
// Row flagged (light red) when it still needs follow-up: Status blank/Pending, or
// any of Photo/Tamkeen/System/Financial Wallet not filled.
const isBlank = (v) => v == null || String(v).trim() === '';
const rowNeedsAttention = (rw) =>
  isBlank(rw.status) || rw.status === 'Pending' ||
  isBlank(rw.photo) || isBlank(rw.tamkeen) || isBlank(rw.system_status) || isBlank(rw.financial_wallet);
const isoToMdy = (iso) => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${+m[2]}/${+m[3]}/${m[1]}` : iso; };
const mdyToIso = (s) => { const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}` : ''; };

function Field({ label, span, children }) {
  return (
    <div className={span === 2 ? 'sm:col-span-2' : ''}>
      <label className="block text-[11px] font-bold text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400';

// Inline-editable free-text cell (used for الوقت) — local state so typing is smooth,
// saves on blur/Enter only when the value actually changed.
function TimeCell({ value, onSave }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  return (
    <input value={v} onChange={(e) => setV(e.target.value)}
      onBlur={() => { if ((v || '') !== (value || '')) onSave(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      placeholder="—"
      className="w-full min-w-[80px] px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400" />
  );
}

export default function ReceiptsSection() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...EMPTY });
  const [isNew, setIsNew] = useState(false);      // new client → will create a code
  const [editId, setEditId] = useState(null);
  const reqIdRef = useRef(globalThis.crypto?.randomUUID?.() || `rcpt-${Math.random().toString(36).slice(2)}`);
  const topRef = useRef(null); // scroll target so editing a row brings the form into view
  const [codeFocus, setCodeFocus] = useState(false);
  const [phoneWarn, setPhoneWarn] = useState('');
  const [q, setQ] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Membership catalog → course dropdown + auto price (Ahmed Hassan list price).
  const { data: memData } = useQuery({ queryKey: ['membership-prices', 'all'], queryFn: () => api.get('/membership-prices/list').then(r => r.data), staleTime: 5 * 60 * 1000 });
  const memberships = memData?.rows || [];
  const courseOptions = memberships.map(m => m.code);
  const priceOf = (code) => { const m = memberships.find(x => x.code === code); return m && m.price_ahmed_hassan != null ? m.price_ahmed_hassan : null; };

  // Client autocomplete (existing clients — search by code/name/either phone).
  const { data: codeSug } = useQuery({
    queryKey: ['client-codes', 'rcpt-search', form.code],
    queryFn: () => api.get('/client-codes/list', { params: { q: form.code, limit: 8 } }).then(r => r.data),
    enabled: !isNew && String(form.code || '').trim().length >= 1,
    keepPreviousData: true,
  });
  const codeMatches = codeSug?.rows || [];

  // Next code for a NEW client.
  const { data: nextData } = useQuery({ queryKey: ['client-codes', 'next'], queryFn: () => api.get('/client-codes/next-code').then(r => r.data), enabled: isNew, staleTime: 0 });

  const startNewClient = () => {
    setIsNew(true);
    // Editing a code-less temp receipt → keep the name/phones already typed and just
    // pull a fresh code. Fresh create → clear them for a clean new client.
    const keep = !!editId;
    api.get('/client-codes/next-code')
      .then(r => setForm(f => ({ ...f, code: r.data?.next ?? '', ...(keep ? {} : { client_name: '', mobile_no: '', mobile_no2: '' }) })))
      .catch(() => {});
  };

  const price = num(form.price);
  const balance = r2((price - discountAmt(form.discount, price)) - num(form.amount));

  // Receipts list.
  const { data: listData, isFetching } = useQuery({
    queryKey: ['cs-receipts', 'list', q],
    queryFn: () => api.get('/cs-receipts/list', { params: { q, limit: 50 } }).then(r => r.data),
    keepPreviousData: true,
  });
  const rows = listData?.rows || [];

  const resetForm = () => { setForm({ ...EMPTY }); setIsNew(false); setEditId(null); setPhoneWarn(''); reqIdRef.current = globalThis.crypto?.randomUUID?.() || `rcpt-${Math.random().toString(36).slice(2)}`; save.reset(); };
  const editRow = (rw) => {
    setEditId(rw.id); setIsNew(false); setPhoneWarn('');
    reqIdRef.current = rw.client_request_id || (globalThis.crypto?.randomUUID?.() || `rcpt-${Math.random().toString(36).slice(2)}`);
    setForm({
      date: rw.date || '', code: rw.code || '', client_name: rw.client_name || '', mobile_no: rw.mobile_no || '',
      mobile_no2: rw.mobile_no2 || '', client_wallet: rw.client_wallet || '', receiver_channel: rw.receiver_channel || '',
      amount: rw.amount ?? '', timing: rw.timing || '', courses: rw.courses || '', price: rw.price ?? '', discount: rw.discount || '',
      status: rw.status || '', photo: rw.photo || '', tamkeen: rw.tamkeen || '', operation_sys: rw.operation_sys || '',
      system_status: rw.system_status || '', financial_wallet: rw.financial_wallet || '',
      lectures_count: rw.lectures_count ?? '',
    });
    save.reset();
    setTimeout(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const lastConfirmRef = useRef(false); // remembers مؤقت vs نهائي for the dup-phone retry
  const save = useMutation({
    mutationFn: ({ confirm, force }) => { lastConfirmRef.current = confirm; return api.post('/cs-receipts', { ...form, is_new_client: isNew, client_request_id: reqIdRef.current, confirm, force }).then(r => r.data); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cs-receipts'] });
      qc.invalidateQueries({ queryKey: ['cs-sales'] });
      setPhoneWarn('');
      setTimeout(resetForm, 1200);
    },
    onError: (err) => { const d = err?.response?.data; if (d?.code === 'DUP_PHONE') setPhoneWarn(d.error || 'الموبايل مكرر'); },
  });
  const del = useMutation({ mutationFn: (id) => api.delete(`/cs-receipts/${id}`).then(r => r.data), onSuccess: () => qc.invalidateQueries({ queryKey: ['cs-receipts'] }) });
  // Confirm a receipt straight from the list (save icon) → creates the operation.
  const [confirmingId, setConfirmingId] = useState(null);
  const confirmRow = useMutation({
    mutationFn: (rw) => api.post('/cs-receipts', { ...rw, is_new_client: false, confirm: true, force: true, client_request_id: rw.client_request_id }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cs-receipts'] }); qc.invalidateQueries({ queryKey: ['cs-sales'] }); },
    onSettled: () => setConfirmingId(null),
  });
  // Inline edit of a tracking flag straight from the list (two-option dropdowns) —
  // updates ONLY that flag, never the money or the linked operation.
  const patchField = useMutation({
    mutationFn: ({ id, field, value }) => api.patch(`/cs-receipts/${id}/field`, { field, value }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cs-receipts'] }),
  });
  const cellSelect = (rw, field, opts) => (
    <select value={rw[field] || ''} onChange={(e) => patchField.mutate({ id: rw.id, field, value: e.target.value })}
      className="w-full min-w-[96px] px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400">
      {opts.map(o => <option key={o} value={o}>{o || '—'}</option>)}
    </select>
  );

  return (
    <div className="space-y-4" dir="rtl">
      <div ref={topRef} />
      <SectionCard title={editId ? 'تعديل إيصال' : 'حركة الإيصالات — تسجيل إيصال'} icon={Receipt} accent="teal"
        actions={editId ? <button onClick={resetForm} className="text-xs font-bold text-teal-700 inline-flex items-center gap-1"><Plus size={14} /> إيصال جديد</button> : null}>
        {/* Client */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <label className="block text-[11px] font-bold text-gray-500 mb-1">الكود (Code) — ابحث أو {isNew ? 'كود جديد تلقائي' : 'اختر عميل قديم'}</label>
            <input type="text" value={form.code ?? ''} onChange={(e) => set('code', e.target.value)} readOnly={isNew}
              onFocus={() => setCodeFocus(true)} onBlur={() => setTimeout(() => setCodeFocus(false), 150)} autoComplete="off"
              className={`${inputCls} ${isNew ? 'bg-gray-100 font-bold' : ''}`} />
            {!isNew && codeFocus && codeMatches.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-auto">
                {codeMatches.map((c) => (
                  <button type="button" key={c.id} onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setForm(f => ({ ...f, code: c.code, client_name: c.client_name || '', mobile_no: c.mobile_no || '', mobile_no2: c.mobile_no2 || '' })); setCodeFocus(false); }}
                    className="block w-full text-right px-3 py-2 hover:bg-teal-50 text-sm border-b border-gray-50 last:border-0">
                    <span className="font-black text-gray-800 font-mono">{c.code}</span>
                    <span className="text-gray-600"> — {c.client_name || '—'}</span>
                    {c.mobile_no ? <span className="text-gray-400 text-xs"> · {c.mobile_no}</span> : null}
                    {c.mobile_no2 ? <span className="text-gray-400 text-xs"> · {c.mobile_no2}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Field label="اسم العميل"><input value={form.client_name} onChange={(e) => set('client_name', e.target.value)} className={inputCls} /></Field>
          <Field label="موبايل العميل"><input value={form.mobile_no} onChange={(e) => set('mobile_no', e.target.value)} className={inputCls} /></Field>
          <Field label="موبايل إضافي"><input value={form.mobile_no2} onChange={(e) => set('mobile_no2', e.target.value)} className={inputCls} /></Field>
        </div>
        {(!editId || !form.code) && (
          <div className="mt-2">
            {isNew ? (
              <button type="button" onClick={() => { setIsNew(false); setForm(f => ({ ...f, code: '' })); }} className="text-xs font-bold text-gray-500">↩ رجوع لاختيار عميل قديم</button>
            ) : (
              <button type="button" onClick={startNewClient} className="inline-flex items-center gap-1 text-xs font-black text-teal-700"><UserPlus size={14} /> عميل جديد (كود جديد تلقائي)</button>
            )}
          </div>
        )}

        {/* Transfer + membership */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <Field label="المبلغ"><input type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} className={inputCls} /></Field>
          <Field label="محفظة العميل (Wallet)"><input value={form.client_wallet} onChange={(e) => set('client_wallet', e.target.value)} className={inputCls} /></Field>
          <Field label="قناة الاستلام / محفظة المستلم">
            <select value={form.receiver_channel} onChange={(e) => set('receiver_channel', e.target.value)} className={inputCls}>
              <option value="">— اختر —</option>
              {RECEIVER_CHANNELS.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="التوقيت"><input value={form.timing} onChange={(e) => set('timing', e.target.value)} placeholder="11:25 PM" className={inputCls} /></Field>
          <Field label="التاريخ"><input type="date" value={mdyToIso(form.date)} onChange={(e) => set('date', e.target.value ? isoToMdy(e.target.value) : '')} className={inputCls} /></Field>
          <Field label="العضوية (Courses)">
            <select value={form.courses} onChange={(e) => { const v = e.target.value; setForm(f => { const p = priceOf(v); return { ...f, courses: v, price: p == null ? f.price : String(p) }; }); }} className={inputCls}>
              <option value="">— اختر —</option>
              {(form.courses && !courseOptions.includes(form.courses) ? [form.courses, ...courseOptions] : courseOptions).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="السعر"><input type="number" value={form.price} onChange={(e) => set('price', e.target.value)} className={inputCls} /></Field>
          <Field label="الخصم (مبلغ أو %)"><input value={form.discount} onChange={(e) => set('discount', e.target.value)} placeholder="1000 أو 10%" className={inputCls} /></Field>
          {isLectures(form.courses) && (
            <Field label="عدد المحاضرات"><input type="number" min="0" value={form.lectures_count} onChange={(e) => set('lectures_count', e.target.value)} placeholder="عدد المحاضرات المطلوبة" className={inputCls} /></Field>
          )}
        </div>

        {/* Statuses */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-3">
          <Field label="Status"><select value={form.status} onChange={(e) => set('status', e.target.value)} className={inputCls}>{STATUS_OPTS.map(o => <option key={o} value={o}>{o || '—'}</option>)}</select></Field>
          <Field label="Photo"><select value={form.photo} onChange={(e) => set('photo', e.target.value)} className={inputCls}>{DONE_OPTS.map(o => <option key={o} value={o}>{o || '—'}</option>)}</select></Field>
          <Field label="Tamkeen"><select value={form.tamkeen} onChange={(e) => set('tamkeen', e.target.value)} className={inputCls}>{DONE_OPTS.map(o => <option key={o} value={o}>{o || '—'}</option>)}</select></Field>
          <Field label="Operation Sys"><select value={form.operation_sys} onChange={(e) => set('operation_sys', e.target.value)} className={inputCls}>{DONE_OPTS.map(o => <option key={o} value={o}>{o || '—'}</option>)}</select></Field>
          <Field label="System"><select value={form.system_status} onChange={(e) => set('system_status', e.target.value)} className={inputCls}>{DONE_OPTS.map(o => <option key={o} value={o}>{o || '—'}</option>)}</select></Field>
          <Field label="Financial Wallet"><select value={form.financial_wallet} onChange={(e) => set('financial_wallet', e.target.value)} className={inputCls}>{FW_OPTS.map(o => <option key={o} value={o}>{o || '—'}</option>)}</select></Field>
        </div>

        {/* Balance + save */}
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <div className="text-sm font-bold text-gray-600">الرصيد المتبقي للعملية: <span className={balance > 0 ? 'text-rose-600' : 'text-emerald-700'}>{fmt(balance)}</span></div>
          {/* Temp save — receipt only, NO operation yet. Works even with no client code
              (money on the wallet before the client's data arrives); needs amount/wallet. */}
          <button type="button" onClick={() => save.mutate({ confirm: false, force: false })}
            disabled={save.isPending || (!form.code && !num(form.amount) && !form.client_wallet && !form.receiver_channel)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 transition disabled:opacity-50">
            {save.isPending ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />} حفظ مؤقت (بدون عملية)
          </button>
          {/* Final — receipt + creates the operation in قائمة العمليات */}
          <button type="button" onClick={() => save.mutate({ confirm: true, force: false })} disabled={save.isPending || !form.code}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black text-white bg-teal-600 hover:bg-teal-700 transition disabled:opacity-50">
            {save.isPending ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle size={16} />} حفظ الإيصال (يعمل العملية)
          </button>
          {save.isSuccess && <span className="inline-flex items-center gap-1 text-sm font-bold text-emerald-700"><CheckCircle size={16} /> {lastConfirmRef.current ? 'اتسجّل الإيصال + العملية' : 'اتحفظ مؤقت (بدون عملية)'}</span>}
          {save.isError && !phoneWarn && <span className="inline-flex items-center gap-1 text-sm font-bold text-rose-700"><AlertTriangle size={16} /> {save.error?.response?.data?.error || 'فشل الحفظ'}</span>}
        </div>
        {phoneWarn && (
          <div className="mt-3 bg-amber-50 border-2 border-amber-200 rounded-2xl p-3 text-sm font-bold text-amber-800">
            <div className="flex items-center gap-2 mb-2"><AlertTriangle size={16} /> {phoneWarn}</div>
            <button onClick={() => save.mutate({ confirm: lastConfirmRef.current, force: true })} disabled={save.isPending} className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-black text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition disabled:opacity-50">تأكيد رغم التكرار</button>
          </div>
        )}
      </SectionCard>

      {/* Receipts list */}
      <SectionCard title="الإيصالات المسجّلة" icon={Receipt} accent="cyan">
        <div className="relative mb-3">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم / الكود / الموبايل / المحفظة" className={`${inputCls} pr-9`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1300px]">
            <thead className="text-gray-500 border-b">
              <tr>
                {['التاريخ', 'الوقت', 'الكود', 'العميل', 'موبايل العميل', 'محفظة العميل', 'المبلغ', 'العضوية', 'قناة الاستلام', 'Status', 'Photo', 'Tamkeen', 'System', 'Financial Wallet', 'الحالة', ''].map(h => <th key={h} className="text-right font-bold py-2 px-3 whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {isFetching && !rows.length ? (
                <tr><td colSpan={16} className="py-4 text-center text-gray-400">جارٍ التحميل…</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={16} className="py-4 text-center text-gray-400">لا توجد إيصالات</td></tr>
              ) : rows.map(rw => (
                <tr key={rw.id} className={`border-b border-gray-50 ${rowNeedsAttention(rw) ? 'bg-rose-50 hover:bg-rose-100' : 'hover:bg-gray-50'}`}>
                  <td className="py-2 px-3 text-xs text-gray-600 whitespace-nowrap">{rw.date || '—'}</td>
                  <td className="py-2 px-3 whitespace-nowrap"><TimeCell value={rw.timing} onSave={(v) => patchField.mutate({ id: rw.id, field: 'timing', value: v })} /></td>
                  <td className="py-2 px-3 font-mono font-bold">
                    <button type="button" onClick={() => editRow(rw)} className="text-teal-700 hover:text-teal-900 hover:underline" title="فتح تعديل الإيصال">{rw.code || '—'}</button>
                  </td>
                  <td className="py-2 px-3">{rw.client_name || '—'}</td>
                  <td className="py-2 px-3 font-mono text-xs text-gray-600">{rw.mobile_no || '—'}</td>
                  <td className="py-2 px-3 font-mono text-xs text-gray-600">{rw.client_wallet || '—'}</td>
                  <td className="py-2 px-3 font-bold text-teal-700">{fmt(rw.amount)}</td>
                  <td className="py-2 px-3 text-xs whitespace-nowrap">{rw.courses || '—'}{isLectures(rw.courses) && rw.lectures_count != null && rw.lectures_count !== '' ? <span className="text-indigo-600 font-bold"> ({rw.lectures_count} محاضرة)</span> : null}</td>
                  <td className="py-2 px-3">{cellSelect(rw, 'receiver_channel', ['', ...RECEIVER_CHANNELS])}</td>
                  <td className="py-2 px-3">{cellSelect(rw, 'status', STATUS_OPTS)}</td>
                  <td className="py-2 px-3">{cellSelect(rw, 'photo', DONE_OPTS)}</td>
                  <td className="py-2 px-3">{cellSelect(rw, 'tamkeen', DONE_OPTS)}</td>
                  <td className="py-2 px-3">{cellSelect(rw, 'system_status', DONE_OPTS)}</td>
                  <td className="py-2 px-3">{cellSelect(rw, 'financial_wallet', FW_OPTS)}</td>
                  <td className="py-2 px-3">
                    {rw.sale_id
                      ? <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-100 text-emerald-700">مسجّل في العمليات</span>
                      : <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-amber-100 text-amber-700">مؤقت</span>}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {!rw.sale_id && (
                      <button onClick={() => { setConfirmingId(rw.id); confirmRow.mutate(rw); }} disabled={confirmingId === rw.id || !rw.code}
                        className="p-1.5 text-teal-600 hover:bg-teal-100 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                        title={rw.code ? 'حفظ الإيصال (يعمل العملية)' : 'محتاج كود العميل الأول — عدّل الإيصال وأضف بياناته'}>
                        {confirmingId === rw.id ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
                      </button>
                    )}
                    <button onClick={() => editRow(rw)} className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-lg" title="تعديل"><Pencil size={15} /></button>
                    <button onClick={() => { if (window.confirm('حذف الإيصال؟ (العملية في قائمة العمليات مش هتتمسح)')) del.mutate(rw.id); }} className="p-1.5 text-rose-600 hover:bg-rose-100 rounded-lg" title="حذف"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
