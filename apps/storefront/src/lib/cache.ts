// The page cache (phase-3-plan §3.1, ADR 0007, ADR 0018). It runs in the
// Worker's entry, before Astro, the KV host map or the API: the key comes
// from the URL alone, and a hit is returned as it is. On a miss the page is
// rendered, and when the page marked itself cacheable (the internal
// x-mm-cache-tags header, set only once the store is known) it is stored
// with Cache-Tag and s-maxage. Previews and local development never cache:
// workers.dev has no zone to purge (ADR 0007 decision 7).
import { pageCacheKey } from '@managemind/shared/storefront/cache';

/** Set by a page that may be cached; never sent to the browser. */
export const CACHE_TAGS_HEADER = 'x-mm-cache-tags';
/** One day: purges keep pages fresh (Q4); browsers keep a page a minute. */
export const PAGE_CACHE_CONTROL = 'public, max-age=60, s-maxage=86400';
export const BROWSER_CACHE_CONTROL = 'public, max-age=60';
/** Images are named by their content hash, so they never change (Phase 2). */
export const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Cookies that make a response personal, so it is never cached or served from the cache. */
const PERSONAL_COOKIES = /(?:^|;\s*)(mm_preview|mm_session)=/;

export interface PageCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

/** The cache key for a request, or null when it must not be cached. */
export function cacheKeyFor(request: Request): string | null {
  if (request.method !== 'GET') return null;
  if (PERSONAL_COOKIES.test(request.headers.get('cookie') ?? '')) return null;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/media/')) {
    return /^\/media\/[0-9a-f]{64}\.(webp|jpg|png)$/.test(url.pathname)
      ? `https://${url.host.toLowerCase()}${url.pathname}`
      : null;
  }
  return pageCacheKey(url);
}

/** What the browser gets: no internal header, no Cache-Tag. */
function forBrowser(response: Response, cache: 'hit' | 'miss' | 'bypass'): Response {
  const out = new Response(response.body, response);
  out.headers.delete(CACHE_TAGS_HEADER);
  out.headers.delete('Cache-Tag');
  out.headers.set('x-cache', cache);
  return out;
}

export interface CacheOptions {
  enabled: boolean;
  cache: PageCache;
  waitUntil: (promise: Promise<unknown>) => void;
  render: (request: Request) => Promise<Response>;
}

export async function serveWithCache(request: Request, options: CacheOptions): Promise<Response> {
  const key = options.enabled ? cacheKeyFor(request) : null;
  if (!key) return forBrowser(await options.render(request), 'bypass');

  const hit = await options.cache.match(key);
  if (hit) return forBrowser(hit, 'hit');

  const response = await options.render(request);
  const tags = response.headers.get(CACHE_TAGS_HEADER);
  const cacheable =
    tags !== null &&
    [200, 301, 404].includes(response.status) &&
    !response.headers.has('set-cookie');
  if (!cacheable) return forBrowser(response, 'miss');

  const media = key.includes('/media/');
  const stored = new Response(response.clone().body, response);
  stored.headers.delete(CACHE_TAGS_HEADER);
  stored.headers.set('Cache-Control', media ? MEDIA_CACHE_CONTROL : PAGE_CACHE_CONTROL);
  if (tags) stored.headers.set('Cache-Tag', tags);
  options.waitUntil(options.cache.put(key, stored));

  const out = forBrowser(response, 'miss');
  out.headers.set('Cache-Control', media ? MEDIA_CACHE_CONTROL : BROWSER_CACHE_CONTROL);
  return out;
}
