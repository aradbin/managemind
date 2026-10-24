// Text inputs (shadcn/ui pattern), 44 px tall for touch (phase-1-plan §7.3).
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'min-h-11 w-full rounded-lg border border-input bg-background px-3 text-base aria-invalid:border-danger disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
