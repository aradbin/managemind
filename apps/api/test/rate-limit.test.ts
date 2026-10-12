import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { countEmailSent } from '../src/rate-limit/email-quota';
import {
  createLimiter,
  type LimiterNamespace,
  limiterName,
  RateLimitedError,
} from '../src/rate-limit/index';
import { LimiterState, type LockStore } from '../src/rate-limit/limiter';

const T0 = Date.UTC(2026, 9, 11, 10, 0, 0); // on a 10-minute boundary

function memoryStore(): LockStore & { value: number | undefined; writes: number } {
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

describe('LimiterState', () => {
  const windows = [
    { limit: 3, seconds: 600 },
    { limit: 5, seconds: 86_400 },
  ];

  it('allows up to the limit, then refuses until the window ends', async () => {
    const state = new LimiterState(memoryStore());
    for (let i = 1; i <= 3; i++) {
      expect(await state.hit(windows, T0 + i)).toEqual({ allowed: true, retryAfter: 0, count: i });
    }
    expect(await state.hit(windows, T0 + 60_000)).toEqual({
      allowed: false,
      retryAfter: 540,
      count: 3,
    });
    // Refused attempts are not counted; the next window starts fresh.
    expect((await state.hit(windows, T0 + 600_000)).allowed).toBe(true);
  });

  it('applies the longest window too', async () => {
    const state = new LimiterState(memoryStore());
    for (let i = 0; i < 5; i++) await state.hit(windows, T0 + i * 600_000);
    const refused = await state.hit(windows, T0 + 5 * 600_000);
    expect(refused.allowed).toBe(false);
    // Until midnight UTC: 13 hours 10 minutes after 10:50.
    expect(refused.retryAfter).toBe(13 * 3600 + 10 * 60);
  });

  it('locks after repeated failures, keeps the lock in storage, and clears on success', async () => {
    const store = memoryStore();
    const state = new LimiterState(store);
    const policy = { failures: 3, windowSeconds: 3600, lockSeconds: 3600 };
    expect(await state.fail(policy, T0)).toEqual({ locked: false });
    expect(await state.fail(policy, T0 + 1)).toEqual({ locked: false });
    expect(await state.fail(policy, T0 + 2)).toEqual({ locked: true });
    expect(store.writes).toBe(1);

    // A new object (after eviction) still sees the lock.
    const revived = new LimiterState(store);
    expect(await revived.hit(windows, T0 + 60_000)).toEqual({
      allowed: false,
      retryAfter: 3541, // locked at T0 + 2 ms, for an hour
      count: 0,
    });
    expect((await revived.hit(windows, T0 + 3_600_003)).allowed).toBe(true);

    await revived.clear();
    expect(store.value).toBeUndefined();
  });
});

/** The RateLimiter namespace, backed by LimiterState in memory. */
function fakeNamespace(): LimiterNamespace & { names: string[] } {
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

describe('createLimiter', () => {
  it('accepts the real Durable Object namespace', () => {
    expectTypeOf<Env['RATE_LIMITER']>().toExtend<LimiterNamespace>();
  });

  it('names objects by rule and a hash, never the raw value', async () => {
    const ns = fakeNamespace();
    const limiter = createLimiter(ns, () => {});
    await limiter.check('otp-send:email', ' Owner@Example.test ');
    expect(ns.names[0]).toBe(await limiterName('otp-send:email', 'owner@example.test'));
    expect(ns.names[0]).toMatch(/^otp-send:email:[0-9a-f]{64}$/);
  });

  it('throws rate_limited with a retry time when a rule is exhausted', async () => {
    const limiter = createLimiter(fakeNamespace(), () => {});
    for (let i = 0; i < 3; i++) await limiter.check('otp-send:email', 'a@example.test');
    const error = await limiter.check('otp-send:email', 'a@example.test').catch((e) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error).toMatchObject({ code: 'rate_limited', status: 429 });
    expect((error as RateLimitedError).retryAfter).toBeGreaterThan(0);
    // Other addresses are unaffected.
    await expect(limiter.check('otp-send:email', 'b@example.test')).resolves.toBeUndefined();
  });

  it('locks an address after 10 failed code checks and unlocks on success', async () => {
    const limiter = createLimiter(fakeNamespace(), () => {});
    for (let i = 0; i < 10; i++) await limiter.fail('otp-verify:email', 'a@example.test');
    await expect(limiter.check('otp-verify:email', 'a@example.test')).rejects.toBeInstanceOf(
      RateLimitedError,
    );
    await limiter.succeed('otp-verify:email', 'a@example.test');
    await expect(limiter.check('otp-verify:email', 'a@example.test')).resolves.toBeUndefined();
  });

  it('fails open and reports when the Durable Object is unreachable', async () => {
    const onError = vi.fn();
    const broken: LimiterNamespace = {
      getByName: () => {
        throw new Error('unavailable');
      },
    };
    const limiter = createLimiter(broken, onError);
    await expect(limiter.check('otp-send:ip', '192.0.2.1')).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('countEmailSent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('counts per UTC day and warns from 70% of the cap', async () => {
    const ns = fakeNamespace();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const day = new Date('2026-10-11T23:59:00Z');
    for (let i = 1; i <= 6; i++) expect(await countEmailSent(ns, day, 10)).toBe(i);
    expect(warn).not.toHaveBeenCalled();
    expect(await countEmailSent(ns, day, 10)).toBe(7);
    expect(warn).toHaveBeenCalledOnce();
    expect(await countEmailSent(ns, new Date('2026-10-12T00:01:00Z'), 10)).toBe(1);
    expect(ns.names.at(-1)).toBe('email-quota:2026-10-12');
  });
});
