import { useEffect, useState } from 'react';

export function t(key, fallback) {
  if (typeof window !== 'undefined' && window.TKNI18n && typeof window.TKNI18n.t === 'function') {
    return window.TKNI18n.t(key, fallback);
  }
  return fallback != null ? fallback : key;
}

export function tf(key, fallback, vars) {
  let s = t(key, fallback);
  if (vars && typeof s === 'string') {
    for (const k in vars) {
      s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]));
    }
  }
  return s;
}

export function useLocale() {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.TKNI18n || !window.TKNI18n.onChange) return;
    return window.TKNI18n.onChange(() => setTick((n) => n + 1));
  }, []);
}
