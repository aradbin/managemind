// Head tags and structured data (phase-3-plan §3.6): canonical on the
// primary host, hreflang, Open Graph, and JSON-LD for products, breadcrumbs
// and the store. JSON-LD goes into a <script> as text, so `<` is escaped.
import type { StoreProduct } from '@managemind/core';
import { decimalPrice } from './format';

export interface Head {
  title: string;
  description?: string;
  canonical: string | null;
  alternates: { locale: string; url: string }[];
  /** noindex when the store isn't live yet (Q7), a page is filtered, or a preview. */
  noindex: boolean;
  image?: string | null;
  type?: 'website' | 'product';
  jsonLd?: object[];
}

/** JSON for a <script type="application/ld+json">, safe inside HTML. */
export const ldJson = (data: object): string =>
  JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028|\u2029/g, '');

export function productLd(product: StoreProduct, url: string, images: string[]): object {
  const prices = product.variants.map((v) => v.price);
  const inStock = product.variants.some((v) => v.available);
  const availability = inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
  const sku = product.variants[0]?.sku;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    url,
    ...(images.length ? { image: images } : {}),
    ...(product.seoDescription ? { description: product.seoDescription } : {}),
    ...(sku ? { sku } : {}),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    offers:
      prices.length > 1 && Math.min(...prices) !== Math.max(...prices)
        ? {
            '@type': 'AggregateOffer',
            priceCurrency: 'BDT',
            lowPrice: decimalPrice(Math.min(...prices)),
            highPrice: decimalPrice(Math.max(...prices)),
            offerCount: prices.length,
            availability,
          }
        : {
            '@type': 'Offer',
            priceCurrency: 'BDT',
            price: decimalPrice(prices[0] ?? 0),
            availability,
            url,
          },
  };
}

export const breadcrumbLd = (items: { name: string; url: string }[]): object => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: item.name,
    item: item.url,
  })),
});

export const storeLd = (
  name: string,
  origin: string,
  logo: string | null,
  searchUrl: string,
): object[] => [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url: `${origin}/`,
    ...(logo ? { logo } : {}),
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name,
    url: `${origin}/`,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${searchUrl}?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  },
];
