import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Network, Layers, Users, BookOpen, GraduationCap, AlertCircle, X, Calendar, ChevronLeft } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

// ─── PER-COLUMN VISUAL THEME ──────────────────────────────────────────────────
// Same section colors as the customer-services org chart so the two pages read
// as one family: عام=أزرق، شبه خاص=كهرماني، خاص=بنفسجي.
const COLUMN_THEMES = {
  general: { headerBg: 'bg-sky-600',    accent: 'text-sky-700',    ring: 'ring-sky-100',    softBg: 'bg-sky-50'    },
  semi:    { headerBg: 'bg-amber-600',  accent: 'text-amber-700',  ring: 'ring-amber-100',  softBg: 'bg-amber-50'  },
  private: { headerBg: 'bg-violet-600', accent: 'text-violet-700', ring: 'ring-violet-100', softBg: 'bg-violet-50' },
};

// ─── TRAINER COLUMN CARD ──────────────────────────────────────────────────────
// One card per teaching section. Lists that section's active trainers with their
// group / student / lecture counts. Clicking a trainer opens the per-group detail
// modal (the breakdown behind the 3 numbers).
function TrainerColumnCard({ section, onSelect }) {
  const theme = COLUMN_THEMES[section.key] || COLUMN_THEMES.general;

  return (
    <div className={`rounded-2xl bg-white shadow-sm ring-1 ${theme.ring} overflow-hidden flex flex-col`}>
      {/* Header */}
      <div className={`${theme.headerBg} text-white px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4" />
          <h3 className="font-bold text-base">{section.label}</h3>
        </div>
        <span className="text-xs bg-white/20 rounded-full px-2 py-0.5">
          {section.members.length} {section.members.length === 1 ? 'محاضر' : 'محاضرين'}
        </span>
      </div>

      {/* Members list */}
      <div className="flex-1 min-h-[200px] divide-y divide-gray-50">
        {section.members.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            لا يوجد محاضرين في هذا القسم
          </div>
        ) : (
          section.members.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelect(m, theme, section.label)}
              className="w-full text-right px-4 py-3 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-2 min-w-0 mb-2">
                <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <GraduationCap className="w-3.5 h-3.5 text-gray-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-800 truncate">{m.name}</p>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold mt-0.5 px-1.5 py-0.5 rounded border ${theme.softBg} ${theme.accent} border-transparent`}>
                    محاضر
                  </span>
                </div>
                <ChevronLeft className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0" />
              </div>
              {/* Three counts */}
              <div className="grid grid-cols-3 gap-1.5">
                <Stat theme={theme} icon={Layers}   value={m.group_count}   label="مجموعة" />
                <Stat theme={theme} icon={Users}    value={m.student_count} label="طالب" />
                <Stat theme={theme} icon={BookOpen} value={m.lecture_count} label="محاضرة" />
              </div>
            </button>
          ))
        )}
      </div>

      {/* Footer totals */}
      <div className={`${theme.softBg} px-4 py-2.5 border-t border-gray-100 text-xs font-bold flex items-center justify-between flex-wrap gap-x-2 gap-y-1`}>
        <span className="text-gray-600">الإجمالي</span>
        <div className="flex items-center gap-2">
          <span className={theme.accent}>
            <Layers className="w-3 h-3 inline-block ml-1" />
            {section.total_groups ?? 0} مجموعة
          </span>
          <span className="text-gray-400">•</span>
          <span className="text-gray-700">
            <Users className="w-3 h-3 inline-block ml-1" />
            {section.total_students ?? 0} طالب
          </span>
          <span className="text-gray-400">•</span>
          <span className="text-gray-700">
            <BookOpen className="w-3 h-3 inline-block ml-1" />
            {section.total_lectures ?? 0} محاضرة
          </span>
        </div>
      </div>
    </div>
  );
}

function Stat({ theme, icon: Icon, value, label }) {
  return (
    <div className={`${theme.softBg} rounded-lg px-1.5 py-1.5 text-center`}>
      <div className="flex items-center justify-center gap-1">
        <Icon className={`w-3 h-3 ${theme.accent}`} />
        <span className="text-sm font-black text-gray-800">{value ?? 0}</span>
      </div>
      <p className="text-[9px] text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

// ─── TRAINER DETAIL MODAL ─────────────────────────────────────────────────────
// The per-group breakdown behind a trainer's 3 aggregate numbers.
function TrainerDetailModal({ selected, onClose }) {
  const { member, theme, sectionLabel } = selected;
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['trainer-org-chart', 'detail', member.id],
    queryFn: async () => (await api.get(`/reports/trainer-org-chart/trainer/${member.id}`)).data,
  });
  const groups = data?.groups || [];
  const totals = data?.totals || { groups: 0, students: 0, lectures: 0 };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`${theme.headerBg} text-white px-5 py-4 flex items-center justify-between`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-base truncate">{member.name}</h3>
              <p className="text-xs text-white/80">محاضر — {sectionLabel}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Totals strip */}
        <div className={`${theme.softBg} px-5 py-3 grid grid-cols-3 gap-2 border-b border-gray-100`}>
          <TotalPill theme={theme} icon={Layers}   value={totals.groups}   label="مجموعة" />
          <TotalPill theme={theme} icon={Users}    value={totals.students} label="طالب" />
          <TotalPill theme={theme} icon={BookOpen} value={totals.lectures} label="محاضرة" />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="p-8 text-center text-gray-400 text-sm">جارٍ التحميل…</div>
          )}
          {isError && (
            <div className="m-4 rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
              فشل تحميل التفاصيل: {error?.response?.data?.error || error?.message || 'خطأ غير معروف'}
            </div>
          )}
          {!isLoading && !isError && groups.length === 0 && (
            <div className="p-8 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              لا توجد مجموعات نشطة لهذا المحاضر
            </div>
          )}
          {!isLoading && !isError && groups.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-2 text-right font-semibold">المجموعة</th>
                  <th className="px-3 py-2 text-center font-semibold">الطلاب</th>
                  <th className="px-3 py-2 text-center font-semibold">المحاضرات</th>
                  <th className="px-3 py-2 text-center font-semibold">أول محاضرة</th>
                  <th className="px-3 py-2 text-center font-semibold">آخر محاضرة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {groups.map((g, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-right">
                      <span className="font-semibold text-gray-800">{g.group_name}</span>
                      {g.line ? <span className="text-[10px] text-gray-400 block">{g.line}</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-center font-bold text-gray-700">{g.students}</td>
                    <td className="px-3 py-2.5 text-center font-bold text-gray-700">{g.lectures}</td>
                    <td className="px-3 py-2.5 text-center text-gray-500 text-xs whitespace-nowrap">
                      <Calendar className="w-3 h-3 inline-block ml-1 text-gray-300" />{g.start_date || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-500 text-xs whitespace-nowrap">
                      <Calendar className="w-3 h-3 inline-block ml-1 text-gray-300" />{g.end_date || '—'}
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

function TotalPill({ theme, icon: Icon, value, label }) {
  return (
    <div className="bg-white/70 rounded-lg px-2 py-1.5 text-center">
      <div className="flex items-center justify-center gap-1">
        <Icon className={`w-3.5 h-3.5 ${theme.accent}`} />
        <span className="text-base font-black text-gray-800">{value ?? 0}</span>
      </div>
      <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

export default function TrainerOrgChart() {
  const [selected, setSelected] = useState(null);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['trainer-org-chart'],
    queryFn: async () => (await api.get('/reports/trainer-org-chart')).data,
  });

  const sections = data?.sections || [];

  return (
    <div className="space-y-6 pb-12">
      <PageHero
        title="الهيكل التنظيمي للمحاضرين"
        subtitle="محاضرو المحاضرات الأساسية موزّعين على الأقسام (عام / شبه خاص / خاص) — اضغط على أي محاضر لعرض تفاصيله"
        icon={Network}
        gradient="linear-gradient(135deg, #1e40af 0%, #6366f1 100%)"
      />

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-80 rounded-2xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700">
          فشل تحميل البيانات: {error?.response?.data?.error || error?.message || 'خطأ غير معروف'}
        </div>
      )}

      {!isLoading && !isError && sections.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {sections.map((s) => (
            <TrainerColumnCard
              key={s.key}
              section={s}
              onSelect={(member, theme, sectionLabel) => setSelected({ member, theme, sectionLabel })}
            />
          ))}
        </div>
      )}

      {!isLoading && !isError && sections.length === 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-800 text-sm">
          لا يوجد بيانات لعرضها
        </div>
      )}

      {selected && <TrainerDetailModal selected={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
