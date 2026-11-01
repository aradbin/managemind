// A list that is a table from the md breakpoint and divided rows in one card
// on phones (phase-1-plan §7.3, ADR 0033), with loading, empty and error
// states, and numbered pages on desktops with "Load more" on phones (a
// `pager` from usePagedList), or plain "Load more" for cursor pagination. A list can draw its own phone
// row instead of the label-and-value one, let rows be selected, end each row
// with a ⋯ menu, and open a record from anywhere on its row (design rule 5).
import { formatNumber } from '@managemind/shared/i18n';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type MouseEvent, type ReactNode, useRef } from 'react';
import { useLocale } from '../i18n';
import { type Pager, pageList } from '../lib/paged';
import { cn } from '../lib/utils';
import { Notice } from './notice';
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
  /** Pages and the count, from usePagedList; replaces hasMore and onLoadMore. */
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
}

/** A press on a control inside the row is that control's, not the row's. */
function fromControl(e: MouseEvent) {
  return (e.target as HTMLElement).closest(
    'a, button, input, label, select, textarea, [role="menuitem"]',
  );
}

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
}: DataListProps<T>) {
  const { t } = useLocale();
  const top = useRef<HTMLDivElement>(null);
  if (isPending) {
    // The list's frame at once, with grey rows where the data goes (ADR 0033).
    return (
      <div role="status" className="overflow-hidden rounded-xl border border-border bg-card">
        <span className="sr-only">{t('loading')}</span>
        <div className="h-10 border-b border-border bg-muted/60" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex h-12 items-center gap-4 border-b border-border px-4 last:border-0"
          >
            <span className="h-3 w-2/5 animate-pulse rounded bg-muted" />
            <span className="ml-auto h-3 w-1/6 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-10 text-center">
        <Notice tone="error">{error}</Notice>
        {onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            {t('action.retry')}
          </Button>
        )}
      </div>
    );
  }
  if (!items?.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">{empty ?? t('list.empty')}</p>
        {emptyAction}
      </div>
    );
  }
  const [first, ...rest] = columns;
  const all = items.every((i) => selection?.isSelected(i));
  const some = !all && items.some((i) => selection?.isSelected(i));
  const selectAll = selection && (
    <input
      type="checkbox"
      className="block shrink-0"
      aria-label={t('list.selectAll')}
      checked={all}
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
        className="block shrink-0"
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

  return (
    <div ref={top} className="flex scroll-mt-4 flex-col gap-3">
      <div
        aria-busy={pager?.mode === 'pages' && pager.busy ? true : undefined}
        className={cn(
          'hidden overflow-x-auto rounded-xl border border-border bg-card transition-opacity md:block',
          pager?.mode === 'pages' && pager.busy && 'opacity-60',
        )}
      >
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{label}</caption>
          <thead className="border-b border-border bg-muted/60">
            <tr>
              {selection && <th className="w-10 pl-4">{selectAll}</th>}
              {columns.map((c) => (
                <th
                  key={c.header}
                  scope="col"
                  className={cn(
                    'h-10 px-4 font-medium whitespace-nowrap',
                    (c.actions || c.numeric) && 'text-right',
                    c.wide && 'hidden lg:table-cell',
                  )}
                >
                  {c.actions ? <span className="sr-only">{c.header}</span> : c.header}
                </th>
              ))}
              {menu && (
                <th className="w-12">
                  <span className="sr-only">{t('list.rowActions')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item) => (
              <tr
                key={rowKey(item)}
                onClick={open(item)}
                data-selected={selection?.isSelected(item) ? '' : undefined}
                className={cn(
                  'hover:bg-muted/50 data-selected:bg-muted/60',
                  onOpen && 'cursor-pointer',
                )}
              >
                {selection && <td className="w-10 pl-4">{check(item)}</td>}
                {columns.map((c) => (
                  <td
                    key={c.header}
                    className={cn(
                      'h-12 px-4 py-2',
                      (c.actions || c.numeric) && 'text-right',
                      c.numeric && 'whitespace-nowrap tabular-nums',
                      c.wide && 'hidden lg:table-cell',
                    )}
                  >
                    {c.cell(item)}
                  </td>
                ))}
                {menu && <td className="w-12 pr-2 text-right">{menu(item)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card md:hidden">
        {selection && (
          <div className="flex h-11 items-center gap-3 border-b border-border bg-muted/60 px-4 text-sm font-medium">
            {selectAll}
            <span>
              {pager?.mode === 'more'
                ? t('list.showing', { shown: pager.shown, total: pager.total })
                : (summary ?? label)}
            </span>
          </div>
        )}
        <ul aria-label={label} className="divide-y divide-border">
          {items.map((item) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the row's link opens it from the keyboard.
            <li
              key={rowKey(item)}
              onClick={open(item)}
              className={cn(
                'flex items-start gap-3 px-4 py-3',
                selection?.isSelected(item) && 'bg-muted/60',
                onOpen && 'cursor-pointer',
              )}
            >
              {selection && <span className="flex h-6 items-center">{check(item)}</span>}
              <div className="min-w-0 flex-1">
                {card ? (
                  card(item)
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {first && <div className="font-medium">{first.cell(item)}</div>}
                    {rest
                      .filter((c) => !c.actions)
                      .map((c) => (
                        <div key={c.header} className="flex gap-2 text-sm">
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
              {menu && <span className="-mr-2 shrink-0">{menu(item)}</span>}
            </li>
          ))}
        </ul>
      </div>
      {pager?.mode === 'pages' && (
        <PageNumbers
          pager={pager}
          onPage={(page) => {
            pager.onPage(page);
            // Back to the list's first row when it starts above the screen.
            if ((top.current?.getBoundingClientRect().top ?? 0) < 0) {
              top.current?.scrollIntoView({ block: 'start' });
            }
          }}
        />
      )}
      {pager?.mode === 'more' && (
        <div className="flex flex-col items-center gap-2">
          {!selection && (
            <p className="text-sm text-muted-foreground">
              {t('list.showing', { shown: pager.shown, total: pager.total })}
            </p>
          )}
          {pager.hasMore && (
            <Button
              variant="secondary"
              className="w-full"
              disabled={pager.loadingMore}
              onClick={pager.onLoadMore}
            >
              {t('list.more')}
            </Button>
          )}
        </div>
      )}
      {!pager && hasMore && onLoadMore && (
        <div className="flex justify-center">
          <Button variant="secondary" disabled={loadingMore} onClick={onLoadMore}>
            {t('list.more')}
          </Button>
        </div>
      )}
    </div>
  );
}

function PageNumbers({
  pager,
  onPage,
}: {
  pager: Extract<Pager, { mode: 'pages' }>;
  onPage: (page: number) => void;
}) {
  const { t, locale } = useLocale();
  const { page, pageCount, total, size } = pager;
  const from = total ? (page - 1) * size + 1 : 0;
  const to = Math.min(page * size, total);
  const pageButton =
    'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg px-2 text-sm font-medium tabular-nums hover:bg-muted disabled:pointer-events-none disabled:opacity-50';
  return (
    <nav
      aria-label={t('list.pages')}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
    >
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t('list.range', { from, to, total })}
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={pageButton}
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft aria-hidden className="size-4" />
            {t('list.prev')}
          </button>
          {pageList(page, pageCount).map((p, i) =>
            p === 'gap' ? (
              <span
                key={`gap-${i}`}
                aria-hidden
                className="inline-flex size-8 items-center justify-center text-muted-foreground"
              >
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                aria-current={p === page ? 'page' : undefined}
                aria-label={t('list.page', { page: p })}
                className={cn(
                  pageButton,
                  p === page && 'border border-border bg-background shadow-xs hover:bg-muted/60',
                )}
                onClick={() => p !== page && onPage(p)}
              >
                {formatNumber(locale, p)}
              </button>
            ),
          )}
          <button
            type="button"
            className={pageButton}
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
          >
            {t('list.next')}
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
      )}
    </nav>
  );
}
