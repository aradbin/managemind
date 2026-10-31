import { describe, expect, it } from 'vitest';
import { csvCell, type MetaFeedItem, metaFeedHeader, metaFeedRow, optionField } from './feed';

const item: MetaFeedItem = {
  id: 'v1',
  itemGroupId: 'p1',
  title: 'Kurta, "white"',
  description: '',
  availability: 'in stock',
  price: 150000,
  salePrice: 120000,
  link: 'https://shop.example.test/products/kurta?v=v1',
  imageLink: 'https://shop.example.test/media/a.webp',
  additionalImageLinks: [
    'https://shop.example.test/media/b.webp',
    'https://shop.example.test/media/c.webp',
  ],
  brand: 'Demo',
  color: 'White',
  size: 'L',
  material: null,
  quantity: null,
};

describe('the Meta feed CSV', () => {
  it('quotes cells with commas, quotes and line breaks only', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
  });

  it('writes a row in the header’s order, with the title standing in for an empty description', () => {
    expect(metaFeedHeader().split(',')).toHaveLength(16);
    expect(metaFeedRow(item)).toBe(
      `${[
        'v1',
        'p1',
        '"Kurta, ""white"""',
        '"Kurta, ""white"""',
        'in stock',
        'new',
        '1500.00 BDT',
        '1200.00 BDT',
        'https://shop.example.test/products/kurta?v=v1',
        'https://shop.example.test/media/a.webp',
        '"https://shop.example.test/media/b.webp,https://shop.example.test/media/c.webp"',
        'Demo',
        'White',
        'L',
        '',
        '',
      ].join(',')}\n`,
    );
  });

  it('cuts a long title to Meta’s 200 characters', () => {
    const row = metaFeedRow({ ...item, title: 'x'.repeat(300) });
    expect(row.split(',')[2]).toHaveLength(200);
  });

  it('maps option names in English and Bangla to Meta’s columns', () => {
    expect(optionField('Colour')).toBe('color');
    expect(optionField(' সাইজ ')).toBe('size');
    expect(optionField('Fabric')).toBe('material');
    expect(optionField('Storage')).toBeNull();
  });
});
