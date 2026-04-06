import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { setAccessToken, clearAccessToken } from '../api/axios';
import i18n from '../i18n';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount using refresh cookie
  useEffect(() => {
    api.post('/auth/refresh')
      .then(({ data }) => {
        setAccessToken(data.accessToken);
        return api.get('/auth/me');
      })
      .then(({ data }) => {
        setUser(data);
        // Apply user's language preference
        if (data.language) {
          i18n.changeLanguage(data.language);
          localStorage.setItem('lang', data.language);
          document.documentElement.dir = data.language === 'ar' ? 'rtl' : 'ltr';
          document.documentElement.lang = data.language;
        }
      })
      .catch(() => { /* no session, stay logged out */ })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    // Apply language
    const lang = data.user.language || 'ar';
    i18n.changeLanguage(lang);
    localStorage.setItem('lang', lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch (_) {}
    clearAccessToken();
    setUser(null);
  }, []);

  const changeLanguage = useCallback(async (lang) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('lang', lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    try { await api.put('/auth/me', { language: lang }); } catch (_) {}
    setUser(prev => prev ? { ...prev, language: lang } : prev);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, changeLanguage, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
