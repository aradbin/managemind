// A small demo catalog for the two demo stores (phase-3-plan §8, §12), so
// previews, the E2E suite and Lighthouse have real pages: categories,
// products with options and brands, a collection, static pages and a
// published theme preset. Idempotent: a store that already has the demo
// collection is left alone. Runs through the same core commands and tenant
// transactions as the API, as app_rw, so row-level security applies.
//
//   tsx demo/catalog.ts            (DATABASE_URL_MIGRATIONS or DATABASE_URL)
import {
  type Actor,
  applyThemePreset,
  brandAttributeId,
  createCategory,
  createCollection,
  createPage,
  createProduct,
  listPages,
  publishTheme,
  receive,
  setAttributeValues,
  setCollectionProducts,
  setProductOptions,
  type TenantTx,
  updateAttribute,
  updatePage,
  updateStoreProfile,
  updateVariant,
  withTenant,
} from '@managemind/core';
import { DEMO_TENANTS } from '@managemind/db/seed';
import { permissionsOf } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import pg from 'pg';

type Text = { bn: string; en: string };

interface DemoProduct {
  title: Text;
  category: number;
  brand: number;
  price: number;
  compareAt?: number;
  option?: { name: Text; values: Text[] };
  stock: number;
}

interface DemoStore {
  slug: string;
  preset: 'fashion' | 'grocery' | 'general';
  categories: Text[];
  brands: Text[];
  collection: Text;
  products: DemoProduct[];
}

const size = {
  name: { bn: 'সাইজ', en: 'Size' },
  values: ['S', 'M', 'L', 'XL'].map((s) => ({ bn: s, en: s })),
};
const weight = {
  name: { bn: 'ওজন', en: 'Weight' },
  values: [
    { bn: '৫০০ গ্রাম', en: '500 g' },
    { bn: '১ কেজি', en: '1 kg' },
  ],
};

export const DEMO_CATALOGS: DemoStore[] = [
  {
    slug: 'demo-fashion',
    preset: 'fashion',
    categories: [
      { bn: 'শাড়ি', en: 'Sarees' },
      { bn: 'পাঞ্জাবি', en: 'Panjabis' },
      { bn: 'থ্রি-পিস', en: 'Three-piece' },
    ],
    brands: [
      { bn: 'রঙ', en: 'Rang' },
      { bn: 'দেশাল', en: 'Deshal' },
    ],
    collection: { bn: 'ঈদ কালেকশন', en: 'Eid collection' },
    products: [
      {
        title: { bn: 'লাল জামদানি শাড়ি', en: 'Red Jamdani saree' },
        category: 0,
        brand: 0,
        price: 850_000,
        compareAt: 990_000,
        stock: 5,
      },
      {
        title: { bn: 'নীল সুতি শাড়ি', en: 'Blue cotton saree' },
        category: 0,
        brand: 1,
        price: 320_000,
        stock: 8,
      },
      {
        title: { bn: 'হলুদ মসলিন শাড়ি', en: 'Yellow muslin saree' },
        category: 0,
        brand: 0,
        price: 1_250_000,
        stock: 0,
      },
      {
        title: { bn: 'সাদা সুতি পাঞ্জাবি', en: 'White cotton panjabi' },
        category: 1,
        brand: 1,
        price: 220_000,
        option: size,
        stock: 6,
      },
      {
        title: { bn: 'কালো সিল্ক পাঞ্জাবি', en: 'Black silk panjabi' },
        category: 1,
        brand: 0,
        price: 450_000,
        compareAt: 520_000,
        option: size,
        stock: 3,
      },
      {
        title: { bn: 'সবুজ খাদি পাঞ্জাবি', en: 'Green khadi panjabi' },
        category: 1,
        brand: 1,
        price: 280_000,
        option: size,
        stock: 4,
      },
      {
        title: { bn: 'গোলাপি থ্রি-পিস', en: 'Pink three-piece' },
        category: 2,
        brand: 0,
        price: 390_000,
        option: size,
        stock: 7,
      },
      {
        title: { bn: 'আকাশি থ্রি-পিস', en: 'Sky blue three-piece' },
        category: 2,
        brand: 1,
        price: 350_000,
        stock: 2,
      },
    ],
  },
  {
    slug: 'demo-grocery',
    preset: 'grocery',
    categories: [
      { bn: 'চাল ও ডাল', en: 'Rice and lentils' },
      { bn: 'তেল ও মসলা', en: 'Oil and spices' },
      { bn: 'চা ও কফি', en: 'Tea and coffee' },
    ],
    brands: [
      { bn: 'প্রাণ', en: 'Pran' },
      { bn: 'তীর', en: 'Teer' },
    ],
    collection: { bn: 'আজকের অফার', en: 'Today’s deals' },
    products: [
      {
        title: { bn: 'মিনিকেট চাল', en: 'Miniket rice' },
        category: 0,
        brand: 1,
        price: 7_800,
        option: weight,
        stock: 40,
      },
      {
        title: { bn: 'মসুর ডাল', en: 'Red lentils' },
        category: 0,
        brand: 0,
        price: 11_500,
        compareAt: 12_500,
        option: weight,
        stock: 25,
      },
      {
        title: { bn: 'সয়াবিন তেল ১ লিটার', en: 'Soybean oil 1 litre' },
        category: 1,
        brand: 1,
        price: 18_900,
        stock: 30,
      },
      {
        title: { bn: 'হলুদের গুঁড়া', en: 'Turmeric powder' },
        category: 1,
        brand: 0,
        price: 6_500,
        option: weight,
        stock: 0,
      },
      {
        title: { bn: 'মরিচের গুঁড়া', en: 'Chilli powder' },
        category: 1,
        brand: 0,
        price: 7_000,
        stock: 18,
      },
      {
        title: { bn: 'সিলেটি চা পাতা', en: 'Sylhet tea leaves' },
        category: 2,
        brand: 0,
        price: 24_000,
        compareAt: 26_000,
        stock: 12,
      },
      {
        title: { bn: 'ইনস্ট্যান্ট কফি', en: 'Instant coffee' },
        category: 2,
        brand: 1,
        price: 45_000,
        stock: 9,
      },
      { title: { bn: 'গ্রিন টি', en: 'Green tea' }, category: 2, brand: 0, price: 32_000, stock: 6 },
    ],
  },
];

export const ownerActor = (tenantId: string): Actor => ({
  kind: 'system',
  userId: null,
  platformRole: null,
  permissions: permissionsOf('owner'),
  tenantId,
  storeRole: 'owner',
});

/**
 * Adds the demo catalog to each demo store that doesn't have it yet; returns
 * the slugs filled. `storefront` gives a store its storefront settings
 * (tracking IDs, chat) when its catalog is first added; later edits in the
 * admin are kept.
 */
export async function seedDemoCatalog(
  client: pg.Client,
  storefront: Partial<Record<string, unknown>> = {},
  /** Only this store (a demo store's reset, phase-5b-plan §3.12). */
  onlyTenantId?: string,
): Promise<string[]> {
  const filled: string[] = [];
  // The core relies on row-level security, which the migration role bypasses:
  // each transaction runs as app_rw, like the API (ADR 0009).
  await client.query('grant app_rw to current_user with set true, inherit false');
  for (const demo of DEMO_CATALOGS) {
    const tenant = DEMO_TENANTS.find((t) => t.slug === demo.slug);
    if (!tenant || (onlyTenantId && tenant.id !== onlyTenantId)) continue;
    const { rows } = await client.query<{ id: string }>(
      'select id from platform.tenants where id = $1 and status = $2',
      [tenant.id, 'active'],
    );
    if (!rows[0]) continue;
    const actor = ownerActor(tenant.id);
    // One transaction per store: an interrupted run leaves nothing half-made.
    const added = await withTenant(client, tenant.id, async (tx) => {
      await tx.db.execute(sql`set local role app_rw`);
      const run = <T>(fn: (tx: TenantTx) => Promise<T>) => fn(tx);
      const { rows: existing } = await tx.db.execute<{ n: number }>(
        // A demo store's collection marks the catalog as there.
        sql`select count(*)::int as n from store.collection_translations where slug = ${slugOf(demo.collection.en)}`,
      );
      if ((existing[0]?.n ?? 0) > 0) return false;

      const categoryIds: string[] = [];
      for (const name of demo.categories) {
        const c = await run((tx) =>
          createCategory(tx, actor, {
            translations: { bn: { name: name.bn }, en: { name: name.en, slug: slugOf(name.en) } },
          }),
        );
        categoryIds.push(c.id);
      }
      const brand = await run((tx) => brandAttributeId(tx));
      await run((tx) => updateAttribute(tx, actor, brand, { filterable: true }));
      const brandValues = (
        await run((tx) =>
          setAttributeValues(
            tx,
            actor,
            brand,
            demo.brands.map((b) => ({ label: { bn: b.bn, en: b.en } })),
          ),
        )
      ).values.map((v) => v.id);

      const productIds: string[] = [];
      for (const p of demo.products) {
        const product = await run((tx) =>
          createProduct(tx, actor, {
            status: 'active',
            translations: {
              bn: { title: p.title.bn },
              en: { title: p.title.en, slug: slugOf(p.title.en) },
            },
            variant: {
              price: p.price,
              compareAtPrice: p.compareAt ?? null,
              sku: skuOf(demo.slug, p.title.en),
            },
            categoryIds: [categoryIds[p.category] as string],
            attributes: [
              { type: 'choice', attributeId: brand, valueIds: [brandValues[p.brand] as string] },
            ],
            tags: ['demo'],
          }),
        );
        let variantIds = product.variants.map((v) => v.id);
        if (p.option) {
          const option = p.option;
          const withOptions = await run((tx) =>
            setProductOptions(tx, actor, product.id, [
              {
                name: { bn: option.name.bn, en: option.name.en },
                values: option.values.map((v) => ({ label: { bn: v.bn, en: v.en } })),
              },
            ]),
          );
          variantIds = withOptions.variants.map((v) => v.id);
          for (const [i, id] of variantIds.entries()) {
            await run((tx) =>
              updateVariant(tx, actor, id, {
                price: p.price + i * Math.round(p.price / 10 / 100) * 100,
                compareAtPrice: p.compareAt
                  ? p.compareAt + i * Math.round(p.price / 10 / 100) * 100
                  : null,
                sku: `${skuOf(demo.slug, p.title.en)}-${i + 1}`,
              }),
            );
          }
        }
        if (p.stock > 0) {
          for (const id of variantIds) {
            await run((tx) =>
              receive(tx, actor, { variantId: id, quantity: p.stock, reason: 'received' }),
            );
          }
        }
        productIds.push(product.id);
      }

      const collection = await run((tx) =>
        createCollection(tx, actor, {
          kind: 'manual',
          published: true,
          translations: {
            bn: { name: demo.collection.bn },
            en: { name: demo.collection.en, slug: slugOf(demo.collection.en) },
          },
        }),
      );
      await run((tx) =>
        setCollectionProducts(
          tx,
          actor,
          collection.id,
          productIds.filter((_, i) => i % 2 === 0),
        ),
      );

      for (const [kind, title] of [
        ['about', { bn: 'আমাদের সম্পর্কে', en: 'About us' }],
        ['returns', { bn: 'রিটার্ন নীতি', en: 'Returns' }],
        ['delivery', { bn: 'ডেলিভারি তথ্য', en: 'Delivery' }],
      ] as const) {
        const translations = {
          bn: { title: title.bn },
          en: { title: title.en, slug: slugOf(title.en) },
        };
        // A store made since Phase 5B has its legal pages as drafts: publish those.
        const existing = (await run((tx) => listPages(tx, actor))).find((pg) => pg.kind === kind);
        await run((tx) =>
          existing
            ? updatePage(tx, actor, existing.id, { published: true, translations })
            : createPage(tx, actor, { kind, published: true, translations }),
        );
      }

      const settings = storefront[demo.slug];
      if (settings) await run((tx) => updateStoreProfile(tx, actor, { storefront: settings }));
      await run((tx) => applyThemePreset(tx, actor, demo.preset));
      await run((tx) => publishTheme(tx, actor));
      return true;
    });
    if (added) filled.push(demo.slug);
  }
  return filled;
}

const slugOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const skuOf = (store: string, title: string) =>
  `${store.split('-')[1]?.slice(0, 3).toUpperCase()}-${slugOf(title).toUpperCase().slice(0, 20)}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('Set DATABASE_URL_MIGRATIONS (or DATABASE_URL).');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const filled = await seedDemoCatalog(client);
    console.log(
      filled.length
        ? `Demo catalog added to: ${filled.join(', ')}`
        : 'Demo catalogs already present.',
    );
  } finally {
    await client.end();
  }
}
