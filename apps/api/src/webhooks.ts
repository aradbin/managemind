// SSLCommerz's IPN (phase-5a-plan §3.5), on the API's own host. The posted
// fields are never trusted: only the val_id is used, to ask SSLCommerz for
// the validation with the store's credentials. 200 once handled (settled,
// already settled, or refused); 500 when SSLCommerz can't be reached, so it
// retries. No session or Turnstile: the validation call is the check, and
// a per-IP limit caps forged notifications (429).
import type { OpenAPIHono } from '@hono/zod-openapi';
import { isUuid } from '@managemind/shared';
import { settleInvoicePayment } from './billing';
import type { AppEnv } from './env';
import { log } from './log';
import { settleFromGateway } from './payments';
import { limiterFor, shopperIp } from './store/commerce';

export function registerWebhooks(app: OpenAPIHono<AppEnv>): void {
  app.use('/v1/webhooks/sslcommerz/*', async (c, next) => {
    await limiterFor(c).check('ipn:ip', shopperIp(c));
    await next();
  });
  // Our own account: invoices paid online (phase-5b-plan §3.7). First, so
  // "platform" never reaches the store route.
  app.post('/v1/webhooks/sslcommerz/platform', async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const valId = typeof form.val_id === 'string' ? form.val_id.slice(0, 100) : '';
    if (!valId || form.status !== 'VALID') return c.text('ok', 200);
    const outcome = await settleInvoicePayment(c.env, c.executionCtx, valId);
    log(outcome.kind === 'refused' ? 'warn' : 'info', 'invoice ipn handled', {
      outcome: outcome.kind,
      ...(outcome.kind === 'refused'
        ? { reason: outcome.reason }
        : { invoice_id: outcome.invoiceId }),
    });
    return c.text('ok', 200);
  });
  app.post('/v1/webhooks/sslcommerz/:tenantId', async (c) => {
    const tenantId = c.req.param('tenantId');
    if (!isUuid(tenantId)) return c.text('not found', 404);
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const valId = typeof form.val_id === 'string' ? form.val_id.slice(0, 100) : '';
    const status = typeof form.status === 'string' ? form.status : '';
    // A failed or cancelled attempt carries no val_id: the delayed check expires it.
    if (!valId || status !== 'VALID') return c.text('ok', 200);
    const outcome = await settleFromGateway(c.env, c.executionCtx, tenantId, valId, 'ipn');
    log('info', 'ipn handled', { tenant_id: tenantId, outcome: outcome.kind });
    return c.text('ok', 200);
  });
}
