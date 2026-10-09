// GET /v1/store/context: which store a hostname belongs to. The storefront
// calls it over its service binding with the shopper's host in
// X-Forwarded-Host. Phase 0 knows `{slug}.<STORE_DOMAIN>`; custom domains
// (tenant_domains, KV cache) arrive in Phases 1 and 3.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { createDb, schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { and, eq } from 'drizzle-orm';
import { withClient } from '../db';
import type { AppEnv } from '../env';

const StoreContext = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    defaultLocale: z.enum(['bn', 'en']),
  })
  .openapi('StoreContext');

const route = createRoute({
  method: 'get',
  path: '/v1/store/context',
  tags: ['store'],
  summary: 'Resolve a store hostname to its store',
  request: {
    headers: z.object({
      'x-forwarded-host': z.string().min(1).max(253).openapi({ example: 'demo-fashion.localhost' }),
    }),
  },
  responses: {
    200: { content: { 'application/json': { schema: StoreContext } }, description: 'The store' },
    404: { description: 'No active store at this host' },
  },
});

/** "Demo-Fashion.example.com:443" under "example.com" -> "demo-fashion". */
export function slugFromHost(host: string, storeDomain: string): string | null {
  const name = host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const suffix = `.${storeDomain}`;
  if (!name.endsWith(suffix)) return null;
  const slug = name.slice(0, -suffix.length);
  return /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(slug) ? slug : null;
}

export function registerStoreContext(app: OpenAPIHono<AppEnv>): void {
  app.openapi(route, async (c) => {
    const host = c.req.valid('header')['x-forwarded-host'];
    const slug = slugFromHost(host, c.var.config.STORE_DOMAIN);
    if (!slug) throw new AppError('store_not_found');
    const t = schema.tenants;
    const [store] = await withClient(c.env, c.executionCtx, (client) =>
      createDb(client)
        .select({ id: t.id, slug: t.slug, name: t.name, defaultLocale: t.defaultLocale })
        .from(t)
        .where(and(eq(t.slug, slug), eq(t.status, 'active'))),
    );
    if (!store) throw new AppError('store_not_found');
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(store, 200);
  });
}
