import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

// Per-color tokens used by StatCard. Each color produces a vibrant gradient
// surface (top→bottom) plus a complementary glow shadow. Idle/hover states
// share the same gradient; hover lifts the card and intensifies the glow.
const COLOR_TOKENS = {
  primary:  { from: '#6366F1', to: '#4F46E5', glow: 'rgba(79, 70, 229, 0.35)' },
  blue:     { from: '#3B82F6', to: '#2563EB', glow: 'rgba(59, 130, 246, 0.3)' },
  cyan:     { from: '#06B6D4', to: '#0891B2', glow: 'rgba(6, 182, 212, 0.3)' },
  purple:   { from: '#A855F7', to: '#7C3AED', glow: 'rgba(168, 85, 247, 0.3)' },
  pink:     { from: '#EC4899', to: '#DB2777', glow: 'rgba(236, 72, 153, 0.3)' },
  rose:     { from: '#F43F5E', to: '#E11D48', glow: 'rgba(244, 63, 94, 0.3)' },
  orange:   { from: '#F97316', to: '#EA580C', glow: 'rgba(249, 115, 22, 0.3)' },
  amber:    { from: '#F59E0B', to: '#D97706', glow: 'rgba(245, 158, 11, 0.3)' },
  green:    { from: '#22C55E', to: '#16A34A', glow: 'rgba(34, 197, 94, 0.3)' },
  emerald:  { from: '#10B981', to: '#059669', glow: 'rgba(16, 185, 129, 0.3)' },
  teal:     { from: '#14B8A6', to: '#0D9488', glow: 'rgba(20, 184, 166, 0.3)' },
  slate:    { from: '#475569', to: '#334155', glow: 'rgba(71, 85, 105, 0.3)' },
  // Aliases for old API
  accent:   { from: '#F59E0B', to: '#D97706', glow: 'rgba(245, 158, 11, 0.3)' },
  success:  { from: '#10B981', to: '#059669', glow: 'rgba(16, 185, 129, 0.3)' },
  warning:  { from: '#F59E0B', to: '#D97706', glow: 'rgba(245, 158, 11, 0.3)' },
  danger:   { from: '#EF4444', to: '#DC2626', glow: 'rgba(239, 68, 68, 0.3)' },
  gray:     { from: '#64748B', to: '#475569', glow: 'rgba(100, 116, 139, 0.25)' },
};

export default function StatCard({
  label,
  value,
  icon: Icon,
  color = 'primary',
  variant = 'soft',     // 'soft' = white card with colored accent ; 'gradient' = full color
  subtitle,
  to,
  onClick,
  loading,
}) {
  const tok = COLOR_TOKENS[color] || COLOR_TOKENS.primary;
  const clickable = Boolean(to || onClick);

  // ── GRADIENT VARIANT (vibrant hero card) ─────────────────────────────────
  if (variant === 'gradient') {
    const cardStyle = {
      background: `linear-gradient(160deg, ${tok.from} 0%, ${tok.to} 100%)`,
      boxShadow: `
        inset 0 1px 0 0 rgba(255,255,255,0.25),
        inset 0 -1px 0 0 rgba(0,0,0,0.1),
        0 8px 24px -6px ${tok.glow},
        0 4px 8px -2px rgba(15, 23, 42, 0.08)
      `,
      border: '1px solid rgba(255,255,255,0.15)',
    };

    const inner = (
      <>
        {/* Decorative blobs for depth */}
        <div
          className="absolute -top-8 -end-8 w-32 h-32 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.18) 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-10 -start-6 w-28 h-28 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%)' }}
        />

        {/* Icon */}
        {Icon && (
          <div
            className="relative z-10 inline-flex items-center justify-center h-11 w-11 rounded-xl flex-shrink-0"
            style={{
              background: 'rgba(255,255,255,0.18)',
              backdropFilter: 'blur(8px)',
              boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.25)',
              border: '1px solid rgba(255,255,255,0.2)',
            }}
          >
            <Icon className="w-5 h-5 text-white" strokeWidth={2.4} />
          </div>
        )}

        {/* Text */}
        <div className="relative z-10 flex-1 min-w-0">
          {loading ? (
            <div className="h-7 w-16 bg-white/30 animate-pulse rounded mb-1" />
          ) : (
            <p className="text-3xl font-black text-white leading-none tracking-tight drop-shadow-sm">
              {value ?? '—'}
            </p>
          )}
          <p className="text-xs text-white/80 mt-1.5 font-bold truncate">{label}</p>
          {subtitle && <p className="text-[11px] text-white/60 mt-0.5 truncate">{subtitle}</p>}
        </div>

        {/* Chevron */}
        {clickable && (
          <div className="relative z-10 flex-shrink-0">
            <ChevronLeft className="w-4 h-4 text-white/60 rtl:flip" />
          </div>
        )}
      </>
    );

    const baseCls = `relative overflow-hidden rounded-2xl flex items-center gap-3 px-4 py-4 select-none
                     transition-all duration-200`;
    const hoverCls = clickable ? 'cursor-pointer hover:-translate-y-1 active:scale-[0.98]' : '';

    if (to)      return <Link to={to} className={`${baseCls} ${hoverCls}`} style={cardStyle}>{inner}</Link>;
    if (onClick) return <button type="button" onClick={onClick} className={`${baseCls} ${hoverCls}`} style={cardStyle}>{inner}</button>;
    return <div className={baseCls} style={cardStyle}>{inner}</div>;
  }

  // ── SOFT VARIANT (white card with colored accent) ────────────────────────
  const inner = (
    <>
      {Icon && (
        <div
          className="inline-flex items-center justify-center h-11 w-11 rounded-xl flex-shrink-0 transition-all"
          style={{
            background: `linear-gradient(160deg, ${tok.from} 0%, ${tok.to} 100%)`,
            boxShadow: `inset 0 1px 0 0 rgba(255,255,255,0.25), 0 4px 12px -2px ${tok.glow}`,
          }}
        >
          <Icon className="w-5 h-5 text-white" strokeWidth={2.4} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-text-secondary text-xs font-bold uppercase tracking-wider">{label}</p>
        {loading ? (
          <div className="h-7 w-16 bg-slate-100 animate-pulse rounded mt-1" />
        ) : (
          <p className="text-2xl font-black text-text-primary leading-tight tracking-tight mt-0.5">
            {value ?? <span className="text-border text-lg">—</span>}
          </p>
        )}
        {subtitle && <p className="text-xs text-text-secondary mt-0.5 font-medium">{subtitle}</p>}
      </div>
      {clickable && (
        <ChevronLeft
          size={16}
          className="text-text-muted group-hover:text-primary transition-colors flex-shrink-0 rtl:flip"
        />
      )}
    </>
  );

  const baseCls = 'card flex items-center gap-4';
  const hoverCls = clickable ? 'group cursor-pointer card-hover text-start w-full' : '';

  if (to)      return <Link to={to} className={`${baseCls} ${hoverCls}`}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={`${baseCls} ${hoverCls}`}>{inner}</button>;
  return <div className={baseCls}>{inner}</div>;
}
