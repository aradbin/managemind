// One Durable Object per limited key (ADR 0006). Counters live in memory, so
// they write no SQLite rows; only a lockout is stored. An evicted object
// restarts its counts, which fails open for at most one window.
import { DurableObject } from 'cloudflare:workers';
import { type HitResult, LimiterState, type LockoutPolicy, type Window } from './limiter';

export class RateLimiter extends DurableObject {
  private readonly state = new LimiterState({
    get: () => this.ctx.storage.get<number>('lockedUntil'),
    put: (until) => this.ctx.storage.put('lockedUntil', until),
    delete: async () => {
      await this.ctx.storage.delete('lockedUntil');
    },
  });

  hit(windows: Window[]): Promise<HitResult> {
    return this.state.hit(windows);
  }

  peek(windows: Window[]): number {
    return this.state.peek(windows);
  }

  fail(policy: LockoutPolicy): Promise<{ locked: boolean }> {
    return this.state.fail(policy);
  }

  clear(): Promise<void> {
    return this.state.clear();
  }
}
