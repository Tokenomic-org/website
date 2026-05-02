import React, { useCallback, useEffect, useState } from 'react';
import { cn } from './cn.js';

const KEY = 'tkn-theme';
const LIGHT = 'light';
const DARK = 'dark';

/** Synchronously read + apply the persisted theme. Designed to also be called
 *  from a tiny inline `<script>` in the page <head> to prevent FOUC. */
export function initDarkMode() {
  if (typeof document === 'undefined') return DARK;
  let theme = DARK;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === LIGHT || stored === DARK) theme = stored;
  } catch {}
  applyTheme(theme);
  return theme;
}

function applyTheme(theme) {
  const cl = document.documentElement.classList;
  if (theme === LIGHT) { cl.add('theme-light'); cl.remove('dark'); }
  else { cl.remove('theme-light'); cl.add('dark'); }
}

export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme); } catch {}
  applyTheme(theme);
  try { window.dispatchEvent(new CustomEvent('tkn-theme', { detail: theme })); } catch {}
}

export function useDarkMode() {
  const [theme, setT] = useState(() => initDarkMode());
  useEffect(() => {
    const onChange = (e) => setT(e.detail);
    window.addEventListener('tkn-theme', onChange);
    return () => window.removeEventListener('tkn-theme', onChange);
  }, []);
  const toggle = useCallback(() => setTheme(theme === DARK ? LIGHT : DARK), [theme]);
  return { theme, isDark: theme === DARK, toggle, set: setTheme };
}

export function DarkModeToggle({ className }) {
  const { isDark, toggle } = useDarkMode();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn(
        'inline-flex items-center justify-center w-9 h-9 rounded-full border border-border bg-surface2 text-fg hover:bg-surface transition-colors',
        className,
      )}
    >
      {isDark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
