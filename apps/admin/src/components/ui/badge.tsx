// Badges as the canvas draws them (ADR 0033 and 0034):
// - StatusBadge (.mm-sbadge): 22 px, 8 px corners, a soft tint of its tone
//   with text in the tone; colour is never the only signal, so it always
//   says its status in words;
// - Badge (.mm-badge): an outlined label in muted text;
// - SecondaryBadge (.mm-badge-sec): a small grey label, as in a filter
//   button's chosen values.
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export const tones = {
  waiting: 'bg-warning text-warning-foreground',
  progress: 'bg-info text-info-foreground',
  moving: 'bg-shipped text-shipped-foreground',
  good: 'bg-success-soft text-success-foreground',
  bad: 'bg-danger-soft text-danger',
  ended: 'bg-muted text-muted-foreground',
  /** Archived and similar: no fill, a hairline edge that takes no space. */
  outline: 'text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)]',
  /** Neutral words in the foreground colour, such as a 60% score. */
  plain: 'bg-muted text-foreground',
} as const;

export type Tone = keyof typeof tones;

export function StatusBadge({
  tone,
  className,
  ...props
}: ComponentProps<'span'> & { tone: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Badge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-border px-1.5 py-px text-xs leading-4 font-medium text-muted-foreground md:py-0.5',
        className,
      )}
      {...props}
    />
  );
}

export function SecondaryBadge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md bg-muted px-1.5 py-0.5 text-xs leading-4 font-medium text-foreground md:px-1 md:font-normal',
        className,
      )}
      {...props}
    />
  );
}
