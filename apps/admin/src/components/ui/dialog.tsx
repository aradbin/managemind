// Dialogs as the canvas draws them (ADR 0033 and 0034), on shadcn/ui's
// Dialog and Sheet (components/ui/shadcn), so they open and close with its
// fade and zoom: a centred dialog from the md breakpoint (512 px, 24 px
// padding, 10 px corners, a bare × at the top right), and a drawer that
// slides up from the bottom on phones (a handle, a centred title). A
// confirmation stays a centred alert on phones too.
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocale } from '../../i18n';
import { useWide } from '../../lib/use-wide';
import { cn } from '../../lib/utils';
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Dialog as ShadDialog,
} from './shadcn/dialog';
import { Sheet as ShadSheet, SheetContent, SheetDescription, SheetTitle } from './shadcn/sheet';

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

/** The × at the top right, named in the admin's language. */
export function CloseX({ className }: { className?: string }) {
  const { t } = useLocale();
  return (
    <DialogClose
      aria-label={t('action.close')}
      className={cn(
        'absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden',
        className,
      )}
    >
      <X aria-hidden className="size-4" />
    </DialogClose>
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
  const wide = useWide();
  const describedBy = description ? {} : { 'aria-describedby': undefined };
  if (alert || wide)
    return (
      <ShadDialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          {...describedBy}
          {...(alert ? { role: 'alertdialog' } : {})}
          showCloseButton={false}
          className={cn(
            'flex max-h-[90dvh] flex-col gap-4 overflow-y-auto rounded-[10px] border-border p-6',
            alert ? 'max-w-[calc(100%-2rem)] sm:max-w-[460px]' : 'sm:max-w-lg',
            className,
          )}
        >
          <div className={cn('flex flex-col gap-2', !alert && 'pr-6')}>
            <DialogTitle
              className={cn('text-lg font-semibold', alert ? 'leading-[1.3]' : 'leading-none')}
            >
              {title}
            </DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </div>
          {children}
          {!alert && <CloseX />}
        </DialogContent>
      </ShadDialog>
    );
  return (
    <ShadSheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        {...describedBy}
        side="bottom"
        showCloseButton={false}
        className={cn(
          'max-h-[85dvh] gap-0 overflow-y-auto rounded-t-[10px] border-border pb-[env(safe-area-inset-bottom)]',
          className,
        )}
      >
        <DrawerHandle />
        <div className="flex flex-col gap-0.5 px-4 pt-3 pb-2 text-center">
          <SheetTitle className="text-base leading-6 font-semibold">{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </div>
        <div className="flex flex-col gap-4 px-4 pt-2 pb-6">{children}</div>
      </SheetContent>
    </ShadSheet>
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
