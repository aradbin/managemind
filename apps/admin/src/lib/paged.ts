// One way to page a long list (ADR 0034, the canvas's pager): "Showing
// 1–10", the rows per page, "Page N" and First, Previous and Next on
// desktops; Previous, "Page N" and Next on phones. Lists that keep the page
// in the address (?page=3) can be shared and come back to on Back; a new
// filter starts again at page 1. The rows per page are remembered on the
// device. The API answers a page with `total` and takes an `offset`.
import { keepPreviousData, type QueryKey, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export const PAGE_SIZES = [10, 20, 30, 40, 50] as const;
const SIZE_KEY = 'mm.rows';

/** What a paged list endpoint answers. */
export interface CountedPage<T> {
  items: T[];
  total: number;
}

export interface Pager {
  /** From 1. */
  page: number;
  pageCount: number;
  total: number;
  size: number;
  /** How many rows this page shows. */
  shown: number;
  /** A page is on its way; the last one stays on screen meanwhile. */
  busy: boolean;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}

function savedSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(n) ? n : PAGE_SIZES[0];
  } catch {
    return PAGE_SIZES[0];
  }
}

export interface PagedListOptions<P extends CountedPage<unknown>> {
  /** The list and its filters; a change of filters goes back to page 1. */
  queryKey: QueryKey;
  /** Fetches `limit` rows from `offset`. */
  fetchPage: (offset: number, limit: number) => Promise<P>;
  /** The page from the address, for lists that keep it there; else the list keeps its own. */
  page?: number | undefined;
  onPageChange?: ((page: number) => void) | undefined;
  enabled?: boolean | undefined;
}

export function usePagedList<P extends CountedPage<unknown>>({
  queryKey,
  fetchPage,
  page: urlPage,
  onPageChange,
  enabled = true,
}: PagedListOptions<P>) {
  type T = P['items'][number];
  const filters = JSON.stringify(queryKey);
  const [size, setSize] = useState(savedSize);
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
    enabled,
    // Keep the last page on screen while the next one loads, but not the
    // rows of other filters.
    placeholderData: (previous, previousQuery) =>
      previousQuery && JSON.stringify(previousQuery.queryKey.slice(0, queryKey.length)) === filters
        ? keepPreviousData(previous)
        : undefined,
  });

  const total = paged.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / size));

  // A page past the end, after rows were deleted or filtered away: the last page.
  const pastEnd = paged.data && !paged.isPlaceholderData && page > pageCount;
  useEffect(() => {
    if (pastEnd) setPage(pageCount);
  });

  const items = (paged.data?.items ?? []) as T[];
  const pager: Pager = {
    page,
    pageCount,
    total,
    size,
    shown: items.length,
    busy: paged.isPlaceholderData,
    onPage: setPage,
    onSize: (next) => {
      try {
        localStorage.setItem(SIZE_KEY, String(next));
      } catch {
        // Not remembered on this device.
      }
      setSize(next);
      setPage(1);
    },
  };

  return {
    items,
    total,
    /** The page's whole answer, for lists that show totals beside the rows. */
    first: paged.data,
    pager,
    isPending: paged.isPending && enabled,
    isError: paged.isError,
    error: paged.error,
    refetch: () => void paged.refetch(),
  };
}
