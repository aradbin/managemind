// Sample orders for a demo store (phase-5b-plan §3.12): about 30 across the
// last month, in every state an owner sees: new, confirmed, being packed,
// on the way, delivered, failed delivery, returned to the store, and
// cancelled. Placed through the core commands as app_rw, like the API, then
// spread over the month by moving their dates (as the migration role).
// Five customers order again and again, so their delivery scores differ
// (phase-6-plan §11); the pending orders fill the confirmation queue, and a
// few checkouts were left unfinished. The sent ones are Steadfast parcels
// with the courier's updates (phase-7-plan §11).
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
          phone: `+88017000${String(10000 + (i % NAMES.length)).slice(-5)}`,
        },
        address: null,
        zone: 'none',
        payment: { kind: 'cod' },
        locale: i % 3 === 0 ? 'en' : 'bn',
        confirm: outcome !== 'pending' && outcome !== 'cancelled',
      });
      if (outcome === 'cancelled') {
        // One a fake order, one the customer's change of mind (phase-6-plan §3.5).
        const fake = i % 2 === 0;
        await cancelOrder(tx, actor, order.id, {
          reason: fake ? 'Says they never ordered' : 'Customer changed their mind',
          code: fake ? 'fake' : 'shopper_request',
        });
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
  await seedIncompleteOrders(
    client,
    tenantId,
    variants.map((v) => v.id),
  );
  await seedCourierParcels(client, tenantId);
  return placed;
}

/**
 * The sent orders as Steadfast parcels with their courier updates
 * (phase-7-plan §11), so sales meetings can show the courier's timeline
 * without a courier account. No tracking link: the consignments are made up.
 */
async function seedCourierParcels(client: pg.Client, tenantId: string) {
  await client.query(
    `update store.shipments s
        set courier = 'steadfast', courier_ref = 'demo-' || n.row_number,
            consignment_id = 'DEMO' || lpad((row_number)::text, 5, '0'),
            tracking_code = 'DEMO' || lpad((row_number)::text, 5, '0'),
            tracking_number = 'DEMO' || lpad((row_number)::text, 5, '0'),
            carrier = 'Steadfast', booked_at = s.shipped_at - interval '3 hours',
            cod_amount = o.total, courier_fee = 6000,
            cod_collected = case when s.status = 'delivered' then o.total end,
            courier_status = case s.status when 'shipped' then 'pending' when 'delivered' then 'delivered'
                                           else 'cancelled' end,
            courier_status_at = coalesce(s.delivered_at, s.failed_at, s.shipped_at),
            courier_returned_at = case when s.status = 'returned' then s.returned_at end,
            last_synced_at = now()
       from (select id, row_number() over (order by created_at) as row_number
               from store.shipments where tenant_id = $1) n,
            store.orders o
      where s.tenant_id = $1 and n.id = s.id and o.id = s.order_id
        and s.status in ('shipped', 'delivered', 'failed', 'returned')`,
    [tenantId],
  );
  await client.query(
    `insert into store.shipment_events (tenant_id, shipment_id, courier_status, update, message, courier_at, source)
     select s.tenant_id, s.id, e.status, e.update, jsonb_build_object('en', e.message), e.at, 'webhook'
       from store.shipments s
       cross join lateral (values
         ('in_review', 'booked', 'Booked', s.booked_at),
         ('pending', 'in_transit', 'Picked up from the store', s.shipped_at),
         ('delivered', 'delivered', 'Delivered to the customer', s.delivered_at),
         ('cancelled', 'returning', 'Customer not at the address', s.failed_at)
       ) as e(status, update, message, at)
      where s.tenant_id = $1 and s.courier = 'steadfast' and e.at is not null
     on conflict do nothing`,
    [tenantId],
  );
}

/** Three checkouts left unfinished in the last day, for the Incomplete orders screen. */
async function seedIncompleteOrders(client: pg.Client, tenantId: string, variantIds: string[]) {
  const people = [
    { name: 'Sabina Yasmin', phone: '+8801700020001', hoursAgo: 2, status: 'open' },
    { name: null, phone: '+8801700020002', hoursAgo: 5, status: 'open' },
    { name: 'Arif Hossain', phone: '+8801700020003', hoursAgo: 20, status: 'contacted' },
  ] as const;
  for (const [i, p] of people.entries()) {
    const variantId = variantIds[i % variantIds.length] as string;
    await withTenant(client, tenantId, async (tx) => {
      await tx.db.execute(sql`set local role app_rw`);
      const { rows } = await tx.db.execute<{ title: unknown; price: string }>(sql`
        select pt.title, v.price from store.variants v
          join store.products p on p.id = v.product_id
          left join lateral (select jsonb_object_agg(t.locale, t.title) as title
                               from store.product_translations t where t.product_id = p.id) pt on true
         where v.id = ${variantId}`);
      const price = Number(rows[0]?.price ?? 0);
      const lines = [
        { variantId, quantity: 1, title: rows[0]?.title ?? {}, optionLabels: [], price },
      ];
      await tx.db.execute(sql`
        insert into store.incomplete_orders
          (phone, name, address, lines, subtotal, locale, status, note, contacted_at, created_at, updated_at)
        values (${p.phone}, ${p.name}, '{"divisionId": 6, "districtId": 47, "areaId": 513}'::jsonb,
                ${JSON.stringify(lines)}::jsonb, ${price}, 'bn', ${p.status},
                ${p.status === 'contacted' ? 'Will order after payday' : null},
                ${p.status === 'contacted' ? sql`now() - interval '2 hours'` : null},
                now() - make_interval(hours => ${p.hoursAgo + 1}), now() - make_interval(hours => ${p.hoursAgo}))`);
    });
  }
}
