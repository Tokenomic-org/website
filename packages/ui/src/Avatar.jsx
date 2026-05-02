import React, { useState } from 'react';
import { cn } from './cn.js';

const SIZES = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-20 h-20 text-lg',
};

export function Avatar({ src, alt, name, size = 'md', className }) {
  const [errored, setErrored] = useState(false);
  const initials = (name || '?')
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const useImage = !!src && !errored;
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-full font-bold overflow-hidden flex-shrink-0',
        'bg-brand text-brand-fg ring-2 ring-surface',
        SIZES[size] || SIZES.md,
        className,
      )}
      aria-label={alt || name}
    >
      {useImage ? (
        <img
          src={src}
          alt={alt || name || ''}
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
          loading="lazy"
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}
