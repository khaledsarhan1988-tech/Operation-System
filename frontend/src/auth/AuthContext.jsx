import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import api, { setAccessToken, clearAccessToken } from '../api/axios';
import i18n from '../i18n';

// Plain axios instance for bootstrap refresh — bypasses the interceptor
// that could cause _isRefreshing deadlock on page load
const plainAxios = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
  withCredentials: true,
  timeout: 15000,
});

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount using refresh cookie
  // Use plainAxios (no interceptor) to avoid _isRefreshing deadlock
  useEffect(() => {
    plainAxios.post('/auth/refresh')
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

  // Refresh local user state from /auth/me — used after profile changes like avatar upload
  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data);
      return data;
    } catch (_) {
      return null;
    }
  }, []);

  // Patch a subset of user fields locally (faster than a full refetch)
  const patchUser = useCallback((patch) => {
    setUser(prev => prev ? { ...prev, ...patch } : prev);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, changeLanguage, refreshUser, patchUser, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
