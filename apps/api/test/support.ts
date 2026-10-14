import type { OutboxEvent } from '@managemind/core';
import { testUrls } from '@managemind/db/testing';
import type { Env } from '../src/env';
import type { LimiterNamespace } from '../src/rate-limit/index';
import { LimiterState, type LockStore } from '../src/rate-limit/limiter';

export const DATABASE = 'managemind_test_api';
export const { ownerUrl, appUrl } = testUrls(DATABASE);

export class FakeQueue {
  sent: OutboxEvent[] = [];
  async send(body: OutboxEvent) {
    this.sent.push(body);
  }
  async sendBatch(messages: Iterable<{ body: OutboxEvent }>) {
    for (const m of messages) this.sent.push(m.body);
  }
}

export function memoryStore(): LockStore & { value: number | undefined; writes: number } {
  const store = {
    value: undefined as number | undefined,
    writes: 0,
    get: async () => store.value,
    put: async (until: number) => {
      store.value = until;
      store.writes++;
    },
    delete: async () => {
      store.value = undefined;
    },
  };
  return store;
}

/** The RateLimiter namespace, backed by LimiterState in memory. */
export function fakeNamespace(): LimiterNamespace & { names: string[] } {
  const objects = new Map<string, LimiterState>();
  const names: string[] = [];
  return {
    names,
    getByName(name: string) {
      names.push(name);
      let state = objects.get(name);
      if (!state) {
        state = new LimiterState(memoryStore());
        objects.set(name, state);
      }
      const s = state;
      return {
        hit: (w) => s.hit(w),
        fail: (p) => s.fail(p),
        clear: () => s.clear(),
      };
    },
  };
}

export function makeEnv(overrides: Partial<Env> = {}): Env & { OUTBOX: FakeQueue } {
  return {
    HYPERDRIVE: { connectionString: appUrl } as unknown as Hyperdrive,
    OUTBOX: new FakeQueue(),
    RATE_LIMITER: fakeNamespace() as unknown as Env['RATE_LIMITER'],
    ENVIRONMENT: 'preview',
    PLATFORM_NAME: 'managemind',
    PLATFORM_DOMAIN: 'platform.example.test',
    STORE_DOMAIN: 'stores.example.test',
    COMMIT_SHA: 'abc1234',
    AUTH_SECRET: 'test-auth-secret-that-is-long-enough-0123456789',
    ADMIN_HOST: 'admin.platform.example.test',
    EMAIL_PROVIDER: 'capture',
    ...overrides,
  } as Env & { OUTBOX: FakeQueue };
}

/** An ExecutionContext whose waitUntil promises can be awaited. */
export function makeCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    passThroughOnException: () => {},
    props: {},
    settle: () => Promise.all(pending),
  } as unknown as ExecutionContext & { settle: () => Promise<unknown[]> };
}
