import type { OutboxEvent } from '@managemind/core';
import { testUrls } from '@managemind/db/testing';
import type { Env } from '../src/env';
import { OtpState } from '../src/otp/state';
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

/** R2 in memory: what the media routes and the cleanup use. */
export class FakeR2 {
  objects = new Map<string, { body: Uint8Array; contentType: string | undefined }>();
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { key, size: o.body.byteLength } : null;
  }
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return {
      key,
      size: o.body.byteLength,
      body: new Blob([o.body]).stream(),
      httpEtag: `"${key}"`,
      httpMetadata: { contentType: o.contentType },
      text: async () => new TextDecoder().decode(o.body),
      json: async () => JSON.parse(new TextDecoder().decode(o.body)),
    };
  }
  async put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: { httpMetadata?: { contentType?: string } },
  ) {
    const body =
      typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array
          ? value
          : new Uint8Array(value);
    this.objects.set(key, {
      body: new Uint8Array(body),
      contentType: options?.httpMetadata?.contentType,
    });
    return { key };
  }
  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }
  async list(options: { prefix?: string } = {}) {
    const prefix = options.prefix ?? '';
    const objects = [...this.objects.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((key) => ({ key }));
    return { objects, truncated: false, delimitedPrefixes: [] };
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
        peek: async (w) => s.peek(w),
        fail: (p) => s.fail(p),
        clear: () => s.clear(),
      };
    },
  };
}

/** The OtpCodes namespace, backed by OtpState in memory; `codes` holds what was sent. */
export function fakeOtpNamespace() {
  const objects = new Map<string, OtpState>();
  const codes = new Map<string, string>();
  return {
    codes,
    getByName(name: string) {
      let state = objects.get(name);
      if (!state) {
        let value: Parameters<ConstructorParameters<typeof OtpState>[0]['put']>[0] | undefined;
        state = new OtpState({
          get: async () => value,
          put: async (v) => {
            value = v;
          },
        });
        objects.set(name, state);
      }
      const s = state;
      return {
        issue: async () => {
          const code = await s.issue();
          codes.set(name, code);
          return code;
        },
        verify: (code: string) => s.verify(code),
        check: (token: string) => s.check(token),
      };
    },
  };
}

export function makeEnv(
  overrides: Partial<Env> = {},
): Env & { OUTBOX: FakeQueue; FILES: FakeR2 & R2Bucket } {
  return {
    HYPERDRIVE: { connectionString: appUrl } as unknown as Hyperdrive,
    OUTBOX: new FakeQueue(),
    FILES: new FakeR2() as unknown as R2Bucket,
    RATE_LIMITER: fakeNamespace() as unknown as Env['RATE_LIMITER'],
    OTP_CODES: fakeOtpNamespace() as unknown as Env['OTP_CODES'],
    ENVIRONMENT: 'preview',
    PLATFORM_NAME: 'managemind',
    PLATFORM_DOMAIN: 'platform.example.test',
    STORE_DOMAIN: 'stores.example.test',
    COMMIT_SHA: 'abc1234',
    AUTH_SECRET: 'test-auth-secret-that-is-long-enough-0123456789',
    ADMIN_HOST: 'admin.platform.example.test',
    EMAIL_PROVIDER: 'capture',
    ...overrides,
  } as Env & { OUTBOX: FakeQueue; FILES: FakeR2 & R2Bucket };
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
