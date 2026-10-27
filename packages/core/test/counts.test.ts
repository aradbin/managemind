// Stock counts and adjustments (phase-8-plan §3.4, §3.5, §10): acceptance
// criterion 2 (a count applies only the real differences while sales go on:
// none is undone or counted twice), blind counting, the approval threshold,
// a count over 500 lines applied in batches as the queue does, a stopped
// apply sent back to review, and the adjustments list with its values.
import { permissionsOf, type StoreRole } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  adjust,
  applyStockCount,
  applyStockCountBatch,
  cancelStockCount,
  createProduct,
  createStockCount,
  createTenant,
  failStockCountApply,
  getStockCount,
  inventoryDrift,
  listAdjustments,
  receive,
  reopenStockCount,
  sell,
  setCountLine,
  submitStockCount,
  systemActor,
  type TenantTx,
  withTenant,
} from '../src';
import { connectApp } from './setup';

let app: pg.Client;
let store: string;
const actorAs = (role: StoreRole): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000ff',
  platformRole: null,
  permissions: permissionsOf(role),
  tenantId: store,
  storeRole: role,
});
let owner: Actor;
let staff: Actor;

beforeAll(async () => {
  app = await connectApp();
  const slug = `cnt${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Count test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  owner = actorAs('owner');
  staff = actorAs('staff');
});
afterAll(() => app.end());

const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);
let seq = 0;
async function variant(stock: number, cost = 100_00) {
  const p = await run((tx) =>
    createProduct(tx, owner, {
      status: 'active',
      translations: { en: { title: `Counted ${++seq}` } },
      variant: { price: 500_00, costPrice: cost, sku: `CNT-${seq}-${Date.now()}` },
    }),
  );
  const id = p.variants[0]?.id as string;
  if (stock)
    await run((tx) => receive(tx, owner, { variantId: id, quantity: stock, reason: 'received' }));
  return id;
}
const onHand = (variantId: string) =>
  run(async (tx) => {
    const { rows } = await tx.db.execute<{ n: number }>(
      sql`select coalesce(sum(on_hand), 0)::int as n from store.inventory_levels where variant_id = ${variantId}`,
    );
    return rows[0]?.n;
  });
const start = (variantIds: string[]) =>
  run((tx) => createStockCount(tx, owner, { scope: { kind: 'variants', variantIds } }));
const count = (id: string, variantId: string, counted: number, as = staff) =>
  run((tx) => setCountLine(tx, as, id, variantId, { counted }));

describe('acceptance criterion 2: counting while selling', () => {
  it('applies only the real differences; sales during the count are kept', async () => {
    const a = await variant(10);
    const b = await variant(5);
    const c = await variant(8);
    const sc = await start([a, b, c]);
    expect(sc).toMatchObject({
      status: 'counting',
      lineCount: 3,
      reference: expect.stringMatching(/^SC-/),
    });

    // b sells one before it is counted, a sells two after it was counted.
    await run((tx) => sell(tx, owner, { variantId: b, quantity: 1, reason: 'order' }));
    await count(sc.id, a, 9); // one is missing
    await run((tx) => sell(tx, owner, { variantId: a, quantity: 2, reason: 'order' }));
    await count(sc.id, b, 4); // right: 5 − 1 sold
    await count(sc.id, c, 10); // two more than the system knew

    // Blind while counting: nobody sees what's expected.
    const counting = await run((tx) => getStockCount(tx, owner, sc.id));
    expect(counting.lines.every((l) => !('expected' in l))).toBe(true);

    await run((tx) => submitStockCount(tx, staff, sc.id));
    const review = await run((tx) => getStockCount(tx, owner, sc.id));
    const line = (v: string) => review.lines.find((l) => l.variantId === v);
    expect(line(a)).toMatchObject({ counted: 9, expected: 10, difference: -1 });
    expect(line(b)).toMatchObject({ counted: 4, expected: 4, difference: 0 });
    expect(line(c)).toMatchObject({ counted: 10, expected: 8, difference: 2, value: 200_00 });
    // Largest value first.
    expect(review.lines[0]?.variantId).toBe(c);
    expect(review.differences).toEqual({ lines: 2, units: 1, value: 100_00 });

    const { count: applied, queued } = await run((tx) => applyStockCount(tx, staff, sc.id));
    expect(queued).toBe(false);
    expect(applied.status).toBe('applied');
    // a: 10 − 2 sold − 1 missing; b untouched; c: 8 + 2.
    expect([await onHand(a), await onHand(b), await onHand(c)]).toEqual([7, 4, 10]);
    expect(await run((tx) => inventoryDrift(tx))).toEqual([]);

    // Every adjustment has its reason, user and value; the list totals them.
    const list = await run((tx) => listAdjustments(tx, owner, { reason: 'count' }));
    const mine = list.items.filter((i) => i.referenceId === sc.id);
    expect(mine.map((i) => [i.variantId, i.quantity, i.value]).sort()).toEqual(
      [
        [a, -1, -100_00],
        [c, 2, 200_00],
      ].sort(),
    );
    expect(mine.every((i) => i.reason === 'count' && i.actorId === staff.userId)).toBe(true);
    expect(list.totals).toMatchObject({ units: 1, value: 100_00, unvalued: 0 });
  });

  it('does the same over the plan’s 50 variants, with sales before and after counting', async () => {
    // Five kinds of line, ten of each, every variant starting with 10 at its own cost:
    // sold before it is counted (counted right); sold after (counted right);
    // one missing, then sold; two found after a sale; counted untouched.
    const kinds = [
      { before: 1, counted: 9, after: 0, difference: 0 },
      { before: 0, counted: 10, after: 2, difference: 0 },
      { before: 0, counted: 9, after: 1, difference: -1 },
      { before: 1, counted: 11, after: 0, difference: 2 },
      { before: 0, counted: 10, after: 0, difference: 0 },
    ];
    const lines = [];
    for (let i = 0; i < 50; i++) {
      const cost = (i + 1) * 10_00;
      lines.push({ id: await variant(10, cost), cost, ...(kinds[i % 5] as (typeof kinds)[0]) });
    }
    const sc = await start(lines.map((l) => l.id));
    expect(sc.lineCount).toBe(50);

    for (const l of lines) {
      if (l.before)
        await run((tx) =>
          sell(tx, owner, { variantId: l.id, quantity: l.before, reason: 'order' }),
        );
      await count(sc.id, l.id, l.counted);
      if (l.after)
        await run((tx) => sell(tx, owner, { variantId: l.id, quantity: l.after, reason: 'order' }));
    }
    await run((tx) => submitStockCount(tx, staff, sc.id));
    const review = await run((tx) => getStockCount(tx, owner, sc.id));
    for (const l of lines) {
      expect(review.lines.find((x) => x.variantId === l.id)).toMatchObject({
        counted: l.counted,
        difference: l.difference,
      });
    }
    const changed = lines.filter((l) => l.difference);
    const value = changed.reduce((a, l) => a + l.difference * l.cost, 0);
    expect(review.differences).toEqual({
      lines: 20,
      units: changed.reduce((a, l) => a + l.difference, 0),
      value,
    });

    // Above the approval threshold, so the owner applies it.
    expect((await run((tx) => applyStockCount(tx, owner, sc.id))).count.status).toBe('applied');
    for (const l of lines) {
      expect(await onHand(l.id)).toBe(10 - l.before - l.after + l.difference);
    }
    expect(await run((tx) => inventoryDrift(tx))).toEqual([]);

    const list = await run((tx) => listAdjustments(tx, owner, { reason: 'count', limit: 200 }));
    const mine = list.items.filter((i) => i.referenceId === sc.id);
    expect(mine).toHaveLength(20);
    expect(mine.every((i) => i.reason === 'count' && i.actorId === owner.userId)).toBe(true);
    expect(mine.reduce((a, i) => a + (i.value ?? 0), 0)).toBe(value);
  });

  it('lets a line be recounted in review, and reopened for counting', async () => {
    const a = await variant(3);
    const sc = await start([a]);
    await count(sc.id, a, 1);
    await run((tx) => submitStockCount(tx, staff, sc.id));
    await count(sc.id, a, 3);
    expect((await run((tx) => getStockCount(tx, owner, sc.id))).lines[0]).toMatchObject({
      difference: 0,
    });
    expect((await run((tx) => reopenStockCount(tx, staff, sc.id))).status).toBe('counting');
    expect((await run((tx) => cancelStockCount(tx, staff, sc.id))).status).toBe('cancelled');
    await expect(count(sc.id, a, 2)).rejects.toMatchObject({ code: 'illegal_transition' });
    await expect(run((tx) => applyStockCount(tx, owner, sc.id))).rejects.toMatchObject({
      code: 'illegal_transition',
    });
  });
});

describe('approval (Q7)', () => {
  it('needs an owner or manager above the store’s threshold', async () => {
    // Six missing at ৳1,000: ৳6,000, above the ৳5,000 default.
    const a = await variant(10, 1_000_00);
    const sc = await start([a]);
    await count(sc.id, a, 4);
    const review = await run((tx) => submitStockCount(tx, staff, sc.id));
    expect(review).not.toHaveProperty('approvalThreshold');
    expect(review.lines[0]).not.toHaveProperty('value');
    await expect(run((tx) => applyStockCount(tx, staff, sc.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect((await run((tx) => applyStockCount(tx, owner, sc.id))).count.status).toBe('applied');
    expect(await onHand(a)).toBe(4);
  });
});

describe('a large count (§7)', () => {
  it('applies over 500 lines in batches, and a stopped apply goes back to review', async () => {
    const a = await variant(0);
    // 501 variants of one product, straight into the table: only the count is under test.
    const ids = await run(async (tx) => {
      const { rows } = await tx.db.execute<{ id: string }>(sql`
        insert into store.variants (product_id, options_key, price, cost_price)
        select v.product_id, gen_random_uuid()::text, 100, 10
          from store.variants v, generate_series(1, 501)
         where v.id = ${a}
        returning id`);
      return rows.map((r) => r.id);
    });
    const sc = await start(ids);
    expect(sc.lineCount).toBe(501);
    await run((tx) =>
      tx.db.execute(sql`
        update store.stock_count_lines set counted = 2, counted_at = now(), counted_by = ${owner.userId}
         where stock_count_id = ${sc.id}`),
    );
    await run((tx) => submitStockCount(tx, owner, sc.id));
    const started = await run((tx) => applyStockCount(tx, owner, sc.id));
    expect(started).toMatchObject({ queued: true, count: { status: 'applying' } });

    // The first message applies 500 lines, then the queue gives up on the next.
    expect(await run((tx) => applyStockCountBatch(tx, systemActor, sc.id))).toEqual({
      done: false,
      applied: 500,
    });
    await run((tx) => failStockCountApply(tx, sc.id, 'database restarted'));
    const stopped = await run((tx) => getStockCount(tx, owner, sc.id));
    expect(stopped).toMatchObject({ status: 'review', applyError: 'database restarted' });
    expect(stopped.lines.filter((l) => l.applied).length).toBe(500);

    // Applying again finishes the last line, and never writes the first 500 twice.
    const again = await run((tx) => applyStockCount(tx, owner, sc.id));
    expect(again).toMatchObject({ queued: false, count: { status: 'applied', applyError: null } });
    const { rows } = await run((tx) =>
      tx.db.execute<{ n: number; units: number }>(sql`
        select count(*)::int as n, sum(quantity)::int as units from store.stock_movements
         where reference_type = 'stock_count' and reference_id = ${sc.id}`),
    );
    expect(rows[0]).toEqual({ n: 501, units: 1002 });
    expect(await run((tx) => inventoryDrift(tx))).toEqual([]);
  });
});

describe('the adjustments list (§3.4)', () => {
  it('values each adjustment at the cost then, and hides values without catalog.cost', async () => {
    const a = await variant(10, 30_00);
    await run((tx) => adjust(tx, staff, { variantId: a, quantity: -2, reason: 'expired' }));
    const list = await run((tx) => listAdjustments(tx, owner, { reason: 'expired' }));
    expect(list.items[0]).toMatchObject({
      variantId: a,
      quantity: -2,
      unitCost: 30_00,
      value: -60_00,
    });
    const seen = await run((tx) => listAdjustments(tx, staff, { reason: 'expired' }));
    expect(seen.items[0]).not.toHaveProperty('value');
    expect(seen.totals).not.toHaveProperty('value');
  });
});
