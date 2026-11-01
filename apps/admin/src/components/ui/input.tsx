// Text inputs (shadcn/ui, ADR 0033 and 0034, the canvas's .mm-input): 36 px
// and 14 px text on desktops, 40 px and 16 px text on phones, so focusing one
// doesn't zoom the page. Transparent, with a faint fill in the dark theme.
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/** The same look for native selects and textareas. */
export const control =
  'w-full rounded-lg border border-input bg-transparent px-3 text-base shadow-xs placeholder:text-muted-foreground aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-white/[0.045]';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control, 'h-10 py-1 md:h-9', className)} {...props} />;
}

/** Several lines of text, with the same look. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(control, 'min-h-22 resize-y py-2 leading-[22px] md:min-h-18', className)}
      {...props}
    />
  );
}
