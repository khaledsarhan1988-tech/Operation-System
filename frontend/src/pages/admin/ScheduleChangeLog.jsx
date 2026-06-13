import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Search, Trash2, PlusCircle, MoveRight, CheckCircle2, XCircle, Filter } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

// Machine flag → Arabic label + tone.
const FLAG_META = {
  deleted_confirmed:   { label: 'حذف محاضرة مؤكدة', tone: 'bg-red-100 text-red-800 border-red-300', sev: 3 },
  deleted_unconfirmed: { label: 'حذف غير مؤكدة (غياب محتمل)', tone: 'bg-orange-100 text-orange-800 border-orange-300', sev: 2 },
  deleted_scheduled:   { label: 'حذف مجدولة', tone: 'bg-amber-50 text-amber-700 border-amber-200', sev: 1 },
  added_extra:         { label: 'محاضرة مضافة', tone: 'bg-yellow-100 text-yellow-800 border-yellow-300', sev: 1 },
};
const TYPE_META = {
  deleted: { label: 'حذف', icon: Trash2, tone: 'text-red-600' },
  added:   { label: 'إضافة', icon: PlusCircle, tone: 'text-emerald-600' },
  moved:   { label: 'نقل', icon: MoveRight, tone: 'text-blue-600' },
};
const REVIEW_META = {
  new:         { label: 'جديد', tone: 'bg-slate-100 text-slate-600' },
  reviewed_ok: { label: 'سليم', tone: 'bg-emerald-100 text-emerald-700' },
  violation:   { label: 'مخالفة', tone: 'bg-red-600 text-white' },
};

export default function ScheduleChangeLog() {
  const qc = useQueryClient();
  const [type, setType]     = useState('all');
  const [flag, setFlag]     = useState('all');
  const [review, setReview] = useState('all');
  const [group, setGroup]   = useState('');
  const [trainer, setTrainer] = useState('');
  const [from, setFrom]     = useState('');
  const [to, setTo]         = useState('');

  const params = useMemo(() => ({ type, flag, review, group: group || undefined, trainer: trainer || undefined, from: from || undefined, to: to || undefined }), [type, flag, review, group, trainer, from, to]);

  const { data: summary } = useQuery({
    queryKey: ['change-log-summary', from, to],
    queryFn: () => api.get('/reschedules/change-log/summary', { params: { from: from || undefined, to: to || undefined } }).then(r => r.data),
    staleTime: 30 * 1000,
  });
  const { data, isLoading } = useQuery({
    queryKey: ['change-log', params],
    queryFn: () => api.get('/reschedules/change-log', { params }).then(r => r.data),
    staleTime: 30 * 1000,
  });
  const rows = data?.rows || [];

  const reviewMut = useMutation({
    mutationFn: ({ id, review_status }) => api.patch(`/reschedules/change-log/${id}/review`, { review_status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['change-log'] }); qc.invalidateQueries({ queryKey: ['change-log-summary'] }); },
  });

  const card = (label, value, tone) => (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <div className="text-2xl font-black">{value ?? 0}</div>
      <div className="text-[11px] font-bold opacity-80">{label}</div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="سجل تغييرات الجدول — كشف التلاعب"
        subtitle="كل إضافة / حذف / نقل للمحاضرات بتوقيتها — لمراجعة عمل الموظفين"
        icon={ShieldAlert}
        gradient="rose"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {card('إجمالي التغييرات', summary?.total, 'bg-white border-gray-200 text-gray-800')}
        {card('🔴 حذف مؤكدة', summary?.by_flag?.deleted_confirmed, 'bg-red-50 border-red-200 text-red-800')}
        {card('🟠 حذف غير مؤكدة', summary?.by_flag?.deleted_unconfirmed, 'bg-orange-50 border-orange-200 text-orange-800')}
        {card('🟡 مضافة', summary?.by_flag?.added_extra, 'bg-yellow-50 border-yellow-200 text-yellow-800')}
        {card('نقل', summary?.by_type?.moved, 'bg-blue-50 border-blue-200 text-blue-800')}
        {card('مخالفات مؤكدة', summary?.by_review?.violation, 'bg-red-600 border-red-700 text-white')}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 p-3 flex flex-wrap items-end gap-3 text-sm">
        <Filter size={16} className="text-gray-400 mb-2" />
        <Sel label="النوع" value={type} onChange={setType} opts={[['all', 'الكل'], ['deleted', 'حذف'], ['added', 'إضافة'], ['moved', 'نقل']]} />
        <Sel label="الاشتباه" value={flag} onChange={setFlag} opts={[['all', 'الكل'], ['deleted_confirmed', 'حذف مؤكدة'], ['deleted_unconfirmed', 'حذف غير مؤكدة'], ['added_extra', 'مضافة']]} />
        <Sel label="المراجعة" value={review} onChange={setReview} opts={[['all', 'الكل'], ['new', 'جديد'], ['reviewed_ok', 'سليم'], ['violation', 'مخالفة']]} />
        <div><label className="block text-[11px] font-bold text-gray-500 mb-1">المجموعة</label>
          <div className="relative"><Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input value={group} onChange={e => setGroup(e.target.value)} placeholder="اسم المجموعة..." className="pr-8 pl-2 py-1.5 rounded-lg border border-gray-200 text-xs w-44" /></div></div>
        <div><label className="block text-[11px] font-bold text-gray-500 mb-1">المدرب</label>
          <input value={trainer} onChange={e => setTrainer(e.target.value)} placeholder="اسم المدرب..." className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs w-36" /></div>
        <div><label className="block text-[11px] font-bold text-gray-500 mb-1">من</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs" /></div>
        <div><label className="block text-[11px] font-bold text-gray-500 mb-1">إلى</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs" /></div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right" style={{ minWidth: '900px' }}>
            <thead><tr className="bg-gray-50 border-b border-gray-100 text-[11px] text-gray-500">
              {['النوع', 'الاشتباه', 'المجموعة', 'المحاضرة', 'الحالة', 'المدرب', 'وقت الكشف', 'المراجعة'].map(h => (
                <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400">جاري التحميل...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">لا توجد تغييرات — شغّل «فحص ذكي للبيانات» أو انتظر المزامنة القادمة</td></tr>
              ) : rows.map(r => {
                const T = TYPE_META[r.change_type] || {}; const Icon = T.icon || MoveRight;
                const F = FLAG_META[r.flags];
                return (
                  <tr key={r.id} className={`hover:bg-gray-50/60 ${r.flags === 'deleted_confirmed' ? 'bg-red-50/40' : ''}`}>
                    <td className="px-3 py-2 whitespace-nowrap"><span className={`inline-flex items-center gap-1 font-bold ${T.tone}`}><Icon size={13} />{T.label}</span></td>
                    <td className="px-3 py-2 whitespace-nowrap">{F ? <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${F.tone}`}>{F.label}</span> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-700 max-w-[230px] truncate" title={r.group_name}>{r.group_name}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap" dir="ltr">
                      {r.date} {r.time || ''}{r.change_type === 'moved' && r.new_date ? <span className="text-blue-600"> → {r.new_date} {r.new_time || ''}</span> : ''}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.prev_status || r.status || '—'}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.trainer || '—'}</td>
                    <td className="px-3 py-2 text-[11px] font-mono text-gray-500 whitespace-nowrap" dir="ltr">{r.detected_at}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${REVIEW_META[r.review_status]?.tone}`}>{REVIEW_META[r.review_status]?.label}</span>
                        <button title="سليم" onClick={() => reviewMut.mutate({ id: r.id, review_status: 'reviewed_ok' })} className="p-1 rounded hover:bg-emerald-50 text-emerald-500"><CheckCircle2 size={14} /></button>
                        <button title="مخالفة" onClick={() => reviewMut.mutate({ id: r.id, review_status: 'violation' })} className="p-1 rounded hover:bg-red-50 text-red-500"><XCircle size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data?.total > rows.length && (
          <div className="px-4 py-2 text-[11px] text-gray-400 border-t">عرض {rows.length} من {data.total} — ضيّق الفلاتر لرؤية الباقي</div>
        )}
      </div>
    </div>
  );
}

function Sel({ label, value, onChange, opts }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-gray-500 mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs bg-white">
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
