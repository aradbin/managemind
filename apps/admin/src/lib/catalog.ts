// Catalog data for the admin screens (phase-2-plan §7): queries, the API's
// types, and helpers for money and translated text.
import type { paths } from '@managemind/sdk';
import type { Locale } from '@managemind/shared/i18n';
import { amountToDecimal, format, money, parseAmount } from '@managemind/shared/money';
import { api, unwrap } from './api';

type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { 200: { content: { 'application/json': infer T } } };
}
  ? T
  : paths[P][M] extends { responses: { 201: { content: { 'application/json': infer T } } } }
    ? T
    : never;

export type Product = Json<'/v1/admin/products/{id}', 'get'>;
export type ProductPage = Json<'/v1/admin/products', 'get'>;
export type ProductSummary = ProductPage['items'][number];
export type Variant = Product['variants'][number];
export type Category = Json<'/v1/admin/categories', 'get'>[number];
export type Collection = Json<'/v1/admin/collections', 'get'>[number];
export type Attribute = Json<'/v1/admin/attributes', 'get'>[number];
export type InventoryPage = Json<'/v1/admin/inventory', 'get'>;
export type InventoryRow = InventoryPage['items'][number];
export type Movement = Json<'/v1/admin/variants/{id}/movements', 'get'>['items'][number];
export type Media = Json<'/v1/admin/media', 'get'>[number];
export type ImportJob = Json<'/v1/admin/imports/{id}', 'get'>;
export type Translated<T> = { bn?: T | undefined; en?: T | undefined };

/** Drops undefined keys: query objects for the API client can't carry them. */
export const compact = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };

/** The value in `locale`, else in the other language, else ''. */
export function pick<T>(values: Translated<T> | undefined, locale: Locale): T | undefined {
  if (!values) return undefined;
  return values[locale] ?? values[locale === 'bn' ? 'en' : 'bn'];
}

/** "৳১,২৫০.০০" for display, in the admin's language. */
export const formatPrice = (amount: number, locale: Locale) => format(money(amount), locale);

/** A price range for lists: "৳500" or "৳500 – ৳900". */
export function formatRange(min: number | null, max: number | null, locale: Locale): string {
  if (min === null) return '—';
  if (max === null || max === min) return formatPrice(min, locale);
  return `${formatPrice(min, locale)} – ${formatPrice(max, locale)}`;
}

/** Poisha to the text in a price input: 125000 -> "1250", 125050 -> "1250.50". */
export const priceInput = (amount: number | null | undefined) =>
  amount === null || amount === undefined ? '' : amountToDecimal(amount);

/** A price input to poisha: "৳১,২৫০" -> 125000; '' -> null; anything else -> undefined (invalid). */
export function readPrice(text: string): number | null | undefined {
  if (!text.trim()) return null;
  const value = parseAmount(text);
  return value === null || value < 0 ? undefined : value;
}

// ---- Queries ---------------------------------------------------------------------------

export interface ProductFilters {
  q?: string | undefined;
  status?: 'draft' | 'active' | 'archived' | undefined;
  categoryId?: string | undefined;
  collectionId?: string | undefined;
  brandValueId?: string | undefined;
  tag?: string | undefined;
  lowStock?: boolean | undefined;
}

export const productsQuery = (filters: ProductFilters) => ({
  queryKey: ['products', filters] as const,
  queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
    unwrap(
      await api.GET('/v1/admin/products', {
        params: {
          query: compact({
            ...filters,
            lowStock: filters.lowStock ? ('true' as const) : undefined,
            after: pageParam,
            limit: 50,
          }),
        },
      }),
    ),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (page: ProductPage) => page.nextCursor ?? undefined,
});

export const productQuery = (id: string) => ({
  queryKey: ['product', id] as const,
  queryFn: async () =>
    unwrap(await api.GET('/v1/admin/products/{id}', { params: { path: { id } } })),
});

export const categoriesQuery = {
  queryKey: ['categories'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/categories')),
  staleTime: 60_000,
};

export const collectionsQuery = {
  queryKey: ['collections'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/collections')),
};

export const attributesQuery = {
  queryKey: ['attributes'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/attributes')),
  staleTime: 60_000,
};

export const storeSettingsQuery = {
  queryKey: ['store'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/store')),
};

/** Categories as an indented list: each with its path for labels ("Clothing › Men"). */
export function categoryOptions(categories: readonly Category[], locale: Locale) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path = (c: Category): string[] => {
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    return [...(parent ? path(parent) : []), pick(c.translations, locale)?.name ?? '—'];
  };
  const ordered: Category[] = [];
  const visit = (parentId: string | null) => {
    for (const c of categories
      .filter((x) => x.parentId === parentId)
      .sort((a, b) => a.position - b.position)) {
      ordered.push(c);
      visit(c.id);
    }
  };
  visit(null);
  return ordered.map((c) => ({ id: c.id, depth: c.depth, label: path(c).join(' › ') }));
}

/** Invalidates everything that shows a product. */
export const productKeys = (id?: string) =>
  id ? [['product', id], ['products'], ['inventory']] : [['products'], ['inventory']];
