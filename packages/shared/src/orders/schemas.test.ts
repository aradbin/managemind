import { describe, expect, it } from 'vitest';
import { defaultTenantSettings, tenantSettings } from '../tenant-settings';
import { promotionAction, promotionCode, promotionConditions, promotionInput } from './promotions';
import { checkoutInput, deliveryZoneInput, placeInput } from './schemas';

const dhanmondi = { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1, Road 2' };

describe('places', () => {
  it('accept an area from the list in its district and division', () => {
    expect(placeInput.safeParse(dhanmondi).success).toBe(true);
    expect(placeInput.safeParse({ ...dhanmondi, districtId: 41 }).success).toBe(false);
    expect(placeInput.safeParse({ ...dhanmondi, line: ' ' }).success).toBe(false);
  });
});

describe('checkout input', () => {
  const valid = {
    contact: { name: 'রহিম', phone: '০১৭১২-৩৪৫৬৭৮', email: '' },
    address: dhanmondi,
    paymentMethod: 'cod',
    expectedTotal: 107_000,
  };
  it('normalizes the phone and drops an empty email', () => {
    const parsed = checkoutInput.parse(valid);
    expect(parsed.contact.phone).toBe('+8801712345678');
    expect(parsed.contact.email).toBeUndefined();
  });
  it('refuses a price from the client, other payment methods and unknown fields', () => {
    expect(checkoutInput.safeParse({ ...valid, paymentMethod: 'bkash' }).success).toBe(false);
    expect(checkoutInput.safeParse({ ...valid, total: 1 }).success).toBe(false);
    expect(
      checkoutInput.safeParse({ ...valid, contact: { ...valid.contact, phone: '12345' } }).success,
    ).toBe(false);
  });
});

describe('delivery zones', () => {
  it('need both parts of the weight rule, and a fallback lists nothing', () => {
    const base = { name: { en: 'Inside Dhaka' }, fee: 7_000 };
    expect(deliveryZoneInput.safeParse({ ...base, freeWeightGrams: 1000 }).success).toBe(false);
    expect(
      deliveryZoneInput.safeParse({ ...base, freeWeightGrams: 1000, feePerExtraKg: 2000 }).success,
    ).toBe(true);
    expect(
      deliveryZoneInput.safeParse({ ...base, isFallback: true, districtIds: [47] }).success,
    ).toBe(false);
  });
});

describe('promotions', () => {
  it('validate each action and refuse unknown ones', () => {
    expect(promotionAction.safeParse({ type: 'percent_off_order', percentBp: 1500 }).success).toBe(
      true,
    );
    expect(promotionAction.safeParse({ type: 'percent_off_order', percentBp: 0 }).success).toBe(
      false,
    );
    expect(promotionAction.safeParse({ type: 'percent_off_items', percentBp: 1000 }).success).toBe(
      false,
    );
    expect(
      promotionAction.safeParse({
        type: 'buy_x_get_y',
        buy: { quantity: 2, items: { categoryIds: ['01951e1e-0000-7000-8000-000000000001'] } },
        get: { quantity: 1, percentBp: 10_000 },
      }).success,
    ).toBe(true);
    expect(promotionAction.safeParse({ type: 'bogus' }).success).toBe(false);
  });

  it('normalize conditions', () => {
    const c = promotionConditions.parse({
      customerPhones: ['01712345678'],
      customerTags: ['VIP', 'vip', ' Wholesale '],
    });
    expect(c.customerPhones).toEqual(['+8801712345678']);
    expect(c.customerTags).toEqual(['vip', 'wholesale']);
    expect(promotionConditions.safeParse({ items: {} }).success).toBe(false);
  });

  it('match codes without regard to case and check the date range', () => {
    expect(promotionCode.parse(' eid500 ')).toBe('EID500');
    expect(promotionCode.safeParse('a').success).toBe(false);
    const base = {
      title: { en: 'Eid' },
      kind: 'code',
      action: { type: 'amount_off_order', amount: 50_000 },
    };
    expect(promotionInput.parse({ ...base, code: 'eid' }).code).toBe('EID');
    expect(
      promotionInput.safeParse({
        ...base,
        startsAt: '2026-10-30T00:00:00Z',
        endsAt: '2026-10-01T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(promotionInput.safeParse({ ...base, kind: 'automatic', code: 'EID' }).success).toBe(
      false,
    );
  });
});

describe('store settings', () => {
  it('default checkout and COD settings for every store', () => {
    const s = defaultTenantSettings();
    expect(s.checkout).toEqual({
      email: 'optional',
      maxQuantityPerLine: 10,
      orderNumberPrefix: '#',
      rateLimits: { perPhoneHour: 3, perPhoneDay: 10, perIpHour: 10 },
      accounts: false,
      termsCheckbox: false,
    });
    expect(s.cod).toEqual({ enabled: true, maxOrderValue: null, advance: 'never' });
    // Settings saved before Phase 4 still parse.
    expect(tenantSettings.parse({ version: 1 }).checkout.maxQuantityPerLine).toBe(10);
    expect(tenantSettings.safeParse({ checkout: { orderNumberPrefix: 'a b' } }).success).toBe(
      false,
    );
  });
});
