// Side panels on shadcn/ui's Sheet (ADR 0033, design rule 1, the canvas's
// .mm-panel): for creating or editing from a list, up to about eight fields.
// A 440 px panel sliding in from the right on desktops, a drawer 92% tall
// sliding up from the bottom on phones. The footer stays in view: Cancel · Save on the right,
// and Delete at its left.
import type { ComponentProps, ReactNode } from 'react';
import { useWide } from '../../lib/use-wide';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { CloseX, DrawerHandle } from './dialog';
import { Sheet as ShadSheet, SheetContent, SheetDescription, SheetTitle } from './shadcn/sheet';

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** A SheetBody and a SheetFooter, often inside a SheetForm. */
  children: ReactNode;
}) {
  const wide = useWide();
  return (
    <ShadSheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        {...(description ? {} : { 'aria-describedby': undefined })}
        side={wide ? 'right' : 'bottom'}
        showCloseButton={false}
        className={cn(
          'gap-0 border-border',
          wide
            ? 'h-dvh w-[440px] max-w-[90%] sm:max-w-[90%]'
            : 'h-[92dvh] rounded-t-[10px] shadow-none',
        )}
      >
        <DrawerHandle />
        <div className="flex shrink-0 flex-col gap-0.5 px-4 pt-3 pb-2 text-center md:gap-1.5 md:py-4 md:pr-12 md:pl-4 md:text-left">
          <SheetTitle className="text-base leading-6 font-semibold">{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </div>
        {children}
        <CloseX className="top-3 right-3 hidden size-7 items-center justify-center md:inline-flex" />
      </SheetContent>
    </ShadSheet>
  );
}

/** A form that holds the panel's body and footer, so Save submits it. */
export function SheetForm({ className, ...props }: ComponentProps<'form'>) {
  return <form noValidate className={cn('flex min-h-0 flex-1 flex-col', className)} {...props} />;
}

/** The fields, scrolling between the title and the footer. */
export function SheetBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-2 pb-4 md:pt-1',
        className,
      )}
      {...props}
    />
  );
}

/** Delete at the left, then Cancel · Save. */
export function SheetFooter({ start, children }: { start?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-3">
      {start}
      <span className="flex-1" />
      <div className="flex gap-2 [&>*]:max-md:flex-1">{children}</div>
    </div>
  );
}

/** Delete in a panel's footer: red words, no box. */
export function SheetDelete({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="lg"
      className={cn('-ml-2 px-2 text-danger hover:bg-danger-soft hover:text-danger', className)}
      {...props}
    />
  );
}
