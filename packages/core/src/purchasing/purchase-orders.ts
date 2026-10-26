// Purchase orders (phase-8-plan §3.2): a draft edited freely, placed with
// the supplier, received in one go or in parts (receipts.ts), then closed
// when the rest won't come. Totals are computed here from the lines and
// other costs; the client's are never used. Costs are left out of every
// view without catalog.cost.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  documentNumber,
  isEditablePurchaseOrder,
  type OtherCost,
  type PurchaseOrderEvent,
  type PurchaseOrderStatus,
  purchaseOrderInput,
  purchaseOrderMachine,
  purchaseOrderPatch,
  purchaseTotals,
} from '@managemind/shared/back-office';
import { tenantSettings } from '@managemind/shared/settings';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { invalid, parseInput } from '../catalog/common';
import { defaultLocationId } from '../inventory/service';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';
import { nextNumber, requireBackOffice, requireCost, seesCost } from './common';
import { activeSupplier } from './suppliers';
import { type Localized, variantLabels } from './variants';

/** What staff do to a PO by hand; receiving is a receipt. */
export type PurchaseOrderAction = Extract<PurchaseOrderEvent, 'place' | 'close' | 'cancel'>;

const po = schema.purchaseOrders;
const pol = schema.purchaseOrderLines;

export interface PurchaseOrderLine {
  id: string;
  variantId: string;
  productId: string;
  title: Localized;
  optionLabels: Localized[];
  sku: string | null;
  barcode: string | null;
  quantity: number;
  receivedQuantity: number;
  /** What's still to come. */
  remaining: number;
  unitCost?: number;
}

export interface PurchaseOrder {
  id: string;
  number: number;
  /** `PO-0001`. */
  reference: string;
  supplier: { id: string; name: string };
  locationId: string;
  status: PurchaseOrderStatus;
  expectedOn: string | null;
  supplierRef: string | null;
  note: string | null;
  lines: PurchaseOrderLine[];
  receipts: { id: string; number: number; reference: string; receivedOn: string }[];
  /** The events allowed now: place, close, cancel. */
  actions: PurchaseOrderAction[];
  placedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  // With catalog.cost only.
  otherCosts?: OtherCost[];
  subtotal?: number;
  otherCostTotal?: number;
  total?: number;
}

type Row = typeof po.$inferSelect;
type LineRow = typeof pol.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function loadOrder(tx: TenantTx, id: string, lock = false): Promise<Row> {
  const query = tx.db.select().from(po).where(eq(po.id, id));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new AppError('not_found');
  return row;
}

async function view(tx: TenantTx, actor: Actor, row: Row): Promise<PurchaseOrder> {
  const lines = await tx.db
    .select()
    .from(pol)
    .where(eq(pol.purchaseOrderId, row.id))
    .orderBy(pol.position, pol.id);
  const labels = await variantLabels(
    tx,
    lines.map((l) => l.variantId),
  );
  const [supplier] = await tx.db
    .select({ id: schema.suppliers.id, name: schema.suppliers.name })
    .from(schema.suppliers)
    .where(eq(schema.suppliers.id, row.supplierId));
  const gr = schema.goodsReceipts;
  const receipts = await tx.db
    .select({ id: gr.id, number: gr.number, receivedOn: gr.receivedOn })
    .from(gr)
    .where(eq(gr.purchaseOrderId, row.id))
    .orderBy(gr.number);
  const cost = seesCost(actor);
  return {
    id: row.id,
    number: row.number,
    reference: documentNumber('PO', row.number),
    supplier: supplier ?? { id: row.supplierId, name: '' },
    locationId: row.locationId,
    status: row.status,
    expectedOn: row.expectedOn,
    supplierRef: row.supplierRef,
    note: row.note,
    lines: lines.map((l) => {
      const label = labels.get(l.variantId);
      return {
        id: l.id,
        variantId: l.variantId,
        productId: label?.productId ?? '',
        title: label?.title ?? {},
        optionLabels: label?.optionLabels ?? [],
        sku: label?.sku ?? null,
        barcode: label?.barcode ?? null,
        quantity: l.quantity,
        receivedQuantity: l.receivedQuantity,
        remaining: Math.max(0, l.quantity - l.receivedQuantity),
        ...(cost ? { unitCost: l.unitCost } : {}),
      };
    }),
    receipts: receipts.map((r) => ({ ...r, reference: documentNumber('GR', r.number) })),
    actions: purchaseOrderMachine
      .events(row.status)
      .filter((e): e is PurchaseOrderAction => e === 'place' || e === 'close' || e === 'cancel'),
    placedAt: iso(row.placedAt),
    closedAt: iso(row.closedAt),
    cancelledAt: iso(row.cancelledAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(cost
      ? {
          otherCosts: row.otherCosts as OtherCost[],
          subtotal: row.subtotal,
          otherCostTotal: row.otherCostTotal,
          total: row.total,
        }
      : {}),
  };
}

export async function getPurchaseOrder(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<PurchaseOrder> {
  authorize(actor, 'purchasing.read');
  await requireBackOffice(tx);
  return view(tx, actor, await loadOrder(tx, id));
}

export interface PurchaseOrderSummary {
  id: string;
  number: number;
  reference: string;
  status: PurchaseOrderStatus;
  supplier: { id: string; name: string };
  expectedOn: string | null;
  lineCount: number;
  ordered: number;
  received: number;
  createdAt: string;
  total?: number;
}

/** GET /purchase-orders: newest first. */
export async function listPurchaseOrders(
  tx: TenantTx,
  actor: Actor,
  query: {
    status?: PurchaseOrderStatus | undefined;
    supplierId?: string | undefined;
    before?: string | undefined;
    limit?: number | undefined;
  } = {},
): Promise<{ items: PurchaseOrderSummary[]; nextCursor: string | null }> {
  authorize(actor, 'purchasing.read');
  await requireBackOffice(tx);
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const filters = [
    query.status ? eq(po.status, query.status) : undefined,
    query.supplierId ? eq(po.supplierId, query.supplierId) : undefined,
    query.before ? lt(po.id, query.before) : undefined,
  ].filter((f) => f !== undefined);
  const rows = await tx.db
    .select({
      id: po.id,
      number: po.number,
      status: po.status,
      supplierId: po.supplierId,
      supplierName: schema.suppliers.name,
      expectedOn: po.expectedOn,
      total: po.total,
      createdAt: po.createdAt,
      lineCount: sql<number>`(select count(*)::int from store.purchase_order_lines l where l.purchase_order_id = ${po.id})`,
      ordered: sql<number>`(select coalesce(sum(l.quantity), 0)::int from store.purchase_order_lines l where l.purchase_order_id = ${po.id})`,
      received: sql<number>`(select coalesce(sum(l.received_quantity), 0)::int from store.purchase_order_lines l where l.purchase_order_id = ${po.id})`,
    })
    .from(po)
    .innerJoin(schema.suppliers, eq(schema.suppliers.id, po.supplierId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(po.id))
    .limit(limit + 1);
  const cost = seesCost(actor);
  const items = rows.slice(0, limit).map((r) => ({
    id: r.id,
    number: r.number,
    reference: documentNumber('PO', r.number),
    status: r.status,
    supplier: { id: r.supplierId, name: r.supplierName },
    expectedOn: r.expectedOn,
    lineCount: r.lineCount,
    ordered: r.ordered,
    received: r.received,
    createdAt: r.createdAt.toISOString(),
    ...(cost ? { total: r.total } : {}),
  }));
  return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null };
}

interface LineIn {
  variantId: string;
  quantity: number;
  unitCost?: number | undefined;
}

/** The lines with their costs: as typed, else the variant's cost; a line with neither is refused. */
async function resolveLines(tx: TenantTx, lines: readonly LineIn[], known: Map<string, number>) {
  const labels = await variantLabels(
    tx,
    lines.map((l) => l.variantId),
  );
  return lines.map((l, i) => {
    const label = labels.get(l.variantId);
    if (!label) throw invalid(`lines.${i}.variantId`, 'unknown variant', 'not_found');
    const unitCost = l.unitCost ?? known.get(l.variantId) ?? label.costPrice;
    if (unitCost === null || unitCost === undefined) {
      throw invalid(`lines.${i}.unitCost`, 'this variant has no cost yet: enter one');
    }
    if (label.archived && !known.has(l.variantId)) {
      throw invalid(`lines.${i}.variantId`, 'the variant is archived');
    }
    return { variantId: l.variantId, quantity: l.quantity, unitCost, position: i };
  });
}

async function checkLocation(tx: TenantTx, locationId: string | undefined): Promise<string> {
  if (!locationId) return defaultLocationId(tx);
  const sl = schema.stockLocations;
  const [row] = await tx.db.select({ id: sl.id }).from(sl).where(eq(sl.id, locationId));
  if (!row) throw invalid('locationId', 'unknown location', 'not_found');
  return row.id;
}

const audited = (
  row: Row,
  lines: readonly Pick<LineRow, 'variantId' | 'quantity' | 'unitCost'>[],
) => ({
  status: row.status,
  supplierId: row.supplierId,
  locationId: row.locationId,
  expectedOn: row.expectedOn,
  supplierRef: row.supplierRef,
  otherCosts: row.otherCosts,
  total: row.total,
  lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitCost: l.unitCost })),
});

/** POST /purchase-orders: a draft (purchasing.write, with costs). */
export async function createPurchaseOrder(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<PurchaseOrder> {
  authorize(actor, 'purchasing.write');
  requireCost(actor);
  await requireBackOffice(tx);
  const v = parseInput(purchaseOrderInput, input);
  await activeSupplier(tx, v.supplierId);
  const locationId = await checkLocation(tx, v.locationId);
  const lines = await resolveLines(tx, v.lines, new Map());
  const totals = purchaseTotals(lines, v.otherCosts);
  const [row] = await tx.db
    .insert(po)
    .values({
      number: await nextNumber(tx, 'purchase_order_number'),
      supplierId: v.supplierId,
      locationId,
      expectedOn: v.expectedOn ?? null,
      supplierRef: v.supplierRef ?? null,
      note: v.note ?? null,
      otherCosts: v.otherCosts,
      ...totals,
      createdBy: actor.userId,
    })
    .returning();
  if (!row) throw new AppError('internal');
  await tx.db.insert(pol).values(lines.map((l) => ({ ...l, purchaseOrderId: row.id })));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'purchase_order.created',
    entityType: 'purchase_order',
    entityId: row.id,
    after: audited(row, lines),
  });
  return view(tx, actor, row);
}

/**
 * PATCH /purchase-orders/{id} (§3.2). A draft changes freely. An ordered
 * PO keeps its supplier, and once something arrived its location; a line
 * that received units stays, at no fewer units than arrived. Each change is
 * in the audit log with what it was before.
 */
export async function updatePurchaseOrder(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<PurchaseOrder> {
  authorize(actor, 'purchasing.write');
  requireCost(actor);
  await requireBackOffice(tx);
  const v = parseInput(purchaseOrderPatch, input);
  const before = await loadOrder(tx, id, true);
  if (!isEditablePurchaseOrder(before.status)) {
    throw new AppError('illegal_transition', {
      detail: `A ${before.status.replace('_', ' ')} purchase order can't be changed`,
    });
  }
  const current = await tx.db.select().from(pol).where(eq(pol.purchaseOrderId, id)).for('update');
  const received = current.filter((l) => l.receivedQuantity > 0);
  if (before.status !== 'draft') {
    if (v.supplierId !== undefined && v.supplierId !== before.supplierId) {
      throw invalid('supplierId', 'an ordered purchase order keeps its supplier');
    }
    if (v.locationId !== undefined && v.locationId !== before.locationId && received.length) {
      throw invalid('locationId', 'goods were already received at this location');
    }
  }
  if (v.supplierId !== undefined && v.supplierId !== before.supplierId) {
    await activeSupplier(tx, v.supplierId);
  }
  const locationId =
    v.locationId !== undefined ? await checkLocation(tx, v.locationId) : before.locationId;

  let lines: (LineIn & { unitCost: number; position: number })[] = current.map((l) => ({
    variantId: l.variantId,
    quantity: l.quantity,
    unitCost: l.unitCost,
    position: l.position,
  }));
  if (v.lines) {
    const kept = new Map(current.map((l) => [l.variantId, l.unitCost]));
    lines = await resolveLines(tx, v.lines, kept);
    const next = new Map(lines.map((l) => [l.variantId, l]));
    for (const r of received) {
      const line = next.get(r.variantId);
      if (!line) throw invalid('lines', 'a line that received goods can’t be removed');
      if (line.quantity < r.receivedQuantity) {
        throw invalid(
          `lines.${line.position}.quantity`,
          `${r.receivedQuantity} already arrived: order at least that many`,
        );
      }
    }
  }
  const otherCosts = v.otherCosts ?? (before.otherCosts as OtherCost[]);
  const totals = purchaseTotals(lines, otherCosts);
  const [after] = await tx.db
    .update(po)
    .set({
      supplierId: v.supplierId ?? before.supplierId,
      locationId,
      ...(v.expectedOn !== undefined ? { expectedOn: v.expectedOn } : {}),
      ...(v.supplierRef !== undefined ? { supplierRef: v.supplierRef } : {}),
      ...(v.note !== undefined ? { note: v.note } : {}),
      otherCosts,
      ...totals,
    })
    .where(eq(po.id, id))
    .returning();
  if (!after) throw new AppError('not_found');
  if (v.lines) {
    const byVariant = new Map(current.map((l) => [l.variantId, l]));
    const keep = new Set(lines.map((l) => l.variantId));
    const gone = current.filter((l) => !keep.has(l.variantId)).map((l) => l.id);
    if (gone.length) await tx.db.delete(pol).where(inArray(pol.id, gone));
    for (const l of lines) {
      const existing = byVariant.get(l.variantId);
      if (existing) {
        await tx.db
          .update(pol)
          .set({ quantity: l.quantity, unitCost: l.unitCost, position: l.position })
          .where(eq(pol.id, existing.id));
      } else {
        await tx.db.insert(pol).values({ ...l, purchaseOrderId: id });
      }
    }
  }
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'purchase_order.updated',
    entityType: 'purchase_order',
    entityId: id,
    before: audited(before, current),
    after: audited(after, lines),
  });
  return view(tx, actor, after);
}

/** DELETE /purchase-orders/{id}: a draft only. */
export async function deletePurchaseOrder(tx: TenantTx, actor: Actor, id: string): Promise<void> {
  authorize(actor, 'purchasing.write');
  await requireBackOffice(tx);
  const before = await loadOrder(tx, id, true);
  if (before.status !== 'draft') {
    throw new AppError('illegal_transition', {
      detail: 'Only a draft can be deleted; cancel an ordered purchase order instead',
    });
  }
  const lines = await tx.db.select().from(pol).where(eq(pol.purchaseOrderId, id));
  await tx.db.delete(po).where(eq(po.id, id));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'purchase_order.deleted',
    entityType: 'purchase_order',
    entityId: id,
    before: audited(before, lines),
  });
}

async function move(
  tx: TenantTx,
  actor: Actor,
  id: string,
  event: 'place' | 'close' | 'cancel',
): Promise<PurchaseOrder> {
  authorize(actor, 'purchasing.write');
  await requireBackOffice(tx);
  const before = await loadOrder(tx, id, true);
  const t = purchaseOrderMachine.transition(before.status, event, undefined);
  const stamp =
    event === 'place'
      ? { placedAt: sql`now()` }
      : event === 'close'
        ? { closedAt: sql`now()` }
        : { cancelledAt: sql`now()` };
  const [after] = await tx.db
    .update(po)
    .set({ status: t.to, ...stamp })
    .where(eq(po.id, id))
    .returning();
  if (!after) throw new AppError('not_found');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: `purchase_order.${event === 'place' ? 'placed' : event === 'close' ? 'closed' : 'cancelled'}`,
    entityType: 'purchase_order',
    entityId: id,
    before: { status: before.status },
    after: { status: after.status },
  });
  if (event === 'place') {
    await emit(tx, 'purchase_order.placed', {
      aggregateType: 'purchase_order',
      aggregateId: id,
      payload: { number: after.number, supplierId: after.supplierId },
    });
  }
  return view(tx, actor, after);
}

/** The PO goes to the supplier: printed, or shared as a PDF or a WhatsApp message. */
export const placePurchaseOrder = (tx: TenantTx, actor: Actor, id: string) =>
  move(tx, actor, id, 'place');

/** What's left won't come; the remaining quantities stay for the record. */
export const closePurchaseOrder = (tx: TenantTx, actor: Actor, id: string) =>
  move(tx, actor, id, 'close');

/** Nothing was received: a draft or an ordered PO. */
export const cancelPurchaseOrder = (tx: TenantTx, actor: Actor, id: string) =>
  move(tx, actor, id, 'cancel');

export interface ReorderLine {
  variantId: string;
  productId: string;
  title: Localized;
  optionLabels: Localized[];
  sku: string | null;
  available: number;
  lowStockThreshold: number;
  /** Brings the variant back to `reorderMultiple` × its threshold (§3.2). */
  quantity: number;
  unitCost?: number | null;
}

/**
 * GET /purchase-orders/reorder?supplierId=: the variants this supplier
 * last delivered that are at or below their low-stock threshold.
 */
export async function reorderSuggestions(
  tx: TenantTx,
  actor: Actor,
  supplierId: string,
): Promise<ReorderLine[]> {
  authorize(actor, 'purchasing.write');
  await requireBackOffice(tx);
  await activeSupplier(tx, supplierId);
  const [store] = await tx.db
    .select({ settings: schema.tenants.settings })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tx.tenantId));
  const multiple = tenantSettings.parse(store?.settings ?? {}).backOffice.reorderMultiple;
  const { rows } = await tx.db.execute<{
    variant_id: string;
    available: number;
    threshold: number;
  }>(sql`
    with last_supplier as (
      select distinct on (gl.variant_id) gl.variant_id, r.supplier_id
        from store.goods_receipt_lines gl join store.goods_receipts r on r.id = gl.goods_receipt_id
       order by gl.variant_id, r.received_on desc, r.number desc)
    select v.id as variant_id, v.low_stock_threshold as threshold,
           coalesce((select sum(l.on_hand - l.reserved) from store.inventory_levels l
                      where l.variant_id = v.id), 0)::int as available
      from last_supplier ls
      join store.variants v on v.id = ls.variant_id
      join store.products p on p.id = v.product_id
     where ls.supplier_id = ${supplierId}
       and v.archived_at is null and p.status <> 'archived'
       and v.track_inventory and v.low_stock_threshold is not null
       and coalesce((select sum(l.on_hand - l.reserved) from store.inventory_levels l
                      where l.variant_id = v.id), 0) <= v.low_stock_threshold
     order by v.id
     limit 200`);
  const labels = await variantLabels(
    tx,
    rows.map((r) => r.variant_id),
  );
  const cost = seesCost(actor);
  return rows.map((r) => {
    const label = labels.get(r.variant_id);
    return {
      variantId: r.variant_id,
      productId: label?.productId ?? '',
      title: label?.title ?? {},
      optionLabels: label?.optionLabels ?? [],
      sku: label?.sku ?? null,
      available: r.available,
      lowStockThreshold: r.threshold,
      quantity: Math.max(1, r.threshold * multiple - r.available),
      ...(cost ? { unitCost: label?.costPrice ?? null } : {}),
    };
  });
}
