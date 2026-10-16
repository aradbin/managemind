// Catalog (phase-2-plan §3–§4): products, options and variants, translations,
// categories, collections, slug redirects, attributes and tags.
//
// Every reference between store tables is a composite foreign key on
// (tenant_id, id). Foreign key checks ignore row-level security, so a plain
// reference to `id` would let one store attach rows to another store's
// product if it knew the UUID; with the tenant in the key it can't.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { media } from './media';
import { store, tenantColumns, tenantPolicy } from './tenant-table';

export const CATALOG_LOCALES = ['bn', 'en'] as const;
export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export const COLLECTION_KINDS = ['manual', 'rule'] as const;
export const COLLECTION_SORTS = [
  'manual',
  'newest',
  'price_asc',
  'price_desc',
  'title_asc',
] as const;
export const SLUG_ENTITY_TYPES = ['product', 'category', 'collection', 'page'] as const;
export const ATTRIBUTE_TYPES = ['choice', 'multi_choice', 'number', 'text', 'boolean'] as const;

const id = () => uuid().primaryKey().default(sql`uuidv7()`);
const ts = () => timestamp({ withTimezone: true });
const createdAt = () => ts().notNull().defaultNow();
const updatedAt = () => ts().notNull().defaultNow();
const money = () => bigint({ mode: 'number' });
const locale = () => text({ enum: CATALOG_LOCALES }).notNull();
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const localeCheck = (table: string, column: AnyPgColumn) =>
  check(`${table}_locale_valid`, sql`${column} in ('bn', 'en')`);
const length = (
  name: string,
  column: AnyPgColumn,
  min: number,
  max: number,
): ReturnType<typeof check> =>
  check(
    name,
    sql`char_length(${column}) between ${sql.raw(String(min))} and ${sql.raw(String(max))}`,
  );
/** Unique (tenant_id, id): the target of composite foreign keys. */
const tenantIdUnique = (table: string, t: { tenantId: AnyPgColumn; id: AnyPgColumn }) =>
  unique(`${table}_tenant_id_unique`).on(t.tenantId, t.id);

/** A composite foreign key that keeps a reference inside its store. */
function ref(
  name: string,
  columns: [AnyPgColumn, ...AnyPgColumn[]],
  foreignColumns: [AnyPgColumn, ...AnyPgColumn[]],
  onDelete: 'cascade' | 'restrict' = 'cascade',
) {
  return foreignKey({ name, columns, foreignColumns }).onDelete(onDelete);
}

/**
 * The database's share of the slug rules (shared/catalog/text.ts has the full
 * ones, which need Unicode classes Postgres regexes lack): lowercase, at most
 * 120 characters, no spaces, URL delimiters or stray hyphens.
 */
const slugCheck = (name: string, column: AnyPgColumn): ReturnType<typeof check> =>
  check(
    name,
    sql`${column} = lower(${column}) and char_length(${column}) between 1 and 120 and ${column} !~ '(^-|-$|--|[[:space:]/?#%&])'`,
  );

// ---- Products, options and variants -----------------------------------------

export const products = store.table(
  'products',
  {
    ...tenantColumns(),
    id: id(),
    status: text({ enum: PRODUCT_STATUSES }).notNull().default('draft'),
    vatCategory: text(),
    metadata: jsonb().notNull().default({}),
    /**
     * The lowest and highest live variant price, kept by the catalog service
     * in the same transaction as any variant change, for price sort and
     * filters (phase-3-plan §3.7). Null without live variants.
     */
    priceMin: money(),
    priceMax: money(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('products', t),
    index('products_tenant_status_created_idx').on(t.tenantId, t.status, sql`created_at desc`),
    index('products_tenant_status_price_idx').on(t.tenantId, t.status, t.priceMin),
    check('products_price_range', sql`${t.priceMin} <= ${t.priceMax}`),
    check('products_status_valid', sql`${t.status} in (${inList(PRODUCT_STATUSES)})`),
    check('products_metadata_object', sql`jsonb_typeof(${t.metadata}) = 'object'`),
  ],
);

export const productTranslations = store.table(
  'product_translations',
  {
    ...tenantColumns(),
    productId: uuid().notNull(),
    locale: locale(),
    title: text().notNull(),
    slug: text().notNull(),
    /** ProseMirror JSON, validated against the whitelist (shared/catalog/rich-text-schema.ts). */
    description: jsonb(),
    seoTitle: text(),
    seoDescription: text(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.productId, t.locale] }),
    ref(
      'product_translations_product_fk',
      [t.tenantId, t.productId],
      [products.tenantId, products.id],
    ),
    unique('product_translations_slug_unique').on(t.tenantId, t.locale, t.slug),
    // Search by title, typo-tolerant in Bangla and English, on the normalized
    // form (app.search_text, migration 0015; phase-3-plan §3.7).
    index('product_translations_search_trgm_idx').using(
      'gin',
      t.tenantId,
      sql`app.search_text(${t.title}) gin_trgm_ops`,
    ),
    localeCheck('product_translations', t.locale),
    length('product_translations_title_length', t.title, 1, 200),
    slugCheck('product_translations_slug_format', t.slug),
  ],
);

export const productOptions = store.table(
  'product_options',
  {
    ...tenantColumns(),
    id: id(),
    productId: uuid().notNull(),
    position: smallint().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('product_options', t),
    ref('product_options_product_fk', [t.tenantId, t.productId], [products.tenantId, products.id]),
    index('product_options_tenant_product_idx').on(t.tenantId, t.productId, t.position),
    check('product_options_position_range', sql`${t.position} between 0 and 2`),
  ],
);

export const productOptionTranslations = store.table(
  'product_option_translations',
  {
    ...tenantColumns(),
    optionId: uuid().notNull(),
    locale: locale(),
    name: text().notNull(),
    /** Normalized name (shared normalizeKey), so filters match "Colour" across products. */
    nameKey: text().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.optionId, t.locale] }),
    ref(
      'product_option_translations_option_fk',
      [t.tenantId, t.optionId],
      [productOptions.tenantId, productOptions.id],
    ),
    index('product_option_translations_key_idx').on(t.tenantId, t.locale, t.nameKey),
    localeCheck('product_option_translations', t.locale),
    length('product_option_translations_name_length', t.name, 1, 100),
  ],
);

export const productOptionValues = store.table(
  'product_option_values',
  {
    ...tenantColumns(),
    id: id(),
    optionId: uuid().notNull(),
    position: smallint().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('product_option_values', t),
    ref(
      'product_option_values_option_fk',
      [t.tenantId, t.optionId],
      [productOptions.tenantId, productOptions.id],
    ),
    index('product_option_values_tenant_option_idx').on(t.tenantId, t.optionId, t.position),
    check('product_option_values_position_range', sql`${t.position} between 0 and 99`),
  ],
);

export const productOptionValueTranslations = store.table(
  'product_option_value_translations',
  {
    ...tenantColumns(),
    valueId: uuid().notNull(),
    locale: locale(),
    label: text().notNull(),
    /** Normalized label, so filters match "Red" across products. */
    labelKey: text().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.valueId, t.locale] }),
    ref(
      'product_option_value_translations_value_fk',
      [t.tenantId, t.valueId],
      [productOptionValues.tenantId, productOptionValues.id],
    ),
    index('product_option_value_translations_key_idx').on(t.tenantId, t.locale, t.labelKey),
    localeCheck('product_option_value_translations', t.locale),
    length('product_option_value_translations_label_length', t.label, 1, 100),
  ],
);

export const variants = store.table(
  'variants',
  {
    ...tenantColumns(),
    id: id(),
    productId: uuid().notNull(),
    /** Sorted option value IDs (shared optionsKey); '' for a product without options. */
    optionsKey: text().notNull(),
    sku: text(),
    barcode: text(),
    /** Money in poisha. */
    price: money().notNull(),
    compareAtPrice: money(),
    costPrice: money(),
    weightGrams: integer(),
    trackInventory: boolean().notNull().default(true),
    allowBackorder: boolean().notNull().default(false),
    lowStockThreshold: integer(),
    /** One of the product's images, shown when this variant is chosen. */
    imageMediaId: uuid(),
    position: smallint().notNull().default(0),
    /** Set when the variant's combination disappeared; kept for stock history and orders. */
    archivedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('variants', t),
    ref('variants_product_fk', [t.tenantId, t.productId], [products.tenantId, products.id]),
    // The image cleanup only removes images nothing points at.
    ref('variants_image_fk', [t.tenantId, t.imageMediaId], [media.tenantId, media.id], 'restrict'),
    // SKUs are matched case-insensitively (the import matches on them). An
    // archived variant frees its SKU and its combination.
    uniqueIndex('variants_sku_unique')
      .on(t.tenantId, sql`lower(sku)`)
      .where(sql`sku is not null and archived_at is null`),
    uniqueIndex('variants_combination_unique')
      .on(t.tenantId, t.productId, t.optionsKey)
      .where(sql`archived_at is null`),
    index('variants_tenant_product_idx').on(t.tenantId, t.productId, t.position),
    // Search by SKU (phase-3-plan §3.7).
    index('variants_sku_trgm_idx').using('gin', t.tenantId, sql`lower(${t.sku}) gin_trgm_ops`),
    index('variants_tenant_barcode_idx').on(t.tenantId, t.barcode).where(sql`barcode is not null`),
    check(
      'variants_amounts_non_negative',
      sql`${t.price} >= 0 and coalesce(${t.compareAtPrice}, 0) >= 0 and coalesce(${t.costPrice}, 0) >= 0`,
    ),
    check(
      'variants_counts_non_negative',
      sql`coalesce(${t.weightGrams}, 0) >= 0 and coalesce(${t.lowStockThreshold}, 0) >= 0`,
    ),
    check('variants_sku_length', sql`char_length(${t.sku}) between 1 and 64`),
    check('variants_barcode_length', sql`char_length(${t.barcode}) between 1 and 64`),
  ],
);

export const variantOptionValues = store.table(
  'variant_option_values',
  {
    ...tenantColumns(),
    variantId: uuid().notNull(),
    valueId: uuid().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.variantId, t.valueId] }),
    ref(
      'variant_option_values_variant_fk',
      [t.tenantId, t.variantId],
      [variants.tenantId, variants.id],
    ),
    ref(
      'variant_option_values_value_fk',
      [t.tenantId, t.valueId],
      [productOptionValues.tenantId, productOptionValues.id],
    ),
    index('variant_option_values_value_idx').on(t.tenantId, t.valueId),
  ],
);

/** A product's images, in order (at most 10, phase-2-plan Q3). */
export const productMedia = store.table(
  'product_media',
  {
    ...tenantColumns(),
    productId: uuid().notNull(),
    mediaId: uuid().notNull(),
    position: smallint().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.productId, t.mediaId] }),
    ref('product_media_product_fk', [t.tenantId, t.productId], [products.tenantId, products.id]),
    ref('product_media_media_fk', [t.tenantId, t.mediaId], [media.tenantId, media.id], 'restrict'),
    index('product_media_order_idx').on(t.tenantId, t.productId, t.position),
    index('product_media_media_idx').on(t.tenantId, t.mediaId),
    check('product_media_position_range', sql`${t.position} between 0 and 9`),
  ],
);

// ---- Categories and collections ------------------------------------------------

export const categories = store.table(
  'categories',
  {
    ...tenantColumns(),
    id: id(),
    parentId: uuid(),
    /** 0 for a root; at most 3 levels (phase-2-plan §3.3). */
    depth: smallint().notNull().default(0),
    position: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('categories', t),
    // A category with children can't be deleted.
    ref('categories_parent_fk', [t.tenantId, t.parentId], [t.tenantId, t.id], 'restrict'),
    index('categories_tenant_parent_idx').on(t.tenantId, t.parentId, t.position),
    check('categories_depth_range', sql`${t.depth} between 0 and 2`),
    check('categories_root_depth', sql`(${t.parentId} is null) = (${t.depth} = 0)`),
    check('categories_not_own_parent', sql`${t.parentId} is distinct from ${t.id}`),
  ],
);

export const categoryTranslations = store.table(
  'category_translations',
  {
    ...tenantColumns(),
    categoryId: uuid().notNull(),
    locale: locale(),
    name: text().notNull(),
    slug: text().notNull(),
    description: jsonb(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.categoryId, t.locale] }),
    ref(
      'category_translations_category_fk',
      [t.tenantId, t.categoryId],
      [categories.tenantId, categories.id],
    ),
    unique('category_translations_slug_unique').on(t.tenantId, t.locale, t.slug),
    localeCheck('category_translations', t.locale),
    length('category_translations_name_length', t.name, 1, 100),
    slugCheck('category_translations_slug_format', t.slug),
  ],
);

export const productCategories = store.table(
  'product_categories',
  {
    ...tenantColumns(),
    productId: uuid().notNull(),
    categoryId: uuid().notNull(),
    /** The product's place in the category's listing. */
    position: integer().notNull().default(0),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.productId, t.categoryId] }),
    ref(
      'product_categories_product_fk',
      [t.tenantId, t.productId],
      [products.tenantId, products.id],
    ),
    // A category with products can't be deleted.
    ref(
      'product_categories_category_fk',
      [t.tenantId, t.categoryId],
      [categories.tenantId, categories.id],
      'restrict',
    ),
    index('product_categories_category_idx').on(t.tenantId, t.categoryId, t.position),
  ],
);

export const collections = store.table(
  'collections',
  {
    ...tenantColumns(),
    id: id(),
    kind: text({ enum: COLLECTION_KINDS }).notNull(),
    /** Rule-based collections only; validated by shared collectionRules. */
    rules: jsonb(),
    sort: text({ enum: COLLECTION_SORTS }).notNull().default('manual'),
    published: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('collections', t),
    index('collections_tenant_created_idx').on(t.tenantId, sql`created_at desc`),
    check('collections_kind_valid', sql`${t.kind} in (${inList(COLLECTION_KINDS)})`),
    check('collections_sort_valid', sql`${t.sort} in (${inList(COLLECTION_SORTS)})`),
    check(
      'collections_rules_match_kind',
      sql`(${t.kind} = 'rule') = (${t.rules} is not null) and not (${t.kind} = 'rule' and ${t.sort} = 'manual')`,
    ),
  ],
);

export const collectionTranslations = store.table(
  'collection_translations',
  {
    ...tenantColumns(),
    collectionId: uuid().notNull(),
    locale: locale(),
    name: text().notNull(),
    slug: text().notNull(),
    description: jsonb(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.collectionId, t.locale] }),
    ref(
      'collection_translations_collection_fk',
      [t.tenantId, t.collectionId],
      [collections.tenantId, collections.id],
    ),
    unique('collection_translations_slug_unique').on(t.tenantId, t.locale, t.slug),
    localeCheck('collection_translations', t.locale),
    length('collection_translations_name_length', t.name, 1, 100),
    slugCheck('collection_translations_slug_format', t.slug),
  ],
);

export const collectionProducts = store.table(
  'collection_products',
  {
    ...tenantColumns(),
    collectionId: uuid().notNull(),
    productId: uuid().notNull(),
    position: integer().notNull().default(0),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.collectionId, t.productId] }),
    ref(
      'collection_products_collection_fk',
      [t.tenantId, t.collectionId],
      [collections.tenantId, collections.id],
    ),
    ref(
      'collection_products_product_fk',
      [t.tenantId, t.productId],
      [products.tenantId, products.id],
    ),
    index('collection_products_order_idx').on(t.tenantId, t.collectionId, t.position),
    index('collection_products_product_idx').on(t.tenantId, t.productId),
  ],
);

/**
 * Old slugs, so old links keep working (Phase 3 serves the 301). A redirect
 * points at the entity, never at another slug, so renames never chain; a live
 * slug always wins, and the service deletes a redirect whose slug is reused.
 */
export const slugRedirects = store.table(
  'slug_redirects',
  {
    ...tenantColumns(),
    id: id(),
    entityType: text({ enum: SLUG_ENTITY_TYPES }).notNull(),
    locale: locale(),
    fromSlug: text().notNull(),
    entityId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantPolicy(t),
    unique('slug_redirects_from_unique').on(t.tenantId, t.entityType, t.locale, t.fromSlug),
    index('slug_redirects_entity_idx').on(t.tenantId, t.entityType, t.entityId),
    check(
      'slug_redirects_entity_type_valid',
      sql`${t.entityType} in (${inList(SLUG_ENTITY_TYPES)})`,
    ),
    localeCheck('slug_redirects', t.locale),
  ],
);

// ---- Attributes and tags (phase-2-plan §3.4) -------------------------------------

export const attributes = store.table(
  'attributes',
  {
    ...tenantColumns(),
    id: id(),
    /** Stable Latin key used in import columns and feeds. */
    key: text().notNull(),
    type: text({ enum: ATTRIBUTE_TYPES }).notNull(),
    filterable: boolean().notNull().default(false),
    visible: boolean().notNull().default(true),
    /** The built-in brand: renamed or hidden, never deleted or retyped. */
    isSystem: boolean().notNull().default(false),
    position: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('attributes', t),
    // The target of product_attributes' typed reference.
    unique('attributes_tenant_id_type_unique').on(t.tenantId, t.id, t.type),
    unique('attributes_key_unique').on(t.tenantId, t.key),
    check('attributes_type_valid', sql`${t.type} in (${inList(ATTRIBUTE_TYPES)})`),
    check('attributes_key_format', sql`${t.key} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check('attributes_text_not_filterable', sql`not (${t.filterable} and ${t.type} = 'text')`),
  ],
);

export const attributeTranslations = store.table(
  'attribute_translations',
  {
    ...tenantColumns(),
    attributeId: uuid().notNull(),
    locale: locale(),
    name: text().notNull(),
    /** For numbers: "GB", "কেজি". */
    unit: text(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.attributeId, t.locale] }),
    ref(
      'attribute_translations_attribute_fk',
      [t.tenantId, t.attributeId],
      [attributes.tenantId, attributes.id],
    ),
    localeCheck('attribute_translations', t.locale),
    length('attribute_translations_name_length', t.name, 1, 100),
    check('attribute_translations_unit_length', sql`char_length(${t.unit}) between 1 and 20`),
  ],
);

/** Choice values, defined once per attribute so filters work across products. */
export const attributeValues = store.table(
  'attribute_values',
  {
    ...tenantColumns(),
    id: id(),
    attributeId: uuid().notNull(),
    position: integer().notNull().default(0),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('attribute_values', t),
    // The target of references that keep a value inside its attribute.
    unique('attribute_values_attribute_id_unique').on(t.tenantId, t.attributeId, t.id),
    ref(
      'attribute_values_attribute_fk',
      [t.tenantId, t.attributeId],
      [attributes.tenantId, attributes.id],
    ),
    index('attribute_values_order_idx').on(t.tenantId, t.attributeId, t.position),
  ],
);

export const attributeValueTranslations = store.table(
  'attribute_value_translations',
  {
    ...tenantColumns(),
    valueId: uuid().notNull(),
    /** Repeated from the value, so labels are unique per attribute. */
    attributeId: uuid().notNull(),
    locale: locale(),
    label: text().notNull(),
    labelKey: text().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.valueId, t.locale] }),
    ref(
      'attribute_value_translations_value_fk',
      [t.tenantId, t.attributeId, t.valueId],
      [attributeValues.tenantId, attributeValues.attributeId, attributeValues.id],
    ),
    unique('attribute_value_translations_label_unique').on(
      t.tenantId,
      t.attributeId,
      t.locale,
      t.labelKey,
    ),
    localeCheck('attribute_value_translations', t.locale),
    length('attribute_value_translations_label_length', t.label, 1, 100),
  ],
);

/** A category's template: the attributes its products usually have. */
export const categoryAttributes = store.table(
  'category_attributes',
  {
    ...tenantColumns(),
    categoryId: uuid().notNull(),
    attributeId: uuid().notNull(),
    position: integer().notNull().default(0),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.categoryId, t.attributeId] }),
    ref(
      'category_attributes_category_fk',
      [t.tenantId, t.categoryId],
      [categories.tenantId, categories.id],
    ),
    ref(
      'category_attributes_attribute_fk',
      [t.tenantId, t.attributeId],
      [attributes.tenantId, attributes.id],
    ),
    index('category_attributes_attribute_idx').on(t.tenantId, t.attributeId),
  ],
);

/**
 * A product's attribute values: one row per choice value, or one row with a
 * number or yes/no; text values live in product_attribute_translations. The
 * row repeats its attribute's type, and two composite keys make the database
 * refuse a value of the wrong type or from another attribute or store.
 */
export const productAttributes = store.table(
  'product_attributes',
  {
    ...tenantColumns(),
    id: id(),
    productId: uuid().notNull(),
    attributeId: uuid().notNull(),
    attributeType: text({ enum: ATTRIBUTE_TYPES }).notNull(),
    valueId: uuid(),
    numberValue: numeric({ mode: 'number' }),
    booleanValue: boolean(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('product_attributes', t),
    ref(
      'product_attributes_product_fk',
      [t.tenantId, t.productId],
      [products.tenantId, products.id],
    ),
    ref(
      'product_attributes_attribute_fk',
      [t.tenantId, t.attributeId, t.attributeType],
      [attributes.tenantId, attributes.id, attributes.type],
    ),
    ref(
      'product_attributes_value_fk',
      [t.tenantId, t.attributeId, t.valueId],
      [attributeValues.tenantId, attributeValues.attributeId, attributeValues.id],
    ),
    // One row per value; for numbers, yes/no and text (no value), one per attribute.
    unique('product_attributes_value_unique')
      .on(t.tenantId, t.productId, t.attributeId, t.valueId)
      .nullsNotDistinct(),
    // A single-choice attribute has one value per product.
    uniqueIndex('product_attributes_single_unique')
      .on(t.tenantId, t.productId, t.attributeId)
      .where(sql`attribute_type <> 'multi_choice'`),
    index('product_attributes_value_idx').on(t.tenantId, t.attributeId, t.valueId),
    index('product_attributes_number_idx').on(t.tenantId, t.attributeId, t.numberValue),
    check(
      'product_attributes_value_matches_type',
      sql`case ${t.attributeType}
        when 'choice' then ${t.valueId} is not null and ${t.numberValue} is null and ${t.booleanValue} is null
        when 'multi_choice' then ${t.valueId} is not null and ${t.numberValue} is null and ${t.booleanValue} is null
        when 'number' then ${t.valueId} is null and ${t.numberValue} is not null and ${t.booleanValue} is null
        when 'boolean' then ${t.valueId} is null and ${t.numberValue} is null and ${t.booleanValue} is not null
        when 'text' then ${t.valueId} is null and ${t.numberValue} is null and ${t.booleanValue} is null
        else false end`,
    ),
  ],
);

export const productAttributeTranslations = store.table(
  'product_attribute_translations',
  {
    ...tenantColumns(),
    productAttributeId: uuid().notNull(),
    locale: locale(),
    text: text().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.productAttributeId, t.locale] }),
    ref(
      'product_attribute_translations_attribute_fk',
      [t.tenantId, t.productAttributeId],
      [productAttributes.tenantId, productAttributes.id],
    ),
    localeCheck('product_attribute_translations', t.locale),
    length('product_attribute_translations_text_length', t.text, 1, 1000),
  ],
);

/** Staff labels: not translated, not shown to shoppers (§3.4). */
export const productTags = store.table(
  'product_tags',
  {
    ...tenantColumns(),
    productId: uuid().notNull(),
    /** Normalized by shared normalizeTag. */
    tag: text().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.productId, t.tag] }),
    ref('product_tags_product_fk', [t.tenantId, t.productId], [products.tenantId, products.id]),
    index('product_tags_tag_idx').on(t.tenantId, t.tag),
    index('product_tags_search_trgm_idx').using(
      'gin',
      t.tenantId,
      sql`app.search_text(${t.tag}) gin_trgm_ops`,
    ),
    length('product_tags_tag_length', t.tag, 1, 50),
    check('product_tags_tag_normalized', sql`${t.tag} = lower(btrim(${t.tag}))`),
  ],
);
