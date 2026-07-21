import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Network, Layers, Users, BookOpen, GraduationCap, AlertCircle, X, Calendar, ChevronLeft,
  ArrowLeftRight, ArrowRight, RefreshCw, Sparkles, ChevronDown, UserPlus,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/ui/PageHero';

// Two columns (owner decision): عام + «خاص وشبه خاص» merged (private_semi).
const SIM_SECTION_LABEL = { general: 'عام', private_semi: 'خاص وشبه خاص' };
const SIM_THEME = {
  general:      { accent: 'text-sky-700',    headerBg: 'bg-sky-600',    ring: 'ring-sky-100' },
  private_semi: { accent: 'text-violet-700', headerBg: 'bg-violet-600', ring: 'ring-violet-100' },
};
// Per-group REAL-section badge (shown inside the merged column).
const GROUP_SEC_BADGE = {
  semi:    { label: 'شبه خاص', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  private: { label: 'خاص',     cls: 'bg-violet-50 text-violet-700 border-violet-200' },
};

// ─── PER-COLUMN VISUAL THEME ──────────────────────────────────────────────────
// Same section colors as the customer-services org chart so the two pages read
// as one family: عام=أزرق، شبه خاص=كهرماني، خاص=بنفسجي.
const COLUMN_THEMES = {
  general:      { headerBg: 'bg-sky-600',    accent: 'text-sky-700',    ring: 'ring-sky-100',    softBg: 'bg-sky-50'    },
  private_semi: { headerBg: 'bg-violet-600', accent: 'text-violet-700', ring: 'ring-violet-100', softBg: 'bg-violet-50' },
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
              onClick={() => onSelect(m, theme, section.label, section.key)}
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

      {/* Footer totals (+ real-section breakdown for the merged column) */}
      <div className={`${theme.softBg} px-4 py-2.5 border-t border-gray-100 text-xs font-bold flex items-center justify-between flex-wrap gap-x-2 gap-y-1`}>
        <span className="text-gray-600">
          الإجمالي
          {section.breakdown && (
            <span className="font-normal text-gray-500"> (خاص {section.breakdown.private ?? 0} · شبه خاص {section.breakdown.semi ?? 0})</span>
          )}
        </span>
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
  const { member, theme, sectionLabel, sectionKey } = selected;
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['trainer-org-chart', 'detail', member.id, sectionKey],
    queryFn: async () => (await api.get(`/reports/trainer-org-chart/trainer/${member.id}`, { params: { section: sectionKey } })).data,
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
                      {GROUP_SEC_BADGE[g.section] && (
                        <span className={`inline-block text-[9px] font-bold mr-1.5 px-1.5 py-0.5 rounded border ${GROUP_SEC_BADGE[g.section].cls}`}>
                          {GROUP_SEC_BADGE[g.section].label}
                        </span>
                      )}
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

// ═══════════════════════════════════════════════════════════════════════════════
// TRAINER DISTRIBUTION SIMULATION HUB — 6 preview modes (no writes). Trainer
// logic: the unit is GROUPS taught (no student-capacity band like coordinators).
// ═══════════════════════════════════════════════════════════════════════════════
const SIM_MODES = [
  { key: 'leave',     label: 'خروج من القسم',      desc: 'محاضر يخرج ومجموعاته تتوزّع على باقي محاضري قسمه',        icon: ArrowRight },
  { key: 'transfer',  label: 'نقل لقسم آخر',       desc: 'محاضر ينتقل لقسم تاني — مجموعاته تتوزّع على باقي قسمه الحالي', icon: ArrowLeftRight },
  { key: 'swap',      label: 'استبدال محاضرين',    desc: 'محاضرين من قسمين مختلفين يتبادلوا الأقسام',                icon: RefreshCw },
  { key: 'add_new',   label: 'إضافة محاضر',        desc: 'محاضر جديد ينضم لقسم — الموجودون يتنازلوا له عن مجموعات',   icon: UserPlus },
  { key: 'temporary', label: 'غياب مؤقت',          desc: 'توزيع مؤقت لمدة محددة (إجازة/سفر) لمجموعات محاضر',         icon: AlertCircle },
  { key: 'groups',    label: 'نقل مجموعات محددة',  desc: 'اختار مجموعات بعينها من محاضر وانقلها لمحاضر تاني',          icon: Layers },
];

function SimSelect({ label, value, onChange, options, placeholder, disabled }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-gray-500 mb-1.5">{label}</label>
      <div className="relative">
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
          className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 pr-8 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none disabled:bg-gray-50 disabled:text-gray-400">
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>
    </div>
  );
}
function SimRunBtn({ onClick, disabled, busy }) {
  return (
    <div className="flex items-end">
      <button type="button" onClick={onClick} disabled={disabled}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-sm px-4 py-2 hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {busy ? 'جاري الحساب...' : 'محاكاة'}
      </button>
    </div>
  );
}
function SimCard({ children }) {
  return <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4 mb-4">{children}</div>;
}
function SimErr({ error }) {
  if (!error) return null;
  return <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-700 text-sm mb-4">فشل المحاكاة: {error?.response?.data?.error || error?.message || 'خطأ'}</div>;
}
function DeltaNum({ before, after }) {
  const d = (after ?? 0) - (before ?? 0);
  const c = d > 0 ? 'text-emerald-600' : d < 0 ? 'text-red-600' : 'text-gray-400';
  return <span className="font-bold text-gray-800">{before} → {after} <span className={`text-xs ${c}`}>({d > 0 ? '+' : ''}{d})</span></span>;
}

// Assignments (group → recipient) + recipients before/after — the shared result
// block for leave / transfer / temporary.
function RedistPanel({ sim }) {
  const th = SIM_THEME[sim.source.section] || SIM_THEME.general;
  return (
    <div className={`rounded-2xl bg-white shadow-sm ring-1 ${th.ring} overflow-hidden`}>
      <div className={`${th.headerBg} text-white px-4 py-3`}>
        <h3 className="font-bold text-base flex items-center gap-2">
          <ArrowRight className="w-4 h-4 rotate-180" />
          بعد خروج {sim.source.name} من {sim.source.section_label}
        </h3>
        <p className="text-xs text-white/80 mt-0.5">
          {sim.source.before.groups} مجموعة ({sim.source.before.students} طالب) هتتوزّع على {sim.recipients.length} محاضر
          {sim.target ? <> — المحاضر بينتقل إلى <b>{sim.target.section_label}</b></> : null}
          {sim.date_from && sim.date_to ? <> — مؤقتًا من {sim.date_from} إلى {sim.date_to}</> : null}
        </p>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <div className="text-[11px] font-bold text-gray-500 mb-2 flex items-center justify-between">
            <span>توزيع المجموعات</span>
            {sim.needs_scheduling_count > 0 && (
              <span className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 font-bold">
                {sim.needs_scheduling_count} محتاجة جدولة
              </span>
            )}
          </div>
          {sim.assignments.length === 0 ? (
            <p className="text-sm text-gray-400 italic text-center py-3">لا توجد مجموعات للتوزيع</p>
          ) : (
            <ul className="space-y-1 max-h-72 overflow-y-auto">
              {sim.assignments.map((a, i) => (
                a.needs_scheduling ? (
                  <li key={i} className="text-xs py-1.5 px-2 rounded bg-amber-50 border border-amber-200">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate flex-1 text-gray-800 font-semibold" title={a.group_name}>{a.group_name}</span>
                      <span className="flex items-center gap-1 text-amber-700 font-bold flex-shrink-0"><AlertCircle className="w-3 h-3" />محتاجة جدولة</span>
                    </div>
                    {a.suggestions && a.suggestions.length > 0 ? (
                      <div className="mt-1 text-[10px] text-emerald-700 flex items-start gap-1">
                        <Sparkles className="w-3 h-3 flex-shrink-0 mt-0.5" />
                        <span>متاح في {a.suggestions[0].section_label}: <b>{a.suggestions.map((s) => s.name).join('، ')}</b></span>
                      </div>
                    ) : (
                      <div className="mt-1 text-[10px] text-gray-400">مفيش محاضر متاح في القسم (شيفت يغطّي الميعاد + فاضي)</div>
                    )}
                  </li>
                ) : (
                  <li key={i} className="text-xs flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-gray-50">
                    <span className="truncate flex-1 text-gray-700" title={a.group_name}>{a.group_name}</span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <span className={`${th.accent} font-semibold`}>{a.students}👥</span>
                      <ArrowRight className="w-3 h-3 text-gray-400" />
                      <span className="font-bold text-gray-800">{a.recipient}</span>
                    </span>
                  </li>
                )
              ))}
            </ul>
          )}
        </div>
        {sim.recipients.length > 0 && (
          <div>
            <div className="text-[11px] font-bold text-gray-500 mb-2">المحاضرون (قبل ← بعد)</div>
            <div className="space-y-1">
              {sim.recipients.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-gray-50">
                  <span className="font-semibold text-gray-700 truncate">{r.name}</span>
                  <span className="text-gray-500">مجموعات: <DeltaNum before={r.before_groups} after={r.after_groups} /></span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LeaveMode({ members, mode }) {
  const [trainer, setTrainer] = useState('');
  const [toSection, setToSection] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const sel = members.find((m) => m.key === trainer);
  const destOptions = ['general', 'private_semi'].filter((s) => s !== sel?.section);
  const { data: sim, isFetching, error, refetch } = useQuery({
    queryKey: ['tr-sim', mode, trainer, toSection, from, to],
    queryFn: async () => (await api.get('/reports/trainer-org-chart/sim/leave', {
      params: { key: trainer, mode, to_section: mode === 'transfer' ? toSection : '', date_from: mode === 'temporary' ? from : '', date_to: mode === 'temporary' ? to : '' },
    })).data,
    enabled: false,
  });
  return (
    <>
      <SimCard>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SimSelect label="المحاضر" value={trainer} onChange={(v) => { setTrainer(v); setToSection(''); }}
            options={members.map((m) => ({ value: m.key, label: `${m.name} (${m.section_label})` }))} placeholder="— اختار —" />
          {mode === 'transfer' && (
            <SimSelect label="ينتقل إلى" value={toSection} onChange={setToSection} disabled={!trainer}
              options={destOptions.map((s) => ({ value: s, label: SIM_SECTION_LABEL[s] }))} placeholder="— اختار قسم —" />
          )}
          {mode === 'temporary' && (
            <div className="grid grid-cols-2 gap-2">
              <div><label className="block text-[11px] font-bold text-gray-500 mb-1.5">من</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm" /></div>
              <div><label className="block text-[11px] font-bold text-gray-500 mb-1.5">إلى</label>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm" /></div>
            </div>
          )}
          <SimRunBtn onClick={() => refetch()} disabled={!trainer || (mode === 'transfer' && !toSection) || isFetching} busy={isFetching} />
        </div>
        {sel && <p className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500"><b>{sel.name}</b> في <b className="text-indigo-700">{sel.section_label}</b> — <b>{sel.group_count}</b> مجموعة / <b>{sel.student_count}</b> طالب.</p>}
      </SimCard>
      <SimErr error={error} />
      {sim && <div className="max-w-3xl mx-auto"><RedistPanel sim={sim} /></div>}
    </>
  );
}

function SwapMode({ members }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const aM = members.find((m) => m.key === a);
  const bOptions = aM ? members.filter((m) => m.section !== aM.section) : members;
  const { data: sim, isFetching, error, refetch } = useQuery({
    queryKey: ['tr-sim-swap', a, b],
    queryFn: async () => (await api.get('/reports/trainer-org-chart/sim/swap', { params: { keyA: a, keyB: b } })).data,
    enabled: false,
  });
  const Half = ({ p }) => (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 overflow-hidden">
      <div className="bg-gray-700 text-white px-4 py-3">
        <h3 className="font-bold text-sm flex items-center gap-2"><ArrowLeftRight className="w-4 h-4" />{p.name} يخرج من {p.section_label}</h3>
        <p className="text-xs text-white/80 mt-0.5">{p.before.groups} مجموعة تتوزّع على {p.recipients.length} محاضر</p>
      </div>
      <div className="p-3">
        {p.needs_scheduling_count > 0 && (
          <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2 font-bold">{p.needs_scheduling_count} محتاجة جدولة</div>
        )}
        <ul className="space-y-1 max-h-52 overflow-y-auto mb-3">
          {p.assignments.map((x, i) => (
            x.needs_scheduling ? (
              <li key={i} className="text-xs py-1.5 px-2 rounded bg-amber-50 border border-amber-200">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate flex-1 text-gray-800 font-semibold" title={x.group_name}>{x.group_name}</span>
                  <span className="text-amber-700 font-bold flex items-center gap-1"><AlertCircle className="w-3 h-3" />محتاجة جدولة</span>
                </div>
                {x.suggestions && x.suggestions.length > 0 ? (
                  <div className="mt-1 text-[10px] text-emerald-700">💡 متاح في {x.suggestions[0].section_label}: <b>{x.suggestions.map((s) => s.name).join('، ')}</b></div>
                ) : <div className="mt-1 text-[10px] text-gray-400">مفيش محاضر متاح</div>}
              </li>
            ) : (
              <li key={i} className="text-xs flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-gray-50">
                <span className="truncate flex-1 text-gray-700" title={x.group_name}>{x.group_name}</span>
                <span className="flex items-center gap-1"><ArrowRight className="w-3 h-3 text-gray-400" /><b className="text-gray-800">{x.recipient}</b></span>
              </li>
            )
          ))}
        </ul>
        {p.recipients.map((r, i) => (
          <div key={i} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-gray-50"><span className="font-semibold text-gray-700 truncate">{r.name}</span><span className="text-gray-500">مجموعات: <DeltaNum before={r.before_groups} after={r.after_groups} /></span></div>
        ))}
      </div>
    </div>
  );
  return (
    <>
      <SimCard>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SimSelect label="المحاضر الأول" value={a} onChange={(v) => { setA(v); setB(''); }}
            options={members.map((m) => ({ value: m.key, label: `${m.name} (${m.section_label})` }))} placeholder="— اختار —" />
          <SimSelect label="المحاضر التاني (قسم مختلف)" value={b} onChange={setB} disabled={!a}
            options={bOptions.map((m) => ({ value: m.key, label: `${m.name} (${m.section_label})` }))} placeholder="— اختار —" />
          <SimRunBtn onClick={() => refetch()} disabled={!a || !b || isFetching} busy={isFetching} />
        </div>
      </SimCard>
      <SimErr error={error} />
      {sim && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><Half p={sim.a} /><Half p={sim.b} /></div>}
    </>
  );
}

function AddNewMode({ members }) {
  const [name, setName] = useState('');
  const [section, setSection] = useState('');
  const { data: sim, isFetching, error, refetch } = useQuery({
    queryKey: ['tr-sim-add', name, section],
    queryFn: async () => (await api.get('/reports/trainer-org-chart/sim/add-new', { params: { name, section } })).data,
    enabled: false,
  });
  return (
    <>
      <SimCard>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><label className="block text-[11px] font-bold text-gray-500 mb-1.5">الاسم</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="محاضر جديد أو موجود..."
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none" /></div>
          <SimSelect label="القسم" value={section} onChange={setSection}
            options={['general', 'private_semi'].map((s) => ({ value: s, label: SIM_SECTION_LABEL[s] }))} placeholder="— اختار قسم —" />
          <SimRunBtn onClick={() => refetch()} disabled={!name.trim() || !section || isFetching} busy={isFetching} />
        </div>
      </SimCard>
      <SimErr error={error} />
      {sim && (
        <div className="max-w-3xl mx-auto rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 overflow-hidden">
          <div className="bg-emerald-600 text-white px-4 py-3">
            <h3 className="font-bold text-base flex items-center gap-2"><UserPlus className="w-4 h-4" />{sim.newcomer.name} ينضم لـ {sim.newcomer.section_label}</h3>
            <p className="text-xs text-white/80 mt-0.5">هيستلم {sim.newcomer_after.groups} مجموعة ({sim.newcomer_after.students} طالب) — الحصة العادلة ≈ {sim.target_groups} مجموعة</p>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <div className="text-[11px] font-bold text-gray-500 mb-2">مجموعات هتيجي للمحاضر الجديد</div>
              {sim.assignments.length === 0 ? <p className="text-sm text-gray-400 italic text-center py-3">مفيش مجموعات تتنقل (القسم صغير)</p> : (
                <ul className="space-y-1 max-h-56 overflow-y-auto">
                  {sim.assignments.map((a, i) => (
                    <li key={i} className="text-xs flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-gray-50">
                      <span className="truncate flex-1 text-gray-700" title={a.group_name}>{a.group_name}</span>
                      <span className="flex items-center gap-1"><b className="text-gray-500">{a.from_trainer}</b><ArrowRight className="w-3 h-3 text-gray-400" /><b className="text-emerald-700">الجديد</b></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-[11px] font-bold text-gray-500 mb-2">المحاضرون الحاليون (قبل ← بعد)</div>
              {sim.donors.map((d, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-gray-50"><span className="font-semibold text-gray-700 truncate">{d.name}</span><span className="text-gray-500">مجموعات: <DeltaNum before={d.before_groups} after={d.after_groups} /></span></div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function GroupsMode({ members }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [picked, setPicked] = useState([]);
  const fromM = members.find((m) => m.key === from);
  const toOptions = from ? members.filter((m) => m.key !== from) : members;
  const { data: detail } = useQuery({
    queryKey: ['tr-sim-detail', from],
    queryFn: async () => (await api.get(`/reports/trainer-org-chart/trainer/${fromM.id}`, { params: { section: fromM.section } })).data,
    enabled: !!fromM?.id,
  });
  const avail = detail?.groups || [];
  useEffect(() => { setPicked([]); }, [from]);
  const toggle = (g) => { const k = `${g.group_name}|${g.line}`; setPicked((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]); };
  const { mutate, data: res, isPending, error } = useMutation({
    mutationFn: () => api.post('/reports/trainer-org-chart/sim/groups', {
      fromKey: from, toKey: to,
      groups: picked.map((k) => { const [gn, ln] = k.split('|'); return { group_name: gn, line: ln }; }),
    }),
  });
  const sim = res?.data;
  return (
    <>
      <SimCard>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SimSelect label="من محاضر" value={from} onChange={(v) => { setFrom(v); setTo(''); }}
            options={members.map((m) => ({ value: m.key, label: `${m.name} (${m.section_label})` }))} placeholder="— اختار —" />
          <SimSelect label="إلى محاضر" value={to} onChange={setTo} disabled={!from}
            options={toOptions.map((m) => ({ value: m.key, label: `${m.name} (${m.section_label})` }))} placeholder="— اختار —" />
          <SimRunBtn onClick={() => mutate()} disabled={!from || !to || picked.length === 0 || isPending} busy={isPending} />
        </div>
        {from && avail.length > 0 && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <div className="text-[11px] font-bold text-gray-500 mb-2 flex items-center justify-between">
              <span>اختار المجموعات ({picked.length} مختارة)</span>
              <button type="button" onClick={() => setPicked(picked.length === avail.length ? [] : avail.map((g) => `${g.group_name}|${g.line}`))} className="text-indigo-600 hover:underline font-bold">
                {picked.length === avail.length ? 'إلغاء الكل' : 'اختيار الكل'}
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-1">
              {avail.map((g) => {
                const k = `${g.group_name}|${g.line}`; const on = picked.includes(k);
                return (
                  <label key={k} className={`flex items-center gap-2 p-2 rounded cursor-pointer text-xs ${on ? 'bg-indigo-50 border border-indigo-200' : 'border border-gray-100 hover:bg-gray-50'}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(g)} className="w-4 h-4 accent-indigo-500" />
                    <span className="truncate flex-1" title={g.group_name}>{g.group_name}</span>
                    <span className="text-gray-500 font-bold">{g.students}👥</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </SimCard>
      <SimErr error={error} />
      {sim && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[sim.from, sim.to].map((side, idx) => (
            <div key={idx} className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 overflow-hidden">
              <div className={`${idx === 0 ? 'bg-red-500' : 'bg-emerald-600'} text-white px-4 py-3`}>
                <h3 className="font-bold text-base">{side.name} ({idx === 0 ? 'يفقد' : 'يستلم'})</h3>
                <p className="text-xs text-white/80">{side.section_label}</p>
              </div>
              <div className="p-4 grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-50 rounded-lg p-3 text-center"><p className="text-[10px] text-gray-500 font-bold">مجموعات</p><p className="text-base font-black text-gray-800">{side.before.groups} → {side.after.groups}</p></div>
                <div className="bg-gray-50 rounded-lg p-3 text-center"><p className="text-[10px] text-gray-500 font-bold">طلاب</p><p className="text-base font-black text-gray-800">{side.before.students} → {side.after.students}</p></div>
              </div>
            </div>
          ))}
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4">
            <h4 className="text-sm font-bold text-gray-800 mb-2">المجموعات المنقولة ({sim.moved.length})</h4>
            <ul className="space-y-1 max-h-52 overflow-y-auto text-xs">
              {sim.moved.map((g, i) => (
                <li key={i} className="flex justify-between items-center py-1 px-2 hover:bg-gray-50 rounded"><span className="truncate flex-1" title={g.group_name}>{g.group_name}</span><span className="font-bold text-gray-700">{g.students} طالب</span></li>
              ))}
            </ul>
            {sim.missing > 0 && <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">⚠️ {sim.missing} مجموعة مش موجودة عند المحاضر المصدر — اتجاهلت</div>}
          </div>
        </div>
      )}
    </>
  );
}

function TrainerSimulationHub() {
  const [mode, setMode] = useState('leave');
  const { data, isLoading } = useQuery({
    queryKey: ['tr-sim-members'],
    queryFn: async () => (await api.get('/reports/trainer-org-chart/sim/members')).data,
  });
  const members = data?.members || [];

  return (
    <div className="border-t-2 border-dashed border-gray-200 pt-8 mt-8">
      <header className="mb-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white">
          <ArrowLeftRight className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-800">محاكاة توزيع المحاضرين</h2>
          <p className="text-xs text-gray-500 mt-0.5">بريفيو فقط بلا حفظ. التوزيع بيوازن عدد المجموعات <b>مع مراعاة مواعيد وأيام شيفت المحاضر وعدم التعارض</b> (الفويس نوت والراحات وقت مشغول) — قسما خاص وشبه خاص pool واحد، والمجموعة اللي مفيش لها محاضر متاح تظهر «محتاجة جدولة».</p>
        </div>
      </header>

      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-2 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {SIM_MODES.map((m) => {
            const Icon = m.icon; const on = mode === m.key;
            return (
              <button key={m.key} type="button" onClick={() => setMode(m.key)}
                className={`p-2.5 rounded-xl text-right transition border-2 ${on ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white border-indigo-600 shadow-md' : 'bg-gray-50 border-gray-100 hover:border-indigo-200 hover:bg-indigo-50'}`}>
                <div className="flex items-center gap-1.5 mb-1"><Icon className={`w-3.5 h-3.5 ${on ? 'text-white' : 'text-indigo-600'}`} /><span className={`text-xs font-bold ${on ? 'text-white' : 'text-gray-800'}`}>{m.label}</span></div>
                <p className={`text-[10px] leading-tight ${on ? 'text-white/80' : 'text-gray-500'}`}>{m.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="h-32 rounded-2xl bg-gray-100 animate-pulse" />
      ) : (
        <>
          {(mode === 'leave' || mode === 'transfer' || mode === 'temporary') && <LeaveMode members={members} mode={mode} />}
          {mode === 'swap'    && <SwapMode   members={members} />}
          {mode === 'add_new' && <AddNewMode members={members} />}
          {mode === 'groups'  && <GroupsMode members={members} />}
        </>
      )}
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
        subtitle="محاضرو المحاضرات الأساسية موزّعين على قسمين (عام / خاص وشبه خاص) — اضغط على أي محاضر لعرض تفاصيله"
        icon={Network}
        gradient="linear-gradient(135deg, #1e40af 0%, #6366f1 100%)"
      />

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1].map((i) => (
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sections.map((s) => (
            <TrainerColumnCard
              key={s.key}
              section={s}
              onSelect={(member, theme, sectionLabel, sectionKey) => setSelected({ member, theme, sectionLabel, sectionKey })}
            />
          ))}
        </div>
      )}

      {!isLoading && !isError && sections.length === 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-800 text-sm">
          لا يوجد بيانات لعرضها
        </div>
      )}

      {/* Distribution simulation (preview only) */}
      {!isLoading && !isError && sections.length > 0 && <TrainerSimulationHub />}

      {selected && <TrainerDetailModal selected={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
