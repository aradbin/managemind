// Several choices as removable chips in one box, with "Add" opening a
// searchable list (ADR 0034, the canvas's .mm-chipbox): categories and
// collections on the product editor. The list marks what is chosen; picking
// a chosen one takes it off.
import { Check, Plus, Search, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useLocale } from '../../i18n';
import { cn } from '../../lib/utils';
import { fieldLabel } from '../field-styles';
import { Popover } from '../ui/popover';

const fold = (text: string) => text.normalize('NFC').toLowerCase();

export function ChipPicker({
  label,
  options,
  value,
  onChange,
  disabled,
  empty,
  searchLabel,
}: {
  label: string;
  options: readonly { id: string; label: string; keywords?: string | undefined }[];
  value: readonly string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean | undefined;
  /** Shown in the list when there is nothing to choose from. */
  empty: string;
  /** The search box's name, "Search categories". */
  searchLabel: string;
}) {
  const { t } = useLocale();
  const labelId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const chosen = value
    .map((id) => options.find((o) => o.id === id))
    .filter((o): o is (typeof options)[number] => Boolean(o));
  const matches = useMemo(() => {
    const words = fold(query.trim()).split(/\s+/).filter(Boolean);
    return options.filter((o) => {
      const text = fold(`${o.label} ${o.keywords ?? ''}`);
      return words.every((w) => text.includes(w));
    });
  }, [options, query]);
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex min-w-0 flex-col">
      <span id={labelId} className={fieldLabel}>
        {label}
      </span>
      <fieldset
        aria-labelledby={labelId}
        disabled={disabled}
        className="m-0 flex min-h-10 min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-input p-[5px_6px] shadow-xs md:min-h-9 md:p-[4px_6px]"
      >
        {chosen.map((o) => (
          <span
            key={o.id}
            className="inline-flex h-7 items-center gap-0.5 rounded-md bg-secondary pr-0.5 pl-2.5 text-[13px] font-medium text-secondary-foreground md:h-6 md:pl-2 md:text-xs"
          >
            {o.label}
            <button
              type="button"
              aria-label={t('chips.remove', { name: o.label })}
              onClick={() => toggle(o.id)}
              className="inline-flex size-6 items-center justify-center rounded hover:bg-foreground/10 md:size-5"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        ))}
        <Popover.Root
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            setQuery('');
          }}
        >
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-haspopup="listbox"
              aria-label={`${t('chips.add')}: ${label}`}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground md:h-6 md:px-1.5"
            >
              <Plus aria-hidden className="size-3.5" />
              {t('chips.add')}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={4}
              collisionPadding={8}
              className="z-50 flex w-[300px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-foreground shadow-md"
            >
              <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 md:h-9">
                <Search aria-hidden className="size-4 shrink-0 opacity-50" />
                <input
                  // biome-ignore lint/a11y/noAutofocus: the list opened to be searched.
                  autoFocus
                  type="search"
                  aria-label={searchLabel}
                  aria-controls={listId}
                  placeholder={searchLabel}
                  autoComplete="off"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground focus-visible:shadow-none md:text-sm"
                />
              </div>
              <div
                id={listId}
                role="listbox"
                aria-label={label}
                aria-multiselectable
                className="max-h-60 overflow-y-auto p-1"
              >
                {matches.length === 0 && (
                  <p className="px-2 py-5 text-center text-sm text-muted-foreground">
                    {options.length ? t('list.noOption') : empty}
                  </p>
                )}
                {matches.map((o) => {
                  const on = value.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => toggle(o.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm leading-5 hover:bg-accent',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      <Check
                        aria-hidden
                        className={cn('size-4 shrink-0', on ? 'opacity-100' : 'opacity-0')}
                      />
                    </button>
                  );
                })}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </fieldset>
    </div>
  );
}
