// What the back office shows about a variant on a PO, a receipt or a count:
// its names in both languages, SKU, barcode and cost, in one query for any
// number of variants.
import { sql } from 'drizzle-orm';
import type { TenantTx } from '../tenant';
import { money } from './common';

export type Localized = { bn?: string; en?: string };

export interface VariantLabel {
  id: string;
  productId: string;
  title: Localized;
  optionLabels: Localized[];
  sku: string | null;
  barcode: string | null;
  /** The weighted average now; callers leave it out without catalog.cost. */
  costPrice: number | null;
  archived: boolean;
}

export async function variantLabels(
  tx: TenantTx,
  ids: readonly string[],
): Promise<Map<string, VariantLabel>> {
  if (!ids.length) return new Map();
  const { rows } = await tx.db.execute<{
    id: string;
    product_id: string;
    title: Localized | null;
    option_labels: Localized[];
    sku: string | null;
    barcode: string | null;
    cost: string | null;
    archived: boolean;
  }>(sql`
    select v.id, v.product_id, v.sku, v.barcode, v.cost_price as cost,
           v.archived_at is not null or p.status = 'archived' as archived,
           (select json_object_agg(t.locale, t.title) from store.product_translations t
             where t.product_id = v.product_id) as title,
           coalesce((select json_agg((select json_object_agg(vt.locale, vt.label)
                       from store.product_option_value_translations vt where vt.value_id = vo.value_id)
                       order by o.position)
                      from store.variant_option_values vo
                      join store.product_option_values ov on ov.id = vo.value_id
                      join store.product_options o on o.id = ov.option_id
                     where vo.variant_id = v.id), '[]'::json) as option_labels
      from store.variants v join store.products p on p.id = v.product_id
     where v.id = any(${sql.param([...new Set(ids)])}::uuid[])`);
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        productId: r.product_id,
        title: r.title ?? {},
        optionLabels: r.option_labels,
        sku: r.sku,
        barcode: r.barcode,
        costPrice: money(r.cost),
        archived: r.archived,
      },
    ]),
  );
}
