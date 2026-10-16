import { describe, expect, it, vi } from 'vitest';
import { CACHE_TAGS_HEADER, type PageCache, serveWithCache } from './cache';

function fakeCache() {
  const entries = new Map<string, Response>();
  const cache: PageCache & { entries: Map<string, Response> } = {
    entries,
    match: async (key) => entries.get(key)?.clone(),
    put: async (key, response) => {
      entries.set(key, response);
    },
  };
  return cache;
}

const page = (
  body = 'page',
  tags: string | null = 's:t',
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html',
      ...(tags !== null ? { [CACHE_TAGS_HEADER]: tags } : {}),
      ...headers,
    },
  });

function run(url: string, render: () => Promise<Response>, init: RequestInit = {}, enabled = true) {
  const cache = fakeCache();
  const pending: Promise<unknown>[] = [];
  const options = {
    enabled,
    cache,
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    render: vi.fn(render),
  };
  return {
    cache,
    options,
    serve: async (u = url, i = init) => {
      const res = await serveWithCache(new Request(u, i), options);
      await Promise.all(pending);
      return res;
    },
  };
}

describe('the page cache', () => {
  it('stores a miss with its tags, then answers the hit without rendering', async () => {
    const t = run('https://shop.example.test/products/a?utm_source=x', async () =>
      page('product', 's:t,s:t:p:1'),
    );
    const miss = await t.serve();
    expect(miss.headers.get('x-cache')).toBe('miss');
    expect(miss.headers.get('cache-control')).toBe('public, max-age=60');
    expect(miss.headers.has(CACHE_TAGS_HEADER)).toBe(false);
    const stored = t.cache.entries.get('https://shop.example.test/products/a');
    expect(stored?.headers.get('cache-tag')).toBe('s:t,s:t:p:1');
    expect(stored?.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=86400');

    // A hit: no render, so no KV read and no API call.
    const hit = await t.serve('https://shop.example.test/products/a?fbclid=y');
    expect(hit.headers.get('x-cache')).toBe('hit');
    expect(hit.headers.has('cache-tag')).toBe(false);
    expect(await hit.text()).toBe('product');
    expect(t.options.render).toHaveBeenCalledTimes(1);
  });

  it('never stores the API, previews, personal cookies, unmarked pages or errors', async () => {
    for (const [url, init, response] of [
      ['https://s.test/api/cart', {}, page()],
      ['https://s.test/__preview?token=x', {}, page()],
      ['https://s.test/', { headers: { cookie: 'a=1; mm_preview=tok' } }, page()],
      ['https://s.test/', {}, page('x', null)],
      ['https://s.test/', {}, page('x', 's:t', 500)],
      ['https://s.test/', {}, page('x', 's:t', 200, { 'set-cookie': 'dev_store=x' })],
      ['https://s.test/', { method: 'POST' }, page()],
    ] as const) {
      const t = run(url, async () => response.clone(), init as RequestInit);
      await t.serve();
      expect(t.cache.entries.size, url).toBe(0);
    }
  });

  it('is off on previews and in development', async () => {
    const t = run('https://s.test/', async () => page(), {}, false);
    const res = await t.serve();
    expect(res.headers.get('x-cache')).toBe('bypass');
    expect(t.cache.entries.size).toBe(0);
  });

  it('caches images for a year, keyed without the query', async () => {
    const file = `${'a'.repeat(64)}.webp`;
    const t = run(`https://s.test/media/${file}?v=1`, async () => page('img', ''));
    const res = await t.serve();
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(t.cache.entries.has(`https://s.test/media/${file}`)).toBe(true);
    // Anything else under /media is not a file name we serve.
    const bad = run('https://s.test/media/../../etc', async () => page('x'));
    await bad.serve();
    expect(bad.cache.entries.size).toBe(0);
  });

  it('caches redirects and not-found pages of known stores', async () => {
    const redirect = run('https://old.example.test/products/a', async () =>
      page('', 's:t', 301, { location: 'https://new.example.test/products/a' }),
    );
    await redirect.serve();
    expect(redirect.cache.entries.size).toBe(1);
    const missing = run('https://s.test/products/nope', async () =>
      page('404', 's:t,s:t:lists', 404),
    );
    await missing.serve();
    expect(missing.cache.entries.size).toBe(1);
  });
});
