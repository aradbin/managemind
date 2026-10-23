// A closed store's purge in the tenant-jobs workflow (phase-5b-plan §3.11).
// First run: the dry run counts everything that would go and what stays,
// saves it on the purge record, and the job waits for the super admin's
// approval. After approval: store rows in STORE_TABLES order, 1,000 at a
// time with the progress saved after each batch, then its files, KV keys
// and platform rows, then a verification. Only a verified purge marks the
// store purged. Every step deletes what is still there, so a stopped run
// resumes from its last saved step and ends the same.
import { PLATFORM_TENANT_ROWS, STORE_TABLES } from '@managemind/db/registry';
import { hostKey, tenantObjectPrefixes } from '@managemind/shared';
import type pg from 'pg';
import type { ObjectStore } from './export';

/** KV through Cloudflare's API, or memory in tests. */
export interface KvStore {
  list(prefix: string): Promise<string[]>;
  delete(keys: readonly string[]): Promise<void>;
}

export interface PurgeDeps {
  client: pg.Client;
  files: ObjectStore;
  kv: KvStore;
  storeDomain: string;
  /** Called after each saved step; tests stop the run here. */
  onStep?: (step: string) => Promise<void> | void;
}

/** Refuses at once instead of retrying: nothing will change by itself. */
export class JobRefused extends Error {}

const BATCH = 1000;
const EXPORT_DAYS_MS = 7 * 86_400_000;
/** The platform column that points at the store, where it isn't tenant_id. */
const TENANT_COLUMN: Record<string, string> = { sessions: 'active_tenant_id' };

type Counts = Record<string, number>;

interface Progress {
  phase?: string;
  step?: 'tables' | 'files' | 'kv' | 'platform' | 'verify';
  /** The table being deleted; earlier ones are done. */
  table?: string;
  deleted?: { tables: Counts; files: Counts; kv: number; platform: Counts; staffAccounts: number };
}

const count = async (client: pg.Client, query: string, params: unknown[]) =>
  Number((await client.query<{ n: string }>(query, params)).rows[0]?.n ?? 0);

async function storeCounts(client: pg.Client, tenantId: string): Promise<Counts> {
  const counts: Counts = {};
  for (const table of STORE_TABLES) {
    counts[table] = await count(
      client,
      `select count(*) as n from store."${table}" where tenant_id = $1`,
      [tenantId],
    );
  }
  return counts;
}

/** Export files whose link is still live stay until the bucket's 7-day rule takes them. */
async function liveExports(client: pg.Client, tenantId: string): Promise<Set<string>> {
  const { rows } = await client.query<{ file_key: string }>(
    `select file_key from platform.tenant_jobs
      where tenant_id = $1 and kind = 'export' and file_key is not null
        and finished_at > now() - make_interval(secs => $2)`,
    [tenantId, EXPORT_DAYS_MS / 1000],
  );
  return new Set(rows.map((r) => r.file_key));
}

async function objectsUnder(files: ObjectStore, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  for await (const o of files.list(prefix)) keys.push(o.key);
  return keys;
}

/** Store files and uploads; exports are counted apart, as some may be kept. */
async function fileCounts(files: ObjectStore, tenantId: string, keep: Set<string>) {
  const [stored = '', exports = '', uploads = ''] = tenantObjectPrefixes(tenantId);
  const exported = await objectsUnder(files, exports);
  return {
    [stored]: (await objectsUnder(files, stored)).length,
    [uploads]: (await objectsUnder(files, uploads)).length,
    [exports]: exported.filter((k) => !keep.has(k)).length,
  };
}

/** The store's KV keys: its own prefix, and the host index entries for its addresses. */
async function kvKeys(deps: PurgeDeps, tenantId: string): Promise<string[]> {
  const { rows } = await deps.client.query<{ host: string }>(
    `select slug || '.' || $2 as host from platform.tenants where id = $1
     union select hostname from platform.tenant_domains where tenant_id = $1`,
    [tenantId, deps.storeDomain],
  );
  const own = await deps.kv.list(`t:${tenantId.toLowerCase()}:`);
  return [...own, ...rows.map((r) => hostKey(r.host))];
}

/** Staff accounts in no other store and without a platform role: they go with the store. */
async function staffOnlyHere(client: pg.Client, tenantId: string): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `select u.id from platform.users u
      where u.platform_role is null
        and exists (select 1 from platform.memberships m where m.user_id = u.id and m.tenant_id = $1)
        and not exists (select 1 from platform.memberships m where m.user_id = u.id and m.tenant_id <> $1)`,
    [tenantId],
  );
  return rows.map((r) => r.id);
}

async function platformCounts(client: pg.Client, tenantId: string): Promise<Counts> {
  const counts: Counts = {};
  for (const [table, action] of Object.entries(PLATFORM_TENANT_ROWS)) {
    counts[`${table} (${action})`] = await count(
      client,
      `select count(*) as n from platform."${table}" where ${TENANT_COLUMN[table] ?? 'tenant_id'} = $1`,
      [tenantId],
    );
  }
  return counts;
}

/** What the purge would delete and what it keeps, saved for the super admin to read. */
export async function dryRun(deps: PurgeDeps, tenantId: string) {
  const { client } = deps;
  const domains = await client.query<{ released: string; on_widget: string; total: string }>(
    `select count(*) filter (where status <> 'removed') as released, count(*) filter (where turnstile) as on_widget,
            count(*) as total
       from platform.tenant_domains where tenant_id = $1`,
    [tenantId],
  );
  const d = domains.rows[0];
  const keep = await liveExports(client, tenantId);
  return {
    countedAt: new Date().toISOString(),
    storeRows: await storeCounts(client, tenantId),
    files: await fileCounts(deps.files, tenantId, keep),
    exportsKept: keep.size,
    kvKeys: (await kvKeys(deps, tenantId)).length,
    customDomains: {
      total: Number(d?.total ?? 0),
      notReleased: Number(d?.released ?? 0),
      onTurnstile: Number(d?.on_widget ?? 0),
    },
    platformRows: await platformCounts(client, tenantId),
    staffAccounts: (await staffOnlyHere(client, tenantId)).length,
  };
}

async function save(deps: PurgeDeps, jobId: string, progress: Progress, step: string) {
  await deps.client.query('update platform.tenant_jobs set progress = $2 where id = $1', [
    jobId,
    progress,
  ]);
  await deps.onStep?.(step);
}

/**
 * Deletes a store's rows in STORE_TABLES order, 1,000 a statement, from
 * `from` on, calling `onBatch` after each. With `keepSystem`, the built-in
 * brand attribute and its names stay (an open store's reset: the database
 * refuses to delete them while the store is open).
 */
export async function deleteStoreRows(
  client: pg.Client,
  tenantId: string,
  from: string | null,
  onBatch: (table: string, deleted: number) => Promise<void>,
  options: { keepSystem?: boolean } = {},
): Promise<void> {
  const start = from ? Math.max(0, STORE_TABLES.indexOf(from as never)) : 0;
  for (const table of STORE_TABLES.slice(start)) {
    const kept = !options.keepSystem
      ? ''
      : table === 'attributes'
        ? ' and not is_system'
        : table === 'attribute_translations'
          ? ' and attribute_id in (select id from store.attributes where not is_system)'
          : '';
    for (;;) {
      const res = await client.query(
        `delete from store."${table}" where ctid = any(array(
           select ctid from store."${table}" where tenant_id = $1${kept} limit ${BATCH}))`,
        [tenantId],
      );
      const n = res.rowCount ?? 0;
      await onBatch(table, n);
      if (n < BATCH) break;
    }
  }
}

/** The approved purge: deletes, verifies, and returns what it did. */
export async function purgeStore(
  deps: PurgeDeps,
  job: { id: string; tenantId: string; progress: unknown },
): Promise<{ deleted: NonNullable<Progress['deleted']>; verification: object }> {
  const { client, tenantId } = { client: deps.client, tenantId: job.tenantId };
  const { rows: stores } = await client.query<{ status: string }>(
    'select status from platform.tenants where id = $1',
    [tenantId],
  );
  if (stores[0]?.status !== 'closed') {
    throw new JobRefused(`the store is ${stores[0]?.status ?? 'missing'}, not closed`);
  }
  // Custom hostnames and the Turnstile list are the Worker's to release
  // (it holds the zone token); it does so when asked for the purge.
  const domains = await count(
    client,
    `select count(*) as n from platform.tenant_domains
      where tenant_id = $1 and (status <> 'removed' or turnstile)`,
    [tenantId],
  );
  if (domains > 0) throw new Error(`${domains} custom domain(s) not released yet`);

  const saved = (job.progress ?? {}) as Progress;
  const progress: Progress = {
    phase: 'delete',
    step: saved.phase === 'delete' ? (saved.step ?? 'tables') : 'tables',
    ...(saved.phase === 'delete' && saved.table ? { table: saved.table } : {}),
    deleted:
      saved.phase === 'delete' && saved.deleted
        ? saved.deleted
        : { tables: {}, files: {}, kv: 0, platform: {}, staffAccounts: 0 },
  };
  const deleted = progress.deleted as NonNullable<Progress['deleted']>;
  const steps = ['tables', 'files', 'kv', 'platform', 'verify'] as const;
  const from = steps.indexOf(progress.step ?? 'tables');

  if (from <= 0) {
    await deleteStoreRows(client, tenantId, progress.table ?? null, async (table, n) => {
      deleted.tables[table] = (deleted.tables[table] ?? 0) + n;
      await save(deps, job.id, { ...progress, step: 'tables', table }, `table:${table}`);
    });
  }

  if (from <= 1) {
    const keep = await liveExports(client, tenantId);
    for (const prefix of tenantObjectPrefixes(tenantId)) {
      const keys = (await objectsUnder(deps.files, prefix)).filter((k) => !keep.has(k));
      for (let i = 0; i < keys.length; i += 100) {
        const chunk = keys.slice(i, i + 100);
        await deps.files.delete(chunk);
        deleted.files[prefix] = (deleted.files[prefix] ?? 0) + chunk.length;
      }
    }
    await save(deps, job.id, { ...progress, step: 'kv' }, 'files');
  }

  if (from <= 2) {
    const keys = await kvKeys(deps, tenantId);
    await deps.kv.delete(keys);
    deleted.kv += keys.length;
    await save(deps, job.id, { ...progress, step: 'platform' }, 'kv');
  }

  if (from <= 3) {
    await client.query('begin');
    try {
      const staff = await staffOnlyHere(client, tenantId);
      for (const [table, action] of Object.entries(PLATFORM_TENANT_ROWS)) {
        if (action === 'keep') continue;
        const column = TENANT_COLUMN[table] ?? 'tenant_id';
        const res =
          action === 'delete'
            ? await client.query(`delete from platform."${table}" where ${column} = $1`, [tenantId])
            : await client.query(
                `update platform."${table}" set ${column} = null where ${column} = $1`,
                [tenantId],
              );
        deleted.platform[table] = (deleted.platform[table] ?? 0) + (res.rowCount ?? 0);
      }
      // Their sessions, sign-in methods and two-factor secrets go with them.
      if (staff.length) {
        await client.query('delete from platform.users where id = any($1::uuid[])', [staff]);
        deleted.staffAccounts += staff.length;
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    }
    await save(deps, job.id, { ...progress, step: 'verify' }, 'platform');
  }

  const keep = await liveExports(client, tenantId);
  const rows = await storeCounts(client, tenantId);
  const files = await fileCounts(deps.files, tenantId, keep);
  const kv = (await deps.kv.list(`t:${tenantId.toLowerCase()}:`)).length;
  const platform = Object.fromEntries(
    Object.entries(await platformCounts(client, tenantId)).filter(([k]) => !k.endsWith('(keep)')),
  );
  const leftover = [
    ...Object.entries(rows).filter(([, n]) => n > 0),
    ...Object.entries(files).filter(([, n]) => n > 0),
    ...Object.entries(platform).filter(([, n]) => n > 0),
    ...(kv > 0 ? [['kv', kv] as const] : []),
  ];
  const verification = {
    verifiedAt: new Date().toISOString(),
    storeRows: Object.values(rows).reduce((a, b) => a + b, 0),
    files: Object.values(files).reduce((a, b) => a + b, 0),
    kvKeys: kv,
    platformRows: Object.values(platform).reduce((a, b) => a + b, 0),
    exportsKept: keep.size,
  };
  if (leftover.length) {
    throw new Error(
      `verification found leftovers: ${leftover.map(([k, n]) => `${k}=${n}`).join(', ')}`,
    );
  }
  return { deleted, verification };
}
