// Inventory (phase-2-plan §3.8, §8): the ledger, the rules, and the invariant
// "on hand and reserved equal the sums of their movements", checked by a
// property test over thousands of random operations, some concurrent.
import { permissionsOf, type StoreRole } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  type ApplyResult,
  adjustInventory,
  createProduct,
  createTenant,
  inventoryDrift,
  listInventory,
  listMovements,
  receive,
  release,
  reserve,
  returnStock,
  sell,
  setOnHand,
  systemActor,
  type TenantTx,
  updateVariant,
  withTenant,
} from '../src';
import { connectApp, connectOwner } from './setup';

let app: pg.Client;
let app2: pg.Client;
let store: string;
let location2: string;
beforeAll(async () => {
  [app, app2] = await Promise.all([connectApp(), connectApp()]);
  const slug = `inv${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Inventory test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  location2 = await run(async (tx) => {
    const { rows } = await tx.db.execute<{ id: string }>(
      sql`insert into store.stock_locations (name) values ('Shop') returning id`,
    );
    return rows[0]?.id as string;
  });
});
afterAll(() => Promise.all([app.end(), app2.end()]));

const actorFor = (role: StoreRole): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000bb',
  platformRole: null,
  permissions: permissionsOf(role),
  tenantId: store,
  storeRole: role,
});
const owner = actorFor('owner');
const run = <T>(fn: (tx: TenantTx) => Promise<T>, client = app) => withTenant(client, store, fn);

let seq = 0;
async function newVariant(settings: { allowBackorder?: boolean; trackInventory?: boolean } = {}) {
  const product = await run((tx) =>
    createProduct(tx, owner, {
      translations: { en: { title: `Stock ${++seq}` } },
      variant: { price: 100 },
    }),
  );
  const id = product.variants[0]?.id as string;
  if (Object.keys(settings).length) await run((tx) => updateVariant(tx, owner, id, settings));
  return id;
}

const level = (result: ApplyResult, variantId: string, locationId?: string) =>
  result.levels.find(
    (l) => l.variantId === variantId && (!locationId || l.locationId === locationId),
  );

const drift = () => run((tx) => inventoryDrift(tx));

describe('movements and rules', () => {
  it('moves the right column with each movement type', async () => {
    const v = await newVariant();
    expect(
      level(
        await run((tx) => receive(tx, owner, { variantId: v, quantity: 10, reason: 'received' })),
        v,
      ),
    ).toMatchObject({ onHand: 10, reserved: 0, available: 10 });
    expect(
      level(
        await run((tx) => reserve(tx, owner, { variantId: v, quantity: 3, reason: 'order' })),
        v,
      ),
    ).toMatchObject({ onHand: 10, reserved: 3, available: 7 });
    expect(
      level(
        await run((tx) =>
          sell(tx, owner, { variantId: v, quantity: 2, reason: 'order', fromReservation: true }),
        ),
        v,
      ),
    ).toMatchObject({ onHand: 8, reserved: 1 });
    expect(
      level(
        await run((tx) => release(tx, owner, { variantId: v, quantity: 1, reason: 'cancelled' })),
        v,
      ),
    ).toMatchObject({ reserved: 0 });
    expect(
      level(
        await run((tx) =>
          returnStock(tx, owner, { variantId: v, quantity: 1, reason: 'returned' }),
        ),
        v,
      ),
    ).toMatchObject({ onHand: 9 });
    const { items } = await run((tx) => listMovements(tx, owner, v));
    expect(items.map((m) => [m.type, m.quantity])).toEqual([
      ['return', 1],
      ['release', -1],
      ['sale', -2],
      ['release', -2],
      ['reservation', 3],
      ['receive', 10],
    ]);
    expect(await drift()).toEqual([]);
  });

  it('refuses oversells without backorders, and allows them with backorders or untracked stock', async () => {
    const strict = await newVariant();
    const backorder = await newVariant({ allowBackorder: true });
    const untracked = await newVariant({ trackInventory: false });
    await run((tx) => receive(tx, owner, { variantId: strict, quantity: 2, reason: 'received' }));
    for (const attempt of [
      () => run((tx) => sell(tx, owner, { variantId: strict, quantity: 3, reason: 'order' })),
      () => run((tx) => reserve(tx, owner, { variantId: strict, quantity: 3, reason: 'order' })),
      () => run((tx) => release(tx, owner, { variantId: strict, quantity: 1, reason: 'x' })),
      () =>
        run((tx) =>
          adjustInventory(tx, owner, [
            { mode: 'delta', variantId: strict, quantity: -3, reason: 'damaged' },
          ]),
        ),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: 'insufficient_stock' });
    }
    expect(
      level(
        await run((tx) => sell(tx, owner, { variantId: backorder, quantity: 3, reason: 'order' })),
        backorder,
      )?.onHand,
    ).toBe(-3);
    expect(
      level(
        await run((tx) => sell(tx, owner, { variantId: untracked, quantity: 3, reason: 'order' })),
        untracked,
      )?.onHand,
    ).toBe(-3);
    expect(await drift()).toEqual([]);
  });

  it('writes a repeated idempotency key only once', async () => {
    const v = await newVariant();
    const once = () =>
      run((tx) =>
        receive(tx, owner, {
          variantId: v,
          quantity: 5,
          reason: 'import',
          idempotencyKey: `import:job:${v}`,
        }),
      );
    expect((await once()).applied).toBe(1);
    const again = await once();
    expect(again).toMatchObject({ applied: 0, skipped: 1 });
    expect(level(again, v)?.onHand).toBe(5);
  });

  it('sets counts with one adjustment per difference', async () => {
    const a = await newVariant();
    const b = await newVariant();
    await run((tx) => receive(tx, owner, { variantId: a, quantity: 4, reason: 'received' }));
    const result = await run((tx) =>
      setOnHand(tx, owner, [
        { variantId: a, onHand: 4, reason: 'count' },
        { variantId: b, onHand: 7, reason: 'count' },
        { variantId: a, onHand: 6, reason: 'count', locationId: location2 },
      ]),
    );
    expect(result.applied).toBe(2);
    expect(level(result, b)?.onHand).toBe(7);
    expect(level(result, a, location2)?.onHand).toBe(6);
    const listed = await run((tx) => listInventory(tx, owner, { q: `stock ${seq - 1}` }));
    expect(listed.items[0]).toMatchObject({ variantId: a, onHand: 10, available: 10 });
    expect(await drift()).toEqual([]);
  });

  it('checks permissions, and the ledger is append-only for the app', async () => {
    const v = await newVariant();
    await expect(
      run((tx) =>
        adjustInventory(tx, actorFor('viewer'), [
          { mode: 'set', variantId: v, onHand: 1, reason: 'count' },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await run((tx) =>
      adjustInventory(tx, actorFor('staff'), [
        { mode: 'set', variantId: v, onHand: 1, reason: 'count' },
      ]),
    );
    // 42501: insufficient_privilege.
    await expect(
      run((tx) => tx.db.execute(sql`update store.stock_movements set quantity = 100`)),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(
      run((tx) => tx.db.execute(sql`delete from store.stock_movements`)),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });
});

// ---- The property test ------------------------------------------------------------

/** A small seeded PRNG (mulberry32), so a failing sequence can be replayed. */
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)) };
}

type Op =
  | {
      kind: 'receive' | 'return' | 'reserve' | 'release' | 'sell' | 'sellReserved';
      quantity: number;
    }
  | { kind: 'adjust'; quantity: number }
  | { kind: 'count'; onHand: number };

function randomOp(r: ReturnType<typeof prng>): Op {
  const kinds = [
    'receive',
    'return',
    'reserve',
    'release',
    'sell',
    'sellReserved',
    'adjust',
    'count',
  ] as const;
  const kind = kinds[r.int(0, kinds.length - 1)] as (typeof kinds)[number];
  if (kind === 'adjust') return { kind, quantity: r.int(1, 4) * (r.next() < 0.5 ? -1 : 1) };
  if (kind === 'count') return { kind, onHand: r.int(0, 12) };
  return { kind, quantity: r.int(1, 4) };
}

function runOp(tx: TenantTx, variantId: string, locationId: string, op: Op) {
  const base = { variantId, locationId, reason: 'property' };
  switch (op.kind) {
    case 'receive':
      return receive(tx, owner, { ...base, quantity: op.quantity });
    case 'return':
      return returnStock(tx, owner, { ...base, quantity: op.quantity });
    case 'reserve':
      return reserve(tx, owner, { ...base, quantity: op.quantity });
    case 'release':
      return release(tx, owner, { ...base, quantity: op.quantity });
    case 'sell':
      return sell(tx, owner, { ...base, quantity: op.quantity });
    case 'sellReserved':
      return sell(tx, owner, { ...base, quantity: op.quantity, fromReservation: true });
    case 'adjust':
      return adjustInventory(tx, owner, [
        { mode: 'delta', variantId, locationId, quantity: op.quantity, reason: 'correction' },
      ]);
    case 'count':
      return setOnHand(tx, owner, [{ ...base, onHand: op.onHand }]);
  }
}

/** The rules, in memory: the expected level after `op`, or null if it must be refused. */
function model(level: { onHand: number; reserved: number }, op: Op, free: boolean) {
  let { onHand, reserved } = level;
  switch (op.kind) {
    case 'receive':
    case 'return':
      onHand += op.quantity;
      break;
    case 'reserve':
      reserved += op.quantity;
      if (!free && onHand - reserved < 0) return null;
      break;
    case 'release':
      reserved -= op.quantity;
      if (reserved < 0) return null;
      break;
    case 'sell':
      onHand -= op.quantity;
      if (!free && onHand - reserved < 0) return null;
      break;
    case 'sellReserved':
      reserved -= op.quantity;
      if (reserved < 0) return null;
      onHand -= op.quantity;
      if (!free && onHand - reserved < 0) return null;
      break;
    case 'adjust':
      onHand += op.quantity;
      if (!free && op.quantity < 0 && onHand < 0) return null;
      break;
    case 'count':
      onHand = op.onHand;
      break;
  }
  return { onHand, reserved };
}

describe('the invariant (property test)', () => {
  it('holds over random sequences, matching the rules step by step', async () => {
    const strict = await newVariant();
    const backorder = await newVariant({ allowBackorder: true });
    const levels = new Map<string, { onHand: number; reserved: number }>();
    const variants = [
      { id: strict, free: false },
      { id: backorder, free: true },
    ];
    const locations = [undefined, location2];
    let ops = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = prng(seed);
      for (let step = 0; step < 150; step++, ops++) {
        const variant = variants[r.int(0, 1)] as (typeof variants)[number];
        const location = locations[r.int(0, 1)];
        const key = `${variant.id}:${location ?? 'default'}`;
        const before = levels.get(key) ?? { onHand: 0, reserved: 0 };
        const op = randomOp(r);
        const expected = model(before, op, variant.free);
        const context = `seed ${seed}, step ${step}: ${JSON.stringify(op)} from ${JSON.stringify(before)}`;
        try {
          const result = await run((tx) => runOp(tx, variant.id, location as string, op));
          expect(expected, context).not.toBeNull();
          const after = result.levels.find(
            (l) => l.variantId === variant.id && (!location || l.locationId === location),
          );
          expect({ onHand: after?.onHand, reserved: after?.reserved }, context).toEqual(expected);
          levels.set(key, expected as { onHand: number; reserved: number });
        } catch (e) {
          if ((e as { code?: string }).code !== 'insufficient_stock') throw e;
          expect(expected, context).toBeNull();
        }
        if (step % 50 === 49) expect(await drift(), context).toEqual([]);
      }
    }
    expect(ops).toBe(1500);
    expect(await drift()).toEqual([]);
  }, 120_000);

  it('holds when two connections change the same stock at once', async () => {
    const strict = await newVariant();
    await run((tx) => receive(tx, owner, { variantId: strict, quantity: 20, reason: 'received' }));
    const worker = async (client: pg.Client, seed: number) => {
      const r = prng(seed);
      for (let step = 0; step < 300; step++) {
        const op = randomOp(r);
        try {
          await run((tx) => runOp(tx, strict, location2, op), client);
        } catch (e) {
          if ((e as { code?: string }).code !== 'insufficient_stock') throw e;
        }
      }
    };
    await Promise.all([worker(app, 101), worker(app2, 202)]);
    expect(await drift()).toEqual([]);
    const { rows } = await run((tx) =>
      tx.db.execute<{ on_hand: number; reserved: number }>(
        sql`select on_hand, reserved from store.inventory_levels where variant_id = ${strict} and location_id = ${location2}`,
      ),
    );
    expect(rows[0]?.reserved).toBeGreaterThanOrEqual(0);
    expect((rows[0]?.on_hand ?? 0) - (rows[0]?.reserved ?? 0)).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('has no drift in any store (the daily check)', async () => {
    const ownerClient = await connectOwner();
    try {
      const { rows } = await ownerClient.query('select * from app.inventory_drift(100)');
      expect(rows).toEqual([]);
    } finally {
      await ownerClient.end();
    }
  });
});
