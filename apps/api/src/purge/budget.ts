// The account-wide purge bucket (ADR 0007 decision 3): on the Free plan,
// purges by tag share 25 calls that refill at 5 a minute, across every zone
// in the account. A token bucket kept by one Durable Object counts our calls
// so we wait instead of collecting 429s. Plain TypeScript, so tests run it
// in Node; the Durable Object only stores its two numbers.

export interface BucketState {
  tokens: number;
  /** When `tokens` was last computed, in ms since the epoch. */
  at: number;
}

export const PURGE_BUCKET = {
  /** Cloudflare's bucket is 25; two are left for purges by hand from the dashboard. */
  capacity: 23,
  /** 5 a minute: one every 12 seconds. */
  refillMs: 12_000,
} as const;

/** The bucket at `now`: refilled for the time since `state.at`, never past capacity. */
export function refill(state: BucketState | undefined, now: number): BucketState {
  if (!state) return { tokens: PURGE_BUCKET.capacity, at: now };
  const earned = Math.floor((now - state.at) / PURGE_BUCKET.refillMs);
  if (earned <= 0) return state;
  const tokens = Math.min(PURGE_BUCKET.capacity, state.tokens + earned);
  // Keep the remainder of a partly earned token, unless the bucket is full.
  const at = tokens === PURGE_BUCKET.capacity ? now : state.at + earned * PURGE_BUCKET.refillMs;
  return { tokens, at };
}

export interface TakeResult {
  ok: boolean;
  /** Seconds until a token is free, when refused. */
  retryAfter: number;
  state: BucketState;
}

/** Takes one token, or says how long to wait. */
export function take(state: BucketState | undefined, now: number): TakeResult {
  const current = refill(state, now);
  if (current.tokens > 0) {
    return { ok: true, retryAfter: 0, state: { ...current, tokens: current.tokens - 1 } };
  }
  const wait = current.at + PURGE_BUCKET.refillMs - now;
  return { ok: false, retryAfter: Math.max(1, Math.ceil(wait / 1000)), state: current };
}

/** After Cloudflare answered 429 anyway (a purge by hand, another tool): the bucket is empty. */
export const drain = (now: number): BucketState => ({ tokens: 0, at: now });
