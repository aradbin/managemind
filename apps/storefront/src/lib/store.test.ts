import { describe, expect, it } from 'vitest';
import { resolveStoreHost, type StoreRequest } from './store';

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
