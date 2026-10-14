// KV host sync (phase-1-plan §4.3, ADR 0015): the outbox consumer's first
// real handler. For each store a batch touches, it recomputes the host keys
// from the database and writes only what differs, so redeliveries and
// duplicates change nothing and KV writes (1,000 a day) are spent only on
// real changes. Previews have no consumer and no KV binding.
import { HOST_EVENTS, hostEntries, type OutboxEvent } from '@managemind/core';
import { createDb } from '@managemind/db';
import { withClient } from './db';
import type { Env } from './env';

export const touchesHosts = (event: OutboxEvent): boolean => HOST_EVENTS.includes(event.eventType);

/** Brings one store's host keys in line with its rows; returns the writes made. */
export async function syncTenantHosts(
  env: Env,
  kv: KVNamespace,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  tenantId: string,
  storeDomain: string,
): Promise<{ put: number; deleted: number }> {
  const entries = await withClient(env, ctx, (client) =>
    hostEntries(createDb(client), tenantId, storeDomain),
  );
  let put = 0;
  let deleted = 0;
  for (const { key, value } of entries.put) {
    const json = JSON.stringify(value);
    if ((await kv.get(key)) === json) continue;
    await kv.put(key, json);
    put++;
  }
  for (const key of entries.delete) {
    if ((await kv.get(key)) === null) continue;
    await kv.delete(key);
    deleted++;
  }
  return { put, deleted };
}
