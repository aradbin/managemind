// The storefront's calls to the API over its service binding (phase-3-plan
// §6.1). One call per page miss; the store is the request's host in
// X-Forwarded-Host. Types come from the core's page queries (type-only, so
// none of the core reaches the Worker's bundle).
import type {
  HomeData,
  Listing,
  ListingPageData,
  ProductPageData,
  StoreCategory,
  StoreCollection,
  StoreLayout,
  StorePage,
} from '@managemind/core';
import type { ListingQuery } from '@managemind/shared/storefront/listing';

export type { HomeData, Listing, ProductPageData, StoreLayout, StorePage };
export type CategoryPage = ListingPageData<StoreCategory>;
export type CollectionPage = ListingPageData<StoreCollection>;
export type SearchPage = { listing: Listing | null; query: ListingQuery };

export interface PageResponse<T> {
  layout: StoreLayout;
  page: T | null;
  redirect: string | null;
}

export type PageFetch<T> =
  | { kind: 'ok'; status: 200 | 404; body: PageResponse<T>; tags: string }
  | { kind: 'error'; status: number; code: string | null };

export interface ApiContext {
  api: Fetcher;
  host: string;
  requestId: string;
  shopperIp: string;
}

/** GET an API path for the store at `host`; problems come back as their code. */
export async function fetchPage<T>(ctx: ApiContext, path: string): Promise<PageFetch<T>> {
  const res = await ctx.api.fetch(`https://api.internal${path}`, {
    headers: {
      'x-forwarded-host': ctx.host,
      'x-request-id': ctx.requestId,
      'x-shopper-ip': ctx.shopperIp,
      accept: 'application/json',
    },
  });
  if (res.status === 200 || res.status === 404) {
    const body = (await res.json()) as PageResponse<T> & { code?: string };
    // A 404 problem (no store at this host) has no layout.
    if (body.layout) {
      return { kind: 'ok', status: res.status, body, tags: res.headers.get('x-cache-tags') ?? '' };
    }
    return { kind: 'error', status: res.status, code: body.code ?? null };
  }
  const problem = (await res.json().catch(() => null)) as { code?: string } | null;
  return { kind: 'error', status: res.status, code: problem?.code ?? null };
}
