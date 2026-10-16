// The page cache's key and tags (phase-3-plan §3.1, §3.2; ADR 0007). The key
// is built from the URL alone, so the storefront checks the cache before any
// KV read or API call. Tags are short, so a listing's header stays small.

import { listingQueryString, parseListingQuery } from './listing';
import { canonicalPath, LISTING_KINDS, parseStorePath } from './urls';

/**
 * The cache key of a GET on a store host: the host, the canonical path and
 * only the query parameters the page uses, normalized and sorted. Null when
 * the request isn't a cacheable page (unknown paths are rendered as 404s,
 * which are cached by their own key only after the store is known).
 */
export function pageCacheKey(url: URL): string | null {
  const path = canonicalPath(url.pathname);
  if (path === null) return null;
  const parsed = parseStorePath(url.pathname);
  const query =
    parsed.type === 'route' && LISTING_KINDS.includes(parsed.route.kind)
      ? listingQueryString(parseListingQuery(url.searchParams, parsed.route.kind))
      : '';
  return `https://${url.host.toLowerCase()}${path}${query}`;
}

export const storeTag = (tenantId: string): string => `s:${tenantId}`;
export const listsTag = (tenantId: string): string => `s:${tenantId}:lists`;
export const productTag = (tenantId: string, productId: string): string =>
  `s:${tenantId}:p:${productId}`;
export const pageTag = (tenantId: string, pageId: string): string => `s:${tenantId}:page:${pageId}`;

/** Cloudflare's limits: a Cache-Tag header of at most 16 KB, and 100 tags per purge call. */
export const CACHE_TAG_HEADER_MAX = 16_000;
export const PURGE_TAGS_PER_CALL = 100;

/**
 * The tags header for a page, deduplicated. A page whose tags would pass
 * Cloudflare's header limit drops its product tags for `lists`, which every
 * product change purges anyway.
 */
export function cacheTagHeader(tags: readonly string[]): string {
  const unique = [...new Set(tags.map((t) => t.toLowerCase()))];
  const header = unique.join(',');
  if (header.length <= CACHE_TAG_HEADER_MAX) return header;
  const kept = unique.filter((t) => !t.includes(':p:'));
  const tenant = unique[0]?.split(':')[1];
  if (tenant && !kept.includes(listsTag(tenant))) kept.push(listsTag(tenant));
  return kept.join(',');
}

/** The fields of an outbox event the purge mapping reads. */
export interface PurgeEvent {
  tenantId: string;
  eventType: string;
  aggregateId: string | null;
  payload: unknown;
}

/** Product fields shoppers never see: a change to only these purges nothing. */
const HIDDEN_PRODUCT_FIELDS = new Set(['settings']);

/** tenant.updated fields that show on every page. */
const STORE_FIELDS = new Set(['name', 'defaultLocale', 'profile', 'storefront', 'theme']);

/**
 * Which cache tags an event purges (§3.2). The store tag empties every page
 * of the store, which costs one purge call like any other.
 */
export function purgeTagsFor(event: PurgeEvent): string[] {
  const t = event.tenantId;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const product = event.aggregateId
    ? [productTag(t, event.aggregateId), listsTag(t)]
    : [listsTag(t)];
  switch (event.eventType) {
    case 'catalog.product.created':
    case 'catalog.product.archived':
    case 'catalog.product.deleted':
      return product;
    case 'catalog.product.updated': {
      const fields = Array.isArray(payload.fields) ? (payload.fields as string[]) : [];
      return fields.length > 0 && fields.every((f) => HIDDEN_PRODUCT_FIELDS.has(f)) ? [] : product;
    }
    case 'inventory.availability.changed': {
      const ids = Array.isArray(payload.productIds) ? (payload.productIds as string[]) : [];
      return [...ids.map((id) => productTag(t, id)), listsTag(t)];
    }
    case 'catalog.page.changed':
      return payload.navigation === true || !event.aggregateId
        ? [storeTag(t)]
        : [pageTag(t, event.aggregateId)];
    case 'tenant.updated': {
      const fields = Array.isArray(payload.fields) ? (payload.fields as string[]) : [];
      return fields.some((f) => STORE_FIELDS.has(f)) ? [storeTag(t)] : [];
    }
    case 'catalog.category.changed':
    case 'catalog.collection.changed':
    case 'catalog.attribute.changed':
    case 'theme.published':
    case 'tenant.status_changed':
    case 'tenant_domain.updated':
    case 'tenant_domain.removed':
      return [storeTag(t)];
    default:
      return [];
  }
}
