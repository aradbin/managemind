import { describe, expect, it } from 'vitest';
import {
  chunkProducts,
  columnId,
  dryRunImport,
  exportHeader,
  IMPORT_HEADERS,
  importChunk,
  type MappedRow,
  matchHeader,
  parseBooleanCell,
} from './import';

describe('headers', () => {
  it('matches the export headers in both languages, with a language suffix', () => {
    expect(matchHeader('Title (bn)')).toEqual({ field: 'title', locale: 'bn' });
    expect(matchHeader('নাম (en)')).toEqual({ field: 'title', locale: 'en' });
    expect(matchHeader('  price ')).toEqual({ field: 'price' });
    expect(matchHeader('দাম')).toEqual({ field: 'price' });
    expect(matchHeader('অপশন১ নাম (bn)')).toEqual({ field: 'option1Name', locale: 'bn' });
    expect(matchHeader('Option1 Name (en)')).toEqual({ field: 'option1Name', locale: 'en' });
    expect(matchHeader('Weight (grams)')).toEqual({ field: 'weightGrams' });
  });

  it('matches attribute columns and Shopify headers', () => {
    expect(matchHeader('Attribute: fabric')).toEqual({
      field: 'attribute',
      attributeKey: 'fabric',
    });
    expect(matchHeader('বৈশিষ্ট্য: origin (bn)')).toEqual({
      field: 'attribute',
      attributeKey: 'origin',
      locale: 'bn',
    });
    expect(matchHeader('Variant SKU')).toEqual({ field: 'sku' });
    expect(matchHeader('Vendor')).toEqual({ field: 'brand' });
    expect(matchHeader('Option1 Name')).toEqual({ field: 'option1Name' });
    expect(matchHeader('Option 2 value (bn)')).toEqual({ field: 'option2Value', locale: 'bn' });
    expect(matchHeader('অপশন ৩ মান (en)')).toEqual({ field: 'option3Value', locale: 'en' });
  });

  it('leaves unknown headers, and a language on a field without one, to the user', () => {
    expect(matchHeader('Colour notes')).toBeNull();
    expect(matchHeader('Price (bn)')).toBeNull();
    expect(matchHeader('Attribute: Bad Key')).toBeNull();
  });

  it('round-trips every export header', () => {
    for (const field of Object.keys(IMPORT_HEADERS) as (keyof typeof IMPORT_HEADERS)[]) {
      for (const lang of ['bn', 'en'] as const) {
        const ref = matchHeader(exportHeader({ field }, lang));
        if (ref?.field !== field) {
          // Localized fields need their suffix; check them with it.
          expect(matchHeader(exportHeader({ field, locale: 'en' }, lang))).toEqual({
            field,
            locale: 'en',
          });
        }
      }
    }
    expect(columnId({ field: 'attribute', attributeKey: 'fabric', locale: 'en' })).toBe(
      'attribute:fabric:en',
    );
  });
});

describe('parseBooleanCell', () => {
  it('reads yes and no in both languages', () => {
    expect(parseBooleanCell('Yes')).toBe(true);
    expect(parseBooleanCell('হ্যাঁ')).toBe(true);
    expect(parseBooleanCell('১')).toBe(true);
    expect(parseBooleanCell('না')).toBe(false);
    expect(parseBooleanCell('FALSE')).toBe(false);
    expect(parseBooleanCell(' ')).toBeNull();
    expect(parseBooleanCell('maybe')).toBeUndefined();
  });
});

const shirt: MappedRow[] = [
  {
    handle: 'Cotton-Shirt',
    'title:bn': 'সুতির শার্ট',
    'title:en': 'Cotton shirt',
    'description:en': 'Soft **cotton**\n- Machine wash',
    status: 'active',
    categories: 'Clothing > Shirts',
    tags: 'Summer, eid sale',
    brand: 'Aarong',
    'option1Name:bn': 'সাইজ',
    'option1Name:en': 'Size',
    'option1Value:bn': 'এম',
    'option1Value:en': 'M',
    sku: 'CS-M',
    price: '৳১,২৫০',
    compareAtPrice: '1500',
    stock: '১০',
    images: 'https://img.example.test/a.jpg, https://img.example.test/b.jpg',
    'attribute:fabric': 'Cotton',
    'attribute:care:en': 'Machine wash',
  },
  {
    handle: 'cotton-shirt',
    'title:bn': 'সুতির শার্ট',
    'option1Value:bn': 'এল',
    'option1Value:en': 'L',
    sku: 'CS-L',
    price: '1250.50',
    stock: '',
    trackInventory: 'yes',
  },
];

describe('dryRunImport', () => {
  it('groups rows into a product with variants, in both languages', () => {
    const { products, errors, skippedRows } = dryRunImport(shirt, { defaultLocale: 'bn' });
    expect(errors).toEqual([]);
    expect(skippedRows).toBe(0);
    expect(products).toHaveLength(1);
    const [product] = products;
    expect(product).toMatchObject({
      handle: 'cotton-shirt',
      row: 2,
      status: 'active',
      categories: [['Clothing', 'Shirts']],
      tags: ['summer', 'eid sale'],
      brand: 'Aarong',
      options: [{ name: { bn: 'সাইজ', en: 'Size' } }],
      images: ['https://img.example.test/a.jpg', 'https://img.example.test/b.jpg'],
      attributes: [
        { key: 'fabric', locale: null, values: ['Cotton'] },
        { key: 'care', locale: 'en', values: ['Machine wash'] },
      ],
    });
    expect(product?.translations.bn?.title).toBe('সুতির শার্ট');
    expect(product?.translations.en?.description?.content?.[1]?.type).toBe('bulletList');
    expect(
      product?.variants.map((v) => [v.row, v.sku, v.price, v.stock, v.trackInventory]),
    ).toEqual([
      [2, 'CS-M', 125_000, 10, null],
      [3, 'CS-L', 125_050, null, true],
    ]);
    expect(importChunk.safeParse(products).success).toBe(true);
  });

  it('reports errors per row and leaves the whole product out', () => {
    const rows: MappedRow[] = [
      { ...shirt[0], price: 'free', stock: '-1', trackInventory: 'maybe' },
      { ...shirt[1], 'title:bn': 'অন্য নাম', sku: 'CS-M' },
    ];
    const { products, errors, skippedRows } = dryRunImport(rows, { defaultLocale: 'bn' });
    expect(products).toEqual([]);
    expect(skippedRows).toBe(2);
    expect(errors.map((e) => [e.row, e.column, e.code])).toEqual([
      [2, 'price', 'invalid'],
      [2, 'trackInventory', 'invalid'],
      [2, 'stock', 'invalid'],
      [3, 'title:bn', 'conflict'],
      [3, 'sku', 'duplicate'],
    ]);
  });

  it('needs a title and option values in the store’s language', () => {
    const rows: MappedRow[] = [
      { handle: 'a', 'title:en': 'Only English', price: '10' },
      {
        handle: 'b',
        'title:bn': 'খ',
        'option1Name:bn': 'রং',
        'option1Value:en': 'Red',
        price: '10',
      },
    ];
    const { errors } = dryRunImport(rows, { defaultLocale: 'bn' });
    expect(errors.map((e) => [e.row, e.column, e.code])).toEqual([
      [2, 'title:bn', 'required'],
      [3, 'option1Value:bn', 'required'],
    ]);
  });

  it('refuses several rows without options, duplicate combinations and a missing price', () => {
    const rows: MappedRow[] = [
      { handle: 'x', 'title:en': 'X', price: '10' },
      { handle: 'x', price: '20' },
      {
        handle: 'y',
        'title:en': 'Y',
        'option1Name:en': 'Size',
        'option1Value:en': 'M',
        price: '1',
      },
      { handle: 'y', 'option1Value:en': 'm', price: '1' },
      { handle: 'z', 'title:en': 'Z' },
    ];
    const { products, errors } = dryRunImport(rows, { defaultLocale: 'en' });
    expect(products).toEqual([]);
    expect(errors.map((e) => [e.row, e.column, e.message])).toEqual([
      [3, 'handle', 'a product with several rows needs options'],
      [5, 'values', 'duplicate combination'],
      [6, 'price', 'a price is needed'],
    ]);
  });

  it('treats a row without a handle as its own product and skips blank rows', () => {
    const rows: MappedRow[] = [
      { 'title:en': 'A', price: '1' },
      { sku: '  ', price: '' },
      { 'title:en': 'B', price: '2' },
    ];
    const { products, errors } = dryRunImport(rows, { defaultLocale: 'en' });
    expect(errors).toEqual([]);
    expect(products.map((p) => [p.handle, p.row])).toEqual([
      ['row-2', 2],
      ['row-4', 4],
    ]);
  });

  it('without a handle, joins variant rows to the product above by title', () => {
    const rows: MappedRow[] = [
      { 'title:bn': 'শাড়ি', price: '1800', 'option1Name:bn': 'রং', 'option1Value:bn': 'লাল' },
      { 'title:bn': 'শাড়ি', price: '1800', 'option1Value:bn': 'নীল' },
      { price: '1900', 'option1Value:bn': 'সবুজ' },
      { 'title:bn': 'শাড়ি', price: '500' },
      { 'title:bn': 'পাঞ্জাবি', price: '950', 'option1Name:bn': 'সাইজ', 'option1Value:bn': 'এম' },
    ];
    const { products, errors } = dryRunImport(rows, { defaultLocale: 'bn' });
    expect(errors).toEqual([]);
    expect(products.map((p) => [p.handle, p.variants.length])).toEqual([
      ['row-2', 3],
      ['row-5', 1],
      ['row-6', 1],
    ]);
  });

  it('runs 500 products with 3 variants each quickly', () => {
    const rows: MappedRow[] = [];
    for (let p = 0; p < 500; p++) {
      for (const size of ['S', 'M', 'L']) {
        rows.push({
          handle: `p${p}`,
          'title:bn': `পণ্য ${p}`,
          'title:en': `Product ${p}`,
          'option1Name:en': 'Size',
          'option1Name:bn': 'সাইজ',
          'option1Value:en': size,
          'option1Value:bn': size,
          sku: `P${p}-${size}`,
          price: '৳৯৯৯',
          stock: '5',
        });
      }
    }
    const started = performance.now();
    const { products, errors } = dryRunImport(rows, { defaultLocale: 'bn' });
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(errors).toEqual([]);
    expect(products).toHaveLength(500);
    expect(chunkProducts(products, 10)).toHaveLength(50);
  });
});

describe('importChunk (server-side check)', () => {
  it('refuses rows the browser would have refused', () => {
    const [product] = dryRunImport(shirt, { defaultLocale: 'bn' }).products;
    const tampered = [
      { ...product, variants: [{ ...product?.variants[0], price: -5 }] },
      { ...product, images: ['javascript:alert(1)'] },
      { ...product, variants: [product?.variants[0], product?.variants[0]] },
    ];
    for (const p of tampered) expect(importChunk.safeParse([p]).success).toBe(false);
    expect(importChunk.safeParse([]).success).toBe(false);
  });
});
