// Listing parameters (phase-3-plan §3.3, §3.7): filters, sort and page of
// category, collection and search pages, as query parameters. Parsing keeps
// only known parameters, normalized, so the cache key and the page agree,
// and ?utm_source= and random parameters never create another cache entry.
import { normalizeKey } from '../catalog/text';
import type { RouteKind } from './urls';

export const LISTING_SORTS = ['featured', 'newest', 'price_asc', 'price_desc'] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];

export const LISTING_LIMITS = {
  pageSize: 24,
  maxPage: 200,
  searchLength: 100,
  /** Search returns at most this many results; more means refine the search (§3.7). */
  searchResults: 48,
  facets: 8,
  valuesPerFacet: 20,
  valueLength: 100,
  /** Whole taka. */
  maxPrice: 100_000_000,
} as const;

/** `a.<attribute key>` (brand and other filterable attributes) or `o.<option name key>`. */
const FACET_PARAM = /^([ao])\.([^,]{1,50})$/u;
const ATTRIBUTE_KEY = /^[a-z][a-z0-9_]{0,39}$/;

export interface ListingQuery {
  /** Search text (search pages only): NFC, single spaces, at most 100 characters. */
  q?: string;
  sort: ListingSort;
  /** 1-based. */
  page: number;
  /** Price range in whole taka. */
  min?: number;
  max?: number;
  inStock: boolean;
  /** A category slug (search pages only). */
  category?: string;
  /** Attribute filters by key, each with value keys (normalized labels). */
  attributes: Record<string, string[]>;
  /** Option filters by option name key ("colour"), each with value keys ("red"). */
  options: Record<string, string[]>;
}

const wholeNumber = (value: string | null, max: number): number | undefined => {
  if (value === null || !/^\d{1,12}$/.test(value)) return undefined;
  const n = Number(value);
  return n <= max ? n : undefined;
};

/** Reads the listing parameters a page of `kind` uses; anything else is ignored. */
export function parseListingQuery(params: URLSearchParams, kind: RouteKind): ListingQuery {
  const L = LISTING_LIMITS;
  const sortParam = params.get('sort');
  const sort = LISTING_SORTS.find((s) => s === sortParam) ?? 'featured';
  const page = wholeNumber(params.get('page'), L.maxPage) ?? 1;
  const query: ListingQuery = {
    sort,
    page: Math.max(page, 1),
    inStock: params.get('stock') === '1',
    attributes: {},
    options: {},
  };
  if (kind === 'search') {
    const q = [...normalizeKey(params.get('q') ?? '')].slice(0, L.searchLength).join('').trim();
    if (q) query.q = q;
    const category = normalizeKey(params.get('category') ?? '');
    if (category && [...category].length <= 120 && !category.includes('/')) {
      query.category = category;
    }
  }
  const min = wholeNumber(params.get('min'), L.maxPrice);
  const max = wholeNumber(params.get('max'), L.maxPrice);
  if (min !== undefined && min > 0) query.min = min;
  if (max !== undefined) query.max = max;
  if (query.min !== undefined && query.max !== undefined && query.min > query.max) {
    [query.min, query.max] = [query.max, query.min];
  }

  let facets = 0;
  const names = [...new Set(params.keys())].sort();
  for (const name of names) {
    const match = FACET_PARAM.exec(name);
    if (!match || facets >= L.facets) continue;
    const [, type, rawKey = ''] = match;
    const key = normalizeKey(rawKey);
    if (!key || (type === 'a' && !ATTRIBUTE_KEY.test(key))) continue;
    const values = [
      ...new Set(
        params
          .getAll(name)
          .flatMap((v) => v.split(','))
          .map(normalizeKey)
          .filter((v) => v && [...v].length <= L.valueLength),
      ),
    ]
      .sort()
      .slice(0, L.valuesPerFacet);
    if (!values.length) continue;
    const target = type === 'a' ? query.attributes : query.options;
    target[key] = [...new Set([...(target[key] ?? []), ...values])].sort();
    facets++;
  }
  return query;
}

/** Whether any filter narrows the listing (filtered pages are noindex, §3.3). */
export const isFiltered = (q: ListingQuery): boolean =>
  q.min !== undefined ||
  q.max !== undefined ||
  q.inStock ||
  q.category !== undefined ||
  Object.keys(q.attributes).length > 0 ||
  Object.keys(q.options).length > 0;

/**
 * The canonical query string of a listing ('' or '?…'): parameters sorted by
 * name, defaults left out. The cache key and the page's links both use it.
 */
export function listingQueryString(q: ListingQuery): string {
  const entries: [string, string][] = [];
  for (const [key, values] of Object.entries(q.attributes))
    entries.push([`a.${key}`, values.join(',')]);
  if (q.category !== undefined) entries.push(['category', q.category]);
  if (q.max !== undefined) entries.push(['max', String(q.max)]);
  if (q.min !== undefined) entries.push(['min', String(q.min)]);
  for (const [key, values] of Object.entries(q.options))
    entries.push([`o.${key}`, values.join(',')]);
  if (q.page > 1) entries.push(['page', String(q.page)]);
  if (q.q !== undefined) entries.push(['q', q.q]);
  if (q.sort !== 'featured') entries.push(['sort', q.sort]);
  if (q.inStock) entries.push(['stock', '1']);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (!entries.length) return '';
  return `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
}

/** The same listing with some parameters changed, as a canonical query string. */
export function withListing(q: ListingQuery, change: Partial<ListingQuery>): string {
  return listingQueryString({ ...q, page: 1, ...change });
}
