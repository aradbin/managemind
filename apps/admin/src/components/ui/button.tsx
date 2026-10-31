// Buttons (shadcn/ui on Radix Slot, ADR 0033): 32 px in headers and toolbars
// on desktops, 36 px on phones and with `size="lg"` (panel and dialog
// footers), 8 px corners.
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Hover lightens the near-black fill, so the text keeps its contrast.
        primary: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover',
        secondary:
          'border border-input bg-background shadow-xs hover:bg-muted dark:bg-white/5 dark:hover:bg-muted',
        ghost: 'hover:bg-muted',
        danger: 'bg-danger text-danger-foreground shadow-xs hover:bg-danger-hover',
        /** A red word for destructive actions that sit beside others. */
        quiet:
          'border border-input bg-background text-danger shadow-xs hover:bg-danger-soft dark:bg-white/5',
      },
      size: {
        default: 'min-h-9 px-3 md:min-h-8',
        lg: 'min-h-9 px-4',
        icon: 'size-9 md:size-8',
      },
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
