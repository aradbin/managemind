// GET /health: liveness only. Never touches the database, so the uptime
// monitor does not keep Neon awake (PLAN.md resource budget).
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '../env';

const Health = z
  .object({
    status: z.literal('ok'),
    environment: z.enum(['development', 'preview', 'production']),
    commit: z.string(),
  })
  .openapi('Health');

const route = createRoute({
  method: 'get',
  path: '/health',
  tags: ['system'],
  summary: 'Liveness check (no database)',
  responses: { 200: { content: { 'application/json': { schema: Health } }, description: 'Alive' } },
});

export function registerHealth(app: OpenAPIHono<AppEnv>): void {
  app.openapi(route, (c) =>
    c.json(
      {
        status: 'ok' as const,
        environment: c.var.config.ENVIRONMENT,
        commit: c.var.config.COMMIT_SHA,
      },
      200,
    ),
  );
}
