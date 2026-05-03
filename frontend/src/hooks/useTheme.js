import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'theme';

function readInitialTheme() {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  // Fallback: prefer system preference
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

function applyTheme(t) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.style.colorScheme = t;
}

/**
 * useTheme — light/dark mode toggle backed by localStorage.
 *
 * The actual color shift is done in CSS via the `[data-theme="dark"]` selector
 * (see globals.css). This hook just toggles the attribute on <html>.
 */
export function useTheme() {
  const [theme, setTheme] = useState(readInitialTheme);

  // Apply on first mount (covers SSR / hot reload edge cases)
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(STORAGE_KEY, next); } catch (_) {}
      return next;
    });
  }, []);

  const setExplicit = useCallback((t) => {
    if (t !== 'light' && t !== 'dark') return;
    try { localStorage.setItem(STORAGE_KEY, t); } catch (_) {}
    setTheme(t);
  }, []);

  return { theme, toggleTheme, setTheme: setExplicit, isDark: theme === 'dark' };
}

// Run synchronously at module-eval time so the page never flashes the wrong theme
if (typeof document !== 'undefined') {
  applyTheme(readInitialTheme());
}
