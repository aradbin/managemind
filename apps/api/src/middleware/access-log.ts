// One access log line per request. Successful requests are sampled in
// production (LOG_SAMPLE_RATE); 4xx and 5xx are always kept.
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { log } from '../log';

export const accessLog = createMiddleware<AppEnv>(async (c, next) => {
  const started = Date.now();
  await next();
  const status = c.res.status;
  const rate = c.var.config?.LOG_SAMPLE_RATE ?? 1;
  if (status < 400 && Math.random() >= rate) return;
  const cf = (c.req.raw as { cf?: { colo?: string } }).cf;
  log(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'request', {
    request_id: c.var.requestId,
    method: c.req.method,
    route: c.req.routePath,
    status,
    duration_ms: Date.now() - started,
    colo: cf?.colo,
    tenant_id: c.var.tenantId,
    user_id: c.var.userId,
  });
});
