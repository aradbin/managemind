// Which API endpoint a store path needs (phase-3-plan §6.1), and where an
// old slug's redirect points. Pure, so it is unit-tested.
import type { Locale } from '@managemind/shared/i18n';
import { listingQueryString, parseListingQuery } from '@managemind/shared/storefront/listing';
import {
  isShell,
  LISTING_KINDS,
  type StoreRoute,
  storePath,
} from '@managemind/shared/storefront/urls';

const ENDPOINT: Record<
  Exclude<StoreRoute['kind'], 'cart' | 'checkout' | 'thanks' | 'track' | 'account' | 'confirm'>,
  string
> = {
  home: 'home',
  product: 'products',
  category: 'categories',
  collection: 'collections',
  page: 'pages',
  search: 'search',
};

/** The API path for a route; `null` route means the layout alone (not found). */
export function apiPath(
  route: StoreRoute | null,
  locale: Locale | null,
  params: URLSearchParams,
  preview: { token: string; path: string } | null,
): string {
  const query =
    route && LISTING_KINDS.includes(route.kind)
      ? listingQueryString(parseListingQuery(params, route.kind))
      : '';
  const extra = new URLSearchParams(query.slice(1));
  if (preview) {
    extra.set('token', preview.token);
    extra.set('path', preview.path);
    return `/v1/store/preview?${extra}`;
  }
  if (locale) extra.set('locale', locale);
  const qs = extra.toString();
  // Shopper pages are shells: the layout alone, their data comes from /api/* in the browser.
  if (!route || isShell(route)) return `/v1/store/pages/layout${qs ? `?${qs}` : ''}`;
  const slug = 'slug' in route ? `/${encodeURIComponent(route.slug)}` : '';
  return `/v1/store/pages/${ENDPOINT[route.kind as keyof typeof ENDPOINT]}${slug}${qs ? `?${qs}` : ''}`;
}

/** Where an old slug goes: the same kind of page with the current slug, keeping the query. */
export function redirectTarget(
  route: StoreRoute,
  slug: string,
  locale: Locale,
  defaultLocale: Locale,
  search: string,
): string {
  if (!('slug' in route)) return storePath(route, locale, defaultLocale);
  return `${storePath({ ...route, slug }, locale, defaultLocale)}${search}`;
}
