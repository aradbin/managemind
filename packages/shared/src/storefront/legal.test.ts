import { describe, expect, it } from 'vitest';
import { richTextDoc } from '../catalog/rich-text-schema';
import { richTextToPlainText } from '../rich-text';
import { LEGAL_KINDS, type LegalContext, legalPageBody } from './legal';

const store: LegalContext = {
  storeName: 'Tea & Co',
  businessName: 'Tea and Company Ltd',
  address: 'House 1, Road 2, Dhanmondi, Dhaka',
  contactPhone: '01712-345678',
  contactEmail: 'hello@tea.example',
  tradeLicense: 'TRAD/DNCC/1234',
  returns: {
    shopperRequests: true,
    windowDays: 7,
    refundMethods: ['bkash', 'cash'],
    refundDeliveryFee: true,
  },
  zones: [
    {
      name: { bn: 'ঢাকার ভেতরে', en: 'Inside Dhaka' },
      fee: 7000,
      estimate: { bn: '১–২ দিন', en: '1–2 days' },
    },
  ],
  cod: true,
  online: false,
  abuseEmail: 'abuse@platform.example',
  platformName: 'managemind',
};

describe('legal page templates', () => {
  it('fill every page in both languages with valid rich text and no placeholder left', () => {
    for (const kind of LEGAL_KINDS) {
      for (const locale of ['bn', 'en'] as const) {
        const doc = legalPageBody(kind, locale, store);
        expect(richTextDoc.safeParse(doc).success, `${kind} ${locale}`).toBe(true);
        expect(richTextToPlainText(doc)).not.toMatch(/\{[a-z_]+\}|undefined/);
      }
    }
  });

  it("use the store's settings, so a change shows at once", () => {
    const text = (kind: (typeof LEGAL_KINDS)[number], c = store) =>
      richTextToPlainText(legalPageBody(kind, 'en', c));
    expect(text('returns')).toContain('within 7 days of delivery');
    expect(text('returns')).toContain('by bKash or in cash');
    expect(text('returns', { ...store, returns: { ...store.returns, windowDays: 14 } })).toContain(
      'within 14 days',
    );
    expect(text('delivery')).toContain('Inside Dhaka: ৳70.00, 1–2 days');
    expect(text('delivery')).toContain('in cash on delivery');
    expect(text('terms')).toContain('Trade license: TRAD/DNCC/1234');
    expect(text('privacy')).toContain('abuse@platform.example');
    // Without contact details, it points to the contact page instead.
    expect(text('terms', { ...store, contactPhone: undefined, contactEmail: undefined })).toContain(
      'contact page',
    );
  });
});
