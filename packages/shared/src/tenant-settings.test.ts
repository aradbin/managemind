import { describe, expect, it } from 'vitest';
import { defaultTenantSettings, tenantSettings } from './tenant-settings';

describe('tenantSettings', () => {
  it('fills defaults for a new store', () => {
    expect(defaultTenantSettings()).toEqual({
      version: 1,
      profile: {},
      display: {},
      tax: { vatEnabled: false, rateBasisPoints: 1500, pricesIncludeVat: true, categories: [] },
      storefront: {
        indexing: false,
        tracking: {},
        consent: { text: {} },
        chat: { greeting: {}, show: 'all' },
        holiday: null,
      },
      checkout: {
        email: 'optional',
        maxQuantityPerLine: 10,
        orderNumberPrefix: '#',
        rateLimits: { perPhoneHour: 3, perPhoneDay: 10, perIpHour: 10 },
        accounts: false,
        termsCheckbox: false,
      },
      cod: { enabled: true, maxOrderValue: null, advance: 'never', otp: 'off' },
      fraud: { flagAfterFailed: 1, minScore: null, minDecided: 2, duplicateMinutes: 30 },
      confirmation: {
        queue: true,
        includePaid: false,
        maxAttempts: 3,
        retryAfterMinutes: 60,
        cancelUnreachable: false,
        smsLink: false,
        callRisky: true,
        autoConfirm: 'never',
        script: {},
      },
      recovery: { incomplete: true, showAfterMinutes: 30, keepDays: 30 },
      backOffice: { countApprovalThreshold: 500000, reorderMultiple: 2 },
      meta: { feed: { enabled: false }, purchaseAt: 'placed', deliveredEvent: false },
      couriers: {
        default: null,
        defaultWeightGrams: 500,
        note: '',
        autoBook: 'never',
        autoReceive: false,
      },
      returns: {
        shopperRequests: true,
        windowDays: 7,
        excludedCategoryIds: [],
        shopperPaysFor: ['wrong_size', 'changed_mind', 'other', 'refused_at_door'],
        refundMethods: ['gateway', 'bkash', 'nagad', 'rocket', 'bank', 'cash', 'store_credit'],
        refundDeliveryFee: true,
      },
      notifications: {
        sms: ['order_placed', 'order_shipped'],
        email: [
          'order_placed',
          'order_confirmed',
          'order_shipped',
          'order_delivered',
          'order_cancelled',
          'payment_received',
          'payment_expired',
          'return_approved',
          'return_rejected',
          'return_received',
          'refund_issued',
          'store_credit_issued',
        ],
        whatsapp: [
          'order_placed',
          'order_confirmed',
          'order_shipped',
          'order_delivered',
          'order_cancelled',
          'payment_received',
          'refund_issued',
        ],
        whatsappFirst: true,
      },
      setup: { subdomainFinal: false },
    });
    expect(tenantSettings.parse({})).toEqual(defaultTenantSettings());
  });

  it('normalizes the contact phone to E.164', () => {
    const settings = tenantSettings.parse({
      profile: { contactPhone: '01712-345678', contactEmail: 'shop@example.test' },
    });
    expect(settings.profile).toEqual({
      contactPhone: '+8801712345678',
      contactEmail: 'shop@example.test',
    });
  });

  it('refuses bad values and unknown keys', () => {
    expect(tenantSettings.safeParse({ profile: { contactPhone: '12345' } }).success).toBe(false);
    expect(tenantSettings.safeParse({ profile: { contactEmail: 'not-an-email' } }).success).toBe(
      false,
    );
    expect(tenantSettings.safeParse({ profile: { fax: '123' } }).success).toBe(false);
    expect(tenantSettings.safeParse({ theme: 'dark' }).success).toBe(false);
    expect(tenantSettings.safeParse({ version: 2 }).success).toBe(false);
  });

  it('trims address lines and refuses empty ones', () => {
    const settings = tenantSettings.parse({ profile: { address: { line1: '  House 12  ' } } });
    expect(settings.profile.address).toEqual({ line1: 'House 12' });
    expect(tenantSettings.safeParse({ profile: { address: { line1: '  ' } } }).success).toBe(false);
  });
});

describe('tax settings', () => {
  it('defaults to 15% including VAT once turned on (Q4)', () => {
    const settings = tenantSettings.parse({ tax: { vatEnabled: true } });
    expect(settings.tax).toEqual({
      vatEnabled: true,
      rateBasisPoints: 1500,
      pricesIncludeVat: true,
      categories: [],
    });
  });

  it('accepts VAT categories and refuses duplicates and bad rates', () => {
    const tax = {
      vatEnabled: true,
      categories: [
        { key: 'reduced', name: 'Reduced 5%', rateBasisPoints: 500 },
        { key: 'exempt', name: 'Exempt', rateBasisPoints: 0, exempt: true },
      ],
    };
    expect(tenantSettings.parse({ tax }).tax.categories[0]?.exempt).toBe(false);
    const dup = { ...tax, categories: [tax.categories[0], tax.categories[0]] };
    expect(tenantSettings.safeParse({ tax: dup }).success).toBe(false);
    expect(tenantSettings.safeParse({ tax: { rateBasisPoints: 10_001 } }).success).toBe(false);
    expect(tenantSettings.safeParse({ tax: { rateBasisPoints: 15.5 } }).success).toBe(false);
    expect(tenantSettings.safeParse({ tax: { vat: true } }).success).toBe(false);
  });

  it('reads settings stored before the tax section existed', () => {
    expect(tenantSettings.parse({ version: 1, profile: {}, display: {} }).tax.vatEnabled).toBe(
      false,
    );
  });
});
