// SSLCommerz's IPN (phase-5a-plan §3.5), on the API's own host. The posted
// fields are never trusted: only the val_id is used, to ask SSLCommerz for
// the validation with the store's credentials. 200 once handled (settled,
// already settled, or refused); 500 when SSLCommerz can't be reached, so it
// retries. No session or Turnstile: the validation call is the check, and
// a per-IP limit caps forged notifications (429).
import type { OpenAPIHono } from '@hono/zod-openapi';
import { isUuid } from '@managemind/shared';
import { settleInvoicePayment } from './billing';
import { courierFromParam, handleCourierWebhook } from './couriers';
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

  // Couriers (phase-7-plan §3.5): the webhook names a parcel; the courier is
  // asked about it with the store's own keys. 404 for a store or courier
  // that isn't connected, 401 for a wrong secret, 500 when the courier
  // couldn't be asked, so it sends the webhook again.
  app.use('/v1/webhooks/couriers/*', async (c, next) => {
    await limiterFor(c).check('courier_webhook:ip', shopperIp(c));
    await next();
  });
  app.post('/v1/webhooks/couriers/:courier/:tenantId', async (c) => {
    const tenantId = c.req.param('tenantId');
    if (!isUuid(tenantId)) return c.text('not found', 404);
    let courier: ReturnType<typeof courierFromParam>;
    try {
      courier = courierFromParam(c.env, c.req.param('courier'));
    } catch {
      return c.text('not found', 404);
    }
    // Refused before reading when the courier says how big it is; checked again after.
    if (Number(c.req.header('content-length') ?? 0) > MAX_WEBHOOK_BYTES) {
      return c.text('too large', 413);
    }
    const raw = await c.req.text();
    if (raw.length > MAX_WEBHOOK_BYTES) return c.text('too large', 413);
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = Object.fromEntries(new URLSearchParams(raw));
    }
    const outcome = await handleCourierWebhook(c.env, c.executionCtx, courier, tenantId, {
      headers: c.req.raw.headers,
      raw,
      body,
    });
    if (outcome.status === 'not_found') return c.text('not found', 404);
    if (outcome.status === 'refused') return c.text('unauthorized', 401);
    if (outcome.status === 'retry') return c.text('try again', 500);
    if (outcome.status === 'ok' && outcome.reply) {
      return c.body(null, outcome.reply.status as 202, outcome.reply.headers);
    }
    return c.text('ok', 200);
  });
}

/** Courier webhooks are small JSON bodies; anything larger isn't one. */
const MAX_WEBHOOK_BYTES = 16 * 1024;
