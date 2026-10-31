// A list that is a table from the md breakpoint and divided rows in one card
// on phones (phase-1-plan §7.3, ADR 0033), with loading, empty and error
// states and "load more" for cursor pagination. A list can draw its own phone
// row instead of the label-and-value one, let rows be selected, end each row
// with a ⋯ menu, and open a record from anywhere on its row (design rule 5).
import type { MouseEvent, ReactNode } from 'react';
import { useLocale } from '../i18n';
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
  empty?: string;
  /** One way out of an empty filtered list: Reset filters, Clear search. */
  emptyAction?: ReactNode;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** The phone row's content, instead of each column as label and value. */
  card?: (item: T) => ReactNode;
  selection?: Selection<T> | undefined;
  /** Opens the record; keyboards use the link in the row. */
  onOpen?: (item: T) => void;
  /** The ⋯ menu at the end of each row. */
  menu?: (item: T) => ReactNode;
  /** Above the phone rows, beside select-all: "10 products". */
  summary?: string;
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
  card,
  selection,
  onOpen,
  menu,
  summary,
}: DataListProps<T>) {
  const { t } = useLocale();
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
      className="block size-4 shrink-0 accent-primary"
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
        className="block size-4 shrink-0 accent-primary"
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
    <div className="flex flex-col gap-3">
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
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
            <span>{summary ?? label}</span>
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
      {hasMore && onLoadMore && (
        <div className="flex justify-center">
          <Button variant="secondary" disabled={loadingMore} onClick={onLoadMore}>
            {t('list.more')}
          </Button>
        </div>
      )}
    </div>
  );
}
