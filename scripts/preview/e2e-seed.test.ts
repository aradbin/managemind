import { connect, testUrls } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanOldE2E, e2eNames, seedE2E } from './e2e-seed';

// The preview database step runs as the owner role, as here.
const { ownerUrl } = testUrls('managemind_test_scripts');
let client: pg.Client;
beforeAll(async () => {
  client = await connect(ownerUrl);
});
afterAll(() => client.end());

const run = () => `r${Date.now().toString(36).slice(-8)}`;

async function storeOf(slug: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'select id from platform.tenants where slug = $1',
    [slug],
  );
  return rows[0]?.id as string;
}

async function count(table: string, tenantId: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `select count(*)::int as n from store.${table} where tenant_id = $1`,
    [tenantId],
  );
  return rows[0]?.n ?? 0;
}

describe('cleanOldE2E', () => {
  it('deletes the store data of runs older than a day and keeps the rest', async () => {
    const [old, fresh] = [run(), `${run()}x`];
    await seedE2E(client, old, 'stores.example.test');
    await seedE2E(client, fresh, 'stores.example.test');
    const oldStore = await storeOf(e2eNames(old, 'phone').slug);
    const freshStore = await storeOf(e2eNames(fresh, 'phone').slug);
    for (const id of [oldStore, freshStore]) {
      await client.query(
        "insert into store.attributes (tenant_id, key, type) values ($1, 'fabric', 'choice')",
        [id],
      );
    }
    await client.query(
      `update platform.tenants set created_at = now() - interval '2 days'
       where slug like $1`,
      [`e2e-${old}-%`],
    );

    expect(await cleanOldE2E(client)).toBeGreaterThanOrEqual(2);

    // The old store keeps only its brand; the stores and people stay.
    const left = await client.query<{ key: string }>(
      'select key from store.attributes where tenant_id = $1',
      [oldStore],
    );
    expect(left.rows.map((r) => r.key)).toEqual(['brand']);
    expect(await count('stock_locations', oldStore)).toBe(0);
    expect(await storeOf(e2eNames(old, 'phone').slug)).toBe(oldStore);
    // The recent run is untouched.
    expect(await count('attributes', freshStore)).toBe(2);
    expect(await count('stock_locations', freshStore)).toBe(1);
  });
});
