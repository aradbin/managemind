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
  /** False while something in `children` (e.g. a reason) is still missing. */
  canConfirm?: boolean;
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
  canConfirm = true,
  busy = false,
  error,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useLocale();
  const [typed, setTyped] = useState('');
  const ready = canConfirm && (!confirmText || typed.trim() === confirmText);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped('');
        onOpenChange(next);
      }}
      title={title}
      alert
    >
      <form
        className="flex flex-col gap-4 text-sm text-muted-foreground [&_input]:text-foreground [&_label]:text-foreground"
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
        <div className="flex flex-wrap-reverse justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            {t('action.cancel')}
          </Button>
          <Button
            type="submit"
            size="lg"
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
