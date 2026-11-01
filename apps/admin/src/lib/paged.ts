// One way to page a long list (ADR 0033): numbered pages on desktops, where
// people jump around and share a page's address, and "Load more" on phones,
// where scrolling on is easier than aiming at small numbers. Both show how
// many match. The API answers a page with `total` and takes an `offset`.
import {
  type InfiniteData,
  keepPreviousData,
  type QueryKey,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

export const PAGE_SIZE = 50;

/** What a paged list endpoint answers. */
export interface CountedPage<T> {
  items: T[];
  total: number;
}

export type Pager =
  | {
      mode: 'pages';
      /** From 1. */
      page: number;
      pageCount: number;
      total: number;
      size: number;
      /** A page is on its way; the last one stays on screen meanwhile. */
      busy: boolean;
      onPage: (page: number) => void;
    }
  | {
      mode: 'more';
      total: number;
      shown: number;
      hasMore: boolean;
      loadingMore: boolean;
      onLoadMore: () => void;
    };

/** The pages to offer: the first, the last, and two either side of this one. */
export function pageList(page: number, count: number): (number | 'gap')[] {
  const shown = new Set([1, count]);
  for (let p = page - 1; p <= page + 1; p++) if (p >= 1 && p <= count) shown.add(p);
  // Near an end, fill to five numbers so the row doesn't jump about.
  if (page <= 3) for (let p = 2; p <= Math.min(4, count); p++) shown.add(p);
  if (page >= count - 2) for (let p = Math.max(1, count - 3); p < count; p++) shown.add(p);
  const sorted = [...shown].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  sorted.forEach((p, i) => {
    const before = sorted[i - 1];
    if (before !== undefined && p - before === 2) out.push(before + 1);
    else if (before !== undefined && p - before > 2) out.push('gap');
    out.push(p);
  });
  return out;
}

/** The md breakpoint, where lists become tables. */
const WIDE = '(min-width: 48rem)';

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True on desktops and tablets, where the list is a table. */
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(WIDE).matches : true,
    () => true,
  );
}

export interface PagedListOptions<P extends CountedPage<unknown>> {
  /** The list and its filters; a change of filters goes back to page 1. */
  queryKey: QueryKey;
  /** Fetches `limit` rows from `offset`. */
  fetchPage: (offset: number, limit: number) => Promise<P>;
  /** The page from the address, for lists that keep it there; else the list keeps its own. */
  page?: number | undefined;
  onPageChange?: ((page: number) => void) | undefined;
  rowKey?: ((item: P['items'][number]) => string) | undefined;
  size?: number | undefined;
  enabled?: boolean | undefined;
}

const idOf = (item: unknown) => (item as { id: string }).id;

export function usePagedList<P extends CountedPage<unknown>>({
  queryKey,
  fetchPage,
  page: urlPage,
  onPageChange,
  rowKey = idOf,
  size = PAGE_SIZE,
  enabled = true,
}: PagedListOptions<P>) {
  type T = P['items'][number];
  const wide = useWide();
  const filters = JSON.stringify(queryKey);
  // Lists that don't keep the page in the address start again at page 1
  // when their filters change.
  const [own, setOwn] = useState({ filters, page: 1 });
  if (urlPage === undefined && own.filters !== filters) setOwn({ filters, page: 1 });
  const page = Math.max(1, urlPage ?? (own.filters === filters ? own.page : 1));
  const setPage = (next: number) => {
    if (onPageChange) onPageChange(next);
    else setOwn({ filters, page: next });
  };

  const paged = useQuery<P>({
    queryKey: [...queryKey, 'page', page, size],
    queryFn: () => fetchPage((page - 1) * size, size),
    enabled: enabled && wide,
    // Keep the last page on screen while the next one loads, but not the
    // rows of other filters.
    placeholderData: (previous, previousQuery) =>
      previousQuery && JSON.stringify(previousQuery.queryKey.slice(0, queryKey.length)) === filters
        ? keepPreviousData(previous)
        : undefined,
  });
  const more = useInfiniteQuery<P, Error, InfiniteData<P, number>, QueryKey, number>({
    queryKey: [...queryKey, 'more', size],
    queryFn: ({ pageParam }) => fetchPage(pageParam, size),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.items.length, 0);
      return last.items.length > 0 && loaded < last.total ? loaded : undefined;
    },
    enabled: enabled && !wide,
  });

  // Rows can shift between one load and the next when orders arrive; a row
  // already shown isn't shown twice.
  const moreItems = useMemo(() => {
    const seen = new Set<string>();
    const rows: T[] = [];
    for (const p of more.data?.pages ?? []) {
      for (const item of p.items) {
        const key = rowKey(item);
        if (!seen.has(key)) {
          seen.add(key);
          rows.push(item);
        }
      }
    }
    return rows;
  }, [more.data, rowKey]);

  const active = wide ? paged : more;
  const first: P | undefined = wide ? paged.data : more.data?.pages[0];
  const total = (wide ? paged.data?.total : more.data?.pages.at(-1)?.total) ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / size));

  // A page past the end, after rows were deleted or filtered away: the last page.
  const pastEnd = wide && paged.data && !paged.isPlaceholderData && page > pageCount;
  useEffect(() => {
    if (pastEnd) setPage(pageCount);
  });

  const pager: Pager = wide
    ? {
        mode: 'pages',
        page,
        pageCount,
        total,
        size,
        busy: paged.isPlaceholderData,
        onPage: setPage,
      }
    : {
        mode: 'more',
        total,
        shown: moreItems.length,
        hasMore: more.hasNextPage,
        loadingMore: more.isFetchingNextPage,
        onLoadMore: () => void more.fetchNextPage(),
      };

  return {
    items: ((wide ? paged.data?.items : moreItems) ?? []) as T[],
    total,
    /** The first page's whole answer, for lists that show totals beside the rows. */
    first,
    pager,
    isPending: active.isPending && enabled,
    isError: active.isError,
    error: active.error,
    refetch: () => void active.refetch(),
  };
}
