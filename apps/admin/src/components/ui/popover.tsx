// Popovers on shadcn/ui's Popover (components/ui/shadcn), so they fade and
// zoom in from their trigger (ADR 0033). `Popover` keeps the Radix names the
// admin used (Popover.Root, Popover.Content…). Its Content brings its own
// portal, so Popover.Portal only passes its children through, and it starts
// with no width or padding of its own: each popover sets them.
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { PopoverAnchor, PopoverContent, PopoverTrigger, Popover as Root } from './shadcn/popover';

function Content({ className, ...props }: ComponentProps<typeof PopoverContent>) {
  return <PopoverContent className={cn('w-auto p-0', className)} {...props} />;
}

export const Popover = {
  Root,
  Trigger: PopoverTrigger,
  Anchor: PopoverAnchor,
  Portal: ({ children }: { children: ReactNode }) => children,
  Content,
};
