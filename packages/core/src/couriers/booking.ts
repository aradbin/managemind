// Booking a parcel (phase-7-plan §3.4). A booking spans two transactions with
// the courier's call between them, so no transaction waits on a courier:
// 1. `claimBooking` creates the shipment (or takes an earlier one) and claims
//    it with a conditional update, so a second tap finds it taken;
// 2. the API calls the courier;
// 3. `recordBooked` or `recordBookingFailed` writes the answer. A refusal
//    frees the shipment to fix and try again; no answer leaves it "unsure",
//    and the next try asks the courier for our invoice before booking again.
import { schema } from '@managemind/db';
import type { Booked, CourierPlace, Parcel } from '@managemind/providers/couriers';
import { AppError } from '@managemind/shared';
import {
  type BookInput,
  bookInput,
  COURIER_LIMITS,
  COURIER_NAMES,
  type Courier,
  type CourierPlaceInput,
  cancelBookingInput,
  codTaka,
  courierText,
  localPhone,
  needsAreas,
  parcelInvoice,
  parcelWeightGrams,
} from '@managemind/shared/orders';
import { eq, sql } from 'drizzle-orm';
import { type Actor, authorize } from '../access';
import { parseInput } from '../catalog/common';
import { recordHistory } from '../orders/history';
import { createShipment, lockOrder, lockShipment, moveShipment } from '../orders/lifecycle';
import { loadOrderDetail } from '../orders/views';
import { orderSettings } from '../pricing/quote';
import type { TenantTx } from '../tenant';
import { resolvePlace } from './areas';
import { recordCourierEvent } from './events';

const s = schema.shipments;

/** What the API needs to call the courier, and to write its answer back. */
export interface BookingClaim {
  shipmentId: string;
  orderId: string;
  courier: Courier;
  invoice: string;
  parcel: Parcel;
  /** Poisha the courier is asked to collect. */
  codAmount: number;
  /** An earlier booking got no answer: ask the courier for the invoice first. */
  unsure: boolean;
}

export interface BookingPreview {
  parcel: Parcel | null;
  codAmount: number;
  place: CourierPlace | null;
  /** What stops a booking now: `not_confirmed`, `nothing_to_ship`, `no_address`, `area_unmatched`. */
  problems: string[];
}

const pick = (text: { en?: string; bn?: string } | null | undefined) => text?.en ?? text?.bn ?? '';

interface Draft {
  orderId: string;
  /** Lines and quantities not yet in a shipment, or those chosen. */
  lines: { orderLineId: string; quantity: number }[];
}

/** The parcel for chosen lines of an order: what the booking sheet shows and the courier gets. */
async function buildParcel(
  tx: TenantTx,
  draft: Draft,
  v: Pick<BookInput, 'courier' | 'weightGrams' | 'note' | 'place'>,
  invoice: string,
  excludeShipment: string | null,
): Promise<BookingPreview> {
  const order = await loadOrderDetail(tx, draft.orderId);
  if (!order) throw new AppError('not_found');
  const { settings } = await orderSettings(tx);
  const problems: string[] = [];
  if (order.status !== 'confirmed' && order.status !== 'processing') problems.push('not_confirmed');
  if (!draft.lines.length) problems.push('nothing_to_ship');
  if (!order.address) problems.push('no_address');
  const byId = new Map(order.lines.map((l) => [l.id, l]));
  const chosen = draft.lines
    .map((d) => ({ line: byId.get(d.orderLineId), quantity: d.quantity }))
    .filter((d): d is { line: NonNullable<typeof d.line>; quantity: number } => !!d.line);

  // COD rides on the order's first parcel: what's due less what other open parcels carry.
  const { rows } = await tx.db.execute<{ n: string }>(sql`
    select coalesce(sum(cod_amount), 0) as n from store.shipments
     where order_id = ${draft.orderId} and courier is not null
       and id is distinct from ${excludeShipment}::uuid
       and (status in ('booked', 'shipped', 'in_transit') or booking_state is not null)`);
  const codAmount = Math.max(0, order.totals.codDue - Number(rows[0]?.n ?? 0));

  let place: CourierPlace | null = null;
  if (needsAreas(v.courier) && order.address) {
    place = await resolvePlace(tx, v.courier, order.address.areaId, v.place ?? null);
    if (!place) problems.push('area_unmatched');
  }
  if (!order.address) return { parcel: null, codAmount, place, problems };

  const items = chosen.map((c) => `${pick(c.line.title)} x${c.quantity}`).join(', ');
  const note = [order.customerNote ?? '', settings.couriers.note, v.note ?? '']
    .map((n) => n.trim())
    .filter(Boolean)
    .join(' · ');
  const value = chosen.reduce(
    (a, c) => a + Math.round((c.line.total * c.quantity) / Math.max(1, c.line.quantity)),
    0,
  );
  const a = order.address;
  const parcel: Parcel = {
    invoice,
    name: courierText(order.contact.name, 100),
    phone: localPhone(order.contact.phone),
    address: courierText(
      [a.line, pick(a.names.area), pick(a.names.district)].filter(Boolean).join(', '),
      250,
    ),
    areaName: pick(a.names.area),
    districtName: pick(a.names.district),
    codTaka: codTaka(codAmount),
    valueTaka: codTaka(value),
    weightGrams:
      v.weightGrams ??
      parcelWeightGrams(
        chosen.map((c) => ({ weightGrams: c.line.weightGrams, quantity: c.quantity })),
        settings.couriers.defaultWeightGrams,
      ),
    items: courierText(items, COURIER_LIMITS.itemsMax),
    itemCount: chosen.reduce((n, c) => n + c.quantity, 0),
    note: courierText(note, COURIER_LIMITS.noteMax),
    ...(place ? { place } : {}),
  };
  return { parcel, codAmount, place, problems };
}

/** Units of each line not yet in a shipment that is still going or went. */
async function freeLines(tx: TenantTx, orderId: string) {
  const { rows } = await tx.db.execute<{ id: string; free: number }>(sql`
    select l.id, (l.quantity - coalesce((select sum(sl.quantity) from store.shipment_lines sl
       join store.shipments s on s.id = sl.shipment_id
      where sl.order_line_id = l.id and s.status <> 'returned'), 0))::int as free
      from store.order_lines l where l.order_id = ${orderId} order by l.position`);
  return rows.filter((r) => r.free > 0).map((r) => ({ orderLineId: r.id, quantity: r.free }));
}

/** Our invoice for a shipment: the order number and its place among the order's bookings. */
async function invoiceFor(tx: TenantTx, shipmentId: string, displayNumber: string) {
  const { rows } = await tx.db.execute<{ n: number }>(sql`
    select ((select count(*) from store.shipments s2
              where s2.order_id = s.order_id and (s2.created_at, s2.id) <= (s.created_at, s.id))
          + (select count(*) from store.order_history h
              where h.order_id = s.order_id and h.machine = 'shipment' and h.event = 'unbook'))::int as n
      from store.shipments s where s.id = ${shipmentId}`);
  return parcelInvoice(displayNumber, rows[0]?.n ?? 1);
}

/** What a booking would send, and what stops it: the booking sheet (§3.4). Reads only. */
export async function bookingPreview(
  tx: TenantTx,
  actor: Actor,
  orderId: string,
  input: unknown,
): Promise<BookingPreview> {
  authorize(actor, 'orders.read');
  const v = parseInput(bookInput, input);
  const lines = v.shipmentId
    ? await shipmentLinesOf(tx, v.shipmentId)
    : (v.lines ?? (await freeLines(tx, orderId)));
  return buildParcel(tx, { orderId, lines }, v, 'preview', v.shipmentId ?? null);
}

async function shipmentLinesOf(tx: TenantTx, shipmentId: string) {
  const { rows } = await tx.db.execute<{ order_line_id: string; quantity: number }>(sql`
    select order_line_id, quantity from store.shipment_lines where shipment_id = ${shipmentId}`);
  return rows.map((r) => ({ orderLineId: r.order_line_id, quantity: r.quantity }));
}

/**
 * Step 1: the shipment, claimed for booking. A new shipment takes the lines
 * chosen, or everything not yet shipped; an earlier one (`shipmentId`) must
 * be pending and not being booked. Refuses what the courier would refuse
 * anyway: an order not confirmed, no address, or an area with no match.
 */
export async function claimBooking(
  tx: TenantTx,
  actor: Actor,
  orderId: string,
  input: unknown,
): Promise<BookingClaim> {
  authorize(actor, 'orders.write');
  const v = parseInput(bookInput, input);
  const order = await lockOrder(tx, orderId);
  if (order.status !== 'confirmed' && order.status !== 'processing') {
    throw new AppError('illegal_transition', { detail: 'Confirm the order before booking it' });
  }
  let shipmentId = v.shipmentId;
  let unsure = false;
  let invoice: string | null = null;
  if (shipmentId) {
    const [row] = await tx.db
      .select({
        orderId: s.orderId,
        status: s.status,
        bookingState: s.bookingState,
        courier: s.courier,
        courierRef: s.courierRef,
      })
      .from(s)
      .where(eq(s.id, shipmentId))
      .for('update');
    if (!row || row.orderId !== orderId) throw new AppError('not_found');
    if (row.status !== 'pending' || row.bookingState === 'booking') {
      throw new AppError('conflict', { detail: 'This shipment is booked or being booked' });
    }
    if (row.bookingState === 'unsure') {
      // The same courier and invoice, so the courier can find the first try.
      if (row.courier !== v.courier) {
        throw new AppError('conflict', {
          detail: `Check ${COURIER_NAMES[row.courier as Courier]}'s panel for this parcel first`,
        });
      }
      unsure = true;
      invoice = row.courierRef;
    }
  } else {
    const lines = v.lines ?? (await freeLines(tx, orderId));
    if (!lines.length) {
      throw new AppError('conflict', { detail: 'Everything in this order is already shipped' });
    }
    shipmentId = (await createShipment(tx, actor, orderId, { lines })).id;
  }
  const detail = await loadOrderDetail(tx, orderId);
  if (!detail) throw new AppError('not_found');
  invoice ??= await invoiceFor(tx, shipmentId, detail.displayNumber);
  const preview = await buildParcel(
    tx,
    { orderId, lines: await shipmentLinesOf(tx, shipmentId) },
    v,
    invoice,
    shipmentId,
  );
  const blocking = preview.problems.filter((p) => p !== 'not_confirmed');
  if (blocking.length || !preview.parcel) {
    throw new AppError('validation_failed', {
      detail: blocking.includes('area_unmatched')
        ? `Pick ${COURIER_NAMES[v.courier]}'s area for this address`
        : 'This order can’t be booked yet',
      fields: blocking.map((p) => ({
        path: p === 'area_unmatched' ? 'place' : 'orderId',
        code: p,
        message: p.replace(/_/g, ' '),
      })),
    });
  }
  const claimed = await tx.db
    .update(s)
    .set({
      courier: v.courier,
      courierRef: invoice,
      bookingState: 'booking',
      bookingError: null,
      codAmount: preview.codAmount,
      courierArea: preview.place ?? null,
    })
    .where(
      sql`${s.id} = ${shipmentId} and ${s.status} = 'pending'
          and (${s.bookingState} is null or ${s.bookingState} = 'unsure')`,
    )
    .returning({ id: s.id });
  if (!claimed.length) {
    throw new AppError('conflict', { detail: 'This shipment is booked or being booked' });
  }
  return {
    shipmentId,
    orderId,
    courier: v.courier,
    invoice,
    parcel: preview.parcel,
    codAmount: preview.codAmount,
    unsure,
  };
}

/**
 * Step 3, booked: the consignment, the tracking link and the first event.
 * Only a shipment still being booked takes it, so a late answer to a
 * booking staff gave up on changes nothing.
 */
export async function recordBooked(
  tx: TenantTx,
  actor: Actor,
  shipmentId: string,
  booked: Booked,
  trackingUrl: string | null,
): Promise<void> {
  const shipment = await lockShipment(tx, shipmentId);
  await lockOrder(tx, shipment.orderId);
  const [row] = await tx.db
    .select({ courier: s.courier, bookingState: s.bookingState })
    .from(s)
    .where(eq(s.id, shipmentId));
  if (!row?.courier || row.bookingState !== 'booking' || shipment.status !== 'pending') return;
  const courier = row.courier as Courier;
  await tx.db
    .update(s)
    .set({
      consignmentId: booked.consignmentId,
      trackingCode: booked.trackingCode,
      trackingNumber: booked.trackingCode ?? booked.consignmentId,
      trackingUrl: booked.trackingCode && trackingUrl ? trackingUrl : null,
      carrier: COURIER_NAMES[courier],
      bookingState: null,
      bookingError: null,
      courierFee: booked.fee ?? null,
      lastSyncedAt: sql`now()`,
    })
    .where(eq(s.id, shipmentId));
  await moveShipment(tx, actor, shipment, 'book', {
    courier,
    data: { courier, consignmentId: booked.consignmentId },
  });
  await recordCourierEvent(tx, shipmentId, booked, 'booking');
}

/** Step 3, failed: refused frees the shipment; no answer leaves it unsure (§3.4). */
export async function recordBookingFailed(
  tx: TenantTx,
  shipmentId: string,
  failure: { refused: boolean; message: string },
): Promise<void> {
  const message = failure.message.slice(0, 300);
  if (failure.refused) {
    await tx.db
      .update(s)
      .set({
        courier: null,
        courierRef: null,
        bookingState: null,
        bookingError: message,
        codAmount: null,
        courierArea: null,
      })
      .where(sql`${s.id} = ${shipmentId} and ${s.bookingState} = 'booking'`);
  } else {
    await tx.db
      .update(s)
      .set({ bookingState: 'unsure', bookingError: message })
      .where(sql`${s.id} = ${shipmentId} and ${s.bookingState} = 'booking'`);
  }
}

/**
 * A booking cancelled: at the courier through its API, or by staff in its
 * panel (`cancelledAtCourier`). The shipment is pending again, to book anew
 * or delete. An unsure booking can be let go the same way, once staff
 * checked the panel.
 */
export async function cancelBooking(
  tx: TenantTx,
  actor: Actor,
  shipmentId: string,
  input: unknown,
  cancelledByApi: boolean,
): Promise<void> {
  authorize(actor, 'orders.write');
  const { cancelledAtCourier } = parseInput(cancelBookingInput, input);
  if (!cancelledByApi && !cancelledAtCourier) {
    throw new AppError('validation_failed', {
      detail: 'Cancel the parcel in the courier’s panel first',
      fields: [{ path: 'cancelledAtCourier', code: 'required', message: 'confirm it' }],
    });
  }
  const shipment = await lockShipment(tx, shipmentId);
  await lockOrder(tx, shipment.orderId);
  const [row] = await tx.db
    .select({ courier: s.courier, consignmentId: s.consignmentId, bookingState: s.bookingState })
    .from(s)
    .where(eq(s.id, shipmentId));
  if (!row?.courier) throw new AppError('not_found');
  const courier = row.courier as Courier;
  if (shipment.status === 'booked') {
    await moveShipment(tx, actor, shipment, 'unbook', {
      courier,
      data: { courier, consignmentId: row.consignmentId, byApi: cancelledByApi },
    });
  } else if (shipment.status === 'pending' && row.bookingState === 'unsure') {
    // Counted like a cancelled booking, so the next one gets a new invoice.
    await recordHistory(tx, actor, {
      orderId: shipment.orderId,
      machine: 'shipment',
      from: 'pending',
      to: 'pending',
      event: 'unbook',
      data: { shipmentId, courier, unsure: true },
    });
  } else {
    throw new AppError('illegal_transition', {
      detail: 'Only a booked parcel not yet picked up can be cancelled',
    });
  }
  await tx.db
    .update(s)
    .set({
      courier: null,
      courierRef: null,
      consignmentId: null,
      trackingCode: null,
      trackingNumber: null,
      trackingUrl: null,
      carrier: null,
      bookingState: null,
      bookingError: null,
      codAmount: null,
      courierArea: null,
      courierStatus: null,
      courierStatusAt: null,
      courierMessage: null,
    })
    .where(eq(s.id, shipmentId));
}

/** The courier and consignment of a shipment, for the API's courier calls. */
export async function shipmentCourier(tx: TenantTx, shipmentId: string) {
  const [row] = await tx.db
    .select({
      orderId: s.orderId,
      status: s.status,
      courier: s.courier,
      consignmentId: s.consignmentId,
      courierRef: s.courierRef,
      trackingCode: s.trackingCode,
      bookingState: s.bookingState,
    })
    .from(s)
    .where(eq(s.id, shipmentId));
  if (!row) throw new AppError('not_found');
  return { ...row, courier: row.courier as Courier | null };
}

export type { CourierPlaceInput };
