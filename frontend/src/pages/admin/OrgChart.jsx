import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Network, Crown, User, Users, Layers, AlertCircle } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'customer_services', label: 'إدارة خدمة العملاء' },
  { key: 'education',         label: 'الإدارة التعليمية' },
];

// Per-column visual treatment — distinct color for each section so users can
// scan the chart at a glance.
const COLUMN_THEMES = {
  general:      { headerBg: 'bg-sky-600',     headerText: 'text-white', accent: 'text-sky-700',     ring: 'ring-sky-100',     softBg: 'bg-sky-50'     },
  private:      { headerBg: 'bg-violet-600',  headerText: 'text-white', accent: 'text-violet-700',  ring: 'ring-violet-100',  softBg: 'bg-violet-50'  },
  semi:         { headerBg: 'bg-amber-600',   headerText: 'text-white', accent: 'text-amber-700',   ring: 'ring-amber-100',   softBg: 'bg-amber-50'   },
  appointments: { headerBg: 'bg-rose-600',    headerText: 'text-white', accent: 'text-rose-700',    ring: 'ring-rose-100',    softBg: 'bg-rose-50'    },
};

// ─── COLUMN CARD ──────────────────────────────────────────────────────────────
function ColumnCard({ section }) {
  const theme = COLUMN_THEMES[section.key] || COLUMN_THEMES.general;
  const isAppointments = section.key === 'appointments';

  return (
    <div className={`rounded-2xl bg-white shadow-sm ring-1 ${theme.ring} overflow-hidden flex flex-col`}>
      {/* Header */}
      <div className={`${theme.headerBg} ${theme.headerText} px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4" />
          <h3 className="font-bold text-base">{section.label}</h3>
        </div>
        <span className="text-xs bg-white/20 rounded-full px-2 py-0.5">
          {section.members.length} {section.members.length === 1 ? 'موظف' : 'موظفين'}
        </span>
      </div>

      {/* Leader */}
      <div className={`${theme.softBg} px-4 py-3 border-b border-gray-100`}>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-gray-500 mb-1">
          <Crown className="w-3 h-3" />
          القائد
        </div>
        {section.leader ? (
          <p className={`font-bold ${theme.accent} text-sm`}>{section.leader.name}</p>
        ) : (
          <p className="text-gray-400 text-sm italic flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            بدون قائد
          </p>
        )}
      </div>

      {/* Members list */}
      <div className="flex-1 min-h-[200px] divide-y divide-gray-50">
        {section.members.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">
            لا يوجد موظفين في هذا القسم
          </div>
        ) : (
          section.members.map((m) => (
            <div key={m.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <User className="w-3.5 h-3.5 text-gray-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{m.name}</p>
                  {m.job_title && (
                    <p className="text-[10px] text-gray-400 truncate">{m.job_title}</p>
                  )}
                </div>
              </div>
              {!isAppointments && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span
                    title="عدد العملاء"
                    className={`text-[11px] font-bold ${theme.accent} ${theme.softBg} rounded-md px-1.5 py-0.5 flex items-center gap-1`}
                  >
                    <Users className="w-3 h-3" />
                    {m.customer_count ?? 0}
                  </span>
                  <span
                    title="عدد المجموعات"
                    className="text-[11px] font-bold text-gray-700 bg-gray-100 rounded-md px-1.5 py-0.5 flex items-center gap-1"
                  >
                    <Layers className="w-3 h-3" />
                    {m.group_count ?? 0}
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer totals */}
      {!isAppointments && (
        <div className={`${theme.softBg} px-4 py-2.5 border-t border-gray-100 text-xs font-bold flex items-center justify-between`}>
          <span className="text-gray-600">الإجمالي</span>
          <div className="flex items-center gap-2">
            <span className={`${theme.accent}`}>
              <Users className="w-3 h-3 inline-block ml-1" />
              {section.total_customers ?? 0} عميل
            </span>
            <span className="text-gray-400">•</span>
            <span className="text-gray-700">
              <Layers className="w-3 h-3 inline-block ml-1" />
              {section.total_groups ?? 0} مجموعة
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function OrgChart() {
  const [activeTab, setActiveTab] = useState('customer_services');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['org-chart', activeTab],
    queryFn: async () => {
      if (activeTab !== 'customer_services') return null;
      const res = await api.get('/org-chart/customer-services');
      return res.data;
    },
    enabled: activeTab === 'customer_services',
  });

  return (
    <div className="space-y-6 pb-12">
      <PageHero
        title="الهيكل التنظيمي"
        subtitle="عرض شجري للإدارات والأقسام والموظفين"
        icon={Network}
        gradient="linear-gradient(135deg, #1e40af 0%, #6366f1 100%)"
      />

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors -mb-px ${
              activeTab === t.key
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'customer_services' && (
        <>
          {isLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-80 rounded-2xl bg-gray-100 animate-pulse" />
              ))}
            </div>
          )}

          {isError && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700">
              فشل تحميل البيانات: {error?.message || 'خطأ غير معروف'}
            </div>
          )}

          {data?.sections && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {data.sections.map((s) => (
                <ColumnCard key={s.key} section={s} />
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'education' && (
        <div className="rounded-2xl bg-white shadow-sm border border-gray-200 p-12 text-center">
          <Network className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-gray-700 mb-1">قريباً</h3>
          <p className="text-sm text-gray-500">صفحة الإدارة التعليمية قيد التحضير</p>
        </div>
      )}
    </div>
  );
}
