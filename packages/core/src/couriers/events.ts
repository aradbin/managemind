// The courier's events on a shipment (phase-7-plan §3.1): every status we
// heard, once each, for the order's timeline and the tracking page.
import { schema } from '@managemind/db';
import type { CourierStatus } from '@managemind/providers/couriers';
import type { EventSource } from '@managemind/shared/orders';
import type { TenantTx } from '../tenant';

/** Stores the event; false when the same status at the same time was stored before. */
export async function recordCourierEvent(
  tx: TenantTx,
  shipmentId: string,
  status: CourierStatus,
  source: EventSource,
): Promise<boolean> {
  const message: { en?: string; bn?: string } = {};
  if (status.message?.en) message.en = status.message.en.slice(0, 300);
  if (status.message?.bn) message.bn = status.message.bn.slice(0, 300);
  const inserted = await tx.db
    .insert(schema.shipmentEvents)
    .values({
      shipmentId,
      courierStatus: status.status.slice(0, 60),
      update: status.update,
      message,
      courierAt: status.at,
      source,
    })
    .onConflictDoNothing()
    .returning({ id: schema.shipmentEvents.id });
  return inserted.length > 0;
}
