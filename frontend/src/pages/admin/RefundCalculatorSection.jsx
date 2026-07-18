import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, RotateCcw, User, Save, RefreshCw, CheckCircle, AlertTriangle, X } from 'lucide-react';
import api from '../../api/axios';
import SectionCard from '../../components/ui/SectionCard';

// «استرداد» — refund calculator. Enter a client code/phone → pick their membership
// operation → the boxes auto-fill and the refund updates live (owner's Excel
// formula). A «حفظ» button records the refund as a normal operation dated today
// (course "Refund", amount NEGATIVE — like the other refund rows) AND stores the
// calc inputs in the `note` field so re-opening the saved refund shows the same
// boxes (so you remember how it was computed). NO backend change — reuses the
// existing POST /cs-sales-register and the `note` column.
const num = (v) => Number(String(v ?? '').replace(/,/g, '')) || 0;
const levelsOf = (code) => { const m = String(code ?? '').match(/(\d+)\s*L\b/i); return m ? Number(m[1]) : 0; };
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const fmt = (x) => r2(x).toLocaleString('en-US', { maximumFractionDigits: 2 });
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const REFUND_TAG = '[refund]'; // marker in `note` after which the calc JSON lives

function parseRefundNote(note) {
  const s = String(note || '');
  const i = s.indexOf(REFUND_TAG);
  if (i < 0) return null;
  try { return JSON.parse(s.slice(i + REFUND_TAG.length)); } catch { return null; }
}
// Saved calc lives in the dedicated `refund_details` column now; fall back to the
// legacy [refund] marker in `note` for refunds saved before that column existed.
function parseRefundData(row) {
  if (row?.refund_details) { try { return JSON.parse(row.refund_details); } catch { /* noop */ } }
  return parseRefundNote(row?.note);
}
const isRefundRow = (row) => String(row?.courses || '').trim().toLowerCase() === 'refund';

function Box({ label, value, onChange, readOnly, tone }) {
  const base = 'w-full px-3 py-2 border rounded-xl text-sm outline-none text-right';
  const cls = readOnly
    ? `${base} bg-gray-100 text-gray-800 font-bold border-gray-200`
    : `${base} border-gray-200 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400`;
  const toneCls = tone === 'amber' ? 'bg-amber-50 text-amber-800 border-amber-200' : '';
  return (
    <div>
      <label className="block text-[11px] font-bold text-gray-500 mb-1">{label}</label>
      <input
        type="text" inputMode="decimal" dir="ltr"
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={readOnly}
        className={`${cls} ${readOnly ? toneCls : ''}`}
      />
    </div>
  );
}

export default function RefundCalculatorSection() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);
  const [seededId, setSeededId] = useState(null);
  const reqIdRef = useRef(null); // idempotency key for the save (per pick)
  // Editable-with-default (seeded from the picked operation, but the owner can override).
  const [mVal, setMVal]       = useState('');
  const [mMonths, setMMonths] = useState('');
  const [tPaid, setTPaid]     = useState('');
  // Pure inputs.
  const [consumed, setConsumed]         = useState('');
  const [sessions, setSessions]         = useState('');
  const [sessionPrice, setSessionPrice] = useState('');
  const [discountPct, setDiscountPct]   = useState('');
  const [placement, setPlacement]       = useState('');
  const [adminFee, setAdminFee]         = useState('');
  const [otherFees, setOtherFees]       = useState('');

  const { data, isFetching } = useQuery({
    queryKey: ['cs-sales', 'refund-search', q],
    queryFn: () => api.get('/cs-sales-register/list', { params: { q, limit: 20 } }).then((r) => r.data),
    enabled: q.trim().length >= 1,
    keepPreviousData: true,
  });
  const rows = data?.rows || [];

  const savedRefund = picked ? isRefundRow(picked) : false; // viewing an already-saved refund

  const pick = (row) => {
    setPicked(row);
    if (seededId !== row.id) {
      const saved = parseRefundData(row);
      if (saved && isRefundRow(row)) {
        // Re-open a saved refund → restore the EXACT calc that produced it.
        setMVal(saved.mVal ?? ''); setMMonths(saved.mMonths ?? ''); setTPaid(saved.tPaid ?? '');
        setConsumed(saved.consumed ?? ''); setSessions(saved.sessions ?? ''); setSessionPrice(saved.sessionPrice ?? '');
        setDiscountPct(saved.discountPct ?? ''); setPlacement(saved.placement ?? ''); setAdminFee(saved.adminFee ?? ''); setOtherFees(saved.otherFees ?? '');
      } else {
        // Fresh calc from a membership operation.
        const eff = (row.new_courses && String(row.new_courses).trim()) ? row.new_courses : row.courses;
        const val = (row.new_prices && num(row.new_prices)) ? num(row.new_prices) : num(row.price);
        setMVal(val ? String(val) : '');
        setMMonths(levelsOf(eff) ? String(levelsOf(eff)) : '');
        setTPaid(num(row.total_paid_calc) ? String(num(row.total_paid_calc)) : '');
        setConsumed(''); setSessions(''); setSessionPrice(''); setDiscountPct(''); setPlacement(''); setAdminFee(''); setOtherFees('');
        reqIdRef.current = (globalThis.crypto?.randomUUID?.() || `refund-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      }
      setSeededId(row.id);
      save.reset();
    }
  };

  const perLevel      = num(mMonths) > 0 ? num(mVal) / num(mMonths) : 0;
  const levelValue    = num(consumed) * perLevel;
  const sessionValue  = num(sessions) * num(sessionPrice);
  const discountValue = num(tPaid) * (num(discountPct) / 100);
  const totalDeduction = levelValue + sessionValue + discountValue + num(placement) + num(adminFee) + num(otherFees);
  const refund = num(tPaid) - totalDeduction;

  const save = useMutation({
    mutationFn: () => {
      const today = new Date();
      const entryDate = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
      const months = `${String(today.getFullYear()).slice(2)}-${MONTH_ABBR[today.getMonth()]}`;
      const neg = -r2(refund); // refund stored as a NEGATIVE amount (like the other refund rows)
      // Calc kept in the dedicated (hidden) column → the operation stays clean; the
      // note is left empty so the row looks like any other refund.
      const refund_details = JSON.stringify({ mVal, mMonths, tPaid, consumed, sessions, sessionPrice, discountPct, placement, adminFee, otherFees });
      return api.post('/cs-sales-register', {
        code: picked.code, client_name: picked.client_name, mobile_no: picked.mobile_no,
        courses: 'Refund', price: neg, total_paid_same_month: neg, balance: 0,
        paid_status: 'Paid', payment_way: 'Cash', department: 'Sales',
        entry_date: entryDate, months, note: '', refund_details, op_type: '',
        client_request_id: reqIdRef.current,
      }).then((r) => r.data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cs-sales'] }); },
  });

  return (
    <div className="space-y-4" dir="rtl">
      <SectionCard title="استرداد — حاسبة" icon={RotateCcw} accent="rose">
        <div className="relative">
          <label className="block text-[11px] font-bold text-gray-500 mb-1">ابحث بكود العميل أو رقم الموبايل</label>
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
              placeholder="مثال: 24275 أو 01001234567"
              className="w-full pr-9 pl-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
            />
          </div>
        </div>

        {q.trim().length >= 1 && (
          <div className="mt-3 border border-gray-100 rounded-2xl overflow-hidden">
            {isFetching && !rows.length ? (
              <div className="p-3 text-sm text-gray-400">جارٍ البحث…</div>
            ) : !rows.length ? (
              <div className="p-3 text-sm text-gray-400">لا توجد نتائج</div>
            ) : (
              <div className="max-h-56 overflow-auto divide-y divide-gray-50">
                {rows.map((rw) => {
                  const eff = (rw.new_courses && String(rw.new_courses).trim()) ? rw.new_courses : rw.courses;
                  const active = picked && picked.id === rw.id;
                  const refRow = isRefundRow(rw);
                  return (
                    <button
                      key={rw.id} type="button" onClick={() => pick(rw)}
                      className={`w-full text-right px-3 py-2 text-sm flex items-center justify-between gap-2 transition ${active ? 'bg-rose-50' : 'hover:bg-gray-50'}`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="font-black text-gray-800 font-mono">{rw.code}</span>
                        <span className="text-gray-600 truncate">{rw.client_name || '—'}</span>
                        <span className="text-gray-400 text-xs">{rw.mobile_no || ''}</span>
                      </span>
                      <span className={`text-xs whitespace-nowrap ${refRow ? 'text-rose-600 font-bold' : 'text-gray-500'}`}>
                        {refRow ? `استرداد محفوظ · ${fmt(rw.price)} ج` : `${eff || '—'} · ${fmt(rw.price)} ج`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {picked && (
        <SectionCard
          title="تفاصيل الاسترداد"
          icon={User}
          accent="amber"
          actions={
            <div className="flex items-center gap-2 text-xs font-bold text-gray-600">
              {savedRefund && <span className="px-2 py-0.5 rounded-lg bg-rose-100 text-rose-700">استرداد محفوظ</span>}
              <span>{picked.code} · {picked.client_name || '—'} · {picked.mobile_no || ''}</span>
            </div>
          }
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <Box label="قيمة العضوية" value={mVal} onChange={setMVal} />
            <Box label="العضوية كام شهر" value={mMonths} onChange={setMMonths} />
            <Box label="ثمن الليفل — تلقائي" value={fmt(perLevel)} readOnly />
            <Box label="عدد الليفل المستهلك" value={consumed} onChange={setConsumed} />
            <Box label="قيمة الليفل — تلقائي" value={fmt(levelValue)} readOnly />
            <Box label="عدد السيشن" value={sessions} onChange={setSessions} />
            <Box label="ثمن السيشن" value={sessionPrice} onChange={setSessionPrice} />
            <Box label="قيمة السيشن — تلقائي" value={fmt(sessionValue)} readOnly />
            <Box label="إجمالي المبلغ المدفوع" value={tPaid} onChange={setTPaid} />
            <Box label="نسبة الخصم %" value={discountPct} onChange={setDiscountPct} />
            <Box label="قيمة الخصم — تلقائي" value={fmt(discountValue)} readOnly />
            <Box label="تحديد مستوى" value={placement} onChange={setPlacement} />
            <Box label="مصاريف إدارية" value={adminFee} onChange={setAdminFee} />
            <Box label="مصاريف أخرى" value={otherFees} onChange={setOtherFees} />
            <Box label="إجمالي الخصم — تلقائي" value={fmt(totalDeduction)} readOnly tone="amber" />
            <div className="col-span-2">
              <label className="block text-[11px] font-black text-emerald-700 mb-1">إجمالي الاسترداد — تلقائي</label>
              <input
                type="text" dir="ltr" readOnly value={fmt(refund)}
                className="w-full px-3 py-2.5 border-2 border-emerald-300 rounded-xl text-lg font-black text-emerald-800 bg-emerald-50 outline-none text-right"
              />
            </div>
          </div>

          {/* Save — only for a fresh calc (not when reviewing an already-saved refund) */}
          {!savedRefund && (
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending || save.isSuccess}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black text-white bg-rose-600 hover:bg-rose-700 transition disabled:opacity-50"
              >
                {save.isPending ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                {save.isSuccess ? 'تم الحفظ' : 'حفظ الاسترداد'}
              </button>
              {save.isSuccess && (
                <span className="inline-flex items-center gap-1 text-sm font-bold text-emerald-700">
                  <CheckCircle size={16} /> اتسجّلت عملية استرداد بمبلغ {fmt(-r2(refund))} بتاريخ النهاردة في قائمة العمليات
                </span>
              )}
              {save.isError && (
                <span className="inline-flex items-center gap-1 text-sm font-bold text-rose-700">
                  <AlertTriangle size={16} /> {save.error?.response?.data?.error || 'فشل الحفظ'}
                </span>
              )}
            </div>
          )}
          <p className="mt-3 text-[11px] text-gray-500 bg-gray-50 rounded-xl p-2">
            {savedRefund
              ? 'استرداد محفوظ — دي المربعات زي ما اتحسبت وقت الحفظ (للمراجعة فقط).'
              : 'الحفظ بيسجّل عملية «Refund» بالمبلغ بالسالب بتاريخ النهاردة، وبيحفظ الحساب ده جواها — ترجعله من البحث بأي وقت.'}
          </p>
        </SectionCard>
      )}
    </div>
  );
}

// Refund review/EDIT shown when a saved «Refund» operation is opened from the
// operations list (✏️). Editable — «حفظ التعديلات» updates the SAME refund row
// (amount re-derived as negative). Render it with key={row.id} so state re-seeds
// per row (the parent mounts it only when a row is selected).
export function RefundReviewModal({ row, onClose }) {
  const qc = useQueryClient();
  const init = parseRefundData(row) || {};
  const [mVal, setMVal]             = useState(init.mVal ?? '');
  const [mMonths, setMMonths]       = useState(init.mMonths ?? '');
  const [tPaid, setTPaid]           = useState(init.tPaid ?? '');
  const [consumed, setConsumed]     = useState(init.consumed ?? '');
  const [sessions, setSessions]     = useState(init.sessions ?? '');
  const [sessionPrice, setSessionPrice] = useState(init.sessionPrice ?? '');
  const [discountPct, setDiscountPct]   = useState(init.discountPct ?? '');
  const [placement, setPlacement]   = useState(init.placement ?? '');
  const [adminFee, setAdminFee]     = useState(init.adminFee ?? '');
  const [otherFees, setOtherFees]   = useState(init.otherFees ?? '');

  const perLevel = num(mMonths) > 0 ? num(mVal) / num(mMonths) : 0;
  const levelValue = num(consumed) * perLevel;
  const sessionValue = num(sessions) * num(sessionPrice);
  const discountValue = num(tPaid) * (num(discountPct) / 100);
  const totalDeduction = levelValue + sessionValue + discountValue + num(placement) + num(adminFee) + num(otherFees);
  const refund = num(tPaid) - totalDeduction;

  const save = useMutation({
    mutationFn: () => {
      const neg = -r2(refund);
      const refund_details = JSON.stringify({ mVal, mMonths, tPaid, consumed, sessions, sessionPrice, discountPct, placement, adminFee, otherFees });
      // Update the SAME row: spread its existing fields, override the money + calc.
      return api.put(`/cs-sales-register/${row.id}`, {
        ...row, courses: 'Refund', price: neg, total_paid_same_month: neg, balance: 0, note: '', refund_details,
      }).then((r) => r.data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cs-sales'] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose} dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-rose-600 to-rose-500 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl"><RotateCcw size={20} /></div>
            <div>
              <h2 className="text-lg font-black">تفاصيل الاسترداد</h2>
              <p className="text-xs text-white/80">{row.code} · {row.client_name || '—'} · {row.mobile_no || ''}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/15 rounded-xl transition"><X size={20} /></button>
        </div>
        <div className="p-6 max-h-[75vh] overflow-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <Box label="قيمة العضوية" value={mVal} onChange={setMVal} />
            <Box label="العضوية كام شهر" value={mMonths} onChange={setMMonths} />
            <Box label="ثمن الليفل — تلقائي" value={fmt(perLevel)} readOnly />
            <Box label="عدد الليفل المستهلك" value={consumed} onChange={setConsumed} />
            <Box label="قيمة الليفل — تلقائي" value={fmt(levelValue)} readOnly />
            <Box label="عدد السيشن" value={sessions} onChange={setSessions} />
            <Box label="ثمن السيشن" value={sessionPrice} onChange={setSessionPrice} />
            <Box label="قيمة السيشن — تلقائي" value={fmt(sessionValue)} readOnly />
            <Box label="إجمالي المبلغ المدفوع" value={tPaid} onChange={setTPaid} />
            <Box label="نسبة الخصم %" value={discountPct} onChange={setDiscountPct} />
            <Box label="قيمة الخصم — تلقائي" value={fmt(discountValue)} readOnly />
            <Box label="تحديد مستوى" value={placement} onChange={setPlacement} />
            <Box label="مصاريف إدارية" value={adminFee} onChange={setAdminFee} />
            <Box label="مصاريف أخرى" value={otherFees} onChange={setOtherFees} />
            <Box label="إجمالي الخصم — تلقائي" value={fmt(totalDeduction)} readOnly tone="amber" />
            <div className="col-span-2">
              <label className="block text-[11px] font-black text-emerald-700 mb-1">إجمالي الاسترداد — تلقائي</label>
              <input type="text" dir="ltr" readOnly value={fmt(refund)}
                className="w-full px-3 py-2.5 border-2 border-emerald-300 rounded-xl text-lg font-black text-emerald-800 bg-emerald-50 outline-none text-right" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black text-white bg-rose-600 hover:bg-rose-700 transition disabled:opacity-50">
              {save.isPending ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />} حفظ التعديلات
            </button>
            {save.isError && (
              <span className="inline-flex items-center gap-1 text-sm font-bold text-rose-700">
                <AlertTriangle size={16} /> {save.error?.response?.data?.error || 'فشل الحفظ'}
              </span>
            )}
            <span className="text-[11px] text-gray-500">التعديل بيحدّث نفس عملية الاسترداد (المبلغ بيتحدّث بالسالب تلقائي).</span>
          </div>
        </div>
      </div>
    </div>
  );
}
