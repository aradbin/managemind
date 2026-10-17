// A product's price range (phase-3-plan §3.7): the lowest and highest live
// variant price, kept on the product for price sort and filters. Every
// command that writes variants calls refreshPriceRange in its transaction;
// a scheduled sale (phase-4-plan §3.14) counts while its window is open,
// and applySaleEdges refreshes it again when a window opens or closes.
import { sql } from 'drizzle-orm';
import { effectivePriceSql } from '../orders/variants';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';

/** Recomputes price_min and price_max; products whose range didn't change aren't touched. */
export async function refreshPriceRange(
  tx: TenantTx,
  productIds: readonly string[],
): Promise<void> {
  if (!productIds.length) return;
  await tx.db.execute(sql`
    update store.products p set price_min = r.lo, price_max = r.hi
      from (select x.id,
                   (select min(${effectivePriceSql('v')}) from store.variants v
                     where v.product_id = x.id and v.archived_at is null) as lo,
                   (select max(${effectivePriceSql('v')}) from store.variants v
                     where v.product_id = x.id and v.archived_at is null) as hi
              from unnest(${sql.param([...new Set(productIds)])}::uuid[]) as x(id)) r
     where p.id = r.id
       and (p.price_min is distinct from r.lo or p.price_max is distinct from r.hi)`);
}

/**
 * A sale window opened or closed (§3.14): the products' ranges again, and
 * their pages purged, since the price shown changed without a staff action.
 */
export async function applySaleEdges(tx: TenantTx, productIds: readonly string[]): Promise<void> {
  const ids = [...new Set(productIds)];
  if (!ids.length) return;
  await refreshPriceRange(tx, ids);
  const { rows } = await tx.db.execute<{ id: string }>(
    sql`select id from store.products where id = any(${sql.param(ids)}::uuid[])`,
  );
  for (const r of rows) {
    await emit(tx, 'catalog.product.updated', {
      aggregateType: 'product',
      aggregateId: r.id,
      payload: { fields: ['prices'] },
    });
  }
}
