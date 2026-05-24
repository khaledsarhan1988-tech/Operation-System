import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, CheckCircle2, XCircle, Clock, AlertCircle, Search,
  RefreshCw, FileText, X, Send, Sparkles,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import { useAuth } from '../../auth/AuthContext';

// Approval status tabs + their visual treatment.
// activeBg uses STATIC class names (Tailwind JIT won't pick up dynamically
// constructed `bg-${color}-500` strings, so the class would never make it
// into the CSS bundle and the buttons would render uncoloured).
const TABS = [
  { key: 'pending',  label: 'في الانتظار',  icon: Clock,         activeBg: 'bg-amber-500'   },
  { key: 'approved', label: 'تمت الموافقة', icon: CheckCircle2,  activeBg: 'bg-emerald-500' },
  { key: 'rejected', label: 'مرفوضة',       icon: XCircle,       activeBg: 'bg-red-500'     },
  { key: 'auto',     label: 'إجازة رسمية',  icon: Sparkles,      activeBg: 'bg-sky-500'     },
  { key: 'all',      label: 'الكل',          icon: CalendarClock, activeBg: 'bg-indigo-500'  },
];

const STATUS_VISUAL = {
  pending:  { label: 'في الانتظار',  cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  approved: { label: 'تمت الموافقة', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  rejected: { label: 'مرفوضة',       cls: 'bg-red-100 text-red-800 border-red-200' },
  auto:     { label: 'إجازة رسمية',   cls: 'bg-sky-100 text-sky-800 border-sky-200' },
};

export default function LectureReschedules() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab]         = useState('pending');
  const [search, setSearch]   = useState('');
  const [trainer, setTrainer] = useState('');
  const [from, setFrom]       = useState('');
  const [to, setTo]           = useState('');
  const [openId, setOpenId]   = useState(null);

  // Super-admin actions (approve/reject/notes) only available to admin+All
  const isSuperAdmin = user?.role === 'admin' && user?.management === 'All';

  const { data, isLoading } = useQuery({
    queryKey: ['reschedules', tab, search, trainer, from, to],
    queryFn: () => api.get('/reschedules', {
      params: {
        status: tab,
        group:   search || undefined,
        trainer: trainer || undefined,
        from:    from || undefined,
        to:      to   || undefined,
      },
    }).then(r => r.data),
    staleTime: 30 * 1000,
  });

  const rows   = data?.rows   || [];
  const counts = data?.counts || {};
  const openRow = openId ? rows.find(r => r.id === openId) : null;

  return (
    <div className="space-y-5">
      <PageHero
        title="إعادة جدولة المحاضرات"
        subtitle="سجل كامل بكل المحاضرات اللى اتغير ميعادها — مع اعتماد المدير ومتابعة الإجازات الرسمية"
        icon={CalendarClock}
        gradient="from-indigo-500 to-purple-600"
      />

      {/* Tabs */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-1.5 flex gap-1.5 flex-wrap">
        {TABS.map(t => {
          const Icon = t.icon;
          const isActive = tab === t.key;
          const cnt = counts[t.key] || (t.key === 'all'
            ? Object.values(counts).reduce((s, n) => s + n, 0) : 0);
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 min-w-[120px] px-3 py-2.5 rounded-xl text-sm font-bold transition flex items-center justify-center gap-2
                ${isActive
                  ? `${t.activeBg} text-white shadow-md`
                  : 'text-gray-600 hover:bg-gray-50'}`}>
              <Icon size={14} />
              {t.label}
              {cnt > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold
                  ${isActive ? 'bg-white/30 text-white' : 'bg-gray-100 text-gray-700'}`}>
                  {cnt}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="بحث في اسم المجموعة..."
            className="w-full pl-3 pr-8 py-1.5 rounded-lg border border-gray-300 text-sm" />
        </div>
        <input type="text" value={trainer} onChange={e => setTrainer(e.target.value)}
          placeholder="اسم المدرب"
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm min-w-[140px]" />
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
        <span className="text-xs text-gray-400">إلى</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm" />
        <button onClick={() => qc.invalidateQueries({ queryKey: ['reschedules'] })}
          className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm flex items-center gap-1.5">
          <RefreshCw size={14} /> تحديث
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 font-bold">
              <tr>
                <th className="px-3 py-2 text-right">المجموعة</th>
                <th className="px-3 py-2 text-right">النوع</th>
                <th className="px-3 py-2 text-right">المدرب</th>
                <th className="px-3 py-2 text-center">من تاريخ</th>
                <th className="px-3 py-2 text-center">إلى تاريخ</th>
                <th className="px-3 py-2 text-center">الحالة</th>
                <th className="px-3 py-2 text-center">السبب</th>
                <th className="px-3 py-2 text-center">اكتشف في</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">جاري التحميل...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">
                  لا توجد عمليات إعادة جدولة في هذه القائمة
                </td></tr>
              ) : rows.map(r => {
                const sv = STATUS_VISUAL[r.approval_status] || { label: r.approval_status, cls: 'bg-gray-100 text-gray-700 border-gray-200' };
                return (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-indigo-50/30 cursor-pointer"
                      onClick={() => setOpenId(r.id)}>
                    <td className="px-3 py-2.5 font-semibold text-gray-800">{r.group_name}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border
                        ${r.session_type === 'main' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200'}`}>
                        {r.session_type === 'main' ? 'أساسية' : 'زووم'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.old_trainer !== r.new_trainer ? (
                        <span>
                          <span className="text-red-600">{r.old_trainer}</span>
                          <span className="text-gray-400 mx-1">←</span>
                          <span className="text-emerald-600">{r.new_trainer}</span>
                        </span>
                      ) : (
                        <span className="text-gray-700">{r.old_trainer || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="text-xs font-bold text-red-600">{r.old_date}</div>
                      <div className="text-[10px] text-gray-500">{r.old_time || ''}</div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="text-xs font-bold text-emerald-600">{r.new_date}</div>
                      <div className="text-[10px] text-gray-500">{r.new_time || ''}</div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full font-bold border ${sv.cls}`}>
                        {sv.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-xs">
                      {r.reschedule_reason === 'official_holiday' ? (
                        <span className="inline-flex items-center gap-1 text-sky-700 font-bold" title={r.holiday_name}>
                          <Sparkles size={11} /> {r.holiday_name || 'إجازة'}
                        </span>
                      ) : <span className="text-gray-300">يدوي</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center text-[11px] text-gray-500">
                      {r.detected_at?.slice(0, 10)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail modal */}
      {openRow && (
        <RescheduleDetailModal
          row={openRow}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setOpenId(null)}
          onChanged={() => { qc.invalidateQueries({ queryKey: ['reschedules'] }); }}
        />
      )}
    </div>
  );
}

// ─── Detail Modal with approve/reject + admin notes ──────────────────────────
function RescheduleDetailModal({ row, isSuperAdmin, onClose, onChanged }) {
  const [notes, setNotes]           = useState(row.admin_notes || '');
  const [rejectReason, setReject]   = useState('');
  const [showRejectBox, setRBox]    = useState(false);
  const sv = STATUS_VISUAL[row.approval_status] || STATUS_VISUAL.pending;

  const approveMut = useMutation({
    mutationFn: () => api.patch(`/reschedules/${row.id}/approve`),
    onSuccess: () => { onChanged(); onClose(); },
  });
  const rejectMut = useMutation({
    mutationFn: () => api.patch(`/reschedules/${row.id}/reject`, { reason: rejectReason }),
    onSuccess: () => { onChanged(); onClose(); },
  });
  const notesMut = useMutation({
    mutationFn: () => api.patch(`/reschedules/${row.id}/notes`, { notes }),
    onSuccess: () => onChanged(),
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-gradient-to-r from-indigo-50 to-purple-50 border-b flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${sv.cls}`}>{sv.label}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-700 border border-indigo-200">
                {row.session_type === 'main' ? 'محاضرة أساسية' : 'زووم/Side'}
              </span>
              {row.reschedule_reason === 'official_holiday' && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold bg-sky-100 text-sky-700 border border-sky-200">
                  <Sparkles size={10} /> سبب: إجازة رسمية ({row.holiday_name})
                </span>
              )}
            </div>
            <h3 className="font-bold text-gray-900 text-lg">{row.group_name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{row.line}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white rounded-lg"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Before/After */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-red-700 uppercase mb-1">الموعد الأصلي (اتلغى)</p>
              <p className="text-lg font-black text-red-800">{row.old_date}</p>
              <p className="text-sm text-red-700 mt-1">
                <Clock size={11} className="inline -mt-0.5" /> {row.old_time || '—'} · {row.old_duration || ''}
              </p>
              <p className="text-xs text-red-600 mt-1">المدرب: <b>{row.old_trainer || '—'}</b></p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-emerald-700 uppercase mb-1">الموعد الجديد</p>
              <p className="text-lg font-black text-emerald-800">{row.new_date}</p>
              <p className="text-sm text-emerald-700 mt-1">
                <Clock size={11} className="inline -mt-0.5" /> {row.new_time || '—'} · {row.new_duration || ''}
              </p>
              <p className="text-xs text-emerald-600 mt-1">المدرب: <b>{row.new_trainer || '—'}</b></p>
            </div>
          </div>

          {/* Detection meta */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-gray-600 grid grid-cols-2 gap-2">
            <div>
              <span className="text-gray-500">اكتشف في:</span>{' '}
              <b className="text-gray-800">{row.detected_at?.replace('T', ' ').slice(0, 16)}</b>
            </div>
            {row.approved_at && (
              <div>
                <span className="text-gray-500">قرار في:</span>{' '}
                <b className="text-gray-800">{row.approved_at?.replace('T', ' ').slice(0, 16)}</b>
              </div>
            )}
            {row.approved_by_name && (
              <div className="col-span-2">
                <span className="text-gray-500">القرار من:</span>{' '}
                <b className="text-gray-800">{row.approved_by_name}</b>
              </div>
            )}
            {row.rejection_reason && (
              <div className="col-span-2 bg-red-50 border border-red-200 rounded p-2 text-red-700">
                <b>سبب الرفض:</b> {row.rejection_reason}
              </div>
            )}
          </div>

          {/* Admin notes — read by all, edit by super-admin only */}
          <div className={`border rounded-xl p-3 ${isSuperAdmin ? 'bg-amber-50/50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              <FileText size={14} className="text-amber-600" />
              <p className="text-xs font-bold text-amber-800">ملاحظات المدير</p>
              {!isSuperAdmin && <span className="text-[10px] text-gray-500">(عرض فقط)</span>}
            </div>
            {isSuperAdmin ? (
              <>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="ملاحظات داخلية للمدير العام (لن يراها المنسق/الموظف)..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-amber-300 text-xs bg-white" />
                <button onClick={() => notesMut.mutate()}
                  disabled={notesMut.isPending || notes === (row.admin_notes || '')}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1.5">
                  <Send size={11} /> حفظ الملاحظة
                </button>
              </>
            ) : (
              <p className="text-xs text-gray-600 whitespace-pre-wrap">
                {row.admin_notes || <span className="text-gray-400 italic">لا توجد ملاحظات</span>}
              </p>
            )}
          </div>

          {/* Approve/Reject (super-admin only, only when pending) */}
          {isSuperAdmin && row.approval_status === 'pending' && (
            <div className="border-t pt-4">
              <p className="text-xs font-bold text-gray-700 mb-2">قرار المدير</p>
              {!showRejectBox ? (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => approveMut.mutate()}
                    disabled={approveMut.isPending}
                    className="py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2">
                    <CheckCircle2 size={15} />
                    {approveMut.isPending ? 'جاري...' : 'موافقة'}
                  </button>
                  <button onClick={() => setRBox(true)}
                    className="py-2.5 rounded-lg bg-gradient-to-r from-red-500 to-red-600 text-white font-bold text-sm inline-flex items-center justify-center gap-2">
                    <XCircle size={15} />
                    رفض
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea value={rejectReason} onChange={e => setReject(e.target.value)}
                    placeholder="سبب الرفض (اختياري)..."
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-red-300 text-xs bg-white" />
                  <div className="flex gap-2">
                    <button onClick={() => setRBox(false)}
                      className="flex-1 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">
                      إلغاء
                    </button>
                    <button onClick={() => rejectMut.mutate()}
                      disabled={rejectMut.isPending}
                      className="flex-1 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-bold text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2">
                      <XCircle size={14} />
                      تأكيد الرفض
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Read-only banner for non-super-admins */}
          {!isSuperAdmin && row.approval_status === 'pending' && (
            <div className="border-t pt-4">
              <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
                <AlertCircle size={14} className="flex-shrink-0" />
                <span>الموافقة/الرفض متاح للمدير العام فقط — في انتظار قراره.</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
