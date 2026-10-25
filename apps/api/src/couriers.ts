// Couriers in the API (phase-7-plan §3.4, §3.5): the calls to each courier,
// between the transactions `core` decides in. Booking claims, calls, then
// records; a webhook names a parcel, and the courier is asked about it; the
// poll asks about quiet parcels twice a day; bulk bookings run on the
// delayed-work queue, 10 to a message, under the Free plan's 50 subrequests.
import {
  type Actor,
  actorFor,
  applyCourierUpdate,
  type CourierConnection,
  claimBooking,
  courierActor,
  findCourierShipment,
  loadCourier,
  markCourierSynced,
  type OutboxEvent,
  orderSettings,
  recordBooked,
  recordBookingFailed,
  relayEvents,
  saveCourierSecrets,
  shipmentCourier,
  type TenantTx,
  withTenant,
} from '@managemind/core';
import { createDb } from '@managemind/db';
import {
  type Booked,
  CourierError,
  type CourierProvider,
  courierProvider,
  type FakeParcelState,
  type WebhookHint,
} from '@managemind/providers/couriers';
import { AppError } from '@managemind/shared';
import { COURIER_LIMITS, COURIER_NAMES, type Courier, isCourier } from '@managemind/shared/orders';
import { captureMessage } from '@sentry/cloudflare';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { queueSink, withClient } from './db';
import { type Env, getConfig } from './env';
import { log } from './log';
import { credentialsKeyring } from './notifications';

type Ctx = Pick<ExecutionContext, 'waitUntil'>;

/** Bulk bookings: one message per 10 orders (§3.4). */
export interface CourierBookMessage {
  kind: 'courier_book';
  tenantId: string;
  /** Who asked; null for the store's auto-booking on confirm (Q8). */
  userId: string | null;
  courier: Courier;
  orderIds: string[];
}

/** Quiet parcels to ask about (§3.5): one message per store, courier and 20 shipments. */
export interface CourierPollMessage {
  kind: 'courier_poll';
  tenantId: string;
  courier: Courier;
  shipmentIds: string[];
}

export type CourierMessage = CourierBookMessage | CourierPollMessage;

/** The test courier never reaches production. */
export const fakeAllowed = (env: Pick<Env, 'ENVIRONMENT'>) => env.ENVIRONMENT !== 'production';

export function courierFromParam(env: Env, value: string): Courier {
  if (!isCourier(value) || (value === 'fake' && !fakeAllowed(env))) throw new AppError('not_found');
  return value;
}

/** Where the courier sends its webhooks: the API's own host, like the IPN (§3.3). */
export function courierWebhookUrl(
  env: Env,
  courier: Courier,
  tenantId: string,
  requestHost?: string,
) {
  const host = getConfig(env).ADMIN_HOST ?? requestHost ?? 'localhost';
  return `https://${host}/v1/webhooks/couriers/${courier}/${tenantId}`;
}

const relay = (env: Env, client: pg.Client) => ({
  afterCommit: async (events: Parameters<typeof relayEvents>[1]) => {
    await relayEvents(client, events, queueSink(env.OUTBOX));
  },
});

/** The store's adapter, wired to this connection for the test courier's state and renewed tokens. */
export function providerFor(
  env: Env,
  client: pg.Client,
  tenantId: string,
  connection: CourierConnection,
): CourierProvider {
  return courierProvider(connection, {
    fakeLookup: async (consignmentId) =>
      withTenant(client, tenantId, async (tx) => {
        const { rows } = await tx.db.execute<{ state: FakeParcelState | null }>(sql`
          select metadata -> 'fakeCourier' as state from store.shipments
           where courier = 'fake' and consignment_id = ${consignmentId}`);
        return rows[0]?.state ?? null;
      }),
    saveSecrets: async (patch) => {
      const keyring = await credentialsKeyring(env);
      if (!keyring) return;
      await withTenant(client, tenantId, (tx) =>
        saveCourierSecrets(tx, keyring, connection.courier, patch),
      );
    },
  });
}

/** The store's courier, opened; null when it isn't connected or its keys can't be opened. */
export async function connectionFor(
  env: Env,
  tx: TenantTx,
  courier: Courier,
): Promise<CourierConnection | null> {
  if (courier === 'fake' && !fakeAllowed(env)) return null;
  try {
    return await loadCourier(tx, await credentialsKeyring(env), courier);
  } catch (e) {
    log('error', 'courier credentials unreadable', {
      tenant_id: tx.tenantId,
      courier,
      error: String(e),
    });
    return null;
  }
}

export interface BookOutcome {
  orderId: string;
  shipmentId: string | null;
  result: 'booked' | 'refused' | 'unsure';
  consignmentId?: string | null;
  error?: string;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/**
 * Books one order's parcel (§3.4): claim, ask the courier, record. A
 * booking that got no answer before is first looked for by its invoice;
 * where the courier can't be searched, staff are asked to check its panel,
 * and nothing is booked blindly (Q7).
 */
export async function bookOrder(
  env: Env,
  ctx: Ctx,
  tenantId: string,
  actor: Actor,
  orderId: string,
  input: Record<string, unknown> & { courier: Courier },
): Promise<BookOutcome> {
  return withClient(env, ctx, async (client) => {
    const connection = await withTenant(client, tenantId, (tx) =>
      connectionFor(env, tx, input.courier),
    );
    if (!connection) {
      throw new AppError('feature_unavailable', {
        detail: `${COURIER_NAMES[input.courier]} isn't connected`,
      });
    }
    const provider = providerFor(env, client, tenantId, connection);
    const claim = await withTenant(
      client,
      tenantId,
      (tx) => claimBooking(tx, actor, orderId, input),
      relay(env, client),
    );
    try {
      let booked: Booked | null = null;
      if (claim.unsure) {
        if (!provider.findByInvoice) {
          throw new CourierError('check_panel', {
            refused: false,
            message: `Check ${COURIER_NAMES[claim.courier]}'s panel for ${claim.invoice} first`,
          });
        }
        booked = await provider.findByInvoice(claim.invoice);
      }
      booked ??= await provider.book(claim.parcel);
      const found = booked;
      await withTenant(
        client,
        tenantId,
        (tx) =>
          recordBooked(
            tx,
            actor,
            claim.shipmentId,
            found,
            found.trackingCode ? provider.trackingUrl(found.trackingCode) : null,
          ),
        relay(env, client),
      );
      log('info', 'parcel booked', {
        tenant_id: tenantId,
        courier: claim.courier,
        shipment_id: claim.shipmentId,
        consignment_id: found.consignmentId,
      });
      return {
        orderId,
        shipmentId: claim.shipmentId,
        result: 'booked',
        consignmentId: found.consignmentId,
      };
    } catch (e) {
      const refused = e instanceof CourierError && e.refused;
      const message = messageOf(e);
      await withTenant(client, tenantId, (tx) =>
        recordBookingFailed(tx, claim.shipmentId, { refused, message }),
      );
      log(refused ? 'info' : 'warn', 'parcel not booked', {
        tenant_id: tenantId,
        courier: claim.courier,
        shipment_id: claim.shipmentId,
        refused,
        error: message,
      });
      return {
        orderId,
        shipmentId: claim.shipmentId,
        result: refused ? 'refused' : 'unsure',
        error: message,
      };
    }
  });
}

/**
 * Cancels a booked parcel at the courier where its API can; returns whether
 * it did, so core can ask staff for the panel otherwise.
 */
export async function cancelAtCourier(
  env: Env,
  ctx: Ctx,
  tenantId: string,
  shipmentId: string,
): Promise<boolean> {
  return withClient(env, ctx, async (client) => {
    const found = await withTenant(client, tenantId, async (tx) => {
      const s = await shipmentCourier(tx, shipmentId);
      return { s, connection: s.courier ? await connectionFor(env, tx, s.courier) : null };
    });
    if (found.s.status !== 'booked' || !found.connection) return false;
    const provider = providerFor(env, client, tenantId, found.connection);
    if (!provider.cancel) return false;
    await provider.cancel({
      consignmentId: found.s.consignmentId,
      invoice: found.s.courierRef ?? undefined,
      trackingCode: found.s.trackingCode ?? undefined,
    });
    return true;
  });
}

/**
 * Asks the courier about one parcel and applies the answer. Returns false
 * when the courier couldn't be asked, so a webhook answers 500 and comes
 * again; a parcel the courier doesn't know is logged and left alone.
 */
async function syncWith(
  client: pg.Client,
  env: Env,
  tenantId: string,
  provider: CourierProvider,
  shipmentId: string,
  source: 'webhook' | 'poll' | 'staff',
  hint: WebhookHint = {},
): Promise<boolean> {
  const s = await withTenant(client, tenantId, (tx) => shipmentCourier(tx, shipmentId));
  if (!s.courier) return true;
  try {
    const status = await provider.status({
      consignmentId: s.consignmentId,
      invoice: s.courierRef ?? undefined,
      trackingCode: s.trackingCode ?? undefined,
    });
    const result = await withTenant(
      client,
      tenantId,
      (tx) =>
        applyCourierUpdate(tx, shipmentId, status, source, {
          codCollected: hint.codCollected,
          fee: hint.fee,
        }),
      relay(env, client),
    );
    if (result.moved.length || result.ignored) {
      log('info', 'courier update applied', {
        tenant_id: tenantId,
        courier: s.courier,
        shipment_id: shipmentId,
        status: status.status,
        moved: result.moved.join(','),
        ...(result.ignored ? { ignored: result.ignored } : {}),
      });
    }
    return true;
  } catch (e) {
    await withTenant(client, tenantId, (tx) => markCourierSynced(tx, shipmentId));
    if (e instanceof CourierError && e.refused) {
      log('warn', 'courier does not know the parcel', {
        tenant_id: tenantId,
        courier: s.courier,
        shipment_id: shipmentId,
        error: messageOf(e),
      });
      return true;
    }
    log('warn', 'courier could not be asked', {
      tenant_id: tenantId,
      courier: s.courier,
      shipment_id: shipmentId,
      error: messageOf(e),
    });
    return false;
  }
}

/** Sync now, from the order page (§3.5). */
export async function syncShipment(
  env: Env,
  ctx: Ctx,
  tenantId: string,
  shipmentId: string,
): Promise<boolean> {
  return withClient(env, ctx, async (client) => {
    const connection = await withTenant(client, tenantId, async (tx) => {
      const s = await shipmentCourier(tx, shipmentId);
      return s.courier ? connectionFor(env, tx, s.courier) : null;
    });
    if (!connection) throw new AppError('not_found');
    return syncWith(
      client,
      env,
      tenantId,
      providerFor(env, client, tenantId, connection),
      shipmentId,
      'staff',
    );
  });
}

export type WebhookOutcome =
  | { status: 'ok'; reply?: { status: number; headers: Record<string, string> } }
  | { status: 'not_found' | 'refused' | 'retry' };

/**
 * A courier's webhook (§3.5): its secret checked where it has one, then the
 * parcel looked up in this store only, and the courier asked about it.
 */
export async function handleCourierWebhook(
  env: Env,
  ctx: Ctx,
  courier: Courier,
  tenantId: string,
  req: { headers: Headers; raw: string; body: unknown },
): Promise<WebhookOutcome> {
  return withClient(env, ctx, async (client) => {
    const connection = await withTenant(client, tenantId, (tx) =>
      connectionFor(env, tx, courier),
    ).catch(() => null);
    const secret = connection?.secrets.webhookSecret;
    if (!connection || typeof secret !== 'string') return { status: 'not_found' };
    const provider = providerFor(env, client, tenantId, connection);
    const hint = provider.parseWebhook(req, secret);
    if (hint === 'refused') {
      log('warn', 'courier webhook refused', { tenant_id: tenantId, courier });
      return { status: 'refused' };
    }
    const reply = provider.webhookReply?.(secret);
    const shipmentId = await withTenant(client, tenantId, (tx) =>
      findCourierShipment(tx, courier, hint),
    );
    if (!shipmentId) {
      log('info', 'courier webhook for no parcel of ours', { tenant_id: tenantId, courier });
      return { status: 'ok', ...(reply ? { reply } : {}) };
    }
    const done = await syncWith(client, env, tenantId, provider, shipmentId, 'webhook', hint);
    return done ? { status: 'ok', ...(reply ? { reply } : {}) } : { status: 'retry' };
  });
}

/**
 * The poll (§3.5, Q14): the quiet parcels across stores, as messages of 20
 * per store and courier on the delayed-work queue.
 */
export async function pollCouriers(env: Env, ctx: Ctx): Promise<number> {
  const due = await withClient(env, ctx, async (client) => {
    const { rows } = await client.query<{
      tenant_id: string;
      shipment_id: string;
      courier: string;
    }>('select * from app.courier_poll_due($1, 30, 2000)', [COURIER_LIMITS.quietHours]);
    return rows;
  });
  const groups = new Map<string, CourierPollMessage>();
  const messages: CourierPollMessage[] = [];
  for (const r of due) {
    if (!isCourier(r.courier)) continue;
    const key = `${r.tenant_id}:${r.courier}`;
    let m = groups.get(key);
    if (!m || m.shipmentIds.length >= COURIER_LIMITS.pollBatch) {
      m = { kind: 'courier_poll', tenantId: r.tenant_id, courier: r.courier, shipmentIds: [] };
      groups.set(key, m);
      messages.push(m);
    }
    m.shipmentIds.push(r.shipment_id);
  }
  for (let i = 0; env.DOMAINS && i < messages.length; i += 100) {
    await env.DOMAINS.sendBatch(messages.slice(i, i + 100).map((body) => ({ body })));
  }
  log('info', 'courier poll queued', { shipments: due.length, messages: messages.length });
  return due.length;
}

/** Queues a bulk booking (§3.4), or runs it after the response where there's no queue. */
export async function queueBookings(
  env: Env,
  ctx: Ctx,
  message: Omit<CourierBookMessage, 'kind' | 'orderIds'> & { orderIds: string[] },
): Promise<void> {
  const batches: CourierBookMessage[] = [];
  for (let i = 0; i < message.orderIds.length; i += COURIER_LIMITS.bookBatch) {
    batches.push({
      ...message,
      kind: 'courier_book',
      orderIds: message.orderIds.slice(i, i + COURIER_LIMITS.bookBatch),
    });
  }
  if (env.DOMAINS) {
    await env.DOMAINS.sendBatch(batches.map((body) => ({ body })));
    return;
  }
  ctx.waitUntil(Promise.all(batches.map((b) => runBookings(env, ctx, b))).then(() => {}));
}

async function runBookings(env: Env, ctx: Ctx, m: CourierBookMessage): Promise<void> {
  const userId = m.userId;
  const actor = userId
    ? await withClient(env, ctx, (client) => actorFor(createDb(client), userId, m.tenantId))
    : courierActor;
  for (const orderId of m.orderIds) {
    try {
      await bookOrder(env, ctx, m.tenantId, actor, orderId, { courier: m.courier });
    } catch (e) {
      // Refused before the courier was asked (no longer confirmed, no area): the list shows it.
      log('info', 'bulk booking skipped an order', {
        tenant_id: m.tenantId,
        order_id: orderId,
        error: messageOf(e),
      });
    }
  }
}

/**
 * Auto-booking (§3.4, Q8): a store with `couriers.autoBook` on books each
 * confirmed order with its default courier (or the first connected), in the
 * background like a bulk booking. Off by default.
 */
export async function autoBook(env: Env, ctx: Ctx, events: readonly OutboxEvent[]): Promise<void> {
  const byStore = new Map<string, string[]>();
  for (const e of events) {
    const tenantId = e.tenantId;
    const orderId = e.aggregateId;
    if (e.eventType !== 'order.confirmed' || !tenantId || !orderId) continue;
    byStore.set(tenantId, [...(byStore.get(tenantId) ?? []), orderId]);
  }
  for (const [tenantId, orderIds] of byStore) {
    const courier = await withClient(env, ctx, (client) =>
      withTenant(client, tenantId, async (tx) => {
        const { settings } = await orderSettings(tx);
        if (settings.couriers.autoBook !== 'on_confirm') return null;
        const { rows } = await tx.db.execute<{ kind: string }>(sql`
          select kind from store.provider_credentials
           where kind in ('steadfast', 'pathao', 'redx', 'fake') order by created_at`);
        const connected = rows
          .map((r) => r.kind)
          .filter((k): k is Courier => isCourier(k) && (k !== 'fake' || fakeAllowed(env)));
        const preferred = settings.couriers.default;
        return preferred && connected.includes(preferred) ? preferred : (connected[0] ?? null);
      }),
    );
    if (!courier) continue;
    await queueBookings(env, ctx, { tenantId, userId: null, courier, orderIds });
    log('info', 'auto-booking queued', { tenant_id: tenantId, courier, orders: orderIds.length });
  }
}

async function runPoll(env: Env, ctx: Ctx, m: CourierPollMessage): Promise<void> {
  await withClient(env, ctx, async (client) => {
    const connection = await withTenant(client, m.tenantId, (tx) =>
      connectionFor(env, tx, m.courier),
    );
    if (!connection) {
      for (const id of m.shipmentIds) {
        await withTenant(client, m.tenantId, (tx) => markCourierSynced(tx, id));
      }
      return;
    }
    const provider = providerFor(env, client, m.tenantId, connection);
    for (const id of m.shipmentIds) {
      await syncWith(client, env, m.tenantId, provider, id, 'poll');
    }
  });
}

/** The delayed-work queue's courier messages. Each is acked once tried; the poll comes again. */
export async function handleCourierMessages(
  messages: readonly Message<CourierMessage>[],
  env: Env,
  ctx: Ctx,
): Promise<void> {
  for (const message of messages) {
    try {
      if (message.body.kind === 'courier_book') await runBookings(env, ctx, message.body);
      else await runPoll(env, ctx, message.body);
      message.ack();
    } catch (e) {
      log('error', 'courier message failed', {
        tenant_id: message.body.tenantId,
        kind: message.body.kind,
        error: messageOf(e),
      });
      if (message.attempts >= 3) {
        captureMessage(`Courier ${message.body.kind} failed`, {
          level: 'warning',
          tags: { tenant_id: message.body.tenantId },
        });
        message.ack();
      } else message.retry({ delaySeconds: 60 });
    }
  }
}

export type { TenantTx };
