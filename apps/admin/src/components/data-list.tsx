// A list as the canvas draws it (ADR 0033 and 0034, design rule 5): a table
// in a 10 px frame from the md breakpoint, and divided rows in one card on
// phones. The loading, failed and empty states sit inside the frame, under
// the real column headings. Under the table, "Showing 1–10", the selection
// bar while rows are picked, and the pager (rows per page, "Page N", First,
// Previous and Next; Previous and Next on phones). Rows open their record
// from anywhere, can be picked, end in a ⋯ menu, and columns can sort.
import { formatNumber } from '@managemind/shared/i18n';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsUpDown,
  CircleAlert,
  RotateCw,
} from 'lucide-react';
import { type CSSProperties, type MouseEvent, type ReactNode, useRef } from 'react';
import { useLocale } from '../i18n';
import { PAGE_SIZES, type Pager } from '../lib/paged';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

export interface Column<T> {
  header: string;
  cell: (item: T) => ReactNode;
  /** Right-aligned, unlabelled on cards: row actions. */
  actions?: boolean;
  /** Right-aligned with even digits: amounts and counts. */
  numeric?: boolean;
  /** Hidden below the lg breakpoint, where the table is narrow. */
  wide?: boolean;
  /** The column sorts the list by this key (with `sort` on the list). */
  sortKey?: string;
  /** A fixed width, as the board gives it. */
  width?: number | string;
  /** What the loading row shows here: a text bar (default), two lines, a badge, a box or nothing. */
  skeleton?: 'text' | 'lines' | 'badge' | 'box' | 'none';
}

/** Rows that can be picked for the selection bar. */
export interface Selection<T> {
  isSelected: (item: T) => boolean;
  toggle: (item: T) => void;
  /** Selects every row shown, or none once all are. */
  toggleAll: () => void;
  /** The row's name, for its checkbox's label. */
  label: (item: T) => string;
}

/** The list's order: a column's key, "-key" for the other way. */
export interface Sort {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

interface DataListProps<T> {
  label: string;
  items: readonly T[] | undefined;
  rowKey: (item: T) => string;
  columns: readonly Column<T>[];
  isPending?: boolean;
  error?: string | undefined;
  onRetry?: () => void;
  empty?: string | undefined;
  /** One way out of an empty filtered list: Reset filters, Clear search. */
  emptyAction?: ReactNode | undefined;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** Pages and the count, from usePagedList. */
  pager?: Pager | undefined;
  /** The phone row's content, instead of each column as label and value. */
  card?: (item: T) => ReactNode;
  selection?: Selection<T> | undefined;
  /** Opens the record; keyboards use the link in the row. */
  onOpen?: ((item: T) => void) | undefined;
  /** The ⋯ menu at the end of each row. */
  menu?: ((item: T) => ReactNode) | undefined;
  /** Above the phone rows, beside select-all: "10 products". */
  summary?: string | undefined;
  /** The selection bar, shown in the footer while rows are picked. */
  bar?: ReactNode;
  sort?: Sort | undefined;
  /** A row's least height on desktops: 48 (default), 52 or 56 as the boards draw them. */
  rowHeight?: number;
  /**
   * How cells are spaced: "tight" puts 8 px around every cell (the Products
   * board); "roomy" starts the row 16 px in and leaves 12 px between columns
   * (the Orders, Customers and inventory boards).
   */
  cells?: 'tight' | 'roomy';
  /** The phone rows' padding, as each phone board draws it. */
  cardClassName?: string;
  /** False where the phone board picks no rows (orders). */
  selectOnPhone?: boolean;
  /** False where the phone board's rows have no ⋯ (products). */
  menuOnPhone?: boolean;
  /**
   * The board's grid for the desktop rows ("24px 76px minmax(0,1.7fr) …
   * 36px", the checkbox and ⋯ columns included): rows 16 px in, 12 px
   * between columns, 8 px out. The rows keep the table's roles.
   */
  grid?: string;
}

/** A press on a control inside the row is that control's, not the row's. */
function fromControl(e: MouseEvent) {
  return (e.target as HTMLElement).closest(
    'a, button, input, label, select, textarea, [role="menuitem"]',
  );
}

const SKELETON_WIDTHS = ['62%', '48%', '74%', '56%', '68%', '44%', '58%', '70%'];

export function DataList<T>({
  label,
  items,
  rowKey,
  columns,
  isPending,
  error,
  onRetry,
  empty,
  emptyAction,
  hasMore,
  loadingMore,
  onLoadMore,
  pager,
  card,
  selection,
  onOpen,
  menu,
  summary,
  bar,
  sort,
  rowHeight = 48,
  cells = 'tight',
  cardClassName,
  selectOnPhone = true,
  menuOnPhone = true,
  grid,
}: DataListProps<T>) {
  const { t } = useLocale();
  const top = useRef<HTMLDivElement>(null);
  const rows = items ?? [];
  const state: 'loading' | 'error' | 'empty' | 'rows' = isPending
    ? 'loading'
    : error
      ? 'error'
      : rows.length === 0
        ? 'empty'
        : 'rows';
  const [first, ...rest] = columns;
  const all = rows.length > 0 && rows.every((i) => selection?.isSelected(i));
  const some = !all && rows.some((i) => selection?.isSelected(i));
  const selectAll = selection && (
    <input
      type="checkbox"
      className="block"
      aria-label={t('list.selectAll')}
      checked={all}
      disabled={state !== 'rows'}
      ref={(el) => {
        if (el) el.indeterminate = some;
      }}
      onChange={selection.toggleAll}
    />
  );
  const check = (item: T) =>
    selection && (
      <input
        type="checkbox"
        className="relative z-[1] block"
        aria-label={selection.label(item)}
        checked={selection.isSelected(item)}
        onChange={() => selection.toggle(item)}
      />
    );
  const open = (item: T) =>
    onOpen
      ? (e: MouseEvent) => {
          if (!fromControl(e)) onOpen(item);
        }
      : undefined;

  // Cell spacing: every cell 8 px (tight), or 16 px in, 12 px between, 8 px out (roomy).
  const span = columns.length + (selection ? 1 : 0) + (menu ? 1 : 0);
  const pad = (i: number) => {
    if (grid) return '';
    if (cells === 'tight') return 'px-2';
    if (i === 0) return 'pr-1.5 pl-4';
    if (i === span - 1) return 'pr-2 pl-1.5';
    return 'px-1.5';
  };
  // A width is the content's, as the board gives it; the cell adds its padding.
  const padPx = (i: number) => (cells === 'tight' ? 16 : i === 0 ? 22 : i === span - 1 ? 14 : 12);
  const widthOf = (c: Column<T>, i: number): CSSProperties | undefined =>
    c.width === undefined
      ? undefined
      : { width: typeof c.width === 'number' ? c.width + padPx(i) : c.width };
  const checkWidth = grid ? undefined : { width: (cells === 'roomy' ? 24 : 16) + padPx(0) };
  // Grid rows: the board's columns, 16 px in, 12 px between, 8 px out.
  const gridRow = grid
    ? ({ display: 'grid', gridTemplateColumns: grid, columnGap: 12, alignItems: 'center' } as const)
    : undefined;
  const rowPad = grid ? 'pr-2 pl-4' : '';
  const cell = grid ? 'block min-w-0' : '';
  /** Grid rows are drawn as blocks, so they say what they are. */
  const role = (r: 'row' | 'cell' | 'columnheader' | 'rowgroup') => (grid ? { role: r } : {});

  const header = (
    <thead className={cn('bg-muted', grid && 'block rounded-t-[10px]')} {...role('rowgroup')}>
      <tr
        className={cn('border-b border-border', rowPad, grid && 'h-10')}
        style={gridRow}
        {...role('row')}
      >
        {selection && (
          <th
            style={checkWidth}
            className={cn(!grid && 'h-10', cell, pad(0))}
            {...role('columnheader')}
          >
            {selectAll}
          </th>
        )}
        {columns.map((c, i) => {
          const at = i + (selection ? 1 : 0);
          const on = sort && c.sortKey ? sortState(sort.value, c.sortKey) : undefined;
          return (
            <th
              key={c.header}
              scope="col"
              {...role('columnheader')}
              style={grid ? undefined : widthOf(c, at)}
              aria-sort={on === 'asc' ? 'ascending' : on === 'desc' ? 'descending' : undefined}
              className={cn(
                'font-medium whitespace-nowrap text-foreground',
                grid ? cell : 'h-10',
                pad(at),
                (c.actions || c.numeric) && 'text-right',
                c.wide && 'hidden lg:table-cell',
              )}
            >
              {c.actions ? (
                <span className="sr-only">{c.header}</span>
              ) : sort && c.sortKey ? (
                <SortButton
                  label={c.header}
                  state={on}
                  numeric={Boolean(c.numeric)}
                  onClick={() => sort.onChange(nextSort(sort.value, c.sortKey as string))}
                />
              ) : (
                c.header
              )}
            </th>
          );
        })}
        {menu && (
          <th
            style={grid ? undefined : { width: (cells === 'roomy' ? 36 : 32) + padPx(span - 1) }}
            className={cn(!grid && 'h-10', cell, pad(span - 1))}
            {...role('columnheader')}
          >
            <span className="sr-only">{t('list.rowActions')}</span>
          </th>
        )}
      </tr>
    </thead>
  );

  const stateRow = (content: ReactNode) => (
    <tr className={cn(grid && 'block')} {...role('row')}>
      <td colSpan={span} className={cn(grid && 'block')} {...role('cell')}>
        {content}
      </td>
    </tr>
  );

  return (
    <div ref={top} className="flex scroll-mt-4 flex-col gap-4">
      {/* Desktops: the table. */}
      <div
        aria-busy={pager?.busy || state === 'loading' ? true : undefined}
        className={cn(
          'hidden overflow-x-auto rounded-[10px] border border-border transition-opacity md:block',
          pager?.busy && 'opacity-60',
        )}
      >
        <table
          className={cn(
            'w-full border-collapse text-left text-sm',
            grid ? 'block' : columns.some((c) => c.width !== undefined) && 'table-fixed',
          )}
          {...(grid ? { role: 'table', 'aria-label': label } : {})}
        >
          <caption className="sr-only">{label}</caption>
          {header}
          <tbody className={cn(grid && 'block')} {...role('rowgroup')}>
            {state === 'loading' &&
              SKELETON_WIDTHS.map((w, r) => (
                <tr
                  key={w + r}
                  aria-hidden
                  className={cn('border-b border-border last:border-b-0', rowPad)}
                  style={grid ? { ...gridRow, minHeight: rowHeight } : { height: rowHeight }}
                >
                  {selection && (
                    <td className={cn(cell, pad(0))}>
                      <span className="mm-skel size-4" />
                    </td>
                  )}
                  {columns.map((c, i) => (
                    <td
                      key={c.header}
                      className={cn(
                        cell,
                        pad(i + (selection ? 1 : 0)),
                        c.wide && 'hidden lg:table-cell',
                      )}
                    >
                      <Skeleton
                        kind={c.skeleton ?? (c.actions ? 'none' : 'text')}
                        width={SKELETON_WIDTHS[(r + i) % 8] as string}
                        numeric={Boolean(c.numeric)}
                      />
                    </td>
                  ))}
                  {menu && <td className={cell} />}
                </tr>
              ))}
            {state === 'loading' && (
              <tr className="sr-only">
                <td role="status">{t('loading')}</td>
              </tr>
            )}
            {state === 'error' &&
              stateRow(<Failed label={label} error={error} onRetry={onRetry} />)}
            {state === 'empty' &&
              stateRow(
                <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                  <p className="text-muted-foreground">{empty ?? t('list.empty')}</p>
                  {emptyAction}
                </div>,
              )}
            {state === 'rows' &&
              rows.map((item) => {
                const picked = selection?.isSelected(item);
                return (
                  <tr
                    key={rowKey(item)}
                    onClick={open(item)}
                    data-selected={picked ? '' : undefined}
                    style={grid ? { ...gridRow, minHeight: rowHeight } : { height: rowHeight }}
                    className={cn(
                      'border-b border-border last:border-b-0 hover:bg-muted/50 data-selected:bg-muted',
                      rowPad,
                      onOpen && 'cursor-pointer',
                    )}
                    {...role('row')}
                  >
                    {selection && (
                      <td className={cn(cell, pad(0))} {...role('cell')}>
                        {check(item)}
                      </td>
                    )}
                    {columns.map((c, i) => (
                      <td
                        key={c.header}
                        {...role('cell')}
                        className={cn(
                          cell,
                          grid ? 'py-1.5' : 'py-2 align-middle',
                          pad(i + (selection ? 1 : 0)),
                          (c.actions || c.numeric) && 'text-right',
                          c.numeric && 'whitespace-nowrap tabular-nums',
                          c.wide && 'hidden lg:table-cell',
                        )}
                      >
                        {c.cell(item)}
                      </td>
                    ))}
                    {menu && (
                      <td className={cn('text-right', cell, pad(span - 1))} {...role('cell')}>
                        {menu(item)}
                      </td>
                    )}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Phones: one card of divided rows. */}
      <div className="overflow-hidden rounded-[10px] border border-border md:hidden">
        {selection && selectOnPhone && state === 'rows' && (
          <div className="flex h-10 items-center gap-1 border-b border-border bg-muted pr-3 text-sm font-medium">
            <span className="flex size-10 items-center justify-center">{selectAll}</span>
            <span className="truncate">{summary ?? label}</span>
          </div>
        )}
        {state === 'loading' && (
          <ul aria-hidden className="divide-y divide-border">
            {SKELETON_WIDTHS.slice(0, 6).map((w) => (
              <li key={w} className="flex min-h-16 flex-col justify-center gap-2 px-3 py-3">
                <span className="mm-skel h-2.5" style={{ width: w }} />
                <span className="mm-skel h-2" style={{ width: '40%' }} />
              </li>
            ))}
          </ul>
        )}
        {state === 'loading' && (
          <p role="status" className="sr-only">
            {t('loading')}
          </p>
        )}
        {state === 'error' && <Failed label={label} error={error} onRetry={onRetry} />}
        {state === 'empty' && (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-muted-foreground">{empty ?? t('list.empty')}</p>
            {emptyAction}
          </div>
        )}
        {state === 'rows' && (
          <ul aria-label={label} className="divide-y divide-border">
            {rows.map((item) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the row's link opens it from the keyboard.
              <li
                key={rowKey(item)}
                onClick={open(item)}
                className={cn(
                  'flex items-center gap-2',
                  selection && selectOnPhone ? 'py-2 pr-3' : 'px-3 py-3',
                  selection?.isSelected(item) && 'bg-muted',
                  onOpen && 'cursor-pointer',
                  cardClassName,
                )}
              >
                {selection && selectOnPhone && (
                  <span className="flex size-10 shrink-0 items-center justify-center self-center">
                    {check(item)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {card ? (
                    card(item)
                  ) : (
                    <div className="flex flex-col gap-1">
                      {first && <div className="font-medium">{first.cell(item)}</div>}
                      {rest
                        .filter((c) => !c.actions)
                        .map((c) => (
                          <div key={c.header} className="flex gap-2 text-[13px] leading-[18px]">
                            <span className="text-muted-foreground">{c.header}:</span>
                            <span>{c.cell(item)}</span>
                          </div>
                        ))}
                      {rest
                        .filter((c) => c.actions)
                        .map((c) => (
                          <div key={c.header} className="mt-1 flex flex-wrap gap-2">
                            {c.cell(item)}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
                {menu && menuOnPhone && <span className="-mr-2 shrink-0">{menu(item)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {pager && state === 'rows' && (
        <PagerRow
          pager={pager}
          bar={rows.some((i) => selection?.isSelected(i)) ? bar : undefined}
          onPage={(page) => {
            pager.onPage(page);
            top.current?.scrollIntoView({ block: 'nearest' });
          }}
        />
      )}
      {!pager && bar}
      {!pager && hasMore && onLoadMore && state === 'rows' && (
        <div className="flex justify-center">
          <Button variant="secondary" disabled={loadingMore} onClick={onLoadMore}>
            {t('list.more')}
          </Button>
        </div>
      )}
    </div>
  );
}

function sortState(value: string | undefined, key: string): 'asc' | 'desc' | undefined {
  if (value === key) return 'asc';
  if (value === `-${key}`) return 'desc';
  return undefined;
}

/** None, then one way, then the other, then none again. */
function nextSort(value: string | undefined, key: string): string | undefined {
  const now = sortState(value, key);
  return now === undefined ? key : now === 'asc' ? `-${key}` : undefined;
}

function SortButton({
  label,
  state,
  numeric,
  onClick,
}: {
  label: string;
  state: 'asc' | 'desc' | undefined;
  numeric: boolean;
  onClick: () => void;
}) {
  const Icon = state === 'asc' ? ArrowUp : state === 'desc' ? ArrowDown : ChevronsUpDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg px-2 font-medium hover:bg-accent',
        numeric ? '-mr-2' : '-ml-2',
      )}
    >
      {label}
      <Icon aria-hidden className={cn('size-3.5', !state && 'opacity-50')} />
    </button>
  );
}

function Skeleton({
  kind,
  width,
  numeric,
}: {
  kind: NonNullable<Column<unknown>['skeleton']>;
  width: string;
  numeric: boolean;
}) {
  if (kind === 'none') return null;
  if (kind === 'box') return <span className="mm-skel size-4" />;
  if (kind === 'badge') return <span className="mm-skel h-[18px]" style={{ width: '70%' }} />;
  if (kind === 'lines')
    return (
      <span className="flex flex-col gap-1.5">
        <span className="mm-skel h-2.5" style={{ width }} />
        <span className="mm-skel h-2" style={{ width: '48%' }} />
      </span>
    );
  return (
    <span className={cn('flex', numeric && 'justify-end')}>
      <span className="mm-skel h-2.5" style={{ width }} />
    </span>
  );
}

/** The list didn't load: inside the frame, with one way to try again. */
function Failed({
  label,
  error,
  onRetry,
}: {
  label: string;
  error: string | undefined;
  onRetry: (() => void) | undefined;
}) {
  const { t } = useLocale();
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span
        aria-hidden
        className="inline-flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <CircleAlert className="size-5" />
      </span>
      <p className="mt-1 font-semibold">{t('list.didntLoad', { name: label })}</p>
      <p className="max-w-[360px] text-muted-foreground">{error}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-2" onClick={onRetry}>
          <RotateCw aria-hidden />
          {t('action.retry')}
        </Button>
      )}
    </div>
  );
}

/**
 * Under the table: "Showing 1–10", the selection bar while rows are picked,
 * then the rows per page, "Page N" and the buttons. While the bar shows, the
 * row stays at the bottom of the screen.
 */
function PagerRow({
  pager,
  bar,
  onPage,
}: {
  pager: Pager;
  bar: ReactNode;
  onPage: (page: number) => void;
}) {
  const { t, locale } = useLocale();
  const { page, pageCount, size, shown } = pager;
  const from = (page - 1) * size + 1;
  const to = from + shown - 1;
  const n = (v: number) => formatNumber(locale, v);
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2',
        bar &&
          'md:sticky md:-bottom-6 md:z-20 md:-mx-6 md:-mb-6 md:bg-canvas md:px-6 md:pt-3 md:pb-9 md:shadow-[0_-1px_0_var(--color-border)]',
      )}
    >
      <p className="hidden text-muted-foreground tabular-nums md:block" aria-live="polite">
        {t('list.showingRange', { from: n(from), to: n(to) })}
      </p>
      {bar}
      <div className="hidden flex-wrap items-center gap-x-6 gap-y-4 md:flex">
        <label className="flex items-center gap-2">
          <span className="font-medium">{t('list.rowsPerPage')}</span>
          <span className="relative">
            <select
              value={size}
              onChange={(e) => pager.onSize(Number(e.target.value))}
              className="h-8 w-[70px] appearance-none rounded-lg border border-border bg-background pr-7 pl-3 shadow-xs hover:bg-accent dark:border-input dark:bg-white/[0.045]"
              style={{ backgroundImage: 'none' }}
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {n(s)}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 opacity-50"
            />
          </span>
        </label>
        <span className="font-medium tabular-nums">{t('list.pageN', { page: n(page) })}</span>
        <nav aria-label={t('list.pages')} className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="icon"
            aria-label={t('list.firstPage')}
            disabled={page <= 1}
            onClick={() => onPage(1)}
          >
            <ChevronsLeft aria-hidden />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label={t('list.prevPage')}
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label={t('list.nextPage')}
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
          >
            <ChevronRight aria-hidden />
          </Button>
        </nav>
      </div>
      <nav
        aria-label={t('list.pages')}
        className="flex w-full items-center justify-between gap-2 md:hidden"
      >
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft aria-hidden />
          {t('list.prev')}
        </Button>
        <span className="font-medium tabular-nums">{t('list.pageN', { page: n(page) })}</span>
        <Button variant="secondary" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          {t('list.next')}
          <ChevronRight aria-hidden />
        </Button>
      </nav>
    </div>
  );
}
