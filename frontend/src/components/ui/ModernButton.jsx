/**
 * ModernButton — branded gradient/glass button used across redesigned pages.
 *
 * Props:
 *   variant   — 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'amber'
 *   size      — 'sm' | 'md' | 'lg'
 *   icon      — Lucide icon component (rendered before label)
 *   loading   — show spinner instead of icon
 *   children  — label
 *   ...rest   — passed to <button>
 */
const VARIANTS = {
  primary:   'bg-[#1e3a5f] hover:bg-[#2c4a7a] text-white shadow-lg shadow-[#1e3a5f]/30',
  secondary: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50',
  ghost:     'bg-gray-50 hover:bg-gray-100 text-gray-700',
  danger:    'bg-rose-500 hover:bg-rose-600 text-white shadow-lg shadow-rose-500/30',
  success:   'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/30',
  amber:     'bg-amber-500 hover:bg-amber-400 text-white shadow-lg shadow-amber-500/40',
  glass:     'bg-white/10 hover:bg-white/20 text-white border border-white/30',
};

const SIZES = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-5 py-3 text-base',
};

export default function ModernButton({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  const variantCls = VARIANTS[variant] || VARIANTS.primary;
  const sizeCls = SIZES[size] || SIZES.md;
  const iconSize = size === 'sm' ? 13 : size === 'lg' ? 18 : 16;

  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-black transition-all
                  hover:-translate-y-0.5 active:translate-y-0
                  disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0
                  ${variantCls} ${sizeCls} ${className}`}
      {...rest}
    >
      {loading ? (
        <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-r-transparent animate-spin" />
      ) : (
        Icon && <Icon size={iconSize} strokeWidth={2.4} />
      )}
      {children}
    </button>
  );
}
