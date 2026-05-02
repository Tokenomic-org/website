import React, { useEffect, useRef } from 'react';
import { cn } from './cn.js';

export function Dialog({ open, onOpenChange, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onOpenChange?.(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === ref.current) onOpenChange?.(false); }}
    >
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" aria-hidden />
      {children}
    </div>
  );
}

export function DialogContent({ className, children, ...rest }) {
  return (
    <div
      className={cn(
        'relative z-10 w-full max-w-lg rounded-xl bg-surface border border-border shadow-card',
        'p-6 animate-fade-in',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function DialogHeader({ children }) { return <div className="mb-4">{children}</div>; }
export function DialogTitle({ children }) { return <h2 className="text-xl font-semibold text-fg">{children}</h2>; }
export function DialogDescription({ children }) { return <p className="text-sm text-muted mt-1">{children}</p>; }
export function DialogFooter({ children }) { return <div className="mt-6 flex items-center justify-end gap-2">{children}</div>; }
