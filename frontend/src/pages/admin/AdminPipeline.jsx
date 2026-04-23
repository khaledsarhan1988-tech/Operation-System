import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Phone, Calendar, Clock, RefreshCw, X, Plus,
  PhoneCall, MessageCircle, StickyNote, MapPin,
  CheckCircle2, ChevronLeft, ChevronRight, AlertTriangle, Search,
  TrendingUp, Zap, Users, Filter,
  BookOpen, PhoneOff, MinusCircle,
  Bell, ChevronDown, CheckSquare, Square, ArrowRightLeft, History,
} from 'lucide-react';
import api from '../../api/axios';

// ─── config ───────────────────────────────────────────────────────────────────
const STAGES = [
  {
    key: 'جديدة',         label: 'جديدة',          group: null,
    gradient: 'from-blue-500 to-blue-600',
    light: 'bg-blue-50',   badge: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500',
    icon: Zap,
  },
  {
    key: 'Follow Up',     label: 'Follow Up',       group: 'قيد المتابعة',
    gradient: 'from-amber-500 to-orange-500',
    light: 'bg-amber-50',  badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500',
    icon: TrendingUp,
  },
  {
    key: 'Placement Test',label: 'Placement Test',  group: 'قيد المتابعة',
    gradient: 'from-yellow-500 to-amber-400',
    light: 'bg-yellow-50', badge: 'bg-yellow-100 text-yellow-800',dot: 'bg-yellow-500',
    icon: BookOpen,
  },
  {
    key: 'Problem Existing',label:'Problem Existing',group: 'قيد المتابعة',
    gradient: 'from-red-500 to-orange-600',
    light: 'bg-red-50',    badge: 'bg-red-100 text-red-700',     dot: 'bg-red-500',
    icon: AlertTriangle,
  },
  {
    key: 'No Answer',     label: 'No Answer',       group: null,
    gradient: 'from-purple-500 to-violet-600',
    light: 'bg-purple-50', badge: 'bg-purple-100 text-purple-700',dot: 'bg-purple-500',
    icon: PhoneOff,
  },
  {
    key: 'No Interesting',label: 'No Interesting',  group: null,
    gradient: 'from-slate-500 to-gray-600',
    light: 'bg-slate-50',  badge: 'bg-slate-100 text-slate-700', dot: 'bg-slate-500',
    icon: MinusCircle,
  },
  {
    key: 'Retention Done',label: 'Retention Done',  group: 'مكتملة',
    gradient: 'from-emerald-500 to-green-600',
    light: 'bg-emerald-50',badge: 'bg-emerald-100 text-emerald-700',dot:'bg-emerald-500',
    icon: CheckCircle2,
  },
];

const PRIORITY_STYLE = {
  'عاجلة': { bar: 'bg-red-500',    badge: 'bg-red-50 text-red-600 border border-red-200'       },
  'هامة':  { bar: 'bg-orange-400', badge: 'bg-orange-50 text-orange-600 border border-orange-200' },
  'عادية': { bar: 'bg-slate-300',  badge: 'bg-slate-50 text-slate-500 border border-slate-200'  },
};
const SLA_STYLE = {
  breached: { badge: 'bg-red-100 text-red-700 border border-red-200',         label: '⚠ متأخر'    },
  at_risk:  { badge: 'bg-orange-100 text-orange-700 border border-orange-200', label: '⏳ قريب'    },
  on_time:  { badge: 'bg-green-100 text-green-700 border border-green-200',    label: '✓ بالوقت' },
};
const LOG_TYPES = [
  { value: 'call',    label: 'مكالمة هاتفية',  Icon: PhoneCall    },
  { value: 'message', label: 'رسالة واتساب',    Icon: MessageCircle },
  { value: 'note',    label: 'ملاحظة',          Icon: StickyNote   },
  { value: 'visit',   label: 'زيارة',           Icon: MapPin       },
];
const OUTCOMES = ['تم التواصل','لم يرد','مشغول','خارج النطاق','رقم خاطئ','وعد بالمتابعة','تم الحل'];
const OUTCOME_COLOR = o =>
  ['تم التواصل','تم الحل','وعد بالمتابعة'].includes(o) ? 'bg-emerald-100 text-emerald-700' :
  ['لم يرد','رقم خاطئ'].includes(o)                    ? 'bg-red-100 text-red-700'          :
  'bg-gray-100 text-gray-600';

function initials(n) {
  if (!n) return '?';
  const p = n.trim().split(/\s+/);
  return p.length >= 2 ? p[0][0] + p[1][0] : p[0].slice(0, 2);
}
function daysAgo(s) {
  if (!s) return '';
  const d = Math.floor((Date.now() - new Date(s)) / 86_400_000);
  return d === 0 ? 'اليوم' : d === 1 ? 'أمس' : `${d} يوم`;
}
function fmtDT(s) {
  if (!s) return '';
  return new Date(s).toLocaleString('ar-EG', { year:'numeric', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

// ─── ReminderPanel ───────────────────────────────────────────────────────────
function ReminderPanel({ apiPath, agent }) {
  const [open, setOpen] = useState(false);
  const [notifiedIds, setNotifiedIds] = useState(() => new Set());

  const { data: reminders = [] } = useQuery({
    queryKey: ['admin-reminders', apiPath, agent],
    queryFn:  () => api.get(apiPath, agent ? { params: { agent } } : {}).then(r => r.data),
    refetchInterval: 60_000,
  });

  // Parse datetime stored as Egypt local time (UTC+2). Handles both T and space separators.
  const parseEgypt = (s) => {
    if (!s) return null;
    const norm = s.trim().replace(' ', 'T').replace(/\.\d+$/, '');
    const withTz = (norm.includes('+') || norm.endsWith('Z')) ? norm : norm + '+02:00';
    const d = new Date(withTz);
    return isNaN(d.getTime()) ? null : d;
  };
  // Human-readable delay: يوم / ساعة / دقيقة
  const fmtDelay = (mins) => {
    const abs = Math.abs(Math.round(mins));
    if (abs < 60)   return `${abs} دقيقة`;
    if (abs < 1440) return `${Math.round(abs / 60)} ساعة`;
    return `${Math.round(abs / 1440)} يوم`;
  };
  const now     = new Date();
  // Show ALL reminders with a valid date — no arbitrary time window filter.
  // The backend already excludes closed clients (Retention Done / إنتهت).
  const visible = reminders.filter(r => parseEgypt(r.next_followup_at) !== null);
  const overdue = visible.filter(r => { const d = parseEgypt(r.next_followup_at); return d && d < now; });
  const total   = visible.length;

  useEffect(() => {
    if (!total) return;
    const req = async () => {
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
      const now2 = new Date();
      reminders.forEach(r => {
        if (notifiedIds.has(r.id)) return;
        const due = parseEgypt(r.next_followup_at);
        if (!due) return;
        const minsLeft = Math.round((due - now2) / 60000);
        if (minsLeft > 30) return;
        const isLate = minsLeft <= 0;
        new Notification(
          isLate ? `⚠️ تذكير متأخر: ${r.client_name}` : `⏰ تذكير قريب: ${r.client_name}`,
          {
            body: `المنسق: ${r.assigned_to} · ${due.toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}`,
            icon: '/favicon.ico',
            tag:  `reminder-${r.id}`,
          }
        );
        setNotifiedIds(prev => new Set([...prev, r.id]));
      });
    };
    req();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminders]);

  if (total === 0) return null;

  return (
    <div className={`rounded-2xl overflow-hidden border transition-all ${overdue.length > 0 ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-4 py-3 transition ${overdue.length > 0 ? 'hover:bg-red-100' : 'hover:bg-amber-100'}`}
      >
        <div className="flex items-center gap-2">
          <Bell size={16} className={overdue.length > 0 ? 'text-red-600' : 'text-amber-600'} />
          <span className={`font-bold text-sm ${overdue.length > 0 ? 'text-red-800' : 'text-amber-800'}`}>
            {overdue.length > 0
              ? `${overdue.length} تذكير متأخر · ${total} إجمالي`
              : `${total} تذكير متابعة معلّق`}
          </span>
          {overdue.length > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full animate-pulse">
              {overdue.length}
            </span>
          )}
        </div>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''} ${overdue.length > 0 ? 'text-red-500' : 'text-amber-500'}`} />
      </button>

      {open && (
        <div className={`border-t divide-y max-h-72 overflow-y-auto ${overdue.length > 0 ? 'border-red-200 divide-red-100' : 'border-amber-200 divide-amber-100'}`}>
          {visible.map(r => {
            const due     = parseEgypt(r.next_followup_at);
            const isLate  = due && due < now;
            const minsLeft= due ? (due - now) / 60000 : 0;
            const timeLabel = isLate
              ? `متأخر ${fmtDelay(minsLeft)}`
              : `بعد ${fmtDelay(minsLeft)}`;
            return (
              <div key={r.id} className={`px-4 py-3 flex items-center gap-3 ${isLate ? 'bg-red-50' : 'bg-white'}`}>
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isLate ? 'bg-red-500 animate-pulse' : 'bg-amber-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-sm truncate">{r.client_name || '—'}</p>
                  <p className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
                    <Phone size={9} />{r.client_phone}
                    {r.assigned_to && <span className="mr-1 text-primary font-medium">· {r.assigned_to}</span>}
                  </p>
                  {due && (
                    <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
                      <Clock size={8} />
                      {due.toLocaleString('ar-EG', { year:'numeric', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                    </p>
                  )}
                </div>
                <div className={`text-[11px] font-bold px-2.5 py-1 rounded-xl text-center flex-shrink-0 ${isLate ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                  {isLate ? '⚠ ' : '⏰ '}{timeLabel}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── TransferHistoryModal (Admin) ────────────────────────────────────────────
function TransferHistoryModal({ onClose }) {
  const [fromUser, setFromUser] = useState('');
  const [toUser,   setToUser]   = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');

  const { data: hist, isLoading, refetch } = useQuery({
    queryKey: ['admin-transfer-history', fromUser, toUser, dateFrom, dateTo],
    queryFn: () => api.get('/admin/pipeline/transfer-history', {
      params: {
        limit: 200,
        ...(fromUser ? { from_user: fromUser } : {}),
        ...(toUser   ? { to_user:   toUser   } : {}),
        ...(dateFrom ? { date_from: dateFrom  } : {}),
        ...(dateTo   ? { date_to:   dateTo    } : {}),
      },
    }).then(r => r.data),
  });

  const fmtDate = s => s ? new Date(s).toLocaleString('ar-EG', {
    year:'numeric', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit',
  }) : '—';

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" dir="rtl" onClick={e => e.stopPropagation()}>

        {/* header */}
        <div className="bg-gradient-to-l from-slate-700 to-gray-800 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <History size={18} className="text-white" />
            <h2 className="font-bold text-white text-base">سجل حركات العملاء</h2>
            {hist?.total != null && (
              <span className="bg-white/20 text-white text-xs px-2.5 py-0.5 rounded-full font-bold">{hist.total} حركة</span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-xl transition">
            <X size={18} className="text-white" />
          </button>
        </div>

        {/* filters */}
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex flex-wrap gap-2">
          <input value={fromUser} onChange={e=>setFromUser(e.target.value)} placeholder="من (موظف/قائد)..."
            className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 flex-1 min-w-[140px]"/>
          <input value={toUser} onChange={e=>setToUser(e.target.value)} placeholder="إلى..."
            className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 flex-1 min-w-[140px]"/>
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"/>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"/>
          {(fromUser||toUser||dateFrom||dateTo) && (
            <button onClick={()=>{setFromUser('');setToUser('');setDateFrom('');setDateTo('');}}
              className="px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-xl border border-red-200 transition flex items-center gap-1">
              <X size={11}/> مسح
            </button>
          )}
        </div>

        {/* list */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex justify-center py-16"><RefreshCw className="animate-spin text-gray-300" size={28} /></div>
          ) : !hist?.data?.length ? (
            <div className="text-center py-16 text-gray-300">
              <History size={44} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">لا توجد حركات مسجلة</p>
              <p className="text-xs mt-1 text-gray-400">سيبدأ التسجيل من الآن تلقائياً</p>
            </div>
          ) : (
            <div className="space-y-2">
              {hist.data.map(t => (
                <div key={t.id} className="bg-gray-50 rounded-2xl p-3.5 border border-gray-100 flex items-center gap-3">
                  <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-slate-600 to-gray-700 flex items-center justify-center">
                    <ArrowRightLeft size={14} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="font-bold text-sm text-gray-900">{t.client_name || '—'}</p>
                      {t.client_phone && (
                        <span className="text-[11px] text-gray-400 font-mono flex items-center gap-1">
                          <Phone size={9}/>{t.client_phone}
                        </span>
                      )}
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">{t.transfer_type}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[12px]">
                      <span className="font-semibold text-red-500">{t.from_user}</span>
                      <ArrowRightLeft size={11} className="text-gray-400 mx-0.5" />
                      <span className="font-semibold text-emerald-600">{t.to_user}</span>
                      {t.transferred_by !== t.from_user && (
                        <span className="text-gray-400 text-[11px]"> · نفّذه: {t.transferred_by}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-400 text-left flex-shrink-0">
                    {fmtDate(t.transferred_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ReassignModal ────────────────────────────────────────────────────────────
function ReassignModal({ count, agentList, onConfirm, onClose, isPending }) {
  const [target, setTarget] = useState('');
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <ArrowRightLeft size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 text-base">نقل عملاء</h3>
            <p className="text-sm text-gray-400">{count} عميل محدد</p>
          </div>
        </div>

        <label className="text-xs font-semibold text-gray-600 block mb-1.5">اختر المنسق الجديد</label>
        <select
          value={target}
          onChange={e => setTarget(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 mb-5"
        >
          <option value="">— اختر منسق —</option>
          {agentList.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-500 hover:bg-gray-50 transition">
            إلغاء
          </button>
          <button
            disabled={!target || isPending}
            onClick={() => onConfirm(target)}
            className="flex-1 py-2.5 bg-gradient-to-l from-primary to-primary-light text-white rounded-xl text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2 shadow-md transition"
          >
            {isPending ? <RefreshCw size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
            تأكيد النقل
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ClientCard ───────────────────────────────────────────────────────────────
function ClientCard({ remark, stageKey, onSelect, onMove, onDragEnd, selectionMode, selected, onToggle }) {
  const pri = PRIORITY_STYLE[remark.priority] || PRIORITY_STYLE['عادية'];
  const sla = SLA_STYLE[remark.sla_status]    || SLA_STYLE.on_time;

  const handleClick = () => selectionMode ? onToggle(remark.id) : onSelect(remark);

  return (
    <div
      draggable={!selectionMode}
      onDragStart={!selectionMode ? e => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/json', JSON.stringify({ id: remark.id, from: stageKey }));
      } : undefined}
      onDragEnd={!selectionMode ? onDragEnd : undefined}
      onClick={handleClick}
      className={`group relative bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden ${
        selectionMode
          ? selected
            ? 'border-primary ring-2 ring-primary/30 bg-primary/5 cursor-pointer'
            : 'border-gray-200 cursor-pointer hover:border-primary/40'
          : 'border-gray-100 hover:shadow-lg hover:-translate-y-0.5 cursor-grab active:cursor-grabbing'
      }`}
    >
      {/* selection checkbox */}
      {selectionMode && (
        <div className="absolute top-2 left-2 z-10" onClick={e => { e.stopPropagation(); onToggle(remark.id); }}>
          {selected
            ? <CheckSquare size={18} className="text-primary fill-primary" />
            : <Square size={18} className="text-gray-300" />
          }
        </div>
      )}
      <div className={`absolute top-0 right-0 w-1 h-full ${pri.bar} rounded-r-2xl`} />
      <div className="p-3.5 pr-4">
        <div className="flex items-center gap-2.5 mb-2.5">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-primary-light flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-sm">
            {initials(remark.client_name)}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-gray-900 text-sm truncate">{remark.client_name || '—'}</p>
            {remark.client_phone && (
              <p className="text-xs text-gray-400 font-mono flex items-center gap-1">
                <Phone size={10} />{remark.client_phone}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium truncate max-w-[110px]">
            {remark.task_type || '—'}
          </span>
          <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ${sla.badge}`}>
            {sla.label}
          </span>
        </div>

        {/* assigned agent chip */}
        {remark.assigned_to && (
          <div className="flex items-center gap-1 text-[11px] text-primary bg-primary/5 rounded-xl px-2 py-1 mb-2 border border-primary/10">
            <Users size={10} />
            <span className="truncate font-semibold">{remark.assigned_to}</span>
          </div>
        )}

        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1 text-[11px] text-gray-400">
            <Calendar size={10} />{daysAgo(remark.added_at)}
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${pri.badge}`}>
            {remark.priority}
          </span>
        </div>

        {remark.client_date && (
          <div className="flex items-center gap-1 text-[11px] text-blue-600 bg-blue-50 rounded-xl px-2 py-1 border border-blue-100 mb-2">
            <Calendar size={10} />تاريخ العميل: {remark.client_date}
          </div>
        )}

        {remark.next_followup_at && (
          <div className="flex items-center gap-1 text-[11px] text-violet-700 bg-violet-50 rounded-xl px-2 py-1 border border-violet-100 mb-2">
            <Clock size={10} />متابعة: {fmtDT(remark.next_followup_at)}
          </div>
        )}

        <div onClick={e => e.stopPropagation()}>
          <select
            defaultValue=""
            onChange={e => { if (e.target.value) { onMove(remark.id, e.target.value); e.target.value=''; } }}
            className="w-full text-[11px] border border-gray-200 rounded-xl px-2 py-1.5 bg-gray-50 text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
          >
            <option value="">↓ انقل إلى مرحلة أخرى</option>
            {STAGES.filter(s => s.key !== stageKey).map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

// ─── KanbanColumn ─────────────────────────────────────────────────────────────
const PAGE_SIZE = 50;

function KanbanColumn({ stage, cards, onSelect, onMove, isDragOver, onColDragOver, onColDrop, onDragEnd, selectionMode, selectedIds, onToggle, onSelectAll }) {
  const StageIcon = stage.icon;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));

  // Reset to first page whenever cards list changes (filter applied)
  useEffect(() => { setPage(1); }, [cards.length]);

  const pageCards   = cards.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const allSelected = selectionMode && cards.length > 0 && cards.every(c => selectedIds?.has(c.id));

  return (
    <div
      className={`flex flex-col rounded-2xl overflow-hidden border shadow-sm bg-gray-50/50 min-h-[500px] transition-all duration-200 ${
        isDragOver ? 'border-primary ring-2 ring-primary/30 bg-primary/5 scale-[1.01]' : 'border-gray-200'
      }`}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onColDragOver?.(stage.key); }}
      onDrop={e => {
        e.preventDefault();
        try {
          const { id, from } = JSON.parse(e.dataTransfer.getData('application/json'));
          if (from !== stage.key) onColDrop?.(id, stage.key);
        } catch {}
      }}
    >
      {/* ── header: shows total count ── */}
      <div className={`bg-gradient-to-l ${stage.gradient} px-4 py-3`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <StageIcon size={16} className="text-white/90 flex-shrink-0" />
            <div className="min-w-0">
              <span className="font-bold text-white text-sm leading-tight block">{stage.label}</span>
              {stage.group && (
                <span className="text-white/60 text-[10px] leading-none">{stage.group}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {selectionMode && cards.length > 0 && (
              <button
                onClick={() => onSelectAll?.(cards, allSelected)}
                className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg transition ${
                  allSelected
                    ? 'bg-white text-primary'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                {allSelected ? <CheckSquare size={12}/> : <Square size={12}/>}
                {allSelected ? 'إلغاء الكل' : 'تحديد الكل'}
              </button>
            )}
            <span className="bg-white/25 text-white text-xs font-bold px-2.5 py-0.5 rounded-full">
              {cards.length}
            </span>
          </div>
        </div>
      </div>

      {/* ── pagination bar (below header, above cards) ── */}
      {totalPages > 1 && (
        <div className="px-2 py-2 border-b border-gray-200 bg-white">
          <div className="flex items-center justify-center gap-1 flex-wrap" dir="ltr">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft size={14} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => {
              const pg  = i + 1;
              const cnt = Math.min(PAGE_SIZE, cards.length - i * PAGE_SIZE);
              return (
                <button
                  key={pg}
                  onClick={() => setPage(pg)}
                  className={`px-1.5 py-0.5 rounded-lg text-[10px] font-semibold transition whitespace-nowrap ${
                    page === pg
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {pg} ({cnt})
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── card list (current page only) ── */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5" style={{ maxHeight: 'calc(100vh - 340px)' }}>
        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-300 select-none">
            <StageIcon size={32} className="mb-2 opacity-30" />
            <p className="text-xs">لا توجد مهام</p>
          </div>
        ) : pageCards.map(c => (
          <ClientCard
            key={c.id} remark={c} stageKey={stage.key}
            onSelect={onSelect} onMove={onMove} onDragEnd={onDragEnd}
            selectionMode={selectionMode} selected={selectedIds?.has(c.id)} onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

// ─── ClientDetailModal ────────────────────────────────────────────────────────
function ClientDetailModal({ remark: init, onClose, onUpdate }) {
  const qc = useQueryClient();
  const [local,    setLocal]    = useState(init);
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm]     = useState({
    interaction_type:'call', outcome:'', notes:'', next_followup_at:'', status:'',
  });

  const { data: logs=[], isLoading: logsLoading, refetch: refetchLogs } = useQuery({
    queryKey: ['admin-remark-logs', local.id],
    queryFn:  () => api.get(`/admin/pipeline/tasks/${local.id}/logs`).then(r => r.data),
  });

  const stageMut = useMutation({
    mutationFn: s => api.put(`/admin/pipeline/tasks/${local.id}`, { status: s }),
    onSuccess: ({ data }) => { setLocal(data); qc.invalidateQueries(['admin-pipeline']); },
  });

  const logMut = useMutation({
    mutationFn: p => api.post(`/admin/pipeline/tasks/${local.id}/log`, p),
    onSuccess: ({ data }) => {
      setLocal(data.remark);
      refetchLogs();
      qc.invalidateQueries(['admin-pipeline']);
      qc.invalidateQueries(['admin-reminders', '/admin/pipeline/reminders']);
      setForm({ interaction_type:'call', outcome:'', notes:'', next_followup_at:'', status:'' });
      setShowForm(false);
    },
  });

  const deleteLogMut = useMutation({
    mutationFn: (logId) => api.delete(`/admin/pipeline/interactions/${logId}`),
    onSuccess: () => {
      refetchLogs();
      qc.invalidateQueries(['admin-reminders']);
    },
  });

  const activeIdx = useMemo(() => {
    const i = STAGES.findIndex(s => s.key === local.status);
    return i === -1 ? 0 : i;
  }, [local.status]);

  const sla = SLA_STYLE[local.sla_status] || SLA_STYLE.on_time;
  const pri = PRIORITY_STYLE[local.priority] || PRIORITY_STYLE['عادية'];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden" dir="rtl" onClick={e => e.stopPropagation()}>

        {/* header */}
        <div className="bg-gradient-to-l from-primary to-primary-light px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center text-white font-bold flex-shrink-0">
                {initials(local.client_name)}
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-white text-base truncate">{local.client_name || '—'}</h2>
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                  {local.client_phone && <span className="flex items-center gap-1 text-white/80 text-xs"><Phone size={11}/>{local.client_phone}</span>}
                  {local.assigned_to  && <span className="text-white/70 text-xs flex items-center gap-1"><Users size={11}/>{local.assigned_to}</span>}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-xl transition flex-shrink-0">
              <X size={18} className="text-white" />
            </button>
          </div>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-white/20 text-white border border-white/20">{sla.label}</span>
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-white/20 text-white border border-white/20">{local.priority}</span>
            {local.next_followup_at && (
              <span className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-violet-400/40 text-white border border-violet-300/30">
                <Clock size={10}/>{fmtDT(local.next_followup_at)}
              </span>
            )}
          </div>
        </div>

        {/* stepper */}
        <div className="px-5 py-3 border-b bg-gray-50">
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            {STAGES.map((s, i) => {
              const isActive = i === activeIdx;
              const isPast   = i < activeIdx;
              return (
                <div key={s.key} className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => stageMut.mutate(s.key)}
                    disabled={stageMut.isPending}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                      isActive ? `bg-gradient-to-l ${s.gradient} text-white shadow-md scale-105`
                      : isPast  ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                      : 'bg-white text-gray-400 border border-gray-200 hover:border-gray-300 hover:text-gray-600'
                    }`}
                  >
                    {isPast ? <CheckCircle2 size={11}/> : <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-gray-300'}`}/>}
                    {s.label}
                  </button>
                  {i < STAGES.length-1 && <ChevronRight size={11} className="text-gray-300 flex-shrink-0"/>}
                </div>
              );
            })}
          </div>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">

          {/* log form */}
          <div className="px-5 py-4">
            {!showForm ? (
              <button
                onClick={() => setShowForm(true)}
                className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-200 rounded-2xl text-sm text-gray-400 hover:border-primary hover:text-primary hover:bg-primary/5 transition-all"
              >
                <Plus size={16}/> سجّل تواصل جديد
              </button>
            ) : (
              <div className="bg-gray-50 rounded-2xl p-4 space-y-3 border border-gray-200">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-gray-800">تسجيل تواصل</p>
                  <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700"><X size={15}/></button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label:'نوع التواصل', key:'interaction_type', opts:LOG_TYPES.map(t=>({value:t.value,label:t.label})) },
                    { label:'النتيجة',    key:'outcome', opts:OUTCOMES.map(o=>({value:o,label:o})), ph:'— اختر —' },
                    { label:'انتقل إلى مرحلة', key:'status', opts:STAGES.map(s=>({value:s.key,label:s.label})), ph:'— لا تغيير —' },
                  ].map(({label,key,opts,ph}) => (
                    <div key={key} className={key==='status'?'col-span-2':''}>
                      <label className="text-xs font-semibold text-gray-600 block mb-1">{label}</label>
                      <select value={form[key]} onChange={e=>setForm(p=>({...p,[key]:e.target.value}))}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40">
                        {ph && <option value="">{ph}</option>}
                        {opts.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">موعد المتابعة</label>
                  <input type="datetime-local" value={form.next_followup_at}
                    onChange={e=>setForm(p=>({...p,next_followup_at:e.target.value}))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"/>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">ملاحظات</label>
                  <textarea value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))}
                    placeholder="ما الذي حدث؟" rows={2}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"/>
                </div>
                {logMut.isError && (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle size={12}/>{logMut.error?.response?.data?.error||'حدث خطأ'}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={()=>setShowForm(false)} className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-200 rounded-xl transition">إلغاء</button>
                  <button disabled={logMut.isPending} onClick={()=>logMut.mutate(form)}
                    className="bg-gradient-to-l from-primary to-primary-light text-white px-5 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 disabled:opacity-50 shadow-md">
                    {logMut.isPending?<RefreshCw size={14} className="animate-spin"/>:<Plus size={14}/>} حفظ
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* timeline */}
          <div className="px-5 py-4">
            <p className="text-sm font-bold text-gray-800 mb-3">
              سجل التواصل {logs.length>0&&<span className="text-xs text-gray-400 font-normal mr-2">{logs.length} سجل</span>}
            </p>
            {logsLoading ? (
              <div className="flex justify-center py-8"><RefreshCw className="animate-spin text-gray-300" size={22}/></div>
            ) : logs.length===0 ? (
              <div className="text-center py-8"><MessageCircle size={32} className="mx-auto text-gray-200 mb-2"/><p className="text-sm text-gray-300">لم يتم تسجيل أي تواصل بعد</p></div>
            ) : (
              <div className="space-y-3">
                {logs.map(log => {
                  const tObj = LOG_TYPES.find(t=>t.value===log.interaction_type);
                  const LI = tObj?.Icon||PhoneCall;
                  return (
                    <div key={log.id} className="flex gap-3 group/log">
                      <div className="flex-shrink-0 w-9 h-9 rounded-2xl bg-gray-100 flex items-center justify-center">
                        <LI size={15} className="text-gray-500"/>
                      </div>
                      <div className="flex-1 bg-gray-50 rounded-2xl p-3 border border-gray-100">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-gray-800">{tObj?.label||log.interaction_type}</span>
                            {log.outcome&&<span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${OUTCOME_COLOR(log.outcome)}`}>{log.outcome}</span>}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-[10px] text-gray-400">{fmtDT(log.created_at)}</span>
                            <button
                              onClick={() => {
                                if (window.confirm('حذف هذا السجل نهائياً؟')) deleteLogMut.mutate(log.id);
                              }}
                              disabled={deleteLogMut.isPending}
                              title="حذف السجل"
                              className="opacity-0 group-hover/log:opacity-100 p-1 rounded-lg hover:bg-red-100 text-red-400 hover:text-red-600 transition-all"
                            >
                              <X size={13}/>
                            </button>
                          </div>
                        </div>
                        {log.notes&&<p className="text-sm text-gray-700">{log.notes}</p>}
                        {log.next_followup_at&&(
                          <div className="flex items-center gap-1 mt-2 text-[11px] text-violet-600 bg-violet-50 rounded-xl px-2 py-1">
                            <Clock size={10}/> موعد المتابعة: {fmtDT(log.next_followup_at)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
const LINES = ['Ahmed Hassan', 'Dardasha'];

// Returns first and last day of current month as YYYY-MM-DD
function currentMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${last}` };
}

export default function AdminPipeline() {
  const [selected,     setSelected]     = useState(null);
  const [search,       setSearch]       = useState('');
  const [filterLine,   setFilterLine]   = useState('');
  const [filterAgent,  setFilterAgent]  = useState('');
  const [filterStage,  setFilterStage]  = useState('');
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');
  const [dragOverStage,setDragOverStage]= useState(null);
  const [selectionMode,  setSelectionMode]  = useState(false);
  const [selectedIds,    setSelectedIds]    = useState(new Set());
  const [showReassign,   setShowReassign]   = useState(false);
  const [showHistory,    setShowHistory]    = useState(false);
  const qc = useQueryClient();

  const { data: agentList = [] } = useQuery({
    queryKey: ['admin-pipeline-agents', filterLine],
    queryFn:  () => api.get('/admin/pipeline/agents', { params: filterLine ? { line: filterLine } : {} }).then(r => r.data),
  });

  const { data: pipeline, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin-pipeline', filterLine, filterAgent, dateFrom, dateTo],
    queryFn:  () => api.get('/admin/pipeline', {
      params: {
        ...(filterLine ? { line:  filterLine  } : {}),
        ...(filterAgent? { agent: filterAgent } : {}),
        ...(dateFrom   ? { date_from: dateFrom } : {}),
        ...(dateTo     ? { date_to:   dateTo   } : {}),
      },
    }).then(r => r.data),
    refetchInterval: 120_000,
  });

  const moveMut = useMutation({
    mutationFn: ({ id, stage }) => api.put(`/admin/pipeline/tasks/${id}`, { status: stage }),
    onSuccess:  () => qc.invalidateQueries(['admin-pipeline']),
  });

  const reassignMut = useMutation({
    mutationFn: ({ ids, assigned_to }) =>
      api.put('/admin/pipeline/bulk-reassign', { ids: [...ids], assigned_to }),
    onSuccess: () => {
      qc.invalidateQueries(['admin-pipeline']);
      setSelectedIds(new Set());
      setSelectionMode(false);
      setShowReassign(false);
    },
  });

  const handleMove       = useCallback((id, stage) => moveMut.mutate({ id, stage }), [moveMut]);
  const handleColDragOver= useCallback((key) => setDragOverStage(key), []);
  const handleColDrop    = useCallback((id, toStage) => {
    setDragOverStage(null);
    moveMut.mutate({ id, stage: toStage });
  }, [moveMut]);
  const handleDragEnd    = useCallback(() => setDragOverStage(null), []);

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, []);

  const handleSelectAll = useCallback((cards, allSelected) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        cards.forEach(c => next.delete(c.id));  // deselect all in column
      } else {
        cards.forEach(c => next.add(c.id));     // select all in column
      }
      return next;
    });
  }, []);

  const visibleStages = filterStage ? STAGES.filter(s => s.key === filterStage) : STAGES;

  const filtered = useMemo(() => {
    if (!pipeline || !search.trim()) return pipeline;
    const q = search.toLowerCase();
    const f = arr => arr.filter(c =>
      (c.client_name||'').toLowerCase().includes(q) ||
      (c.client_phone||'').includes(q) ||
      (c.assigned_to||'').toLowerCase().includes(q)
    );
    return Object.fromEntries(Object.entries(pipeline).map(([k,v])=>[k,f(v)]));
  }, [pipeline, search]);

  const totalOpen = STAGES.filter(s=>s.key!=='Retention Done').reduce((s,st)=>s+(pipeline?.[st.key]?.length||0),0);
  const totalAll  = STAGES.reduce((s,st)=>s+(pipeline?.[st.key]?.length||0),0);
  const doneRate  = totalAll>0 ? Math.round(((pipeline?.['Retention Done']?.length||0)/totalAll)*100) : 0;

  return (
    <div className="space-y-5" dir="rtl">

      {/* header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">بايبلاين العملاء</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {isLoading ? '...' : `${totalOpen} مهمة نشطة · نسبة الإنجاز ${doneRate}%`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSelectionMode(m => !m); setSelectedIds(new Set()); }}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl border transition shadow-sm font-medium ${
              selectionMode
                ? 'bg-primary text-white border-primary'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <CheckSquare size={14} />
            {selectionMode ? 'إلغاء التحديد' : 'تحديد'}
          </button>
          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-2 px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition shadow-sm text-gray-600"
          >
            <History size={14} /> سجل الحركات
          </button>
          <button onClick={()=>refetch()} disabled={isFetching}
            className="flex items-center gap-2 px-4 py-2.5 text-sm bg-white border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-50 transition shadow-sm">
            <RefreshCw size={14} className={isFetching?'animate-spin':''}/> تحديث
          </button>
        </div>
      </div>

      {/* filters */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-gray-400"/>
            <span className="text-sm font-semibold text-gray-700">تصفية</span>
          </div>
          {(filterLine||filterAgent||filterStage||dateFrom||dateTo||search) && (
            <button
              onClick={()=>{setFilterLine('');setFilterAgent('');setFilterStage('');setDateFrom('');setDateTo('');setSearch('');}}
              className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 transition"
            >
              <X size={12}/> مسح الفلاتر
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="بحث بالاسم أو الموبايل..."
              className="w-full border border-gray-200 rounded-xl pr-9 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"/>
          </div>
          <select value={filterLine} onChange={e=>{setFilterLine(e.target.value);setFilterAgent('');}}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white">
            <option value="">كل الخطوط</option>
            {LINES.map(l=><option key={l} value={l}>{l}</option>)}
          </select>
          <select value={filterAgent} onChange={e=>setFilterAgent(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white">
            <option value="">كل المنسقين</option>
            {agentList.map(a=><option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filterStage} onChange={e=>setFilterStage(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white">
            <option value="">كل المراحل</option>
            {STAGES.map(s=>(
              <option key={s.key} value={s.key}>
                {s.label}{s.group ? ` — ${s.group}` : ''}
              </option>
            ))}
          </select>
          {/* date range */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 flex-1 border border-gray-200 rounded-xl px-2 py-1.5 focus-within:ring-2 focus-within:ring-primary/30">
              <Calendar size={13} className="text-gray-400 flex-shrink-0"/>
              <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}
                title="من تاريخ"
                className="flex-1 text-xs text-gray-700 focus:outline-none bg-transparent min-w-0"/>
            </div>
            <span className="text-gray-400 text-xs flex-shrink-0">—</span>
            <div className="flex items-center gap-1 flex-1 border border-gray-200 rounded-xl px-2 py-1.5 focus-within:ring-2 focus-within:ring-primary/30">
              <Calendar size={13} className="text-gray-400 flex-shrink-0"/>
              <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}
                title="إلى تاريخ"
                className="flex-1 text-xs text-gray-700 focus:outline-none bg-transparent min-w-0"/>
            </div>
          </div>
        </div>
        {(dateFrom||dateTo) && (
          <p className="text-xs text-primary mt-2 flex items-center gap-1">
            <Calendar size={11}/>
            تصفية بتاريخ العميل:
            {dateFrom && <span className="font-semibold">{dateFrom}</span>}
            {dateFrom && dateTo && ' ← '}
            {dateTo   && <span className="font-semibold">{dateTo}</span>}
          </p>
        )}
      </div>

      {/* reminders panel */}
      <ReminderPanel apiPath="/admin/pipeline/reminders" agent={filterAgent} />

      {/* stats */}
      {!isLoading && (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {STAGES.map(s=>{
            const count = pipeline?.[s.key]?.length??0;
            const SI = s.icon;
            return (
              <div key={s.key} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-2.5 flex-shrink-0 min-w-[130px]">
                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${s.gradient} flex items-center justify-center shadow-sm flex-shrink-0`}>
                  <SI size={16} className="text-white"/>
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-black text-gray-900">{count}</p>
                  <p className="text-[11px] text-gray-400 leading-tight truncate">{s.label}</p>
                  {s.group && <p className="text-[10px] text-gray-300 leading-tight truncate">{s.group}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* board */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <RefreshCw className="animate-spin text-primary" size={36}/>
          <p className="text-sm text-gray-400">جاري تحميل البايبلاين...</p>
        </div>
      ) : (
        <div className="flex gap-4 pb-6 overflow-x-auto">
          {visibleStages.map(stage=>(
            <div key={stage.key} className={`flex-shrink-0 ${filterStage ? 'w-full max-w-sm' : 'w-72'}`}>
              <KanbanColumn
                stage={stage}
                cards={filtered?.[stage.key]||[]}
                onSelect={setSelected}
                onMove={handleMove}
                isDragOver={dragOverStage === stage.key}
                onColDragOver={handleColDragOver}
                onColDrop={handleColDrop}
                onDragEnd={handleDragEnd}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                onToggle={toggleSelect}
                onSelectAll={handleSelectAll}
              />
            </div>
          ))}
        </div>
      )}

      {selected && (
        <ClientDetailModal remark={selected} onClose={()=>setSelected(null)}
          onUpdate={()=>{ qc.invalidateQueries(['admin-pipeline']); setSelected(null); }}/>
      )}

      {/* ── floating selection bar ── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-gray-900 text-white rounded-2xl shadow-2xl px-5 py-3" dir="rtl">
          <div className="flex items-center gap-2">
            <span className="bg-primary text-white text-xs font-black w-7 h-7 rounded-full flex items-center justify-center">
              {selectedIds.size}
            </span>
            <span className="text-sm font-semibold">عميل محدد</span>
          </div>
          <div className="w-px h-5 bg-white/20 mx-1" />
          <button
            onClick={() => setShowReassign(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary-light px-4 py-2 rounded-xl text-sm font-bold transition"
          >
            <ArrowRightLeft size={14} /> نقل إلى منسق
          </button>
          <button onClick={clearSelection} className="p-1.5 hover:bg-white/10 rounded-lg transition">
            <X size={15} className="text-gray-400" />
          </button>
        </div>
      )}

      {/* ── reassign modal ── */}
      {showReassign && (
        <ReassignModal
          count={selectedIds.size}
          agentList={agentList}
          isPending={reassignMut.isPending}
          onClose={() => setShowReassign(false)}
          onConfirm={(assigned_to) => reassignMut.mutate({ ids: selectedIds, assigned_to })}
        />
      )}

      {/* ── transfer history modal ── */}
      {showHistory && <TransferHistoryModal onClose={() => setShowHistory(false)} />}
    </div>
  );
}
