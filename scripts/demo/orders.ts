// Sample orders for a demo store (phase-5b-plan §3.12): about 30 across the
// last month, in every state an owner sees: new, confirmed, being packed,
// on the way, delivered, failed delivery, returned to the store, and
// cancelled. Placed through the core commands as app_rw, like the API, then
// spread over the month by moving their dates (as the migration role).
import {
  cancelOrder,
  createShipment,
  deliverShipment,
  failShipment,
  placeOrder,
  returnShipment,
  shipShipment,
  withTenant,
} from '@managemind/core';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { ownerActor } from './catalog';

type Outcome =
  | 'pending'
  | 'confirmed'
  | 'packing'
  | 'shipped'
  | 'delivered'
  | 'failed'
  | 'returned'
  | 'cancelled';

/** The mix: most orders delivered, a few of every other state. */
const MIX: Outcome[] = [
  ...Array<Outcome>(12).fill('delivered'),
  ...Array<Outcome>(4).fill('shipped'),
  ...Array<Outcome>(3).fill('pending'),
  ...Array<Outcome>(3).fill('confirmed'),
  ...Array<Outcome>(3).fill('packing'),
  ...Array<Outcome>(2).fill('failed'),
  ...Array<Outcome>(1).fill('returned'),
  ...Array<Outcome>(2).fill('cancelled'),
];

const NAMES = ['Rahim Uddin', 'Nusrat Jahan', 'Karim Ahmed', 'Farzana Akter', 'Tanvir Hasan'];

/** Places the sample orders; returns how many. Needs the demo catalog's stock. */
export async function seedDemoOrders(client: pg.Client, tenantId: string): Promise<number> {
  const actor = ownerActor(tenantId);
  await client.query('grant app_rw to current_user with set true, inherit false');
  const { rows: variants } = await client.query<{ id: string }>(
    `select v.id from store.variants v join store.inventory_levels l on l.variant_id = v.id
      where v.tenant_id = $1 and l.on_hand > 0 order by v.created_at`,
    [tenantId],
  );
  if (!variants.length) return 0;
  let placed = 0;
  for (const [i, outcome] of MIX.entries()) {
    const variantId = variants[i % variants.length]?.id as string;
    const orderId = await withTenant(client, tenantId, async (tx) => {
      await tx.db.execute(sql`set local role app_rw`);
      const order = await placeOrder(tx, actor, {
        channel: 'admin',
        source: 'phone',
        lines: [{ variantId, quantity: 1 }],
        contact: {
          name: NAMES[i % NAMES.length] as string,
          phone: `+88017000${String(10000 + i).slice(-5)}`,
        },
        address: null,
        zone: 'none',
        payment: { kind: 'cod' },
        locale: i % 3 === 0 ? 'en' : 'bn',
        confirm: outcome !== 'pending' && outcome !== 'cancelled',
      });
      if (outcome === 'cancelled') {
        await cancelOrder(tx, actor, order.id, { reason: 'Customer changed their mind' });
      }
      if (['packing', 'shipped', 'delivered', 'failed', 'returned'].includes(outcome)) {
        const { rows } = await tx.db.execute<{ id: string }>(
          sql`select id from store.order_lines where order_id = ${order.id}`,
        );
        const shipment = await createShipment(tx, actor, order.id, {
          lines: rows.map((r) => ({ orderLineId: r.id, quantity: 1 })),
        });
        if (outcome !== 'packing') await shipShipment(tx, actor, shipment.id);
        if (outcome === 'delivered') await deliverShipment(tx, actor, shipment.id, {});
        if (outcome === 'failed' || outcome === 'returned') {
          await failShipment(tx, actor, shipment.id, { reason: 'Nobody at the address' });
        }
        if (outcome === 'returned') await returnShipment(tx, actor, shipment.id, {});
      }
      return order.id;
    });
    // Spread across the last month: the newest orders are the open ones.
    const daysAgo =
      outcome === 'pending' ? i % 2 : Math.round(((MIX.length - i) / MIX.length) * 29);
    await client.query(
      'update store.orders set placed_at = placed_at - make_interval(days => $2) where id = $1',
      [orderId, daysAgo],
    );
    placed++;
  }
  return placed;
}
