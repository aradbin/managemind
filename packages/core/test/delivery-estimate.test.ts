import { describe, expect, it } from 'vitest';
import { dhakaDate, estimateDays, expectedDelivery } from '../src/orders/delivery-estimate';

describe('estimateDays', () => {
  it('reads the days from the zone text the store wrote, in either language', () => {
    expect(estimateDays({ en: '1–2 days', bn: '১–২ দিন' })).toEqual({ min: 1, max: 2 });
    expect(estimateDays({ bn: '৩-৫ দিন' })).toEqual({ min: 3, max: 5 });
    expect(estimateDays({ en: '3 to 5 days' })).toEqual({ min: 3, max: 5 });
    expect(estimateDays({ en: 'Within 2 days' })).toEqual({ min: 2, max: 2 });
    expect(estimateDays({ en: '24 hours' })).toEqual({ min: 1, max: 1 });
    expect(estimateDays({ en: '1-2 weeks' })).toEqual({ min: 7, max: 14 });
  });

  it('gives nothing when the text has no days', () => {
    expect(estimateDays({ en: 'Same day' })).toBeNull();
    expect(estimateDays({})).toBeNull();
    expect(estimateDays(null)).toBeNull();
  });
});

describe('expectedDelivery', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  const order = {
    status: 'confirmed',
    deliveryStatus: 'not_shipped',
    confirmedAt: '2026-11-20T05:00:00Z',
    bookedAt: null,
    estimate: { en: '1–2 days' },
  };

  it('counts from the confirmation, then from the booking, in Bangladesh dates', () => {
    expect(expectedDelivery(order, now)).toEqual({ from: '2026-11-21', to: '2026-11-22' });
    // Booked at 23:30 Dhaka time on the 21st: still the 21st there.
    expect(
      expectedDelivery(
        { ...order, deliveryStatus: 'shipped', bookedAt: '2026-11-21T17:30:00Z' },
        now,
      ),
    ).toEqual({ from: '2026-11-22', to: '2026-11-23' });
    expect(dhakaDate(new Date('2026-11-21T18:30:00Z'))).toBe('2026-11-22');
  });

  it('gives no date before the store confirms, after delivery, or once it has passed', () => {
    expect(expectedDelivery({ ...order, status: 'pending', confirmedAt: null }, now)).toBeNull();
    expect(expectedDelivery({ ...order, deliveryStatus: 'delivered' }, now)).toBeNull();
    expect(expectedDelivery({ ...order, status: 'cancelled' }, now)).toBeNull();
    expect(expectedDelivery({ ...order, estimate: { en: 'Same day' } }, now)).toBeNull();
    expect(expectedDelivery(order, new Date('2026-11-23T10:00:00Z'))).toBeNull();
  });
});
