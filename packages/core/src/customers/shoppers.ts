// Shopper accounts' own data (phase-4-plan §3.11): the profile, the orders
// placed while signed in, and saved addresses. An account never reads a
// customer's data by phone: nobody has verified that the shopper owns that
// phone, so guest orders aren't linked (Phase 5A's phone codes can). Every
// function takes the signed-in shopper's ID from the session, never from
// the request body.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { cleanString } from '@managemind/shared/catalog';
import { addressInput } from '@managemind/shared/orders';
import { phoneNumber } from '@managemind/shared/settings';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { parseInput } from '../catalog/common';
import { orderSettings } from '../pricing/quote';
import type { TenantTx } from '../tenant';
import { type CustomerAddress, MAX_ADDRESSES } from './service';

export interface ShopperProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

const u = schema.shopperUsers;
const a = schema.shopperAddresses;

export async function shopperProfile(tx: TenantTx, userId: string): Promise<ShopperProfile> {
  const [row] = await tx.db
    .select({ id: u.id, name: u.name, email: u.email, phone: u.phone })
    .from(u)
    .where(eq(u.id, userId));
  if (!row) throw new AppError('not_found');
  return row;
}

export const shopperProfileInput = z
  .object({
    name: cleanString(100).optional(),
    phone: phoneNumber().nullable().optional(),
  })
  .strict();

export async function updateShopperProfile(
  tx: TenantTx,
  userId: string,
  input: unknown,
): Promise<ShopperProfile> {
  const v = parseInput(shopperProfileInput, input);
  if (v.name !== undefined || v.phone !== undefined) {
    await tx.db
      .update(u)
      .set({
        ...(v.name !== undefined ? { name: v.name } : {}),
        ...(v.phone !== undefined ? { phone: v.phone } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(u.id, userId));
  }
  return shopperProfile(tx, userId);
}

export interface ShopperOrder {
  id: string;
  number: number;
  displayNumber: string;
  status: string;
  paymentStatus: string;
  deliveryStatus: string;
  total: number;
  itemCount: number;
  placedAt: string;
}

/** Orders placed while signed in, newest first (at most 50). */
export async function shopperOrders(tx: TenantTx, userId: string): Promise<ShopperOrder[]> {
  const { checkout } = await orderSettings(tx);
  const { rows } = await tx.db.execute<{
    id: string;
    number: string | number;
    status: string;
    paymentStatus: string;
    deliveryStatus: string;
    total: string | number;
    itemCount: number;
    placedAt: Date | string;
  }>(sql`
    select o.id, o.number, o.status, o.payment_status as "paymentStatus",
           o.delivery_status as "deliveryStatus", o.total,
           (select coalesce(sum(l.quantity), 0)::int from store.order_lines l where l.order_id = o.id) as "itemCount",
           o.placed_at as "placedAt"
      from store.orders o where o.shopper_user_id = ${userId}
     order by o.placed_at desc limit 50`);
  return rows.map((r) => ({
    id: r.id,
    number: Number(r.number),
    displayNumber: `${checkout.orderNumberPrefix}${r.number}`,
    status: r.status,
    paymentStatus: r.paymentStatus,
    deliveryStatus: r.deliveryStatus,
    total: Number(r.total),
    itemCount: r.itemCount,
    placedAt: new Date(r.placedAt).toISOString(),
  }));
}

export async function shopperAddresses(tx: TenantTx, userId: string): Promise<CustomerAddress[]> {
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
    .where(eq(a.userId, userId))
    .orderBy(desc(a.isDefault), asc(a.createdAt));
}

export async function addShopperAddress(
  tx: TenantTx,
  userId: string,
  input: unknown,
): Promise<CustomerAddress> {
  const v = parseInput(addressInput, input);
  const existing = await shopperAddresses(tx, userId);
  if (existing.length >= MAX_ADDRESSES) throw new AppError('limit_exceeded');
  const isDefault = v.isDefault ?? existing.length === 0;
  if (isDefault) await tx.db.update(a).set({ isDefault: false }).where(eq(a.userId, userId));
  const [row] = await tx.db
    .insert(a)
    .values({
      userId,
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
  return (await shopperAddresses(tx, userId)).find((x) => x.id === row.id) as CustomerAddress;
}

export async function updateShopperAddress(
  tx: TenantTx,
  userId: string,
  addressId: string,
  input: unknown,
): Promise<CustomerAddress> {
  const current = (await shopperAddresses(tx, userId)).find((x) => x.id === addressId);
  if (!current) throw new AppError('not_found');
  const { id: _id, ...rest } = current;
  const v = parseInput(addressInput, { ...rest, ...(input as object) });
  if (v.isDefault) await tx.db.update(a).set({ isDefault: false }).where(eq(a.userId, userId));
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
    .where(and(eq(a.id, addressId), eq(a.userId, userId)));
  return (await shopperAddresses(tx, userId)).find((x) => x.id === addressId) as CustomerAddress;
}

export async function deleteShopperAddress(
  tx: TenantTx,
  userId: string,
  addressId: string,
): Promise<void> {
  const deleted = await tx.db
    .delete(a)
    .where(and(eq(a.id, addressId), eq(a.userId, userId)))
    .returning({ id: a.id });
  if (!deleted.length) throw new AppError('not_found');
}

/**
 * "Save my details" at checkout while signed in: the name and phone on the
 * account when it has none, and the address unless the same one is saved.
 */
export async function saveCheckoutDetails(
  tx: TenantTx,
  userId: string,
  details: {
    name: string;
    phone: string;
    address: { divisionId: number; districtId: number; areaId: number; line: string };
  },
): Promise<void> {
  const profile = await shopperProfile(tx, userId);
  if (!profile.name || !profile.phone) {
    await tx.db
      .update(u)
      .set({
        ...(profile.name ? {} : { name: details.name }),
        ...(profile.phone ? {} : { phone: details.phone }),
        updatedAt: sql`now()`,
      })
      .where(eq(u.id, userId));
  }
  const saved = await shopperAddresses(tx, userId);
  const same = saved.some(
    (s) => s.areaId === details.address.areaId && s.line.trim() === details.address.line.trim(),
  );
  if (same || saved.length >= MAX_ADDRESSES) return;
  await addShopperAddress(tx, userId, {
    name: details.name,
    phone: details.phone,
    ...details.address,
  });
}
