import React from 'react';
import { cn } from './cn.js';

export function Card({ className, hover = false, children, ...rest }) {
  return (
    <div
      className={cn(
        'rounded-xl bg-surface border border-border shadow-card overflow-hidden',
        hover && 'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-glow hover:border-brand/40',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...rest }) {
  return <div className={cn('p-5 pb-3', className)} {...rest}>{children}</div>;
}
export function CardTitle({ className, children, ...rest }) {
  return <h3 className={cn('text-lg font-semibold text-fg leading-tight', className)} {...rest}>{children}</h3>;
}
export function CardDescription({ className, children, ...rest }) {
  return <p className={cn('text-sm text-muted mt-1 leading-relaxed', className)} {...rest}>{children}</p>;
}
export function CardContent({ className, children, ...rest }) {
  return <div className={cn('p-5 pt-2', className)} {...rest}>{children}</div>;
}
export function CardFooter({ className, children, ...rest }) {
  return <div className={cn('px-5 py-4 border-t border-border bg-surface2/40 flex items-center justify-between', className)} {...rest}>{children}</div>;
}
