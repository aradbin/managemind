import type { StoreProduct } from '@managemind/core';
import { describe, expect, it } from 'vitest';
import { displayFor, price, priceRange } from './format';
import { alternates, themeHref } from './links';
import { decide, type RoutingInput } from './routing';
import { ldJson, productLd } from './seo';

const store = {
  id: '01900000-0000-7000-8000-00000000000a',
  slug: 'demo',
  name: 'Demo',
  defaultLocale: 'bn' as const,
  status: 'active' as const,
  primaryHost: 'demo.managemind.store',
};
const input = (path: string, overrides: Partial<RoutingInput> = {}): RoutingInput => ({
  url: new URL(`https://demo.managemind.store${path}`),
  host: 'demo.managemind.store',
  store,
  environment: 'production',
  storeDomain: 'managemind.store',
  platformDomain: 'managemind.site',
  devStore: null,
  ...overrides,
});

describe('routing', () => {
  it('serves the default language at the root and the other under its prefix', () => {
    expect(decide(input('/products/a'))).toEqual({
      type: 'continue',
      locale: 'bn',
      prefixed: false,
    });
    expect(decide(input('/en/products/a'))).toEqual({
      type: 'continue',
      locale: 'en',
      prefixed: true,
    });
  });

  it('drops the default language’s prefix with a 301', () => {
    expect(decide(input('/bn/products/a?x=1'))).toEqual({
      type: 'redirect',
      status: 301,
      location: '/products/a?x=1',
      cacheable: true,
    });
    expect(decide(input('/bn'))).toMatchObject({ location: '/' });
  });

  it('redirects every other host of a store to its primary domain, except the API and images', () => {
    const custom = { ...store, primaryHost: 'www.shop.com.bd' };
    expect(decide(input('/products/a?q=1', { store: custom }))).toEqual({
      type: 'redirect',
      status: 301,
      location: 'https://www.shop.com.bd/products/a?q=1',
      cacheable: true,
    });
    expect(decide(input('/api/cart', { store: custom }))).toMatchObject({ type: 'continue' });
    expect(decide(input(`/media/${'a'.repeat(64)}.webp`, { store: custom }))).toMatchObject({
      type: 'continue',
    });
    // Previews and the dev selector never redirect between hosts.
    expect(decide(input('/', { store: custom, environment: 'preview' }))).toMatchObject({
      type: 'continue',
    });
  });

  it('sends the bare store domain to the platform', () => {
    expect(decide(input('/', { host: 'managemind.store', store: null }))).toEqual({
      type: 'redirect',
      status: 302,
      location: 'https://managemind.site/',
      cacheable: false,
    });
    expect(decide(input('/', { host: 'nobody.managemind.store', store: null }))).toMatchObject({
      type: 'continue',
    });
  });
});

describe('formatting', () => {
  it('shows whole taka without decimals, in the store’s digits', () => {
    expect(price(125000, displayFor('en', null))).toBe('৳1,250');
    expect(price(125050, displayFor('en', null))).toBe('৳1,250.50');
    expect(price(125000, displayFor('bn', null))).toBe('১,২৫০৳');
    expect(price(125000, displayFor('bn', 'latin'))).toBe('1,250৳');
    // Zeros in the taka stay: only the decimals go.
    expect(price(60000, displayFor('bn', null))).toBe('৬০০৳');
    expect(price(10000000, displayFor('bn', null))).toBe('১,০০,০০০৳');
    expect(price(60000, displayFor('en', null))).toBe('৳600');
    expect(priceRange(10000, 25000, displayFor('en', null))).toBe('৳100 – ৳250');
    expect(priceRange(10000, 10000, displayFor('en', null))).toBe('৳100');
  });
});

describe('links', () => {
  const ctx = {
    locale: 'en' as const,
    defaultLocale: 'bn' as const,
    origin: 'https://demo.managemind.store',
  };

  it('resolves theme links in the page’s language', () => {
    expect(themeHref(ctx, { kind: 'product', slug: 'red-saree' })).toBe('/en/products/red-saree');
    expect(themeHref(ctx, { kind: 'search', q: 'শাড়ি' })).toBe(
      `/en/search?q=${encodeURIComponent('শাড়ি')}`,
    );
    expect(themeHref(ctx, { kind: 'url', url: 'https://x.test' })).toBe('https://x.test');
    expect(themeHref(ctx, null)).toBeNull();
  });

  it('lists hreflang alternates with x-default on the default language', () => {
    expect(
      alternates(ctx, (slug) => (slug ? { kind: 'product', slug } : null), { bn: 'লাল', en: 'red' }),
    ).toEqual([
      { locale: 'bn', url: `https://demo.managemind.store/products/${encodeURIComponent('লাল')}` },
      { locale: 'en', url: 'https://demo.managemind.store/en/products/red' },
      {
        locale: 'x-default',
        url: `https://demo.managemind.store/products/${encodeURIComponent('লাল')}`,
      },
    ]);
  });
});

describe('structured data', () => {
  it('describes a product with its offer in BDT', () => {
    const product = {
      title: 'Saree',
      brand: 'Aarong',
      seoDescription: null,
      variants: [
        { price: 125050, available: true, sku: 'S-1' },
        { price: 125050, available: false, sku: 'S-2' },
      ],
    } as unknown as StoreProduct;
    expect(productLd(product, 'https://x/p', [])).toMatchObject({
      '@type': 'Product',
      sku: 'S-1',
      brand: { name: 'Aarong' },
      offers: {
        '@type': 'Offer',
        price: '1250.50',
        priceCurrency: 'BDT',
        availability: 'https://schema.org/InStock',
      },
    });
  });

  it('escapes < so the JSON can’t close its script tag', () => {
    expect(ldJson({ name: '</script><b>' })).toBe('{"name":"\\u003c/script>\\u003cb>"}');
  });
});
