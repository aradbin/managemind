// The storefront's page queries (phase-3-plan §5, §6.1): one call per page
// miss, returning everything the page shows plus the cache tags it touched.
// Read-only; the catalog is read through the catalog module's published-only
// functions, never its tables.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import type { Locale } from '@managemind/shared/i18n';
import { type StoreProfile, tenantSettings } from '@managemind/shared/settings';
import type { StorefrontSettings, Theme, ThemeLink } from '@managemind/shared/storefront';
import { themeLinkTargets, themeMediaIds } from '@managemind/shared/storefront';
import { listsTag, pageTag, productTag, storeTag } from '@managemind/shared/storefront/cache';
import { type ListingQuery, parseListingQuery } from '@managemind/shared/storefront/listing';
import type { SitemapPart } from '@managemind/shared/storefront/urls';
import { eq, sql } from 'drizzle-orm';
import {
  publishedPageBySlug,
  type StorePage,
  type StorePageLink,
  storePageLinks,
} from '../catalog/pages';
import {
  imageJson,
  type Lang,
  type Listing,
  listPublishedProducts,
  type ProductCard,
  publishedCategoryBySlug,
  publishedCollectionBySlug,
  publishedProductBySlug,
  relatedProducts,
  type StoreCategory,
  type StoreCollection,
  type StoreImage,
  type StoreProduct,
  slugsById,
  storeCategories,
  storeCollections,
  toImage,
} from '../catalog/published';
import type { TenantTx } from '../tenant';
import { themeOf } from '../theme/service';

/** A page's data and the cache tags it carries (§3.2). */
export interface PageResult<T> {
  data: T;
  tags: string[];
}

export type LinkTargets = Record<
  'category' | 'collection' | 'product' | 'page',
  Record<string, string>
>;

export interface StoreLayout {
  locale: Locale;
  store: {
    name: string;
    slug: string;
    defaultLocale: Locale;
    profile: StoreProfile;
  };
  theme: Theme;
  /** The theme's images (logo, favicon, banners), by media ID. */
  images: Record<string, StoreImage>;
  /** Slugs of the records the theme links to, in this language; missing ones aren't published. */
  links: LinkTargets;
  categories: StoreCategory[];
  pages: StorePageLink[];
  storefront: StorefrontSettings;
  numerals: 'bengali' | 'latin' | null;
  /** What the shopper pages need to know (phase-4-plan §3.16). */
  shop: { accounts: boolean; termsCheckbox: boolean; email: 'optional' | 'required' | 'hidden' };
}

async function storeRow(tx: TenantTx) {
  const t = schema.tenants;
  const [row] = await tx.db
    .select({ name: t.name, slug: t.slug, defaultLocale: t.defaultLocale, settings: t.settings })
    .from(t)
    .where(eq(t.id, tx.tenantId));
  if (!row) throw new AppError('store_not_found');
  return { ...row, settings: tenantSettings.parse(row.settings) };
}

/** The shopper's language, with the store's default filling gaps. */
export async function storeLang(tx: TenantTx, locale: Locale | null): Promise<Lang> {
  const row = await storeRow(tx);
  return { locale: locale ?? row.defaultLocale, fallback: row.defaultLocale };
}

async function themeImages(
  tx: TenantTx,
  lang: Lang,
  theme: Theme,
): Promise<Record<string, StoreImage>> {
  const ids = themeMediaIds(theme);
  if (!ids.length) return {};
  const { rows } = await tx.db.execute<{ id: string; image: Parameters<typeof toImage>[0] }>(sql`
    select md.id, ${imageJson(sql`md`, lang)} as image from store.media md
     where md.id = any(${sql.param(ids)}::uuid[])`);
  return Object.fromEntries(
    rows
      .map((r) => [r.id, toImage(r.image)])
      .filter((e): e is [string, StoreImage] => e[1] !== null),
  );
}

/**
 * What every page shows: the store, its theme, the menu and the footer. The
 * shopper's language is `locale`, or the store's default when null; `lang`
 * is what the page's own query should use.
 */
export async function storeLayout(
  tx: TenantTx,
  locale: Locale | null,
  which: 'published' | 'draft' = 'published',
): Promise<PageResult<StoreLayout> & { lang: Lang }> {
  const row = await storeRow(tx);
  const lang: Lang = { locale: locale ?? row.defaultLocale, fallback: row.defaultLocale };
  const theme = themeOf(row.settings, which);
  const images = await themeImages(tx, lang, theme);
  const links = await slugsById(tx, lang, themeLinkTargets(theme));
  const categories = await storeCategories(tx, lang);
  const pages = await storePageLinks(tx, lang);
  return {
    lang,
    data: {
      locale: lang.locale,
      store: {
        name: row.name,
        slug: row.slug,
        defaultLocale: row.defaultLocale,
        profile: row.settings.profile,
      },
      theme,
      images,
      links,
      categories,
      pages,
      storefront: row.settings.storefront,
      numerals: row.settings.display.numerals ?? null,
      shop: {
        accounts: row.settings.checkout.accounts,
        termsCheckbox: row.settings.checkout.termsCheckbox,
        email: row.settings.checkout.email,
      },
    },
    tags: [storeTag(tx.tenantId)],
  };
}

const cardTags = (tenantId: string, cards: readonly ProductCard[]) =>
  cards.map((c) => productTag(tenantId, c.id));

export interface HomeData {
  /** Category grid sections: their categories with a picture (the first product's image). */
  categoryGrids: Record<string, (StoreCategory & { image: StoreImage | null })[]>;
  collectionCarousels: Record<string, (StoreCollection & { image: StoreImage | null })[]>;
  productGrids: Record<string, ProductCard[]>;
}

async function categoryImages(
  tx: TenantTx,
  lang: Lang,
  ids: string[],
): Promise<Record<string, StoreImage>> {
  if (!ids.length) return {};
  const { rows } = await tx.db.execute<{ id: string; image: Parameters<typeof toImage>[0] }>(sql`
    select k.id, (select ${imageJson(sql`md`, lang)}
                    from store.product_categories pc
                    join store.products p on p.id = pc.product_id and p.status = 'active'
                    join store.product_media pm on pm.product_id = p.id and pm.position = 0
                    join store.media md on md.id = pm.media_id
                   where pc.category_id = k.id order by pc.position, p.created_at desc limit 1) as image
      from store.categories k where k.id = any(${sql.param(ids)}::uuid[])`);
  return Object.fromEntries(
    rows
      .map((r) => [r.id, toImage(r.image)])
      .filter((e): e is [string, StoreImage] => e[1] !== null),
  );
}

/** The homepage: the layout's sections, filled with their categories, collections and products. */
export async function homePage(
  tx: TenantTx,
  lang: Lang,
  theme: Theme,
): Promise<PageResult<HomeData>> {
  const data: HomeData = { categoryGrids: {}, collectionCarousels: {}, productGrids: {} };
  const tags = [storeTag(tx.tenantId), listsTag(tx.tenantId)];
  let categories: StoreCategory[] | null = null;
  for (const section of theme.sections) {
    if (section.type === 'category_grid') {
      categories ??= await storeCategories(tx, lang);
      const all = categories;
      const chosen = section.categoryIds.length
        ? section.categoryIds
            .map((id) => all.find((c) => c.id === id))
            .filter((c): c is StoreCategory => Boolean(c))
        : all.filter((c) => c.parentId === null).slice(0, 12);
      const images = await categoryImages(
        tx,
        lang,
        chosen.map((c) => c.id),
      );
      data.categoryGrids[section.id] = chosen.map((c) => ({ ...c, image: images[c.id] ?? null }));
    } else if (section.type === 'collection_carousel') {
      data.collectionCarousels[section.id] = await storeCollections(
        tx,
        lang,
        section.collectionIds.length ? section.collectionIds : undefined,
      ).then((list) => list.slice(0, 12));
    } else if (section.type === 'product_grid') {
      const scope = section.collectionId
        ? ({ type: 'collection', collectionId: section.collectionId } as const)
        : ({ type: 'all' } as const);
      const listing = await listPublishedProducts(
        tx,
        lang,
        scope,
        parseListingQuery(
          new URLSearchParams(section.collectionId ? '' : 'sort=newest'),
          'collection',
        ),
        { pageSize: section.limit, facets: false },
      );
      data.productGrids[section.id] = listing.items;
      tags.push(...cardTags(tx.tenantId, listing.items));
    }
  }
  return { data, tags };
}

export type Found<T> = { found: T } | { redirect: string } | null;

export interface ProductPageData {
  product: StoreProduct;
  related: ProductCard[];
}

/** A product page: the product and related products, or a redirect for an old slug. */
export async function productPage(
  tx: TenantTx,
  lang: Lang,
  slug: string,
  options: { related: boolean } = { related: true },
): Promise<PageResult<Found<ProductPageData>>> {
  const hit = await publishedProductBySlug(tx, lang, slug);
  if (!hit || 'redirect' in hit)
    return { data: hit, tags: [storeTag(tx.tenantId), listsTag(tx.tenantId)] };
  const related = options.related ? await relatedProducts(tx, lang, hit.found) : [];
  return {
    data: { found: { product: hit.found, related } },
    // Related products' tags too, so an archived one never stays linked for a day.
    tags: [
      storeTag(tx.tenantId),
      productTag(tx.tenantId, hit.found.id),
      ...cardTags(tx.tenantId, related),
    ],
  };
}

export interface ListingPageData<T> {
  entity: T;
  listing: Listing;
  query: ListingQuery;
}

const listingTags = (tenantId: string, listing: Listing) => [
  storeTag(tenantId),
  listsTag(tenantId),
  ...cardTags(tenantId, listing.items),
];

/** A category page: the category, its children's links come from the layout's menu. */
export async function categoryPage(
  tx: TenantTx,
  lang: Lang,
  slug: string,
  query: ListingQuery,
): Promise<PageResult<Found<ListingPageData<StoreCategory>>>> {
  const hit = await publishedCategoryBySlug(tx, lang, slug);
  if (!hit || 'redirect' in hit)
    return { data: hit, tags: [storeTag(tx.tenantId), listsTag(tx.tenantId)] };
  const listing = await listPublishedProducts(
    tx,
    lang,
    { type: 'category', categoryId: hit.found.id },
    query,
  );
  return {
    data: { found: { entity: hit.found, listing, query } },
    tags: listingTags(tx.tenantId, listing),
  };
}

export async function collectionPage(
  tx: TenantTx,
  lang: Lang,
  slug: string,
  query: ListingQuery,
): Promise<PageResult<Found<ListingPageData<StoreCollection>>>> {
  const hit = await publishedCollectionBySlug(tx, lang, slug);
  if (!hit || 'redirect' in hit)
    return { data: hit, tags: [storeTag(tx.tenantId), listsTag(tx.tenantId)] };
  const listing = await listPublishedProducts(
    tx,
    lang,
    { type: 'collection', collectionId: hit.found.id },
    query,
  );
  return {
    data: { found: { entity: hit.found, listing, query } },
    tags: listingTags(tx.tenantId, listing),
  };
}

/** Search results; an empty query lists nothing (the page shows the search box). */
export async function searchPage(
  tx: TenantTx,
  lang: Lang,
  query: ListingQuery,
): Promise<PageResult<{ listing: Listing | null; query: ListingQuery }>> {
  if (!query.q)
    return { data: { listing: null, query }, tags: [storeTag(tx.tenantId), listsTag(tx.tenantId)] };
  const listing = await listPublishedProducts(tx, lang, { type: 'search', q: query.q }, query);
  return { data: { listing, query }, tags: listingTags(tx.tenantId, listing) };
}

export async function staticPage(
  tx: TenantTx,
  lang: Lang,
  slug: string,
): Promise<PageResult<Found<StorePage>>> {
  const hit = await publishedPageBySlug(tx, lang, slug);
  const tags = [storeTag(tx.tenantId)];
  if (hit && 'found' in hit) tags.push(pageTag(tx.tenantId, hit.found.id));
  else tags.push(listsTag(tx.tenantId));
  return { data: hit, tags };
}

export interface SitemapEntry {
  slugs: Partial<Record<Locale, string>>;
  updatedAt: string;
}

/** One sitemap's entries, with each entity's slug in every language (§3.6); at most 50,000. */
export async function sitemapPart(
  tx: TenantTx,
  part: SitemapPart,
): Promise<PageResult<SitemapEntry[]>> {
  const sources: Record<SitemapPart, ReturnType<typeof sql>> = {
    products: sql`select json_object_agg(t.locale, t.slug) as slugs, max(p.updated_at) as "updatedAt"
      from store.products p join store.product_translations t on t.product_id = p.id
     where p.status = 'active' group by p.id order by max(p.updated_at) desc`,
    categories: sql`select json_object_agg(t.locale, t.slug) as slugs, max(k.updated_at) as "updatedAt"
      from store.categories k join store.category_translations t on t.category_id = k.id
     group by k.id order by max(k.updated_at) desc`,
    collections: sql`select json_object_agg(t.locale, t.slug) as slugs, max(c.updated_at) as "updatedAt"
      from store.collections c join store.collection_translations t on t.collection_id = c.id
     where c.published group by c.id order by max(c.updated_at) desc`,
    pages: sql`select json_object_agg(t.locale, t.slug) as slugs, max(pg.updated_at) as "updatedAt"
      from store.pages pg join store.page_translations t on t.page_id = pg.id
     where pg.published group by pg.id order by max(pg.updated_at) desc`,
  };
  const { rows } = await tx.db.execute<{ slugs: SitemapEntry['slugs']; updatedAt: string }>(
    sql`${sources[part]} limit 50000`,
  );
  return {
    data: rows.map((r) => ({ slugs: r.slugs, updatedAt: new Date(r.updatedAt).toISOString() })),
    tags: [storeTag(tx.tenantId), listsTag(tx.tenantId)],
  };
}

/** A theme link as the storefront needs it: a route and slug, a search, a URL, or nothing. */
export type ResolvedLink =
  | { kind: 'product' | 'category' | 'collection' | 'page'; slug: string }
  | { kind: 'search'; q: string }
  | { kind: 'url'; url: string };

export function resolveLink(
  link: ThemeLink | null | undefined,
  links: LinkTargets,
): ResolvedLink | null {
  if (!link) return null;
  if (link.type === 'url') return { kind: 'url', url: link.url };
  if (link.type === 'search') return { kind: 'search', q: link.q };
  const slug = links[link.type][link.id];
  return slug ? { kind: link.type, slug } : null;
}
