// Cache purges (ADR 0007, ADR 0018). The outbox consumer turns events into
// cache tags (shared purgeTagsFor) and sends one message per store to the
// purge queue. The purge consumer receives them in batches of up to 10
// seconds, which debounces each store's changes; merges each store's tags
// (more than 100, or the store tag, becomes the store tag); packs them into
// calls of at most 100 tags; and spends one token of the account-wide bucket
// per call. When the bucket is empty or Cloudflare answers 429, the tags go
// back on the queue with a delay of 12 seconds or more. A purge is never
// dropped: other failures retry the messages, and they end in the
// dead-letter queue after 5 tries.
import type { OutboxEvent } from '@managemind/core';
import { PURGE_TAGS_PER_CALL, purgeTagsFor, storeTag } from '@managemind/shared/storefront/cache';
import { captureMessage } from '@sentry/cloudflare';
import type { Env } from '../env';
import { log } from '../log';

export interface PurgeMessage {
  kind: 'purge';
  tenantId: string;
  tags: string[];
}

export const isPurgeMessage = (body: unknown): body is PurgeMessage =>
  (body as PurgeMessage | null)?.kind === 'purge';

/** At least the bucket's refill interval, so a retry finds a token. */
const MIN_DELAY_SECONDS = 12;

/** The purge messages a batch of outbox events needs: one per store with tags. */
export function purgeMessages(events: readonly OutboxEvent[]): PurgeMessage[] {
  const byTenant = new Map<string, Set<string>>();
  for (const event of events) {
    const tags = purgeTagsFor(event);
    if (!tags.length) continue;
    const set = byTenant.get(event.tenantId) ?? new Set<string>();
    for (const tag of tags) set.add(tag);
    byTenant.set(event.tenantId, set);
  }
  return [...byTenant].map(([tenantId, tags]) => ({ kind: 'purge', tenantId, tags: [...tags] }));
}

/** One store's tags, merged: the store tag alone when it is there or there are too many. */
export function mergeTags(tenantId: string, tags: Iterable<string>): string[] {
  const set = new Set(tags);
  const whole = storeTag(tenantId);
  if (set.has(whole) || set.size > PURGE_TAGS_PER_CALL) return [whole];
  return [...set];
}

/** Packs stores' tag lists into calls of at most 100 tags, never splitting a store. */
export function packCalls(groups: { tenantId: string; tags: string[] }[]) {
  const calls: { tenantIds: string[]; tags: string[] }[] = [];
  for (const group of groups) {
    const last = calls.at(-1);
    if (last && last.tags.length + group.tags.length <= PURGE_TAGS_PER_CALL) {
      last.tenantIds.push(group.tenantId);
      last.tags.push(...group.tags);
    } else {
      calls.push({ tenantIds: [group.tenantId], tags: [...group.tags] });
    }
  }
  return calls;
}

export type PurgeOutcome = 'purged' | 'rate_limited' | 'failed';

/** One purge-by-tag call on the store zone. */
export async function purgeByTags(
  zoneId: string,
  token: string,
  tags: string[],
  fetcher: typeof fetch = fetch,
): Promise<{ outcome: PurgeOutcome; status: number; error?: string }> {
  const res = await fetcher(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tags }),
  });
  if (res.ok) return { outcome: 'purged', status: res.status };
  const text = await res.text().catch(() => '');
  return {
    outcome: res.status === 429 ? 'rate_limited' : 'failed',
    status: res.status,
    error: text.slice(0, 300),
  };
}

export interface PurgeDeps {
  fetcher?: typeof fetch;
}

export async function handlePurgeQueue(
  batch: MessageBatch<PurgeMessage>,
  env: Env,
  deps: PurgeDeps = {},
): Promise<void> {
  const token = env.CF_STORE_TOKEN;
  const zone = env.STORE_ZONE_ID;
  if (!token || !zone || !env.PURGE) {
    // Without the token nothing can be purged; pages still expire within a day.
    log('warn', 'purge skipped: CF_STORE_TOKEN or STORE_ZONE_ID is not set', {
      messages: batch.messages.length,
    });
    for (const m of batch.messages) m.ack();
    return;
  }
  const queue = env.PURGE;

  const byTenant = new Map<string, { tags: Set<string>; messages: Message<PurgeMessage>[] }>();
  for (const message of batch.messages) {
    const entry = byTenant.get(message.body.tenantId) ?? { tags: new Set(), messages: [] };
    for (const tag of message.body.tags) entry.tags.add(tag);
    entry.messages.push(message);
    byTenant.set(message.body.tenantId, entry);
  }
  const groups = [...byTenant].map(([tenantId, e]) => ({
    tenantId,
    tags: mergeTags(tenantId, e.tags),
  }));
  const budget = env.PURGE_BUDGET.getByName('account');

  /** Puts a call's stores back on the queue for later; the originals are then done. */
  const later = async (call: { tenantIds: string[] }, delaySeconds: number) => {
    await queue.sendBatch(
      call.tenantIds.map((tenantId) => ({
        body: {
          kind: 'purge' as const,
          tenantId,
          tags: groups.find((g) => g.tenantId === tenantId)?.tags ?? [],
        },
        contentType: 'json' as const,
        delaySeconds,
      })),
    );
  };
  const settle = (call: { tenantIds: string[] }, how: 'ack' | 'retry') => {
    for (const tenantId of call.tenantIds) {
      for (const m of byTenant.get(tenantId)?.messages ?? []) {
        if (how === 'ack') m.ack();
        else m.retry({ delaySeconds: MIN_DELAY_SECONDS * m.attempts });
      }
    }
  };

  for (const call of packCalls(groups)) {
    try {
      const slot = await budget.take();
      if (!slot.ok) {
        await later(call, Math.max(MIN_DELAY_SECONDS, slot.retryAfter));
        log('info', 'purge delayed: bucket empty', {
          tags: call.tags.length,
          retry_after: slot.retryAfter,
        });
        settle(call, 'ack');
        continue;
      }
      const result = await purgeByTags(zone, token, call.tags, deps.fetcher);
      if (result.outcome === 'purged') {
        log('info', 'purged', { tenants: call.tenantIds.length, tags: call.tags.length });
        settle(call, 'ack');
      } else if (result.outcome === 'rate_limited') {
        await budget.drain();
        await later(call, MIN_DELAY_SECONDS);
        log('warn', 'purge delayed: 429', { tags: call.tags.length });
        captureMessage('cache purge answered 429', {
          level: 'warning',
          extra: { tags: call.tags.length },
        });
        settle(call, 'ack');
      } else {
        log('error', 'purge failed', { status: result.status, error: result.error });
        settle(call, 'retry');
      }
    } catch (e) {
      log('error', 'purge failed', { error: String(e) });
      settle(call, 'retry');
    }
  }
}
