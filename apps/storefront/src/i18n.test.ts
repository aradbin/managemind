import { placeholders } from '@managemind/shared/i18n';
import { describe, expect, it } from 'vitest';
import { bn, en, type StoreMessageKey, translator } from './i18n';

describe('storefront messages', () => {
  it('has every English message in Bangla, with the same placeholders', () => {
    const keys = Object.keys(en) as StoreMessageKey[];
    expect(Object.keys(bn).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(placeholders(bn[key]), key).toEqual(placeholders(en[key]));
  });

  it('uses the store’s digits', () => {
    expect(translator('bn')('listing.count', { count: 24 })).toBe('২৪টি পণ্য');
    expect(translator('bn', 'latin')('listing.count', { count: 24 })).toBe('24টি পণ্য');
    expect(translator('en')('listing.count', { count: 1 })).toBe('1 product');
  });
});
