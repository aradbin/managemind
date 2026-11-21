import { describe, expect, it } from 'vitest';
import { apiPath } from './store-page';

const none = new URLSearchParams();

describe('apiPath', () => {
  it('asks the cart and checkout shells for the store’s promises, other shells for the layout', () => {
    expect(apiPath({ kind: 'cart' }, null, none, null)).toBe('/v1/store/pages/shop');
    expect(apiPath({ kind: 'checkout' }, 'en', none, null)).toBe('/v1/store/pages/shop?locale=en');
    expect(apiPath({ kind: 'track' }, null, none, null)).toBe('/v1/store/pages/layout');
    expect(apiPath(null, null, none, null)).toBe('/v1/store/pages/layout');
  });

  it('keeps a listing’s parameters, normalized', () => {
    expect(
      apiPath(
        { kind: 'category', slug: 'sarees' },
        null,
        new URLSearchParams('utm=x&sale=1'),
        null,
      ),
    ).toBe('/v1/store/pages/categories/sarees?sale=1');
  });
});
