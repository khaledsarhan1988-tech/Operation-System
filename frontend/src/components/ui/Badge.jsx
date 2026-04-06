import { useTranslation } from 'react-i18next';

// Status value → display config
const STATUS_MAP = {
  // Remark status
  'إنتهت':       { label: 'done',      cls: 'bg-success/10 text-success' },
  'غير منتهية':  { label: 'pending',   cls: 'bg-warning/10 text-warning' },
  // Priority
  'عاجلة':       { label: 'urgent',    cls: 'bg-danger/10 text-danger' },
  'هامة':        { label: 'important', cls: 'bg-warning/10 text-warning' },
  'عادية':       { label: 'normal',    cls: 'bg-gray-100 text-gray-500' },
  // Batch status
  'نشطة':        { label: 'active',    cls: 'bg-success/10 text-success' },
  'مجدولة':      { label: 'scheduled', cls: 'bg-blue-100 text-blue-600' },
  'مؤكدة':       { label: 'confirmed', cls: 'bg-success/10 text-success' },
  // Follow-up
  pending:       { label: 'pending',   cls: 'bg-warning/10 text-warning' },
  contacted:     { label: 'contacted', cls: 'bg-blue-100 text-blue-600' },
  resolved:      { label: 'resolved',  cls: 'bg-success/10 text-success' },
  // SLA
  on_time:       { label: 'onTime',    cls: 'bg-success/10 text-success' },
  at_risk:       { label: 'atRisk',    cls: 'bg-warning/10 text-warning' },
  breached:      { label: 'breached',  cls: 'bg-danger/10 text-danger' },
  // Session type
  main:          { label: 'main',      cls: 'bg-blue-100 text-blue-600' },
  side:          { label: 'side',      cls: 'bg-purple-100 text-purple-600' },
  onboarding:    { label: 'onboarding',cls: 'bg-teal-100 text-teal-600' },
  offboarding:   { label: 'offboarding',cls:'bg-orange-100 text-orange-600' },
  regular:       { label: 'regular',   cls: 'bg-purple-100 text-purple-600' },
  compensatory:  { label: 'compensatory',cls:'bg-gray-100 text-gray-600' },
};

export default function Badge({ value, ns, className = '' }) {
  const { t } = useTranslation();
  if (!value) return null;
  const conf = STATUS_MAP[value];
  if (!conf) return <span className={`badge bg-gray-100 text-gray-600 ${className}`}>{value}</span>;

  let label;
  try {
    label = ns ? t(`${ns}.${conf.label}`) : t(`tasks.${conf.label}`, { defaultValue: t(`sla.${conf.label}`, { defaultValue: t(`absent.${conf.label}`, { defaultValue: t(`schedule.${conf.label}`, { defaultValue: conf.label }) }) }) });
  } catch {
    label = conf.label;
  }

  return <span className={`badge ${conf.cls} ${className}`}>{label}</span>;
}
