// Goods receipts (phase-8-plan §3.3): what arrived, at what cost. One
// transaction writes the receipt and its lines, moves the average cost of
// each variant (before the stock goes up, so the average weighs what was on
// hand), receives the stock with a movement per line, advances the PO, and
// records a payment made on the spot. A repeated key writes nothing twice.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  documentNumber,
  type GoodsReceiptInput,
  goodsReceiptInput,
  landedUnitCosts,
  type OtherCost,
  purchaseOrderCostShare,
  purchaseOrderMachine,
  purchaseTotals,
  receiveEvent,
} from '@managemind/shared/back-office';
import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { invalid, parseInput } from '../catalog/common';
import { applyMovements, defaultLocationId } from '../inventory/service';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';
import { nextNumber, requireBackOffice, seesCost, today } from './common';
import { receiveAtCost } from './costs';
import { activeSupplier } from './suppliers';
import { type Localized, variantLabels } from './variants';

const gr = schema.goodsReceipts;
const grl = schema.goodsReceiptLines;
const po = schema.purchaseOrders;
const pol = schema.purchaseOrderLines;

export interface GoodsReceiptLine {
  variantId: string;
  productId: string;
  title: Localized;
  optionLabels: Localized[];
  sku: string | null;
  quantity: number;
  purchaseOrderLineId: string | null;
  unitCost?: number;
  landedUnitCost?: number;
}

export interface GoodsReceipt {
  id: string;
  number: number;
  /** `GR-0001`. */
  reference: string;
  supplier: { id: string; name: string } | null;
  purchaseOrder: { id: string; number: number; reference: string } | null;
  locationId: string;
  receivedOn: string;
  supplierInvoice: string | null;
  note: string | null;
  lines: GoodsReceiptLine[];
  receivedBy: string | null;
  createdAt: string;
  /** Lines that came in above what was still to come (§3.3): received anyway. */
  warnings: { variantId: string; code: 'over_received'; extra: number }[];
  // With catalog.cost only.
  otherCosts?: OtherCost[];
  subtotal?: number;
  otherCostTotal?: number;
  total?: number;
  /** The payment made with it, with purchasing.pay. */
  payment?: { id: string; amount: number; method: string; reference: string | null } | null;
}

type Row = typeof gr.$inferSelect;

async function view(
  tx: TenantTx,
  actor: Actor,
  row: Row,
  warnings: GoodsReceipt['warnings'] = [],
): Promise<GoodsReceipt> {
  const lines = await tx.db.select().from(grl).where(eq(grl.goodsReceiptId, row.id));
  const labels = await variantLabels(
    tx,
    lines.map((l) => l.variantId),
  );
  const [supplier] = row.supplierId
    ? await tx.db
        .select({ id: schema.suppliers.id, name: schema.suppliers.name })
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, row.supplierId))
    : [];
  const [order] = row.purchaseOrderId
    ? await tx.db
        .select({ id: po.id, number: po.number })
        .from(po)
        .where(eq(po.id, row.purchaseOrderId))
    : [];
  const cost = seesCost(actor);
  const pays = actor.permissions.has('purchasing.pay');
  const sp = schema.supplierPayments;
  const [payment] = pays
    ? await tx.db
        .select({ id: sp.id, amount: sp.amount, method: sp.method, reference: sp.reference })
        .from(sp)
        .where(eq(sp.goodsReceiptId, row.id))
    : [];
  return {
    id: row.id,
    number: row.number,
    reference: documentNumber('GR', row.number),
    supplier: supplier ?? null,
    purchaseOrder: order ? { ...order, reference: documentNumber('PO', order.number) } : null,
    locationId: row.locationId,
    receivedOn: row.receivedOn,
    supplierInvoice: row.supplierInvoice,
    note: row.note,
    lines: lines.map((l) => {
      const label = labels.get(l.variantId);
      return {
        variantId: l.variantId,
        productId: label?.productId ?? '',
        title: label?.title ?? {},
        optionLabels: label?.optionLabels ?? [],
        sku: label?.sku ?? null,
        quantity: l.quantity,
        purchaseOrderLineId: l.purchaseOrderLineId,
        ...(cost ? { unitCost: l.unitCost, landedUnitCost: l.landedUnitCost } : {}),
      };
    }),
    receivedBy: row.receivedBy,
    createdAt: row.createdAt.toISOString(),
    warnings,
    ...(cost
      ? {
          otherCosts: row.otherCosts as OtherCost[],
          subtotal: row.subtotal,
          otherCostTotal: row.otherCostTotal,
          total: row.total,
        }
      : {}),
    ...(pays ? { payment: payment ?? null } : {}),
  };
}

export async function getGoodsReceipt(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<GoodsReceipt> {
  authorize(actor, 'purchasing.read');
  await requireBackOffice(tx);
  const [row] = await tx.db.select().from(gr).where(eq(gr.id, id));
  if (!row) throw new AppError('not_found');
  return view(tx, actor, row);
}

export interface GoodsReceiptSummary {
  id: string;
  number: number;
  reference: string;
  receivedOn: string;
  supplier: { id: string; name: string } | null;
  purchaseOrderId: string | null;
  units: number;
  total?: number;
}

/** GET /goods-receipts: newest first. */
export async function listGoodsReceipts(
  tx: TenantTx,
  actor: Actor,
  query: {
    supplierId?: string | undefined;
    purchaseOrderId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    before?: string | undefined;
    limit?: number | undefined;
  } = {},
): Promise<{ items: GoodsReceiptSummary[]; nextCursor: string | null }> {
  authorize(actor, 'purchasing.read');
  await requireBackOffice(tx);
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const filters = [
    query.supplierId ? eq(gr.supplierId, query.supplierId) : undefined,
    query.purchaseOrderId ? eq(gr.purchaseOrderId, query.purchaseOrderId) : undefined,
    query.from ? gte(gr.receivedOn, query.from) : undefined,
    query.to ? lte(gr.receivedOn, query.to) : undefined,
    query.before ? lt(gr.id, query.before) : undefined,
  ].filter((f) => f !== undefined);
  const s = schema.suppliers;
  const rows = await tx.db
    .select({
      id: gr.id,
      number: gr.number,
      receivedOn: gr.receivedOn,
      supplierId: gr.supplierId,
      supplierName: s.name,
      purchaseOrderId: gr.purchaseOrderId,
      total: gr.total,
      units: sql<number>`(select coalesce(sum(l.quantity), 0)::int from store.goods_receipt_lines l where l.goods_receipt_id = ${gr.id})`,
    })
    .from(gr)
    .leftJoin(s, eq(s.id, gr.supplierId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(gr.id))
    .limit(limit + 1);
  const cost = seesCost(actor);
  const items = rows.slice(0, limit).map((r) => ({
    id: r.id,
    number: r.number,
    reference: documentNumber('GR', r.number),
    receivedOn: r.receivedOn,
    supplier: r.supplierId ? { id: r.supplierId, name: r.supplierName ?? '' } : null,
    purchaseOrderId: r.purchaseOrderId,
    units: r.units,
    ...(cost ? { total: r.total } : {}),
  }));
  return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null };
}

/**
 * Who may receive what (§3.11): staff receive an ordered PO's quantities
 * with inventory.write, at the PO's costs; costs, other costs and a receipt
 * without a PO need purchasing.write and catalog.cost; paying needs
 * purchasing.pay.
 */
function authorizeReceipt(actor: Actor, v: GoodsReceiptInput): void {
  const withCosts = v.lines.some((l) => l.unitCost !== undefined) || v.otherCosts.length > 0;
  if (!v.purchaseOrderId || withCosts) {
    authorize(actor, 'purchasing.write');
    if (!seesCost(actor))
      throw new AppError('forbidden', { detail: 'costs need the cost permission' });
  } else {
    authorize(actor, 'inventory.write');
  }
  if (v.payment) authorize(actor, 'purchasing.pay');
}

const ownOtherCosts = sql`coalesce((select sum((c->>'amount')::bigint) from jsonb_array_elements(${gr.otherCosts}) c), 0)`;

/** POST /goods-receipts: a receipt for an ordered PO, or a direct one (Q5). */
export async function createGoodsReceipt(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
  options: { idempotencyKey?: string | undefined } = {},
): Promise<GoodsReceipt> {
  const v = parseInput(goodsReceiptInput, input);
  authorizeReceipt(actor, v);
  await requireBackOffice(tx);
  if (options.idempotencyKey) {
    const [done] = await tx.db
      .select()
      .from(gr)
      .where(eq(gr.idempotencyKey, options.idempotencyKey));
    if (done) return view(tx, actor, done);
  }
  if (v.payment && !v.supplierId && !v.purchaseOrderId) {
    throw invalid('payment', 'a payment needs a supplier');
  }

  // The PO, its lines and what earlier receipts carried of its other costs.
  type OrderLine = typeof pol.$inferSelect;
  let order: typeof po.$inferSelect | null = null;
  let orderLines = new Map<string, OrderLine>();
  if (v.purchaseOrderId) {
    const [row] = await tx.db.select().from(po).where(eq(po.id, v.purchaseOrderId)).for('update');
    if (!row) throw invalid('purchaseOrderId', 'unknown purchase order', 'not_found');
    order = row;
    if (!purchaseOrderMachine.can(order.status, 'receive', undefined)) {
      throw new AppError('illegal_transition', {
        detail: `A ${order.status.replace('_', ' ')} purchase order can't be received`,
      });
    }
    if (v.supplierId && v.supplierId !== order.supplierId) {
      throw invalid('supplierId', 'the purchase order is from another supplier');
    }
    if (v.locationId && v.locationId !== order.locationId) {
      throw invalid('locationId', 'the purchase order is received at its own location');
    }
    const rows = await tx.db
      .select()
      .from(pol)
      .where(eq(pol.purchaseOrderId, order.id))
      .orderBy(pol.id)
      .for('update');
    orderLines = new Map(rows.map((l) => [l.variantId, l]));
  }
  const supplierId = order?.supplierId ?? v.supplierId ?? null;
  if (supplierId && !order) await activeSupplier(tx, supplierId);
  const locationId = order?.locationId ?? v.locationId ?? (await defaultLocationId(tx));
  if (!order && v.locationId) {
    const sl = schema.stockLocations;
    const [loc] = await tx.db.select({ id: sl.id }).from(sl).where(eq(sl.id, v.locationId));
    if (!loc) throw invalid('locationId', 'unknown location', 'not_found');
  }

  // Each line's cost: as entered, else the PO's, else the variant's.
  const labels = await variantLabels(
    tx,
    v.lines.map((l) => l.variantId),
  );
  const warnings: GoodsReceipt['warnings'] = [];
  const lines = v.lines.map((l, i) => {
    const label = labels.get(l.variantId);
    if (!label) throw invalid(`lines.${i}.variantId`, 'unknown variant', 'not_found');
    const orderLine = orderLines.get(l.variantId);
    if (order && !orderLine) {
      throw invalid(`lines.${i}.variantId`, 'not on the purchase order: add it to the PO first');
    }
    const unitCost = l.unitCost ?? orderLine?.unitCost ?? label.costPrice;
    if (unitCost === null || unitCost === undefined) {
      throw invalid(`lines.${i}.unitCost`, 'this variant has no cost yet: enter one');
    }
    if (orderLine) {
      const extra = orderLine.receivedQuantity + l.quantity - orderLine.quantity;
      if (extra > 0) {
        warnings.push({
          variantId: l.variantId,
          code: 'over_received',
          extra: Math.min(extra, l.quantity),
        });
      }
    }
    return { variantId: l.variantId, quantity: l.quantity, unitCost, orderLine };
  });

  // Other costs: this receipt's share of the PO's, plus its own (Q4).
  const own = v.otherCosts.reduce((a, c) => a + c.amount, 0);
  let share = 0;
  let completes = false;
  if (order) {
    const all = [...orderLines.values()];
    const receivedNow = new Map(lines.map((l) => [l.variantId, l.quantity]));
    completes = all.every(
      (l) => l.receivedQuantity + (receivedNow.get(l.variantId) ?? 0) >= l.quantity,
    );
    const atOrderCost = (l: OrderLine, q: number) => Math.min(q, l.quantity) * l.unitCost;
    const [allocated] = await tx.db
      .select({ total: sql<string>`coalesce(sum(${gr.otherCostTotal} - ${ownOtherCosts}), 0)` })
      .from(gr)
      .where(eq(gr.purchaseOrderId, order.id));
    share = purchaseOrderCostShare({
      otherCostTotal: order.otherCostTotal,
      poValue: order.subtotal,
      receivedBefore: all.reduce((a, l) => a + atOrderCost(l, l.receivedQuantity), 0),
      receivedNow: all.reduce(
        (a, l) =>
          a +
          atOrderCost(l, l.receivedQuantity + (receivedNow.get(l.variantId) ?? 0)) -
          atOrderCost(l, l.receivedQuantity),
        0,
      ),
      allocatedBefore: Number(allocated?.total ?? 0),
      completes,
    });
  }
  const { subtotal } = purchaseTotals(lines, []);
  const otherCostTotal = share + own;
  const landed = landedUnitCosts(lines, otherCostTotal);
  const receivedOn = v.receivedOn ?? today();

  let row: Row | undefined;
  try {
    [row] = await tx.db
      .insert(gr)
      .values({
        number: await nextNumber(tx, 'goods_receipt_number'),
        supplierId,
        purchaseOrderId: order?.id ?? null,
        locationId,
        receivedOn,
        supplierInvoice: v.supplierInvoice ?? null,
        otherCosts: v.otherCosts,
        subtotal,
        otherCostTotal,
        total: subtotal + otherCostTotal,
        note: v.note ?? null,
        receivedBy: actor.userId,
        idempotencyKey: options.idempotencyKey ?? null,
      })
      .returning();
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code;
    if (code === '23505')
      throw new AppError('conflict', { detail: 'this receipt was already saved' });
    throw e;
  }
  if (!row) throw new AppError('internal');
  const receipt = row;
  await tx.db.insert(grl).values(
    lines.map((l, i) => ({
      goodsReceiptId: receipt.id,
      purchaseOrderLineId: l.orderLine?.id ?? null,
      variantId: l.variantId,
      quantity: l.quantity,
      unitCost: l.unitCost,
      landedUnitCost: landed[i] as number,
    })),
  );

  // The average first, against what was on hand; then the stock.
  const ref = { referenceType: 'goods_receipt', referenceId: receipt.id };
  await receiveAtCost(
    tx,
    actor,
    lines.map((l, i) => ({
      variantId: l.variantId,
      quantity: l.quantity,
      unitCost: landed[i] as number,
    })),
    'receipt',
    ref,
  );
  await applyMovements(
    tx,
    actor,
    lines.map((l, i) => ({
      ...ref,
      variantId: l.variantId,
      locationId,
      type: 'receive' as const,
      quantity: l.quantity,
      reason: 'received',
      unitCost: landed[i] as number,
      idempotencyKey: `goods_receipt:${receipt.id}:${l.variantId}`,
    })),
  );

  if (order) {
    for (const l of lines) {
      if (!l.orderLine) continue;
      await tx.db
        .update(pol)
        .set({ receivedQuantity: l.orderLine.receivedQuantity + l.quantity })
        .where(eq(pol.id, l.orderLine.id));
    }
    const t = purchaseOrderMachine.transition(
      order.status,
      receiveEvent(completes ? 0 : 1),
      undefined,
    );
    if (t.to !== order.status) {
      await tx.db.update(po).set({ status: t.to }).where(eq(po.id, order.id));
    } else {
      await tx.db.update(po).set({ updatedAt: sql`now()` }).where(eq(po.id, order.id));
    }
  }

  if (v.payment && supplierId) {
    await tx.db.insert(schema.supplierPayments).values({
      supplierId,
      paidOn: receivedOn,
      amount: v.payment.amount,
      method: v.payment.method,
      reference: v.payment.reference ?? null,
      goodsReceiptId: receipt.id,
      recordedBy: actor.userId,
    });
  }

  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'goods_receipt.created',
    entityType: 'goods_receipt',
    entityId: receipt.id,
    after: {
      number: receipt.number,
      purchaseOrderId: receipt.purchaseOrderId,
      supplierId,
      total: receipt.total,
      lines: lines.map((l, i) => ({
        variantId: l.variantId,
        quantity: l.quantity,
        unitCost: l.unitCost,
        landedUnitCost: landed[i],
      })),
      payment: v.payment ?? null,
    },
  });
  await emit(tx, 'goods_receipt.created', {
    aggregateType: 'goods_receipt',
    aggregateId: receipt.id,
    payload: {
      number: receipt.number,
      purchaseOrderId: receipt.purchaseOrderId,
      lines: lines.length,
    },
  });
  return view(tx, actor, receipt, warnings);
}
