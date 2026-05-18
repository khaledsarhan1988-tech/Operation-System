import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Network, Crown, User, Users, Layers, AlertCircle,
  ArrowRight, ArrowLeftRight, Sparkles, ChevronDown, RefreshCw,
  Settings, X, Briefcase, CheckCircle2,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

// ─── COORDINATOR TYPE VISUAL CONFIG ──────────────────────────────────────────
// Matches the backend COORDINATOR_TYPES catalog. Colors are chosen so the two
// types are visually distinct at a glance:
//   • standard   → teal (calm, students-only)
//   • multi_task → indigo (more responsibility)
// Capacity-status colors are SEPARATE so a member can be e.g. "standard +
// over-capacity" without the badge colors blending.
const COORD_TYPE_VISUAL = {
  standard:   { label: 'منسق',              badge: 'bg-teal-100 text-teal-700 border-teal-200',     dot: 'bg-teal-500'   },
  multi_task: { label: 'منسق متعدد المهام', badge: 'bg-indigo-100 text-indigo-700 border-indigo-200', dot: 'bg-indigo-500' },
};
const CAPACITY_VISUAL = {
  under:   { label: 'تحت الحد الأدنى', bar: 'bg-orange-400', text: 'text-orange-700', soft: 'bg-orange-50' },
  ok:      { label: 'ضمن النطاق',     bar: 'bg-emerald-500', text: 'text-emerald-700', soft: 'bg-emerald-50' },
  over:    { label: 'تجاوز الحد الأقصى', bar: 'bg-red-500',    text: 'text-red-700',    soft: 'bg-red-50' },
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'customer_services', label: 'إدارة خدمة العملاء' },
  { key: 'education',         label: 'الإدارة التعليمية' },
];

// Per-column visual treatment — distinct color for each section so users can
// scan the chart at a glance.
const COLUMN_THEMES = {
  general:           { headerBg: 'bg-sky-600',     headerText: 'text-white', accent: 'text-sky-700',     ring: 'ring-sky-100',     softBg: 'bg-sky-50'     },
  private:           { headerBg: 'bg-violet-600',  headerText: 'text-white', accent: 'text-violet-700',  ring: 'ring-violet-100',  softBg: 'bg-violet-50'  },
  private_dardasha:  { headerBg: 'bg-fuchsia-600', headerText: 'text-white', accent: 'text-fuchsia-700', ring: 'ring-fuchsia-100', softBg: 'bg-fuchsia-50' },
  semi:              { headerBg: 'bg-amber-600',   headerText: 'text-white', accent: 'text-amber-700',   ring: 'ring-amber-100',   softBg: 'bg-amber-50'   },
  appointments:      { headerBg: 'bg-rose-600',    headerText: 'text-white', accent: 'text-rose-700',    ring: 'ring-rose-100',    softBg: 'bg-rose-50'    },
};

// ─── COLUMN CARD ──────────────────────────────────────────────────────────────
function ColumnCard({ section, isAdmin, onEditMember }) {
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
          section.members.map((m) => {
            const typeViz = COORD_TYPE_VISUAL[m.coordinator_type] || COORD_TYPE_VISUAL.standard;
            const capViz  = m.capacity_status ? CAPACITY_VISUAL[m.capacity_status] : null;
            // Visual progress: percentage of capacity_max (cap at 110% so an
            // over-loaded bar stays visible on the row).
            const pct = (!isAppointments && m.capacity_max)
              ? Math.min(110, Math.round(((m.customer_count || 0) / m.capacity_max) * 100))
              : 0;
            return (
              <div key={m.id} className="px-4 py-2.5 hover:bg-gray-50 transition-colors group">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                      <User className="w-3.5 h-3.5 text-gray-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{m.name}</p>
                      {!isAppointments && (
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold mt-0.5 px-1.5 py-0.5 rounded border ${typeViz.badge}`}
                          title={typeViz.label}
                        >
                          <Briefcase className="w-2.5 h-2.5" />
                          {typeViz.label}
                        </span>
                      )}
                      {m.job_title && (
                        <p className="text-[10px] text-gray-400 truncate mt-0.5">{m.job_title}</p>
                      )}
                    </div>
                  </div>
                  {!isAppointments && (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span
                        title={`عدد العملاء (الحد ${m.capacity_min}-${m.capacity_max})`}
                        className={`text-[11px] font-bold ${capViz ? capViz.text : theme.accent} ${capViz ? capViz.soft : theme.softBg} rounded-md px-1.5 py-0.5 flex items-center gap-1`}
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
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => onEditMember && onEditMember(m)}
                          className="opacity-0 group-hover:opacity-100 transition p-1 rounded hover:bg-indigo-100 text-gray-400 hover:text-indigo-600"
                          title="تغيير نوع المنسق"
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {/* Capacity meter — full width line under the name row */}
                {!isAppointments && m.capacity_max && (
                  <div className="mt-1.5">
                    <div className="flex items-center justify-between text-[9px] mb-0.5">
                      <span className="text-gray-400">
                        {m.capacity_min}-{m.capacity_max} طالب
                      </span>
                      {capViz && (
                        <span className={`${capViz.text} font-bold`}>{capViz.label}</span>
                      )}
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${capViz ? capViz.bar : 'bg-gray-300'} transition-all`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })
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

// ─── TRANSFER SIMULATOR (bottom half) ─────────────────────────────────────────
const TRANSFERABLE_SECTIONS = ['general', 'private', 'semi']; // 'appointments' excluded (no group/customer counts)

function TransferSimulator({ sections }) {
  const [coord, setCoord] = useState('');         // selected coordinator name
  const [toSection, setToSection] = useState('');

  // Flatten members across transferable sections — each row knows where it is.
  // Exclude section leaders: a leader shouldn't be transferred as a coordinator
  // (and shouldn't receive transferred groups either — backend enforces the
  // recipient side; frontend hides them from the moving-coordinator dropdown).
  const allMembers = useMemo(() => {
    const norm = (s) => String(s || '').trim().toLowerCase();
    return sections
      .filter((s) => TRANSFERABLE_SECTIONS.includes(s.key))
      .flatMap((s) => {
        const leaderName = norm(s.leader?.name);
        return s.members
          .filter((m) => !leaderName || norm(m.name) !== leaderName)
          .map((m) => ({
            name: m.name, fromSection: s.key, fromLabel: s.label,
            customer_count: m.customer_count ?? 0, group_count: m.group_count ?? 0,
          }));
      });
  }, [sections]);

  const selectedMember = allMembers.find((m) => m.name === coord) || null;
  const fromSection = selectedMember?.fromSection || '';

  // Sections available as targets (exclude the member's current section)
  const targetOptions = useMemo(() => {
    return sections
      .filter((s) => TRANSFERABLE_SECTIONS.includes(s.key) && s.key !== fromSection)
      .map((s) => ({ key: s.key, label: s.label }));
  }, [sections, fromSection]);

  const canSimulate = !!coord && !!toSection;

  const { data: sim, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['transfer-sim', coord, fromSection, toSection],
    queryFn: async () => {
      const res = await api.get('/org-chart/transfer-simulation', {
        params: { coordinator: coord, fromSection, toSection },
      });
      return res.data;
    },
    enabled: false,  // run only on button click
  });

  return (
    <div className="border-t-2 border-dashed border-gray-200 pt-8 mt-8">
      <header className="mb-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white">
          <ArrowLeftRight className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-800">محاكاة نقل منسق</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            اختار منسق وقسم جديد، السيستم يقترح إزاي المجموعات تتوزع — التوزيع متوازن حسب عدد العملاء، بريفيو فقط.
          </p>
        </div>
      </header>

      {/* Controls */}
      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Coordinator */}
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              المنسق
            </label>
            <div className="relative">
              <select
                value={coord}
                onChange={(e) => { setCoord(e.target.value); setToSection(''); }}
                className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 pr-8 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
              >
                <option value="">— اختار —</option>
                {allMembers.map((m) => (
                  <option key={`${m.fromSection}:${m.name}`} value={m.name}>
                    {m.name} ({m.fromLabel})
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* To section */}
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              ينتقل إلى
            </label>
            <div className="relative">
              <select
                value={toSection}
                onChange={(e) => setToSection(e.target.value)}
                disabled={!coord}
                className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 pr-8 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">— اختار قسم —</option>
                {targetOptions.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* Run button */}
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => refetch()}
              disabled={!canSimulate || isFetching}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-sm px-4 py-2 hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isFetching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {isFetching ? 'جاري الحساب...' : 'محاكاة'}
            </button>
          </div>
        </div>

        {selectedMember && (
          <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
            <span className="font-bold text-gray-700">{selectedMember.name}</span> حالياً في
            <span className="mx-1 font-bold text-indigo-700">{selectedMember.fromLabel}</span>
            بـ <span className="font-bold">{selectedMember.customer_count}</span> عميل عبر
            <span className="font-bold">{selectedMember.group_count}</span> مجموعة.
          </div>
        )}
      </div>

      {isError && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
          فشل المحاكاة: {error?.response?.data?.error || error?.message || 'خطأ غير معروف'}
        </div>
      )}

      {sim && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SourcePanel sim={sim} />
          <TargetPanel sim={sim} />
        </div>
      )}
    </div>
  );
}

// LEFT: After Ali leaves source section
function SourcePanel({ sim }) {
  const { coordinator_name, from_section, ali_current, source } = sim;
  const theme = COLUMN_THEMES[from_section.key] || COLUMN_THEMES.general;

  return (
    <div className={`rounded-2xl bg-white shadow-sm ring-1 ${theme.ring} overflow-hidden`}>
      <div className={`${theme.headerBg} ${theme.headerText} px-4 py-3`}>
        <h3 className="font-bold text-base flex items-center gap-2">
          <ArrowRight className="w-4 h-4 rotate-180" />
          بعد خروج {coordinator_name} من {from_section.label}
        </h3>
        <p className="text-xs text-white/80 mt-0.5">
          {ali_current.group_count} مجموعة ({ali_current.customer_count} عميل) موزعة على {source.member_summary.length} موظف
        </p>
      </div>

      {/* Groups → recipients */}
      <div className="p-3 border-b border-gray-100">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
          مجموعات {coordinator_name} تذهب إلى
        </div>
        {source.assignments.length === 0 ? (
          <p className="text-sm text-gray-400 italic text-center py-4">لا توجد مجموعات للتوزيع</p>
        ) : (
          <ul className="space-y-1.5 max-h-72 overflow-y-auto">
            {source.assignments.map((a, idx) => (
              <li key={`${a.group_name}|${idx}`} className="text-xs flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-gray-50">
                <span className="truncate flex-1 text-gray-700" title={a.group_name}>{a.group_name}</span>
                <span className="flex items-center gap-1 flex-shrink-0">
                  <span className={`${theme.accent} font-semibold`}>{a.customer_count}</span>
                  <ArrowRight className="w-3 h-3 text-gray-400" />
                  <span className="font-bold text-gray-800">{a.recipient_name || 'غير محدد'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Member before/after */}
      <div className="p-3">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
          عدد العملاء قبل و بعد
        </div>
        <BeforeAfterTable rows={source.member_summary.map((m) => ({
          name: m.name,
          before_count: m.before_count,
          after_count: m.after_count,
          before_groups: m.before_groups,
          after_groups: m.after_groups,
        }))} delta="positive" />
      </div>
    </div>
  );
}

// RIGHT: After Ali joins target section
function TargetPanel({ sim }) {
  const { coordinator_name, to_section, target } = sim;
  const theme = COLUMN_THEMES[to_section.key] || COLUMN_THEMES.private;

  return (
    <div className={`rounded-2xl bg-white shadow-sm ring-1 ${theme.ring} overflow-hidden`}>
      <div className={`${theme.headerBg} ${theme.headerText} px-4 py-3`}>
        <h3 className="font-bold text-base flex items-center gap-2">
          <ArrowRight className="w-4 h-4" />
          بعد انضمام {coordinator_name} إلى {to_section.label}
        </h3>
        <p className="text-xs text-white/80 mt-0.5">
          متوسط التقسيم: {target.target_per_person} عميل لكل موظف · {coordinator_name} يستلم {target.ali_after_count} عميل
        </p>
      </div>

      {/* Groups Ali receives */}
      <div className="p-3 border-b border-gray-100">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
          {coordinator_name} يستلم
        </div>
        {target.ali_receives.length === 0 ? (
          <p className="text-sm text-gray-400 italic text-center py-4">
            لا حاجة لإعادة توزيع — الأحمال متوازنة بالفعل
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-72 overflow-y-auto">
            {target.ali_receives.map((a, idx) => (
              <li key={`${a.group_name}|${idx}`} className="text-xs flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-gray-50">
                <span className="truncate flex-1 text-gray-700" title={a.group_name}>{a.group_name}</span>
                <span className="flex items-center gap-1 flex-shrink-0">
                  <span className="font-bold text-gray-800">{a.donor_name}</span>
                  <ArrowRight className="w-3 h-3 text-gray-400" />
                  <span className={`${theme.accent} font-semibold`}>{a.customer_count}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Member before/after */}
      <div className="p-3">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
          عدد العملاء قبل و بعد
        </div>
        <BeforeAfterTable
          rows={[
            // Ali first
            { name: coordinator_name, before_count: 0, after_count: target.ali_after_count, before_groups: 0, after_groups: target.ali_receives.length, isNew: true },
            ...target.member_summary.map((m) => ({
              name: m.name,
              before_count: m.before_count,
              after_count: m.after_count,
              before_groups: m.before_groups,
              after_groups: m.after_groups,
            })),
          ]}
          delta="negative"
        />
      </div>
    </div>
  );
}

function BeforeAfterTable({ rows, delta }) {
  if (!rows.length) return <p className="text-sm text-gray-400 italic text-center py-4">—</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-400 border-b border-gray-100">
            <th className="text-right py-1.5 font-semibold">الموظف</th>
            <th className="text-center py-1.5 font-semibold">عملاء قبل</th>
            <th className="text-center py-1.5 font-semibold">عملاء بعد</th>
            <th className="text-center py-1.5 font-semibold">مجموعات</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const diff = r.after_count - r.before_count;
            const isGain = diff > 0;
            const isLoss = diff < 0;
            return (
              <tr key={`${r.name}|${idx}`} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-1.5 font-semibold text-gray-700">
                  {r.name}
                  {r.isNew && <span className="text-[10px] text-indigo-600 mx-1 font-bold">(جديد)</span>}
                </td>
                <td className="text-center py-1.5 text-gray-500">{r.before_count}</td>
                <td className={`text-center py-1.5 font-bold ${isGain ? 'text-emerald-600' : isLoss ? 'text-rose-600' : 'text-gray-700'}`}>
                  {r.after_count}
                  {diff !== 0 && (
                    <span className="text-[10px] mx-1 font-normal">
                      ({diff > 0 ? '+' : ''}{diff})
                    </span>
                  )}
                </td>
                <td className="text-center py-1.5 text-gray-500">
                  {r.before_groups} <span className="text-gray-300">→</span> <span className="font-semibold text-gray-700">{r.after_groups}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
// ─── EDIT MEMBER TYPE MODAL ──────────────────────────────────────────────────
// Admin-only. Opens from the Settings icon on each member row. Shows the
// current type and lets the admin switch between standard / multi_task.
// The capacity rules per type are fetched live from the backend so frontend
// numbers always match the server-side classification.
function EditMemberTypeModal({ member, onClose }) {
  const qc = useQueryClient();
  const [selectedType, setSelectedType] = useState(member.coordinator_type || 'standard');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const { data: typesData } = useQuery({
    queryKey: ['org-chart', 'coordinator-types'],
    queryFn: async () => (await api.get('/org-chart/coordinator-types')).data,
    staleTime: 60 * 60 * 1000,  // catalog rarely changes
  });
  const types = typesData?.types || [];

  const mutation = useMutation({
    mutationFn: () => api.patch(`/org-chart/members/${member.id}/type`, {
      coordinator_type: selectedType,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-chart'] });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || err.message),
  });

  async function save() {
    if (selectedType === member.coordinator_type) {
      onClose();
      return;
    }
    setError(null);
    setSubmitting(true);
    try { await mutation.mutateAsync(); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-gradient-to-r from-indigo-50 to-purple-50 border-b flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900 text-base">تغيير نوع المنسق</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {member.name} • {member.sectionLabel}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white rounded-lg">
            <X size={18} className="text-gray-600" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {error && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-gray-500">عدد العملاء الحاليّ</span>
              <span className="font-bold text-gray-800">{member.customer_count ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">عدد المجموعات</span>
              <span className="font-bold text-gray-800">{member.group_count ?? 0}</span>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-600">اختر النوع:</p>
            {types.map((t) => {
              const viz = COORD_TYPE_VISUAL[t.code] || COORD_TYPE_VISUAL.standard;
              const isSelected = selectedType === t.code;
              const isCurrent  = member.coordinator_type === t.code;
              return (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => setSelectedType(t.code)}
                  className={`w-full text-right p-3 rounded-lg border-2 transition ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${viz.dot}`} />
                    <span className="font-bold text-sm text-gray-800 flex-1">{t.label_ar}</span>
                    {isSelected && <CheckCircle2 size={16} className="text-indigo-600" />}
                    {isCurrent && !isSelected && (
                      <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">الحالي</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    الـ Capacity المثالية: <span className="font-bold">{t.capacity_min}-{t.capacity_max} طالب</span>
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-100">
            إلغاء
          </button>
          <button
            onClick={save}
            disabled={submitting}
            className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-bold disabled:opacity-50"
          >
            {submitting ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OrgChart() {
  const [activeTab, setActiveTab] = useState('customer_services');
  // Which member is currently being re-classified by the admin (null = closed).
  const [editingMember, setEditingMember] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['org-chart', activeTab],
    queryFn: async () => {
      if (activeTab !== 'customer_services') return null;
      const res = await api.get('/org-chart/customer-services');
      return res.data;
    },
    enabled: activeTab === 'customer_services',
  });

  // Layout/feature flags driven by who is viewing. Admin gets the full view
  // (all sections + simulator). A team leader gets only their own column and
  // no simulator (moving members between sections is an admin action).
  const isAdmin = data?.viewer_role === 'admin';
  const sectionCount = data?.sections?.length || 0;
  // 1 column → centered card; 2-4 → up to 4 wide; 5+ → 5 wide on large screens.
  const gridCols = sectionCount === 1
    ? 'grid-cols-1 max-w-md mx-auto'
    : sectionCount >= 5
      ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5'
      : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4';

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

          {data?.sections && data.sections.length > 0 && (
            <div className={`grid ${gridCols} gap-4`}>
              {data.sections.map((s) => (
                <ColumnCard
                  key={s.key}
                  section={s}
                  isAdmin={isAdmin}
                  onEditMember={(m) => setEditingMember({ ...m, sectionLabel: s.label })}
                />
              ))}
            </div>
          )}

          {editingMember && (
            <EditMemberTypeModal
              member={editingMember}
              onClose={() => setEditingMember(null)}
            />
          )}

          {data?.sections && data.sections.length === 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-800 text-sm">
              {data.warning || 'لا يوجد بيانات لعرضها'}
            </div>
          )}

          {/* ── Bottom half: Transfer Simulator (admin only) ────────────── */}
          {isAdmin && data?.sections && data.sections.length > 0 && (
            <TransferSimulator sections={data.sections} />
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
