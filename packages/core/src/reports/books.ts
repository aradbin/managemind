// The back office's other reports (phase-8-plan §3.8): what the stock is
// worth today or at a past month's end, slow movers, supplier dues and
// purchases, expenses by category and month, and the COD that couriers and
// the store's own riders still hold.
import { AppError } from '@managemind/shared';
import { AGEING_BUCKETS, type AgeingBucket } from '@managemind/shared/back-office';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, authorize } from '../access';
import { parseInput } from '../catalog/common';
import { requireBackOffice, today } from '../purchasing/common';
import { type SupplierDue, supplierDues } from '../purchasing/suppliers';
import { type Localized, variantLabels } from '../purchasing/variants';
import type { TenantTx } from '../tenant';
import { backOfficeReportQuery } from './back-office';
import { monthEnd } from './summaries';

const n = (v: unknown) => Number(v ?? 0);

function requireCostReport(actor: Actor): void {
  authorize(actor, 'reports.read');
  if (!actor.permissions.has('catalog.cost')) {
    throw new AppError('forbidden', { detail: 'stock values need the cost permission' });
  }
}

// ---- Stock valuation (§3.8, §3.9) ----------------------------------------------------------

export const stockValuationQuery = z
  .object({
    /** A past month (YYYY-MM): its month-end values. Today when left out. */
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
  })
  .strict();

export interface ValuationRow {
  variantId: string;
  productId: string;
  title: Localized;
  optionLabels: Localized[];
  sku: string | null;
  locationId: string;
  location: string;
  categoryId: string | null;
  category: Localized | null;
  onHand: number;
  unitCost: number | null;
  value: number;
}

export interface Valuation {
  /** The day the figures are for: today, or the month's last day. */
  asOf: string;
  month: string | null;
  /** On hand above zero (§3.8). */
  items: ValuationRow[];
  /** Below zero (backorders), listed apart and never netted. */
  negative: ValuationRow[];
  byLocation: { locationId: string; location: string; units: number; value: number }[];
  byCategory: {
    categoryId: string | null;
    category: Localized | null;
    units: number;
    value: number;
  }[];
  totals: { units: number; value: number; missingCostUnits: number };
  /** Month ends with stored values, newest first. */
  months: string[];
}

/** GET /reports/stock: valuation today or at a past month's end (reports.read, catalog.cost). */
export async function stockValuation(
  tx: TenantTx,
  actor: Actor,
  query: unknown,
): Promise<Valuation> {
  requireCostReport(actor);
  await requireBackOffice(tx);
  const q = parseInput(stockValuationQuery, query);
  const asOf = q.month ? monthEnd(`${q.month}-01`) : today();
  const source = q.month
    ? sql`select variant_id, location_id, on_hand, unit_cost from store.monthly_stock_values
           where month = ${asOf}::date`
    : sql`select l.variant_id, l.location_id, l.on_hand, v.cost_price as unit_cost
            from store.inventory_levels l join store.variants v on v.id = l.variant_id
           where l.on_hand <> 0`;
  const { rows } = await tx.db.execute<{
    variant_id: string;
    location_id: string;
    on_hand: number;
    unit_cost: string | null;
    location: string;
    category_id: string | null;
    category: Localized | null;
  }>(sql`
    select x.variant_id, x.location_id, x.on_hand, x.unit_cost, sl.name as location,
           c.id as category_id,
           (select json_object_agg(ct.locale, ct.name) from store.category_translations ct
             where ct.category_id = c.id) as category
      from (${source}) x
      join store.stock_locations sl on sl.id = x.location_id
      join store.variants v on v.id = x.variant_id
      left join lateral (
        -- A product in several categories counts under its first: the shallowest, then by position.
        select c.id from store.product_categories pc join store.categories c on c.id = pc.category_id
         where pc.product_id = v.product_id order by c.depth, c.position, c.id limit 1) c on true`);
  const labels = await variantLabels(
    tx,
    rows.map((r) => r.variant_id),
  );
  const all = rows.map((r): ValuationRow => {
    const label = labels.get(r.variant_id);
    const unitCost = r.unit_cost === null ? null : n(r.unit_cost);
    const onHand = n(r.on_hand);
    return {
      variantId: r.variant_id,
      productId: label?.productId ?? '',
      title: label?.title ?? {},
      optionLabels: label?.optionLabels ?? [],
      sku: label?.sku ?? null,
      locationId: r.location_id,
      location: r.location,
      categoryId: r.category_id,
      category: r.category,
      onHand,
      unitCost,
      value: onHand > 0 ? onHand * (unitCost ?? 0) : 0,
    };
  });
  const items = all.filter((r) => r.onHand > 0).sort((a, b) => b.value - a.value);
  const negative = all.filter((r) => r.onHand < 0);
  const group = <K extends string | null>(key: (r: ValuationRow) => K) => {
    const m = new Map<K, { units: number; value: number; first: ValuationRow }>();
    for (const r of items) {
      const g = m.get(key(r)) ?? { units: 0, value: 0, first: r };
      g.units += r.onHand;
      g.value += r.value;
      m.set(key(r), g);
    }
    return [...m.values()].sort((a, b) => b.value - a.value);
  };
  const { rows: months } = await tx.db.execute<{ month: string }>(sql`
    select distinct month::text as month from store.monthly_stock_values order by 1 desc limit 36`);
  return {
    asOf,
    month: q.month ?? null,
    items,
    negative,
    byLocation: group((r) => r.locationId).map((g) => ({
      locationId: g.first.locationId,
      location: g.first.location,
      units: g.units,
      value: g.value,
    })),
    byCategory: group((r) => r.categoryId).map((g) => ({
      categoryId: g.first.categoryId,
      category: g.first.category,
      units: g.units,
      value: g.value,
    })),
    totals: {
      units: items.reduce((a, r) => a + r.onHand, 0),
      value: items.reduce((a, r) => a + r.value, 0),
      missingCostUnits: items.reduce((a, r) => a + (r.unitCost === null ? r.onHand : 0), 0),
    },
    months: months.map((m) => m.month),
  };
}

// ---- Slow movers (§3.8) --------------------------------------------------------------------

export const slowMoversQuery = z
  .object({ days: z.coerce.number().int().min(7).max(365).default(60) })
  .strict();

export interface SlowMover {
  variantId: string;
  productId: string;
  title: Localized;
  optionLabels: Localized[];
  sku: string | null;
  onHand: number;
  /** The last sale's shipment, or null when it never sold. */
  lastSoldAt: string | null;
  /** With catalog.cost only. */
  value?: number;
}

/** GET /reports/slow-movers: on hand, with no sale in `days` (reports.read; values with catalog.cost). */
export async function slowMovers(
  tx: TenantTx,
  actor: Actor,
  query: unknown,
): Promise<{ days: number; items: SlowMover[] }> {
  authorize(actor, 'reports.read');
  await requireBackOffice(tx);
  const q = parseInput(slowMoversQuery, query);
  const { rows } = await tx.db.execute<{
    variant_id: string;
    on_hand: number;
    cost: string | null;
    last_sold: string | null;
  }>(sql`
    select v.id as variant_id, s.on_hand, v.cost_price as cost,
           (select max(m.created_at) from store.stock_movements m
             where m.variant_id = v.id and m.type = 'sale') as last_sold
      from store.variants v
      join store.products p on p.id = v.product_id
      join lateral (select sum(l.on_hand)::int as on_hand from store.inventory_levels l
                     where l.variant_id = v.id) s on true
     where s.on_hand > 0 and v.archived_at is null and p.status <> 'archived'
       and not exists (select 1 from store.stock_movements m
                        where m.variant_id = v.id and m.type = 'sale'
                          and m.created_at >= now() - make_interval(days => ${q.days}))
     order by s.on_hand * coalesce(v.cost_price, 0) desc, s.on_hand desc
     limit 500`);
  const labels = await variantLabels(
    tx,
    rows.map((r) => r.variant_id),
  );
  const cost = actor.permissions.has('catalog.cost');
  return {
    days: q.days,
    items: rows.map((r) => {
      const label = labels.get(r.variant_id);
      return {
        variantId: r.variant_id,
        productId: label?.productId ?? '',
        title: label?.title ?? {},
        optionLabels: label?.optionLabels ?? [],
        sku: label?.sku ?? null,
        onHand: n(r.on_hand),
        lastSoldAt: r.last_sold ? new Date(r.last_sold).toISOString() : null,
        ...(cost ? { value: n(r.on_hand) * n(r.cost) } : {}),
      };
    }),
  };
}

// ---- Suppliers (§3.7, §3.8) ----------------------------------------------------------------

export interface SupplierReport {
  from: string;
  to: string;
  dues: SupplierDue[];
  duesTotal: { balance: number; buckets: Record<AgeingBucket, number> };
  /** Received and paid in the range, per supplier; null for receipts without one. */
  purchases: {
    supplierId: string | null;
    name: string | null;
    receipts: number;
    received: number;
    paid: number;
  }[];
}

/** GET /reports/suppliers: balances and ageing today, purchases in the range (reports.read, purchasing.pay). */
export async function supplierReport(
  tx: TenantTx,
  actor: Actor,
  query: unknown,
): Promise<SupplierReport> {
  authorize(actor, 'reports.read');
  const q = parseInput(backOfficeReportQuery, query);
  const dues = await supplierDues(tx, actor);
  const buckets = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])) as Record<
    AgeingBucket,
    number
  >;
  for (const d of dues) for (const b of AGEING_BUCKETS) buckets[b] += d.buckets[b];
  const { rows } = await tx.db.execute<{
    supplier_id: string | null;
    name: string | null;
    receipts: number;
    received: string;
    paid: string;
  }>(sql`
    with r as (
      select supplier_id, count(*)::int as receipts, sum(total) as received
        from store.goods_receipts where received_on between ${q.from}::date and ${q.to}::date
       group by supplier_id),
    p as (
      select supplier_id, sum(amount) as paid from store.supplier_payments
       where paid_on between ${q.from}::date and ${q.to}::date group by supplier_id)
    select k.supplier_id, s.name,
           coalesce(r.receipts, 0) as receipts, coalesce(r.received, 0) as received,
           coalesce(p.paid, 0) as paid
      from (select supplier_id from r union select supplier_id from p) k
      left join r on r.supplier_id is not distinct from k.supplier_id
      left join p on p.supplier_id is not distinct from k.supplier_id
      left join store.suppliers s on s.id = k.supplier_id
     order by coalesce(r.received, 0) desc, s.name`);
  return {
    from: q.from,
    to: q.to,
    dues,
    duesTotal: { balance: dues.reduce((a, d) => a + d.balance, 0), buckets },
    purchases: rows.map((r) => ({
      supplierId: r.supplier_id,
      name: r.name,
      receipts: n(r.receipts),
      received: n(r.received),
      paid: n(r.paid),
    })),
  };
}

// ---- Expenses (§3.6, §3.8) -----------------------------------------------------------------

export interface ExpenseReport {
  from: string;
  to: string;
  /** Each month of the range (YYYY-MM), oldest first. */
  months: string[];
  categories: {
    categoryId: string;
    name: { bn: string; en: string };
    /** Per month, in the order of `months`. */
    amounts: number[];
    total: number;
  }[];
  monthTotals: number[];
  total: number;
}

/** GET /reports/expenses: by category and month (reports.read, expenses.read). */
export async function expenseReport(
  tx: TenantTx,
  actor: Actor,
  query: unknown,
): Promise<ExpenseReport> {
  authorize(actor, 'reports.read');
  authorize(actor, 'expenses.read');
  await requireBackOffice(tx);
  const q = parseInput(backOfficeReportQuery, query);
  const { rows } = await tx.db.execute<{
    month: string;
    category_id: string;
    name: { bn: string; en: string };
    position: number;
    amount: string;
  }>(sql`
    select to_char(e.spent_on, 'YYYY-MM') as month, e.category_id, c.name, c.position,
           sum(e.amount) as amount
      from store.expenses e join store.expense_categories c on c.id = e.category_id
     where e.spent_on between ${q.from}::date and ${q.to}::date
     group by 1, 2, 3, 4`);
  const months: string[] = [];
  for (let m = q.from.slice(0, 7); m <= q.to.slice(0, 7); ) {
    months.push(m);
    const [y, mm] = m.split('-').map(Number) as [number, number];
    m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
  }
  const index = new Map(months.map((m, i) => [m, i]));
  const byCategory = new Map<string, ExpenseReport['categories'][number] & { position: number }>();
  for (const r of rows) {
    const c = byCategory.get(r.category_id) ?? {
      categoryId: r.category_id,
      name: r.name,
      position: r.position,
      amounts: months.map(() => 0),
      total: 0,
    };
    const amount = n(r.amount);
    const i = index.get(r.month) ?? 0;
    c.amounts[i] = (c.amounts[i] ?? 0) + amount;
    c.total += amount;
    byCategory.set(r.category_id, c);
  }
  const categories = [...byCategory.values()]
    .sort((a, b) => b.total - a.total || a.position - b.position)
    .map(({ position: _position, ...c }) => c);
  const monthTotals = months.map((_, i) => categories.reduce((a, c) => a + (c.amounts[i] ?? 0), 0));
  return {
    from: q.from,
    to: q.to,
    months,
    categories,
    monthTotals,
    total: monthTotals.reduce((a, v) => a + v, 0),
  };
}

// ---- COD outstanding (§3.8; Phase 7's reconciliation) --------------------------------------

export const COD_AGE_BUCKETS = ['0_7', '8_14', '15_30', 'over_30'] as const;
export type CodAgeBucket = (typeof COD_AGE_BUCKETS)[number];
const codBucket = (days: number): CodAgeBucket =>
  days <= 7 ? '0_7' : days <= 14 ? '8_14' : days <= 30 ? '15_30' : 'over_30';

export interface CodOutstanding {
  /** Per courier, and `null` for the store's own riders. */
  holders: {
    courier: string | null;
    parcels: number;
    amount: number;
    buckets: Record<CodAgeBucket, number>;
    oldestDays: number;
  }[];
  total: number;
}

/**
 * GET /reports/cod-outstanding: delivered COD a courier hasn't paid out yet
 * (net of its fee), and COD the store's own riders delivered but nobody
 * marked as paid, aged by delivery day (reports.read).
 */
export async function codOutstanding(
  tx: TenantTx,
  actor: Actor,
  on = today(),
): Promise<CodOutstanding> {
  authorize(actor, 'reports.read');
  await requireBackOffice(tx);
  const { rows } = await tx.db.execute<{
    courier: string | null;
    amount: string;
    days: number;
  }>(sql`
    select s.courier,
           coalesce(s.cod_collected, s.cod_amount, 0) - coalesce(s.courier_fee, 0) as amount,
           (${on}::date - (s.delivered_at at time zone 'Asia/Dhaka')::date)::int as days
      from store.shipments s
     where s.courier is not null and s.status = 'delivered' and coalesce(s.cod_amount, 0) > 0
       and not exists (select 1 from store.courier_payout_lines l where l.shipment_id = s.id)
    union all
    select null, sum(p.amount),
           (${on}::date - (min(s.delivered_at) at time zone 'Asia/Dhaka')::date)::int
      from store.payments p
      join store.shipments s on s.order_id = p.order_id and s.status = 'delivered' and s.courier is null
     where p.provider = 'cod' and p.status = 'pending'
       and not exists (select 1 from store.shipments c where c.order_id = p.order_id and c.courier is not null)
     group by p.order_id`);
  const holders = new Map<string | null, CodOutstanding['holders'][number]>();
  for (const r of rows) {
    const h = holders.get(r.courier) ?? {
      courier: r.courier,
      parcels: 0,
      amount: 0,
      buckets: Object.fromEntries(COD_AGE_BUCKETS.map((b) => [b, 0])) as Record<
        CodAgeBucket,
        number
      >,
      oldestDays: 0,
    };
    const amount = n(r.amount);
    const days = Math.max(0, n(r.days));
    h.parcels += 1;
    h.amount += amount;
    h.buckets[codBucket(days)] += amount;
    h.oldestDays = Math.max(h.oldestDays, days);
    holders.set(r.courier, h);
  }
  const list = [...holders.values()].sort(
    (a, b) => (a.courier === null ? 1 : 0) - (b.courier === null ? 1 : 0) || b.amount - a.amount,
  );
  return { holders: list, total: list.reduce((a, h) => a + h.amount, 0) };
}
