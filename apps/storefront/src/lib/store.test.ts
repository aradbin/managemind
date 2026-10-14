import { describe, expect, it } from 'vitest';
import { lookupStore, resolveStoreHost, type StoreContext, type StoreRequest } from './store';

const base: StoreRequest = {
  host: 'managemind-storefront.example.workers.dev',
  storeParam: null,
  storeCookie: null,
  environment: 'preview',
  storeDomain: 'stores.example.test',
};

describe('resolveStoreHost', () => {
  it('uses the request host by default, without port', () => {
    expect(resolveStoreHost({ ...base, host: 'Demo-Fashion.stores.example.test:443' })).toEqual({
      host: 'demo-fashion.stores.example.test',
      devStore: null,
      cookie: null,
    });
  });

  it('selects a store with ?store= and remembers it', () => {
    expect(resolveStoreHost({ ...base, storeParam: 'demo-grocery' })).toEqual({
      host: 'demo-grocery.stores.example.test',
      devStore: 'demo-grocery',
      cookie: { set: 'demo-grocery' },
    });
  });

  it('keeps the selection from the cookie, and clears it with ?store=', () => {
    expect(resolveStoreHost({ ...base, storeCookie: 'demo-grocery' }).host).toBe(
      'demo-grocery.stores.example.test',
    );
    expect(resolveStoreHost({ ...base, storeParam: '', storeCookie: 'demo-grocery' })).toEqual({
      host: base.host,
      devStore: null,
      cookie: { clear: true },
    });
  });

  it('ignores malformed slugs', () => {
    expect(resolveStoreHost({ ...base, storeParam: 'Bad Slug!' }).devStore).toBeNull();
    expect(resolveStoreHost({ ...base, storeCookie: 'x.evil.test' }).devStore).toBeNull();
  });

  it('is switched off in production', () => {
    expect(
      resolveStoreHost({
        ...base,
        environment: 'production',
        storeParam: 'demo-grocery',
        storeCookie: 'demo-fashion',
      }),
    ).toEqual({
      host: base.host,
      devStore: null,
      cookie: null,
    });
  });
});

describe('lookupStore', () => {
  const record = {
    tenantId: '0199d000-0000-7000-8000-00000000f001',
    slug: 'demo-fashion',
    name: 'Demo Fashion',
    defaultLocale: 'en' as const,
    status: 'active' as const,
    primaryHost: 'demo-fashion.stores.example.test',
  };
  const { tenantId, ...fields } = record;
  const fromApi: StoreContext = { ...fields, id: tenantId, name: 'From the API' };
  const host = 'demo-fashion.stores.example.test';

  it('uses the KV map when the host is in it, without calling the API', async () => {
    let apiCalls = 0;
    const kv = { get: async (key: string) => (key === `host:${host}` ? record : null) };
    const store = await lookupStore(host, {
      kv: kv as never,
      api: async () => {
        apiCalls++;
        return fromApi;
      },
    });
    expect(store).toEqual({ ...fromApi, name: 'Demo Fashion' });
    expect(apiCalls).toBe(0);
  });

  it('falls back to the API on a miss, without KV, and when KV fails', async () => {
    const api = async () => fromApi;
    expect(await lookupStore(host, { kv: { get: async () => null } as never, api })).toEqual(
      fromApi,
    );
    expect(await lookupStore(host, { api })).toEqual(fromApi);
    const errors: unknown[] = [];
    const broken = { get: async () => Promise.reject(new Error('kv down')) };
    expect(
      await lookupStore(host, { kv: broken as never, api, onKvError: (e) => errors.push(e) }),
    ).toEqual(fromApi);
    expect(errors).toHaveLength(1);
  });
});
