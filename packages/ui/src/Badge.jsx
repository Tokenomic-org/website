import React from 'react';
import { cn } from './cn.js';

const VARIANTS = {
  default: 'bg-surface2 text-fg border-border',
  brand:   'bg-brand/15 text-brand border-brand/30',
  accent:  'bg-accent/15 text-accent border-accent/30',
  success: 'bg-success/15 text-success border-success/30',
  danger:  'bg-danger/15 text-danger border-danger/30',
  outline: 'bg-transparent text-muted border-border',
};

export function Badge({ variant = 'default', children, className, ...rest }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold uppercase tracking-wide',
        VARIANTS[variant] || VARIANTS.default,
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
