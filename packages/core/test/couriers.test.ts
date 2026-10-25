// Couriers (phase-7-plan §3.1, §3.4–§3.6, §10): booking in two steps with
// its claim, refusals and unsure bookings; a courier's updates walking the
// shipment with stock and COD right; returns, partial deliveries, cancels
// and stale updates; the poll's list; and area matches.
import type { Booked, CourierStatus } from '@managemind/providers/couriers';
import { permissionsOf, type StoreRole } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  addToCart,
  applyCourierUpdate,
  bookingPreview,
  cancelBooking,
  cancelOrder,
  claimBooking,
  confirmOrder,
  courierAreaReview,
  createProduct,
  createTenant,
  deleteShipment,
  findCourierShipment,
  getOrder,
  inventoryDrift,
  placeOrder,
  receive,
  receiveCourierReturn,
  recordBooked,
  recordBookingFailed,
  resolvePlace,
  setCartArea,
  setCourierAreaMatch,
  shopperActor,
  shopperOrderView,
  systemActor,
  type TenantTx,
  withPlatform,
  withTenant,
} from '../src';
import { connectApp, connectOwner } from './setup';

let app: pg.Client;
let owner: pg.Client;
let store: string;
let staff: Actor;
const address = { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1, Road 2' };

beforeAll(async () => {
  app = await connectApp();
  owner = await connectOwner();
  const slug = `cour${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Courier test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  const role: StoreRole = 'staff';
  staff = {
    kind: 'user',
    userId: '0199d000-0000-7000-8000-0000000000ee',
    platformRole: null,
    permissions: permissionsOf(role),
    tenantId: store,
    storeRole: role,
  };
  // A Pathao city and zone, and RedX's area, matched to Dhanmondi (513).
  await owner.query(`
    insert into ref.courier_areas (courier, kind, external_id, parent_id, name) values
      ('pathao', 'city', 1, null, 'Dhaka'), ('pathao', 'zone', 52, 1, 'Dhanmondi'),
      ('pathao', 'area', 900, 52, 'Dhanmondi 27'), ('redx', 'area', 7, null, 'Dhanmondi')
    on conflict do nothing`);
  await owner.query(`
    insert into ref.courier_area_map (area_id, courier, kind, external_id, match)
    values (513, 'pathao', 'zone', 52, 'name') on conflict do nothing`);
});
afterAll(async () => {
  await app.end();
  await owner.end();
});

const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);
let seq = 0;

async function product(price: number, stockUnits: number, weightGrams?: number) {
  const p = await run((tx) =>
    createProduct(tx, staff, {
      status: 'active',
      translations: { en: { title: `Parcel thing ${++seq}` } },
      variant: { price, ...(weightGrams ? { weightGrams } : {}) },
    }),
  );
  const id = p.variants[0]?.id as string;
  await run((tx) =>
    receive(tx, staff, { variantId: id, quantity: stockUnits, reason: 'received' }),
  );
  return id;
}

async function confirmedOrder(items: [string, number][]) {
  let token: string | null = null;
  for (const [variantId, quantity] of items) {
    const r = await run((tx) => addToCart(tx, token, { variantId, quantity }, 'en'));
    token = r.token ?? token;
  }
  const cart = await run((tx) => setCartArea(tx, token, { areaId: 513 }));
  const placed = await run((tx) =>
    placeOrder(tx, shopperActor(), {
      channel: 'storefront',
      source: 'website',
      cartToken: token,
      contact: { name: 'Rahim', phone: `+88017${String(Date.now()).slice(-8)}` },
      address,
      payment: { kind: 'cod' },
      expectedTotal: cart.quote.totals.total,
      locale: 'en',
    }),
  );
  await run((tx) => confirmOrder(tx, staff, placed.id));
  return placed.id;
}

let consignment = 0;
const booked = (overrides: Partial<Booked> = {}): Booked => ({
  consignmentId: `FK${++consignment}`,
  trackingCode: `FK${consignment}`,
  status: 'booked',
  update: 'booked',
  at: new Date(),
  ...overrides,
});
const update = (u: CourierStatus['update'], extra: Partial<CourierStatus> = {}): CourierStatus => ({
  status: u,
  update: u,
  at: new Date(Date.now() + ++consignment * 1000),
  ...extra,
});

async function bookFake(orderId: string) {
  const claim = await run((tx) => claimBooking(tx, staff, orderId, { courier: 'fake' }));
  const b = booked();
  await run((tx) =>
    recordBooked(tx, staff, claim.shipmentId, b, 'https://courier.invalid/track/x'),
  );
  return { claim, consignmentId: b.consignmentId as string };
}

const shipmentRow = (id: string) =>
  run(async (tx) => {
    const { rows } = await tx.db.execute<Record<string, unknown>>(
      sql`select * from store.shipments where id = ${id}`,
    );
    return rows[0] as Record<string, unknown>;
  });
const stock = (variantId: string) =>
  run(async (tx) => {
    const { rows } = await tx.db.execute<{ on_hand: number; reserved: number }>(
      sql`select sum(on_hand)::int as on_hand, sum(reserved)::int as reserved from store.inventory_levels where variant_id = ${variantId}`,
    );
    return rows[0];
  });

describe('booking (§3.4)', () => {
  it('claims, books once, and keeps the order from changing under the parcel', async () => {
    const v = await product(50_000, 5, 300);
    const orderId = await confirmedOrder([[v, 2]]);
    const preview = await run((tx) => bookingPreview(tx, staff, orderId, { courier: 'fake' }));
    expect(preview.problems).toEqual([]);
    expect(preview.parcel).toMatchObject({
      phone: expect.stringMatching(/^017\d{8}$/),
      address: 'House 1, Road 2, Dhanmondi, Dhaka',
      weightGrams: 600,
      itemCount: 2,
    });

    const claim = await run((tx) => claimBooking(tx, staff, orderId, { courier: 'fake' }));
    expect(claim.invoice).toMatch(/^\d+-1$/);
    expect(claim.codAmount).toBe(preview.codAmount);
    expect(claim.parcel.codTaka).toBe(Math.ceil(preview.codAmount / 100));
    // A second tap while the first is booking finds it taken.
    await expect(
      run((tx) =>
        claimBooking(tx, staff, orderId, { courier: 'fake', shipmentId: claim.shipmentId }),
      ),
    ).rejects.toMatchObject({ code: 'conflict' });

    await run((tx) => recordBooked(tx, staff, claim.shipmentId, booked(), null));
    const row = await shipmentRow(claim.shipmentId);
    expect(row).toMatchObject({ status: 'booked', courier: 'fake', booking_state: null });
    expect(await stock(v)).toEqual({ on_hand: 5, reserved: 2 });

    await expect(
      run((tx) => cancelOrder(tx, staff, orderId, { reason: 'test' })),
    ).rejects.toMatchObject({ code: 'illegal_transition' });
    const detail = await run((tx) => getOrder(tx, staff, orderId));
    expect(detail.shipments[0]?.courier).toMatchObject({
      courier: 'fake',
      events: [{ update: 'booked' }],
    });
  });

  it('frees a refused booking, and keeps an unsure one to look for', async () => {
    const v = await product(20_000, 5);
    const orderId = await confirmedOrder([[v, 1]]);
    const first = await run((tx) => claimBooking(tx, staff, orderId, { courier: 'fake' }));
    await run((tx) =>
      recordBookingFailed(tx, first.shipmentId, { refused: true, message: 'bad phone' }),
    );
    expect(await shipmentRow(first.shipmentId)).toMatchObject({
      status: 'pending',
      courier: null,
      booking_error: 'bad phone',
    });

    const second = await run((tx) =>
      claimBooking(tx, staff, orderId, { courier: 'fake', shipmentId: first.shipmentId }),
    );
    expect(second.invoice).toBe(first.invoice);
    await run((tx) =>
      recordBookingFailed(tx, second.shipmentId, { refused: false, message: 'no answer' }),
    );
    expect(await shipmentRow(second.shipmentId)).toMatchObject({ booking_state: 'unsure' });
    await expect(run((tx) => deleteShipment(tx, staff, second.shipmentId))).rejects.toMatchObject({
      code: 'illegal_transition',
    });
    // Another courier can't book it until staff checked the first.
    await expect(
      run((tx) =>
        claimBooking(tx, staff, orderId, { courier: 'steadfast', shipmentId: second.shipmentId }),
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    const third = await run((tx) =>
      claimBooking(tx, staff, orderId, { courier: 'fake', shipmentId: second.shipmentId }),
    );
    expect(third).toMatchObject({ unsure: true, invoice: first.invoice });

    // Let go after checking the panel: the next booking gets a new invoice.
    await run((tx) =>
      recordBookingFailed(tx, third.shipmentId, { refused: false, message: 'no answer' }),
    );
    await run((tx) =>
      cancelBooking(tx, staff, third.shipmentId, { cancelledAtCourier: true }, false),
    );
    const fourth = await run((tx) =>
      claimBooking(tx, staff, orderId, { courier: 'fake', shipmentId: third.shipmentId }),
    );
    expect(fourth.invoice).not.toBe(first.invoice);
  });

  it('asks for the courier area when the address has no match', async () => {
    const v = await product(20_000, 5);
    const orderId = await confirmedOrder([[v, 1]]);
    const preview = await run((tx) => bookingPreview(tx, staff, orderId, { courier: 'redx' }));
    expect(preview.problems).toEqual(['area_unmatched']);
    await expect(
      run((tx) => claimBooking(tx, staff, orderId, { courier: 'redx' })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const picked = await run((tx) =>
      claimBooking(tx, staff, orderId, { courier: 'redx', place: { areaId: 7 } }),
    );
    expect(picked.parcel.place).toEqual({ areaId: 7, name: 'Dhanmondi' });
  });
});

describe('areas (§3.6)', () => {
  it('uses the platform match, or a pick checked against the courier list', async () => {
    expect(await run((tx) => resolvePlace(tx, 'pathao', 513, null))).toEqual({
      cityId: 1,
      zoneId: 52,
      name: 'Dhanmondi',
    });
    expect(await run((tx) => resolvePlace(tx, 'redx', 513, null))).toBeNull();
    expect(await run((tx) => resolvePlace(tx, 'pathao', 513, { zoneId: 52, areaId: 900 }))).toEqual(
      { cityId: 1, zoneId: 52, areaId: 900, name: 'Dhanmondi 27, Dhanmondi' },
    );
    await expect(
      run((tx) => resolvePlace(tx, 'pathao', 513, { zoneId: 999 })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('the platform review (§3.6)', () => {
  it('lists unmatched areas with suggestions, and takes a super admin’s match', async () => {
    const rows = await withPlatform(app, (tx) =>
      courierAreaReview(tx, systemActor, 'redx', { unmatchedOnly: true, districtId: 47 }),
    );
    const dhanmondi = rows.find((r) => r.areaId === 513);
    expect(dhanmondi?.suggestions[0]).toMatchObject({ externalId: 7, name: 'Dhanmondi' });
    await withPlatform(app, (tx) => setCourierAreaMatch(tx, systemActor, 'redx', 513, 7));
    expect(await run((tx) => resolvePlace(tx, 'redx', 513, null))).toEqual({
      areaId: 7,
      name: 'Dhanmondi',
    });
    await expect(
      withPlatform(app, (tx) => setCourierAreaMatch(tx, staff, 'redx', 513, 7)),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await withPlatform(app, (tx) => setCourierAreaMatch(tx, systemActor, 'redx', 513, null));
  });
});

describe('updates (§3.5)', () => {
  it('walks a booked parcel to delivered: stock sold, COD settled, once', async () => {
    const v = await product(50_000, 5);
    const orderId = await confirmedOrder([[v, 2]]);
    const { claim, consignmentId } = await bookFake(orderId);
    const id = await run((tx) => findCourierShipment(tx, 'fake', { consignmentId }));
    expect(id).toBe(claim.shipmentId);

    const delivered = update('delivered', { codCollected: claim.codAmount });
    const r = await run((tx) => applyCourierUpdate(tx, claim.shipmentId, delivered, 'webhook'));
    expect(r.moved).toEqual(['ship', 'deliver']);
    expect(await stock(v)).toEqual({ on_hand: 3, reserved: 0 });
    const order = await run((tx) => getOrder(tx, staff, orderId));
    expect(order).toMatchObject({ deliveryStatus: 'delivered', paymentStatus: 'paid', flags: [] });
    expect(await run((tx) => inventoryDrift(tx))).toEqual([]);

    const again = await run((tx) => applyCourierUpdate(tx, claim.shipmentId, delivered, 'poll'));
    expect(again).toMatchObject({ moved: [], repeated: true });
  });

  it('flags a COD difference and a partial delivery', async () => {
    const v = await product(50_000, 5);
    const orderId = await confirmedOrder([[v, 2]]);
    const { claim } = await bookFake(orderId);
    await run((tx) => applyCourierUpdate(tx, claim.shipmentId, update('in_transit'), 'webhook'));
    expect((await shipmentRow(claim.shipmentId)).status).toBe('in_transit');
    await run((tx) =>
      applyCourierUpdate(
        tx,
        claim.shipmentId,
        update('partial_delivered', { codCollected: 50_000 }),
        'webhook',
      ),
    );
    const order = await run((tx) => getOrder(tx, staff, orderId));
    expect(order.flags).toEqual(expect.arrayContaining(['cod_difference', 'partial_delivery']));
    expect(order.paymentStatus).toBe('partially_paid');
    expect(order.totals.paidTotal).toBe(50_000);
    expect(await shipmentRow(claim.shipmentId)).toMatchObject({ cod_collected: '50000' });
  });

  it('fails a returning parcel, and restocks a returned one only once staff receive it', async () => {
    const v = await product(30_000, 5);
    const orderId = await confirmedOrder([[v, 1]]);
    const { claim } = await bookFake(orderId);
    await run((tx) => applyCourierUpdate(tx, claim.shipmentId, update('picked_up'), 'webhook'));
    expect(await stock(v)).toEqual({ on_hand: 4, reserved: 0 });
    await run((tx) =>
      applyCourierUpdate(
        tx,
        claim.shipmentId,
        update('returning', { message: { en: 'Customer refused' } }),
        'webhook',
      ),
    );
    expect(await shipmentRow(claim.shipmentId)).toMatchObject({
      status: 'failed',
      failed_reason: 'Customer refused',
    });
    await run((tx) => applyCourierUpdate(tx, claim.shipmentId, update('returned'), 'webhook'));
    const row = await shipmentRow(claim.shipmentId);
    expect(row.status).toBe('failed');
    expect(row.courier_returned_at).not.toBeNull();
    expect(await stock(v)).toEqual({ on_hand: 4, reserved: 0 });
    await run((tx) => receiveCourierReturn(tx, staff, claim.shipmentId));
    expect(await stock(v)).toEqual({ on_hand: 5, reserved: 1 });
    expect(await run((tx) => inventoryDrift(tx))).toEqual([]);
  });

  it('puts a parcel the courier cancelled before pickup back to pending', async () => {
    const v = await product(30_000, 5);
    const orderId = await confirmedOrder([[v, 1]]);
    const { claim } = await bookFake(orderId);
    const r = await run((tx) =>
      applyCourierUpdate(
        tx,
        claim.shipmentId,
        update('cancelled', { message: { en: 'Pickup cancelled' } }),
        'webhook',
      ),
    );
    expect(r.moved).toEqual(['unbook']);
    expect(await shipmentRow(claim.shipmentId)).toMatchObject({
      status: 'pending',
      courier: null,
      booking_error: 'Pickup cancelled',
    });
  });

  it('keeps an older update as an event without moving the shipment', async () => {
    const v = await product(30_000, 5);
    const orderId = await confirmedOrder([[v, 1]]);
    const { claim } = await bookFake(orderId);
    await run((tx) => applyCourierUpdate(tx, claim.shipmentId, update('in_transit'), 'webhook'));
    const old = { ...update('picked_up'), at: new Date(Date.now() - 3_600_000) };
    const r = await run((tx) => applyCourierUpdate(tx, claim.shipmentId, old, 'poll'));
    expect(r).toMatchObject({ moved: [], ignored: 'stale' });
    expect((await shipmentRow(claim.shipmentId)).status).toBe('in_transit');
    const view = await run((tx) => shopperOrderView(tx, orderId));
    expect(view?.shipments[0]?.events.map((e) => e.update)).toEqual([
      'picked_up',
      'booked',
      'in_transit',
    ]);
  });

  it('lists quiet open parcels for the poll, across stores', async () => {
    const v = await product(30_000, 5);
    const orderId = await confirmedOrder([[v, 1]]);
    const { claim } = await bookFake(orderId);
    await owner.query(
      `update store.shipments set last_synced_at = now() - interval '7 hours' where id = $1`,
      [claim.shipmentId],
    );
    const { rows } = await app.query<{ shipment_id: string }>(
      'select * from app.courier_poll_due(6, 30, 2000)',
    );
    expect(rows.map((r) => r.shipment_id)).toContain(claim.shipmentId);
  });
});
