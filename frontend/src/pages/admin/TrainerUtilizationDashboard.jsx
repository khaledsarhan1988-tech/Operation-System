'use client';
import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, TrendingUp, TrendingDown, Activity, AlertTriangle,
  CheckCircle2, Lightbulb, Users, Download, FileSpreadsheet,
  FileText, Clock, Zap, Sparkles, Sun, Moon,
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
  // Custom date range — overrides `weeks` when both fields are filled.
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate]     = useState('');
  const exportRef               = useRef(null);
  const usingCustomRange = !!(fromDate && toDate && fromDate <= toDate);

  const { data, isLoading } = useQuery({
    queryKey: ['trainer-utilization-summary', weeks, section, usingCustomRange ? fromDate : null, usingCustomRange ? toDate : null],
    queryFn: () => api.get('/reports/trainer-utilization-summary', {
      params: usingCustomRange
        ? { section, from: fromDate, to: toDate }
        : { section, weeks },
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
  const exportPdf = async () => {
    if (!exportRef.current) return;
    const canvas = await html2canvas(exportRef.current, {
      scale: 2,
      backgroundColor: '#FFFFFF',
      useCORS: true,
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    const imgW = pdfW - 10;
    const imgH = (canvas.height * imgW) / canvas.width;
    let heightLeft = imgH;
    let position = 5;
    pdf.addImage(imgData, 'PNG', 5, position, imgW, imgH);
    heightLeft -= pdfH - 10;
    while (heightLeft > 0) {
      position = heightLeft - imgH + 5;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 5, position, imgW, imgH);
      heightLeft -= pdfH - 10;
    }
    pdf.save(`trainer-utilization-${period?.from || 'export'}.pdf`);
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
          onChange={e => setSection(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        >
          {Object.entries(SECTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
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
                value={`${summary.avg_utilization}%`}
                icon={Activity}
                tone="blue"
                trend={summary.trend_pct}
                trendLabel={`الفترة السابقة ${summary.prev_avg_utilization}%`}
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
                subtitle={summary.low_count === 0 ? 'الكل مشغول جيداً' : 'تحت 50%'}
              />
              <KpiCard
                title="مدربين مكتملين"
                value={summary.high_count}
                suffix={`من ${summary.trainers_total}`}
                icon={Zap}
                tone="orange"
                subtitle={summary.high_count === 0 ? '—' : 'فوق 90%'}
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
                      <ReferenceLine y={summary.avg_utilization} stroke="#94A3B8" strokeDasharray="4 4" label={{ value: `الإجمالي ${summary.avg_utilization}%`, fill: '#64748B', fontSize: 10, position: 'insideTopLeft' }} />
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
                  {insights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
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
                        <th className="text-center px-3 py-2 font-bold text-gray-600">المحجوز</th>
                        <th className="text-center px-3 py-2 font-bold text-gray-600">الفاضي</th>
                        <th className="text-center px-3 py-2 font-bold text-gray-600">الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trainers.map(t => (
                        <tr key={t.id} className="border-t border-gray-50 hover:bg-slate-50/40 transition-colors">
                          <td className="px-5 py-2.5">
                            <div className="font-bold text-gray-900">{t.name}</div>
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
    </div>
  );
}

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, suffix, icon, tone, subtitle, trend, trendLabel }) {
  const IconComp = icon;
  const tones = {
    blue:    { bg: 'from-blue-50 to-cyan-50',       text: 'text-blue-900',    iconBg: 'bg-blue-500',    accent: 'text-blue-600',    border: 'border-blue-100' },
    emerald: { bg: 'from-emerald-50 to-teal-50',    text: 'text-emerald-900', iconBg: 'bg-emerald-500', accent: 'text-emerald-600', border: 'border-emerald-100' },
    amber:   { bg: 'from-amber-50 to-orange-50',    text: 'text-amber-900',   iconBg: 'bg-amber-500',   accent: 'text-amber-700',   border: 'border-amber-100' },
    rose:    { bg: 'from-rose-50 to-pink-50',       text: 'text-rose-900',    iconBg: 'bg-rose-500',    accent: 'text-rose-700',    border: 'border-rose-100' },
    orange:  { bg: 'from-orange-50 to-amber-50',    text: 'text-orange-900',  iconBg: 'bg-orange-500',  accent: 'text-orange-700',  border: 'border-orange-100' },
  };
  const c = tones[tone] || tones.blue;
  return (
    <div className={`bg-gradient-to-br ${c.bg} rounded-2xl p-4 border ${c.border}`}>
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
    </div>
  );
}

// ─── INSIGHT CARD ─────────────────────────────────────────────────────────────
function InsightCard({ insight }) {
  const { severity, type, message } = insight;
  const config = {
    critical: { icon: AlertTriangle,  bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-900',    accent: 'text-rose-600',  emoji: '🔴' },
    warning:  { icon: AlertTriangle,  bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-900',   accent: 'text-amber-600', emoji: '⚠' },
    good:     { icon: CheckCircle2,   bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-900', accent: 'text-emerald-600', emoji: '🟢' },
  };
  const c = config[severity] || config.warning;
  const IconComp = type === 'trend_up' || type === 'trend_down' ? Sparkles : c.icon;
  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-xl ${c.bg} ${c.border} border`}>
      <div className={`${c.accent} mt-0.5 shrink-0`}>
        <IconComp size={15} />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-semibold ${c.text} leading-snug`}>
          <span className="me-1">{c.emoji}</span>
          {message}
        </div>
      </div>
    </div>
  );
}
