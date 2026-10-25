// Couriers in the admin (phase-7-plan §3.3, §3.4, §6.1): connecting a
// courier, booking one order or many, cancelling and syncing a parcel, the
// courier's returns, and, outside production, moving a test parcel.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  bookingPreview,
  bookingStates,
  type CredentialCheck,
  cancelBooking,
  checkBulkBooking,
  codReconciliation,
  connectCourier,
  courierConnectInput,
  courierWebhookSecret,
  deletePayout,
  disconnectCourier,
  listCourierReturns,
  listCouriers,
  lockOrder,
  recordPayout,
  rotateWebhookSecret,
  searchCourierPlaces,
  setFakeParcel,
  shipmentCourier,
} from '@managemind/core';
import { CourierError, courierProvider } from '@managemind/providers/couriers';
import { AppError } from '@managemind/shared';
import {
  bookInput,
  bulkBookInput,
  COURIER_UPDATES,
  COURIERS,
  type Courier,
  cancelBookingInput,
  codReportQuery,
  LIVE_COURIERS,
  needsAreas,
  payoutInput,
} from '@managemind/shared/orders';
import {
  bookOrder,
  cancelAtCourier,
  courierFromParam,
  courierWebhookUrl,
  fakeAllowed,
  handleCourierWebhook,
  queueBookings,
  syncShipment,
} from '../couriers';
import { credentialsKeyring } from '../notifications';
import { limiterFor } from '../store/commerce';
import { inStore, type StaffEnv } from './context';

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['admin'] } as C & {
    tags: string[];
  });
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  200: { content: { 'application/json': { schema } }, description },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});
const Id = z.object({ id: z.uuid() });
const CourierParam = z.object({ courier: z.enum(COURIERS) });

const Connected = z
  .object({
    courier: z.enum(COURIERS),
    mode: z.enum(['sandbox', 'live']).nullable(),
    hint: z.string(),
    config: z.record(z.string(), z.unknown()),
    checkedAt: z.string().nullable(),
    checkError: z.string().nullable(),
    updatedAt: z.string(),
  })
  .openapi('ConnectedCourier');
const Couriers = z
  .object({
    /** What this environment offers: the three couriers, and the test courier outside production. */
    available: z.array(z.enum(COURIERS)),
    connected: z.array(Connected),
  })
  .openapi('Couriers');
const Webhook = z.object({ url: z.string(), secret: z.string() }).openapi('CourierWebhook');
const PickupStores = z.object({
  pickupStores: z.array(z.object({ id: z.number().int(), name: z.string() })),
});
const Place = z.object({
  kind: z.string(),
  externalId: z.number().int(),
  parentId: z.number().int().nullable(),
  name: z.string(),
  parent: z.string().nullable(),
});
const Parcel = z.record(z.string(), z.unknown()).openapi('CourierParcel');
const Preview = z
  .object({
    parcel: Parcel.nullable(),
    codAmount: z.number().int(),
    place: z.record(z.string(), z.unknown()).nullable(),
    problems: z.array(z.string()),
  })
  .openapi('BookingPreview');
const Outcome = z
  .object({
    orderId: z.uuid(),
    shipmentId: z.uuid().nullable(),
    result: z.enum(['booked', 'refused', 'unsure']),
    consignmentId: z.string().nullable().optional(),
    error: z.string().optional(),
  })
  .openapi('BookingOutcome');
const BulkCheck = z.object({
  orderId: z.uuid(),
  displayNumber: z.string().nullable(),
  problems: z.array(z.string()),
  codAmount: z.number().int(),
});
const BookingState = z.object({
  orderId: z.uuid(),
  shipmentId: z.uuid().nullable(),
  status: z.string().nullable(),
  courier: z.string().nullable(),
  bookingState: z.string().nullable(),
  bookingError: z.string().nullable(),
  consignmentId: z.string().nullable(),
});
const CourierReturn = z.object({
  shipmentId: z.uuid(),
  orderId: z.uuid(),
  displayNumber: z.string(),
  courier: z.string(),
  consignmentId: z.string().nullable(),
  name: z.string(),
  failedReason: z.string().nullable(),
  returnedByCourierAt: z.string(),
  items: z.number().int(),
});

const Matched = z.object({
  consignmentId: z.string(),
  shipmentId: z.uuid(),
  collected: z.number().int(),
  fee: z.number().int(),
  net: z.number().int(),
});
const PayoutResult = z
  .object({
    payoutId: z.uuid().nullable(),
    matched: z.array(Matched),
    unknown: z.array(z.string()),
    alreadyPaid: z.array(z.string()),
    notDelivered: z.array(z.string()),
    totals: z.object({ collected: z.number().int(), fee: z.number().int(), net: z.number().int() }),
  })
  .openapi('PayoutResult');
const CodReport = z
  .object({
    from: z.string(),
    to: z.string(),
    couriers: z.array(
      z.object({
        courier: z.string(),
        delivered: z.number().int(),
        codAsked: z.number().int(),
        collected: z.number().int(),
        fees: z.number().int(),
        net: z.number().int(),
        paidOut: z.number().int(),
        outstanding: z.number().int(),
        outstandingParcels: z.number().int(),
        returned: z.number().int(),
        returnCharges: z.number().int(),
      }),
    ),
    outstanding: z.array(
      z.object({
        shipmentId: z.uuid(),
        orderId: z.uuid(),
        displayNumber: z.string(),
        courier: z.string(),
        consignmentId: z.string().nullable(),
        deliveredAt: z.string(),
        net: z.number().int(),
        days: z.number().int(),
      }),
    ),
    differences: z.array(
      z.object({
        shipmentId: z.uuid(),
        orderId: z.uuid(),
        displayNumber: z.string(),
        courier: z.string(),
        consignmentId: z.string().nullable(),
        asked: z.number().int(),
        collected: z.number().int(),
        paidNet: z.number().int().nullable(),
        expectedNet: z.number().int(),
        kind: z.enum(['collected', 'paid']),
      }),
    ),
    payouts: z.array(
      z.object({
        id: z.uuid(),
        courier: z.string(),
        reference: z.string(),
        paidAt: z.string(),
        amount: z.number().int(),
        fees: z.number().int(),
        parcels: z.number().int(),
        source: z.string(),
      }),
    ),
  })
  .openapi('CodReport');

export const COURIER_ROUTES = {
  couriers: r({
    method: 'get',
    path: '/couriers',
    summary: "The couriers offered, and the store's connected ones without secrets",
    responses: json(Couriers, 'Couriers'),
  }),
  checkCourier: r({
    method: 'post',
    path: '/couriers/{courier}/check',
    summary: 'Check keys with the courier without saving; its pickup stores (settings.credentials)',
    request: { params: CourierParam, ...body(courierConnectInput) },
    responses: json(PickupStores, 'Checked'),
  }),
  connectCourier: r({
    method: 'put',
    path: '/couriers/{courier}',
    summary: 'Check with the courier, then save its keys (settings.credentials)',
    request: { params: CourierParam, ...body(courierConnectInput) },
    responses: json(Connected, 'Connected'),
  }),
  disconnectCourier: r({
    method: 'delete',
    path: '/couriers/{courier}',
    summary: 'Remove a courier (settings.credentials)',
    request: { params: CourierParam },
    responses: { 204: { description: 'Removed' } },
  }),
  courierWebhook: r({
    method: 'get',
    path: '/couriers/{courier}/webhook',
    summary: "The callback URL and secret to paste into the courier's panel (settings.credentials)",
    request: { params: CourierParam },
    responses: json(Webhook, 'Webhook'),
  }),
  rotateCourierWebhook: r({
    method: 'post',
    path: '/couriers/{courier}/webhook-secret',
    summary: 'A new webhook secret; paste it into the courier panel too (settings.credentials)',
    request: { params: CourierParam },
    responses: json(Webhook, 'Webhook'),
  }),
  courierPlaces: r({
    method: 'get',
    path: '/couriers/{courier}/places',
    summary: "The courier's zones or areas by name, for the booking sheet (orders.write)",
    request: { params: CourierParam, query: z.object({ q: z.string().max(60).default('') }) },
    responses: json(z.array(Place), 'Places'),
  }),
  bookingPreview: r({
    method: 'post',
    path: '/orders/{id}/booking/preview',
    summary: 'What a booking would send, and what stops it (orders.read)',
    request: { params: Id, ...body(bookInput) },
    responses: json(Preview, 'Preview'),
  }),
  book: r({
    method: 'post',
    path: '/orders/{id}/booking',
    summary: "Book the order's parcel with a courier (orders.write)",
    request: { params: Id, ...body(bookInput) },
    responses: json(Outcome, 'The booking'),
  }),
  bulkCheck: r({
    method: 'post',
    path: '/shipments/book/check',
    summary: 'Each order’s checks before a bulk booking (orders.write)',
    request: body(bulkBookInput),
    responses: json(z.array(BulkCheck), 'Checks'),
  }),
  bulkBook: r({
    method: 'post',
    path: '/shipments/book',
    summary: 'Book up to 100 orders in the background (orders.write)',
    request: body(bulkBookInput),
    responses: {
      202: {
        content: { 'application/json': { schema: z.object({ queued: z.number().int() }) } },
        description: 'Queued',
      },
    },
  }),
  bookingStates: r({
    method: 'get',
    path: '/shipments/bookings',
    summary: "Each order's latest shipment, as bookings land (orders.read)",
    request: { query: z.object({ orderIds: z.string().max(4000) }) },
    responses: json(z.array(BookingState), 'States'),
  }),
  cancelBooking: r({
    method: 'post',
    path: '/shipments/{id}/cancel-booking',
    summary: 'Cancel a booked parcel at the courier, or record that staff did (orders.write)',
    request: { params: Id, ...body(cancelBookingInput) },
    responses: json(z.object({ cancelledByApi: z.boolean() }), 'Cancelled'),
  }),
  syncShipment: r({
    method: 'post',
    path: '/shipments/{id}/sync',
    summary: 'Ask the courier now; once a minute per shipment (orders.write)',
    request: { params: Id },
    responses: json(z.object({ asked: z.boolean() }), 'Asked'),
  }),
  courierReturns: r({
    method: 'get',
    path: '/courier-returns',
    summary: 'Parcels the courier returned, waiting to be received (orders.read)',
    responses: json(z.array(CourierReturn), 'Returns'),
  }),
  codReport: r({
    method: 'get',
    path: '/reports/cod',
    summary: 'COD reconciliation by courier, for a range of delivery dates (reports.read)',
    request: { query: codReportQuery },
    responses: json(CodReport, 'Report'),
  }),
  recordPayout: r({
    method: 'post',
    path: '/courier-payouts',
    summary: 'Record a courier payout or import a statement; preview first (payments.reconcile)',
    request: body(payoutInput),
    responses: json(PayoutResult, 'Preview or saved'),
  }),
  deletePayout: r({
    method: 'delete',
    path: '/courier-payouts/{id}',
    summary: 'Delete a payout recorded by mistake (payments.reconcile)',
    request: { params: Id },
    responses: { 204: { description: 'Deleted' } },
  }),
  fakeParcel: r({
    method: 'post',
    path: '/couriers/fake/parcels/{consignmentId}',
    summary: 'Move a test parcel as the courier would; not in production (orders.write)',
    request: {
      params: z.object({ consignmentId: z.string().max(100) }),
      ...body(
        z
          .object({
            status: z.enum(COURIER_UPDATES),
            codCollected: z.number().int().min(0).nullable().optional(),
          })
          .strict(),
      ),
    },
    responses: json(z.object({ ok: z.boolean() }), 'Moved'),
  }),
} as const;

/** A courier check for the vault: the courier's own call, before anything is saved. */
const courierCheck =
  (courier: Courier): CredentialCheck =>
  async (c) => {
    await courierProvider({
      courier,
      mode: c.mode === 'sandbox' || c.mode === 'live' ? c.mode : null,
      secrets: c.secrets,
      config: c.config,
    }).check();
  };

export function registerCouriers(admin: OpenAPIHono<StaffEnv>): void {
  const R = COURIER_ROUTES;
  const actor = (c: { var: StaffEnv['Variables'] }) => c.var.staff.actor;
  const tenant = (c: { var: StaffEnv['Variables'] }) => c.var.staff.actor.tenantId as string;
  const keyringOf = async (c: { env: StaffEnv['Bindings'] }) => {
    const keyring = await credentialsKeyring(c.env);
    if (!keyring) {
      throw new AppError('feature_unavailable', {
        detail: 'The platform has no credentials key yet (CREDENTIALS_KEY)',
      });
    }
    return keyring;
  };
  const courierOf = (c: { env: StaffEnv['Bindings'] }, value: string) =>
    courierFromParam(c.env, value);

  admin.openapi(R.couriers, async (c) => {
    const connected = await inStore(c, (tx) => listCouriers(tx, actor(c)));
    const available: Courier[] = fakeAllowed(c.env)
      ? [...LIVE_COURIERS, 'fake']
      : [...LIVE_COURIERS];
    return c.json(
      {
        available,
        connected: connected
          .filter((x) => available.includes(x.kind as Courier))
          .map((x) => ({
            courier: x.kind as Courier,
            mode: x.mode,
            hint: x.hint,
            config: x.config,
            checkedAt: x.checkedAt,
            checkError: x.checkError,
            updatedAt: x.updatedAt,
          })),
      },
      200,
    );
  });
  admin.openapi(R.checkCourier, async (c) => {
    if (!actor(c).permissions.has('settings.credentials')) throw new AppError('forbidden');
    const courier = courierOf(c, c.req.valid('param').courier);
    const v = c.req.valid('json');
    try {
      const result = await courierProvider({
        courier,
        mode: v.mode ?? null,
        secrets: v.secrets,
        config: v.config,
      }).check();
      return c.json({ pickupStores: result.pickupStores ?? [] }, 200);
    } catch (e) {
      throw new AppError('validation_failed', {
        fields: [
          {
            path: 'secrets',
            code: 'rejected',
            message: (e instanceof Error ? e.message : String(e)).slice(0, 300),
          },
        ],
      });
    }
  });
  admin.openapi(R.connectCourier, async (c) => {
    const courier = courierOf(c, c.req.valid('param').courier);
    const keyring = await keyringOf(c);
    const saved = await inStore(
      c,
      (tx) =>
        connectCourier(tx, actor(c), keyring, courier, c.req.valid('json'), courierCheck(courier)),
      { write: true },
    );
    return c.json(
      {
        courier,
        mode: saved.mode,
        hint: saved.hint,
        config: saved.config,
        checkedAt: saved.checkedAt,
        checkError: saved.checkError,
        updatedAt: saved.updatedAt,
      },
      200,
    );
  });
  admin.openapi(R.disconnectCourier, async (c) => {
    const courier = courierOf(c, c.req.valid('param').courier);
    await inStore(c, (tx) => disconnectCourier(tx, actor(c), courier), { write: true });
    return c.body(null, 204);
  });
  admin.openapi(R.courierWebhook, async (c) => {
    const courier = courierOf(c, c.req.valid('param').courier);
    const keyring = await keyringOf(c);
    const secret = await inStore(c, (tx) => courierWebhookSecret(tx, actor(c), keyring, courier));
    return c.json(
      { url: courierWebhookUrl(c.env, courier, tenant(c), new URL(c.req.url).host), secret },
      200,
    );
  });
  admin.openapi(R.rotateCourierWebhook, async (c) => {
    const courier = courierOf(c, c.req.valid('param').courier);
    const keyring = await keyringOf(c);
    const secret = await inStore(c, (tx) => rotateWebhookSecret(tx, actor(c), keyring, courier), {
      write: true,
    });
    return c.json(
      { url: courierWebhookUrl(c.env, courier, tenant(c), new URL(c.req.url).host), secret },
      200,
    );
  });
  admin.openapi(R.courierPlaces, async (c) => {
    if (!actor(c).permissions.has('orders.write')) throw new AppError('forbidden');
    const courier = courierOf(c, c.req.valid('param').courier);
    if (!needsAreas(courier)) return c.json([], 200);
    const { q } = c.req.valid('query');
    return c.json(await inStore(c, (tx) => searchCourierPlaces(tx, courier, q)), 200);
  });
  admin.openapi(R.bookingPreview, async (c) => {
    const { id } = c.req.valid('param');
    const v = c.req.valid('json');
    courierOf(c, v.courier);
    const preview = await inStore(c, (tx) => bookingPreview(tx, actor(c), id, v));
    return c.json(
      {
        parcel: preview.parcel as Record<string, unknown> | null,
        codAmount: preview.codAmount,
        place: (preview.place as Record<string, unknown> | null) ?? null,
        problems: preview.problems,
      },
      200,
    );
  });
  admin.openapi(R.book, async (c) => {
    const { id } = c.req.valid('param');
    const v = c.req.valid('json');
    courierOf(c, v.courier);
    // The order first, so another store's ID is a 404; and refused for a
    // suspended store, or an owner before the terms, as every write is.
    await inStore(c, (tx) => lockOrder(tx, id), { write: true });
    const outcome = await bookOrder(c.env, c.executionCtx, tenant(c), actor(c), id, v);
    return c.json(outcome, 200);
  });
  admin.openapi(R.bulkCheck, async (c) => {
    const v = c.req.valid('json');
    courierOf(c, v.courier);
    return c.json(await inStore(c, (tx) => checkBulkBooking(tx, actor(c), v)), 200);
  });
  admin.openapi(R.bulkBook, async (c) => {
    const v = c.req.valid('json');
    courierOf(c, v.courier);
    if (!actor(c).permissions.has('orders.write')) throw new AppError('forbidden');
    await inStore(c, async () => null, { write: true });
    await queueBookings(c.env, c.executionCtx, {
      tenantId: tenant(c),
      userId: actor(c).userId ?? null,
      courier: v.courier,
      orderIds: [...new Set(v.orderIds)],
    });
    return c.json({ queued: new Set(v.orderIds).size }, 202);
  });
  admin.openapi(R.bookingStates, async (c) => {
    const ids = c.req
      .valid('query')
      .orderIds.split(',')
      .filter((x) => z.uuid().safeParse(x).success);
    return c.json(await inStore(c, (tx) => bookingStates(tx, actor(c), ids)), 200);
  });
  admin.openapi(R.cancelBooking, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    // The shipment first, so another store's ID is a 404 before any courier call.
    await inStore(c, (tx) => shipmentCourier(tx, id));
    if (!actor(c).permissions.has('orders.write')) throw new AppError('forbidden');
    let byApi = false;
    if (!input.cancelledAtCourier) {
      try {
        byApi = await cancelAtCourier(c.env, c.executionCtx, tenant(c), id);
      } catch (e) {
        throw new AppError('conflict', {
          detail:
            e instanceof CourierError
              ? `The courier refused: ${e.message}`
              : 'The courier did not answer; try again',
        });
      }
    }
    await inStore(c, (tx) => cancelBooking(tx, actor(c), id, input, byApi), { write: true });
    return c.json({ cancelledByApi: byApi }, 200);
  });
  admin.openapi(R.syncShipment, async (c) => {
    const { id } = c.req.valid('param');
    if (!actor(c).permissions.has('orders.write')) throw new AppError('forbidden');
    await inStore(c, (tx) => shipmentCourier(tx, id));
    await limiterFor(c as unknown as Parameters<typeof limiterFor>[0]).check(
      'courier_sync:shipment',
      id,
    );
    const asked = await syncShipment(c.env, c.executionCtx, tenant(c), id);
    return c.json({ asked }, 200);
  });
  admin.openapi(R.courierReturns, async (c) =>
    c.json(await inStore(c, (tx) => listCourierReturns(tx, actor(c))), 200),
  );
  admin.openapi(R.codReport, async (c) =>
    c.json(await inStore(c, (tx) => codReconciliation(tx, actor(c), c.req.valid('query'))), 200),
  );
  admin.openapi(R.recordPayout, async (c) => {
    const v = c.req.valid('json');
    const result = await inStore(c, (tx) => recordPayout(tx, actor(c), v), {
      write: !v.preview,
    });
    return c.json(result, 200);
  });
  admin.openapi(R.deletePayout, async (c) => {
    const { id } = c.req.valid('param');
    await inStore(c, (tx) => deletePayout(tx, actor(c), id), { write: true });
    return c.body(null, 204);
  });
  admin.openapi(R.fakeParcel, async (c) => {
    if (!fakeAllowed(c.env)) throw new AppError('not_found');
    const { consignmentId } = c.req.valid('param');
    const v = c.req.valid('json');
    const keyring = await keyringOf(c);
    await inStore(
      c,
      (tx) =>
        setFakeParcel(tx, actor(c), consignmentId, {
          status: v.status,
          codCollected: v.codCollected ?? null,
        }),
      { write: true },
    );
    // Then the test courier's webhook, as a courier would send it.
    const secret = await inStore(c, (tx) =>
      courierWebhookSecret(
        tx,
        { ...actor(c), permissions: new Set(['settings.credentials']) },
        keyring,
        'fake',
      ),
    );
    const raw = JSON.stringify({ consignment_id: consignmentId });
    const outcome = await handleCourierWebhook(c.env, c.executionCtx, 'fake', tenant(c), {
      headers: new Headers({ authorization: `Bearer ${secret}` }),
      raw,
      body: JSON.parse(raw),
    });
    return c.json({ ok: outcome.status === 'ok' }, 200);
  });
}
