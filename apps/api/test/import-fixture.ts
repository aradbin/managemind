// The 500-product import fixture (phase-2-plan §8): Bangla and English,
// up to 3 options, 1,500 variants, brand, tags, attributes of every type,
// stock and image links. Rows are what the browser's column mapping produces
// (MappedRow); the file formats themselves are the import wizard's (PR 14).
import type { MappedRow } from '@managemind/shared/catalog/import';

export const FIXTURE_ATTRIBUTES = [
  { key: 'fabric', type: 'choice', name: 'Fabric' },
  { key: 'occasion', type: 'multi_choice', name: 'Occasion' },
  { key: 'weight_kg', type: 'number', name: 'Weight' },
  { key: 'care', type: 'text', name: 'Care' },
  { key: 'handmade', type: 'boolean', name: 'Handmade' },
] as const;

const SIZES = [
  ['S', 'ছোট'],
  ['M', 'মাঝারি'],
  ['L', 'বড়'],
] as const;
const COLOURS = [
  ['Red', 'লাল'],
  ['Blue', 'নীল'],
] as const;
const FABRICS = ['Cotton', 'Silk', 'Linen', 'Jamdani'];
const BRANDS = ['Aarong', 'Yellow', 'Kay Kraft', 'Rang Bangladesh'];
const toBangla = (n: number) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)] ?? d);

/**
 * Rows for `count` products of 3 variants each. Every fifth product has three
 * options (size, colour, fit), the rest one (size). SKUs start with `prefix`.
 */
export function fixtureRows(count = 500, prefix = 'FX'): MappedRow[] {
  const rows: MappedRow[] = [];
  for (let p = 0; p < count; p++) {
    const handle = `${prefix.toLowerCase()}-product-${p}`;
    const threeOptions = p % 5 === 0;
    for (let v = 0; v < 3; v++) {
      const [sizeEn, sizeBn] = SIZES[v] as (typeof SIZES)[number];
      const row: Record<string, string> = {
        handle,
        'option1Name:en': 'Size',
        'option1Name:bn': 'সাইজ',
        'option1Value:en': sizeEn,
        'option1Value:bn': sizeBn,
        sku: `${prefix}-${p}-${v}`,
        // Bangla digits and the taka sign on some rows, as clients type them.
        price: p % 2 ? `৳${toBangla(500 + p)}` : `${500 + p}.50`,
        stock: String((p + v) % 7),
        trackInventory: 'yes',
      };
      if (threeOptions) {
        const [colourEn, colourBn] = COLOURS[v % 2] as (typeof COLOURS)[number];
        Object.assign(row, {
          'option2Name:en': 'Colour',
          'option2Name:bn': 'রং',
          'option2Value:en': colourEn,
          'option2Value:bn': colourBn,
          'option3Name:en': 'Fit',
          'option3Name:bn': 'ফিট',
          'option3Value:en': v === 2 ? 'Loose' : 'Regular',
          'option3Value:bn': v === 2 ? 'ঢিলা' : 'নিয়মিত',
        });
      }
      if (v === 0) {
        Object.assign(row, {
          'title:en': `Fixture Panjabi ${p}`,
          'title:bn': `ফিক্সচার পাঞ্জাবি ${toBangla(p)}`,
          'description:en': `Hand-finished **${FABRICS[p % 4]}** panjabi.\n- Machine wash`,
          'description:bn': `হাতে তৈরি ${FABRICS[p % 4]} পাঞ্জাবি।`,
          status: p % 10 === 9 ? 'draft' : 'active',
          categories: p % 2 ? 'Clothing > Men > Panjabi' : 'Clothing > Men',
          tags: p % 3 ? 'eid, new-arrival' : 'eid',
          brand: BRANDS[p % 4] as string,
          'attribute:fabric': FABRICS[p % 4] as string,
          'attribute:occasion': p % 2 ? 'Eid, Wedding' : 'Casual',
          'attribute:weight_kg': p % 2 ? '০.৫' : '0.75',
          'attribute:care:en': 'Dry clean',
          'attribute:care:bn': 'ড্রাই ক্লিন',
          'attribute:handmade': p % 2 ? 'হ্যাঁ' : 'no',
          ...(p < 3
            ? { images: `https://img.example.test/${p}/a.jpg, https://img.example.test/${p}/b.jpg` }
            : {}),
        });
      }
      rows.push(row);
    }
  }
  return rows;
}
