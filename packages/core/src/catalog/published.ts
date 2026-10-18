// What shoppers see of the catalog (phase-3-plan §3.5, §3.7): published-only
// reads for the storefront's page queries. Only active products, published
// collections and (in pages.ts) published pages ever appear. Text comes in
// the shopper's language, falling back to the store's default. No costs,
// stock counts or staff-only fields leave this module: a variant is only
// "available" or not.
import { collectionRules, MEDIA_EXTENSIONS, type MediaType } from '@managemind/shared/catalog';
import type { RichTextDoc } from '@managemind/shared/rich-text';
import { LISTING_LIMITS, type ListingQuery } from '@managemind/shared/storefront/listing';
import { type SQL, sql } from 'drizzle-orm';
import { effectivePriceSql } from '../orders/variants';
import type { TenantTx } from '../tenant';
import { rulesSql } from './collections';
import type { Locale } from './common';
import { resolveRedirect } from './slugs';

/** The shopper's language and the store's default, which fills any gap. */
export interface Lang {
  locale: Locale;
  fallback: Locale;
}

export interface StoreImage {
  width: number;
  height: number;
  /** Smallest first: `{ width, file }` with file `<sha256>.<ext>`. */
  files: { width: number; file: string }[];
  /** Null when the store left it blank; the storefront then uses the product's name. */
  alt: string | null;
}

export interface ProductCard {
  id: string;
  slug: string;
  title: string;
  /** Poisha; null only for a product without live variants. */
  priceMin: number | null;
  priceMax: number | null;
  /** The cheapest variant's compare-at price. */
  compareAt: number | null;
  available: boolean;
  brand: string | null;
  image: StoreImage | null;
}

type RawImage = {
  mime: MediaType;
  width: number;
  height: number;
  files: { width: number; sha256: string }[];
  alt: string | null;
};

export function toImage(raw: RawImage | null): StoreImage | null {
  if (!raw) return null;
  const ext = MEDIA_EXTENSIONS[raw.mime] ?? 'webp';
  return {
    width: raw.width,
    height: raw.height,
    files: [...raw.files]
      .sort((a, b) => a.width - b.width)
      .map((f) => ({ width: f.width, file: `${f.sha256}.${ext}` })),
    alt: raw.alt,
  };
}

/** A media row as RawImage JSON, alt text in the shopper's language. */
export const imageJson = (md: SQL, lang: Lang): SQL => sql`json_build_object(
  'mime', ${md}.mime, 'width', ${md}.width, 'height', ${md}.height, 'files', ${md}.files,
  'alt', coalesce(
    (select mt.alt from store.media_translations mt where mt.media_id = ${md}.id and mt.locale = ${lang.locale}),
    (select mt.alt from store.media_translations mt where mt.media_id = ${md}.id and mt.locale = ${lang.fallback})))`;

/** A live variant shoppers can order: untracked, backordered or with available stock. */
const VARIANT_AVAILABLE = (v: SQL) => sql`(not ${v}.track_inventory or ${v}.allow_backorder
  or coalesce((select sum(l.on_hand - l.reserved) from store.inventory_levels l where l.variant_id = ${v}.id), 0) > 0)`;

const PRODUCT_AVAILABLE = sql`exists (select 1 from store.variants av
  where av.product_id = p.id and av.archived_at is null and ${VARIANT_AVAILABLE(sql`av`)})`;

/** The card of product `p`, with tl/td its translations in the shopper's and the default language. */
const cardJson = (lang: Lang) => sql`json_build_object(
  'id', p.id,
  'slug', coalesce(tl.slug, td.slug),
  'title', coalesce(tl.title, td.title),
  'priceMin', p.price_min, 'priceMax', p.price_max,
  -- The cheapest variant's strikethrough: its regular price while on sale (§3.14).
  'compareAt', (select case when ${effectivePriceSql('cv')} < cv.price then cv.price
                            else cv.compare_at_price end
                  from store.variants cv
                 where cv.product_id = p.id and cv.archived_at is null
                 order by ${effectivePriceSql('cv')}, cv.position limit 1),
  'available', ${PRODUCT_AVAILABLE},
  'brand', (select coalesce(bl.label, bd.label)
              from store.product_attributes pa
              join store.attributes a on a.id = pa.attribute_id and a.key = 'brand' and a.visible
              left join store.attribute_value_translations bl on bl.value_id = pa.value_id and bl.locale = ${lang.locale}
              left join store.attribute_value_translations bd on bd.value_id = pa.value_id and bd.locale = ${lang.fallback}
             where pa.product_id = p.id limit 1),
  'image', (select ${imageJson(sql`md`, lang)}
              from store.product_media pm join store.media md on md.id = pm.media_id
             where pm.product_id = p.id order by pm.position limit 1))`;

const translationJoins = (lang: Lang) => sql`
  left join store.product_translations tl on tl.product_id = p.id and tl.locale = ${lang.locale}
  join store.product_translations td on td.product_id = p.id and td.locale = ${lang.fallback}`;

type RawCard = Omit<ProductCard, 'image' | 'priceMin' | 'priceMax' | 'compareAt'> & {
  image: RawImage | null;
  priceMin: number | string | null;
  priceMax: number | string | null;
  compareAt: number | string | null;
};

const num = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

export const toCard = (raw: RawCard): ProductCard => ({
  ...raw,
  priceMin: num(raw.priceMin),
  priceMax: num(raw.priceMax),
  compareAt: num(raw.compareAt),
  image: toImage(raw.image),
});

/** Cards of active products, in the order of `ids`. */
export async function productCards(
  tx: TenantTx,
  lang: Lang,
  ids: readonly string[],
): Promise<ProductCard[]> {
  if (!ids.length) return [];
  const { rows } = await tx.db.execute<{ card: RawCard }>(sql`
    select ${cardJson(lang)} as card from store.products p ${translationJoins(lang)}
     where p.id = any(${sql.param([...ids])}::uuid[]) and p.status = 'active'`);
  const byId = new Map(rows.map((r) => [r.card.id, toCard(r.card)]));
  return ids.map((id) => byId.get(id)).filter((c): c is ProductCard => Boolean(c));
}

// ---- Listings ---------------------------------------------------------------------

export type ListingScope =
  | { type: 'all' }
  | { type: 'category'; categoryId: string }
  | { type: 'collection'; collectionId: string }
  | { type: 'search'; q: string };

export interface FacetValue {
  key: string;
  label: string;
  count: number;
  selected: boolean;
}

export interface Facet {
  /** `attribute` filters are `a.<key>`, `option` filters `o.<key>` (shared listing.ts). */
  type: 'attribute' | 'option';
  key: string;
  name: string;
  values: FacetValue[];
}

export interface Facets {
  /** The price range of the listing before filters, in poisha. */
  price: { min: number; max: number } | null;
  /** Search only: the categories of the results. */
  categories: { slug: string; name: string; count: number; selected: boolean }[];
  groups: Facet[];
}

export interface Listing {
  items: ProductCard[];
  total: number;
  page: number;
  pageCount: number;
  facets: Facets | null;
}

/** A category and its descendants, by id. */
const categoryTree = (categoryId: SQL) => sql`(
  with recursive tree as (
    select id from store.categories where id = ${categoryId}
    union all select c.id from store.categories c join tree on c.parent_id = tree.id)
  select id from tree)`;

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Search matches on titles (either language), tags and SKUs, on the normalized text (§3.7). */
function searchMatch(q: string): SQL {
  const like = `%${escapeLike(q)}%`;
  return sql`(
    exists (select 1 from store.product_translations st where st.product_id = p.id
             and (app.search_text(st.title) %> app.search_text(${q})
                  or app.search_text(st.title) like app.search_text(${like})))
    or exists (select 1 from store.product_tags sg where sg.product_id = p.id
             and (app.search_text(sg.tag) %> app.search_text(${q})
                  or app.search_text(sg.tag) like app.search_text(${like})))
    or exists (select 1 from store.variants sv where sv.product_id = p.id and sv.archived_at is null
             and lower(sv.sku) like ${`${escapeLike(q.toLowerCase())}%`}))`;
}

/** Relevance of a search result: the best title match, an exact SKU first. */
const searchRank = (q: string) => sql`greatest(
  coalesce((select max(word_similarity(app.search_text(${q}), app.search_text(st.title)))
              from store.product_translations st where st.product_id = p.id), 0),
  case when exists (select 1 from store.variants sv where sv.product_id = p.id
                     and sv.archived_at is null and lower(sv.sku) = ${q.toLowerCase()}) then 2 else 0 end)`;

async function scopeSql(tx: TenantTx, scope: ListingScope): Promise<SQL> {
  switch (scope.type) {
    case 'all':
      return sql`true`;
    case 'category':
      return sql`exists (select 1 from store.product_categories pc
        where pc.product_id = p.id and pc.category_id in ${categoryTree(sql`${scope.categoryId}::uuid`)})`;
    case 'collection': {
      const { rows } = await tx.db.execute<{ kind: string; rules: unknown }>(
        sql`select kind, rules from store.collections where id = ${scope.collectionId} and published`,
      );
      const row = rows[0];
      if (!row) return sql`false`;
      if (row.kind === 'manual') {
        return sql`exists (select 1 from store.collection_products cp
          where cp.product_id = p.id and cp.collection_id = ${scope.collectionId})`;
      }
      return rulesSql(collectionRules.parse(row.rules));
    }
    case 'search':
      return searchMatch(scope.q);
  }
}

/** Matches a value key in either language, so a link from the other language still filters. */
const attributeFilter = (key: string, values: string[]) => sql`exists (
  select 1 from store.product_attributes pa
    join store.attributes a on a.id = pa.attribute_id and a.key = ${key} and a.filterable
    join store.attribute_value_translations avt on avt.value_id = pa.value_id
   where pa.product_id = p.id and avt.label_key = any(${sql.param(values)}::text[]))`;

const optionFilter = (key: string, values: string[]) => sql`exists (
  select 1 from store.variants fv
    join store.variant_option_values fvo on fvo.variant_id = fv.id
    join store.product_option_values fov on fov.id = fvo.value_id
    join store.product_option_translations fot on fot.option_id = fov.option_id and fot.name_key = ${key}
    join store.product_option_value_translations fvt on fvt.value_id = fov.id
   where fv.product_id = p.id and fv.archived_at is null
     and fvt.label_key = any(${sql.param(values)}::text[]))`;

/** Filters other than the facets: price, stock and (search) category. */
function baseFilters(query: ListingQuery, lang: Lang): SQL[] {
  const where: SQL[] = [];
  if (query.min !== undefined) where.push(sql`p.price_max >= ${query.min * 100}`);
  if (query.max !== undefined) where.push(sql`p.price_min <= ${query.max * 100}`);
  if (query.inStock) where.push(PRODUCT_AVAILABLE);
  if (query.category !== undefined) {
    const id = sql`(select ct.category_id from store.category_translations ct
      where ct.slug = ${query.category} and ct.locale in (${lang.locale}, ${lang.fallback}) limit 1)`;
    where.push(sql`exists (select 1 from store.product_categories pc
      where pc.product_id = p.id and pc.category_id in ${categoryTree(id)})`);
  }
  return where;
}

function facetFilters(query: ListingQuery): SQL[] {
  return [
    ...Object.entries(query.attributes).map(([key, values]) => attributeFilter(key, values)),
    ...Object.entries(query.options).map(([key, values]) => optionFilter(key, values)),
  ];
}

async function orderSql(tx: TenantTx, scope: ListingScope, query: ListingQuery): Promise<SQL> {
  const newest = sql`p.created_at desc, p.id desc`;
  if (query.sort === 'newest') return newest;
  if (query.sort === 'price_asc') return sql`p.price_min asc nulls last, p.id`;
  if (query.sort === 'price_desc') return sql`p.price_min desc nulls last, p.id`;
  // Featured: the scope's own order.
  if (scope.type === 'search') return sql`${searchRank(scope.q)} desc, ${newest}`;
  if (scope.type === 'category') {
    return sql`(select min(pc.position) from store.product_categories pc
      where pc.product_id = p.id and pc.category_id = ${scope.categoryId}) asc nulls last, ${newest}`;
  }
  if (scope.type === 'collection') {
    const { rows } = await tx.db.execute<{ sort: string }>(
      sql`select sort from store.collections where id = ${scope.collectionId}`,
    );
    switch (rows[0]?.sort) {
      case 'manual':
        return sql`(select cp.position from store.collection_products cp
          where cp.product_id = p.id and cp.collection_id = ${scope.collectionId}) asc nulls last, ${newest}`;
      case 'price_asc':
        return sql`p.price_min asc nulls last, p.id`;
      case 'price_desc':
        return sql`p.price_min desc nulls last, p.id`;
      case 'title_asc':
        return sql`coalesce(tl.title, td.title) asc, p.id`;
    }
  }
  return newest;
}

/**
 * A page of active products in a scope, with filters, sort and facets: one
 * query for the page (with its total) and one grouped query for the facets.
 * Search is capped at 48 results (§3.7).
 */
export async function listPublishedProducts(
  tx: TenantTx,
  lang: Lang,
  scope: ListingScope,
  query: ListingQuery,
  options: { pageSize?: number; facets?: boolean } = {},
): Promise<Listing> {
  const pageSize = options.pageSize ?? LISTING_LIMITS.pageSize;
  const cap = scope.type === 'search' ? LISTING_LIMITS.searchResults : Number.POSITIVE_INFINITY;
  const page = Math.max(1, Math.min(query.page, LISTING_LIMITS.maxPage));
  const offset = (page - 1) * pageSize;
  const scoped = await scopeSql(tx, scope);
  const base = [sql`p.status = 'active'`, scoped, ...baseFilters(query, lang)];
  const where = sql.join([...base, ...facetFilters(query)], sql` and `);
  const order = await orderSql(tx, scope, query);
  const limit = Math.max(0, Math.min(pageSize, cap - offset));

  const { rows } =
    limit > 0
      ? await tx.db.execute<{ card: RawCard; total: number }>(sql`
          select ${cardJson(lang)} as card, count(*) over ()::int as total
            from store.products p ${translationJoins(lang)}
           where ${where}
           order by ${order}
           limit ${limit} offset ${offset}`)
      : { rows: [] };
  let total = rows[0]?.total ?? 0;
  if (!rows.length && offset > 0) {
    // Past the last page: count without fetching, for the page links.
    const { rows: n } = await tx.db.execute<{ n: number }>(sql`
      select count(*)::int as n from store.products p ${translationJoins(lang)} where ${where}`);
    total = n[0]?.n ?? 0;
  }
  total = Math.min(total, cap);
  return {
    items: rows.map((r) => toCard(r.card)),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    facets:
      options.facets === false
        ? null
        : await facets(tx, lang, sql.join(base, sql` and `), query, scope.type === 'search'),
  };
}

type FacetRow = {
  type: 'attribute' | 'option';
  key: string;
  name: string;
  value_key: string;
  label: string;
  count: number;
};

/**
 * Filter values with their product counts, from one grouped query over the
 * listing before its facet filters (so choosing a value never hides the
 * others), plus the price range and, for search, the result categories.
 */
async function facets(
  tx: TenantTx,
  lang: Lang,
  base: SQL,
  query: ListingQuery,
  withCategories: boolean,
): Promise<Facets> {
  const { rows } = await tx.db.execute<FacetRow>(sql`
    with base as (
      select p.id, p.price_min, p.price_max from store.products p ${translationJoins(lang)} where ${base}
    ), attrs as (
      select 'attribute' as type, a.key, coalesce(al.name, ad.name) as name, a.position as pos,
             coalesce(vl.label_key, vd.label_key) as value_key, coalesce(vl.label, vd.label) as label,
             av.position as value_pos, count(distinct b.id)::int as count
        from base b
        join store.product_attributes pa on pa.product_id = b.id
        join store.attributes a on a.id = pa.attribute_id and a.filterable
             and a.type in ('choice', 'multi_choice')
        join store.attribute_values av on av.id = pa.value_id
        left join store.attribute_translations al on al.attribute_id = a.id and al.locale = ${lang.locale}
        left join store.attribute_translations ad on ad.attribute_id = a.id and ad.locale = ${lang.fallback}
        left join store.attribute_value_translations vl on vl.value_id = av.id and vl.locale = ${lang.locale}
        left join store.attribute_value_translations vd on vd.value_id = av.id and vd.locale = ${lang.fallback}
       group by 1, 2, 3, 4, 5, 6, 7
    ), opts as (
      select 'option' as type, coalesce(ol.name_key, od.name_key) as key,
             min(coalesce(ol.name, od.name)) as name, 1000 as pos,
             coalesce(vl.label_key, vd.label_key) as value_key, min(coalesce(vl.label, vd.label)) as label,
             min(ov.position) as value_pos, count(distinct b.id)::int as count
        from base b
        join store.variants v on v.product_id = b.id and v.archived_at is null
        join store.variant_option_values vo on vo.variant_id = v.id
        join store.product_option_values ov on ov.id = vo.value_id
        left join store.product_option_translations ol on ol.option_id = ov.option_id and ol.locale = ${lang.locale}
        left join store.product_option_translations od on od.option_id = ov.option_id and od.locale = ${lang.fallback}
        left join store.product_option_value_translations vl on vl.value_id = ov.id and vl.locale = ${lang.locale}
        left join store.product_option_value_translations vd on vd.value_id = ov.id and vd.locale = ${lang.fallback}
       group by 2, 5
    ), price as (
      select 'price' as type, '' as key, '' as name, 0 as pos, min(price_min)::text as value_key,
             max(price_max)::text as label, 0 as value_pos, count(*)::int as count from base
    )
    select type, key, name, value_key, label, count from (
      select * from attrs union all select * from opts union all select * from price) f
     where value_key is not null and key is not null
     order by pos, key, value_pos, label`);

  const groups = new Map<string, Facet>();
  let price: Facets['price'] = null;
  for (const row of rows) {
    if ((row.type as string) === 'price') {
      if (row.count > 0) price = { min: Number(row.value_key), max: Number(row.label) };
      continue;
    }
    const id = `${row.type}:${row.key}`;
    let group = groups.get(id);
    if (!group) {
      if (groups.size >= LISTING_LIMITS.facets) continue;
      group = { type: row.type, key: row.key, name: row.name, values: [] };
      groups.set(id, group);
    }
    if (group.values.length >= LISTING_LIMITS.valuesPerFacet) continue;
    const selected = (row.type === 'attribute' ? query.attributes : query.options)[row.key] ?? [];
    group.values.push({
      key: row.value_key,
      label: row.label,
      count: row.count,
      selected: selected.includes(row.value_key),
    });
  }
  // An option every product shares in one value (a lone "Size: Free") filters nothing.
  const useful = [...groups.values()].filter((g) => g.values.length > 1 || g.values[0]?.selected);

  let categories: Facets['categories'] = [];
  if (withCategories) {
    const { rows: cats } = await tx.db.execute<{ slug: string; name: string; count: number }>(sql`
      with base as (select p.id from store.products p ${translationJoins(lang)} where ${base})
      select coalesce(cl.slug, cd.slug) as slug, coalesce(cl.name, cd.name) as name,
             count(distinct b.id)::int as count
        from base b join store.product_categories pc on pc.product_id = b.id
        left join store.category_translations cl on cl.category_id = pc.category_id and cl.locale = ${lang.locale}
        left join store.category_translations cd on cd.category_id = pc.category_id and cd.locale = ${lang.fallback}
       group by 1, 2 order by count desc, name limit ${LISTING_LIMITS.valuesPerFacet}`);
    categories = cats
      .filter((c) => c.slug)
      .map((c) => ({ ...c, selected: c.slug === query.category }));
  }
  return { price, categories, groups: useful };
}

// ---- Product pages ------------------------------------------------------------------

export interface StoreVariant {
  id: string;
  optionValueIds: string[];
  sku: string | null;
  price: number;
  compareAtPrice: number | null;
  available: boolean;
  imageMediaId: string | null;
}

export interface StoreSpecification {
  key: string;
  name: string;
  /** Formatted values: choice labels, a number with its unit, yes/no, or text. */
  type: 'choice' | 'multi_choice' | 'number' | 'text' | 'boolean';
  values: string[];
  number: number | null;
  unit: string | null;
  boolean: boolean | null;
}

export interface StoreProduct {
  id: string;
  slug: string;
  /** The slug in each language that has one, for hreflang. */
  slugs: Partial<Record<Locale, string>>;
  title: string;
  description: RichTextDoc | null;
  seoTitle: string | null;
  seoDescription: string | null;
  brand: string | null;
  options: { id: string; name: string; values: { id: string; label: string }[] }[];
  variants: StoreVariant[];
  media: (StoreImage & { id: string })[];
  specifications: StoreSpecification[];
  /** The first category's path from the top, for breadcrumbs. */
  breadcrumbs: { id: string; slug: string; name: string }[];
  categoryIds: string[];
  updatedAt: string;
}

export type BySlug<T> = { found: T } | { redirect: string } | null;

/**
 * An entity's ID by slug: the shopper's language, then the default
 * language's slug; else an old slug's current one, as a redirect.
 */
async function idBySlug(
  tx: TenantTx,
  table: 'product' | 'category' | 'collection' | 'page',
  lang: Lang,
  slug: string,
): Promise<{ id: string; locale: Locale } | { redirectTo: string } | null> {
  const t = {
    product: { table: 'store.product_translations', column: 'product_id' },
    category: { table: 'store.category_translations', column: 'category_id' },
    collection: { table: 'store.collection_translations', column: 'collection_id' },
    page: { table: 'store.page_translations', column: 'page_id' },
  }[table];
  const { rows } = await tx.db.execute<{ id: string; locale: Locale }>(sql`
    select ${sql.raw(t.column)} as id, locale from ${sql.raw(t.table)}
     where slug = ${slug} and locale in (${lang.locale}, ${lang.fallback})
     order by (locale = ${lang.locale}) desc limit 1`);
  const hit = rows[0];
  if (hit) return { id: hit.id, locale: hit.locale };
  for (const locale of new Set([lang.locale, lang.fallback])) {
    const id = await resolveRedirect(tx, table, locale, slug);
    if (id) return { redirectTo: id };
  }
  return null;
}

/** The current slug of an entity in the shopper's language (else the default's). */
async function currentSlug(
  tx: TenantTx,
  table: 'product' | 'category' | 'collection' | 'page',
  lang: Lang,
  id: string,
): Promise<string | null> {
  const t = {
    product: ['store.product_translations', 'product_id'],
    category: ['store.category_translations', 'category_id'],
    collection: ['store.collection_translations', 'collection_id'],
    page: ['store.page_translations', 'page_id'],
  }[table] as [string, string];
  const { rows } = await tx.db.execute<{ slug: string }>(sql`
    select slug from ${sql.raw(t[0])} where ${sql.raw(t[1])} = ${id}
       and locale in (${lang.locale}, ${lang.fallback})
     order by (locale = ${lang.locale}) desc limit 1`);
  return rows[0]?.slug ?? null;
}

/** Resolves a slug for a published entity: found, a redirect to the current slug, or nothing. */
export async function resolveStoreSlug(
  tx: TenantTx,
  kind: 'product' | 'category' | 'collection' | 'page',
  lang: Lang,
  slug: string,
  isPublished: (id: string) => Promise<boolean>,
): Promise<BySlug<string>> {
  const hit = await idBySlug(tx, kind, lang, slug);
  if (!hit) return null;
  const id = 'id' in hit ? hit.id : hit.redirectTo;
  if (!(await isPublished(id))) return null;
  // Found by the default language's slug, though this language has its own:
  // the page's own URL is the one to use.
  const current = await currentSlug(tx, kind, lang, id);
  if ('id' in hit && (hit.locale === lang.locale || current === slug)) return { found: id };
  return current && current !== slug ? { redirect: current } : 'id' in hit ? { found: id } : null;
}

const isActiveProduct = (tx: TenantTx) => async (id: string) => {
  const { rows } = await tx.db.execute(
    sql`select 1 from store.products where id = ${id} and status = 'active'`,
  );
  return rows.length > 0;
};

/** An active product by slug, with everything its page shows, or a redirect for an old slug. */
export async function publishedProductBySlug(
  tx: TenantTx,
  lang: Lang,
  slug: string,
): Promise<BySlug<StoreProduct>> {
  const hit = await resolveStoreSlug(tx, 'product', lang, slug, isActiveProduct(tx));
  if (!hit || 'redirect' in hit) return hit;
  const product = await publishedProduct(tx, lang, hit.found);
  return product ? { found: product } : null;
}

type RawProduct = Omit<StoreProduct, 'media' | 'variants'> & {
  media: (RawImage & { id: string })[];
  variants: (Omit<StoreVariant, 'price' | 'compareAtPrice'> & {
    price: number | string;
    compareAtPrice: number | string | null;
  })[];
  specifications: (StoreSpecification & { number: number | string | null })[];
};

/** An active product's page data, by ID; one query. */
export async function publishedProduct(
  tx: TenantTx,
  lang: Lang,
  id: string,
): Promise<StoreProduct | null> {
  const L = lang.locale;
  const D = lang.fallback;
  const tr = (table: string, alias: string, key: string, value: SQL) => sql`coalesce(
    (select ${sql.raw(alias)}.${sql.raw(key)} from ${sql.raw(table)} ${sql.raw(alias)} where ${value} and ${sql.raw(alias)}.locale = ${L}),
    (select ${sql.raw(alias)}.${sql.raw(key)} from ${sql.raw(table)} ${sql.raw(alias)} where ${value} and ${sql.raw(alias)}.locale = ${D}))`;
  const { rows } = await tx.db.execute<{ product: RawProduct }>(sql`
    select json_build_object(
      'id', p.id,
      'slug', coalesce(tl.slug, td.slug),
      'slugs', (select json_object_agg(t.locale, t.slug) from store.product_translations t where t.product_id = p.id),
      'title', coalesce(tl.title, td.title),
      'description', coalesce(tl.description, td.description),
      'seoTitle', coalesce(tl.seo_title, td.seo_title),
      'seoDescription', coalesce(tl.seo_description, td.seo_description),
      'updatedAt', p.updated_at,
      'brand', (select coalesce(bl.label, bd.label)
                  from store.product_attributes pa
                  join store.attributes a on a.id = pa.attribute_id and a.key = 'brand' and a.visible
                  left join store.attribute_value_translations bl on bl.value_id = pa.value_id and bl.locale = ${L}
                  left join store.attribute_value_translations bd on bd.value_id = pa.value_id and bd.locale = ${D}
                 where pa.product_id = p.id limit 1),
      'options', coalesce((select json_agg(json_build_object(
          'id', o.id,
          'name', ${tr('store.product_option_translations', 'ot', 'name', sql`ot.option_id = o.id`)},
          'values', coalesce((select json_agg(json_build_object(
              'id', ov.id,
              'label', ${tr('store.product_option_value_translations', 'vt', 'label', sql`vt.value_id = ov.id`)})
              order by ov.position)
            from store.product_option_values ov where ov.option_id = o.id
              and exists (select 1 from store.variant_option_values x join store.variants xv on xv.id = x.variant_id
                           where x.value_id = ov.id and xv.archived_at is null)), '[]'::json))
          order by o.position)
        from store.product_options o where o.product_id = p.id), '[]'::json),
      'variants', coalesce((select json_agg(json_build_object(
          'id', v.id,
          'optionValueIds', coalesce((select json_agg(vo.value_id order by o.position)
              from store.variant_option_values vo
              join store.product_option_values ov on ov.id = vo.value_id
              join store.product_options o on o.id = ov.option_id
             where vo.variant_id = v.id), '[]'::json),
          'sku', v.sku, 'price', ${effectivePriceSql('v')},
          'compareAtPrice', case when ${effectivePriceSql('v')} < v.price then v.price
                                 else v.compare_at_price end,
          'available', ${VARIANT_AVAILABLE(sql`v`)},
          'imageMediaId', v.image_media_id)
          order by v.position)
        from store.variants v where v.product_id = p.id and v.archived_at is null), '[]'::json),
      'media', coalesce((select json_agg(${imageJson(sql`md`, lang)}::jsonb || jsonb_build_object('id', md.id) order by pm.position)
        from store.product_media pm join store.media md on md.id = pm.media_id
        where pm.product_id = p.id), '[]'::json),
      'specifications', coalesce((select json_agg(json_build_object(
          'key', a.key, 'type', a.type,
          'name', ${tr('store.attribute_translations', 'at', 'name', sql`at.attribute_id = a.id`)},
          'unit', ${tr('store.attribute_translations', 'au', 'unit', sql`au.attribute_id = a.id`)},
          'values', coalesce((select json_agg(${tr('store.attribute_value_translations', 'avt', 'label', sql`avt.value_id = pa.value_id`)} order by av.position)
              from store.product_attributes pa join store.attribute_values av on av.id = pa.value_id
             where pa.product_id = p.id and pa.attribute_id = a.id), '[]'::json),
          'number', (select pa.number_value from store.product_attributes pa
             where pa.product_id = p.id and pa.attribute_id = a.id and pa.number_value is not null),
          'boolean', (select pa.boolean_value from store.product_attributes pa
             where pa.product_id = p.id and pa.attribute_id = a.id and pa.boolean_value is not null),
          'text', (select ${tr('store.product_attribute_translations', 'pat', 'text', sql`pat.product_attribute_id = pa.id`)}
             from store.product_attributes pa where pa.product_id = p.id and pa.attribute_id = a.id limit 1))
          order by a.position, a.key)
        from store.attributes a
        where a.visible and a.key <> 'brand'
          and exists (select 1 from store.product_attributes pa where pa.product_id = p.id and pa.attribute_id = a.id)),
        '[]'::json),
      'categoryIds', coalesce((select json_agg(pc.category_id order by pc.category_id)
        from store.product_categories pc where pc.product_id = p.id), '[]'::json),
      'breadcrumbs', coalesce((
        with recursive path as (
          select c.id, c.parent_id, 0 as up from store.categories c
           where c.id = (select pc.category_id from store.product_categories pc
                          join store.categories k on k.id = pc.category_id
                          where pc.product_id = p.id order by k.depth desc, pc.category_id limit 1)
          union all
          select c.id, c.parent_id, path.up + 1 from store.categories c join path on c.id = path.parent_id)
        select json_agg(json_build_object(
            'id', path.id,
            'slug', ${tr('store.category_translations', 'cs', 'slug', sql`cs.category_id = path.id`)},
            'name', ${tr('store.category_translations', 'cn', 'name', sql`cn.category_id = path.id`)})
          order by path.up desc)
        from path), '[]'::json)
    ) as product
    from store.products p ${translationJoins(lang)}
    where p.id = ${id} and p.status = 'active'`);
  const raw = rows[0]?.product;
  if (!raw) return null;
  return {
    ...raw,
    slugs: raw.slugs ?? {},
    variants: raw.variants.map((x) => ({
      ...x,
      price: Number(x.price),
      compareAtPrice: num(x.compareAtPrice),
    })),
    media: raw.media.map((m) => ({ ...(toImage(m) as StoreImage), id: m.id })),
    specifications: raw.specifications.map((s) => {
      const textValue = (s as { text?: string | null }).text;
      const { text: _text, ...rest } = s as typeof s & { text?: string | null };
      return {
        ...rest,
        number: num(s.number),
        values: s.type === 'text' ? (textValue ? [textValue] : []) : s.values,
      };
    }),
    updatedAt: new Date(raw.updatedAt).toISOString(),
  };
}

/** Up to `limit` other active products from the product's categories, newest first. */
export async function relatedProducts(
  tx: TenantTx,
  lang: Lang,
  product: Pick<StoreProduct, 'id' | 'categoryIds'>,
  limit = 8,
): Promise<ProductCard[]> {
  if (!product.categoryIds.length) return [];
  const { rows } = await tx.db.execute<{ card: RawCard }>(sql`
    select ${cardJson(lang)} as card from store.products p ${translationJoins(lang)}
     where p.status = 'active' and p.id <> ${product.id}
       and exists (select 1 from store.product_categories pc where pc.product_id = p.id
                    and pc.category_id = any(${sql.param(product.categoryIds)}::uuid[]))
     order by p.created_at desc, p.id desc limit ${limit}`);
  return rows.map((r) => toCard(r.card));
}

// ---- Categories and collections ---------------------------------------------------------

export interface StoreCategory {
  id: string;
  parentId: string | null;
  slug: string;
  slugs: Partial<Record<Locale, string>>;
  name: string;
  description: RichTextDoc | null;
}

export interface StoreCollection {
  id: string;
  slug: string;
  slugs: Partial<Record<Locale, string>>;
  name: string;
  description: RichTextDoc | null;
}

const namedJson = (table: string, column: string, alias: string) => sql`
  'slug', coalesce(tl.slug, td.slug),
  'slugs', (select json_object_agg(t.locale, t.slug) from ${sql.raw(table)} t where t.${sql.raw(column)} = ${sql.raw(alias)}.id),
  'name', coalesce(tl.name, td.name),
  'description', coalesce(tl.description, td.description)`;

const namedJoins = (table: string, column: string, alias: string, lang: Lang) => sql`
  left join ${sql.raw(table)} tl on tl.${sql.raw(column)} = ${sql.raw(alias)}.id and tl.locale = ${lang.locale}
  left join ${sql.raw(table)} td on td.${sql.raw(column)} = ${sql.raw(alias)}.id and td.locale = ${lang.fallback}`;

/** Every category in tree order (by position), for the header menu and the category grid. */
export async function storeCategories(tx: TenantTx, lang: Lang): Promise<StoreCategory[]> {
  const { rows } = await tx.db.execute<{ category: StoreCategory }>(sql`
    select json_build_object('id', k.id, 'parentId', k.parent_id,
      ${namedJson('store.category_translations', 'category_id', 'k')}) as category
      from store.categories k ${namedJoins('store.category_translations', 'category_id', 'k', lang)}
     where coalesce(tl.slug, td.slug) is not null
     order by k.depth, k.position, k.id`);
  return rows.map((r) => ({ ...r.category, slugs: r.category.slugs ?? {} }));
}

/** A category by slug, or a redirect for an old slug. */
export async function publishedCategoryBySlug(
  tx: TenantTx,
  lang: Lang,
  slug: string,
): Promise<BySlug<StoreCategory>> {
  const hit = await resolveStoreSlug(tx, 'category', lang, slug, async () => true);
  if (!hit || 'redirect' in hit) return hit;
  const category = (await storeCategories(tx, lang)).find((c) => c.id === hit.found);
  return category ? { found: category } : null;
}

/** Published collections, by ID or all of them, newest first. */
export async function storeCollections(
  tx: TenantTx,
  lang: Lang,
  ids?: readonly string[],
): Promise<(StoreCollection & { image: StoreImage | null })[]> {
  const { rows } = await tx.db.execute<{
    collection: StoreCollection & { image: RawImage | null };
  }>(sql`
    select json_build_object('id', c.id,
      ${namedJson('store.collection_translations', 'collection_id', 'c')},
      -- The first product's first image stands in for a collection picture.
      'image', (select ${imageJson(sql`md`, lang)}
                  from store.collection_products cp
                  join store.products p on p.id = cp.product_id and p.status = 'active'
                  join store.product_media pm on pm.product_id = p.id
                  join store.media md on md.id = pm.media_id
                 where cp.collection_id = c.id order by cp.position, pm.position limit 1)) as collection
      from store.collections c ${namedJoins('store.collection_translations', 'collection_id', 'c', lang)}
     where c.published and coalesce(tl.slug, td.slug) is not null
       ${ids ? sql`and c.id = any(${sql.param([...ids])}::uuid[])` : sql``}
     order by c.created_at desc limit 50`);
  const list = rows.map((r) => ({
    ...r.collection,
    slugs: r.collection.slugs ?? {},
    image: toImage(r.collection.image),
  }));
  if (!ids) return list;
  const byId = new Map(list.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter((c): c is (typeof list)[number] => Boolean(c));
}

/** A published collection by slug, or a redirect for an old slug. */
export async function publishedCollectionBySlug(
  tx: TenantTx,
  lang: Lang,
  slug: string,
): Promise<BySlug<StoreCollection>> {
  const isPublished = async (id: string) => {
    const { rows } = await tx.db.execute(
      sql`select 1 from store.collections where id = ${id} and published`,
    );
    return rows.length > 0;
  };
  const hit = await resolveStoreSlug(tx, 'collection', lang, slug, isPublished);
  if (!hit || 'redirect' in hit) return hit;
  const [collection] = await storeCollections(tx, lang, [hit.found]);
  return collection ? { found: collection } : null;
}

/** Slugs of entities a theme links to, by kind and ID, in the shopper's language. */
export async function slugsById(
  tx: TenantTx,
  lang: Lang,
  ids: Record<'category' | 'collection' | 'product' | 'page', readonly string[]>,
): Promise<Record<'category' | 'collection' | 'product' | 'page', Record<string, string>>> {
  const out = { category: {}, collection: {}, product: {}, page: {} } as Record<
    'category' | 'collection' | 'product' | 'page',
    Record<string, string>
  >;
  const sources = {
    category: sql`select ct.category_id as id, ct.slug, ct.locale from store.category_translations ct
      where ct.category_id = any(${sql.param([...ids.category])}::uuid[])`,
    collection: sql`select ct.collection_id as id, ct.slug, ct.locale from store.collection_translations ct
      join store.collections c on c.id = ct.collection_id and c.published
      where ct.collection_id = any(${sql.param([...ids.collection])}::uuid[])`,
    product: sql`select pt.product_id as id, pt.slug, pt.locale from store.product_translations pt
      join store.products p on p.id = pt.product_id and p.status = 'active'
      where pt.product_id = any(${sql.param([...ids.product])}::uuid[])`,
    page: sql`select pt.page_id as id, pt.slug, pt.locale from store.page_translations pt
      join store.pages pg on pg.id = pt.page_id and pg.published
      where pt.page_id = any(${sql.param([...ids.page])}::uuid[])`,
  };
  for (const kind of ['category', 'collection', 'product', 'page'] as const) {
    if (!ids[kind].length) continue;
    const { rows } = await tx.db.execute<{ id: string; slug: string; locale: Locale }>(
      sql`select * from (${sources[kind]}) s where s.locale in (${lang.locale}, ${lang.fallback})
          order by (s.locale = ${lang.fallback}) desc`,
    );
    // Default language first, so the shopper's language overwrites it.
    for (const row of rows) out[kind][row.id] = row.slug;
  }
  return out;
}
