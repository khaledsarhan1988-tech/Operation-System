import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Search, ArrowLeftRight, Clock, PhoneOff, XCircle, UserPlus, Trash2 } from 'lucide-react';
import api from '../../api/axios';

/**
 * Group transition screen — opened from an Enr Groups row.
 *  - pick a NEXT group (active, not started yet) from the same dept,
 *  - move current-group clients into it (or add new ones from كشف العملاء),
 *  - record a disposition (postponed / no_answer / unsuccessful) for the rest.
 * All actions save immediately (admin only).
 */

const METHODS = [
  { value: 'call',     label: 'مكالمة' },
  { value: 'whatsapp', label: 'واتساب' },
  { value: 'visit',    label: 'زيارة' },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map(m => [m.value, m.label]));

const DISP_META = {
  postponed:    { label: 'تأجيل',     cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  no_answer:    { label: 'عدم الرد',  cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  unsuccessful: { label: 'غير ناجح',  cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

const NEXT_STATUS_LABEL = {
  waiting_lectures: 'بانتظار المحاضرات',
  waiting_trainees: 'بانتظار المتدربين',
};

export default function EnrTransitionModal({ group, onClose }) {
  const qc = useQueryClient();
  const dept = group.dept_type;
  const [nextGroup, setNextGroup] = useState('');        // "group_name|line"
  const [salesQ, setSalesQ] = useState('');
  const [salesSearch, setSalesSearch] = useState('');
  const [postponeFor, setPostponeFor] = useState(null);  // phone of client whose postpone form is open
  const [pForm, setPForm] = useState({ followup_date: '', followup_time: '', followup_method: 'call', notes: '' });

  const [nextName, nextLine] = nextGroup ? nextGroup.split('|') : ['', ''];

  const optionsQ = useQuery({
    queryKey: ['enr-next-options', dept, group.line],
    queryFn: () => api.get('/cs/enr-groups/next-options', { params: { dept, line: group.line } }).then(r => r.data),
  });
  const txQ = useQuery({
    queryKey: ['enr-transition', group.group_name, group.line],
    queryFn: () => api.get('/cs/enr-groups/transition', { params: { group: group.group_name, line: group.line } }).then(r => r.data),
  });
  const rosterQ = useQuery({
    queryKey: ['enr-next-roster', nextName, nextLine],
    enabled: !!nextName,
    queryFn: () => api.get('/cs/enr-groups/next-roster', { params: { next_group: nextName, next_line: nextLine } }).then(r => r.data),
  });
  const salesQRes = useQuery({
    queryKey: ['enr-sales-search', salesSearch],
    enabled: salesSearch.length > 0,
    queryFn: () => api.get('/cs/enr-groups/sales-search', { params: { q: salesSearch } }).then(r => r.data),
  });

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ['enr-transition', group.group_name, group.line] });
    qc.invalidateQueries({ queryKey: ['enr-next-roster'] });
    qc.invalidateQueries({ queryKey: ['enr-dispositions'] });
  };

  const moveMut = useMutation({
    mutationFn: ({ name, phone, added_from }) => api.post('/cs/enr-groups/next-members', {
      next_group: nextName, next_line: nextLine,
      source_group: added_from === 'sales_register' ? null : group.group_name,
      source_line: added_from === 'sales_register' ? null : group.line,
      members: [{ name, phone }], added_from,
    }),
    onSuccess: refetchAll,
    onError: (e) => alert('فشل النقل: ' + (e.response?.data?.error || e.message)),
  });
  const unmoveMut = useMutation({
    mutationFn: (id) => api.delete(`/cs/enr-groups/next-members/${id}`),
    onSuccess: refetchAll,
  });
  const dispMut = useMutation({
    mutationFn: (payload) => api.post('/cs/enr-groups/disposition', {
      source_group: group.group_name, source_line: group.line, dept, ...payload,
    }),
    onSuccess: () => { setPostponeFor(null); setPForm({ followup_date: '', followup_time: '', followup_method: 'call', notes: '' }); refetchAll(); },
    onError: (e) => alert('فشل الحفظ: ' + (e.response?.data?.error || e.message)),
  });
  const clearDispMut = useMutation({
    mutationFn: (id) => api.delete(`/cs/enr-groups/disposition/${id}`),
    onSuccess: refetchAll,
  });

  const move = (c, added_from = 'current') => {
    if (!nextName) { alert('اختر المجموعة القادمة أولاً'); return; }
    moveMut.mutate({ name: c.name, phone: c.phone, added_from });
  };
  const setDisp = (c, disposition, extra = {}) =>
    dispMut.mutate({ client_name: c.name, client_phone: c.phone, disposition, ...extra });
  const savePostpone = (c) => setDisp(c, 'postponed', pForm);

  const options = optionsQ.data?.items || [];
  const items = txQ.data?.items || [];
  const roster = rosterQ.data?.items || [];
  const sales = salesQRes.data?.items || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-slate-800">نقل المجموعة</div>
            <div className="text-xs text-slate-500 font-mono break-all mt-0.5">{group.group_name}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Next group picker */}
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-600">المجموعة القادمة:</span>
          <select
            value={nextGroup}
            onChange={(e) => setNextGroup(e.target.value)}
            className="flex-1 min-w-[16rem] py-2 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-200"
          >
            <option value="">— اختر مجموعة لسه ماابتدتش —</option>
            {options.map((o) => (
              <option key={`${o.group_name}|${o.line}`} value={`${o.group_name}|${o.line}`}>
                {o.group_name}{o.line ? ` (${o.line})` : ''}{o.start_date ? ` — ${o.start_date}` : ''}{NEXT_STATUS_LABEL[o.status] ? ` · ${NEXT_STATUS_LABEL[o.status]}` : ''}
              </option>
            ))}
          </select>
          {nextName && <span className="text-xs text-emerald-600">{roster.length} في الروستر</span>}
        </div>

        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Current clients + actions */}
          <div className="lg:col-span-2">
            <div className="text-sm font-semibold text-slate-700 mb-2">عملاء المجموعة الحالية ({items.length})</div>
            <div className="space-y-2">
              {items.map((c, i) => (
                <div key={(c.phone || c.name || i) + ''} className="border border-slate-100 rounded-lg p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm text-slate-800 truncate">{c.name || '—'}</div>
                      <div className="text-xs text-slate-400 font-mono" dir="ltr">{c.phone || ''}</div>
                    </div>
                    {c.moved_to ? (
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5 border border-emerald-200">
                          نُقل → {c.moved_to.next_group_name}
                        </span>
                        <button onClick={() => unmoveMut.mutate(c.moved_to.id)} className="text-slate-400 hover:text-rose-600" title="تراجع"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : c.disposition ? (
                      <div className="flex items-center gap-1">
                        <span className={`text-[11px] rounded-full px-2 py-0.5 border ${DISP_META[c.disposition.disposition]?.cls || ''}`}>
                          {DISP_META[c.disposition.disposition]?.label || c.disposition.disposition}
                          {c.disposition.disposition === 'postponed' && c.disposition.followup_date
                            ? ` · ${c.disposition.followup_date}${c.disposition.followup_time ? ' ' + c.disposition.followup_time : ''}${c.disposition.followup_method ? ' · ' + (METHOD_LABEL[c.disposition.followup_method] || '') : ''}`
                            : ''}
                        </span>
                        <button onClick={() => clearDispMut.mutate(c.disposition.id)} className="text-slate-400 hover:text-rose-600" title="تراجع"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => move(c)} title="نقل للمجموعة القادمة"
                          className="inline-flex items-center gap-1 text-[11px] bg-violet-600 text-white rounded-lg px-2 py-1 hover:bg-violet-700">
                          <ArrowLeftRight className="w-3 h-3" /> نقل
                        </button>
                        <button onClick={() => { setPostponeFor(c.phone || c.name); }} title="تأجيل"
                          className="inline-flex items-center gap-1 text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-2 py-1 hover:bg-amber-100">
                          <Clock className="w-3 h-3" /> تأجيل
                        </button>
                        <button onClick={() => setDisp(c, 'no_answer')} title="عدم الرد"
                          className="inline-flex items-center gap-1 text-[11px] bg-purple-50 text-purple-700 border border-purple-200 rounded-lg px-2 py-1 hover:bg-purple-100">
                          <PhoneOff className="w-3 h-3" /> عدم الرد
                        </button>
                        <button onClick={() => setDisp(c, 'unsuccessful')} title="غير ناجح"
                          className="inline-flex items-center gap-1 text-[11px] bg-rose-50 text-rose-700 border border-rose-200 rounded-lg px-2 py-1 hover:bg-rose-100">
                          <XCircle className="w-3 h-3" /> غير ناجح
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Inline postpone form */}
                  {postponeFor === (c.phone || c.name) && !c.moved_to && !c.disposition && (
                    <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap items-end gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">تاريخ المتابعة</label>
                        <input type="date" value={pForm.followup_date} onChange={e => setPForm(p => ({ ...p, followup_date: e.target.value }))}
                          className="py-1 px-2 text-xs border border-slate-200 rounded" dir="ltr" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">الموعد</label>
                        <input type="time" value={pForm.followup_time} onChange={e => setPForm(p => ({ ...p, followup_time: e.target.value }))}
                          className="py-1 px-2 text-xs border border-slate-200 rounded" dir="ltr" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">طريقة المتابعة</label>
                        <select value={pForm.followup_method} onChange={e => setPForm(p => ({ ...p, followup_method: e.target.value }))}
                          className="py-1 px-2 text-xs border border-slate-200 rounded bg-white">
                          {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      </div>
                      <div className="flex-1 min-w-[8rem]">
                        <label className="block text-[10px] text-slate-500 mb-0.5">ملاحظات</label>
                        <input type="text" value={pForm.notes} onChange={e => setPForm(p => ({ ...p, notes: e.target.value }))}
                          className="w-full py-1 px-2 text-xs border border-slate-200 rounded" />
                      </div>
                      <button onClick={() => savePostpone(c)} disabled={dispMut.isPending}
                        className="text-xs bg-amber-600 text-white rounded-lg px-3 py-1.5 hover:bg-amber-700 disabled:opacity-50">حفظ التأجيل</button>
                      <button onClick={() => setPostponeFor(null)} className="text-xs text-slate-500 px-2 py-1.5">إلغاء</button>
                    </div>
                  )}
                </div>
              ))}
              {txQ.isLoading && <div className="text-center text-slate-400 text-sm py-6">جاري التحميل...</div>}
              {!txQ.isLoading && items.length === 0 && <div className="text-center text-slate-400 text-sm py-6">لا يوجد عملاء في المجموعة</div>}
            </div>
          </div>

          {/* Right: add new from كشف العملاء + roster */}
          <div className="lg:col-span-1 space-y-4">
            <div>
              <div className="text-sm font-semibold text-slate-700 mb-2">إضافة عميل جديد (كشف العملاء)</div>
              <form onSubmit={(e) => { e.preventDefault(); setSalesSearch(salesQ.trim()); }} className="flex gap-1.5">
                <div className="relative flex-1">
                  <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input value={salesQ} onChange={e => setSalesQ(e.target.value)} placeholder="اسم / موبايل / كود"
                    className="w-full pr-7 pl-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" />
                </div>
                <button className="text-xs bg-violet-600 text-white rounded-lg px-2.5 hover:bg-violet-700">بحث</button>
              </form>
              <div className="mt-2 space-y-1 max-h-56 overflow-y-auto">
                {salesQRes.isLoading && <div className="text-xs text-slate-400 py-2 text-center">جاري البحث...</div>}
                {salesSearch && !salesQRes.isLoading && sales.length === 0 && <div className="text-xs text-slate-400 py-2 text-center">لا نتائج</div>}
                {sales.map((s, i) => (
                  <div key={(s.phone || s.name || i) + ''} className="flex items-center justify-between gap-2 border border-slate-100 rounded-lg px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="text-xs text-slate-800 truncate">{s.name || '—'}</div>
                      <div className="text-[11px] text-slate-400 font-mono" dir="ltr">{s.phone || ''}{s.code ? ` · ${s.code}` : ''}</div>
                    </div>
                    <button onClick={() => move(s, 'sales_register')} disabled={!nextName} title={nextName ? 'إضافة للمجموعة القادمة' : 'اختر المجموعة القادمة أولاً'}
                      className="inline-flex items-center gap-1 text-[11px] bg-emerald-600 text-white rounded-lg px-2 py-1 hover:bg-emerald-700 disabled:opacity-40">
                      <UserPlus className="w-3 h-3" /> إضافة
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {nextName && (
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-2">روستر المجموعة القادمة ({roster.length})</div>
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {roster.map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-2 border border-slate-100 rounded-lg px-2 py-1.5">
                      <div className="min-w-0">
                        <div className="text-xs text-slate-800 truncate">{m.client_name || '—'}</div>
                        <div className="text-[11px] text-slate-400 font-mono" dir="ltr">{m.client_phone || ''}</div>
                      </div>
                      <span className="text-[10px] text-slate-400">{m.added_from === 'sales_register' ? 'جديد' : 'منقول'}</span>
                    </div>
                  ))}
                  {roster.length === 0 && <div className="text-xs text-slate-400 py-2 text-center">لا أحد بعد</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
