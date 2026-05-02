import { useTranslation } from 'react-i18next';

// Tailwind-soft palette: bg-{color}-50 + text-{color}-700 + border-{color}-200
// Gives a calm, polished look that's easy on the eyes (vs old harsh /10 tints).
const SOFT_PALETTE = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber:   'bg-amber-50 text-amber-700 border-amber-200',
  red:     'bg-red-50 text-red-700 border-red-200',
  blue:    'bg-blue-50 text-blue-700 border-blue-200',
  indigo:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  purple:  'bg-purple-50 text-purple-700 border-purple-200',
  teal:    'bg-teal-50 text-teal-700 border-teal-200',
  orange:  'bg-orange-50 text-orange-700 border-orange-200',
  slate:   'bg-slate-100 text-slate-600 border-slate-200',
};

// Status value → display config
const STATUS_MAP = {
  // Remark status
  'إنتهت':       { label: 'done',      cls: SOFT_PALETTE.emerald },
  'غير منتهية':  { label: 'pending',   cls: SOFT_PALETTE.amber },
  // Priority
  'عاجلة':       { label: 'urgent',    cls: SOFT_PALETTE.red },
  'هامة':        { label: 'important', cls: SOFT_PALETTE.amber },
  'عادية':       { label: 'normal',    cls: SOFT_PALETTE.slate },
  // Batch status
  'نشطة':        { label: 'active',    cls: SOFT_PALETTE.emerald },
  'مجدولة':      { label: 'scheduled', cls: SOFT_PALETTE.blue },
  'مؤكدة':       { label: 'confirmed', cls: SOFT_PALETTE.emerald },
  // Follow-up
  pending:       { label: 'pending',   cls: SOFT_PALETTE.amber },
  contacted:     { label: 'contacted', cls: SOFT_PALETTE.blue },
  resolved:      { label: 'resolved',  cls: SOFT_PALETTE.emerald },
  // SLA
  on_time:       { label: 'onTime',    cls: SOFT_PALETTE.emerald },
  at_risk:       { label: 'atRisk',    cls: SOFT_PALETTE.amber },
  breached:      { label: 'breached',  cls: SOFT_PALETTE.red },
  // Session type
  main:          { label: 'main',      cls: SOFT_PALETTE.blue },
  side:          { label: 'side',      cls: SOFT_PALETTE.purple },
  onboarding:    { label: 'onboarding',  cls: SOFT_PALETTE.teal },
  offboarding:   { label: 'offboarding', cls: SOFT_PALETTE.orange },
  regular:       { label: 'regular',     cls: SOFT_PALETTE.blue },
  compensatory:  { label: 'compensatory',cls: SOFT_PALETTE.amber },
};

export default function Badge({ value, ns, className = '' }) {
  const { t } = useTranslation();
  if (!value) return null;
  const conf = STATUS_MAP[value];
  if (!conf) return <span className={`badge ${SOFT_PALETTE.slate} ${className}`}>{value}</span>;

  let label;
  try {
    label = ns ? t(`${ns}.${conf.label}`) : t(`tasks.${conf.label}`, { defaultValue: t(`sla.${conf.label}`, { defaultValue: t(`absent.${conf.label}`, { defaultValue: t(`schedule.${conf.label}`, { defaultValue: conf.label }) }) }) });
  } catch {
    label = conf.label;
  }

  return <span className={`badge ${conf.cls} ${className}`}>{label}</span>;
}
