// Text inputs (shadcn/ui, ADR 0033): 36 px and 14 px text on desktops, 40 px
// and 16 px text on phones, so focusing one doesn't zoom the page.
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/** The same look for native selects and textareas. */
export const control =
  'w-full rounded-lg border border-input bg-background px-3 text-base shadow-xs placeholder:text-muted-foreground aria-invalid:border-danger disabled:opacity-50 md:text-sm dark:bg-white/5';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control, 'min-h-10 md:min-h-9', className)} {...props} />;
}
