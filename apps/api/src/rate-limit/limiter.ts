// Rate-limit state for one key (ADR 0006): fixed-window counters kept in
// memory, and a lockout that survives eviction because it is stored. Plain
// TypeScript, so tests run it in Node; the Durable Object only wraps it.

export interface Window {
  limit: number;
  seconds: number;
}

export interface HitResult {
  allowed: boolean;
  /** Seconds until a refused caller may try again (0 when allowed). */
  retryAfter: number;
  /** The highest count across windows after this hit; quota tracking reads it. */
  count: number;
}

export interface LockoutPolicy {
  /** Failures within `windowSeconds` that trigger the lock. */
  failures: number;
  windowSeconds: number;
  lockSeconds: number;
}

/** The little persistent state a limiter needs: the lock's end time. */
export interface LockStore {
  get(): Promise<number | undefined>;
  put(until: number): Promise<void>;
  delete(): Promise<void>;
}

/** Windows are aligned to multiples of their length since the epoch. */
const windowStart = (now: number, seconds: number) =>
  Math.floor(now / (seconds * 1000)) * seconds * 1000;

export class LimiterState {
  private readonly counts = new Map<number, { start: number; count: number }>();
  private failures: { start: number; count: number } | undefined;
  private lockedUntil: number | undefined | null = null; // null: not loaded yet

  constructor(private readonly store: LockStore) {}

  private async lock(now: number): Promise<number> {
    if (this.lockedUntil === null) this.lockedUntil = await this.store.get();
    const until = this.lockedUntil ?? 0;
    return until > now ? until : 0;
  }

  /** Counts one attempt, unless the key is locked or a window is full. */
  async hit(windows: readonly Window[], now = Date.now()): Promise<HitResult> {
    const locked = await this.lock(now);
    if (locked) return { allowed: false, retryAfter: Math.ceil((locked - now) / 1000), count: 0 };

    let retryAfter = 0;
    let count = 0;
    const current = windows.map((w) => {
      const start = windowStart(now, w.seconds);
      const entry = this.counts.get(w.seconds);
      const n = entry && entry.start === start ? entry.count : 0;
      if (n >= w.limit) {
        retryAfter = Math.max(retryAfter, Math.ceil((start + w.seconds * 1000 - now) / 1000));
      }
      return { w, start, n };
    });
    // A refused attempt is not counted, so waiting is always enough.
    if (retryAfter > 0) {
      return { allowed: false, retryAfter, count: Math.max(...current.map((c) => c.n)) };
    }
    for (const { w, start, n } of current) {
      this.counts.set(w.seconds, { start, count: n + 1 });
      count = Math.max(count, n + 1);
    }
    return { allowed: true, retryAfter: 0, count };
  }

  /** The highest current count across windows, without counting (the email quota guard). */
  peek(windows: readonly Window[], now = Date.now()): number {
    let count = 0;
    for (const w of windows) {
      const entry = this.counts.get(w.seconds);
      if (entry && entry.start === windowStart(now, w.seconds))
        count = Math.max(count, entry.count);
    }
    return count;
  }

  /** Records a failed verification; locks the key when the policy's limit is reached. */
  async fail(policy: LockoutPolicy, now = Date.now()): Promise<{ locked: boolean }> {
    const start = windowStart(now, policy.windowSeconds);
    const n = this.failures && this.failures.start === start ? this.failures.count + 1 : 1;
    this.failures = { start, count: n };
    if (n < policy.failures) return { locked: false };
    this.lockedUntil = now + policy.lockSeconds * 1000;
    this.failures = undefined;
    await this.store.put(this.lockedUntil);
    return { locked: true };
  }

  /** After a success: forget failures and any lock. */
  async clear(): Promise<void> {
    this.failures = undefined;
    if (this.lockedUntil) await this.store.delete();
    this.lockedUntil = undefined;
  }
}
