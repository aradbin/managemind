// A row of figures in one bordered strip (the canvas's .mm-statrow): four
// across on desktops, two by two on phones, each a small label over its
// value and, under it, an optional note ("+12% vs. before").
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface Stat {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  /** Red for a figure that needs looking at (low stock, overdue). */
  alert?: boolean;
}

export function StatRow({
  stats,
  size = 'md',
  className,
}: {
  stats: readonly Stat[];
  /** md: 18 px values (inventory); lg: 20 px (reports). */
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <dl
      className={cn(
        'm-0 grid grid-cols-2 overflow-hidden rounded-[12px] border border-border bg-card md:rounded-xl',
        stats.length >= 4 ? 'md:grid-cols-4' : stats.length === 3 ? 'md:grid-cols-3' : '',
        className,
      )}
    >
      {stats.map((s, i) => (
        <div
          key={s.label}
          className={cn(
            'flex flex-col gap-1 px-4 py-3 md:gap-1.5',
            size === 'lg' ? 'md:px-5 md:py-4' : 'md:px-[18px] md:py-3.5',
            i % 2 === 1 && 'border-l border-border',
            i >= 2 && 'max-md:border-t max-md:border-border',
            i > 0 && 'md:border-l md:border-border',
          )}
        >
          <dt className="text-xs font-medium text-muted-foreground">{s.label}</dt>
          <dd
            className={cn(
              'm-0 text-base leading-6 font-semibold tabular-nums',
              size === 'lg'
                ? 'md:text-xl md:leading-7 md:tracking-[-0.01em]'
                : 'md:text-lg md:leading-6',
              s.alert && 'text-danger',
            )}
          >
            {s.value}
            {s.note && (
              <small className="mt-0.5 block text-xs leading-4 font-medium">{s.note}</small>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
