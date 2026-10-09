import type { OutboxEvent } from '@managemind/core';
import { testUrls } from '@managemind/db/testing';
import type { Env } from '../src/env';

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

export function makeEnv(overrides: Partial<Env> = {}): Env & { OUTBOX: FakeQueue } {
  return {
    HYPERDRIVE: { connectionString: appUrl } as unknown as Hyperdrive,
    OUTBOX: new FakeQueue(),
    ENVIRONMENT: 'preview',
    PLATFORM_NAME: 'managemind',
    PLATFORM_DOMAIN: 'platform.example.test',
    STORE_DOMAIN: 'stores.example.test',
    COMMIT_SHA: 'abc1234',
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
