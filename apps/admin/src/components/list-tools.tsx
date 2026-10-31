// The parts every list's toolbar is built from (ADR 0033, design rules 4 and 5):
// stage tabs with counts, dashed "+ Name" filter buttons whose list has a
// search box and "Clear filter", one Filters drawer on phones, the ⋯ menu that
// ends a row, and the dark bar that appears while rows are selected.
import { formatNumber } from '@managemind/shared/i18n';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, CirclePlus, Ellipsis, Search, SlidersHorizontal, X } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useLocale } from '../i18n';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Input } from './ui/input';
import { menuContent, menuItem, menuSeparator } from './ui/menu';

export interface StageTab<K extends string> {
  key: K;
  label: string;
  count?: number | undefined;
}

/** Where records move through stages, the stage is a row of tabs above the toolbar. */
export function StageTabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly StageTab<K>[];
  value: K | undefined;
  onChange: (key: K) => void;
  label?: string;
}) {
  const { t, locale } = useLocale();
  return (
    <div className="-mx-3 overflow-x-auto px-3 [scrollbar-width:none] md:mx-0 md:px-0">
      <fieldset className="inline-flex h-9 items-center rounded-[10px] bg-muted p-[3px]">
        <legend className="sr-only">{label ?? t('list.stages')}</legend>
        {tabs.map((tab) => {
          const on = tab.key === value;
          return (
            <button
              key={tab.key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(tab.key)}
              className={cn(
                'inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent px-2.5 text-sm font-medium text-muted-foreground hover:text-foreground',
                on && 'bg-background text-foreground shadow-sm dark:border-input dark:bg-input',
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="text-xs font-medium text-muted-foreground tabular-nums">
                  {formatNumber(locale, tab.count)}
                </span>
              )}
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}

export interface FilterOption {
  value: string;
  label: string;
}

/** One filter: a name, its choices, and the one picked (the API takes one each). */
export interface FilterDef {
  key: string;
  label: string;
  value: string | undefined;
  options: readonly FilterOption[];
  onChange: (value: string | undefined) => void;
}

/**
 * The toolbar after the search box: a dashed button per filter, then Reset.
 * On phones one filter keeps its button; more share one Filters drawer.
 */
export function FilterButtons({
  filters,
  onReset,
  extra,
}: {
  filters: readonly FilterDef[];
  /** Shown while anything is filtered. */
  onReset?: (() => void) | undefined;
  /** More toolbar controls, after the filters (a checkbox, a chip). */
  extra?: ReactNode;
}) {
  const { t } = useLocale();
  const shown = filters.filter((f) => f.options.length > 0);
  const many = shown.length > 1;
  return (
    <>
      <div className={cn('flex-wrap items-center gap-2', many ? 'hidden md:flex' : 'flex')}>
        {shown.map((f) => (
          <FilterButton key={f.key} filter={f} />
        ))}
      </div>
      {many && <FilterDrawer filters={shown} />}
      {extra}
      {onReset && (
        <Button variant="ghost" onClick={onReset}>
          {t('list.reset')}
          <X aria-hidden />
        </Button>
      )}
    </>
  );
}

function FilterButton({ filter }: { filter: FilterDef }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const picked = filter.options.find((o) => o.value === filter.value);
  const q = query.trim().toLowerCase();
  const options = q
    ? filter.options.filter((o) => o.label.toLowerCase().includes(q))
    : filter.options;

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (refocus) trigger.current?.focus();
  };

  // Closes on a press outside, like a popover.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  });

  const choose = (value: string | undefined) => {
    filter.onChange(value);
    close(true);
  };

  /** Escape closes; the arrows move between the search box and the choices. */
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[data-filter-item]') ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? Math.min(at + 1, items.length - 1) : Math.max(at - 1, 0);
    items[next]?.focus();
  };

  return (
    <div ref={wrap} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? close(false) : setOpen(true))}
        className={cn(
          'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-dashed border-input bg-background px-3 text-sm font-medium shadow-xs hover:bg-muted md:min-h-8 dark:bg-white/5',
          picked && 'border-solid',
        )}
      >
        {picked ? (
          <>
            {filter.label}
            <span aria-hidden className="h-4 w-px bg-border" />
            <span className="rounded-md bg-muted px-1 text-xs font-normal">{picked.label}</span>
          </>
        ) : (
          <>
            <CirclePlus aria-hidden className="size-4" />
            {filter.label}
          </>
        )}
      </button>
      {open && (
        <div
          id={listId}
          role="dialog"
          aria-label={filter.label}
          onKeyDown={onKey}
          className="absolute top-full left-0 z-40 mt-1 w-60 overflow-hidden rounded-lg border border-border bg-background shadow-md"
        >
          <div className="flex h-9 items-center gap-2 border-b border-border px-3">
            <Search aria-hidden className="size-4 shrink-0 opacity-50" />
            <input
              // biome-ignore lint/a11y/noAutofocus: the list opened to be searched.
              autoFocus
              data-filter-item
              aria-label={t('list.findOption', { name: filter.label })}
              placeholder={filter.label}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground focus-visible:outline-none md:text-sm"
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {options.length === 0 && (
              <p className="px-2 py-5 text-center text-sm text-muted-foreground">
                {t('list.noOption')}
              </p>
            )}
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                data-filter-item
                aria-pressed={o.value === filter.value}
                onClick={() => choose(o.value === filter.value ? undefined : o.value)}
                className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted md:min-h-8"
              >
                <Check
                  aria-hidden
                  className={cn('size-4 shrink-0', o.value !== filter.value && 'invisible')}
                />
                <span className="truncate">{o.label}</span>
              </button>
            ))}
          </div>
          {picked && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                data-filter-item
                onClick={() => choose(undefined)}
                className="flex min-h-9 w-full items-center justify-center rounded-md text-sm outline-none hover:bg-muted focus-visible:bg-muted md:min-h-8"
              >
                {t('list.clearFilter')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Phones with several filters: one button that says how many are set, and a drawer. */
function FilterDrawer({ filters }: { filters: readonly FilterDef[] }) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const set = filters.filter((f) => f.value !== undefined).length;
  return (
    <>
      <Button
        variant="secondary"
        className="md:hidden"
        aria-label={set ? t('list.filtersSet', { count: set }) : t('list.filters')}
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal aria-hidden />
        {t('list.filters')}
        {set > 0 && (
          <span className="rounded-md bg-muted px-1.5 text-xs tabular-nums">
            {formatNumber(locale, set)}
          </span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={t('list.filters')}>
        <div className="flex flex-col gap-4">
          {filters.map((f) => (
            <fieldset key={f.key} className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{f.label}</legend>
              <div className="flex flex-wrap gap-2">
                {f.options.map((o) => {
                  const on = o.value === f.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => f.onChange(on ? undefined : o.value)}
                      className={cn(
                        'min-h-9 rounded-lg border border-input px-3 text-sm',
                        on && 'border-primary bg-primary text-primary-foreground',
                      )}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_2fr] gap-2 pt-2">
          <Button
            variant="secondary"
            size="lg"
            disabled={set === 0}
            onClick={() => {
              for (const f of filters) if (f.value !== undefined) f.onChange(undefined);
            }}
          >
            {t('list.clearAll')}
          </Button>
          <Button size="lg" onClick={() => setOpen(false)}>
            {t('list.showResults')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/** The ⋯ button that ends a row: open or edit, other actions, then the destructive one. */
export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useLocale();
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`${t('list.rowActions')}: ${label}`}
        >
          <Ellipsis aria-hidden />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className={cn(menuContent, 'min-w-44')}>
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function RowMenuItem({
  onSelect,
  danger,
  disabled,
  children,
}: {
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Menu.Item
      disabled={disabled ?? false}
      onSelect={onSelect}
      className={cn(
        menuItem,
        '[&_svg]:size-4 [&_svg]:text-muted-foreground',
        danger && 'text-danger [&_svg]:text-danger',
      )}
    >
      {children}
    </Menu.Item>
  );
}

export function RowMenuSeparator() {
  return <Menu.Separator className={menuSeparator} />;
}

/**
 * The dark bar shown while rows are selected: how many, the actions, then
 * Clear. It stays at the bottom of the screen (above the tab bar on phones).
 */
export function SelectionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  const { t } = useLocale();
  if (count === 0) return null;
  return (
    <div className="pointer-events-none sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 flex justify-center md:bottom-4">
      <div
        role="toolbar"
        aria-label={t('list.selectedCount', { count })}
        className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-primary py-1.5 pr-1.5 pl-3.5 text-sm text-primary-foreground shadow-lg [scrollbar-width:none]"
      >
        <span aria-live="polite" className="shrink-0 pr-2 font-medium whitespace-nowrap">
          {t('list.selectedCount', { count })}
        </span>
        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-primary-foreground/25" />
        {children}
        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-primary-foreground/25" />
        <button
          type="button"
          aria-label={t('list.clearSelection')}
          title={t('list.clearSelection')}
          onClick={onClear}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-primary-foreground/15"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** An action in the selection bar. */
export const barAction =
  'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 font-medium hover:bg-primary-foreground/15 disabled:opacity-50 [&_svg]:size-4';

/** A list's search box, with its magnifier. */
export function SearchInput({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        className="pl-9"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
