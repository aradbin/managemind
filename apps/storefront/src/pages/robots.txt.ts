// robots.txt per store (phase-3-plan §3.6): everything disallowed until the
// owner turns indexing on (Q7); then the sitemap, and no API, search or
// preview pages.
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { fetchPage } from '../lib/api';
import { CACHE_TAGS_HEADER } from '../lib/cache';

export const GET: APIRoute = async ({ locals, url }) => {
  const text = (body: string, status = 200, tags?: string) =>
    new Response(body, {
      status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...(tags ? { [CACHE_TAGS_HEADER]: tags } : {}),
      },
    });
  const { store } = locals;
  if (!store) return text('User-agent: *\nDisallow: /\n', 404);
  const result = await fetchPage<unknown>(
    { api: env.API, host: locals.host, requestId: locals.requestId, shopperIp: locals.shopperIp },
    '/v1/store/pages/layout',
  );
  if (result.kind !== 'ok') return text('User-agent: *\nDisallow: /\n', 503);
  if (!result.body.layout.storefront.indexing)
    return text('User-agent: *\nDisallow: /\n', 200, result.tags);
  const origin = env.ENVIRONMENT === 'production' ? `https://${store.primaryHost}` : url.origin;
  return text(
    [
      'User-agent: *',
      'Disallow: /api/',
      'Disallow: /search',
      'Disallow: /en/search',
      'Disallow: /bn/search',
      'Disallow: /__preview',
      '',
      `Sitemap: ${origin}/sitemap.xml`,
      '',
    ].join('\n'),
    200,
    result.tags,
  );
};
