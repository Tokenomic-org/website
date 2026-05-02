import React from 'react';
import { cn } from './cn.js';

export const Input = React.forwardRef(function Input(
  { className, leadingIcon, trailingIcon, ...rest },
  ref,
) {
  return (
    <div className={cn('relative flex items-center', className)}>
      {leadingIcon && (
        <span className="absolute left-3 text-muted pointer-events-none flex items-center" aria-hidden>
          {leadingIcon}
        </span>
      )}
      <input
        ref={ref}
        className={cn(
          'w-full h-10 rounded-lg bg-surface2 text-fg placeholder:text-muted/80',
          'border border-border focus:border-brand focus:ring-2 focus:ring-brand/30 focus:outline-none',
          'text-sm transition-colors',
          leadingIcon ? 'pl-10' : 'pl-3',
          trailingIcon ? 'pr-10' : 'pr-3',
        )}
        {...rest}
      />
      {trailingIcon && (
        <span className="absolute right-3 text-muted pointer-events-none flex items-center" aria-hidden>
          {trailingIcon}
        </span>
      )}
    </div>
  );
});
