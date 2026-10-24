// Reports (phase-5a-plan §3.15): computed in SQL when asked, for a date
// range, with nothing stored. Orders count by when they were placed; refunds
// and failed deliveries by when they happened.

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, authorize } from '../access';
import { requireFeature } from '../billing/entitlements';
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
  // The reports screen is a plan feature (phase-5b-plan §3.5).
  await requireFeature(tx, 'reports');
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

// ---- Sales recovery (phase-6-plan §3.9) -------------------------------------------------

export interface RecoveryReport {
  from: string;
  to: string;
  /** Incomplete checkouts started in the range, kept 30 days at most. */
  incomplete: {
    saved: number;
    contacted: number;
    converted: number;
    recovered: number;
    /** Recovered after staff called. */
    recoveredAfterCall: number;
    dismissed: number;
    savedValue: number;
    convertedValue: number;
    recoveredValue: number;
  };
  confirmation: {
    /** COD orders placed in the range. */
    placed: number;
    confirmedBy: { call: number; link: number; staff: number; auto: number };
    cancelledBy: { code: string; orders: number }[];
    unreachable: number;
    /** Minutes from placement to confirmation, the median; null with none confirmed. */
    medianMinutes: number | null;
    /** Confirmed of those decided, in percent; null with none decided. */
    rate: number | null;
  };
  /** Delivered and not received by the score the order had when placed: what a threshold would catch. */
  deliveryByScore: {
    band: '0-49' | '50-79' | '80-100' | 'new';
    delivered: number;
    notReceived: number;
  }[];
  duplicates: { flagged: number; merged: number; cancelled: number; dismissed: number };
}

export async function getRecoveryReport(
  tx: TenantTx,
  actor: Actor,
  query: unknown,
): Promise<RecoveryReport> {
  authorize(actor, 'reports.read');
  await requireFeature(tx, 'reports');
  const q = parseInput(reportQuery, query);
  const from = sql`(${q.from}::date)::timestamp at time zone 'Asia/Dhaka'`;
  const until = sql`((${q.to}::date + 1))::timestamp at time zone 'Asia/Dhaka'`;
  const inRange = sql`o.placed_at >= ${from} and o.placed_at < ${until}`;
  const cod = sql`exists (select 1 from store.payments p where p.order_id = o.id and p.provider = 'cod')`;

  const [incomplete, confirmation, cancels, bands, duplicates] = await Promise.all([
    tx.db.execute<Record<string, number | string>>(sql`
      select count(*)::int as saved,
             count(*) filter (where contacted_at is not null)::int as contacted,
             count(*) filter (where status = 'converted')::int as converted,
             count(*) filter (where status = 'recovered')::int as recovered,
             count(*) filter (where status = 'recovered' and contacted_at is not null)::int as after_call,
             count(*) filter (where status = 'dismissed')::int as dismissed,
             coalesce(sum(subtotal), 0) as saved_value,
             coalesce(sum(subtotal) filter (where status = 'converted'), 0) as converted_value,
             coalesce(sum(subtotal) filter (where status = 'recovered'), 0) as recovered_value
        from store.incomplete_orders where created_at >= ${from} and created_at < ${until}`),
    tx.db.execute<Record<string, number | string | null>>(sql`
      select count(*)::int as placed,
             count(*) filter (where c.confirmed_via = 'call')::int as call,
             count(*) filter (where c.confirmed_via = 'link')::int as link,
             count(*) filter (where o.confirmed_at is not null
                                and coalesce(c.confirmed_via, 'staff') = 'staff')::int as staff,
             count(*) filter (where c.confirmed_via = 'auto')::int as auto,
             count(*) filter (where 'unreachable' = any(o.flags))::int as unreachable,
             count(*) filter (where o.confirmed_at is not null)::int as confirmed,
             count(*) filter (where o.confirmed_at is not null or o.status = 'cancelled')::int as decided,
             percentile_cont(0.5) within group (
               order by extract(epoch from o.confirmed_at - o.placed_at) / 60)
               filter (where o.confirmed_at is not null) as median
        from store.orders o left join store.order_confirmations c on c.order_id = o.id
       where ${inRange} and ${cod}`),
    tx.db.execute<{ code: string; orders: number }>(sql`
      select coalesce(o.cancel_code, 'other') as code, count(*)::int as orders
        from store.orders o where ${inRange} and ${cod} and o.status = 'cancelled'
         and o.confirmed_at is null
       group by 1 order by 2 desc`),
    tx.db.execute<{ band: string; delivered: number; not_received: number }>(sql`
      select case when o.phone_score is null then 'new' when o.phone_score < 50 then '0-49'
                  when o.phone_score < 80 then '50-79' else '80-100' end as band,
             count(*) filter (where o.delivery_status = 'delivered' or o.status = 'completed')::int as delivered,
             count(*) filter (where not (o.delivery_status = 'delivered' or o.status = 'completed')
               and (exists (select 1 from store.shipments s where s.order_id = o.id
                             and s.status in ('failed', 'returned'))
                    or o.cancel_code in ('fake', 'wrong_number', 'no_answer')))::int as not_received
        from store.orders o where ${inRange}
       group by 1`),
    tx.db.execute<Record<string, number>>(sql`
      select count(*) filter (where o.duplicate_of is not null)::int as flagged,
             count(*) filter (where exists (select 1 from store.order_history h
                where h.order_id = o.id and h.event = 'merged_into'))::int as merged,
             count(*) filter (where o.cancel_code = 'duplicate' and not exists (
                select 1 from store.order_history h where h.order_id = o.id and h.event = 'merged_into'))::int
               as cancelled,
             count(*) filter (where exists (select 1 from store.order_history h
                where h.order_id = o.id and h.event = 'duplicate_dismissed'))::int as dismissed
        from store.orders o where ${inRange}`),
  ]);
  const i = incomplete.rows[0] ?? {};
  const c = confirmation.rows[0] ?? {};
  const n = (v: unknown) => Number(v ?? 0);
  const byBand = new Map(bands.rows.map((b) => [b.band, b]));
  return {
    from: q.from,
    to: q.to,
    incomplete: {
      saved: n(i.saved),
      contacted: n(i.contacted),
      converted: n(i.converted),
      recovered: n(i.recovered),
      recoveredAfterCall: n(i.after_call),
      dismissed: n(i.dismissed),
      savedValue: n(i.saved_value),
      convertedValue: n(i.converted_value),
      recoveredValue: n(i.recovered_value),
    },
    confirmation: {
      placed: n(c.placed),
      confirmedBy: { call: n(c.call), link: n(c.link), staff: n(c.staff), auto: n(c.auto) },
      cancelledBy: cancels.rows,
      unreachable: n(c.unreachable),
      medianMinutes: c.median === null || c.median === undefined ? null : Math.round(n(c.median)),
      rate: n(c.decided) ? Math.round((100 * n(c.confirmed)) / n(c.decided)) : null,
    },
    deliveryByScore: (['0-49', '50-79', '80-100', 'new'] as const).map((band) => ({
      band,
      delivered: byBand.get(band)?.delivered ?? 0,
      notReceived: byBand.get(band)?.not_received ?? 0,
    })),
    duplicates: {
      flagged: n(duplicates.rows[0]?.flagged),
      merged: n(duplicates.rows[0]?.merged),
      cancelled: n(duplicates.rows[0]?.cancelled),
      dismissed: n(duplicates.rows[0]?.dismissed),
    },
  };
}
