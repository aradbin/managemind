// A product's last 30 days and its latest orders, for the product view
// (ADR 0034, the canvas's ProductView): units sold and revenue per product
// and per variant, the margin for those who see costs, and the orders that
// had it. Cancelled orders don't count. Orders need orders.read; the margin
// needs catalog.cost and a cost on every line sold.
import { AppError } from '@managemind/shared';
import { formatOrderNumber } from '@managemind/shared/orders';
import { sql } from 'drizzle-orm';
import { type Actor, authorize } from '../access';
import type { Localized } from '../orders/variants';
import { orderSettings } from '../pricing/quote';
import type { TenantTx } from '../tenant';

export interface ProductActivity {
  /** Units sold in the last 30 days. */
  sold: number;
  /** What those lines came to, after discounts. */
  revenue: number;
  /** Revenue less cost, as a share of revenue; null without costs or sales. */
  marginBp: number | null;
  /** Units sold per variant in the last 30 days. */
  variants: { variantId: string; sold: number }[];
  /** The latest orders with the product, newest first; empty without orders.read. */
  recentOrders: {
    id: string;
    displayNumber: string;
    placedAt: string;
    customerName: string;
    status: string;
    total: number;
    lines: { optionLabels: Localized[]; quantity: number }[];
  }[];
}

const DAYS = 30;
const RECENT = 5;

export async function productActivity(
  tx: TenantTx,
  actor: Actor,
  productId: string,
): Promise<ProductActivity> {
  authorize(actor, 'catalog.read');
  // Another store's product, or none at all: not found, as everywhere else.
  const found = await tx.db.execute(sql`select 1 from store.products where id = ${productId}`);
  if (!found.rows.length) throw new AppError('not_found');
  const since = sql`now() - make_interval(days => ${DAYS})`;
  // One after the other: a transaction's client runs one query at a time.
  const totals = await tx.db.execute<{
    sold: string | null;
    revenue: string | null;
    cost: string | null;
    costless: string;
  }>(sql`
      select sum(l.quantity) as sold, sum(l.line_total) as revenue,
             sum(l.cost_price * l.quantity) as cost,
             count(*) filter (where l.cost_price is null) as costless
        from store.order_lines l join store.orders o on o.id = l.order_id
       where l.product_id = ${productId} and o.status <> 'cancelled' and o.placed_at >= ${since}`);
  const perVariant = await tx.db.execute<{ variant_id: string; sold: string }>(sql`
      select l.variant_id, sum(l.quantity) as sold
        from store.order_lines l join store.orders o on o.id = l.order_id
       where l.product_id = ${productId} and o.status <> 'cancelled' and o.placed_at >= ${since}
       group by l.variant_id`);
  const t = totals.rows[0];
  const revenue = Number(t?.revenue ?? 0);
  const cost = t?.cost === null || t?.cost === undefined ? null : Number(t.cost);
  const marginBp =
    actor.permissions.has('catalog.cost') &&
    revenue > 0 &&
    cost !== null &&
    Number(t?.costless) === 0
      ? Math.round(((revenue - cost) / revenue) * 10_000)
      : null;

  let recentOrders: ProductActivity['recentOrders'] = [];
  if (actor.permissions.has('orders.read')) {
    const { checkout } = await orderSettings(tx);
    const { rows } = await tx.db.execute<{
      id: string;
      number: string;
      placed_at: string;
      contact: { name?: string } | null;
      status: string;
      total: string;
      lines: { optionLabels: Localized[]; quantity: number }[];
    }>(sql`
      select o.id, o.number, o.placed_at, o.contact, o.status, o.total,
             (select json_agg(json_build_object('optionLabels', l.option_labels, 'quantity', l.quantity)
                order by l.position)
                from store.order_lines l where l.order_id = o.id and l.product_id = ${productId}) as lines
        from store.orders o
       where exists (select 1 from store.order_lines l where l.order_id = o.id and l.product_id = ${productId})
       order by o.placed_at desc limit ${RECENT}`);
    recentOrders = rows.map((r) => ({
      id: r.id,
      displayNumber: formatOrderNumber(checkout.orderNumberPrefix, Number(r.number)),
      placedAt: new Date(r.placed_at).toISOString(),
      customerName: r.contact?.name ?? '',
      status: r.status,
      total: Number(r.total),
      lines: r.lines ?? [],
    }));
  }

  return {
    sold: Number(t?.sold ?? 0),
    revenue,
    marginBp,
    variants: perVariant.rows.map((r) => ({ variantId: r.variant_id, sold: Number(r.sold) })),
    recentOrders,
  };
}
