import React, { createContext, useContext } from 'react';
import { cn } from './cn.js';

const TabsCtx = createContext(null);

export function Tabs({ value, onValueChange, children, className }) {
  return (
    <TabsCtx.Provider value={{ value, set: onValueChange }}>
      <div className={cn('w-full', className)}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({ children, className }) {
  return (
    <div
      role="tablist"
      className={cn('inline-flex items-center gap-1 p-1 rounded-lg bg-surface2 border border-border', className)}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children, className }) {
  const ctx = useContext(TabsCtx);
  const active = ctx?.value === value;
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={() => ctx?.set?.(value)}
      className={cn(
        'px-4 h-9 rounded-md text-sm font-semibold transition-colors',
        active ? 'bg-brand text-brand-fg shadow-sm' : 'text-muted hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className }) {
  const ctx = useContext(TabsCtx);
  if (ctx?.value !== value) return null;
  return <div className={cn('pt-6 animate-fade-in', className)}>{children}</div>;
}
