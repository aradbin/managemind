// Our billing in the API (phase-5b-plan §3.7, §3.8): the owners' invoice and
// reminder emails from the outbox, and the SSLCommerz payment link on our
// own merchant account. The link stays off until PLATFORM_SSLCOMMERZ_* exist.
// As in Phase 5A, a payment settles only on SSLCommerz's own validation: the
// invoice in value_a, BDT, the exact amount due, and a val_id never seen.
import {
  type OutboxEvent,
  reactivateOverdue,
  recordInvoicePaymentInTx,
  relayEvents,
  systemActor,
  withTenant,
} from '@managemind/core';
import { type InvoiceEmailKind, invoiceEmail } from '@managemind/providers/email';
import {
  createSession,
  type SslcommerzCredentials,
  validate,
} from '@managemind/providers/sslcommerz';
import { AppError, isUuid } from '@managemind/shared';
import { dhakaDate } from '@managemind/shared/billing';
import { format, money } from '@managemind/shared/money';
import { createMailer } from './auth/email';
import { queueSink, withClient } from './db';
import { type Env, getConfig } from './env';
import { log } from './log';

type Client = Parameters<Parameters<typeof withClient>[2]>[0];

export const sendsBillingEmail = (e: OutboxEvent) =>
  e.eventType === 'invoice.issued' || e.eventType === 'invoice.reminder';

/** Emails the owners about an issued invoice or a reminder step, each in their language. */
export async function billingEmails(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  event: OutboxEvent,
): Promise<void> {
  const config = getConfig(env);
  const payload = event.payload as { invoiceId: string; step?: InvoiceEmailKind };
  const kind: InvoiceEmailKind =
    event.eventType === 'invoice.issued' ? 'issued' : (payload.step ?? 'due_soon');
  await withClient(env, ctx, async (client) => {
    const { rows } = await client.query<{
      number: string | null;
      total: number;
      amount_paid: number;
      due_on: string | null;
      status: string;
      store: string;
    }>(
      `select i.number, i.total, i.amount_paid, i.due_on::text, i.status, t.name as store
         from platform.invoices i join platform.tenants t on t.id = i.tenant_id where i.id = $1`,
      [payload.invoiceId],
    );
    const inv = rows[0];
    // Paid or void since: nothing to remind about.
    if (!inv?.number || !inv.due_on || inv.status !== 'issued') return;
    const owners = await client.query<{ email: string; locale: 'bn' | 'en' }>(
      `select u.email, u.locale from platform.memberships m join platform.users u on u.id = m.user_id
        where m.tenant_id = $1 and m.role = 'owner'`,
      [event.tenantId],
    );
    const mailer = createMailer(env, config, ctx);
    for (const owner of owners.rows) {
      mailer.sendLater(
        {
          to: owner.email,
          ...invoiceEmail({
            kind,
            locale: owner.locale,
            platformName: config.PLATFORM_NAME,
            storeName: inv.store,
            number: inv.number,
            amount: format(money(inv.total - inv.amount_paid), owner.locale),
            due: new Date(`${inv.due_on}T00:00:00+06:00`),
            link: `https://${config.ADMIN_HOST ?? config.PLATFORM_DOMAIN}/settings/billing`,
          }),
        },
        `invoice_${kind}`,
      );
    }
  });
}

/** Our own merchant account, or null while it doesn't exist (the link is off). */
export function platformGateway(env: Env): SslcommerzCredentials | null {
  if (!env.PLATFORM_SSLCOMMERZ_STORE_ID || !env.PLATFORM_SSLCOMMERZ_PASSWORD) return null;
  return {
    storeId: env.PLATFORM_SSLCOMMERZ_STORE_ID,
    storePassword: env.PLATFORM_SSLCOMMERZ_PASSWORD,
    mode: env.PLATFORM_SSLCOMMERZ_MODE === 'sandbox' ? 'sandbox' : 'live',
  };
}

/** Starts an SSLCommerz session for what is due on one of the store's invoices. */
export async function startInvoicePayment(
  env: Env,
  client: Client,
  tenantId: string,
  invoiceId: string,
  origin: { api: string; admin: string },
  f: typeof fetch = fetch,
): Promise<{ url: string }> {
  const { rows } = await client.query<{
    total: number;
    amount_paid: number;
    status: string;
    number: string | null;
    store: string;
    email: string | null;
  }>(
    `select i.total, i.amount_paid, i.status, i.number, t.name as store,
            (select u.email from platform.memberships m join platform.users u on u.id = m.user_id
              where m.tenant_id = t.id and m.role = 'owner' limit 1) as email
       from platform.invoices i join platform.tenants t on t.id = i.tenant_id
      where i.id = $1 and i.tenant_id = $2`,
    [invoiceId, tenantId],
  );
  const inv = rows[0];
  if (!inv || inv.status === 'draft') throw new AppError('not_found');
  if (inv.status !== 'issued') {
    throw new AppError('illegal_transition', { detail: `the invoice is ${inv.status}` });
  }
  // Checked after the invoice, so another store's invoice is a 404 either way.
  const gateway = platformGateway(env);
  if (!gateway) {
    throw new AppError('feature_unavailable', {
      detail: 'Online payment of invoices is not set up yet',
    });
  }
  const due = inv.total - inv.amount_paid;
  const back = `${origin.admin}/settings/billing?invoice=${invoiceId}`;
  const session = await createSession(
    gateway,
    {
      // One session per attempt; the invoice rides in value_a.
      tranId: `${invoiceId.replace(/-/g, '').slice(0, 20)}${Date.now().toString(36)}`,
      amount: due,
      successUrl: back,
      failUrl: back,
      cancelUrl: back,
      ipnUrl: `${origin.api}/v1/webhooks/sslcommerz/platform`,
      tenantId: invoiceId,
      productName: `Invoice ${inv.number ?? ''}`,
      customer: {
        name: inv.store,
        phone: '01700000000',
        email: inv.email,
        address: 'Dhaka',
        city: 'Dhaka',
      },
    },
    f,
  );
  return { url: session.url };
}

export type InvoiceSettlement =
  | { kind: 'paid'; invoiceId: string }
  | { kind: 'already'; invoiceId: string }
  | { kind: 'refused'; reason: string };

/**
 * The IPN for our own account: validated with SSLCommerz, then recorded as
 * a payment of exactly what is due. A replayed val_id is refused by the
 * unique index; a different amount, currency or invoice is refused and logged.
 */
export async function settleInvoicePayment(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  valId: string,
  f: typeof fetch = fetch,
): Promise<InvoiceSettlement> {
  const gateway = platformGateway(env);
  if (!gateway) return { kind: 'refused', reason: 'not set up' };
  const v = await validate(gateway, valId, f);
  if (v.status !== 'VALID' && v.status !== 'VALIDATED')
    return { kind: 'refused', reason: `status ${v.status}` };
  if (v.currency !== 'BDT') return { kind: 'refused', reason: 'currency' };
  const invoiceId = v.valueA ?? '';
  if (!isUuid(invoiceId)) return { kind: 'refused', reason: 'no invoice' };
  return withClient(env, ctx, async (client) => {
    const { rows } = await client.query<{
      tenant_id: string;
      total: number;
      amount_paid: number;
      status: string;
    }>('select tenant_id, total, amount_paid, status from platform.invoices where id = $1', [
      invoiceId,
    ]);
    const inv = rows[0];
    if (!inv) return { kind: 'refused', reason: 'unknown invoice' } as const;
    const seen = await client.query(
      'select 1 from platform.billing_payments where gateway_val_id = $1',
      [valId],
    );
    if (seen.rowCount) return { kind: 'already', invoiceId } as const;
    if (inv.status !== 'issued')
      return { kind: 'refused', reason: `invoice ${inv.status}` } as const;
    if (v.amount !== inv.total - inv.amount_paid)
      return { kind: 'refused', reason: 'amount' } as const;
    const today = dhakaDate(new Date());
    const result = await withTenant(
      client,
      inv.tenant_id,
      (tx) =>
        recordInvoicePaymentInTx(
          tx,
          systemActor,
          invoiceId,
          {
            amount: v.amount as number,
            method: 'sslcommerz',
            reference: v.bankTranId ?? v.tranId,
            paidOn: today,
            gatewayTranId: v.tranId,
            gatewayValId: v.valId,
          },
          today,
        ),
      {
        afterCommit: (events) => relayEvents(client, events, queueSink(env.OUTBOX)).then(() => {}),
      },
    );
    if (result.reactivate) await reactivateOverdue(client, inv.tenant_id);
    log('info', 'invoice paid online', { invoice_id: invoiceId });
    return { kind: 'paid', invoiceId } as const;
  });
}
