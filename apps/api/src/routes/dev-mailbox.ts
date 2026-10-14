// GET /v1/_dev/mailbox?to=: emails the capture provider saved (phase-1-plan
// §3.8), for local development, previews and Playwright, which read sign-in
// codes and invitation links here. It answers 404 in production, and
// outside local development only with the DEV_TOKEN header. Not in the
// OpenAPI document.

import type { OpenAPIHono } from '@hono/zod-openapi';
import { AppError } from '@managemind/shared';
import { withClient } from '../db';
import type { AppEnv } from '../env';

/** Compares in time independent of where the strings differ. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function registerDevMailbox(app: OpenAPIHono<AppEnv>): void {
  app.get('/v1/_dev/mailbox', async (c) => {
    const { ENVIRONMENT, DEV_TOKEN } = c.var.config;
    if (ENVIRONMENT === 'production') throw new AppError('not_found');
    if (ENVIRONMENT !== 'development') {
      const given = c.req.header('x-dev-token') ?? '';
      if (!DEV_TOKEN || !sameSecret(given, DEV_TOKEN)) throw new AppError('not_found');
    }
    const to = c.req.query('to')?.trim().toLowerCase();
    if (!to)
      throw new AppError('validation_failed', {
        fields: [{ path: 'to', code: 'required', message: 'required' }],
      });
    const { rows } = await withClient(c.env, c.executionCtx, (client) =>
      client.query(
        `select id, "to", subject, text, html, created_at as "createdAt"
           from platform.dev_emails where "to" = $1 order by created_at desc limit 20`,
        [to],
      ),
    );
    c.header('Cache-Control', 'no-store');
    return c.json(rows, 200);
  });
}
