// A list that is a table from the md breakpoint and cards on phones
// (phase-1-plan §7.3), with loading, empty and error states and "load more"
// for cursor pagination. Both sit in bordered cards (ADR 0029, ADR 0033); a
// list can draw its own phone card instead of the label-and-value one.
import type { ReactNode } from 'react';
import { useLocale } from '../i18n';
import { cn } from '../lib/utils';
import { Notice } from './notice';
import { Button } from './ui/button';

export interface Column<T> {
  header: string;
  cell: (item: T) => ReactNode;
  /** Right-aligned, unlabelled on cards: row actions. */
  actions?: boolean;
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
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** The phone card's content, instead of each column as label and value. */
  card?: (item: T) => ReactNode;
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
  hasMore,
  loadingMore,
  onLoadMore,
  card,
}: DataListProps<T>) {
  const { t } = useLocale();
  if (isPending) {
    // The list's frame at once, with grey rows where the data goes (ADR 0033).
    return (
      <div role="status" className="overflow-hidden rounded-xl border border-border bg-card">
        <span className="sr-only">{t('loading')}</span>
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
      <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        {empty ?? t('list.empty')}
      </p>
    );
  }
  const [first, ...rest] = columns;
  return (
    <div className="flex flex-col gap-3">
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{label}</caption>
          <thead className="border-b border-border bg-muted/60 text-sm">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.header}
                  scope="col"
                  className={cn('h-10 px-4 font-medium', c.actions && 'text-right')}
                >
                  {c.actions ? <span className="sr-only">{c.header}</span> : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item) => (
              <tr key={rowKey(item)} className="hover:bg-muted/50">
                {columns.map((c) => (
                  <td key={c.header} className={cn('h-12 px-4 py-2', c.actions && 'text-right')}>
                    {c.cell(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={label} className="flex flex-col gap-2.5 md:hidden">
        {items.map((item) =>
          card ? (
            <li key={rowKey(item)} className="rounded-xl border border-border bg-card p-4">
              {card(item)}
            </li>
          ) : (
            <li
              key={rowKey(item)}
              className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4"
            >
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
            </li>
          ),
        )}
      </ul>
      {hasMore && onLoadMore && (
        <div>
          <Button variant="secondary" disabled={loadingMore} onClick={onLoadMore}>
            {t('list.more')}
          </Button>
        </div>
      )}
    </div>
  );
}
