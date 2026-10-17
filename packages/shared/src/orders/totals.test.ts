import { describe, expect, it } from 'vitest';
import { calculateTotals, roundDiscount, type TotalsLine } from './totals';

const line = (key: string, unitPrice: number, quantity = 1, vatRateBp = 0): TotalsLine => ({
  key,
  unitPrice,
  quantity,
  vatRateBp,
});

describe('calculateTotals', () => {
  it('adds lines and delivery', () => {
    const t = calculateTotals({
      lines: [line('a', 50_000, 2), line('b', 12_000)],
      deliveryFee: 7_000,
    });
    expect(t.lines.map((l) => l.total)).toEqual([100_000, 12_000]);
    expect(t).toMatchObject({
      subtotal: 112_000,
      discountTotal: 0,
      deliveryFee: 7_000,
      total: 119_000,
    });
  });

  it('allocates an order discount by what each line costs, adding up exactly', () => {
    // ৳100 over ৳333.33, ৳333.33 and ৳333.34: largest remainder, earlier lines first on ties.
    const t = calculateTotals({
      lines: [line('a', 33_333), line('b', 33_333), line('c', 33_334)],
      adjustments: [{ key: 'p', target: 'order', amount: 10_000 }],
    });
    const shares = t.adjustments[0]?.allocations ?? {};
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(shares).toEqual({ a: 3_333, b: 3_333, c: 3_334 });
    expect(t.discountTotal).toBe(10_000);
    expect(t.total).toBe(90_000);
  });

  it('rounds each promotion to a whole taka in the shopper’s favour', () => {
    expect(roundDiscount(4_995, 100_000)).toBe(5_000);
    expect(roundDiscount(5_000, 100_000)).toBe(5_000);
    expect(roundDiscount(5_001, 100_000)).toBe(5_100);
    expect(roundDiscount(5_001, 5_050)).toBe(5_050); // never more than what is left
    // 15% of ৳333 is ৳49.95: the shopper gets ৳50 off.
    const t = calculateTotals({
      lines: [line('a', 33_300)],
      adjustments: [{ key: 'p', target: 'items', perLine: { a: 4_995 } }],
    });
    expect(t.discountTotal).toBe(5_000);
    expect(t.total).toBe(28_300);
  });

  it('applies item discounts first, then order discounts on what remains', () => {
    const t = calculateTotals({
      lines: [line('a', 100_000), line('b', 100_000)],
      adjustments: [
        { key: 'order', target: 'order', amount: 10_000 },
        { key: 'item', target: 'items', perLine: { a: 50_000 } },
      ],
    });
    expect(t.adjustments.map((a) => a.key)).toEqual(['item', 'order']);
    // The order discount follows what each line costs after the item discount: 1:2.
    expect(t.adjustments[1]?.allocations).toEqual({ a: 3_333, b: 6_667 });
    expect(t.lines.map((l) => l.discount)).toEqual([53_333, 6_667]);
    expect(t.total).toBe(140_000);
  });

  it('never discounts a line below zero, moving the rest to other lines', () => {
    // ৳9.51 rounds up to ৳10; line a has only ৳9.60 left, so b takes the rest.
    const t = calculateTotals({
      lines: [line('a', 960), line('b', 100_000)],
      adjustments: [{ key: 'item', target: 'items', perLine: { a: 950, b: 1 } }],
    });
    expect(t.adjustments[0]?.allocations).toEqual({ a: 960, b: 40 });
    expect(t.lines.map((l) => l.total)).toEqual([0, 99_960]);
    expect(t.discountTotal).toBe(1_000);
  });

  it('caps every discount at what is left, so the total never goes below zero', () => {
    const t = calculateTotals({
      lines: [line('a', 10_000)],
      deliveryFee: 7_000,
      adjustments: [
        { key: 'o', target: 'order', amount: 50_000 },
        { key: 'd', target: 'delivery', amount: 10_000 },
      ],
    });
    expect(t).toMatchObject({ discountTotal: 10_000, deliveryDiscount: 7_000, total: 0 });
  });

  it('takes a delivery discount off the fee, not the lines', () => {
    const t = calculateTotals({
      lines: [line('a', 100_000)],
      deliveryFee: 13_000,
      adjustments: [{ key: 'free', target: 'delivery', amount: 13_000 }],
    });
    expect(t).toMatchObject({ discountTotal: 0, deliveryDiscount: 13_000, total: 100_000 });
    expect(t.adjustments[0]).toEqual({
      key: 'free',
      target: 'delivery',
      amount: 13_000,
      allocations: {},
    });
  });

  it('keeps manual discounts exact', () => {
    const t = calculateTotals({
      lines: [line('a', 100_000)],
      adjustments: [{ key: 'manual', target: 'order', amount: 1_250, roundToTaka: false }],
    });
    expect(t.discountTotal).toBe(1_250);
  });

  it('shows VAT included in prices without changing the total', () => {
    // ৳1,150 at 15% included: VAT is ৳150.
    const t = calculateTotals({
      lines: [line('a', 115_000, 1, 1_500)],
      vat: { enabled: true, pricesIncludeVat: true },
    });
    expect(t).toMatchObject({ vatTotal: 15_000, vatIncluded: true, rounding: 0, total: 115_000 });
  });

  it('adds VAT excluded from prices per line, then rounds the total to a whole taka once', () => {
    // ৳3.33 + ৳3.33 at 15%: 49.95 → 50 poisha each, so ৳7.66; rounded to ৳8.
    const t = calculateTotals({
      lines: [line('a', 333, 1, 1_500), line('b', 333, 1, 1_500)],
      vat: { enabled: true, pricesIncludeVat: false },
    });
    expect(t.lines.map((l) => l.vat)).toEqual([50, 50]);
    expect(t).toMatchObject({ vatTotal: 100, rounding: 34, total: 800 });
  });

  it('calculates VAT after discounts, per line rate, and none when VAT is off', () => {
    const lines = [line('a', 100_000, 1, 1_500), line('b', 100_000, 1, 0)];
    const adjustments = [{ key: 'o', target: 'order' as const, amount: 20_000 }];
    const on = calculateTotals({
      lines,
      adjustments,
      vat: { enabled: true, pricesIncludeVat: false },
    });
    expect(on.lines.map((l) => l.vat)).toEqual([13_500, 0]);
    const off = calculateTotals({ lines, adjustments });
    expect(off.vatTotal).toBe(0);
    expect(off.lines.map((l) => l.vatRateBp)).toEqual([0, 0]);
  });

  it('refuses fractions, negatives and repeated keys', () => {
    expect(() => calculateTotals({ lines: [line('a', 10.5)] })).toThrow(RangeError);
    expect(() => calculateTotals({ lines: [line('a', -1)] })).toThrow(RangeError);
    expect(() => calculateTotals({ lines: [line('a', 1), line('a', 2)] })).toThrow(RangeError);
  });
});
