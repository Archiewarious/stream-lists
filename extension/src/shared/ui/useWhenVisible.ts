import { useEffect, useRef } from 'react';

/**
 * Calls `onVisible` once the element comes within `margin` of its scroll area's view — and again whenever `key`
 * changes while it is there (a page loaded, and the end of the list is still in view). Off while `enabled` is false.
 */
export const useWhenVisible = <T extends Element>(onVisible: () => void, { key, enabled = true, margin = '200px' }: { key?: unknown; enabled?: boolean; margin?: string } = {}) => {
  const ref = useRef<T>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;
    // The panel scrolls inside Mantine's ScrollArea; elsewhere (modals, dropdowns) the page itself is the view.
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && callback.current(), {
      root: node.closest('.mantine-ScrollArea-viewport'),
      rootMargin: margin,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [key, enabled, margin]);

  return ref;
};
