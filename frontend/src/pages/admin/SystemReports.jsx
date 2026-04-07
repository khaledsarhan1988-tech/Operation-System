'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Users, AlertTriangle, BookOpen, Layers, UserX, AlertCircle,
  MessageSquare, RefreshCw, ChevronDown, ChevronUp, X, Clock,
  UserCheck, Eye, Search, Filter, TrendingUp, Calendar,
  CheckCircle, XCircle, AlertOctagon, BarChart2, Zap,
} from 'lucide-react';
import api from '../../api/axios';

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
function GroupsModal({ title, groups, allUsers = [], onClose }) {
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [traineesGroup, setTraineesGroup] = useState(null);
  const [search, setSearch] = useState('');

  const userDeptMap = {};
  allUsers.forEach(u => {
    if (u.full_name) userDeptMap[u.full_name.toLowerCase().trim()] = u.department;
  });
  const getCoordDept = (g) => userDeptMap[(g.coordinators ?? '').toLowerCase().trim()] ?? g.dept_type ?? '—';

  const filtered = search.trim()
    ? groups.filter(g => g.group_name?.toLowerCase().includes(search.trim().toLowerCase()))
    : groups;

  const { data: lecturesData, isLoading: lecturesLoading } = useQuery({
    queryKey: ['group-lectures', expandedGroup],
    queryFn: () => api.get('/reports/group-lectures', { params: { group_name: expandedGroup } }).then(r => r.data),
    enabled: !!expandedGroup,
  });
  const { data: traineesData, isLoading: traineesLoading } = useQuery({
    queryKey: ['group-trainees', traineesGroup],
    queryFn: () => api.get('/reports/group-trainees', { params: { group_name: traineesGroup } }).then(r => r.data),
    enabled: !!traineesGroup,
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
          <div className="relative">
            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text" value={search}
              onChange={e => { setSearch(e.target.value); setExpandedGroup(null); setTraineesGroup(null); }}
              placeholder="بحث باسم المجموعة..."
              className="w-full bg-gray-50 border border-gray-200 rounded-xl pr-10 pl-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
            />
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

// ─── LIST MODAL ───────────────────────────────────────────────────────────────
function ListModal({ title, endpoint, params, columns, onClose }) {
  const [page, setPage]               = useState(1);
  const [search, setSearch]           = useState('');
  const [appliedSearch, setApplied]   = useState('');
  const LIMIT = 100;

  const { data, isLoading } = useQuery({
    queryKey: [endpoint, params, page, appliedSearch],
    queryFn: () => api.get(endpoint, { params: { ...params, page, limit: LIMIT, search: appliedSearch } }).then(r => r.data),
  });

  const handleSearch = (e) => { e.preventDefault(); setPage(1); setApplied(search); };
  const handleClear  = ()    => { setSearch(''); setApplied(''); setPage(1); };

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 1;

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
    if (col.type === 'ob_count') return (
      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black ${
        (val ?? 0) > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'
      }`}>{val ?? 0}</span>
    );
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
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="بحث باسم المجموعة..."
                className="w-full bg-gray-50 border border-gray-200 rounded-xl pr-10 pl-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
              />
            </div>
            <button type="submit"
              className="px-5 py-2.5 bg-[#1e3a5f] text-white rounded-xl text-sm font-semibold hover:bg-[#15294a] transition-all">
              بحث
            </button>
            {appliedSearch && (
              <button type="button" onClick={handleClear}
                className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-200 transition-all">
                مسح
              </button>
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
  const [groupsModal,  setGroupsModal]  = useState(null);
  const [listModal,    setListModal]    = useState(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['reports', applied],
    queryFn: () => api.get('/reports/dashboard', { params: applied }).then(r => r.data),
  });
  const { data: usersData } = useQuery({
    queryKey: ['users-agents'],
    queryFn: () => api.get('/admin/users').then(r => r.data),
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

  const totalErrors =
    (data?.groups_with_errors?.remarks_errors?.length ?? 0) +
    (data?.groups_with_errors?.lectures_errors?.length ?? 0) +
    (data?.groups_with_errors?.side_session_errors?.length ?? 0);

  const tabCounts = {
    remarks:  data?.groups_with_errors?.remarks_errors?.length ?? 0,
    lectures: data?.groups_with_errors?.lectures_errors?.length ?? 0,
    side:     data?.groups_with_errors?.side_session_errors?.length ?? 0,
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
            onClick={() => setGroupsModal({ title: 'مجموعات نشطة', groups: data?.active_groups_list ?? [] })} />
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
            onClick={() => setGroupsModal({ title: 'مجموعات منتهية ولا تزال نشطة', groups: data?.expired_groups_list ?? [] })} />
          <KpiCard label="المحاضرات الأساسية" value={kpis.main_lectures} icon={BookOpen}
            gradient="linear-gradient(135deg, #0369a1 0%, #0ea5e9 100%)"
            loading={isLoading}
            onClick={() => setListModal({
              title: 'المحاضرات الأساسية',
              endpoint: '/reports/lectures-list',
              params: { session_type: 'main', ...applied },
              columns: [
                { key: 'group_name',          label: 'المجموعة',    noWrap: true },
                { key: 'date',                label: 'التاريخ',     type: 'date' },
                { key: 'time',                label: 'الوقت' },
                { key: 'duration',            label: 'المدة',       type: 'duration' },
                { key: 'trainer',             label: 'المدرب' },
                { key: 'status',              label: 'الحالة' },
                { key: 'attendance',          label: 'الحضور' },
                { key: 'dept_type',           label: 'القسم',       type: 'badge' },
                { key: 'coordinators',        label: 'المنسق' },
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
                { key: 'onboarding_count',      label: 'Onboarding', type: 'ob_count' },
                { key: 'offboarding_count',     label: 'Offboarding',type: 'ob_count' },
                { key: 'dept_type',             label: 'القسم',      type: 'badge' },
                { key: 'coordinators',          label: 'المنسق' },
              ],
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
            })} />
        </div>
      </div>

      {/* ── KPI — ROW 3: Alerts ── */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Zap size={11} /> التنبيهات
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <KpiCard label="غياب الجلسات الجانبية" value={kpis.absent_side} icon={UserX}
            gradient="linear-gradient(135deg, #ca8a04 0%, #eab308 100%)"
            loading={isLoading}
            onClick={() => setListModal({
              title: 'غياب الجلسات الجانبية',
              endpoint: '/reports/absent-side-list',
              params: { ...applied },
              columns: [
                { key: 'group_name',           label: 'اسم المجموعة',   noWrap: true },
                { key: 'session_date',          label: 'التاريخ',         type: 'date' },
                { key: 'lecture_start_time',    label: 'الوقت' },
                { key: 'actual_duration',       label: 'المدة',          type: 'duration' },
                { key: 'trainer',               label: 'المدرب' },
                { key: 'coordinators',          label: 'المنسق' },
                { key: 'dept_type',             label: 'القسم',           type: 'badge' },
                { key: 'side_session_category', label: 'التصنيف',        type: 'category' },
              ],
            })} />
          <KpiCard label="ملاحظات مفتوحة" value={kpis.open_remarks} icon={MessageSquare}
            gradient="linear-gradient(135deg, #b91c1c 0%, #f87171 100%)"
            loading={isLoading} pulse={(kpis.open_remarks ?? 0) > 0} />
          <KpiCard label="مجموعات بها أخطاء" value={isLoading ? undefined : totalErrors} icon={AlertCircle}
            gradient="linear-gradient(135deg, #374151 0%, #6b7280 100%)"
            loading={isLoading} />
        </div>
      </div>

      {/* ── OPEN REMARKS ── */}
      <SectionCard
        title="الملاحظات المفتوحة"
        icon={MessageSquare}
        iconColor="#b91c1c"
        accentColor="#b91c1c"
        count={data?.open_remarks_list?.length}
        countColor="bg-red-100 text-red-700"
        open={remarksOpen}
        onToggle={() => setRemarksOpen(o => !o)}
      >
        <StyledTable headers={['اسم العميل','تفاصيل','التصنيف','الحالة','الأهمية','مستوى الإلحاح','آخر تحديث','مسؤول']} minWidth="900px">
          {isLoading ? <SkeletonRows cols={8} /> :
           !data?.open_remarks_list?.length ? <EmptyRow cols={8} msg="✓ لا توجد ملاحظات مفتوحة" /> :
           data.open_remarks_list.map((r) => {
             const hrs = r.added_at ? (Date.now() - new Date(r.added_at).getTime()) / 3600000 : 0;
             const urgency = hrs >= 72 ? 'overdue' : hrs >= 48 ? 'normal' : hrs >= 24 ? 'important' : hrs >= 3 ? 'urgent' : 'ok';
             const rowCls = urgency === 'overdue' ? 'bg-red-50/60' : urgency === 'urgent' ? 'bg-orange-50/40' : '';
             return (
               <tr key={r.id} className={`border-b border-gray-50 hover:bg-gray-50/70 transition-colors ${rowCls}`}>
                 <Td highlight>{r.client_name}</Td>
                 <Td className="max-w-xs truncate text-gray-600">{r.details}</Td>
                 <Td>
                   <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                     {r.category ?? '—'}
                   </span>
                 </Td>
                 <Td>{r.status}</Td>
                 <Td>
                   <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${
                     r.priority === 'عاجلة' ? 'bg-red-100 text-red-700' :
                     r.priority === 'هامة'  ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
                   }`}>{r.priority ?? '—'}</span>
                 </Td>
                 <Td><UrgencyBadge level={urgency} /></Td>
                 <Td className="text-xs text-gray-500">{fmtDate(r.last_updated)}</Td>
                 <Td>{r.assigned_to}</Td>
               </tr>
             );
           })}
        </StyledTable>
      </SectionCard>

      {/* ── EXPIRED GROUPS ── */}
      <SectionCard
        title="مجموعات منتهية ولا تزال نشطة"
        icon={AlertTriangle}
        iconColor="#dc2626"
        accentColor="#dc2626"
        count={data?.expired_groups_list?.length}
        countColor="bg-red-100 text-red-700"
        open={expiredOpen}
        onToggle={() => setExpiredOpen(o => !o)}
      >
        <StyledTable headers={['اسم المجموعة','تاريخ البداية','تاريخ النهاية','القسم','المنسق']}>
          {isLoading ? <SkeletonRows cols={5} /> :
           !data?.expired_groups_list?.length ? <EmptyRow cols={5} msg="✓ لا توجد مجموعات منتهية ونشطة" /> :
           data.expired_groups_list.map((g, i) => (
             <tr key={g.id ?? i} className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">
               <Td highlight className="whitespace-nowrap">{g.group_name}</Td>
               <Td className="text-xs text-gray-500 whitespace-nowrap">{fmtDate(g.start_date)}</Td>
               <Td className="whitespace-nowrap">
                 <span className="inline-flex items-center gap-1 text-red-600 font-semibold text-xs">
                   <AlertOctagon size={12} /> {fmtDate(g.end_date)}
                 </span>
               </Td>
               <Td><DeptBadge dept={g.dept_type} /></Td>
               <Td>{g.coordinators}</Td>
             </tr>
           ))}
        </StyledTable>
      </SectionCard>

      {/* ── ERRORS REPORT ── */}
      <SectionCard
        title="تقرير الأخطاء"
        icon={AlertCircle}
        iconColor="#6b7280"
        accentColor="#374151"
        count={isLoading ? undefined : totalErrors}
        countColor="bg-gray-100 text-gray-700"
        open={errorsOpen}
        onToggle={() => setErrorsOpen(o => !o)}
      >
        {/* Tabs */}
        <div className="px-5 pt-4 pb-0 flex gap-1 border-b border-gray-100">
          {[
            { key: 'remarks',  label: 'ملاحظات متأخرة',  color: 'text-red-600 border-red-500',    dot: 'bg-red-500' },
            { key: 'lectures', label: 'محاضرات ناقصة',   color: 'text-blue-700 border-blue-600',  dot: 'bg-blue-600' },
            { key: 'side',     label: 'جلسات جانبية',    color: 'text-purple-700 border-purple-600', dot: 'bg-purple-600' },
          ].map(tab => (
            <button key={tab.key} onClick={() => setErrorsTab(tab.key)}
              className={`relative flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-2 -mb-px transition-all ${
                errorsTab === tab.key ? tab.color : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {tabCounts[tab.key] > 0 && (
                <span className={`w-2 h-2 rounded-full ${tab.dot}`} />
              )}
              {tab.label}
              <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                errorsTab === tab.key ? 'bg-gray-100 text-gray-700' : 'bg-gray-100 text-gray-400'
              }`}>{tabCounts[tab.key]}</span>
            </button>
          ))}
        </div>

        <div className="p-0">
          {/* Remarks errors */}
          {errorsTab === 'remarks' && (
            <StyledTable headers={['اسم العميل','الحالة','ساعات مفتوحة','مستوى الإلحاح','مسؤول','تاريخ الإضافة']} minWidth="700px">
              {isLoading ? <SkeletonRows cols={6} /> :
               !data?.groups_with_errors?.remarks_errors?.length ? <EmptyRow cols={6} msg="✓ لا توجد ملاحظات متأخرة" /> :
               data.groups_with_errors.remarks_errors.map((r) => (
                 <tr key={r.id} className={`border-b border-gray-50 hover:bg-gray-50/70 transition-colors ${
                   r.urgency_level === 'overdue' ? 'bg-red-50/40' : ''
                 }`}>
                   <Td highlight>{r.client_name}</Td>
                   <Td>{r.status}</Td>
                   <Td>
                     <span className="inline-flex items-center gap-1 text-sm font-bold text-gray-700">
                       <Clock size={12} className="text-gray-400" />{r.hours_open} ساعة
                     </span>
                   </Td>
                   <Td><UrgencyBadge level={r.urgency_level} /></Td>
                   <Td>{r.assigned_to}</Td>
                   <Td className="text-xs text-gray-500">{fmtDate(r.added_at)}</Td>
                 </tr>
               ))}
            </StyledTable>
          )}

          {/* Lectures errors */}
          {errorsTab === 'lectures' && (
            <StyledTable headers={['اسم المجموعة','المجدولة','المكتملة','الناقصة','التقدم','القسم','المنسق']} minWidth="750px">
              {isLoading ? <SkeletonRows cols={7} /> :
               !data?.groups_with_errors?.lectures_errors?.length ? <EmptyRow cols={7} msg="✓ لا توجد محاضرات ناقصة" /> :
               data.groups_with_errors.lectures_errors.map((g, i) => (
                 <tr key={g.group_name ?? i} className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">
                   <Td highlight className="whitespace-nowrap">{g.group_name}</Td>
                   <Td>{g.scheduled_lectures}</Td>
                   <Td>{g.completed_lectures}</Td>
                   <Td>
                     <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                       -{g.missing_lectures}
                     </span>
                   </Td>
                   <Td style={{ minWidth: '140px' }}>
                     <ProgressBar
                       done={g.completed_lectures}
                       total={g.scheduled_lectures}
                       colorClass="bg-blue-500"
                     />
                   </Td>
                   <Td><DeptBadge dept={g.dept_type} /></Td>
                   <Td>{g.coordinators}</Td>
                 </tr>
               ))}
            </StyledTable>
          )}

          {/* Side session errors */}
          {errorsTab === 'side' && (
            <StyledTable headers={['اسم المجموعة','المتدربين','الجلسات الفعلية','المطلوبة','الفرق','التقدم','القسم','المنسق']} minWidth="800px">
              {isLoading ? <SkeletonRows cols={8} /> :
               !data?.groups_with_errors?.side_session_errors?.length ? <EmptyRow cols={8} msg="✓ لا توجد جلسات جانبية ناقصة" /> :
               data.groups_with_errors.side_session_errors.map((g, i) => (
                 <tr key={g.group_name ?? i} className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">
                   <Td highlight className="whitespace-nowrap">{g.group_name}</Td>
                   <Td>{g.trainee_count}</Td>
                   <Td>{g.side_count}</Td>
                   <Td>{g.expected_side_count}</Td>
                   <Td>
                     <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700">
                       -{g.expected_side_count - g.side_count}
                     </span>
                   </Td>
                   <Td style={{ minWidth: '140px' }}>
                     <ProgressBar
                       done={g.side_count}
                       total={g.expected_side_count}
                       colorClass="bg-purple-500"
                     />
                   </Td>
                   <Td><DeptBadge dept={g.dept_type} /></Td>
                   <Td>{g.coordinators}</Td>
                 </tr>
               ))}
            </StyledTable>
          )}
        </div>
      </SectionCard>

      {/* ── MODALS ── */}
      {groupsModal && (
        <GroupsModal
          title={groupsModal.title}
          groups={groupsModal.groups}
          allUsers={usersData ?? []}
          onClose={() => setGroupsModal(null)}
        />
      )}
      {listModal && (
        <ListModal
          title={listModal.title}
          endpoint={listModal.endpoint}
          params={listModal.params}
          columns={listModal.columns}
          onClose={() => setListModal(null)}
        />
      )}
    </div>
  );
}
