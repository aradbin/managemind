import { describe, expect, it } from 'vitest';
import {
  add,
  allocate,
  compare,
  format,
  type Money,
  money,
  multiply,
  percentOf,
  subtract,
  sum,
} from './money';

const bdt = (amount: number) => money(amount);
const amounts = (ms: Money[]) => ms.map((m) => m.amount);

describe('money', () => {
  it('only accepts safe integers in minor units', () => {
    expect(bdt(12_345)).toEqual({ amount: 12_345, currency: 'BDT' });
    expect(() => bdt(10.5)).toThrow(RangeError);
    expect(() => bdt(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => bdt(Number.NaN)).toThrow(RangeError);
  });

  it('adds, subtracts, multiplies and sums exactly', () => {
    expect(add(bdt(10), bdt(20)).amount).toBe(30);
    expect(subtract(bdt(10), bdt(25)).amount).toBe(-15);
    expect(multiply(bdt(1999), 3).amount).toBe(5997);
    expect(sum([bdt(1), bdt(2), bdt(3)]).amount).toBe(6);
    expect(sum([]).amount).toBe(0);
    expect(() => multiply(bdt(100), 1.5)).toThrow(RangeError);
    expect(compare(bdt(1), bdt(2))).toBe(-1);
  });

  it('refuses to mix currencies', () => {
    const other = { amount: 1, currency: 'USD' } as unknown as Money;
    expect(() => add(bdt(1), other)).toThrow(TypeError);
  });

  it('rounds percentages once, half away from zero', () => {
    expect(percentOf(bdt(999), 1500).amount).toBe(150); // 149.85
    expect(percentOf(bdt(1), 5000).amount).toBe(1); // 0.5
    expect(percentOf(bdt(-1), 5000).amount).toBe(-1); // -0.5
    expect(percentOf(bdt(1), 1250).amount).toBe(0); // 0.125
    expect(percentOf(bdt(9_000_000_000_000), 9_999).amount).toBe(8_999_100_000_000);
    expect(() => percentOf(bdt(100), 12.5)).toThrow(RangeError);
  });

  it('allocates so the parts always add up', () => {
    expect(amounts(allocate(bdt(100), [1, 1, 1]))).toEqual([34, 33, 33]);
    expect(amounts(allocate(bdt(-100), [1, 1, 1]))).toEqual([-34, -33, -33]);
    expect(amounts(allocate(bdt(1000), [0, 3, 1]))).toEqual([0, 750, 250]);
    expect(amounts(allocate(bdt(5), [1, 2]))).toEqual([2, 3]);
    expect(() => allocate(bdt(5), [0, 0])).toThrow(RangeError);
    expect(() => allocate(bdt(5), [1, -1])).toThrow(RangeError);

    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 1000; i += 1) {
      const total = rand(10_000_000) - 2_000_000;
      const weights = Array.from({ length: 1 + rand(8) }, () => rand(5000));
      if (!weights.some((w) => w > 0)) weights[0] = 1;
      const parts = allocate(bdt(total), weights);
      expect(sum(parts).amount).toBe(total);
    }
  });
});

describe('format', () => {
  it('formats in English with Latin digits', () => {
    expect(format(bdt(123_450), 'en')).toBe('৳1,234.50');
    expect(format(bdt(5), 'en')).toBe('৳0.05');
    expect(format(bdt(-5), 'en')).toBe('-৳0.05');
  });

  it('formats in Bangla with Bengali digits and lakh grouping', () => {
    expect(format(bdt(123_450), 'bn')).toBe('১,২৩৪.৫০৳');
    expect(format(bdt(123_456_750), 'bn')).toBe('১২,৩৪,৫৬৭.৫০৳');
  });

  it('lets a store choose Latin digits in Bangla', () => {
    expect(format(bdt(123_450), 'bn', { numerals: 'latin' })).toBe('1,234.50৳');
  });
});
