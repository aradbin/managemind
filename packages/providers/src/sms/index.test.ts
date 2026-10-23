import { describe, expect, it } from 'vitest';
import { bulkSmsBdProvider, httpSmsProvider, SmsError, smsNetBdProvider } from './index';

/** A fetch that records its calls and answers with `body`. */
function fake(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init ? { init } : {}) });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { f, calls };
}

describe('sms.net.bd', () => {
  it('sends to 880… with the sender ID, and reads the balance', async () => {
    const { f, calls } = fake({
      error: 0,
      msg: 'Request successfully submitted',
      data: { request_id: 42 },
    });
    const p = smsNetBdProvider({ apiKey: 'k', senderId: 'SHOP', fetch: f });
    expect(await p.send('+8801712345678', 'হ্যালো')).toEqual({ id: '42' });
    const sent = new URLSearchParams(String(calls[0]?.init?.body));
    expect(calls[0]?.url).toBe('https://api.sms.net.bd/sendsms');
    expect(Object.fromEntries(sent)).toEqual({
      api_key: 'k',
      msg: 'হ্যালো',
      to: '8801712345678',
      sender_id: 'SHOP',
    });
    const balance = fake({ error: 0, msg: 'Success', data: { balance: '120.5000' } });
    expect(await smsNetBdProvider({ apiKey: 'k', fetch: balance.f }).balance()).toBe(120.5);
  });

  it('names its errors, and retries only its own failures', async () => {
    const low = smsNetBdProvider({
      apiKey: 'k',
      fetch: fake({ error: 417, msg: 'Insufficient balance' }).f,
    });
    await expect(low.send('+8801712345678', 'x')).rejects.toMatchObject({
      code: 'insufficient_balance',
      retryable: false,
    });
    const down = smsNetBdProvider({ apiKey: 'k', fetch: fake('oops', 502).f });
    await expect(down.send('+8801712345678', 'x')).rejects.toMatchObject({ retryable: true });
  });
});

describe('BulkSMSBD', () => {
  it('sends with its fields, and reads 202 as success', async () => {
    const { f, calls } = fake({
      response_code: 202,
      message_id: 9,
      success_message: 'SMS Submitted Successfully',
    });
    const p = bulkSmsBdProvider({ apiKey: 'k', senderId: '8809617', fetch: f });
    expect(await p.send('+8801712345678', 'hi')).toEqual({ id: '9' });
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]?.init?.body)))).toEqual({
      api_key: 'k',
      type: 'text',
      number: '8801712345678',
      senderid: '8809617',
      message: 'hi',
    });
    const wall = bulkSmsBdProvider({
      apiKey: 'k',
      senderId: 'x',
      fetch: fake({ response_code: 1032 }).f,
    });
    await expect(wall.send('+8801712345678', 'hi')).rejects.toMatchObject({
      code: 'ip_not_whitelisted',
    });
  });
});

describe('a generic HTTPS gateway', () => {
  it('puts the number and text in the named fields, with its secret header', async () => {
    const { f, calls } = fake('OK: queued');
    const p = httpSmsProvider(
      {
        url: 'https://gw.example.test/send',
        method: 'GET',
        toField: 'msisdn',
        messageField: 'text',
        extra: { from: 'SHOP' },
        authHeader: 'x-key',
        successText: 'OK',
      },
      { authValue: 'secret' },
      f,
    );
    await p.send('+8801712345678', 'hi');
    const url = new URL(calls[0]?.url ?? '');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: 'SHOP',
      msisdn: '8801712345678',
      text: 'hi',
    });
    expect((calls[0]?.init?.headers ?? {}) as Record<string, string>).toMatchObject({
      'x-key': 'secret',
    });
    const refused = httpSmsProvider(
      {
        url: 'https://gw.example.test',
        method: 'POST',
        toField: 'to',
        messageField: 'm',
        extra: {},
        successText: 'OK',
      },
      {},
      fake('FAILED').f,
    );
    await expect(refused.send('+8801712345678', 'hi')).rejects.toBeInstanceOf(SmsError);
  });
});
