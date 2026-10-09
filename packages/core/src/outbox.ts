// Transactional outbox (ADR 0010). emit() writes the event in the caller's
// transaction; after commit, relayEvents() hands the events to the queue and
// marks them dispatched. Anything the relay misses is picked up by the daily
// sweep (app.outbox_claim), so a slow queue never fails a request.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { EVENTS, type EventPayload, type EventType } from './events';
import type { DbClient, TenantTx } from './tenant';

export interface OutboxEvent {
  id: string;
  tenantId: string;
  eventType: EventType;
  aggregateType: string;
  aggregateId: string | null;
  payload: unknown;
  requestId: string | null;
  createdAt: string;
}

export interface EmitInput<E extends EventType> {
  aggregateType: string;
  aggregateId?: string;
  payload: EventPayload<E>;
}

export async function emit<E extends EventType>(
  tx: TenantTx,
  eventType: E,
  input: EmitInput<E>,
): Promise<OutboxEvent> {
  const parsed = EVENTS[eventType].safeParse(input.payload);
  if (!parsed.success) {
    throw new AppError('internal', {
      detail: `invalid payload for ${eventType}`,
      cause: parsed.error,
    });
  }
  const [row] = await tx.db
    .insert(schema.outbox)
    .values({
      eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId ?? null,
      payload: parsed.data,
      requestId: tx.requestId ?? null,
    })
    .returning();
  if (!row) throw new AppError('internal', { detail: 'outbox insert returned no row' });
  const event: OutboxEvent = {
    id: row.id,
    tenantId: row.tenantId,
    eventType,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    payload: row.payload,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  };
  tx.events.push(event);
  return event;
}

/** Where relayed events go: Cloudflare Queues in the Worker, a stub in tests. */
export interface EventSink {
  send(events: readonly OutboxEvent[]): Promise<void>;
}

export interface RelayResult {
  dispatched: number;
  failed: number;
  error?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends committed events to the sink, retrying quickly a few times, then
 * marks them dispatched. Never throws: the data is already committed, and
 * leftovers are the daily sweep's job. Runs outside any tenant transaction.
 */
export async function relayEvents(
  client: DbClient,
  events: readonly OutboxEvent[],
  sink: EventSink,
  options: { attempts?: number; backoffMs?: number } = {},
): Promise<RelayResult> {
  if (events.length === 0) return { dispatched: 0, failed: 0 };
  const attempts = options.attempts ?? 3;
  const ids = events.map((e) => e.id);
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await sink.send(events);
      const { rows } = await client.query<{ n: number }>(
        'select app.outbox_mark_dispatched($1::uuid[]) as n',
        [ids],
      );
      return { dispatched: rows[0]?.n ?? 0, failed: 0 };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt < attempts) await sleep((options.backoffMs ?? 100) * 2 ** (attempt - 1));
    }
  }
  for (const id of ids) {
    await client.query('select app.outbox_mark_failed($1, $2)', [id, lastError]).catch(() => {});
  }
  return { dispatched: 0, failed: ids.length, error: lastError };
}
