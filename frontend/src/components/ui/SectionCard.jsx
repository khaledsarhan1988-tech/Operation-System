/**
 * SectionCard — modern rounded card for content sections.
 *
 * Props:
 *   title       — section heading text
 *   icon        — Lucide icon
 *   accent      — header icon color: indigo | blue | violet | emerald | amber | rose | cyan | fuchsia
 *   actions     — JSX rendered on the leading edge of the header
 *   children    — body content
 *   padding     — body padding (default: 'p-6')
 *   className   — extra classes for the outer card
 *   loading     — render skeleton placeholder when true
 *   noBodyPad   — disable default body padding (e.g. for tables)
 */
const ACCENT_BG = {
  indigo:  'bg-indigo-100  text-indigo-600',
  blue:    'bg-blue-100    text-blue-600',
  violet:  'bg-violet-100  text-violet-600',
  emerald: 'bg-emerald-100 text-emerald-600',
  amber:   'bg-amber-100   text-amber-600',
  rose:    'bg-rose-100    text-rose-600',
  cyan:    'bg-cyan-100    text-cyan-600',
  fuchsia: 'bg-fuchsia-100 text-fuchsia-600',
  slate:   'bg-slate-100   text-slate-600',
};

export default function SectionCard({
  title,
  subtitle,
  icon: Icon,
  accent = 'indigo',
  actions,
  children,
  padding = 'p-6',
  className = '',
  noBodyPad = false,
  loading = false,
}) {
  const accentCls = ACCENT_BG[accent] || ACCENT_BG.indigo;

  return (
    <div className={`bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden ${className}`}>
      {(title || actions) && (
        <div className={`flex items-center justify-between gap-3 ${noBodyPad ? 'p-5' : 'px-6 pt-5 pb-3'} ${children ? 'border-b border-gray-100' : ''}`}>
          <div className="flex items-center gap-2.5 min-w-0">
            {Icon && (
              <div className={`p-1.5 rounded-lg ${accentCls}`}>
                <Icon size={16} strokeWidth={2.5} />
              </div>
            )}
            <div className="min-w-0">
              {title && <h3 className="text-base font-black text-gray-800 truncate">{title}</h3>}
              {subtitle && <p className="text-xs text-gray-400 font-bold mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </div>
      )}

      {children && (
        <div className={noBodyPad ? '' : padding}>
          {loading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-3/4" />
              <div className="h-4 bg-gray-100 rounded w-1/2" />
              <div className="h-4 bg-gray-100 rounded w-2/3" />
            </div>
          ) : children}
        </div>
      )}
    </div>
  );
}
