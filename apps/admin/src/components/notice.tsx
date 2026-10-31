// An inline message (ADR 0033): a grey note for information, a red outlined
// alert for problems. Errors are alerts (announced at once), the rest status.
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
        'rounded-[10px] border px-3 py-2.5 text-sm',
        tone === 'error' ? 'border-danger/50 text-danger' : 'border-border bg-muted/60',
      )}
    >
      {children}
    </p>
  );
}
