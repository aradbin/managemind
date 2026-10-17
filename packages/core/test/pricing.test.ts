// The promotion engine (phase-4-plan §3.13, §10): pure, so every condition,
// action and stacking rule is checked without a database.
import { describe, expect, it } from 'vitest';
import { type PricingLine, type PromotionRule, priceCart } from '../src/pricing/engine';

const CAT = '01951e1e-0000-7000-8000-00000000ca01';
const line = (
  key: string,
  unitPrice: number,
  quantity = 1,
  extra: Partial<PricingLine> = {},
): PricingLine => ({
  key,
  variantId: key,
  productId: `p-${key}`,
  categoryIds: [],
  collectionIds: [],
  unitPrice,
  quantity,
  vatRateBp: 0,
  ...extra,
});
let seq = 0;
const promo = (p: Partial<PromotionRule> & Pick<PromotionRule, 'action'>): PromotionRule => ({
  id: `promo-${++seq}`,
  title: { en: `Promo ${seq}` },
  kind: 'automatic',
  priority: 0,
  exclusive: false,
  maxDiscount: null,
  conditions: {},
  ...p,
});
const base = {
  customer: { phone: '+8801712345678', tags: [], isFirstOrder: false },
  zoneId: 'zone-dhaka',
  paymentMethod: 'cod' as const,
  deliveryFee: 7_000,
};

describe('conditions', () => {
  it('checks the minimum subtotal and quantity, optionally on matching items only', () => {
    const p = promo({
      conditions: { minSubtotal: 200_000 },
      action: { type: 'percent_off_order', percentBp: 1000 },
    });
    const under = priceCart({ ...base, lines: [line('a', 150_000)], promotions: [p] });
    expect(under.notApplied).toEqual([{ promotionId: p.id, reason: 'min_subtotal' }]);
    const over = priceCart({
      ...base,
      lines: [line('a', 150_000), line('b', 60_000)],
      promotions: [p],
    });
    expect(over.applied.map((a) => a.amount)).toEqual([21_000]);

    const q = promo({
      conditions: { minQuantity: 2, items: { categoryIds: [CAT] } },
      action: { type: 'amount_off_order', amount: 10_000 },
    });
    const one = priceCart({
      ...base,
      lines: [line('a', 50_000, 1, { categoryIds: [CAT] }), line('b', 50_000, 3)],
      promotions: [q],
    });
    expect(one.notApplied[0]?.reason).toBe('min_quantity');
  });

  it('checks zone, first order, customer phone or tag, and payment method', () => {
    const lines = [line('a', 100_000)];
    const cases: [PromotionRule['conditions'], string][] = [
      [{ zoneIds: ['zone-ctg'] }, 'zone'],
      [{ firstOrder: true }, 'first_order'],
      [{ customerPhones: ['+8801811111111'] }, 'customer'],
      [{ customerTags: ['vip'] }, 'customer'],
      [{ paymentMethods: ['manual'] }, 'payment_method'],
    ];
    for (const [conditions, reason] of cases) {
      const p = promo({ conditions, action: { type: 'amount_off_order', amount: 1_000 } });
      expect(priceCart({ ...base, lines, promotions: [p] }).notApplied[0]?.reason).toBe(reason);
    }
    const vip = promo({
      conditions: { customerTags: ['vip'] },
      action: { type: 'amount_off_order', amount: 1_000 },
    });
    const r = priceCart({
      ...base,
      customer: { ...base.customer, tags: ['vip'] },
      lines,
      promotions: [vip],
    });
    expect(r.applied).toHaveLength(1);
  });
});

describe('actions', () => {
  it('takes a percentage or an amount off targeted items', () => {
    const lines = [line('a', 100_000, 2, { categoryIds: [CAT] }), line('b', 50_000)];
    const percent = promo({
      action: { type: 'percent_off_items', percentBp: 1500, target: { categoryIds: [CAT] } },
    });
    const r1 = priceCart({ ...base, lines, promotions: [percent] });
    expect(r1.applied[0]?.allocations).toEqual({ a: 30_000 });
    const each = promo({
      action: { type: 'amount_off_items', amount: 5_000, target: { productIds: ['p-a'] } },
    });
    expect(priceCart({ ...base, lines, promotions: [each] }).totals.discountTotal).toBe(10_000);
  });

  it('buy 2 get 1 free discounts the cheapest qualifying units', () => {
    const sel = { categoryIds: [CAT] };
    const p = promo({
      action: {
        type: 'buy_x_get_y',
        buy: { quantity: 2, items: sel },
        get: { quantity: 1, percentBp: 10_000 },
      },
    });
    const lines = [
      line('a', 100_000, 2, { categoryIds: [CAT] }),
      line('b', 40_000, 1, { categoryIds: [CAT] }),
      line('c', 30_000, 1),
    ];
    const r = priceCart({ ...base, lines, promotions: [p] });
    expect(r.applied[0]?.allocations).toEqual({ b: 40_000 });
    // Six units make two uses; maxUses 1 limits it.
    const six = [line('a', 10_000, 6, { categoryIds: [CAT] })];
    expect(priceCart({ ...base, lines: six, promotions: [p] }).totals.discountTotal).toBe(20_000);
    const once = { ...p, action: { ...p.action, maxUses: 1 } } as PromotionRule;
    expect(priceCart({ ...base, lines: six, promotions: [once] }).totals.discountTotal).toBe(
      10_000,
    );
    // Two units only: nothing to give.
    const two = [line('a', 10_000, 2, { categoryIds: [CAT] })];
    expect(priceCart({ ...base, lines: two, promotions: [p] }).notApplied[0]?.reason).toBe(
      'no_discount',
    );
  });

  it('gives free or discounted delivery', () => {
    const free = promo({
      conditions: { minSubtotal: 100_000 },
      action: { type: 'delivery_percent_off', percentBp: 10_000 },
    });
    const r = priceCart({ ...base, lines: [line('a', 120_000)], promotions: [free] });
    expect(r.totals).toMatchObject({ deliveryFee: 7_000, deliveryDiscount: 7_000, total: 120_000 });
  });

  it('caps a promotion at its maximum discount', () => {
    const p = promo({
      maxDiscount: 20_000,
      action: { type: 'percent_off_order', percentBp: 5000 },
    });
    expect(
      priceCart({ ...base, lines: [line('a', 100_000)], promotions: [p] }).totals.discountTotal,
    ).toBe(20_000);
  });
});

describe('stacking (Q10)', () => {
  it('applies combinable promotions together: item discounts first, then the order discount on the rest', () => {
    const item = promo({
      action: { type: 'percent_off_items', percentBp: 5000, target: { productIds: ['p-a'] } },
    });
    const order = promo({ action: { type: 'percent_off_order', percentBp: 1000 } });
    const r = priceCart({
      ...base,
      lines: [line('a', 100_000), line('b', 100_000)],
      promotions: [order, item],
    });
    expect(r.applied.map((a) => [a.promotionId, a.amount])).toEqual([
      [item.id, 50_000],
      [order.id, 15_000],
    ]);
  });

  it('gives the shopper the larger of the best exclusive promotion and all combinable ones', () => {
    const lines = [line('a', 100_000)];
    const small = promo({ action: { type: 'amount_off_order', amount: 10_000 } });
    const small2 = promo({ action: { type: 'amount_off_order', amount: 10_000 } });
    const big = promo({ exclusive: true, action: { type: 'amount_off_order', amount: 15_000 } });
    const r = priceCart({ ...base, lines, promotions: [small, small2, big] });
    expect(r.applied.map((a) => a.promotionId).sort()).toEqual([small.id, small2.id].sort());
    expect(r.notApplied).toEqual([{ promotionId: big.id, reason: 'better_offer' }]);
    const bigger = {
      ...big,
      action: { type: 'amount_off_order', amount: 30_000 },
    } as PromotionRule;
    const r2 = priceCart({ ...base, lines, promotions: [small, small2, bigger] });
    expect(r2.applied.map((a) => a.promotionId)).toEqual([bigger.id]);
  });

  it('reports a code that loses to a better offer', () => {
    const auto = promo({ exclusive: true, action: { type: 'amount_off_order', amount: 30_000 } });
    const code = promo({
      kind: 'code',
      code: 'EID',
      action: { type: 'amount_off_order', amount: 10_000 },
    });
    const r = priceCart({ ...base, lines: [line('a', 100_000)], promotions: [auto, code] });
    expect(r.notApplied).toEqual([{ promotionId: code.id, code: 'EID', reason: 'better_offer' }]);
  });
});

describe('the rest of the cart', () => {
  it('shows the nearest free-delivery threshold', () => {
    const at2k = promo({
      conditions: { minSubtotal: 200_000 },
      action: { type: 'delivery_percent_off', percentBp: 10_000 },
    });
    const at3k = promo({
      conditions: { minSubtotal: 300_000 },
      action: { type: 'delivery_percent_off', percentBp: 10_000 },
    });
    const r = priceCart({ ...base, lines: [line('a', 178_000)], promotions: [at3k, at2k] });
    expect(r.freeDelivery).toEqual({ threshold: 200_000, remaining: 22_000 });
    expect(
      priceCart({ ...base, lines: [line('a', 200_000)], promotions: [at2k] }).freeDelivery,
    ).toBeNull();
  });

  it('applies a manual discount exactly, after promotions', () => {
    const p = promo({ action: { type: 'percent_off_order', percentBp: 1000 } });
    const r = priceCart({
      ...base,
      lines: [line('a', 100_000)],
      promotions: [p],
      manualDiscount: { amount: 1_250, reason: 'regular' },
    });
    expect(r.manual).toMatchObject({ amount: 1_250, reason: 'regular' });
    expect(r.totals.discountTotal).toBe(11_250);
    const pc = priceCart({
      ...base,
      lines: [line('a', 100_000)],
      promotions: [],
      manualDiscount: { percentBp: 500, reason: 'x' },
    });
    expect(pc.manual?.amount).toBe(5_000);
  });
});
