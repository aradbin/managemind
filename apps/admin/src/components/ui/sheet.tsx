// Side panels on Radix Dialog (ADR 0033, design rule 1): for creating or
// editing from a list, up to about eight fields. A panel from the right on
// desktops, a drawer 92% tall from the bottom on phones. The footer stays in
// view: Cancel · Save on the right, and on desktops Delete at its left.
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useLocale } from '../../i18n';
import { cn } from '../../lib/utils';
import { Button } from './button';

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
  description?: string | undefined;
  /** A SheetBody and a SheetFooter, often inside a SheetForm. */
  children: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <RadixDialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className="fixed inset-x-0 bottom-0 z-50 flex h-[92dvh] flex-col rounded-t-xl border border-border bg-background shadow-lg md:inset-y-0 md:right-0 md:left-auto md:h-dvh md:w-full md:max-w-md md:rounded-none md:border-y-0 md:border-r-0"
        >
          <span
            aria-hidden
            className="mx-auto mt-2 h-1.5 w-24 shrink-0 rounded-full bg-muted md:hidden"
          />
          <div className="flex shrink-0 items-start gap-2 px-4 pt-3 pb-2 md:px-4 md:pt-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-center md:text-left">
              <RadixDialog.Title className="font-semibold">{title}</RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="text-sm text-muted-foreground">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-mt-1 -mr-1 hidden md:inline-flex"
                aria-label={t('action.close')}
              >
                <X aria-hidden />
              </Button>
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
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
      className={cn('flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-2', className)}
      {...props}
    />
  );
}

/** Cancel · Save on the right; `start` (Delete) at the left on desktops. */
export function SheetFooter({ start, children }: { start?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-border p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:flex-row md:items-center md:pb-4">
      {start && <div className="order-last md:order-first md:mr-auto">{start}</div>}
      <div className="grid grid-cols-[1fr_2fr] gap-2 md:ml-auto md:flex">{children}</div>
    </div>
  );
}

/** Delete in a panel's footer: red words, no box. */
export function SheetDelete({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="lg"
      className={cn('w-full text-danger hover:bg-danger-soft md:-ml-2 md:w-auto', className)}
      {...props}
    />
  );
}
