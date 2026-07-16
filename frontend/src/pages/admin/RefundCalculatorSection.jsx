import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, RotateCcw, User } from 'lucide-react';
import api from '../../api/axios';
import SectionCard from '../../components/ui/SectionCard';

// «استرداد» — refund calculator (display only, no save). Enter a client code or
// phone → pick their membership operation → the boxes below auto-fill and the
// refund updates live. Mirrors the owner's Excel formula:
//   ثمن الليفل   = قيمة العضوية ÷ عدد الشهور
//   قيمة الليفل  = عدد الليفل المستهلك × ثمن الليفل
//   قيمة الخصم   = إجمالي المدفوع × نسبة الخصم%
//   إجمالي الخصم = قيمة الليفل + قيمة السيشن + قيمة الخصم + تحديد مستوى + مصاريف إدارية
//   الاسترداد    = إجمالي المدفوع − إجمالي الخصم
const num = (v) => Number(String(v ?? '').replace(/,/g, '')) || 0;
const levelsOf = (code) => { const m = String(code ?? '').match(/(\d+)\s*L\b/i); return m ? Number(m[1]) : 0; };
const fmt = (x) => (Math.round((Number(x) || 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

function Box({ label, value, onChange, readOnly, tone }) {
  const base = 'w-full px-3 py-2 border rounded-xl text-sm outline-none text-right';
  const cls = readOnly
    ? `${base} bg-gray-100 text-gray-800 font-bold border-gray-200`
    : `${base} border-gray-200 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400`;
  const toneCls = tone === 'amber' ? 'bg-amber-50 text-amber-800 border-amber-200'
    : tone === 'green' ? 'bg-emerald-50 text-emerald-800 border-emerald-300 text-base' : '';
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
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);
  const [seededId, setSeededId] = useState(null);
  // Editable-with-default (seeded from the picked operation, but the owner can override).
  const [mVal, setMVal]       = useState(''); // قيمة العضوية
  const [mMonths, setMMonths] = useState(''); // العضوية كام شهر
  const [tPaid, setTPaid]     = useState(''); // إجمالي المدفوع
  // Pure inputs.
  const [consumed, setConsumed]         = useState(''); // عدد الليفل المستهلك
  const [sessions, setSessions]         = useState(''); // عدد السيشن
  const [sessionPrice, setSessionPrice] = useState(''); // ثمن السيشن
  const [discountPct, setDiscountPct]   = useState(''); // نسبة الخصم %
  const [placement, setPlacement]       = useState(''); // تحديد مستوى
  const [adminFee, setAdminFee]         = useState(''); // مصاريف إدارية

  const { data, isFetching } = useQuery({
    queryKey: ['cs-sales', 'refund-search', q],
    queryFn: () => api.get('/cs-sales-register/list', { params: { q, limit: 20 } }).then((r) => r.data),
    enabled: q.trim().length >= 1,
    keepPreviousData: true,
  });
  const rows = data?.rows || [];

  const pick = (row) => {
    setPicked(row);
    if (seededId !== row.id) {
      const eff = (row.new_courses && String(row.new_courses).trim()) ? row.new_courses : row.courses;
      const val = (row.new_prices && num(row.new_prices)) ? num(row.new_prices) : num(row.price);
      setMVal(val ? String(val) : '');
      setMMonths(levelsOf(eff) ? String(levelsOf(eff)) : '');
      setTPaid(num(row.total_paid_calc) ? String(num(row.total_paid_calc)) : '');
      setSeededId(row.id);
    }
  };

  const perLevel      = num(mMonths) > 0 ? num(mVal) / num(mMonths) : 0;
  const levelValue    = num(consumed) * perLevel;
  const sessionValue  = num(sessions) * num(sessionPrice);
  const discountValue = num(tPaid) * (num(discountPct) / 100);
  const totalDeduction = levelValue + sessionValue + discountValue + num(placement) + num(adminFee);
  const refund = num(tPaid) - totalDeduction;

  return (
    <div className="space-y-4" dir="rtl">
      <SectionCard title="استرداد — حاسبة" icon={RotateCcw} accent="rose">
        {/* Search */}
        <div className="relative">
          <label className="block text-[11px] font-bold text-gray-500 mb-1">ابحث بكود العميل أو رقم الموبايل</label>
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
              placeholder="مثال: 24794 أو 01001234567"
              className="w-full pr-9 pl-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
            />
          </div>
        </div>

        {/* Results — pick the membership operation to refund */}
        {q.trim().length >= 1 && (
          <div className="mt-3 border border-gray-100 rounded-2xl overflow-hidden">
            {isFetching && !rows.length ? (
              <div className="p-3 text-sm text-gray-400">جارٍ البحث…</div>
            ) : !rows.length ? (
              <div className="p-3 text-sm text-gray-400">لا توجد نتائج</div>
            ) : (
              <div className="max-h-56 overflow-auto divide-y divide-gray-50">
                {rows.map((r) => {
                  const eff = (r.new_courses && String(r.new_courses).trim()) ? r.new_courses : r.courses;
                  const active = picked && picked.id === r.id;
                  return (
                    <button
                      key={r.id} type="button" onClick={() => pick(r)}
                      className={`w-full text-right px-3 py-2 text-sm flex items-center justify-between gap-2 transition ${active ? 'bg-rose-50' : 'hover:bg-gray-50'}`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="font-black text-gray-800 font-mono">{r.code}</span>
                        <span className="text-gray-600 truncate">{r.client_name || '—'}</span>
                        <span className="text-gray-400 text-xs">{r.mobile_no || ''}</span>
                      </span>
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        {eff || '—'} · {fmt(r.price)} ج
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
            <div className="text-xs font-bold text-gray-600">
              {picked.code} · {picked.client_name || '—'} · {picked.mobile_no || ''}
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
            <Box label="إجمالي الخصم — تلقائي" value={fmt(totalDeduction)} readOnly tone="amber" />
            <div className="col-span-2">
              <label className="block text-[11px] font-black text-emerald-700 mb-1">إجمالي الاسترداد — تلقائي</label>
              <input
                type="text" dir="ltr" readOnly value={fmt(refund)}
                className="w-full px-3 py-2.5 border-2 border-emerald-300 rounded-xl text-lg font-black text-emerald-800 bg-emerald-50 outline-none text-right"
              />
            </div>
          </div>
          <p className="mt-3 text-[11px] text-gray-500 bg-gray-50 rounded-xl p-2">
            حاسبة عرض فقط — مابتسجّلش عملية في النظام. القيم العلوية اتملّت من عملية العميل وتقدر تعدّلها، والباقي تكتبه.
          </p>
        </SectionCard>
      )}
    </div>
  );
}
