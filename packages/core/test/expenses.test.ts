// Expenses (phase-8-plan §3.6, §10): acceptance criterion 3 (a monthly
// recurring expense posts once on its day, never twice, when the batch runs
// late or twice; editing and deleting are audited), the seeded categories,
// the month's totals, receipt photos, and who may read and write.
import { permissionsOf, type StoreRole } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  createExpense,
  createExpenseCategory,
  createRecurringExpense,
  createTenant,
  deleteExpense,
  deleteRecurringExpense,
  expenseReceipt,
  listExpenseCategories,
  listExpenses,
  listRecurringExpenses,
  postRecurringExpenses,
  setExpenseReceipt,
  systemActor,
  type TenantTx,
  updateExpense,
  updateExpenseCategory,
  updateRecurringExpense,
  withTenant,
} from '../src';
import { connectApp } from './setup';

let app: pg.Client;
let store: string;
const actorAs = (role: StoreRole): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000e5',
  platformRole: null,
  permissions: permissionsOf(role),
  tenantId: store,
  storeRole: role,
});
let owner: Actor;

beforeAll(async () => {
  app = await connectApp();
  const slug = `exp${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Expense test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  owner = actorAs('owner');
});
afterAll(() => app.end());

const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);
const category = async (key: string) =>
  (await run((tx) => listExpenseCategories(tx, owner))).find((c) => c.key === key)?.id as string;
const posts = (recurringId: string) =>
  run(async (tx) => {
    const { rows } = await tx.db.execute<{ spent_on: string }>(sql`
      select spent_on::text from store.expenses where recurring_expense_id = ${recurringId}
       order by spent_on`);
    return rows.map((r) => r.spent_on);
  });

describe('categories', () => {
  it('seeds the defaults once, and keeps archived ones for old expenses', async () => {
    const first = await run((tx) => listExpenseCategories(tx, owner));
    expect(first.map((c) => c.key)).toEqual([
      'rent',
      'salaries',
      'ads',
      'packaging',
      'delivery',
      'utilities',
      'internet',
      'bank_charges',
      'equipment',
      'other',
    ]);
    expect(first[2]?.name).toEqual({ bn: 'ফেসবুক ও অনলাইন বিজ্ঞাপন', en: 'Facebook and online ads' });
    const custom = await run((tx) =>
      createExpenseCategory(tx, owner, { name: { bn: 'চা-নাস্তা', en: 'Tea and snacks' } }),
    );
    expect(custom.position).toBe(10);
    await run((tx) => updateExpenseCategory(tx, owner, custom.id, { archived: true }));
    const again = await run((tx) => listExpenseCategories(tx, owner));
    expect(again).toHaveLength(11);
    expect(again.find((c) => c.id === custom.id)?.archived).toBe(true);
    await expect(
      run((tx) =>
        createExpense(tx, owner, {
          spentOn: '2026-10-01',
          categoryId: custom.id,
          amount: 100,
          method: 'cash',
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('acceptance criterion 3: recurring expenses post once', () => {
  it('posts on its day, once when the batch runs twice, and the missed days when late', async () => {
    const rent = await category('rent');
    const entry = await run((tx) =>
      createRecurringExpense(
        tx,
        owner,
        {
          categoryId: rent,
          amount: 25_000_00,
          method: 'bank',
          payee: 'Landlord',
          cadence: 'monthly',
          day: 5,
          startsOn: '2026-01-01',
        },
        '2026-08-03',
      ),
    );
    // From the day it was made, never for months before.
    expect(entry.nextOn).toBe('2026-08-05');

    expect(await run((tx) => postRecurringExpenses(tx, '2026-08-04'))).toEqual({ posted: 0 });
    expect(await run((tx) => postRecurringExpenses(tx, '2026-08-05'))).toEqual({ posted: 1 });
    expect(await run((tx) => postRecurringExpenses(tx, '2026-08-05'))).toEqual({ posted: 0 });
    expect(await posts(entry.id)).toEqual(['2026-08-05']);

    // The batch doesn't run until three days after October's: September's and
    // October's both post, once.
    expect(await run((tx) => postRecurringExpenses(tx, '2026-10-08'))).toEqual({ posted: 2 });
    expect(await run((tx) => postRecurringExpenses(tx, '2026-10-08'))).toEqual({ posted: 0 });
    expect(await posts(entry.id)).toEqual(['2026-08-05', '2026-09-05', '2026-10-05']);
    const [listed] = (await run((tx) => listRecurringExpenses(tx, owner))).filter(
      (r) => r.id === entry.id,
    );
    expect(listed?.nextOn).toBe('2026-11-05');
  });

  it('changes only future posts, and stops at its end', async () => {
    const ads = await category('ads');
    const entry = await run((tx) =>
      createRecurringExpense(
        tx,
        owner,
        {
          categoryId: ads,
          amount: 1_000_00,
          method: 'card',
          cadence: 'weekly',
          day: 1,
          startsOn: '2026-10-01',
          endsOn: '2026-10-20',
        },
        '2026-10-01',
      ),
    );
    expect(entry.nextOn).toBe('2026-10-05');
    await run((tx) => postRecurringExpenses(tx, '2026-10-05'));
    const changed = await run((tx) =>
      updateRecurringExpense(tx, owner, entry.id, { amount: 1_500_00 }, '2026-10-05'),
    );
    // Today's post is made; the next is next Monday's.
    expect(changed.nextOn).toBe('2026-10-12');
    await run((tx) => postRecurringExpenses(tx, '2026-10-31'));
    const { rows } = await run((tx) =>
      tx.db.execute<{ spent_on: string; amount: string }>(sql`
        select spent_on::text, amount from store.expenses where recurring_expense_id = ${entry.id}
         order by spent_on`),
    );
    expect(rows.map((r) => [r.spent_on, Number(r.amount)])).toEqual([
      ['2026-10-05', 1_000_00],
      ['2026-10-12', 1_500_00],
      ['2026-10-19', 1_500_00],
    ]);
    // Deleting the entry keeps what it posted, as ordinary expenses.
    await run((tx) => deleteRecurringExpense(tx, owner, entry.id));
    const { rows: kept } = await run((tx) =>
      tx.db.execute<{ n: number }>(sql`
        select count(*)::int as n from store.expenses where spent_on between '2026-10-05' and '2026-10-19'
           and category_id = ${ads}`),
    );
    expect(kept[0]?.n).toBe(3);
  });
});

describe('expenses', () => {
  it('audits edits and deletions with the old values, and totals a month', async () => {
    const packaging = await category('packaging');
    const salaries = await category('salaries');
    const a = await run((tx) =>
      createExpense(tx, owner, {
        spentOn: '2026-07-10',
        categoryId: packaging,
        amount: 2_400_00,
        method: 'bkash',
        payee: 'Box Mart',
      }),
    );
    await run((tx) =>
      createExpense(tx, owner, {
        spentOn: '2026-07-31',
        categoryId: salaries,
        amount: 15_000_00,
        method: 'cash',
      }),
    );
    await run((tx) => updateExpense(tx, owner, a.id, { amount: 2_600_00 }));
    const july = await run((tx) =>
      listExpenses(tx, owner, { from: '2026-07-01', to: '2026-07-31' }),
    );
    expect(july.totals).toEqual({
      total: 17_600_00,
      count: 2,
      byCategory: [
        { categoryId: salaries, amount: 15_000_00 },
        { categoryId: packaging, amount: 2_600_00 },
      ],
    });

    const photo = {
      key: `tenants/${store}/expenses/${a.id}.jpg`,
      mimeType: 'image/jpeg',
      bytes: 1000,
    };
    await run((tx) => setExpenseReceipt(tx, owner, a.id, photo));
    expect(await run((tx) => expenseReceipt(tx, actorAs('viewer'), a.id))).toEqual(photo);
    expect(await run((tx) => deleteExpense(tx, owner, a.id))).toEqual({ receiptKey: photo.key });

    const { rows } = await run((tx) =>
      tx.db.execute<{ action: string; before: { amount: number } | null }>(sql`
        select action, before from store.audit_log where entity_id = ${a.id} order by created_at`),
    );
    expect(rows.map((r) => [r.action, r.before?.amount ?? null])).toEqual([
      ['expense.created', null],
      ['expense.updated', 2_400_00],
      ['expense.deleted', 2_600_00],
    ]);
  });

  it('lets viewers read and only owners and managers write (Q12)', async () => {
    const other = await category('other');
    const input = { spentOn: '2026-10-01', categoryId: other, amount: 100, method: 'cash' };
    await expect(run((tx) => listExpenses(tx, actorAs('staff')))).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect((await run((tx) => listExpenses(tx, actorAs('viewer')))).items.length).toBeGreaterThan(
      0,
    );
    await expect(run((tx) => createExpense(tx, actorAs('viewer'), input))).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect((await run((tx) => createExpense(tx, actorAs('manager'), input))).amount).toBe(100);
  });
});
