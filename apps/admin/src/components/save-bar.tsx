// The save bar on full-page forms (ADR 0033, design rule 7, the canvas's
// dark .mm-bar): once something changes, "Unsaved changes | Discard · Save"
// stays at the bottom of the screen (above the tab bar on phones); a new
// record shows "Cancel · Create …" from the start.
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { barAction } from './list-tools';

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
        className="pointer-events-auto flex h-11 max-w-[calc(100%-1rem)] items-center gap-1 rounded-xl bg-primary pr-1.5 pl-3.5 text-sm text-primary-foreground shadow-lg"
      >
        {message && (
          <>
            <span role="status" className="truncate font-medium whitespace-nowrap">
              {message}
            </span>
            <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-primary-foreground/25" />
          </>
        )}
        <button type="button" className={barAction} disabled={busy} onClick={onDiscard}>
          {discardLabel}
        </button>
        <button
          {...(form
            ? { type: 'submit' as const, form }
            : { type: 'button' as const, onClick: onSave })}
          disabled={busy || saveDisabled}
          className={cn(
            barAction,
            'bg-primary-foreground text-primary hover:bg-primary-foreground/90',
          )}
        >
          {saveLabel}
        </button>
      </section>
    </div>
  );
}
