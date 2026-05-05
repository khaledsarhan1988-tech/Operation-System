import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Snowflake, Calendar, Clock, User, FileText, Trash2, Eye, X, Wrench,
  Users, Layers, BookOpen, Video, AlertCircle, UserX, TrendingDown, Pin, PinOff,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';
import ModernButton from '../../components/ui/ModernButton';
import { useAuth } from '../../auth/AuthContext';

export default function QualitySnapshots() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [view, setView] = useState({ open: false, id: null });

  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ['quality-snapshots'],
    queryFn: () => api.get('/reports/quality-snapshots').then(r => r.data),
    staleTime: 30_000,
  });

  const deleteMu = useMutation({
    mutationFn: (id) => api.delete(`/reports/quality-snapshot/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quality-snapshots'] }),
  });

  const officialMu = useMutation({
    mutationFn: ({ id, is_official }) => api.patch(`/reports/quality-snapshot/${id}/official`, { is_official }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quality-snapshots'] }),
  });

  const handleDelete = (snap) => {
    if (window.confirm(`متأكد إنك عاوز تمسح النسخة "${snap.snapshot_label}"؟ ده إجراء لا يمكن التراجع عنه.`)) {
      deleteMu.mutate(snap.id);
    }
  };

  const handleToggleOfficial = (snap) => {
    const newVal = !snap.is_official;
    if (newVal && window.confirm('تفعيل "Official" هيخلى النسخة دى المصدر الرسمى لأهداف الأقسام، وأى نسخة رسمية تانية لنفس الفترة هتتحول لمسوّدة. متأكد؟')) {
      officialMu.mutate({ id: snap.id, is_official: 1 });
    } else if (!newVal && window.confirm('تحويل النسخة من Official لمسوّدة؟ الأهداف اللى مرتبطة بيها هتفقد مصدر بياناتها.')) {
      officialMu.mutate({ id: snap.id, is_official: 0 });
    }
  };

  return (
    <div className="space-y-5 animate-fadeIn pb-12" dir="rtl">
      <PageHero
        title="النسخ المحفوظة من تقارير الجودة"
        subtitle="نسخ ثابتة من التقرير لا تتغير حتى لو رفعت ملفات Excel جديدة"
        icon={Snowflake}
        gradient="cyan"
        stats={[
          { label: 'نسخ محفوظة', value: snapshots.length, icon: Snowflake },
        ]}
      />

      {isLoading ? (
        <p className="text-center py-12 text-gray-400 text-sm font-bold">جارى التحميل...</p>
      ) : snapshots.length === 0 ? (
        <EmptyState
          icon={Snowflake}
          accent="cyan"
          title="مفيش نسخ محفوظة لسه"
          message='ادخل على صفحة "تقارير الجودة" واضغط "حفظ نسخة دائمة" عشان تحفظ أول نسخة.'
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {snapshots.map(s => (
            <SnapshotCard
              key={s.id}
              snap={s}
              isAdmin={user?.role === 'admin'}
              onView={() => setView({ open: true, id: s.id })}
              onDelete={() => handleDelete(s)}
              onToggleOfficial={() => handleToggleOfficial(s)}
              busyOfficial={officialMu.isPending}
            />
          ))}
        </div>
      )}

      <SnapshotDetailModal
        open={view.open}
        id={view.id}
        onClose={() => setView({ open: false, id: null })}
      />
    </div>
  );
}

// ─── SNAPSHOT CARD ───────────────────────────────────────────────────────────
function SnapshotCard({ snap, isAdmin, onView, onDelete, onToggleOfficial, busyOfficial }) {
  const date = snap.frozen_at ? new Date(snap.frozen_at).toLocaleString('ar-EG') : '—';
  const isOfficial = !!snap.is_official;
  return (
    <div className={`bg-white border-2 ${isOfficial ? 'border-emerald-300 ring-2 ring-emerald-100' : 'border-gray-200'} rounded-2xl shadow-sm hover:shadow-md transition overflow-hidden`}>
      <div className={`${isOfficial ? 'bg-gradient-to-l from-emerald-100 to-emerald-50' : 'bg-gradient-to-l from-cyan-50 to-blue-50'} px-4 py-3 border-b border-gray-100 flex items-center gap-2`}>
        {isOfficial ? <Pin size={16} className="text-emerald-600" /> : <Snowflake size={16} className="text-cyan-600" />}
        <h3 className="text-sm font-black text-gray-800 truncate flex-1" title={snap.snapshot_label}>
          {snap.snapshot_label}
        </h3>
        {isOfficial && (
          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-600 text-white whitespace-nowrap">
            Official
          </span>
        )}
      </div>

      <div className="p-4 space-y-2 text-xs">
        <div className="flex items-center gap-1.5 text-gray-700 font-bold">
          <Calendar size={12} className="text-gray-400" />
          {snap.from_date} → {snap.to_date}
        </div>
        {snap.department_filter && snap.department_filter !== 'All' && (
          <div className="flex items-center gap-1.5 text-gray-700 font-bold">
            <Layers size={12} className="text-gray-400" />
            القسم: {snap.department_filter}
          </div>
        )}
        <div className="flex items-center gap-1.5 text-gray-600">
          <User size={12} className="text-gray-400" />
          {snap.frozen_by_name || 'غير محدد'}
        </div>
        <div className="flex items-center gap-1.5 text-gray-500">
          <Clock size={12} className="text-gray-400" />
          {date}
        </div>
        {snap.notes && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
            <p className="text-[11px] text-amber-800 line-clamp-2">{snap.notes}</p>
          </div>
        )}
      </div>

      <div className="bg-gray-50 border-t border-gray-100 px-3 py-2 flex justify-end gap-1.5 flex-wrap">
        <ModernButton variant="ghost" icon={Eye} onClick={onView} size="sm">عرض</ModernButton>
        {isAdmin && (
          <ModernButton
            variant={isOfficial ? 'primary' : 'ghost'}
            icon={isOfficial ? PinOff : Pin}
            onClick={onToggleOfficial}
            disabled={busyOfficial}
            size="sm"
          >
            {isOfficial ? 'إلغاء Official' : 'Official'}
          </ModernButton>
        )}
        {isAdmin && (
          <ModernButton variant="ghost" icon={Trash2} onClick={onDelete} size="sm">مسح</ModernButton>
        )}
      </div>
    </div>
  );
}

// ─── SNAPSHOT DETAIL MODAL ───────────────────────────────────────────────────
function SnapshotDetailModal({ open, id, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['quality-snapshot', id],
    queryFn: () => api.get(`/reports/quality-snapshot/${id}`).then(r => r.data),
    enabled: open && !!id,
  });

  if (!open) return null;

  const summary = data?.summary || {};
  const rows = data?.rows || [];
  const deptAverages = data?.dept_averages || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-7xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-l from-cyan-600 to-blue-600 text-white px-6 py-4 flex items-center gap-3">
          <Snowflake size={20} />
          <div className="flex-1">
            <h2 className="text-base font-black">{data?.snapshot_label || 'جارى التحميل...'}</h2>
            <p className="text-xs font-bold opacity-90 mt-0.5">
              {data?.from_date} → {data?.to_date} · {rows.length} موظف · حُفظ بتاريخ {data?.frozen_at ? new Date(data.frozen_at).toLocaleString('ar-EG') : '—'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 bg-white/15 hover:bg-white/25 rounded-xl backdrop-blur">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-auto flex-1 p-5 space-y-5 bg-gray-50">
          {isLoading ? (
            <p className="text-center py-12 text-gray-400 text-sm font-bold">جارى التحميل...</p>
          ) : (
            <>
              {data?.notes && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                  <strong>ملاحظات:</strong> {data.notes}
                </div>
              )}

              {/* Summary chips */}
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'موظفين',          value: summary.total_agents || 0,    icon: Users,      color: 'emerald' },
                  { label: 'Solve Mistakes',  value: summary.total_code_fixed || 0, icon: Wrench,     color: 'pink' },
                  { label: 'Attendance Main', value: summary.total_main || 0,       icon: BookOpen,   color: 'blue' },
                  { label: 'Attendance Side', value: summary.total_side || 0,       icon: Video,      color: 'purple' },
                  { label: 'Attendance Task', value: summary.total_task || 0,       icon: FileText,   color: 'cyan' },
                  { label: 'ريمارك مفتوحة',   value: summary.total_open || 0,       icon: AlertCircle, color: 'amber' },
                  { label: 'غياب أساسى',      value: summary.total_main_absent || 0, icon: UserX,     color: 'rose' },
                  { label: 'غياب زووم',       value: summary.total_zoom_absent || 0, icon: TrendingDown, color: 'violet' },
                ].map((c, i) => (
                  <div key={i} className={`px-3 py-2 rounded-xl border bg-${c.color}-50 border-${c.color}-200 min-w-[110px] text-center`}>
                    <div className="text-[10px] font-black text-gray-600 mb-0.5">{c.label}</div>
                    <div className={`text-base font-black text-${c.color}-700`}>{c.value}</div>
                  </div>
                ))}
              </div>

              {/* Dept averages */}
              {deptAverages.length > 0 && (
                <SectionCard title="متوسط النسب لكل قسم (وقت الحفظ)" icon={Layers} accent="violet">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {deptAverages.map(d => (
                      <div key={d.department} className="border border-gray-200 rounded-xl p-3 bg-white">
                        <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
                          <span className="font-black text-sm">{d.department}</span>
                          <span className="text-[10px] text-gray-500 font-bold">{d.employees} موظف</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="text-center">
                            <div className="text-gray-600 font-bold mb-1">غياب أساسى</div>
                            <div className="text-rose-700 font-black text-base">{d.mainRate}%</div>
                            <div className="text-[10px] text-gray-500 font-mono">{d.mainAbsent}/{d.mainExpected}</div>
                          </div>
                          <div className="text-center">
                            <div className="text-gray-600 font-bold mb-1">غياب زووم</div>
                            <div className="text-violet-700 font-black text-base">{d.zoomRate}%</div>
                            <div className="text-[10px] text-gray-500 font-mono">{d.zoomAbsent}/{d.zoomExpected}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}

              {/* Main table */}
              <SectionCard title="تقرير الجودة لكل موظف (نسخة محفوظة)" icon={Snowflake} accent="cyan" noBodyPad>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right">
                    <thead className="bg-gray-50/60 border-b border-gray-100">
                      <tr>
                        <th className="px-4 py-2 text-xs font-black text-gray-500">الموظف</th>
                        <th className="px-4 py-2 text-xs font-black text-gray-500">القسم</th>
                        <th className="px-4 py-2 text-xs font-black text-gray-500">Solve Mistakes</th>
                        <th className="px-4 py-2 text-xs font-black text-gray-500">Attendance Main</th>
                        <th className="px-4 py-2 text-xs font-black text-gray-500">Attendance Side</th>
                        <th className="px-4 py-2 text-xs font-black text-gray-500">Attendance Task</th>
                        <th className="px-4 py-2 text-xs font-black text-gray-500">ريمارك مفتوحة</th>
                        <th className="px-4 py-2 text-xs font-black text-gray-500">نسبة غياب الأساسية</th>
                        <th className="px-4 py-2 text-xs font-black text-gray-500">نسبة غياب الزووم</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map((r, i) => (
                        <tr key={r.agent_id || i} className="hover:bg-gray-50/40">
                          <td className="px-4 py-2 font-black">{r.agent_name}</td>
                          <td className="px-4 py-2">{r.department}</td>
                          <td className="px-4 py-2 text-pink-700 font-bold">{r.code_problems_fixed}</td>
                          <td className="px-4 py-2 text-blue-700 font-bold">{r.attendance_main_count}</td>
                          <td className="px-4 py-2 text-purple-700 font-bold">{r.attendance_side_count}</td>
                          <td className="px-4 py-2 text-cyan-700 font-bold">{r.attendance_task_count}</td>
                          <td className="px-4 py-2 text-amber-700 font-bold">{r.open_remarks_count}</td>
                          <td className="px-4 py-2 text-rose-700 font-bold">
                            {r.main_absent_rate}%
                            <span className="text-[10px] text-gray-500 font-mono ms-1">({r.main_absent_count}/{r.main_expected_count})</span>
                          </td>
                          <td className="px-4 py-2 text-violet-700 font-bold">
                            {r.zoom_absent_rate}%
                            <span className="text-[10px] text-gray-500 font-mono ms-1">({r.zoom_absent_count}/{r.zoom_expected_count})</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-cyan-50 border-t-2 border-cyan-200 font-black">
                        <td className="px-4 py-2" colSpan={2}>الإجمالى</td>
                        <td className="px-4 py-2 text-pink-700">{summary.total_code_fixed || 0}</td>
                        <td className="px-4 py-2 text-blue-700">{summary.total_main || 0}</td>
                        <td className="px-4 py-2 text-purple-700">{summary.total_side || 0}</td>
                        <td className="px-4 py-2 text-cyan-700">{summary.total_task || 0}</td>
                        <td className="px-4 py-2 text-amber-700">{summary.total_open || 0}</td>
                        <td className="px-4 py-2 text-rose-700">{summary.total_main_absent || 0}</td>
                        <td className="px-4 py-2 text-violet-700">{summary.total_zoom_absent || 0}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </SectionCard>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
