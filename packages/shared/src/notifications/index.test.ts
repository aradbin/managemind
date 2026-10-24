import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  defaultTemplate,
  MESSAGE_EVENTS,
  notificationSettings,
  renderTemplate,
  SHOPPER_EVENTS,
  STAFF_EVENTS,
  smsParts,
  templateVariables,
  unknownVariables,
} from './index';

describe('templates', () => {
  it('lists variables once, in order', () => {
    expect(templateVariables('{order_number} for {customer_name}, {order_number}')).toEqual([
      'order_number',
      'customer_name',
    ]);
  });

  it("refuses variables the event doesn't have", () => {
    expect(unknownVariables('order_placed', 'Order {order_number}: {amount_due}')).toEqual([]);
    expect(unknownVariables('order_placed', 'Shipped by {carrier}')).toEqual(['carrier']);
    expect(unknownVariables('order_shipped', 'Shipped by {carrier}')).toEqual([]);
  });

  it('escapes values for HTML and leaves SMS plain, with missing values empty', () => {
    const values = { customer_name: '<b>Rina & co</b>' };
    expect(renderTemplate('Hi {customer_name}', values, 'html')).toBe(
      'Hi &lt;b&gt;Rina &amp; co&lt;/b&gt;',
    );
    expect(renderTemplate('Hi {customer_name}', values, 'plain')).toBe('Hi <b>Rina & co</b>');
    expect(renderTemplate('Track: {tracking_number}.', {}, 'plain')).toBe('Track: .');
  });
});

describe('SMS parts', () => {
  it('counts GSM messages in 160 and 153', () => {
    expect(smsParts('a'.repeat(160))).toEqual({ encoding: 'gsm', length: 160, parts: 1 });
    expect(smsParts('a'.repeat(161)).parts).toBe(2);
    expect(smsParts('a'.repeat(306)).parts).toBe(2);
    expect(smsParts('a'.repeat(307)).parts).toBe(3);
    // An extended character counts twice.
    expect(smsParts('€'.repeat(80))).toMatchObject({ encoding: 'gsm', length: 160, parts: 1 });
  });

  it('counts Bangla as Unicode in 70 and 67', () => {
    expect(smsParts('ক'.repeat(70))).toEqual({ encoding: 'unicode', length: 70, parts: 1 });
    expect(smsParts('ক'.repeat(71)).parts).toBe(2);
    expect(smsParts(`Order #1001 ${'ক'}`).encoding).toBe('unicode');
  });
});

describe('notification settings', () => {
  it('sends order placed and shipped by SMS, and everything by email, by default', () => {
    const s = notificationSettings.parse({});
    expect(s.sms).toEqual(['order_placed', 'order_shipped']);
    expect(s.email).toContain('refund_issued');
  });
});

describe('default templates', () => {
  it('use only their events’ variables, in both languages', () => {
    for (const event of MESSAGE_EVENTS) {
      for (const channel of CHANNELS) {
        for (const locale of ['bn', 'en'] as const) {
          const t = defaultTemplate(event, channel, locale);
          if (!t) continue;
          expect(
            unknownVariables(event, `${t.subject ?? ''} ${t.body}`),
            `${event} ${channel}`,
          ).toEqual([]);
        }
      }
    }
  });

  it('give every shopper event an email and an SMS, and every staff event a push', () => {
    for (const event of SHOPPER_EVENTS) {
      expect(defaultTemplate(event, 'email', 'bn')?.subject).toBeTruthy();
      expect(defaultTemplate(event, 'sms', 'en')).not.toBeNull();
    }
    for (const event of STAFF_EVENTS) expect(defaultTemplate(event, 'push', 'bn')).not.toBeNull();
  });

  it('send the confirmation link by SMS only, in one part in English', () => {
    expect(defaultTemplate('confirm_request', 'email', 'en')).toBeNull();
    const t = defaultTemplate('confirm_request', 'sms', 'en');
    const body = renderTemplate(
      t?.body ?? '',
      {
        store_name: 'Rina Fashion House',
        order_number: '#10234',
        amount_due: 'Tk 2,450',
        confirm_url: 'https://rina-fashion.managemind.store/c/a1B2c3D4e5',
      },
      'plain',
    );
    expect(smsParts(body)).toMatchObject({ encoding: 'gsm', parts: 1 });
  });
});
