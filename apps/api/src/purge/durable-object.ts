// The purge counter (ADR 0007 decision 3): one object for the whole account,
// named "account". Its two numbers are stored, so an evicted object never
// forgets calls it already allowed.
import { DurableObject } from 'cloudflare:workers';
import { type BucketState, drain, type TakeResult, take } from './budget';

export class PurgeBudget extends DurableObject {
  async take(): Promise<Omit<TakeResult, 'state'>> {
    const state = await this.ctx.storage.get<BucketState>('bucket');
    const result = take(state, Date.now());
    await this.ctx.storage.put('bucket', result.state);
    return { ok: result.ok, retryAfter: result.retryAfter };
  }

  async drain(): Promise<void> {
    await this.ctx.storage.put('bucket', drain(Date.now()));
  }
}
