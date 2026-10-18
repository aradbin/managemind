import { describe, expect, it, vi } from 'vitest';
import { brevoProvider, parseAddress } from './brevo';
import { EmailError, type EmailMessage } from './types';

const message: EmailMessage = {
  to: 'shopper@example.test',
  from: 'Demo Fashion <no-reply@managemind.store>',
  replyTo: 'Demo Fashion <hello@demo.test>',
  subject: 'Your code',
  html: '<p>123456</p>',
  text: '123456',
  tags: { kind: 'shopper_sign_in_code' },
};

const reply = (status: number, body: unknown) =>
  vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json(body, { status }));

describe('brevoProvider', () => {
  it('posts the message in Brevo’s shape', async () => {
    const fetch = reply(201, { messageId: '<abc@smtp-relay.mailin.fr>' });
    const provider = brevoProvider({ apiKey: 'xkeysib-test', fetch });
    await expect(provider.send(message)).resolves.toEqual({ id: '<abc@smtp-relay.mailin.fr>' });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init?.headers).toMatchObject({ 'api-key': 'xkeysib-test' });
    expect(JSON.parse(String(init?.body))).toEqual({
      sender: { name: 'Demo Fashion', email: 'no-reply@managemind.store' },
      to: [{ email: 'shopper@example.test' }],
      subject: 'Your code',
      htmlContent: '<p>123456</p>',
      textContent: '123456',
      replyTo: { name: 'Demo Fashion', email: 'hello@demo.test' },
      tags: ['kind:shopper_sign_in_code'],
    });
  });

  it('marks rate limits and server errors retryable, and nothing else', async () => {
    const limited = brevoProvider({
      apiKey: 'k',
      fetch: reply(429, { code: 'too_many_requests' }),
    });
    await expect(limited.send(message)).rejects.toMatchObject({
      code: 'too_many_requests',
      retryable: true,
    });
    const refused = brevoProvider({
      apiKey: 'k',
      fetch: reply(400, { code: 'invalid_parameter' }),
    });
    const error = await refused.send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailError);
    expect(error).toMatchObject({ code: 'invalid_parameter', retryable: false, status: 400 });
  });

  it('reads addresses with and without a name', () => {
    expect(parseAddress('no-reply@x.test')).toEqual({ email: 'no-reply@x.test' });
    expect(parseAddress('"Shop, Ltd" <a@x.test>')).toEqual({
      name: 'Shop, Ltd',
      email: 'a@x.test',
    });
  });
});
