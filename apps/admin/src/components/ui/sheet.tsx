// Side panels on Radix Dialog (ADR 0033, design rule 1, the canvas's
// .mm-panel): for creating or editing from a list, up to about eight fields.
// A 440 px panel from the right on desktops, a drawer 92% tall from the
// bottom on phones. The footer stays in view: Cancel · Save on the right,
// and Delete at its left.
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useLocale } from '../../i18n';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { DrawerHandle } from './dialog';

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
  const { t } = useLocale();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <RadixDialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className="fixed inset-x-0 bottom-0 z-50 flex h-[92dvh] flex-col rounded-t-[10px] border-t border-border bg-background md:inset-y-0 md:right-0 md:left-auto md:h-dvh md:w-[440px] md:max-w-[90%] md:rounded-none md:border-t-0 md:border-l md:shadow-lg"
        >
          <DrawerHandle />
          <div className="flex shrink-0 flex-col gap-0.5 px-4 pt-3 pb-2 text-center md:gap-1.5 md:py-4 md:pr-12 md:pl-4 md:text-left">
            <RadixDialog.Title className="text-base leading-6 font-semibold">
              {title}
            </RadixDialog.Title>
            {description && (
              <RadixDialog.Description className="text-sm text-muted-foreground">
                {description}
              </RadixDialog.Description>
            )}
          </div>
          {children}
          <RadixDialog.Close asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3 hidden size-7 opacity-70 hover:opacity-100 md:inline-flex md:size-7"
              aria-label={t('action.close')}
            >
              <X aria-hidden />
            </Button>
          </RadixDialog.Close>
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
