// Refunds and store credit (phase-5a-plan §3.13). The amount is computed,
// then confirmed: each returned unit refunds its cumulative share of its
// line's total (which carries its discounts and VAT), and the delivery fee
// comes back only under the policy. Staff can lower it with a reason, never
// raise it, and no refund takes more than was paid and not yet refunded.
// The order is locked throughout, so two refunds at once can't both pass.
//
// A manual refund (bKash, bank, cash…) is recorded as done. A gateway
// refund is created pending here, sent to SSLCommerz by the API outside
// the transaction, and then moves to processing, succeeded or failed. Store
// credit is a single-use code for the customer's phone.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  type RefundMethod,
  refundInput,
  refundMachine,
  refundPreviewInput,
  refundShare,
} from '@managemind/shared/orders';
import { and, eq, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput } from '../catalog/common';
import { recordHistory } from '../orders/history';
import { lockOrder, refreshOrder } from '../orders/lifecycle';
import { emit } from '../outbox';
import { orderSettings } from '../pricing/quote';
import { formatReturnNumber, lockReturn, resolveReturn } from '../returns/service';
import type { TenantTx } from '../tenant';
import { issueStoreCredit } from './store-credit';

const f = schema.refunds;

export interface RefundLinePreview {
  orderLineId: string;
  title: Record<string, string>;
  quantity: number;
  amount: number;
}

export interface RefundPreview {
  returnId: string | null;
  lines: RefundLinePreview[];
  /** The delivery fee part, under the policy (Q10). */
  delivery: number;
  /** Lines and delivery, capped at what's left to refund. */
  amount: number;
  /** Paid and not yet refunded (failed refunds aside). */
  refundable: number;
  /** Online payments that can be refunded through the gateway, with what's left of each. */
  gatewayPayments: { id: string; amount: number; left: number; bankTranId: string | null }[];
}

/** Refunds that count against what was paid: all but failed ones. */
async function refundedSoFar(tx: TenantTx, orderId: string) {
  const { rows } = await tx.db.execute<{ amount: string; delivery: string }>(sql`
    select coalesce(sum(amount), 0) as amount, coalesce(sum(delivery_amount), 0) as delivery
      from store.refunds where order_id = ${orderId} and status <> 'failed'`);
  return { amount: Number(rows[0]?.amount ?? 0), delivery: Number(rows[0]?.delivery ?? 0) };
}

async function gatewayPayments(tx: TenantTx, orderId: string) {
  const { rows } = await tx.db.execute<{
    id: string;
    amount: string;
    refunded: string;
    bank_tran_id: string | null;
  }>(sql`
    select p.id, p.amount, p.gateway_bank_tran_id as bank_tran_id,
           coalesce((select sum(amount) from store.refunds r
                      where r.payment_id = p.id and r.status <> 'failed'), 0) as refunded
      from store.payments p
     where p.order_id = ${orderId} and p.provider = 'sslcommerz' and p.status = 'paid'
     order by p.created_at`);
  return rows.map((p) => ({
    id: p.id,
    amount: Number(p.amount),
    left: Number(p.amount) - Number(p.refunded),
    bankTranId: p.bank_tran_id,
  }));
}

async function computeRefund(
  tx: TenantTx,
  orderId: string,
  returnId: string | null,
): Promise<RefundPreview> {
  const [order] = await tx.db
    .select({
      total: schema.orders.total,
      paidTotal: schema.orders.paidTotal,
      deliveryFee: schema.orders.deliveryFee,
      deliveryDiscount: schema.orders.deliveryDiscount,
    })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId));
  if (!order) throw new AppError('not_found');
  const so = await refundedSoFar(tx, orderId);
  const refundable = Math.max(0, Number(order.paidTotal) - so.amount);
  const gateway = await gatewayPayments(tx, orderId);

  if (!returnId) {
    // No return: an edit left the order overpaid (§3.13).
    const due = Math.max(0, Number(order.paidTotal) - so.amount - Number(order.total));
    return {
      returnId: null,
      lines: [],
      delivery: 0,
      amount: due,
      refundable,
      gatewayPayments: gateway,
    };
  }

  const { rows } = await tx.db.execute<{
    order_line_id: string;
    title: Record<string, string>;
    line_total: string;
    ordered: number;
    quantity: number;
    refunded_line: number;
    refunded_here: number;
  }>(sql`
    select rl.order_line_id, l.title, l.line_total, l.quantity as ordered, rl.quantity,
           coalesce((select sum(fl.quantity) from store.refund_lines fl join store.refunds x on x.id = fl.refund_id
                      where fl.order_line_id = l.id and x.status <> 'failed'), 0)::int as refunded_line,
           coalesce((select sum(fl.quantity) from store.refund_lines fl join store.refunds x on x.id = fl.refund_id
                      where fl.order_line_id = l.id and x.return_id = ${returnId} and x.status <> 'failed'), 0)::int as refunded_here
      from store.return_lines rl join store.order_lines l on l.id = rl.order_line_id
     where rl.return_id = ${returnId} order by l.position`);
  const lines: RefundLinePreview[] = [];
  for (const l of rows) {
    const units = l.quantity - l.refunded_here;
    if (units <= 0) continue;
    lines.push({
      orderLineId: l.order_line_id,
      title: l.title,
      quantity: units,
      amount: refundShare(Number(l.line_total), l.ordered, l.refunded_line, units),
    });
  }

  // The delivery fee comes back only when the whole order has come back for
  // a reason the store pays the return for, and only once (Q10).
  let delivery = 0;
  const { settings } = await orderSettings(tx);
  const [ret] = await tx.db
    .select({ shopperPays: schema.returns.shopperPaysReturn })
    .from(schema.returns)
    .where(eq(schema.returns.id, returnId));
  if (settings.returns.refundDeliveryFee && ret?.shopperPays === false && so.delivery === 0) {
    const { rows: units } = await tx.db.execute<{ ordered: number; refunded: number }>(sql`
      select coalesce((select sum(quantity) from store.order_lines where order_id = ${orderId}), 0)::int as ordered,
             coalesce((select sum(fl.quantity) from store.refund_lines fl join store.refunds x on x.id = fl.refund_id
                        where x.order_id = ${orderId} and x.status <> 'failed'), 0)::int as refunded`);
    const now = lines.reduce((a, l) => a + l.quantity, 0);
    if (lines.length && (units[0]?.refunded ?? 0) + now >= (units[0]?.ordered ?? 0)) {
      delivery = Math.max(0, Number(order.deliveryFee) - Number(order.deliveryDiscount));
    }
  }
  const sum = lines.reduce((a, l) => a + l.amount, 0) + delivery;
  return {
    returnId,
    lines,
    delivery,
    amount: Math.min(sum, refundable),
    refundable,
    gatewayPayments: gateway,
  };
}

export async function previewRefund(
  tx: TenantTx,
  actor: Actor,
  orderId: string,
  input: unknown,
): Promise<RefundPreview> {
  authorize(actor, 'payments.refund');
  const v = parseInput(refundPreviewInput, input);
  if (v.returnId) await checkReturnOfOrder(tx, v.returnId, orderId);
  return computeRefund(tx, orderId, v.returnId ?? null);
}

async function checkReturnOfOrder(tx: TenantTx, returnId: string, orderId: string) {
  const [ret] = await tx.db
    .select({ orderId: schema.returns.orderId })
    .from(schema.returns)
    .where(eq(schema.returns.id, returnId));
  if (ret?.orderId !== orderId) throw new AppError('not_found');
}

const REFERENCE_NEEDED: readonly RefundMethod[] = [
  'bkash',
  'nagad',
  'rocket',
  'bank',
  'gateway_manual',
];

export interface CreatedRefund {
  id: string;
  method: RefundMethod;
  status: 'pending' | 'succeeded';
  amount: number;
  /** For `gateway`: what the API sends to SSLCommerz after commit. */
  gateway: { paymentId: string; bankTranId: string } | null;
  /** For `store_credit`: the code issued. */
  creditCode: string | null;
}

/**
 * Records a refund. Manual methods and store credit are done at once; a
 * gateway refund waits for the API to send it (submitGatewayRefund).
 */
export async function createRefund(
  tx: TenantTx,
  actor: Actor,
  orderId: string,
  input: unknown,
): Promise<CreatedRefund> {
  authorize(actor, 'payments.refund');
  const v = parseInput(refundInput, input);
  const order = await lockOrder(tx, orderId);
  let ret: Awaited<ReturnType<typeof lockReturn>> | null = null;
  if (v.returnId) {
    await checkReturnOfOrder(tx, v.returnId, orderId);
    ret = await lockReturn(tx, v.returnId);
    const exchanged = ret.status === 'resolved' && ret.resolution === 'exchanged';
    if (ret.status !== 'inspected' && !exchanged) {
      throw new AppError('illegal_transition', { detail: 'Inspect the return first' });
    }
  }
  const preview = await computeRefund(tx, orderId, ret?.id ?? null);
  if (preview.amount <= 0) {
    throw new AppError('conflict', { detail: 'Nothing is left to refund' });
  }
  const amount = v.amount ?? preview.amount;
  if (amount > preview.amount) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'amount', code: 'too_high', message: `at most ${preview.amount}` }],
    });
  }
  if (amount < preview.amount && !v.reason) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'reason', code: 'required', message: 'say why the refund is lower' }],
    });
  }
  if (REFERENCE_NEEDED.includes(v.method) && !v.reference) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'reference', code: 'required', message: 'the transaction reference' }],
    });
  }

  let payment: { id: string; bankTranId: string | null; left: number } | null = null;
  if (v.method === 'gateway' || v.method === 'gateway_manual') {
    payment =
      preview.gatewayPayments.find((p) =>
        v.paymentId ? p.id === v.paymentId : p.left >= amount,
      ) ?? null;
    if (!payment) throw new AppError('conflict', { detail: 'No online payment to refund' });
    if (amount > payment.left) {
      throw new AppError('validation_failed', {
        fields: [
          { path: 'amount', code: 'too_high', message: `the payment has ${payment.left} left` },
        ],
      });
    }
    if (v.method === 'gateway' && !payment.bankTranId) {
      throw new AppError('conflict', { detail: 'The payment has no bank transaction to refund' });
    }
  }

  // Its lines record which units it covers, at their computed shares, even
  // when staff lowered the amount: those units are settled either way.
  const delivery = Math.min(preview.delivery, amount);
  const done = v.method !== 'gateway';
  let creditCode: { id: string; code: string } | null = null;
  if (v.method === 'store_credit') {
    creditCode = await issueStoreCredit(tx, order.id, amount);
  }
  const [row] = await tx.db
    .insert(f)
    .values({
      orderId,
      returnId: ret?.id ?? null,
      paymentId: payment?.id ?? null,
      method: v.method,
      status: done ? 'succeeded' : 'pending',
      amount,
      deliveryAmount: delivery,
      reference: v.reference ?? null,
      reason: v.reason ?? null,
      creditCodeId: creditCode?.id ?? null,
      recordedBy: actor.userId,
      processedAt: done ? sql`now()` : null,
    })
    .returning({ id: f.id });
  const id = row?.id as string;
  if (preview.lines.length) {
    await tx.db.insert(schema.refundLines).values(
      preview.lines.map((l) => ({
        refundId: id,
        orderLineId: l.orderLineId,
        quantity: l.quantity,
        amount: l.amount,
      })),
    );
  }
  await recordHistory(tx, actor, {
    orderId,
    machine: 'refund',
    from: null,
    to: done ? 'succeeded' : 'pending',
    event: 'refund',
    reason: v.reason ?? null,
    data: {
      refundId: id,
      method: v.method,
      amount,
      ...(ret ? { returnNumber: formatReturnNumber(ret.number) } : {}),
    },
  });
  if (ret && ret.status === 'inspected') {
    await resolveReturn(tx, actor, ret, v.method === 'store_credit' ? 'store_credit' : 'refunded');
  }
  if (done) await refundDone(tx, actor, orderId, id, amount, v.method, creditCode?.code ?? null);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'refund.created',
    entityType: 'order',
    entityId: orderId,
    after: { refundId: id, method: v.method, amount, reference: v.reference ?? null },
  });
  return {
    id,
    method: v.method,
    status: done ? 'succeeded' : 'pending',
    amount,
    gateway:
      v.method === 'gateway' && payment?.bankTranId
        ? { paymentId: payment.id, bankTranId: payment.bankTranId }
        : null,
    creditCode: creditCode?.code ?? null,
  };
}

async function refundDone(
  tx: TenantTx,
  actor: Actor,
  orderId: string,
  refundId: string,
  amount: number,
  method: RefundMethod,
  creditCode: string | null,
): Promise<void> {
  await refreshOrder(tx, actor, orderId);
  await emit(tx, 'refund.succeeded', {
    aggregateType: 'refund',
    aggregateId: refundId,
    payload: { orderId, amount, method, ...(creditCode ? { creditCode } : {}) },
  });
}

/** SSLCommerz took the refund (or refused it): processing, or failed with its reason. */
export async function submitGatewayRefund(
  tx: TenantTx,
  actor: Actor,
  refundId: string,
  answer: { refundRefId: string; done: boolean } | { error: string },
): Promise<void> {
  const [row] = await tx.db
    .select({ status: f.status, orderId: f.orderId, amount: f.amount })
    .from(f)
    .where(eq(f.id, refundId))
    .for('update');
  if (!row) throw new AppError('not_found');
  if ('error' in answer) {
    await moveRefund(tx, actor, refundId, row, 'fail', {
      gatewayError: answer.error.slice(0, 300),
    });
    return;
  }
  await tx.db.update(f).set({ gatewayRefundRef: answer.refundRefId }).where(eq(f.id, refundId));
  await moveRefund(tx, actor, refundId, row, answer.done ? 'succeed' : 'submit');
}

/** A processing gateway refund's outcome, from the refund query. */
export async function settleGatewayRefund(
  tx: TenantTx,
  actor: Actor,
  refundId: string,
  outcome: 'refunded' | 'cancelled',
): Promise<void> {
  const [row] = await tx.db
    .select({ status: f.status, orderId: f.orderId, amount: f.amount })
    .from(f)
    .where(eq(f.id, refundId))
    .for('update');
  if (row?.status !== 'processing') return;
  await moveRefund(
    tx,
    actor,
    refundId,
    row,
    outcome === 'refunded' ? 'succeed' : 'fail',
    outcome === 'cancelled' ? { gatewayError: 'SSLCommerz cancelled the refund' } : {},
  );
}

async function moveRefund(
  tx: TenantTx,
  actor: Actor,
  refundId: string,
  row: { status: string; orderId: string; amount: number },
  event: 'submit' | 'succeed' | 'fail',
  extra: { gatewayError?: string } = {},
): Promise<void> {
  const from = row.status as 'pending' | 'processing';
  if (!refundMachine.can(from, event, undefined)) return;
  const { to } = refundMachine.transition(from, event, undefined);
  await lockOrder(tx, row.orderId);
  await tx.db
    .update(f)
    .set({
      status: to,
      ...(to === 'succeeded' || to === 'failed' ? { processedAt: sql`now()` } : {}),
      ...extra,
      updatedAt: sql`now()`,
    })
    .where(eq(f.id, refundId));
  await recordHistory(tx, actor, {
    orderId: row.orderId,
    machine: 'refund',
    from,
    to,
    event,
    reason: extra.gatewayError ?? null,
    data: { refundId },
  });
  if (to === 'succeeded') {
    await refundDone(tx, actor, row.orderId, refundId, Number(row.amount), 'gateway', null);
  }
}

/** Gateway refunds still processing, for the delayed check. */
export async function processingRefunds(
  tx: TenantTx,
): Promise<{ id: string; ref: string; paymentId: string }[]> {
  const rows = await tx.db
    .select({ id: f.id, ref: f.gatewayRefundRef, paymentId: f.paymentId })
    .from(f)
    .where(and(eq(f.status, 'processing'), eq(f.method, 'gateway')));
  return rows.filter((r) => r.ref && r.paymentId) as {
    id: string;
    ref: string;
    paymentId: string;
  }[];
}
