// An inline message: errors are alerts (announced at once), the rest status.
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error';
  children: ReactNode;
}) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-md px-3 py-2 text-sm',
        tone === 'error' ? 'bg-danger/10 text-danger' : 'bg-muted',
      )}
    >
      {children}
    </p>
  );
}
