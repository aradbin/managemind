// Catalog input schemas shared by the API, the admin and the import
// (phase-2-plan §3–§6). They describe what a client may send; the database
// constraints and the core services check everything again.
import { z } from 'zod';
import type { Locale } from '../money';
import { CATALOG_LIMITS as L } from './limits';
import { richTextDoc } from './rich-text-schema';
import { cleanText, isCatalogSlug, normalizeTag } from './text';
import { combinationCount } from './variants';

export const LOCALE_VALUES = ['bn', 'en'] as const satisfies readonly Locale[];
export const locale = z.enum(LOCALE_VALUES);

/** Trimmed, NFC, inner whitespace collapsed; 1..max characters. */
export const cleanString = (max: number) =>
  z.string().transform(cleanText).pipe(z.string().min(1).max(max));

/** Optional text that may be cleared: '' and whitespace become null. */
const optionalText = (max: number) =>
  z
    .string()
    .transform(cleanText)
    .pipe(z.string().max(max))
    .transform((s) => s || null)
    .nullable()
    .optional();

export const catalogSlug = z
  .string()
  .trim()
  .transform((s) => s.normalize('NFC').toLowerCase())
  .refine(isCatalogSlug, 'letters, digits and single hyphens');

/** One entry per locale; at least one. Which locale is required depends on the store, so services check that. */
export const perLocale = <T extends z.ZodType>(value: T) =>
  z.partialRecord(locale, value).refine((v) => Object.keys(v).length > 0, 'at least one language');

/** Integer minor units (poisha). */
export const price = z.int().min(0).max(L.maxPrice);

export const sku = z
  .string()
  .trim()
  .max(L.skuLength)
  .regex(/^[\p{L}\p{N}][\p{L}\p{M}\p{N}._\-/#]*$/u, 'letters, digits and . _ - / #')
  .transform((s) => s.normalize('NFC'));

export const barcode = z
  .string()
  .trim()
  .max(L.barcodeLength)
  .regex(/^[A-Za-z0-9-]+$/, 'letters, digits and hyphens');

export const metadata = z
  .record(z.string().min(1).max(64), z.json())
  .refine((m) => Object.keys(m).length <= L.metadataKeys, `at most ${L.metadataKeys} keys`)
  .refine((m) => JSON.stringify(m).length <= 16_384, 'at most 16 KB');

/** One tag, normalized (§3.4). */
export const tag = z.string().transform((raw, ctx) => {
  const normalized = normalizeTag(raw);
  if (normalized === null) {
    ctx.addIssue({ code: 'custom', message: `tags are 1–${L.tagLength} characters` });
    return z.NEVER;
  }
  return normalized;
});

export const tags = z
  .array(z.string())
  .max(L.tagsPerProduct)
  .transform((list, ctx) => {
    const out = new Set<string>();
    for (const raw of list) {
      const tag = normalizeTag(raw);
      if (tag === null) {
        ctx.addIssue({ code: 'custom', message: `tags are 1–${L.tagLength} characters` });
        return z.NEVER;
      }
      out.add(tag);
    }
    return [...out];
  });

// ---- Products -------------------------------------------------------------

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export const productStatus = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof productStatus>;

export const productTranslation = z.object({
  title: cleanString(L.titleLength),
  /** Generated from the title when left out. */
  slug: catalogSlug.optional(),
  description: richTextDoc.optional(),
  seoTitle: optionalText(L.seoTitleLength),
  seoDescription: optionalText(L.seoDescriptionLength),
});
export type ProductTranslationInput = z.infer<typeof productTranslation>;

export const variantFields = z.object({
  sku: sku.nullable().optional(),
  barcode: barcode.nullable().optional(),
  price,
  compareAtPrice: price.nullable().optional(),
  costPrice: price.nullable().optional(),
  weightGrams: z.int().min(0).max(1_000_000).nullable().optional(),
  trackInventory: z.boolean().optional(),
  allowBackorder: z.boolean().optional(),
  lowStockThreshold: z.int().min(0).max(L.maxStock).nullable().optional(),
});
export type VariantFields = z.infer<typeof variantFields>;

/** A compare-at price only means something above the price. */
const compareAtAbovePrice = (v: {
  price?: number | undefined;
  compareAtPrice?: number | null | undefined;
}) => v.compareAtPrice == null || v.price === undefined || v.compareAtPrice > v.price;

export const variantPatch = variantFields
  .partial()
  .refine(compareAtAbovePrice, { message: 'must be above the price', path: ['compareAtPrice'] });

export const bulkVariantPatch = z
  .array(
    z.object({
      id: z.uuid(),
      price: price.optional(),
      compareAtPrice: price.nullable().optional(),
      lowStockThreshold: z.int().min(0).max(L.maxStock).nullable().optional(),
    }),
  )
  .min(1)
  .max(L.bulkVariantEdits);

export const optionValueInput = z.object({
  /** An existing value keeps its ID, so its variants survive a rename. */
  id: z.uuid().optional(),
  label: perLocale(cleanString(L.nameLength)),
});
export const optionInput = z.object({
  id: z.uuid().optional(),
  name: perLocale(cleanString(L.nameLength)),
  values: z.array(optionValueInput).min(1).max(L.valuesPerOption),
});

/** PUT /products/{id}/options: the full list, which regenerates the variants. */
export const productOptions = z
  .array(optionInput)
  .max(L.optionsPerProduct)
  .superRefine((options, ctx) => {
    if (combinationCount(options.map((o) => o.values)) > L.variantsPerProduct) {
      ctx.addIssue({
        code: 'custom',
        message: `at most ${L.variantsPerProduct} variants`,
        params: { code: 'too_many_variants' },
      });
    }
    for (const lang of LOCALE_VALUES) {
      const names = options.map((o) => o.name[lang]?.toLowerCase()).filter(Boolean);
      if (new Set(names).size !== names.length) {
        ctx.addIssue({ code: 'custom', message: 'option names must differ' });
      }
      options.forEach((o, i) => {
        const labels = o.values.map((v) => v.label[lang]?.toLowerCase()).filter(Boolean);
        if (new Set(labels).size !== labels.length) {
          ctx.addIssue({ code: 'custom', path: [i, 'values'], message: 'values must differ' });
        }
      });
    }
  });
export type ProductOptionsInput = z.infer<typeof productOptions>;

const vatCategory = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,31}$/)
  .nullable();

/** A product attribute value as sent by the editor or the import (§3.4). */
export const productAttributeInput = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('choice'),
    attributeId: z.uuid(),
    valueIds: z.array(z.uuid()).max(1),
  }),
  z.object({
    type: z.literal('multi_choice'),
    attributeId: z.uuid(),
    valueIds: z.array(z.uuid()).max(L.valuesPerAttribute),
  }),
  z.object({
    type: z.literal('number'),
    attributeId: z.uuid(),
    number: z.number().finite().min(-1e12).max(1e12).nullable(),
  }),
  z.object({ type: z.literal('boolean'), attributeId: z.uuid(), value: z.boolean().nullable() }),
  z.object({
    type: z.literal('text'),
    attributeId: z.uuid(),
    text: z.partialRecord(locale, optionalText(1_000)),
  }),
]);
export type ProductAttributeInput = z.infer<typeof productAttributeInput>;

export const productCreate = z.object({
  status: productStatus.exclude(['archived']).default('draft'),
  translations: perLocale(productTranslation),
  /** The single variant of a product without options; options come after creation. */
  variant: variantFields
    .refine(compareAtAbovePrice, { message: 'must be above the price', path: ['compareAtPrice'] })
    .optional(),
  categoryIds: z.array(z.uuid()).max(20).optional(),
  tags: tags.optional(),
  attributes: z.array(productAttributeInput).max(L.attributesPerStore).optional(),
  vatCategory: vatCategory.optional(),
  metadata: metadata.optional(),
});
export type ProductCreate = z.infer<typeof productCreate>;

export const productPatch = z.object({
  status: productStatus.exclude(['archived']).optional(),
  /** A locale set to null removes that translation (never the store's default locale). */
  translations: z.partialRecord(locale, productTranslation.nullable()).optional(),
  categoryIds: z.array(z.uuid()).max(20).optional(),
  collectionIds: z.array(z.uuid()).max(50).optional(),
  tags: tags.optional(),
  /** Replaces the listed attributes' values; an empty value removes the attribute. */
  attributes: z.array(productAttributeInput).max(L.attributesPerStore).optional(),
  vatCategory: vatCategory.optional(),
  metadata: metadata.optional(),
});
export type ProductPatch = z.infer<typeof productPatch>;

// ---- Categories and collections ----------------------------------------------

export const nameTranslation = z.object({
  name: cleanString(L.nameLength),
  slug: catalogSlug.optional(),
  description: richTextDoc.optional(),
});

export const categoryCreate = z.object({
  parentId: z.uuid().nullable().optional(),
  translations: perLocale(nameTranslation),
});
export const categoryPatch = z.object({
  translations: z.partialRecord(locale, nameTranslation.nullable()).optional(),
});
export const categoryMove = z.object({
  parentId: z.uuid().nullable(),
  /** Position among the new siblings; the end when left out. */
  position: z.int().min(0).optional(),
});

export const COLLECTION_SORTS = [
  'manual',
  'newest',
  'price_asc',
  'price_desc',
  'title_asc',
] as const;

const id = z.uuid();
const bounds = (bound: z.ZodNumber) =>
  z
    .object({ min: bound.nullable(), max: bound.nullable() })
    .refine((r) => r.min !== null || r.max !== null, 'a minimum or a maximum')
    .refine((r) => r.min === null || r.max === null || r.min <= r.max, 'minimum above maximum');

/** Rule-based collections: every condition must match (Q7). Stored as JSON, so "any of" can come later. */
export const collectionCondition = z.discriminatedUnion('type', [
  z.object({ type: z.literal('category'), categoryId: id }),
  bounds(price).extend({ type: z.literal('price') }),
  z.object({ type: z.literal('title_contains'), text: cleanString(L.nameLength) }),
  z.object({ type: z.literal('created_within_days'), days: z.int().min(1).max(3650) }),
  z.object({ type: z.literal('tag'), tag: tag }),
  z.object({ type: z.literal('brand'), valueId: id }),
  z.object({ type: z.literal('attribute_value'), attributeId: id, valueId: id }),
  bounds(z.number().finite()).extend({ type: z.literal('attribute_range'), attributeId: id }),
  z.object({ type: z.literal('attribute_boolean'), attributeId: id, value: z.boolean() }),
]);
export type CollectionCondition = z.infer<typeof collectionCondition>;

export const collectionRules = z.object({
  match: z.literal('all').default('all'),
  conditions: z.array(collectionCondition).min(1).max(L.rulesPerCollection),
});
export type CollectionRules = z.infer<typeof collectionRules>;

export const collectionCreate = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('manual'),
    translations: perLocale(nameTranslation),
    sort: z.enum(COLLECTION_SORTS).default('manual'),
    published: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('rule'),
    translations: perLocale(nameTranslation),
    rules: collectionRules,
    sort: z.enum(COLLECTION_SORTS).exclude(['manual']).default('newest'),
    published: z.boolean().default(false),
  }),
]);
export const collectionPatch = z.object({
  translations: z.partialRecord(locale, nameTranslation.nullable()).optional(),
  rules: collectionRules.optional(),
  sort: z.enum(COLLECTION_SORTS).optional(),
  published: z.boolean().optional(),
});

// ---- Attributes (§3.4) ------------------------------------------------------

export const ATTRIBUTE_TYPES = ['choice', 'multi_choice', 'number', 'text', 'boolean'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];
/** Text values are per product and free-form, so they can't drive filters. */
export const FILTERABLE_TYPES: readonly AttributeType[] = [
  'choice',
  'multi_choice',
  'number',
  'boolean',
];
export const BRAND_ATTRIBUTE_KEY = 'brand';

export const attributeKey = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'lowercase Latin letters, digits and _');

const attributeTranslation = z.object({
  name: cleanString(L.nameLength),
  unit: optionalText(20),
});

export const attributeCreate = z
  .object({
    key: attributeKey,
    type: z.enum(ATTRIBUTE_TYPES),
    translations: perLocale(attributeTranslation),
    filterable: z.boolean().default(false),
    visible: z.boolean().default(true),
  })
  .refine((a) => !a.filterable || FILTERABLE_TYPES.includes(a.type), {
    message: 'text attributes cannot be filters',
    path: ['filterable'],
  })
  .refine((a) => a.key !== BRAND_ATTRIBUTE_KEY, { message: 'reserved', path: ['key'] });

/** Key and type never change after creation: imports and product values depend on them. */
export const attributePatch = z.object({
  translations: z.partialRecord(locale, attributeTranslation.nullable()).optional(),
  filterable: z.boolean().optional(),
  visible: z.boolean().optional(),
  position: z.int().min(0).optional(),
});

/** PUT /attributes/{id}/values: the full ordered list. */
export const attributeValues = z
  .array(
    z.object({
      id: z.uuid().optional(),
      label: perLocale(cleanString(L.nameLength)),
    }),
  )
  .max(L.valuesPerAttribute)
  .superRefine((values, ctx) => {
    for (const lang of LOCALE_VALUES) {
      const labels = values.map((v) => v.label[lang]?.toLowerCase()).filter(Boolean);
      if (new Set(labels).size !== labels.length) {
        ctx.addIssue({ code: 'custom', message: 'labels must differ' });
      }
    }
  });

// ---- Inventory ----------------------------------------------------------------

export const STOCK_MOVEMENT_TYPES = [
  'receive',
  'sale',
  'reservation',
  'release',
  'adjustment',
  'return',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/** Which level column each movement type moves, and its sign (phase-2-plan §3.8). */
export const MOVEMENT_EFFECT: Record<
  StockMovementType,
  { column: 'on_hand' | 'reserved'; sign: 1 | -1 | 0 }
> = {
  receive: { column: 'on_hand', sign: 1 },
  return: { column: 'on_hand', sign: 1 },
  adjustment: { column: 'on_hand', sign: 0 }, // either sign
  sale: { column: 'on_hand', sign: -1 },
  reservation: { column: 'reserved', sign: 1 },
  release: { column: 'reserved', sign: -1 },
};

export const ADJUSTMENT_REASONS = [
  'received',
  'count',
  'damaged',
  'lost',
  'returned',
  'correction',
  'import',
  'other',
] as const;

export const inventoryAdjustments = z
  .array(
    z.discriminatedUnion('mode', [
      /** Add or remove a quantity: receiving, damage, loss. */
      z.object({
        mode: z.literal('delta'),
        variantId: z.uuid(),
        locationId: z.uuid().optional(),
        quantity: z
          .int()
          .min(-L.maxStock)
          .max(L.maxStock)
          .refine((q) => q !== 0, 'not zero'),
        reason: z.enum(ADJUSTMENT_REASONS),
        note: optionalText(500),
      }),
      /** Set the counted quantity: a stock count. */
      z.object({
        mode: z.literal('set'),
        variantId: z.uuid(),
        locationId: z.uuid().optional(),
        onHand: z.int().min(0).max(L.maxStock),
        reason: z.enum(ADJUSTMENT_REASONS),
        note: optionalText(500),
      }),
    ]),
  )
  .min(1)
  .max(L.bulkVariantEdits);
export type InventoryAdjustments = z.infer<typeof inventoryAdjustments>;
