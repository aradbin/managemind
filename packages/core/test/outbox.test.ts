import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type EventSink, emit, type OutboxEvent, relayEvents, withTenant } from '../src';
import { connectApp, connectOwner, TENANT_A, TENANT_B } from './setup';

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  app = await connectApp();
  owner = await connectOwner();
});
afterAll(async () => {
  await app.end();
  await owner.end();
});

const emitOne = (tenant: string, slug: string) =>
  withTenant(
    app,
    tenant,
    (tx) =>
      emit(tx, 'tenant.seeded', {
        aggregateType: 'tenant',
        aggregateId: tenant,
        payload: { slug },
      }),
    { requestId: 'req_test' },
  );

const row = async (id: string) =>
  (
    await owner.query(
      'select dispatched_at, attempts, last_error from store.outbox where id = $1',
      [id],
    )
  ).rows[0];

class FlakySink implements EventSink {
  sent: OutboxEvent[] = [];
  constructor(private failures: number) {}
  async send(events: readonly OutboxEvent[]) {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('queue unavailable');
    }
    this.sent.push(...events);
  }
}

describe('emit', () => {
  it('writes the event in the transaction, with tenant and request id', async () => {
    const event = await emitOne(TENANT_B, 'demo');
    expect(event).toMatchObject({
      tenantId: TENANT_B,
      eventType: 'tenant.seeded',
      requestId: 'req_test',
    });
    expect(await row(event.id)).toMatchObject({ dispatched_at: null, attempts: 0 });
  });

  it('refuses a payload that does not match the event schema', async () => {
    await expect(
      withTenant(app, TENANT_A, (tx) =>
        emit(tx, 'tenant.seeded', { aggregateType: 'tenant', payload: { slug: 42 } as never }),
      ),
    ).rejects.toThrow(/invalid payload/);
  });
});

describe('relayEvents', () => {
  it('sends and marks events dispatched', async () => {
    const event = await emitOne(TENANT_A, 'relay-ok');
    const sink = new FlakySink(0);
    expect(await relayEvents(app, [event], sink)).toEqual({ dispatched: 1, failed: 0 });
    expect(sink.sent.map((e) => e.id)).toEqual([event.id]);
    expect((await row(event.id))?.dispatched_at).not.toBeNull();
  });

  it('retries a flaky queue', async () => {
    const event = await emitOne(TENANT_A, 'relay-flaky');
    const result = await relayEvents(app, [event], new FlakySink(2), { backoffMs: 1 });
    expect(result).toEqual({ dispatched: 1, failed: 0 });
  });

  it('never throws when the queue is down, and records the failure', async () => {
    const event = await emitOne(TENANT_A, 'relay-down');
    const result = await relayEvents(app, [event], new FlakySink(99), { backoffMs: 1 });
    expect(result).toEqual({ dispatched: 0, failed: 1, error: 'queue unavailable' });
    expect(await row(event.id)).toMatchObject({
      dispatched_at: null,
      attempts: 1,
      last_error: 'queue unavailable',
    });
  });
});
