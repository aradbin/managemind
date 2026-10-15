import { describe, expect, it } from 'vitest';
import { CATALOG_LIMITS } from './limits';
import { isCatalogSlug, nextSlug, normalizeKey, normalizeTag, slugify } from './text';

describe('slugify', () => {
  it.each([
    ['Cotton Shirt', 'cotton-shirt'],
    ['  Cotton   Shirt!! ', 'cotton-shirt'],
    ['লাল শাড়ি', 'লাল-শাড়ি'],
    ['লাল শাড়ি (Silk) – ২০২৬', 'লাল-শাড়ি-silk-২০২৬'],
    ['Café Crème', 'café-crème'],
    ['100% Pure Ghee 1kg', '100-pure-ghee-1kg'],
    ['!!!', ''],
  ])('%s -> %s', (title, slug) => {
    expect(slugify(title)).toBe(slug);
    if (slug) expect(isCatalogSlug(slug)).toBe(true);
  });

  it('composes decomposed letters (NFC) so the same title gives the same slug', () => {
    expect(slugify('Café')).toBe('café');
    expect(slugify('Café')).toBe(slugify('Café'));
  });

  it('drops zero-width joiners', () => {
    expect(slugify('র‍্যাব')).toBe(slugify('র্যাব'));
  });

  it('cuts long titles at the limit without splitting a letter from its marks', () => {
    const full = Array.from({ length: 60 }, () => 'শাড়ি').join('-');
    const slug = slugify(full.replaceAll('-', ' '));
    expect([...slug].length).toBeLessThanOrEqual(CATALOG_LIMITS.slugLength);
    expect(isCatalogSlug(slug)).toBe(true);
    expect(full.startsWith(slug)).toBe(true);
    // The character after the cut starts a new letter or word, not a mark.
    expect(/\p{M}/u.test([...full][[...slug].length] ?? '')).toBe(false);
  });
});

describe('isCatalogSlug', () => {
  it.each(['Shirt', 'a--b', '-a', 'a-', 'a b', 'a/b', 'a_b', 'a.b', '', 'x'.repeat(121)])(
    'refuses %j',
    (slug) => {
      expect(isCatalogSlug(slug)).toBe(false);
    },
  );
});

describe('nextSlug', () => {
  it('adds a number and stays within the limit', () => {
    expect(nextSlug('shirt', 2)).toBe('shirt-2');
    const long = nextSlug('a'.repeat(120), 12);
    expect(long.length).toBe(120);
    expect(long.endsWith('-12')).toBe(true);
  });
});

describe('normalizeKey and normalizeTag', () => {
  it('matches labels typed differently', () => {
    expect(normalizeKey(' Red ')).toBe(normalizeKey('RED'));
    expect(normalizeKey('Light  Blue')).toBe('light blue');
    expect(normalizeKey('লাল')).toBe('লাল');
  });

  it('normalizes tags and refuses empty or long ones', () => {
    expect(normalizeTag('  Eid  Sale ')).toBe('eid sale');
    expect(normalizeTag('ঈদ অফার')).toBe('ঈদ অফার');
    expect(normalizeTag('   ')).toBeNull();
    expect(normalizeTag('x'.repeat(51))).toBeNull();
    expect(normalizeTag('ক'.repeat(50))).toBe('ক'.repeat(50));
  });
});
