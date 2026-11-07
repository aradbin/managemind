// Dialogs on Radix (focus trap, Escape, aria-modal) as the canvas draws them
// (ADR 0033 and 0034): a centred dialog from the md breakpoint (.mm-dialog:
// 512 px, 24 px padding, 10 px corners, a bare × at the top right), and a
// drawer from the bottom on phones (.mm-drawer: a handle, a centred title).
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocale } from '../../i18n';
import { cn } from '../../lib/utils';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Narrower dialogs, such as the confirmation's 460 px. */
  className?: string;
  /**
   * A confirmation (role alertdialog): centred on phones too, as the
   * canvas's .mm-alertbox, 460 px wide, its title 18 px over 1.3.
   */
  alert?: boolean;
  children: ReactNode;
}

/** The drawer's handle on phones. */
export function DrawerHandle() {
  return (
    <span
      aria-hidden
      className="mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full bg-muted md:hidden"
    />
  );
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  className,
  alert = false,
  children,
}: DialogProps) {
  const { t } = useLocale();
  if (alert)
    return (
      <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
          <RadixDialog.Content
            role="alertdialog"
            {...(description ? {} : { 'aria-describedby': undefined })}
            className={cn(
              'fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-[10px] border border-border bg-background p-6 shadow-lg',
              className,
            )}
          >
            <div className="flex flex-col gap-2">
              <RadixDialog.Title className="text-lg leading-[1.3] font-semibold">
                {title}
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="text-sm text-muted-foreground">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            {children}
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    );
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <RadixDialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-[10px] border-t border-border bg-background pb-[env(safe-area-inset-bottom)]',
            'md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[90dvh] md:w-[calc(100%-2rem)] md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:gap-4 md:rounded-[10px] md:border md:p-6 md:pb-6 md:shadow-lg',
            className,
          )}
        >
          <DrawerHandle />
          <div className="flex flex-col gap-0.5 px-4 pt-3 pb-2 text-center md:gap-2 md:p-0 md:pr-6 md:text-left">
            <RadixDialog.Title className="text-base leading-6 font-semibold md:text-lg md:leading-none">
              {title}
            </RadixDialog.Title>
            {description && (
              <RadixDialog.Description className="text-sm text-muted-foreground">
                {description}
              </RadixDialog.Description>
            )}
          </div>
          <div className="flex flex-col gap-4 px-4 pt-2 pb-6 md:contents">{children}</div>
          <RadixDialog.Close
            aria-label={t('action.close')}
            className="absolute top-4 right-4 hidden rounded-sm opacity-70 transition-opacity hover:opacity-100 md:inline-flex"
          >
            <X aria-hidden className="size-4" />
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** A dialog's buttons: right-aligned, wrapping in reverse on phones. */
export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 md:flex-row md:flex-wrap-reverse md:justify-end [&>*]:max-md:w-full',
        className,
      )}
    >
      {children}
    </div>
  );
}
