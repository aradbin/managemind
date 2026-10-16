// Rate limits for the sensitive endpoints only: sign-in codes, two-factor
// checks, invitations (phase-1-plan §5.5), fetching images by URL
// (phase-2-plan §3.7) and storefront search misses (phase-3-plan §3.7).
// Never on every request.
import { AppError } from '@managemind/shared';
import type { HitResult, LockoutPolicy, Window } from './limiter';

/** What the API needs from the RateLimiter namespace (a fake in tests). */
export interface LimiterNamespace {
  getByName(name: string): {
    hit(windows: Window[]): Promise<HitResult>;
    fail(policy: LockoutPolicy): Promise<{ locked: boolean }>;
    clear(): Promise<void>;
  };
}

interface Rule {
  windows: Window[];
  lockout?: LockoutPolicy;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const RULES = {
  /** Sign-in codes sent to one email address. */
  'otp-send:email': {
    windows: [
      { limit: 3, seconds: 10 * MINUTE },
      { limit: 10, seconds: DAY },
    ],
  },
  /** Sign-in codes requested from one IP address. */
  'otp-send:ip': { windows: [{ limit: 20, seconds: HOUR }] },
  /** Code checks for one email address; 10 failures in an hour lock it for an hour. */
  'otp-verify:email': {
    windows: [{ limit: 10, seconds: 15 * MINUTE }],
    lockout: { failures: 10, windowSeconds: HOUR, lockSeconds: HOUR },
  },
  /** Authenticator or backup code checks for one user. */
  '2fa-verify:user': {
    windows: [{ limit: 5, seconds: 15 * MINUTE }],
    lockout: { failures: 10, windowSeconds: HOUR, lockSeconds: HOUR },
  },
  /** Invitations sent by one store. */
  'invite:tenant': { windows: [{ limit: 30, seconds: DAY }] },
  /** Storefront search misses from one shopper (phase-3-plan §3.7); cached results cost nothing. */
  'search:ip': { windows: [{ limit: 30, seconds: MINUTE }] },
  /** Images fetched by URL for one store's imports (phase-2-plan §3.7): 500 products' worth an hour. */
  'media-fetch:tenant': {
    windows: [
      { limit: 2_000, seconds: HOUR },
      { limit: 10_000, seconds: DAY },
    ],
  },
} as const satisfies Record<string, Rule>;

export type RuleName = keyof typeof RULES;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The object name: the rule plus a hash, so no email address or IP becomes an object name. */
export async function limiterName(rule: RuleName, value: string): Promise<string> {
  return `${rule}:${await sha256(value.trim().toLowerCase())}`;
}

export interface Limiter {
  /** Counts an attempt; throws rate_limited (with `retryAfter` in seconds) when refused. */
  check(rule: RuleName, value: string): Promise<void>;
  /** Records a failed verification for a rule with a lockout. */
  fail(rule: RuleName, value: string): Promise<void>;
  /** Clears failures and lockout after a successful verification. */
  succeed(rule: RuleName, value: string): Promise<void>;
}

export class RateLimitedError extends AppError {
  readonly retryAfter: number;
  constructor(retryAfter: number) {
    super('rate_limited');
    this.retryAfter = retryAfter;
  }
}

/**
 * The limiter fails open: if the Durable Object can't be reached, the
 * request goes ahead and `onError` reports it. Better Auth's own limit of
 * three tries per code still applies.
 */
export function createLimiter(ns: LimiterNamespace, onError: (e: unknown) => void): Limiter {
  const stub = async (rule: RuleName, value: string) =>
    ns.getByName(await limiterName(rule, value));
  return {
    async check(rule, value) {
      let result: HitResult;
      try {
        result = await (await stub(rule, value)).hit([...RULES[rule].windows]);
      } catch (e) {
        onError(e);
        return;
      }
      if (!result.allowed) throw new RateLimitedError(result.retryAfter);
    },
    async fail(rule, value) {
      const policy = (RULES[rule] as Rule).lockout;
      if (!policy) return;
      try {
        await (await stub(rule, value)).fail(policy);
      } catch (e) {
        onError(e);
      }
    },
    async succeed(rule, value) {
      if (!(RULES[rule] as Rule).lockout) return;
      try {
        await (await stub(rule, value)).clear();
      } catch (e) {
        onError(e);
      }
    },
  };
}
