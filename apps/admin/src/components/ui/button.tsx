// Buttons (shadcn/ui pattern on Radix Slot). Every size keeps a 44 px touch
// target (phase-1-plan §7.3).
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Hover darkens rather than fades, so the text keeps its contrast.
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary: 'border border-input bg-background hover:bg-muted',
        ghost: 'hover:bg-muted',
        danger: 'bg-danger text-danger-foreground hover:bg-danger-hover',
        /** A red word for destructive actions that sit beside others. */
        quiet: 'border border-input bg-background text-danger hover:bg-danger-soft',
      },
      size: { default: '', icon: 'min-w-11 px-0' },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a link) with button styles. */
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild,
  type = 'button',
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type })}
      {...props}
    />
  );
}
