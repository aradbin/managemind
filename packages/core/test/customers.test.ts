// Customers (phase-4-plan §3.10, §10): one per phone, found or created by
// checkout and manual orders, edited by staff, and imported in batched chunks.
import { permissionsOf, type StoreRole } from '@managemind/shared';
import { mapCustomerHeaders, parseCustomerRow } from '@managemind/shared/orders/customer-import';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  addAddress,
  createCustomer,
  createImportJob,
  createTenant,
  deleteCustomer,
  findOrCreateCustomer,
  getCustomer,
  getImportJob,
  listCustomers,
  processImportChunk,
  startImport,
  systemActor,
  type TenantTx,
  updateCustomer,
  withTenant,
} from '../src';
import { connectApp } from './setup';

let app: pg.Client;
let app2: pg.Client;
let store: string;
const actorAs = (role: StoreRole): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000ee',
  platformRole: null,
  permissions: permissionsOf(role),
  tenantId: store,
  storeRole: role,
});

beforeAll(async () => {
  [app, app2] = await Promise.all([connectApp(), connectApp()]);
  const slug = `cust${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Customers test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
});
afterAll(() => Promise.all([app.end(), app2.end()]));
const run = <T>(fn: (tx: TenantTx) => Promise<T>, client = app) => withTenant(client, store, fn);

describe('customers', () => {
  it('are found or created by phone, also by two first orders at once', async () => {
    const phone = '+8801711000001';
    const [a, b] = await Promise.all([
      run((tx) => findOrCreateCustomer(tx, { phone, name: 'First' }), app),
      run(
        (tx) => findOrCreateCustomer(tx, { phone, name: 'Second', email: 'x@example.test' }),
        app2,
      ),
    ]);
    expect(a.id).toBe(b.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    // The second order filled the missing email, and the name stayed the first one's.
    const c = await run((tx) => getCustomer(tx, actorAs('owner'), a.id));
    expect(c.email).toBe('x@example.test');
  });

  it('are edited by staff, refusing a phone another customer has', async () => {
    const owner = actorAs('owner');
    const c = await run((tx) =>
      createCustomer(tx, owner, { phone: '01711-000002', name: 'Karim', tags: ['VIP'] }),
    );
    expect(c).toMatchObject({ phone: '+8801711000002', tags: ['vip'] });
    await expect(
      run((tx) => createCustomer(tx, owner, { phone: '01711000002', name: 'Dup' })),
    ).rejects.toMatchObject({ code: 'conflict' });
    const updated = await run((tx) =>
      updateCustomer(tx, owner, c.id, { name: 'Karim Mia', note: 'wholesale buyer' }),
    );
    expect(updated).toMatchObject({ name: 'Karim Mia', note: 'wholesale buyer' });
    const address = await run((tx) =>
      addAddress(tx, owner, c.id, {
        name: 'Karim',
        phone: '01711000002',
        divisionId: 6,
        districtId: 47,
        areaId: 513,
        line: 'Road 1',
      }),
    );
    expect(address.isDefault).toBe(true);
    expect(
      (await run((tx) => listCustomers(tx, owner, { q: 'karim' }))).items.map((x) => x.id),
    ).toContain(c.id);
    expect(
      (await run((tx) => listCustomers(tx, owner, { q: '01711000002' }))).items.map((x) => x.id),
    ).toEqual([c.id]);
    expect(
      (await run((tx) => listCustomers(tx, owner, { tag: 'vip' }))).items.map((x) => x.id),
    ).toEqual([c.id]);
    await run((tx) => deleteCustomer(tx, owner, c.id));
    expect((await run((tx) => listCustomers(tx, owner, { q: 'karim' }))).items).toEqual([]);
  });

  it('are hidden from viewers', async () => {
    await expect(run((tx) => listCustomers(tx, actorAs('viewer')))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('the customer import', () => {
  it('creates and updates customers by phone in batched chunks, with addresses', async () => {
    const owner = actorAs('owner');
    await run((tx) =>
      createCustomer(tx, owner, {
        phone: '+8801711000100',
        name: 'Old Name',
        email: 'old@example.test',
        tags: ['old'],
      }),
    );
    const cols = mapCustomerHeaders([
      'Name',
      'Phone',
      'Email',
      'Address',
      'Thana',
      'District',
      'Tags',
    ]);
    const sheet = [
      ['Old Name Updated', '01711000100', '', 'House 9', 'Dhanmondi', 'Dhaka', 'vip'],
      ['New One', '01711000101', 'new@example.test', 'Road 4', 'Kotwali', 'Chattogram', ''],
      ['Twice', '01711000101', '', '', '', '', ''],
      ['Bad', '12345', '', '', '', '', ''],
    ];
    const parsed = sheet.map((cells, i) => parseCustomerRow(cells, cols, i + 2));
    const rows = parsed.map((p) => p.customer).filter(Boolean);
    expect(parsed[3]?.errors[0]?.field).toBe('phone');
    const job = await run((tx) =>
      createImportJob(tx, owner, {
        kind: 'customers',
        fileName: 'customers.csv',
        chunkCount: 1,
        total: rows.length,
      }),
    );
    await run((tx) => startImport(tx, owner, job.id));
    expect(
      await processImportChunk(app, { tenantId: store, jobId: job.id, chunk: 0 }, rows),
    ).toBeNull();
    const done = await run((tx) => getImportJob(tx, owner, job.id));
    expect(done).toMatchObject({
      kind: 'customers',
      status: 'done',
      created: 1,
      updated: 1,
      failed: 1,
    });
    const found = await run(
      async (tx) =>
        (
          await tx.db.execute(sql`
          select c.phone, c.name, c.email, c.tags,
                 (select count(*)::int from store.customer_addresses a where a.customer_id = c.id) as addresses
            from store.customers c where c.phone in ('+8801711000100', '+8801711000101') order by c.phone`)
        ).rows,
    );
    expect(found).toEqual([
      {
        phone: '+8801711000100',
        name: 'Old Name Updated',
        email: 'old@example.test',
        tags: expect.arrayContaining(['old', 'vip']),
        addresses: 1,
      },
      // The later row with the same phone won; its address was empty.
      { phone: '+8801711000101', name: 'Twice', email: null, tags: [], addresses: 0 },
    ]);
  });

  it('needs customers.write', async () => {
    await expect(
      run((tx) =>
        createImportJob(tx, actorAs('viewer'), {
          kind: 'customers',
          fileName: 'c.csv',
          chunkCount: 1,
          total: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
