// Carts and placeOrder (phase-4-plan §3.4, §3.5, §10), against Postgres with
// RLS: totals, refusals, idempotency (acceptance criterion 2) and the last
// unit under concurrent checkouts (acceptance criterion 1).
import { permissionsOf } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  addToCart,
  checkout,
  createProduct,
  createPromotion,
  createTenant,
  getCart,
  inventoryDrift,
  type PlaceOrderInput,
  placeOrder,
  receive,
  setCartArea,
  setCartCode,
  setCartQuantity,
  shopperActor,
  systemActor,
  type TenantTx,
  updateVariant,
  withTenant,
} from '../src';
import { connectApp, TENANT_A } from './setup';

const DHANMONDI = 513; // dhaka.dhanmondi: "Inside Dhaka", ৳70
const SAVAR = 365; // dhaka.savar: "Dhaka suburbs", ৳100
const address = (areaId = DHANMONDI) => ({
  divisionId: 6,
  districtId: 47,
  areaId,
  line: 'House 1, Road 2',
});

let pool: pg.Client[];
let app: pg.Client;
let store: string;
let owner: Actor;
const shopper = shopperActor();

beforeAll(async () => {
  pool = await Promise.all(Array.from({ length: 10 }, () => connectApp()));
  app = pool[0] as pg.Client;
  const slug = `ord${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Orders test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  owner = {
    kind: 'user',
    userId: '0199d000-0000-7000-8000-0000000000cc',
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId: store,
    storeRole: 'owner',
  };
});
afterAll(() => Promise.all(pool.map((c) => c.end())));

const run = <T>(fn: (tx: TenantTx) => Promise<T>, client = app) => withTenant(client, store, fn);

let seq = 0;
async function product(price: number, stock: number, extra: Record<string, unknown> = {}) {
  const p = await run((tx) =>
    createProduct(tx, owner, {
      status: 'active',
      translations: { en: { title: `Item ${++seq}` }, bn: { title: `পণ্য ${seq}` } },
      variant: { price, ...extra },
    }),
  );
  const variantId = p.variants[0]?.id as string;
  if (stock > 0)
    await run((tx) => receive(tx, owner, { variantId, quantity: stock, reason: 'received' }));
  return variantId;
}

const contact = { name: 'Rahim', phone: '+8801712345678' };

async function cartWith(lines: [string, number][], areaId: number | null = DHANMONDI) {
  let token: string | null = null;
  for (const [variantId, quantity] of lines) {
    const r = await run((tx) => addToCart(tx, token, { variantId, quantity }, 'en'));
    token = r.token ?? token;
  }
  if (areaId !== null) await run((tx) => setCartArea(tx, token, { areaId }));
  return token as string;
}

const order = (
  token: string,
  expectedTotal: number,
  extra: Partial<PlaceOrderInput> = {},
): PlaceOrderInput => ({
  channel: 'storefront',
  source: 'website',
  cartToken: token,
  contact,
  address: address(),
  payment: { kind: 'cod' },
  expectedTotal,
  locale: 'en',
  ...extra,
});

const stock = (variantId: string) =>
  run(async (tx) => {
    const { rows } = await tx.db.execute<{ on_hand: number; reserved: number }>(
      sql`select coalesce(sum(on_hand), 0)::int as on_hand, coalesce(sum(reserved), 0)::int as reserved
            from store.inventory_levels where variant_id = ${variantId}`,
    );
    return rows[0];
  });

describe('carts', () => {
  it('are created on the first add and priced with the zone and weight', async () => {
    const a = await product(50_000, 5, { weightGrams: 1_500 });
    const first = await run((tx) => addToCart(tx, null, { variantId: a, quantity: 2 }, 'en'));
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.cart.itemCount).toBe(2);
    // No area yet: "from ৳70".
    expect(first.cart.quote.deliveryFrom).toBe(7_000);
    expect(first.cart.quote.totals.deliveryFee).toBe(0);
    const token = first.token as string;
    // 3 kg in Dhaka: ৳70 for the first kilogram and ৳20 for each of the other two.
    const inDhaka = await run((tx) => setCartArea(tx, token, { areaId: DHANMONDI }));
    expect(inDhaka.quote.totals).toMatchObject({
      subtotal: 100_000,
      deliveryFee: 11_000,
      total: 111_000,
    });
    expect(inDhaka.quote.zone?.name).toEqual({ bn: 'ঢাকার ভেতরে', en: 'Inside Dhaka' });
    const savar = await run((tx) => setCartArea(tx, token, { areaId: SAVAR }));
    expect(savar.quote.totals.deliveryFee).toBe(14_000);
    // Chattogram's Kotwali falls to "Outside Dhaka".
    const ctg = await run((tx) => setCartArea(tx, token, { areaId: 561 }));
    expect(ctg.quote.zone?.name.en).toBe('Outside Dhaka');
  });

  it('refuse more than the stock or the per-line limit, and keep a line that became unavailable', async () => {
    const a = await product(10_000, 3);
    await expect(
      run((tx) => addToCart(tx, null, { variantId: a, quantity: 4 }, 'en')),
    ).rejects.toMatchObject({
      code: 'insufficient_stock',
    });
    const b = await product(10_000, 100);
    await expect(
      run((tx) => addToCart(tx, null, { variantId: b, quantity: 11 }, 'en')),
    ).rejects.toMatchObject({
      code: 'limit_exceeded',
    });
    const token = await cartWith([[a, 2]]);
    await run((tx) => updateVariant(tx, owner, a, { trackInventory: true }));
    await run((tx) =>
      tx.db.execute(
        sql`update store.products set status = 'draft' where id = (select product_id from store.variants where id = ${a})`,
      ),
    );
    const cart = await run((tx) => getCart(tx, token));
    expect(cart?.quote.lines[0]?.problem).toBe('unavailable');
    expect(cart?.ready).toBe(false);
    const emptied = await run((tx) => setCartQuantity(tx, token, a, { quantity: 0 }));
    expect(emptied.itemCount).toBe(0);
  });

  it('are invisible to another store', async () => {
    const a = await product(10_000, 3);
    const token = await cartWith([[a, 1]]);
    expect(await withTenant(app, TENANT_A, (tx) => getCart(tx, token))).toBeNull();
    expect(await run((tx) => getCart(tx, token))).not.toBeNull();
  });
});

describe('placeOrder', () => {
  it('turns the cart into an order with snapshots, a reservation, a COD payment and history', async () => {
    const a = await product(50_000, 5);
    const token = await cartWith([[a, 2]]);
    const placed = await run((tx) => placeOrder(tx, shopper, order(token, 107_000)));
    expect(placed).toMatchObject({ status: 'pending', total: 107_000, codAmount: 107_000 });
    expect(placed.displayNumber).toBe(`#${placed.number}`);
    expect(placed.number).toBeGreaterThanOrEqual(1001);
    expect(await stock(a)).toEqual({ on_hand: 5, reserved: 2 });
    const rows = await run(async (tx) => {
      const o =
        await tx.db.execute(sql`select status, payment_status, delivery_status, total::int, phone, address->'names'->'area'->>'en' as area,
        zone_name->>'en' as zone, customer_id from store.orders where id = ${placed.id}`);
      const l = await tx.db.execute(
        sql`select title->>'en' as title, unit_price::int, quantity, line_total::int from store.order_lines where order_id = ${placed.id}`,
      );
      const p = await tx.db.execute(
        sql`select provider, status, amount::int from store.payments where order_id = ${placed.id}`,
      );
      const h = await tx.db.execute(
        sql`select machine, to_status, event, actor_type from store.order_history where order_id = ${placed.id}`,
      );
      const c = await tx.db.execute(
        sql`select status from store.carts where order_id = ${placed.id}`,
      );
      const cu = await tx.db.execute(
        sql`select order_count, name from store.customers where phone = ${contact.phone}`,
      );
      return { o: o.rows[0], l: l.rows, p: p.rows, h: h.rows, c: c.rows, cu: cu.rows[0] };
    });
    expect(rows.o).toMatchObject({
      status: 'pending',
      payment_status: 'unpaid',
      delivery_status: 'not_shipped',
      total: 107_000,
      phone: contact.phone,
      area: 'Dhanmondi',
      zone: 'Inside Dhaka',
    });
    expect(rows.l).toEqual([
      {
        title: expect.stringMatching(/^Item/),
        unit_price: 50_000,
        quantity: 2,
        line_total: 100_000,
      },
    ]);
    expect(rows.p).toEqual([{ provider: 'cod', status: 'pending', amount: 107_000 }]);
    expect(rows.h).toEqual([
      { machine: 'order', to_status: 'pending', event: 'place', actor_type: 'shopper' },
    ]);
    expect(rows.c).toEqual([{ status: 'converted' }]);
    expect(rows.cu).toMatchObject({ name: 'Rahim' });
    expect(await run((tx) => inventoryDrift(tx))).toEqual([]);
  });

  it('refuses when the price changed, and says the new total', async () => {
    const a = await product(50_000, 5);
    const token = await cartWith([[a, 1]]);
    await expect(run((tx) => placeOrder(tx, shopper, order(token, 50_000)))).rejects.toMatchObject({
      code: 'price_changed',
      extensions: { totals: expect.objectContaining({ total: 57_000 }) },
    });
  });

  it('refuses during holiday mode, above the COD maximum, and for a blocked phone', async () => {
    const a = await product(50_000, 5);
    const token = await cartWith([[a, 1]]);
    const setSettings = (patch: string) =>
      run((tx) =>
        tx.db.execute(
          sql.raw(
            `update platform.tenants set settings = settings || '${patch}'::jsonb where id = '${store}'`,
          ),
        ),
      );
    const now = Date.now();
    await setSettings(
      JSON.stringify({
        storefront: {
          holiday: {
            startsAt: new Date(now - 60_000).toISOString(),
            endsAt: new Date(now + 60_000).toISOString(),
            message: {},
          },
        },
      }),
    );
    await expect(run((tx) => placeOrder(tx, shopper, order(token, 57_000)))).rejects.toMatchObject({
      code: 'checkout_paused',
    });
    await setSettings(
      JSON.stringify({
        storefront: {},
        cod: { enabled: true, maxOrderValue: 50_000, advance: 'never' },
      }),
    );
    await expect(run((tx) => placeOrder(tx, shopper, order(token, 57_000)))).rejects.toMatchObject({
      code: 'cod_unavailable',
    });
    await setSettings(
      JSON.stringify({ cod: { enabled: true, maxOrderValue: null, advance: 'never' } }),
    );
    await run((tx) =>
      tx.db.execute(
        sql`insert into store.blocked_phones (phone, reason) values ('+8801999999999', 'fake orders')`,
      ),
    );
    await expect(
      run((tx) =>
        placeOrder(
          tx,
          shopper,
          order(token, 57_000, { contact: { name: 'X', phone: '+8801999999999' } }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    // Nothing was reserved by the refusals.
    expect(await stock(a)).toEqual({ on_hand: 5, reserved: 0 });
  });

  it('enters a manual order with an advance payment and COD for the rest', async () => {
    const a = await product(80_000, 5);
    const placed = await run((tx) =>
      placeOrder(tx, owner, {
        channel: 'admin',
        source: 'facebook',
        lines: [{ variantId: a, quantity: 1 }],
        contact: { name: 'Karim', phone: '+8801812345678' },
        address: address(SAVAR),
        payment: { kind: 'manual', method: 'bkash', amount: 10_000, reference: 'TX123' },
        manualDiscount: { amount: 5_000, reason: 'regular customer' },
        locale: 'bn',
        confirm: true,
      }),
    );
    expect(placed).toMatchObject({ status: 'confirmed', total: 85_000, codAmount: 75_000 });
    const pays = await run((tx) =>
      tx.db.execute(
        sql`select provider, method, status, amount::int from store.payments where order_id = ${placed.id} order by provider`,
      ),
    );
    expect(pays.rows).toEqual([
      { provider: 'cod', method: 'cod', status: 'pending', amount: 75_000 },
      { provider: 'manual', method: 'bkash', status: 'paid', amount: 10_000 },
    ]);
    const o = await run((tx) =>
      tx.db.execute(
        sql`select payment_status, paid_total::int, discount_total::int from store.orders where id = ${placed.id}`,
      ),
    );
    expect(o.rows[0]).toEqual({
      payment_status: 'partially_paid',
      paid_total: 10_000,
      discount_total: 5_000,
    });
  });

  it('warns staff about a blocked phone and goes ahead when told to', async () => {
    const a = await product(10_000, 5);
    const input: PlaceOrderInput = {
      channel: 'admin',
      source: 'phone',
      lines: [{ variantId: a, quantity: 1 }],
      contact: { name: 'Blocked', phone: '+8801999999999' },
      address: null,
      zone: 'none',
      payment: { kind: 'cod' },
      locale: 'en',
    };
    await expect(run((tx) => placeOrder(tx, owner, input))).rejects.toMatchObject({
      code: 'conflict',
      extensions: { reason: 'blocked_phone' },
    });
    const placed = await run((tx) => placeOrder(tx, owner, { ...input, allowBlocked: true }));
    expect(placed.total).toBe(10_000);
  });
});

describe('acceptance criterion 2: idempotent checkout', () => {
  it('returns the same order for a retry and never creates two', async () => {
    const a = await product(20_000, 5);
    const token = await cartWith([[a, 1]]);
    const key = `test-key-${Date.now()}`;
    const body = { cart: token, total: 27_000 };
    const first = await run((tx) => checkout(tx, shopper, key, body, order(token, 27_000)));
    const again = await run((tx) => checkout(tx, shopper, key, body, order(token, 27_000)));
    expect(first.status).toBe(201);
    expect(again).toMatchObject({ status: 201, replayed: true, body: first.body });
    await expect(
      run((tx) => checkout(tx, shopper, key, { ...body, total: 1 }, order(token, 27_000))),
    ).rejects.toMatchObject({ code: 'idempotency_key_reused' });
    expect(await stock(a)).toEqual({ on_hand: 5, reserved: 1 });
  });

  it('gives a concurrent duplicate the same order', async () => {
    const a = await product(20_000, 5);
    const token = await cartWith([[a, 1]]);
    const key = `test-key-c-${Date.now()}`;
    const results = await Promise.allSettled(
      pool
        .slice(0, 3)
        .map((client) =>
          run((tx) => checkout(tx, shopper, key, { token }, order(token, 27_000)), client),
        ),
    );
    const ok = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<{ body: { id: string } }>).value);
    for (const r of results) {
      if (r.status === 'rejected')
        expect((r.reason as { code: string }).code).toBe('idempotency_request_in_progress');
    }
    expect(new Set(ok.map((r) => r.body.id)).size).toBe(1);
    const n = await run((tx) =>
      tx.db.execute<{ n: number }>(
        sql`select count(*)::int as n from store.orders o join store.order_lines l on l.order_id = o.id where l.variant_id = ${a}`,
      ),
    );
    expect(n.rows[0]?.n).toBe(1);
    expect(await stock(a)).toEqual({ on_hand: 5, reserved: 1 });
  });
});

// Each test here holds many connections and transactions at once, which can
// outlast the 5 s default on a CI runner shared with the other suites.
describe('acceptance criterion 1: the last unit', () => {
  it('goes to exactly one of ten shoppers ordering at once', async () => {
    const a = await product(30_000, 1);
    const tokens: string[] = [];
    for (let i = 0; i < 10; i += 1) tokens.push(await cartWith([[a, 1]]));
    const results = await Promise.allSettled(
      pool.map((client, i) =>
        run(
          (tx) =>
            placeOrder(
              tx,
              shopper,
              order(tokens[i] as string, 37_000, {
                contact: { name: `S${i}`, phone: `+88017000001${String(i).padStart(2, '0')}` },
              }),
            ),
          client,
        ),
      ),
    );
    const placed = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(placed).toHaveLength(1);
    expect(refused).toHaveLength(9);
    for (const r of refused) {
      expect(r.reason).toMatchObject({
        code: 'insufficient_stock',
        extensions: { lines: [{ variantId: a, available: 0 }] },
      });
    }
    expect(await stock(a)).toEqual({ on_hand: 1, reserved: 1 });
    expect(await run((tx) => inventoryDrift(tx))).toEqual([]);
  }, 30_000);

  it('gives a code limited to one use to exactly one of ten shoppers at once', async () => {
    const a = await product(10_000, 20);
    const code = `ONCE${Date.now().toString(36).toUpperCase()}`;
    const promo = await run((tx) =>
      createPromotion(tx, owner, {
        title: { en: 'Once' },
        kind: 'code',
        status: 'active',
        code,
        usageLimit: 1,
        action: { type: 'amount_off_order', amount: 2_000 },
      }),
    );
    const tokens: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const token = await cartWith([[a, 1]]);
      await run((tx) => setCartCode(tx, token, { code }));
      tokens.push(token);
    }
    // ৳100 + ৳70 delivery - ৳20 off.
    const results = await Promise.allSettled(
      pool.map((client, i) =>
        run(
          (tx) =>
            placeOrder(
              tx,
              shopper,
              order(tokens[i] as string, 15_000, {
                contact: { name: `C${i}`, phone: `+88017000002${String(i).padStart(2, '0')}` },
              }),
            ),
          client,
        ),
      ),
    );
    const placed = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(placed).toHaveLength(1);
    expect(refused).toHaveLength(9);
    // A shopper whose quote ran after the winner committed finds the code
    // used up: their total is ৳170 without it, so the price changed. One whose
    // quote ran first loses at the count. Both keep their ৳150 from going through.
    for (const r of refused) {
      if (r.reason?.code === 'price_changed') {
        expect(r.reason).toMatchObject({
          extensions: { expectedTotal: 15_000, totals: { total: 17_000, discountTotal: 0 } },
        });
      } else {
        expect(r.reason).toMatchObject({
          code: 'promotion_unavailable',
          extensions: { promotionId: promo.id },
        });
      }
    }
    const { rows } = await run((tx) =>
      tx.db.execute<{ n: number }>(
        sql`select usage_count as n from store.promotions where id = ${promo.id}`,
      ),
    );
    expect(rows[0]?.n).toBe(1);
    // The nine refused orders released what they reserved.
    expect(await stock(a)).toEqual({ on_hand: 20, reserved: 1 });
  }, 30_000);

  it('gives 20 concurrent orders 20 different numbers', async () => {
    const a = await product(1_000, 100);
    const tokens: string[] = [];
    for (let i = 0; i < 20; i += 1) tokens.push(await cartWith([[a, 1]]));
    const extra = await Promise.all(Array.from({ length: 10 }, () => connectApp()));
    const clients = [...pool, ...extra];
    const placed = await Promise.all(
      tokens.map((t, i) => run((tx) => placeOrder(tx, shopper, order(t, 8_000)), clients[i])),
    ).finally(() => Promise.all(extra.map((c) => c.end())));
    expect(new Set(placed.map((p) => p.number)).size).toBe(20);
  }, 30_000);
});
