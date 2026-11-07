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
  /** On its way back, handed back to the store by the courier, or received. */
  state: 'on_its_way' | 'handed_back' | 'received';
  /** When it reached that state. */
  since: string;
  /** Kept for older callers: when the courier handed it back, else since. */
  returnedByCourierAt: string;
  items: number;
  /** The parcel's first item and its quantity, and the parcel's value. */
  firstItem: { title: string; quantity: number } | null;
  value: number;
}

/**
 * Parcels a courier couldn't deliver (§3.5, Q9): coming back (failed, on the
 * way or handed back) or received in the store. Received puts them back in
 * stock; nothing is restocked before staff see it.
 */
export async function listCourierReturns(
  tx: TenantTx,
  actor: Actor,
  query: { tab?: 'coming' | 'received' | undefined; q?: string | undefined } = {},
): Promise<{
  items: CourierReturn[];
  counts: { coming: number; received: number; comingValue: number };
}> {
  authorize(actor, 'orders.read');
  const { checkout } = await orderSettings(tx);
  const tab = query.tab ?? 'coming';
  const text = query.q?.trim();
  const search = text
    ? sql`and (o.contact ->> 'name' ilike ${`%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}
           or s.consignment_id ilike ${`%${text}%`}
           or o.number::text = ${text.replace(/\D/g, '') || '-'})`
    : sql``;
  const coming = sql`s.status = 'failed'`;
  const received = sql`s.status = 'returned'`;
  const value = sql`(select coalesce(sum(sl.quantity * l.unit_price), 0) from store.shipment_lines sl
      join store.order_lines l on l.id = sl.order_line_id where sl.shipment_id = s.id)`;
  const { rows: c } = await tx.db.execute<{
    coming: number;
    received: number;
    value: string | null;
  }>(sql`
    select count(*) filter (where ${coming})::int as coming,
           count(*) filter (where ${received})::int as received,
           sum(${value}) filter (where ${coming}) as value
      from store.shipments s join store.orders o on o.id = s.order_id
     where s.courier is not null ${search}`);
  const { rows } = await tx.db.execute<{
    id: string;
    order_id: string;
    number: number;
    courier: string;
    consignment_id: string | null;
    name: string;
    failed_reason: string | null;
    status: string;
    courier_returned_at: Date | null;
    failed_at: Date | null;
    returned_at: Date | null;
    updated_at: Date;
    items: number;
    first_title: string | null;
    first_quantity: number | null;
    value: string;
  }>(sql`
    select s.id, s.order_id, o.number, s.courier, s.consignment_id, o.contact ->> 'name' as name,
           s.failed_reason, s.status, s.courier_returned_at, s.failed_at, s.returned_at, s.updated_at,
           (select coalesce(sum(sl.quantity), 0)::int from store.shipment_lines sl where sl.shipment_id = s.id) as items,
           f.title as first_title, f.quantity as first_quantity, ${value} as value
      from store.shipments s join store.orders o on o.id = s.order_id
      left join lateral (select l.title, sl.quantity from store.shipment_lines sl
             join store.order_lines l on l.id = sl.order_line_id
            where sl.shipment_id = s.id order by l.position limit 1) f on true
     where s.courier is not null and ${tab === 'coming' ? coming : received} ${search}
     order by ${tab === 'coming' ? sql`coalesce(s.courier_returned_at, s.failed_at, s.updated_at)` : sql`s.returned_at desc nulls last`}
     limit 200`);
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return {
    items: rows.map((r) => {
      const state =
        r.status === 'returned' ? 'received' : r.courier_returned_at ? 'handed_back' : 'on_its_way';
      const since =
        (state === 'received'
          ? iso(r.returned_at)
          : state === 'handed_back'
            ? iso(r.courier_returned_at)
            : iso(r.failed_at)) ?? (iso(r.updated_at) as string);
      return {
        shipmentId: r.id,
        orderId: r.order_id,
        displayNumber: formatOrderNumber(checkout.orderNumberPrefix, r.number),
        courier: r.courier,
        consignmentId: r.consignment_id,
        name: r.name,
        failedReason: r.failed_reason,
        state,
        since,
        returnedByCourierAt: iso(r.courier_returned_at) ?? since,
        items: r.items,
        firstItem: r.first_title
          ? { title: r.first_title, quantity: Number(r.first_quantity ?? 1) }
          : null,
        value: Number(r.value ?? 0),
      };
    }),
    counts: {
      coming: Number(c[0]?.coming ?? 0),
      received: Number(c[0]?.received ?? 0),
      comingValue: Number(c[0]?.value ?? 0),
    },
  };
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
