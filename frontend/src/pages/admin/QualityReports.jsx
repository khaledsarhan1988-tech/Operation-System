import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck, Calendar, Filter, Search, X, Download, Wrench,
  ClipboardCheck, AlertCircle, Video, BookOpen, Layers, FileText, Users,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';
import ModernButton from '../../components/ui/ModernButton';

export default function QualityReports() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [from, setFrom]             = useState(monthAgo);
  const [to, setTo]                 = useState(today);
  const [department, setDepartment] = useState('All');
  const [search, setSearch]         = useState('');
  const [applied, setApplied]       = useState({ from: monthAgo, to: today, department: 'All' });

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

  // Client-side search by agent name
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
    const headers = ['الموظف', 'القسم', 'حل الأعطال', 'Attendance Main', 'Attendance Side', 'Attendance Task', 'الريمارك المفتوحة', 'إجمالي الريمارك'];
    const csvRows = filteredRows.map(r => [
      r.agent_name, r.department, r.code_problems_fixed,
      r.attendance_main_count, r.attendance_side_count, r.attendance_task_count,
      r.open_remarks_count, r.total_remarks,
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

  const inputCls = 'w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500';

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="تقارير الجودة"
        subtitle="تقرير شامل لكل موظف — الريمارك والإصلاحات حسب الفترة والقسم"
        icon={ShieldCheck}
        gradient="emerald"
        actions={
          <ModernButton variant="glass" icon={Download} onClick={exportCSV} disabled={!filteredRows.length}>
            تنزيل CSV
          </ModernButton>
        }
        stats={[
          { label: 'موظفين',          value: summary.total_agents || 0,    icon: Users },
          { label: 'حل الأعطال',      value: summary.total_code_fixed || 0, icon: Wrench },
          { label: 'Attendance Main', value: summary.total_main || 0,      icon: BookOpen },
          { label: 'Attendance Side', value: summary.total_side || 0,      icon: Video },
          { label: 'ريمارك مفتوحة',  value: summary.total_open || 0,      icon: AlertCircle },
        ]}
      />

      {/* Filters */}
      <div
        className="rounded-2xl border border-gray-100 overflow-hidden bg-white shadow-sm"
      >
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
              <input type="date" value={from} max={today}
                     onChange={e => setFrom(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-black text-gray-500 mb-1.5">
                <Calendar size={12} /> إلى تاريخ
              </label>
              <input type="date" value={to} max={today}
                     onChange={e => setTo(e.target.value)} className={inputCls} />
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
            <ModernButton variant="primary" onClick={handleApply}>
              تطبيق الفلاتر
            </ModernButton>
            <ModernButton variant="ghost" onClick={handleReset}>
              <X size={14} /> إعادة تعيين
            </ModernButton>
          </div>
        </div>
      </div>

      {/* Results table */}
      <SectionCard
        title="تقرير الجودة لكل موظف"
        subtitle={`${filteredRows.length} موظف · من ${applied.from} إلى ${applied.to}`}
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
                    <div className="inline-flex items-center gap-1.5">
                      <Wrench size={12} className="text-pink-500" />
                      حل الأعطال
                    </div>
                  </th>
                  <th className="px-5 py-3 text-xs font-black text-gray-500 whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <BookOpen size={12} className="text-blue-500" />
                      Attendance Main
                    </div>
                  </th>
                  <th className="px-5 py-3 text-xs font-black text-gray-500 whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <Video size={12} className="text-purple-500" />
                      Attendance Side
                    </div>
                  </th>
                  <th className="px-5 py-3 text-xs font-black text-gray-500 whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <FileText size={12} className="text-cyan-500" />
                      Attendance Task
                    </div>
                  </th>
                  <th className="px-5 py-3 text-xs font-black text-gray-500 whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <AlertCircle size={12} className="text-amber-500" />
                      ريمارك مفتوحة
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredRows.map((r, i) => {
                  const deptColor = r.department === 'General' ? 'blue'
                    : r.department === 'Private' ? 'violet'
                    : r.department === 'Semi' ? 'orange' : 'gray';
                  const deptCls = {
                    blue:   'bg-blue-100 text-blue-700 border-blue-200',
                    violet: 'bg-violet-100 text-violet-700 border-violet-200',
                    orange: 'bg-orange-100 text-orange-700 border-orange-200',
                    gray:   'bg-gray-100 text-gray-700 border-gray-200',
                  }[deptColor];

                  return (
                    <tr key={r.agent_id || i} className="hover:bg-gray-50/40 transition-colors">
                      <td className="px-5 py-3 font-black text-gray-900">{r.agent_name}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black border ${deptCls}`}>
                          {r.department}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black border ${
                          r.code_problems_fixed > 0
                            ? 'bg-pink-100 text-pink-700 border-pink-200'
                            : 'bg-gray-50 text-gray-400 border-gray-200'
                        }`}>{r.code_problems_fixed}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black border ${
                          r.attendance_main_count > 0
                            ? 'bg-blue-100 text-blue-700 border-blue-200'
                            : 'bg-gray-50 text-gray-400 border-gray-200'
                        }`}>{r.attendance_main_count}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black border ${
                          r.attendance_side_count > 0
                            ? 'bg-purple-100 text-purple-700 border-purple-200'
                            : 'bg-gray-50 text-gray-400 border-gray-200'
                        }`}>{r.attendance_side_count}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black border ${
                          r.attendance_task_count > 0
                            ? 'bg-cyan-100 text-cyan-700 border-cyan-200'
                            : 'bg-gray-50 text-gray-400 border-gray-200'
                        }`}>{r.attendance_task_count}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-black border ${
                          r.open_remarks_count > 0
                            ? 'bg-amber-100 text-amber-700 border-amber-200'
                            : 'bg-gray-50 text-gray-400 border-gray-200'
                        }`}>{r.open_remarks_count}</span>
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
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
