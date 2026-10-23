// The tenant-jobs runner against the test database (phase-5b-plan §3.9,
// §3.10): an export holds only its store's rows and files, in insert order,
// with a manifest; the owners' event goes to the queue; a failure retries,
// then fails; a lost runner's job is claimed again.
import {
  type Actor,
  createProduct,
  createTenant,
  type OutboxEvent,
  queueJob,
  systemActor,
  withTenant,
} from '@managemind/core';
import { connect, testUrls } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import { strFromU8, unzipSync } from 'fflate';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ObjectStore, OMITTED } from './export';
import { claimJob, runJobs } from './runner';

const { ownerUrl } = testUrls('managemind_test_scripts');
let client: pg.Client;
beforeAll(async () => {
  client = await connect(ownerUrl);
});
afterAll(() => client.end());

const noKv = { list: async () => [], delete: async () => {} };
const base = {
  get client() {
    return client;
  },
  kv: noKv,
  storeDomain: 'stores.example.test',
  log: () => {},
};

function memoryStore(): ObjectStore & { objects: Map<string, Uint8Array>; failPut: boolean } {
  const objects = new Map<string, Uint8Array>();
  const store = {
    objects,
    failPut: false,
    async *list(prefix: string) {
      for (const [key, body] of objects) {
        if (key.startsWith(prefix)) yield { key, size: body.byteLength };
      }
    },
    get: async (key: string) => objects.get(key) ?? null,
    put: async (key: string, body: Uint8Array) => {
      if (store.failPut) throw new Error('R2 said no');
      objects.set(key, body);
    },
    delete: async (keys: readonly string[]) => {
      for (const k of keys) objects.delete(k);
    },
  };
  return store;
}

let seq = 0;
async function store(name: string) {
  const slug = `jb${Date.now().toString(36)}${seq++}`;
  const { id } = await createTenant(client, systemActor, {
    slug,
    name,
    defaultLocale: 'en',
    owner: { email: `${slug}@example.test`, name: 'Owner' },
  });
  const owner: Actor = {
    kind: 'user',
    userId: null,
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId: id,
    storeRole: 'owner',
  };
  await withTenant(client, id, (tx) =>
    createProduct(tx, owner, {
      status: 'active',
      translations: { en: { title: `${name} saree` } },
      variant: { price: 150_000 },
    }),
  );
  return { id, slug };
}

const queue = (tenantId: string) =>
  withTenant(client, tenantId, (tx) => queueJob(tx, tenantId, 'export', null)).then((r) => r.job);

const jobRow = async (id: string) =>
  (
    await client.query<{
      status: string;
      attempts: number;
      error: string | null;
      file_key: string;
    }>('select status, attempts, error, file_key from platform.tenant_jobs where id = $1', [id])
  ).rows[0];

describe('the export job', () => {
  it("zips only the store's rows and files, and tells the Worker it's ready", async () => {
    const a = await store('Alpha');
    const b = await store('Beta');
    const files = memoryStore();
    files.objects.set(`tenants/${a.id}/media/logo.png`, new Uint8Array([1, 2, 3]));
    files.objects.set(`tenants/${b.id}/media/other.png`, new Uint8Array([9]));
    const job = await queue(a.id);
    const sent: OutboxEvent[] = [];
    const summary = await runJobs(
      { ...base, files, sink: { send: async (e) => void sent.push(...e) } },
      { jobId: job.id },
    );
    expect(summary.succeeded).toEqual([job.id]);
    const row = await jobRow(job.id);
    expect(row).toMatchObject({
      status: 'succeeded',
      file_key: `exports/tenants/${a.id}/${job.id}.zip`,
    });
    expect(sent.map((e) => e.eventType)).toEqual(['tenant.exported']);
    expect(sent[0]?.payload).toMatchObject({ jobId: job.id });

    const zip = unzipSync(files.objects.get(row?.file_key ?? '') as Uint8Array);
    const manifest = JSON.parse(strFromU8(zip['manifest.json'] as Uint8Array));
    expect(manifest).toMatchObject({
      format: 'managemind-store-export',
      store: { id: a.id, slug: a.slug, name: 'Alpha' },
      tables: { products: 1 },
      platform: { tenant: 1, members: 1 },
    });
    expect(manifest.schema).toMatch(/^\d{4}_/);
    // Insert order: a product before its variants, the reverse of the purge.
    expect(manifest.tableOrder.indexOf('products')).toBeLessThan(
      manifest.tableOrder.indexOf('variants'),
    );
    const products = strFromU8(zip['tables/products.jsonl'] as Uint8Array)
      .trim()
      .split('\n');
    expect(products.map((l) => JSON.parse(l).tenant_id)).toEqual([a.id]);
    const csv = zip['csv/products.csv'] as Uint8Array;
    // A byte order mark for spreadsheet apps, a header, and the one product.
    expect([...csv.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(strFromU8(csv).trim().split('\r\n')).toHaveLength(2);
    expect(Object.keys(zip).filter((k) => k.startsWith('files/'))).toEqual([
      'files/media/logo.png',
    ]);
    for (const omitted of Object.keys(OMITTED)) {
      expect(zip[`tables/${omitted}.jsonl`], omitted).toBeUndefined();
    }
    expect(manifest.files['files/media/logo.png']).toMatchObject({ bytes: 3 });
    // No staff sign-in data in the members list.
    const members = strFromU8(zip['platform/members.jsonl'] as Uint8Array);
    expect(Object.keys(JSON.parse(members.trim()))).toEqual(['name', 'email', 'role', 'createdAt']);
  });

  it('retries a failed run, and fails it on the third attempt', async () => {
    const s = await store('Gamma');
    const files = memoryStore();
    files.failPut = true;
    const job = await queue(s.id);
    const run = () => runJobs({ ...base, files, sink: null }, { jobId: job.id });
    expect((await run()).retried).toEqual([job.id]);
    expect(await jobRow(job.id)).toMatchObject({
      status: 'pending',
      attempts: 1,
      error: 'R2 said no',
    });
    await run();
    expect((await run()).failed).toEqual([job.id]);
    expect(await jobRow(job.id)).toMatchObject({ status: 'failed', attempts: 3 });
    // The store can ask again: a failed job isn't open.
    expect((await queue(s.id)).id).not.toBe(job.id);
  });

  it("claims a job again when its runner was lost, but not one that's running", async () => {
    const s = await store('Delta');
    const job = await queue(s.id);
    expect((await claimJob(client, ['export'], job.id))?.id).toBe(job.id);
    expect(await claimJob(client, ['export'], job.id)).toBeNull();
    // updated_at follows every update, so the trigger is off while it's set back.
    await client.query(
      'alter table platform.tenant_jobs disable trigger tenant_jobs_set_updated_at',
    );
    try {
      await client.query(
        `update platform.tenant_jobs set updated_at = now() - interval '2 hours' where id = $1`,
        [job.id],
      );
    } finally {
      await client.query(
        'alter table platform.tenant_jobs enable trigger tenant_jobs_set_updated_at',
      );
    }
    expect(await claimJob(client, ['export'], job.id)).toMatchObject({ id: job.id, attempts: 2 });
  });
});
