import { describe, expect, it } from 'vitest';
import { credentialCheck } from '../src/credential-checks';

const respond =
  (status: number, body: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status });

const email = (provider: 'resend' | 'brevo', from = 'orders@shop.test') => ({
  kind: 'email' as const,
  provider,
  mode: null,
  secrets: { apiKey: 'k' },
  config: { from },
});

describe('credential checks', () => {
  it('accept a Resend key whose sending domain is verified', async () => {
    const ok = respond(200, { data: [{ name: 'shop.test', status: 'verified' }] });
    await expect(credentialCheck(ok)(email('resend'))).resolves.toBeUndefined();
  });

  it('refuse a bad Resend key, or a domain it has not verified', async () => {
    await expect(credentialCheck(respond(401, {}))(email('resend'))).rejects.toThrow(/refused/);
    const pending = respond(200, { data: [{ name: 'shop.test', status: 'pending' }] });
    await expect(credentialCheck(pending)(email('resend'))).rejects.toThrow(/not verified/);
    const other = respond(200, { data: [{ name: 'other.test', status: 'verified' }] });
    await expect(credentialCheck(other)(email('resend'))).rejects.toThrow(/not a domain/);
  });

  it('accept a Brevo sender on the same domain, and refuse an inactive one', async () => {
    const ok = respond(200, { senders: [{ email: 'hello@shop.test', active: true }] });
    await expect(credentialCheck(ok)(email('brevo'))).resolves.toBeUndefined();
    const off = respond(200, { senders: [{ email: 'orders@shop.test', active: false }] });
    await expect(credentialCheck(off)(email('brevo'))).rejects.toThrow(/not an active sender/);
  });

  it('accept SSLCommerz credentials that start a session, and refuse others', async () => {
    const ssl = {
      kind: 'sslcommerz' as const,
      provider: 'sslcommerz' as const,
      mode: 'sandbox' as const,
      secrets: { storeId: 'test1', storePassword: 'pw' },
      config: {},
    };
    const ok = respond(200, { status: 'SUCCESS', GatewayPageURL: 'https://gw', sessionkey: 'k' });
    await expect(credentialCheck(ok)(ssl)).resolves.toBeUndefined();
    const bad = respond(200, { status: 'FAILED', failedreason: 'Store Credential Error' });
    await expect(credentialCheck(bad)(ssl)).rejects.toThrow(/Store Credential Error/);
  });

  it('accept an SMS key that reads its balance, and refuse one that doesn’t', async () => {
    const sms = (provider: 'sms_net_bd' | 'bulksmsbd') => ({
      kind: 'sms' as const,
      provider,
      mode: null,
      secrets: { apiKey: 'k' },
      config: { senderId: 'SHOP' },
    });
    const ok = respond(200, { error: 0, msg: 'Success', data: { balance: '10.00' } });
    await expect(credentialCheck(ok)(sms('sms_net_bd'))).resolves.toBeUndefined();
    const bad = respond(200, { error: 405, msg: 'Authorization required' });
    await expect(credentialCheck(bad)(sms('sms_net_bd'))).rejects.toThrow(/Authorization required/);
    const wall = respond(200, { response_code: 1032 });
    await expect(credentialCheck(wall)(sms('bulksmsbd'))).rejects.toThrow(/1032/);
  });
});
