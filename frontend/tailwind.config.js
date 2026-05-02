/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Brand ──────────────────────────────────────────
        primary:         '#4F46E5',  // indigo-600 — modern, professional
        'primary-hover': '#4338CA',  // indigo-700
        'primary-soft':  '#EEF2FF',  // indigo-50 — for subtle highlights
        'primary-ring':  '#C7D2FE',  // indigo-200 — focus rings

        // ── Accent (highlights, badges) ────────────────────
        accent:          '#F59E0B',  // amber-500
        'accent-soft':   '#FEF3C7',  // amber-100

        // ── Semantic ───────────────────────────────────────
        success:         '#10B981',  // emerald-500
        'success-soft':  '#D1FAE5',  // emerald-100
        warning:         '#F59E0B',  // amber-500
        'warning-soft':  '#FEF3C7',  // amber-100
        danger:          '#EF4444',  // red-500
        'danger-soft':   '#FEE2E2',  // red-100
        info:            '#3B82F6',  // blue-500
        'info-soft':     '#DBEAFE',  // blue-100

        // ── Surfaces ───────────────────────────────────────
        surface:         '#F8FAFC',  // slate-50 — eye-friendly page bg
        card:            '#FFFFFF',
        'card-muted':    '#F8FAFC',  // hover/secondary card bg
        border:          '#E2E8F0',  // slate-200 — subtle
        'border-strong': '#CBD5E1',  // slate-300

        // ── Text ───────────────────────────────────────────
        'text-primary':   '#0F172A',  // slate-900
        'text-secondary': '#475569',  // slate-600
        'text-muted':     '#94A3B8',  // slate-400

        // ── Sidebar (deep, modern) ─────────────────────────
        sidebar:          '#0F172A',  // slate-900
        'sidebar-hover':  '#1E293B',  // slate-800
        'sidebar-active': '#312E81',  // indigo-900 (subtle indigo wash)
        'sidebar-text':   '#94A3B8',  // slate-400
        'sidebar-accent': '#818CF8',  // indigo-400 — active accent
      },
      fontFamily: {
        sans: ['Inter', 'Cairo', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // Refined depth — subtle, layered, inspired by Linear/Vercel
        xs:    '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
        sm:    '0 1px 3px 0 rgba(15, 23, 42, 0.06), 0 1px 2px -1px rgba(15, 23, 42, 0.04)',
        DEFAULT: '0 1px 3px 0 rgba(15, 23, 42, 0.06), 0 1px 2px -1px rgba(15, 23, 42, 0.04)',
        md:    '0 4px 6px -1px rgba(15, 23, 42, 0.06), 0 2px 4px -2px rgba(15, 23, 42, 0.04)',
        lg:    '0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.04)',
        xl:    '0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.04)',
        '2xl': '0 25px 50px -12px rgba(15, 23, 42, 0.18)',
        // Brand glow for primary buttons
        'glow-primary': '0 1px 3px 0 rgba(79, 70, 229, 0.2), 0 4px 12px -2px rgba(79, 70, 229, 0.15)',
        'glow-danger':  '0 1px 3px 0 rgba(239, 68, 68, 0.2), 0 4px 12px -2px rgba(239, 68, 68, 0.15)',
        'inner-soft':   'inset 0 1px 2px 0 rgba(15, 23, 42, 0.04)',
      },
      borderRadius: {
        DEFAULT: '0.5rem',
      },
      animation: {
        'fade-in':   'fadeIn 0.2s ease-out',
        'slide-up':  'slideUp 0.25s ease-out',
        'scale-in':  'scaleIn 0.18s ease-out',
      },
      keyframes: {
        fadeIn:  { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        scaleIn: { from: { opacity: 0, transform: 'scale(0.96)' }, to: { opacity: 1, transform: 'scale(1)' } },
      },
    },
  },
  plugins: [],
};
