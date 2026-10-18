// Online payments in the API (phase-5a-plan §3.3, §3.5): the gateway session
// after checkout, settling from SSLCommerz's own validation (the IPN, the
// shopper's return and the delayed checks all end in settleFromGateway),
// and the 30- and 60-minute checks on the delayed queue.
import {
  type Actor,
  type CreatedRefund,
  expireGatewayPayment,
  gatewayPaymentState,
  gatewaySession,
  loadCredentials,
  relayEvents,
  type SettleOutcome,
  settleGatewayPayment,
  settleGatewayRefund,
  submitGatewayRefund,
  systemActor,
  type TenantTx,
  withTenant,
} from '@managemind/core';
import {
  createSession,
  queryTransaction,
  refundStatus,
  type SslcommerzCredentials,
  refund as sendRefund,
  type Validation,
  validate,
} from '@managemind/providers/sslcommerz';
import { AppError } from '@managemind/shared';
import { captureMessage } from '@sentry/cloudflare';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { storeUrlsFor } from './admin/store-urls';
import { queueSink, withClient } from './db';
import { type Env, getConfig } from './env';
import { log } from './log';
import { credentialsKeyring } from './notifications';

/** A delayed check of one gateway refund still processing (§3.13). */
export interface RefundCheckMessage {
  kind: 'refund_check';
  tenantId: string;
  refundId: string;
  attempt: number;
}

/** Every 30 minutes for a day; SSLCommerz usually settles a refund within hours. */
const REFUND_CHECKS = 48;

/** A delayed check of one online payment (§3.3): at 30 minutes, then at 60. */
export interface PaymentCheckMessage {
  kind: 'payment_check';
  tenantId: string;
  paymentId: string;
  stage: 1 | 2;
}

const CHECK_DELAY_SECONDS = 30 * 60;

/** The store's SSLCommerz account, or null when it has none that passed its check. */
export async function gatewayFor(tx: TenantTx, env: Env): Promise<SslcommerzCredentials | null> {
  const keyring = await credentialsKeyring(env);
  try {
    const saved = await loadCredentials(tx, keyring, 'sslcommerz');
    if (!saved?.mode) return null;
    return {
      storeId: String(saved.secrets.storeId),
      storePassword: String(saved.secrets.storePassword),
      mode: saved.mode,
    };
  } catch (e) {
    log('error', 'gateway credentials unreadable', { tenant_id: tx.tenantId, error: String(e) });
    return null;
  }
}

const relay = (env: Env, client: pg.Client) => ({
  afterCommit: async (events: Parameters<typeof relayEvents>[1]) => {
    await relayEvents(client, events, queueSink(env.OUTBOX));
  },
});

/** Where SSLCommerz sends the IPN: the API's own host (§3.5), not the store's. */
export function ipnUrl(env: Env, tenantId: string, requestHost?: string): string {
  const host = getConfig(env).ADMIN_HOST ?? requestHost ?? 'localhost';
  return `https://${host}/v1/webhooks/sslcommerz/${tenantId}`;
}

/**
 * Starts a gateway session for a pending online payment and schedules its
 * check. Throws when SSLCommerz refuses; the order stays, and the shopper
 * can try again or pay on delivery (§3.3).
 */
export async function startGatewaySession(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  tenantId: string,
  paymentId: string,
  requestHost?: string,
): Promise<string> {
  const config = getConfig(env);
  const { creds, session, returnUrl } = await withClient(env, ctx, (client) =>
    withTenant(client, tenantId, async (tx) => ({
      creds: await gatewayFor(tx, env),
      session: await gatewaySession(tx, paymentId),
      returnUrl: (await storeUrlsFor(config, tx)).page('orders/pay/return'),
    })),
  );
  if (!creds) throw new AppError('feature_unavailable', { detail: 'Online payment is off' });
  const back = (status: string) =>
    `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}status=${status}`;
  const { url } = await createSession(creds, {
    tranId: paymentId,
    amount: session.amount,
    successUrl: back('success'),
    failUrl: back('failed'),
    cancelUrl: back('cancelled'),
    ipnUrl: ipnUrl(env, tenantId, requestHost),
    tenantId,
    productName: `${session.storeName} ${session.orderNumber}`,
    customer: session.customer,
  });
  await env.DOMAINS?.send(
    { kind: 'payment_check', tenantId, paymentId, stage: 1 },
    { delaySeconds: CHECK_DELAY_SECONDS },
  );
  return url;
}

/** The validation's fields as core reads them; null when the amount isn't an amount. */
function toCore(v: Validation) {
  if (v.amount === null) return null;
  return {
    status: v.status,
    tranId: v.tranId,
    valId: v.valId,
    amount: v.amount,
    currency: v.currency,
    tenantId: v.valueA,
    bankTranId: v.bankTranId,
    riskLevel: v.riskLevel,
    cardType: v.cardType,
    cardIssuer: v.cardIssuer,
  };
}

function report(tenantId: string, outcome: SettleOutcome, source: string, valId: string) {
  if (outcome.kind !== 'refused') return;
  // A refusal of a validation that SSLCommerz returned is worth a look: a
  // forged or tampered callback, or a second charge (§3.5).
  log('warn', 'gateway validation refused', {
    tenant_id: tenantId,
    source,
    val_id: valId,
    reason: outcome.reason,
  });
  captureMessage(`Payment validation refused: ${outcome.reason}`, {
    level: 'warning',
    tags: { tenant_id: tenantId, source },
  });
}

/**
 * Settles from a val_id (§3.5): asks SSLCommerz to validate it with the
 * store's credentials, then lets core check and settle. The callback's own
 * fields are never used. Throws only when SSLCommerz can't be reached, so
 * the IPN answers 500 and is retried.
 */
export async function settleFromGateway(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  tenantId: string,
  valId: string,
  source: 'ipn' | 'return',
): Promise<SettleOutcome> {
  return withClient(env, ctx, async (client) => {
    const creds = await withTenant(client, tenantId, (tx) => gatewayFor(tx, env));
    if (!creds) return { kind: 'refused', reason: 'no gateway' };
    const v = toCore(await validate(creds, valId));
    if (!v) return { kind: 'refused', reason: 'no amount' };
    const outcome = await withTenant(
      client,
      tenantId,
      (tx) => settleGatewayPayment(tx, v),
      relay(env, client),
    );
    report(tenantId, outcome, source, valId);
    return outcome;
  });
}

/**
 * The delayed checks (§3.3): at 30 minutes the transaction query settles a
 * payment whose IPN never arrived; at 60 a payment still pending expires
 * and its order is cancelled.
 */
export async function handlePaymentChecks(
  messages: readonly Message<PaymentCheckMessage>[],
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<void> {
  await withClient(env, ctx, async (client) => {
    for (const message of messages) {
      const { tenantId, paymentId, stage } = message.body;
      try {
        const state = await withTenant(client, tenantId, (tx) =>
          gatewayPaymentState(tx, paymentId),
        );
        if (state?.status !== 'pending') {
          message.ack();
          continue;
        }
        const creds = await withTenant(client, tenantId, (tx) => gatewayFor(tx, env));
        const found = creds ? await queryTransaction(creds, paymentId) : null;
        const v = found ? toCore(found) : null;
        if (v) {
          const outcome = await withTenant(
            client,
            tenantId,
            (tx) => settleGatewayPayment(tx, v),
            relay(env, client),
          );
          report(tenantId, outcome, 'check', v.valId);
          log('info', 'payment checked', {
            tenant_id: tenantId,
            payment_id: paymentId,
            outcome: outcome.kind,
          });
        } else if (stage === 1) {
          await env.DOMAINS?.send(
            { ...message.body, stage: 2 },
            { delaySeconds: CHECK_DELAY_SECONDS },
          );
        } else {
          const expired = await withTenant(
            client,
            tenantId,
            (tx) => expireGatewayPayment(tx, paymentId),
            relay(env, client),
          );
          log('info', 'payment expired', { tenant_id: tenantId, payment_id: paymentId, expired });
        }
        message.ack();
      } catch (e) {
        log('error', 'payment check failed', {
          tenant_id: tenantId,
          payment_id: paymentId,
          error: String(e),
        });
        message.retry();
      }
    }
  });
}

/**
 * Sends a gateway refund to SSLCommerz after it was recorded (§3.13), and
 * records the answer: processing (checked every 30 minutes), done, or
 * failed with SSLCommerz's reason, after which staff can refund another way
 * or record one made in the SSLCommerz panel.
 */
export async function sendGatewayRefund(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  tenantId: string,
  actor: Actor,
  refund: CreatedRefund,
): Promise<'processing' | 'succeeded' | 'failed'> {
  if (refund.method !== 'gateway' || !refund.gateway) return 'succeeded';
  const gateway = refund.gateway;
  return withClient(env, ctx, async (client) => {
    const creds = await withTenant(client, tenantId, (tx) => gatewayFor(tx, env));
    let answer: { refundRefId: string; done: boolean } | { error: string };
    if (!creds) answer = { error: 'SSLCommerz is not set up' };
    else {
      try {
        const sent = await sendRefund(creds, {
          bankTranId: gateway.bankTranId,
          refundTransId: refund.id,
          amount: refund.amount,
          remarks: 'Refund',
        });
        answer =
          sent.status === 'failed'
            ? { error: sent.error }
            : { refundRefId: sent.refundRefId, done: sent.status === 'success' };
      } catch (e) {
        answer = { error: `SSLCommerz could not be reached: ${String(e)}`.slice(0, 300) };
      }
    }
    await withTenant(
      client,
      tenantId,
      (tx) => submitGatewayRefund(tx, actor, refund.id, answer),
      relay(env, client),
    );
    if ('error' in answer) {
      log('warn', 'gateway refund refused', { tenant_id: tenantId, refund_id: refund.id });
      return 'failed';
    }
    if (answer.done) return 'succeeded';
    await env.DOMAINS?.send(
      { kind: 'refund_check', tenantId, refundId: refund.id, attempt: 1 },
      { delaySeconds: CHECK_DELAY_SECONDS },
    );
    return 'processing';
  });
}

/** Asks SSLCommerz how a processing refund stands, and settles or checks again later. */
export async function handleRefundChecks(
  messages: readonly Message<RefundCheckMessage>[],
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<void> {
  await withClient(env, ctx, async (client) => {
    for (const message of messages) {
      const { tenantId, refundId, attempt } = message.body;
      try {
        const found = await withTenant(client, tenantId, async (tx) => ({
          creds: await gatewayFor(tx, env),
          row: (
            await tx.db.execute<{ status: string; ref: string | null }>(
              sql`select status, gateway_refund_ref as ref from store.refunds where id = ${refundId}`,
            )
          ).rows[0],
        }));
        if (found.row?.status !== 'processing' || !found.row.ref || !found.creds) {
          message.ack();
          continue;
        }
        const status = await refundStatus(found.creds, found.row.ref);
        if (status === 'refunded' || status === 'cancelled') {
          await withTenant(
            client,
            tenantId,
            (tx) => settleGatewayRefund(tx, systemActor, refundId, status),
            relay(env, client),
          );
        } else if (attempt < REFUND_CHECKS) {
          await env.DOMAINS?.send(
            { ...message.body, attempt: attempt + 1 },
            { delaySeconds: CHECK_DELAY_SECONDS },
          );
        } else {
          log('warn', 'gateway refund still processing after a day', {
            tenant_id: tenantId,
            refund_id: refundId,
          });
        }
        message.ack();
      } catch (e) {
        log('error', 'refund check failed', {
          tenant_id: tenantId,
          refund_id: refundId,
          error: String(e),
        });
        message.retry();
      }
    }
  });
}
