// Dialogs on Radix (focus trap, Escape, aria-modal): a full-width sheet from
// the bottom on phones, a centred dialog from the md breakpoint
// (phase-1-plan §7.3).
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocale } from '../../i18n';
import { Button } from './button';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | undefined;
  children: ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, children }: DialogProps) {
  const { t } = useLocale();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <RadixDialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col gap-4 overflow-y-auto rounded-t-xl border border-border bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:p-6"
        >
          <div className="flex items-start justify-between gap-2">
            <RadixDialog.Title className="pt-2 text-lg font-semibold">{title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t('action.close')}>
                <X aria-hidden className="size-5" />
              </Button>
            </RadixDialog.Close>
          </div>
          {description && (
            <RadixDialog.Description className="text-muted-foreground">
              {description}
            </RadixDialog.Description>
          )}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
