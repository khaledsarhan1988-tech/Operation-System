import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserX, Search, AlertCircle, CheckCircle2, HelpCircle, UserCog, Download,
  Radar, Archive, RefreshCw, Image as ImageIcon, EyeOff } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

/**
 * «عملاء غير مسجلين في كشف العملاء» — TEMPORARY review page.
 * One row per client found in a real group with no membership, graded by the
 * evidence, with a free-text note the reviewer keeps for himself (autosaved).
 * Delete this file + its route/sidebar entry + the service/table when done.
 */

const CATS = [
  { key: 'need',   label: 'محتاجين تسجيل',      icon: AlertCircle, cls: 'bg-rose-50 text-rose-700 border-rose-200',       hint: 'مفيش أي أثر لهم في كشف العملاء' },
  { key: 'likely', label: 'الأرجح خطأ رقم',     icon: HelpCircle,  cls: 'bg-amber-50 text-amber-700 border-amber-200',     hint: 'اسم فريد + الرقم مختلف خانة أو اتنين' },
  { key: 'review', label: 'يحتاج مراجعتك',      icon: Search,      cls: 'bg-sky-50 text-sky-700 border-sky-200',           hint: 'الاسم متكرر أو الرقم مختلف تمامًا' },
  { key: 'staff',  label: 'موظفين / مش عملاء',  icon: UserCog,     cls: 'bg-slate-100 text-slate-600 border-slate-200',    hint: 'فريق العمل أو رحلة غير منطقية لعميل' },
];
const CAT_MAP = Object.fromEntries(CATS.map(c => [c.key, c]));

// One row: the note is local while typing and saved on blur (or Ctrl/Cmd+Enter).
function NoteCell({ item, onSave, saving }) {
  const [val, setVal] = useState(item.note || '');
  useEffect(() => { setVal(item.note || ''); }, [item.note, item.phone]);
  const dirty = (val || '') !== (item.note || '');
  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={val}
        rows={2}
        placeholder="اكتب ملحوظتك…"
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => dirty && onSave(val)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.blur(); } }}
        className={`w-full text-xs rounded-lg border px-2 py-1.5 resize-y focus:outline-none focus:ring-2 focus:ring-violet-300 ${
          dirty ? 'border-amber-300 bg-amber-50/40' : item.note ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200'
        }`}
      />
      {(item.note_by || dirty) && (
        <span className="text-[10px] text-slate-400">
          {dirty ? (saving ? 'جارٍ الحفظ…' : 'غير محفوظة — اضغط خارج الخانة') : `${item.note_by || ''}${item.note_at ? ` · ${String(item.note_at).slice(0, 10)}` : ''}`}
        </span>
      )}
    </div>
  );
}

/**
 * «مراقبة يومية» — the live watch list. The backlog tab is a one-off cleanup;
 * this one is what keeps it clean: the nightly job records every client who
 * lands in a group without a matching membership, and clears the row by itself
 * once the number is fixed. So an empty table here is the good state.
 */
function WatchPanel() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('open');

  const q = useQuery({
    queryKey: ['cs-integrity', status],
    queryFn: () => api.get('/cs/integrity-findings', { params: { status } }).then(r => r.data),
  });
  const mut = useMutation({
    mutationFn: ({ phone, status: s, note }) => api.put(`/cs/integrity-findings/${encodeURIComponent(phone)}`, { status: s, note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cs-integrity'] }),
    onError: (e) => alert('فشل التحديث: ' + (e.response?.data?.error || e.message)),
  });
  const runNow = useMutation({
    mutationFn: () => api.post('/cs/integrity-findings/run', {}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['cs-integrity'] });
      const s = r.data?.scan || {};
      alert(`تم الفحص\nجديد: ${s.added ?? 0} · اتقفل تلقائيًا: ${s.resolved ?? 0}`);
    },
    onError: (e) => alert('فشل الفحص: ' + (e.response?.data?.error || e.message)),
  });

  const w = q.data?.weekly || {};
  const counts = q.data?.counts || {};
  const items = q.data?.items || [];

  const IMG = {
    found:     { label: 'إيصال يطابق الرقم', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    not_found: { label: 'مفيش إيصال بالرقم', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    pending:   { label: 'لسه', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  };

  return (
    <div className="space-y-4">
      {/* Weekly digest — the Saturday report */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['اتكشف الأسبوع ده', w.detected, 'bg-sky-50 text-sky-700 border-sky-200'],
          ['لسه مفتوح', w.still_open, 'bg-amber-50 text-amber-700 border-amber-200'],
          ['اتصلح', w.fixed, 'bg-emerald-50 text-emerald-700 border-emerald-200'],
          ['بلا إيصال', w.no_receipt, 'bg-rose-50 text-rose-700 border-rose-200'],
        ].map(([label, val, cls]) => (
          <div key={label} className={`rounded-2xl border p-4 ${cls}`}>
            <div className="text-2xl font-black">{val ?? 0}</div>
            <div className="text-xs font-bold mt-1">{label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          {[['open', 'مفتوح'], ['resolved', 'اتصلح'], ['ignored', 'متجاهَل'], ['all', 'الكل']].map(([k, label]) => (
            <button key={k} onClick={() => setStatus(k)}
              className={`text-xs rounded-lg px-3 py-2 border ${status === k ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {label}{counts[k] != null ? ` (${counts[k]})` : ''}
            </button>
          ))}
          <button onClick={() => runNow.mutate()} disabled={runNow.isPending}
            className="text-xs inline-flex items-center gap-1.5 rounded-lg px-3 py-2 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 mr-auto">
            <RefreshCw className={`w-3.5 h-3.5 ${runNow.isPending ? 'animate-spin' : ''}`} />
            {runNow.isPending ? 'بيفحص…' : 'افحص دلوقتي'}
          </button>
        </div>

        {q.isLoading ? (
          <div className="p-10 text-center text-slate-400 text-sm">جارٍ التحميل…</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm flex flex-col items-center gap-2">
            <CheckCircle2 className="w-7 h-7 text-emerald-500" />
            <span className="font-semibold">مفيش أي مخالفة</span>
            <span className="text-xs text-slate-400">الجدول الفاضي هنا معناه إن كل الأرقام الجديدة مظبوطة</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="px-3 py-2.5 text-right font-medium">العميل</th>
                  <th className="px-3 py-2.5 text-center font-medium">اتكشف</th>
                  <th className="px-3 py-2.5 text-center font-medium">مجموعات</th>
                  <th className="px-3 py-2.5 text-right font-medium">الدليل</th>
                  <th className="px-3 py-2.5 text-center font-medium">الإيصال</th>
                  <th className="px-3 py-2.5 text-center font-medium">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map(it => (
                  <tr key={it.client_phone_norm} className="hover:bg-slate-50/60 align-top">
                    <td className="px-3 py-3">
                      <div className="font-medium text-slate-800">{it.client_name || '—'}</div>
                      <div className="text-xs text-slate-400 font-mono" dir="ltr">{it.client_phone_norm}</div>
                    </td>
                    <td className="px-3 py-3 text-center text-[11px] font-mono text-slate-600 whitespace-nowrap" dir="ltr">
                      {String(it.detected_at || '').slice(0, 10)}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="inline-flex min-w-7 justify-center px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-xs font-semibold">{it.groups_count}</span>
                      <div className="text-[10px] text-slate-400 mt-1 max-w-52 truncate mx-auto" title={it.groups_sample || ''}>{it.groups_sample}</div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-700 max-w-md">{it.evidence}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 border ${(IMG[it.image_check] || IMG.pending).cls}`}>
                        <ImageIcon className="w-3 h-3" />{(IMG[it.image_check] || IMG.pending).label}
                      </span>
                      {it.image_file && <div className="text-[10px] text-slate-400 mt-1 max-w-40 truncate mx-auto" title={it.image_file}>{it.image_file}</div>}
                    </td>
                    <td className="px-3 py-3 text-center whitespace-nowrap">
                      {it.status === 'open' ? (
                        <button onClick={() => { const n = prompt('سبب التجاهل (اختياري):'); if (n !== null) mut.mutate({ phone: it.client_phone_norm, status: 'ignored', note: n || null }); }}
                          className="text-[11px] inline-flex items-center gap-1 rounded-lg px-2 py-1 border border-slate-200 text-slate-600 hover:bg-slate-50">
                          <EyeOff className="w-3 h-3" /> تجاهل
                        </button>
                      ) : (
                        <button onClick={() => mut.mutate({ phone: it.client_phone_norm, status: 'open' })}
                          className="text-[11px] rounded-lg px-2 py-1 border border-slate-200 text-slate-600 hover:bg-slate-50">↺ رجّعه</button>
                      )}
                      {it.note && <div className="text-[10px] text-slate-400 mt-1 max-w-40 truncate mx-auto" title={it.note}>{it.note}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function UnregisteredClients() {
  const qc = useQueryClient();
  const [view, setView] = useState('watch');   // watch = the live list; backlog = the July cleanup
  const [cat, setCat] = useState('need');
  const [q, setQ] = useState('');
  const [onlyNoted, setOnlyNoted] = useState(false);

  const listQ = useQuery({
    queryKey: ['cs-unregistered'],
    queryFn: () => api.get('/cs/unregistered-clients').then(r => r.data),
  });

  const noteMut = useMutation({
    mutationFn: ({ phone, note }) => api.put(`/cs/unregistered-clients/${encodeURIComponent(phone)}/note`, { note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cs-unregistered'] }),
    onError: (e) => alert('فشل حفظ الملحوظة: ' + (e.response?.data?.error || e.message)),
  });

  const counts = listQ.data?.counts || {};
  const items = useMemo(() => {
    let list = listQ.data?.items || [];
    if (cat !== 'all') list = list.filter(i => i.category === cat);
    if (onlyNoted) list = list.filter(i => i.note);
    const t = q.trim().toLowerCase();
    if (t) list = list.filter(i => String(i.name || '').toLowerCase().includes(t) || i.phone.includes(t)
      || (i.groups || []).some(g => g.toLowerCase().includes(t)));
    return list;
  }, [listQ.data, cat, q, onlyNoted]);

  const exportCsv = () => {
    const head = ['التصنيف', 'الاسم', 'الموبايل', 'عدد المجموعات', 'أول ظهور', 'آخر ظهور', 'الدليل', 'الإجراء', 'ملاحظتي', 'المجموعات'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = items.map(i => [CAT_MAP[i.category]?.label || i.category, i.name, i.phone, i.groups_count,
      i.first_seen || '', i.last_seen || '', i.evidence, i.action, i.note || '', (i.groups || []).join(' | ')].map(esc).join(','));
    const blob = new Blob(['﻿' + [head.map(esc).join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `عملاء غير مسجلين - ${cat}.csv`;
    a.click();
  };

  return (
    <div className="space-y-5 pb-12" dir="rtl">
      <PageHero
        title="عملاء غير مسجلين في كشف العملاء"
        subtitle="عملاء ظاهرين في مجموعات حقيقية بلا عضوية مسجّلة — مصنّفين بالدليل، مع خانة ملاحظات لكل عميل"
        icon={UserX}
        gradient="linear-gradient(135deg, #9f1239 0%, #f59e0b 100%)"
      />

      {/* Tabs — the watch list is the day-to-day view; the backlog is history. */}
      <div className="flex items-center gap-2">
        {[
          ['watch', 'مراقبة يومية', Radar, 'اللي بيظهر من 24 يوليو 2026'],
          ['backlog', 'المراجعة القديمة', Archive, `الدفعة الأولى — ${counts.legacy ?? 0} عميل`],
        ].map(([k, label, Icon, hint]) => (
          <button key={k} onClick={() => setView(k)}
            className={`flex-1 md:flex-none text-right rounded-2xl border px-4 py-3 transition-all ${
              view === k ? 'bg-violet-600 text-white border-violet-600 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            <div className="flex items-center gap-2 font-bold text-sm"><Icon className="w-4 h-4" />{label}</div>
            <div className={`text-[11px] mt-0.5 ${view === k ? 'text-white/80' : 'text-slate-400'}`}>{hint}</div>
          </button>
        ))}
      </div>

      {view === 'watch' && <WatchPanel />}

      {view === 'backlog' && <>
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {CATS.map(c => {
          const Icon = c.icon;
          const active = cat === c.key;
          return (
            <button
              key={c.key}
              onClick={() => setCat(c.key)}
              className={`text-right rounded-2xl border p-4 transition-all ${c.cls} ${active ? 'ring-2 ring-offset-1 ring-violet-400 shadow-sm' : 'opacity-80 hover:opacity-100'}`}
            >
              <div className="flex items-center justify-between">
                <Icon className="w-5 h-5" />
                <span className="text-2xl font-black">{counts[c.key] ?? 0}</span>
              </div>
              <div className="mt-1 font-bold text-sm">{c.label}</div>
              <div className="text-[11px] opacity-75 mt-0.5">{c.hint}</div>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 overflow-hidden">
        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-52">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ابحث بالاسم أو الموبايل أو المجموعة…"
              className="w-full rounded-xl border border-slate-200 pr-9 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
          <button onClick={() => setCat('all')} className={`text-xs rounded-lg px-3 py-2 border ${cat === 'all' ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            الكل ({counts.all ?? 0})
          </button>
          <label className="text-xs flex items-center gap-1.5 text-slate-600 border border-slate-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-slate-50">
            <input type="checkbox" checked={onlyNoted} onChange={(e) => setOnlyNoted(e.target.checked)} />
            اللي عليها ملاحظات ({counts.with_note ?? 0})
          </label>
          <button onClick={exportCsv} className="text-xs inline-flex items-center gap-1.5 rounded-lg px-3 py-2 bg-emerald-600 text-white hover:bg-emerald-700">
            <Download className="w-3.5 h-3.5" /> تصدير ({items.length})
          </button>
        </div>

        {listQ.isLoading ? (
          <div className="p-10 text-center text-slate-400 text-sm">جارٍ التحميل…</div>
        ) : listQ.isError ? (
          <div className="m-4 rounded-xl bg-rose-50 border border-rose-200 p-4 text-rose-700 text-sm">
            فشل التحميل: {listQ.error?.response?.data?.error || listQ.error?.message}
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-500" /> مفيش عملاء في التصنيف ده
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0">
                <tr>
                  <th className="px-3 py-2.5 text-right font-medium">العميل</th>
                  <th className="px-3 py-2.5 text-center font-medium">المجموعات</th>
                  <th className="px-3 py-2.5 text-center font-medium">الظهور</th>
                  <th className="px-3 py-2.5 text-right font-medium">الدليل والإجراء</th>
                  <th className="px-3 py-2.5 text-right font-medium w-64">ملاحظتي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map(it => (
                  <tr key={it.phone} className="hover:bg-slate-50/60 align-top">
                    <td className="px-3 py-3">
                      <div className="font-medium text-slate-800">{it.name || '—'}</div>
                      <div className="text-xs text-slate-400 font-mono" dir="ltr">{it.phone}</div>
                      {cat === 'all' && (
                        <span className={`inline-block mt-1 text-[10px] rounded px-1.5 py-0.5 border ${CAT_MAP[it.category]?.cls}`}>
                          {CAT_MAP[it.category]?.label}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="inline-flex items-center justify-center min-w-7 px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-xs font-semibold">
                        {it.groups_count}
                      </span>
                      <div className="text-[10px] text-slate-400 mt-1 max-w-56 truncate mx-auto" title={(it.groups || []).join('\n')}>
                        {(it.groups || [])[0]}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center text-[11px] font-mono text-slate-600 whitespace-nowrap" dir="ltr">
                      {it.first_seen || '—'}<br />→ {it.last_seen || '—'}
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-xs text-slate-700">{it.evidence}</div>
                      <div className="text-[11px] text-violet-600 mt-1">← {it.action}</div>
                    </td>
                    <td className="px-3 py-3">
                      <NoteCell
                        item={it}
                        saving={noteMut.isPending}
                        onSave={(note) => noteMut.mutate({ phone: it.phone, note })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>}
    </div>
  );
}
