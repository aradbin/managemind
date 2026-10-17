// The storefront's catalog reads (phase-3-plan §3.5, §3.7, §9): published
// only, slugs and redirects, filters and facets, price sort, search with
// Bangla spelling variants, and the availability event.
import { permissionsOf } from '@managemind/shared';
import { type ListingQuery, parseListingQuery } from '@managemind/shared/storefront/listing';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  archiveProduct,
  brandAttributeId,
  bulkUpdateVariants,
  createCategory,
  createCollection,
  createProduct,
  createTenant,
  type Lang,
  listPublishedProducts,
  publishedCategoryBySlug,
  publishedCollectionBySlug,
  publishedProduct,
  publishedProductBySlug,
  receive,
  relatedProducts,
  sell,
  setAttributeValues,
  setCollectionProducts,
  setProductOptions,
  systemActor,
  type TenantTx,
  updateAttribute,
  updateProduct,
  updateVariant,
  withTenant,
} from '../src';
import { connectApp } from './setup';

let app: pg.Client;
let store: string;
let owner: Actor;
const en: Lang = { locale: 'en', fallback: 'bn' };
const bn: Lang = { locale: 'bn', fallback: 'bn' };

beforeAll(async () => {
  app = await connectApp();
  const slug = `pub${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Published test',
      defaultLocale: 'bn',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  owner = {
    kind: 'user',
    userId: '0199d000-0000-7000-8000-0000000000ab',
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId: store,
    storeRole: 'owner',
  };
});
afterAll(() => app.end());

const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);
const query = (qs = '', kind: 'category' | 'collection' | 'search' = 'category'): ListingQuery =>
  parseListingQuery(new URLSearchParams(qs), kind);

let n = 0;
const product = (
  bnTitle: string,
  extra: { translations?: object } & Record<string, unknown> = {},
  price = 100_000,
  status: 'active' | 'draft' = 'active',
) => {
  const { translations, ...rest } = extra;
  return run((tx) =>
    createProduct(tx, owner, {
      status,
      translations: { bn: { title: bnTitle, slug: `p-${Date.now()}-${n++}` }, ...translations },
      variant: { price, sku: `SKU-${Date.now()}-${n++}` },
      ...rest,
    }),
  );
};

describe('published products', () => {
  it('finds active products by slug, in either language, never drafts or archived ones', async () => {
    const shirt = await product('শার্ট', {
      translations: { en: { title: 'Shirt', slug: 'shirt-pub' } },
    });
    const draft = await product('খসড়া', {}, 100_000, 'draft');
    const bnSlug = shirt.translations.bn?.slug as string;

    const byBn = await run((tx) => publishedProductBySlug(tx, bn, bnSlug));
    expect(byBn && 'found' in byBn && byBn.found.title).toBe('শার্ট');
    const byEn = await run((tx) => publishedProductBySlug(tx, en, 'shirt-pub'));
    expect(byEn && 'found' in byEn && byEn.found).toMatchObject({
      title: 'Shirt',
      slugs: { bn: bnSlug, en: 'shirt-pub' },
    });
    // The default language's slug under the other language redirects to that language's own.
    const fallback = await run((tx) => publishedProductBySlug(tx, en, bnSlug));
    expect(fallback).toEqual({ redirect: 'shirt-pub' });

    expect(
      await run((tx) => publishedProductBySlug(tx, bn, draft.translations.bn?.slug as string)),
    ).toBeNull();
    await run((tx) => archiveProduct(tx, owner, shirt.id));
    expect(await run((tx) => publishedProductBySlug(tx, bn, bnSlug))).toBeNull();
  });

  it('redirects an old slug to the current one', async () => {
    const p = await product('পাঞ্জাবি');
    const old = p.translations.bn?.slug as string;
    await run((tx) =>
      updateProduct(tx, owner, p.id, {
        translations: { bn: { title: 'পাঞ্জাবি', slug: `panjabi-${n++}` } },
      }),
    );
    const hit = await run((tx) => publishedProductBySlug(tx, bn, old));
    expect(hit).toEqual({ redirect: expect.stringMatching(/^panjabi-/) });
  });

  it('shows variants as available or not, with no stock counts or costs', async () => {
    const p = await product('জুতা');
    const variant = p.variants[0]?.id as string;
    await run((tx) => updateVariant(tx, owner, variant, { costPrice: 50_000 }));
    let page = await run((tx) => publishedProduct(tx, bn, p.id));
    expect(page?.variants[0]).toEqual({
      id: variant,
      optionValueIds: [],
      sku: expect.any(String),
      price: 100_000,
      compareAtPrice: null,
      available: false,
      imageMediaId: null,
    });
    await run((tx) => receive(tx, owner, { variantId: variant, quantity: 2, reason: 'received' }));
    page = await run((tx) => publishedProduct(tx, bn, p.id));
    expect(page?.variants[0]?.available).toBe(true);
    expect(JSON.stringify(page)).not.toContain('50000');
  });
});

describe('price range', () => {
  it('keeps price_min and price_max through variant edits, options and bulk edits', async () => {
    const p = await product('শাড়ি দাম', {}, 200_000);
    const range = async () => {
      const { rows } = await app.query<{ price_min: string; price_max: string }>(
        'select price_min, price_max from store.products where id = $1',
        [p.id],
      );
      return rows[0];
    };
    // The app role reads through RLS only inside a tenant transaction.
    const read = () => run(async () => range());
    expect(await read()).toEqual({ price_min: '200000', price_max: '200000' });

    const withOptions = await run((tx) =>
      setProductOptions(tx, owner, p.id, [
        { name: { bn: 'সাইজ' }, values: [{ label: { bn: 'S' } }, { label: { bn: 'L' } }] },
      ]),
    );
    const [s, l] = withOptions.variants.map((v) => v.id) as [string, string];
    await run((tx) => updateVariant(tx, owner, l, { price: 300_000 }));
    expect(await read()).toEqual({ price_min: '200000', price_max: '300000' });
    await run((tx) => bulkUpdateVariants(tx, owner, [{ id: s, price: 150_000 }]));
    expect(await read()).toEqual({ price_min: '150000', price_max: '300000' });
  });
});

describe('listings', () => {
  let category: string;
  let red: string;
  let cheap: string;
  let dear: string;
  let middle: string;

  beforeAll(async () => {
    category = (
      await run((tx) =>
        createCategory(tx, owner, { translations: { bn: { name: 'পোশাক', slug: `cloth-${n++}` } } }),
      )
    ).id;
    const brand = await run((tx) => brandAttributeId(tx));
    await run((tx) => updateAttribute(tx, owner, brand, { filterable: true }));
    const values = await run((tx) =>
      setAttributeValues(tx, owner, brand, [
        { label: { bn: 'আড়ং', en: 'Aarong' } },
        { label: { bn: 'ইয়েলো', en: 'Yellow' } },
      ]),
    );
    const [aarong, yellow] = values.values.map((v) => v.id) as [string, string];
    const make = async (title: string, price: number, brandValue: string, colour: string) => {
      const p = await product(
        title,
        {
          categoryIds: [category],
          attributes: [{ type: 'choice', attributeId: brand, valueIds: [brandValue] }],
        },
        price,
      );
      const withOptions = await run((tx) =>
        setProductOptions(tx, owner, p.id, [
          { name: { bn: 'রং', en: 'Colour' }, values: [{ label: { bn: colour } }] },
        ]),
      );
      await run((tx) =>
        updateVariant(tx, owner, withOptions.variants[0]?.id as string, {
          price,
          trackInventory: false,
        }),
      );
      return p.id;
    };
    cheap = await make('সস্তা জামা', 50_000, aarong, 'লাল');
    middle = await make('মাঝারি জামা', 100_000, yellow, 'নীল');
    dear = await make('দামি জামা', 300_000, aarong, 'লাল');
    red = 'লাল';
    // A draft in the category never shows.
    await product('খসড়া জামা', { categoryIds: [category] }, 10_000, 'draft');
  });

  const list = (qs = '', scope = { type: 'category' as const, categoryId: category }) =>
    run((tx) => listPublishedProducts(tx, bn, scope, query(qs)));

  it('lists active products with a total and pages', async () => {
    const page = await list();
    expect(page.items.map((i) => i.id).sort()).toEqual([cheap, middle, dear].sort());
    expect(page).toMatchObject({ total: 3, page: 1, pageCount: 1 });
    const second = await run((tx) =>
      listPublishedProducts(tx, bn, { type: 'category', categoryId: category }, query('page=2'), {
        pageSize: 2,
      }),
    );
    expect(second).toMatchObject({ total: 3, page: 2, pageCount: 2 });
    expect(second.items).toHaveLength(1);
  });

  it('sorts by price with price_min', async () => {
    expect((await list('sort=price_asc')).items.map((i) => i.id)).toEqual([cheap, middle, dear]);
    expect((await list('sort=price_desc')).items.map((i) => i.id)).toEqual([dear, middle, cheap]);
  });

  it('filters by price, brand and option, with facet counts', async () => {
    expect((await list('min=600&max=1000')).items.map((i) => i.id)).toEqual([middle]);
    const byBrand = await list('a.brand=আড়ং');
    expect(byBrand.items.map((i) => i.id).sort()).toEqual([cheap, dear].sort());
    // English labels filter too.
    expect((await list('a.brand=aarong')).total).toBe(2);
    expect((await list(`o.রং=${red}`)).total).toBe(2);
    expect((await list(`o.রং=${red}&a.brand=ইয়েলো`)).total).toBe(0);

    const facets = byBrand.facets;
    expect(facets?.price).toEqual({ min: 50_000, max: 300_000 });
    const brand = facets?.groups.find((g) => g.key === 'brand');
    expect(brand?.values).toEqual([
      { key: 'আড়ং', label: 'আড়ং', count: 2, selected: true },
      { key: 'ইয়েলো', label: 'ইয়েলো', count: 1, selected: false },
    ]);
    const colour = facets?.groups.find((g) => g.type === 'option');
    expect(colour).toMatchObject({ key: 'রং', name: 'রং' });
    expect(colour?.values.map((v) => [v.key, v.count])).toEqual(
      expect.arrayContaining([
        ['লাল', 2],
        ['নীল', 1],
      ]),
    );
  });

  it('filters to products in stock', async () => {
    const tracked = await product('স্টক জামা', { categoryIds: [category] }, 70_000);
    expect((await list('stock=1')).items.map((i) => i.id)).not.toContain(tracked.id);
    expect((await list()).items.map((i) => i.id)).toContain(tracked.id);
    await run((tx) => archiveProduct(tx, owner, tracked.id));
  });

  it('lists published collections only, in their order', async () => {
    const collection = await run((tx) =>
      createCollection(tx, owner, {
        kind: 'manual',
        published: true,
        translations: { bn: { name: 'বাছাই', slug: `picks-${n++}` } },
      }),
    );
    await run((tx) => setCollectionProducts(tx, owner, collection.id, [dear, cheap]));
    const page = await run((tx) =>
      listPublishedProducts(
        tx,
        bn,
        { type: 'collection', collectionId: collection.id },
        query('', 'collection'),
      ),
    );
    expect(page.items.map((i) => i.id)).toEqual([dear, cheap]);
    const slug = collection.translations.bn?.slug as string;
    expect(await run((tx) => publishedCollectionBySlug(tx, bn, slug))).toMatchObject({
      found: { id: collection.id },
    });

    const hidden = await run((tx) =>
      createCollection(tx, owner, {
        kind: 'manual',
        translations: { bn: { name: 'গোপন', slug: `hidden-${n++}` } },
      }),
    );
    expect(
      await run((tx) => publishedCollectionBySlug(tx, bn, hidden.translations.bn?.slug as string)),
    ).toBeNull();
    const none = await run((tx) =>
      listPublishedProducts(
        tx,
        bn,
        { type: 'collection', collectionId: hidden.id },
        query('', 'collection'),
      ),
    );
    expect(none.total).toBe(0);
  });

  it('finds categories by slug and related products', async () => {
    const { rows } = await run((tx) =>
      tx.db.execute<{ slug: string }>(
        sql`select slug from store.category_translations where category_id = ${category}`,
      ),
    );
    const hit = await run((tx) => publishedCategoryBySlug(tx, bn, rows[0]?.slug as string));
    expect(hit).toMatchObject({ found: { id: category, name: 'পোশাক' } });
    const related = await run((tx) =>
      relatedProducts(tx, bn, { id: cheap, categoryIds: [category] }),
    );
    expect(related.map((r) => r.id).sort()).toEqual([middle, dear].sort());
  });
});

describe('search', () => {
  const search = (q: string, lang = bn) =>
    run((tx) =>
      listPublishedProducts(
        tx,
        lang,
        { type: 'search', q },
        query(`q=${encodeURIComponent(q)}`, 'search'),
      ),
    );

  it('finds Bangla spelling variants, English titles, SKUs and tags', async () => {
    const saree = await product('লাল জামদানি শাড়ি', {
      translations: { en: { title: 'Red Jamdani Saree', slug: `red-saree-${n++}` } },
      tags: ['উৎসব'],
    });
    const draft = await product('নীল শাড়ি খসড়া', {}, 100_000, 'draft');
    const ids = async (q: string) => (await search(q)).items.map((i) => i.id);

    expect(await ids('শাড়ী')).toContain(saree.id); // long ī for short i
    expect(await ids('জামদানী শাড়ী')).toContain(saree.id);
    expect(await ids('saree')).toContain(saree.id);
    expect(await ids('উৎসব')).toContain(saree.id);
    const sku = saree.variants[0]?.sku as string;
    expect(await ids(sku.slice(0, 8).toLowerCase())).toContain(saree.id);
    expect(await ids('শাড়ি')).not.toContain(draft.id);
    expect(await ids('কম্পিউটার')).toEqual([]);
  });

  it('caps results at 48', async () => {
    const marker = `zx${Date.now().toString(36)}`;
    for (let i = 0; i < 50; i++) await product(`${marker} item ${i}`);
    const page = await search(marker);
    expect(page.total).toBe(48);
    expect(page.pageCount).toBe(2);
    const second = await run((tx) =>
      listPublishedProducts(
        tx,
        bn,
        { type: 'search', q: marker },
        query(`q=${marker}&page=2`, 'search'),
      ),
    );
    expect(second.items).toHaveLength(24);
    const third = await run((tx) =>
      listPublishedProducts(
        tx,
        bn,
        { type: 'search', q: marker },
        query(`q=${marker}&page=3`, 'search'),
      ),
    );
    expect(third.items).toHaveLength(0);
  });
});

describe('inventory.availability.changed', () => {
  it('fires only when a variant’s available stock crosses zero', async () => {
    const p = await product('ঘড়ি');
    const variant = p.variants[0]?.id as string;
    const events = async (fn: (tx: TenantTx) => Promise<unknown>) =>
      run(async (tx) => {
        await fn(tx);
        return tx.events
          .filter((e) => e.eventType === 'inventory.availability.changed')
          .map((e) => e.payload);
      });
    expect(
      await events((tx) =>
        receive(tx, owner, { variantId: variant, quantity: 3, reason: 'received' }),
      ),
    ).toEqual([{ productIds: [p.id] }]);
    expect(
      await events((tx) =>
        receive(tx, owner, { variantId: variant, quantity: 1, reason: 'received' }),
      ),
    ).toEqual([]);
    expect(
      await events((tx) => sell(tx, owner, { variantId: variant, quantity: 3, reason: 'sale' })),
    ).toEqual([]);
    expect(
      await events((tx) => sell(tx, owner, { variantId: variant, quantity: 1, reason: 'sale' })),
    ).toEqual([{ productIds: [p.id] }]);
  });

  it('never fires for untracked or backordered variants', async () => {
    const p = await product('ছাতা');
    const variant = p.variants[0]?.id as string;
    await run((tx) => updateVariant(tx, owner, variant, { trackInventory: false }));
    const fired = await run(async (tx) => {
      await receive(tx, owner, { variantId: variant, quantity: 3, reason: 'received' });
      return tx.events.some((e) => e.eventType === 'inventory.availability.changed');
    });
    expect(fired).toBe(false);
  });
});
