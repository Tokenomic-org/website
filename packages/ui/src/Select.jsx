import React from 'react';
import { cn } from './cn.js';

export function Select({ value, onChange, options = [], className, ariaLabel, ...rest }) {
  return (
    <div className={cn('relative inline-flex', className)}>
      <select
        value={value}
        onChange={(e) => onChange && onChange(e.target.value)}
        aria-label={ariaLabel}
        className={cn(
          'appearance-none h-10 pl-3 pr-9 rounded-lg bg-surface2 text-fg text-sm',
          'border border-border focus:border-brand focus:ring-2 focus:ring-brand/30 focus:outline-none',
          'cursor-pointer',
        )}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
    </div>
  );
}
