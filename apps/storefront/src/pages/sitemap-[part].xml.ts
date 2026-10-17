// One sitemap (phase-3-plan §3.6): every published product, category,
// collection or page, each with its other language as an xhtml:link.

import { env } from 'cloudflare:workers';
import type { SitemapEntry } from '@managemind/core';
import type { Locale } from '@managemind/shared/i18n';
import {
  SITEMAP_PARTS,
  type SitemapPart,
  type StoreRoute,
  storePath,
} from '@managemind/shared/storefront/urls';
import type { APIRoute } from 'astro';
import { CACHE_TAGS_HEADER } from '../lib/cache';

const KIND: Record<SitemapPart, Exclude<StoreRoute['kind'], 'home' | 'search'>> = {
  products: 'product',
  categories: 'category',
  collections: 'collection',
  pages: 'page',
};

const escapeXml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c,
  );

export const GET: APIRoute = async ({ locals, params, url }) => {
  const part = SITEMAP_PARTS.find((p) => p === params.part);
  const { store } = locals;
  if (!part || !store) return new Response('Not found', { status: 404 });
  const res = await env.API.fetch(`https://api.internal/v1/store/sitemap/${part}`, {
    headers: { 'x-forwarded-host': locals.host, 'x-request-id': locals.requestId },
  });
  if (!res.ok) return new Response('Unavailable', { status: 503 });
  const data = (await res.json()) as { defaultLocale: Locale; entries: SitemapEntry[] };
  const origin = env.ENVIRONMENT === 'production' ? `https://${store.primaryHost}` : url.origin;
  const loc = (slug: string, locale: Locale) =>
    `${origin}${storePath({ kind: KIND[part], slug } as StoreRoute, locale, data.defaultLocale)}`;
  const urls = data.entries.flatMap((entry) => {
    const locales = (['bn', 'en'] as const).filter((l) => entry.slugs[l]);
    const links = locales.map(
      (l) =>
        `    <xhtml:link rel="alternate" hreflang="${l}" href="${escapeXml(loc(entry.slugs[l] as string, l))}"/>`,
    );
    return locales.map(
      (l) =>
        `  <url>\n    <loc>${escapeXml(loc(entry.slugs[l] as string, l))}</loc>\n    <lastmod>${entry.updatedAt.slice(0, 10)}</lastmod>\n${locales.length > 1 ? `${links.join('\n')}\n` : ''}  </url>`,
    );
  });
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      [CACHE_TAGS_HEADER]: res.headers.get('x-cache-tags') ?? '',
    },
  });
};
