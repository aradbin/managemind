// Asks before a destructive or hard-to-undo action. With `confirmText`, the
// user must type it first (e.g. the store's name), so a slip of the thumb
// can't do it.
import { type ReactNode, useState } from 'react';
import { useLocale } from '../i18n';
import { Field } from './field';
import { Notice } from './notice';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  confirmText?: string | undefined;
  busy?: boolean;
  error?: string | undefined;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  destructive = true,
  confirmText,
  busy = false,
  error,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useLocale();
  const [typed, setTyped] = useState('');
  const ready = !confirmText || typed.trim() === confirmText;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped('');
        onOpenChange(next);
      }}
      title={title}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) onConfirm();
        }}
      >
        {children}
        {confirmText && (
          <Field
            label={t('confirm.typeToConfirm', { word: confirmText })}
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('action.cancel')}
          </Button>
          <Button
            type="submit"
            variant={destructive ? 'danger' : 'primary'}
            disabled={!ready || busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
