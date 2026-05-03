import { Menu, Globe, Bell, Sun, Moon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { useTheme } from '../../hooks/useTheme';

const AVATAR_GRADIENTS = [
  'from-indigo-500 to-purple-600',
  'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-fuchsia-600',
  'from-sky-500 to-indigo-600',
  'from-teal-500 to-emerald-600',
];

function gradientFor(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

const ROLE_LABELS = {
  admin: 'Administrator',
  leader: 'Team Leader',
  agent: 'Agent',
  enrollment: 'Enrollment',
  enrollment_leader: 'Enrollment Lead',
};

export default function Topbar({ onMenuClick }) {
  const { i18n } = useTranslation();
  const { user, changeLanguage } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isAr = i18n.language === 'ar';
  const isDark = theme === 'dark';
  const initial = user?.full_name?.[0]?.toUpperCase() || '?';
  const gradient = gradientFor(user?.full_name);

  // Shared chip styling for the dark topbar — translucent surface that pops
  // against the deep gradient background.
  const chipStyle = {
    background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)',
    backdropFilter: 'blur(8px)',
    boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.08), 0 2px 6px -1px rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.08)',
  };

  return (
    <header
      className="h-16 flex items-center justify-between px-4 md:px-6 gap-3 sticky top-0 z-30 relative overflow-hidden"
      style={{
        background: 'linear-gradient(165deg, #0B1120 0%, #1E1B4B 55%, #1A0F2E 100%)',
        boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.05), 0 4px 16px -4px rgba(15, 23, 42, 0.4)',
      }}
    >
      {/* Decorative orbs to match the sidebar's atmosphere */}
      <div
        className="absolute top-0 right-1/4 w-64 h-32 rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #6366F1 0%, transparent 70%)' }}
      />
      <div
        className="absolute top-0 left-1/3 w-48 h-32 rounded-full opacity-15 blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, #A855F7 0%, transparent 70%)' }}
      />

      {/* Left: hamburger (mobile) */}
      <button
        onClick={onMenuClick}
        className="lg:hidden relative z-10 inline-flex items-center justify-center h-10 w-10 rounded-xl
                   text-slate-300 hover:text-white transition-all"
        style={chipStyle}
        aria-label="Open menu"
      >
        <Menu size={20} strokeWidth={2.2} />
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right cluster */}
      <div className="relative z-10 flex items-center gap-2">
        {/* Notifications */}
        <button
          type="button"
          className="relative inline-flex items-center justify-center h-10 w-10 rounded-xl text-slate-300
                     hover:text-white transition-all"
          style={chipStyle}
          title={isAr ? 'الإشعارات' : 'Notifications'}
        >
          <Bell size={18} strokeWidth={2.2} />
          <span
            className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500"
            style={{
              border: '2px solid #0F172A',
              boxShadow: '0 0 0 2px rgba(239, 68, 68, 0.3)',
            }}
          />
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="inline-flex items-center justify-center h-10 w-10 rounded-xl text-slate-300
                     hover:text-white transition-all"
          style={chipStyle}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun size={18} strokeWidth={2.2} /> : <Moon size={18} strokeWidth={2.2} />}
        </button>

        {/* Language toggle */}
        <button
          onClick={() => changeLanguage(isAr ? 'en' : 'ar')}
          className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl text-sm font-bold text-slate-300
                     hover:text-white transition-all"
          style={chipStyle}
          title={isAr ? 'Switch to English' : 'التبديل إلى العربية'}
        >
          <Globe size={16} strokeWidth={2.2} />
          <span>{isAr ? 'EN' : 'عربي'}</span>
        </button>

        {/* Vertical divider — light tint for the dark bg */}
        <div
          className="w-px h-6 mx-1"
          style={{ background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.15) 30%, rgba(255,255,255,0.15) 70%, transparent)' }}
        />

        {/* User block */}
        <div className="flex items-center gap-3 pe-1">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <p className="text-sm font-bold text-white tracking-tight">{user?.full_name}</p>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
              {ROLE_LABELS[user?.role] || user?.role}
            </p>
          </div>
          <div className={`avatar avatar-md bg-gradient-to-br ${gradient}`}>
            {initial}
          </div>
        </div>
      </div>
    </header>
  );
}
