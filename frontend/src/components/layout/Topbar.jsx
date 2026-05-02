import { Menu, Globe, Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';

// Deterministic gradient picker — same user always gets the same avatar color.
// 8 carefully picked gradient pairs that look good on white, accessible contrast for white text.
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
  admin: 'Admin',
  leader: 'Leader',
  agent: 'Agent',
  enrollment: 'Enrollment',
  enrollment_leader: 'Enrollment Lead',
};

export default function Topbar({ onMenuClick }) {
  const { i18n } = useTranslation();
  const { user, changeLanguage } = useAuth();
  const isAr = i18n.language === 'ar';
  const initial = user?.full_name?.[0]?.toUpperCase() || '?';
  const gradient = gradientFor(user?.full_name);

  return (
    <header className="h-16 bg-card border-b border-border flex items-center justify-between px-4 md:px-6 gap-3 sticky top-0 z-30">
      {/* Left: hamburger (mobile) */}
      <button
        onClick={onMenuClick}
        className="lg:hidden btn-icon-ghost"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right cluster */}
      <div className="flex items-center gap-1.5">
        {/* Notifications (placeholder for future) */}
        <button
          type="button"
          className="btn-icon-ghost relative"
          title={isAr ? 'الإشعارات' : 'Notifications'}
        >
          <Bell size={18} />
        </button>

        {/* Language toggle */}
        <button
          onClick={() => changeLanguage(isAr ? 'en' : 'ar')}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold text-text-secondary
                     hover:bg-card-muted hover:text-text-primary transition-all"
          title={isAr ? 'Switch to English' : 'التبديل إلى العربية'}
        >
          <Globe size={16} />
          <span>{isAr ? 'EN' : 'عربي'}</span>
        </button>

        <div className="divider-vertical mx-1.5" />

        {/* User block */}
        <div className="flex items-center gap-3 pe-1">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <p className="text-sm font-semibold text-text-primary">{user?.full_name}</p>
            <p className="text-xs text-text-muted">
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
