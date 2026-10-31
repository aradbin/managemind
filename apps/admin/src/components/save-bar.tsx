// The save bar on full-page forms (ADR 0033, design rule 7): once something
// changes, "Discard · Save" stays at the bottom of the screen (above the tab
// bar on phones); a new record shows "Cancel · Create …" from the start.
import type { ReactNode } from 'react';
import { Button } from './ui/button';

export function SaveBar({
  show,
  message,
  discardLabel,
  onDiscard,
  saveLabel,
  busy,
  saveDisabled,
  form,
  onSave,
}: {
  show: boolean;
  /** What's pending, on the left: "Unsaved changes". */
  message?: ReactNode;
  discardLabel: string;
  onDiscard: () => void;
  saveLabel: string;
  busy?: boolean | undefined;
  /** Save waits for something required. */
  saveDisabled?: boolean | undefined;
  /** The id of the form Save submits; or `onSave`. */
  form?: string;
  onSave?: () => void;
}) {
  if (!show) return null;
  return (
    <div className="pointer-events-none sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 flex justify-center md:bottom-4">
      <section
        aria-label={typeof message === 'string' ? message : saveLabel}
        className="pointer-events-auto flex w-full max-w-3xl items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 shadow-lg"
      >
        {message && <span className="flex-1 truncate text-sm font-medium">{message}</span>}
        <div className="ml-auto flex shrink-0 gap-2">
          <Button variant="secondary" disabled={busy} onClick={onDiscard}>
            {discardLabel}
          </Button>
          <Button
            {...(form ? { type: 'submit' as const, form } : { onClick: onSave })}
            disabled={busy || saveDisabled}
          >
            {saveLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
