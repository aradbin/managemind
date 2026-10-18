// Reports (phase-5a-plan §3.15): computed in SQL when asked, for a date
// range, with nothing stored. Orders count by when they were placed; refunds
// and failed deliveries by when they happened.

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, authorize } from '../access';
import { parseInput } from '../catalog/common';
import type { TenantTx } from '../tenant';

export const reportQuery = z
  .object({
    from: z.iso.date(),
    /** Inclusive. */
    to: z.iso.date(),
  })
  .strict()
  .refine((q) => q.from <= q.to, { message: 'from is after to', path: ['from'] })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 366 * 86_400_000, {
    message: 'at most a year',
    path: ['to'],
  });

export interface Reports {
  from: string;
  to: string;
  /** Units returned against units delivered, per product (the 20 most returned). */
  returnsByProduct: {
    productId: string;
    title: Record<string, string>;
    delivered: number;
    returned: number;
  }[];
  returnsByReason: { reason: string; returns: number; units: number }[];
  refundsByMethod: { method: string; refunds: number; amount: number }[];
  /** Shipments that came back, against all that went out, per delivery zone. */
  failedByZone: {
    zoneId: string | null;
    zone: Record<string, string> | null;
    shipped: number;
    failed: number;
    cost: number;
  }[];
  /** Orders and revenue (paid) by how they were paid. */
  payments: { kind: 'online' | 'cod' | 'manual' | 'mixed'; orders: number; revenue: number }[];
}

export async function getReports(tx: TenantTx, actor: Actor, query: unknown): Promise<Reports> {
  authorize(actor, 'reports.read');
  const q = parseInput(reportQuery, query);
  // The range in Dhaka time, as staff read dates.
  const from = sql`(${q.from}::date)::timestamp at time zone 'Asia/Dhaka'`;
  const until = sql`((${q.to}::date + 1))::timestamp at time zone 'Asia/Dhaka'`;

  const [byProduct, byReason, byMethod, byZone, byPayment] = await Promise.all([
    tx.db.execute<{
      product_id: string;
      title: Record<string, string>;
      delivered: number;
      returned: number;
    }>(sql`
      with delivered as (
        select l.product_id, (array_agg(l.title))[1] as title, sum(sl.quantity)::int as delivered
          from store.shipment_lines sl
          join store.shipments s on s.id = sl.shipment_id and s.status = 'delivered'
          join store.order_lines l on l.id = sl.order_line_id
          join store.orders o on o.id = l.order_id
         where o.placed_at >= ${from} and o.placed_at < ${until}
         group by l.product_id),
      returned as (
        select l.product_id, sum(rl.quantity)::int as returned
          from store.return_lines rl
          join store.returns r on r.id = rl.return_id
          join store.order_lines l on l.id = rl.order_line_id
          join store.orders o on o.id = l.order_id
         where o.placed_at >= ${from} and o.placed_at < ${until}
           and r.status <> 'rejected' and r.resolution is distinct from 'rejected'
         group by l.product_id)
      select d.product_id, d.title, d.delivered, coalesce(r.returned, 0) as returned
        from delivered d left join returned r using (product_id)
       where coalesce(r.returned, 0) > 0
       order by coalesce(r.returned, 0)::float / greatest(d.delivered, 1) desc, d.delivered desc
       limit 20`),
    tx.db.execute<{ reason: string; returns: number; units: number }>(sql`
      select r.reason, count(distinct r.id)::int as returns, coalesce(sum(rl.quantity), 0)::int as units
        from store.returns r join store.return_lines rl on rl.return_id = r.id
       where r.created_at >= ${from} and r.created_at < ${until}
         and r.status <> 'rejected' and r.resolution is distinct from 'rejected'
       group by r.reason order by units desc`),
    tx.db.execute<{ method: string; refunds: number; amount: string }>(sql`
      select method, count(*)::int as refunds, coalesce(sum(amount), 0) as amount
        from store.refunds
       where status = 'succeeded' and processed_at >= ${from} and processed_at < ${until}
       group by method order by amount desc`),
    tx.db.execute<{
      zone_id: string | null;
      zone: Record<string, string> | null;
      shipped: number;
      failed: number;
      cost: string;
    }>(sql`
      select o.zone_id, z.name as zone,
             count(*) filter (where s.shipped_at is not null)::int as shipped,
             count(*) filter (where s.status = 'returned')::int as failed,
             coalesce(sum(s.return_cost) filter (where s.status = 'returned'), 0) as cost
        from store.shipments s
        join store.orders o on o.id = s.order_id
        left join store.delivery_zones z on z.id = o.zone_id
       where s.shipped_at >= ${from} and s.shipped_at < ${until}
       group by o.zone_id, z.name order by failed desc, shipped desc`),
    tx.db.execute<{
      kind: Reports['payments'][number]['kind'];
      orders: number;
      revenue: string;
    }>(sql`
      with paid as (
        select o.id, o.paid_total - o.refunded_total as revenue,
               bool_or(p.provider = 'sslcommerz') as online,
               bool_or(p.provider = 'cod') as cod,
               bool_or(p.provider = 'manual') as manual
          from store.orders o
          join store.payments p on p.order_id = o.id and p.status = 'paid'
         where o.placed_at >= ${from} and o.placed_at < ${until} and o.status <> 'cancelled'
         group by o.id)
      select case when (online::int + cod::int + manual::int) > 1 then 'mixed'
                  when online then 'online' when cod then 'cod' else 'manual' end as kind,
             count(*)::int as orders, coalesce(sum(revenue), 0) as revenue
        from paid group by 1 order by revenue desc`),
  ]);

  return {
    from: q.from,
    to: q.to,
    returnsByProduct: byProduct.rows.map((r) => ({
      productId: r.product_id,
      title: r.title,
      delivered: r.delivered,
      returned: r.returned,
    })),
    returnsByReason: byReason.rows,
    refundsByMethod: byMethod.rows.map((r) => ({ ...r, amount: Number(r.amount) })),
    failedByZone: byZone.rows.map((r) => ({
      zoneId: r.zone_id,
      zone: r.zone,
      shipped: r.shipped,
      failed: r.failed,
      cost: Number(r.cost),
    })),
    payments: byPayment.rows.map((r) => ({ ...r, revenue: Number(r.revenue) })),
  };
}
