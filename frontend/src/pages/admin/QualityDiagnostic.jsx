import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, Calendar, Filter, Layers, AlertTriangle, FileWarning,
  Wrench, UserX, Database, Clock,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';
import ModernButton from '../../components/ui/ModernButton';

export default function QualityDiagnostic() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [from, setFrom]             = useState(monthAgo);
  const [to, setTo]                 = useState(today);
  const [department, setDepartment] = useState('All');
  const [applied, setApplied]       = useState({ from: monthAgo, to: today, department: 'All' });

  const { data, isLoading } = useQuery({
    queryKey: ['quality-diagnostic', applied],
    queryFn: () => api.get('/reports/quality-diagnostic', {
      params: {
        from: applied.from,
        to:   applied.to,
        department: applied.department && applied.department !== 'All' ? applied.department : undefined,
      },
    }).then(r => r.data),
    enabled: !!applied.from && !!applied.to,
    staleTime: 0,
  });

  const handleApply = () => setApplied({ from, to, department });

  const inputCls = 'w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500';

  const sm = data?.solve_mistakes;
  const ma = data?.main_absent;
  const dt = data?.dept_totals || {};
  const ff = data?.file_freshness || [];

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="تحليل تشخيصى لتقارير الجودة"
        subtitle="بيكشف بالظبط مين الـ records اللى داخلة فى الحساب — مفيد لما الأرقام تتغير بعد رفع Excel جديد"
        icon={Activity}
        gradient="amber"
        stats={[
          { label: 'Solve Mistakes',  value: sm?.total ?? '—',     icon: Wrench },
          { label: 'Main Absent P1',  value: ma?.part1_count ?? '—', icon: UserX },
          { label: 'Main Absent P2',  value: ma?.part2_count ?? '—', icon: UserX },
          { label: 'Orphans',         value: sm?.orphans_count ?? '—', icon: AlertTriangle },
        ]}
      />

      {/* Filters */}
      <div className="rounded-2xl border border-gray-100 overflow-hidden bg-white shadow-sm">
        <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-l from-amber-50 to-white flex items-center gap-2.5">
          <div className="p-1.5 bg-amber-100 rounded-lg">
            <Filter size={14} className="text-amber-600" />
          </div>
          <span className="text-sm font-black text-gray-800">فلاتر التشخيص</span>
        </div>
        <div className="p-5">
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
            <div className="flex items-end">
              <ModernButton variant="primary" onClick={handleApply} className="w-full">شغّل التشخيص</ModernButton>
            </div>
          </div>
        </div>
      </div>

      {isLoading && <p className="text-center py-12 text-gray-400 text-sm font-bold">جاري التحليل...</p>}

      {data && (
        <>
          {/* File Freshness */}
          <SectionCard title="آخر تحديث لكل ملف Excel" icon={Database} accent="blue">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-gray-50/60 border-b border-gray-100">
                  <tr>
                    <th className="px-5 py-3 text-xs font-black text-gray-500">الملف</th>
                    <th className="px-5 py-3 text-xs font-black text-gray-500">عدد السجلات</th>
                    <th className="px-5 py-3 text-xs font-black text-gray-500">آخر رفع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {ff.map((f, i) => (
                    <tr key={i} className="hover:bg-gray-50/40">
                      <td className="px-5 py-2.5 font-black text-gray-900">{f.file_type}</td>
                      <td className="px-5 py-2.5 font-mono font-bold text-blue-700">{f.records_imported}</td>
                      <td className="px-5 py-2.5 text-xs text-gray-600">
                        <Clock size={11} className="inline ms-1" />
                        {new Date(f.last_synced_at).toLocaleString('ar-EG')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* Solve Mistakes Breakdown */}
          <SectionCard
            title={`Solve Mistakes — تفصيل الـ ${sm?.total || 0} record`}
            subtitle={`موزعين على ${Object.keys(sm?.by_coordinator || {}).length} كوارد + ${sm?.orphans_count || 0} يتيم`}
            icon={Wrench}
            accent="pink"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-black text-gray-500 mb-2">حسب الكوارد:</h4>
                <div className="space-y-1.5">
                  {Object.entries(sm?.by_coordinator || {}).sort((a,b) => b[1]-a[1]).map(([k, v]) => {
                    const isOrphan = k.includes('orphan');
                    return (
                      <div key={k} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${
                        isOrphan ? 'bg-red-50 border-red-200' : 'bg-pink-50 border-pink-200'
                      }`}>
                        <span className={`text-xs font-black ${isOrphan ? 'text-red-700' : 'text-gray-800'}`}>
                          {k}
                        </span>
                        <span className={`text-sm font-black ${isOrphan ? 'text-red-700' : 'text-pink-700'}`}>{v}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {sm?.orphans_count > 0 && (
                <div>
                  <h4 className="text-xs font-black text-red-600 mb-2 inline-flex items-center gap-1">
                    <AlertTriangle size={12} /> سجلات يتيمة (مفيش كوارد):
                  </h4>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 max-h-72 overflow-auto">
                    <p className="text-[11px] text-red-800 mb-2 font-bold">
                      المجموعات دى موجودة فى code_problem_status لكن مش متربطة بأى batch (الكوارد اتشال أو المجموعة اتمسحت من ملف batches).
                    </p>
                    <table className="w-full text-[11px]">
                      <thead className="bg-red-100">
                        <tr>
                          <th className="px-2 py-1 text-right">المجموعة</th>
                          <th className="px-2 py-1">النوع</th>
                          <th className="px-2 py-1">التاريخ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sm.orphan_records.map((r, i) => (
                          <tr key={i} className="border-t border-red-100">
                            <td className="px-2 py-1 font-mono">{r.group_name}</td>
                            <td className="px-2 py-1">{r.problem_type}</td>
                            <td className="px-2 py-1 text-gray-600">{r.updated_at?.slice(0, 10)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Main Absent Breakdown */}
          <SectionCard
            title={`غياب أساسى — Part 1 (${ma?.part1_count || 0}) + Part 2 (${ma?.part2_count || 0}) = ${ma?.total || 0}`}
            subtitle="Part 1 = من ملف الغيابات | Part 2 = محاضرات مؤكدة + Attendance فاضى × عملاء المجموعة"
            icon={UserX}
            accent="rose"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-black text-gray-500 mb-2">Part 1 حسب الكوارد:</h4>
                <div className="space-y-1.5">
                  {Object.entries(ma?.part1_by_coordinator || {}).sort((a,b) => b[1]-a[1]).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between px-3 py-2 rounded-lg border bg-rose-50 border-rose-200">
                      <span className="text-xs font-black text-gray-800">{k}</span>
                      <span className="text-sm font-black text-rose-700">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-black text-gray-500 mb-2">Part 2 حسب الكوارد:</h4>
                <div className="space-y-1.5">
                  {Object.entries(ma?.part2_by_coordinator || {}).sort((a,b) => b[1]-a[1]).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between px-3 py-2 rounded-lg border bg-amber-50 border-amber-200">
                      <span className="text-xs font-black text-gray-800">{k}</span>
                      <span className="text-sm font-black text-amber-700">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Department Totals */}
          <SectionCard title="إجمالى لكل قسم" icon={Layers} accent="violet">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.entries(dt).map(([dept, vals]) => (
                <div key={dept} className="border border-gray-200 rounded-xl p-4 bg-gray-50/40">
                  <h4 className="text-sm font-black text-gray-800 mb-3">{dept}</h4>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-gray-600">Solve Mistakes:</span><span className="font-black text-pink-700">{vals.solve_mistakes}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Main Absent P1:</span><span className="font-black text-rose-700">{vals.main_absent_p1}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Main Absent P2:</span><span className="font-black text-amber-700">{vals.main_absent_p2}</span></div>
                    <div className="flex justify-between border-t border-gray-200 pt-1 mt-1"><span className="text-gray-600 font-black">Total Main Absent:</span><span className="font-black text-violet-700">{vals.main_absent_p1 + vals.main_absent_p2}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </>
      )}

      {!isLoading && !data && (
        <EmptyState
          icon={FileWarning}
          accent="amber"
          title="ابدأ التشخيص"
          message="حدد الفترة الزمنية والقسم ودوس على 'شغّل التشخيص'."
        />
      )}
    </div>
  );
}
