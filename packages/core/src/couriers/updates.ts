// What a courier's status does to a shipment (phase-7-plan §3.5). The API
// asks the courier (a webhook only says which parcel); this module decides:
// it keeps the event, walks the shipment machine to the courier's state with
// every step's effects (stock at pickup, COD at delivery), and flags what
// staff must look at. Repeated and out-of-order updates are harmless.
import { schema } from '@managemind/db';
import type { CourierStatus, WebhookHint } from '@managemind/providers/couriers';
import {
  type Courier,
  type EventSource,
  type ShipmentEvent,
  shipmentPath,
  UPDATE_STATUS,
} from '@managemind/shared/orders';
import { and, eq, sql } from 'drizzle-orm';
import { type Actor, systemActor } from '../access';
import {
  deliverShipment,
  failShipment,
  lockOrder,
  lockShipment,
  moveShipment,
  returnShipment,
  shipShipment,
  transitShipment,
} from '../orders/lifecycle';
import { orderSettings } from '../pricing/quote';
import type { TenantTx } from '../tenant';
import { recordCourierEvent } from './events';

/** The courier acting through its updates: it moves shipments, nothing else. */
export const courierActor: Actor = { ...systemActor, permissions: new Set(['orders.write']) };

const s = schema.shipments;

export interface UpdateResult {
  /** The shipment events applied, in order. */
  moved: ShipmentEvent[];
  /** The same status at the same time was heard before. */
  repeated: boolean;
  /** Why nothing moved, when nothing could: `stale`, `unreachable`, `not_courier`. */
  ignored?: string;
}

/**
 * The shipment a webhook names, in this store only. A parcel found by our
 * invoice before its courier told us the consignment (Steadfast, §3.4) gets
 * it now.
 */
export async function findCourierShipment(
  tx: TenantTx,
  courier: Courier,
  hint: Pick<WebhookHint, 'consignmentId' | 'invoice'>,
): Promise<string | null> {
  if (hint.consignmentId) {
    const [row] = await tx.db
      .select({ id: s.id })
      .from(s)
      .where(and(eq(s.courier, courier), eq(s.consignmentId, hint.consignmentId)));
    if (row) return row.id;
  }
  if (hint.invoice) {
    const [row] = await tx.db
      .select({ id: s.id, consignmentId: s.consignmentId })
      .from(s)
      .where(and(eq(s.courier, courier), eq(s.courierRef, hint.invoice)));
    if (!row) return null;
    if (!row.consignmentId && hint.consignmentId) {
      await tx.db.update(s).set({ consignmentId: hint.consignmentId }).where(eq(s.id, row.id));
    }
    return row.id;
  }
  return null;
}

/**
 * Applies what the courier said about one parcel. `hint` carries amounts
 * from a webhook whose secret was checked, for couriers whose answer has
 * none (Steadfast).
 */
export async function applyCourierUpdate(
  tx: TenantTx,
  shipmentId: string,
  status: CourierStatus,
  source: EventSource,
  hint: Pick<WebhookHint, 'codCollected' | 'fee'> = {},
): Promise<UpdateResult> {
  const shipment = await lockShipment(tx, shipmentId);
  await lockOrder(tx, shipment.orderId);
  const [row] = await tx.db
    .select({
      courier: s.courier,
      courierStatusAt: s.courierStatusAt,
      codAmount: s.codAmount,
      courierFee: s.courierFee,
      courierReturnedAt: s.courierReturnedAt,
    })
    .from(s)
    .where(eq(s.id, shipmentId));
  if (!row?.courier) return { moved: [], repeated: false, ignored: 'not_courier' };
  const courier = row.courier as Courier;
  const isNew = await recordCourierEvent(tx, shipmentId, status, source);
  const message = status.message?.en ?? status.message?.bn ?? null;
  const stale = row.courierStatusAt !== null && status.at < row.courierStatusAt;
  const fee = status.fee ?? hint.fee ?? null;
  await tx.db
    .update(s)
    .set({
      lastSyncedAt: sql`now()`,
      ...(fee !== null ? { courierFee: fee } : {}),
      ...(stale
        ? {}
        : {
            courierStatus: status.status.slice(0, 60),
            courierStatusAt: status.at,
            courierMessage: message?.slice(0, 500) ?? null,
          }),
    })
    .where(eq(s.id, shipmentId));
  if (stale) return { moved: [], repeated: !isNew, ignored: 'stale' };

  if (status.update === 'cancelled') {
    if (shipment.status !== 'booked')
      return { moved: [], repeated: !isNew, ignored: 'unreachable' };
    await courierCancelled(tx, shipment, courier, message);
    return { moved: ['unbook'], repeated: !isNew };
  }
  const target = UPDATE_STATUS[status.update];
  if (!target) return { moved: [], repeated: !isNew };
  const path = shipmentPath(shipment.status, target);
  if (!path) return { moved: [], repeated: !isNew, ignored: 'unreachable' };

  const collected =
    status.codCollected ??
    hint.codCollected ??
    (row.codAmount !== null ? Number(row.codAmount) : null);
  const moved: ShipmentEvent[] = [];
  for (const event of path) {
    moved.push(event);
    if (event === 'ship') await shipShipment(tx, courierActor, shipmentId, courier);
    else if (event === 'transit') await transitShipment(tx, courierActor, shipmentId, courier);
    else if (event === 'deliver') {
      const carriesCod = row.codAmount !== null && Number(row.codAmount) > 0;
      if (carriesCod && collected !== null) {
        await tx.db.update(s).set({ codCollected: collected }).where(eq(s.id, shipmentId));
      }
      await deliverShipment(
        tx,
        courierActor,
        shipmentId,
        { cashCollected: carriesCod },
        {
          courier,
          collected: carriesCod ? collected : null,
          partial: status.update === 'partial_delivered',
        },
      );
    } else if (event === 'fail') {
      await failShipment(
        tx,
        courierActor,
        shipmentId,
        { reason: (message ?? `${courier}: ${status.status}`).slice(0, 300) },
        courier,
      );
    } else if (event === 'return') {
      await returnShipment(tx, courierActor, shipmentId, {});
    }
  }
  if (status.update === 'returned' && !row.courierReturnedAt) {
    await tx.db.update(s).set({ courierReturnedAt: sql`now()` }).where(eq(s.id, shipmentId));
    const { settings } = await orderSettings(tx);
    if (settings.couriers.autoReceive) {
      await returnShipment(tx, courierActor, shipmentId, {});
      moved.push('return');
    }
  }
  return { moved, repeated: !isNew };
}

/** The courier cancelled before pickup: the shipment is pending again, with its reason. */
async function courierCancelled(
  tx: TenantTx,
  shipment: Awaited<ReturnType<typeof lockShipment>>,
  courier: Courier,
  message: string | null,
) {
  await moveShipment(tx, courierActor, shipment, 'unbook', {
    courier,
    reason: message ?? undefined,
    data: { courier, byCourier: true },
  });
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
      bookingError: (message ?? `${courier} cancelled the parcel`).slice(0, 300),
      codAmount: null,
      courierArea: null,
    })
    .where(eq(s.id, shipment.id));
}

/**
 * A parcel the courier returned, now in the store: today's return, which
 * restocks it (§3.5, Q9). Staff confirm it; `autoReceive` does it at once.
 */
export async function receiveCourierReturn(
  tx: TenantTx,
  actor: Actor,
  shipmentId: string,
  input: unknown = {},
) {
  return returnShipment(tx, actor, shipmentId, input);
}
