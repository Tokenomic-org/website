import { useCallback, useEffect, useState, useRef } from 'react';

/**
 * Two-way bind a JSON-serializable filter object to the URL's `?...` query
 * string using `replaceState` so back-button history isn't polluted.
 *
 * Only keys present in `defaults` are read or written; values equal to the
 * default are removed from the URL.
 */
export function useUrlState(defaults) {
  const [state, setState] = useState(() => readFromUrl(defaults));
  const def = useRef(defaults);
  def.current = defaults;

  useEffect(() => {
    const onPop = () => setState(readFromUrl(def.current));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const update = useCallback((patch) => {
    setState((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
      writeToUrl(next, def.current);
      return next;
    });
  }, []);

  return [state, update];
}

function readFromUrl(defaults) {
  const out = { ...defaults };
  if (typeof window === 'undefined') return out;
  const sp = new URLSearchParams(window.location.search);
  for (const k of Object.keys(defaults)) {
    if (sp.has(k)) {
      const v = sp.get(k);
      const dv = defaults[k];
      if (typeof dv === 'number') out[k] = Number.isFinite(+v) ? +v : dv;
      else if (typeof dv === 'boolean') out[k] = v === '1' || v === 'true';
      else out[k] = v;
    }
  }
  return out;
}

function writeToUrl(state, defaults) {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams(window.location.search);
  for (const k of Object.keys(defaults)) {
    const dv = defaults[k];
    const v  = state[k];
    const isDefault = (dv ?? '') === (v ?? '') || (typeof dv === 'boolean' && !!v === !!dv);
    if (isDefault || v === '' || v == null) sp.delete(k);
    else sp.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  const qs = sp.toString();
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
  window.history.replaceState(null, '', url);
}
