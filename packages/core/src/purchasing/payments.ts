// Payments to suppliers (phase-8-plan §3.7): each reduces the supplier's
// balance and isn't allocated to a PO; the dues report applies them to the
// oldest receipts first. Every record, change and removal is audited with
// its old values (§8).
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  type SpendMethod,
  supplierPaymentInput,
  supplierPaymentPatch,
} from '@managemind/shared/back-office';
import { and, desc, eq, gte, lt, lte } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput } from '../catalog/common';
import type { TenantTx } from '../tenant';
import { requireBackOffice } from './common';
import { activeSupplier } from './suppliers';

const sp = schema.supplierPayments;

export interface SupplierPayment {
  id: string;
  supplier: { id: string; name: string };
  paidOn: string;
  amount: number;
  method: SpendMethod;
  reference: string | null;
  note: string | null;
  goodsReceiptId: string | null;
  recordedBy: string | null;
  createdAt: string;
}

type Row = typeof sp.$inferSelect;

async function toPayment(tx: TenantTx, row: Row): Promise<SupplierPayment> {
  const [supplier] = await tx.db
    .select({ id: schema.suppliers.id, name: schema.suppliers.name })
    .from(schema.suppliers)
    .where(eq(schema.suppliers.id, row.supplierId));
  return {
    id: row.id,
    supplier: supplier ?? { id: row.supplierId, name: '' },
    paidOn: row.paidOn,
    amount: row.amount,
    method: row.method,
    reference: row.reference,
    note: row.note,
    goodsReceiptId: row.goodsReceiptId,
    recordedBy: row.recordedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

const audited = (row: Row) => ({
  supplierId: row.supplierId,
  paidOn: row.paidOn,
  amount: row.amount,
  method: row.method,
  reference: row.reference,
  note: row.note,
});

/** GET /supplier-payments: newest first (purchasing.pay). */
export async function listSupplierPayments(
  tx: TenantTx,
  actor: Actor,
  query: {
    supplierId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    before?: string | undefined;
    limit?: number | undefined;
  } = {},
): Promise<{ items: SupplierPayment[]; nextCursor: string | null }> {
  authorize(actor, 'purchasing.pay');
  await requireBackOffice(tx);
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const filters = [
    query.supplierId ? eq(sp.supplierId, query.supplierId) : undefined,
    query.from ? gte(sp.paidOn, query.from) : undefined,
    query.to ? lte(sp.paidOn, query.to) : undefined,
    query.before ? lt(sp.id, query.before) : undefined,
  ].filter((f) => f !== undefined);
  const s = schema.suppliers;
  const rows = await tx.db
    .select({ p: sp, name: s.name })
    .from(sp)
    .innerJoin(s, eq(s.id, sp.supplierId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(sp.paidOn), desc(sp.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit).map(({ p, name }) => ({
    id: p.id,
    supplier: { id: p.supplierId, name },
    paidOn: p.paidOn,
    amount: p.amount,
    method: p.method,
    reference: p.reference,
    note: p.note,
    goodsReceiptId: p.goodsReceiptId,
    recordedBy: p.recordedBy,
    createdAt: p.createdAt.toISOString(),
  }));
  return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null };
}

export async function createSupplierPayment(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<SupplierPayment> {
  authorize(actor, 'purchasing.pay');
  await requireBackOffice(tx);
  const v = parseInput(supplierPaymentInput, input);
  await activeSupplier(tx, v.supplierId);
  const [row] = await tx.db
    .insert(sp)
    .values({
      supplierId: v.supplierId,
      paidOn: v.paidOn,
      amount: v.amount,
      method: v.method,
      reference: v.reference ?? null,
      note: v.note ?? null,
      recordedBy: actor.userId,
    })
    .returning();
  if (!row) throw new AppError('internal');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'supplier_payment.created',
    entityType: 'supplier_payment',
    entityId: row.id,
    after: audited(row),
  });
  return toPayment(tx, row);
}

async function lockPayment(tx: TenantTx, id: string): Promise<Row> {
  const [row] = await tx.db.select().from(sp).where(eq(sp.id, id)).for('update');
  if (!row) throw new AppError('not_found');
  return row;
}

export async function updateSupplierPayment(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<SupplierPayment> {
  authorize(actor, 'purchasing.pay');
  await requireBackOffice(tx);
  const v = parseInput(supplierPaymentPatch, input);
  const before = await lockPayment(tx, id);
  const [row] = await tx.db
    .update(sp)
    .set({
      ...(v.paidOn !== undefined ? { paidOn: v.paidOn } : {}),
      ...(v.amount !== undefined ? { amount: v.amount } : {}),
      ...(v.method !== undefined ? { method: v.method } : {}),
      ...(v.reference !== undefined ? { reference: v.reference } : {}),
      ...(v.note !== undefined ? { note: v.note } : {}),
    })
    .where(eq(sp.id, id))
    .returning();
  if (!row) throw new AppError('not_found');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'supplier_payment.updated',
    entityType: 'supplier_payment',
    entityId: id,
    before: audited(before),
    after: audited(row),
  });
  return toPayment(tx, row);
}

export async function deleteSupplierPayment(tx: TenantTx, actor: Actor, id: string): Promise<void> {
  authorize(actor, 'purchasing.pay');
  await requireBackOffice(tx);
  const before = await lockPayment(tx, id);
  await tx.db.delete(sp).where(eq(sp.id, id));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'supplier_payment.deleted',
    entityType: 'supplier_payment',
    entityId: id,
    before: audited(before),
  });
}
