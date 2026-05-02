import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { cn } from './cn.js';

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const remove = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    const t = { id, variant: 'default', timeout: 4000, ...toast };
    setToasts((cur) => [...cur, t]);
    if (t.timeout > 0) setTimeout(() => remove(id), t.timeout);
    return id;
  }, [remove]);

  return (
    <ToastCtx.Provider value={{ push, remove }}>
      {children}
      <div className="fixed top-4 right-4 z-[1100] flex flex-col gap-2 pointer-events-none" aria-live="polite">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function Toast({ toast, onClose }) {
  const variants = {
    default: 'bg-surface border-border text-fg',
    success: 'bg-success/15 border-success/40 text-fg',
    error:   'bg-danger/15 border-danger/40 text-fg',
  };
  return (
    <div
      className={cn(
        'pointer-events-auto min-w-[280px] max-w-sm rounded-lg border px-4 py-3 shadow-card animate-fade-in',
        variants[toast.variant] || variants.default,
      )}
      role="status"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          {toast.title && <div className="font-semibold text-sm">{toast.title}</div>}
          {toast.description && <div className="text-sm text-muted mt-0.5">{toast.description}</div>}
        </div>
        <button onClick={onClose} className="text-muted hover:text-fg" aria-label="Dismiss">×</button>
      </div>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    // Fallback to console so islands without a provider still work.
    return {
      push: (t) => console.log('[toast]', t),
      remove: () => {},
    };
  }
  return ctx;
}
