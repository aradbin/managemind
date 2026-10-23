// A demo or test store's reset (phase-5b-plan §3.12): the same deletion as a
// purge, but the store, its people and its settings stay and nothing waits
// for a grace period. Then it starts again: the defaults every store gets,
// and for the demo stores the sample catalog and a month of sample orders.
// A stopped reset runs again from the start: deleting is idempotent, and
// the reseed only runs once everything is gone.
import {
  type EventSink,
  emit,
  relayEvents,
  seedStoreDefaults,
  systemActor,
  withTenant,
} from '@managemind/core';
import { permissionsOf, tenantObjectPrefixes } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { seedDemoCatalog } from '../demo/catalog';
import { seedDemoOrders } from '../demo/orders';
import type { ObjectStore } from './export';
import { deleteStoreRows, JobRefused } from './purge';

export interface ResetDeps {
  client: pg.Client;
  files: ObjectStore;
  sink: EventSink | null;
}

export interface ResetResult {
  deleted: { rows: number; files: number };
  catalog: boolean;
  orders: number;
}

export async function resetStore(
  deps: ResetDeps,
  job: { id: string; tenantId: string },
  onProgress: (step: string) => Promise<void> = async () => {},
): Promise<ResetResult> {
  const { client } = deps;
  const { rows: stores } = await client.query<{ kind: string; status: string }>(
    'select kind, status from platform.tenants where id = $1',
    [job.tenantId],
  );
  const store = stores[0];
  if (!store || store.kind === 'client')
    throw new JobRefused('only demo and test stores are reset');
  if (store.status !== 'active' && store.status !== 'suspended') {
    throw new JobRefused(`the store is ${store.status}`);
  }

  let rows = 0;
  await deleteStoreRows(
    client,
    job.tenantId,
    null,
    async (table, n) => {
      rows += n;
      await onProgress(`table:${table}`);
    },
    { keepSystem: true },
  );
  // Its files and uploads; an export the owner may still download stays.
  let files = 0;
  const [stored = '', , uploads = ''] = tenantObjectPrefixes(job.tenantId);
  for (const prefix of [stored, uploads]) {
    const keys: string[] = [];
    for await (const o of deps.files.list(prefix)) keys.push(o.key);
    for (let i = 0; i < keys.length; i += 100) await deps.files.delete(keys.slice(i, i + 100));
    files += keys.length;
  }
  await onProgress('files');

  // The core runs as app_rw, as in the API, so row-level security applies.
  await client.query('grant app_rw to current_user with set true, inherit false');
  const owner = {
    ...systemActor,
    permissions: permissionsOf('owner'),
    storeRole: 'owner' as const,
  };
  await withTenant(client, job.tenantId, async (tx) => {
    await tx.db.execute(sql`set local role app_rw`);
    await seedStoreDefaults(tx, { ...owner, tenantId: job.tenantId });
  });
  const catalog =
    store.kind === 'demo' && (await seedDemoCatalog(client, {}, job.tenantId)).length > 0;
  const orders = catalog ? await seedDemoOrders(client, job.tenantId) : 0;
  await onProgress('reseeded');

  // The reseed's own events (new products, sample orders) changed nothing
  // anyone needs to hear about; one store-wide cache purge covers the pages.
  await client.query(
    `select app.outbox_mark_dispatched(array(
       select id from store.outbox where tenant_id = $1 and dispatched_at is null))`,
    [job.tenantId],
  );
  await withTenant(
    client,
    job.tenantId,
    (tx) =>
      emit(tx, 'tenant.reset', {
        aggregateType: 'tenant_job',
        aggregateId: job.id,
        payload: { jobId: job.id },
      }),
    deps.sink
      ? {
          afterCommit: (events) =>
            relayEvents(client, events, deps.sink as EventSink).then(() => {}),
        }
      : {},
  );
  return { deleted: { rows, files }, catalog, orders };
}
