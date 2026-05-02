import React from 'react';
import { cn } from './cn.js';

const VARIANTS = {
  primary:
    'bg-brand text-brand-fg hover:bg-brand/90 active:bg-brand/80 shadow-sm',
  secondary:
    'bg-surface2 text-fg border border-border hover:bg-surface',
  ghost:
    'bg-transparent text-fg hover:bg-surface2',
  outline:
    'bg-transparent text-fg border border-border hover:bg-surface2',
  danger:
    'bg-danger text-white hover:bg-danger/90',
  link:
    'bg-transparent text-brand underline-offset-4 hover:underline px-0 py-0',
};

const SIZES = {
  sm: 'h-8 px-3 text-xs rounded-md',
  md: 'h-10 px-4 text-sm rounded-lg',
  lg: 'h-12 px-6 text-base rounded-lg',
  icon: 'h-10 w-10 p-0 rounded-lg',
};

export const Button = React.forwardRef(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', loading = false, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none whitespace-nowrap',
        VARIANTS[variant] || VARIANTS.primary,
        SIZES[size] || SIZES.md,
        className,
      )}
      {...rest}
    >
      {loading && (
        <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden />
      )}
      {children}
    </button>
  );
});
