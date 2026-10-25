// Storefront URLs (phase-3-plan §3.3). The store's default language is at the
// root and the other under a prefix: /products/লাল-শাড়ি and
// /en/products/red-saree. No zod here: the storefront runs this on every
// request.
import { normalizeKey } from '../catalog/text';
import type { Locale } from '../money';

export type StoreRoute =
  | { kind: 'home' }
  | { kind: 'product'; slug: string }
  | { kind: 'category'; slug: string }
  | { kind: 'collection'; slug: string }
  | { kind: 'page'; slug: string }
  | { kind: 'search' }
  | { kind: ShellKind };
export type RouteKind = StoreRoute['kind'];
export type SlugRouteKind = Exclude<RouteKind, 'home' | 'search' | ShellKind>;

/**
 * Shopper pages (phase-4-plan §3.16): cached shells with no personal data,
 * whose scripts call /api/*. noindex, and disallowed in robots.txt.
 */
export const SHELL_PATHS = {
  cart: 'cart',
  checkout: 'checkout',
  thanks: 'orders/thanks',
  track: 'track',
  account: 'account',
  /** The SMS link to confirm or cancel an order (phase-6-plan §3.7); its code is the fragment. */
  confirm: 'c',
} as const;
export type ShellKind = keyof typeof SHELL_PATHS;
const SHELL_BY_PATH = Object.fromEntries(
  Object.entries(SHELL_PATHS).map(([kind, path]) => [path, kind]),
) as Record<string, ShellKind>;
export const isShell = (route: StoreRoute): route is { kind: ShellKind } =>
  route.kind in SHELL_PATHS;

/** Path segment of each slug route. */
export const ROUTE_SEGMENTS: Record<SlugRouteKind, string> = {
  product: 'products',
  category: 'categories',
  collection: 'collections',
  page: 'pages',
};
const KIND_BY_SEGMENT = Object.fromEntries(
  Object.entries(ROUTE_SEGMENTS).map(([kind, segment]) => [segment, kind]),
) as Record<string, SlugRouteKind>;

/** Listing pages: their filters, sort and page are query parameters (§3.3). */
export const LISTING_KINDS: readonly RouteKind[] = ['category', 'collection', 'search'];

export const SITEMAP_PARTS = ['products', 'categories', 'collections', 'pages'] as const;
export type SitemapPart = (typeof SITEMAP_PARTS)[number];

export type ParsedPath =
  | { type: 'route'; locale: Locale | null; route: StoreRoute }
  | { type: 'sitemap'; part: SitemapPart | null }
  | { type: 'robots' }
  | { type: 'not_found' };

/** A path segment, decoded and normalized like stored slugs (NFC, lowercase), or null. */
function decodeSlug(segment: string): string | null {
  try {
    const slug = normalizeKey(decodeURIComponent(segment));
    return slug && !slug.includes('/') && [...slug].length <= 120 ? slug : null;
  } catch {
    return null;
  }
}

/**
 * The route a path asks for, with its language prefix, if any (`locale`
 * null means no prefix: the store's default language). Works without
 * knowing the store, so the cache can be checked before anything else.
 */
export function parseStorePath(pathname: string): ParsedPath {
  if (pathname === '/robots.txt') return { type: 'robots' };
  if (pathname === '/sitemap.xml') return { type: 'sitemap', part: null };
  const sitemap = /^\/sitemap-([a-z]+)\.xml$/.exec(pathname);
  if (sitemap) {
    const part = SITEMAP_PARTS.find((p) => p === sitemap[1]);
    return part ? { type: 'sitemap', part } : { type: 'not_found' };
  }

  const segments = pathname.split('/').filter(Boolean);
  let locale: Locale | null = null;
  if (segments[0] === 'bn' || segments[0] === 'en') {
    locale = segments[0];
    segments.shift();
  }
  if (segments.length === 0) return { type: 'route', locale, route: { kind: 'home' } };
  if (segments.length === 1 && segments[0] === 'search') {
    return { type: 'route', locale, route: { kind: 'search' } };
  }
  const shell = SHELL_BY_PATH[segments.join('/')];
  if (shell) return { type: 'route', locale, route: { kind: shell } };
  const kind = KIND_BY_SEGMENT[segments[0] ?? ''];
  if (kind && segments.length === 2) {
    const slug = decodeSlug(segments[1] ?? '');
    if (slug) return { type: 'route', locale, route: { kind, slug } as StoreRoute };
  }
  return { type: 'not_found' };
}

/** A route's path under a language prefix ('' for none). */
function withPrefix(route: StoreRoute, prefix: string): string {
  switch (route.kind) {
    case 'home':
      return prefix || '/';
    case 'search':
      return `${prefix}/search`;
    case 'cart':
    case 'checkout':
    case 'thanks':
    case 'track':
    case 'account':
    case 'confirm':
      return `${prefix}/${SHELL_PATHS[route.kind]}`;
    default:
      return `${prefix}/${ROUTE_SEGMENTS[route.kind]}/${encodeURIComponent(route.slug)}`;
  }
}

/** The path of a route in a language: no prefix for the store's default language. */
export const storePath = (route: StoreRoute, locale: Locale, defaultLocale: Locale): string =>
  withPrefix(route, locale === defaultLocale ? '' : `/${locale}`);

/**
 * The canonical form of a path, keeping its prefix as requested: slugs
 * decoded, normalized and re-encoded, no trailing slash. Null for paths
 * that aren't store pages. The cache keys on it.
 */
export function canonicalPath(pathname: string): string | null {
  const parsed = parseStorePath(pathname);
  if (parsed.type === 'robots') return '/robots.txt';
  if (parsed.type === 'sitemap')
    return parsed.part ? `/sitemap-${parsed.part}.xml` : '/sitemap.xml';
  if (parsed.type !== 'route') return null;
  return withPrefix(parsed.route, parsed.locale ? `/${parsed.locale}` : '');
}

export const absoluteUrl = (host: string, path: string): string => `https://${host}${path}`;

/** A product image's URL on the store's host; files are `<sha256>.<ext>` (Phase 2). */
export const mediaPath = (file: string): string => `/media/${file}`;
