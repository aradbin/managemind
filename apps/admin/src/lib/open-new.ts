// The Create menu opens a list page with `?new=1` (ADR 0034): the page opens
// its side panel for a new record once, and the address drops the flag, so
// Back and a reload don't open it again.
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

export function useOpenNew(open: () => void, ready = true): void {
  const asked = useRouterState({
    select: (s) => (s.location.search as { new?: unknown }).new === 1,
  });
  const navigate = useNavigate();
  useEffect(() => {
    if (!asked || !ready) return;
    open();
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, new: undefined }),
      replace: true,
    } as never);
  }, [asked, ready, open, navigate]);
}
