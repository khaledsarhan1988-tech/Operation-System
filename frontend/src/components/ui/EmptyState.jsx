/**
 * EmptyState — friendly placeholder for sections with no data.
 *
 * Props:
 *   icon     — Lucide icon component
 *   title    — short headline (default: 'لا توجد بيانات')
 *   message  — descriptive text below
 *   action   — JSX (e.g., a button) shown below the message
 *   compact  — smaller variant for narrow containers
 *   accent   — icon background color: gray | blue | violet | emerald | amber | rose
 */
const ACCENT_BG = {
  gray:    'bg-gray-100    text-gray-400',
  blue:    'bg-blue-50     text-blue-400',
  violet:  'bg-violet-50   text-violet-400',
  emerald: 'bg-emerald-50  text-emerald-500',
  amber:   'bg-amber-50    text-amber-500',
  rose:    'bg-rose-50     text-rose-400',
};

export default function EmptyState({
  icon: Icon,
  title = 'لا توجد بيانات',
  message,
  action,
  compact = false,
  accent = 'gray',
}) {
  const accentCls = ACCENT_BG[accent] || ACCENT_BG.gray;
  const sz = compact ? 'py-6' : 'py-12';
  const iconSize = compact ? 22 : 32;

  return (
    <div className={`text-center ${sz}`}>
      {Icon && (
        <div className={`inline-flex items-center justify-center w-${compact ? 12 : 16} h-${compact ? 12 : 16} rounded-2xl ${accentCls} mb-3`}
             style={{ width: compact ? 48 : 64, height: compact ? 48 : 64 }}>
          <Icon size={iconSize} strokeWidth={2} />
        </div>
      )}
      <p className="text-sm font-black text-gray-700">{title}</p>
      {message && <p className="text-xs text-gray-400 font-bold mt-1.5 max-w-sm mx-auto leading-relaxed">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
