// The storefront's page endpoints (phase-3-plan §6.1): /v1/store/pages/*,
// /v1/store/sitemap/{part} and /v1/store/preview. Each returns everything one
// page shows, from one transaction, with its cache tags in x-cache-tags, which
// the storefront moves into Cache-Tag. The store comes only from
// X-Forwarded-Host, which the storefront sets from the request's real host,
// so a client can't choose another store. Responses are built for caching:
// stable URLs, an ETag (If-None-Match answers 304) and max-age=60.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  categoryPage,
  collectionPage,
  homePage,
  type PageResult,
  productPage,
  resolveHost,
  searchPage,
  sitemapPart,
  staticPage,
  storeLayout,
  type TenantTx,
  withTenant,
} from '@managemind/core';
import { createDb } from '@managemind/db';
import { AppError } from '@managemind/shared';
import type { Locale } from '@managemind/shared/i18n';
import { verifyPreviewToken } from '@managemind/shared/storefront';
import { cacheTagHeader } from '@managemind/shared/storefront/cache';
import { parseListingQuery } from '@managemind/shared/storefront/listing';
import { parseStorePath, SITEMAP_PARTS, type StoreRoute } from '@managemind/shared/storefront/urls';
import { captureException } from '@sentry/cloudflare';
import type { Context } from 'hono';
import { withClient } from '../db';
import type { AppEnv } from '../env';
import { createLimiter } from '../rate-limit/index';

const Host = z.object({
  'x-forwarded-host': z.string().min(1).max(253).openapi({ example: 'demo-fashion.localhost' }),
});
const LocaleQuery = z.object({ locale: z.enum(['bn', 'en']).optional() });
const Slug = z.object({ slug: z.string().min(1).max(400) });
/** Listing parameters pass through as they are; the API keeps only the known ones. */
const Listing = LocaleQuery.catchall(z.string());

const StorePage = z
  .object({
    layout: z
      .record(z.string(), z.unknown())
      .openapi({ description: 'Theme, menu, footer and settings' }),
    page: z.unknown().nullable().openapi({ description: 'The page’s data; null when not found' }),
    redirect: z
      .string()
      .nullable()
      .openapi({ description: 'The current slug, for an old one (301)' }),
  })
  .openapi('StorePage');
const StoreSitemap = z
  .object({
    defaultLocale: z.enum(['bn', 'en']),
    indexing: z.boolean(),
    entries: z.array(z.object({ slugs: z.record(z.string(), z.string()), updatedAt: z.string() })),
  })
  .openapi('StoreSitemap');

const pageResponses = {
  200: {
    content: { 'application/json': { schema: StorePage } },
    description: 'The page, or a redirect',
  },
  304: { description: 'Not modified (If-None-Match)' },
  404: {
    content: { 'application/json': { schema: StorePage } },
    description: 'Not found; the layout is still there for the 404 page',
  },
};

const r = <const C extends Omit<Parameters<typeof createRoute>[0], 'tags'>>(config: C) =>
  createRoute({ ...config, tags: ['store'] } as C & { tags: string[] });

export const STORE_PAGE_ROUTES = {
  layout: r({
    method: 'get',
    path: '/v1/store/pages/layout',
    summary: 'The layout alone, for not-found pages',
    request: { headers: Host, query: LocaleQuery },
    responses: pageResponses,
  }),
  home: r({
    method: 'get',
    path: '/v1/store/pages/home',
    summary: 'The homepage',
    request: { headers: Host, query: LocaleQuery },
    responses: pageResponses,
  }),
  product: r({
    method: 'get',
    path: '/v1/store/pages/products/{slug}',
    summary: 'A product page, or a redirect for an old slug',
    request: { headers: Host, params: Slug, query: LocaleQuery },
    responses: pageResponses,
  }),
  category: r({
    method: 'get',
    path: '/v1/store/pages/categories/{slug}',
    summary: 'A category with a page of products and facets',
    request: { headers: Host, params: Slug, query: Listing },
    responses: pageResponses,
  }),
  collection: r({
    method: 'get',
    path: '/v1/store/pages/collections/{slug}',
    summary: 'A collection with a page of products and facets',
    request: { headers: Host, params: Slug, query: Listing },
    responses: pageResponses,
  }),
  search: r({
    method: 'get',
    path: '/v1/store/pages/search',
    summary: 'Search results and facets (30 misses a minute per shopper)',
    request: { headers: Host, query: Listing },
    responses: pageResponses,
  }),
  page: r({
    method: 'get',
    path: '/v1/store/pages/pages/{slug}',
    summary: 'A static page',
    request: { headers: Host, params: Slug, query: LocaleQuery },
    responses: pageResponses,
  }),
  sitemap: r({
    method: 'get',
    path: '/v1/store/sitemap/{part}',
    summary: 'One sitemap’s entries, with each one’s slug in every language',
    request: { headers: Host, params: z.object({ part: z.enum(SITEMAP_PARTS) }) },
    responses: {
      200: { content: { 'application/json': { schema: StoreSitemap } }, description: 'Entries' },
      304: { description: 'Not modified (If-None-Match)' },
    },
  }),
  preview: r({
    method: 'get',
    path: '/v1/store/preview',
    summary: 'Any store page with the draft theme, for the theme editor (never cached)',
    request: {
      headers: Host,
      query: z
        .object({
          token: z.string().min(1).max(200),
          path: z.string().min(1).max(1000).openapi({ example: '/en/products/red-saree' }),
        })
        .catchall(z.string()),
    },
    responses: {
      200: {
        content: { 'application/json': { schema: StorePage } },
        description: 'The page with the draft theme',
      },
      401: { description: 'The token is missing, expired or for another store' },
      404: { content: { 'application/json': { schema: StorePage } }, description: 'Not found' },
    },
  }),
} as const;

type Which = 'published' | 'draft';

/** Resolves the forwarded host to its store, then runs `fn` in that store's transaction. */
async function inHostStore<T>(
  c: Context<AppEnv>,
  fn: (tx: TenantTx, tenantId: string) => Promise<T>,
  check?: (tenantId: string) => Promise<void>,
): Promise<T> {
  const host = c.req.header('x-forwarded-host') ?? '';
  return withClient(c.env, c.executionCtx, async (client) => {
    const record = await resolveHost(createDb(client), host, c.var.config.STORE_DOMAIN);
    if (!record) throw new AppError('store_not_found');
    if (record.status === 'closed') throw new AppError('tenant_closed');
    if (record.status !== 'active') throw new AppError('tenant_suspended');
    await check?.(record.tenantId);
    return withTenant(client, record.tenantId, (tx) => fn(tx, record.tenantId), {
      requestId: c.var.requestId,
    });
  });
}

/** A short, stable hash of the body: the ETag. */
async function etag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0'));
  return `W/"${hex.join('')}"`;
}

async function respond(
  c: Context<AppEnv>,
  body: unknown,
  status: 200 | 404,
  tags: string[],
  which: Which,
): Promise<Response> {
  const text = JSON.stringify(body);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'x-cache-tags': cacheTagHeader(tags),
  };
  if (which === 'draft') {
    headers['Cache-Control'] = 'no-store';
    return new Response(text, { status, headers });
  }
  headers['Cache-Control'] = 'public, max-age=60';
  headers.ETag = await etag(text);
  if (status === 200 && c.req.header('if-none-match') === headers.ETag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(text, { status, headers });
}

/** The shopper's IP: the storefront forwards it over the service binding, which has no `cf`. */
const shopperIp = (c: Context<AppEnv>) =>
  ((c.req.raw as { cf?: unknown }).cf === undefined && c.req.header('x-shopper-ip')) ||
  c.req.header('cf-connecting-ip') ||
  'unknown';

async function limitSearch(c: Context<AppEnv>) {
  const limiter = createLimiter(c.env.RATE_LIMITER, (e) =>
    captureException(e, { tags: { request_id: c.var.requestId } }),
  );
  await limiter.check('search:ip', shopperIp(c));
}

/** One page: the layout, the route's own data, and the tags of both. */
async function render(
  c: Context<AppEnv>,
  tx: TenantTx,
  locale: Locale | null,
  route: StoreRoute | { kind: 'layout' },
  params: URLSearchParams,
  which: Which,
): Promise<Response> {
  const layout = await storeLayout(tx, locale, which);
  const { lang } = layout;
  let result: PageResult<unknown> | null = null;
  switch (route.kind) {
    case 'layout':
      break;
    case 'home':
      result = await homePage(tx, lang, layout.data.theme);
      break;
    case 'product':
      result = await productPage(tx, lang, route.slug, {
        related: layout.data.theme.pages.product.showRelated,
      });
      break;
    case 'category':
      result = await categoryPage(tx, lang, route.slug, parseListingQuery(params, 'category'));
      break;
    case 'collection':
      result = await collectionPage(tx, lang, route.slug, parseListingQuery(params, 'collection'));
      break;
    case 'search': {
      const query = parseListingQuery(params, 'search');
      if (query.q && which === 'published') await limitSearch(c);
      result = await searchPage(tx, lang, query);
      break;
    }
    case 'page':
      result = await staticPage(tx, lang, route.slug);
      break;
  }
  const tags = [...layout.tags, ...(result?.tags ?? [])];
  if (!result)
    return respond(c, { layout: layout.data, page: null, redirect: null }, 200, tags, which);
  const data = result.data as { found: unknown } | { redirect: string } | null;
  // Home and search have no "found" wrapper.
  if (route.kind === 'home' || route.kind === 'search') {
    return respond(c, { layout: layout.data, page: data, redirect: null }, 200, tags, which);
  }
  if (data && 'redirect' in data) {
    return respond(
      c,
      { layout: layout.data, page: null, redirect: data.redirect },
      200,
      tags,
      which,
    );
  }
  if (data && 'found' in data) {
    return respond(c, { layout: layout.data, page: data.found, redirect: null }, 200, tags, which);
  }
  return respond(c, { layout: layout.data, page: null, redirect: null }, 404, tags, which);
}

const searchParams = (c: Context<AppEnv>) => new URL(c.req.url).searchParams;
const localeOf = (c: Context<AppEnv>): Locale | null => {
  const l = c.req.query('locale');
  return l === 'bn' || l === 'en' ? l : null;
};
/** A slug from the path, decoded and normalized like stored ones. */
const slugOf = (raw: string) => raw.normalize('NFC').toLowerCase();

export function registerStorePages(app: OpenAPIHono<AppEnv>): void {
  const R = STORE_PAGE_ROUTES;
  const page =
    (route: (c: Context<AppEnv>) => StoreRoute | { kind: 'layout' }) => (c: Context<AppEnv>) =>
      inHostStore(c, (tx) => render(c, tx, localeOf(c), route(c), searchParams(c), 'published'));

  app.openapi(R.layout, page(() => ({ kind: 'layout' })) as never);
  app.openapi(R.home, page(() => ({ kind: 'home' })) as never);
  app.openapi(
    R.product,
    page((c) => ({ kind: 'product', slug: slugOf(c.req.param('slug') ?? '') })) as never,
  );
  app.openapi(
    R.category,
    page((c) => ({ kind: 'category', slug: slugOf(c.req.param('slug') ?? '') })) as never,
  );
  app.openapi(
    R.collection,
    page((c) => ({ kind: 'collection', slug: slugOf(c.req.param('slug') ?? '') })) as never,
  );
  app.openapi(R.search, page(() => ({ kind: 'search' })) as never);
  app.openapi(
    R.page,
    page((c) => ({ kind: 'page', slug: slugOf(c.req.param('slug') ?? '') })) as never,
  );

  app.openapi(R.sitemap, (async (c: Context<AppEnv>) => {
    const part = c.req.param('part') as (typeof SITEMAP_PARTS)[number];
    return inHostStore(c, async (tx) => {
      const layout = await storeLayout(tx, null);
      const result = await sitemapPart(tx, part);
      return respond(
        c,
        {
          defaultLocale: layout.data.store.defaultLocale,
          indexing: layout.data.storefront.indexing,
          entries: result.data,
        },
        200,
        result.tags,
        'published',
      );
    });
  }) as never);

  app.openapi(R.preview, (async (c: Context<AppEnv>) => {
    const params = searchParams(c);
    const token = params.get('token') ?? '';
    const parsed = parseStorePath(params.get('path') ?? '/');
    const check = async (tenantId: string) => {
      const owner = await verifyPreviewToken(token, c.var.config.AUTH_SECRET);
      if (owner !== tenantId) throw new AppError('unauthorized');
    };
    return inHostStore(
      c,
      (tx) =>
        parsed.type === 'route'
          ? render(c, tx, parsed.locale, parsed.route, params, 'draft')
          : render(c, tx, null, { kind: 'layout' }, params, 'draft'),
      check,
    );
  }) as never);
}
