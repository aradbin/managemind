// The back office's reports (phase-8-plan §3.8, §3.9): sales by day, week
// or month; sales, cost and profit by product; and the profit statement
// beside the period before. Past days come from the summary tables, and any
// day without its summary row (today, or a store not backfilled yet) is
// computed live by the same SQL. Costs and profit need catalog.cost.
import { AppError } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, authorize } from '../access';
import { parseInput } from '../catalog/common';
import { requireBackOffice, today } from '../purchasing/common';
import { type Localized, variantLabels } from '../purchasing/variants';
import type { TenantTx } from '../tenant';
import { dayFacts, productFacts } from './summaries';

const DAY_MS = 86_400_000;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

export const backOfficeReportQuery = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .strict()
  .refine((q) => q.from <= q.to, { message: 'from is after to', path: ['from'] })
  .refine((q) => daysBetween(q.from, q.to) < 731, { message: 'at most two years', path: ['to'] });

export interface DayRow {
  day: string;
  ordersDelivered: number;
  units: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  vat: number;
  deliveryIncome: number;
  courierFees: number;
  failedDeliveryCosts: number;
  returnedUnits: number;
  returns: number;
  cogs: number;
  returnedCogs: number;
  missingCostUnits: number;
  stockLosses: number;
}

type RawDay = Record<string, string | number>;
const toDay = (r: RawDay): DayRow => ({
  day:
    typeof r.day === 'string'
      ? r.day.slice(0, 10)
      : new Date(r.day as number).toISOString().slice(0, 10),
  ordersDelivered: Number(r.orders_delivered),
  units: Number(r.units),
  grossSales: Number(r.gross_sales),
  discounts: Number(r.discounts),
  netSales: Number(r.net_sales),
  vat: Number(r.vat),
  deliveryIncome: Number(r.delivery_income),
  courierFees: Number(r.courier_fees),
  failedDeliveryCosts: Number(r.failed_delivery_costs),
  returnedUnits: Number(r.returned_units),
  returns: Number(r.returns),
  cogs: Number(r.cogs),
  returnedCogs: Number(r.returned_cogs),
  missingCostUnits: Number(r.missing_cost_units),
  stockLosses: Number(r.stock_losses),
});

/** The days of the range that have no summary row: today, and any day not refreshed. */
async function missingDays(tx: TenantTx, from: string, to: string): Promise<string[]> {
  const { rows } = await tx.db.execute<{ day: string }>(sql`
    select d::date::text as day from generate_series(${from}::date, ${to}::date, interval '1 day') d
     where d::date >= ${today()}::date
        or not exists (select 1 from store.daily_sales s where s.day = d::date)`);
  return rows.map((r) => r.day);
}

/**
 * Each day's facts for the range: summary rows where they exist, computed
 * live for the rest. `live` computes every day, for the equality test.
 */
export async function dailyFacts(
  tx: TenantTx,
  from: string,
  to: string,
  options: { live?: boolean } = {},
): Promise<DayRow[]> {
  if (options.live) {
    const { rows } = await tx.db.execute<RawDay>(dayFacts(from, to));
    return rows.map(toDay);
  }
  const missing = new Set(await missingDays(tx, from, to));
  const { rows: stored } = await tx.db.execute<RawDay>(sql`
    select day::text, orders_delivered, units, gross_sales, discounts, net_sales, vat, delivery_income,
           courier_fees, failed_delivery_costs, returned_units, returns, cogs, returned_cogs,
           missing_cost_units, stock_losses
      from store.daily_sales where day between ${from}::date and ${to}::date`);
  const out = stored.map(toDay).filter((d) => !missing.has(d.day));
  if (missing.size) {
    const list = [...missing].sort();
    const { rows } = await tx.db.execute<RawDay>(
      dayFacts(list[0] as string, list[list.length - 1] as string),
    );
    out.push(...rows.map(toDay).filter((d) => missing.has(d.day)));
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : 1));
}

export interface ProductRow {
  variantId: string;
  productId: string;
  units: number;
  netSales: number;
  cogs: number;
  returnedUnits: number;
  returns: number;
  returnedCogs: number;
  missingCostUnits: number;
}

/** Per variant over the range, summary rows and live days alike. */
export async function productTotals(
  tx: TenantTx,
  from: string,
  to: string,
  options: { live?: boolean } = {},
): Promise<ProductRow[]> {
  const missing = options.live ? null : await missingDays(tx, from, to);
  const parts = [];
  if (missing === null) {
    parts.push(sql`select * from (${productFacts(from, to)}) live`);
  } else {
    parts.push(sql`
      select day, variant_id, product_id, units, net_sales, cogs, returned_units, returns,
             returned_cogs, missing_cost_units
        from store.daily_product_sales
       where day between ${from}::date and ${to}::date
         and not (day = any(${sql.param(missing)}::date[]))`);
    if (missing.length) {
      parts.push(sql`
        select * from (${productFacts(missing[0] as string, missing[missing.length - 1] as string)}) live
         where day = any(${sql.param(missing)}::date[])`);
    }
  }
  const { rows } = await tx.db.execute<Record<string, string | number>>(sql`
    select variant_id, (array_agg(product_id))[1] as product_id,
           sum(units)::int as units, sum(net_sales)::bigint as net_sales, sum(cogs)::bigint as cogs,
           sum(returned_units)::int as returned_units, sum(returns)::bigint as returns,
           sum(returned_cogs)::bigint as returned_cogs, sum(missing_cost_units)::int as missing_cost_units
      from (${sql.join(parts, sql` union all `)}) f
     group by variant_id`);
  return rows.map((r) => ({
    variantId: String(r.variant_id),
    productId: String(r.product_id),
    units: Number(r.units),
    netSales: Number(r.net_sales),
    cogs: Number(r.cogs),
    returnedUnits: Number(r.returned_units),
    returns: Number(r.returns),
    returnedCogs: Number(r.returned_cogs),
    missingCostUnits: Number(r.missing_cost_units),
  }));
}

// ---- The sales report (§3.8) -------------------------------------------------------------

export const salesReportQuery = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    by: z.enum(['day', 'week', 'month']).default('day'),
  })
  .strict();

export interface SalesBucket {
  /** The bucket's first day: the day, the week's Monday, or the month's 1st. */
  start: string;
  ordersDelivered: number;
  units: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  returnedUnits: number;
  returns: number;
  deliveryIncome: number;
}

const bucketOf = (date: string, by: 'day' | 'week' | 'month') => {
  if (by === 'day') return date;
  if (by === 'month') return `${date.slice(0, 7)}-01`;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return addDays(date, 1 - weekday);
};

const SALES_FIELDS = [
  'ordersDelivered',
  'units',
  'grossSales',
  'discounts',
  'netSales',
  'returnedUnits',
  'returns',
  'deliveryIncome',
] as const;

/** GET /reports/sales: delivered sales by day, week or month (reports.read). */
export async function salesReport(
  tx: TenantTx,
  actor: Actor,
  query: unknown,
): Promise<{
  from: string;
  to: string;
  by: 'day' | 'week' | 'month';
  buckets: SalesBucket[];
  totals: Omit<SalesBucket, 'start'>;
}> {
  authorize(actor, 'reports.read');
  await requireBackOffice(tx);
  const q = parseInput(salesReportQuery, query);
  parseInput(backOfficeReportQuery, { from: q.from, to: q.to });
  const days = await dailyFacts(tx, q.from, q.to);
  const buckets = new Map<string, SalesBucket>();
  const zero = () =>
    Object.fromEntries(SALES_FIELDS.map((f) => [f, 0])) as Omit<SalesBucket, 'start'>;
  const totals = zero();
  for (const d of days) {
    const key = bucketOf(d.day, q.by);
    const b = buckets.get(key) ?? { start: key, ...zero() };
    for (const f of SALES_FIELDS) {
      b[f] += d[f];
      totals[f] += d[f];
    }
    buckets.set(key, b);
  }
  return { from: q.from, to: q.to, by: q.by, buckets: [...buckets.values()], totals };
}

// ---- Products (§3.8) ---------------------------------------------------------------------

export interface ProductReportRow {
  variantId: string;
  productId: string;
  title: Localized;
  optionLabels: Localized[];
  sku: string | null;
  units: number;
  returnedUnits: number;
  netSales: number;
  returns: number;
  // With catalog.cost only.
  cogs?: number;
  grossProfit?: number;
  /** Basis points of net sales after returns; null without sales. */
  marginBp?: number | null;
  missingCostUnits?: number;
}

/** GET /reports/products: per variant, best sellers first (reports.read; costs with catalog.cost). */
export async function productsReport(
  tx: TenantTx,
  actor: Actor,
  query: unknown,
): Promise<{ from: string; to: string; items: ProductReportRow[] }> {
  authorize(actor, 'reports.read');
  await requireBackOffice(tx);
  const q = parseInput(backOfficeReportQuery, query);
  const rows = await productTotals(tx, q.from, q.to);
  const labels = await variantLabels(
    tx,
    rows.map((r) => r.variantId),
  );
  const cost = actor.permissions.has('catalog.cost');
  const items = rows
    .map((r) => {
      const label = labels.get(r.variantId);
      const sales = r.netSales - r.returns;
      const profit = sales - (r.cogs - r.returnedCogs);
      return {
        variantId: r.variantId,
        productId: r.productId,
        title: label?.title ?? {},
        optionLabels: label?.optionLabels ?? [],
        sku: label?.sku ?? null,
        units: r.units,
        returnedUnits: r.returnedUnits,
        netSales: r.netSales,
        returns: r.returns,
        ...(cost
          ? {
              cogs: r.cogs - r.returnedCogs,
              grossProfit: profit,
              marginBp: sales > 0 ? Math.round((profit * 10_000) / sales) : null,
              missingCostUnits: r.missingCostUnits,
            }
          : {}),
      };
    })
    .sort((a, b) => b.netSales - a.netSales || b.units - a.units);
  return { from: q.from, to: q.to, items };
}

// ---- The profit statement (§3.8) ---------------------------------------------------------

export interface ProfitStatement {
  from: string;
  to: string;
  netSales: number;
  returns: number;
  /** Cost of what was delivered, less what came back. */
  cogs: number;
  grossProfit: number;
  deliveryIncome: number;
  courierFees: number;
  failedDeliveryCosts: number;
  deliveryResult: number;
  stockLosses: number;
  expenses: number;
  expensesByCategory: { categoryId: string; name: { bn: string; en: string }; amount: number }[];
  netProfit: number;
  /** Delivered units sold without a cost: profit is overstated by them (§3.8). */
  missingCostUnits: number;
  ordersDelivered: number;
  vat: number;
  grossSales: number;
  discounts: number;
}

async function statement(tx: TenantTx, from: string, to: string): Promise<ProfitStatement> {
  const days = await dailyFacts(tx, from, to);
  const sum = (f: keyof DayRow) => days.reduce((a, d) => a + (d[f] as number), 0);
  const { rows: spent } = await tx.db.execute<{
    category_id: string;
    name: { bn: string; en: string };
    amount: string;
  }>(sql`
    select e.category_id, c.name, sum(e.amount) as amount
      from store.expenses e join store.expense_categories c on c.id = e.category_id
     where e.spent_on between ${from}::date and ${to}::date
     group by e.category_id, c.name
     order by sum(e.amount) desc`);
  const expensesByCategory = spent.map((r) => ({
    categoryId: r.category_id,
    name: r.name,
    amount: Number(r.amount),
  }));
  const expenses = expensesByCategory.reduce((a, c) => a + c.amount, 0);
  const netSales = sum('netSales');
  const returns = sum('returns');
  const cogs = sum('cogs') - sum('returnedCogs');
  const grossProfit = netSales - returns - cogs;
  const deliveryIncome = sum('deliveryIncome');
  const courierFees = sum('courierFees');
  const failedDeliveryCosts = sum('failedDeliveryCosts');
  const deliveryResult = deliveryIncome - courierFees - failedDeliveryCosts;
  const stockLosses = sum('stockLosses');
  return {
    from,
    to,
    netSales,
    returns,
    cogs,
    grossProfit,
    deliveryIncome,
    courierFees,
    failedDeliveryCosts,
    deliveryResult,
    stockLosses,
    expenses,
    expensesByCategory,
    netProfit: grossProfit + deliveryResult - stockLosses - expenses,
    missingCostUnits: sum('missingCostUnits'),
    ordersDelivered: sum('ordersDelivered'),
    vat: sum('vat'),
    grossSales: sum('grossSales'),
    discounts: sum('discounts'),
  };
}

/**
 * GET /reports/profit: the statement for the range and for the same number
 * of days before it (reports.read and catalog.cost).
 */
export async function profitReport(
  tx: TenantTx,
  actor: Actor,
  query: unknown,
): Promise<{ current: ProfitStatement; previous: ProfitStatement }> {
  authorize(actor, 'reports.read');
  if (!actor.permissions.has('catalog.cost')) {
    throw new AppError('forbidden', { detail: 'profit needs the cost permission' });
  }
  await requireBackOffice(tx);
  const q = parseInput(backOfficeReportQuery, query);
  const length = daysBetween(q.from, q.to) + 1;
  const previousTo = addDays(q.from, -1);
  return {
    current: await statement(tx, q.from, q.to),
    previous: await statement(tx, addDays(previousTo, 1 - length), previousTo),
  };
}

// ---- Per order and on the dashboard (§3.8, §3.12) ------------------------------------------

export interface OrderProfit {
  /** Delivered net sales less returns and the cost of what stayed sold; null before delivery. */
  grossProfit: number | null;
  /** Delivered units without a cost: the profit is overstated. */
  missingCostUnits: number;
}

/**
 * Gross profit for the orders on a list page, by the definitions the
 * reports use (shares rounded the same way, so an order's figures add up to
 * its days'). Callers check catalog.cost.
 */
export async function orderProfits(
  tx: TenantTx,
  orderIds: readonly string[],
): Promise<Map<string, OrderProfit>> {
  if (!orderIds.length) return new Map();
  const { rows } = await tx.db.execute<{
    order_id: string;
    delivered: number;
    profit: string;
    missing: number;
  }>(sql`
    with lines as (
      select l.order_id, l.quantity as q, l.unit_price, l.discount_total, l.cost_price,
             case when o.vat_included then l.vat_amount else 0 end as vat,
             l.line_subtotal - l.discount_total - case when o.vat_included then l.vat_amount else 0 end as net,
             coalesce((select sum(sl.quantity) from store.shipment_lines sl
                         join store.shipments s on s.id = sl.shipment_id and s.status = 'delivered'
                        where sl.order_line_id = l.id), 0) as u,
             coalesce((select sum(rl.quantity) from store.return_lines rl
                         join store.returns r on r.id = rl.return_id
                        where rl.order_line_id = l.id and r.received_at is not null
                          and r.status <> 'rejected' and r.resolution is distinct from 'rejected'), 0) as ru,
             (select coalesce(sum(round((l.line_subtotal - l.discount_total
                       - case when o.vat_included then l.vat_amount else 0 end)::numeric * rl.quantity / l.quantity)), 0)
                from store.return_lines rl join store.returns r on r.id = rl.return_id
               where rl.order_line_id = l.id and r.received_at is not null
                 and r.status <> 'rejected' and r.resolution is distinct from 'rejected') as returned_value
        from store.order_lines l join store.orders o on o.id = l.order_id
       where l.order_id = any(${sql.param([...orderIds])}::uuid[]))
    select order_id, sum(u)::int as delivered,
           (sum(unit_price * u - round(discount_total::numeric * u / q) - round(vat::numeric * u / q)
                - returned_value - coalesce(cost_price, 0) * (u - ru))
            - coalesce((select sum(f.amount - f.delivery_amount) from store.refunds f
                         where f.order_id = lines.order_id and f.return_id is null and f.status = 'succeeded'
                           and f.processed_at >= (select min(s.delivered_at) from store.shipments s
                                                   where s.order_id = lines.order_id and s.status = 'delivered')), 0)
           )::bigint as profit,
           sum(case when cost_price is null then u else 0 end)::int as missing
      from lines group by order_id`);
  return new Map(
    rows.map((r) => [
      r.order_id,
      {
        grossProfit: r.delivered > 0 ? Number(r.profit) : null,
        missingCostUnits: Number(r.missing),
      },
    ]),
  );
}

/** The dashboard's month so far (§3.12): gross profit, expenses and net profit. */
export async function monthToDateProfit(
  tx: TenantTx,
  on = today(),
): Promise<Pick<ProfitStatement, 'grossProfit' | 'expenses' | 'netProfit' | 'missingCostUnits'>> {
  const s = await statement(tx, `${on.slice(0, 8)}01`, on);
  return {
    grossProfit: s.grossProfit,
    expenses: s.expenses,
    netProfit: s.netProfit,
    missingCostUnits: s.missingCostUnits,
  };
}
