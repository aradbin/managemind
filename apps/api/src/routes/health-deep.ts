// GET /health/deep: checks the database through Hyperdrive. For an hourly
// check only; the uptime monitor uses /health, which never wakes Neon.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { withClient } from '../db';
import type { AppEnv } from '../env';
import { log } from '../log';

const DeepHealth = z
  .object({ status: z.enum(['ok', 'unavailable']), database_ms: z.number().nullable() })
  .openapi('DeepHealth');

const route = createRoute({
  method: 'get',
  path: '/health/deep',
  tags: ['system'],
  summary: 'Database check (wakes Neon; hourly use only)',
  responses: {
    200: {
      content: { 'application/json': { schema: DeepHealth } },
      description: 'Database reachable',
    },
    503: {
      content: { 'application/json': { schema: DeepHealth } },
      description: 'Database unreachable',
    },
  },
});

export function registerDeepHealth(app: OpenAPIHono<AppEnv>): void {
  app.openapi(route, async (c) => {
    const started = Date.now();
    try {
      await withClient(c.env, c.executionCtx, (client) => client.query('select 1'));
      return c.json({ status: 'ok' as const, database_ms: Date.now() - started }, 200);
    } catch (e) {
      log('error', 'deep health check failed', {
        request_id: c.var.requestId,
        error: e instanceof Error ? e.message : String(e),
      });
      return c.json({ status: 'unavailable' as const, database_ms: null }, 503);
    }
  });
}
