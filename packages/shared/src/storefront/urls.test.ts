import { describe, expect, it } from 'vitest';
import {
  cacheTagHeader,
  listsTag,
  pageCacheKey,
  pageTag,
  productTag,
  purgeTagsFor,
  storeTag,
} from './cache';
import { isFiltered, listingQueryString, parseListingQuery, withListing } from './listing';
import { canonicalPath, parseStorePath, storePath } from './urls';

const SAREE = 'লাল-শাড়ি';
const SAREE_PATH = encodeURIComponent(SAREE);

describe('parseStorePath', () => {
  it('reads routes with and without a language prefix', () => {
    expect(parseStorePath('/')).toEqual({ type: 'route', locale: null, route: { kind: 'home' } });
    expect(parseStorePath('/en')).toEqual({ type: 'route', locale: 'en', route: { kind: 'home' } });
    expect(parseStorePath(`/products/${SAREE_PATH}`)).toEqual({
      type: 'route',
      locale: null,
      route: { kind: 'product', slug: SAREE },
    });
    expect(parseStorePath('/en/categories/Shirts/')).toEqual({
      type: 'route',
      locale: 'en',
      route: { kind: 'category', slug: 'shirts' },
    });
    expect(parseStorePath('/search')).toMatchObject({ route: { kind: 'search' } });
    expect(parseStorePath('/pages/about')).toMatchObject({
      route: { kind: 'page', slug: 'about' },
    });
  });

  it('reads sitemaps and robots', () => {
    expect(parseStorePath('/robots.txt')).toEqual({ type: 'robots' });
    expect(parseStorePath('/sitemap.xml')).toEqual({ type: 'sitemap', part: null });
    expect(parseStorePath('/sitemap-products.xml')).toEqual({ type: 'sitemap', part: 'products' });
    expect(parseStorePath('/sitemap-users.xml')).toEqual({ type: 'not_found' });
  });

  it('refuses unknown paths and broken encodings', () => {
    for (const path of [
      '/products',
      '/products/a/b',
      '/fr/products/a',
      '/wp-admin',
      '/products/%E0%A6',
    ]) {
      expect(parseStorePath(path)).toEqual({ type: 'not_found' });
    }
  });
});

describe('storePath', () => {
  it('puts the default language at the root and the other under a prefix', () => {
    expect(storePath({ kind: 'product', slug: SAREE }, 'bn', 'bn')).toBe(`/products/${SAREE_PATH}`);
    expect(storePath({ kind: 'product', slug: 'red-saree' }, 'en', 'bn')).toBe(
      '/en/products/red-saree',
    );
    expect(storePath({ kind: 'home' }, 'bn', 'en')).toBe('/bn');
    expect(storePath({ kind: 'home' }, 'en', 'en')).toBe('/');
    expect(storePath({ kind: 'search' }, 'en', 'bn')).toBe('/en/search');
  });

  it('round-trips through parseStorePath', () => {
    const path = storePath({ kind: 'collection', slug: 'ঈদ-অফার' }, 'en', 'bn');
    expect(parseStorePath(path)).toEqual({
      type: 'route',
      locale: 'en',
      route: { kind: 'collection', slug: 'ঈদ-অফার' },
    });
  });
});

describe('canonicalPath', () => {
  it('normalizes slugs and drops trailing slashes', () => {
    expect(canonicalPath('/en/products/Red-Saree/')).toBe('/en/products/red-saree');
    // Raw (unencoded) Bangla and its encoded form are the same page.
    expect(canonicalPath(`/products/${SAREE}`)).toBe(`/products/${SAREE_PATH}`);
    expect(canonicalPath('/bn/')).toBe('/bn');
    expect(canonicalPath('/nope/x')).toBeNull();
  });
});

describe('listing parameters', () => {
  const parse = (qs: string, kind: 'category' | 'search' = 'category') =>
    parseListingQuery(new URLSearchParams(qs), kind);

  it('keeps only known parameters, normalized and sorted', () => {
    const q = parse(
      'utm_source=fb&sort=price_asc&page=2&a.brand=Nike,adidas&o.Colour=Red&stock=1&min=500&max=100',
    );
    expect(q).toEqual({
      sort: 'price_asc',
      page: 2,
      inStock: true,
      min: 100,
      max: 500,
      attributes: { brand: ['adidas', 'nike'] },
      options: { colour: ['red'] },
    });
    expect(listingQueryString(q)).toBe(
      '?a.brand=adidas%2Cnike&max=500&min=100&o.colour=red&page=2&sort=price_asc&stock=1',
    );
  });

  it('ignores bad values and search-only parameters elsewhere', () => {
    const q = parse('sort=random&page=-3&q=shirt&category=x&a.Bad-Key=x&min=abc');
    expect(listingQueryString(q)).toBe('');
    expect(isFiltered(q)).toBe(false);
  });

  it('reads search text, trimmed to 100 characters', () => {
    const q = parse(`q=${encodeURIComponent('  লাল   শাড়ী ')}&category=Sarees`, 'search');
    expect(q.q).toBe('লাল শাড়ী');
    expect(q.category).toBe('sarees');
    expect(parse(`q=${'x'.repeat(150)}`, 'search').q).toHaveLength(100);
  });

  it('caps facets and their values', () => {
    const qs = Array.from({ length: 12 }, (_, i) => `o.k${i}=v`).join('&');
    expect(Object.keys(parse(qs).options)).toHaveLength(8);
    const values = Array.from({ length: 30 }, (_, i) => `v${i}`).join(',');
    expect(parse(`o.size=${values}`).options.size).toHaveLength(20);
  });

  it('resets the page when a filter changes', () => {
    const q = parse('page=3&sort=newest');
    expect(withListing(q, { inStock: true })).toBe('?sort=newest&stock=1');
  });
});

describe('pageCacheKey', () => {
  it('keys on host, canonical path and the listing parameters only', () => {
    const a = pageCacheKey(
      new URL('https://Shop.Example.com/categories/Shirts?utm_source=x&sort=newest&page=1'),
    );
    const b = pageCacheKey(
      new URL('https://shop.example.com/categories/shirts/?sort=newest&fbclid=y'),
    );
    expect(a).toBe('https://shop.example.com/categories/shirts?sort=newest');
    expect(b).toBe(a);
  });

  it('ignores query parameters on pages without a listing', () => {
    expect(pageCacheKey(new URL(`https://s.test/products/${SAREE}?variant=1&utm_medium=x`))).toBe(
      `https://s.test/products/${SAREE_PATH}`,
    );
  });

  it('returns null for paths that are not store pages', () => {
    expect(pageCacheKey(new URL('https://s.test/api/cart'))).toBeNull();
    expect(pageCacheKey(new URL('https://s.test/__preview'))).toBeNull();
  });
});

describe('cache tags', () => {
  const t = '01900000-0000-7000-8000-00000000000a';
  const p = '01900000-0000-7000-8000-00000000000b';

  it('builds short tags', () => {
    expect(storeTag(t)).toBe(`s:${t}`);
    expect(productTag(t, p)).toBe(`s:${t}:p:${p}`);
    expect(listsTag(t)).toBe(`s:${t}:lists`);
    expect(pageTag(t, p)).toBe(`s:${t}:page:${p}`);
  });

  it('keeps the header under Cloudflare’s limit by falling back to lists', () => {
    const products = Array.from({ length: 300 }, (_, i) => productTag(t, `${p}${i}`));
    const header = cacheTagHeader([storeTag(t), ...products]);
    expect(header).toBe(`${storeTag(t)},${listsTag(t)}`);
    expect(cacheTagHeader([storeTag(t), storeTag(t), productTag(t, p)])).toBe(
      `${storeTag(t)},${productTag(t, p)}`,
    );
  });

  it('maps events to the tags they purge', () => {
    const ev = (eventType: string, payload: unknown = {}, aggregateId: string | null = p) => ({
      tenantId: t,
      eventType,
      aggregateId,
      payload,
    });
    const product = [productTag(t, p), listsTag(t)];
    expect(purgeTagsFor(ev('catalog.product.created'))).toEqual(product);
    expect(purgeTagsFor(ev('catalog.product.updated', { fields: ['prices'] }))).toEqual(product);
    expect(purgeTagsFor(ev('catalog.product.updated', { fields: ['settings'] }))).toEqual([]);
    expect(purgeTagsFor(ev('inventory.level.changed', { variantIds: [p] }))).toEqual([]);
    expect(purgeTagsFor(ev('inventory.availability.changed', { productIds: [p] }, null))).toEqual(
      product,
    );
    expect(purgeTagsFor(ev('catalog.category.changed', { change: 'updated' }))).toEqual([
      storeTag(t),
    ]);
    expect(purgeTagsFor(ev('theme.published'))).toEqual([storeTag(t)]);
    expect(purgeTagsFor(ev('tenant.reset', { jobId: p }))).toEqual([storeTag(t)]);
    expect(purgeTagsFor(ev('tenant.updated', { fields: ['tax'] }))).toEqual([]);
    expect(purgeTagsFor(ev('tenant.updated', { fields: ['profile'] }))).toEqual([storeTag(t)]);
    expect(
      purgeTagsFor(ev('catalog.page.changed', { change: 'updated', navigation: false })),
    ).toEqual([pageTag(t, p)]);
    expect(
      purgeTagsFor(ev('catalog.page.changed', { change: 'updated', navigation: true })),
    ).toEqual([storeTag(t)]);
    expect(purgeTagsFor(ev('staff.invited'))).toEqual([]);
  });
});
