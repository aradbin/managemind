// What carts, checkout and manual orders read about the variants they sell
// (phase-4-plan §3.4, §3.6): titles and option labels in both languages,
// the price a shopper pays now (the sale price inside its window, §3.14),
// stock available, weight and VAT. One query for any number of variants.
// Line snapshots are frozen from this at placement.
import type { TaxSettings } from '@managemind/shared/settings';
import { sql } from 'drizzle-orm';
import { type StoreImage, toImage } from '../catalog/published';
import type { TenantTx } from '../tenant';

export type Localized = { bn?: string; en?: string };

export interface OrderableVariant {
  id: string;
  productId: string;
  /** Live and orderable: the product is active and the variant isn't archived. */
  live: boolean;
  title: Localized;
  /** Product slugs per language, for links back from the cart. */
  slugs: Localized;
  optionLabels: Localized[];
  sku: string | null;
  image: StoreImage | null;
  /** What the shopper pays now: the sale price inside its window. */
  price: number;
  /** The strikethrough: the regular price during a sale, else the compare-at price. */
  compareAtPrice: number | null;
  onSale: boolean;
  costPrice: number | null;
  weightGrams: number;
  vatCategory: string | null;
  trackInventory: boolean;
  allowBackorder: boolean;
  /** On hand minus reserved, over every location. */
  available: number;
  categoryIds: string[];
}

/** The price in force at `now` (§3.14): the same rule the published pages use. */
export const effectivePriceSql = (v: string) =>
  sql.raw(
    `(case when ${v}.sale_price is not null and now() >= ${v}.sale_starts_at and now() < ${v}.sale_ends_at
         then ${v}.sale_price else ${v}.price end)`,
  );

type Raw = Omit<OrderableVariant, 'image' | 'price' | 'compareAtPrice' | 'costPrice'> & {
  image: Parameters<typeof toImage>[0];
  price: number | string;
  regularPrice: number | string;
  compareAtPrice: number | string | null;
  costPrice: number | string | null;
};

const n = (v: number | string | null) => (v === null ? null : Number(v));

export async function loadVariants(
  tx: TenantTx,
  ids: readonly string[],
): Promise<Map<string, OrderableVariant>> {
  if (!ids.length) return new Map();
  const { rows } = await tx.db.execute<{ v: Raw }>(sql`
    select json_build_object(
      'id', v.id, 'productId', v.product_id,
      'live', p.status = 'active' and v.archived_at is null,
      'title', (select json_object_agg(t.locale, t.title) from store.product_translations t where t.product_id = p.id),
      'slugs', (select json_object_agg(t.locale, t.slug) from store.product_translations t where t.product_id = p.id),
      'optionLabels', coalesce((select json_agg(
          (select json_object_agg(vt.locale, vt.label) from store.product_option_value_translations vt
            where vt.value_id = vo.value_id) order by o.position)
          from store.variant_option_values vo
          join store.product_option_values ov on ov.id = vo.value_id
          join store.product_options o on o.id = ov.option_id
         where vo.variant_id = v.id), '[]'::json),
      'sku', v.sku,
      'image', coalesce(
        (select json_build_object('mime', m.mime, 'width', m.width, 'height', m.height, 'files', m.files, 'alt', null)
           from store.media m where m.id = v.image_media_id),
        (select json_build_object('mime', m.mime, 'width', m.width, 'height', m.height, 'files', m.files, 'alt', null)
           from store.product_media pm join store.media m on m.id = pm.media_id
          where pm.product_id = p.id order by pm.position limit 1)),
      'price', ${effectivePriceSql('v')},
      'regularPrice', v.price,
      'compareAtPrice', v.compare_at_price,
      'onSale', ${effectivePriceSql('v')} < v.price,
      'costPrice', v.cost_price,
      'weightGrams', coalesce(v.weight_grams, 0),
      'vatCategory', p.vat_category,
      'trackInventory', v.track_inventory,
      'allowBackorder', v.allow_backorder,
      'available', coalesce((select sum(l.on_hand - l.reserved) from store.inventory_levels l
                              where l.variant_id = v.id), 0),
      'categoryIds', coalesce((select json_agg(pc.category_id) from store.product_categories pc
                                where pc.product_id = p.id), '[]'::json)
    ) as v
      from store.variants v join store.products p on p.id = v.product_id
     where v.id = any(${sql.param([...new Set(ids)])}::uuid[])`);
  return new Map(
    rows.map(({ v }) => [
      v.id,
      {
        ...v,
        image: toImage(v.image),
        price: Number(v.price),
        compareAtPrice: v.onSale ? Number(v.regularPrice) : n(v.compareAtPrice),
        costPrice: n(v.costPrice),
        available: Number(v.available),
      },
    ]),
  );
}

/** Whether `quantity` can be ordered: untracked, backordered, or in stock. */
export const canOrder = (v: OrderableVariant, quantity: number) =>
  !v.trackInventory || v.allowBackorder || v.available >= quantity;

/** A line's VAT rate in basis points, from the store's settings (0 when VAT is off or exempt). */
export function vatRateOf(tax: TaxSettings, vatCategory: string | null): number {
  if (!tax.vatEnabled) return 0;
  if (!vatCategory) return tax.rateBasisPoints;
  const category = tax.categories.find((c) => c.key === vatCategory);
  if (!category) return tax.rateBasisPoints;
  return category.exempt ? 0 : category.rateBasisPoints;
}
