import { describe, expect, it } from 'vitest';
import {
  attributeCreate,
  attributeValues,
  bulkVariantPatch,
  collectionCreate,
  collectionRules,
  inventoryAdjustments,
  productCreate,
  productOptions,
  productPatch,
  sku,
  tags,
  variantPatch,
} from './schemas';
import { combinationCount, combinations, optionsKey } from './variants';

const uuid = (n: number) => `0190a0b0-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('productCreate', () => {
  it('accepts a minimal product and fills defaults', () => {
    const product = productCreate.parse({ translations: { bn: { title: '  লাল   শাড়ি ' } } });
    expect(product).toEqual({ status: 'draft', translations: { bn: { title: 'লাল শাড়ি' } } });
  });

  it('needs at least one language and refuses archived on create', () => {
    expect(productCreate.safeParse({ translations: {} }).success).toBe(false);
    expect(productCreate.safeParse({ translations: { fr: { title: 'x' } } }).success).toBe(false);
    expect(
      productCreate.safeParse({ status: 'archived', translations: { en: { title: 'x' } } }).success,
    ).toBe(false);
  });

  it('normalizes slugs and refuses bad ones', () => {
    const ok = productCreate.parse({ translations: { en: { title: 'x', slug: ' Red-Saree ' } } });
    expect(ok.translations.en?.slug).toBe('red-saree');
    expect(
      productCreate.safeParse({ translations: { en: { title: 'x', slug: 'red saree' } } }).success,
    ).toBe(false);
  });

  it('clears empty SEO fields to null', () => {
    const product = productCreate.parse({
      translations: { en: { title: 'x', seoTitle: '   ', seoDescription: ' Fine ' } },
    });
    expect(product.translations.en).toMatchObject({ seoTitle: null, seoDescription: 'Fine' });
  });

  it('checks prices are poisha integers and compare-at is above the price', () => {
    const base = { translations: { en: { title: 'x' } } };
    expect(productCreate.safeParse({ ...base, variant: { price: 125_000 } }).success).toBe(true);
    expect(productCreate.safeParse({ ...base, variant: { price: 12.5 } }).success).toBe(false);
    expect(productCreate.safeParse({ ...base, variant: { price: -1 } }).success).toBe(false);
    expect(
      productCreate.safeParse({ ...base, variant: { price: 1000, compareAtPrice: 1000 } }).success,
    ).toBe(false);
    expect(
      productCreate.safeParse({ ...base, variant: { price: 1000, compareAtPrice: 1500 } }).success,
    ).toBe(true);
  });

  it('refuses rich text outside the whitelist', () => {
    const description = { type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] };
    expect(
      productCreate.safeParse({ translations: { en: { title: 'x', description } } }).success,
    ).toBe(false);
  });
});

describe('productPatch and variants', () => {
  it('lets a translation be removed with null', () => {
    expect(productPatch.parse({ translations: { en: null } })).toEqual({
      translations: { en: null },
    });
  });

  it('checks compare-at only when both prices are in the patch', () => {
    expect(variantPatch.safeParse({ compareAtPrice: 10 }).success).toBe(true);
    expect(variantPatch.safeParse({ price: 20, compareAtPrice: 10 }).success).toBe(false);
  });

  it('limits bulk edits', () => {
    const edits = Array.from({ length: 201 }, (_, i) => ({ id: uuid(i), price: 100 }));
    expect(bulkVariantPatch.safeParse(edits).success).toBe(false);
    expect(bulkVariantPatch.safeParse(edits.slice(0, 200)).success).toBe(true);
  });
});

describe('sku and tags', () => {
  it('accepts common SKU shapes and refuses spaces', () => {
    for (const s of ['TS-001', 'শাড়ি-০১', 'A/B#1', 'x.y_z'])
      expect(sku.safeParse(s).success).toBe(true);
    for (const s of ['has space', '-lead', '', 'x'.repeat(65)])
      expect(sku.safeParse(s).success).toBe(false);
  });

  it('normalizes, de-duplicates and limits tags', () => {
    expect(tags.parse([' Eid Sale', 'eid  sale', 'ঈদ'])).toEqual(['eid sale', 'ঈদ']);
    expect(tags.safeParse(['']).success).toBe(false);
    expect(tags.safeParse(Array.from({ length: 31 }, (_, i) => `t${i}`)).success).toBe(false);
  });
});

describe('options and combinations', () => {
  const option = (name: string, labels: string[]) => ({
    name: { en: name },
    values: labels.map((l) => ({ label: { en: l } })),
  });

  it('accepts up to 3 options and 100 variants', () => {
    expect(
      productOptions.safeParse([
        option('Size', ['S', 'M', 'L', 'XL']),
        option('Colour', ['Red', 'Blue', 'Green', 'Black', 'White']),
        option('Fit', ['Slim', 'Regular', 'Loose', 'Oversized', 'Tall']),
      ]).success,
    ).toBe(true);
  });

  it('refuses a 4th option, more than 100 variants, and repeated names or values', () => {
    const four = ['A', 'B', 'C', 'D'].map((n) => option(n, ['x']));
    expect(productOptions.safeParse(four).success).toBe(false);
    const tooMany = [
      option(
        'A',
        Array.from({ length: 11 }, (_, i) => `a${i}`),
      ),
      option(
        'B',
        Array.from({ length: 10 }, (_, i) => `b${i}`),
      ),
    ];
    expect(productOptions.safeParse(tooMany).success).toBe(false);
    expect(productOptions.safeParse([option('Size', ['S']), option('size', ['M'])]).success).toBe(
      false,
    );
    expect(productOptions.safeParse([option('Size', ['S', ' s '])]).success).toBe(false);
  });

  it('generates combinations in option order', () => {
    expect(combinations([['S', 'M'], ['Red']])).toEqual([
      ['S', 'Red'],
      ['M', 'Red'],
    ]);
    expect(combinations([])).toEqual([[]]);
    expect(
      combinationCount([
        ['a', 'b'],
        ['c', 'd', 'e'],
      ]),
    ).toBe(6);
    expect(() => combinations([Array(11).fill(0), Array(10).fill(0)])).toThrow(RangeError);
  });

  it('keys a combination by its sorted value IDs', () => {
    expect(optionsKey([uuid(2), uuid(1)])).toBe(optionsKey([uuid(1), uuid(2)]));
    expect(optionsKey([])).toBe('');
  });
});

describe('collections', () => {
  it('accepts every condition type', () => {
    const rules = collectionRules.parse({
      conditions: [
        { type: 'category', categoryId: uuid(1) },
        { type: 'price', min: 50_000, max: null },
        { type: 'tag', tag: ' Eid Sale ' },
        { type: 'attribute_range', attributeId: uuid(2), min: 4, max: 16 },
        { type: 'created_within_days', days: 30 },
      ],
    });
    expect(rules.match).toBe('all');
    expect(rules.conditions[2]).toEqual({ type: 'tag', tag: 'eid sale' });
  });

  it('refuses more than 5 conditions, empty or inverted ranges and unknown types', () => {
    const c = { type: 'created_within_days', days: 7 };
    expect(collectionRules.safeParse({ conditions: Array(6).fill(c) }).success).toBe(false);
    expect(collectionRules.safeParse({ conditions: [] }).success).toBe(false);
    expect(
      collectionRules.safeParse({ conditions: [{ type: 'price', min: null, max: null }] }).success,
    ).toBe(false);
    expect(
      collectionRules.safeParse({ conditions: [{ type: 'price', min: 500, max: 100 }] }).success,
    ).toBe(false);
    expect(collectionRules.safeParse({ conditions: [{ type: 'sql', where: '1=1' }] }).success).toBe(
      false,
    );
    expect(collectionRules.safeParse({ match: 'any', conditions: [c] }).success).toBe(false);
  });

  it('needs rules for a rule collection, and no manual sort', () => {
    const translations = { en: { name: 'Eid' } };
    expect(collectionCreate.safeParse({ kind: 'rule', translations }).success).toBe(false);
    expect(
      collectionCreate.safeParse({
        kind: 'rule',
        translations,
        sort: 'manual',
        rules: { conditions: [{ type: 'created_within_days', days: 7 }] },
      }).success,
    ).toBe(false);
    expect(collectionCreate.parse({ kind: 'manual', translations })).toMatchObject({
      sort: 'manual',
      published: false,
    });
  });
});

describe('attributes', () => {
  const base = { key: 'fabric', type: 'choice', translations: { en: { name: 'Fabric' } } };

  it('accepts a definition and defaults its flags', () => {
    expect(attributeCreate.parse(base)).toMatchObject({ filterable: false, visible: true });
  });

  it('refuses text filters, the reserved brand key and bad keys', () => {
    expect(attributeCreate.safeParse({ ...base, type: 'text', filterable: true }).success).toBe(
      false,
    );
    expect(attributeCreate.safeParse({ ...base, key: 'brand' }).success).toBe(false);
    for (const key of ['Fabric', '1st', 'কাপড়', 'a-b', 'x'.repeat(41)]) {
      expect(attributeCreate.safeParse({ ...base, key }).success).toBe(false);
    }
  });

  it('refuses repeated value labels', () => {
    expect(
      attributeValues.safeParse([{ label: { en: 'Cotton' } }, { label: { en: 'cotton' } }]).success,
    ).toBe(false);
  });
});

describe('inventoryAdjustments', () => {
  it('accepts deltas and counts, and refuses zero deltas and negative counts', () => {
    const variantId = uuid(1);
    expect(
      inventoryAdjustments.safeParse([
        { mode: 'delta', variantId, quantity: -2, reason: 'damaged' },
        { mode: 'set', variantId, onHand: 10, reason: 'count' },
      ]).success,
    ).toBe(true);
    expect(
      inventoryAdjustments.safeParse([{ mode: 'delta', variantId, quantity: 0, reason: 'other' }])
        .success,
    ).toBe(false);
    expect(
      inventoryAdjustments.safeParse([{ mode: 'set', variantId, onHand: -1, reason: 'count' }])
        .success,
    ).toBe(false);
  });
});
