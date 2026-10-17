import { describe, expect, it } from 'vitest';
import { cloudflareHostnames } from './cloudflare';
import { fakeHostnames } from './fake';
import { isLive } from './types';

function recorder(responses: { status: number; body: unknown }[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({
      method: init.method ?? 'GET',
      url,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    const next = responses.shift() ?? { status: 200, body: { success: true, result: null } };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

const hostname = {
  id: 'abc',
  hostname: 'www.shop.com.bd',
  status: 'pending',
  ssl: { status: 'pending_validation', validation_errors: [{ message: 'CNAME not found' }] },
  ownership_verification: { type: 'txt', name: '_cf-custom-hostname.www.shop.com.bd', value: 'v1' },
};

describe('cloudflareHostnames', () => {
  it('creates with HTTP validation and maps the state', async () => {
    const { calls, fetcher } = recorder([
      { status: 201, body: { success: true, result: hostname } },
    ]);
    const provider = cloudflareHostnames({ zoneId: 'zone', token: 't', fetcher });
    const state = await provider.create('www.shop.com.bd');
    expect(calls[0]).toEqual({
      method: 'POST',
      url: 'https://api.cloudflare.com/client/v4/zones/zone/custom_hostnames',
      body: {
        hostname: 'www.shop.com.bd',
        ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
      },
    });
    expect(state).toEqual({
      ref: 'abc',
      hostname: 'www.shop.com.bd',
      status: 'pending',
      sslStatus: 'pending_validation',
      ownership: { type: 'TXT', name: '_cf-custom-hostname.www.shop.com.bd', value: 'v1' },
      errors: ['CNAME not found'],
    });
    expect(isLive(state)).toBe(false);
  });

  it('returns null for a hostname Cloudflare no longer has, and throws on errors', async () => {
    const { fetcher } = recorder([
      { status: 404, body: { success: false, errors: [{ message: 'not found' }] } },
      {
        status: 409,
        body: {
          success: false,
          errors: [{ code: 1406, message: 'Duplicate custom hostname found.' }],
        },
      },
    ]);
    const provider = cloudflareHostnames({ zoneId: 'zone', token: 't', fetcher });
    expect(await provider.get('gone')).toBeNull();
    await expect(provider.create('www.shop.com.bd')).rejects.toMatchObject({ status: 409 });
  });

  it('lists every page of the zone', async () => {
    const { calls, fetcher } = recorder([
      {
        status: 200,
        body: { success: true, result: [hostname], result_info: { page: 1, total_pages: 2 } },
      },
      {
        status: 200,
        body: {
          success: true,
          result: [{ ...hostname, id: 'def' }],
          result_info: { page: 2, total_pages: 2 },
        },
      },
    ]);
    const all = await cloudflareHostnames({ zoneId: 'zone', token: 't', fetcher }).list();
    expect(all.map((h) => h.ref)).toEqual(['abc', 'def']);
    expect(calls.map((c) => c.url.split('?')[1])).toEqual([
      'per_page=50&page=1',
      'per_page=50&page=2',
    ]);
  });
});

describe('fakeHostnames', () => {
  it('keeps state until told otherwise', async () => {
    const fake = fakeHostnames();
    const created = await fake.create('www.cf-test.example.com');
    expect(created.ownership?.type).toBe('TXT');
    fake.set('www.cf-test.example.com', { status: 'active', sslStatus: 'active' });
    expect(isLive((await fake.get(created.ref)) ?? created)).toBe(true);
    await fake.delete(created.ref);
    expect(await fake.get(created.ref)).toBeNull();
  });
});
