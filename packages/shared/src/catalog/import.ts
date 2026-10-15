// Spreadsheet import and export columns (phase-2-plan §3.7). The browser
// maps headers, parses cells and groups rows into products (the dry run); the
// server validates each staged chunk again with `importChunk`, because the
// dry run is for the user, not a trust boundary.
//
// The format follows Shopify's: one row per variant, rows of a product share
// a handle, and product fields come from the product's first row.
import { z } from 'zod';
import { parseInteger, toLatinDigits } from '../digits';
import { parseAmount } from '../money';
import { richTextFromMarkdown } from '../rich-text';
import { CATALOG_LIMITS as L } from './limits';
import { richTextDoc } from './rich-text-schema';
import {
  attributeKey,
  barcode,
  catalogSlug,
  cleanString,
  LOCALE_VALUES,
  locale,
  type ProductStatus,
  perLocale,
  price,
  productStatus,
  sku,
  tags,
} from './schemas';
import { cleanText, normalizeKey, normalizeTag } from './text';

type Locale = (typeof LOCALE_VALUES)[number];

// ---- Columns ------------------------------------------------------------------

export const IMPORT_FIELDS = [
  'handle',
  'title',
  'slug',
  'description',
  'seoTitle',
  'seoDescription',
  'status',
  'categories',
  'tags',
  'brand',
  'vatCategory',
  'option1Name',
  'option1Value',
  'option2Name',
  'option2Value',
  'option3Name',
  'option3Value',
  'sku',
  'barcode',
  'price',
  'compareAtPrice',
  'costPrice',
  'weightGrams',
  'stock',
  'trackInventory',
  'allowBackorder',
  'lowStockThreshold',
  'images',
  'variantImage',
  'attribute',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Fields with one column per language, e.g. "Title (bn)" and "Title (en)". */
const LOCALIZED = new Set<ImportField>([
  'title',
  'slug',
  'description',
  'seoTitle',
  'seoDescription',
  'option1Name',
  'option1Value',
  'option2Name',
  'option2Value',
  'option3Name',
  'option3Value',
]);
export const isLocalizedField = (field: ImportField): boolean => LOCALIZED.has(field);

/** The export's headers, in English and Bangla. Both are recognized on import. */
export const IMPORT_HEADERS: Record<
  Exclude<ImportField, 'attribute'>,
  { en: string; bn: string }
> = {
  handle: { en: 'Handle', bn: 'হ্যান্ডেল' },
  title: { en: 'Title', bn: 'নাম' },
  slug: { en: 'URL slug', bn: 'ইউআরএল' },
  description: { en: 'Description', bn: 'বিবরণ' },
  seoTitle: { en: 'SEO title', bn: 'এসইও শিরোনাম' },
  seoDescription: { en: 'SEO description', bn: 'এসইও বিবরণ' },
  status: { en: 'Status', bn: 'অবস্থা' },
  categories: { en: 'Categories', bn: 'ক্যাটাগরি' },
  tags: { en: 'Tags', bn: 'ট্যাগ' },
  brand: { en: 'Brand', bn: 'ব্র্যান্ড' },
  vatCategory: { en: 'VAT category', bn: 'ভ্যাট ক্যাটাগরি' },
  option1Name: { en: 'Option1 name', bn: 'অপশন১ নাম' },
  option1Value: { en: 'Option1 value', bn: 'অপশন১ মান' },
  option2Name: { en: 'Option2 name', bn: 'অপশন২ নাম' },
  option2Value: { en: 'Option2 value', bn: 'অপশন২ মান' },
  option3Name: { en: 'Option3 name', bn: 'অপশন৩ নাম' },
  option3Value: { en: 'Option3 value', bn: 'অপশন৩ মান' },
  sku: { en: 'SKU', bn: 'এসকেইউ' },
  barcode: { en: 'Barcode', bn: 'বারকোড' },
  price: { en: 'Price', bn: 'দাম' },
  compareAtPrice: { en: 'Compare-at price', bn: 'আগের দাম' },
  costPrice: { en: 'Cost price', bn: 'ক্রয়মূল্য' },
  weightGrams: { en: 'Weight (grams)', bn: 'ওজন (গ্রাম)' },
  stock: { en: 'Stock', bn: 'স্টক' },
  trackInventory: { en: 'Track stock', bn: 'স্টক হিসাব' },
  allowBackorder: { en: 'Sell when out of stock', bn: 'স্টক শেষেও বিক্রি' },
  lowStockThreshold: { en: 'Low stock alert', bn: 'কম স্টকের সতর্কতা' },
  images: { en: 'Image URLs', bn: 'ছবির লিংক' },
  variantImage: { en: 'Variant image URL', bn: 'ভ্যারিয়েন্টের ছবির লিংক' },
};

/** Common Shopify export headers, so a store moving from Shopify maps with no work. */
const ALIASES: Record<string, ImportField> = {
  'variant sku': 'sku',
  'variant price': 'price',
  'variant compare at price': 'compareAtPrice',
  'variant barcode': 'barcode',
  'variant inventory qty': 'stock',
  'variant grams': 'weightGrams',
  'variant image': 'variantImage',
  'cost per item': 'costPrice',
  'image src': 'images',
  vendor: 'brand',
  'seo title': 'seoTitle',
  'seo description': 'seoDescription',
  'option1 name': 'option1Name',
  'option1 value': 'option1Value',
  'option2 name': 'option2Name',
  'option2 value': 'option2Value',
  'option3 name': 'option3Name',
  'option3 value': 'option3Value',
};

/** A mapped column: which field, and which language or attribute it carries. */
export interface ColumnRef {
  field: ImportField;
  locale?: Locale;
  /** For `attribute` columns: the attribute's key. */
  attributeKey?: string;
}

export const columnId = (ref: ColumnRef): string =>
  [ref.field, ref.attributeKey, ref.locale].filter(Boolean).join(':');

const headerKey = (header: string) =>
  toLatinDigits(normalizeKey(header))
    .replace(/[\s_-]+/g, ' ')
    .trim();

const HEADER_INDEX = new Map<string, ImportField>([
  ...Object.entries(ALIASES),
  ...Object.entries(IMPORT_HEADERS).flatMap(([field, h]) => [
    [headerKey(h.en), field as ImportField] as const,
    [headerKey(h.bn), field as ImportField] as const,
  ]),
]);

const ATTRIBUTE_PREFIX = /^(?:attribute|বৈশিষ্ট্য)\s*:\s*/iu;

/**
 * Recognizes an export header in either language, with an optional
 * " (bn)" or " (en)" suffix: "Title (bn)", "নাম (en)", "Attribute: fabric (en)".
 * Unknown headers return null, and the wizard asks the user to map them.
 */
export function matchHeader(header: string): ColumnRef | null {
  let text = cleanText(header);
  let lang: Locale | undefined;
  const suffix = /\s*\((bn|en)\)$/iu.exec(text);
  if (suffix) {
    lang = suffix[1]?.toLowerCase() as Locale;
    text = text.slice(0, suffix.index);
  }
  const attr = ATTRIBUTE_PREFIX.exec(text);
  if (attr) {
    const key = attributeKey.safeParse(text.slice(attr[0].length).toLowerCase());
    if (!key.success) return null;
    return lang
      ? { field: 'attribute', attributeKey: key.data, locale: lang }
      : { field: 'attribute', attributeKey: key.data };
  }
  const field = HEADER_INDEX.get(headerKey(text));
  if (!field) return null;
  if (!isLocalizedField(field)) return lang ? null : { field };
  return lang ? { field, locale: lang } : { field };
}

/** The export header of a column, in the user's language. */
export function exportHeader(ref: ColumnRef, lang: Locale): string {
  const base =
    ref.field === 'attribute'
      ? `${lang === 'bn' ? 'বৈশিষ্ট্য' : 'Attribute'}: ${ref.attributeKey}`
      : IMPORT_HEADERS[ref.field][lang];
  return ref.locale ? `${base} (${ref.locale})` : base;
}

// ---- Staged products: what the server validates --------------------------------

const url = z
  .string()
  .trim()
  .max(2048)
  .refine((u) => {
    try {
      const parsed = new URL(u);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an http(s) link');

const row = z.int().min(1);

export const importVariant = z.object({
  row,
  /** One label per option, in option order. */
  values: z.array(perLocale(cleanString(L.nameLength))).max(L.optionsPerProduct),
  sku: sku.nullable(),
  barcode: barcode.nullable(),
  price,
  compareAtPrice: price.nullable(),
  costPrice: price.nullable(),
  weightGrams: z.int().min(0).max(1_000_000).nullable(),
  trackInventory: z.boolean().nullable(),
  allowBackorder: z.boolean().nullable(),
  lowStockThreshold: z.int().min(0).max(L.maxStock).nullable(),
  /** The new on-hand count at the default location; null leaves stock alone. */
  stock: z.int().min(0).max(L.maxStock).nullable(),
  image: url.nullable(),
});
export type ImportVariant = z.infer<typeof importVariant>;

export const importProduct = z
  .object({
    handle: z.string().trim().min(1).max(L.slugLength),
    row,
    status: productStatus,
    translations: perLocale(
      z.object({
        title: cleanString(L.titleLength),
        slug: catalogSlug.nullable(),
        description: richTextDoc.nullable(),
        seoTitle: cleanString(L.seoTitleLength).nullable(),
        seoDescription: cleanString(L.seoDescriptionLength).nullable(),
      }),
    ),
    /** Category paths by name, root first: [["Clothing", "Saree"]]. */
    categories: z.array(z.array(cleanString(L.nameLength)).min(1).max(L.categoryDepth)).max(20),
    tags,
    brand: cleanString(L.nameLength).nullable(),
    vatCategory: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,31}$/)
      .nullable(),
    options: z
      .array(z.object({ name: perLocale(cleanString(L.nameLength)) }))
      .max(L.optionsPerProduct),
    variants: z.array(importVariant).min(1).max(L.variantsPerProduct),
    images: z.array(url).max(L.imagesPerProduct),
    /** Raw cell values; the server types them by each attribute's type. */
    attributes: z
      .array(
        z.object({
          key: attributeKey,
          locale: locale.nullable(),
          values: z.array(cleanString(1_000)).max(L.valuesPerAttribute),
        }),
      )
      .max(L.attributesPerStore * 2),
  })
  .superRefine((product, ctx) => {
    const combos = new Set<string>();
    const skus = new Set<string>();
    product.variants.forEach((v, i) => {
      if (v.values.length !== product.options.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants', i, 'values'],
          message: 'one value per option',
        });
      }
      // Labels in the first language present (every row has the store's language).
      const key = v.values
        .map((value) => normalizeKey(LOCALE_VALUES.map((l) => value[l]).find(Boolean) ?? ''))
        .join('\u0000');
      if (combos.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants', i, 'values'],
          message: 'duplicate combination',
        });
      }
      combos.add(key);
      if (v.sku) {
        if (skus.has(v.sku.toLowerCase())) {
          ctx.addIssue({ code: 'custom', path: ['variants', i, 'sku'], message: 'duplicate SKU' });
        }
        skus.add(v.sku.toLowerCase());
      }
      if (v.compareAtPrice !== null && v.compareAtPrice <= v.price) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants', i, 'compareAtPrice'],
          message: 'must be above the price',
        });
      }
    });
  });
export type ImportProduct = z.infer<typeof importProduct>;

/** One staged chunk: whole products only, so a chunk never needs another's rows. */
export const importChunk = z.array(importProduct).min(1).max(100);

// ---- Cells and rows: the browser's dry run --------------------------------------

export type ImportErrorCode = 'required' | 'invalid' | 'duplicate' | 'conflict' | 'too_many';

export interface ImportRowError {
  /** The spreadsheet row, 1-based, counting the header row. */
  row: number;
  /** The column's ID (see `columnId`), or '' for the whole row. */
  column: string;
  code: ImportErrorCode;
  message: string;
}

const TRUE = new Set(['yes', 'y', 'true', '1', 'হ্যাঁ', 'হ্যা', 'হাঁ']);
const FALSE = new Set(['no', 'n', 'false', '0', 'না']);

/** "yes", "হ্যাঁ", "TRUE", "1" -> true; "" -> null; anything else -> undefined (an error). */
export function parseBooleanCell(cell: string): boolean | null | undefined {
  const text = toLatinDigits(normalizeKey(cell));
  if (!text) return null;
  if (TRUE.has(text)) return true;
  if (FALSE.has(text)) return false;
  return undefined;
}

const STATUS_WORDS: Record<string, ProductStatus> = {
  draft: 'draft',
  active: 'active',
  archived: 'archived',
  খসড়া: 'draft',
  সক্রিয়: 'active',
  আর্কাইভ: 'archived',
};

/** Comma-separated values, trimmed, empty ones dropped. */
export const splitList = (cell: string): string[] =>
  cell.split(/[,،]/u).map(cleanText).filter(Boolean);

/** A row as read from the file: the cell text under each mapped column's ID. */
export type MappedRow = Readonly<Record<string, string | undefined>>;

export interface DryRunResult {
  products: ImportProduct[];
  errors: ImportRowError[];
  /** Rows that belong to a product with errors; nothing of theirs is imported. */
  skippedRows: number;
}

/**
 * Groups mapped rows into products and checks every cell: the import's dry
 * run. `firstRow` is the spreadsheet row of rows[0] (2 when row 1 is the
 * header). A product with any error is left out whole, so a half-imported
 * product never appears.
 */
export function dryRunImport(
  rows: readonly MappedRow[],
  options: { defaultLocale: Locale; firstRow?: number },
): DryRunResult {
  const firstRow = options.firstRow ?? 2;
  const errors: ImportRowError[] = [];
  const groups = new Map<string, { rows: { n: number; cells: MappedRow }[] }>();

  rows.forEach((cells, i) => {
    const n = firstRow + i;
    if (Object.values(cells).every((v) => !v?.trim())) return; // blank row
    const handle = cleanText(cells.handle ?? '').toLowerCase();
    const key = handle || `row-${n}`;
    const group = groups.get(key) ?? { rows: [] };
    group.rows.push({ n, cells });
    groups.set(key, group);
  });

  const products: ImportProduct[] = [];
  const skusInFile = new Map<string, number>();
  let skippedRows = 0;

  for (const [handle, group] of groups) {
    const before = errors.length;
    const product = buildProduct(handle, group.rows, options.defaultLocale, errors);
    for (const v of product?.variants ?? []) {
      if (!v.sku) continue;
      const seen = skusInFile.get(v.sku.toLowerCase());
      if (seen !== undefined) {
        errors.push({
          row: v.row,
          column: 'sku',
          code: 'duplicate',
          message: `SKU also on row ${seen}`,
        });
      } else {
        skusInFile.set(v.sku.toLowerCase(), v.row);
      }
    }
    if (product && errors.length === before) {
      const checked = importProduct.safeParse(product);
      if (checked.success) {
        products.push(checked.data);
        continue;
      }
      for (const issue of checked.error.issues) {
        const [first, index, field] = issue.path;
        const variant = first === 'variants' ? product.variants[Number(index)] : undefined;
        const column =
          first === 'translations' && typeof field === 'string'
            ? `${field}:${String(index)}`
            : variant && typeof field === 'string'
              ? field
              : String(first ?? '');
        errors.push({
          row: variant?.row ?? product.row,
          column,
          code: 'invalid',
          message: issue.message,
        });
      }
    }
    skippedRows += group.rows.length;
  }
  return { products, errors: errors.sort((a, b) => a.row - b.row), skippedRows };
}

function buildProduct(
  handle: string,
  rows: { n: number; cells: MappedRow }[],
  defaultLocale: Locale,
  errors: ImportRowError[],
): ImportProduct | null {
  const first = rows[0];
  if (!first) return null;
  const error = (row: number, column: string, code: ImportErrorCode, message: string) =>
    errors.push({ row, column, code, message });

  /** A product-level cell: from the first row; later rows must leave it empty or repeat it. */
  const productCell = (column: string): string => {
    const value = cleanText(first.cells[column] ?? '');
    for (const { n, cells } of rows.slice(1)) {
      const other = cleanText(cells[column] ?? '');
      if (other && other !== value)
        error(n, column, 'conflict', 'differs from the product’s first row');
    }
    return value;
  };

  const translations: ImportProduct['translations'] = {};
  for (const lang of LOCALE_VALUES) {
    const title = productCell(columnId({ field: 'title', locale: lang }));
    const slug = productCell(columnId({ field: 'slug', locale: lang }));
    const description = first.cells[columnId({ field: 'description', locale: lang })]?.trim() ?? '';
    const seoTitle = productCell(columnId({ field: 'seoTitle', locale: lang }));
    const seoDescription = productCell(columnId({ field: 'seoDescription', locale: lang }));
    if (!title) {
      if (slug || description || seoTitle || seoDescription) {
        error(
          first.n,
          columnId({ field: 'title', locale: lang }),
          'required',
          'a title is needed for this language',
        );
      }
      continue;
    }
    translations[lang] = {
      title,
      slug: slug || null,
      description: description ? richTextFromMarkdown(description) : null,
      seoTitle: seoTitle || null,
      seoDescription: seoDescription || null,
    };
  }
  if (!translations[defaultLocale]) {
    error(
      first.n,
      columnId({ field: 'title', locale: defaultLocale }),
      'required',
      'a title in the store’s language is needed',
    );
  }

  const statusCell = productCell('status');
  const status = statusCell ? STATUS_WORDS[normalizeKey(statusCell)] : 'draft';
  if (!status) error(first.n, 'status', 'invalid', 'draft, active or archived');

  const categories = splitList(productCell('categories')).map((path) =>
    path.split('>').map(cleanText).filter(Boolean),
  );
  const tagList: string[] = [];
  for (const raw of splitList(productCell('tags'))) {
    const tag = normalizeTag(raw);
    if (tag === null) error(first.n, 'tags', 'invalid', `tags are 1–${L.tagLength} characters`);
    else if (!tagList.includes(tag)) tagList.push(tag);
  }
  if (tagList.length > L.tagsPerProduct) {
    error(first.n, 'tags', 'too_many', `at most ${L.tagsPerProduct} tags`);
  }

  const images = splitList(productCell('images'));
  if (images.length > L.imagesPerProduct) {
    error(first.n, 'images', 'too_many', `at most ${L.imagesPerProduct} images`);
  }

  // Options: names from the first row; each row gives its values.
  const optionCount = [1, 2, 3].filter((i) =>
    LOCALE_VALUES.some((lang) => cleanText(first.cells[`option${i}Name:${lang}`] ?? '')),
  ).length;
  const options: ImportProduct['options'] = [];
  for (let i = 1; i <= optionCount; i++) {
    const name: Partial<Record<Locale, string>> = {};
    for (const lang of LOCALE_VALUES) {
      const value = productCell(`option${i}Name:${lang}`);
      if (value) name[lang] = value;
    }
    if (!name[defaultLocale]) {
      error(
        first.n,
        `option${i}Name:${defaultLocale}`,
        'required',
        'an option name in the store’s language is needed',
      );
    }
    options.push({ name });
  }
  if (optionCount === 0 && rows.length > 1) {
    for (const { n } of rows.slice(1)) {
      error(n, 'handle', 'conflict', 'a product with several rows needs options');
    }
  }
  if (rows.length > L.variantsPerProduct) {
    error(first.n, 'handle', 'too_many', `at most ${L.variantsPerProduct} variants per product`);
  }

  const variants: ImportVariant[] = [];
  for (const { n, cells } of rows) {
    const cell = (column: string) => cleanText(cells[column] ?? '');
    const values: Partial<Record<Locale, string>>[] = [];
    for (let i = 1; i <= optionCount; i++) {
      const value: Partial<Record<Locale, string>> = {};
      for (const lang of LOCALE_VALUES) {
        const label = cell(`option${i}Value:${lang}`);
        if (label) value[lang] = label;
      }
      if (!value[defaultLocale]) {
        error(
          n,
          `option${i}Value:${defaultLocale}`,
          'required',
          'an option value in the store’s language is needed',
        );
      }
      values.push(value);
    }
    const amount = (column: string, required: boolean): number | null => {
      const text = cell(column);
      if (!text) {
        if (required) error(n, column, 'required', 'a price is needed');
        return null;
      }
      const value = parseAmount(text);
      if (value === null || value < 0 || value > L.maxPrice) {
        error(n, column, 'invalid', 'not a price');
        return null;
      }
      return value;
    };
    const whole = (column: string): number | null => {
      const text = cell(column);
      if (!text) return null;
      const value = parseInteger(text);
      if (value === null || value > L.maxStock) {
        error(n, column, 'invalid', 'not a whole number');
        return null;
      }
      return value;
    };
    const flag = (column: string): boolean | null => {
      const value = parseBooleanCell(cell(column));
      if (value === undefined) {
        error(n, column, 'invalid', 'yes or no');
        return null;
      }
      return value;
    };
    const skuText = cell('sku');
    const skuValue = skuText ? sku.safeParse(skuText) : null;
    if (skuValue && !skuValue.success) error(n, 'sku', 'invalid', 'letters, digits and . _ - / #');
    const barcodeText = cell('barcode');
    const barcodeValue = barcodeText ? barcode.safeParse(barcodeText) : null;
    if (barcodeValue && !barcodeValue.success)
      error(n, 'barcode', 'invalid', 'letters, digits and hyphens');

    variants.push({
      row: n,
      values,
      sku: skuValue?.success ? skuValue.data : null,
      barcode: barcodeValue?.success ? barcodeValue.data : null,
      price: amount('price', true) ?? 0,
      compareAtPrice: amount('compareAtPrice', false),
      costPrice: amount('costPrice', false),
      weightGrams: whole('weightGrams'),
      trackInventory: flag('trackInventory'),
      allowBackorder: flag('allowBackorder'),
      lowStockThreshold: whole('lowStockThreshold'),
      stock: whole('stock'),
      image: cell('variantImage') || null,
    });
  }

  // Attributes: every "Attribute: <key>" column, with its language if it has one.
  const attributes: ImportProduct['attributes'] = [];
  const attributeColumns = new Set(
    rows.flatMap(({ cells }) => Object.keys(cells).filter((c) => c.startsWith('attribute:'))),
  );
  for (const column of attributeColumns) {
    const [, key = '', lang] = column.split(':');
    const values = splitList(productCell(column));
    if (values.length) attributes.push({ key, locale: (lang as Locale) ?? null, values });
  }

  return {
    handle,
    row: first.n,
    status: status ?? 'draft',
    translations,
    categories,
    tags: tagList.slice(0, L.tagsPerProduct),
    brand: productCell('brand') || null,
    vatCategory: productCell('vatCategory').toLowerCase() || null,
    options,
    variants,
    images,
    attributes,
  };
}

/** Splits products into staged chunks of at most `size` products. */
export function chunkProducts<T>(products: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < products.length; i += size) chunks.push(products.slice(i, i + size));
  return chunks;
}
