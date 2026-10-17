// Editing an order before anything ships (phase-4-plan §3.9): quantities,
// added and removed lines, the address or zone, or the delivery fee with a
// reason. Existing lines keep the price they were ordered at; the
// promotions applied at placement are re-checked, and one that no longer
// qualifies drops off (its use is given back). Reservations follow in the
// same transaction, and the history keeps the lines before and after. The
// preview runs the same code without writing.
import { schema } from '@managemind/db';
import { AppError, uuidv7 } from '@managemind/shared';
import { orderEditInput } from '@managemind/shared/orders';
import { eq, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput } from '../catalog/common';
import { addressSnapshot } from '../customers/service';
import { applyMovements, type Movement } from '../inventory/service';
import { emit } from '../outbox';
import { orderSettings, type Quote, quote } from '../pricing/quote';
import type { TenantTx } from '../tenant';
import { recordHistory } from './history';
import { giveBackPromotionUses, lockOrder, refreshOrder, syncCodAmount } from './lifecycle';
import { writeAdjustments } from './place';

export interface EditResult {
  quote: Quote;
  /** Promotions applied at placement that the new lines no longer qualify for. */
  dropped: { promotionId: string; title: unknown }[];
  /** Settled payments above the new total: Phase 5A refunds it. */
  refundDue: number;
}

export async function editOrder(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
  options: { preview?: boolean } = {},
): Promise<EditResult> {
  authorize(actor, 'orders.write');
  const v = parseInput(orderEditInput, input);
  const order = await lockOrder(tx, id);
  if (order.status === 'cancelled' || order.status === 'completed') {
    throw new AppError('illegal_transition', { detail: `A ${order.status} order can't be edited` });
  }
  const { rows: shipped } = await tx.db.execute(
    sql`select 1 from store.shipments where order_id = ${id} limit 1`,
  );
  if (shipped.length) {
    throw new AppError('illegal_transition', {
      detail: 'Delete the order’s shipments before editing it',
    });
  }
  if (new Set(v.lines.map((l) => l.variantId)).size !== v.lines.length) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'lines', code: 'duplicate', message: 'one line per variant' }],
    });
  }

  const [current] = await tx.db
    .select({
      phone: schema.orders.phone,
      address: schema.orders.address,
      zoneId: schema.orders.zoneId,
      deliveryFee: schema.orders.deliveryFee,
      metadata: schema.orders.metadata,
    })
    .from(schema.orders)
    .where(eq(schema.orders.id, id));
  if (!current) throw new AppError('not_found');
  const { rows: before } = await tx.db.execute<{
    id: string;
    variant_id: string;
    quantity: number;
    unit_price: string;
  }>(sql`
    select id, variant_id, quantity, unit_price from store.order_lines where order_id = ${id} order by position`);
  const { rows: adjustments } = await tx.db.execute<{
    kind: string;
    promotion_id: string | null;
    code: string | null;
    code_id: string | null;
    title: unknown;
    amount: string;
    reason: string | null;
  }>(
    sql`select kind, promotion_id, code, code_id, title, amount, reason from store.order_adjustments where order_id = ${id}`,
  );
  const promotions = adjustments
    .filter((a) => a.promotion_id)
    .map((a) => ({ id: a.promotion_id as string, code: a.code, codeId: a.code_id }));
  const manual = adjustments.find((a) => a.kind === 'manual');
  const metadata = (current.metadata ?? {}) as { deliveryFeeReason?: string };

  const address =
    v.address === undefined
      ? (current.address as Parameters<typeof addressSnapshot>[0] | null)
      : v.address;
  const zone =
    v.zoneId !== undefined
      ? v.zoneId === 'none'
        ? ('none' as const)
        : v.zoneId
          ? { id: v.zoneId }
          : undefined
      : v.address !== undefined
        ? undefined
        : current.zoneId
          ? { id: current.zoneId }
          : ('none' as const);
  const feeOverride =
    v.deliveryFee !== undefined
      ? (v.deliveryFee ?? undefined)
      : metadata.deliveryFeeReason
        ? { amount: Number(current.deliveryFee), reason: metadata.deliveryFeeReason }
        : undefined;

  const settings = await orderSettings(tx);
  const q = await quote(tx, {
    lines: v.lines,
    areaId: address?.areaId ?? null,
    zone,
    deliveryFeeOverride: feeOverride?.amount,
    code: null,
    phone: current.phone,
    paymentMethod: 'cod',
    manualDiscount: manual ? { amount: Number(manual.amount), reason: manual.reason ?? '' } : null,
    maxQuantityPerLine: null,
    settings,
    edit: {
      promotions,
      unitPrices: Object.fromEntries(before.map((l) => [l.variant_id, Number(l.unit_price)])),
    },
  });
  const unavailable = q.lines.filter((l) => l.problem === 'unavailable');
  if (unavailable.length) {
    throw new AppError('cart_invalid', {
      extensions: {
        lines: unavailable.map((l) => ({ variantId: l.variantId, problem: l.problem })),
      },
    });
  }
  const kept = new Set(q.promotions.map((p) => p.promotionId));
  const dropped = adjustments
    .filter((a) => a.promotion_id && !kept.has(a.promotion_id))
    .map((a) => ({ promotionId: a.promotion_id as string, title: a.title }));
  const refundDue = Math.max(0, order.paidTotal - q.totals.total);
  if (options.preview) return { quote: q, dropped, refundDue };

  // Reservations follow the new quantities.
  const oldQty = new Map(before.map((l) => [l.variant_id, l.quantity]));
  const newQty = new Map(v.lines.map((l) => [l.variantId, l.quantity]));
  const editId = uuidv7();
  const moves: Movement[] = [];
  for (const variantId of new Set([...oldQty.keys(), ...newQty.keys()])) {
    const delta = (newQty.get(variantId) ?? 0) - (oldQty.get(variantId) ?? 0);
    if (delta === 0) continue;
    moves.push({
      variantId,
      type: delta > 0 ? 'reservation' : 'release',
      quantity: delta,
      reason: 'order_edited',
      referenceType: 'order',
      referenceId: id,
      idempotencyKey: `order:${id}:edit:${editId}:${variantId}`,
    });
  }
  await applyMovements(tx, actor, moves);

  // Lines: existing ones updated in place, new ones added, removed ones deleted.
  await tx.db.delete(schema.orderAdjustments).where(eq(schema.orderAdjustments.orderId, id));
  const lineIds = new Map<string, string>();
  const totals = new Map(q.totals.lines.map((t) => [t.key, t]));
  const existing = new Map(before.map((l) => [l.variant_id, l.id]));
  for (const [position, p] of q.priced.entries()) {
    const t = totals.get(p.line.key);
    const values = {
      quantity: p.line.quantity,
      unitPrice: p.line.unitPrice,
      vatRateBp: t?.vatRateBp ?? 0,
      lineSubtotal: t?.subtotal ?? 0,
      discountTotal: t?.discount ?? 0,
      vatAmount: t?.vat ?? 0,
      lineTotal: t?.total ?? 0,
      position,
    };
    const lineId = existing.get(p.variant.id);
    if (lineId) {
      await tx.db.update(schema.orderLines).set(values).where(eq(schema.orderLines.id, lineId));
      lineIds.set(p.line.key, lineId);
    } else {
      const newId = uuidv7();
      const variant = p.variant;
      await tx.db.insert(schema.orderLines).values({
        ...values,
        id: newId,
        orderId: id,
        variantId: variant.id,
        productId: variant.productId,
        title: variant.title,
        optionLabels: variant.optionLabels,
        sku: variant.sku,
        image: variant.image,
        compareAtPrice: variant.compareAtPrice,
        costPrice: variant.costPrice,
        weightGrams: variant.weightGrams,
        vatCategory: variant.vatCategory,
      });
      lineIds.set(p.line.key, newId);
    }
  }
  const removed = before.filter((l) => !newQty.has(l.variant_id)).map((l) => l.id);
  if (removed.length) {
    await tx.db.execute(
      sql`delete from store.order_lines where id = any(${sql.param(removed)}::uuid[])`,
    );
  }
  await writeAdjustments(tx, id, q, lineIds);
  if (dropped.length)
    await giveBackPromotionUses(
      tx,
      id,
      dropped.map((d) => d.promotionId),
    );

  const zoneName = q.zone?.name ?? null;
  await tx.db
    .update(schema.orders)
    .set({
      subtotal: q.totals.subtotal,
      discountTotal: q.totals.discountTotal,
      deliveryFee: q.totals.deliveryFee,
      deliveryDiscount: q.totals.deliveryDiscount,
      vatTotal: q.totals.vatTotal,
      rounding: q.totals.rounding,
      total: q.totals.total,
      zoneId: q.zone?.id ?? null,
      zoneName,
      address: address ? addressSnapshot(address) : null,
      metadata: { ...metadata, deliveryFeeReason: feeOverride?.reason ?? undefined },
    })
    .where(eq(schema.orders.id, id));
  await syncCodAmount(tx, id, q.totals.total);
  const lines = (rows: { variantId: string; quantity: number }[]) =>
    rows.map((r) => ({ variantId: r.variantId, quantity: r.quantity }));
  await recordHistory(tx, actor, {
    orderId: id,
    machine: 'edit',
    from: null,
    to: null,
    event: 'edit',
    reason: v.reason,
    data: {
      before: {
        lines: lines(before.map((l) => ({ variantId: l.variant_id, quantity: l.quantity }))),
        total: order.total,
      },
      after: { lines: lines(v.lines), total: q.totals.total },
      dropped: dropped.map((d) => d.promotionId),
    },
  });
  await refreshOrder(tx, actor, id);
  await emit(tx, 'order.edited', {
    aggregateType: 'order',
    aggregateId: id,
    payload: { number: order.number, total: q.totals.total },
  });
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'order.edited',
    entityType: 'order',
    entityId: id,
    before: { total: order.total },
    after: { total: q.totals.total, lines: v.lines },
  });
  return { quote: q, dropped, refundDue };
}
