// A searchable select (ADR 0033, design rule 3): for eight or more options,
// or names people would type. A button shows the choice; it opens a list
// with a search box. Arrows move through what matches, Enter picks, Escape
// closes. Each option carries its value as data-value, so tests can pick by
// value as they did with native selects.
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { type KeyboardEvent, useId, useMemo, useRef, useState } from 'react';
import { useLocale } from '../../i18n';
import { cn } from '../../lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  /** A second line, such as a category's path. */
  hint?: string | undefined;
  /** More text to match: the name in the other language, a code. */
  keywords?: string | undefined;
  disabled?: boolean | undefined;
}

/** At most this many matches are drawn; typing narrows the rest. */
const SHOWN = 200;

const fold = (text: string) => text.normalize('NFC').toLowerCase();

export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  searchLabel,
  disabled,
  invalid,
  className,
  describedBy,
  ariaLabel,
}: {
  /** For the field's <label htmlFor>, which names the button. */
  id?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  options: readonly ComboboxOption[];
  /** Shown while nothing is chosen. */
  placeholder?: string | undefined;
  /** The search box's name, "Search areas". */
  searchLabel: string;
  disabled?: boolean | undefined;
  invalid?: boolean | undefined;
  className?: string | undefined;
  describedBy?: string | undefined;
  /** Its name when no <label> names it. */
  ariaLabel?: string | undefined;
}) {
  const { t } = useLocale();
  const listId = useId();
  const optionId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const chosen = options.find((o) => o.value === value);

  const matches = useMemo(() => {
    const words = fold(query.trim()).split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    return options.filter((o) => {
      const text = fold(`${o.label} ${o.hint ?? ''} ${o.keywords ?? ''}`);
      return words.every((w) => text.includes(w));
    });
  }, [options, query]);
  const shown = matches.slice(0, SHOWN);

  const show = (next: boolean) => {
    setOpen(next);
    setQuery('');
    // Start on the current choice, so the list opens where you are.
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
  };
  const pick = (o: ComboboxOption | undefined) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  };
  const move = (to: number) => {
    const next = Math.min(Math.max(to, 0), shown.length - 1);
    setActive(next);
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') move(active + 1);
    else if (e.key === 'ArrowUp') move(active - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(shown.length - 1);
    else if (e.key === 'Enter') pick(shown[active]);
    else return;
    e.preventDefault();
  };

  return (
    <Popover.Root open={open} onOpenChange={show}>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          aria-label={ariaLabel}
          disabled={disabled}
          data-value={value}
          className={cn(
            'flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-left text-base shadow-xs hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger md:min-h-9 md:text-sm dark:bg-white/5',
            className,
          )}
        >
          <span className={cn('truncate', !chosen && 'text-muted-foreground')}>
            {chosen?.label ?? placeholder ?? t('form.choose')}
          </span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 flex max-h-[min(22rem,var(--radix-popover-content-available-height))] w-[max(var(--radix-popover-trigger-width),14rem)] flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-md"
        >
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 md:h-9">
            <Search aria-hidden className="size-4 shrink-0 opacity-50" />
            <input
              // biome-ignore lint/a11y/noAutofocus: the list opened to be searched.
              autoFocus
              role="combobox"
              aria-label={searchLabel}
              aria-controls={listId}
              aria-expanded
              aria-autocomplete="list"
              aria-activedescendant={shown[active] ? `${optionId}-${active}` : undefined}
              placeholder={searchLabel}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground focus-visible:outline-none md:text-sm"
            />
          </div>
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label={searchLabel}
            className="min-h-0 flex-1 overflow-y-auto p-1"
          >
            {shown.length === 0 && (
              <p className="px-2 py-5 text-center text-sm text-muted-foreground">
                {t('list.noOption')}
              </p>
            )}
            {shown.map((o, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the search box's arrows and Enter pick from the keyboard.
              <div
                key={o.value}
                id={`${optionId}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={o.value === value}
                aria-disabled={o.disabled ? true : undefined}
                data-value={o.value}
                data-index={i}
                onClick={() => pick(o)}
                onPointerMove={() => setActive(i)}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm',
                  i === active && 'bg-muted',
                  o.disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <Check
                  aria-hidden
                  className={cn('mt-0.5 size-4 shrink-0', o.value !== value && 'invisible')}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{o.label}</span>
                  {o.hint && (
                    <span className="truncate text-xs text-muted-foreground">{o.hint}</span>
                  )}
                </span>
              </div>
            ))}
            {matches.length > SHOWN && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                {t('form.typeToNarrow', { count: matches.length - SHOWN })}
              </p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
