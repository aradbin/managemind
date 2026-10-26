// The reports' summary tables (phase-8-plan §3.8, §3.9, ADR 0031). Every
// fact is booked on its own Dhaka day:
// - a sale on its shipment's delivery day, with the line's discounts and VAT
//   shared by delivered units (cumulatively, so parts add up to the line);
// - a return on the day it was received back, at its net sale value;
// - a refund that isn't a return on the day it was processed, once the order
//   was delivered (a refund before delivery undoes no sale);
// - delivery income on the order's first delivery day, less refunded fees;
// - courier fees on the delivery day, failed-delivery costs on the day the
//   parcel came back, stock losses on the adjustment's day.
// The same SQL fills the tables (the nightly refresh) and answers for days
// not refreshed (today), so the two can never disagree.
import { type SQL, sql } from 'drizzle-orm';
import type { TenantTx } from '../tenant';

const day = (ts: SQL) => sql`(${ts} at time zone 'Asia/Dhaka')::date`;
const start = (date: string) => sql`(${date}::date)::timestamp at time zone 'Asia/Dhaka'`;
const end = (date: string) => sql`(${date}::date + 1)::timestamp at time zone 'Asia/Dhaka'`;

/** Delivered shipment lines in the range, each with its shares of the line's discount and VAT. */
const shipped = (from: string, to: string) => sql`
  shipped as (
    select ${day(sql`x.delivered_at`)} as day, x.order_id, x.variant_id, x.product_id, x.u,
           x.unit_price * x.u as gross,
           round(x.discount_total::numeric * (x.before + x.u) / x.q)
             - round(x.discount_total::numeric * x.before / x.q) as disc,
           round(x.vat_amount::numeric * (x.before + x.u) / x.q)
             - round(x.vat_amount::numeric * x.before / x.q) as vat,
           x.vat_included, x.cost_price
      from (
        select s.delivered_at, s.order_id, l.variant_id, l.product_id, sl.quantity as u,
               l.quantity as q, l.unit_price, l.discount_total, l.vat_amount, l.cost_price,
               o.vat_included,
               coalesce(sum(sl.quantity) over (
                 partition by sl.order_line_id order by s.delivered_at, s.id
                 rows between unbounded preceding and 1 preceding), 0) as before
          from store.shipment_lines sl
          join store.shipments s on s.id = sl.shipment_id and s.status = 'delivered'
          join store.order_lines l on l.id = sl.order_line_id
          join store.orders o on o.id = l.order_id
         where sl.order_line_id in (
           select sl2.order_line_id from store.shipment_lines sl2
             join store.shipments s2 on s2.id = sl2.shipment_id and s2.status = 'delivered'
            where s2.delivered_at >= ${start(from)} and s2.delivered_at < ${end(to)})) x
     where x.delivered_at >= ${start(from)} and x.delivered_at < ${end(to)})`;

/** Units returned and accepted in the range, at their share of the line's net value. */
const returned = (from: string, to: string) => sql`
  returned as (
    select ${day(sql`r.received_at`)} as day, l.variant_id, l.product_id, rl.quantity as u,
           round((l.line_subtotal - l.discount_total
                  - case when o.vat_included then l.vat_amount else 0 end)::numeric
                 * rl.quantity / l.quantity) as value,
           l.cost_price
      from store.return_lines rl
      join store.returns r on r.id = rl.return_id
      join store.order_lines l on l.id = rl.order_line_id
      join store.orders o on o.id = l.order_id
     where r.received_at >= ${start(from)} and r.received_at < ${end(to)}
       and r.status <> 'rejected' and r.resolution is distinct from 'rejected')`;

/** Per day and variant: the products report's rows. */
export const productFacts = (from: string, to: string) => sql`
  with ${shipped(from, to)}, ${returned(from, to)}
  select day, variant_id, (array_agg(product_id))[1] as product_id,
         sum(units)::int as units, sum(net_sales)::bigint as net_sales, sum(cogs)::bigint as cogs,
         sum(returned_units)::int as returned_units, sum(returns)::bigint as returns,
         sum(returned_cogs)::bigint as returned_cogs,
         sum(missing_cost_units)::int as missing_cost_units
    from (
      select day, variant_id, product_id, u as units,
             gross - disc - case when vat_included then vat else 0 end as net_sales,
             coalesce(cost_price, 0) * u as cogs, 0 as returned_units, 0 as returns,
             0 as returned_cogs, case when cost_price is null then u else 0 end as missing_cost_units
        from shipped
      union all
      select day, variant_id, product_id, 0, 0, 0, u, value, coalesce(cost_price, 0) * u, 0
        from returned) f
   group by day, variant_id`;

/** Per day, every day of the range (zeros included): the sales and profit reports' rows. */
export const dayFacts = (from: string, to: string) => sql`
  with ${shipped(from, to)}, ${returned(from, to)},
  days as (select generate_series(${from}::date, ${to}::date, interval '1 day')::date as day),
  sales as (
    select day, sum(u)::int as units, sum(gross) as gross_sales, sum(disc) as discounts,
           sum(gross - disc - case when vat_included then vat else 0 end) as net_sales,
           sum(vat) as vat, sum(coalesce(cost_price, 0) * u) as cogs,
           sum(case when cost_price is null then u else 0 end)::int as missing_cost_units
      from shipped group by day),
  firsts as (
    select o.id, o.delivery_fee - o.delivery_discount as delivery,
           ${day(sql`min(s.delivered_at)`)} as day
      from store.orders o join store.shipments s on s.order_id = o.id and s.status = 'delivered'
     where o.id in (select order_id from shipped)
     group by o.id),
  delivered as (
    select day, count(*)::int as orders, sum(delivery) as delivery_income
      from firsts where day between ${from}::date and ${to}::date group by day),
  returns as (
    select day, sum(u)::int as returned_units, sum(value) as returns,
           sum(coalesce(cost_price, 0) * u) as returned_cogs
      from returned group by day),
  refunds as (
    select ${day(sql`f.processed_at`)} as day,
           sum(case when f.return_id is null
                     and f.processed_at >= (select min(s.delivered_at) from store.shipments s
                                             where s.order_id = f.order_id and s.status = 'delivered')
                    then f.amount - f.delivery_amount else 0 end) as goodwill,
           sum(f.delivery_amount) as delivery_refunded
      from store.refunds f
     where f.status = 'succeeded' and f.processed_at >= ${start(from)} and f.processed_at < ${end(to)}
     group by 1),
  couriers as (
    select ${day(sql`delivered_at`)} as day, sum(coalesce(courier_fee, 0)) as fees
      from store.shipments
     where status = 'delivered' and delivered_at >= ${start(from)} and delivered_at < ${end(to)}
     group by 1),
  failed as (
    select ${day(sql`returned_at`)} as day, sum(return_cost) as costs
      from store.shipments
     where return_cost is not null and returned_at >= ${start(from)} and returned_at < ${end(to)}
     group by 1),
  losses as (
    select ${day(sql`created_at`)} as day, -sum(quantity * coalesce(unit_cost, 0)) as losses
      from store.stock_movements
     where type = 'adjustment' and reason in ('damaged', 'lost', 'expired', 'sample', 'count')
       and created_at >= ${start(from)} and created_at < ${end(to)}
     group by 1)
  select d.day,
         coalesce(dl.orders, 0) as orders_delivered, coalesce(s.units, 0) as units,
         coalesce(s.gross_sales, 0)::bigint as gross_sales, coalesce(s.discounts, 0)::bigint as discounts,
         coalesce(s.net_sales, 0)::bigint as net_sales, coalesce(s.vat, 0)::bigint as vat,
         (coalesce(dl.delivery_income, 0) - coalesce(rf.delivery_refunded, 0))::bigint as delivery_income,
         coalesce(c.fees, 0)::bigint as courier_fees,
         coalesce(fd.costs, 0)::bigint as failed_delivery_costs,
         coalesce(r.returned_units, 0) as returned_units,
         (coalesce(r.returns, 0) + coalesce(rf.goodwill, 0))::bigint as returns,
         coalesce(s.cogs, 0)::bigint as cogs, coalesce(r.returned_cogs, 0)::bigint as returned_cogs,
         coalesce(s.missing_cost_units, 0) as missing_cost_units,
         coalesce(ls.losses, 0)::bigint as stock_losses
    from days d
    left join sales s on s.day = d.day
    left join delivered dl on dl.day = d.day
    left join returns r on r.day = d.day
    left join refunds rf on rf.day = d.day
    left join couriers c on c.day = d.day
    left join failed fd on fd.day = d.day
    left join losses ls on ls.day = d.day
   order by d.day`;

const DAY_COLUMNS = sql.raw(`day, orders_delivered, units, gross_sales, discounts, net_sales, vat,
  delivery_income, courier_fees, failed_delivery_costs, returned_units, returns, cogs,
  returned_cogs, missing_cost_units, stock_losses`);
const PRODUCT_COLUMNS = sql.raw(`day, variant_id, product_id, units, net_sales, cogs,
  returned_units, returns, returned_cogs, missing_cost_units`);

/**
 * Rewrites the summaries of `from` to `to` (Dhaka dates, inclusive) in the
 * transaction's store (§3.9): the nightly refresh's last 7 days, or a whole
 * history in the backfill.
 */
export async function refreshSummaries(tx: TenantTx, from: string, to: string): Promise<void> {
  await tx.db.execute(
    sql`delete from store.daily_sales where day between ${from}::date and ${to}::date`,
  );
  await tx.db.execute(
    sql`delete from store.daily_product_sales where day between ${from}::date and ${to}::date`,
  );
  await tx.db.execute(
    sql`insert into store.daily_sales (${DAY_COLUMNS}) select ${DAY_COLUMNS} from (${dayFacts(from, to)}) f`,
  );
  await tx.db.execute(
    sql`insert into store.daily_product_sales (${PRODUCT_COLUMNS})
        select ${PRODUCT_COLUMNS} from (${productFacts(from, to)}) f`,
  );
}

/** The month's last day, for YYYY-MM-DD in it. */
export function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Stock at the end of `month` (its last day), per variant and location, at
 * the cost then (§3.9): on hand now less the movements since, and the cost
 * before the first change since, else the cost now. Rewrites that month.
 */
export async function writeMonthEndValues(tx: TenantTx, month: string): Promise<number> {
  const last = monthEnd(month);
  const boundary = end(last);
  await tx.db.execute(sql`delete from store.monthly_stock_values where month = ${last}::date`);
  const { rowCount } = await tx.db.execute(sql`
    insert into store.monthly_stock_values (month, variant_id, location_id, on_hand, unit_cost, value)
    select ${last}::date, x.variant_id, x.location_id, x.on_hand, x.cost,
           greatest(x.on_hand, 0) * coalesce(x.cost, 0)
      from (
        select l.variant_id, l.location_id,
               (l.on_hand - coalesce((
                  select sum(m.quantity) from store.stock_movements m
                   where m.variant_id = l.variant_id and m.location_id = l.location_id
                     and m.type in ('receive', 'return', 'adjustment', 'sale')
                     and m.created_at >= ${boundary}), 0))::int as on_hand,
               coalesce(
                 (select c.old_cost from store.cost_changes c
                   where c.variant_id = l.variant_id and c.created_at >= ${boundary}
                   order by c.created_at, c.id limit 1),
                 case when exists (select 1 from store.cost_changes c
                                    where c.variant_id = l.variant_id and c.created_at >= ${boundary})
                      then null else v.cost_price end) as cost
          from store.inventory_levels l join store.variants v on v.id = l.variant_id) x
     where x.on_hand <> 0`);
  return rowCount ?? 0;
}

const shiftDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Older days whose shipments or refunds changed since yesterday (a courier's fee, sent late). */
async function changedDays(tx: TenantTx, before: string): Promise<string[]> {
  const { rows } = await tx.db.execute<{ day: string }>(sql`
    select distinct d::text as day from (
      select ${day(sql`delivered_at`)} as d from store.shipments
       where updated_at >= now() - interval '1 day' and delivered_at is not null
      union
      select ${day(sql`returned_at`)} from store.shipments
       where updated_at >= now() - interval '1 day' and returned_at is not null
      union
      select ${day(sql`processed_at`)} from store.refunds
       where updated_at >= now() - interval '1 day' and processed_at is not null) x
     where d < ${before}::date
     order by 1`);
  return rows.map((r) => r.day);
}

/**
 * The daily batch's refresh for one store (§3.9): the 7 days before `on`,
 * any older day a late change touched, and on the 1st the month just ended.
 */
export async function refreshStoreReports(tx: TenantTx, on: string): Promise<{ days: number }> {
  const from = shiftDays(on, -7);
  const to = shiftDays(on, -1);
  const older = await changedDays(tx, from);
  for (const d of older) await refreshSummaries(tx, d, d);
  await refreshSummaries(tx, from, to);
  if (on.endsWith('-01')) await writeMonthEndValues(tx, to);
  return { days: 7 + older.length };
}
