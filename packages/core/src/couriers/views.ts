// What the admin reads about couriers (phase-7-plan §3.9): the checks before
// a bulk booking, each order's booking as it lands, parcels the courier
// returned, and the test courier's parcels for the dev route.
import type { FakeParcelState } from '@managemind/providers/couriers';
import { AppError } from '@managemind/shared';
import {
  bulkBookInput,
  COURIER_LIMITS,
  type CourierUpdateKind,
  formatOrderNumber,
} from '@managemind/shared/orders';
import { sql } from 'drizzle-orm';
import { type Actor, authorize } from '../access';
import { parseInput } from '../catalog/common';
import { orderSettings } from '../pricing/quote';
import type { TenantTx } from '../tenant';
import { bookingPreview } from './booking';

export interface BulkCheck {
  orderId: string;
  displayNumber: string | null;
  /** Empty when the order can be booked as it is. */
  problems: string[];
  codAmount: number;
}

/** Each order's checks before a bulk booking (§3.4): nothing is booked yet. */
export async function checkBulkBooking(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<BulkCheck[]> {
  authorize(actor, 'orders.write');
  const v = parseInput(bulkBookInput, input);
  const { checkout } = await orderSettings(tx);
  const { rows } = await tx.db.execute<{ id: string; number: number }>(sql`
    select id, number from store.orders where id = any(${sql.param(v.orderIds)}::uuid[])`);
  const numbers = new Map(rows.map((r) => [r.id, r.number]));
  const out: BulkCheck[] = [];
  for (const orderId of v.orderIds) {
    const number = numbers.get(orderId);
    if (number === undefined) {
      out.push({ orderId, displayNumber: null, problems: ['not_found'], codAmount: 0 });
      continue;
    }
    const preview = await bookingPreview(tx, actor, orderId, { courier: v.courier });
    out.push({
      orderId,
      displayNumber: formatOrderNumber(checkout.orderNumberPrefix, number),
      problems: preview.problems,
      codAmount: preview.codAmount,
    });
  }
  return out;
}

export interface BookingState {
  orderId: string;
  shipmentId: string | null;
  status: string | null;
  courier: string | null;
  bookingState: string | null;
  bookingError: string | null;
  consignmentId: string | null;
}

/** Each order's latest shipment, for a bulk booking's results as they land. */
export async function bookingStates(
  tx: TenantTx,
  actor: Actor,
  orderIds: readonly string[],
): Promise<BookingState[]> {
  authorize(actor, 'orders.read');
  const ids = orderIds.slice(0, COURIER_LIMITS.bulkMax);
  const { rows } = await tx.db.execute<{
    order_id: string;
    id: string | null;
    status: string | null;
    courier: string | null;
    booking_state: string | null;
    booking_error: string | null;
    consignment_id: string | null;
  }>(sql`
    select o.id as order_id, s.id, s.status, s.courier, s.booking_state, s.booking_error, s.consignment_id
      from store.orders o
      left join lateral (select * from store.shipments s where s.order_id = o.id
                          order by s.created_at desc, s.id desc limit 1) s on true
     where o.id = any(${sql.param([...ids])}::uuid[])`);
  return rows.map((r) => ({
    orderId: r.order_id,
    shipmentId: r.id,
    status: r.status,
    courier: r.courier,
    bookingState: r.booking_state,
    bookingError: r.booking_error,
    consignmentId: r.consignment_id,
  }));
}

export interface CourierReturn {
  shipmentId: string;
  orderId: string;
  displayNumber: string;
  courier: string;
  consignmentId: string | null;
  name: string;
  failedReason: string | null;
  returnedByCourierAt: string;
  items: number;
}

/** Parcels the courier says it brought back, not yet received in the store (§3.5, Q9). */
export async function listCourierReturns(tx: TenantTx, actor: Actor): Promise<CourierReturn[]> {
  authorize(actor, 'orders.read');
  const { checkout } = await orderSettings(tx);
  const { rows } = await tx.db.execute<{
    id: string;
    order_id: string;
    number: number;
    courier: string;
    consignment_id: string | null;
    name: string;
    failed_reason: string | null;
    courier_returned_at: Date;
    items: number;
  }>(sql`
    select s.id, s.order_id, o.number, s.courier, s.consignment_id, o.contact ->> 'name' as name,
           s.failed_reason, s.courier_returned_at,
           (select coalesce(sum(sl.quantity), 0)::int from store.shipment_lines sl where sl.shipment_id = s.id) as items
      from store.shipments s join store.orders o on o.id = s.order_id
     where s.status = 'failed' and s.courier_returned_at is not null
     order by s.courier_returned_at
     limit 200`);
  return rows.map((r) => ({
    shipmentId: r.id,
    orderId: r.order_id,
    displayNumber: formatOrderNumber(checkout.orderNumberPrefix, r.number),
    courier: r.courier,
    consignmentId: r.consignment_id,
    name: r.name,
    failedReason: r.failed_reason,
    returnedByCourierAt: new Date(r.courier_returned_at).toISOString(),
    items: r.items,
  }));
}

/**
 * The test courier's side of a parcel (§6.3): what it will answer when
 * asked. Outside production only; the API checks that.
 */
export async function setFakeParcel(
  tx: TenantTx,
  actor: Actor,
  consignmentId: string,
  state: { status: CourierUpdateKind; codCollected?: number | null },
): Promise<string> {
  authorize(actor, 'orders.write');
  const value: FakeParcelState = {
    status: state.status,
    codCollected: state.codCollected ?? null,
    at: new Date().toISOString(),
  };
  const { rows } = await tx.db.execute<{ id: string }>(sql`
    update store.shipments set metadata = jsonb_set(metadata, '{fakeCourier}', ${JSON.stringify(value)}::jsonb)
     where courier = 'fake' and consignment_id = ${consignmentId} returning id`);
  const id = rows[0]?.id;
  if (!id) throw new AppError('not_found');
  return id;
}
