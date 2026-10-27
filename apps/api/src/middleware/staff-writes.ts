// CSRF for staff auth and the admin and platform APIs (phase-1-plan §5.5): a
// write must come from the admin's origin and be JSON, which a cross-site
// form can't send without a preflight. Better Auth also checks its routes
// against trustedOrigins, but only when a cookie is sent.
import { AppError } from '@managemind/shared';
import { createMiddleware } from 'hono/factory';
import { adminOrigin } from '../auth/routes';
import type { AppEnv } from '../env';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Image uploads send the file itself (ADR 0016); a cross-site form can't send these types either. */
// As /v1/admin/... or, on the admin host, /api/admin/... (app.ts).
const UPLOAD = /^\/(?:v1|api)\/admin\/media\/files\/[^/]+$/;
/** An expense's receipt photo (phase-8-plan §3.6). */
const RECEIPT = /^\/(?:v1|api)\/admin\/expenses\/[0-9a-f-]{36}\/receipt$/;
const IMAGE_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);

export const staffWrites = createMiddleware<AppEnv>(async (c, next) => {
  if (!SAFE.has(c.req.method)) {
    if (c.req.header('origin') !== adminOrigin(c)) throw new AppError('forbidden');
    const hasBody = c.req.header('content-length') !== '0' && c.req.raw.body !== null;
    const type = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase();
    const allowed =
      type === 'application/json' ||
      (c.req.method === 'PUT' && UPLOAD.test(c.req.path) && IMAGE_TYPES.has(type ?? '')) ||
      (c.req.method === 'POST' && RECEIPT.test(c.req.path) && IMAGE_TYPES.has(type ?? ''));
    if (hasBody && !allowed) throw new AppError('forbidden');
  }
  await next();
});
