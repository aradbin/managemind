import { permissionsOf, type StoreRole } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  archiveProduct,
  brandAttributeId,
  bulkUpdateVariants,
  collectionProducts,
  createAttribute,
  createCategory,
  createCollection,
  createProduct,
  createTenant,
  deleteAttribute,
  deleteCategory,
  deleteProduct,
  getAttribute,
  getProduct,
  listCategories,
  listProducts,
  moveCategory,
  type ProductDetail,
  resolveRedirect,
  setAttributeValues,
  setCategoryAttributes,
  setCollectionProducts,
  setProductOptions,
  suggestOptions,
  suggestTags,
  systemActor,
  type TenantTx,
  templateAttributes,
  updateAttribute,
  updateProduct,
  updateVariant,
  withTenant,
} from '../src';
import { connectApp } from './setup';

let app: pg.Client;
let store: string;
let other: string;
beforeAll(async () => {
  app = await connectApp();
  const make = async (defaultLocale: 'bn' | 'en') => {
    const slug = `cat${Date.now().toString(36)}${defaultLocale}`;
    return (
      await createTenant(app, systemActor, {
        slug,
        name: 'Catalog test',
        defaultLocale,
        owner: { email: `${slug}@example.test`, name: 'Owner' },
      })
    ).id;
  };
  store = await make('en');
  other = await make('bn');
});
afterAll(() => app.end());

const actorFor = (role: StoreRole, tenantId = store): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000aa',
  platformRole: null,
  permissions: permissionsOf(role),
  tenantId,
  storeRole: role,
});
const owner = actorFor('owner');
const staff = actorFor('staff');

const run = <T>(fn: (tx: TenantTx) => Promise<T>, tenantId = store) =>
  withTenant(app, tenantId, fn);

const option = (name: string, labels: string[], from?: ProductDetail['options'][number]) => ({
  ...(from ? { id: from.id } : {}),
  name: { en: name },
  values: labels.map((label) => {
    const existing = from?.values.find((v) => v.label.en === label);
    return { ...(existing ? { id: existing.id } : {}), label: { en: label } };
  }),
});

const labelsOf = (product: ProductDetail) =>
  product.variants.map((variant) =>
    variant.optionValueIds
      .map((id) => product.options.flatMap((o) => o.values).find((v) => v.id === id)?.label.en)
      .join('/'),
  );

let seq = 0;
const title = (base: string) => `${base} ${++seq}`;

describe('products', () => {
  it('creates a product with a slug, a variant and audit/event rows', async () => {
    const product = await run((tx) =>
      createProduct(tx, owner, {
        translations: { en: { title: 'Cotton Shirt' }, bn: { title: 'সুতির শার্ট' } },
        variant: { price: 125_000, sku: 'CS-1', costPrice: 80_000 },
        tags: ['Summer'],
      }),
    );
    expect(product.translations.en?.slug).toBe('cotton-shirt');
    expect(product.translations.bn?.slug).toBe('সুতির-শার্ট');
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0]).toMatchObject({ price: 125_000, sku: 'CS-1', costPrice: 80_000 });
    expect(product.tags).toEqual(['summer']);
    const { rows } = await app.query(
      `select (select count(*) from store.audit_log where entity_id = $1)::int as audits,
              (select count(*) from store.outbox where aggregate_id = $1)::int as events`,
      [product.id],
    );
    expect(rows[0]).toEqual({ audits: 0, events: 0 }); // no tenant set outside withTenant: RLS shows nothing
    const counts = await run(async (tx) => {
      const { rows: r } = await tx.db.execute<{ audits: number; events: number }>(
        sql`select (select count(*) from store.audit_log where entity_id = ${product.id})::int as audits,
               (select count(*) from store.outbox where aggregate_id = ${product.id} and event_type = 'catalog.product.created')::int as events`,
      );
      return r[0];
    });
    expect(counts).toEqual({ audits: 1, events: 1 });
  });

  it('numbers repeated slugs, refuses a taken one, and needs the default language', async () => {
    const make = (t: object) => run((tx) => createProduct(tx, owner, t));
    const a = await make({ translations: { en: { title: 'Same Name' } } });
    const b = await make({ translations: { en: { title: 'Same Name' } } });
    expect([a.translations.en?.slug, b.translations.en?.slug]).toEqual([
      'same-name',
      'same-name-2',
    ]);
    await expect(
      make({ translations: { en: { title: 'X', slug: 'same-name' } } }),
    ).rejects.toMatchObject({
      code: 'catalog_slug_taken',
    });
    await expect(make({ translations: { bn: { title: 'শুধু বাংলা' } } })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('leaves a redirect when a slug changes, and a live slug wins over it', async () => {
    const product = await run((tx) =>
      createProduct(tx, owner, { translations: { en: { title: 'Old Name' } } }),
    );
    await run((tx) =>
      updateProduct(tx, owner, product.id, {
        translations: { en: { title: 'New Name', slug: 'new-name' } },
      }),
    );
    expect(await run((tx) => resolveRedirect(tx, 'product', 'en', 'old-name'))).toBe(product.id);
    // Rename twice: both old slugs point at the product, never at each other.
    await run((tx) =>
      updateProduct(tx, owner, product.id, {
        translations: { en: { title: 'N', slug: 'newest-name' } },
      }),
    );
    expect(await run((tx) => resolveRedirect(tx, 'product', 'en', 'new-name'))).toBe(product.id);
    // Another product takes the old slug: the redirect goes away.
    await run((tx) =>
      createProduct(tx, owner, { translations: { en: { title: 'x', slug: 'old-name' } } }),
    );
    expect(await run((tx) => resolveRedirect(tx, 'product', 'en', 'old-name'))).toBeNull();
  });

  it('keeps SKUs unique per store', async () => {
    const sku = `SKU-${Date.now()}`;
    await run((tx) =>
      createProduct(tx, owner, {
        translations: { en: { title: title('A') } },
        variant: { price: 1, sku },
      }),
    );
    await expect(
      run((tx) =>
        createProduct(tx, owner, {
          translations: { en: { title: title('B') } },
          variant: { price: 1, sku: sku.toLowerCase() },
        }),
      ),
    ).rejects.toMatchObject({ code: 'sku_taken' });
    // Another store may use the same SKU.
    await run(
      (tx) =>
        createProduct(tx, actorFor('owner', other), {
          translations: { bn: { title: 'খ' } },
          variant: { price: 1, sku },
        }),
      other,
    );
  });

  it('publishes only with a title in the default language and a price', async () => {
    await expect(
      run((tx) =>
        createProduct(tx, owner, {
          status: 'active',
          translations: { en: { title: title('Free') } },
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const product = await run((tx) =>
      createProduct(tx, owner, {
        status: 'active',
        translations: { en: { title: title('Priced') } },
        variant: { price: 500 },
      }),
    );
    expect(product.status).toBe('active');
  });

  it('hides cost prices without catalog.cost, and refuses to set them', async () => {
    const product = await run((tx) =>
      createProduct(tx, owner, {
        translations: { en: { title: title('Cost') } },
        variant: { price: 100, costPrice: 60 },
      }),
    );
    const seen = await run((tx) => getProduct(tx, staff, product.id));
    expect(seen.variants[0]).not.toHaveProperty('costPrice');
    const variantId = product.variants[0]?.id as string;
    await expect(
      run((tx) => updateVariant(tx, staff, variantId, { costPrice: 10 })),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(run((tx) => getProduct(tx, actorFor('viewer'), product.id))).resolves.toBeTruthy();
    await expect(
      run((tx) => createProduct(tx, actorFor('viewer'), { translations: { en: { title: 'x' } } })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('archives anything and deletes only drafts', async () => {
    const product = await run((tx) =>
      createProduct(tx, owner, {
        status: 'active',
        translations: { en: { title: title('Del') } },
        variant: { price: 5 },
      }),
    );
    await expect(run((tx) => deleteProduct(tx, owner, product.id))).rejects.toMatchObject({
      code: 'in_use',
    });
    expect((await run((tx) => archiveProduct(tx, owner, product.id))).status).toBe('archived');
    const draft = await run((tx) =>
      createProduct(tx, owner, { translations: { en: { title: title('Draft') } } }),
    );
    await run((tx) => deleteProduct(tx, owner, draft.id));
    await expect(run((tx) => getProduct(tx, owner, draft.id))).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('edits variants with checks and bulk edits prices', async () => {
    const product = await run((tx) =>
      createProduct(tx, owner, {
        translations: { en: { title: title('V') } },
        variant: { price: 1000 },
      }),
    );
    const id = product.variants[0]?.id as string;
    await expect(
      run((tx) => updateVariant(tx, owner, id, { compareAtPrice: 900 })),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
    expect(
      (await run((tx) => updateVariant(tx, owner, id, { compareAtPrice: 1500, sku: `V-${seq}` })))
        .compareAtPrice,
    ).toBe(1500);
    expect(await run((tx) => bulkUpdateVariants(tx, owner, [{ id, price: 1200 }]))).toEqual({
      updated: 1,
    });
    expect((await run((tx) => getProduct(tx, owner, product.id))).variants[0]?.price).toBe(1200);
  });
});

describe('options and variants', () => {
  it('generates combinations and keeps variants through edits', async () => {
    let product = await run((tx) =>
      createProduct(tx, owner, {
        translations: { en: { title: title('Tee') } },
        variant: { price: 500, sku: `T-${seq}` },
      }),
    );
    const original = product.variants[0]?.id;
    product = await run((tx) =>
      setProductOptions(tx, owner, product.id, [option('Size', ['S', 'M'])]),
    );
    expect(labelsOf(product)).toEqual(['S', 'M']);
    // The original variant (with its SKU and price) became the first combination.
    expect(product.variants[0]?.id).toBe(original);
    expect(product.variants[0]?.price).toBe(500);
    expect(product.variants[1]?.price).toBe(500);
    const [s, m] = product.variants.map((v) => v.id);

    // Add a value and an option: S and M keep their rows, taking Red.
    product = await run((tx) =>
      setProductOptions(tx, owner, product.id, [
        option('Size', ['S', 'M', 'L'], product.options[0]),
        option('Colour', ['Red', 'Blue']),
      ]),
    );
    expect(labelsOf(product)).toEqual(['S/Red', 'S/Blue', 'M/Red', 'M/Blue', 'L/Red', 'L/Blue']);
    expect(product.variants[0]?.id).toBe(s);
    expect(product.variants[2]?.id).toBe(m);

    // Rename a value: same IDs, same variants.
    const renamed = product.options[1] as ProductDetail['options'][number];
    product = await run((tx) =>
      setProductOptions(tx, owner, product.id, [
        option('Size', ['S', 'M', 'L'], product.options[0]),
        {
          id: renamed.id,
          name: { en: 'Colour' },
          values: renamed.values.map((v) => ({
            id: v.id,
            label: { en: v.label.en === 'Red' ? 'Crimson' : 'Blue' },
          })),
        },
      ]),
    );
    expect(product.variants[0]?.id).toBe(s);
    expect(labelsOf(product)[0]).toBe('S/Crimson');

    // Remove M: its variants are archived, not deleted.
    const sizes = product.options[0] as ProductDetail['options'][number];
    product = await run((tx) =>
      setProductOptions(tx, owner, product.id, [
        {
          id: sizes.id,
          name: { en: 'Size' },
          values: sizes.values
            .filter((v) => v.label.en !== 'M')
            .map((v) => ({ id: v.id, label: v.label })),
        },
        {
          id: product.options[1]?.id,
          name: { en: 'Colour' },
          values: product.options[1]?.values.map((v) => ({ id: v.id, label: v.label })),
        },
      ]),
    );
    expect(labelsOf(product)).toEqual(['S/Crimson', 'S/Blue', 'L/Crimson', 'L/Blue']);
    const archived = await run(async (tx) => {
      const { rows } = await tx.db.execute<{ id: string }>(
        sql`select id from store.variants where product_id = ${product.id} and archived_at is not null`,
      );
      return rows.map((r) => r.id);
    });
    expect(archived).toContain(m);

    // Remove the colour option: one variant per size survives.
    product = await run((tx) =>
      setProductOptions(tx, owner, product.id, [option('Size', ['S', 'L'], product.options[0])]),
    );
    expect(labelsOf(product)).toEqual(['S', 'L']);
    expect(product.variants[0]?.id).toBe(s);

    // No options at all: back to one variant.
    product = await run((tx) => setProductOptions(tx, owner, product.id, []));
    expect(product.variants.map((v) => v.id)).toEqual([s]);
  });

  it('refuses IDs from another product and too many variants', async () => {
    const a = await run((tx) =>
      createProduct(tx, owner, { translations: { en: { title: title('A') } } }),
    );
    const b = await run(async (tx) =>
      setProductOptions(
        tx,
        owner,
        (await createProduct(tx, owner, { translations: { en: { title: title('B') } } })).id,
        [option('Size', ['S'])],
      ),
    );
    await expect(
      run((tx) => setProductOptions(tx, owner, a.id, [option('Size', ['S'], b.options[0])])),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const many = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
    await expect(
      run((tx) =>
        setProductOptions(tx, owner, a.id, [option('A', many(11)), option('B', many(10))]),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('suggests the store’s option names and values', async () => {
    const result = await run((tx) => suggestOptions(tx, owner, { locale: 'en', prefix: 'si' }));
    expect(result.names[0]?.name).toBe('Size');
    const sizes = await run((tx) => suggestOptions(tx, owner, { locale: 'en', name: 'size' }));
    expect(sizes.values.map((v) => v.label)).toContain('S');
  });
});

describe('categories', () => {
  it('keeps the tree at 3 levels and refuses cycles', async () => {
    const root = await run((tx) =>
      createCategory(tx, owner, { translations: { en: { name: title('Clothing') } } }),
    );
    const mid = await run((tx) =>
      createCategory(tx, owner, {
        parentId: root.id,
        translations: { en: { name: title('Men') } },
      }),
    );
    const leaf = await run((tx) =>
      createCategory(tx, owner, {
        parentId: mid.id,
        translations: { en: { name: title('Shirts') } },
      }),
    );
    await expect(
      run((tx) =>
        createCategory(tx, owner, {
          parentId: leaf.id,
          translations: { en: { name: 'Too deep' } },
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      run((tx) => moveCategory(tx, owner, root.id, { parentId: leaf.id })),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
    // A 3-level branch can't move under another category.
    const other = await run((tx) =>
      createCategory(tx, owner, { translations: { en: { name: title('Other') } } }),
    );
    await expect(
      run((tx) => moveCategory(tx, owner, root.id, { parentId: other.id })),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
    const moved = await run((tx) =>
      moveCategory(tx, owner, leaf.id, { parentId: other.id, position: 0 }),
    );
    expect(moved).toMatchObject({ parentId: other.id, depth: 1, position: 0 });
    const tree = await run((tx) => listCategories(tx, owner));
    expect(tree.find((c) => c.id === leaf.id)?.depth).toBe(1);
  });

  it('deletes only empty categories', async () => {
    const category = await run((tx) =>
      createCategory(tx, owner, { translations: { en: { name: title('Busy') } } }),
    );
    const child = await run((tx) =>
      createCategory(tx, owner, {
        parentId: category.id,
        translations: { en: { name: title('Kid') } },
      }),
    );
    await expect(run((tx) => deleteCategory(tx, owner, category.id))).rejects.toMatchObject({
      code: 'in_use',
    });
    await run((tx) =>
      createProduct(tx, owner, {
        translations: { en: { title: title('In') } },
        categoryIds: [child.id],
      }),
    );
    await expect(run((tx) => deleteCategory(tx, owner, child.id))).rejects.toMatchObject({
      code: 'in_use',
    });
  });

  it('collects template attributes from a category and its parents', async () => {
    const fabric = await run((tx) =>
      createAttribute(tx, owner, {
        key: `fabric_${seq++}`,
        type: 'choice',
        translations: { en: { name: 'Fabric' } },
      }),
    );
    const fit = await run((tx) =>
      createAttribute(tx, owner, {
        key: `fit_${seq++}`,
        type: 'choice',
        translations: { en: { name: 'Fit' } },
      }),
    );
    const root = await run((tx) =>
      createCategory(tx, owner, { translations: { en: { name: title('Apparel') } } }),
    );
    const leaf = await run((tx) =>
      createCategory(tx, owner, {
        parentId: root.id,
        translations: { en: { name: title('Tops') } },
      }),
    );
    await run((tx) => setCategoryAttributes(tx, owner, root.id, [fabric.id]));
    await run((tx) => setCategoryAttributes(tx, owner, leaf.id, [fit.id]));
    expect(await run((tx) => templateAttributes(tx, owner, [leaf.id]))).toEqual([
      fit.id,
      fabric.id,
    ]);
  });
});

describe('attributes and tags', () => {
  it('stores typed values, refuses wrong types and keeps the brand', async () => {
    const ram = await run((tx) =>
      createAttribute(tx, owner, {
        key: `ram_${seq++}`,
        type: 'number',
        filterable: true,
        translations: { en: { name: 'RAM', unit: 'GB' } },
      }),
    );
    const brand = await run((tx) => brandAttributeId(tx));
    const withValues = await run((tx) =>
      setAttributeValues(tx, owner, brand, [
        { label: { en: 'Aarong' } },
        { label: { en: 'Yellow' } },
      ]),
    );
    const aarong = withValues.values[0]?.id as string;
    const product = await run((tx) =>
      createProduct(tx, owner, {
        translations: { en: { title: title('Phone') } },
        attributes: [
          { type: 'number', attributeId: ram.id, number: 8 },
          { type: 'choice', attributeId: brand, valueIds: [aarong] },
        ],
      }),
    );
    expect(product.attributes.map((a) => [a.key, a.valueIds, a.number])).toEqual(
      expect.arrayContaining([
        ['brand', [aarong], null],
        [ram.key, [], 8],
      ]),
    );
    await expect(
      run((tx) =>
        updateProduct(tx, owner, product.id, {
          attributes: [{ type: 'choice', attributeId: ram.id, valueIds: [] }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(run((tx) => deleteAttribute(tx, owner, brand))).rejects.toMatchObject({
      code: 'in_use',
    });
    await expect(
      run((tx) => setAttributeValues(tx, owner, brand, [{ label: { en: 'Yellow' } }])),
    ).rejects.toMatchObject({ code: 'in_use' });
    expect((await run((tx) => updateAttribute(tx, owner, brand, { visible: false }))).visible).toBe(
      false,
    );
    expect(await run((tx) => deleteAttribute(tx, owner, ram.id))).toEqual({ removedFrom: 1 });
  });

  it('suggests tags by prefix, most used first', async () => {
    for (const tags of [['eid-offer', 'eid-sale'], ['eid-sale']]) {
      await run((tx) =>
        createProduct(tx, owner, { translations: { en: { title: title('Tagged') } }, tags }),
      );
    }
    const suggestions = await run((tx) => suggestTags(tx, owner, 'EID'));
    expect(suggestions.map((s) => s.tag).slice(0, 2)).toEqual(['eid-sale', 'eid-offer']);
  });
});

describe('collections and the product list', () => {
  it('matches rule collections in SQL, including tag, brand and attribute rules', async () => {
    const brand = await run((tx) => brandAttributeId(tx));
    const current = await run((tx) => getAttribute(tx, owner, brand));
    const brands = await run((tx) =>
      setAttributeValues(tx, owner, brand, [
        ...current.values.map((v) => ({ id: v.id, label: v.label })),
        { label: { en: `Rule Brand ${seq}` } },
      ]),
    );
    const ruleBrand = brands.values[brands.values.length - 1]?.id as string;
    const weight = await run((tx) =>
      createAttribute(tx, owner, {
        key: `weight_${seq++}`,
        type: 'number',
        translations: { en: { name: 'Weight' } },
      }),
    );
    const tag = `rule-${seq}`;
    const make = (name: string, extra: object) =>
      run((tx) => createProduct(tx, owner, { translations: { en: { title: name } }, ...extra }));
    const hit = await make(title('Hit'), {
      tags: [tag],
      variant: { price: 60_000 },
      attributes: [
        { type: 'choice', attributeId: brand, valueIds: [ruleBrand] },
        { type: 'number', attributeId: weight.id, number: 2.5 },
      ],
    });
    await make(title('Cheap'), {
      tags: [tag],
      variant: { price: 100 },
      attributes: [{ type: 'choice', attributeId: brand, valueIds: [ruleBrand] }],
    });
    await make(title('Untagged'), { variant: { price: 60_000 } });
    const collection = await run((tx) =>
      createCollection(tx, owner, {
        kind: 'rule',
        translations: { en: { name: title('Rules') } },
        rules: {
          conditions: [
            { type: 'tag', tag },
            { type: 'brand', valueId: ruleBrand },
            { type: 'price', min: 50_000, max: null },
            { type: 'attribute_range', attributeId: weight.id, min: 2, max: 3 },
          ],
        },
      }),
    );
    const { items, total } = await run((tx) => collectionProducts(tx, owner, collection.id));
    expect(total).toBe(1);
    expect(items[0]?.id).toBe(hit.id);
    const listed = await run((tx) => listProducts(tx, owner, { collectionId: collection.id }));
    expect(listed.items.map((p) => p.id)).toEqual([hit.id]);
  });

  it('orders manual collections by hand', async () => {
    const a = await run((tx) =>
      createProduct(tx, owner, { translations: { en: { title: title('M1') } } }),
    );
    const b = await run((tx) =>
      createProduct(tx, owner, { translations: { en: { title: title('M2') } } }),
    );
    const collection = await run((tx) =>
      createCollection(tx, owner, {
        kind: 'manual',
        translations: { en: { name: title('Picks') } },
      }),
    );
    await run((tx) => setCollectionProducts(tx, owner, collection.id, [b.id, a.id]));
    const { items } = await run((tx) => collectionProducts(tx, owner, collection.id));
    expect(items.map((p) => p.id)).toEqual([b.id, a.id]);
  });

  it('lists products newest first with search, filters and cursors', async () => {
    const marker = `Zebra${Date.now()}`;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        (
          await run((tx) =>
            createProduct(tx, owner, {
              translations: { en: { title: `${marker} ${i}` } },
              variant: { price: 100 * (i + 1) },
            }),
          )
        ).id,
      );
    }
    const page1 = await run((tx) => listProducts(tx, owner, { q: marker.toLowerCase(), limit: 2 }));
    expect(page1.items.map((p) => p.id)).toEqual([ids[2], ids[1]]);
    expect(page1.nextCursor).toBe(ids[1]);
    const page2 = await run((tx) =>
      listProducts(tx, owner, { q: marker, limit: 2, after: page1.nextCursor as string }),
    );
    expect(page2.items.map((p) => p.id)).toEqual([ids[0]]);
    expect(page2.nextCursor).toBeNull();
    expect(page1.items[0]).toMatchObject({
      minPrice: 300,
      maxPrice: 300,
      variantCount: 1,
      titles: { en: `${marker} 2` },
    });
    // Another store sees none of them.
    const elsewhere = await run(
      (tx) => listProducts(tx, actorFor('owner', other), { q: marker }),
      other,
    );
    expect(elsewhere.items).toEqual([]);
  });
});
