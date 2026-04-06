import { Menu, Globe, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';

export default function Topbar({ onMenuClick }) {
  const { t, i18n } = useTranslation();
  const { user, changeLanguage } = useAuth();
  const isAr = i18n.language === 'ar';

  return (
    <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 gap-3">
      {/* Left: hamburger (mobile) */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 hover:bg-surface rounded-lg transition-colors"
      >
        <Menu size={20} className="text-text-primary" />
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Language toggle */}
      <button
        onClick={() => changeLanguage(isAr ? 'en' : 'ar')}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-surface transition-colors text-sm text-text-secondary font-medium"
        title={isAr ? 'Switch to English' : 'التبديل إلى العربية'}
      >
        <Globe size={16} />
        {isAr ? 'EN' : 'عربي'}
      </button>

      {/* User avatar */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-sm font-bold">
          {user?.full_name?.[0]?.toUpperCase()}
        </div>
        <div className="hidden sm:block">
          <p className="text-sm font-medium text-text-primary leading-tight">{user?.full_name}</p>
          <p className="text-xs text-text-secondary capitalize">{user?.role}</p>
        </div>
      </div>
    </header>
  );
}
