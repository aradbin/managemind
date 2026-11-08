// The parts every list's toolbar is built from, as the canvas draws them
// (ADR 0033 and 0034, design rules 4 and 5): stage tabs with counts, dashed
// "+ Name" filter buttons whose list has a search box and "Clear filters", one
// Filters drawer on phones, the count on the right, the ⋯ menu that ends a
// row, and the dark bar that appears while rows are selected.
import { formatNumber } from '@managemind/shared/i18n';
import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  ArrowDownUp,
  Check,
  CirclePlus,
  Ellipsis,
  type LucideIcon,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useLocale } from '../i18n';
import { useWide } from '../lib/use-wide';
import { cn } from '../lib/utils';
import { SecondaryBadge } from './ui/badge';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Input } from './ui/input';
import { menuContent, menuItem, menuItemDanger, menuSeparator } from './ui/menu';
import { chipClass } from './ui/segmented';

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
  const list = useRef<HTMLDivElement>(null);
  /** The arrows move between the tabs, as in any tab row. */
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const all = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = all[(at + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
    next?.focus();
    next?.click();
  };
  return (
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
      <div
        ref={list}
        role="tablist"
        aria-label={label ?? t('list.stages')}
        onKeyDown={onKey}
        className="inline-flex h-10 items-center rounded-[10px] bg-muted p-[3px] md:h-9"
      >
        {tabs.map((tab) => {
          const on = tab.key === value;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(tab.key)}
              className={cn(
                'inline-flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground md:h-[30px] md:px-2.5 md:text-[13px]',
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
      </div>
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
  /** The picked value; with `multi`, the picked values joined by commas ("paid,unpaid"). */
  value: string | undefined;
  options: readonly FilterOption[];
  onChange: (value: string | undefined) => void;
  /** Several values at once, matching any of them (design rule 4). */
  multi?: boolean;
}

/** A filter's picked values, as a list. */
export const pickedValues = (filter: FilterDef): string[] =>
  filter.value ? (filter.multi ? filter.value.split(',').filter(Boolean) : [filter.value]) : [];

/** Picks or drops one value; the filter is cleared once nothing is picked. */
function toggleValue(filter: FilterDef, value: string) {
  if (!filter.multi) {
    filter.onChange(filter.value === value ? undefined : value);
    return;
  }
  const now = pickedValues(filter);
  const next = now.includes(value) ? now.filter((v) => v !== value) : [...now, value];
  // In the options' order, so the same choice reads the same in the URL.
  const ordered = filter.options.map((o) => o.value).filter((v) => next.includes(v));
  filter.onChange(ordered.length ? ordered.join(',') : undefined);
}

/**
 * The toolbar after the search box: a dashed button per filter, then Reset.
 * On phones one filter keeps its button; more share one Filters drawer.
 */
export function FilterButtons({
  filters,
  onReset,
  extra,
  showLabel,
  width,
  drawerExtra,
  drawerAlways,
}: {
  filters: readonly FilterDef[];
  /** Shown while anything is filtered. */
  onReset?: (() => void) | undefined;
  /** More toolbar controls, after the filters (a checkbox, a chip). */
  extra?: ReactNode;
  /** The phone drawer's main button: "Show 16 orders". */
  showLabel?: string | undefined;
  /** The popover's width, as each board draws it (208 px by default). */
  width?: number;
  /** More in the phone drawer, after the filters (a switch). */
  drawerExtra?: ReactNode;
  /** On phones, the drawer even for one filter. */
  drawerAlways?: boolean;
}) {
  const { t } = useLocale();
  const shown = filters.filter((f) => f.options.length > 0);
  const many = shown.length > 1 || Boolean(drawerAlways);
  return (
    <>
      <div className={cn('flex-wrap items-center gap-2', many ? 'hidden md:flex' : 'flex')}>
        {shown.map((f) => (
          <FilterButton key={f.key} filter={f} width={width} />
        ))}
      </div>
      {many && <FilterDrawer filters={shown} showLabel={showLabel} extra={drawerExtra} />}
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

function FilterButton({ filter, width = 208 }: { filter: FilterDef; width?: number | undefined }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const values = pickedValues(filter);
  const picked = filter.options.filter((o) => values.includes(o.value));
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

  /** One choice closes the list; with several allowed, it stays open for more. */
  const choose = (value: string) => {
    toggleValue(filter, value);
    if (!filter.multi) close(true);
  };
  const clear = () => {
    filter.onChange(undefined);
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
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent md:h-8 dark:border-input dark:bg-white/[0.045]"
      >
        <CirclePlus aria-hidden className="size-4" />
        {filter.label}
        {picked.length > 0 && (
          <>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
            {picked.length > 2 ? (
              <SecondaryBadge>{t('list.selectedCount', { count: picked.length })}</SecondaryBadge>
            ) : (
              picked.map((o) => (
                <SecondaryBadge key={o.value} className="max-w-40 truncate">
                  {o.label}
                </SecondaryBadge>
              ))
            )}
          </>
        )}
      </button>
      {open && (
        <div
          id={listId}
          role="dialog"
          aria-label={filter.label}
          onKeyDown={onKey}
          style={{ width }}
          className="absolute top-full left-0 z-40 mt-1 overflow-hidden rounded-lg border border-border bg-popover text-foreground shadow-md"
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
              className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground focus-visible:shadow-none focus-visible:outline-none md:text-sm"
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {options.length === 0 && <p className="py-5 text-center">{t('list.noResults')}</p>}
            {options.map((o) => {
              const on = values.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  data-filter-item
                  aria-pressed={on}
                  onClick={() => choose(o.value)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm leading-5 outline-none hover:bg-accent focus-visible:bg-accent"
                >
                  {/* A box to tick, as the board draws it. */}
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input',
                      on && 'border-primary bg-primary text-primary-foreground',
                    )}
                  >
                    {on && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="flex-1 truncate">{o.label}</span>
                </button>
              );
            })}
          </div>
          {picked.length > 0 && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                data-filter-item
                onClick={clear}
                className="flex w-full items-center justify-center rounded-md px-2 py-1.5 text-sm leading-5 outline-none hover:bg-accent focus-visible:bg-accent"
              >
                {t('list.clearFilters')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Phones with several filters: one button that says how many are set, and a drawer. */
function FilterDrawer({
  filters,
  showLabel,
  extra,
}: {
  filters: readonly FilterDef[];
  showLabel?: string | undefined;
  extra?: ReactNode;
}) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const set = filters.filter((f) => f.value !== undefined).length;
  return (
    <>
      <Button
        variant="secondary"
        className="h-10 md:hidden"
        aria-label={set ? t('list.filtersSet', { count: set }) : t('list.filters')}
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal aria-hidden />
        {t('list.filters')}
        {set > 0 && <SecondaryBadge className="ml-0.5">{formatNumber(locale, set)}</SecondaryBadge>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={t('list.filters')}>
        <div className="flex flex-col gap-4 md:gap-5">
          {filters.map((f) => (
            <fieldset key={f.key} className="flex flex-col gap-2">
              <legend className="mb-2 text-sm leading-none font-medium">{f.label}</legend>
              <div className="flex flex-wrap gap-1.5">
                {f.options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={pickedValues(f).includes(o.value)}
                    onClick={() => toggleValue(f, o.value)}
                    className={chipClass}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          {extra}
        </div>
        <div className="-mx-4 flex gap-2 border-t border-border px-4 pt-3 md:mx-0 md:border-0 md:px-0 md:pt-0">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={set === 0}
            onClick={() => {
              for (const f of filters) if (f.value !== undefined) f.onChange(undefined);
            }}
          >
            {t('list.clear')}
          </Button>
          <Button className="flex-[2]" onClick={() => setOpen(false)}>
            {showLabel ?? t('list.showResults')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/** On phones, the picked filters as chips that remove themselves, then Clear all. */
export function FilterChips({
  filters,
  onReset,
  extra,
}: {
  filters: readonly FilterDef[];
  onReset: () => void;
  /** More chips, such as "Low stock". */
  extra?: readonly { label: string; onRemove: () => void }[];
}) {
  const { t } = useLocale();
  const chips = [
    ...filters.flatMap((f) =>
      f.options
        .filter((o) => pickedValues(f).includes(o.value))
        .map((o) => ({ label: o.label, onRemove: () => toggleValue(f, o.value) })),
    ),
    ...(extra ?? []),
  ];
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 md:hidden">
      {chips.map((c) => (
        <button
          key={c.label}
          type="button"
          aria-label={t('list.removeFilter', { name: c.label })}
          onClick={c.onRemove}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-muted pr-1 pl-2 text-xs"
        >
          {c.label}
          <X aria-hidden className="size-3.5 opacity-60" />
        </button>
      ))}
      <Button variant="ghost" className="h-7 px-2 text-xs has-[>svg]:px-2" onClick={onReset}>
        {t('list.clearAll')}
      </Button>
    </div>
  );
}

/** On phones, the list's order in a drawer, since there are no column headings to press. */
export function SortDrawer({
  options,
  value,
  onChange,
}: {
  options: readonly { value: string; label: string }[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Button variant="secondary" className="md:hidden" onClick={() => setOpen(true)}>
        <ArrowDownUp aria-hidden />
        {current?.label ?? t('list.sort')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={t('list.sortBy')}>
        <fieldset aria-label={t('list.sortBy')} className="-mx-2 flex flex-col">
          {options.map((o) => (
            <label
              key={o.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-accent has-[:focus-visible]:bg-accent"
            >
              <input
                type="radio"
                name="list-sort"
                className="sr-only"
                checked={o.value === value}
                onChange={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              />
              <span className="flex-1">{o.label}</span>
              <Check
                aria-hidden
                className={cn('size-[18px]', o.value === value ? 'opacity-100' : 'opacity-0')}
              />
            </label>
          ))}
        </fieldset>
      </Dialog>
    </>
  );
}

/** Set inside a phone's menu drawer: closes it once an item is chosen. */
const InDrawer = createContext<(() => void) | null>(null);

/**
 * The ⋯ button that ends a row: open or edit, other actions, then the
 * destructive one. A popover on desktops; on phones a drawer from the
 * bottom with 44 px rows (design rule 5).
 */
export function RowMenu({
  label,
  trigger = 'ghost',
  page = trigger === 'outline',
  children,
}: {
  label: string;
  /** "outline" for a page's own ⋯ beside its header buttons. */
  trigger?: 'ghost' | 'outline';
  /** The page's own menu (named "More actions"), not a row's. */
  page?: boolean;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const wide = useWide();
  const [open, setOpen] = useState(false);
  const button = (
    <Button
      variant={trigger === 'outline' ? 'secondary' : 'ghost'}
      size="icon"
      className={cn('relative z-[1]', trigger === 'ghost' && !page && 'size-8 md:size-8')}
      aria-label={page ? label : `${t('list.rowActions')}: ${label}`}
      {...(wide
        ? {}
        : {
            'aria-haspopup': 'menu' as const,
            'aria-expanded': open,
            onClick: () => setOpen(true),
          })}
    >
      <Ellipsis aria-hidden />
    </Button>
  );
  if (!wide)
    return (
      <>
        {button}
        <Dialog open={open} onOpenChange={setOpen} title={label}>
          <InDrawer.Provider value={() => setOpen(false)}>
            <div role="menu" aria-label={label} className="-mx-4 -mt-2 -mb-2 flex flex-col">
              {children}
            </div>
          </InDrawer.Provider>
        </Dialog>
      </>
    );
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{button}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className={cn(menuContent, 'w-[200px]')}>
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

const drawerItem =
  "flex min-h-11 w-full items-center gap-3 px-4 text-left text-[15px] leading-5 hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

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
  const close = useContext(InDrawer);
  if (close)
    return (
      <button
        type="button"
        role="menuitem"
        disabled={disabled ?? false}
        onClick={() => {
          close();
          onSelect();
        }}
        className={cn(drawerItem, danger && 'text-danger [&_svg]:!text-danger')}
      >
        {children}
      </button>
    );
  return (
    <Menu.Item
      disabled={disabled ?? false}
      onSelect={onSelect}
      className={cn(menuItem, danger && menuItemDanger)}
    >
      {children}
    </Menu.Item>
  );
}

export function RowMenuSeparator() {
  const close = useContext(InDrawer);
  if (close) return <hr className="my-1 h-px border-0 bg-border" />;
  return <Menu.Separator className={menuSeparator} />;
}

/** An action in the selection bar. */
export interface BarAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  title?: string | undefined;
}

/**
 * The dark bar shown while rows are selected (the canvas's .mm-bar): how
 * many, the actions, then a way to clear. On desktops it sits in the list's
 * footer; on phones it spans the screen above the tab bar, with the first
 * action and the rest under ⋯.
 */
export function SelectionBar({
  count,
  label,
  onClear,
  actions,
  clearText = false,
}: {
  count: number;
  /** "3 orders selected"; "3 selected" by default. */
  label?: string;
  onClear: () => void;
  actions: readonly BarAction[];
  /** "Clear" in words at the end, as the Orders board has it, instead of ×. */
  clearText?: boolean;
}) {
  const { t } = useLocale();
  if (count === 0) return null;
  const text = label ?? t('list.selectedCount', { count });
  const [main, ...more] = actions;
  return (
    <div
      role="toolbar"
      aria-label={text}
      className="fixed inset-x-3 bottom-[calc(4rem+0.75rem+env(safe-area-inset-bottom))] z-30 flex h-12 items-center gap-0.5 rounded-xl bg-primary pr-1 pl-3.5 text-sm text-primary-foreground shadow-lg md:static md:h-11 md:max-w-[calc(100%-1rem)] md:gap-1 md:pr-1.5"
    >
      <span
        aria-live="polite"
        className="flex-1 font-medium whitespace-nowrap tabular-nums md:flex-none"
      >
        {text}
      </span>
      <span
        aria-hidden
        className="mx-1.5 hidden h-4 w-px shrink-0 bg-primary-foreground/25 md:block"
      />
      {actions.map((a, i) => (
        <button
          key={a.label}
          type="button"
          disabled={a.disabled}
          title={a.title}
          onClick={a.onClick}
          className={cn(barAction, i > 0 && 'max-md:hidden')}
        >
          <a.icon aria-hidden />
          {a.label}
        </button>
      ))}
      {main && more.length > 0 && (
        <Menu.Root>
          <Menu.Trigger asChild>
            <button
              type="button"
              aria-label={t('list.moreActions')}
              className={cn(barAction, 'w-9 justify-center px-0 md:hidden')}
            >
              <Ellipsis aria-hidden />
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              align="end"
              side="top"
              sideOffset={8}
              className={cn(menuContent, 'w-[200px]')}
            >
              {more.map((a) => (
                <Menu.Item
                  key={a.label}
                  disabled={a.disabled}
                  onSelect={a.onClick}
                  className={menuItem}
                >
                  <a.icon aria-hidden />
                  {a.label}
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      )}
      <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-primary-foreground/25" />
      {clearText ? (
        <button type="button" onClick={onClear} className={barAction}>
          {t('list.clear')}
        </button>
      ) : (
        <button
          type="button"
          aria-label={t('list.clearSelection')}
          title={t('list.clearSelection')}
          onClick={onClear}
          className={cn(barAction, 'w-9 justify-center px-0 md:w-8')}
        >
          <X aria-hidden />
        </button>
      )}
    </div>
  );
}

/** An action's look in the selection bar. */
export const barAction =
  'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 font-medium hover:bg-primary-foreground/[0.14] disabled:pointer-events-none disabled:opacity-50 md:h-8 md:px-3 [&_svg]:size-4';

/** The muted count at the right of the toolbar: "16 orders · ৳62,800". */
export function ToolbarSummary({ children }: { children: ReactNode }) {
  return (
    <span className="ml-auto hidden text-[13px] text-muted-foreground tabular-nums md:inline">
      {children}
    </span>
  );
}

/** A list's search box, with its magnifier. */
export function SearchInput({
  label,
  placeholder,
  value,
  onChange,
  className,
}: {
  label: string;
  /** A shorter hint on phones, as the phone boards write it. */
  placeholder?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  /** The width, as each board gives it: `md:w-[260px]`. */
  className?: string;
}) {
  const wide = useWide();
  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground md:left-2.5"
      />
      <Input
        type="search"
        className="pl-9 md:h-8 md:pl-8"
        aria-label={label}
        placeholder={wide ? label : (placeholder ?? label)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
