import { useEffect, useState } from 'react';

// Built-in gradient palettes — pass `gradient="navy"` etc.
// Or pass `gradientCss` to override with any custom CSS gradient string.
const GRADIENTS = {
  navy:    'linear-gradient(135deg, #1e3a5f 0%, #2c4a7a 50%, #3b5fa0 100%)',
  violet:  'linear-gradient(135deg, #4c1d95 0%, #6d28d9 50%, #8b5cf6 100%)',
  emerald: 'linear-gradient(135deg, #064e3b 0%, #047857 50%, #10b981 100%)',
  rose:    'linear-gradient(135deg, #881337 0%, #be123c 50%, #f43f5e 100%)',
  amber:   'linear-gradient(135deg, #78350f 0%, #b45309 50%, #f59e0b 100%)',
  cyan:    'linear-gradient(135deg, #164e63 0%, #0e7490 50%, #06b6d4 100%)',
  slate:   'linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%)',
  fuchsia: 'linear-gradient(135deg, #701a75 0%, #a21caf 50%, #d946ef 100%)',
};

const ORB_COLORS = {
  navy:    ['#6366F1', '#A855F7'],
  violet:  ['#c084fc', '#ec4899'],
  emerald: ['#34d399', '#0ea5e9'],
  rose:    ['#fb7185', '#f97316'],
  amber:   ['#fbbf24', '#f97316'],
  cyan:    ['#22d3ee', '#3b82f6'],
  slate:   ['#94a3b8', '#cbd5e1'],
  fuchsia: ['#e879f9', '#f472b6'],
};

// Animated counter — reusable across pages
function useCounter(target, duration = 800) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf, start;
    const step = (ts) => {
      if (!start) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round((Number(target) || 0) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

export function HeroStatPill({ value, suffix = '', icon: Icon, label, animated = true, signed = false }) {
  const numVal = Number(value) || 0;
  const display = animated ? useCounter(Math.abs(numVal)) : Math.abs(numVal);
  const sign = signed && numVal !== 0 ? (numVal > 0 ? '+' : '−') : '';
  const tone = signed
    ? numVal > 0 ? 'text-emerald-200' : numVal < 0 ? 'text-rose-200' : 'text-white'
    : 'text-white';
  return (
    <div className="bg-white/10 backdrop-blur-md border border-white/15 rounded-2xl px-4 py-3 flex items-center gap-3">
      {Icon && (
        <div className="p-2 bg-white/15 rounded-xl">
          <Icon size={18} className="text-white" />
        </div>
      )}
      <div>
        <p className="text-[10px] text-white/70 font-bold uppercase tracking-wider">{label}</p>
        <p className={`text-2xl font-black leading-none mt-0.5 ${tone}`}>
          {sign}{display}<span className="text-sm font-bold opacity-80">{suffix}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * PageHero — modern gradient header for any page.
 *
 * Props:
 *   title       — main heading (required)
 *   subtitle    — small descriptor under the title
 *   icon        — Lucide icon component
 *   gradient    — palette key: navy | violet | emerald | rose | amber | cyan | slate | fuchsia
 *   gradientCss — full CSS gradient override (wins over `gradient`)
 *   actions     — JSX shown on the leading edge (buttons)
 *   stats       — array of { label, value, icon, suffix?, signed?, animated? } — renders as glass pills
 *   children    — anything extra under the stats row
 */
export default function PageHero({
  title,
  subtitle,
  icon: Icon,
  gradient = 'navy',
  gradientCss,
  actions,
  stats,
  children,
}) {
  const bg = gradientCss || GRADIENTS[gradient] || GRADIENTS.navy;
  const [orb1, orb2] = ORB_COLORS[gradient] || ORB_COLORS.navy;

  return (
    <div
      className="relative overflow-hidden rounded-3xl p-6 text-white"
      style={{
        background: bg,
        boxShadow: '0 20px 50px -12px rgba(15, 23, 42, 0.45)',
      }}
    >
      {/* Decorative orbs */}
      <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full opacity-20 blur-3xl pointer-events-none"
           style={{ background: `radial-gradient(circle, ${orb1} 0%, transparent 70%)` }} />
      <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full opacity-20 blur-3xl pointer-events-none"
           style={{ background: `radial-gradient(circle, ${orb2} 0%, transparent 70%)` }} />

      <div className="relative z-10">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
          <div className="flex items-center gap-3">
            {Icon && (
              <div className="p-3 bg-white/15 backdrop-blur rounded-2xl">
                <Icon size={26} />
              </div>
            )}
            <div>
              <h1 className="text-2xl font-black tracking-tight">{title}</h1>
              {subtitle && <p className="text-white/70 text-sm font-bold mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </div>

        {/* Optional stats row */}
        {stats && stats.length > 0 && (
          <div className={`grid gap-3 grid-cols-2 ${
            stats.length === 3 ? 'md:grid-cols-3'
            : stats.length === 4 ? 'md:grid-cols-4'
            : stats.length === 5 ? 'md:grid-cols-5'
            : stats.length >= 6 ? 'md:grid-cols-3 lg:grid-cols-6'
            : 'md:grid-cols-2'
          }`}>
            {stats.map((s, i) => (
              <HeroStatPill key={i} {...s} />
            ))}
          </div>
        )}

        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  );
}
