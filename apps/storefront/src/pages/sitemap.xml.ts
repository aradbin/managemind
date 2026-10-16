// The sitemap index (phase-3-plan §3.6): one sitemap per kind of page.

import { env } from 'cloudflare:workers';
import { storeTag } from '@managemind/shared/storefront/cache';
import { SITEMAP_PARTS } from '@managemind/shared/storefront/urls';
import type { APIRoute } from 'astro';
import { CACHE_TAGS_HEADER } from '../lib/cache';

export const GET: APIRoute = ({ locals, url }) => {
  const { store } = locals;
  if (!store) return new Response('Not found', { status: 404 });
  const origin = env.ENVIRONMENT === 'production' ? `https://${store.primaryHost}` : url.origin;
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITEMAP_PARTS.map((part) => `  <sitemap><loc>${origin}/sitemap-${part}.xml</loc></sitemap>`).join('\n')}
</sitemapindex>
`;
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      [CACHE_TAGS_HEADER]: storeTag(store.id),
    },
  });
};
