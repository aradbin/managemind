import { describe, expect, it, vi } from 'vitest';
import { resendProvider } from './resend';
import { EmailError, type EmailMessage } from './types';

const message: EmailMessage = {
  to: 'owner@example.test',
  from: 'managemind <no-reply@notify.example.test>',
  replyTo: 'help@example.test',
  subject: 'Hello',
  html: '<p>Hi</p>',
  text: 'Hi',
  tags: { kind: 'sign_in_code' },
  idempotencyKey: 'key-1',
};

const reply = (status: number, body: unknown) =>
  vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json(body, { status }));

describe('resendProvider', () => {
  it('posts the message in Resend’s shape', async () => {
    const fetch = reply(200, { id: 'email_1' });
    const provider = resendProvider({ apiKey: 're_test', fetch });
    await expect(provider.send(message)).resolves.toEqual({ id: 'email_1' });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      authorization: 'Bearer re_test',
      'content-type': 'application/json',
      'idempotency-key': 'key-1',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      from: message.from,
      to: ['owner@example.test'],
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
      reply_to: 'help@example.test',
      tags: [{ name: 'kind', value: 'sign_in_code' }],
    });
  });

  it.each([
    [500, 'application_error', true],
    [503, 'service_unavailable', true],
    [429, 'rate_limit_exceeded', true],
    [429, 'daily_quota_exceeded', false],
    [403, 'validation_error', false],
    [422, 'missing_required_field', false],
  ])('maps %i %s to a %s-retryable EmailError', async (status, name, retryable) => {
    const provider = resendProvider({
      apiKey: 're_test',
      fetch: reply(status, {
        statusCode: status,
        name,
        message: 'details about owner@example.test',
      }),
    });
    const error = await provider.send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailError);
    expect(error).toMatchObject({ code: name, status, retryable });
    // The provider's message can name the recipient; ours never does.
    expect(String((error as Error).message)).not.toContain('owner@example.test');
  });

  it('treats a network failure as retryable', async () => {
    const provider = resendProvider({
      apiKey: 're_test',
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    });
    await expect(provider.send(message)).rejects.toMatchObject({
      code: 'network_error',
      retryable: true,
    });
  });

  it('refuses to start without an API key', () => {
    expect(() => resendProvider({ apiKey: '' })).toThrow(/API key/);
  });
});
