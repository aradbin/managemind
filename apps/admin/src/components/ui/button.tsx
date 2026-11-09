// Buttons (shadcn/ui on Radix Slot, ADR 0033 and 0034, the canvas's .mm-btn):
// 32 px in headers and toolbars on desktops, 36 px on phones and with
// `size="lg"` (panel and dialog footers), 8 px corners.
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { type ComponentProps, lazy, Suspense } from 'react';
import { cn } from '../../lib/utils';

/** An icon button's tooltip, in its own chunk (components/ui/icon-tip.tsx). */
const IconTip = lazy(() => import('./icon-tip'));

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        /** shadcn/ui's outline button. */
        secondary:
          'border-border bg-background shadow-xs hover:bg-accent dark:border-input dark:bg-white/[0.045] dark:hover:bg-accent',
        ghost: 'hover:bg-accent',
        danger: 'bg-danger-fill text-danger-foreground shadow-xs hover:bg-danger-fill/90',
        /** A red word for destructive actions that sit beside others. */
        quiet:
          'border-border bg-background text-danger shadow-xs hover:bg-danger-soft dark:border-input dark:bg-white/[0.045]',
      },
      size: {
        /** 36 px on phones, 32 px on desktops. */
        default: 'h-9 px-4 has-[>svg]:px-3 md:h-8 md:px-3 md:has-[>svg]:px-3',
        /** 36 px: panel and dialog footers. */
        lg: 'h-9 px-4',
        icon: 'size-9 md:size-8',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a link) with button styles. */
  asChild?: boolean;
  /**
   * An icon button shows its name in shadcn/ui's tooltip on hover and focus
   * (its aria-label, else its title). False leaves it out.
   */
  tooltip?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild,
  type = 'button',
  tooltip = true,
  title,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  const tip = size === 'icon' && tooltip ? (props['aria-label'] ?? title) : undefined;
  const button = (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type })}
      // The tooltip replaces the browser's own, so it doesn't show twice.
      {...(tip ? {} : { title })}
      {...props}
    />
  );
  if (!tip) return button;
  return (
    <Suspense fallback={button}>
      <IconTip tip={String(tip)}>{button}</IconTip>
    </Suspense>
  );
}
