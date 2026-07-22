import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, Search, Calendar, Filter, X, ChevronLeft, ChevronRight,
  Eye, RefreshCw, Plus, Pencil, Trash2, Save, CreditCard, Hash,
  AlertTriangle, DollarSign, Upload, CheckCircle, Tag, RotateCcw,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import MembershipPricesSection from './MembershipPricesSection';
import ClientCodesSection from './ClientCodesSection';
import RefundCalculatorSection, { RefundReviewModal } from './RefundCalculatorSection';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function fmtAmount(amount) {
  if (amount == null || amount === '') return '—';
  const n = Number(amount);
  if (isNaN(n)) return amount;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Empty form — keys MUST match backend SALE_FIELDS. Some fields carry common
// DEFAULTS for new operations (the user can change them from the dropdown);
// these defaults are NOT applied on edit (edit shows the row's actual values).
const EMPTY_FORM = {
  code: '', entry_date: '', client_name: '', mobile_no: '', agent_name: '',
  department: 'Sales', courses: '', price: '', months: '', payment_way: 'Cash',
  paid_status: 'Paid', pages: 'Ahmed Hassan', shift: 'No Different', groups: 'Groups', total_price: '',
  total_paid_same_month: '', discount: '', chrismss_discount_ah: '',
  chrismss_discount_dar: '', offer_individual: '', refund_deduction: '',
  khaled_deduction: '', new_prices: '', new_courses: '', balance: '', noted1: '',
  noted2: '', tamkeen: '', installment_date: '', note: '',
  op_type: '', transfer_consumed_levels: '', transfer_total_levels: '',
  transfer_from_phone: '', transfer_from_code: '', refund_details: '',
  transfer_consumed_value: '',
};
// Parse the level count from a course code: "6L GAC" → 6, "3L PAC 2P" → 3.
function parseLevels(code) {
  const m = String(code ?? '').match(/(\d+)\s*L\b/i);
  return m ? Number(m[1]) : 0;
}
// Dates are stored as "M/D/YYYY" (the sheet format). A <input type="date"> needs
// ISO "YYYY-MM-DD" — convert both ways so the stored format stays unchanged.
function toISODate(s) {
  const v = String(s ?? '').trim();
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}
function fromISODate(iso) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : (iso || '');
}
const EMPTY_INST = { sales_man: '', department: '', months: '', paid_or_not: '', amount: '', pay_date: '', note: '' };

// Fixed controlled vocabularies (mirror the backend normalizer). Using <select>
// for these two makes it impossible to re-introduce spelling/case variants.
// "Daradasha AUE" is a DISTINCT brand from "Dardasha" (owner decision).
const BRANDS = ['Ahmed Hassan', 'Dardasha', 'Go English', 'Work Shop Offline', 'Daradasha AUE'];
const PAID_STATUSES = ['Paid', 'Not Paid', 'Fake'];

// Discount accepts either a percentage ("10%") → computed off the membership
// price, or a plain amount ("1000"). Returns the discount AMOUNT in pounds.
function discountAmount(discountStr, price) {
  const s = String(discountStr ?? '').trim();
  if (s === '') return 0;
  if (s.endsWith('%')) {
    const pct = parseFloat(s.slice(0, -1).trim());
    return isFinite(pct) ? (Number(price) || 0) * pct / 100 : 0;
  }
  const amt = parseFloat(s.replace(/,/g, ''));
  return isFinite(amt) ? amt : 0;
}

// Totals logic (owner spec).
//   The membership is whatever the customer ended up on: a normal row uses
//   `courses`/`price`; an UPGRADE row uses the NEW membership (`new_courses`/
//   `new_prices`) — the original course is just kept as "started with".
//   ALL the customer's money counts toward the membership:
//     total paid = first payment (total_paid_same_month) + every installment.
//   The first/same-month payment is ALWAYS separate from the installment blocks
//   (the sheet stores it in its own column), so it must be ADDED, not replaced.
//   balance = (effective price − discount) − total paid.
//   Discount is offer_individual on upgrades (e.g. migrated "-250"), else the
//   `discount` field; either may be a % of the price or a plain amount; only
//   its magnitude matters.
// mode: 'normal' | 'upgrade' | 'transfer'.
//   transfer = membership swap with credit for the UNUSED part of the old one:
//     consumed value = old paid × (consumed levels / total levels)
//     credit         = old paid − consumed value
//     required diff  = new price − credit
//     balance        = required diff − (paid + installments)   (0 when fully paid)
function calcPaidBalance(form, installments, mode = 'normal') {
  const isUpgrade = mode === 'upgrade';
  const isTransfer = mode === 'transfer';
  const hasInst = installments.some(i => i.amount !== '' && i.amount != null);
  const instSum = installments.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const manual = (form.total_paid_same_month === '' || form.total_paid_same_month == null)
    ? null : Number(form.total_paid_same_month);
  const subPrice = Number(form.price) || 0;
  const newPrice = Number(String(form.new_prices ?? '').replace(/,/g, '')) || 0;
  const totalPaid = (manual || 0) + instSum;

  if (isTransfer) {
    // Model 2 — the installments are the FULL payment ledger (old + new payments).
    // `price` (المدفوع في القديمة) is the OLD membership price, used ONLY to value
    // the consumed level. That consumed value is a loss deducted from everything
    // the client paid:   balance = newPrice − (allPaid − consumedValue).
    // (We do NOT also add `price` back as credit — that would double-count the old
    //  payments, which now live in the installments.)
    const oldPrice = subPrice;
    // Consumed value: the auto formula, UNLESS the owner typed an override (e.g. a
    // credit quoted on the list price while the client paid a discounted amount).
    const consumedValue = consumedValueOf(form);
    const credit = oldPrice - consumedValue;       // value carried from the old membership (informational)
    const required = newPrice - credit;            // new money still required (informational)
    const balance = Math.round((newPrice - (totalPaid - consumedValue)) * 100) / 100;
    return { hasInst, instSum, manual: manual || 0, effPrice: newPrice, discount: 0,
             consumedValue, credit, required, totalPaid, balance };
  }

  const effPrice = isUpgrade ? newPrice : subPrice;
  const discount = Math.abs(discountAmount(isUpgrade ? form.offer_individual : form.discount, effPrice));
  const balance = (effPrice - discount) - totalPaid;
  return { hasInst, instSum, manual: manual || 0, effPrice, discount, totalPaid, balance };
}

// The AUTO consumed-level value for a transfer: old paid × consumed ÷ total levels.
function autoConsumedValue(form) {
  const oldPrice = Number(form.price) || 0;
  const totalLevels = Number(form.transfer_total_levels) || 0;
  const consumedLevels = Number(form.transfer_consumed_levels) || 0;
  return totalLevels > 0 ? Math.round((oldPrice * consumedLevels / totalLevels) * 100) / 100 : 0;
}
// The consumed value actually USED: the owner's manual override when present,
// otherwise the auto formula. The override exists because a credit is sometimes
// quoted on the LIST price while the client paid a discounted amount — e.g. paid
// 8550, credit promised 6000 ⇒ the consumed month is worth 2550, not 8550÷3.
// NOTE: the old "auto-fill the direct payment so the balance is 0" helper was
// REMOVED — it overwrote the real amount paid and hid a client's leftover credit.
function consumedValueOf(form) {
  const ov = form.transfer_consumed_value;
  if (ov !== '' && ov != null) return Math.round((Number(ov) || 0) * 100) / 100;
  return autoConsumedValue(form);
}

// ─── FORM MODAL (create / edit) ───────────────────────────────────────────────
function SaleFormModal({ open, editId, options, onClose, onSaved }) {
  const isEdit = !!editId;
  const [form, setForm] = useState(EMPTY_FORM);
  const [installments, setInstallments] = useState([]);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('normal'); // 'normal' | 'upgrade' | 'transfer' | 'client_transfer'
  const isUpgrade = mode === 'upgrade';
  const isTransfer = mode === 'transfer';
  const isClientTransfer = mode === 'client_transfer'; // نقل لعميل آخر (cross-client)

  // Load the row being edited. refetchOnWindowFocus is OFF so switching windows
  // (e.g. to screenshot) does NOT refetch and clobber in-progress edits.
  const { data: rowData, isLoading: loadingRow } = useQuery({
    queryKey: ['cs-sales', 'one', editId],
    queryFn: () => api.get(`/cs-sales-register/${editId}`).then(r => r.data),
    enabled: open && isEdit,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Populate the form EXACTLY ONCE per open (per editId). Critical: a background
  // refetch must never overwrite what the user is typing — so once we've seeded
  // the form from the server we never re-seed it until the modal is reopened.
  const seededFor = useRef(null);
  // Idempotency key for a NEW operation — generated ONCE per open and re-sent on
  // every retry, so a save that silently committed during a gateway 502 can't be
  // duplicated by the user clicking save again. Reset when the modal closes.
  const reqIdRef = useRef(null);
  useEffect(() => {
    if (!open) { seededFor.current = null; reqIdRef.current = null; return; } // reset when modal closes
    const target = isEdit ? editId : 'new';
    if (seededFor.current === target) return;          // already seeded this open
    if (isEdit) {
      if (!rowData) return; // wait for the first fetch
      const s = rowData.sale || {};
      setForm({ ...EMPTY_FORM, ...Object.fromEntries(Object.keys(EMPTY_FORM).map(k => [k, s[k] ?? ''])) });
      let insts = (rowData.installments || []).map(i => ({
        sales_man: i.sales_man ?? '', department: i.department ?? '', months: i.months ?? '',
        paid_or_not: i.paid_or_not ?? '', amount: i.amount ?? '', pay_date: i.pay_date ?? '',
        note: i.note ?? '',
      }));
      // Migrated rows kept the payment date on the parent (installment_date) while
      // the installment's own date was blank → lift it onto the first installment.
      // (Skip for transfers — there installment_date IS the transfer date.)
      if ((s.op_type || '').toLowerCase() !== 'transfer'
          && s.installment_date && insts.length && !insts.some(i => i.pay_date)) {
        insts = insts.map((it, idx) => idx === 0 ? { ...it, pay_date: s.installment_date } : it);
      }
      setInstallments(insts);
      // Determine mode: op_type wins; else infer upgrade from new_courses/noted2.
      const op = (s.op_type || '').toLowerCase();
      if (op === 'client_transfer') setMode('client_transfer');
      else if (op === 'transfer') setMode('transfer');
      else if (op === 'upgrade') setMode('upgrade');
      else if ((s.new_courses && String(s.new_courses).trim()) || (s.noted2 || '') === 'Upgraded') setMode('upgrade');
      else setMode('normal');
      seededFor.current = target;
    } else {
      setForm(EMPTY_FORM); setInstallments([]); setError(''); setMode('normal');
      reqIdRef.current = (globalThis.crypto?.randomUUID?.() || `req-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      seededFor.current = target;
    }
  }, [open, isEdit, editId, rowData]);

  const save = useMutation({
    mutationFn: () => {
      // total_paid_same_month is the first/cash payment exactly as typed — keep it
      // as-is (do NOT overwrite). Only the derived balance + op_type are added.
      const { balance } = calcPaidBalance(form, installments, mode);
      const payload = { ...form, balance, op_type: mode === 'normal' ? '' : mode, installments };
      return isEdit
        ? api.put(`/cs-sales-register/${editId}`, payload).then(r => r.data)
        : api.post('/cs-sales-register', { ...payload, client_request_id: reqIdRef.current }).then(r => r.data);
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err) => setError(err?.response?.data?.error || 'فشل الحفظ'),
  });

  // Membership catalog — the Courses field is chosen from these, and selecting
  // one (or changing the brand) auto-fills the price.
  const { data: membershipData } = useQuery({
    queryKey: ['membership-prices', 'all'],
    queryFn: () => api.get('/membership-prices/list').then(r => r.data),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  // Code autocomplete: search the Clients Codes registry by code/name/phone so
  // the user never has to remember a code (and can't mistype one).
  const [codeFocus, setCodeFocus] = useState(false);
  const { data: codeSug } = useQuery({
    queryKey: ['client-codes', 'search', form.code],
    queryFn: () => api.get('/client-codes/list', { params: { q: form.code, limit: 8 } }).then(r => r.data),
    enabled: open && String(form.code || '').trim().length >= 1,
    keepPreviousData: true,
  });
  const codeMatches = codeSug?.rows || [];

  // Sender autocomplete for «نقل لعميل آخر» — pick the SENDING client so their real
  // phone (which drives the deliveries sender-cap) is filled exactly, never mistyped.
  const [fromFocus, setFromFocus] = useState(false);
  const { data: fromSug } = useQuery({
    queryKey: ['client-codes', 'from-search', form.transfer_from_code],
    queryFn: () => api.get('/client-codes/list', { params: { q: form.transfer_from_code, limit: 8 } }).then(r => r.data),
    enabled: open && isClientTransfer && String(form.transfer_from_code || '').trim().length >= 1,
    keepPreviousData: true,
  });
  const fromMatches = fromSug?.rows || [];

  if (!open) return null;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  // In transfer mode, keep the direct payment = required − installments so the
  // balance stays 0 and installments are never double-counted.
  const setInst = (idx, k, v) => setInstallments(list => list.map((it, i) => i === idx ? { ...it, [k]: v } : it));
  const addInst = () => setInstallments(list => [...list, { ...EMPTY_INST }]);
  const rmInst = (idx) => setInstallments(list => list.filter((_, i) => i !== idx));

  const opt = (k) => options?.[k] || [];

  // ── Courses dropdown + auto-price from the membership catalog ──────────────
  const memberships = membershipData?.rows || [];
  const mmap = {};
  for (const m of memberships) mmap[m.code] = m;
  const membershipCodes = memberships.map(m => m.code);
  // Keep the row's existing course selectable even if it's not a membership
  // (e.g. an older operation whose code was pruned) — never silently drop it.
  const courseOptions = (form.courses && !membershipCodes.includes(form.courses))
    ? [form.courses, ...membershipCodes]
    : membershipCodes;

  // Price column by brand: Ahmed Hassan → AH; Dardasha & Daradasha AUE → Dardasha.
  // Other brands (Go English / Work Shop / empty) → manual (apply:false).
  const priceFor = (code, brand) => {
    const m = mmap[code];
    if (!m) return { apply: false };
    if (brand === 'Ahmed Hassan') return { apply: true, value: m.price_ahmed_hassan };
    if (brand === 'Dardasha' || brand === 'Daradasha AUE') return { apply: true, value: m.price_dardasha };
    return { apply: false };
  };
  const applyCourse = (v) => setForm(f => {
    const next = { ...f, courses: v };
    const r = priceFor(v, f.pages);
    if (r.apply) next.price = r.value == null ? '' : String(r.value);
    return next;
  });
  const applyPages = (v) => setForm(f => {
    const next = { ...f, pages: v };
    const r = priceFor(f.courses, v);
    if (r.apply) next.price = r.value == null ? '' : String(r.value);
    return next;
  });
  // Picking the operation date auto-fills "الشهر (Months)" as YY-Mon (e.g. 26-Jun).
  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const applyEntryDate = (v) => setForm(f => {
    const next = { ...f, entry_date: v };
    const m = String(v || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) next.months = `${String(m[3]).slice(-2)}-${MONTH_ABBR[Number(m[1]) - 1]}`;
    return next;
  });
  // New (upgrade) course → auto-fill the new price from the membership catalog.
  const applyNewCourse = (v) => setForm(f => {
    const next = { ...f, new_courses: v };
    const r = priceFor(v, f.pages);
    if (r.apply) next.new_prices = r.value == null ? '' : String(r.value);
    return next;
  });
  const newCourseOptions = (form.new_courses && !membershipCodes.includes(form.new_courses))
    ? [form.new_courses, ...membershipCodes] : membershipCodes;

  // ── Transfer helpers. Changing a transfer input re-syncs the consumed VALUE to
  // its auto formula — unless the owner is editing that value itself, then their
  // override stands. The amount PAID is never auto-written (it must stay the real
  // figure, so a leftover client credit shows as a negative balance).
  const setTr = (patch) => setForm(f => {
    const next = { ...f, ...patch };
    if (!('transfer_consumed_value' in patch)) next.transfer_consumed_value = String(autoConsumedValue(next));
    return next;
  });
  // New membership (transfer): set new_courses + auto new_prices from catalog.
  const applyTransferNewCourse = (v) => setForm(f => {
    const next = { ...f, new_courses: v };
    const r = priceFor(v, f.pages);
    if (r.apply) next.new_prices = r.value == null ? '' : String(r.value);
    return next;
  });
  // Old membership (transfer): set courses + total levels parsed from the code.
  const applyTransferOldCourse = (v) => setForm(f => {
    const next = { ...f, courses: v };
    const lv = parseLevels(v);
    if (lv) next.transfer_total_levels = String(lv);
    const r = priceFor(v, f.pages);
    if (r.apply) next.price = r.value == null ? '' : String(r.value);
    next.transfer_consumed_value = String(autoConsumedValue(next));
    return next;
  });

  // Client-transfer («نقل لعميل آخر») helpers.
  // Old membership (the SENDER's) → auto-fill its total levels from the code.
  const applyClientOldCourse = (v) => setForm(f => {
    const next = { ...f, courses: v };
    const lv = parseLevels(v);
    if (lv) next.transfer_total_levels = String(lv);
    return next;
  });
  // The transfer fee is the ONLY money on this row: it's both the charge (price)
  // and what's paid, so the balance lands on 0 and total-paid = the fee.
  const applyClientFee = (v) => setForm(f => ({ ...f, price: v, total_paid_same_month: v }));

  // Derived paid amount + remaining balance (read-only display).
  const totals = calcPaidBalance(form, installments, mode);

  // Field renderer — `list` enables a datalist (pick existing or type new);
  // `select` (a fixed array) renders a hard <select> instead (no free text).
  // IMPORTANT: call this as a function — {F({...})} — NOT as <F/>. Rendering it
  // as a component would give it a fresh identity each render (it's defined
  // inside SaleFormModal) and remount the input on every keystroke, losing
  // focus. Calling it inlines plain host elements, so focus is preserved.
  const F = ({ k, label, type = 'text', list, select, span = 1, onChange, date }) => {
    const handle = onChange || ((v) => set(k, v));
    return (
    <div className={span === 2 ? 'sm:col-span-2' : span === 4 ? 'sm:col-span-2 lg:col-span-4' : ''}>
      <label className="block text-[11px] font-bold text-gray-500 mb-1">{label}</label>
      {date ? (
        <input
          type="date"
          value={toISODate(form[k])}
          onChange={(e) => handle(e.target.value ? fromISODate(e.target.value) : '')}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
        />
      ) : select ? (
        <select
          value={form[k] ?? ''}
          onChange={(e) => handle(e.target.value)}
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
            onChange={(e) => handle(e.target.value)}
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
  };

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

              <SectionCard
                title="بيانات العملية"
                icon={CreditCard}
                accent="emerald"
                actions={
                  <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
                    {[['normal', 'عادي'], ['upgrade', 'ترقية'], ['transfer', 'تحويل'], ['client_transfer', 'نقل لعميل آخر']].map(([m, lbl]) => (
                      <button key={m} type="button" onClick={() => setMode(m)}
                        className={`px-3 py-1 text-xs font-black rounded-lg transition ${mode === m ? 'bg-emerald-600 text-white shadow' : 'text-gray-600 hover:bg-gray-200'}`}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                }
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Code field with live autocomplete from the Clients Codes registry */}
                  <div className="relative">
                    <label className="block text-[11px] font-bold text-gray-500 mb-1">الكود (Code) — ابحث بالكود/الاسم/الموبايل</label>
                    <input
                      type="text"
                      value={form.code ?? ''}
                      onChange={(e) => set('code', e.target.value)}
                      onFocus={() => setCodeFocus(true)}
                      onBlur={() => setTimeout(() => setCodeFocus(false), 150)}
                      autoComplete="off"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                    />
                    {codeFocus && codeMatches.length > 0 && (
                      <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-auto">
                        {codeMatches.map((c) => (
                          <button
                            type="button"
                            key={c.id}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setForm((f) => ({ ...f, code: c.code, client_name: c.client_name || f.client_name, mobile_no: c.mobile_no || f.mobile_no }));
                              setCodeFocus(false);
                            }}
                            className="block w-full text-right px-3 py-2 hover:bg-sky-50 text-sm border-b border-gray-50 last:border-0"
                          >
                            <span className="font-black text-gray-800 font-mono">{c.code}</span>
                            <span className="text-gray-600"> — {c.client_name || '—'}</span>
                            {c.mobile_no ? <span className="text-gray-400 text-xs"> · {c.mobile_no}</span> : null}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {F({ k: 'entry_date', label: 'التاريخ (Data)', date: true, onChange: applyEntryDate })}
                  {F({ k: 'client_name', label: 'اسم العميل', span: 2 })}
                  {F({ k: 'mobile_no', label: 'الموبايل' })}
                  {F({ k: 'agent_name', label: 'الموظف (Agent)', list: 'agents' })}
                  {F({ k: 'department', label: 'القسم (Department)', list: 'departments' })}
                  {/* Main course/price: transfer & upgrade use the NEW membership;
                      client_transfer = the RECEIVED membership + the transfer fee. */}
                  {isClientTransfer
                    ? F({ k: 'new_courses', label: 'العضوية المنقولة (Courses)', select: newCourseOptions })
                    : isTransfer
                      ? F({ k: 'new_courses', label: 'العضوية الجديدة (Courses)', select: newCourseOptions, onChange: applyTransferNewCourse })
                      : isUpgrade
                        ? F({ k: 'new_courses', label: 'العضوية الحالية (Courses)', select: newCourseOptions, onChange: applyNewCourse })
                        : F({ k: 'courses', label: 'الكورس (Courses)', select: courseOptions, onChange: applyCourse })}
                  {isClientTransfer
                    ? F({ k: 'price', label: 'رسوم النقل (Price)', type: 'number', onChange: applyClientFee })
                    : isTransfer
                      ? F({ k: 'new_prices', label: 'السعر الجديد (Price)', type: 'number', onChange: (v) => setTr({ new_prices: v }) })
                      : isUpgrade
                        ? F({ k: 'new_prices', label: 'السعر (Price)', type: 'number' })
                        : F({ k: 'price', label: 'السعر (Price)', type: 'number' })}
                  {isClientTransfer
                    ? F({ k: 'courses', label: 'العضوية القديمة (المُرسِل)', select: courseOptions, onChange: applyClientOldCourse })
                    : isTransfer
                      ? F({ k: 'courses', label: 'محوّل من (العضوية القديمة)', select: courseOptions, onChange: applyTransferOldCourse })
                      : isUpgrade
                        ? F({ k: 'courses', label: 'بدأ بـ (الكورس الأصلي)', select: courseOptions, onChange: applyCourse })
                        : null}
                  {/* Sender identity (client_transfer): autocomplete fills the sender's real phone */}
                  {isClientTransfer && (
                    <div className="relative">
                      <label className="block text-[11px] font-bold text-gray-500 mb-1">المُرسِل — ابحث بالكود/الاسم/الموبايل</label>
                      <input
                        type="text"
                        value={form.transfer_from_code ?? ''}
                        onChange={(e) => set('transfer_from_code', e.target.value)}
                        onFocus={() => setFromFocus(true)}
                        onBlur={() => setTimeout(() => setFromFocus(false), 150)}
                        autoComplete="off"
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                      />
                      {fromFocus && fromMatches.length > 0 && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-auto">
                          {fromMatches.map((c) => (
                            <button
                              type="button"
                              key={c.id}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setForm((f) => ({ ...f, transfer_from_code: c.code, transfer_from_phone: c.mobile_no || f.transfer_from_phone }));
                                setFromFocus(false);
                              }}
                              className="block w-full text-right px-3 py-2 hover:bg-sky-50 text-sm border-b border-gray-50 last:border-0"
                            >
                              <span className="font-black text-gray-800 font-mono">{c.code}</span>
                              <span className="text-gray-600"> — {c.client_name || '—'}</span>
                              {c.mobile_no ? <span className="text-gray-400 text-xs"> · {c.mobile_no}</span> : null}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {isClientTransfer && F({ k: 'transfer_from_phone', label: 'موبايل المُرسِل (يُملأ تلقائيًا)' })}
                  {isClientTransfer && F({ k: 'installment_date', label: 'تاريخ النقل (Date)', date: true })}
                  {isTransfer && F({ k: 'price', label: 'المدفوع في القديمة', type: 'number', onChange: (v) => setTr({ price: v }) })}
                  {isTransfer && F({ k: 'installment_date', label: 'تاريخ التحويل (Date)', date: true })}
                  {F({ k: 'months', label: 'الشهر (Months)', list: 'months' })}
                  {F({ k: 'payment_way', label: 'طريقة الدفع', list: 'payment_ways' })}
                  {F({ k: 'paid_status', label: 'حالة الدفع', select: PAID_STATUSES })}
                  {F({ k: 'pages', label: 'البراند (Pages)', select: BRANDS, onChange: applyPages })}
                  {F({ k: 'shift', label: 'الفترة (Shift)', list: 'shifts' })}
                  {F({ k: 'groups', label: 'المجموعة (Groups)' })}
                </div>
              </SectionCard>

              <SectionCard title="الإجماليات والخصومات" icon={DollarSign} accent="amber">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {isClientTransfer ? (
                    <>
                      {/* Client transfer: sender's levels → moved to the receiver. The
                          fee is the only money; balance is 0. */}
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 mb-1">إجمالي ليفلات القديمة (تلقائي من الكود)</label>
                        <input type="number" value={form.transfer_total_levels ?? ''}
                          onChange={(e) => set('transfer_total_levels', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 mb-1">عدد الليفلات اللي استهلكها المُرسِل</label>
                        <input type="number" value={form.transfer_consumed_levels ?? ''}
                          onChange={(e) => set('transfer_consumed_levels', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 mb-1">الليفلات المنقولة للمستقبِل — تلقائي</label>
                        <input type="number" readOnly
                          value={Math.max(0, (Number(form.transfer_total_levels) || 0) - (Number(form.transfer_consumed_levels) || 0))}
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-gray-100 text-gray-700 font-bold outline-none" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 mb-1">الرصيد المتبقي — تلقائي</label>
                        <input type="number" readOnly value={Math.round((totals.balance || 0) * 100) / 100}
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-gray-100 text-gray-800 font-bold outline-none" />
                      </div>
                      <div className="sm:col-span-2 lg:col-span-4 text-[11px] text-gray-500 bg-amber-50 rounded-xl p-2">
                        المُرسِل هيظهر في «تسليمات الأقسام» بالليفلات اللي استهلكها بس، والمستقبِل بالليفلات المنقولة. الفلوس = رسوم النقل فقط (قيمة العضوية الأصلية اتسجّلت مرة واحدة على المُرسِل).
                      </div>
                    </>
                  ) : isTransfer ? (
                    <>
                      {/* Transfer: levels consumed + auto credit/required/balance */}
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 mb-1">عدد الليفلات المستهلكة</label>
                        <input type="number" value={form.transfer_consumed_levels ?? ''}
                          onChange={(e) => setTr({ transfer_consumed_levels: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 mb-1">إجمالي ليفلات القديمة (تلقائي من الكود)</label>
                        <input type="number" value={form.transfer_total_levels ?? ''}
                          onChange={(e) => setTr({ transfer_total_levels: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 mb-1">قيمة المستهلَك (تلقائي — تقدر تعدّله)</label>
                        <input type="number" value={form.transfer_consumed_value ?? ''}
                          onChange={(e) => setTr({ transfer_consumed_value: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 mb-1">الرصيد المحوّل — تلقائي</label>
                        <input type="number" readOnly value={Math.round((totals.credit || 0) * 100) / 100}
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-gray-100 text-gray-700 font-bold outline-none" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 mb-1">فرق التحويل المطلوب — تلقائي</label>
                        <input type="number" readOnly value={Math.round((totals.required || 0) * 100) / 100}
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-gray-100 text-gray-700 font-bold outline-none" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 mb-1">مدفوع مباشرة (غير الأقساط)</label>
                        <input type="number" value={form.total_paid_same_month ?? ''}
                          onChange={(e) => set('total_paid_same_month', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 mb-1">إجمالي المدفوع (كل الأقساط + المباشر) — تلقائي</label>
                        <input type="number" readOnly value={Math.round((totals.totalPaid || 0) * 100) / 100}
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-gray-100 text-gray-700 font-bold outline-none" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-bold text-gray-500 mb-1">الرصيد المتبقي — تلقائي</label>
                        <input type="number" readOnly value={Math.round((totals.balance || 0) * 100) / 100}
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-gray-100 text-gray-800 font-bold outline-none" />
                      </div>
                    </>
                  ) : (
                    <>
                  {/* First/cash payment (always editable). It is SEPARATE from the
                      installments — total paid = this + the installments. */}
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 mb-1">
                      {totals.hasInst ? 'المدفوع (الدفعة الأولى)' : 'المبلغ المدفوع من العميل'}
                    </label>
                    <input
                      type="number"
                      value={form.total_paid_same_month ?? ''}
                      onChange={(e) => set('total_paid_same_month', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                    />
                  </div>
                  {/* Total paid (read-only) = first payment + installments — shown when there are installments */}
                  {totals.hasInst && (
                    <div>
                      <label className="block text-[11px] font-bold text-gray-500 mb-1">إجمالي المدفوع (الدفعة الأولى + الأقساط) — تلقائي</label>
                      <input type="number" value={totals.totalPaid} readOnly
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-gray-100 text-gray-700 font-bold outline-none" />
                    </div>
                  )}
                  {/* Discount — offer_individual on an upgrade, else the discount field; % or amount */}
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 mb-1">
                      Discount (مبلغ أو %){totals.discount > 0 ? ` — خصم ${totals.discount.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : ''}
                    </label>
                    <input
                      type="text"
                      value={(isUpgrade ? form.offer_individual : form.discount) ?? ''}
                      onChange={(e) => set(isUpgrade ? 'offer_individual' : 'discount', e.target.value)}
                      placeholder="مثال: 1000 أو 10%"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                    />
                  </div>
                  {/* Balance — auto = (effective price − discount) − total paid (read-only) */}
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 mb-1">Balance (الرصيد المتبقي) — تلقائي</label>
                    <input
                      type="number"
                      value={totals.balance}
                      readOnly
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-gray-100 text-gray-800 font-bold outline-none"
                    />
                  </div>
                    </>
                  )}
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
                            ['sales_man', 'Sales Man', opt('agents')],
                            ['department', 'Department', ['Sales', 'Operation']],
                            ['months', 'Months', opt('months')],
                            ['paid_or_not', 'Paid or Not Paid', ['Paid', 'Not Paid', 'Fake']],
                            ['amount', 'Amount', null, 'number'],
                            ['pay_date', 'Date', null],
                            ['note', 'Note', null],
                          ].map(([k, lbl, sel, typ]) => {
                            const cur = ins[k] ?? '';
                            // keep an existing value selectable even if not in the list
                            const selOpts = sel ? (cur && !sel.includes(cur) ? [cur, ...sel] : sel) : null;
                            return (
                              <div key={k} className={k === 'note' ? 'col-span-2 sm:col-span-4' : ''}>
                                <label className="block text-[10px] font-bold text-gray-500 mb-0.5">{lbl}</label>
                                {selOpts ? (
                                  <select
                                    value={cur}
                                    onChange={(e) => setInst(idx, k, e.target.value)}
                                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-violet-200 outline-none"
                                  >
                                    <option value="">—</option>
                                    {selOpts.map(v => <option key={v} value={v}>{v}</option>)}
                                  </select>
                                ) : k === 'note' ? (
                                  <textarea
                                    rows={1}
                                    value={cur}
                                    ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                                    onChange={(e) => { setInst(idx, k, e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs resize-none overflow-hidden focus:ring-2 focus:ring-violet-200 outline-none"
                                  />
                                ) : k === 'pay_date' ? (
                                  <input
                                    type="date"
                                    value={toISODate(cur)}
                                    onChange={(e) => setInst(idx, k, e.target.value ? fromISODate(e.target.value) : '')}
                                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-violet-200 outline-none"
                                  />
                                ) : (
                                  <input
                                    type={typ || 'text'}
                                    value={cur}
                                    onChange={(e) => setInst(idx, k, e.target.value)}
                                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-violet-200 outline-none"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              <SectionCard title="الحالة والملاحظات" icon={Filter} accent="cyan">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {F({ k: 'noted1', label: 'Noted #1' })}
                  {F({ k: 'noted2', label: 'Noted #2', list: 'noted' })}
                  {F({ k: 'tamkeen', label: 'Tamkeen', list: 'tamkeen' })}
                  {F({ k: 'note', label: 'Note', span: 4 })}
                </div>
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
  const [refundRow, setRefundRow] = useState(null); // opening a saved refund → boxes review
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
    // Invalidate the WHOLE cs-sales cache (list, options, AND the single-row
    // query ['cs-sales','one',id]) so reopening a row shows the freshly saved
    // values — not a stale cached copy.
    qc.invalidateQueries({ queryKey: ['cs-sales'] });
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
          ['codes', 'Clients Codes', Hash],
          ['refund', 'استرداد', RotateCcw],
        ].map(([key, label, Icon]) => (
          <button key={key} onClick={() => setView(key)}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-black rounded-xl transition ${
              view === key ? 'bg-emerald-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100'
            }`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {view === 'memberships' ? <MembershipPricesSection /> : view === 'codes' ? <ClientCodesSection /> : view === 'refund' ? <RefundCalculatorSection /> : (
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
                  <th className="px-3 py-3 text-left">New Course</th>
                  <th className="px-3 py-3 text-right">Price</th>
                  <th className="px-3 py-3 text-right">Total Paid</th>
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
                    <td className="px-3 py-2.5 text-violet-700 font-bold">{r.new_courses || '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-700">{fmtAmount((r.new_courses && String(r.new_courses).trim()) ? r.new_prices : r.price)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-sky-700">{fmtAmount(r.total_paid_calc)}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">{r.months || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">{r.payment_way || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">{r.paid_status || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-700">{r.agent_name || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-700">{r.department || '—'}</td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      <button onClick={() => (String(r.courses || '').trim().toLowerCase() === 'refund' ? setRefundRow(r) : openEdit(r.id))} className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-lg transition" title={String(r.courses || '').trim().toLowerCase() === 'refund' ? 'تفاصيل الاسترداد' : 'تعديل'}><Pencil size={15} /></button>
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
      {refundRow && <RefundReviewModal key={refundRow.id} row={refundRow} onClose={() => setRefundRow(null)} />}
      <DeleteConfirm row={deleteRow} onClose={() => setDeleteRow(null)} onDeleted={afterMutate} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={afterMutate} />
    </div>
  );
}
