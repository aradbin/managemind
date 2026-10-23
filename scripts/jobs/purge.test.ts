// The purge (phase-5b-plan §3.11, acceptance criterion 3): three stores with
// a row in every store table and files in R2; one is closed and purged with
// the dry run and an approval. Its rows, files and KV keys are gone and the
// other two are untouched; its tenant record, billing history, audit and
// purge record stay; a staff member of two stores keeps the other one; and
// a run stopped halfway resumes to the same result.
import {
  type Actor,
  approvePurge,
  closeTenant,
  createTenant,
  requestPurge,
  systemActor,
  withPlatform,
} from '@managemind/core';
import { STORE_TABLES } from '@managemind/db/registry';
import { connect, FIXTURES, inTenant, testUrls } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObjectStore } from './export';
import type { KvStore } from './purge';
import { claimJob, runJobs } from './runner';

const { ownerUrl } = testUrls('managemind_test_scripts');
let client: pg.Client;
beforeAll(async () => {
  client = await connect(ownerUrl);
});
afterAll(() => client.end());

const STORE_DOMAIN = 'stores.example.test';

function memoryFiles(): ObjectStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async *list(prefix: string) {
      for (const [key, body] of objects)
        if (key.startsWith(prefix)) yield { key, size: body.length };
    },
    get: async (key) => objects.get(key) ?? null,
    put: async (key, body) => void objects.set(key, body),
    delete: async (keys) => {
      for (const k of keys) objects.delete(k);
    },
  };
}

function memoryKv(): KvStore & { keys: Set<string> } {
  const keys = new Set<string>();
  return {
    keys,
    list: async (prefix) => [...keys].filter((k) => k.startsWith(prefix)),
    delete: async (list) => {
      for (const k of list) keys.delete(k);
    },
  };
}

let seq = 0;
async function seededStore(files: ReturnType<typeof memoryFiles>, kv: ReturnType<typeof memoryKv>) {
  const slug = `pg${Date.now().toString(36)}${seq++}`;
  const { id } = await createTenant(client, systemActor, {
    slug,
    name: `Purge ${slug}`,
    defaultLocale: 'en',
    kind: 'test',
    owner: { email: `${slug}@example.test`, name: 'Owner' },
  });
  // A row in every store table, as the isolation suite makes them. A table
  // the new store already has a row in (its legal pages) may refuse a duplicate.
  await inTenant(client, id, async () => {
    for (const fixture of Object.values(FIXTURES)) {
      await client.query('savepoint fixture');
      try {
        await client.query(fixture('default'));
      } catch (e) {
        if ((e as { code?: string }).code !== '23505') throw e;
        await client.query('rollback to savepoint fixture');
      }
    }
  });
  files.objects.set(`tenants/${id}/products/a.webp`, new Uint8Array([1]));
  files.objects.set(`tenants/${id}/theme/logo.png`, new Uint8Array([2]));
  files.objects.set(`tmp-uploads/tenants/${id}/upload.csv`, new Uint8Array([3]));
  kv.keys.add(`host:${slug}.${STORE_DOMAIN}`);
  kv.keys.add(`t:${id}:catalog:version`);
  return { id, slug };
}

const counts = async (tenantId: string) => {
  const out: Record<string, number> = {};
  for (const table of STORE_TABLES) {
    const { rows } = await client.query<{ n: string }>(
      `select count(*) as n from store."${table}" where tenant_id = $1`,
      [tenantId],
    );
    out[table] = Number(rows[0]?.n);
  }
  return out;
};
const filesOf = (files: ReturnType<typeof memoryFiles>, id: string) =>
  [...files.objects.keys()].filter((k) => k.includes(id)).sort();

async function superAdmin(): Promise<Actor> {
  const { rows } = await client.query<{ id: string }>(
    `insert into platform.users (name, email, email_verified, platform_role)
     values ('Admin', $1, true, 'super_admin') returning id`,
    [`admin-${Date.now().toString(36)}${seq++}@example.test`],
  );
  return {
    kind: 'user',
    userId: rows[0]?.id ?? null,
    platformRole: 'super_admin',
    permissions: new Set(),
  };
}

describe('purging a closed store (criterion 3)', () => {
  it('deletes only its rows, files and keys, keeps its records, and resumes when stopped', async () => {
    const files = memoryFiles();
    const kv = memoryKv();
    const [a, b, c] = [
      await seededStore(files, kv),
      await seededStore(files, kv),
      await seededStore(files, kv),
    ];
    const admin = await superAdmin();

    // A staff member in A and B, one only in A.
    const { rows: staff } = await client.query<{ id: string; email: string }>(
      `insert into platform.users (name, email, email_verified)
       values ('Both', $1, true), ('Only A', $2, true) returning id, email`,
      [`both-${a.slug}@example.test`, `only-${a.slug}@example.test`],
    );
    const [both, onlyA] = staff as [{ id: string }, { id: string }];
    await client.query(
      `insert into platform.memberships (tenant_id, user_id, role)
       values ($1, $2, 'staff'), ($3, $2, 'staff'), ($1, $4, 'staff')`,
      [a.id, both.id, b.id, onlyA.id],
    );
    // Billing history and usage that stay with the tenant record.
    await client.query(
      `insert into platform.usage_daily (tenant_id, day, metric, value) values ($1, current_date - 1, 'orders', 3)`,
      [a.id],
    );
    // An export whose link is still live stays; an expired one goes.
    const { rows: jobs } = await client.query<{ id: string }>(
      `insert into platform.tenant_jobs (tenant_id, kind, status, file_key, finished_at)
       values ($1::uuid, 'export', 'succeeded', 'exports/tenants/' || $1::text || '/live.zip', now()),
              ($1, 'export', 'succeeded', 'exports/tenants/' || $1::text || '/old.zip', now() - interval '8 days')
       returning id`,
      [a.id],
    );
    expect(jobs).toHaveLength(2);
    files.objects.set(`exports/tenants/${a.id}/live.zip`, new Uint8Array([4]));
    files.objects.set(`exports/tenants/${a.id}/old.zip`, new Uint8Array([5]));

    const before = { b: await counts(b.id), c: await counts(c.id) };
    const beforeFiles = { b: filesOf(files, b.id), c: filesOf(files, c.id) };
    expect(Object.values(await counts(a.id)).every((n) => n > 0)).toBe(true);

    const closed = await closeTenant(client, systemActor, a.id, {
      slug: a.slug,
      reason: 'test over',
    });
    // Its export on the way out isn't this test's concern.
    await client.query(`update platform.tenant_jobs set status = 'failed' where id = $1`, [
      closed.exportJobId,
    ]);
    const { purge, job } = await withPlatform(client, (tx) => requestPurge(tx, admin, a.id));

    let stopAt: string | null = null;
    const deps = {
      client,
      files,
      kv,
      storeDomain: STORE_DOMAIN,
      sink: null,
      log: () => {},
      onStep: (step: string) => {
        if (step === stopAt) throw new Error(`stopped at ${step}`);
      },
    };
    const run = () => runJobs(deps, { jobId: job.id });

    // The dry run, then nothing until it's approved.
    expect((await run()).waiting).toEqual([job.id]);
    expect(await claimJob(client, ['purge'], job.id)).toBeNull();
    const { rows: dry } = await client.query<{ dry_run: Record<string, Record<string, number>> }>(
      'select dry_run from platform.tenant_purges where id = $1',
      [purge.id],
    );
    expect(dry[0]?.dry_run.storeRows?.products).toBeGreaterThan(0);
    expect(dry[0]?.dry_run).toMatchObject({ staffAccounts: 2, exportsKept: 1 });
    await expect(
      withPlatform(client, (tx) =>
        approvePurge(tx, admin, a.id, { purgeId: purge.id, slug: 'nope' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await withPlatform(client, (tx) =>
      approvePurge(tx, admin, a.id, { purgeId: purge.id, slug: a.slug.toUpperCase() }),
    );

    // Stopped halfway through the tables, then run again.
    stopAt = 'table:orders';
    expect((await run()).retried).toEqual([job.id]);
    expect((await counts(a.id)).orders).toBe(0);
    expect((await counts(a.id)).products).toBeGreaterThan(0);
    stopAt = null;
    expect((await run()).succeeded).toEqual([job.id]);

    // Nothing of A's left in the store schema, R2 (but the live export) or KV.
    expect(Object.entries(await counts(a.id)).filter(([, n]) => n > 0)).toEqual([]);
    expect(filesOf(files, a.id)).toEqual([`exports/tenants/${a.id}/live.zip`]);
    expect([...kv.keys].filter((k) => k.includes(a.slug) || k.includes(a.id))).toEqual([]);
    // B and C as they were.
    expect(await counts(b.id)).toEqual(before.b);
    expect(await counts(c.id)).toEqual(before.c);
    expect(filesOf(files, b.id)).toEqual(beforeFiles.b);
    expect(filesOf(files, c.id)).toEqual(beforeFiles.c);
    expect(kv.keys.has(`host:${b.slug}.${STORE_DOMAIN}`)).toBe(true);

    // Kept: the tenant record, purged; usage; jobs; the audit; the purge record.
    const one = async (q: string) => (await client.query(q, [a.id])).rows[0];
    expect(
      await one(
        'select status, purged_at is not null as purged from platform.tenants where id = $1',
      ),
    ).toEqual({
      status: 'purged',
      purged: true,
    });
    expect(
      await one('select count(*)::int as n from platform.usage_daily where tenant_id = $1'),
    ).toEqual({ n: 1 });
    expect(
      await one(
        `select count(*)::int as n from platform.audit_log where tenant_id = $1 and action in ('tenant.close', 'tenant.purge_approved', 'tenant.purged')`,
      ),
    ).toEqual({ n: 3 });
    const record = await one(
      'select verification, deleted, finished_at from platform.tenant_purges where tenant_id = $1',
    );
    expect(record?.verification).toMatchObject({
      storeRows: 0,
      files: 0,
      kvKeys: 0,
      platformRows: 0,
    });
    expect(record?.deleted.tables.orders).toBeGreaterThan(0);
    // Memberships and staff: the one in two stores keeps B; the rest are gone.
    expect(
      await one('select count(*)::int as n from platform.memberships where tenant_id = $1'),
    ).toEqual({ n: 0 });
    const users = await client.query<{ id: string }>(
      'select id from platform.users where id = any($1::uuid[])',
      [[both.id, onlyA.id]],
    );
    expect(users.rows.map((r) => r.id)).toEqual([both.id]);
    const kept = await client.query(
      'select 1 from platform.memberships where user_id = $1 and tenant_id = $2',
      [both.id, b.id],
    );
    expect(kept.rowCount).toBe(1);
  });

  it('refuses an open store, and a client store before its grace period ends', async () => {
    const slug = `pg${Date.now().toString(36)}${seq++}`;
    const { id } = await createTenant(client, systemActor, {
      slug,
      name: 'Client',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    });
    const admin = await superAdmin();
    await expect(withPlatform(client, (tx) => requestPurge(tx, admin, id))).rejects.toMatchObject({
      code: 'illegal_transition',
    });
    await closeTenant(client, systemActor, id, { slug, reason: 'client left' });
    await expect(withPlatform(client, (tx) => requestPurge(tx, admin, id))).rejects.toMatchObject({
      code: 'illegal_transition',
    });
  });
});
