// Products, options and variants (phase-2-plan §3.1, §3.2, §5). Every
// command checks its permission, writes its audit entry and emits its event
// in the caller's transaction. Reads build their JSON in Postgres, one round
// trip per product, which keeps Worker CPU low (ADR 0003).
import { schema } from '@managemind/db';
import { AppError, uuidv7 } from '@managemind/shared';
import {
  bulkVariantPatch,
  combinations,
  normalizeKey,
  optionsKey,
  type ProductCreate,
  type ProductOptionsInput,
  type ProductPatch,
  productCreate,
  productOptions,
  productPatch,
  type VariantFields,
  variantPatch,
} from '@managemind/shared/catalog';
import { and, eq, inArray, isNull, ne, type SQL, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { requireWithinLimit } from '../billing/entitlements';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';
import { replaceProductAttributes, replaceProductTags } from './attributes';
import { collectionMatch } from './collections';
import {
  catalogWrite,
  invalid,
  type Locale,
  parseInput,
  requireDefault,
  storeCatalogContext,
  type Translated,
} from './common';
import { refreshPriceRange } from './prices';
import { chooseSlug, dropRedirects, recordSlugChange } from './slugs';

const p = schema.products;
const pt = schema.productTranslations;
const v = schema.variants;

// ---- Reads ----------------------------------------------------------------------

export interface ProductTranslation {
  title: string;
  slug: string;
  description: unknown;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface ProductVariant {
  id: string;
  optionValueIds: string[];
  sku: string | null;
  barcode: string | null;
  price: number;
  compareAtPrice: number | null;
  /** A scheduled sale (phase-4-plan §3.14): the price inside its window. */
  salePrice: number | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  /** Only for `catalog.cost`; left out otherwise. */
  costPrice?: number | null;
  weightGrams: number | null;
  trackInventory: boolean;
  allowBackorder: boolean;
  lowStockThreshold: number | null;
  imageMediaId: string | null;
  position: number;
  /** Totals across locations; only for `inventory.read`. */
  stock?: { onHand: number; reserved: number; available: number };
}

export interface ProductOption {
  id: string;
  position: number;
  name: Translated<string>;
  values: { id: string; position: number; label: Translated<string> }[];
}

export interface ProductAttributeValue {
  attributeId: string;
  key: string;
  type: string;
  valueIds: string[];
  number: number | null;
  boolean: boolean | null;
  text: Translated<string>;
}

export interface ProductDetail {
  id: string;
  status: 'draft' | 'active' | 'archived';
  vatCategory: string | null;
  metadata: Record<string, unknown>;
  translations: Translated<ProductTranslation>;
  options: ProductOption[];
  variants: ProductVariant[];
  media: {
    mediaId: string;
    position: number;
    mime: string;
    width: number;
    height: number;
    files: { width: number; sha256: string; bytes: number }[];
    alt: Translated<string>;
  }[];
  categoryIds: string[];
  collectionIds: string[];
  attributes: ProductAttributeValue[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** Whole products as JSON documents, built by Postgres: one row per product. */
const detailSql = (where: SQL) => sql`
  select json_build_object(
    'id', p.id,
    'status', p.status,
    'vatCategory', p.vat_category,
    'metadata', p.metadata,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at,
    'translations', coalesce((
      select json_object_agg(t.locale, json_build_object(
        'title', t.title, 'slug', t.slug, 'description', t.description,
        'seoTitle', t.seo_title, 'seoDescription', t.seo_description))
      from store.product_translations t where t.product_id = p.id), '{}'::json),
    'options', coalesce((
      select json_agg(json_build_object(
        'id', o.id, 'position', o.position,
        'name', coalesce((select json_object_agg(ot.locale, ot.name)
                  from store.product_option_translations ot where ot.option_id = o.id), '{}'::json),
        'values', coalesce((select json_agg(json_build_object(
                  'id', ov.id, 'position', ov.position,
                  'label', coalesce((select json_object_agg(vt.locale, vt.label)
                    from store.product_option_value_translations vt where vt.value_id = ov.id), '{}'::json))
                  order by ov.position)
                  from store.product_option_values ov where ov.option_id = o.id), '[]'::json))
        order by o.position)
      from store.product_options o where o.product_id = p.id), '[]'::json),
    'variants', coalesce((
      select json_agg(json_build_object(
        'id', v.id,
        'optionValueIds', coalesce((select json_agg(vo.value_id order by o.position)
            from store.variant_option_values vo
            join store.product_option_values ov on ov.id = vo.value_id
            join store.product_options o on o.id = ov.option_id
           where vo.variant_id = v.id), '[]'::json),
        'sku', v.sku, 'barcode', v.barcode, 'price', v.price,
        'compareAtPrice', v.compare_at_price, 'costPrice', v.cost_price,
        'salePrice', v.sale_price, 'saleStartsAt', v.sale_starts_at, 'saleEndsAt', v.sale_ends_at,
        'weightGrams', v.weight_grams, 'trackInventory', v.track_inventory,
        'allowBackorder', v.allow_backorder, 'lowStockThreshold', v.low_stock_threshold,
        'imageMediaId', v.image_media_id, 'position', v.position,
        'stock', (select json_build_object(
            'onHand', coalesce(sum(l.on_hand), 0), 'reserved', coalesce(sum(l.reserved), 0),
            'available', coalesce(sum(l.on_hand - l.reserved), 0))
          from store.inventory_levels l where l.variant_id = v.id))
        order by v.position)
      from store.variants v where v.product_id = p.id and v.archived_at is null), '[]'::json),
    'media', coalesce((select json_agg(json_build_object(
        'mediaId', pm.media_id, 'position', pm.position, 'mime', md.mime,
        'width', md.width, 'height', md.height, 'files', md.files,
        'alt', coalesce((select json_object_agg(mt.locale, mt.alt) from store.media_translations mt
                          where mt.media_id = md.id), '{}'::json))
        order by pm.position)
      from store.product_media pm join store.media md on md.id = pm.media_id
      where pm.product_id = p.id), '[]'::json),
    'categoryIds', coalesce((select json_agg(pc.category_id order by pc.category_id)
      from store.product_categories pc where pc.product_id = p.id), '[]'::json),
    'collectionIds', coalesce((select json_agg(cp.collection_id order by cp.collection_id)
      from store.collection_products cp where cp.product_id = p.id), '[]'::json),
    'attributes', coalesce((select json_agg(json_build_object(
        'attributeId', a.id, 'key', a.key, 'type', a.type,
        'valueIds', coalesce((select json_agg(pa.value_id order by av.position)
            from store.product_attributes pa join store.attribute_values av on av.id = pa.value_id
           where pa.product_id = p.id and pa.attribute_id = a.id), '[]'::json),
        'number', (select pa.number_value from store.product_attributes pa
           where pa.product_id = p.id and pa.attribute_id = a.id and pa.number_value is not null),
        'boolean', (select pa.boolean_value from store.product_attributes pa
           where pa.product_id = p.id and pa.attribute_id = a.id and pa.boolean_value is not null),
        'text', coalesce((select json_object_agg(pat.locale, pat.text)
            from store.product_attributes pa
            join store.product_attribute_translations pat on pat.product_attribute_id = pa.id
           where pa.product_id = p.id and pa.attribute_id = a.id), '{}'::json))
        order by a.position, a.key)
      from store.attributes a
      where exists (select 1 from store.product_attributes pa where pa.product_id = p.id and pa.attribute_id = a.id)),
      '[]'::json),
    'tags', coalesce((select json_agg(tg.tag order by tg.tag)
      from store.product_tags tg where tg.product_id = p.id), '[]'::json)
  ) as product
  from store.products p where ${where}`;

/** A product with everything the editor shows; cost and stock only for those allowed. */
export async function getProduct(tx: TenantTx, actor: Actor, id: string): Promise<ProductDetail> {
  authorize(actor, 'catalog.read');
  const { rows } = await tx.db.execute<{ product: ProductDetail }>(detailSql(sql`p.id = ${id}`));
  const product = rows[0]?.product;
  if (!product) throw new AppError('not_found');
  return redact(product, actor);
}

function redact(product: ProductDetail, actor: Actor): ProductDetail {
  const cost = actor.permissions.has('catalog.cost');
  const stock = actor.permissions.has('inventory.read');
  if (cost && stock) return product;
  return {
    ...product,
    variants: product.variants.map(({ costPrice, stock: levels, ...variant }) => ({
      ...variant,
      ...(cost ? { costPrice: costPrice ?? null } : {}),
      ...(stock && levels ? { stock: levels } : {}),
    })),
  };
}

export interface ProductListQuery {
  q?: string | undefined;
  status?: 'draft' | 'active' | 'archived' | undefined;
  categoryId?: string | undefined;
  collectionId?: string | undefined;
  /** A value of the built-in brand attribute. */
  brandValueId?: string | undefined;
  tag?: string | undefined;
  attributeValueId?: string | undefined;
  lowStock?: boolean | undefined;
  /** The last id of the previous page. */
  after?: string | undefined;
  limit?: number | undefined;
}

export type ProductSummary = {
  id: string;
  status: 'draft' | 'active' | 'archived';
  titles: Translated<string>;
  minPrice: number | null;
  maxPrice: number | null;
  variantCount: number;
  /** Available stock across tracked variants; only for `inventory.read`. */
  available?: number | null;
  lowStock?: boolean;
  imageMediaId: string | null;
  /** `<sha256>.<ext>` of the first image's smallest file. */
  imageFile: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Escapes LIKE wildcards in user text. */
const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Products newest first, with filters, a page at a time. */
export async function listProducts(
  tx: TenantTx,
  actor: Actor,
  query: ProductListQuery = {},
): Promise<{ items: ProductSummary[]; nextCursor: string | null }> {
  authorize(actor, 'catalog.read');
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const where: SQL[] = [];
  where.push(query.status ? sql`p.status = ${query.status}` : sql`p.status <> 'archived'`);
  if (query.after) where.push(sql`p.id < ${query.after}`);
  if (query.q?.trim()) {
    const text = query.q.trim().normalize('NFC');
    const like = `%${likeEscape(text)}%`;
    where.push(sql`(
      exists (select 1 from store.product_translations t where t.product_id = p.id
                 and app.search_text(t.title) like app.search_text(${like}))
      or exists (select 1 from store.variants sv where sv.product_id = p.id and lower(sv.sku) like ${`${likeEscape(text.toLowerCase())}%`})
      or exists (select 1 from store.product_tags tg where tg.product_id = p.id and tg.tag = ${normalizeKey(text)}))`);
  }
  if (query.categoryId) {
    where.push(sql`exists (
      with recursive tree as (
        select id from store.categories where id = ${query.categoryId}
        union all select c.id from store.categories c join tree on c.parent_id = tree.id)
      select 1 from store.product_categories pc where pc.product_id = p.id and pc.category_id in (select id from tree))`);
  }
  if (query.collectionId) where.push(await collectionMatch(tx, query.collectionId));
  if (query.brandValueId) {
    where.push(sql`exists (select 1 from store.product_attributes pa join store.attributes a on a.id = pa.attribute_id
      where pa.product_id = p.id and a.key = 'brand' and pa.value_id = ${query.brandValueId})`);
  }
  if (query.attributeValueId) {
    where.push(sql`exists (select 1 from store.product_attributes pa
      where pa.product_id = p.id and pa.value_id = ${query.attributeValueId})`);
  }
  if (query.tag) {
    where.push(
      sql`exists (select 1 from store.product_tags tg where tg.product_id = p.id and tg.tag = ${normalizeKey(query.tag)})`,
    );
  }
  if (query.lowStock) where.push(sql`${LOW_STOCK} `);

  const { rows } = await tx.db.execute<ProductSummary>(sql`
    select p.id, p.status,
      coalesce((select json_object_agg(t.locale, t.title) from store.product_translations t
                 where t.product_id = p.id), '{}'::json) as "titles",
      agg.min_price as "minPrice", agg.max_price as "maxPrice", agg.n as "variantCount",
      (select sum(l.on_hand - l.reserved)::int from store.inventory_levels l
         join store.variants sv on sv.id = l.variant_id
        where sv.product_id = p.id and sv.archived_at is null and sv.track_inventory) as "available",
      ${LOW_STOCK} as "lowStock",
      (select pm.media_id from store.product_media pm where pm.product_id = p.id
        order by pm.position limit 1) as "imageMediaId",
      -- The first image's smallest file, for list thumbnails (files are stored smallest first).
      (select (md.files -> 0 ->> 'sha256') || '.' ||
              case md.mime when 'image/webp' then 'webp' when 'image/jpeg' then 'jpg' else 'png' end
         from store.product_media pm join store.media md on md.id = pm.media_id
        where pm.product_id = p.id order by pm.position limit 1) as "imageFile",
      p.created_at as "createdAt", p.updated_at as "updatedAt"
    from store.products p
    left join lateral (
      select min(price) as min_price, max(price) as max_price, count(*)::int as n
        from store.variants sv where sv.product_id = p.id and sv.archived_at is null) agg on true
    where ${sql.join(where, sql` and `)}
    order by p.id desc
    limit ${limit + 1}`);
  const stock = actor.permissions.has('inventory.read');
  const items = rows.slice(0, limit).map((row) => {
    const { available, lowStock, ...rest } = row;
    return {
      ...rest,
      minPrice: row.minPrice === null ? null : Number(row.minPrice),
      maxPrice: row.maxPrice === null ? null : Number(row.maxPrice),
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      ...(stock ? { available: available ?? null, lowStock: Boolean(lowStock) } : {}),
    };
  });
  return {
    items,
    nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null,
  };
}

/**
 * Whole products for the export, a page at a time, with the list's filters:
 * the browser writes the file (phase-2-plan §3.7).
 */
export async function exportProducts(
  tx: TenantTx,
  actor: Actor,
  query: ProductListQuery = {},
): Promise<{ items: ProductDetail[]; nextCursor: string | null }> {
  const page = await listProducts(tx, actor, query);
  const ids = page.items.map((p) => p.id);
  if (!ids.length) return { items: [], nextCursor: null };
  const { rows } = await tx.db.execute<{ product: ProductDetail }>(
    detailSql(sql`p.id = any(${sql.param(ids)}::uuid[])`),
  );
  const byId = new Map(rows.map((r) => [r.product.id, redact(r.product, actor)]));
  return {
    items: ids.map((id) => byId.get(id)).filter((p): p is ProductDetail => Boolean(p)),
    nextCursor: page.nextCursor,
  };
}

/** A tracked live variant at or below its threshold (available across locations). */
const LOW_STOCK = sql`exists (
  select 1 from store.variants lv
   where lv.product_id = p.id and lv.archived_at is null and lv.track_inventory
     and lv.low_stock_threshold is not null
     and coalesce((select sum(l.on_hand - l.reserved) from store.inventory_levels l
                    where l.variant_id = lv.id), 0) <= lv.low_stock_threshold)`;

// ---- Writes ---------------------------------------------------------------------

async function lockProduct(tx: TenantTx, id: string) {
  const [row] = await tx.db
    .select({ id: p.id, status: p.status })
    .from(p)
    .where(eq(p.id, id))
    .for('update');
  if (!row) throw new AppError('not_found');
  return row;
}

function requireCostPermission(actor: Actor, fields: { costPrice?: unknown }): void {
  if (fields.costPrice !== undefined && !actor.permissions.has('catalog.cost')) {
    throw new AppError('forbidden', { detail: 'Cost prices need the catalog.cost permission' });
  }
}

function checkVatCategory(key: string | null | undefined, allowed: string[]): void {
  if (key && !allowed.includes(key))
    throw invalid('vatCategory', 'not one of the store’s VAT categories');
}

/** Writes translations for the languages given, with slugs and redirects. */
async function writeTranslations(
  tx: TenantTx,
  productId: string,
  input: Translated<ProductCreate['translations'][Locale] | null>,
  locale: Locale,
): Promise<void> {
  const existing = await tx.db
    .select({ locale: pt.locale, slug: pt.slug, title: pt.title })
    .from(pt)
    .where(eq(pt.productId, productId));
  const current = new Map(existing.map((t) => [t.locale, t]));
  for (const lang of ['bn', 'en'] as const) {
    const t = input[lang];
    if (t === undefined) continue;
    if (t === null) {
      if (lang === locale)
        throw invalid(
          `translations.${lang}`,
          'the store’s default language is required',
          'required',
        );
      await tx.db.delete(pt).where(and(eq(pt.productId, productId), eq(pt.locale, lang)));
      continue;
    }
    const other = lang === 'bn' ? 'en' : 'bn';
    const slug = await chooseSlug(tx, 'product', {
      locale: lang,
      entityId: productId,
      requested: t.slug,
      current: current.get(lang)?.slug,
      title: t.title,
      fallbackTitle: input[other]?.title ?? current.get(other)?.title,
    });
    const values = {
      productId,
      locale: lang,
      title: t.title,
      slug,
      ...(t.description !== undefined ? { description: t.description } : {}),
      ...(t.seoTitle !== undefined ? { seoTitle: t.seoTitle } : {}),
      ...(t.seoDescription !== undefined ? { seoDescription: t.seoDescription } : {}),
    };
    await catalogWrite(() =>
      tx.db
        .insert(pt)
        .values(values)
        .onConflictDoUpdate({
          target: [pt.tenantId, pt.productId, pt.locale],
          set: { ...values, updatedAt: sql`now()` },
        }),
    );
    await recordSlugChange(tx, 'product', {
      locale: lang,
      entityId: productId,
      from: current.get(lang)?.slug,
      to: slug,
    });
  }
}

/** A product can be active once it has a title in the default language and a price. */
async function checkPublishable(tx: TenantTx, productId: string, locale: Locale): Promise<void> {
  const { rows } = await tx.db.execute<{ titled: boolean; priced: boolean }>(sql`
    select exists (select 1 from store.product_translations
                    where product_id = ${productId} and locale = ${locale}) as titled,
           exists (select 1 from store.variants
                    where product_id = ${productId} and archived_at is null and price > 0) as priced`);
  const row = rows[0];
  if (!row?.titled) throw invalid(`translations.${locale}.title`, 'needed to publish', 'required');
  if (!row.priced) throw invalid('variants', 'a price above zero is needed to publish', 'required');
}

async function replaceCategories(
  tx: TenantTx,
  productId: string,
  categoryIds: string[],
): Promise<void> {
  const pc = schema.productCategories;
  const ids = [...new Set(categoryIds)];
  await tx.db
    .delete(pc)
    .where(
      and(
        eq(pc.productId, productId),
        ids.length ? sql`${pc.categoryId} <> all(${sql.param(ids)}::uuid[])` : undefined,
      ),
    );
  if (!ids.length) return;
  // New links go to the end of each category's listing.
  await catalogWrite(() =>
    tx.db.execute(sql`
      insert into store.product_categories (product_id, category_id, position)
      select ${productId}, c.id,
             coalesce((select max(position) + 1 from store.product_categories x where x.category_id = c.id), 0)
        from unnest(${sql.param(ids)}::uuid[]) as c(id)
      on conflict do nothing`),
  );
  const { rows } = await tx.db.execute<{ n: number }>(
    sql`select count(*)::int as n from store.categories where id = any(${sql.param(ids)}::uuid[])`,
  );
  if (rows[0]?.n !== ids.length) throw invalid('categoryIds', 'unknown category', 'not_found');
}

async function replaceCollections(
  tx: TenantTx,
  productId: string,
  collectionIds: string[],
): Promise<void> {
  const ids = [...new Set(collectionIds)];
  const { rows } = await tx.db.execute<{ id: string; kind: string }>(
    sql`select id, kind from store.collections where id = any(${sql.param(ids)}::uuid[])`,
  );
  if (rows.length !== ids.length) throw invalid('collectionIds', 'unknown collection', 'not_found');
  if (rows.some((r) => r.kind !== 'manual')) {
    throw invalid('collectionIds', 'rule-based collections choose their products themselves');
  }
  await tx.db.execute(sql`
    delete from store.collection_products
     where product_id = ${productId} and not (collection_id = any(${sql.param(ids)}::uuid[]))`);
  if (!ids.length) return;
  await tx.db.execute(sql`
    insert into store.collection_products (collection_id, product_id, position)
    select c.id, ${productId},
           coalesce((select max(position) + 1 from store.collection_products x where x.collection_id = c.id), 0)
      from unnest(${sql.param(ids)}::uuid[]) as c(id)
    on conflict do nothing`);
}

const variantColumns = (fields: { [K in keyof VariantFields]?: VariantFields[K] | undefined }) => ({
  ...(fields.sku !== undefined ? { sku: fields.sku } : {}),
  ...(fields.barcode !== undefined ? { barcode: fields.barcode } : {}),
  ...(fields.price !== undefined ? { price: fields.price } : {}),
  ...(fields.compareAtPrice !== undefined ? { compareAtPrice: fields.compareAtPrice } : {}),
  ...(fields.costPrice !== undefined ? { costPrice: fields.costPrice } : {}),
  ...(fields.weightGrams !== undefined ? { weightGrams: fields.weightGrams } : {}),
  ...(fields.trackInventory !== undefined ? { trackInventory: fields.trackInventory } : {}),
  ...(fields.allowBackorder !== undefined ? { allowBackorder: fields.allowBackorder } : {}),
  ...(fields.lowStockThreshold !== undefined
    ? { lowStockThreshold: fields.lowStockThreshold }
    : {}),
});

type SaleFields = {
  salePrice?: number | null | undefined;
  saleStartsAt?: string | null | undefined;
  saleEndsAt?: string | null | undefined;
};

/** A sale's columns: clearing the price clears its window. */
const saleColumns = (fields: SaleFields) =>
  fields.salePrice === null
    ? { salePrice: null, saleStartsAt: null, saleEndsAt: null }
    : fields.salePrice === undefined
      ? {}
      : {
          salePrice: fields.salePrice,
          saleStartsAt: new Date(fields.saleStartsAt as string),
          saleEndsAt: new Date(fields.saleEndsAt as string),
        };

/** The sale must stay below the regular price, whichever of the two changed. */
function checkSale(
  current: VariantRow,
  fields: SaleFields & { price?: number | undefined },
  path: string,
) {
  const price = fields.price ?? current.price;
  const sale = fields.salePrice !== undefined ? fields.salePrice : current.salePrice;
  if (sale !== null && sale >= price) throw invalid(`${path}salePrice`, 'must be below the price');
}

/** Sale windows that open or close later: the API queues a message for each edge (§3.14). */
async function scheduleSaleEdges(tx: TenantTx, productId: string, rows: VariantRow[]) {
  const now = Date.now();
  const edges = [
    ...new Set(
      rows
        .filter((r) => r.salePrice !== null)
        .flatMap((r) => [r.saleStartsAt, r.saleEndsAt])
        .filter((d): d is Date => d !== null && d.getTime() > now)
        .map((d) => d.toISOString()),
    ),
  ];
  if (!edges.length) return;
  await emit(tx, 'catalog.sale_scheduled', {
    aggregateType: 'product',
    aggregateId: productId,
    payload: { productIds: [productId], edges },
  });
}

/** Creates a product with its single variant; options are set afterwards. */
/** Products that count toward the plan's limit: every one not archived (phase-5b-plan §3.5). */
export async function countProducts(tx: TenantTx): Promise<number> {
  const [row] = await tx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(p)
    .where(and(eq(p.tenantId, tx.tenantId), ne(p.status, 'archived')));
  return row?.n ?? 0;
}

export async function createProduct(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<ProductDetail> {
  authorize(actor, 'catalog.write');
  const data: ProductCreate = parseInput(productCreate, input);
  await requireWithinLimit(tx, 'products', () => countProducts(tx));
  const store = await storeCatalogContext(tx);
  requireDefault(data.translations, store.defaultLocale);
  if (data.variant) requireCostPermission(actor, data.variant);
  checkVatCategory(data.vatCategory, store.vatCategories);

  const id = uuidv7();
  await tx.db.insert(p).values({
    id,
    status: 'draft',
    vatCategory: data.vatCategory ?? null,
    metadata: data.metadata ?? {},
  });
  await writeTranslations(tx, id, data.translations, store.defaultLocale);
  await catalogWrite(() =>
    tx.db
      .insert(v)
      .values({ productId: id, optionsKey: '', price: 0, ...variantColumns(data.variant ?? {}) }),
  );
  await refreshPriceRange(tx, [id]);
  if (data.categoryIds?.length) await replaceCategories(tx, id, data.categoryIds);
  if (data.tags?.length) await replaceProductTags(tx, id, data.tags);
  if (data.attributes?.length)
    await replaceProductAttributes(tx, id, data.attributes, store.defaultLocale);
  if (data.status === 'active') {
    await checkPublishable(tx, id, store.defaultLocale);
    await tx.db.update(p).set({ status: 'active' }).where(eq(p.id, id));
  }

  const product = await getProduct(tx, actor, id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'product.created',
    entityType: 'product',
    entityId: id,
    after: {
      status: product.status,
      translations: product.translations,
      variant: data.variant ?? null,
    },
  });
  await emit(tx, 'catalog.product.created', {
    aggregateType: 'product',
    aggregateId: id,
    payload: {},
  });
  return product;
}

/** Edits a product's content, status, links, tags, attributes and settings. */
export async function updateProduct(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<ProductDetail> {
  authorize(actor, 'catalog.write');
  const patch: ProductPatch = parseInput(productPatch, input);
  const current = await lockProduct(tx, id);
  const store = await storeCatalogContext(tx);
  if (patch.vatCategory !== undefined) checkVatCategory(patch.vatCategory, store.vatCategories);
  const before = await getProduct(tx, actor, id);

  const fields: string[] = [];
  if (patch.translations) {
    await writeTranslations(tx, id, patch.translations, store.defaultLocale);
    fields.push('content');
  }
  if (patch.categoryIds) {
    await replaceCategories(tx, id, patch.categoryIds);
    fields.push('categories');
  }
  if (patch.collectionIds) {
    await replaceCollections(tx, id, patch.collectionIds);
    fields.push('collections');
  }
  if (patch.tags) {
    await replaceProductTags(tx, id, patch.tags);
    fields.push('tags');
  }
  if (patch.attributes) {
    await replaceProductAttributes(tx, id, patch.attributes, store.defaultLocale);
    fields.push('attributes');
  }
  const columns: Partial<typeof p.$inferInsert> = {};
  if (patch.vatCategory !== undefined) columns.vatCategory = patch.vatCategory;
  if (patch.metadata !== undefined) columns.metadata = patch.metadata;
  if (patch.status !== undefined && patch.status !== current.status) {
    // Bringing an archived product back counts toward the plan again.
    if (current.status === 'archived') {
      await requireWithinLimit(tx, 'products', () => countProducts(tx));
    }
    if (patch.status === 'active') await checkPublishable(tx, id, store.defaultLocale);
    columns.status = patch.status;
    fields.push('status');
  }
  if (Object.keys(columns).length) {
    if (columns.vatCategory !== undefined || columns.metadata !== undefined)
      fields.push('settings');
    await tx.db.update(p).set(columns).where(eq(p.id, id));
  } else if (fields.length) {
    await tx.db.update(p).set({ updatedAt: sql`now()` }).where(eq(p.id, id));
  }
  // Slugs and titles must still satisfy publishing while active.
  if (current.status === 'active' && patch.status === undefined && patch.translations) {
    await checkPublishable(tx, id, store.defaultLocale);
  }

  const after = await getProduct(tx, actor, id);
  if (fields.length) {
    const changed = (key: keyof ProductDetail) =>
      JSON.stringify(before[key]) !== JSON.stringify(after[key]);
    const keys = (
      [
        'status',
        'translations',
        'categoryIds',
        'collectionIds',
        'tags',
        'attributes',
        'vatCategory',
        'metadata',
      ] as const
    ).filter(changed);
    await recordAudit(tx, {
      ...auditActor(actor, 'staff'),
      action: 'product.updated',
      entityType: 'product',
      entityId: id,
      before: Object.fromEntries(keys.map((k) => [k, before[k]])),
      after: Object.fromEntries(keys.map((k) => [k, after[k]])),
    });
    await emit(tx, 'catalog.product.updated', {
      aggregateType: 'product',
      aggregateId: id,
      payload: { fields: [...new Set(fields)] },
    });
  }
  return after;
}

/** Archives a product: it leaves the store, and its orders and stock history still resolve. */
export async function archiveProduct(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<ProductDetail> {
  authorize(actor, 'catalog.write');
  const current = await lockProduct(tx, id);
  if (current.status !== 'archived') {
    await tx.db.update(p).set({ status: 'archived' }).where(eq(p.id, id));
    await recordAudit(tx, {
      ...auditActor(actor, 'staff'),
      action: 'product.archived',
      entityType: 'product',
      entityId: id,
      before: { status: current.status },
      after: { status: 'archived' },
    });
    await emit(tx, 'catalog.product.archived', {
      aggregateType: 'product',
      aggregateId: id,
      payload: {},
    });
  }
  return getProduct(tx, actor, id);
}

/**
 * Deletes a draft (Q9). Anything with history (stock movements now, orders
 * from Phase 4) is refused by the database's references: archive it instead.
 */
export async function deleteProduct(tx: TenantTx, actor: Actor, id: string): Promise<void> {
  authorize(actor, 'catalog.write');
  const current = await lockProduct(tx, id);
  if (current.status !== 'draft') {
    throw new AppError('in_use', {
      detail: 'Only drafts can be deleted; archive the product instead',
    });
  }
  const before = await getProduct(tx, actor, id);
  await catalogWrite(async () => {
    await tx.db.delete(schema.productCategories).where(eq(schema.productCategories.productId, id));
    await tx.db.delete(p).where(eq(p.id, id));
  });
  await dropRedirects(tx, 'product', id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'product.deleted',
    entityType: 'product',
    entityId: id,
    before: { translations: before.translations, variants: before.variants.length },
  });
  await emit(tx, 'catalog.product.deleted', {
    aggregateType: 'product',
    aggregateId: id,
    payload: {},
  });
}

// ---- Options and variant regeneration (§3.1) ------------------------------------

/**
 * Replaces a product's options and regenerates its variants. Existing IDs keep
 * their rows, so a renamed value keeps its variants. A variant survives when
 * its combination still exists; when an option is added, each variant takes
 * the new option's first value; when an option is removed, the first variant
 * of each collapsed group survives. Every other variant is archived, never
 * deleted, so its stock history and orders still resolve.
 */
export async function setProductOptions(
  tx: TenantTx,
  actor: Actor,
  productId: string,
  input: unknown,
): Promise<ProductDetail> {
  authorize(actor, 'catalog.write');
  const options: ProductOptionsInput = parseInput(productOptions, input);
  const store = await storeCatalogContext(tx);
  for (const [i, o] of options.entries()) {
    requireDefault(o.name, store.defaultLocale, `${i}.name`);
    for (const [j, value] of o.values.entries()) {
      requireDefault(value.label, store.defaultLocale, `${i}.values.${j}.label`);
    }
  }
  await lockProduct(tx, productId);
  const before = await getProduct(tx, actor, productId);

  // What exists now.
  const oldOptions = new Map(before.options.map((o) => [o.id, o]));
  const oldValueOption = new Map<string, string>();
  for (const o of before.options) for (const value of o.values) oldValueOption.set(value.id, o.id);

  // IDs in the input must be this product's, each used once.
  const seen = new Set<string>();
  const optionIds: string[] = [];
  const valueIds: string[][] = [];
  options.forEach((o, i) => {
    if (o.id && (!oldOptions.has(o.id) || seen.has(o.id)))
      throw invalid(`${i}.id`, 'not an option of this product');
    const optionId = o.id ?? uuidv7();
    seen.add(optionId);
    optionIds.push(optionId);
    valueIds.push(
      o.values.map((value, j) => {
        if (value.id && (oldValueOption.get(value.id) !== o.id || seen.has(value.id))) {
          throw invalid(`${i}.values.${j}.id`, 'not a value of this option');
        }
        const valueId = value.id ?? uuidv7();
        seen.add(valueId);
        return valueId;
      }),
    );
  });
  const keptOptions = new Set(optionIds.filter((id) => oldOptions.has(id)));
  const keptValues = new Set(valueIds.flat().filter((id) => oldValueOption.has(id)));

  // Match existing variants to the new combinations.
  const combos = combinations(valueIds).map((ids) => ({ ids, set: new Set(ids) }));
  const matched = new Map<number, string>(); // combo index -> variant id
  const archived: string[] = [];
  for (const variant of before.variants) {
    let dead = false;
    const kept: string[] = [];
    for (const valueId of variant.optionValueIds) {
      const optionId = oldValueOption.get(valueId);
      if (!optionId || !keptOptions.has(optionId)) continue; // its option was removed
      if (!keptValues.has(valueId)) dead = true; // its value was removed
      kept.push(valueId);
    }
    const index = dead
      ? -1
      : combos.findIndex((c, i) => !matched.has(i) && kept.every((id) => c.set.has(id)));
    if (index === -1) archived.push(variant.id);
    else matched.set(index, variant.id);
  }

  // Write: archive first, so surviving variants can take freed combinations.
  if (archived.length) {
    await tx.db.update(v).set({ archivedAt: sql`now()` }).where(inArray(v.id, archived));
  }
  const po = schema.productOptions;
  const pov = schema.productOptionValues;
  const removedOptions = [...oldOptions.keys()].filter((id) => !keptOptions.has(id));
  const removedValues = [...oldValueOption.keys()].filter(
    (id) => !keptValues.has(id) && keptOptions.has(oldValueOption.get(id) ?? ''),
  );
  if (removedValues.length) await tx.db.delete(pov).where(inArray(pov.id, removedValues));
  if (removedOptions.length) await tx.db.delete(po).where(inArray(po.id, removedOptions));

  for (const [i, optionId] of optionIds.entries()) {
    if (keptOptions.has(optionId))
      await tx.db.update(po).set({ position: i }).where(eq(po.id, optionId));
    else await tx.db.insert(po).values({ id: optionId, productId, position: i });
    for (const [j, valueId] of (valueIds[i] ?? []).entries()) {
      if (keptValues.has(valueId))
        await tx.db.update(pov).set({ position: j }).where(eq(pov.id, valueId));
      else await tx.db.insert(pov).values({ id: valueId, optionId, position: j });
    }
  }
  // Names and labels: rewritten whole, they are small.
  const pot = schema.productOptionTranslations;
  const povt = schema.productOptionValueTranslations;
  if (optionIds.length) {
    await tx.db.delete(pot).where(inArray(pot.optionId, optionIds));
    await tx.db.delete(povt).where(inArray(povt.valueId, valueIds.flat()));
    await tx.db.insert(pot).values(
      options.flatMap((o, i) =>
        Object.entries(o.name).map(([locale, name]) => ({
          optionId: optionIds[i] as string,
          locale: locale as Locale,
          name: name as string,
          nameKey: normalizeKey(name as string),
        })),
      ),
    );
    await tx.db.insert(povt).values(
      options.flatMap((o, i) =>
        o.values.flatMap((value, j) =>
          Object.entries(value.label).map(([locale, label]) => ({
            valueId: valueIds[i]?.[j] as string,
            locale: locale as Locale,
            label: label as string,
            labelKey: normalizeKey(label as string),
          })),
        ),
      ),
    );
  }

  // Variants: survivors move to their combination, the rest are new.
  const survivors = [...matched.values()];
  if (survivors.length) {
    await tx.db
      .update(v)
      .set({ optionsKey: sql`'moving:' || ${v.id}` })
      .where(inArray(v.id, survivors));
  }
  const defaultPrice = before.variants[0]?.price ?? 0;
  const vov = schema.variantOptionValues;
  if (survivors.length) await tx.db.delete(vov).where(inArray(vov.variantId, survivors));
  const links: { variantId: string; valueId: string }[] = [];
  for (const [i, combo] of combos.entries()) {
    const key = optionsKey(combo.ids);
    let variantId = matched.get(i);
    if (variantId) {
      await tx.db.update(v).set({ optionsKey: key, position: i }).where(eq(v.id, variantId));
    } else {
      variantId = uuidv7();
      await tx.db
        .insert(v)
        .values({ id: variantId, productId, optionsKey: key, price: defaultPrice, position: i });
    }
    for (const valueId of combo.ids) links.push({ variantId, valueId });
  }
  if (links.length) await tx.db.insert(vov).values(links);
  await tx.db.update(p).set({ updatedAt: sql`now()` }).where(eq(p.id, productId));
  await refreshPriceRange(tx, [productId]);

  const after = await getProduct(tx, actor, productId);
  const summary = (d: ProductDetail) => ({
    options: d.options.map((o) => ({ name: o.name, values: o.values.map((x) => x.label) })),
    variants: d.variants.length,
  });
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'product.options_changed',
    entityType: 'product',
    entityId: productId,
    before: summary(before),
    after: { ...summary(after), archivedVariants: archived },
  });
  await emit(tx, 'catalog.product.updated', {
    aggregateType: 'product',
    aggregateId: productId,
    payload: { fields: ['options', 'variants'] },
  });
  return after;
}

// ---- Variant edits -----------------------------------------------------------------

type VariantRow = typeof v.$inferSelect;

const auditedVariantFields = [
  'sku',
  'barcode',
  'price',
  'compareAtPrice',
  'costPrice',
  'weightGrams',
  'trackInventory',
  'allowBackorder',
  'lowStockThreshold',
  'salePrice',
  'saleStartsAt',
  'saleEndsAt',
] as const;

/** Dates compare by time, not by object. */
const plain = (x: unknown) => (x instanceof Date ? x.toISOString() : x);

function variantChanges(before: VariantRow, after: VariantRow) {
  const keys = auditedVariantFields.filter((k) => plain(before[k]) !== plain(after[k]));
  return {
    keys,
    before: Object.fromEntries(keys.map((k) => [k, plain(before[k])])),
    after: Object.fromEntries(keys.map((k) => [k, plain(after[k])])),
  };
}

/** Edits one variant: SKU, prices, weight, stock settings. */
export async function updateVariant(
  tx: TenantTx,
  actor: Actor,
  variantId: string,
  input: unknown,
): Promise<ProductVariant> {
  authorize(actor, 'catalog.write');
  const patch = parseInput(variantPatch, input);
  requireCostPermission(actor, patch);
  const [current] = await tx.db
    .select()
    .from(v)
    .where(and(eq(v.id, variantId), isNull(v.archivedAt)))
    .for('update');
  if (!current) throw new AppError('not_found');
  const compareAt =
    patch.compareAtPrice !== undefined ? patch.compareAtPrice : current.compareAtPrice;
  const price = patch.price ?? current.price;
  if (compareAt !== null && compareAt <= price)
    throw invalid('compareAtPrice', 'must be above the price');
  checkSale(current, patch, '');

  const [updated] = await catalogWrite(() =>
    tx.db
      .update(v)
      .set({ ...variantColumns(patch), ...saleColumns(patch) })
      .where(eq(v.id, variantId))
      .returning(),
  );
  if (!updated) throw new AppError('not_found');
  const changes = variantChanges(current, updated);
  if (changes.keys.length) {
    await tx.db.update(p).set({ updatedAt: sql`now()` }).where(eq(p.id, current.productId));
    await refreshPriceRange(tx, [current.productId]);
    await recordAudit(tx, {
      ...auditActor(actor, 'staff'),
      action: 'variant.updated',
      entityType: 'variant',
      entityId: variantId,
      before: changes.before,
      after: changes.after,
    });
    await emit(tx, 'catalog.product.updated', {
      aggregateType: 'product',
      aggregateId: current.productId,
      payload: {
        fields: changes.keys.some((k) => k.endsWith('rice') || k.startsWith('sale'))
          ? ['variants', 'prices']
          : ['variants'],
      },
    });
    if (changes.keys.some((k) => k.startsWith('sale')))
      await scheduleSaleEdges(tx, current.productId, [updated]);
  }
  const product = await getProduct(tx, actor, current.productId);
  const variant = product.variants.find((x) => x.id === variantId);
  if (!variant) throw new AppError('not_found');
  return variant;
}

/** Bulk price, compare-at, sale and threshold edits from the product list (at most 200). */
export async function bulkUpdateVariants(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<{ updated: number }> {
  authorize(actor, 'catalog.write');
  const edits = parseInput(bulkVariantPatch, input);
  const ids = [...new Set(edits.map((e) => e.id))];
  if (ids.length !== edits.length) throw invalid('', 'each variant once');
  const rows = await tx.db
    .select()
    .from(v)
    .where(and(inArray(v.id, ids), isNull(v.archivedAt)))
    .orderBy(v.id)
    .for('update');
  if (rows.length !== ids.length) throw new AppError('not_found');
  const byId = new Map(rows.map((r) => [r.id, r]));

  const products = new Set<string>();
  const sales = new Map<string, VariantRow[]>();
  let updated = 0;
  for (const [i, edit] of edits.entries()) {
    const current = byId.get(edit.id) as VariantRow;
    const price = edit.price ?? current.price;
    const compareAt =
      edit.compareAtPrice !== undefined ? edit.compareAtPrice : current.compareAtPrice;
    if (compareAt !== null && compareAt <= price)
      throw invalid(`${i}.compareAtPrice`, 'must be above the price');
    checkSale(current, edit, `${i}.`);
    const { id, ...fields } = edit;
    const [after] = await tx.db
      .update(v)
      .set({ ...variantColumns(fields), ...saleColumns(fields) })
      .where(eq(v.id, id))
      .returning();
    if (!after) continue;
    const changes = variantChanges(current, after);
    if (!changes.keys.length) continue;
    updated += 1;
    products.add(current.productId);
    if (changes.keys.some((k) => k.startsWith('sale'))) {
      const list = sales.get(current.productId) ?? [];
      list.push(after);
      sales.set(current.productId, list);
    }
    await recordAudit(tx, {
      ...auditActor(actor, 'staff'),
      action: 'variant.updated',
      entityType: 'variant',
      entityId: id,
      before: changes.before,
      after: changes.after,
    });
  }
  if (products.size) {
    await tx.db
      .update(p)
      .set({ updatedAt: sql`now()` })
      .where(inArray(p.id, [...products]));
    await refreshPriceRange(tx, [...products]);
  }
  for (const productId of products) {
    await emit(tx, 'catalog.product.updated', {
      aggregateType: 'product',
      aggregateId: productId,
      payload: { fields: ['variants', 'prices'] },
    });
  }
  for (const [productId, rows] of sales) await scheduleSaleEdges(tx, productId, rows);
  return { updated };
}
