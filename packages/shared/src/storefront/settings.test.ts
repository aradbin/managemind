import { describe, expect, it } from 'vitest';
import { tenantSettings } from '../tenant-settings';
import {
  defaultStorefrontSettings,
  dhakaToUtc,
  holidayActive,
  holidaySettings,
  messengerLink,
  storefrontSettings,
  utcToDhaka,
  whatsappLink,
} from './settings';

describe('storefrontSettings', () => {
  it('defaults to noindex, no tracking and chat on every page', () => {
    expect(defaultStorefrontSettings()).toEqual({
      indexing: false,
      tracking: {},
      consent: { text: {} },
      chat: { greeting: {}, show: 'all' },
      holiday: null,
    });
  });

  it('validates tracking IDs by format', () => {
    const ok = storefrontSettings.parse({
      tracking: { metaPixelId: '123456789012345', ga4Id: 'g-ab12cd34ef' },
    });
    expect(ok.tracking).toEqual({ metaPixelId: '123456789012345', ga4Id: 'G-AB12CD34EF' });
    expect(storefrontSettings.safeParse({ tracking: { metaPixelId: '12345' } }).success).toBe(
      false,
    );
    expect(storefrontSettings.safeParse({ tracking: { ga4Id: 'UA-1234-1' } }).success).toBe(false);
  });

  it('normalizes the WhatsApp number and checks the Messenger username', () => {
    const parsed = storefrontSettings.parse({
      chat: { whatsapp: '০১৭১২-৩৪৫৬৭৮', messenger: 'my.shop' },
    });
    expect(parsed.chat.whatsapp).toBe('+8801712345678');
    expect(storefrontSettings.safeParse({ chat: { whatsapp: '12345' } }).success).toBe(false);
    expect(storefrontSettings.safeParse({ chat: { messenger: 'a b' } }).success).toBe(false);
  });

  it('limits the consent text to 300 characters', () => {
    expect(
      storefrontSettings.safeParse({ consent: { text: { en: 'x'.repeat(301) } } }).success,
    ).toBe(false);
  });

  it('is part of the store settings, with defaults for older stores', () => {
    const settings = tenantSettings.parse({});
    expect(settings.storefront.indexing).toBe(false);
    expect(settings.theme).toBeUndefined();
  });

  it('accepts the business details in the profile', () => {
    const settings = tenantSettings.parse({
      profile: {
        businessName: 'Rupa Fashion Ltd.',
        tradeLicense: 'TRAD/DNCC/012345/2024',
        dbid: 'DBID-1234',
        bin: '000123456-0101',
      },
    });
    expect(settings.profile.bin).toBe('000123456-0101');
    expect(tenantSettings.safeParse({ profile: { bin: 'abc' } }).success).toBe(false);
  });
});

describe('holiday mode', () => {
  const holiday = holidaySettings.parse({
    startsAt: dhakaToUtc('2026-03-30T00:00'),
    endsAt: dhakaToUtc('2026-04-03T00:00'),
    message: { bn: 'ঈদের ছুটি', en: 'Closed for Eid' },
  });

  it('converts Asia/Dhaka times to UTC and back', () => {
    expect(dhakaToUtc('2026-03-30T00:00')).toBe('2026-03-29T18:00:00.000Z');
    expect(utcToDhaka('2026-03-29T18:00:00.000Z')).toBe('2026-03-30T00:00');
  });

  it('is active from midnight in Dhaka until the end', () => {
    expect(holidayActive(holiday, new Date('2026-03-29T17:59:59Z'))).toBe(false);
    expect(holidayActive(holiday, new Date('2026-03-29T18:00:00Z'))).toBe(true);
    expect(holidayActive(holiday, new Date('2026-04-02T17:59:59Z'))).toBe(true);
    expect(holidayActive(holiday, new Date('2026-04-02T18:00:00Z'))).toBe(false);
    expect(holidayActive(null)).toBe(false);
  });

  it('refuses a window that ends first or lasts more than 60 days', () => {
    const at = (d: string) => dhakaToUtc(d);
    expect(
      holidaySettings.safeParse({
        startsAt: at('2026-04-03T00:00'),
        endsAt: at('2026-03-30T00:00'),
        message: {},
      }).success,
    ).toBe(false);
    expect(
      holidaySettings.safeParse({
        startsAt: at('2026-01-01T00:00'),
        endsAt: at('2026-04-01T00:00'),
        message: {},
      }).success,
    ).toBe(false);
  });
});

describe('chat links', () => {
  it('builds wa.me links with the greeting', () => {
    expect(whatsappLink('+8801712345678')).toBe('https://wa.me/8801712345678');
    expect(whatsappLink('+8801712345678', 'লাল শাড়ি https://x.com/p')).toBe(
      'https://wa.me/8801712345678?text=%E0%A6%B2%E0%A6%BE%E0%A6%B2%20%E0%A6%B6%E0%A6%BE%E0%A6%A1%E0%A6%BC%E0%A6%BF%20https%3A%2F%2Fx.com%2Fp',
    );
  });

  it('builds m.me links', () => {
    expect(messengerLink('my.shop')).toBe('https://m.me/my.shop');
  });
});
