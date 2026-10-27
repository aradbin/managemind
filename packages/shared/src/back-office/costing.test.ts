import { describe, expect, it } from 'vitest';
import {
  landedUnitCosts,
  nextOccurrence,
  occurrences,
  purchaseOrderCostShare,
  purchaseTotals,
  spreadByWeight,
  supplierAgeing,
  weightedAverageCost,
} from './costing';

describe('the cost rule (§3.3)', () => {
  it('averages a receipt into what is on hand, to the poisha', () => {
    // 10 at ৳100 and 5 at ৳130: (1000 + 650) / 15 = ৳110.
    expect(weightedAverageCost(10, 100_00, 5, 130_00)).toBe(110_00);
    // 3 at 1000 poisha and 2 at 1001: 5002 / 5 = 1000.4, rounded.
    expect(weightedAverageCost(3, 1000, 2, 1001)).toBe(1000);
    expect(weightedAverageCost(1, 1000, 1, 1001)).toBe(1001); // 1000.5 rounds up
  });

  it('takes the receipt’s cost with nothing on hand, below zero, or no cost yet', () => {
    expect(weightedAverageCost(0, 100_00, 5, 130_00)).toBe(130_00);
    expect(weightedAverageCost(-4, 100_00, 5, 130_00)).toBe(130_00);
    expect(weightedAverageCost(10, null, 5, 130_00)).toBe(130_00);
  });
});

describe('spreading other costs by value', () => {
  it('sums exactly, the remainder to the largest line', () => {
    expect(spreadByWeight(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(spreadByWeight(1000, [3000, 1000])).toEqual([750, 250]);
    expect(spreadByWeight(7, [1, 5, 1])).toEqual([1, 5, 1]);
    const parts = spreadByWeight(99_999, [12_345, 67_890, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(99_999);
    expect(spreadByWeight(10, [0, 0])).toEqual([5, 5]);
  });

  it('lands each line’s share per unit', () => {
    // ৳300 of transport over ৳2,000 + ৳1,000 of goods: ৳200 and ৳100.
    const lines = [
      { quantity: 10, unitCost: 200_00 },
      { quantity: 4, unitCost: 250_00 },
    ];
    expect(landedUnitCosts(lines, 300_00)).toEqual([220_00, 275_00]);
    expect(landedUnitCosts(lines, 0)).toEqual([200_00, 250_00]);
    expect(landedUnitCosts([{ quantity: 4, unitCost: 0 }], 100)).toEqual([25]);
  });

  it('totals a PO', () => {
    expect(
      purchaseTotals(
        [
          { quantity: 2, unitCost: 150 },
          { quantity: 1, unitCost: 100 },
        ],
        [{ amount: 50 }],
      ),
    ).toEqual({ subtotal: 400, otherCostTotal: 50, total: 450 });
  });

  it('gives each receipt of a PO its share, the last one the rest', () => {
    const base = { otherCostTotal: 1000, poValue: 3000 };
    const first = purchaseOrderCostShare({
      ...base,
      receivedBefore: 0,
      receivedNow: 1000,
      allocatedBefore: 0,
      completes: false,
    });
    expect(first).toBe(333);
    const second = purchaseOrderCostShare({
      ...base,
      receivedBefore: 1000,
      receivedNow: 1000,
      allocatedBefore: first,
      completes: false,
    });
    expect(second).toBe(333);
    const last = purchaseOrderCostShare({
      ...base,
      receivedBefore: 2000,
      receivedNow: 1000,
      allocatedBefore: first + second,
      completes: true,
    });
    expect(first + second + last).toBe(1000);
    // Received beyond the order: never more than the costs.
    expect(
      purchaseOrderCostShare({
        ...base,
        receivedBefore: 0,
        receivedNow: 5000,
        allocatedBefore: 0,
        completes: false,
      }),
    ).toBe(1000);
  });
});

describe('supplier ageing (§3.7)', () => {
  it('applies payments to the oldest debts first', () => {
    const result = supplierAgeing({
      openedOn: '2026-06-01',
      openingBalance: 5000,
      receipts: [
        { on: '2026-08-20', amount: 3000 },
        { on: '2026-10-20', amount: 2000 },
      ],
      paid: 6000,
      today: '2026-10-26',
    });
    // The opening 5,000 is paid, then 1,000 of August's: 2,000 left there.
    expect(result.balance).toBe(4000);
    expect(result.buckets).toEqual({ '0_30': 2000, '31_60': 0, '61_90': 2000, over_90: 0 });
  });

  it('owes nothing on an advance', () => {
    const result = supplierAgeing({
      openedOn: '2026-01-01',
      openingBalance: -1000,
      receipts: [{ on: '2026-10-01', amount: 500 }],
      paid: 0,
      today: '2026-10-26',
    });
    expect(result.balance).toBe(-500);
    expect(Object.values(result.buckets).every((b) => b === 0)).toBe(true);
  });
});

describe('recurring dates (§3.6)', () => {
  const monthly = (day: number, startsOn = '2026-01-15', endsOn: string | null = null) => ({
    cadence: 'monthly' as const,
    day,
    startsOn,
    endsOn,
  });

  it('posts on the day, or the month’s last day', () => {
    expect(occurrences(monthly(28), '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-28',
      '2026-02-28',
      '2026-03-28',
      '2026-04-28',
    ]);
    expect(occurrences(monthly(0), '2026-01-01', '2026-03-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
    expect(occurrences(monthly(0, '2028-02-01'), '2028-02-01', '2028-02-29')).toEqual([
      '2028-02-29',
    ]);
  });

  it('starts mid-month on the next due day, and stops at the end date', () => {
    expect(nextOccurrence(monthly(10), '2026-01-01')).toBe('2026-02-10');
    expect(nextOccurrence(monthly(20), '2026-01-01')).toBe('2026-01-20');
    expect(
      occurrences(monthly(20, '2026-01-15', '2026-03-19'), '2026-01-01', '2026-12-31'),
    ).toEqual(['2026-01-20', '2026-02-20']);
    expect(nextOccurrence(monthly(20, '2026-01-15', '2026-03-19'), '2026-03-01')).toBeNull();
  });

  it('posts weekly on its weekday', () => {
    // 2026-10-26 is a Monday; 5 is Friday.
    const weekly = { cadence: 'weekly' as const, day: 5, startsOn: '2026-10-26', endsOn: null };
    expect(occurrences(weekly, '2026-10-26', '2026-11-13')).toEqual([
      '2026-10-30',
      '2026-11-06',
      '2026-11-13',
    ]);
    expect(nextOccurrence({ ...weekly, day: 1 }, '2026-10-26')).toBe('2026-10-26');
    expect(nextOccurrence({ ...weekly, day: 7 }, '2026-10-26')).toBe('2026-11-01');
  });
});
