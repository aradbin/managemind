import { describe, expect, it } from 'vitest';
import { metaCart } from './meta-cart';

const a = '0192f0c3-1111-7222-8333-444455556666';
const b = '0192f0c3-1111-7222-8333-444455557777';

describe('metaCart', () => {
  it('reads variants and quantities, encoded or not', () => {
    const query = new URLSearchParams(`products=${a}%3A2,${b}:1&coupon=EID`);
    expect(metaCart(query)).toEqual([
      { variantId: a, quantity: 2 },
      { variantId: b, quantity: 1 },
    ]);
  });

  it('skips what isn’t a variant ID and keeps quantities between 1 and 999', () => {
    const query = new URLSearchParams(`products=nope:2,${a}:0,${b}:5000`);
    expect(metaCart(query)).toEqual([
      { variantId: a, quantity: 1 },
      { variantId: b, quantity: 999 },
    ]);
  });

  it('is empty without products', () => {
    expect(metaCart(new URLSearchParams(''))).toEqual([]);
  });
});
