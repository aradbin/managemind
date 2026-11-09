// A searchable select (ADR 0033, design rule 3): for eight or more options,
// or names people would type. A button shows the choice; it opens shadcn/ui's
// Command (cmdk) in a popover, with a search box. Arrows move through what
// matches, Enter picks, Escape closes. Each option carries its value as
// data-value, so tests can pick by value as they did with native selects.
import { Check, ChevronsUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocale } from '../../i18n';
import { cn } from '../../lib/utils';
import { Popover } from './popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from './shadcn/command';

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

/** Every typed word somewhere in the label, the hint or the keywords. */
export function matchOptions<T extends ComboboxOption>(options: readonly T[], query: string): T[] {
  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  if (!words.length) return [...options];
  return options.filter((o) => {
    const text = fold(`${o.label} ${o.hint ?? ''} ${o.keywords ?? ''}`);
    return words.every((w) => text.includes(w));
  });
}

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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const chosen = options.find((o) => o.value === value);
  const matches = useMemo(() => matchOptions(options, query), [options, query]);
  const shown = matches.slice(0, SHOWN);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery('');
      }}
    >
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          aria-label={ariaLabel}
          disabled={disabled}
          data-value={value}
          className={cn(
            'flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent pr-2.5 pl-3 text-left text-base shadow-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger md:h-9 md:text-sm dark:bg-white/[0.045] dark:hover:bg-accent',
            className,
          )}
        >
          <span className={cn('truncate', !chosen && 'text-muted-foreground')}>
            {chosen?.label ?? placeholder ?? t('form.choose')}
          </span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 opacity-50" />
        </button>
      </Popover.Trigger>
      <Popover.Content
        align="start"
        collisionPadding={8}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[max(var(--radix-popover-trigger-width),15rem)] flex-col overflow-hidden rounded-lg border-border"
      >
        {/* Our own matching (both languages' names, a word anywhere), so cmdk doesn't filter. */}
        <Command
          shouldFilter={false}
          loop
          className="rounded-none"
          {...(chosen ? { defaultValue: chosen.value } : {})}
        >
          <CommandInput
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={query}
            onValueChange={setQuery}
            className="h-10 text-base focus-visible:shadow-none md:h-9 md:text-sm"
          />
          <CommandList aria-label={searchLabel} className="max-h-60 p-1">
            <CommandEmpty className="px-2 py-5 text-center text-sm text-muted-foreground">
              {t('list.noOption')}
            </CommandEmpty>
            {shown.map((o) => (
              <CommandItem
                key={o.value}
                value={o.value}
                {...(o.disabled ? { disabled: true } : {})}
                onSelect={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className="cursor-pointer items-start rounded-md leading-5"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{o.label}</span>
                  {o.hint && (
                    <span className="truncate text-xs text-muted-foreground">{o.hint}</span>
                  )}
                </span>
                <Check
                  aria-hidden
                  className={cn('mt-0.5 size-4 shrink-0', o.value !== value && 'opacity-0')}
                />
              </CommandItem>
            ))}
            {matches.length > SHOWN && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                {t('form.typeToNarrow', { count: matches.length - SHOWN })}
              </p>
            )}
          </CommandList>
        </Command>
      </Popover.Content>
    </Popover.Root>
  );
}
