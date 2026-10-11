import { describe, expect, it } from 'vitest';
import { checkSlug, isReservedSlug } from './slug';

describe('checkSlug', () => {
  it('accepts and normalizes a valid slug', () => {
    expect(checkSlug('  Acme-Gadgets ')).toEqual({ ok: true, slug: 'acme-gadgets' });
    expect(checkSlug('a1b')).toEqual({ ok: true, slug: 'a1b' });
  });

  it.each(['ab', '-acme', 'acme-', 'ac--me', 'acme_shop', 'acme.shop', 'দোকান', 'a'.repeat(33)])(
    'refuses %s as invalid',
    (slug) => {
      expect(checkSlug(slug)).toEqual({ ok: false, code: 'invalid' });
    },
  );

  it.each(['admin', 'api', 'www', 'auth', 'notify', 'Bkash', 'managemind'])(
    'refuses %s as reserved',
    (slug) => {
      expect(checkSlug(slug)).toEqual({ ok: false, code: 'reserved' });
    },
  );

  it('exposes the reserved list for lookups', () => {
    expect(isReservedSlug('stores')).toBe(true);
    expect(isReservedSlug('acme')).toBe(false);
  });
});
