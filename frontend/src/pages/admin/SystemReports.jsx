'use client';
import { useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Users, AlertTriangle, BookOpen, Layers, UserX, AlertCircle,
  MessageSquare, RefreshCw, ChevronDown, ChevronUp, X, Clock,
  UserCheck, Eye, Search, Filter, TrendingUp, Calendar,
  CheckCircle, XCircle, AlertOctagon, BarChart2, Zap, FileText,
  Edit3, Save, Bell, ShieldCheck, Loader2, Copy, Check, Video,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';

// ─── COPY BUTTON ──────────────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handle = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);
  return (
    <button
      onClick={handle}
      title="انقر للنسخ"
      className={`inline-flex items-center gap-1.5 group text-right transition-colors ${copied ? 'text-emerald-600' : 'text-gray-900 hover:text-blue-600'}`}
    >
      <span className="font-semibold text-xs">{text}</span>
      {copied
        ? <Check size={12} className="text-emerald-500 flex-shrink-0" />
        : <Copy size={12} className="opacity-0 group-hover:opacity-60 flex-shrink-0 transition-opacity" />
      }
    </button>
  );
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmtDate = (d) => {
  if (!d) return '—';
  try {
    if (typeof d === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}/.test(d)) return d.split(',')[0].trim();
    const p = new Date(d);
    return isNaN(p.getTime()) ? d : p.toLocaleDateString('ar-EG');
  } catch { return d; }
};

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, icon: Icon, gradient, loading, onClick, pulse }) {
  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden rounded-xl flex items-center gap-3 px-4 py-3 transition-all duration-200 select-none
        ${onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg active:scale-95' : ''}
        ${pulse ? 'ring-2 ring-red-400 ring-offset-1' : ''}
        shadow-sm`}
      style={{ background: gradient }}
    >
      {/* Decorative circle */}
      <div className="absolute -top-3 -left-3 w-16 h-16 rounded-full bg-white/10 pointer-events-none" />
      <div className="absolute -bottom-4 -right-1 w-14 h-14 rounded-full bg-white/10 pointer-events-none" />

      {/* Icon */}
      <div className="relative z-10 bg-white/20 backdrop-blur-sm p-2 rounded-lg flex-shrink-0">
        <Icon className="w-4 h-4 text-white" />
      </div>

      {/* Text */}
      <div className="relative z-10 flex-1 min-w-0">
        {loading ? (
          <div className="h-6 w-12 bg-white/30 animate-pulse rounded mb-0.5" />
        ) : (
          <p className="text-xl font-black text-white leading-none">{value ?? '—'}</p>
        )}
        <p className="text-xs text-white/75 mt-0.5 font-medium truncate">{label}</p>
      </div>

      {/* Eye */}
      {onClick && (
        <div className="relative z-10 bg-white/20 p-1 rounded-lg flex-shrink-0">
          <Eye className="w-3 h-3 text-white/70" />
        </div>
      )}
    </div>
  );
}

// ─── DEPT BADGE ───────────────────────────────────────────────────────────────
function DeptBadge({ dept }) {
  const map = {
    'Semi':    'bg-amber-100 text-amber-800 border-amber-200',
    'Private': 'bg-violet-100 text-violet-800 border-violet-200',
    'General': 'bg-sky-100 text-sky-800 border-sky-200',
    'All':     'bg-slate-100 text-slate-600 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${map[dept] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
      {dept ?? '—'}
    </span>
  );
}

// ─── URGENCY BADGE ────────────────────────────────────────────────────────────
function UrgencyBadge({ level }) {
  const map = {
    urgent:    { label: '⚡ عاجل',      cls: 'bg-red-100 text-red-700 border-red-200' },
    important: { label: '⚠ مهم',       cls: 'bg-orange-100 text-orange-700 border-orange-200' },
    normal:    { label: '📋 عادي',      cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    overdue:   { label: '🔴 متأخر جداً', cls: 'bg-red-200 text-red-900 border-red-300' },
    ok:        { label: '✓ بخير',       cls: 'bg-green-100 text-green-700 border-green-200' },
  };
  const cfg = map[level] ?? map.ok;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ─── PROGRESS BAR ─────────────────────────────────────────────────────────────
function ProgressBar({ done, total, colorClass = 'bg-blue-500' }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div className={`h-1.5 rounded-full transition-all ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 tabular-nums w-10 text-left">{done}/{total}</span>
    </div>
  );
}

// ─── SECTION CARD ─────────────────────────────────────────────────────────────
function SectionCard({ title, icon: Icon, iconColor, count, countColor = 'bg-red-100 text-red-700', open, onToggle, children, accentColor = '#1e3a5f' }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl" style={{ backgroundColor: `${accentColor}15` }}>
            <Icon className="w-4 h-4" style={{ color: accentColor }} />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">{title}</h2>
            {count !== undefined && (
              <span className={`inline-block mt-0.5 text-xs font-bold px-2 py-0.5 rounded-full ${countColor}`}>
                {count} سجل
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm text-gray-500 hover:bg-gray-50 border border-gray-100 transition-all font-medium"
        >
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          {open ? 'طي' : 'عرض'}
        </button>
      </div>

      {/* Content */}
      {open && <div className="p-0">{children}</div>}
    </div>
  );
}

// ─── STYLED TABLE ─────────────────────────────────────────────────────────────
function StyledTable({ headers, children, minWidth = '700px' }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-right" style={{ minWidth }}>
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            {headers.map(h => (
              <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, className = '', highlight }) {
  return (
    <td className={`px-4 py-3 text-gray-700 ${highlight ? 'font-semibold text-gray-900' : ''} ${className}`}>
      {children ?? '—'}
    </td>
  );
}

function SkeletonRows({ cols = 5, rows = 4 }) {
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

function EmptyRow({ cols, msg = 'لا توجد بيانات' }) {
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

// ─── GROUPS MODAL ─────────────────────────────────────────────────────────────
function GroupsModal({ title, groups, allUsers = [], onClose, filterType = 'active' }) {
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [traineesGroup, setTraineesGroup] = useState(null);
  const [search,      setSearch]      = useState('');
  const [fromDate,    setFromDate]    = useState('');
  const [toDate,      setToDate]      = useState('');
  const [deptF,       setDeptF]       = useState('');
  const [minTrainees, setMinTrainees] = useState('');
  const [maxTrainees, setMaxTrainees] = useState('');
  const [coordF,      setCoordF]      = useState('');

  const userDeptMap = {};
  allUsers.forEach(u => {
    if (u.full_name) userDeptMap[u.full_name.toLowerCase().trim()] = u.department;
  });
  const getCoordDept = (g) => userDeptMap[(g.coordinators ?? '').toLowerCase().trim()] ?? g.dept_type ?? '—';

  // unique coordinator values for dropdown
  const coordOptions = [...new Set(groups.map(g => g.coordinators).filter(Boolean))].sort();
  const deptOptions  = [...new Set(groups.map(g => getCoordDept(g)).filter(d => d && d !== '—'))].sort();

  const dateField = filterType === 'expired' ? 'end_date' : 'start_date';

  const filtered = groups.filter(g => {
    if (search.trim() && !g.group_name?.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (fromDate && g[dateField] && g[dateField] < fromDate) return false;
    if (toDate   && g[dateField] && g[dateField] > toDate)   return false;
    if (deptF    && getCoordDept(g) !== deptF) return false;
    if (minTrainees && (g.trainee_count ?? 0) < Number(minTrainees)) return false;
    if (maxTrainees && (g.trainee_count ?? 0) > Number(maxTrainees)) return false;
    if (coordF   && !(g.coordinators ?? '').toLowerCase().includes(coordF.toLowerCase())) return false;
    return true;
  });

  const clearFilters = () => { setFromDate(''); setToDate(''); setDeptF(''); setMinTrainees(''); setMaxTrainees(''); setCoordF(''); setSearch(''); };

  const { data: lecturesData, isLoading: lecturesLoading } = useQuery({
    queryKey: ['group-lectures', expandedGroup],
    queryFn: () => api.get('/reports/group-lectures', { params: { group_name: expandedGroup } }).then(r => r.data),
    enabled: !!expandedGroup,
    staleTime: 5 * 60 * 1000,
    gcTime:    15 * 60 * 1000,
  });
  const { data: traineesData, isLoading: traineesLoading } = useQuery({
    queryKey: ['group-trainees', traineesGroup],
    queryFn: () => api.get('/reports/group-trainees', { params: { group_name: traineesGroup } }).then(r => r.data),
    enabled: !!traineesGroup,
    staleTime: 5 * 60 * 1000,
    gcTime:    15 * 60 * 1000,
  });

  const hasLectures = (g) => (g.scheduled_lectures ?? 0) > 0 || (g.completed_lectures ?? 0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-7xl my-6 flex flex-col" style={{ maxHeight: '90vh' }}>

        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex-shrink-0 bg-gradient-to-l from-[#1e3a5f]/5 to-white rounded-t-3xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-black text-gray-900">{title}</h2>
              <p className="text-sm text-gray-400 mt-1">
                {search.trim() ? `${filtered.length} من ${groups.length}` : groups.length} مجموعة
              </p>
            </div>
            <button onClick={onClose}
              className="p-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all">
              <X size={18} className="text-gray-600" />
            </button>
          </div>
          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text" value={search}
              onChange={e => { setSearch(e.target.value); setExpandedGroup(null); setTraineesGroup(null); }}
              placeholder="بحث باسم المجموعة..."
              className="w-full bg-gray-50 border border-gray-200 rounded-xl pr-10 pl-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-end">
            {/* Date from */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-gray-500">من تاريخ {filterType === 'expired' ? '(النهاية)' : '(البداية)'}</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]/30" />
            </div>
            {/* Date to */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-gray-500">إلى تاريخ</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]/30" />
            </div>
            {/* Dept */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-gray-500">القسم</label>
              <select value={deptF} onChange={e => setDeptF(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]/30 min-w-[90px]">
                <option value="">الكل</option>
                {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            {/* Trainee count range */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-gray-500">المتدربين (من - إلى)</label>
              <div className="flex gap-1">
                <input type="number" min="0" value={minTrainees} onChange={e => setMinTrainees(e.target.value)}
                  placeholder="من" className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 w-16 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]/30" />
                <input type="number" min="0" value={maxTrainees} onChange={e => setMaxTrainees(e.target.value)}
                  placeholder="إلى" className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 w-16 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]/30" />
              </div>
            </div>
            {/* Coordinator — only for expired */}
            {filterType === 'expired' && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-gray-500">المنسق</label>
                <select value={coordF} onChange={e => setCoordF(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]/30 min-w-[120px]">
                  <option value="">الكل</option>
                  {coordOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            {/* Clear */}
            {(fromDate||toDate||deptF||minTrainees||maxTrainees||coordF||search) && (
              <button onClick={clearFilters}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-all mt-4">
                <X size={11}/> مسح
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm text-right" style={{ minWidth: '1000px' }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b border-gray-100">
                {['اسم المجموعة','الكورس','القسم','المتدربين','تقدم المحاضرات','البداية','النهاية','المنسق',''].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={9} className="text-center py-12 text-gray-400">لا توجد مجموعات</td></tr>
                : filtered.map((g, i) => (
                <>
                  <tr key={g.external_id ?? i}
                    className={`border-b border-gray-50 transition-colors ${expandedGroup === g.group_name ? 'bg-blue-50/30' : 'hover:bg-gray-50/70'}`}>
                    <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap" style={{ minWidth: '300px' }}>
                      {g.group_name}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{g.course ?? '—'}</td>
                    <td className="px-4 py-3"><DeptBadge dept={getCoordDept(g)} /></td>

                    {/* Trainees button */}
                    <td className="px-4 py-3 relative">
                      <button
                        onClick={() => setTraineesGroup(traineesGroup === g.group_name ? null : g.group_name)}
                        className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 transition-all shadow-sm"
                      >{g.trainee_count ?? 0}</button>
                      {traineesGroup === g.group_name && (
                        <div className="absolute z-30 top-12 right-0 w-72 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-3 bg-indigo-600 text-white">
                            <span className="text-xs font-bold">المتدربين ({traineesData?.length ?? '...'})</span>
                            <button onClick={() => setTraineesGroup(null)}><X size={14} /></button>
                          </div>
                          {traineesLoading ? (
                            <div className="text-center text-xs text-gray-400 py-6">جاري التحميل...</div>
                          ) : !traineesData?.length ? (
                            <div className="text-center text-xs text-gray-400 py-6">لا يوجد متدربين</div>
                          ) : (
                            <div className="max-h-56 overflow-y-auto">
                              {traineesData.map((t, idx) => (
                                <div key={idx} className={`flex items-center justify-between px-4 py-2.5 text-xs ${idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}>
                                  <span className="text-indigo-600 font-mono font-medium">{t.phone ?? '—'}</span>
                                  <span className="font-semibold text-gray-800">{t.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Progress */}
                    <td className="px-4 py-3" style={{ minWidth: '160px' }}>
                      <ProgressBar
                        done={g.completed_lectures ?? 0}
                        total={g.scheduled_lectures ?? 0}
                        colorClass={hasLectures(g) ? 'bg-emerald-500' : 'bg-gray-300'}
                      />
                    </td>

                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{fmtDate(g.start_date)}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{fmtDate(g.end_date)}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{g.coordinators ?? '—'}</td>

                    {/* Lectures toggle */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setExpandedGroup(expandedGroup === g.group_name ? null : g.group_name)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-white text-xs font-medium transition-all shadow-sm whitespace-nowrap ${
                          hasLectures(g) ? 'bg-[#1e3a5f] hover:bg-[#15294a]' : 'bg-red-500 hover:bg-red-600'
                        }`}
                      >
                        <BookOpen size={12} />
                        المحاضرات
                        {expandedGroup === g.group_name ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                      </button>
                    </td>
                  </tr>

                  {/* Lectures expandable */}
                  {expandedGroup === g.group_name && (
                    <tr key={`lec-${g.group_name}`} className="border-b border-gray-100">
                      <td colSpan={9} className="px-6 py-4 bg-blue-50/40">
                        {lecturesLoading ? (
                          <div className="text-center text-sm text-gray-400 py-4">جاري التحميل...</div>
                        ) : !lecturesData?.lectures?.length ? (
                          <div className="flex items-center justify-center gap-2 py-4 text-red-400 text-sm">
                            <XCircle size={16} /> لا توجد محاضرات مسجلة لهذه المجموعة
                          </div>
                        ) : (
                          <div className="rounded-xl border border-blue-100 overflow-hidden">
                            <table className="w-full text-xs text-right">
                              <thead>
                                <tr className="bg-blue-600 text-white">
                                  {['#','النوع','التاريخ','الوقت','المدة','المدرب','الحالة','الحضور'].map(h => (
                                    <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {lecturesData.lectures.map((l, idx) => (
                                  <tr key={l.id ?? idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-blue-50/30'}>
                                    <td className="px-3 py-2 text-gray-400 font-mono">{idx + 1}</td>
                                    <td className="px-3 py-2">
                                      <span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-semibold ${l.session_type === 'main' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                                        {l.session_type === 'main' ? 'أساسية' : 'جانبية'}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtDate(l.date)}</td>
                                    <td className="px-3 py-2 text-gray-600">{l.time ?? '—'}</td>
                                    <td className="px-3 py-2 text-gray-600">{l.duration ?? '—'}</td>
                                    <td className="px-3 py-2 text-gray-700">{l.trainer ?? '—'}</td>
                                    <td className="px-3 py-2 text-gray-700">{l.status ?? '—'}</td>
                                    <td className="px-3 py-2 text-gray-700">{l.attendance ?? '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end flex-shrink-0 bg-gray-50/50 rounded-b-3xl">
          <button onClick={onClose}
            className="px-6 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl text-sm font-semibold transition-all">
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── REMARKS NOTES MODAL ─────────────────────────────────────────────────────
function RemarksNotesModal({ params, onClose }) {
  const LIMIT = 100;
  const [tab, setTab] = useState('main');

  // main tab state
  const [pageM, setPageM]   = useState(1);
  const [searchM, setSearchM] = useState('');
  const [fM, setFM]   = useState({ modal_from:'', modal_to:'', modal_dept:'', coordinator:'', has_remark:'' });
  const [afM, setAfM] = useState({});

  // zoom tab state
  const [pageZ, setPageZ]   = useState(1);
  const [searchZ, setSearchZ] = useState('');
  const [fZ, setFZ]   = useState({ modal_from:'', modal_to:'', modal_dept:'', coordinator:'', has_remark:'' });
  const [afZ, setAfZ] = useState({});

  // categories state
  const [pageC, setPageC]   = useState(1);
  const [searchC, setSearchC] = useState('');
  const [fC, setFC]   = useState({ modal_from:'', modal_to:'', modal_dept:'', assigned_to:'', category_filter:'' });
  const [afC, setAfC] = useState({});

  const { data: opts } = useQuery({
    queryKey: ['rnOpts'],
    queryFn: () => api.get('/reports/remarks-notes-options').then(r => r.data),
    staleTime: 10 * 60 * 1000,
  });
  const coordinators = opts?.coordinators ?? [];
  const categories   = opts?.categories   ?? [];
  const assignedTo   = opts?.assignedTo   ?? [];

  const applyM = () => { const c={}; Object.entries(fM).forEach(([k,v])=>{if(v&&v!=='All')c[k]=v;}); setAfM(c); setPageM(1); };
  const clearM = () => { setFM({modal_from:'',modal_to:'',modal_dept:'',coordinator:'',has_remark:''}); setAfM({}); setPageM(1); };
  const applyZ = () => { const c={}; Object.entries(fZ).forEach(([k,v])=>{if(v&&v!=='All')c[k]=v;}); setAfZ(c); setPageZ(1); };
  const clearZ = () => { setFZ({modal_from:'',modal_to:'',modal_dept:'',coordinator:'',has_remark:''}); setAfZ({}); setPageZ(1); };
  const applyC = () => { const c={}; Object.entries(fC).forEach(([k,v])=>{if(v&&v!=='All')c[k]=v;}); setAfC(c); setPageC(1); };
  const clearC = () => { setFC({modal_from:'',modal_to:'',modal_dept:'',assigned_to:'',category_filter:''}); setAfC({}); setPageC(1); };

  const { data: mData, isLoading: mLoad } = useQuery({
    queryKey: ['rnm', params, pageM, searchM, afM],
    queryFn: () => api.get('/reports/remarks-notes-main', { params: { ...params, page: pageM, limit: LIMIT, search: searchM, ...afM } }).then(r => r.data),
    staleTime: 2 * 60 * 1000,
  });
  const { data: zData, isLoading: zLoad } = useQuery({
    queryKey: ['rnz', params, pageZ, searchZ, afZ],
    queryFn: () => api.get('/reports/remarks-notes-zoom', { params: { ...params, page: pageZ, limit: LIMIT, search: searchZ, ...afZ } }).then(r => r.data),
    staleTime: 2 * 60 * 1000,
  });
  const { data: cData, isLoading: cLoad } = useQuery({
    queryKey: ['rnc', params, pageC, searchC, afC],
    queryFn: () => api.get('/reports/remarks-categories', { params: { ...params, page: pageC, limit: LIMIT, search: searchC, ...afC } }).then(r => r.data),
    staleTime: 2 * 60 * 1000,
  });

  const tpM = mData ? Math.ceil(mData.total / LIMIT) : 1;
  const tpZ = zData ? Math.ceil(zData.total / LIMIT) : 1;
  const tpC = cData ? Math.ceil(cData.total / LIMIT) : 1;

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-gray-50';
  const labelCls = 'block text-xs text-gray-400 mb-1 font-semibold';

  const PagBar = ({ page, setPage, total }) => total > 1 ? (
    <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/60">
      <button disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-200 disabled:opacity-40 hover:bg-gray-50">السابق</button>
      <span className="text-xs text-gray-500">{page} / {total}</span>
      <button disabled={page>=total} onClick={()=>setPage(p=>p+1)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-200 disabled:opacity-40 hover:bg-gray-50">التالي</button>
    </div>
  ) : null;

  const SearchBar = ({ val, setVal, onApply, total, placeholder }) => (
    <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-2">
      <form onSubmit={e=>{e.preventDefault();onApply();}} className="flex gap-2 flex-1">
        <input value={val} onChange={e=>setVal(e.target.value)} placeholder={placeholder}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">بحث</button>
      </form>
      <span className="text-xs text-gray-400 whitespace-nowrap">إجمالي: <b className="text-gray-700">{total ?? '—'}</b></span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-50" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm flex-shrink-0">
        <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
          <X className="w-5 h-5 text-gray-500" />
        </button>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-100"><FileText className="w-5 h-5 text-indigo-600" /></div>
          <div>
            <h2 className="text-xl font-black text-gray-900">ملحوظات الريماركات</h2>
            <p className="text-xs text-gray-400">مقارنة الغيابات بالريماركات وملخص التصنيفات</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-5">

        {/* ── SECTION 1: COMPARISON ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Section header + tabs */}
          <div className="px-5 py-3 border-b border-gray-100 bg-gradient-to-l from-blue-50/60 to-white flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-2">
              <button onClick={()=>setTab('main')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${tab==='main' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                📚 المحاضرات الأساسية
              </button>
              <button onClick={()=>setTab('zoom')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${tab==='zoom' ? 'bg-purple-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                🖥️ الجلسات الجانبية (Zoom)
              </button>
            </div>
            <h3 className="text-sm font-bold text-gray-700">القسم الأول — مقارنة الغيابات بالريماركات</h3>
          </div>

          {/* MAIN SESSION TAB */}
          {tab === 'main' && (
            <>
              <SearchBar val={searchM} setVal={setSearchM} onApply={applyM} total={mData?.total} placeholder="بحث باسم الطالب، المجموعة، أو الموبايل..." />
              {/* Filters */}
              <div className="px-5 py-3 bg-gray-50/50 border-b border-gray-100 grid grid-cols-2 md:grid-cols-5 gap-3">
                <div>
                  <label className={labelCls}>من تاريخ</label>
                  <input type="date" value={fM.modal_from} onChange={e=>setFM(f=>({...f,modal_from:e.target.value}))} className={inputCls}/>
                </div>
                <div>
                  <label className={labelCls}>إلى تاريخ</label>
                  <input type="date" value={fM.modal_to} onChange={e=>setFM(f=>({...f,modal_to:e.target.value}))} className={inputCls}/>
                </div>
                <div>
                  <label className={labelCls}>القسم</label>
                  <select value={fM.modal_dept} onChange={e=>setFM(f=>({...f,modal_dept:e.target.value}))} className={inputCls}>
                    <option value="">الكل</option>
                    <option value="General">عام</option>
                    <option value="Private">خاص</option>
                    <option value="Semi">شبه خاص</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>المنسق</label>
                  <select value={fM.coordinator} onChange={e=>setFM(f=>({...f,coordinator:e.target.value}))} className={inputCls}>
                    <option value="">الكل</option>
                    {coordinators.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>حالة الريمارك</label>
                  <select value={fM.has_remark} onChange={e=>setFM(f=>({...f,has_remark:e.target.value}))} className={inputCls}>
                    <option value="">الكل</option>
                    <option value="1">✅ موجود</option>
                    <option value="0">❌ غير موجود</option>
                  </select>
                </div>
                <div className="col-span-2 md:col-span-5 flex gap-2 justify-end">
                  <button onClick={applyM} className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700">تطبيق</button>
                  <button onClick={clearM} className="px-4 py-1.5 bg-gray-200 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-300">مسح</button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right" style={{minWidth:'1000px'}}>
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['اسم الطالب','الموبايل','المجموعة','القسم','المنسق','تاريخ الغياب','تاريخ الريمارك المتوقع','حالة الريمارك','تفاصيل الريمارك','المسؤول'].map(h=>(
                        <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {mLoad ? <SkeletonRows cols={10}/> :
                     !mData?.rows?.length ? <EmptyRow cols={10}/> :
                     mData.rows.map((row,i)=>(
                       <tr key={row.id??i} className={`hover:bg-gray-50/70 transition-colors ${!row.has_remark ? 'bg-red-50/40' : ''}`}>
                         <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{row.student_name??'—'}</td>
                         <td className="px-4 py-3"><span className="font-mono text-xs text-blue-600">{row.student_phone??'—'}</span></td>
                         <td className="px-4 py-3 text-xs whitespace-nowrap text-gray-700">{row.group_name??'—'}</td>
                         <td className="px-4 py-3"><DeptBadge dept={row.dept_type}/></td>
                         <td className="px-4 py-3 text-xs whitespace-nowrap text-gray-600">{row.coordinators??'—'}</td>
                         <td className="px-4 py-3 text-xs whitespace-nowrap font-medium text-gray-700">{fmtDate(row.absence_date)}</td>
                         <td className="px-4 py-3 text-xs whitespace-nowrap font-bold text-orange-600">{fmtDate(row.expected_remark_date)}</td>
                         <td className="px-4 py-3">
                           {row.has_remark
                             ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700"><CheckCircle size={11}/>موجود</span>
                             : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700"><XCircle size={11}/>غير موجود</span>}
                         </td>
                         <td className="px-4 py-3 text-xs text-gray-500" style={{maxWidth:'200px',overflowWrap:'break-word'}}>{row.remark_details??'—'}</td>
                         <td className="px-4 py-3 text-xs whitespace-nowrap text-gray-600">{row.assigned_to??'—'}</td>
                       </tr>
                     ))}
                  </tbody>
                </table>
              </div>
              <PagBar page={pageM} setPage={setPageM} total={tpM}/>
            </>
          )}

          {/* ZOOM CALL TAB */}
          {tab === 'zoom' && (
            <>
              <SearchBar val={searchZ} setVal={setSearchZ} onApply={applyZ} total={zData?.total} placeholder="بحث باسم العميل، المجموعة، أو الموبايل..." />
              {/* Filters */}
              <div className="px-5 py-3 bg-gray-50/50 border-b border-gray-100 grid grid-cols-2 md:grid-cols-5 gap-3">
                <div>
                  <label className={labelCls}>من تاريخ</label>
                  <input type="date" value={fZ.modal_from} onChange={e=>setFZ(f=>({...f,modal_from:e.target.value}))} className={inputCls}/>
                </div>
                <div>
                  <label className={labelCls}>إلى تاريخ</label>
                  <input type="date" value={fZ.modal_to} onChange={e=>setFZ(f=>({...f,modal_to:e.target.value}))} className={inputCls}/>
                </div>
                <div>
                  <label className={labelCls}>القسم</label>
                  <select value={fZ.modal_dept} onChange={e=>setFZ(f=>({...f,modal_dept:e.target.value}))} className={inputCls}>
                    <option value="">الكل</option>
                    <option value="General">عام</option>
                    <option value="Private">خاص</option>
                    <option value="Semi">شبه خاص</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>المنسق</label>
                  <select value={fZ.coordinator} onChange={e=>setFZ(f=>({...f,coordinator:e.target.value}))} className={inputCls}>
                    <option value="">الكل</option>
                    {coordinators.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>حالة الريمارك</label>
                  <select value={fZ.has_remark} onChange={e=>setFZ(f=>({...f,has_remark:e.target.value}))} className={inputCls}>
                    <option value="">الكل</option>
                    <option value="1">✅ موجود</option>
                    <option value="0">⚠️ غير موجود</option>
                  </select>
                </div>
                <div className="col-span-2 md:col-span-5 flex gap-2 justify-end">
                  <button onClick={applyZ} className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700">تطبيق</button>
                  <button onClick={clearZ} className="px-4 py-1.5 bg-gray-200 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-300">مسح</button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right" style={{minWidth:'1000px'}}>
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['اسم العميل','الموبايل','المجموعة','القسم','المنسق','تاريخ الغياب','تاريخ الريمارك المتوقع','حالة الريمارك','تفاصيل الريمارك','المسؤول'].map(h=>(
                        <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {zLoad ? <SkeletonRows cols={10}/> :
                     !zData?.rows?.length ? <EmptyRow cols={10}/> :
                     zData.rows.map((row,i)=>(
                       <tr key={row.remark_id??i} className={`hover:bg-gray-50/70 transition-colors ${!row.has_remark ? 'bg-amber-50/40' : ''}`}>
                         <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{row.client_name??'—'}</td>
                         <td className="px-4 py-3"><span className="font-mono text-xs text-blue-600">{row.client_phone??'—'}</span></td>
                         <td className="px-4 py-3 text-xs whitespace-nowrap text-gray-700">{row.group_name??'—'}</td>
                         <td className="px-4 py-3"><DeptBadge dept={row.dept_type}/></td>
                         <td className="px-4 py-3 text-xs whitespace-nowrap text-gray-600">{row.coordinators??'—'}</td>
                         <td className="px-4 py-3 text-xs whitespace-nowrap font-medium text-gray-700">{fmtDate(row.session_date)}</td>
                         <td className="px-4 py-3 text-xs whitespace-nowrap font-bold text-orange-600">{fmtDate(row.expected_remark_date)}</td>
                         <td className="px-4 py-3">
                           {row.has_remark
                             ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700"><CheckCircle size={11}/>موجود</span>
                             : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700"><AlertTriangle size={11}/>غير موجود</span>}
                         </td>
                         <td className="px-4 py-3 text-xs text-gray-500" style={{maxWidth:'200px',overflowWrap:'break-word'}}>{row.remark_details??'—'}</td>
                         <td className="px-4 py-3 text-xs whitespace-nowrap text-gray-600">
                           {row.assigned_to ?? '—'}
                           {row.has_remark && row.assigned_to && (
                             (row.coordinators && row.assigned_to.trim().toLowerCase() !== row.coordinators.trim().toLowerCase()) ||
                             !row.dept_type
                           ) && (
                             <span className="mr-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-100 text-yellow-700 border border-yellow-200" title={`الريمارك عمله: ${row.assigned_to}`}>
                               ⚠ موظف آخر
                             </span>
                           )}
                         </td>
                       </tr>
                     ))}
                  </tbody>
                </table>
              </div>
              <PagBar page={pageZ} setPage={setPageZ} total={tpZ}/>
            </>
          )}
        </div>

        {/* ── SECTION 2: CATEGORIES SUMMARY ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gradient-to-l from-purple-50/60 to-white flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-bold text-gray-700">القسم الثاني — ملخص التصنيفات</h3>
            <span className="text-xs text-gray-400">إجمالي: <b className="text-gray-700">{cData?.total ?? '—'}</b> سجل</span>
          </div>
          <SearchBar val={searchC} setVal={setSearchC} onApply={applyC} total={cData?.total} placeholder="بحث بالتصنيف، اسم العميل، أو الموبايل..." />
          {/* Filters */}
          <div className="px-5 py-3 bg-gray-50/50 border-b border-gray-100 grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className={labelCls}>من تاريخ</label>
              <input type="date" value={fC.modal_from} onChange={e=>setFC(f=>({...f,modal_from:e.target.value}))} className={inputCls}/>
            </div>
            <div>
              <label className={labelCls}>إلى تاريخ</label>
              <input type="date" value={fC.modal_to} onChange={e=>setFC(f=>({...f,modal_to:e.target.value}))} className={inputCls}/>
            </div>
            <div>
              <label className={labelCls}>القسم</label>
              <select value={fC.modal_dept} onChange={e=>setFC(f=>({...f,modal_dept:e.target.value}))} className={inputCls}>
                <option value="">الكل</option>
                <option value="General">عام</option>
                <option value="Private">خاص</option>
                <option value="Semi">شبه خاص</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>التصنيف</label>
              <select value={fC.category_filter} onChange={e=>setFC(f=>({...f,category_filter:e.target.value}))} className={inputCls}>
                <option value="">الكل</option>
                {categories.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>المسؤول</label>
              <select value={fC.assigned_to} onChange={e=>setFC(f=>({...f,assigned_to:e.target.value}))} className={inputCls}>
                <option value="">الكل</option>
                {assignedTo.map(a=><option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="col-span-2 md:col-span-5 flex gap-2 justify-end">
              <button onClick={applyC} className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700">تطبيق</button>
              <button onClick={clearC} className="px-4 py-1.5 bg-gray-200 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-300">مسح</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right" style={{minWidth:'900px'}}>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {['التصنيف','العدد','تاريخ الريمارك','المنسق','اسم العميل','الموبايل','المجموعة'].map(h=>(
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cLoad ? <SkeletonRows cols={7}/> :
                 !cData?.rows?.length ? <EmptyRow cols={7}/> :
                 (() => {
                   let lastCat = null;
                   return cData.rows.map((row,i) => {
                     const isNew = row.category !== lastCat;
                     lastCat = row.category;
                     const isAttendance = row.category === 'Attendance Main Session' || row.category === 'Attendance Zoom Call';
                     return (
                       <tr key={row.id??i} className={`border-b border-gray-50 hover:bg-gray-50/70 transition-colors ${isAttendance ? 'bg-blue-50/20' : ''}`}>
                         <td className="px-4 py-3">
                           {isNew ? (
                             <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-100 text-indigo-700 whitespace-nowrap">
                               {row.category}
                             </span>
                           ) : null}
                         </td>
                         <td className="px-4 py-3">
                           {isNew ? (
                             <span className="inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-black bg-indigo-600 text-white">
                               {row.category_count}
                             </span>
                           ) : null}
                         </td>
                         <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{fmtDate(row.remark_date_val)}</td>
                         <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{row.coordinators??'—'}</td>
                         <td className="px-4 py-3 text-xs font-semibold text-gray-800 whitespace-nowrap">{row.client_name??'—'}</td>
                         <td className="px-4 py-3"><span className="font-mono text-xs text-blue-600">{row.client_phone??'—'}</span></td>
                         <td className="px-4 py-3 text-xs text-gray-600" style={{maxWidth:'180px',overflowWrap:'anywhere'}}>{row.group_name??'—'}</td>
                       </tr>
                     );
                   });
                 })()}
              </tbody>
            </table>
          </div>
          <PagBar page={pageC} setPage={setPageC} total={tpC}/>
        </div>

      </div>
    </div>
  );
}

// ─── LIST MODAL ───────────────────────────────────────────────────────────────
// extraFilters: array of keys to show → ['trainer','coordinator','date','dept']
function ObDatesPopup({ groupName, category, label, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['ob-dates', groupName, category],
    queryFn: () => api.get('/reports/lectures-list', {
      params: { session_type: 'side', group_name: groupName, category, limit: 200 }
    }).then(r => r.data),
    staleTime: 60000,
  });
  const rows = data?.rows ?? [];
  const fmtD = (d) => { try { return new Date(d).toLocaleDateString('ar-EG', { weekday:'short', year:'numeric', month:'short', day:'numeric' }); } catch { return d; } };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 w-80 max-h-96 flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border-b border-amber-100">
          <div>
            <p className="text-xs font-bold text-amber-800">جلسات {label}</p>
            <p className="text-[10px] text-amber-600 truncate max-w-[200px]">{groupName}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-amber-100 text-amber-600"><X size={14}/></button>
        </div>
        {/* Body */}
        <div className="overflow-y-auto flex-1 p-3 space-y-1.5">
          {isLoading ? (
            <p className="text-center text-gray-400 text-xs py-4">جاري التحميل...</p>
          ) : rows.length === 0 ? (
            <p className="text-center text-gray-400 text-xs py-4">لا توجد جلسات</p>
          ) : rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50/60 border border-amber-100">
              <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-800 text-[10px] font-black flex items-center justify-center flex-shrink-0">{i+1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-800">{fmtD(r.date)}</p>
                <p className="text-[10px] text-gray-400">{r.time} · {r.trainer}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-gray-100 text-center">
          <span className="text-[10px] text-gray-400">{rows.length} جلسة</span>
        </div>
      </div>
    </div>
  );
}

function ListModal({ title, endpoint, params, columns, onClose, extraFilters = [] }) {
  const [page, setPage]             = useState(1);
  const [search, setSearch]         = useState('');
  const [appliedSearch, setApplied] = useState('');
  const [obPopup, setObPopup]       = useState(null); // { groupName, category, label }

  const show = Array.isArray(extraFilters) ? extraFilters : (extraFilters ? ['trainer','coordinator','date'] : []);

  // Extra filters state
  const [modalF, setModalF] = useState({
    trainer: '', coordinator: '', modal_from: '', modal_to: '', modal_dept: '',
    assigned_to: '', priority: '', category_search: '', status_filter: '',
  });
  const [appliedMF, setAppMF] = useState({});
  const LIMIT = 100;

  const allParams = { ...params, page, limit: LIMIT, search: appliedSearch, ...appliedMF };

  const { data, isLoading } = useQuery({
    queryKey: [endpoint, params, page, appliedSearch, appliedMF],
    queryFn: () => api.get(endpoint, { params: allParams }).then(r => r.data),
    staleTime: 2 * 60 * 1000,
    gcTime:    5 * 60 * 1000,
  });

  // Fetch dropdown options (only when category_search filter is shown)
  const needsOpts = show.includes('category_search') || show.includes('assigned_to') || show.includes('coordinator');
  const { data: filterOpts } = useQuery({
    queryKey: ['rnOpts'],
    queryFn: () => api.get('/reports/remarks-notes-options').then(r => r.data),
    staleTime: 10 * 60 * 1000,
    enabled: needsOpts,
  });

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setApplied(search);
    setAppMF(Object.fromEntries(Object.entries(modalF).filter(([, v]) => v !== '' && v !== 'All')));
  };
  const handleClear = () => {
    setSearch(''); setApplied('');
    setModalF({ trainer: '', coordinator: '', modal_from: '', modal_to: '', modal_dept: '', assigned_to: '', priority: '', category_search: '', status_filter: '' });
    setAppMF({});
    setPage(1);
  };

  const hasActiveFilters = appliedSearch || Object.keys(appliedMF).length > 0;

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 1;

  function CopyBadge({ val }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
      navigator.clipboard.writeText(val).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    };
    return (
      <span
        onClick={handleCopy}
        title="اضغط للنسخ"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold cursor-pointer select-all transition-all duration-150"
        style={{
          minWidth: '140px', maxWidth: '220px', overflowWrap: 'anywhere', whiteSpace: 'normal',
          background: copied ? '#d1fae5' : '#ecfdf5',
          color: copied ? '#065f46' : '#065f46',
          border: copied ? '1px solid #6ee7b7' : '1px solid #a7f3d0',
        }}
      >
        {copied ? '✅ تم النسخ!' : `✓ ${val}`}
      </span>
    );
  }

  const renderCell = (row, col) => {
    const val = row[col.key];
    if (col.type === 'date') return fmtDate(val);
    if (col.type === 'badge') return <DeptBadge dept={val} />;
    if (col.type === 'type') return (
      <span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-semibold ${val === 'main' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
        {val === 'main' ? 'أساسية' : 'جانبية'}
      </span>
    );
    if (col.type === 'present') return (
      val === 1 || val === true
        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700"><CheckCircle size={11}/>حاضر</span>
        : val === 0 || val === false
        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700"><XCircle size={11}/>غائب</span>
        : <span className="text-gray-400 text-xs">—</span>
    );
    if (col.type === 'trainee_total') return (
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-black bg-slate-100 text-slate-700">
        {val ?? 0}
      </span>
    );
    if (col.type === 'absent_count') return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
        <XCircle size={11}/>{val ?? 0} غائب
      </span>
    );
    if (col.type === 'present_count') return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">
        <CheckCircle size={11}/>{val ?? 0} حاضر
      </span>
    );
    if (col.type === 'duration') return val
      ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700"><Clock size={11}/>{val}</span>
      : <span className="text-gray-300 text-xs">—</span>;
    if (col.type === 'category') {
      const catMap = {
        onboarding:   { label: 'Onboarding',   cls: 'bg-blue-100 text-blue-700' },
        offboarding:  { label: 'Offboarding',  cls: 'bg-orange-100 text-orange-700' },
        regular:      { label: 'جلسة عادية',  cls: 'bg-green-100 text-green-700' },
        compensatory: { label: 'تعويضية',     cls: 'bg-purple-100 text-purple-700' },
      };
      const cfg = catMap[val?.toLowerCase()] ?? { label: val ?? '—', cls: 'bg-gray-100 text-gray-600' };
      return <span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-semibold ${cfg.cls}`}>{cfg.label}</span>;
    }
    if (col.type === 'ob_count') {
      const count = val ?? 0;
      const catKey = col.key.replace('_count', ''); // onboarding / offboarding / compensatory
      return (
        <button
          disabled={count === 0}
          onClick={() => count > 0 && setObPopup({ groupName: row.group_name, category: catKey, label: col.label })}
          className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black transition-transform ${
            count > 0 ? 'bg-amber-100 text-amber-700 hover:scale-110 hover:bg-amber-200 cursor-pointer' : 'bg-gray-100 text-gray-400 cursor-default'
          }`}
        >{count}</button>
      );
    }
    if (col.type === 'urgency') {
      const uMap = {
        overdue:  { label: '🔴 متأخر جداً', cls: 'bg-red-200 text-red-900 border-red-300' },
        normal:   { label: '📋 عادي',       cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
        important:{ label: '⚠ مهم',         cls: 'bg-orange-100 text-orange-700 border-orange-200' },
        urgent:   { label: '⚡ عاجل',        cls: 'bg-red-100 text-red-700 border-red-200' },
        ok:       { label: '✓ بخير',         cls: 'bg-green-100 text-green-700 border-green-200' },
      };
      const u = uMap[val] ?? uMap.ok;
      return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${u.cls}`}>{u.label}</span>;
    }
    if (col.type === 'priority') {
      const pMap = {
        'عاجلة': 'bg-red-100 text-red-700',
        'هامة':  'bg-orange-100 text-orange-700',
      };
      return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${pMap[val] ?? 'bg-gray-100 text-gray-600'}`}>{val ?? '—'}</span>;
    }
    if (col.type === 'details') return val ? (
      <div style={{ fontSize: '12px', color: '#4b5563', lineHeight: '1.7', minWidth: '180px', maxWidth: '320px', overflowWrap: 'break-word' }}>
        {val}
      </div>
    ) : <span className="text-gray-300">—</span>;
    if (col.type === 'active_group') return val ? (
      <CopyBadge val={val} />
    ) : <span className="text-gray-300 text-xs">—</span>;
    if (col.type === 'phone') return val ? (
      <span className="font-mono text-xs text-blue-600 font-medium">{val}</span>
    ) : <span className="text-gray-300 text-xs">—</span>;
    return val ?? '—';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-7xl my-6 flex flex-col" style={{ maxHeight: '90vh' }}>
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex-shrink-0 bg-gradient-to-l from-[#1e3a5f]/5 to-white rounded-t-3xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-black text-gray-900">{title}</h2>
              {data && <p className="text-sm text-gray-400 mt-1">إجمالي: <span className="font-bold text-gray-700">{data.total?.toLocaleString()}</span> سجل</p>}
            </div>
            <button onClick={onClose} className="p-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all">
              <X size={18} className="text-gray-600" />
            </button>
          </div>
          <form onSubmit={handleSearch} className="space-y-3">
            {/* Search bar */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="بحث باسم المجموعة..."
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl pr-10 pl-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
                />
              </div>
              <button type="submit"
                className="px-5 py-2.5 bg-[#1e3a5f] text-white rounded-xl text-sm font-semibold hover:bg-[#15294a] transition-all whitespace-nowrap">
                بحث
              </button>
              {hasActiveFilters && (
                <button type="button" onClick={handleClear}
                  className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-200 transition-all whitespace-nowrap">
                  مسح الكل
                </button>
              )}
            </div>

            {/* Extra filters row */}
            {show.length > 0 && (
              <div className={`grid gap-2 pt-1 ${
                show.length === 1 ? 'grid-cols-1 max-w-xs' :
                show.length === 2 ? 'grid-cols-2' :
                show.length === 3 ? 'grid-cols-3' :
                'grid-cols-2 md:grid-cols-4'
              }`}>
                {show.includes('trainer') && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-semibold">المدرب</label>
                    <input type="text" value={modalF.trainer}
                      onChange={e => setModalF(f => ({ ...f, trainer: e.target.value }))}
                      placeholder="اسم المدرب..."
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
                    />
                  </div>
                )}
                {show.includes('coordinator') && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-semibold">المنسق</label>
                    <select value={modalF.coordinator}
                      onChange={e => setModalF(f => ({ ...f, coordinator: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
                    >
                      <option value="">الكل</option>
                      {(filterOpts?.coordinators ?? []).map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                )}
                {show.includes('date') && (<>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-semibold">من تاريخ</label>
                    <input type="date" value={modalF.modal_from}
                      onChange={e => setModalF(f => ({ ...f, modal_from: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-semibold">إلى تاريخ</label>
                    <input type="date" value={modalF.modal_to}
                      onChange={e => setModalF(f => ({ ...f, modal_to: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
                    />
                  </div>
                </>)}
                {show.includes('dept') && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-semibold">القسم</label>
                    <select value={modalF.modal_dept}
                      onChange={e => setModalF(f => ({ ...f, modal_dept: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
                    >
                      <option value="">الكل</option>
                      <option value="General">عام</option>
                      <option value="Private">خاص</option>
                      <option value="Semi">شبه خاص</option>
                    </select>
                  </div>
                )}
                {show.includes('assigned_to') && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-semibold">المسؤول</label>
                    <select value={modalF.assigned_to}
                      onChange={e => setModalF(f => ({ ...f, assigned_to: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
                    >
                      <option value="">الكل</option>
                      {(filterOpts?.assignedTo ?? []).map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                )}
                {show.includes('priority') && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-semibold">الأهمية</label>
                    <select value={modalF.priority}
                      onChange={e => setModalF(f => ({ ...f, priority: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
                    >
                      <option value="">الكل</option>
                      <option value="عاجلة">عاجلة</option>
                      <option value="هامة">هامة</option>
                      <option value="عادية">عادية</option>
                    </select>
                  </div>
                )}
                {show.includes('category_search') && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-semibold">التصنيف</label>
                    <select value={modalF.category_search}
                      onChange={e => setModalF(f => ({ ...f, category_search: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
                    >
                      <option value="">الكل</option>
                      {(filterOpts?.categories ?? []).map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                )}
                {show.includes('status_filter') && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-semibold">الحالة</label>
                    <select value={modalF.status_filter}
                      onChange={e => setModalF(f => ({ ...f, status_filter: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
                    >
                      <option value="">الكل</option>
                      <option value="غير منتهية">غير منتهية</option>
                      <option value="إنتهت">إنتهت</option>
                    </select>
                  </div>
                )}
              </div>
            )}
          </form>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm text-right" style={{ minWidth: '700px' }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b border-gray-100">
                {columns.map(c => (
                  <th key={c.key} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <SkeletonRows cols={columns.length} />
              ) : !data?.rows?.length ? (
                <EmptyRow cols={columns.length} />
              ) : (
                data.rows.map((row, i) => (
                  <tr key={row.id ?? i} className={`border-b border-gray-50 transition-colors hover:bg-gray-50/70 ${i % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                    {columns.map(c => (
                      <td key={c.key} className={`px-4 py-3 text-gray-700 ${c.noWrap !== false ? 'whitespace-nowrap' : ''} ${c.key === 'group_name' ? 'font-semibold text-gray-900' : ''}`}>
                        {renderCell(row, c)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-3xl flex-shrink-0">
          <div className="flex items-center gap-2">
            {totalPages > 1 && <>
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium disabled:opacity-40 hover:bg-white transition-all">السابق</button>
              <span className="text-sm text-gray-500 font-medium">{page} / {totalPages}</span>
              <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium disabled:opacity-40 hover:bg-white transition-all">التالي</button>
            </>}
          </div>
          <button onClick={onClose}
            className="px-6 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl text-sm font-semibold transition-all">إغلاق</button>
        </div>
      </div>
      {/* Ob-count dates popup */}
      {obPopup && (
        <ObDatesPopup
          groupName={obPopup.groupName}
          category={obPopup.category}
          label={obPopup.label}
          onClose={() => setObPopup(null)}
        />
      )}
    </div>
  );
}

// ─── CODE PROBLEMS MODAL ──────────────────────────────────────────────────────
// ─── STATUS CONFIG ────────────────────────────────────────────────────────────
const STATUS_CFG = {
  new:         { label: 'جديد',        emoji: '🆕', dot: 'bg-red-500',     badge: 'bg-red-100 text-red-700 border-red-200',         btn: 'hover:bg-red-50 hover:border-red-300'      },
  reported:    { label: 'تم الإبلاغ',  emoji: '📨', dot: 'bg-blue-500',    badge: 'bg-blue-100 text-blue-700 border-blue-200',      btn: 'hover:bg-blue-50 hover:border-blue-300'    },
  in_progress: { label: 'قيد الحل',    emoji: '⏳', dot: 'bg-amber-500',   badge: 'bg-amber-100 text-amber-700 border-amber-200',   btn: 'hover:bg-amber-50 hover:border-amber-300'  },
  wont_repeat: { label: 'لن تتكرر',    emoji: '✋', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', btn: 'hover:bg-emerald-50 hover:border-emerald-300' },
  exception:   { label: 'استثناء',     emoji: '🔕', dot: 'bg-slate-400',   badge: 'bg-slate-100 text-slate-600 border-slate-200',   btn: 'hover:bg-slate-50 hover:border-slate-300'  },
  resolved:    { label: 'تم حلها',     emoji: '✅', dot: 'bg-green-600',   badge: 'bg-green-100 text-green-700 border-green-200',   btn: 'hover:bg-green-50 hover:border-green-300'  },
};

function CodeProblemsModal({ params, onClose }) {
  const qc = useQueryClient();

  // ── filters
  const [search,    setSearch]    = useState('');
  const [fSection,  setFSection]  = useState('all');
  const [fProbType, setFProbType] = useState('');
  const [fDept,     setFDept]     = useState('');
  const [fCoord,    setFCoord]    = useState('');
  const [fStatus,   setFStatus]   = useState('');   // '' | 'new' | 'reported' | 'in_progress' | 'exception'

  // ── status editor
  const [editKey,  setEditKey]  = useState(null);   // { group_name, problem_type, session_type }
  const [editForm, setEditForm] = useState({ status: 'new', note: '' });
  const [saving,   setSaving]   = useState(false);
  const [saveError, setSaveError] = useState(null);

  // ── data
  const showResolved = fStatus === 'wont_repeat' || fStatus === 'exception' || fStatus === 'resolved';
  const { data, isLoading } = useQuery({
    queryKey: ['code-problems-modal', params, showResolved],
    queryFn:  () => api.get('/reports/code-problems', { params: { ...params, show_resolved: showResolved || undefined } }).then(r => r.data),
    staleTime: 5 * 60 * 1000, gcTime: 15 * 60 * 1000,
  });
  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ['problem-statuses'],
    queryFn:  () => api.get('/reports/problem-statuses').then(r => r.data),
    staleTime: 1 * 60 * 1000,
  });

  // Build status map: `group|type|session` → record
  const statusMap = {};
  (statusData ?? []).forEach(s => {
    statusMap[`${s.group_name}|${s.problem_type}|${s.session_type}`] = s;
  });
  const getStatus = (p, sessionType) =>
    statusMap[`${p.group_name}|${p.problem_type}|${sessionType}`] ?? null;
  const getStatusKey = (p) => p._resolved_status ?? p._status?.status ?? 'new';

  // ── enrich problems with status
  const mainProbs = (data?.main_problems ?? []).map(p => ({
    ...p, _session: 'main', _status: getStatus(p, 'main'),
  }));
  const sideProbs = (data?.zoom_problems ?? []).map(p => ({
    ...p, _session: 'side', _status: getStatus(p, 'side'),
  }));
  const allEnriched = [...mainProbs, ...sideProbs];

  // ── unique dropdown values
  const probTypes = [...new Set(allEnriched.map(p => p.problem_type).filter(Boolean))].sort();
  const depts     = [...new Set(allEnriched.map(p => p.dept_type).filter(Boolean))].sort();
  const coords    = [...new Set(allEnriched.map(p => p.coordinators).filter(Boolean))].sort();

  // ── status counts: active from allEnriched + resolved from statusData
  const statusCounts = { new: 0, reported: 0, in_progress: 0, exception: 0, wont_repeat: 0, resolved: 0 };
  allEnriched.forEach(p => { if (statusCounts[getStatusKey(p)] !== undefined) statusCounts[getStatusKey(p)]++; });
  // Count wont_repeat/exception/resolved from statusData (they're excluded from allEnriched by default)
  if (!showResolved && statusData) {
    statusCounts.wont_repeat = statusData.filter(s => s.status === 'wont_repeat').length;
    statusCounts.exception   = statusData.filter(s => s.status === 'exception').length;
    statusCounts.resolved    = statusData.filter(s => s.status === 'resolved').length;
  }
  const totalAll = allEnriched.length + (showResolved ? 0 : statusCounts.wont_repeat + statusCounts.exception + statusCounts.resolved);

  // ── filter logic
  const applyFilters = (rows) => rows.filter(p => {
    const sk = getStatusKey(p);
    // Hide resolved (wont_repeat / exception) by default unless explicitly selected or it's a repeated violation
    if (!fStatus && !search && !p.repeated_violation && (sk === 'wont_repeat' || sk === 'exception' || sk === 'resolved')) return false;
    if (search    && !p.group_name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (fProbType && p.problem_type !== fProbType)  return false;
    if (fDept     && p.dept_type    !== fDept)       return false;
    if (fCoord    && p.coordinators !== fCoord)      return false;
    if (fStatus) {
      if (fStatus === 'new' && sk !== 'new')      return false;
      if (fStatus !== 'new' && sk !== fStatus)    return false;
    }
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
  };

  // ── save status
  const handleSave = async () => {
    if (!editKey || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.put('/reports/problem-status', { ...editKey, ...editForm, actual: editKey.actual });
      await qc.invalidateQueries({ queryKey: ['problem-statuses'] });
      await qc.invalidateQueries({ queryKey: ['code-problems-modal'] });
      // Auto-filter to show the saved status so user sees the result
      if (['reported', 'wont_repeat', 'exception'].includes(editForm.status)) {
        setFStatus(editForm.status);
      }
      setEditKey(null);
    } catch(e) {
      console.error(e);
      setSaveError(e?.response?.data?.error || 'حدث خطأ أثناء الحفظ، حاول مرة أخرى');
    } finally { setSaving(false); }
  };

  // ── UI helpers
  const problemBadge = (type) => {
    const cls =
      type === 'عدد محاضرات زيادة'       || type === 'زووم كول زيادة'         ? 'bg-orange-100 text-orange-700 border-orange-200' :
      type === 'تاريخ أول محاضرة غلط'    || type === 'زووم كول ناقصة'         ? 'bg-red-100 text-red-700 border-red-200' :
      type === 'تاريخ آخر محاضرة غلط'    || type === 'تاريخ آخر زووم كول غلط' ? 'bg-purple-100 text-purple-700 border-purple-200' :
      'bg-yellow-100 text-yellow-800 border-yellow-200';
    return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${cls}`}>{type}</span>;
  };

  const StatusBadge = ({ p }) => {
    const key  = getStatusKey(p);
    const cfg  = STATUS_CFG[key];
    const note = p._status?.note;
    const by   = p._status?.updated_by_name;
    return (
      <button
        onClick={() => openEditor(p)}
        title={note ? `ملاحظة: ${note}${by ? ` — ${by}` : ''}` : 'انقر لتغيير الحالة'}
        className={`group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold border transition-all
          ${cfg.badge} ${cfg.btn} hover:shadow-sm`}
      >
        <span>{cfg.emoji}</span>
        <span>{cfg.label}</span>
        <Edit3 size={10} className="opacity-0 group-hover:opacity-60 transition-opacity" />
      </button>
    );
  };

  const selectCls = 'bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] min-w-[130px]';
  const hasFilters = search || fSection !== 'all' || fProbType || fDept || fCoord || fStatus;

  const ProbTable = ({ rows, cols, sectionLabel, sectionColor, sectionBg, dotColor, labelFirst }) => (
    <div>
      <div className={`flex items-center gap-2 px-5 py-3 ${sectionBg} border-b ${sectionColor} sticky top-0 z-10`}>
        <span className={`w-2 h-2 rounded-full ${dotColor} flex-shrink-0`} />
        <span className={`text-sm font-bold`}>{sectionLabel}</span>
        <span className={`mr-auto text-xs font-bold px-2 py-0.5 rounded-full ${sectionBg.replace('/70','')}`}>{rows.length}</span>
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
             const rowBg = getStatusKey(p) === 'exception'   ? 'bg-slate-50/50'   :
                           getStatusKey(p) === 'wont_repeat'  ? 'bg-emerald-50/30' :
                           getStatusKey(p) === 'in_progress'  ? 'bg-amber-50/30'   :
                           getStatusKey(p) === 'reported'     ? 'bg-blue-50/20'    : '';
             return (
               <tr key={i} className={`border-b border-gray-50 hover:bg-gray-50/60 transition-colors ${rowBg}`}>
                 <td className="px-4 py-3 text-xs" style={{ maxWidth: '240px', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                   <CopyButton text={p.group_name} />
                 </td>
                 <td className="px-4 py-3 whitespace-nowrap text-xs font-mono text-gray-500">{p.first_date ?? '—'}</td>
                 <td className="px-4 py-3 whitespace-nowrap">{problemBadge(p.problem_type)}</td>
                 <td className="px-4 py-3 text-xs text-gray-600" style={{ maxWidth: '260px', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                   {p.detail}
                   {p.repeated_violation && (
                     <div className="mt-1 flex items-start gap-1 text-[10px] font-bold text-orange-700 bg-orange-50 border border-orange-200 rounded px-1.5 py-1">
                       <span>⚠</span>
                       <span>
                         سبق وضع حالة "{p.previous_status === 'wont_repeat' ? 'لن تتكرر' : 'استثناء'}" عند العدد {p.previous_actual} — الموظف كرر الخطأ وأصبح {p.actual}
                       </span>
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-7xl my-6 flex flex-col" style={{ maxHeight: '92vh' }}>

        {/* ── HEADER ── */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex-shrink-0 bg-gradient-to-l from-slate-50 to-white rounded-t-3xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-xl font-black text-gray-900 flex items-center gap-2">
                <div className="p-2 bg-gray-100 rounded-xl"><AlertCircle className="w-5 h-5 text-gray-700" /></div>
                أكواد فيها مشكلة
              </h2>
              <p className="text-sm text-gray-400 mt-1 mr-10">
                {isLoading ? 'جاري التحميل...' : `${total} مشكلة معروضة من إجمالي ${totalAll}`}
              </p>
            </div>
            <button onClick={onClose} className="p-2.5 bg-gray-100 hover:bg-red-50 hover:text-red-500 rounded-xl transition-all">
              <X size={18} />
            </button>
          </div>

          {/* ── SUMMARY BOXES ── */}
          {(() => {
            const achieved = statusCounts.reported + statusCounts.in_progress + statusCounts.wont_repeat + statusCounts.exception;
            const remaining = totalAll - achieved;
            return (
              <div className="flex gap-3 mb-3">
                <div className="flex-1 flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">
                  <div className="p-2 bg-emerald-100 rounded-xl">
                    <CheckCircle size={18} className="text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-emerald-600 font-semibold">ما تم إنجازه</p>
                    <p className="text-xl font-black text-emerald-700">{achieved}</p>
                  </div>
                  <div className="mr-auto text-xs text-emerald-500 font-medium">
                    {totalAll > 0 ? Math.round((achieved / totalAll) * 100) : 0}%
                  </div>
                </div>
                <div className="flex-1 flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                  <div className="p-2 bg-red-100 rounded-xl">
                    <AlertCircle size={18} className="text-red-500" />
                  </div>
                  <div>
                    <p className="text-xs text-red-500 font-semibold">جديد المتبقي</p>
                    <p className="text-xl font-black text-red-600">{remaining}</p>
                  </div>
                  <div className="mr-auto text-xs text-red-400 font-medium">
                    {totalAll > 0 ? Math.round((remaining / totalAll) * 100) : 0}%
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── STATUS TABS ── */}
          <div className="flex flex-wrap gap-2 mb-4">
            {/* All */}
            <button
              onClick={() => setFStatus('')}
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
            <select
              value={fStatus}
              onChange={e => setFStatus(e.target.value)}
              className={`${selectCls} ${fStatus ? 'ring-2 ring-[#1e3a5f]/30 border-[#1e3a5f] font-bold' : ''}`}
            >
              <option value="">كل الحالات</option>
              {Object.entries(STATUS_CFG).map(([key, cfg]) => (
                <option key={key} value={key}>
                  {cfg.emoji} {cfg.label} ({statusCounts[key]})
                </option>
              ))}
            </select>
            <select value={fProbType} onChange={e => setFProbType(e.target.value)} className={selectCls}>
              <option value="">كل أنواع المشاكل</option>
              {probTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={fDept} onChange={e => setFDept(e.target.value)} className={selectCls}>
              <option value="">كل الأقسام</option>
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={fCoord} onChange={e => setFCoord(e.target.value)} className={selectCls}>
              <option value="">كل المنسقين</option>
              {coords.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {hasFilters && (
              <button
                onClick={() => { setSearch(''); setFSection('all'); setFProbType(''); setFDept(''); setFCoord(''); setFStatus(''); }}
                className="px-3 py-2 text-xs text-gray-500 hover:text-red-600 border border-gray-200 rounded-xl hover:border-red-200 transition-all font-medium whitespace-nowrap"
              >✕ مسح الكل</button>
            )}
          </div>
        </div>

        {/* ── TABLES ── */}
        <div className="overflow-auto flex-1">
          {fSection !== 'side' && (
            <ProbTable rows={filteredMain} labelFirst="تاريخ أول محاضرة"
              sectionLabel="مشاكل المحاضرات الأساسية"
              sectionBg="bg-blue-50/70" sectionColor="border-blue-100"
              dotColor="bg-blue-500" />
          )}
          {fSection !== 'main' && (
            <ProbTable rows={filteredSide} labelFirst="تاريخ أول جلسة"
              sectionLabel="مشاكل الزووم كول"
              sectionBg="bg-purple-50/70" sectionColor="border-purple-100"
              dotColor="bg-purple-500" />
          )}
        </div>

        {/* ── FOOTER ── */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-3xl flex-shrink-0 flex items-center justify-between">
          <p className="text-xs text-gray-400 flex items-center gap-1.5">
            <Bell size={12} />
            انقر على أي حالة لتحديثها · التغييرات تُحفظ فوراً ولا تتأثر بإعادة رفع Excel
          </p>
          <button onClick={onClose}
            className="px-6 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl text-sm font-semibold transition-all">
            إغلاق
          </button>
        </div>
      </div>

      {/* ── STATUS EDITOR DIALOG ── */}
      {editKey && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => !saving && setEditKey(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>

            {/* Dialog header */}
            <div className="px-5 py-4 bg-gradient-to-l from-[#1e3a5f]/10 to-[#1e3a5f]/5 border-b border-[#1e3a5f]/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-[#1e3a5f] uppercase tracking-wide mb-1">تحديث حالة المشكلة</p>
                  <p className="text-sm font-black text-gray-900 leading-tight" style={{ wordBreak: 'break-all' }}>
                    {editKey.group_name}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">{editKey.problem_type}</p>
                </div>
                <button onClick={() => setEditKey(null)} className="p-1.5 rounded-lg hover:bg-gray-100 flex-shrink-0">
                  <X size={15} className="text-gray-500" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* Status options */}
              <div>
                <p className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide">اختر الحالة</p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(STATUS_CFG).map(([key, cfg]) => (
                    <button key={key}
                      onClick={() => setEditForm(f => ({ ...f, status: key }))}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold border-2 transition-all
                        ${editForm.status === key
                          ? cfg.badge + ' border-current shadow-sm scale-[1.02]'
                          : 'border-gray-200 text-gray-600 bg-gray-50 hover:bg-gray-100'}`}
                    >
                      <span className="text-base">{cfg.emoji}</span>
                      <span>{cfg.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wide">
                  ملاحظة (اختياري)
                </label>
                <textarea
                  value={editForm.note}
                  onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="مثال: تم إبلاغ علاء بالمشكلة، أو: استثناء بسبب محاضرة تعويضية..."
                  rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] resize-none bg-gray-50"
                />
              </div>

              {/* Error */}
              {saveError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{saveError}</p>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[#1e3a5f] hover:bg-[#15294a] text-white rounded-xl text-sm font-bold transition-all disabled:opacity-60 shadow-sm"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {saving ? 'جاري الحفظ...' : 'حفظ'}
                </button>
                <button
                  onClick={() => setEditKey(null)}
                  disabled={saving}
                  className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold transition-all"
                >إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TEAM SUMMARY SECTION ─────────────────────────────────────────────────────
const DEPT_META = {
  customer_services: { label: 'إدارة خدمة العملاء', gradient: 'from-blue-600 to-blue-500',   dot: 'bg-blue-500'   },
  appointments:      { label: 'إدارة المواعيد',      gradient: 'from-orange-500 to-amber-400', dot: 'bg-orange-500' },
};
const SECTION_LABELS = {
  all: 'الكل', general: 'عام', private: 'خاص', semi: 'شبه خاص', phone_call: 'فون كول',
};

function MetricCell({ value, warnColor = 'red', label, onClick }) {
  const isOk = (value ?? 0) === 0;
  const colorMap = {
    red:    'bg-red-100 text-red-800 border-red-200',
    orange: 'bg-orange-100 text-orange-800 border-orange-200',
    amber:  'bg-amber-100 text-amber-800 border-amber-200',
    purple: 'bg-purple-100 text-purple-800 border-purple-200',
    slate:  'bg-indigo-100 text-indigo-800 border-indigo-300',
  };
  const cls = isOk ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : colorMap[warnColor];
  const canClick = !isOk && !!onClick;
  return (
    <td className="px-3 py-2.5 text-center">
      <span
        onClick={canClick ? onClick : undefined}
        title={canClick ? `عرض تفاصيل ${label}` : label}
        className={`inline-flex items-center justify-center min-w-[36px] px-2.5 py-0.5 rounded-full text-xs font-black border transition-all
          ${cls} ${canClick ? 'cursor-pointer hover:scale-110 hover:shadow-sm active:scale-95' : ''}`}
      >
        {value ?? 0}
      </span>
    </td>
  );
}

// ─── METRIC DETAIL MODAL ──────────────────────────────────────────────────────
const METRIC_META = {
  expired_groups:          { label: 'مجموعات منتهية ونشطة',       color: 'red'    },
  overdue_remarks:         { label: 'ريماركات متأخرة',             color: 'orange' },
  main_absence_no_remark:  { label: 'غياب أساسي بلا ريمارك',      color: 'amber'  },
  side_absence_no_remark:  { label: 'غياب زووم بلا ريمارك',      color: 'purple' },
  groups_with_errors:      { label: 'مجموعات بها أخطاء',          color: 'slate'  },
};

function MetricDetailModal({ employee, metric, applied = {}, onClose }) {
  const [copied, setCopied] = useState(false);
  const meta = METRIC_META[metric] ?? { label: metric, color: 'slate' };

  const { data, isLoading } = useQuery({
    queryKey: ['team-detail', employee, metric, applied],
    queryFn: () => api.get('/reports/team-summary-detail', { params: { employee, metric, ...applied } }).then(r => r.data),
    staleTime: 2 * 60 * 1000,
  });

  const rows = data?.rows ?? [];

  // Extract the main "code" from each row (group_name or client identifier)
  const getCodes = () => {
    if (!rows.length) return '';
    if (metric === 'overdue_remarks') {
      return rows.map(r => `${r.client_name ?? '—'} | ${r.client_phone ?? '—'} | ${r.priority ?? '—'} | ${r.hours_open} ساعة`).join('\n');
    }
    if (metric === 'main_absence_no_remark') {
      return [...new Set(rows.map(r => r.group_name))].join('\n');
    }
    return rows.map(r => r.group_name).join('\n');
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getCodes()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const headerColors = {
    red:    'from-red-600 to-red-500',
    orange: 'from-orange-500 to-amber-400',
    amber:  'from-amber-500 to-yellow-400',
    purple: 'from-purple-600 to-purple-500',
    slate:  'from-slate-600 to-slate-500',
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className={`bg-gradient-to-l ${headerColors[meta.color]} px-5 py-4`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/70 text-xs font-semibold mb-0.5">{employee}</p>
              <h3 className="text-white font-black text-base">{meta.label}</h3>
              <p className="text-white/60 text-xs mt-0.5">
                {isLoading ? 'جاري التحميل...' : `${rows.length} سجل`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {rows.length > 0 && (
                <button onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white rounded-xl text-xs font-bold transition-all">
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'تم النسخ!' : 'نسخ الكل'}
                </button>
              )}
              <button onClick={onClose} className="p-1.5 bg-white/20 hover:bg-white/30 rounded-xl transition-all">
                <X size={15} className="text-white" />
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto" style={{ maxHeight: '60vh' }}>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
              <Loader2 size={18} className="animate-spin ml-2" /> جاري التحميل...
            </div>
          ) : !rows.length ? (
            <div className="flex flex-col items-center py-12 text-gray-400">
              <CheckCircle className="w-8 h-8 text-emerald-300 mb-2" />
              <p className="text-sm">لا توجد بيانات</p>
            </div>
          ) : metric === 'expired_groups' ? (
            <table className="w-full text-sm text-right">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                {['اسم المجموعة','تاريخ النهاية','القسم','المتدربين'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50/70">
                    <td className="px-4 py-2.5 text-xs font-semibold text-gray-900" style={{ maxWidth: 220, wordBreak: 'break-all' }}>{r.group_name}</td>
                    <td className="px-4 py-2.5 text-xs text-red-600 font-mono whitespace-nowrap">{r.end_date}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">{r.dept_type ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 text-center">{r.trainee_count ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : metric === 'overdue_remarks' ? (
            <table className="w-full text-sm text-right">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                {['العميل','الموبايل','الأهمية','ساعات مفتوحة'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50/70">
                    <td className="px-4 py-2.5 text-xs font-semibold text-gray-900 whitespace-nowrap">{r.client_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-blue-600 whitespace-nowrap">{r.client_phone ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold border
                        ${r.priority === 'عاجلة' ? 'bg-red-100 text-red-700 border-red-200' :
                          r.priority === 'هامة'  ? 'bg-orange-100 text-orange-700 border-orange-200' :
                          'bg-gray-100 text-gray-600 border-gray-200'}`}>
                        {r.priority ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-black text-red-600 text-center">{r.hours_open}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : metric === 'main_absence_no_remark' ? (
            <table className="w-full text-sm text-right">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                {['اسم الطالب','الموبايل','المجموعة','تاريخ الغياب'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50/70">
                    <td className="px-4 py-2.5 text-xs font-semibold text-gray-900 whitespace-nowrap">{r.student_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-blue-600 whitespace-nowrap">{r.phone ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600" style={{ maxWidth: 180, wordBreak: 'break-all' }}>{r.group_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap font-mono">{r.date ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : metric === 'side_absence_no_remark' ? (
            <table className="w-full text-sm text-right">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                {['المجموعة','تاريخ الجلسة','الحضور','المتدربين'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50/70">
                    <td className="px-4 py-2.5 text-xs font-semibold text-gray-900" style={{ maxWidth: 220, wordBreak: 'break-all' }}>{r.group_name}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap font-mono">{r.date ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-red-600 font-black text-center">{r.attendance ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 text-center">{r.trainee_count ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            /* groups_with_errors */
            <table className="w-full text-sm text-right">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                {['اسم المجموعة','مجدول','مسجل','الفرق'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50/70">
                    <td className="px-4 py-2.5 text-xs font-semibold text-gray-900" style={{ maxWidth: 220, wordBreak: 'break-all' }}>{r.group_name}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 text-center">{r.scheduled_lectures ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 text-center">{r.completed_lectures ?? '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="text-xs font-black text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                        {r.diff > 0 ? `+${r.diff}` : r.diff}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <p className="text-xs text-gray-400">اضغط خارج النافذة للإغلاق</p>
          {rows.length > 0 && (
            <button onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e3a5f] text-white rounded-xl text-xs font-bold transition-all hover:bg-[#15294a]">
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? 'تم النسخ!' : 'نسخ الأكواد'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TeamSummarySection({ data, loading, applied = {} }) {
  const [detailModal, setDetailModal] = useState(null); // { employee, metric }
  const byDept = {};
  (data ?? []).forEach(m => {
    if (!byDept[m.department]) byDept[m.department] = [];
    byDept[m.department].push(m);
  });

  const allZero = m =>
    !m.expired_groups && !m.overdue_remarks &&
    !m.main_absence_no_remark && !m.side_absence_no_remark && !m.groups_with_errors;

  const COLS = [
    { key: 'expired_groups',         label: 'منتهية ونشطة',          color: 'red'    },
    { key: 'overdue_remarks',         label: 'ريماركات متأخرة',        color: 'orange' },
    { key: 'main_absence_no_remark',  label: 'غياب أساسي بلا ريمارك', color: 'amber'  },
    { key: 'side_absence_no_remark',  label: 'غياب زووم بلا ريمارك', color: 'purple' },
    { key: 'groups_with_errors',      label: 'مجموعات بها أخطاء',     color: 'slate'  },
  ];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 bg-gradient-to-l from-[#1e3a5f]/5 to-white">
        <div className="p-2 rounded-xl bg-[#1e3a5f]/10">
          <Users className="w-4 h-4 text-[#1e3a5f]" />
        </div>
        <div>
          <h2 className="text-base font-bold text-gray-900">ملخص فريق العمل</h2>
          <p className="text-xs text-gray-400 mt-0.5">خدمة العملاء + المواعيد — مؤشرات لكل موظف</p>
        </div>
        {loading && (
          <div className="mr-auto flex items-center gap-1.5 text-xs text-gray-400">
            <RefreshCw size={12} className="animate-spin" /> جاري التحميل...
          </div>
        )}
      </div>

      {/* Column legend */}
      <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100 flex flex-wrap gap-x-5 gap-y-1">
        {COLS.map(c => {
          const dotColors = { red:'bg-red-400', orange:'bg-orange-400', amber:'bg-amber-400', purple:'bg-purple-400', slate:'bg-indigo-400' };
          return (
            <span key={c.key} className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColors[c.color]}`} />
              {c.label}
            </span>
          );
        })}
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-emerald-400" />
          صفر = بخير
        </span>
      </div>

      <div className="divide-y divide-gray-50">
        {loading ? (
          /* Skeleton */
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3 animate-pulse">
              <div className="h-4 w-32 bg-gray-100 rounded-full" />
              <div className="flex gap-2 mr-auto">
                {COLS.map((_, j) => <div key={j} className="h-6 w-10 bg-gray-100 rounded-full" />)}
              </div>
            </div>
          ))
        ) : !data?.length ? (
          <div className="text-center py-10 text-gray-400 text-sm">
            <Users className="w-8 h-8 mx-auto mb-2 text-gray-200" />
            لا يوجد موظفون في هذين القسمين
          </div>
        ) : (
          Object.entries(byDept).map(([dept, members]) => {
            const meta = DEPT_META[dept] ?? { label: dept, gradient: 'from-gray-500 to-gray-400', dot: 'bg-gray-400' };
            return (
              <div key={dept}>
                {/* Dept header row */}
                <div className={`bg-gradient-to-l ${meta.gradient} px-5 py-2 flex items-center gap-2`}>
                  <span className="w-2 h-2 rounded-full bg-white/60" />
                  <span className="text-xs font-black text-white tracking-wide uppercase">{meta.label}</span>
                  <span className="mr-auto text-[11px] text-white/70 font-semibold">{members.length} موظف</span>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right" style={{ minWidth: '700px' }}>
                    <thead>
                      <tr className="bg-gray-50/60 border-b border-gray-100">
                        <th className="px-5 py-2 text-xs font-semibold text-gray-500 text-right">الاسم</th>
                        <th className="px-3 py-2 text-xs font-semibold text-gray-400 text-center whitespace-nowrap">القسم</th>
                        {COLS.map(c => (
                          <th key={c.key} className="px-3 py-2 text-xs font-semibold text-gray-400 text-center whitespace-nowrap">
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {members.map((m, idx) => (
                        <tr key={m.id ?? idx}
                          className={`transition-colors hover:bg-gray-50/70 ${allZero(m) ? '' : 'bg-red-50/20'}`}>
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-[#1e3a5f]/10 flex items-center justify-center text-[10px] font-black text-[#1e3a5f] flex-shrink-0">
                                {m.name?.charAt(0) ?? '؟'}
                              </div>
                              <div>
                                <p className="font-semibold text-gray-900 text-sm">{m.name}</p>
                                {m.job_title && (
                                  <p className="text-[11px] text-gray-400">{m.job_title}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold bg-gray-100 text-gray-600">
                              {SECTION_LABELS[m.section] ?? m.section ?? '—'}
                            </span>
                          </td>
                          {COLS.map(c => (
                            <MetricCell key={c.key} value={m[c.key]} warnColor={c.color} label={c.label}
                              onClick={() => setDetailModal({ employee: m.name, metric: c.key })} />
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        )}
      </div>

      {detailModal && (
        <MetricDetailModal
          employee={detailModal.employee}
          metric={detailModal.metric}
          applied={applied}
          onClose={() => setDetailModal(null)}
        />
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function SystemReports() {
  const today = new Date().toISOString().slice(0, 10);

  const [filters, setFilters] = useState({ from_date: '', to_date: '', department: 'All', employee: '' });
  const [applied, setApplied] = useState({});
  const [errorsTab,    setErrorsTab]    = useState('remarks');
  const [remarksOpen,  setRemarksOpen]  = useState(true);
  const [expiredOpen,  setExpiredOpen]  = useState(true);
  const [errorsOpen,   setErrorsOpen]   = useState(true);
  const [groupsModal,       setGroupsModal]       = useState(null);
  const [listModal,         setListModal]         = useState(null);
  const [remarksNotesOpen,  setRemarksNotesOpen]  = useState(false);
  const [codeProbsOpen,     setCodeProbsOpen]     = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['reports', applied],
    queryFn: () => api.get('/reports/dashboard', { params: applied }).then(r => r.data),
    staleTime: 3 * 60 * 1000,   // 3 min — dashboard stays fresh
    gcTime:    10 * 60 * 1000,  // keep in cache 10 min
  });
  const { data: usersData } = useQuery({
    queryKey: ['users-agents'],
    queryFn: () => api.get('/admin/users').then(r => r.data),
    staleTime: 10 * 60 * 1000,  // 10 min — users list rarely changes
    gcTime:    30 * 60 * 1000,
  });

  // Code problems — always fetch so KPI shows correct count immediately
  const { data: codeProbs, isLoading: codeLoading } = useQuery({
    queryKey: ['code-problems', applied],
    queryFn: () => api.get('/reports/code-problems', { params: applied }).then(r => r.data),
    staleTime: 5 * 60 * 1000,
    gcTime:    15 * 60 * 1000,
  });

  // Team summary — reloads when top-page filters change
  const { data: teamSummary, isLoading: teamSummaryLoading } = useQuery({
    queryKey: ['team-summary', applied],
    queryFn: () => api.get('/reports/team-summary', { params: applied }).then(r => r.data),
    staleTime: 5 * 60 * 1000,
    gcTime:    15 * 60 * 1000,
  });

  const agents = (usersData ?? []).filter(u => u.role === 'agent');
  const kpis = data?.kpis ?? {};

  const handleApply = () => {
    const clean = {};
    if (filters.from_date) clean.from_date = filters.from_date;
    if (filters.to_date)   clean.to_date   = filters.to_date;
    if (filters.department && filters.department !== 'All') clean.department = filters.department;
    if (filters.employee)  clean.employee  = filters.employee;
    setApplied(clean);
  };
  const handleReset = () => {
    setFilters({ from_date: '', to_date: '', department: 'All', employee: '' });
    setApplied({});
  };

  const codeProblemsTotal = codeProbs?.total ?? 0;

  const totalErrors =
    (data?.groups_with_errors?.remarks_errors?.length ?? 0) +
    (data?.groups_with_errors?.side_session_errors?.length ?? 0);

  const tabCounts = {
    remarks: data?.groups_with_errors?.remarks_errors?.length ?? 0,
    side:    data?.groups_with_errors?.side_session_errors?.length ?? 0,
  };

  return (
    <div className="space-y-4" dir="rtl">

      {/* ── PAGE HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">تقارير خدمة العملاء</h1>
          <p className="text-sm text-gray-400 mt-1 flex items-center gap-1.5">
            <BarChart2 size={14} />
            لوحة متابعة شاملة بمؤشرات الأداء والأخطاء
          </p>
        </div>
        <button onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all font-medium">
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          تحديث
        </button>
      </div>

      {/* ── FILTER BAR ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 bg-gradient-to-l from-[#1e3a5f]/5 to-[#1e3a5f]/10 border-b border-[#1e3a5f]/10 flex items-center gap-2">
          <Filter size={14} className="text-[#1e3a5f]" />
          <span className="text-sm font-bold text-[#1e3a5f]">فلاتر البحث</span>
          {Object.keys(applied).length > 0 && (
            <span className="mr-auto text-xs bg-[#1e3a5f] text-white px-2.5 py-0.5 rounded-full font-semibold">
              {Object.keys(applied).length} فلتر مفعّل
            </span>
          )}
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 mb-1.5">
                <Calendar size={12} /> من تاريخ
              </label>
              <input type="date" value={filters.from_date} max={today}
                onChange={e => setFilters(f => ({ ...f, from_date: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] transition-all"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 mb-1.5">
                <Calendar size={12} /> إلى تاريخ
              </label>
              <input type="date" value={filters.to_date} max={today}
                onChange={e => setFilters(f => ({ ...f, to_date: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] transition-all"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 mb-1.5">
                <Layers size={12} /> القسم
              </label>
              <select value={filters.department}
                onChange={e => setFilters(f => ({ ...f, department: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] transition-all"
              >
                <option value="All">الكل</option>
                <option value="General">عام</option>
                <option value="Private">خاص</option>
                <option value="Semi">شبه خاص</option>
              </select>
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 mb-1.5">
                <UserCheck size={12} /> الموظف / المنسق
              </label>
              <select value={filters.employee}
                onChange={e => setFilters(f => ({ ...f, employee: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] transition-all"
              >
                <option value="">الكل</option>
                {agents.map(u => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleApply}
              className="px-6 py-2.5 bg-[#1e3a5f] text-white rounded-xl text-sm font-bold hover:bg-[#15294a] transition-all shadow-sm hover:shadow-md">
              تطبيق الفلاتر
            </button>
            <button onClick={handleReset}
              className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-all">
              إعادة تعيين
            </button>
          </div>
        </div>
      </div>

      {/* ── KPI — ROW 1: Groups Status ── */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Users size={11} /> حالة المجموعات
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <KpiCard label="مجموعات نشطة" value={kpis.active_groups} icon={Users}
            gradient="linear-gradient(135deg, #1e3a5f 0%, #2d5a9e 100%)"
            loading={isLoading}
            onClick={() => setGroupsModal({ title: 'مجموعات نشطة', groups: data?.active_groups_list ?? [], filterType: 'active' })} />
          <KpiCard label="بانتظار تسجيل المتدربين" value={kpis.waiting_trainees} icon={UserCheck}
            gradient="linear-gradient(135deg, #d97706 0%, #f59e0b 100%)"
            loading={isLoading}
            onClick={() => setGroupsModal({ title: 'بانتظار تسجيل المتدربين', groups: data?.waiting_trainees_list ?? [] })} />
          <KpiCard label="بانتظار تسجيل المحاضرات" value={kpis.waiting_lectures} icon={Clock}
            gradient="linear-gradient(135deg, #ea580c 0%, #f97316 100%)"
            loading={isLoading}
            onClick={() => setGroupsModal({ title: 'بانتظار تسجيل المحاضرات', groups: data?.waiting_lectures_list ?? [] })} />
        </div>
      </div>

      {/* ── KPI — ROW 2: Activity Metrics ── */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <TrendingUp size={11} /> مؤشرات النشاط
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="مجموعات منتهية ونشطة" value={kpis.expired_active_groups} icon={AlertTriangle}
            gradient="linear-gradient(135deg, #dc2626 0%, #ef4444 100%)"
            loading={isLoading} pulse={(kpis.expired_active_groups ?? 0) > 0}
            onClick={() => setGroupsModal({ title: 'مجموعات منتهية ولا تزال نشطة', groups: data?.expired_groups_list ?? [], filterType: 'expired' })} />
          <KpiCard label="المحاضرات الأساسية" value={kpis.main_lectures} icon={BookOpen}
            gradient="linear-gradient(135deg, #0369a1 0%, #0ea5e9 100%)"
            loading={isLoading}
            onClick={() => setListModal({
              title: 'المحاضرات الأساسية',
              endpoint: '/reports/lectures-list',
              params: { session_type: 'main', ...applied },
              extraFilters: ['trainer', 'coordinator', 'date', 'dept'],
              columns: [
                { key: 'group_name',   label: 'المجموعة',   noWrap: true },
                { key: 'date',         label: 'التاريخ',    type: 'date' },
                { key: 'time',         label: 'الوقت' },
                { key: 'duration',     label: 'المدة',      type: 'duration' },
                { key: 'trainer',      label: 'المدرب' },
                { key: 'status',       label: 'الحالة' },
                { key: 'attendance',   label: 'الحضور' },
                { key: 'dept_type',    label: 'القسم',      type: 'badge' },
                { key: 'coordinators', label: 'المنسق' },
              ],
            })} />
          <KpiCard label="الجلسات الجانبية" value={kpis.side_sessions} icon={Layers}
            gradient="linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)"
            loading={isLoading}
            onClick={() => setListModal({
              title: 'الجلسات الجانبية',
              endpoint: '/reports/lectures-list',
              params: { session_type: 'side', ...applied },
              columns: [
                { key: 'group_name',           label: 'المجموعة',    noWrap: true },
                { key: 'date',                  label: 'التاريخ',    type: 'date' },
                { key: 'time',                  label: 'الوقت' },
                { key: 'duration',              label: 'المدة',      type: 'duration' },
                { key: 'trainer',               label: 'المدرب' },
                { key: 'status',                label: 'الحالة' },
                { key: 'side_session_category', label: 'التصنيف',   type: 'category' },
                { key: 'onboarding_count',      label: 'Onboarding',  type: 'ob_count' },
                { key: 'offboarding_count',     label: 'Offboarding', type: 'ob_count' },
                { key: 'compensatory_count',    label: 'تعويضية',     type: 'ob_count' },
                { key: 'dept_type',             label: 'القسم',      type: 'badge' },
                { key: 'coordinators',          label: 'المنسق' },
              ],
              extraFilters: ['trainer', 'coordinator', 'date', 'dept'],
            })} />
          <KpiCard label="زووم كول" value={kpis.zoom_calls} icon={Video}
            gradient="linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)"
            loading={isLoading}
            onClick={() => setListModal({
              title: 'زووم كول (جلسات 15 دقيقة)',
              endpoint: '/reports/lectures-list',
              params: { session_type: 'side', category: 'regular', ...applied },
              columns: [
                { key: 'group_name',  label: 'المجموعة',  noWrap: true },
                { key: 'date',        label: 'التاريخ',   type: 'date' },
                { key: 'time',        label: 'الوقت' },
                { key: 'duration',    label: 'المدة',     type: 'duration' },
                { key: 'trainer',     label: 'المدرب' },
                { key: 'status',      label: 'الحالة' },
                { key: 'dept_type',   label: 'القسم',     type: 'badge' },
                { key: 'coordinators',label: 'المنسق' },
              ],
              extraFilters: ['trainer', 'coordinator', 'date', 'dept'],
            })} />
          <KpiCard label="غياب المحاضرات الأساسية" value={kpis.absent_main} icon={UserX}
            gradient="linear-gradient(135deg, #b45309 0%, #d97706 100%)"
            loading={isLoading}
            onClick={() => setListModal({
              title: 'غياب المحاضرات الأساسية',
              endpoint: '/reports/absent-list',
              params: { ...applied },
              columns: [
                { key: 'student_name', label: 'اسم الطالب' },
                { key: 'phone',        label: 'الموبايل' },
                { key: 'group_name',   label: 'المجموعة' },
                { key: 'date',         label: 'التاريخ', type: 'date' },
                { key: 'time',         label: 'الوقت' },
                { key: 'lecture_no',   label: 'رقم المحاضرة' },
                { key: 'dept_type',    label: 'القسم',   type: 'badge' },
                { key: 'coordinators', label: 'المنسق' },
              ],
              extraFilters: ['coordinator', 'date', 'dept'],
            })} />
          <KpiCard label="غياب الزووم كول" value={kpis.absent_zoom} icon={UserX}
            gradient="linear-gradient(135deg, #ca8a04 0%, #eab308 100%)"
            loading={isLoading}
            onClick={() => setListModal({
              title: 'غياب الزووم كول',
              endpoint: '/reports/absent-side-list',
              params: { ...applied },
              columns: [
                { key: 'group_name',    label: 'اسم المجموعة',   noWrap: true },
                { key: 'session_date',  label: 'التاريخ',         type: 'date' },
                { key: 'trainer',       label: 'المدرب' },
                { key: 'coordinators',  label: 'المنسق' },
                { key: 'dept_type',     label: 'القسم',           type: 'badge' },
                { key: 'trainee_count', label: 'إجمالي المتدربين', type: 'trainee_total' },
                { key: 'present_count', label: 'عدد الحضور',      type: 'present_count' },
                { key: 'absent_count',  label: 'عدد الغياب',      type: 'absent_count' },
              ],
              extraFilters: ['trainer', 'coordinator', 'date', 'dept'],
            })} />
        </div>
      </div>

      {/* ── KPI — ROW 3: Alerts ── */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Zap size={11} /> التنبيهات
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <KpiCard label="ملاحظات" value={kpis.open_remarks} icon={MessageSquare}
            gradient="linear-gradient(135deg, #b91c1c 0%, #f87171 100%)"
            loading={isLoading} pulse={(kpis.open_remarks ?? 0) > 0}
            onClick={() => setListModal({
              title: 'الملاحظات المفتوحة',
              endpoint: '/reports/remarks-list',
              params: { ...applied },
              extraFilters: ['assigned_to', 'priority', 'category_search', 'status_filter', 'date', 'dept'],
              columns: [
                { key: 'client_name',   label: 'اسم العميل',      noWrap: true },
                { key: 'client_phone',  label: 'الموبايل',         type: 'phone' },
                { key: 'details',       label: 'التفاصيل',         type: 'details',      noWrap: false },
                { key: 'active_group',  label: 'المجموعة النشطة',  type: 'active_group', noWrap: false },
                { key: 'category',      label: 'التصنيف',          type: 'badge' },
                { key: 'status',        label: 'الحالة' },
                { key: 'priority',      label: 'الأهمية',          type: 'priority' },
                { key: 'urgency_level', label: 'مستوى الإلحاح',    type: 'urgency' },
                { key: 'hours_open',    label: 'ساعات مفتوحة' },
                { key: 'last_updated',  label: 'آخر تحديث',        type: 'date' },
                { key: 'assigned_to',   label: 'مسؤول' },
              ],
            })} />
          <KpiCard label="مجموعات بها أخطاء" value={isLoading || codeLoading ? undefined : codeProblemsTotal} icon={AlertCircle}
            gradient="linear-gradient(135deg, #374151 0%, #6b7280 100%)"
            loading={isLoading || codeLoading}
            onClick={() => setCodeProbsOpen(true)} />
          <KpiCard label="ملحوظات الريماركات" value={kpis.remarks_notes} icon={FileText}
            gradient="linear-gradient(135deg, #4338ca 0%, #7c3aed 100%)"
            loading={isLoading}
            onClick={() => setRemarksNotesOpen(true)} />
        </div>
      </div>

      {/* ── TEAM SUMMARY ── */}
      <TeamSummarySection data={teamSummary} loading={teamSummaryLoading} applied={applied} />

      {/* ── MODALS ── */}
      {groupsModal && (
        <GroupsModal
          title={groupsModal.title}
          groups={groupsModal.groups}
          allUsers={usersData ?? []}
          filterType={groupsModal.filterType ?? 'active'}
          onClose={() => setGroupsModal(null)}
        />
      )}
      {listModal && (
        <ListModal
          title={listModal.title}
          endpoint={listModal.endpoint}
          params={listModal.params}
          columns={listModal.columns}
          extraFilters={listModal.extraFilters ?? false}
          onClose={() => setListModal(null)}
        />
      )}
      {remarksNotesOpen && (
        <RemarksNotesModal
          params={applied}
          onClose={() => setRemarksNotesOpen(false)}
        />
      )}
      {codeProbsOpen && (
        <CodeProblemsModal
          params={applied}
          onClose={() => setCodeProbsOpen(false)}
        />
      )}
    </div>
  );
}
