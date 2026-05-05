import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck, Calendar, Filter, Search, X, Download, Wrench,
  ClipboardCheck, AlertCircle, Video, BookOpen, Layers, FileText, Users,
  TrendingDown, Phone, UserX, FileDown, Snowflake, Save,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';
import ModernButton from '../../components/ui/ModernButton';

// ─── DETAILS MODAL ────────────────────────────────────────────────────────────
function DetailsModal({ open, agent, type, from, to, onClose }) {
  const TYPE_DEFS = {
    main:        { label: 'Attendance Main Session', kind: 'remarks', color: 'blue' },
    side:        { label: 'Attendance Side / Zoom Call', kind: 'remarks', color: 'purple' },
    task:        { label: 'Attendance Task', kind: 'remarks', color: 'cyan' },
    open:        { label: 'الريمارك المفتوحة', kind: 'remarks', color: 'amber' },
    fixed:       { label: 'Solve Mistakes (المشاكل المُصلَّحة)', kind: 'cps', color: 'pink' },
    main_absent: { label: 'غيابات المحاضرات الأساسية', kind: 'absent', color: 'rose' },
    zoom_absent: { label: 'غيابات الزووم كول', kind: 'absent', color: 'violet' },
  };
  const def = TYPE_DEFS[type] || TYPE_DEFS.main;

  const { data = [], isLoading } = useQuery({
    queryKey: ['quality-details', agent, type, from, to],
    queryFn: () => api.get('/reports/quality-employee/details', {
      params: { agent, type, from, to },
    }).then(r => r.data),
    enabled: open && !!agent && !!type,
  });

  if (!open) return null;

  const accentMap = {
    blue:   'from-blue-500 to-cyan-500',
    purple: 'from-purple-500 to-fuchsia-500',
    cyan:   'from-cyan-500 to-teal-500',
    amber:  'from-amber-500 to-orange-500',
    pink:   'from-pink-500 to-rose-500',
    rose:   'from-rose-500 to-red-500',
    violet: 'from-violet-500 to-purple-500',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className={`bg-gradient-to-l ${accentMap[def.color]} text-white px-6 py-4 flex items-center justify-between`}>
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider opacity-85 mb-0.5">{def.label}</p>
            <h2 className="text-lg font-black">{agent}</h2>
            <p className="text-xs font-bold opacity-85 mt-0.5">
              من {from || '—'} إلى {to || '—'} · {data.length} سجل
            </p>
          </div>
          <button onClick={onClose} className="p-2 bg-white/15 hover:bg-white/25 rounded-xl backdrop-blur">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-auto flex-1">
          {isLoading ? (
            <p className="text-center py-12 text-gray-400 text-sm font-bold">جاري التحميل...</p>
          ) : !data.length ? (
            <EmptyState
              icon={FileText}
              accent="gray"
              title="لا توجد سجلات"
              message="مفيش بيانات للفلتر ده."
            />
          ) : def.kind === 'remarks' ? (
            <table className="w-full text-sm text-right" dir="rtl">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">العميل</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">الموبايل</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">نوع المهمة</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">التصنيف</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">الحالة</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">الأولوية</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50/40">
                    <td className="px-4 py-2.5 font-black text-gray-800">{r.client_name || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{r.client_phone || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-700 font-bold">{r.task_type || '—'}</td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className="px-2 py-0.5 bg-gray-100 rounded-lg text-gray-700 font-bold">{r.category || '—'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className={`px-2 py-0.5 rounded-lg font-black ${
                        r.status === 'إنتهت' ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>{r.status || '—'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-bold text-gray-600">{r.priority || '—'}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{(r.added_at || '').slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : def.kind === 'cps' ? (
            <table className="w-full text-sm text-right" dir="rtl">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">المجموعة</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">نوع المشكلة</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">الجلسة</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">الحالة</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">الكود الجديد</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">بواسطة</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50/40">
                    <td className="px-4 py-2.5 font-mono text-xs font-black text-gray-800">{r.group_name}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-700 font-bold">{r.problem_type}</td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className={`px-2 py-0.5 rounded-lg font-black ${
                        r.session_type === 'main' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                      }`}>{r.session_type === 'main' ? 'أساسية' : 'جانبية'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-lg font-black">{r.status}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{r.new_group_code || '—'}</td>
                    <td className="px-4 py-2.5 text-xs font-bold text-gray-700">{r.updated_by_name || '—'}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{(r.updated_at || '').slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            // Absent students
            <table className="w-full text-sm text-right" dir="rtl">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">الطالب</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">الموبايل</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">المجموعة</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">التاريخ</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">الوقت</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">رقم المحاضرة</th>
                  <th className="px-4 py-3 text-xs font-black text-gray-500">حالة المتابعة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50/40">
                    <td className="px-4 py-2.5 font-black text-gray-800">{r.student_name || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{r.phone || '—'}</td>
                    <td className="px-4 py-2.5 text-xs font-mono font-bold text-gray-700 max-w-[220px] truncate">{r.group_name}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">{r.date}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{r.time}</td>
                    <td className="px-4 py-2.5 text-xs text-center">{r.lecture_no ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className={`px-2 py-0.5 rounded-lg font-black ${
                        r.follow_up_status === 'resolved' ? 'bg-emerald-100 text-emerald-700'
                        : r.follow_up_status === 'contacted' ? 'bg-blue-100 text-blue-700'
                        : 'bg-amber-100 text-amber-700'
                      }`}>{r.follow_up_status || 'pending'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function QualityReports() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [from, setFrom]             = useState(monthAgo);
  const [to, setTo]                 = useState(today);
  const [department, setDepartment] = useState('All');
  const [search, setSearch]         = useState('');
  const [applied, setApplied]       = useState({ from: monthAgo, to: today, department: 'All' });
  const [drill, setDrill]           = useState({ open: false, agent: null, type: null });
  const [pdfBusy, setPdfBusy]       = useState(false);
  const [pdfRendering, setPdfRendering] = useState(false);
  const [freezeOpen, setFreezeOpen] = useState(false);

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['quality-employee', applied],
    queryFn: () => api.get('/reports/quality-employee', {
      params: {
        from: applied.from || undefined,
        to:   applied.to   || undefined,
        department: applied.department && applied.department !== 'All' ? applied.department : undefined,
      },
    }).then(r => r.data),
    staleTime: 60_000,
  });

  const summary = data?.summary || {};
  const rows = data?.rows || [];

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.agent_name?.toLowerCase().includes(q));
  }, [rows, search]);

  // Per-department averages — uses true rate = SUM(absent)/SUM(expected),
  // not a flat average of percentages, so departments with more sessions
  // are weighted correctly. Calculated from filteredRows so the search
  // filter is reflected too.
  const deptAverages = useMemo(() => {
    const buckets = new Map();
    filteredRows.forEach(r => {
      const key = r.department || '—';
      if (!buckets.has(key)) {
        buckets.set(key, {
          department: key,
          employees: 0,
          mainAbsent: 0, mainExpected: 0,
          zoomAbsent: 0, zoomExpected: 0,
          codeFixed: 0, openRemarks: 0,
        });
      }
      const b = buckets.get(key);
      b.employees     += 1;
      b.mainAbsent    += r.main_absent_count    || 0;
      b.mainExpected  += r.main_expected_count  || 0;
      b.zoomAbsent    += r.zoom_absent_count    || 0;
      b.zoomExpected  += r.zoom_expected_count  || 0;
      b.codeFixed     += r.code_problems_fixed  || 0;
      b.openRemarks   += r.open_remarks_count   || 0;
    });
    return Array.from(buckets.values()).map(b => ({
      ...b,
      mainRate: b.mainExpected > 0 ? Math.round((b.mainAbsent / b.mainExpected) * 100) : 0,
      zoomRate: b.zoomExpected > 0 ? Math.round((b.zoomAbsent / b.zoomExpected) * 100) : 0,
    })).sort((a, b) => b.employees - a.employees);
  }, [filteredRows]);

  // Validate that an ISO date string ("YYYY-MM-DD") is a real calendar date.
  // Catches "April 31", "Feb 30", "13/45/2026", etc. — the HTML date input
  // accepts these in some browsers when typed directly.
  function isValidISODate(s) {
    if (!s) return true; // empty is allowed
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, day] = s.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1, day));
    return d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m && d.getUTCDate() === day;
  }

  const handleApply = () => {
    // Catch case where browser silently emptied the field after invalid input
    // (e.g. user typed "04/31/2026" → some browsers set value to "").
    if (!from) {
      alert('"من تاريخ" مطلوب. لو كنت كاتب تاريخ غير صحيح (زي 31 ابريل) المتصفح بيمسحه — اختار تاريخ موجود فعلاً.');
      return;
    }
    if (!to) {
      alert('"إلى تاريخ" مطلوب. لو كنت كاتب تاريخ غير صحيح (زي 31 ابريل) المتصفح بيمسحه — اختار تاريخ موجود فعلاً.');
      return;
    }
    if (!isValidISODate(from)) {
      alert('"من تاريخ" غير صحيح. يرجى اختيار تاريخ موجود فعلاً (مثلاً 30 ابريل، مش 31 ابريل).');
      return;
    }
    if (!isValidISODate(to)) {
      alert('"إلى تاريخ" غير صحيح. يرجى اختيار تاريخ موجود فعلاً (مثلاً 30 ابريل، مش 31 ابريل).');
      return;
    }
    if (from > to) {
      alert('"من تاريخ" لازم يكون قبل أو يساوي "إلى تاريخ".');
      return;
    }
    setApplied({ from, to, department });
  };
  const handleReset = () => {
    setFrom(monthAgo); setTo(today); setDepartment('All'); setSearch('');
    setApplied({ from: monthAgo, to: today, department: 'All' });
  };

  function exportCSV() {
    if (!filteredRows.length) return;
    const headers = ['الموظف', 'القسم', 'Solve Mistakes', 'Attendance Main', 'Attendance Side', 'Attendance Task', 'الريمارك المفتوحة', 'نسبة غياب الأساسية', 'نسبة غياب الزووم'];
    const csvRows = filteredRows.map(r => [
      r.agent_name, r.department, r.code_problems_fixed,
      r.attendance_main_count, r.attendance_side_count, r.attendance_task_count,
      r.open_remarks_count,
      `${r.main_absent_rate}% (${r.main_absent_count}/${r.main_expected_count})`,
      `${r.zoom_absent_rate}% (${r.zoom_absent_count}/${r.zoom_expected_count})`,
    ]);
    const csv = [headers, ...csvRows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `quality-report-${applied.from}-to-${applied.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportPDF() {
    if (pdfBusy) return;
    if (!filteredRows.length) return;
    setPdfBusy(true);
    setPdfRendering(true);
    try {
      // Two animation frames + small timeout so the hidden plain table is fully painted
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 80));

      const node = document.getElementById('quality-pdf-printable');
      if (!node) throw new Error('PDF area missing');

      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowWidth: node.scrollWidth,
        windowHeight: node.scrollHeight,
      });

      // Landscape A4 fits the wide table much better
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth  = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth   = pageWidth;
      const imgHeight  = (canvas.height * imgWidth) / canvas.width;

      const imgData = canvas.toDataURL('image/jpeg', 0.93);

      if (imgHeight <= pageHeight) {
        pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
      } else {
        // Multi-page: paint full image but shift y per page so each page shows the next chunk
        let position = 0;
        let heightLeft = imgHeight;
        while (heightLeft > 0) {
          pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
          heightLeft -= pageHeight;
          if (heightLeft > 0) {
            position -= pageHeight;
            pdf.addPage();
          }
        }
      }

      pdf.save(`quality-report-${applied.from}-to-${applied.to}.pdf`);
    } catch (e) {
      alert('تعذّر إنشاء الـ PDF: ' + (e.message || 'خطأ غير معروف'));
    } finally {
      setPdfRendering(false);
      setPdfBusy(false);
    }
  }

  const inputCls = 'w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500';

  // Helper: clickable badge for a numeric cell
  function NumBadge({ value, color, agent, type }) {
    const colorMap = {
      pink:   { active: 'bg-pink-100 text-pink-700 border-pink-200 hover:bg-pink-200',         dim: 'bg-gray-50 text-gray-400 border-gray-200' },
      blue:   { active: 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200',         dim: 'bg-gray-50 text-gray-400 border-gray-200' },
      purple: { active: 'bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-200', dim: 'bg-gray-50 text-gray-400 border-gray-200' },
      cyan:   { active: 'bg-cyan-100 text-cyan-700 border-cyan-200 hover:bg-cyan-200',         dim: 'bg-gray-50 text-gray-400 border-gray-200' },
      amber:  { active: 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200',     dim: 'bg-gray-50 text-gray-400 border-gray-200' },
    };
    const c = colorMap[color] || colorMap.blue;
    const cls = value > 0 ? c.active + ' cursor-pointer transition-colors' : c.dim + ' cursor-default';
    return (
      <button
        onClick={() => value > 0 && setDrill({ open: true, agent, type })}
        disabled={value === 0}
        className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black border ${cls}`}
      >
        {value}
      </button>
    );
  }

  // Rate badge with breakdown shown on hover
  function RateBadge({ rate, absent, expected, agent, type }) {
    const tone = rate >= 30 ? 'rose' : rate >= 15 ? 'amber' : rate > 0 ? 'emerald' : 'gray';
    const cls = {
      rose:    'bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-200',
      amber:   'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200',
      emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200',
      gray:    'bg-gray-50 text-gray-400 border-gray-200 cursor-default',
    }[tone];
    return (
      <button
        onClick={() => absent > 0 && setDrill({ open: true, agent, type })}
        disabled={absent === 0}
        title={`${absent} غياب من ${expected} متوقع`}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-black border transition-colors ${cls} ${absent > 0 ? 'cursor-pointer' : ''}`}
      >
        <span>{rate}%</span>
        {absent > 0 && <span className="opacity-60 text-[10px]">({absent}/{expected})</span>}
      </button>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="تقارير الجودة"
        subtitle="تقرير شامل لكل موظف — اضغط على أي رقم لعرض التفاصيل"
        icon={ShieldCheck}
        gradient="emerald"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <ModernButton variant="glass" icon={Snowflake} onClick={() => setFreezeOpen(true)}
                          disabled={!filteredRows.length}>
              حفظ نسخة دائمة
            </ModernButton>
            <ModernButton variant="glass" icon={FileDown} onClick={exportPDF}
                          disabled={!filteredRows.length || pdfBusy}>
              {pdfBusy ? 'جاري التحضير...' : 'تنزيل PDF'}
            </ModernButton>
            <ModernButton variant="glass" icon={Download} onClick={exportCSV} disabled={!filteredRows.length}>
              تنزيل CSV
            </ModernButton>
          </div>
        }
        stats={[
          { label: 'موظفين',          value: summary.total_agents || 0,    icon: Users },
          { label: 'Solve Mistakes',  value: summary.total_code_fixed || 0, icon: Wrench },
          { label: 'Attendance Main', value: summary.total_main || 0,      icon: BookOpen },
          { label: 'Attendance Side', value: summary.total_side || 0,      icon: Video },
          { label: 'ريمارك مفتوحة',  value: summary.total_open || 0,      icon: AlertCircle },
        ]}
      />

      {/* Filters */}
      <div className="rounded-2xl border border-gray-100 overflow-hidden bg-white shadow-sm">
        <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-l from-emerald-50 to-white flex items-center gap-2.5">
          <div className="p-1.5 bg-emerald-100 rounded-lg">
            <Filter size={14} className="text-emerald-600" />
          </div>
          <span className="text-sm font-black text-gray-800">فلاتر التقرير</span>
          {(applied.from !== monthAgo || applied.to !== today || applied.department !== 'All') && (
            <span className="ms-auto text-[11px] font-black px-2.5 py-1 rounded-full bg-emerald-600 text-white">
              فلاتر مفعّلة
            </span>
          )}
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-black text-gray-500 mb-1.5">
                <Calendar size={12} /> من تاريخ
              </label>
              <input type="date" value={from} max={today} onChange={e => setFrom(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-black text-gray-500 mb-1.5">
                <Calendar size={12} /> إلى تاريخ
              </label>
              <input type="date" value={to} max={today} onChange={e => setTo(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-black text-gray-500 mb-1.5">
                <Layers size={12} /> القسم
              </label>
              <select value={department} onChange={e => setDepartment(e.target.value)} className={inputCls}>
                <option value="All">الكل</option>
                <option value="General">General</option>
                <option value="Private">Private</option>
                <option value="Semi">Semi</option>
              </select>
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-black text-gray-500 mb-1.5">
                <Search size={12} /> بحث باسم الموظف
              </label>
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                     placeholder="...الاسم" className={inputCls} />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <ModernButton variant="primary" onClick={handleApply}>تطبيق الفلاتر</ModernButton>
            <ModernButton variant="ghost" onClick={handleReset}><X size={14} /> إعادة تعيين</ModernButton>
          </div>
        </div>
      </div>

      {/* Results: table on the right + per-department averages sidebar on
          the left. Grid switches to single-column on small screens so the
          sidebar drops below the table on phones / narrow tablets. */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 items-start">

        {/* ─── Department averages sidebar ──────────────────────────── */}
        <SectionCard
          title="متوسط النسب لكل قسم"
          subtitle="نسبة موزّونة (مجموع الغياب ÷ مجموع المتوقع)"
          icon={Layers}
          accent="violet"
        >
          {deptAverages.length === 0 ? (
            <p className="text-center py-8 text-gray-400 text-xs font-bold">لا توجد بيانات</p>
          ) : (
            <div className="space-y-3">
              {deptAverages.map((d) => {
                const deptCls = {
                  General: { bg: 'bg-blue-50',    bd: 'border-blue-200',    fg: 'text-blue-700'    },
                  Private: { bg: 'bg-violet-50',  bd: 'border-violet-200',  fg: 'text-violet-700'  },
                  Semi:    { bg: 'bg-orange-50',  bd: 'border-orange-200',  fg: 'text-orange-700'  },
                }[d.department] || { bg: 'bg-gray-50', bd: 'border-gray-200', fg: 'text-gray-700' };
                const rateColor = (r) => r >= 30 ? 'text-rose-700 bg-rose-100'
                                       : r >= 15 ? 'text-amber-700 bg-amber-100'
                                       : r > 0   ? 'text-emerald-700 bg-emerald-100'
                                       :           'text-gray-500 bg-gray-100';
                return (
                  <div key={d.department}
                       className={`rounded-xl border ${deptCls.bd} ${deptCls.bg} p-3`}>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className={`text-xs font-black ${deptCls.fg}`}>{d.department}</span>
                      <span className="text-[10px] font-bold text-gray-500">
                        {d.employees} موظف
                      </span>
                    </div>

                    {/* Main absence rate */}
                    <div className="mb-2">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] font-bold text-gray-600 inline-flex items-center gap-1">
                          <UserX size={10} className="text-rose-500" /> غياب أساسي
                        </span>
                        <span className={`text-[11px] font-black px-1.5 py-0.5 rounded-md ${rateColor(d.mainRate)}`}>
                          {d.mainRate}%
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono">
                        {d.mainAbsent} / {d.mainExpected}
                      </div>
                    </div>

                    {/* Zoom absence rate */}
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] font-bold text-gray-600 inline-flex items-center gap-1">
                          <TrendingDown size={10} className="text-violet-500" /> غياب زووم
                        </span>
                        <span className={`text-[11px] font-black px-1.5 py-0.5 rounded-md ${rateColor(d.zoomRate)}`}>
                          {d.zoomRate}%
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono">
                        {d.zoomAbsent} / {d.zoomExpected}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        {/* ─── Main results table ───────────────────────────────────── */}
        <SectionCard
          title="تقرير الجودة لكل موظف"
          subtitle={`${filteredRows.length} موظف · من ${applied.from} إلى ${applied.to} · اضغط على أي رقم للتفاصيل`}
          icon={ClipboardCheck}
          accent="emerald"
          noBodyPad
        >
        {isLoading ? (
          <p className="text-center py-12 text-gray-400 text-sm font-bold">جاري التحميل...</p>
        ) : filteredRows.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            accent="emerald"
            title="لا توجد بيانات"
            message="غيّر الفلاتر أو وسّع الفترة الزمنية لمشاهدة النتائج."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead>
                <tr className="bg-gray-50/60 border-b border-gray-100">
                  <th className="px-5 py-3 text-xs font-black text-gray-500 whitespace-nowrap">الموظف</th>
                  <th className="px-5 py-3 text-xs font-black text-gray-500 whitespace-nowrap">القسم</th>
                  <th className="px-5 py-3 text-xs font-black text-gray-500 whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5"><Wrench size={12} className="text-pink-500" />Solve Mistakes</div>
                  </th>
                  <th className="px-5 py-3 text-xs font-black text-gray-500 whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5"><BookOpen size={12} className="text-blue-500" />Attendance Main</div>
                  </th>
                  <th className="px-5 py-3 text-xs font-black text-gray-500 whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5"><Video size={12} className="text-purple-500" />Attendance Side</div>
                  </th>
                  <th className="px-5 py-3 text-xs font-black text-gray-500 whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5"><FileText size={12} className="text-cyan-500" />Attendance Task</div>
                  </th>
                  <th className="px-5 py-3 text-xs font-black text-gray-500 whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5"><AlertCircle size={12} className="text-amber-500" />ريمارك مفتوحة</div>
                  </th>
                  <th className="px-5 py-3 text-xs font-black text-gray-500 whitespace-nowrap bg-rose-50/40">
                    <div className="inline-flex items-center gap-1.5"><UserX size={12} className="text-rose-500" />نسبة غياب الأساسية</div>
                  </th>
                  <th className="px-5 py-3 text-xs font-black text-gray-500 whitespace-nowrap bg-violet-50/40">
                    <div className="inline-flex items-center gap-1.5"><TrendingDown size={12} className="text-violet-500" />نسبة غياب الزووم</div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredRows.map((r, i) => {
                  const deptCls = {
                    General: 'bg-blue-100 text-blue-700 border-blue-200',
                    Private: 'bg-violet-100 text-violet-700 border-violet-200',
                    Semi:    'bg-orange-100 text-orange-700 border-orange-200',
                  }[r.department] || 'bg-gray-100 text-gray-700 border-gray-200';

                  return (
                    <tr key={r.agent_id || i} className="hover:bg-gray-50/40 transition-colors">
                      <td className="px-5 py-3 font-black text-gray-900">{r.agent_name}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black border ${deptCls}`}>
                          {r.department}
                        </span>
                      </td>
                      <td className="px-5 py-3"><NumBadge value={r.code_problems_fixed}    color="pink"   agent={r.agent_name} type="fixed" /></td>
                      <td className="px-5 py-3"><NumBadge value={r.attendance_main_count}  color="blue"   agent={r.agent_name} type="main" /></td>
                      <td className="px-5 py-3"><NumBadge value={r.attendance_side_count}  color="purple" agent={r.agent_name} type="side" /></td>
                      <td className="px-5 py-3"><NumBadge value={r.attendance_task_count}  color="cyan"   agent={r.agent_name} type="task" /></td>
                      <td className="px-5 py-3"><NumBadge value={r.open_remarks_count}     color="amber"  agent={r.agent_name} type="open" /></td>
                      <td className="px-5 py-3 bg-rose-50/30">
                        <RateBadge rate={r.main_absent_rate} absent={r.main_absent_count} expected={r.main_expected_count}
                                   agent={r.agent_name} type="main_absent" />
                      </td>
                      <td className="px-5 py-3 bg-violet-50/30">
                        <RateBadge rate={r.zoom_absent_rate} absent={r.zoom_absent_count} expected={r.zoom_expected_count}
                                   agent={r.agent_name} type="zoom_absent" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-emerald-50/60 border-t-2 border-emerald-200">
                  <td className="px-5 py-3 font-black text-gray-900" colSpan={2}>الإجمالي</td>
                  <td className="px-5 py-3 font-black text-pink-700">{summary.total_code_fixed || 0}</td>
                  <td className="px-5 py-3 font-black text-blue-700">{summary.total_main || 0}</td>
                  <td className="px-5 py-3 font-black text-purple-700">{summary.total_side || 0}</td>
                  <td className="px-5 py-3 font-black text-cyan-700">{summary.total_task || 0}</td>
                  <td className="px-5 py-3 font-black text-amber-700">{summary.total_open || 0}</td>
                  <td className="px-5 py-3 font-black text-rose-700 bg-rose-50/40">{summary.total_main_absent || 0}</td>
                  <td className="px-5 py-3 font-black text-violet-700 bg-violet-50/40">{summary.total_zoom_absent || 0}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        </SectionCard>
      </div>

      {/* Hidden printable area — rendered only during PDF generation. Plain
          inline styles only (no Tailwind/oklch/gradients) so html2canvas
          captures cleanly and reliably. */}
      {pdfRendering && (
        <div
          id="quality-pdf-printable"
          style={{
            position: 'fixed',
            top: 0,
            left: '-10000px',
            width: '1400px',
            backgroundColor: '#ffffff',
            padding: '24px',
            fontFamily: 'Tahoma, "Segoe UI", Arial, sans-serif',
            color: '#111827',
            direction: 'rtl',
          }}
        >
          {/* Title — English only (Arabic rendering broken under html2canvas).
              Filter dates shown below in clean LTR format. */}
          <div style={{ borderBottom: '3px solid #10b981', paddingBottom: '12px', marginBottom: '16px' }}>
            <div
              dir="ltr"
              style={{
                fontSize: '22px',
                fontWeight: 700,
                color: '#065f46',
                letterSpacing: '0.5px',
              }}
            >
              Quality Report — Per Employee
            </div>
            <div
              dir="ltr"
              style={{
                display: 'flex',
                gap: '20px',
                marginTop: '8px',
                fontSize: '13px',
                color: '#374151',
                fontWeight: 600,
              }}
            >
              <span>
                <span style={{ color: '#6b7280' }}>From:</span>{' '}
                <span style={{ color: '#065f46', fontWeight: 700 }}>{applied.from || '—'}</span>
              </span>
              <span>
                <span style={{ color: '#6b7280' }}>To:</span>{' '}
                <span style={{ color: '#065f46', fontWeight: 700 }}>{applied.to || '—'}</span>
              </span>
              <span>
                <span style={{ color: '#6b7280' }}>Employees:</span>{' '}
                <span style={{ color: '#065f46', fontWeight: 700 }}>{filteredRows.length}</span>
              </span>
              {applied.department && applied.department !== 'All' && (
                <span>
                  <span style={{ color: '#6b7280' }}>Department:</span>{' '}
                  <span style={{ color: '#065f46', fontWeight: 700 }}>{applied.department}</span>
                </span>
              )}
            </div>
          </div>

          {/* Summary chips */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
            {[
              { label: 'موظفين',         value: summary.total_agents       || 0, bg: '#ecfdf5', fg: '#065f46' },
              { label: 'Solve Mistakes', value: summary.total_code_fixed   || 0, bg: '#fdf2f8', fg: '#9d174d' },
              { label: 'Attendance Main', value: summary.total_main         || 0, bg: '#eff6ff', fg: '#1e40af' },
              { label: 'Attendance Side', value: summary.total_side         || 0, bg: '#faf5ff', fg: '#6b21a8' },
              { label: 'Attendance Task', value: summary.total_task         || 0, bg: '#ecfeff', fg: '#155e75' },
              { label: 'ريمارك مفتوحة',  value: summary.total_open         || 0, bg: '#fffbeb', fg: '#92400e' },
              { label: 'غياب أساسي',     value: summary.total_main_absent  || 0, bg: '#fff1f2', fg: '#9f1239' },
              { label: 'غياب زووم',      value: summary.total_zoom_absent  || 0, bg: '#f5f3ff', fg: '#5b21b6' },
            ].map((c, i) => (
              <div
                key={i}
                style={{
                  background: c.bg,
                  color: c.fg,
                  padding: '10px 16px',
                  borderRadius: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  minWidth: '120px',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '4px', opacity: 0.85 }}>
                  {c.label}
                </div>
                <div style={{ fontSize: '20px', fontWeight: 800, lineHeight: 1 }}>
                  {c.value}
                </div>
              </div>
            ))}
          </div>

          {/* Department averages — vertical centered layout that looks balanced
              regardless of card width (avoids huge gap from space-between). */}
          {deptAverages.length > 0 && (
            <div style={{
              background: '#fafafa',
              border: '1px solid #e5e7eb',
              borderRadius: '10px',
              padding: '16px',
              marginBottom: '14px',
            }}>
              <div style={{
                fontSize: '15px',
                fontWeight: 700,
                color: '#5b21b6',
                marginBottom: '14px',
                paddingBottom: '10px',
                borderBottom: '2px solid #ddd6fe',
                textAlign: 'center',
              }}>
                متوسط النسب لكل قسم — Department Averages
                <div style={{ fontSize: '11px', fontWeight: 500, color: '#6b7280', marginTop: '3px' }}>
                  (نسبة موزّونة: مجموع الغياب ÷ مجموع المتوقع)
                </div>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${deptAverages.length}, 1fr)`,
                gap: '12px',
              }}>
                {deptAverages.map((d) => {
                  const colors = {
                    General: { bg: '#eff6ff', bd: '#bfdbfe', fg: '#1e40af' },
                    Private: { bg: '#f5f3ff', bd: '#ddd6fe', fg: '#6b21a8' },
                    Semi:    { bg: '#fff7ed', bd: '#fed7aa', fg: '#9a3412' },
                  }[d.department] || { bg: '#f9fafb', bd: '#e5e7eb', fg: '#374151' };
                  const rateBg = (r) => r >= 30 ? '#fee2e2'
                                       : r >= 15 ? '#fef3c7'
                                       : r > 0   ? '#d1fae5' : '#f3f4f6';
                  const rateFg = (r) => r >= 30 ? '#991b1b'
                                       : r >= 15 ? '#92400e'
                                       : r > 0   ? '#065f46' : '#6b7280';
                  return (
                    <div key={d.department} style={{
                      background: colors.bg,
                      border: `1px solid ${colors.bd}`,
                      borderRadius: '10px',
                      padding: '14px',
                      textAlign: 'center',
                    }}>
                      {/* Header: department name + employee count, both centered */}
                      <div style={{
                        marginBottom: '12px',
                        paddingBottom: '10px',
                        borderBottom: `1px solid ${colors.bd}`,
                      }}>
                        <div style={{ fontSize: '16px', fontWeight: 800, color: colors.fg, marginBottom: '2px' }}>
                          {d.department}
                        </div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280' }}>
                          {d.employees} موظف
                        </div>
                      </div>

                      {/* Two metrics side by side, each centered in its half */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        {/* Main absence */}
                        <div style={{
                          background: '#ffffff',
                          border: `1px solid ${colors.bd}`,
                          borderRadius: '8px',
                          padding: '10px 6px',
                        }}>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: '#374151', marginBottom: '6px' }}>
                            غياب أساسى
                          </div>
                          <div style={{
                            display: 'inline-block',
                            fontSize: '18px',
                            fontWeight: 800,
                            background: rateBg(d.mainRate),
                            color: rateFg(d.mainRate),
                            padding: '4px 12px',
                            borderRadius: '8px',
                            marginBottom: '4px',
                          }}>
                            {d.mainRate}%
                          </div>
                          <div style={{ fontSize: '10px', color: '#6b7280', fontFamily: 'monospace' }}>
                            {d.mainAbsent} / {d.mainExpected}
                          </div>
                        </div>

                        {/* Zoom absence */}
                        <div style={{
                          background: '#ffffff',
                          border: `1px solid ${colors.bd}`,
                          borderRadius: '8px',
                          padding: '10px 6px',
                        }}>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: '#374151', marginBottom: '6px' }}>
                            غياب زووم
                          </div>
                          <div style={{
                            display: 'inline-block',
                            fontSize: '18px',
                            fontWeight: 800,
                            background: rateBg(d.zoomRate),
                            color: rateFg(d.zoomRate),
                            padding: '4px 12px',
                            borderRadius: '8px',
                            marginBottom: '4px',
                          }}>
                            {d.zoomRate}%
                          </div>
                          <div style={{ fontSize: '10px', color: '#6b7280', fontFamily: 'monospace' }}>
                            {d.zoomAbsent} / {d.zoomExpected}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Plain table */}
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '12px',
            tableLayout: 'fixed',
          }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                {['الموظف','القسم','Solve Mistakes','Attendance Main','Attendance Side','Attendance Task','ريمارك مفتوحة','نسبة غياب الأساسية','نسبة غياب الزووم'].map((h, i) => (
                  <th key={i} style={{
                    padding: '10px 6px',
                    textAlign: 'center',
                    verticalAlign: 'middle',
                    fontWeight: 700,
                    color: '#374151',
                    border: '1px solid #e5e7eb',
                    fontSize: '11px',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r, i) => {
                const cellBase = {
                  padding: '8px 6px',
                  border: '1px solid #e5e7eb',
                  textAlign: 'center',
                  verticalAlign: 'middle',
                  fontWeight: 700,
                };
                return (
                  <tr key={r.agent_id || i} style={{ background: i % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                    <td style={{ ...cellBase, fontWeight: 700, color: '#111827' }}>{r.agent_name}</td>
                    <td style={{ ...cellBase, fontWeight: 600, color: '#374151' }}>{r.department}</td>
                    <td style={{ ...cellBase, color: '#9d174d' }}>{r.code_problems_fixed}</td>
                    <td style={{ ...cellBase, color: '#1e40af' }}>{r.attendance_main_count}</td>
                    <td style={{ ...cellBase, color: '#6b21a8' }}>{r.attendance_side_count}</td>
                    <td style={{ ...cellBase, color: '#155e75' }}>{r.attendance_task_count}</td>
                    <td style={{ ...cellBase, color: '#92400e' }}>{r.open_remarks_count}</td>
                    <td style={{ ...cellBase, color: '#9f1239' }}>
                      {r.main_absent_rate}% <span style={{ color: '#6b7280', fontWeight: 500 }}>({r.main_absent_count}/{r.main_expected_count})</span>
                    </td>
                    <td style={{ ...cellBase, color: '#5b21b6' }}>
                      {r.zoom_absent_rate}% <span style={{ color: '#6b7280', fontWeight: 500 }}>({r.zoom_absent_count}/{r.zoom_expected_count})</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#ecfdf5', borderTop: '2px solid #10b981' }}>
                <td colSpan={2} style={{ padding: '10px 6px', border: '1px solid #d1fae5', textAlign: 'center', verticalAlign: 'middle', fontWeight: 800 }}>الإجمالي</td>
                <td style={{ padding: '10px 6px', border: '1px solid #d1fae5', textAlign: 'center', verticalAlign: 'middle', fontWeight: 800, color: '#9d174d' }}>{summary.total_code_fixed || 0}</td>
                <td style={{ padding: '10px 6px', border: '1px solid #d1fae5', textAlign: 'center', verticalAlign: 'middle', fontWeight: 800, color: '#1e40af' }}>{summary.total_main || 0}</td>
                <td style={{ padding: '10px 6px', border: '1px solid #d1fae5', textAlign: 'center', verticalAlign: 'middle', fontWeight: 800, color: '#6b21a8' }}>{summary.total_side || 0}</td>
                <td style={{ padding: '10px 6px', border: '1px solid #d1fae5', textAlign: 'center', verticalAlign: 'middle', fontWeight: 800, color: '#155e75' }}>{summary.total_task || 0}</td>
                <td style={{ padding: '10px 6px', border: '1px solid #d1fae5', textAlign: 'center', verticalAlign: 'middle', fontWeight: 800, color: '#92400e' }}>{summary.total_open || 0}</td>
                <td style={{ padding: '10px 6px', border: '1px solid #d1fae5', textAlign: 'center', verticalAlign: 'middle', fontWeight: 800, color: '#9f1239' }}>{summary.total_main_absent || 0}</td>
                <td style={{ padding: '10px 6px', border: '1px solid #d1fae5', textAlign: 'center', verticalAlign: 'middle', fontWeight: 800, color: '#5b21b6' }}>{summary.total_zoom_absent || 0}</td>
              </tr>
            </tfoot>
          </table>

          {/* Footer — kept fully LTR + English to avoid bidi rendering issues
              in html2canvas with mixed Arabic/Latin numerals. */}
          <div
            dir="ltr"
            style={{
              marginTop: '14px',
              fontSize: '10px',
              color: '#6b7280',
              textAlign: 'left',
              fontFamily: 'Tahoma, "Segoe UI", Arial, sans-serif',
            }}
          >
            Generated: {new Date().toISOString().slice(0, 19).replace('T', ' ')} · Ahmed Hassan Academy — Quality Reports
          </div>
        </div>
      )}

      <DetailsModal
        open={drill.open}
        agent={drill.agent}
        type={drill.type}
        from={applied.from}
        to={applied.to}
        onClose={() => setDrill({ open: false, agent: null, type: null })}
      />

      <FreezeSnapshotModal
        open={freezeOpen}
        onClose={() => setFreezeOpen(false)}
        applied={applied}
        summary={summary}
        rows={filteredRows}
        deptAverages={deptAverages}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['quality-snapshots'] });
          setFreezeOpen(false);
          if (window.confirm('تم حفظ النسخة بنجاح. هل تريد فتح صفحة النسخ المحفوظة الآن؟')) {
            navigate('/admin/reports/quality-snapshots');
          }
        }}
      />
    </div>
  );
}

// ─── FREEZE SNAPSHOT MODAL ───────────────────────────────────────────────────
function FreezeSnapshotModal({ open, onClose, applied, summary, rows, deptAverages, onSaved }) {
  const defaultLabel = applied.from && applied.to
    ? `Quality Report ${applied.from} → ${applied.to}`
    : `Quality Report Snapshot`;
  const [label, setLabel] = useState(defaultLabel);
  const [notes, setNotes] = useState('');
  const [isOfficial, setIsOfficial] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset label when modal opens with new context
  useMemo(() => {
    if (open) {
      setLabel(defaultLabel);
      setNotes('');
      setIsOfficial(false);
      setError('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultLabel]);

  if (!open) return null;

  const handleSave = async () => {
    if (!label.trim()) { setError('يرجى إدخال اسم للنسخة'); return; }
    setSaving(true);
    setError('');
    try {
      await api.post('/reports/quality-snapshot', {
        label: label.trim(),
        from: applied.from || null,
        to:   applied.to   || null,
        department: applied.department || 'All',
        notes: notes.trim() || null,
        summary,
        rows,
        dept_averages: deptAverages,
        is_official: isOfficial,
      });
      onSaved && onSaved();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-l from-cyan-600 to-blue-600 text-white px-6 py-4 flex items-center gap-3">
          <Snowflake size={20} />
          <div className="flex-1">
            <h2 className="text-base font-black">حفظ نسخة دائمة من التقرير</h2>
            <p className="text-xs font-bold opacity-90 mt-0.5">
              الأرقام هتتسجل دلوقتى ومتتغيرش حتى لو رفعت ملفات Excel جديدة
            </p>
          </div>
          <button onClick={onClose} className="p-2 bg-white/15 hover:bg-white/25 rounded-xl backdrop-blur">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Snapshot details summary */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs">
            <div className="grid grid-cols-2 gap-2 text-gray-700 font-bold">
              <div><span className="text-gray-500">من تاريخ:</span> {applied.from || '—'}</div>
              <div><span className="text-gray-500">إلى تاريخ:</span> {applied.to || '—'}</div>
              <div><span className="text-gray-500">القسم:</span> {applied.department || 'All'}</div>
              <div><span className="text-gray-500">الموظفين:</span> {rows.length}</div>
            </div>
          </div>

          {/* Label */}
          <div>
            <label className="text-xs font-black text-gray-600 mb-1 block">
              اسم النسخة <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="مثال: Quality Report - April 2026 Final"
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500"
              maxLength={200}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-black text-gray-600 mb-1 block">ملاحظات (اختياري)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="مثال: نسخة نهاية أبريل قبل اجتماع الإدارة"
              rows={3}
              className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 resize-none"
              maxLength={500}
            />
          </div>

          {/* Official toggle */}
          <div className={`border-2 rounded-xl p-3 transition ${isOfficial ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-gray-50'}`}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isOfficial}
                onChange={e => setIsOfficial(e.target.checked)}
                className="mt-0.5 w-5 h-5 accent-emerald-600"
              />
              <div className="flex-1">
                <div className="text-sm font-black text-gray-800 flex items-center gap-1.5">
                  📌 نسخة رسمية لنهاية الفترة (Official End-of-Period)
                </div>
                <p className="text-[11px] text-gray-600 mt-1 leading-relaxed">
                  لما تفعّل ده، النسخة دى هتبقى المصدر الرسمى للأرقام عند:
                  <br/>• وضع تحديات الأقسام (Baseline)
                  <br/>• تقييم الأهداف نهاية الفترة (Actual)
                  <br/>
                  <span className="text-amber-700 font-bold">⚠ لو فيه نسخة رسمية تانية لنفس الفترة، هتتحول لمسوّدة تلقائياً.</span>
                </p>
              </div>
            </label>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 border-t border-gray-200 px-6 py-3 flex justify-end gap-2">
          <ModernButton variant="ghost" onClick={onClose} disabled={saving}>
            إلغاء
          </ModernButton>
          <ModernButton variant="primary" icon={Save} onClick={handleSave} disabled={saving || !label.trim()}>
            {saving ? 'جارى الحفظ...' : 'حفظ النسخة'}
          </ModernButton>
        </div>
      </div>
    </div>
  );
}
