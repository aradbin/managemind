// An inline message as the canvas draws it (ADR 0033 and 0034): a grey note
// for information (.mm-note), an amber banner for a warning (.mm-banner), a
// red outlined alert for problems (.mm-alert-bad), each with its icon.
// Errors are alerts (announced at once), the rest status.
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export function Notice({
  tone = 'info',
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'error';
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === 'error' ? CircleAlert : tone === 'warning' ? TriangleAlert : Info;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-[10px] px-3.5 py-3 text-[13px] leading-[18px]',
        tone === 'error' &&
          'border border-[color-mix(in_oklch,var(--tone-danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--tone-danger)_5%,transparent)] text-danger',
        tone === 'warning' &&
          'border border-[color-mix(in_oklch,var(--tone-warn)_35%,transparent)] bg-[color-mix(in_oklch,var(--tone-warn)_7%,transparent)]',
        tone === 'info' && 'bg-muted',
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          'mt-px size-4 shrink-0',
          tone === 'info' && 'text-muted-foreground',
          tone === 'warning' && 'text-warning-foreground',
        )}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
