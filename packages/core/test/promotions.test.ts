// Promotions and codes (phase-4-plan §3.13, §10) against Postgres: create
// and edit, shared and batch codes, the campaign figures after real orders,
// the test cart's reasons, and ending a campaign.
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  cancelOrder,
  createManualOrder,
  createProduct,
  createPromotion,
  createTenant,
  DRAFT_PROMOTION_ID,
  generateCodes,
  getPromotion,
  listCodes,
  listPromotions,
  receive,
  systemActor,
  type TenantTx,
  testCart,
  updatePromotion,
  withTenant,
} from '../src';
import { connectApp } from './setup';

const DHANMONDI = 513;
const address = { divisionId: 6, districtId: 47, areaId: DHANMONDI, line: 'House 1' };

let app: pg.Client;
let store: string;
let owner: Actor;
let viewer: Actor;
let variant: string;

beforeAll(async () => {
  app = await connectApp();
  const slug = `pro${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Promotions test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  const base = {
    kind: 'user' as const,
    userId: '0199d000-0000-7000-8000-0000000000dd',
    platformRole: null,
    tenantId: store,
  };
  owner = { ...base, permissions: permissionsOf('owner'), storeRole: 'owner' };
  viewer = { ...base, permissions: permissionsOf('viewer'), storeRole: 'viewer' };
  variant = await run(async (tx) => {
    const p = await createProduct(tx, owner, {
      status: 'active',
      translations: { en: { title: 'Panjabi' } },
      variant: { price: 100_000 },
    });
    const id = p.variants[0]?.id as string;
    await receive(tx, owner, { variantId: id, quantity: 50, reason: 'received' });
    return id;
  });
});
afterAll(() => app.end());

const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);

const tenPercent = {
  title: { en: '10% off over ৳1,500', bn: '৳১,৫০০-এর বেশিতে ১০% ছাড়' },
  kind: 'automatic',
  status: 'active',
  conditions: { minSubtotal: 150_000 },
  action: { type: 'percent_off_order', percentBp: 1000 },
};

const order = (code?: string, phone = '+8801712000001') =>
  run((tx) =>
    createManualOrder(tx, owner, {
      source: 'phone',
      lines: [{ variantId: variant, quantity: 2 }],
      contact: { name: 'Karim', phone },
      address,
      ...(code ? { code } : {}),
    }),
  );

describe('promotions', () => {
  let automatic: string;
  let coded: string;

  it('creates an automatic and a code promotion; codes match without regard to case', async () => {
    const a = await run((tx) => createPromotion(tx, owner, tenPercent));
    automatic = a.id;
    expect(a).toMatchObject({ state: 'live', usageCount: 0, orders: 0, code: null });
    const c = await run((tx) =>
      createPromotion(tx, owner, {
        title: { en: 'Eid ৳250 off' },
        kind: 'code',
        status: 'active',
        code: 'eid200',
        exclusive: true,
        action: { type: 'amount_off_order', amount: 25_000 },
      }),
    );
    coded = c.id;
    expect(c).toMatchObject({ code: 'EID200', codeCount: 1 });
    await expect(
      run((tx) =>
        createPromotion(tx, owner, {
          title: { en: 'Clash' },
          kind: 'code',
          code: 'Eid200',
          action: { type: 'amount_off_order', amount: 100 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(run((tx) => createPromotion(tx, viewer, tenPercent))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('keeps the kind, and reads a future start as scheduled', async () => {
    await expect(
      run((tx) => updatePromotion(tx, owner, automatic, { kind: 'code' })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const later = new Date(Date.now() + 86_400_000).toISOString();
    const p = await run((tx) => updatePromotion(tx, owner, automatic, { startsAt: later }));
    expect(p.state).toBe('scheduled');
    const back = await run((tx) => updatePromotion(tx, owner, automatic, { startsAt: null }));
    expect(back.state).toBe('live');
  });

  it('tries a cart, saying why each promotion did or didn’t apply, with a draft as if live', async () => {
    const draft = {
      title: { en: 'Free delivery' },
      kind: 'automatic',
      action: { type: 'delivery_percent_off', percentBp: 10_000 },
    };
    const one = await run((tx) =>
      testCart(tx, viewer, {
        lines: [{ variantId: variant, quantity: 1 }],
        areaId: DHANMONDI,
        draft,
      }),
    );
    const by = (id: string) => one.results.find((r) => r.promotionId === id);
    expect(by(automatic)).toMatchObject({ applied: false, reason: 'min_subtotal' });
    expect(by(DRAFT_PROMOTION_ID)).toMatchObject({ applied: true, amount: 7_000 });
    expect(one.quote.totals.total).toBe(100_000);

    const two = await run((tx) =>
      testCart(tx, viewer, {
        lines: [{ variantId: variant, quantity: 2 }],
        areaId: DHANMONDI,
        code: 'EID200',
      }),
    );
    // The exclusive code (৳250) beats the combinable 10% (৳200), which says why.
    expect(two.results.filter((r) => r.applied).map((r) => r.amount)).toEqual([25_000]);
    expect(two.results.find((r) => r.promotionId === automatic)?.reason).toBe('better_offer');
  });

  it('counts uses, orders, discounts and sales, and gives uses back on cancel', async () => {
    const placed = await order();
    await order('eid200', '+8801712000002');
    const list = await run((tx) => listPromotions(tx, viewer));
    const a = list.find((p) => p.id === automatic);
    expect(a).toMatchObject({ orders: 1, usageCount: 1, discountTotal: 20_000 });
    expect(a?.sales).toBe(200_000 - 20_000 + 7_000);
    expect((await run((tx) => getPromotion(tx, viewer, coded))).usageCount).toBe(1);

    await run((tx) => cancelOrder(tx, owner, placed.id, { reason: 'test' }));
    expect(await run((tx) => getPromotion(tx, viewer, automatic))).toMatchObject({
      usageCount: 0,
      orders: 0,
    });
    expect(
      (await run((tx) => listPromotions(tx, viewer, { state: 'live', kind: 'code' }))).map(
        (p) => p.id,
      ),
    ).toEqual([coded]);
  });

  it('generates unique single-use codes in a batch', async () => {
    const { created, codes } = await run((tx) =>
      generateCodes(tx, owner, coded, { count: 300, prefix: 'vip' }),
    );
    expect(created).toBe(300);
    expect(new Set(codes).size).toBe(300);
    expect(codes.every((c) => /^VIP[A-Z2-9]{8}$/.test(c))).toBe(true);
    const page = await run((tx) => listCodes(tx, viewer, coded, { limit: 100 }));
    expect(page.items).toHaveLength(100);
    expect(page.nextCursor).not.toBeNull();
    const single = codes[0] as string;
    // Used once: the second order gets the automatic 10% only.
    expect((await order(single.toLowerCase(), '+8801712000003')).total).toBe(182_000);
    expect((await order(single, '+8801712000004')).total).toBe(187_000);
    const used = await run((tx) => listCodes(tx, viewer, coded, { limit: 1000 }));
    expect(used.items.find((c) => c.code === single)).toMatchObject({
      usageCount: 1,
      usageLimit: 1,
    });
    await expect(
      run((tx) => generateCodes(tx, owner, automatic, { count: 1 })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('ends a promotion instead of deleting it', async () => {
    const ended = await run((tx) => updatePromotion(tx, owner, coded, { status: 'ended' }));
    expect(ended.state).toBe('ended');
    const t = await run((tx) =>
      testCart(tx, viewer, { lines: [{ variantId: variant, quantity: 2 }], code: 'EID200' }),
    );
    expect(t.quote.code).toEqual({ code: 'EID200', status: 'inactive' });
  });
});
