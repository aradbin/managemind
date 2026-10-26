// Returns (phase-5a-plan §3.12): staff create them, or shoppers ask from the
// tracking page within the policy's window. A return moves through
// requested → approved → (in_transit →) received → inspected → resolved.
// Inspection restocks by condition: sellable units go back on hand, damaged
// ones go back and are written off, so the ledger shows both and
// inventoryDrift stays zero. A line can only be returned up to what was
// delivered, less what other returns cover; the order is locked while that
// is checked, as stock is.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  exchangeInput,
  inspectInput,
  type ReturnReason,
  type ReturnRecordStatus,
  type ReturnResolution,
  refundShare,
  returnInput,
  returnListQuery,
  returnMachine,
  returnRejectInput,
  returnStatusOf,
  shopperReturnInput,
} from '@managemind/shared/orders';
import { and, desc, eq, lt, type SQL, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput } from '../catalog/common';
import { applyMovements, type Movement } from '../inventory/service';
import { recordHistory } from '../orders/history';
import { lockOrder } from '../orders/lifecycle';
import { type PlacedOrder, placeOrder } from '../orders/place';
import { emit } from '../outbox';
import { orderSettings, quote } from '../pricing/quote';
import { restockAtLineCost } from '../purchasing/costs';
import type { TenantTx } from '../tenant';

const r = schema.returns;
const FIRST_RETURN_NUMBER = 1001;

export const formatReturnNumber = (n: number) => `R${n}`;

/** One line of an order as far as returns go. */
export interface ReturnableLine {
  orderLineId: string;
  variantId: string;
  productId: string;
  title: Record<string, string>;
  optionLabels: Record<string, string>[];
  quantity: number;
  lineTotal: number;
  delivered: number;
  /** Units in other returns that weren't rejected. */
  inReturns: number;
  returnable: number;
  /** In a category the policy excludes: shoppers can't ask; staff still can. */
  excluded: boolean;
}

/** Lines of an order with what's still returnable. */
export async function returnableLines(
  tx: TenantTx,
  orderId: string,
  excludedCategoryIds: readonly string[] = [],
): Promise<ReturnableLine[]> {
  const { rows } = await tx.db.execute<{
    id: string;
    variant_id: string;
    product_id: string;
    title: Record<string, string>;
    option_labels: Record<string, string>[];
    quantity: number;
    line_total: string;
    delivered: number;
    in_returns: number;
    excluded: boolean;
  }>(sql`
    select l.id, l.variant_id, l.product_id, l.title, l.option_labels, l.quantity, l.line_total,
           coalesce((select sum(sl.quantity) from store.shipment_lines sl
                       join store.shipments s on s.id = sl.shipment_id
                      where sl.order_line_id = l.id and s.status = 'delivered'), 0)::int as delivered,
           coalesce((select sum(rl.quantity) from store.return_lines rl
                       join store.returns r on r.id = rl.return_id
                      where rl.order_line_id = l.id and r.status <> 'rejected'
                        and r.resolution is distinct from 'rejected'), 0)::int as in_returns,
           exists (select 1 from store.product_categories pc
                    where pc.product_id = l.product_id
                      and pc.category_id = any(${sql.param([...excludedCategoryIds])}::uuid[])) as excluded
      from store.order_lines l where l.order_id = ${orderId} order by l.position`);
  return rows.map((l) => ({
    orderLineId: l.id,
    variantId: l.variant_id,
    productId: l.product_id,
    title: l.title,
    optionLabels: l.option_labels ?? [],
    quantity: l.quantity,
    lineTotal: Number(l.line_total),
    delivered: l.delivered,
    inReturns: l.in_returns,
    returnable: Math.max(0, l.delivered - l.in_returns),
    excluded: l.excluded,
  }));
}

/** The latest delivery of an order: the shopper's window starts there. */
async function deliveredAt(tx: TenantTx, orderId: string): Promise<Date | null> {
  const { rows } = await tx.db.execute<{ at: string | null }>(sql`
    select max(delivered_at) as at from store.shipments
     where order_id = ${orderId} and status = 'delivered'`);
  return rows[0]?.at ? new Date(rows[0].at) : null;
}

/** Whether a shopper can still ask (§3.10), and which lines. */
export async function shopperReturnable(
  tx: TenantTx,
  orderId: string,
  now: Date = new Date(),
): Promise<{ open: boolean; until: string | null; lines: ReturnableLine[] }> {
  const { settings } = await orderSettings(tx);
  const policy = settings.returns;
  const lines = await returnableLines(tx, orderId, policy.excludedCategoryIds);
  const at = await deliveredAt(tx, orderId);
  const until = at ? new Date(at.getTime() + policy.windowDays * 86_400_000) : null;
  const open =
    policy.shopperRequests &&
    until !== null &&
    until > now &&
    lines.some((l) => l.returnable > 0 && !l.excluded);
  return { open, until: until?.toISOString() ?? null, lines };
}

async function nextReturnNumber(tx: TenantTx): Promise<number> {
  const { rows } = await tx.db.execute<{ value: string }>(sql`
    insert into store.counters (name, value) values ('return_number', ${FIRST_RETURN_NUMBER})
    on conflict (tenant_id, name) do update set value = store.counters.value + 1
    returning value`);
  return Number(rows[0]?.value);
}

/** The order's return status follows its returns, like its delivery status. */
async function refreshReturnStatus(tx: TenantTx, orderId: string): Promise<void> {
  const { rows } = await tx.db.execute<{
    status: ReturnRecordStatus;
    resolution: ReturnResolution | null;
    quantity: number;
  }>(sql`
    select r.status, r.resolution, coalesce(sum(rl.quantity), 0)::int as quantity
      from store.returns r left join store.return_lines rl on rl.return_id = r.id
     where r.order_id = ${orderId} group by r.id`);
  const { rows: ordered } = await tx.db.execute<{ n: number }>(sql`
    select coalesce(sum(quantity), 0)::int as n from store.order_lines where order_id = ${orderId}`);
  const status = returnStatusOf(ordered[0]?.n ?? 0, rows);
  await tx.db
    .update(schema.orders)
    .set({ returnStatus: status })
    .where(eq(schema.orders.id, orderId));
}

export interface ReturnPhotoInput {
  objectKey: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: number;
}

type Origin = { by: 'staff' } | { by: 'shopper'; orderId: string; photos: ReturnPhotoInput[] };

/**
 * A new return. Staff's are approved at once (they decided it); a shopper's
 * waits for approval, and must be within the window, for lines the policy
 * allows.
 */
export async function createReturn(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
  origin: Origin = { by: 'staff' },
): Promise<{ id: string; number: number }> {
  const shopper = origin.by === 'shopper';
  if (!shopper) authorize(actor, 'orders.write');
  const v = shopper ? parseInput(shopperReturnInput, input) : parseInput(returnInput, input);
  const orderId = shopper ? origin.orderId : (v as { orderId: string }).orderId;
  const order = await lockOrder(tx, orderId);
  if (order.status === 'cancelled') {
    throw new AppError('illegal_transition', { detail: 'The order is cancelled' });
  }
  const { settings } = await orderSettings(tx);
  const policy = settings.returns;

  let lines: ReturnableLine[];
  if (shopper) {
    const window = await shopperReturnable(tx, orderId);
    if (!window.open) {
      throw new AppError('illegal_transition', { detail: 'Returns are closed for this order' });
    }
    lines = window.lines;
  } else {
    lines = await returnableLines(tx, orderId, policy.excludedCategoryIds);
  }
  const byId = new Map(lines.map((l) => [l.orderLineId, l]));
  const seen = new Set<string>();
  v.lines.forEach((want, i) => {
    const line = byId.get(want.orderLineId);
    const bad = (message: string) =>
      new AppError('validation_failed', {
        fields: [{ path: `lines.${i}.quantity`, code: 'not_returnable', message }],
      });
    if (!line || seen.has(want.orderLineId)) throw bad('not a line of this order');
    seen.add(want.orderLineId);
    if (shopper && line.excluded) throw bad('this item is not returnable');
    if (want.quantity > line.returnable) throw bad(`only ${line.returnable} can be returned`);
  });

  const reason: ReturnReason = v.reason;
  const shopperPays =
    ('shopperPaysReturn' in v ? v.shopperPaysReturn : undefined) ??
    policy.shopperPaysFor.includes(reason);
  const number = await nextReturnNumber(tx);
  const status: ReturnRecordStatus = shopper ? 'requested' : 'approved';
  const [row] = await tx.db
    .insert(r)
    .values({
      number,
      orderId,
      status,
      reason,
      note: v.note ?? null,
      requestedBy: shopper ? 'shopper' : 'staff',
      createdBy: shopper ? null : actor.userId,
      shopperPaysReturn: shopperPays,
      approvedAt: shopper ? null : sql`now()`,
    })
    .returning({ id: r.id });
  const id = row?.id as string;
  await tx.db.insert(schema.returnLines).values(
    v.lines.map((l) => ({
      returnId: id,
      orderLineId: l.orderLineId,
      quantity: l.quantity,
      reason: l.reason ?? null,
    })),
  );
  if (shopper && origin.photos.length) {
    await tx.db
      .insert(schema.returnPhotos)
      .values(origin.photos.map((p) => ({ returnId: id, ...p })));
  }
  await recordHistory(tx, actor, {
    orderId,
    machine: 'return',
    from: null,
    to: status,
    event: 'request',
    reason: v.note ?? null,
    data: { returnId: id, number },
  });
  await refreshReturnStatus(tx, orderId);
  await emit(tx, 'return.requested', {
    aggregateType: 'return',
    aggregateId: id,
    payload: { orderId, number, by: shopper ? 'shopper' : 'staff', reason },
  });
  if (!shopper) {
    await emit(tx, 'return.approved', {
      aggregateType: 'return',
      aggregateId: id,
      payload: { orderId, number },
    });
  }
  if (!shopper) {
    await recordAudit(tx, {
      ...auditActor(actor, 'staff'),
      action: 'return.created',
      entityType: 'return',
      entityId: id,
      after: { orderId, number, reason, lines: v.lines },
    });
  }
  return { id, number };
}

interface LockedReturn {
  id: string;
  number: number;
  orderId: string;
  status: ReturnRecordStatus;
  resolution: ReturnResolution | null;
  shopperPaysReturn: boolean | null;
}

/** Locks the order first, then the return, as every return change does. */
export async function lockReturn(tx: TenantTx, id: string): Promise<LockedReturn> {
  const [head] = await tx.db.select({ orderId: r.orderId }).from(r).where(eq(r.id, id));
  if (!head) throw new AppError('not_found');
  await lockOrder(tx, head.orderId);
  const [row] = await tx.db
    .select({
      id: r.id,
      number: r.number,
      orderId: r.orderId,
      status: r.status,
      resolution: r.resolution,
      shopperPaysReturn: r.shopperPaysReturn,
    })
    .from(r)
    .where(eq(r.id, id))
    .for('update');
  if (!row) throw new AppError('not_found');
  return row as LockedReturn;
}

const MOVE_EVENTS = {
  approve: 'return.approved',
  reject: 'return.rejected',
  receive: 'return.received',
} as const;

/** approve, reject (with a reason), send (it's on its way back) or receive. */
export async function moveReturn(
  tx: TenantTx,
  actor: Actor,
  id: string,
  event: 'approve' | 'reject' | 'send' | 'receive',
  input: unknown = {},
): Promise<ReturnDetail> {
  authorize(actor, 'orders.write');
  const ret = await lockReturn(tx, id);
  if (!returnMachine.can(ret.status, event, undefined)) {
    throw new AppError('illegal_transition', {
      detail: `A ${ret.status} return can't ${event}`,
    });
  }
  const { to } = returnMachine.transition(ret.status, event, undefined);
  const reason = event === 'reject' ? parseInput(returnRejectInput, input).reason : null;
  await tx.db
    .update(r)
    .set({
      status: to,
      ...(event === 'approve' ? { approvedAt: sql`now()` } : {}),
      ...(event === 'receive' ? { receivedAt: sql`now()` } : {}),
      ...(reason ? { rejectReason: reason } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(r.id, id));
  await recordHistory(tx, actor, {
    orderId: ret.orderId,
    machine: 'return',
    from: ret.status,
    to,
    event,
    reason,
    data: { returnId: id, number: ret.number },
  });
  await refreshReturnStatus(tx, ret.orderId);
  if (event !== 'send') {
    await emit(tx, MOVE_EVENTS[event], {
      aggregateType: 'return',
      aggregateId: id,
      payload: { orderId: ret.orderId, number: ret.number },
    });
  }
  return getReturn(tx, actor, id);
}

/**
 * Inspection (§3.12, criterion 2): every unit back is sellable or damaged.
 * Both go back on hand with a `return` movement, and damaged units are then
 * written off with an adjustment, so the ledger shows the loss. The keys
 * make a repeated call restock once.
 */
export async function inspectReturn(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<ReturnDetail> {
  authorize(actor, 'orders.write');
  const v = parseInput(inspectInput, input);
  const ret = await lockReturn(tx, id);
  if (!returnMachine.can(ret.status, 'inspect', undefined)) {
    throw new AppError('illegal_transition', {
      detail: `A ${ret.status} return can't be inspected`,
    });
  }
  const { rows: lines } = await tx.db.execute<{
    order_line_id: string;
    quantity: number;
    variant_id: string;
    cost_price: string | null;
  }>(sql`
    select rl.order_line_id, rl.quantity, l.variant_id, l.cost_price
      from store.return_lines rl join store.order_lines l on l.id = rl.order_line_id
     where rl.return_id = ${id}`);
  const found = new Map(v.lines.map((l) => [l.orderLineId, l]));
  if (found.size !== lines.length || v.lines.length !== lines.length) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'lines', code: 'incomplete', message: 'inspect every line of the return' }],
    });
  }
  const movements: Movement[] = [];
  lines.forEach((line, i) => {
    const got = found.get(line.order_line_id);
    if (!got || got.sellable + got.damaged !== line.quantity) {
      throw new AppError('validation_failed', {
        fields: [
          {
            path: `lines.${i}`,
            code: 'count',
            message: `${line.quantity} units came back: each is sellable or damaged`,
          },
        ],
      });
    }
    const ref = { referenceType: 'return', referenceId: id };
    movements.push({
      variantId: line.variant_id,
      type: 'return',
      quantity: line.quantity,
      unitCost: line.cost_price === null ? null : Number(line.cost_price),
      reason: 'return_inspected',
      idempotencyKey: `return:${id}:${line.order_line_id}:return`,
      ...ref,
    });
    if (got.damaged > 0) {
      movements.push({
        variantId: line.variant_id,
        type: 'adjustment',
        quantity: -got.damaged,
        unitCost: line.cost_price === null ? null : Number(line.cost_price),
        reason: 'damaged',
        note: formatReturnNumber(ret.number),
        idempotencyKey: `return:${id}:${line.order_line_id}:damaged`,
        ...ref,
      });
    }
  });
  // Back in at the cost they were sold at, before the stock moves (phase-8-plan §3.3).
  await restockAtLineCost(tx, actor, lines, { referenceType: 'return', referenceId: id });
  await applyMovements(tx, actor, movements);
  for (const l of v.lines) {
    await tx.db
      .update(schema.returnLines)
      .set({ restocked: l.sellable, writtenOff: l.damaged })
      .where(
        and(eq(schema.returnLines.returnId, id), eq(schema.returnLines.orderLineId, l.orderLineId)),
      );
  }
  await tx.db
    .update(r)
    .set({ status: 'inspected', inspectedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(r.id, id));
  await recordHistory(tx, actor, {
    orderId: ret.orderId,
    machine: 'return',
    from: ret.status,
    to: 'inspected',
    event: 'inspect',
    data: {
      returnId: id,
      number: ret.number,
      sellable: v.lines.reduce((a, l) => a + l.sellable, 0),
      damaged: v.lines.reduce((a, l) => a + l.damaged, 0),
    },
  });
  return getReturn(tx, actor, id);
}

/** Closes an inspected return (refund, store credit, exchange, or nothing given back). */
export async function resolveReturn(
  tx: TenantTx,
  actor: Actor,
  ret: LockedReturn,
  resolution: ReturnResolution,
  extra: { exchangeOrderId?: string; exchangeCredit?: number; reason?: string } = {},
): Promise<void> {
  if (!returnMachine.can(ret.status, 'resolve', undefined)) {
    throw new AppError('illegal_transition', {
      detail: `A ${ret.status} return can't be resolved`,
    });
  }
  await tx.db
    .update(r)
    .set({
      status: 'resolved',
      resolution,
      resolvedAt: sql`now()`,
      updatedAt: sql`now()`,
      ...(extra.exchangeOrderId ? { exchangeOrderId: extra.exchangeOrderId } : {}),
      ...(extra.exchangeCredit !== undefined ? { exchangeCredit: extra.exchangeCredit } : {}),
      ...(extra.reason ? { rejectReason: extra.reason } : {}),
    })
    .where(eq(r.id, ret.id));
  await recordHistory(tx, actor, {
    orderId: ret.orderId,
    machine: 'return',
    from: ret.status,
    to: 'resolved',
    event: 'resolve',
    reason: extra.reason ?? null,
    data: { returnId: ret.id, number: ret.number, resolution },
  });
  await refreshReturnStatus(tx, ret.orderId);
}

/** Inspected, and nothing is given back (the goods weren't as claimed). */
export async function closeReturnWithoutRefund(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<ReturnDetail> {
  authorize(actor, 'orders.write');
  const { reason } = parseInput(returnRejectInput, input);
  const ret = await lockReturn(tx, id);
  await resolveReturn(tx, actor, ret, 'rejected', { reason });
  return getReturn(tx, actor, id);
}

/** What the return's units are worth, less what was refunded for them already. */
export async function returnCredit(tx: TenantTx, returnId: string): Promise<number> {
  const { rows } = await tx.db.execute<{
    line_total: string;
    ordered: number;
    quantity: number;
    refunded_line: number;
    refunded_here: number;
  }>(sql`
    select l.line_total, l.quantity as ordered, rl.quantity,
           coalesce((select sum(fl.quantity) from store.refund_lines fl join store.refunds f on f.id = fl.refund_id
                      where fl.order_line_id = l.id and f.status <> 'failed'), 0)::int as refunded_line,
           coalesce((select sum(fl.quantity) from store.refund_lines fl join store.refunds f on f.id = fl.refund_id
                      where fl.order_line_id = l.id and f.return_id = ${returnId} and f.status <> 'failed'), 0)::int as refunded_here
      from store.return_lines rl join store.order_lines l on l.id = rl.order_line_id
     where rl.return_id = ${returnId}`);
  let total = 0;
  for (const l of rows) {
    const units = l.quantity - l.refunded_here;
    if (units > 0) total += refundShare(Number(l.line_total), l.ordered, l.refunded_line, units);
  }
  return total;
}

/**
 * An exchange (§3.13): a new order (source `exchange`) for the replacement
 * lines at today's prices, with the returned units' value taken off as an
 * exchange credit. More to pay is cash on delivery or a payment link; a
 * credit bigger than the new order comes back as `refundDue`, refunded
 * through the usual flow. The replacement ships free when the store pays the
 * return.
 */
export async function exchangeReturn(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<{ order: PlacedOrder; credit: number; applied: number; refundDue: number }> {
  authorize(actor, 'orders.write');
  const v = parseInput(exchangeInput, input);
  const ret = await lockReturn(tx, id);
  if (ret.status !== 'inspected') {
    throw new AppError('illegal_transition', { detail: 'Inspect the return first' });
  }
  const [old] = await tx.db
    .select({
      contact: schema.orders.contact,
      address: schema.orders.address,
      zoneId: schema.orders.zoneId,
      locale: schema.orders.locale,
      paidTotal: schema.orders.paidTotal,
    })
    .from(schema.orders)
    .where(eq(schema.orders.id, ret.orderId));
  if (!old) throw new AppError('not_found');
  const { rows: refunded } = await tx.db.execute<{ n: string }>(sql`
    select coalesce(sum(amount), 0) as n from store.refunds
     where order_id = ${ret.orderId} and status <> 'failed'`);
  // Only money the shopper actually paid, and hasn't had back, can be credited.
  const credit = Math.min(
    await returnCredit(tx, id),
    Math.max(0, Number(old.paidTotal) - Number(refunded[0]?.n ?? 0)),
  );
  const settings = await orderSettings(tx);
  const contact = old.contact as { name: string; phone: string; email?: string };
  const address = old.address as {
    divisionId: number;
    districtId: number;
    areaId: number;
    line: string;
  } | null;
  const zone = address ? (old.zoneId ? { id: old.zoneId } : undefined) : ('none' as const);
  const deliveryFee =
    address && ret.shopperPaysReturn === false
      ? { amount: 0, reason: `Exchange for ${formatReturnNumber(ret.number)}` }
      : undefined;
  const q = await quote(tx, {
    lines: v.lines,
    areaId: address?.areaId ?? null,
    zone,
    deliveryFeeOverride: deliveryFee?.amount,
    code: null,
    phone: contact.phone,
    paymentMethod: 'cod',
    maxQuantityPerLine: null,
    settings,
  });
  const applied = Math.min(credit, q.totals.subtotal - q.totals.discountTotal);
  const order = await placeOrder(
    tx,
    actor,
    {
      channel: 'admin',
      source: 'exchange',
      lines: v.lines,
      contact: {
        name: contact.name,
        phone: contact.phone,
        ...(contact.email ? { email: contact.email } : {}),
      },
      address: address
        ? {
            divisionId: address.divisionId,
            districtId: address.districtId,
            areaId: address.areaId,
            line: address.line,
          }
        : null,
      zone,
      deliveryFeeOverride: deliveryFee,
      code: null,
      manualDiscount:
        applied > 0
          ? { amount: applied, reason: `Exchange credit ${formatReturnNumber(ret.number)}` }
          : null,
      payment: { kind: 'cod' },
      note: v.note,
      locale: old.locale as 'bn' | 'en',
      confirm: v.confirm,
      allowBlocked: true,
    },
    settings,
  );
  await resolveReturn(tx, actor, ret, 'exchanged', {
    exchangeOrderId: order.id,
    exchangeCredit: applied,
  });
  return { order, credit, applied, refundDue: credit - applied };
}

// ---- Views ----------------------------------------------------------------------------

export interface ReturnSummary {
  id: string;
  number: number;
  displayNumber: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  status: ReturnRecordStatus;
  reason: ReturnReason;
  requestedBy: string;
  units: number;
  createdAt: string;
}

export interface ReturnDetail extends ReturnSummary {
  note: string | null;
  shopperPaysReturn: boolean | null;
  resolution: ReturnResolution | null;
  rejectReason: string | null;
  exchangeOrderId: string | null;
  lines: {
    orderLineId: string;
    title: Record<string, string>;
    optionLabels: Record<string, string>[];
    quantity: number;
    reason: ReturnReason | null;
    restocked: number;
    writtenOff: number;
  }[];
  photos: { id: string; mimeType: string }[];
  /** What a refund would give back for its units now (§3.13). */
  credit: number;
  approvedAt: string | null;
  receivedAt: string | null;
  inspectedAt: string | null;
  resolvedAt: string | null;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export async function listReturns(
  tx: TenantTx,
  actor: Actor,
  query: unknown,
): Promise<ReturnSummary[]> {
  authorize(actor, 'orders.read');
  const q = parseInput(returnListQuery, query);
  const where: SQL[] = [];
  if (q.status) where.push(eq(r.status, q.status));
  if (q.reason) where.push(eq(r.reason, q.reason));
  if (q.orderId) where.push(eq(r.orderId, q.orderId));
  if (q.before) where.push(lt(r.createdAt, new Date(q.before)));
  const o = schema.orders;
  const rows = await tx.db
    .select({
      id: r.id,
      number: r.number,
      orderId: r.orderId,
      orderNumber: o.number,
      contact: o.contact,
      status: r.status,
      reason: r.reason,
      requestedBy: r.requestedBy,
      createdAt: r.createdAt,
      units: sql<number>`(select coalesce(sum(quantity), 0)::int from store.return_lines rl where rl.return_id = ${r.id})`,
    })
    .from(r)
    .innerJoin(o, eq(o.id, r.orderId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(r.createdAt))
    .limit(q.limit);
  const { settings } = await orderSettings(tx);
  return rows.map((x) => ({
    id: x.id,
    number: x.number,
    displayNumber: formatReturnNumber(x.number),
    orderId: x.orderId,
    orderNumber: `${settings.checkout.orderNumberPrefix}${x.orderNumber}`,
    customerName: (x.contact as { name?: string }).name ?? '',
    status: x.status,
    reason: x.reason,
    requestedBy: x.requestedBy,
    units: Number(x.units),
    createdAt: x.createdAt.toISOString(),
  }));
}

export async function getReturn(tx: TenantTx, actor: Actor, id: string): Promise<ReturnDetail> {
  authorize(actor, 'orders.read');
  const o = schema.orders;
  const [row] = await tx.db
    .select({ ret: r, orderNumber: o.number, contact: o.contact })
    .from(r)
    .innerJoin(o, eq(o.id, r.orderId))
    .where(eq(r.id, id));
  if (!row) throw new AppError('not_found');
  const { rows: lines } = await tx.db.execute<{
    order_line_id: string;
    title: Record<string, string>;
    option_labels: Record<string, string>[];
    quantity: number;
    reason: ReturnReason | null;
    restocked: number;
    written_off: number;
  }>(sql`
    select rl.order_line_id, l.title, l.option_labels, rl.quantity, rl.reason, rl.restocked, rl.written_off
      from store.return_lines rl join store.order_lines l on l.id = rl.order_line_id
     where rl.return_id = ${id} order by l.position`);
  const photos = await tx.db
    .select({ id: schema.returnPhotos.id, mimeType: schema.returnPhotos.mimeType })
    .from(schema.returnPhotos)
    .where(eq(schema.returnPhotos.returnId, id))
    .orderBy(schema.returnPhotos.createdAt);
  const { settings } = await orderSettings(tx);
  const x = row.ret;
  return {
    id: x.id,
    number: x.number,
    displayNumber: formatReturnNumber(x.number),
    orderId: x.orderId,
    orderNumber: `${settings.checkout.orderNumberPrefix}${row.orderNumber}`,
    customerName: (row.contact as { name?: string }).name ?? '',
    status: x.status,
    reason: x.reason,
    requestedBy: x.requestedBy,
    units: lines.reduce((a, l) => a + l.quantity, 0),
    createdAt: x.createdAt.toISOString(),
    note: x.note,
    shopperPaysReturn: x.shopperPaysReturn,
    resolution: x.resolution,
    rejectReason: x.rejectReason,
    exchangeOrderId: x.exchangeOrderId,
    lines: lines.map((l) => ({
      orderLineId: l.order_line_id,
      title: l.title,
      optionLabels: l.option_labels ?? [],
      quantity: l.quantity,
      reason: l.reason,
      restocked: l.restocked,
      writtenOff: l.written_off,
    })),
    photos,
    credit: await returnCredit(tx, id),
    approvedAt: iso(x.approvedAt),
    receivedAt: iso(x.receivedAt),
    inspectedAt: iso(x.inspectedAt),
    resolvedAt: iso(x.resolvedAt),
  };
}

/** A photo's R2 key, for the admin API to stream it to staff. */
export async function returnPhotoKey(
  tx: TenantTx,
  actor: Actor,
  returnId: string,
  photoId: string,
): Promise<{ objectKey: string; mimeType: string }> {
  authorize(actor, 'orders.read');
  const p = schema.returnPhotos;
  const [row] = await tx.db
    .select({ objectKey: p.objectKey, mimeType: p.mimeType })
    .from(p)
    .where(and(eq(p.id, photoId), eq(p.returnId, returnId)));
  if (!row) throw new AppError('not_found');
  return row;
}
