'use client';
import { useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, TrendingUp, TrendingDown, Activity, AlertTriangle,
  CheckCircle2, Lightbulb, Users, Download, FileSpreadsheet,
  FileText, Clock, Zap, Sparkles, Sun, Moon, User, X,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine,
} from 'recharts';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import EmptyState from '../../components/ui/EmptyState';
import HolidayBanner from '../../components/ui/HolidayBanner';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SECTIONS = {
  all:        'الكل',
  general:    'عام',
  private:    'خاص',
  semi:       'شبه خاص',
  phone_call: 'فون كول',
};
const SECTION_TONE = {
  general:    'bg-sky-50 text-sky-700 border-sky-200',
  private:    'bg-violet-50 text-violet-700 border-violet-200',
  semi:       'bg-amber-50 text-amber-700 border-amber-200',
  phone_call: 'bg-pink-50 text-pink-700 border-pink-200',
  all:        'bg-slate-100 text-slate-600 border-slate-200',
};
const SECTION_COLORS_CHART = {
  general:    '#0EA5E9',
  private:    '#8B5CF6',
  semi:       '#F59E0B',
  phone_call: '#EC4899',
};

// Status tone (low/normal/high)
const STATUS_BADGE = {
  low:    { cls: 'bg-rose-50 text-rose-700 border-rose-200',       label: 'منخفض' },
  normal: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'طبيعي' },
  high:   { cls: 'bg-amber-50 text-amber-700 border-amber-200',    label: 'مكتمل' },
};

function utilCellColor(util) {
  if (util == null) return '#E2E8F0';
  if (util < 50)   return '#FB7185'; // rose-400
  if (util < 75)   return '#10B981'; // emerald-500
  if (util < 90)   return '#F59E0B'; // amber-500
  if (util <= 100) return '#F97316'; // orange-500
  return '#EF4444';                  // red-500
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function TrainerUtilizationDashboard() {
  const [weeks, setWeeks]     = useState(12);
  const [section, setSection] = useState('all');
  const [trainerName, setTrainerName] = useState('');
  // Detail modal — either group mode ('low'/'high') or single-trainer mode.
  //   { kind: 'group',  type: 'low' | 'high' }
  //   { kind: 'single', trainer: {...} }
  const [detailModal, setDetailModal] = useState(null);
  const openGroupModal  = (type)    => setDetailModal({ kind: 'group',  type });
  const openSingleModal = (trainer) => setDetailModal({ kind: 'single', trainer });
  // Custom date range — overrides `weeks` when both fields are filled.
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate]     = useState('');
  const exportRef               = useRef(null);
  // Both dates filled = custom range, in EITHER order. The backend normalizes
  // an inverted (from > to) range by swapping, so we don't block it here —
  // previously an inverted range silently fell back to the weeks preset.
  const usingCustomRange = !!(fromDate && toDate);

  // Reset trainer selection when section changes — the dropdown options shift.
  const handleSectionChange = (next) => {
    setSection(next);
    setTrainerName('');
  };

  // Fetch the trainer list (used to populate the dropdown).
  const { data: teamList = [] } = useQuery({
    queryKey: ['team-trainers-education'],
    queryFn: () => api.get('/team', { params: { department: 'education', status: 'active' } }).then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const trainerOptions = useMemo(() => {
    return teamList
      .filter(t => section === 'all' || t.section === section)
      .filter(t => t.shift || t.shift2)
      .map(t => ({
        value: t.name,
        label: String(t.name || '').replace(/\([^)]*\)/g, '').trim() || t.name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }, [teamList, section]);

  const { data, isLoading } = useQuery({
    queryKey: ['trainer-utilization-summary', weeks, section, usingCustomRange ? fromDate : null, usingCustomRange ? toDate : null, trainerName],
    queryFn: () => api.get('/reports/trainer-utilization-summary', {
      params: usingCustomRange
        ? { section, from: fromDate, to: toDate, search: trainerName || undefined }
        : { section, weeks, search: trainerName || undefined },
    }).then(r => r.data),
    staleTime: 2 * 60 * 1000,
  });

  const clearCustomRange = () => { setFromDate(''); setToDate(''); };

  const summary           = data?.summary;
  const weeklyTimeline    = data?.weekly_timeline    || [];
  const sectionAverages   = data?.section_averages   || [];
  const trainers          = data?.trainers           || [];
  const insights          = data?.insights           || [];
  const period            = data?.period;

  // ── CSV Export ──────────────────────────────────────────────────────────────
  const exportCsv = () => {
    if (!trainers.length) return;
    const headers = ['الاسم', 'القسم', 'الشيفت', 'الإشغال %', 'المتاح (ساعة)', 'المحجوز (ساعة)', 'الفاضي (ساعة)', 'الحالة'];
    const rows = trainers.map(t => [
      t.name,
      SECTIONS[t.section] || t.section,
      t.shift_summary || '',
      t.utilization_pct ?? '',
      t.available_hours,
      t.booked_hours,
      t.free_hours,
      STATUS_BADGE[t.status]?.label || t.status,
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(cell => {
        const s = String(cell ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(','))
      .join('\n');
    // BOM for Excel Arabic support
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trainer-utilization-${period?.from || 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── PDF Export ──────────────────────────────────────────────────────────────
  // Builds a clean, paginated A4 report (header + KPI summary + grouped trainer
  // table) in an off-screen DOM, then captures each page div as a full-page
  // image. This avoids the old "one tall screenshot sliced blindly" approach
  // that cut cards/rows across pages.
  const exportPdf = async () => {
    if (!trainers.length) return;
    const A4W = 794, A4H = 1123, PAD = 36;
    const esc = s => String(s ?? '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    const pct = v => (v == null ? '—' : v + '%');
    const today = new Date().toISOString().slice(0, 10);
    const periodStr = period ? `${period.from} → ${period.to}` : '';

    // Flatten trainers grouped by section (section header rows + trainer rows)
    const order = ['general', 'private', 'semi', 'phone_call'];
    const groups = {};
    trainers.forEach(t => { (groups[t.section] = groups[t.section] || []).push(t); });
    const items = [];
    order.forEach(sec => {
      const arr = groups[sec];
      if (!arr || !arr.length) return;
      arr.sort((a, b) => (b.utilization_pct || 0) - (a.utilization_pct || 0));
      items.push({ type: 'section', label: SECTIONS[sec] || sec, count: arr.length });
      arr.forEach(t => items.push({ type: 'row', t }));
    });
    // Chunk into pages — fewer rows on page 1 (header + KPIs take space)
    const FIRST = 12, REST = 24;
    const pages = [];
    let idx = 0, first = true;
    while (idx < items.length) {
      const take = first ? FIRST : REST;
      pages.push(items.slice(idx, idx + take));
      idx += take; first = false;
    }
    if (!pages.length) pages.push([]);
    const total = pages.length;

    const rowHtml = (t) => {
      const color = utilCellColor(t.utilization_pct);
      const inactive = t.member_status === 'inactive'
        ? ' <span style="font-size:10px;color:#94a3b8">(غير نشط)</span>' : '';
      return `<tr style="border-bottom:1px solid #eef2f7">
        <td style="padding:7px 10px;font-weight:700;color:#0f172a">${esc(t.name)}${inactive}</td>
        <td style="padding:7px 10px;text-align:center;color:#475569">${esc(SECTIONS[t.section] || t.section)}</td>
        <td style="padding:7px 10px;text-align:center;color:#0f172a;font-weight:700">${t.available_hours}س</td>
        <td style="padding:7px 10px;text-align:center;color:#475569">${t.booked_hours}س</td>
        <td style="padding:7px 10px;text-align:center"><span style="display:inline-block;min-width:46px;padding:3px 8px;border-radius:999px;color:#fff;font-weight:800;background:${color}">${pct(t.utilization_pct)}</span></td>
        <td style="padding:7px 10px;text-align:center;color:#475569">${esc(STATUS_BADGE[t.status]?.label || '')}</td>
      </tr>`;
    };
    const sectionRowHtml = (s) =>
      `<tr style="background:#eef2ff"><td colspan="6" style="padding:6px 10px;font-weight:800;color:#1e3a8a">قسم: ${esc(s.label)} (${s.count})</td></tr>`;
    const tableHead = `<thead><tr style="background:#1f3864;color:#fff;font-size:12px">
        <th style="padding:8px 10px;text-align:right">المدرب</th>
        <th style="padding:8px 10px">القسم</th>
        <th style="padding:8px 10px">المتاح</th>
        <th style="padding:8px 10px">المحجوز</th>
        <th style="padding:8px 10px">الإشغال</th>
        <th style="padding:8px 10px">الحالة</th></tr></thead>`;
    const headerBlock = `
      <div style="background:linear-gradient(135deg,#1e3a8a,#1f3864);color:#fff;border-radius:14px;padding:18px 22px;margin-bottom:16px">
        <div style="font-size:22px;font-weight:800">تقرير إشغال المدربين — الإدارة التعليمية</div>
        <div style="font-size:13px;opacity:.9;margin-top:6px">أكاديمية أحمد حسن · الفترة: ${esc(periodStr)} · تاريخ الإصدار: ${today}</div>
      </div>`;
    const kpi = (lbl, val, c) =>
      `<div style="flex:1;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px">
        <div style="font-size:12px;color:#64748b">${lbl}</div>
        <div style="font-size:22px;font-weight:800;color:${c}">${val}</div></div>`;
    const kpiBlock = summary ? `
      <div style="display:flex;gap:12px;margin-bottom:16px">
        ${kpi('متوسط الإشغال', pct(summary.avg_utilization), '#1d4ed8')}
        ${kpi('ساعات مهدورة', (summary.wasted_hours ?? '—') + ' س', '#d97706')}
        ${kpi('مدربين مكتملين', (summary.high_count ?? 0) + ' / ' + (summary.trainers_total ?? 0), '#ea580c')}
        ${kpi('إشغال منخفض', (summary.low_count ?? 0) + ' / ' + (summary.trainers_total ?? 0), '#e11d48')}
      </div>` : '';

    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-10000px;top:0;';
    container.dir = 'rtl';
    pages.forEach((chunk, pi) => {
      const page = document.createElement('div');
      page.className = 'pdf-page';
      page.style.cssText = `position:relative;width:${A4W}px;min-height:${A4H}px;background:#fff;padding:${PAD}px;box-sizing:border-box;font-family:'Cairo','Tajawal','Segoe UI',Arial,sans-serif;`;
      let inner = '';
      if (pi === 0) inner += headerBlock + kpiBlock;
      inner += `<table style="width:100%;border-collapse:collapse;font-size:13px">${tableHead}<tbody>`;
      chunk.forEach(it => { inner += it.type === 'section' ? sectionRowHtml(it) : rowHtml(it.t); });
      inner += `</tbody></table>`;
      inner += `<div style="position:absolute;bottom:14px;left:0;right:0;text-align:center;font-size:11px;color:#94a3b8">صفحة ${pi + 1} من ${total} · أكاديمية أحمد حسن</div>`;
      page.innerHTML = inner;
      container.appendChild(page);
    });
    document.body.appendChild(container);

    try {
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pageEls = container.querySelectorAll('.pdf-page');
      for (let i = 0; i < pageEls.length; i++) {
        const canvas = await html2canvas(pageEls[i], { scale: 2, backgroundColor: '#FFFFFF', useCORS: true });
        if (i > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297);
      }
      pdf.save(`trainer-utilization-${period?.from || 'export'}.pdf`);
    } finally {
      document.body.removeChild(container);
    }
  };

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="لوحة إشغال المدربين"
        subtitle="نظرة شاملة على الإشغال والاتجاهات والمدربين المتاحين"
        icon={BarChart3}
        gradient="navy"
        actions={
          <div className="flex gap-2">
            <button
              onClick={exportCsv}
              disabled={!trainers.length}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold border border-white/30 transition-all disabled:opacity-50"
            >
              <FileSpreadsheet size={14} /> تنزيل Excel
            </button>
            <button
              onClick={exportPdf}
              disabled={!trainers.length}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold border border-white/30 transition-all disabled:opacity-50"
            >
              <FileText size={14} /> تنزيل PDF
            </button>
          </div>
        }
      />

      <HolidayBanner dates={data?.holiday_dates} />

      {/* ── Filters ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold text-gray-700">الفترة:</span>
        <div className={`flex items-center gap-1 bg-gray-50 rounded-xl p-1 border border-gray-200 ${usingCustomRange ? 'opacity-50' : ''}`}>
          {[4, 8, 12, 24].map(n => (
            <button
              key={n}
              onClick={() => { clearCustomRange(); setWeeks(n); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                weeks === n && !usingCustomRange
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-white'
              }`}
            >
              {n} أسبوع
            </button>
          ))}
        </div>

        {/* Custom date range — overrides the weeks preset when filled */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-700">من:</span>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            dir="ltr"
          />
          <span className="text-xs font-bold text-gray-700">إلى:</span>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            min={fromDate || undefined}
            className="border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            dir="ltr"
          />
          {usingCustomRange && (
            <button
              onClick={clearCustomRange}
              title="إلغاء الفترة المخصصة والرجوع للـ preset"
              className="px-2 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-bold transition-all"
            >
              ✕
            </button>
          )}
        </div>

        <span className="text-xs font-bold text-gray-700 mr-3">القسم:</span>
        <select
          value={section}
          onChange={e => handleSectionChange(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        >
          {Object.entries(SECTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {/* Trainer dropdown — filtered by selected section */}
        <div className="relative min-w-[200px] max-w-xs">
          <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <select
            value={trainerName}
            onChange={e => setTrainerName(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl pr-9 pl-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-white appearance-none"
          >
            <option value="">كل المدربين ({trainerOptions.length})</option>
            {trainerOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {period && (
          <span className="text-xs text-gray-400 mr-auto">
            {period.from} → {period.to}
            {usingCustomRange && <span className="text-blue-500 font-semibold mr-1">(مخصص)</span>}
          </span>
        )}
      </div>

      {/* Container that gets captured for PDF export */}
      <div ref={exportRef} className="space-y-5">
        {isLoading ? (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-3">
              {[1,2,3,4].map(i => <div key={i} className="h-24 bg-gray-100 animate-pulse rounded-2xl" />)}
            </div>
            <div className="h-64 bg-gray-100 animate-pulse rounded-2xl" />
          </div>
        ) : !data ? (
          <div className="bg-white rounded-3xl border border-gray-100">
            <EmptyState icon={BarChart3} accent="gray" title="لا توجد بيانات" message="جرب اختيار قسم آخر أو زيادة فترة الأسابيع" />
          </div>
        ) : (
          <>
            {/* ── KPI Cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard
                title="متوسط الإشغال"
                value={`${summary?.avg_utilization ?? 0}%`}
                icon={Activity}
                tone="blue"
                trend={summary?.trend_pct ?? null}
                trendLabel={summary?.prev_avg_utilization != null
                  ? `الفترة السابقة ${summary.prev_avg_utilization}%`
                  : 'لا توجد فترة سابقة قابلة للمقارنة'}
              />
              <KpiCard
                title="ساعات مهدورة"
                value={summary.wasted_hours}
                suffix="ساعة"
                icon={Clock}
                tone="amber"
                subtitle={summary.wasted_courses_eq > 0 ? `يكفي لـ ${summary.wasted_courses_eq} كورس` : 'إشغال ممتاز'}
              />
              <KpiCard
                title="مدربين إشغال منخفض"
                value={summary.low_count}
                suffix={`من ${summary.trainers_total}`}
                icon={TrendingDown}
                tone="rose"
                subtitle={summary.low_count === 0 ? 'الكل مشغول جيداً' : 'تحت 50% — اضغط للتفاصيل'}
                onClick={summary.low_count > 0 ? () => openGroupModal('low') : null}
              />
              <KpiCard
                title="مدربين مكتملين"
                value={summary.high_count}
                suffix={`من ${summary.trainers_total}`}
                icon={Zap}
                tone="orange"
                subtitle={summary.high_count === 0 ? '—' : 'فوق 90% — اضغط للتفاصيل'}
                onClick={summary.high_count > 0 ? () => openGroupModal('high') : null}
              />
            </div>

            {/* ── Charts row ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Timeline (2 cols on lg) */}
              <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Activity size={16} className="text-blue-500" />
                  <span className="text-sm font-bold text-gray-800">خط الإشغال الزمني</span>
                  <span className="text-xs text-gray-400 mr-auto">{weeks} أسبوع</span>
                </div>
                {weeklyTimeline.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-sm text-gray-400">
                    لا توجد بيانات للفترة المختارة
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={weeklyTimeline} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                      <CartesianGrid stroke="#F1F5F9" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748B' }} reversed />
                      <YAxis tick={{ fontSize: 10, fill: '#64748B' }} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                      <Tooltip
                        contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12 }}
                        formatter={(value) => [`${value}%`, 'متوسط الإشغال']}
                      />
                      <ReferenceLine y={summary?.avg_utilization ?? 0} stroke="#94A3B8" strokeDasharray="4 4" label={{ value: `الإجمالي ${summary?.avg_utilization ?? 0}%`, fill: '#64748B', fontSize: 10, position: 'insideTopLeft' }} />
                      <Line
                        type="monotone"
                        dataKey="avg_utilization"
                        stroke="#3B82F6"
                        strokeWidth={2.5}
                        dot={{ fill: '#3B82F6', r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Section comparison (1 col) */}
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 size={16} className="text-violet-500" />
                  <span className="text-sm font-bold text-gray-800">مقارنة الأقسام</span>
                </div>
                {sectionAverages.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-sm text-gray-400">لا أقسام</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={sectionAverages} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                      <CartesianGrid stroke="#F1F5F9" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748B' }} reversed />
                      <YAxis tick={{ fontSize: 10, fill: '#64748B' }} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                      <Tooltip
                        contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12 }}
                        formatter={(v) => [`${v}%`, 'إشغال']}
                      />
                      <Bar dataKey="avg_utilization" radius={[8, 8, 0, 0]}>
                        {sectionAverages.map((s) => (
                          <Cell key={s.section} fill={SECTION_COLORS_CHART[s.section] || '#64748B'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {/* Per-department raw hours: operational (متاح) vs recorded lectures
                    (محجوز) so نسبة الإشغال = محجوز ÷ متاح is transparent at dept level. */}
                {sectionAverages.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-[11px]">
                      <thead>
                        <tr className="text-gray-500">
                          <th className="text-right py-1 font-semibold">القسم</th>
                          <th className="text-center py-1 font-semibold">المتاح</th>
                          <th className="text-center py-1 font-semibold">المحجوز</th>
                          <th className="text-center py-1 font-semibold">الإشغال</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sectionAverages.map((s) => (
                          <tr key={s.section} className="border-t border-gray-50">
                            <td className="text-right py-1.5 font-semibold text-gray-700">{s.label}</td>
                            <td className="text-center py-1.5 text-gray-800 font-bold">{s.available_hours}س</td>
                            <td className="text-center py-1.5 text-gray-600">{s.booked_hours}س</td>
                            <td className="text-center py-1.5 font-bold text-gray-900">{s.avg_utilization}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* ── Smart Insights ── */}
            {insights.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb size={16} className="text-amber-500" />
                  <span className="text-sm font-bold text-gray-800">رؤى ذكية</span>
                  <span className="text-xs text-gray-400 mr-auto">{insights.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {insights.map((ins, i) => {
                    // Trainer-specific insights become clickable → opens detail modal
                    const t = ins.trainer_name
                      ? trainers.find(x => x.name === ins.trainer_name)
                      : null;
                    return (
                      <InsightCard
                        key={i}
                        insight={ins}
                        onClick={t ? () => openSingleModal(t) : null}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Trainers Table ── */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100">
                <Users size={16} className="text-blue-500" />
                <span className="text-sm font-bold text-gray-800">المدربين</span>
                <span className="text-xs text-gray-400 mr-auto">{trainers.length}</span>
              </div>
              {trainers.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-400">لا يوجد مدربين في الفترة المختارة</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50/60">
                      <tr>
                        <th className="text-right px-5 py-2 font-bold text-gray-600">المدرب</th>
                        <th className="text-right px-3 py-2 font-bold text-gray-600">القسم</th>
                        <th className="text-right px-3 py-2 font-bold text-gray-600">الشيفت</th>
                        <th className="text-center px-3 py-2 font-bold text-gray-600">الإشغال</th>
                        <th className="text-center px-3 py-2 font-bold text-gray-600">المتاح</th>
                        <th className="text-center px-3 py-2 font-bold text-gray-600">المحجوز</th>
                        <th className="text-center px-3 py-2 font-bold text-gray-600">الفاضي</th>
                        <th className="text-center px-3 py-2 font-bold text-gray-600">الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trainers.map(t => (
                        <tr key={t.row_key || t.id} className="border-t border-gray-50 hover:bg-slate-50/40 transition-colors">
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className={`font-bold ${t.member_status === 'inactive' ? 'text-gray-500 line-through decoration-gray-300' : 'text-gray-900'}`}>
                                {t.name}
                              </span>
                              {/* Trainer is deactivated NOW but had activity
                                  during the filter range — surface a chip so
                                  the dashboard reader doesn't think the row
                                  is a current-team metric. */}
                              {t.member_status === 'inactive' && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-gray-200 text-gray-700 border border-gray-300">
                                  غير نشط حالياً
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-semibold border ${SECTION_TONE[t.section] || SECTION_TONE.all}`}>
                              {SECTIONS[t.section] || t.section}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-gray-500">
                            <div className="flex items-center gap-1">
                              {t.shift_summary?.includes('مسائي') ? <Moon size={11} className="text-indigo-400" />
                                : t.shift_summary?.includes('صباحي') ? <Sun size={11} className="text-amber-400" /> : null}
                              <span className="truncate max-w-[150px]">{t.shift_summary || '—'}</span>
                            </div>
                          </td>
                          <td className="text-center px-3 py-2.5">
                            {t.utilization_pct != null ? (
                              <div className="inline-flex items-center gap-2">
                                <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${Math.min(100, t.utilization_pct)}%`,
                                      backgroundColor: utilCellColor(t.utilization_pct),
                                    }}
                                  />
                                </div>
                                <span className="font-bold text-gray-900 min-w-[35px]">{t.utilization_pct}%</span>
                              </div>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="text-center px-3 py-2.5 text-gray-800 font-bold">{t.available_hours}س</td>
                          <td className="text-center px-3 py-2.5 text-gray-600 font-semibold">{t.booked_hours}س</td>
                          <td className="text-center px-3 py-2.5 text-gray-600 font-semibold">{t.free_hours}س</td>
                          <td className="text-center px-3 py-2.5">
                            <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-bold border ${STATUS_BADGE[t.status]?.cls || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                              {STATUS_BADGE[t.status]?.label || t.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Detail modal (group or single trainer) ── */}
      {detailModal && (() => {
        if (detailModal.kind === 'single') {
          const t = detailModal.trainer;
          return (
            <KpiDetailModal
              type={t.status === 'high' ? 'high' : 'low'}
              trainers={[t]}
              singleMode
              period={period}
              onClose={() => setDetailModal(null)}
            />
          );
        }
        return (
          <KpiDetailModal
            type={detailModal.type}
            trainers={trainers.filter(x => x.status === detailModal.type)}
            onClose={() => setDetailModal(null)}
          />
        );
      })()}
    </div>
  );
}

// ─── KPI DETAIL MODAL ─────────────────────────────────────────────────────────
const DOW_AR_LIST = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
function fmtMinsLabel(mins) {
  if (mins == null || mins <= 0) return '0';
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h === 0) return `${m}د`;
  if (m === 0) return `${h}س`;
  return `${h}س ${m}د`;
}
function fmtClock(min) {
  if (min == null) return '';
  const mod = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(mod / 60), mm = mod % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12; if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2,'0')}:${String(mm).padStart(2,'0')} ${ampm}`;
}

function KpiDetailModal({ type, trainers, onClose, singleMode, period }) {
  // For single mode, fetch per-day detail so we can show recurring free slots
  const trainer = singleMode && trainers.length === 1 ? trainers[0] : null;
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['trainer-utilization-detail', trainer?.id, period?.from, period?.to],
    queryFn: () => api.get('/reports/trainer-utilization', {
      params: { from: period.from, to: period.to, search: trainer?.full_name || trainer?.name },
    }).then(r => r.data),
    enabled: !!(trainer && period?.from && period?.to),
    staleTime: 60 * 1000,
  });

  // Aggregate free slots by (day-of-week, start, end) — surfaces recurring patterns
  const slotPatterns = useMemo(() => {
    const detailTrainer = detail?.trainers?.[0];
    if (!detailTrainer) return [];
    const map = {}; // key → { dow, startMin, endMin, weeks, totalMins }
    for (const [date, day] of Object.entries(detailTrainer.days || {})) {
      if (!day.is_work_day) continue;
      const dow = new Date(date + 'T12:00:00').getDay();
      for (const slot of (day.free_slots || [])) {
        const key = `${dow}|${slot.start_min}|${slot.end_min}`;
        if (!map[key]) {
          map[key] = { dow, startMin: slot.start_min, endMin: slot.end_min, weeks: 0, totalMins: 0 };
        }
        map[key].weeks++;
        map[key].totalMins += slot.duration_min;
      }
    }
    return Object.values(map).sort((a, b) => b.totalMins - a.totalMins);
  }, [detail]);

  const baseCfg = type === 'low'
    ? {
        title: 'مدربين الإشغال المنخفض',
        subtitle: 'تحت 50%',
        icon: TrendingDown,
        tone: 'bg-rose-50 text-rose-700 border-rose-200',
        iconBg: 'bg-rose-500',
        utilCls: 'bg-rose-100 text-rose-700 border-rose-200',
      }
    : {
        title: 'مدربين مكتملين',
        subtitle: 'فوق 90% — احتمال احتراق وظيفي',
        icon: Zap,
        tone: 'bg-orange-50 text-orange-700 border-orange-200',
        iconBg: 'bg-orange-500',
        utilCls: 'bg-orange-100 text-orange-700 border-orange-200',
      };
  const cfg = singleMode && trainers.length === 1
    ? { ...baseCfg, title: 'تفاصيل المدرب', subtitle: trainers[0].name }
    : baseCfg;
  const IconComp = cfg.icon;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${singleMode ? 'max-w-xl' : 'max-w-lg'} overflow-hidden flex flex-col max-h-[90vh]`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b border-gray-100 ${cfg.tone.split(' ')[0]}/50`}>
          <div className="flex items-center gap-3">
            <div className={`${cfg.iconBg} w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm`}>
              <IconComp size={18} />
            </div>
            <div>
              <div className="font-bold text-gray-900 text-sm">{cfg.title}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                {cfg.subtitle}{singleMode ? '' : ` · ${trainers.length} مدرب`}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/60 rounded-lg transition-all">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {trainers.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">مفيش مدربين في الحالة دي</div>
          ) : (
            <div className="space-y-2">
              {trainers.map(t => (
                <div
                  key={t.row_key || t.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50/60 border border-slate-100 hover:bg-slate-50 transition-colors"
                >
                  <div className={`${cfg.iconBg} w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0`}>
                    {t.name?.charAt(0) || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-900 text-sm truncate">{t.name}</div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${SECTION_TONE[t.section] || SECTION_TONE.all}`}>
                        {SECTIONS[t.section] || t.section}
                      </span>
                      {t.shift_summary?.includes('مسائي')
                        ? <Moon size={10} className="text-indigo-400" />
                        : t.shift_summary?.includes('صباحي') ? <Sun size={10} className="text-amber-400" /> : null}
                      <span className="text-[10px] text-gray-500 truncate">{t.shift_summary}</span>
                    </div>
                  </div>
                  <div className={`inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-xs font-extrabold border ${cfg.utilCls} shrink-0`}>
                    {t.utilization_pct}%
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Free slots breakdown — single trainer mode only */}
          {singleMode && trainer && (
            <div className="space-y-2">
              <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                <div className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Clock size={13} className="text-sky-600" />
                  أوقات الفراغ في الفترة
                </div>
                <span className="text-[10px] text-gray-400" dir="ltr">{period?.from} → {period?.to}</span>
              </div>

              {detailLoading ? (
                <div className="space-y-1.5">
                  {[1,2,3].map(i => <div key={i} className="h-9 bg-gray-100 animate-pulse rounded-lg" />)}
                </div>
              ) : slotPatterns.length === 0 ? (
                <div className="text-center py-4 text-xs text-gray-400 bg-gray-50/60 rounded-xl">
                  مفيش وقت فراغ ثابت في الفترة — كل الفترات مكتملة بالكامل
                </div>
              ) : (
                <>
                  <div className="text-[11px] text-gray-500 mb-1">
                    عرض {slotPatterns.length} فترة مستمرة (مجمعة حسب يوم الأسبوع + الوقت)
                  </div>
                  <div className="space-y-1.5">
                    {slotPatterns.map((p, i) => {
                      const dur = p.endMin - p.startMin;
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-50/60 border border-sky-100"
                        >
                          <span className="text-[11px] font-bold text-sky-900 min-w-[55px]">
                            {DOW_AR_LIST[p.dow]}
                          </span>
                          <span className="text-[11px] font-mono font-bold text-sky-900" dir="ltr">
                            {fmtClock(p.startMin)} → {fmtClock(p.endMin)}
                          </span>
                          <span className="text-[10px] text-sky-600 me-auto">
                            ({fmtMinsLabel(dur)})
                          </span>
                          <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-full font-bold bg-sky-100 text-sky-700 border border-sky-200 whitespace-nowrap">
                            {p.weeks} مرة · {fmtMinsLabel(p.totalMins)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-[11px] text-gray-600 bg-amber-50/50 border border-amber-100 rounded-lg px-3 py-2">
                    💡 الفترات المستمرة (4 من 4 أسابيع مثلاً) صالحة لفتح كورس جديد عليها مباشرة
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
          <button
            onClick={onClose}
            className="w-full py-2 rounded-xl bg-gray-200 hover:bg-gray-300 text-sm font-semibold text-gray-700 transition-all"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, suffix, icon, tone, subtitle, trend, trendLabel, onClick }) {
  const IconComp = icon;
  const tones = {
    blue:    { bg: 'from-blue-50 to-cyan-50',       text: 'text-blue-900',    iconBg: 'bg-blue-500',    accent: 'text-blue-600',    border: 'border-blue-100' },
    emerald: { bg: 'from-emerald-50 to-teal-50',    text: 'text-emerald-900', iconBg: 'bg-emerald-500', accent: 'text-emerald-600', border: 'border-emerald-100' },
    amber:   { bg: 'from-amber-50 to-orange-50',    text: 'text-amber-900',   iconBg: 'bg-amber-500',   accent: 'text-amber-700',   border: 'border-amber-100' },
    rose:    { bg: 'from-rose-50 to-pink-50',       text: 'text-rose-900',    iconBg: 'bg-rose-500',    accent: 'text-rose-700',    border: 'border-rose-100' },
    orange:  { bg: 'from-orange-50 to-amber-50',    text: 'text-orange-900',  iconBg: 'bg-orange-500',  accent: 'text-orange-700',  border: 'border-orange-100' },
  };
  const c = tones[tone] || tones.blue;
  const Tag = onClick ? 'button' : 'div';
  const interactiveCls = onClick
    ? 'cursor-pointer hover:shadow-md hover:scale-[1.02] transition-all text-right w-full'
    : '';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick || undefined}
      className={`bg-gradient-to-br ${c.bg} rounded-2xl p-4 border ${c.border} ${interactiveCls}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className={`${c.iconBg} w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-sm`}>
          <IconComp size={17} />
        </div>
        {trend != null && (
          <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold ${
            trend > 0 ? 'bg-emerald-100 text-emerald-700' : trend < 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'
          }`}>
            {trend > 0 ? <TrendingUp size={9} /> : trend < 0 ? <TrendingDown size={9} /> : null}
            {trend > 0 ? `+${trend}%` : `${trend}%`}
          </span>
        )}
      </div>
      <div className={`text-[11px] font-bold ${c.accent} mb-1`}>{title}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-2xl font-extrabold ${c.text}`}>{value}</span>
        {suffix && <span className={`text-[11px] font-bold ${c.accent}`}>{suffix}</span>}
      </div>
      {(subtitle || trendLabel) && (
        <div className="text-[10px] text-gray-500 mt-1 truncate">
          {subtitle || trendLabel}
        </div>
      )}
    </Tag>
  );
}

// ─── INSIGHT CARD ─────────────────────────────────────────────────────────────
function InsightCard({ insight, onClick }) {
  const { severity, type, message } = insight;
  const config = {
    critical: { icon: AlertTriangle,  bg: 'bg-rose-50',    border: 'border-rose-200',    hover: 'hover:bg-rose-100',    text: 'text-rose-900',    accent: 'text-rose-600',  emoji: '🔴' },
    warning:  { icon: AlertTriangle,  bg: 'bg-amber-50',   border: 'border-amber-200',   hover: 'hover:bg-amber-100',   text: 'text-amber-900',   accent: 'text-amber-600', emoji: '⚠' },
    good:     { icon: CheckCircle2,   bg: 'bg-emerald-50', border: 'border-emerald-200', hover: 'hover:bg-emerald-100', text: 'text-emerald-900', accent: 'text-emerald-600', emoji: '🟢' },
  };
  const c = config[severity] || config.warning;
  const IconComp = type === 'trend_up' || type === 'trend_down' ? Sparkles : c.icon;
  const Tag = onClick ? 'button' : 'div';
  const interactiveCls = onClick
    ? `${c.hover} cursor-pointer hover:shadow-sm transition-all text-right w-full`
    : '';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick || undefined}
      className={`flex items-start gap-3 px-3 py-2.5 rounded-xl ${c.bg} ${c.border} border ${interactiveCls}`}
    >
      <div className={`${c.accent} mt-0.5 shrink-0`}>
        <IconComp size={15} />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-semibold ${c.text} leading-snug`}>
          <span className="me-1">{c.emoji}</span>
          {message}
        </div>
      </div>
    </Tag>
  );
}
