// The API application: middleware, routes and the OpenAPI document.
import { OpenAPIHono } from '@hono/zod-openapi';
import { AppError } from '@managemind/shared';
import { secureHeaders } from 'hono/secure-headers';
import { getPath } from 'hono/utils/url';
import { registerAdmin } from './admin/routes';
import { registerAuth } from './auth/routes';
import type { AppEnv } from './env';
import { problemResponse, validationError } from './errors';
import { accessLog } from './middleware/access-log';
import { context } from './middleware/context';
import { staffWrites } from './middleware/staff-writes';
import { registerPlatform } from './platform/routes';
import { registerDevMailbox } from './routes/dev-mailbox';
import { registerHealth } from './routes/health';
import { registerDeepHealth } from './routes/health-deep';
import { registerStoreContext } from './routes/store-context';
import { registerAccount } from './store/account';
import { registerCommerce } from './store/commerce';
import { registerCheckoutOtp } from './store/otp';
import { registerStorePages } from './store/pages';
import { registerShopperReturns } from './store/returns';
import { registerExports } from './tenant-jobs';
import { registerWebhooks } from './webhooks';

/**
 * The admin reaches the API under its own host as /api/* (phase-1-plan §3.5):
 * /api/admin/* and /api/platform/* are routed as /v1/admin/* and
 * /v1/platform/*. /api/auth/* is Better Auth's own base path.
 */
export function apiPath(path: string): string {
  const match = /^\/api\/(admin|platform)(\/.*)?$/.exec(path);
  return match ? `/v1/${match[1]}${match[2] ?? ''}` : path;
}

export function createApp(): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>({
    getPath: (request) => apiPath(getPath(request)),
    // Request validation failures become validation_failed problems.
    defaultHook: (result, c) => {
      if (!result.success) return problemResponse(c, validationError(result.error));
      return;
    },
  });

  app.use('*', context);
  app.use('*', accessLog);
  app.use('*', secureHeaders({ crossOriginResourcePolicy: 'same-site' }));

  // Better Auth checks Origin only when a cookie is sent; every staff write is checked here.
  app.use('/api/auth/*', staffWrites);
  app.use('/v1/admin/*', staffWrites);
  app.use('/v1/platform/*', staffWrites);

  registerHealth(app);
  registerDeepHealth(app);
  registerStoreContext(app);
  registerStorePages(app);
  registerCommerce(app);
  registerShopperReturns(app);
  registerCheckoutOtp(app);
  registerWebhooks(app);
  registerExports(app);
  registerAccount(app);
  registerAuth(app);
  registerAdmin(app);
  registerPlatform(app);
  registerDevMailbox(app);

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'managemind API', version: '0.0.0' },
  });

  app.notFound((c) => problemResponse(c, new AppError('not_found')));
  app.onError((error, c) => problemResponse(c, error));
  return app;
}
