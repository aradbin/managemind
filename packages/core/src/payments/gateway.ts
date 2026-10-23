// Online payments through the store's gateway (phase-5a-plan §3.3, §3.5).
// The API talks to SSLCommerz; this module decides. A payment settles only
// from the gateway's own validation answer, never from what a callback
// says, and only when it is this store's pending (or expired) payment for
// exactly that amount in BDT. A replay settles nothing twice: the payment
// row is locked and its val_id is unique.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { paymentMachine } from '@managemind/shared/orders';
import { eq, sql } from 'drizzle-orm';
import { type Actor, authorize, systemActor } from '../access';
import { cancelOrder, refreshOrder, syncCodAmount } from '../orders/lifecycle';
import { MIN_ONLINE_AMOUNT } from '../orders/place';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';

/** The system acting on a gateway's answer: it may cancel an unpaid order. */
const gatewayActor: Actor = { ...systemActor, permissions: new Set(['orders.write']) };

/** What a gateway session needs from the order (SSLCommerz's required fields). */
export interface GatewaySession {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  amount: number;
  locale: 'bn' | 'en';
  customer: { name: string; phone: string; email: string | null; address: string; city: string };
  storeName: string;
}

export async function gatewaySession(tx: TenantTx, paymentId: string): Promise<GatewaySession> {
  const { rows } = await tx.db.execute<{
    id: string;
    order_id: string;
    amount: string;
    status: string;
    provider: string;
    number: string;
    contact: { name: string; phone: string; email?: string };
    shipping_address: { line?: string; names?: { district?: { en?: string } } } | null;
    locale: 'bn' | 'en';
    order_status: string;
    prefix: string | null;
    store_name: string;
  }>(sql`
    select p.id, p.order_id, p.amount, p.status, p.provider, o.number, o.contact,
           o.address as shipping_address, o.locale, o.status as order_status,
           t.settings #>> '{checkout,orderNumberPrefix}' as prefix, t.name as store_name
      from store.payments p
      join store.orders o on o.id = p.order_id
      join platform.tenants t on t.id = o.tenant_id
     where p.id = ${paymentId}`);
  const r = rows[0];
  if (r?.provider !== 'sslcommerz') throw new AppError('not_found');
  if (r.status !== 'pending' || r.order_status === 'cancelled') {
    throw new AppError('conflict', { detail: 'This payment is no longer waiting' });
  }
  return {
    paymentId: r.id,
    orderId: r.order_id,
    orderNumber: `${r.prefix ?? '#'}${r.number}`,
    amount: Number(r.amount),
    locale: r.locale,
    customer: {
      name: r.contact.name,
      phone: r.contact.phone,
      email: r.contact.email ?? null,
      address: r.shipping_address?.line ?? '',
      city: r.shipping_address?.names?.district?.en ?? 'Dhaka',
    },
    storeName: r.store_name,
  };
}

/** The gateway's validation answer, already parsed by the adapter. */
export interface GatewayValidation {
  status: string;
  tranId: string;
  valId: string;
  /** In poisha, parsed exactly from the gateway's decimal string. */
  amount: number;
  currency: string;
  /** value_a: the tenant the session was made for. */
  tenantId: string | null;
  bankTranId: string | null;
  riskLevel: number | null;
  cardType: string | null;
  cardIssuer: string | null;
}

export type SettleOutcome =
  | { kind: 'settled'; orderId: string; problem: 'risky' | 'late' | null }
  | { kind: 'already'; orderId: string }
  | { kind: 'refused'; reason: string };

const VALID = new Set(['VALID', 'VALIDATED']);

/**
 * Settles a payment from the gateway's validation (§3.5): the IPN, the
 * shopper's return and the delayed check all end here. Refusals change
 * nothing and say why, for the log and Sentry.
 */
export async function settleGatewayPayment(
  tx: TenantTx,
  v: GatewayValidation,
): Promise<SettleOutcome> {
  if (!VALID.has(v.status)) return { kind: 'refused', reason: `status ${v.status}` };
  if (v.tenantId !== tx.tenantId) return { kind: 'refused', reason: 'another store' };
  if (v.currency !== 'BDT') return { kind: 'refused', reason: `currency ${v.currency}` };
  const p = schema.payments;
  const [payment] = await tx.db
    .select({
      id: p.id,
      orderId: p.orderId,
      provider: p.provider,
      status: p.status,
      amount: p.amount,
      valId: p.gatewayValId,
    })
    .from(p)
    .where(eq(p.id, v.tranId))
    .for('update');
  if (payment?.provider !== 'sslcommerz') {
    return { kind: 'refused', reason: 'unknown transaction' };
  }
  if (payment.status === 'paid') {
    // The same validation again: done. Another val_id for a paid payment is a second
    // charge at the gateway, which staff must see.
    if (payment.valId === v.valId) return { kind: 'already', orderId: payment.orderId };
    return { kind: 'refused', reason: 'already paid with another validation' };
  }
  if (!paymentMachine.can(payment.status, 'settle', undefined)) {
    return { kind: 'refused', reason: `payment is ${payment.status}` };
  }
  if (v.amount !== Number(payment.amount)) {
    return { kind: 'refused', reason: `amount ${v.amount} for ${payment.amount}` };
  }

  const late = payment.status === 'expired';
  const risky = v.riskLevel === 1;
  await tx.db
    .update(p)
    .set({
      status: 'paid',
      settledAt: sql`now()`,
      gatewayValId: v.valId,
      gatewayBankTranId: v.bankTranId,
      riskLevel: v.riskLevel,
      metadata: { cardType: v.cardType, cardIssuer: v.cardIssuer },
    })
    .where(eq(p.id, payment.id));
  const order = await refreshOrder(tx, gatewayActor, payment.orderId);
  // What's left to collect on delivery drops by what was paid online (a
  // payment link, §3.3 step 7). A cancelled order collects nothing.
  if (order.status !== 'cancelled') await syncCodAmount(tx, payment.orderId, order.total);
  const problem = late ? 'late' : risky ? 'risky' : null;
  if (problem) {
    const flag = late ? 'late_payment' : 'payment_risk';
    await tx.db.execute(sql`
      update store.orders set flags = array(select distinct unnest(array_append(flags, ${flag}::text)))
       where id = ${payment.orderId}`);
  }
  await emit(tx, 'payment.settled', {
    aggregateType: 'payment',
    aggregateId: payment.id,
    payload: {
      orderId: payment.orderId,
      amount: Number(payment.amount),
      ...(problem ? { problem } : {}),
    },
  });
  return { kind: 'settled', orderId: payment.orderId, problem };
}

/** A pending online payment's age and state, for the delayed checks (§3.3). */
export async function gatewayPaymentState(
  tx: TenantTx,
  paymentId: string,
): Promise<{ status: string; orderId: string } | null> {
  const p = schema.payments;
  const [row] = await tx.db
    .select({ status: p.status, orderId: p.orderId, provider: p.provider })
    .from(p)
    .where(eq(p.id, paymentId));
  return row && row.provider === 'sslcommerz' ? { status: row.status, orderId: row.orderId } : null;
}

/**
 * At 60 minutes (§3.3, Q4): a payment still pending expires, and its order
 * is cancelled, releasing the stock (not for a payment link). The shopper hears "payment not
 * received" once, not also "cancelled". A late IPN can still settle it.
 */
export async function expireGatewayPayment(tx: TenantTx, paymentId: string): Promise<boolean> {
  const p = schema.payments;
  const [payment] = await tx.db
    .select({ status: p.status, orderId: p.orderId, provider: p.provider, metadata: p.metadata })
    .from(p)
    .where(eq(p.id, paymentId))
    .for('update');
  if (payment?.provider !== 'sslcommerz' || payment.status !== 'pending') return false;
  await tx.db.update(p).set({ status: 'expired' }).where(eq(p.id, paymentId));
  // A payment link was extra: the order stands, with the rest due on delivery.
  if ((payment.metadata as { link?: boolean }).link) return true;
  const [order] = await tx.db
    .select({ status: schema.orders.status })
    .from(schema.orders)
    .where(eq(schema.orders.id, payment.orderId));
  if (order && order.status !== 'cancelled' && order.status !== 'completed') {
    await cancelOrder(tx, gatewayActor, payment.orderId, {
      reason: 'Online payment not received',
      cause: 'payment_expired',
    });
  }
  return true;
}

/** The order of an online payment, and whether it is paid: for the shopper's return (§3.3). */
export async function orderOfGatewayPayment(
  tx: TenantTx,
  paymentId: string,
): Promise<{ orderId: string; paid: boolean } | null> {
  const state = await gatewayPaymentState(tx, paymentId);
  return state ? { orderId: state.orderId, paid: state.status === 'paid' } : null;
}

/** An order's online payment still waiting, for "pay now" (§3.3, §8). */
export async function pendingGatewayPayment(tx: TenantTx, orderId: string): Promise<string | null> {
  const { rows } = await tx.db.execute<{ id: string }>(sql`
    select p.id from store.payments p join store.orders o on o.id = p.order_id
     where p.order_id = ${orderId} and p.provider = 'sslcommerz' and p.status = 'pending'
       and o.status <> 'cancelled'
     order by p.created_at desc limit 1`);
  return rows[0]?.id ?? null;
}

/**
 * A payment link from the order page (§3.3 step 7): a pending online payment
 * for what's unpaid, which the shopper pays from the link. A link already
 * waiting is reused, so sending it twice can't charge twice.
 */
export async function createPaymentLink(
  tx: TenantTx,
  actor: Actor,
  orderId: string,
): Promise<{ paymentId: string; amount: number }> {
  // Owners, managers and staff (§6.3): it adds a payment, so viewers can't.
  authorize(actor, 'payments.read');
  authorize(actor, 'orders.write');
  const [order] = await tx.db
    .select({
      status: schema.orders.status,
      total: schema.orders.total,
      paidTotal: schema.orders.paidTotal,
    })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .for('update');
  if (!order) throw new AppError('not_found');
  if (order.status === 'cancelled' || order.status === 'completed') {
    throw new AppError('illegal_transition', { detail: `The order is ${order.status}` });
  }
  const p = schema.payments;
  const waiting = await pendingGatewayPayment(tx, orderId);
  if (waiting) {
    const [row] = await tx.db.select({ amount: p.amount }).from(p).where(eq(p.id, waiting));
    return { paymentId: waiting, amount: Number(row?.amount ?? 0) };
  }
  const due = Number(order.total) - Number(order.paidTotal);
  if (due < MIN_ONLINE_AMOUNT) {
    throw new AppError('conflict', {
      detail: due <= 0 ? 'The order is paid' : 'Below the gateway’s ৳10 minimum',
    });
  }
  const [row] = await tx.db
    .insert(p)
    .values({
      orderId,
      provider: 'sslcommerz',
      method: 'online',
      amount: due,
      recordedBy: actor.userId,
      metadata: { link: true },
    })
    .returning({ id: p.id });
  if (!row) throw new AppError('internal');
  return { paymentId: row.id, amount: due };
}
