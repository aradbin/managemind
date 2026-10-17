// Customers (phase-4-plan §3.10): one per phone number per store. Checkout,
// manual orders and imports find a customer by the normalized phone or
// create one; the name and email come from the first order, and a later
// order with another name keeps the customer's (Q15). Totals are kept in
// the same transaction as order changes. Customers are soft-deleted.
import { schema } from '@managemind/db';
import { AppError, normalizePhone } from '@managemind/shared';
import { placeNames } from '@managemind/shared/geo';
import { addressInput, customerInput, customerPatch } from '@managemind/shared/orders';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput, pgError } from '../catalog/common';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';

export interface CustomerAddress {
  id: string;
  name: string;
  phone: string;
  divisionId: number;
  districtId: number;
  areaId: number;
  line: string;
  label: string | null;
  isDefault: boolean;
}

export interface Customer {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  tags: string[];
  note: string | null;
  orderCount: number;
  totalSpent: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  createdAt: string;
}

export const MAX_ADDRESSES = 10;

const c = schema.customers;
const CUSTOMER_COLUMNS = {
  id: c.id,
  phone: c.phone,
  name: c.name,
  email: c.email,
  tags: c.tags,
  note: c.note,
  orderCount: c.orderCount,
  totalSpent: c.totalSpent,
  firstOrderAt: c.firstOrderAt,
  lastOrderAt: c.lastOrderAt,
  createdAt: c.createdAt,
};
const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
const toCustomer = (
  r: {
    [K in keyof typeof CUSTOMER_COLUMNS]: unknown;
  },
): Customer => ({
  ...(r as unknown as Customer),
  totalSpent: Number(r.totalSpent),
  firstOrderAt: iso(r.firstOrderAt as Date | null),
  lastOrderAt: iso(r.lastOrderAt as Date | null),
  createdAt: iso(r.createdAt as Date) as string,
});

/**
 * The customer for a phone, created if new (checkout and manual orders).
 * Concurrent first orders from one phone meet on the unique index and both
 * end up with the same customer.
 */
export async function findOrCreateCustomer(
  tx: TenantTx,
  input: { phone: string; name: string; email?: string | null | undefined },
): Promise<{ id: string; created: boolean }> {
  const inserted = await tx.db
    .insert(c)
    .values({ phone: input.phone, name: input.name, email: input.email ?? null })
    .onConflictDoNothing({ target: [c.tenantId, c.phone], where: sql`deleted_at is null` })
    .returning({ id: c.id });
  if (inserted[0]) {
    await emit(tx, 'customer.created', {
      aggregateType: 'customer',
      aggregateId: inserted[0].id,
      payload: {},
    });
    return { id: inserted[0].id, created: true };
  }
  const [existing] = await tx.db
    .select({ id: c.id, email: c.email })
    .from(c)
    .where(and(eq(c.phone, input.phone), isNull(c.deletedAt)));
  if (!existing) throw new AppError('internal', { detail: 'customer vanished' });
  // An email typed later fills a gap, never replaces one.
  if (!existing.email && input.email) {
    await tx.db.update(c).set({ email: input.email }).where(eq(c.id, existing.id));
  }
  return { id: existing.id, created: false };
}

export interface CustomerQuery {
  q?: string | undefined;
  tag?: string | undefined;
  after?: string | undefined;
  limit?: number | undefined;
}

/** The list: newest activity first, searched by phone or name, filtered by tag. */
export async function listCustomers(
  tx: TenantTx,
  actor: Actor,
  query: CustomerQuery = {},
): Promise<{ items: Customer[]; nextCursor: string | null }> {
  authorize(actor, 'customers.read');
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const q = query.q?.trim();
  const phone = q ? normalizePhone(q) : null;
  const digits = q?.replace(/\D/g, '') ?? '';
  const search = q
    ? phone
      ? sql`and c.phone = ${phone}`
      : digits.length >= 4 && /^[\d\s+-]+$/.test(q)
        ? sql`and c.phone like ${`%${digits}%`}`
        : sql`and app.search_text(c.name) like app.search_text(${`%${q.replace(/[\\%_]/g, (x) => `\\${x}`)}%`})`
    : sql``;
  const { rows } = await tx.db.execute<Record<keyof typeof CUSTOMER_COLUMNS, unknown>>(sql`
    select c.id, c.phone, c.name, c.email, c.tags, c.note, c.order_count as "orderCount",
           c.total_spent as "totalSpent", c.first_order_at as "firstOrderAt",
           c.last_order_at as "lastOrderAt", c.created_at as "createdAt"
      from store.customers c
     where c.deleted_at is null ${search}
       ${query.tag ? sql`and ${query.tag} = any(c.tags)` : sql``}
       ${query.after ? sql`and c.id < ${query.after}` : sql``}
     order by c.id desc limit ${limit + 1}`);
  const items = rows.slice(0, limit).map(toCustomer);
  return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null };
}

async function loadCustomer(tx: TenantTx, id: string): Promise<Customer> {
  const [row] = await tx.db
    .select(CUSTOMER_COLUMNS)
    .from(c)
    .where(and(eq(c.id, id), isNull(c.deletedAt)));
  if (!row) throw new AppError('not_found');
  return toCustomer(row);
}

export async function customerAddresses(
  tx: TenantTx,
  customerId: string,
): Promise<CustomerAddress[]> {
  const a = schema.customerAddresses;
  return tx.db
    .select({
      id: a.id,
      name: a.name,
      phone: a.phone,
      divisionId: a.divisionId,
      districtId: a.districtId,
      areaId: a.areaId,
      line: a.line,
      label: a.label,
      isDefault: a.isDefault,
    })
    .from(a)
    .where(eq(a.customerId, customerId))
    .orderBy(sql`${a.isDefault} desc`, a.createdAt);
}

export interface CustomerDetail extends Customer {
  addresses: CustomerAddress[];
  orders: {
    id: string;
    number: number;
    status: string;
    paymentStatus: string;
    deliveryStatus: string;
    total: number;
    placedAt: string;
  }[];
}

export async function getCustomer(tx: TenantTx, actor: Actor, id: string): Promise<CustomerDetail> {
  authorize(actor, 'customers.read');
  const customer = await loadCustomer(tx, id);
  const { rows } = await tx.db.execute<CustomerDetail['orders'][number] & { total: string }>(sql`
    select id, number::int, status, payment_status as "paymentStatus", delivery_status as "deliveryStatus",
           total, placed_at as "placedAt"
      from store.orders where customer_id = ${id} order by placed_at desc limit 50`);
  return {
    ...customer,
    addresses: await customerAddresses(tx, id),
    orders: rows.map((r) => ({
      ...r,
      total: Number(r.total),
      placedAt: iso(r.placedAt) as string,
    })),
  };
}

function phoneTaken(e: unknown): never {
  const { code, constraint } = pgError(e);
  if (code === '23505' && constraint === 'customers_phone_unique') {
    throw new AppError('conflict', {
      detail: 'A customer with this phone already exists',
      fields: [{ path: 'phone', code: 'taken', message: 'already a customer' }],
    });
  }
  throw e;
}

export async function createCustomer(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<Customer> {
  authorize(actor, 'customers.write');
  const v = parseInput(customerInput, input);
  const [row] = await tx.db
    .insert(c)
    .values({
      phone: v.phone,
      name: v.name,
      email: v.email ?? null,
      tags: v.tags ?? [],
      note: v.note ?? null,
    })
    .returning(CUSTOMER_COLUMNS)
    .catch(phoneTaken);
  if (!row) throw new AppError('internal');
  const customer = toCustomer(row);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'customer.created',
    entityType: 'customer',
    entityId: customer.id,
    after: v,
  });
  await emit(tx, 'customer.created', {
    aggregateType: 'customer',
    aggregateId: customer.id,
    payload: {},
  });
  return customer;
}

export async function updateCustomer(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<Customer> {
  authorize(actor, 'customers.write');
  const v = parseInput(customerPatch, input);
  const before = await loadCustomer(tx, id);
  const [row] = await tx.db
    .update(c)
    .set({
      ...(v.phone !== undefined ? { phone: v.phone } : {}),
      ...(v.name !== undefined ? { name: v.name } : {}),
      ...(v.email !== undefined ? { email: v.email } : {}),
      ...(v.tags !== undefined ? { tags: v.tags } : {}),
      ...(v.note !== undefined ? { note: v.note } : {}),
    })
    .where(eq(c.id, id))
    .returning(CUSTOMER_COLUMNS)
    .catch(phoneTaken);
  if (!row) throw new AppError('not_found');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'customer.updated',
    entityType: 'customer',
    entityId: id,
    before,
    after: v,
  });
  await emit(tx, 'customer.updated', { aggregateType: 'customer', aggregateId: id, payload: {} });
  return toCustomer(row);
}

/** Soft delete: the customer leaves lists; past orders keep their snapshot. */
export async function deleteCustomer(tx: TenantTx, actor: Actor, id: string): Promise<void> {
  authorize(actor, 'customers.write');
  const before = await loadCustomer(tx, id);
  await tx.db.update(c).set({ deletedAt: sql`now()` }).where(eq(c.id, id));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'customer.deleted',
    entityType: 'customer',
    entityId: id,
    before,
  });
}

/** Adds an address; the first, or one marked default, becomes the default. */
export async function addAddress(
  tx: TenantTx,
  actor: Actor | null,
  customerId: string,
  input: unknown,
): Promise<CustomerAddress> {
  if (actor) authorize(actor, 'customers.write');
  const v = parseInput(addressInput, input);
  await loadCustomer(tx, customerId);
  const existing = await customerAddresses(tx, customerId);
  if (existing.length >= MAX_ADDRESSES) throw new AppError('limit_exceeded');
  const a = schema.customerAddresses;
  const isDefault = v.isDefault ?? existing.length === 0;
  if (isDefault)
    await tx.db.update(a).set({ isDefault: false }).where(eq(a.customerId, customerId));
  const [row] = await tx.db
    .insert(a)
    .values({
      customerId,
      name: v.name,
      phone: v.phone,
      divisionId: v.divisionId,
      districtId: v.districtId,
      areaId: v.areaId,
      line: v.line,
      label: v.label ?? null,
      isDefault,
    })
    .returning({ id: a.id });
  if (!row) throw new AppError('internal');
  if (actor) {
    await recordAudit(tx, {
      ...auditActor(actor, 'staff'),
      action: 'customer.address_added',
      entityType: 'customer',
      entityId: customerId,
      after: v,
    });
  }
  return (await customerAddresses(tx, customerId)).find((x) => x.id === row.id) as CustomerAddress;
}

export async function updateAddress(
  tx: TenantTx,
  actor: Actor,
  customerId: string,
  addressId: string,
  input: unknown,
): Promise<CustomerAddress> {
  authorize(actor, 'customers.write');
  const current = (await customerAddresses(tx, customerId)).find((x) => x.id === addressId);
  if (!current) throw new AppError('not_found');
  const { id: _id, ...rest } = current;
  const v = parseInput(addressInput, { ...rest, ...(input as object) });
  const a = schema.customerAddresses;
  if (v.isDefault)
    await tx.db.update(a).set({ isDefault: false }).where(eq(a.customerId, customerId));
  await tx.db
    .update(a)
    .set({
      name: v.name,
      phone: v.phone,
      divisionId: v.divisionId,
      districtId: v.districtId,
      areaId: v.areaId,
      line: v.line,
      label: v.label ?? null,
      isDefault: v.isDefault ?? current.isDefault,
    })
    .where(and(eq(a.id, addressId), eq(a.customerId, customerId)));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'customer.address_updated',
    entityType: 'customer',
    entityId: customerId,
    before: current,
    after: v,
  });
  return (await customerAddresses(tx, customerId)).find(
    (x) => x.id === addressId,
  ) as CustomerAddress;
}

export async function deleteAddress(
  tx: TenantTx,
  actor: Actor,
  customerId: string,
  addressId: string,
): Promise<void> {
  authorize(actor, 'customers.write');
  const a = schema.customerAddresses;
  const deleted = await tx.db
    .delete(a)
    .where(and(eq(a.id, addressId), eq(a.customerId, customerId)))
    .returning({ id: a.id });
  if (!deleted.length) throw new AppError('not_found');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'customer.address_deleted',
    entityType: 'customer',
    entityId: customerId,
    before: { addressId },
  });
}

/** An address's names, for the order snapshot (§3.6). */
export function addressSnapshot(place: {
  divisionId: number;
  districtId: number;
  areaId: number;
  line: string;
}) {
  const names = placeNames(place);
  if (!names)
    throw new AppError('validation_failed', {
      fields: [
        { path: 'address.areaId', code: 'unknown', message: 'choose an area from the list' },
      ],
    });
  return { ...place, names };
}
