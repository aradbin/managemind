// True from the md breakpoint, where lists are tables and the sidebar shows.
import { useSyncExternalStore } from 'react';

const WIDE = '(min-width: 48rem)';

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(WIDE).matches : true,
    () => true,
  );
}
