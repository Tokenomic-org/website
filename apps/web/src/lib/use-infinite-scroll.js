import { useEffect, useRef } from 'react';

/**
 * Attach an IntersectionObserver to a sentinel ref; invoke `onLoadMore` when
 * it scrolls into view. Disabled when `enabled` is false (e.g. no more pages).
 */
export function useInfiniteScroll(onLoadMore, { enabled = true, rootMargin = '600px' } = {}) {
  const ref = useRef(null);
  useEffect(() => {
    if (!enabled || !ref.current || typeof IntersectionObserver === 'undefined') return;
    const el = ref.current;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) onLoadMore();
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, onLoadMore, rootMargin]);
  return ref;
}
