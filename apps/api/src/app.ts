// The API application: middleware, routes and the OpenAPI document.
import { OpenAPIHono } from '@hono/zod-openapi';
import { AppError } from '@managemind/shared';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './env';
import { problemResponse, validationError } from './errors';
import { accessLog } from './middleware/access-log';
import { context } from './middleware/context';
import { registerHealth } from './routes/health';

export function createApp(): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>({
    // Request validation failures become validation_failed problems.
    defaultHook: (result, c) => {
      if (!result.success) return problemResponse(c, validationError(result.error));
      return;
    },
  });

  app.use('*', context);
  app.use('*', accessLog);
  app.use('*', secureHeaders({ crossOriginResourcePolicy: 'same-site' }));

  registerHealth(app);

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'managemind API', version: '0.0.0' },
  });

  app.notFound((c) => problemResponse(c, new AppError('not_found')));
  app.onError((error, c) => problemResponse(c, error));
  return app;
}
