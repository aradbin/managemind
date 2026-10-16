// Cache purges (ADR 0007, ADR 0018): events become the right tags; each
// store's tags are merged and packed into calls of at most 100; an empty
// bucket or a 429 comes back as a delayed message; other failures retry;
// nothing is dropped.
import type { OutboxEvent } from '@managemind/core';
import { listsTag, productTag, storeTag } from '@managemind/shared/storefront/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleQueue } from '../src/jobs';
import { PURGE_BUCKET, refill, take } from '../src/purge/budget';
import {
  handlePurgeQueue,
  mergeTags,
  type PurgeMessage,
  packCalls,
  purgeMessages,
} from '../src/purge/consumer';
import { makeCtx, makeEnv } from './support';

const A = '01900000-0000-7000-8000-00000000000a';
const B = '01900000-0000-7000-8000-00000000000b';
const P = '01900000-0000-7000-8000-0000000000aa';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('the purge bucket', () => {
  it('starts full, spends one token per call and refills one every 12 seconds', () => {
    let state = refill(undefined, 0);
    expect(state.tokens).toBe(PURGE_BUCKET.capacity);
    for (let i = 0; i < PURGE_BUCKET.capacity; i++) {
      const r = take(state, 0);
      expect(r.ok).toBe(true);
      state = r.state;
    }
    const empty = take(state, 5_000);
    expect(empty).toMatchObject({ ok: false, retryAfter: 7 });
    expect(take(empty.state, 12_000).ok).toBe(true);
    expect(refill({ tokens: 0, at: 0 }, 10 * 60_000).tokens).toBe(PURGE_BUCKET.capacity);
  });
});

describe('tags', () => {
  const event = (
    eventType: string,
    payload: unknown,
    tenantId = A,
    aggregateId: string | null = P,
  ) =>
    ({
      id: crypto.randomUUID(),
      tenantId,
      eventType,
      aggregateId,
      payload,
      aggregateType: 'x',
      requestId: null,
      createdAt: '',
    }) as OutboxEvent;

  it('become one message per store, events without tags left out', () => {
    expect(
      purgeMessages([
        event('catalog.product.updated', { fields: ['prices'] }),
        event('inventory.level.changed', { variantIds: [P], reason: 'sale' }),
        event('catalog.category.changed', { change: 'updated' }, B, null),
      ]),
    ).toEqual([
      { kind: 'purge', tenantId: A, tags: [productTag(A, P), listsTag(A)] },
      { kind: 'purge', tenantId: B, tags: [storeTag(B)] },
    ]);
  });

  it('merge to the store tag when it is there or there are more than 100', () => {
    expect(mergeTags(A, [productTag(A, P), storeTag(A)])).toEqual([storeTag(A)]);
    const many = Array.from({ length: 101 }, (_, i) => productTag(A, `${i}`));
    expect(mergeTags(A, many)).toEqual([storeTag(A)]);
  });

  it('pack into calls of at most 100 without splitting a store', () => {
    const tags = (n: number, t: string) => Array.from({ length: n }, (_, i) => `s:${t}:p:${i}`);
    const calls = packCalls([
      { tenantId: A, tags: tags(60, A) },
      { tenantId: B, tags: tags(50, B) },
      { tenantId: 'c', tags: tags(40, 'c') },
    ]);
    expect(calls.map((c) => [c.tenantIds, c.tags.length])).toEqual([
      [[A], 60],
      [[B, 'c'], 90],
    ]);
  });
});

/** A message batch whose acks and retries are recorded. */
function batch(bodies: PurgeMessage[]) {
  const done: { body: PurgeMessage; how: string; delay?: number }[] = [];
  return {
    done,
    batch: {
      queue: 'managemind-purge',
      messages: bodies.map((body) => ({
        body,
        attempts: 1,
        ack: () => done.push({ body, how: 'ack' }),
        retry: (o?: { delaySeconds?: number }) =>
          done.push({ body, how: 'retry', ...(o?.delaySeconds ? { delay: o.delaySeconds } : {}) }),
      })),
    } as unknown as MessageBatch<PurgeMessage>,
  };
}

function purgeEnv(slots: { ok: boolean; retryAfter: number }[] = []) {
  const sent: { body: PurgeMessage; delaySeconds?: number }[] = [];
  let drained = 0;
  const env = makeEnv({
    CF_STORE_TOKEN: 'token',
    STORE_ZONE_ID: 'zone123',
    PURGE: {
      sendBatch: async (messages: Iterable<{ body: PurgeMessage; delaySeconds?: number }>) => {
        sent.push(...messages);
      },
    } as unknown as Queue<PurgeMessage>,
    PURGE_BUDGET: {
      getByName: () => ({
        take: async () => slots.shift() ?? { ok: true, retryAfter: 0 },
        drain: async () => {
          drained++;
        },
      }),
    } as unknown as ReturnType<typeof makeEnv>['PURGE_BUDGET'],
  });
  return { env, sent, drained: () => drained };
}

const msg = (tenantId: string, tags: string[]): PurgeMessage => ({ kind: 'purge', tenantId, tags });

describe('the purge consumer', () => {
  it('merges each store’s messages into one call and acknowledges them', async () => {
    const { env, sent } = purgeEnv();
    const calls: { url: string; body: unknown }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response('{"success":true}', { status: 200 });
    }) as unknown as typeof fetch;
    const { batch: b, done } = batch([
      msg(A, [productTag(A, P), listsTag(A)]),
      msg(A, [listsTag(A)]),
      msg(B, [storeTag(B)]),
    ]);
    await handlePurgeQueue(b, env, { fetcher });
    expect(calls).toEqual([
      {
        url: 'https://api.cloudflare.com/client/v4/zones/zone123/purge_cache',
        body: { tags: [productTag(A, P), listsTag(A), storeTag(B)] },
      },
    ]);
    expect(done.map((d) => d.how)).toEqual(['ack', 'ack', 'ack']);
    expect(sent).toEqual([]);
  });

  it('puts the tags back with a delay when the bucket is empty', async () => {
    const { env, sent } = purgeEnv([{ ok: false, retryAfter: 30 }]);
    const fetcher = vi.fn();
    const { batch: b, done } = batch([msg(A, [listsTag(A)])]);
    await handlePurgeQueue(b, env, { fetcher: fetcher as unknown as typeof fetch });
    expect(fetcher).not.toHaveBeenCalled();
    expect(sent).toEqual([{ body: msg(A, [listsTag(A)]), contentType: 'json', delaySeconds: 30 }]);
    expect(done.map((d) => d.how)).toEqual(['ack']);
  });

  it('empties the bucket and retries after 12 seconds on a 429', async () => {
    const { env, sent, drained } = purgeEnv();
    const fetcher = (async () =>
      new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    const { batch: b, done } = batch([msg(A, [listsTag(A)])]);
    await handlePurgeQueue(b, env, { fetcher });
    expect(drained()).toBe(1);
    expect(sent[0]).toMatchObject({ delaySeconds: 12 });
    expect(done.map((d) => d.how)).toEqual(['ack']);
  });

  it('retries the messages on any other failure, so they end in the dead-letter queue', async () => {
    const { env, sent } = purgeEnv();
    const fetcher = (async () => new Response('bad', { status: 500 })) as unknown as typeof fetch;
    const { batch: b, done } = batch([msg(A, [listsTag(A)])]);
    await handlePurgeQueue(b, env, { fetcher });
    expect(sent).toEqual([]);
    expect(done).toEqual([{ body: msg(A, [listsTag(A)]), how: 'retry', delay: 12 }]);
  });

  it('acknowledges without purging when the token isn’t set', async () => {
    const { env } = purgeEnv();
    const { CF_STORE_TOKEN: _token, ...withoutToken } = env;
    const fetcher = vi.fn();
    const { batch: b, done } = batch([msg(A, [listsTag(A)])]);
    await handlePurgeQueue(b, withoutToken, { fetcher: fetcher as unknown as typeof fetch });
    expect(fetcher).not.toHaveBeenCalled();
    expect(done.map((d) => d.how)).toEqual(['ack']);
  });
});

describe('the outbox consumer', () => {
  it('sends purge messages for events shoppers see', async () => {
    const { env, sent } = purgeEnv();
    const ctx = makeCtx();
    const acked: string[] = [];
    const events = [
      { eventType: 'theme.published', payload: {} },
      { eventType: 'staff.invited', payload: {} },
    ].map(
      (e) =>
        ({
          id: crypto.randomUUID(),
          tenantId: A,
          aggregateType: 'x',
          aggregateId: null,
          requestId: null,
          createdAt: '',
          ...e,
        }) as OutboxEvent,
    );
    await handleQueue(
      {
        queue: 'managemind-outbox',
        messages: events.map((body) => ({
          body,
          attempts: 1,
          ack: () => acked.push(body.id),
          retry: () => {},
        })),
      } as unknown as MessageBatch<OutboxEvent>,
      {
        ...env,
        PURGE: {
          sendBatch: async (m: Iterable<{ body: PurgeMessage }>) => sent.push(...m),
        } as never,
      },
      ctx,
    );
    expect(sent.map((s) => s.body)).toEqual([msg(A, [storeTag(A)])]);
    expect(acked).toHaveLength(2);
  });
});
