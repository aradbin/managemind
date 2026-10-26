// The back office's imports (phase-8-plan §3.10): suppliers with opening
// balances, a name already in the store skipped with its balance untouched;
// past expenses, one already recorded skipped; and who may import what.

import { permissionsOf, type StoreRole } from '@managemind/shared';
import {
  BACK_OFFICE_IMPORT_LIMITS,
  type ImportCategory,
  mapExpenseHeaders,
  mapSupplierHeaders,
  parseExpenseRow,
  parseSupplierRow,
} from '@managemind/shared/back-office';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  createSupplier,
  createTenant,
  importExpenses,
  importSuppliers,
  listExpenseCategories,
  listExpenses,
  supplierDues,
  systemActor,
  type TenantTx,
  withTenant,
} from '../src';
import { connectApp } from './setup';

let app: pg.Client;
let store: string;
const actorAs = (role: StoreRole): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000f8',
  platformRole: null,
  permissions: permissionsOf(role),
  tenantId: store,
  storeRole: role,
});
let owner: Actor;
const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);

beforeAll(async () => {
  app = await connectApp();
  const slug = `imp${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Import test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  owner = actorAs('owner');
});
afterAll(() => app.end());

describe('supplier import', () => {
  it('creates the suppliers with their balances and skips a name already there', async () => {
    await run((tx) =>
      createSupplier(tx, owner, { name: 'Islampur Wholesale', openingBalance: 100_00 }),
    );
    const sheet = [
      ['Supplier', 'Phone', 'Opening balance'],
      ['islampur wholesale', '01711000001', '9,000'],
      ['Chawkbazar Traders', '01811000002', '2,500.50'],
      ['Tangail Weavers', '', '-300'],
    ];
    const columns = mapSupplierHeaders(sheet[0] as string[]);
    const rows = sheet
      .slice(1)
      .map((cells, i) => parseSupplierRow(cells, columns, i + 2).supplier)
      .filter((s) => s !== null);
    expect(rows).toHaveLength(3);
    const result = await run((tx) => importSuppliers(tx, owner, rows));
    expect(result).toEqual({ created: 2, skipped: [{ row: 2, reason: 'exists' }] });
    const dues = await run((tx) => supplierDues(tx, owner));
    expect(Object.fromEntries(dues.map((d) => [d.name, d.balance]))).toEqual({
      'Islampur Wholesale': 100_00,
      'Chawkbazar Traders': 2_500_50,
      // An advance: the store paid before receiving.
      'Tangail Weavers': -300_00,
    });
    // Sent again (a retry without its key), nothing new is made.
    expect((await run((tx) => importSuppliers(tx, owner, rows))).created).toBe(0);
    const { rows: audit } = await run((tx) =>
      tx.db.execute<{ after: { count: number } }>(
        sql`select after from store.audit_log where action = 'suppliers.imported'`,
      ),
    );
    expect(audit.map((a) => a.after.count)).toEqual([2]);
  });

  it('needs purchasing.write, and purchasing.pay for balances', async () => {
    const row = { row: 2, name: 'Staff Supplier', openingBalance: 0 };
    await expect(run((tx) => importSuppliers(tx, actorAs('staff'), [row]))).rejects.toMatchObject({
      code: 'forbidden',
    });
    const writer = {
      ...owner,
      permissions: new Set(['purchasing.write', 'purchasing.read']),
    } as Actor;
    expect((await run((tx) => importSuppliers(tx, writer, [row]))).created).toBe(1);
    await expect(
      run((tx) =>
        importSuppliers(tx, writer, [{ row: 3, name: 'With balance', openingBalance: 5_00 }]),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run((tx) =>
        importSuppliers(
          tx,
          owner,
          Array.from({ length: BACK_OFFICE_IMPORT_LIMITS.chunk + 1 }, (_, i) => ({
            row: i + 2,
            name: `S${i}`,
          })),
        ),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('expense import', () => {
  it('records past months, files what doesn’t match under Other, and skips what is already there', async () => {
    const categories = (await run((tx) => listExpenseCategories(tx, owner))) as ImportCategory[];
    const sheet = [
      ['Date', 'Category', 'Amount', 'Paid by', 'Paid to'],
      ['05/06/2026', 'Rent', '15,000', 'Bank', 'Landlord'],
      ['2026-06-20', 'ফেসবুক ও অনলাইন বিজ্ঞাপন', '2500', 'card', 'Meta'],
      ['2026-07-01', 'Tea for staff', '300', '', ''],
      ['2026-07-02', 'Rent', 'none', 'cash', ''],
    ];
    const columns = mapExpenseHeaders(sheet[0] as string[]);
    const parsed = sheet
      .slice(1)
      .map((cells, i) => parseExpenseRow(cells, columns, i + 2, categories, '2026-10-26'));
    expect(parsed.map((p) => p.errors.length)).toEqual([0, 0, 0, 1]);
    expect(parsed[2]?.warnings.map((w) => w.field)).toEqual(['category', 'method']);
    const rows = parsed.map((p) => p.expense).filter((e) => e !== null);
    expect(await run((tx) => importExpenses(tx, owner, rows))).toEqual({ created: 3, skipped: [] });
    expect(await run((tx) => importExpenses(tx, owner, rows))).toEqual({
      created: 0,
      skipped: [
        { row: 2, reason: 'exists' },
        { row: 3, reason: 'exists' },
        { row: 4, reason: 'exists' },
      ],
    });
    const june = await run((tx) =>
      listExpenses(tx, owner, { from: '2026-06-01', to: '2026-07-31' }),
    );
    expect(june.totals.total).toBe(15_000_00 + 2_500_00 + 300_00);
    const other = categories.find((c) => c.key === 'other')?.id;
    expect(june.items.find((e) => e.amount === 300_00)).toMatchObject({
      categoryId: other,
      method: 'cash',
    });
  });

  it('refuses a future date, another store’s category, and a viewer', async () => {
    const categories = await run((tx) => listExpenseCategories(tx, owner));
    const rent = categories.find((c) => c.key === 'rent')?.id as string;
    const row = { row: 2, spentOn: '2026-09-01', categoryId: rent, amount: 100, method: 'cash' };
    await expect(
      run((tx) => importExpenses(tx, owner, [{ ...row, spentOn: '2099-01-01' }])),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      run((tx) =>
        importExpenses(tx, owner, [{ ...row, categoryId: '0199d000-0000-7000-8000-00000000dead' }]),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(run((tx) => importExpenses(tx, actorAs('viewer'), [row]))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
