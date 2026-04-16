import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, Search, CheckCircle, Bell,
  Loader2, Save, X, Edit3
} from 'lucide-react';
import api from '../../api/axios';

// ─── STATUS CONFIG ─────────────────────────────────────────────────────────────
const STATUS_CFG = {
  new:         { label: 'جديد',       emoji: '🆕', dot: 'bg-red-500',     badge: 'bg-red-100 text-red-700 border-red-200',             btn: 'hover:bg-red-50 hover:border-red-300'      },
  reported:    { label: 'تم الإبلاغ', emoji: '📨', dot: 'bg-blue-500',    badge: 'bg-blue-100 text-blue-700 border-blue-200',          btn: 'hover:bg-blue-50 hover:border-blue-300'    },
  in_progress: { label: 'قيد الحل',   emoji: '⏳', dot: 'bg-amber-500',   badge: 'bg-amber-100 text-amber-700 border-amber-200',       btn: 'hover:bg-amber-50 hover:border-amber-300'  },
  wont_repeat: { label: 'لن تتكرر',   emoji: '✋', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', btn: 'hover:bg-emerald-50 hover:border-emerald-300' },
  exception:   { label: 'استثناء',    emoji: '🔕', dot: 'bg-slate-400',   badge: 'bg-slate-100 text-slate-600 border-slate-200',       btn: 'hover:bg-slate-50 hover:border-slate-300'  },
  resolved:    { label: 'تم حلها',    emoji: '✅', dot: 'bg-green-600',   badge: 'bg-green-100 text-green-700 border-green-200',       btn: 'hover:bg-green-50 hover:border-green-300'  },
};

// ─── HELPERS ───────────────────────────────────────────────────────────────────
function DeptBadge({ dept }) {
  const map = {
    'Semi':    'bg-amber-100 text-amber-800 border-amber-200',
    'Private': 'bg-violet-100 text-violet-800 border-violet-200',
    'General': 'bg-sky-100 text-sky-800 border-sky-200',
  };
  const cls = map[dept] ?? 'bg-gray-100 text-gray-600 border-gray-200';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${cls}`}>{dept ?? '—'}</span>;
}

function SkeletonRows({ cols = 7, rows = 5 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i} className="animate-pulse border-b border-gray-50">
      {Array.from({ length: cols }).map((__, j) => (
        <td key={j} className="px-4 py-3">
          <div className="h-3.5 bg-gray-100 rounded-full" style={{ width: `${60 + (j * 13 % 40)}%` }} />
        </td>
      ))}
    </tr>
  ));
}

function EmptyRow({ cols, msg = 'لا توجد مشاكل' }) {
  return (
    <tr>
      <td colSpan={cols} className="text-center py-12">
        <div className="flex flex-col items-center gap-2 text-gray-400">
          <CheckCircle className="w-8 h-8 text-green-300" />
          <p className="text-sm font-medium">{msg}</p>
        </div>
      </td>
    </tr>
  );
}

function problemBadge(type) {
  const cls =
    type === 'عدد محاضرات زيادة'       || type === 'زووم كول زيادة'         ? 'bg-orange-100 text-orange-700 border-orange-200' :
    type === 'تاريخ أول محاضرة غلط'    || type === 'زووم كول ناقصة'         ? 'bg-red-100 text-red-700 border-red-200' :
    type === 'تاريخ آخر محاضرة غلط'    || type === 'تاريخ آخر زووم كول غلط' ? 'bg-purple-100 text-purple-700 border-purple-200' :
    'bg-yellow-100 text-yellow-800 border-yellow-200';
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${cls}`}>{type}</span>;
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function LeaderCodeProblems() {
  const qc = useQueryClient();

  // ── filters
  const [search,     setSearch]     = useState('');
  const [fSection,   setFSection]   = useState('all');
  const [fStatus,    setFStatus]    = useState('');
  const [fProbType,  setFProbType]  = useState('');
  const [fEmployee,  setFEmployee]  = useState('');

  // ── status editor
  const [editKey,   setEditKey]   = useState(null);
  const [editForm,  setEditForm]  = useState({ status: 'new', note: '' });
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState(null);

  // ── users list for employee dropdown (all agents from users table)
  const { data: usersData } = useQuery({
    queryKey: ['users-agents'],
    queryFn: () => api.get('/admin/users').then(r => r.data),
    staleTime: 10 * 60 * 1000,
  });
  const team = (usersData ?? []).filter(u => u.role === 'agent' && u.is_active);

  // ── data — always show_resolved:true so counts match inside/outside
  const { data, isLoading } = useQuery({
    queryKey: ['leader-code-problems', fEmployee],
    queryFn: () => api.get('/reports/code-problems', {
      params: { show_resolved: true, ...(fEmployee ? { employee: fEmployee } : {}) },
    }).then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ['problem-statuses'],
    queryFn: () => api.get('/reports/problem-statuses').then(r => r.data),
    staleTime: 60 * 1000,
  });

  // ── build status map
  const statusMap = {};
  (statusData ?? []).forEach(s => {
    statusMap[`${s.group_name}|${s.problem_type}|${s.session_type}`] = s;
  });
  const getStatus    = (p, session) => statusMap[`${p.group_name}|${p.problem_type}|${session}`] ?? null;
  const getStatusKey = (p) => p._resolved_status ?? p._status?.status ?? 'new';

  // ── enrich problems
  const mainProbs   = (data?.main_problems ?? []).map(p => ({ ...p, _session: 'main', _status: getStatus(p, 'main') }));
  const sideProbs   = (data?.zoom_problems ?? []).map(p => ({ ...p, _session: 'side', _status: getStatus(p, 'side') }));
  const allEnriched = [...mainProbs, ...sideProbs];

  // ── dropdown values
  const probTypes = [...new Set(allEnriched.map(p => p.problem_type).filter(Boolean))].sort();

  // ── status counts from allEnriched (accurate for current filter)
  const statusCounts = { new: 0, reported: 0, in_progress: 0, exception: 0, wont_repeat: 0, resolved: 0 };
  allEnriched.forEach(p => { const k = getStatusKey(p); if (k in statusCounts) statusCounts[k]++; });
  const totalAll = allEnriched.length;

  // ── filter logic
  const applyFilters = (rows) => rows.filter(p => {
    const sk = getStatusKey(p);
    if (!fStatus && !search && !p.repeated_violation && (sk === 'wont_repeat' || sk === 'exception' || sk === 'resolved')) return false;
    if (search    && !p.group_name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (fProbType && p.problem_type !== fProbType) return false;
    if (fStatus   && sk !== fStatus)               return false;
    return true;
  });

  const filteredMain = fSection === 'side' ? [] : applyFilters(mainProbs);
  const filteredSide = fSection === 'main' ? [] : applyFilters(sideProbs);
  const total        = filteredMain.length + filteredSide.length;

  // ── open editor
  const openEditor = (p) => {
    const cur = p._status;
    setEditKey({ group_name: p.group_name, problem_type: p.problem_type, session_type: p._session, actual: p.actual ?? null });
    setEditForm({ status: cur?.status ?? 'new', note: cur?.note ?? '' });
    setSaveError(null);
  };

  // ── save status
  const handleSave = async () => {
    if (!editKey || saving) return;
    setSaving(true); setSaveError(null);
    try {
      await api.put('/reports/problem-status', { ...editKey, ...editForm, actual: editKey.actual });
      await qc.invalidateQueries({ queryKey: ['problem-statuses'] });
      await qc.invalidateQueries({ queryKey: ['leader-code-problems'] });
      setEditKey(null);
    } catch (e) {
      setSaveError(e?.response?.data?.error || 'حدث خطأ، حاول مرة أخرى');
    } finally { setSaving(false); }
  };

  const selectCls  = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] min-w-[140px]';
  const hasFilters = search || fSection !== 'all' || fProbType || fStatus || fEmployee;

  const achieved  = statusCounts.wont_repeat + statusCounts.exception + statusCounts.resolved;
  const remaining = totalAll - achieved;

  // ─── TABLE ────────────────────────────────────────────────────────────────
  const StatusBadge = ({ p }) => {
    const key = getStatusKey(p);
    const cfg = STATUS_CFG[key];
    const note = p._status?.note;
    const by   = p._status?.updated_by_name;
    return (
      <button
        onClick={() => openEditor(p)}
        title={note ? `ملاحظة: ${note}${by ? ` — ${by}` : ''}` : 'انقر لتغيير الحالة'}
        className={`group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold border transition-all ${cfg.badge} ${cfg.btn} hover:shadow-sm`}
      >
        <span>{cfg.emoji}</span>
        <span>{cfg.label}</span>
        <Edit3 size={10} className="opacity-0 group-hover:opacity-60 transition-opacity" />
      </button>
    );
  };

  const ProbTable = ({ rows, labelFirst, sectionLabel, sectionBg, sectionColor, dotColor }) => (
    <div>
      <div className={`flex items-center gap-2 px-5 py-3 ${sectionBg} border-b ${sectionColor} sticky top-0 z-10`}>
        <span className={`w-2 h-2 rounded-full ${dotColor} flex-shrink-0`} />
        <span className="text-sm font-bold">{sectionLabel}</span>
        <span className={`mr-auto text-xs font-bold px-2 py-0.5 rounded-full ${sectionBg.replace('/70', '')}`}>{rows.length}</span>
      </div>
      <table className="w-full text-sm text-right" style={{ minWidth: '1000px' }}>
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            {['اسم المجموعة', labelFirst, 'نوع المشكلة', 'التفاصيل', 'القسم', 'المنسق', 'الحالة', 'ملحوظات'].map(h => (
              <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {isLoading || statusLoading ? <SkeletonRows cols={8} rows={5} /> :
           !rows.length ? <EmptyRow cols={8} msg="✓ لا توجد مشاكل" /> :
           rows.map((p, i) => {
             const rowBg =
               getStatusKey(p) === 'exception'   ? 'bg-slate-50/50'   :
               getStatusKey(p) === 'wont_repeat'  ? 'bg-emerald-50/30' :
               getStatusKey(p) === 'resolved'     ? 'bg-green-50/30'   :
               getStatusKey(p) === 'in_progress'  ? 'bg-amber-50/30'   :
               getStatusKey(p) === 'reported'     ? 'bg-blue-50/20'    : '';
             return (
               <tr key={i} className={`border-b border-gray-50 hover:bg-gray-50/60 transition-colors ${rowBg}`}>
                 <td className="px-4 py-3 font-semibold text-gray-900 text-xs" style={{ maxWidth: '240px', wordBreak: 'break-word' }}>
                   <button onClick={() => navigator.clipboard.writeText(p.group_name)} title="انقر للنسخ" className="text-right hover:text-blue-600 transition-colors cursor-copy">{p.group_name}</button>
                 </td>
                 <td className="px-4 py-3 whitespace-nowrap text-xs font-mono text-gray-500">{p.first_date ?? '—'}</td>
                 <td className="px-4 py-3 whitespace-nowrap">{problemBadge(p.problem_type)}</td>
                 <td className="px-4 py-3 text-xs text-gray-600" style={{ maxWidth: '260px', wordBreak: 'break-word' }}>
                   {p.detail}
                   {p.repeated_violation && (
                     <div className="mt-1 flex items-start gap-1 text-[10px] font-bold text-orange-700 bg-orange-50 border border-orange-200 rounded px-1.5 py-1">
                       <span>⚠</span>
                       <span>سبق وضع حالة "{p.previous_status === 'wont_repeat' ? 'لن تتكرر' : 'استثناء'}" عند العدد {p.previous_actual} — الموظف كرر الخطأ وأصبح {p.actual}</span>
                     </div>
                   )}
                 </td>
                 <td className="px-4 py-3 whitespace-nowrap"><DeptBadge dept={p.dept_type} /></td>
                 <td className="px-4 py-3 text-gray-700 whitespace-nowrap text-xs">{p.coordinators ?? '—'}</td>
                 <td className="px-4 py-3 whitespace-nowrap"><StatusBadge p={p} /></td>
                 <td className="px-4 py-3 text-xs text-gray-600" style={{ maxWidth: '220px', wordBreak: 'break-word' }}>{p._status?.note || '—'}</td>
               </tr>
             );
           })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-0 animate-fadeIn" dir="rtl">
      {/* ── HEADER ── */}
      <div className="px-6 pt-5 pb-4 border-b border-gray-100 bg-gradient-to-l from-slate-50 to-white rounded-t-2xl">
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-100 rounded-xl">
              <AlertCircle className="w-5 h-5 text-gray-700" />
            </div>
            <div>
              <h1 className="text-xl font-black text-gray-900">أكواد بها مشكلة</h1>
              <p className="text-sm text-gray-400 mt-0.5">
                {isLoading ? 'جاري التحميل...' : `${total} مشكلة معروضة من إجمالي ${totalAll}`}
              </p>
            </div>
          </div>
          {/* Employee filter */}
          <select
            value={fEmployee}
            onChange={e => { setFEmployee(e.target.value); setFStatus(''); setSearch(''); setFSection('all'); setFProbType(''); }}
            className={`${selectCls} ${fEmployee ? 'ring-2 ring-[#1e3a5f]/30 border-[#1e3a5f] font-bold' : ''}`}
          >
            <option value="">كل الموظفين</option>
            {(team ?? []).map((a, i) => (
              <option key={i} value={a.full_name}>{a.full_name}</option>
            ))}
          </select>
        </div>

        {/* ── SUMMARY BOXES ── */}
        <div className="flex gap-3 mb-4">
          <div className="flex-1 flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">
            <div className="p-2 bg-emerald-100 rounded-xl"><CheckCircle size={18} className="text-emerald-600" /></div>
            <div>
              <p className="text-xs text-emerald-600 font-semibold">ما تم إنجازه</p>
              <p className="text-xl font-black text-emerald-700">{achieved}</p>
            </div>
            <div className="mr-auto text-xs text-emerald-500 font-medium">
              {totalAll > 0 ? Math.round((achieved / totalAll) * 100) : 0}%
            </div>
          </div>
          <div className="flex-1 flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
            <div className="p-2 bg-red-100 rounded-xl"><AlertCircle size={18} className="text-red-500" /></div>
            <div>
              <p className="text-xs text-red-500 font-semibold">المتبقي</p>
              <p className="text-xl font-black text-red-600">{remaining}</p>
            </div>
            <div className="mr-auto text-xs text-red-400 font-medium">
              {totalAll > 0 ? Math.round((remaining / totalAll) * 100) : 0}%
            </div>
          </div>
        </div>

        {/* ── STATUS TABS ── */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => setFStatus('')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all
              ${!fStatus ? 'bg-[#1e3a5f] text-white border-[#1e3a5f] shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            الكل
            <span className={`text-xs px-2 py-0.5 rounded-full font-black ${!fStatus ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>{totalAll}</span>
          </button>
          {Object.entries(STATUS_CFG).map(([key, cfg]) => (
            <button key={key}
              onClick={() => setFStatus(fStatus === key ? '' : key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all
                ${fStatus === key ? cfg.badge + ' shadow-sm ring-2 ring-offset-1 ring-current' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
            >
              <span>{cfg.emoji}</span> {cfg.label}
              <span className={`text-xs px-2 py-0.5 rounded-full font-black
                ${fStatus === key ? 'bg-white/40' : statusCounts[key] > 0 ? 'bg-gray-100 text-gray-700' : 'bg-gray-50 text-gray-400'}`}>
                {statusCounts[key]}
              </span>
            </button>
          ))}
        </div>

        {/* ── FILTER BAR ── */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="بحث باسم المجموعة..."
              className="w-full bg-white border border-gray-200 rounded-xl pr-10 pl-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
            />
          </div>
          <select value={fSection} onChange={e => setFSection(e.target.value)} className={selectCls}>
            <option value="all">كل المشاكل</option>
            <option value="main">أساسية فقط</option>
            <option value="side">جانبية فقط</option>
          </select>
          <select value={fProbType} onChange={e => setFProbType(e.target.value)} className={selectCls}>
            <option value="">كل أنواع المشاكل</option>
            {probTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setFSection('all'); setFProbType(''); setFStatus(''); setFEmployee(''); }}
              className="px-3 py-2 text-xs text-gray-500 hover:text-red-600 border border-gray-200 rounded-xl hover:border-red-200 transition-all font-medium whitespace-nowrap"
            >✕ مسح الكل</button>
          )}
        </div>
      </div>

      {/* ── TABLES ── */}
      <div className="bg-white rounded-b-2xl overflow-x-auto border border-t-0 border-gray-100">
        {fSection !== 'side' && (
          <ProbTable rows={filteredMain} labelFirst="تاريخ أول محاضرة"
            sectionLabel="مشاكل المحاضرات الأساسية"
            sectionBg="bg-blue-50/70" sectionColor="border-blue-100" dotColor="bg-blue-500" />
        )}
        {fSection !== 'main' && (
          <ProbTable rows={filteredSide} labelFirst="تاريخ أول جلسة"
            sectionLabel="مشاكل الزووم كول"
            sectionBg="bg-purple-50/70" sectionColor="border-purple-100" dotColor="bg-purple-500" />
        )}
      </div>

      {/* ── FOOTER ── */}
      <div className="px-6 py-3 bg-gray-50/50 border border-t-0 border-gray-100 rounded-b-2xl">
        <p className="text-xs text-gray-400 flex items-center gap-1.5">
          <Bell size={12} />
          انقر على أي حالة لتحديثها · التغييرات تُحفظ فوراً ولا تتأثر بإعادة رفع Excel
        </p>
      </div>

      {/* ── STATUS EDITOR ── */}
      {editKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => !saving && setEditKey(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 bg-gradient-to-l from-[#1e3a5f]/10 to-[#1e3a5f]/5 border-b border-[#1e3a5f]/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-[#1e3a5f] uppercase tracking-wide mb-1">تحديث حالة المشكلة</p>
                  <p className="text-sm font-black text-gray-900 leading-tight" style={{ wordBreak: 'break-all' }}>{editKey.group_name}</p>
                  <p className="text-xs text-gray-500 mt-1">{editKey.problem_type}</p>
                </div>
                <button onClick={() => setEditKey(null)} className="p-1.5 rounded-lg hover:bg-gray-100 flex-shrink-0">
                  <X size={15} className="text-gray-500" />
                </button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide">اختر الحالة</p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(STATUS_CFG).map(([key, cfg]) => (
                    <button key={key}
                      onClick={() => setEditForm(f => ({ ...f, status: key }))}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold border-2 transition-all
                        ${editForm.status === key ? cfg.badge + ' border-current shadow-sm scale-[1.02]' : 'border-gray-200 text-gray-600 bg-gray-50 hover:bg-gray-100'}`}
                    >
                      <span className="text-base">{cfg.emoji}</span>
                      <span>{cfg.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wide">ملاحظة (اختياري)</label>
                <textarea value={editForm.note} onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="أضف ملاحظة..." rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] resize-none bg-gray-50"
                />
              </div>
              {saveError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{saveError}</p>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[#1e3a5f] hover:bg-[#15294a] text-white rounded-xl text-sm font-bold transition-all disabled:opacity-60 shadow-sm">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {saving ? 'جاري الحفظ...' : 'حفظ'}
                </button>
                <button onClick={() => setEditKey(null)} disabled={saving}
                  className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold transition-all">
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
