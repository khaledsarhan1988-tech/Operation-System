/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary:         '#1E3A5F',
        'primary-light': '#2D5F8A',
        accent:          '#F5A623',
        'accent-light':  '#FDE9C0',
        success:         '#27AE60',
        warning:         '#E67E22',
        danger:          '#E74C3C',
        surface:         '#F8FAFC',
        card:            '#FFFFFF',
        border:          '#E2E8F0',
        sidebar:         '#1E3A5F',
        'sidebar-text':  '#CBD5E0',
        'sidebar-active':'#F5A623',
      },
      fontFamily: {
        sans: ['Inter', 'Cairo', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(0,0,0,0.1)',
        'card-hover': '0 4px 6px -1px rgba(0,0,0,0.1)',
      },
    },
  },
  plugins: [],
};
