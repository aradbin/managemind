// GET /v1/store/context: which store a hostname belongs to. The storefront
// calls it over its service binding with the shopper's host in
// X-Forwarded-Host: an active custom domain, or `{slug}.<STORE_DOMAIN>`
// (ADR 0015). It reads the database and never writes KV, so random hosts
// can't spend KV writes. Suspended stores get their maintenance page in PR 10.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { resolveHost } from '@managemind/core';
import { createDb } from '@managemind/db';
import { AppError } from '@managemind/shared';
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

export function registerStoreContext(app: OpenAPIHono<AppEnv>): void {
  app.openapi(route, async (c) => {
    const host = c.req.valid('header')['x-forwarded-host'];
    const record = await withClient(c.env, c.executionCtx, (client) =>
      resolveHost(createDb(client), host, c.var.config.STORE_DOMAIN),
    );
    if (record?.status !== 'active') throw new AppError('store_not_found');
    const store = {
      id: record.tenantId,
      slug: record.slug,
      name: record.name,
      defaultLocale: record.defaultLocale,
    };
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(store, 200);
  });
}
