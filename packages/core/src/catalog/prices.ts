// A product's price range (phase-3-plan §3.7): the lowest and highest live
// variant price, kept on the product for price sort and filters. Every
// command that writes variants calls refreshPriceRange in its transaction.
import { sql } from 'drizzle-orm';
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
                   (select min(v.price) from store.variants v
                     where v.product_id = x.id and v.archived_at is null) as lo,
                   (select max(v.price) from store.variants v
                     where v.product_id = x.id and v.archived_at is null) as hi
              from unnest(${sql.param([...new Set(productIds)])}::uuid[]) as x(id)) r
     where p.id = r.id
       and (p.price_min is distinct from r.lo or p.price_max is distinct from r.hi)`);
}
