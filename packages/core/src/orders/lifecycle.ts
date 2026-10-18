// What happens to an order after placement (phase-4-plan §3.6–§3.9): the
// order machine (confirm, process, complete, cancel), shipments with stock
// following the goods, cash on delivery and manual payments, and the derived
// payment and delivery statuses, recalculated in the same transaction as
// every change. Every change writes a history row with its actor.
//
// Stock (Q9): reserved at placement; released on cancel or when an edit
// removes units; sold from the reservation when a shipment ships; back in
// stock, and reserved for the order again, when a failed shipment returns.
// So an order's outstanding reservation is always its quantity minus the
// units that left the store and haven't come back.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  deliverInput,
  deliveryStatusOf,
  failInput,
  manualPaymentInput,
  noteInput,
  type OrderStatus,
  orderMachine,
  orderTagsInput,
  type PaymentStatus,
  paymentStatusOf,
  type ShipmentStatus,
  shipmentInput,
  shipmentMachine,
  shipmentReturnInput,
} from '@managemind/shared/orders';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput } from '../catalog/common';
import { applyMovements, type Movement } from '../inventory/service';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';
import { recordHistory } from './history';

const o = schema.orders;

export interface OrderRow {
  id: string;
  number: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  deliveryStatus: 'not_shipped' | 'partially_shipped' | 'shipped' | 'delivered' | 'failed';
  customerId: string;
  total: number;
  paidTotal: number;
  refundedTotal: number;
}

export async function lockOrder(tx: TenantTx, id: string): Promise<OrderRow> {
  const [row] = await tx.db
    .select({
      id: o.id,
      number: o.number,
      status: o.status,
      paymentStatus: o.paymentStatus,
      deliveryStatus: o.deliveryStatus,
      customerId: o.customerId,
      total: o.total,
      paidTotal: o.paidTotal,
      refundedTotal: o.refundedTotal,
    })
    .from(o)
    .where(eq(o.id, id))
    .for('update');
  if (!row) throw new AppError('not_found');
  return {
    ...row,
    total: Number(row.total),
    paidTotal: Number(row.paidTotal),
    refundedTotal: Number(row.refundedTotal),
  };
}

/** Units of each line that left the store and haven't come back. */
async function shippedUnits(tx: TenantTx, orderId: string): Promise<number> {
  const { rows } = await tx.db.execute<{ n: number }>(sql`
    select coalesce(sum(shipped_quantity), 0)::int as n from store.order_lines where order_id = ${orderId}`);
  return rows[0]?.n ?? 0;
}

async function orderedUnits(tx: TenantTx, orderId: string): Promise<number> {
  const { rows } = await tx.db.execute<{ n: number }>(sql`
    select coalesce(sum(quantity), 0)::int as n from store.order_lines where order_id = ${orderId}`);
  return rows[0]?.n ?? 0;
}

const EVENT_OF: Partial<
  Record<OrderStatus, 'order.confirmed' | 'order.processing' | 'order.completed'>
> = {
  confirmed: 'order.confirmed',
  processing: 'order.processing',
  completed: 'order.completed',
};

/** Moves the order machine and writes the row, the history and the event. */
async function moveOrder(
  tx: TenantTx,
  actor: Actor,
  order: OrderRow,
  event: 'confirm' | 'process' | 'complete',
): Promise<OrderRow> {
  const t = orderMachine.transition(order.status, event, {
    shippedQuantity: await shippedUnits(tx, order.id),
    deliveryStatus: order.deliveryStatus,
    paymentStatus: order.paymentStatus,
  });
  await tx.db
    .update(o)
    .set({
      status: t.to,
      ...(t.to === 'confirmed' ? { confirmedAt: sql`now()` } : {}),
      ...(t.to === 'completed' ? { completedAt: sql`now()` } : {}),
    })
    .where(eq(o.id, order.id));
  await recordHistory(tx, actor, {
    orderId: order.id,
    machine: 'order',
    from: t.from,
    to: t.to,
    event,
  });
  const type = EVENT_OF[t.to];
  if (type)
    await emit(tx, type, {
      aggregateType: 'order',
      aggregateId: order.id,
      payload: { number: order.number },
    });
  return { ...order, status: t.to };
}

/**
 * Recalculates the derived statuses from payments and shipments, records
 * what changed, keeps the customer's spending, and completes the order once
 * it is delivered and paid.
 */
export async function refreshOrder(tx: TenantTx, actor: Actor, orderId: string): Promise<OrderRow> {
  let order = await lockOrder(tx, orderId);
  const { rows: paid } = await tx.db.execute<{ n: string }>(sql`
    select coalesce(sum(amount), 0) as n from store.payments where order_id = ${orderId} and status = 'paid'`);
  const paidTotal = Number(paid[0]?.n ?? 0);
  const { rows: refunded } = await tx.db.execute<{ n: string }>(sql`
    select coalesce(sum(amount), 0) as n from store.refunds where order_id = ${orderId} and status = 'succeeded'`);
  const refundedTotal = Number(refunded[0]?.n ?? 0);
  const { rows: shipped } = await tx.db.execute<{ status: ShipmentStatus; quantity: number }>(sql`
    select s.status, coalesce(sum(sl.quantity), 0)::int as quantity
      from store.shipments s join store.shipment_lines sl on sl.shipment_id = s.id
     where s.order_id = ${orderId} group by s.id, s.status`);
  const paymentStatus = paymentStatusOf(paidTotal, order.total, refundedTotal);
  const deliveryStatus = deliveryStatusOf(await orderedUnits(tx, orderId), shipped);
  if (paymentStatus !== order.paymentStatus) {
    await recordHistory(tx, actor, {
      orderId,
      machine: 'payment',
      from: order.paymentStatus,
      to: paymentStatus,
      event: 'payments_changed',
      data: { paidTotal, refundedTotal },
    });
  }
  if (deliveryStatus !== order.deliveryStatus) {
    await recordHistory(tx, actor, {
      orderId,
      machine: 'delivery',
      from: order.deliveryStatus,
      to: deliveryStatus,
      event: 'shipments_changed',
    });
    // Total spent counts delivered orders only (§3.10).
    const sign = deliveryStatus === 'delivered' ? 1 : order.deliveryStatus === 'delivered' ? -1 : 0;
    if (sign) {
      await tx.db.execute(sql`
        update store.customers set total_spent = greatest(0, total_spent + ${sign * order.total})
         where id = ${order.customerId}`);
    }
  }
  await tx.db
    .update(o)
    .set({ paidTotal, refundedTotal, paymentStatus, deliveryStatus })
    .where(eq(o.id, orderId));
  if (paidTotal >= order.total) {
    // Paid in full: an online payment still waiting (a payment link) is no
    // longer wanted. Expired, not voided, so money that arrives anyway is
    // still recorded, as a late payment to give back (phase-5a-plan §3.5).
    await tx.db.execute(sql`
      update store.payments set status = 'expired'
       where order_id = ${orderId} and provider = 'sslcommerz' and status = 'pending'`);
  }
  order = { ...order, paidTotal, refundedTotal, paymentStatus, deliveryStatus };
  if (
    order.status === 'processing' &&
    deliveryStatus === 'delivered' &&
    (paymentStatus === 'paid' || paymentStatus === 'partially_refunded')
  ) {
    order = await moveOrder(tx, actor, order, 'complete');
  }
  return order;
}

// ---- The order machine ----------------------------------------------------------------

export async function confirmOrder(tx: TenantTx, actor: Actor, id: string): Promise<OrderRow> {
  authorize(actor, 'orders.write');
  return moveOrder(tx, actor, await lockOrder(tx, id), 'confirm');
}

/** "Start processing": also happens on its own with the first shipment. */
export async function startProcessing(tx: TenantTx, actor: Actor, id: string): Promise<OrderRow> {
  authorize(actor, 'orders.write');
  return moveOrder(tx, actor, await lockOrder(tx, id), 'process');
}

/** Each line's outstanding reservation: ordered minus what left the store. */
async function outstanding(tx: TenantTx, orderId: string) {
  const { rows } = await tx.db.execute<{ id: string; variant_id: string; n: number }>(sql`
    select id, variant_id, (quantity - shipped_quantity)::int as n
      from store.order_lines where order_id = ${orderId}`);
  return rows.filter((r) => r.n > 0);
}

/**
 * Cancels while nothing is shipped (§3.9): releases the reservations, voids
 * pending payments and gives promotion uses back, so a cancelled order
 * doesn't use up a coupon. Staff give a reason; a shopper may cancel only
 * while the order is pending.
 */
export async function cancelOrder(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: { reason: string; cause?: 'payment_expired' },
): Promise<OrderRow> {
  const byShopper = actor.kind === 'shopper';
  if (!byShopper) authorize(actor, 'orders.write');
  const order = await lockOrder(tx, id);
  if (byShopper && order.status !== 'pending') {
    throw new AppError('illegal_transition', {
      detail: 'The store has confirmed this order; please contact them',
    });
  }
  const t = orderMachine.transition(order.status, 'cancel', {
    shippedQuantity: await shippedUnits(tx, id),
  });
  const lines = await outstanding(tx, id);
  await applyMovements(
    tx,
    actor,
    lines.map(
      (l): Movement => ({
        variantId: l.variant_id,
        type: 'release',
        quantity: -l.n,
        reason: 'order_cancelled',
        referenceType: 'order',
        referenceId: id,
        idempotencyKey: `order:${id}:${l.id}:cancel`,
      }),
    ),
  );
  const voided = await tx.db
    .update(schema.payments)
    .set({ status: 'voided', voidedAt: sql`now()` })
    .where(and(eq(schema.payments.orderId, id), eq(schema.payments.status, 'pending')))
    .returning({ id: schema.payments.id });
  await giveBackPromotionUses(tx, id);
  const who = auditActor(actor, 'staff');
  await tx.db
    .update(o)
    .set({
      status: 'cancelled',
      cancelledAt: sql`now()`,
      cancelReason: input.reason,
      cancelledBy: who.actorType,
    })
    .where(eq(o.id, id));
  await tx.db.execute(sql`
    update store.customers set order_count = greatest(0, order_count - 1) where id = ${order.customerId}`);
  await recordHistory(tx, actor, {
    orderId: id,
    machine: 'order',
    from: t.from,
    to: t.to,
    event: 'cancel',
    reason: input.reason,
  });
  for (const p of voided) {
    await emit(tx, 'payment.voided', {
      aggregateType: 'payment',
      aggregateId: p.id,
      payload: { orderId: id },
    });
  }
  await emit(tx, 'order.cancelled', {
    aggregateType: 'order',
    aggregateId: id,
    payload: {
      number: order.number,
      by: who.actorType,
      ...(input.cause ? { reason: input.cause } : {}),
    },
  });
  if (!byShopper) {
    await recordAudit(tx, {
      ...who,
      action: 'order.cancelled',
      entityType: 'order',
      entityId: id,
      after: { reason: input.reason },
    });
  }
  return { ...order, status: 'cancelled' };
}

/** The uses the order's promotions and codes counted, given back. */
export async function giveBackPromotionUses(tx: TenantTx, orderId: string, only?: string[]) {
  const { rows } = await tx.db.execute<{
    promotion_id: string;
    code_id: string | null;
    phone: string;
  }>(sql`
    select a.promotion_id, a.code_id, o.phone from store.order_adjustments a
      join store.orders o on o.id = a.order_id
     where a.order_id = ${orderId} and a.promotion_id is not null
       ${only ? sql`and a.promotion_id = any(${sql.param(only)}::uuid[])` : sql``}`);
  for (const r of rows) {
    await tx.db.execute(sql`
      update store.promotions set usage_count = greatest(0, usage_count - 1) where id = ${r.promotion_id}`);
    await tx.db.execute(sql`
      update store.promotion_customer_usage set count = greatest(0, count - 1)
       where promotion_id = ${r.promotion_id} and phone = ${r.phone}`);
    if (r.code_id) {
      await tx.db.execute(sql`
        update store.promotion_codes set usage_count = greatest(0, usage_count - 1) where id = ${r.code_id}`);
    }
  }
}

// ---- Shipments ---------------------------------------------------------------------

export interface ShipmentRow {
  id: string;
  orderId: string;
  status: ShipmentStatus;
}

async function lockShipment(tx: TenantTx, id: string): Promise<ShipmentRow> {
  const s = schema.shipments;
  const [row] = await tx.db
    .select({ id: s.id, orderId: s.orderId, status: s.status })
    .from(s)
    .where(eq(s.id, id))
    .for('update');
  if (!row) throw new AppError('not_found');
  return row;
}

async function shipmentLines(tx: TenantTx, shipmentId: string) {
  const { rows } = await tx.db.execute<{
    order_line_id: string;
    variant_id: string;
    quantity: number;
  }>(sql`
    select sl.order_line_id, l.variant_id, sl.quantity from store.shipment_lines sl
      join store.order_lines l on l.id = sl.order_line_id where sl.shipment_id = ${shipmentId}`);
  return rows;
}

/**
 * A shipment of chosen lines and quantities (§3.7). The order must be
 * confirmed; its first shipment moves it to processing. Each line can be
 * sent only as many units as aren't in another shipment yet.
 */
export async function createShipment(
  tx: TenantTx,
  actor: Actor,
  orderId: string,
  input: unknown,
): Promise<{ id: string }> {
  authorize(actor, 'orders.write');
  const v = parseInput(shipmentInput, input);
  let order = await lockOrder(tx, orderId);
  if (order.status !== 'confirmed' && order.status !== 'processing') {
    throw new AppError('illegal_transition', { detail: 'Confirm the order before shipping it' });
  }
  // Units of each line not yet in a pending, shipped, delivered or failed shipment.
  const { rows } = await tx.db.execute<{ id: string; free: number }>(sql`
    select l.id, (l.quantity - coalesce((select sum(sl.quantity) from store.shipment_lines sl
       join store.shipments s on s.id = sl.shipment_id
      where sl.order_line_id = l.id and s.status <> 'returned'), 0))::int as free
      from store.order_lines l where l.order_id = ${orderId}`);
  const free = new Map(rows.map((r) => [r.id, r.free]));
  for (const [i, l] of v.lines.entries()) {
    const left = free.get(l.orderLineId);
    if (left === undefined) {
      throw new AppError('validation_failed', {
        fields: [
          { path: `lines.${i}.orderLineId`, code: 'unknown', message: 'not a line of this order' },
        ],
      });
    }
    if (l.quantity > left) {
      throw new AppError('validation_failed', {
        fields: [{ path: `lines.${i}.quantity`, code: 'too_big', message: `at most ${left}` }],
      });
    }
  }
  const [shipment] = await tx.db
    .insert(schema.shipments)
    .values({
      orderId,
      carrier: v.carrier ?? null,
      trackingNumber: v.trackingNumber ?? null,
      trackingUrl: v.trackingUrl ?? null,
    })
    .returning({ id: schema.shipments.id });
  if (!shipment) throw new AppError('internal');
  await tx.db.insert(schema.shipmentLines).values(
    v.lines.map((l) => ({
      shipmentId: shipment.id,
      orderLineId: l.orderLineId,
      quantity: l.quantity,
    })),
  );
  if (order.status === 'confirmed') order = await moveOrder(tx, actor, order, 'process');
  await recordHistory(tx, actor, {
    orderId,
    machine: 'shipment',
    from: null,
    to: 'pending',
    event: 'create',
    data: { shipmentId: shipment.id, lines: v.lines },
  });
  await emit(tx, 'shipment.created', {
    aggregateType: 'shipment',
    aggregateId: shipment.id,
    payload: { orderId },
  });
  return shipment;
}

async function moveShipment(
  tx: TenantTx,
  actor: Actor,
  shipment: ShipmentRow,
  event: 'ship' | 'deliver' | 'fail' | 'return',
  extra: { reason?: string; data?: unknown } = {},
) {
  const t = shipmentMachine.transition(shipment.status, event, undefined);
  const stamp = {
    ship: 'shippedAt',
    deliver: 'deliveredAt',
    fail: 'failedAt',
    return: 'returnedAt',
  } as const;
  await tx.db
    .update(schema.shipments)
    .set({
      status: t.to,
      [stamp[event]]: sql`now()`,
      ...(event === 'fail' ? { failedReason: extra.reason ?? null } : {}),
    })
    .where(eq(schema.shipments.id, shipment.id));
  await recordHistory(tx, actor, {
    orderId: shipment.orderId,
    machine: 'shipment',
    from: t.from,
    to: t.to,
    event,
    reason: extra.reason,
    data: { shipmentId: shipment.id, ...(extra.data ? { extra: extra.data } : {}) },
  });
  const type = {
    ship: 'shipment.shipped',
    deliver: 'shipment.delivered',
    fail: 'shipment.failed',
    return: 'shipment.returned',
  } as const;
  await emit(tx, type[event], {
    aggregateType: 'shipment',
    aggregateId: shipment.id,
    payload: { orderId: shipment.orderId },
  });
  return t;
}

/** Marked shipped: its units are sold from the reservation (release and sale together). */
export async function shipShipment(tx: TenantTx, actor: Actor, id: string): Promise<OrderRow> {
  authorize(actor, 'orders.write');
  const shipment = await lockShipment(tx, id);
  await lockOrder(tx, shipment.orderId);
  await moveShipment(tx, actor, shipment, 'ship');
  const lines = await shipmentLines(tx, id);
  const ref = { referenceType: 'shipment', referenceId: id, reason: 'order_shipped' };
  await applyMovements(
    tx,
    actor,
    lines.flatMap((l): Movement[] => [
      {
        ...ref,
        variantId: l.variant_id,
        type: 'release',
        quantity: -l.quantity,
        idempotencyKey: `shipment:${id}:${l.order_line_id}:release`,
      },
      {
        ...ref,
        variantId: l.variant_id,
        type: 'sale',
        quantity: -l.quantity,
        idempotencyKey: `shipment:${id}:${l.order_line_id}:sale`,
      },
    ]),
  );
  await tx.db.execute(sql`
    update store.order_lines l set shipped_quantity = l.shipped_quantity + sl.quantity
      from store.shipment_lines sl where sl.shipment_id = ${id} and sl.order_line_id = l.id`);
  return refreshOrder(tx, actor, shipment.orderId);
}

/**
 * Marked delivered. With "cash collected" (checked by default), the order's
 * pending cash-on-delivery payment is settled; Phase 7's courier sync will
 * do this on its own.
 */
export async function deliverShipment(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown = {},
): Promise<OrderRow> {
  authorize(actor, 'orders.write');
  const { cashCollected } = parseInput(deliverInput, input);
  const shipment = await lockShipment(tx, id);
  await lockOrder(tx, shipment.orderId);
  await moveShipment(tx, actor, shipment, 'deliver', { data: { cashCollected } });
  if (cashCollected) await settleCod(tx, actor, shipment.orderId);
  return refreshOrder(tx, actor, shipment.orderId);
}

async function settleCod(tx: TenantTx, actor: Actor, orderId: string) {
  const settled = await tx.db
    .update(schema.payments)
    .set({ status: 'paid', settledAt: sql`now()`, recordedBy: actor.userId })
    .where(
      and(
        eq(schema.payments.orderId, orderId),
        eq(schema.payments.provider, 'cod'),
        eq(schema.payments.status, 'pending'),
      ),
    )
    .returning({ id: schema.payments.id, amount: schema.payments.amount });
  for (const p of settled) {
    await emit(tx, 'payment.settled', {
      aggregateType: 'payment',
      aggregateId: p.id,
      payload: { orderId, amount: Number(p.amount) },
    });
  }
}

/** The courier couldn't deliver: the goods are on their way back. */
export async function failShipment(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<OrderRow> {
  authorize(actor, 'orders.write');
  const { reason } = parseInput(failInput, input);
  const shipment = await lockShipment(tx, id);
  await lockOrder(tx, shipment.orderId);
  await moveShipment(tx, actor, shipment, 'fail', { reason });
  return refreshOrder(tx, actor, shipment.orderId);
}

/**
 * A failed shipment came back: its units are back in stock with a `return`
 * movement, and reserved for the order again, so it can be sent once more
 * or cancelled (which releases them). What the trip cost is recorded (the
 * order's delivery fee unless staff say otherwise), and the customer's
 * failed deliveries go up by one, which can flag the phone (phase-5a-plan §3.11).
 */
export async function returnShipment(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown = {},
): Promise<OrderRow> {
  authorize(actor, 'orders.write');
  const { returnCost } = parseInput(shipmentReturnInput, input);
  const shipment = await lockShipment(tx, id);
  const order = await lockOrder(tx, shipment.orderId);
  await moveShipment(tx, actor, shipment, 'return');
  await tx.db.execute(sql`
    update store.shipments s
       set return_cost = coalesce(${returnCost ?? null}::bigint,
                                  (select greatest(0, o.delivery_fee - o.delivery_discount)
                                     from store.orders o where o.id = s.order_id))
     where s.id = ${id}`);
  await tx.db.execute(sql`
    update store.customers set failed_deliveries = failed_deliveries + 1
     where id = ${order.customerId}`);
  const lines = await shipmentLines(tx, id);
  const ref = { referenceType: 'shipment', referenceId: id };
  await applyMovements(
    tx,
    actor,
    lines.flatMap((l): Movement[] => [
      {
        ...ref,
        variantId: l.variant_id,
        type: 'return',
        quantity: l.quantity,
        reason: 'failed_delivery',
        idempotencyKey: `shipment:${id}:${l.order_line_id}:return`,
      },
      {
        ...ref,
        variantId: l.variant_id,
        type: 'reservation',
        quantity: l.quantity,
        reason: 'order',
        idempotencyKey: `shipment:${id}:${l.order_line_id}:reserve`,
      },
    ]),
  );
  await tx.db.execute(sql`
    update store.order_lines l set shipped_quantity = l.shipped_quantity - sl.quantity
      from store.shipment_lines sl where sl.shipment_id = ${id} and sl.order_line_id = l.id`);
  return refreshOrder(tx, actor, shipment.orderId);
}

/** A shipment not yet shipped can be deleted; its units can be shipped again. */
export async function deleteShipment(tx: TenantTx, actor: Actor, id: string): Promise<void> {
  authorize(actor, 'orders.write');
  const shipment = await lockShipment(tx, id);
  if (shipment.status !== 'pending') {
    throw new AppError('illegal_transition', {
      detail: 'Only a shipment not yet shipped can be deleted',
    });
  }
  await tx.db.delete(schema.shipments).where(eq(schema.shipments.id, id));
  await recordHistory(tx, actor, {
    orderId: shipment.orderId,
    machine: 'shipment',
    from: 'pending',
    to: null,
    event: 'delete',
    data: { shipmentId: id },
  });
}

/**
 * A walk-in sale that leaves the shop at once (§3.12): confirmed, one
 * shipment of everything with no carrier, shipped and delivered with the
 * cash collected.
 */
export async function completeWalkIn(
  tx: TenantTx,
  actor: Actor,
  orderId: string,
): Promise<OrderRow> {
  authorize(actor, 'orders.write');
  const order = await lockOrder(tx, orderId);
  if (order.status === 'pending') await moveOrder(tx, actor, order, 'confirm');
  const { rows } = await tx.db.execute<{ id: string; quantity: number }>(
    sql`select id, quantity from store.order_lines where order_id = ${orderId}`,
  );
  const shipment = await createShipment(tx, actor, orderId, {
    lines: rows.map((r) => ({ orderLineId: r.id, quantity: r.quantity })),
  });
  await shipShipment(tx, actor, shipment.id);
  return deliverShipment(tx, actor, shipment.id, { cashCollected: true });
}

// ---- Payments ------------------------------------------------------------------------

/**
 * A payment staff record as already received (bKash, Nagad, bank, cash…),
 * settled at once. The pending COD payment shrinks by the same amount in the
 * same transaction (§3.8), and is voided when nothing is left to collect.
 */
export async function recordPayment(
  tx: TenantTx,
  actor: Actor,
  orderId: string,
  input: unknown,
): Promise<OrderRow> {
  authorize(actor, 'orders.write');
  const v = parseInput(manualPaymentInput, input);
  const order = await lockOrder(tx, orderId);
  if (order.status === 'cancelled')
    throw new AppError('illegal_transition', { detail: 'The order is cancelled' });
  const [payment] = await tx.db
    .insert(schema.payments)
    .values({
      orderId,
      provider: 'manual',
      method: v.method,
      status: 'paid',
      amount: v.amount,
      reference: v.reference ?? null,
      recordedBy: actor.userId,
      settledAt: sql`now()`,
    })
    .returning({ id: schema.payments.id });
  const p = schema.payments;
  const pending = await tx.db
    .select({ id: p.id, amount: p.amount })
    .from(p)
    .where(and(eq(p.orderId, orderId), eq(p.provider, 'cod'), eq(p.status, 'pending')))
    .for('update');
  let left = v.amount;
  for (const cod of pending) {
    if (left <= 0) break;
    const amount = Number(cod.amount);
    const take = Math.min(amount, left);
    left -= take;
    if (take === amount) {
      await tx.db.update(p).set({ status: 'voided', voidedAt: sql`now()` }).where(eq(p.id, cod.id));
    } else
      await tx.db
        .update(p)
        .set({ amount: amount - take })
        .where(eq(p.id, cod.id));
  }
  await emit(tx, 'payment.recorded', {
    aggregateType: 'payment',
    aggregateId: payment?.id as string,
    payload: { orderId, provider: 'manual', amount: v.amount },
  });
  await emit(tx, 'payment.settled', {
    aggregateType: 'payment',
    aggregateId: payment?.id as string,
    payload: { orderId, amount: v.amount },
  });
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'payment.recorded',
    entityType: 'order',
    entityId: orderId,
    after: v,
  });
  return refreshOrder(tx, actor, orderId);
}

/** The pending COD payment follows the total after an edit (what's left to collect). */
export async function syncCodAmount(tx: TenantTx, orderId: string, total: number): Promise<void> {
  const p = schema.payments;
  const { rows } = await tx.db.execute<{ n: string }>(sql`
    select coalesce(sum(amount), 0) as n from store.payments where order_id = ${orderId} and status = 'paid'`);
  const due = Math.max(0, total - Number(rows[0]?.n ?? 0));
  const pending = await tx.db
    .select({ id: p.id })
    .from(p)
    .where(and(eq(p.orderId, orderId), eq(p.provider, 'cod'), eq(p.status, 'pending')))
    .for('update');
  const [first, ...rest] = pending;
  if (rest.length) {
    await tx.db
      .update(p)
      .set({ status: 'voided', voidedAt: sql`now()` })
      .where(
        inArray(
          p.id,
          rest.map((r) => r.id),
        ),
      );
  }
  if (first && due > 0) await tx.db.update(p).set({ amount: due }).where(eq(p.id, first.id));
  else if (first)
    await tx.db.update(p).set({ status: 'voided', voidedAt: sql`now()` }).where(eq(p.id, first.id));
  else if (due > 0)
    await tx.db.insert(p).values({ orderId, provider: 'cod', method: 'cod', amount: due });
}

// ---- Notes and tags ------------------------------------------------------------------

/** An internal note, never shown to the shopper. */
export async function addOrderNote(
  tx: TenantTx,
  actor: Actor,
  orderId: string,
  input: unknown,
): Promise<{ id: string }> {
  authorize(actor, 'orders.write');
  const { body } = parseInput(noteInput, input);
  await lockOrder(tx, orderId);
  const [row] = await tx.db
    .insert(schema.orderNotes)
    .values({ orderId, authorId: actor.userId, body })
    .returning({ id: schema.orderNotes.id });
  if (!row) throw new AppError('internal');
  return row;
}

export async function setOrderTags(
  tx: TenantTx,
  actor: Actor,
  orderId: string,
  input: unknown,
): Promise<{ tags: string[] }> {
  authorize(actor, 'orders.write');
  const { tags } = parseInput(orderTagsInput, input);
  await lockOrder(tx, orderId);
  await tx.db.update(o).set({ tags }).where(eq(o.id, orderId));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'order.tagged',
    entityType: 'order',
    entityId: orderId,
    after: { tags },
  });
  return { tags };
}
