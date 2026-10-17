// Catalog and inventory routes under /v1/admin (phase-2-plan §6). Request
// bodies use the shared schemas the services validate again; each service
// checks its own permission. Another store's IDs answer 404 (RLS hides the
// rows), and every route with an ID is in the isolation suite.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  adjustInventory,
  archiveProduct,
  bulkUpdateVariants,
  collectionProducts,
  createAttribute,
  createCategory,
  createCollection,
  createProduct,
  deleteAttribute,
  deleteCategory,
  deleteCollection,
  deleteProduct,
  exportProducts,
  getProduct,
  listAttributes,
  listCategories,
  listCollections,
  listInventory,
  listLocations,
  listMovements,
  listProducts,
  moveCategory,
  runIdempotent,
  setAttributeValues,
  setCategoryAttributes,
  setCollectionProducts,
  setProductOptions,
  suggestOptions,
  suggestTags,
  templateAttributes,
  updateAttribute,
  updateCategory,
  updateCollection,
  updateLocation,
  updateProduct,
  updateVariant,
} from '@managemind/core';
import {
  attributeCreate,
  attributePatch,
  attributeValues,
  bulkVariantPatch,
  categoryCreate,
  categoryMove,
  categoryPatch,
  collectionCreate,
  collectionPatch,
  collectionRules,
  inventoryAdjustments,
  productCreate,
  productOptions,
  productPatch,
  variantPatch,
} from '@managemind/shared/catalog';
import type { Context } from 'hono';
import { inStore, type StaffEnv } from './context';

const Id = z.object({ id: z.uuid() });
const Locale = z.enum(['bn', 'en']);
const translated = <T extends z.ZodType>(value: T) =>
  z.object({ bn: value.optional(), en: value.optional() });
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  200: { content: { 'application/json': { schema } }, description },
});
const created = <T extends z.ZodType>(schema: T, description: string) => ({
  201: { content: { 'application/json': { schema } }, description },
});
const ok = (description: string) => ({ 204: { description } });
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});
const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
const limit = z.coerce.number().int().min(1).max(100).optional();
const flag = z.enum(['true', 'false']).optional();

// ---- Response shapes -----------------------------------------------------------------

const RichText = z
  .unknown()
  .openapi({ description: 'ProseMirror JSON (the description whitelist)' });
const Variant = z
  .object({
    id: z.uuid(),
    optionValueIds: z.array(z.uuid()),
    sku: z.string().nullable(),
    barcode: z.string().nullable(),
    price: z.number().int(),
    compareAtPrice: z.number().int().nullable(),
    salePrice: z.number().int().nullable(),
    saleStartsAt: z.string().nullable(),
    saleEndsAt: z.string().nullable(),
    costPrice: z
      .number()
      .int()
      .nullable()
      .optional()
      .openapi({ description: 'Only with catalog.cost' }),
    weightGrams: z.number().int().nullable(),
    trackInventory: z.boolean(),
    allowBackorder: z.boolean(),
    lowStockThreshold: z.number().int().nullable(),
    imageMediaId: z.uuid().nullable(),
    position: z.number().int(),
    stock: z
      .object({ onHand: z.number().int(), reserved: z.number().int(), available: z.number().int() })
      .optional()
      .openapi({ description: 'Only with inventory.read' }),
  })
  .openapi('Variant');
export const Product = z
  .object({
    id: z.uuid(),
    status: z.enum(['draft', 'active', 'archived']),
    vatCategory: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    translations: translated(
      z.object({
        title: z.string(),
        slug: z.string(),
        description: RichText,
        seoTitle: z.string().nullable(),
        seoDescription: z.string().nullable(),
      }),
    ),
    options: z.array(
      z.object({
        id: z.uuid(),
        position: z.number().int(),
        name: translated(z.string()),
        values: z.array(
          z.object({ id: z.uuid(), position: z.number().int(), label: translated(z.string()) }),
        ),
      }),
    ),
    variants: z.array(Variant),
    media: z.array(
      z.object({
        mediaId: z.uuid(),
        position: z.number().int(),
        mime: z.string(),
        width: z.number().int(),
        height: z.number().int(),
        files: z.array(
          z.object({ width: z.number().int(), sha256: z.string(), bytes: z.number().int() }),
        ),
        alt: translated(z.string()),
      }),
    ),
    categoryIds: z.array(z.uuid()),
    collectionIds: z.array(z.uuid()),
    attributes: z.array(
      z.object({
        attributeId: z.uuid(),
        key: z.string(),
        type: z.string(),
        valueIds: z.array(z.uuid()),
        number: z.number().nullable(),
        boolean: z.boolean().nullable(),
        text: translated(z.string()),
      }),
    ),
    tags: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Product');
const ProductSummary = z
  .object({
    id: z.uuid(),
    status: z.enum(['draft', 'active', 'archived']),
    titles: translated(z.string()),
    minPrice: z.number().int().nullable(),
    maxPrice: z.number().int().nullable(),
    variantCount: z.number().int(),
    available: z.number().int().nullable().optional(),
    lowStock: z.boolean().optional(),
    imageMediaId: z.uuid().nullable(),
    imageFile: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ProductSummary');
const NameTranslations = translated(
  z.object({ name: z.string(), slug: z.string(), description: RichText }),
);
const Category = z
  .object({
    id: z.uuid(),
    parentId: z.uuid().nullable(),
    depth: z.number().int(),
    position: z.number().int(),
    translations: NameTranslations,
    attributeIds: z.array(z.uuid()),
    productCount: z.number().int(),
  })
  .openapi('Category');
const Collection = z
  .object({
    id: z.uuid(),
    kind: z.enum(['manual', 'rule']),
    rules: z.unknown().nullable(),
    sort: z.string(),
    published: z.boolean(),
    translations: NameTranslations,
    productCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Collection');
const CollectionProduct = z.object({
  id: z.uuid(),
  status: z.string(),
  titles: translated(z.string()),
  minPrice: z.number().int().nullable(),
});
const Attribute = z
  .object({
    id: z.uuid(),
    key: z.string(),
    type: z.enum(['choice', 'multi_choice', 'number', 'text', 'boolean']),
    filterable: z.boolean(),
    visible: z.boolean(),
    isSystem: z.boolean(),
    position: z.number().int(),
    name: translated(z.string()),
    unit: translated(z.string()),
    values: z.array(
      z.object({ id: z.uuid(), position: z.number().int(), label: translated(z.string()) }),
    ),
    productCount: z.number().int(),
  })
  .openapi('Attribute');
const Level = z.object({
  variantId: z.uuid(),
  locationId: z.uuid(),
  onHand: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
});
const InventoryRow = z
  .object({
    variantId: z.uuid(),
    productId: z.uuid(),
    titles: translated(z.string()),
    optionLabels: z.array(translated(z.string())),
    sku: z.string().nullable(),
    trackInventory: z.boolean(),
    allowBackorder: z.boolean(),
    lowStockThreshold: z.number().int().nullable(),
    onHand: z.number().int(),
    reserved: z.number().int(),
    available: z.number().int(),
    lowStock: z.boolean(),
  })
  .openapi('InventoryRow');
const MovementRow = z
  .object({
    id: z.uuid(),
    locationId: z.uuid(),
    type: z.enum(['receive', 'sale', 'reservation', 'release', 'adjustment', 'return']),
    quantity: z.number().int(),
    reason: z.string(),
    note: z.string().nullable(),
    referenceType: z.string().nullable(),
    referenceId: z.uuid().nullable(),
    actorType: z.string(),
    actorId: z.uuid().nullable(),
    createdAt: z.string(),
  })
  .openapi('StockMovement');
const Location = z
  .object({
    id: z.uuid(),
    name: z.string(),
    isDefault: z.boolean(),
    address: z
      .object({ line1: z.string(), line2: z.string().optional(), city: z.string().optional() })
      .nullable(),
  })
  .openapi('StockLocation');

// ---- Routes ----------------------------------------------------------------------------

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['catalog'] } as C & {
    tags: string[];
  });

export const CATALOG_ROUTES = {
  products: r({
    method: 'get',
    path: '/products',
    summary: 'Products, newest first, with search and filters (catalog.read)',
    request: {
      query: z.object({
        q: z.string().max(100).optional(),
        status: z.enum(['draft', 'active', 'archived']).optional(),
        categoryId: z.uuid().optional(),
        collectionId: z.uuid().optional(),
        brandValueId: z.uuid().optional(),
        tag: z.string().max(50).optional(),
        attributeValueId: z.uuid().optional(),
        lowStock: flag,
        after: z.uuid().optional(),
        limit,
      }),
    },
    responses: json(page(ProductSummary), 'Products'),
  }),
  exportProducts: r({
    method: 'get',
    path: '/products/export',
    summary: 'Whole products for the export, a page at a time, with the list’s filters',
    request: {
      query: z.object({
        q: z.string().max(100).optional(),
        status: z.enum(['draft', 'active', 'archived']).optional(),
        categoryId: z.uuid().optional(),
        collectionId: z.uuid().optional(),
        brandValueId: z.uuid().optional(),
        tag: z.string().max(50).optional(),
        lowStock: flag,
        after: z.uuid().optional(),
        limit,
      }),
    },
    responses: json(
      z.object({ items: z.array(Product), nextCursor: z.string().nullable() }),
      'Products',
    ),
  }),
  createProduct: r({
    method: 'post',
    path: '/products',
    summary: 'Create a product (catalog.write; accepts Idempotency-Key)',
    request: body(productCreate),
    responses: created(Product, 'Created'),
  }),
  product: r({
    method: 'get',
    path: '/products/{id}',
    summary: 'A product with translations, options, variants, media, attributes and tags',
    request: { params: Id },
    responses: json(Product, 'Product'),
  }),
  updateProduct: r({
    method: 'patch',
    path: '/products/{id}',
    summary: 'Edit a product (catalog.write)',
    request: { params: Id, ...body(productPatch) },
    responses: json(Product, 'Product'),
  }),
  setOptions: r({
    method: 'put',
    path: '/products/{id}/options',
    summary: 'Replace the options and regenerate the variants (catalog.write)',
    request: { params: Id, ...body(productOptions) },
    responses: json(Product, 'Product'),
  }),
  archiveProduct: r({
    method: 'post',
    path: '/products/{id}/archive',
    summary: 'Archive a product (catalog.write)',
    request: { params: Id },
    responses: json(Product, 'Product'),
  }),
  deleteProduct: r({
    method: 'delete',
    path: '/products/{id}',
    summary: 'Delete a draft that has no history (catalog.write)',
    request: { params: Id },
    responses: ok('Deleted'),
  }),
  updateVariant: r({
    method: 'patch',
    path: '/variants/{id}',
    summary: 'Edit a variant (catalog.write; cost prices need catalog.cost)',
    request: { params: Id, ...body(variantPatch) },
    responses: json(Variant, 'Variant'),
  }),
  bulkVariants: r({
    method: 'patch',
    path: '/variants',
    summary: 'Bulk price, compare-at and threshold edits, at most 200 (catalog.write)',
    request: body(bulkVariantPatch),
    responses: json(z.object({ updated: z.number().int() }), 'Updated'),
  }),
  movements: r({
    method: 'get',
    path: '/variants/{id}/movements',
    summary: "A variant's stock ledger, newest first (inventory.read)",
    request: { params: Id, query: z.object({ before: z.uuid().optional(), limit }) },
    responses: json(page(MovementRow), 'Movements'),
  }),

  categories: r({
    method: 'get',
    path: '/categories',
    summary: 'The category tree (catalog.read)',
    responses: json(z.array(Category), 'Categories'),
  }),
  createCategory: r({
    method: 'post',
    path: '/categories',
    summary: 'Create a category (catalog.write)',
    request: body(categoryCreate),
    responses: created(Category, 'Created'),
  }),
  updateCategory: r({
    method: 'patch',
    path: '/categories/{id}',
    summary: 'Rename a category (catalog.write)',
    request: { params: Id, ...body(categoryPatch) },
    responses: json(Category, 'Category'),
  }),
  moveCategory: r({
    method: 'post',
    path: '/categories/{id}/move',
    summary: 'Move a category under another, or reorder it (catalog.write)',
    request: { params: Id, ...body(categoryMove) },
    responses: json(Category, 'Category'),
  }),
  deleteCategory: r({
    method: 'delete',
    path: '/categories/{id}',
    summary: 'Delete an empty category (catalog.write)',
    request: { params: Id },
    responses: ok('Deleted'),
  }),
  categoryTemplate: r({
    method: 'put',
    path: '/categories/{id}/attributes',
    summary: "Set the category's attribute template (catalog.write)",
    request: { params: Id, ...body(z.array(z.uuid()).max(100)) },
    responses: json(Category, 'Category'),
  }),
  templateAttributes: r({
    method: 'get',
    path: '/template-attributes',
    summary: 'The template attributes of categories and their parents, nearest first',
    request: { query: z.object({ categoryIds: z.string().max(2000) }) },
    responses: json(z.array(z.uuid()), 'Attribute IDs'),
  }),

  attributes: r({
    method: 'get',
    path: '/attributes',
    summary: 'Attributes with their values (catalog.read)',
    responses: json(z.array(Attribute), 'Attributes'),
  }),
  createAttribute: r({
    method: 'post',
    path: '/attributes',
    summary: 'Create an attribute (catalog.write)',
    request: body(attributeCreate),
    responses: created(Attribute, 'Created'),
  }),
  updateAttribute: r({
    method: 'patch',
    path: '/attributes/{id}',
    summary: 'Rename, re-flag or move an attribute (catalog.write)',
    request: { params: Id, ...body(attributePatch) },
    responses: json(Attribute, 'Attribute'),
  }),
  deleteAttribute: r({
    method: 'delete',
    path: '/attributes/{id}',
    summary: 'Delete an attribute and its values from every product; never the brand',
    request: { params: Id },
    responses: json(z.object({ removedFrom: z.number().int() }), 'Deleted'),
  }),
  attributeValues: r({
    method: 'put',
    path: '/attributes/{id}/values',
    summary: "Replace a choice attribute's values (catalog.write)",
    request: { params: Id, ...body(attributeValues) },
    responses: json(Attribute, 'Attribute'),
  }),
  tags: r({
    method: 'get',
    path: '/tags',
    summary: "The store's tags by prefix, most used first",
    request: { query: z.object({ prefix: z.string().max(50).default(''), limit }) },
    responses: json(z.array(z.object({ tag: z.string(), count: z.number().int() })), 'Tags'),
  }),
  optionSuggestions: r({
    method: 'get',
    path: '/option-suggestions',
    summary: "The store's option names and values by prefix",
    request: {
      query: z.object({
        locale: Locale,
        prefix: z.string().max(100).optional(),
        name: z.string().max(100).optional(),
        limit,
      }),
    },
    responses: json(
      z.object({
        names: z.array(z.object({ name: z.string(), count: z.number().int() })),
        values: z.array(z.object({ label: z.string(), count: z.number().int() })),
      }),
      'Suggestions',
    ),
  }),

  collections: r({
    method: 'get',
    path: '/collections',
    summary: 'Collections (catalog.read)',
    responses: json(z.array(Collection), 'Collections'),
  }),
  createCollection: r({
    method: 'post',
    path: '/collections',
    summary: 'Create a manual or rule-based collection (catalog.write)',
    request: body(collectionCreate),
    responses: created(Collection, 'Created'),
  }),
  updateCollection: r({
    method: 'patch',
    path: '/collections/{id}',
    summary: 'Edit a collection (catalog.write)',
    request: { params: Id, ...body(collectionPatch) },
    responses: json(Collection, 'Collection'),
  }),
  deleteCollection: r({
    method: 'delete',
    path: '/collections/{id}',
    summary: 'Delete a collection (catalog.write)',
    request: { params: Id },
    responses: ok('Deleted'),
  }),
  collectionOrder: r({
    method: 'put',
    path: '/collections/{id}/products',
    summary: "A manual collection's products, in order (catalog.write)",
    request: { params: Id, ...body(z.array(z.uuid()).max(1000)) },
    responses: json(Collection, 'Collection'),
  }),
  collectionProducts: r({
    method: 'get',
    path: '/collections/{id}/products',
    summary: "A collection's products in its order; for rules, what they match now",
    request: {
      params: Id,
      query: z.object({ limit, offset: z.coerce.number().int().min(0).optional() }),
    },
    responses: json(
      z.object({ items: z.array(CollectionProduct), total: z.number().int() }),
      'Products',
    ),
  }),
  collectionPreview: r({
    method: 'post',
    path: '/collections/{id}/preview',
    summary: 'What unsaved rules would match (the live preview)',
    request: { params: Id, ...body(collectionRules) },
    responses: json(
      z.object({ items: z.array(CollectionProduct), total: z.number().int() }),
      'Products',
    ),
  }),

  inventory: r({
    method: 'get',
    path: '/inventory',
    summary: 'Stock per variant (inventory.read)',
    request: {
      query: z.object({
        lowStock: flag,
        locationId: z.uuid().optional(),
        q: z.string().max(100).optional(),
        after: z.uuid().optional(),
        limit,
      }),
    },
    responses: json(page(InventoryRow), 'Inventory'),
  }),
  adjustInventory: r({
    method: 'post',
    path: '/inventory/adjustments',
    summary: 'Receive, count or write off stock (inventory.write; accepts Idempotency-Key)',
    request: body(inventoryAdjustments),
    responses: json(
      z.object({
        applied: z.number().int(),
        skipped: z.number().int(),
        levels: z.array(Level),
      }),
      'Applied',
    ),
  }),
  locations: r({
    method: 'get',
    path: '/locations',
    summary: 'Stock locations, the default first (inventory.read)',
    responses: json(z.array(Location), 'Locations'),
  }),
  updateLocation: r({
    method: 'patch',
    path: '/locations/{id}',
    summary: "A location's name and address (settings.write)",
    request: {
      params: Id,
      ...body(
        z.object({
          name: z.string().trim().min(1).max(100).optional(),
          address: z
            .object({
              line1: z.string().trim().min(1).max(200),
              line2: z.string().trim().min(1).max(200).optional(),
              city: z.string().trim().min(1).max(100).optional(),
            })
            .nullable()
            .optional(),
        }),
      ),
    },
    responses: json(Location, 'Location'),
  }),
} as const;

/** Runs `fn` once per Idempotency-Key, replaying the first result (product create, adjustments). */
async function idempotent<T>(
  c: Context<StaffEnv>,
  scope: string,
  input: unknown,
  status: number,
  fn: Parameters<typeof inStore<T>>[1],
): Promise<T> {
  const key = c.req.header('idempotency-key');
  const result = await inStore<{ body: unknown }>(
    c,
    (tx) =>
      key
        ? runIdempotent(tx, { scope, key, request: input }, async () => ({
            status,
            body: await fn(tx),
          }))
        : fn(tx).then((value) => ({ body: value })),
    { write: true },
  );
  return result.body as T;
}

export function registerCatalog(admin: OpenAPIHono<StaffEnv>): void {
  const R = CATALOG_ROUTES;
  const actor = (c: Context<StaffEnv>) => c.var.staff.actor;
  const write = { write: true };

  admin.openapi(R.products, async (c) => {
    const { lowStock, ...query } = c.req.valid('query');
    const result = await inStore(c, (tx) =>
      listProducts(tx, actor(c), { ...query, lowStock: lowStock === 'true' }),
    );
    return c.json(result, 200);
  });
  admin.openapi(R.exportProducts, async (c) => {
    const { lowStock, ...query } = c.req.valid('query');
    return c.json(
      await inStore(c, (tx) =>
        exportProducts(tx, actor(c), { ...query, lowStock: lowStock === 'true' }),
      ),
      200,
    );
  });
  admin.openapi(R.createProduct, async (c) => {
    const input = c.req.valid('json');
    const product = await idempotent(c, 'admin.product.create', input, 201, (tx) =>
      createProduct(tx, actor(c), input),
    );
    return c.json(product as never, 201);
  });
  admin.openapi(R.product, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(await inStore(c, (tx) => getProduct(tx, actor(c), id)), 200);
  });
  admin.openapi(R.updateProduct, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => updateProduct(tx, actor(c), id, input), write), 200);
  });
  admin.openapi(R.setOptions, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => setProductOptions(tx, actor(c), id, input), write), 200);
  });
  admin.openapi(R.archiveProduct, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(await inStore(c, (tx) => archiveProduct(tx, actor(c), id), write), 200);
  });
  admin.openapi(R.deleteProduct, async (c) => {
    const { id } = c.req.valid('param');
    await inStore(c, (tx) => deleteProduct(tx, actor(c), id), write);
    return c.body(null, 204);
  });
  admin.openapi(R.updateVariant, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => updateVariant(tx, actor(c), id, input), write), 200);
  });
  admin.openapi(R.bulkVariants, async (c) => {
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => bulkUpdateVariants(tx, actor(c), input), write), 200);
  });
  admin.openapi(R.movements, async (c) => {
    const { id } = c.req.valid('param');
    const query = c.req.valid('query');
    return c.json(await inStore(c, (tx) => listMovements(tx, actor(c), id, query)), 200);
  });

  admin.openapi(R.categories, async (c) =>
    c.json(await inStore(c, (tx) => listCategories(tx, actor(c))), 200),
  );
  admin.openapi(R.createCategory, async (c) => {
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => createCategory(tx, actor(c), input), write), 201);
  });
  admin.openapi(R.updateCategory, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => updateCategory(tx, actor(c), id, input), write), 200);
  });
  admin.openapi(R.moveCategory, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => moveCategory(tx, actor(c), id, input), write), 200);
  });
  admin.openapi(R.deleteCategory, async (c) => {
    const { id } = c.req.valid('param');
    await inStore(c, (tx) => deleteCategory(tx, actor(c), id), write);
    return c.body(null, 204);
  });
  admin.openapi(R.categoryTemplate, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(
      await inStore(c, (tx) => setCategoryAttributes(tx, actor(c), id, input), write),
      200,
    );
  });
  admin.openapi(R.templateAttributes, async (c) => {
    const ids = c.req
      .valid('query')
      .categoryIds.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const parsed = z.array(z.uuid()).max(20).safeParse(ids);
    if (!parsed.success) return c.json([], 200);
    return c.json(await inStore(c, (tx) => templateAttributes(tx, actor(c), parsed.data)), 200);
  });

  admin.openapi(R.attributes, async (c) =>
    c.json(await inStore(c, (tx) => listAttributes(tx, actor(c))), 200),
  );
  admin.openapi(R.createAttribute, async (c) => {
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => createAttribute(tx, actor(c), input), write), 201);
  });
  admin.openapi(R.updateAttribute, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => updateAttribute(tx, actor(c), id, input), write), 200);
  });
  admin.openapi(R.deleteAttribute, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(await inStore(c, (tx) => deleteAttribute(tx, actor(c), id), write), 200);
  });
  admin.openapi(R.attributeValues, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(
      await inStore(c, (tx) => setAttributeValues(tx, actor(c), id, input), write),
      200,
    );
  });
  admin.openapi(R.tags, async (c) => {
    const { prefix, limit: n } = c.req.valid('query');
    return c.json(await inStore(c, (tx) => suggestTags(tx, actor(c), prefix, n)), 200);
  });
  admin.openapi(R.optionSuggestions, async (c) => {
    const query = c.req.valid('query');
    return c.json(await inStore(c, (tx) => suggestOptions(tx, actor(c), query)), 200);
  });

  admin.openapi(R.collections, async (c) =>
    c.json(await inStore(c, (tx) => listCollections(tx, actor(c))), 200),
  );
  admin.openapi(R.createCollection, async (c) => {
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => createCollection(tx, actor(c), input), write), 201);
  });
  admin.openapi(R.updateCollection, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => updateCollection(tx, actor(c), id, input), write), 200);
  });
  admin.openapi(R.deleteCollection, async (c) => {
    const { id } = c.req.valid('param');
    await inStore(c, (tx) => deleteCollection(tx, actor(c), id), write);
    return c.body(null, 204);
  });
  admin.openapi(R.collectionOrder, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(
      await inStore(c, (tx) => setCollectionProducts(tx, actor(c), id, input), write),
      200,
    );
  });
  admin.openapi(R.collectionProducts, async (c) => {
    const { id } = c.req.valid('param');
    const query = c.req.valid('query');
    return c.json(await inStore(c, (tx) => collectionProducts(tx, actor(c), id, query)), 200);
  });
  admin.openapi(R.collectionPreview, async (c) => {
    const { id } = c.req.valid('param');
    const rules = c.req.valid('json');
    return c.json(await inStore(c, (tx) => collectionProducts(tx, actor(c), id, { rules })), 200);
  });

  admin.openapi(R.inventory, async (c) => {
    const { lowStock, ...query } = c.req.valid('query');
    return c.json(
      await inStore(c, (tx) =>
        listInventory(tx, actor(c), { ...query, lowStock: lowStock === 'true' }),
      ),
      200,
    );
  });
  admin.openapi(R.adjustInventory, async (c) => {
    const input = c.req.valid('json');
    const result = await idempotent(c, 'admin.inventory.adjust', input, 200, (tx) =>
      adjustInventory(tx, actor(c), input),
    );
    return c.json(result as never, 200);
  });
  admin.openapi(R.locations, async (c) =>
    c.json(await inStore(c, (tx) => listLocations(tx, actor(c))), 200),
  );
  admin.openapi(R.updateLocation, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => updateLocation(tx, actor(c), id, input), write), 200);
  });
}
