import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck, Calendar, Filter, Search, X, Download, Wrench,
  ClipboardCheck, AlertCircle, Video, BookOpen, Layers, FileText, Users,
  TrendingDown, Phone, UserX, FileDown,
} from 'lucide-react';
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
  const printRef                    = useRef(null);

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

  const handleApply = () => setApplied({ from, to, department });
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
    try {
      // Wait two animation frames so the layout is fully painted
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const node = printRef.current;
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
          <div className="flex items-center gap-2">
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

      {/* Results table — wrapped in a ref so the PDF export captures everything (header + table + totals) */}
      <div ref={printRef} className="bg-white">
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

      <DetailsModal
        open={drill.open}
        agent={drill.agent}
        type={drill.type}
        from={applied.from}
        to={applied.to}
        onClose={() => setDrill({ open: false, agent: null, type: null })}
      />
    </div>
  );
}
