// Plan limits and features in the core services (phase-5b-plan §3.5): hard
// limits refuse staff with plan_limit, features refuse turning a setting on,
// a setting already on survives a downgrade, and soft limits never refuse.
import { fakeHostnames } from '@managemind/providers/hostnames';
import { permissionsOf } from '@managemind/shared';
import { type Entitlements, UNLIMITED } from '@managemind/shared/billing';
import { checkoutSettings } from '@managemind/shared/orders';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  addDomain,
  archiveProduct,
  createPlan,
  createProduct,
  createPromotion,
  createTenant,
  getReports,
  invite,
  placeOrder,
  setSubscription,
  systemActor,
  updatePlan,
  updateProduct,
  updateStoreProfile,
  withPlatform,
  withTenant,
} from '../src';
import { connectApp, connectOwner } from './setup';

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  [app, owner] = await Promise.all([connectApp(), connectOwner()]);
});
afterAll(() => Promise.all([app.end(), owner.end()]));

let seq = 0;
const tiny: Entitlements = {
  limits: {
    products: 1,
    staff: 1,
    ordersPerMonth: 0,
    emailsPerMonth: 0,
    storageMb: 1,
    customDomains: 0,
  },
  features: {
    ...UNLIMITED.features,
    shopperAccounts: false,
    promotionCoupons: false,
    promotionBuyXGetY: false,
    reports: false,
  },
};

async function storeOnPlan(entitlements: Entitlements) {
  const code = `p-${Date.now().toString(36)}-${seq++}`;
  const plan = await withPlatform(app, (tx) =>
    createPlan(tx, systemActor, {
      code,
      name: { bn: code, en: code },
      monthlyPrice: 0,
      setupFee: 0,
      entitlements,
    }),
  );
  const slug = `e${Date.now().toString(36)}${seq++}`;
  const created = await createTenant(app, systemActor, {
    slug,
    name: `Plan ${slug}`,
    owner: { email: `${slug}@example.test`, name: 'Owner' },
    subscription: { planId: plan.id, billingDay: 1 },
  });
  const staff: Actor = {
    kind: 'user',
    userId: created.ownerUserId,
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId: created.id,
    storeRole: 'owner',
  };
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(app, created.id, fn);
  return { ...created, plan, staff, run };
}

const product = (n: number) => ({
  translations: { bn: { title: `পণ্য ${n}` } },
  variant: { price: 10_000, trackInventory: false },
});

describe('hard limits', () => {
  it('refuses product 2 on a 1-product plan, and bringing an archived one back', async () => {
    const s = await storeOnPlan(tiny);
    const first = await s.run((tx) => createProduct(tx, s.staff, product(1)));
    const refused = s.run((tx) => createProduct(tx, s.staff, product(2)));
    await expect(refused).rejects.toMatchObject({
      code: 'plan_limit',
      extensions: { limit: 'products', max: 1, used: 1 },
    });
    await s.run((tx) => archiveProduct(tx, s.staff, first.id));
    const second = await s.run((tx) => createProduct(tx, s.staff, product(3)));
    expect(second.id).toBeDefined();
    await expect(
      s.run((tx) => updateProduct(tx, s.staff, first.id, { status: 'draft' })),
    ).rejects.toMatchObject({ code: 'plan_limit' });
  });

  it('counts members and pending invitations toward staff, and refuses a domain on a plan without', async () => {
    const s = await storeOnPlan(tiny);
    await expect(
      s.run((tx) => invite(tx, s.staff, { email: `x${seq++}@example.test`, role: 'staff' })),
    ).rejects.toMatchObject({ code: 'plan_limit', extensions: { limit: 'staff' } });
    const provider = fakeHostnames();
    await expect(
      s.run((tx) =>
        addDomain(
          tx,
          s.staff,
          { hostname: `shop${seq++}.example.com` },
          { platformDomain: 'managemind.site', storeDomain: 'managemind.store', provider },
        ),
      ),
    ).rejects.toMatchObject({ code: 'plan_limit', extensions: { limit: 'customDomains' } });
    expect(provider.hostnames.size).toBe(0);
  });

  it('never refuses a shopper: orders past the monthly limit still go through', async () => {
    const s = await storeOnPlan(tiny);
    const p = await s.run((tx) => createProduct(tx, s.staff, { ...product(1), status: 'active' }));
    const placed = await s.run((tx) =>
      placeOrder(tx, s.staff, {
        channel: 'admin',
        source: 'facebook',
        lines: [{ variantId: p.variants[0]?.id as string, quantity: 1 }],
        contact: { name: 'Karim', phone: '+8801812345678' },
        address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1' },
        payment: { kind: 'cod' },
        locale: 'bn',
      }),
    );
    expect(placed.id).toBeDefined();
  });
});

describe('features', () => {
  it('refuses turning on what the plan lacks, and gates the reports', async () => {
    const s = await storeOnPlan(tiny);
    await expect(
      s.run((tx) =>
        createPromotion(tx, s.staff, {
          title: { bn: 'ঈদ' },
          kind: 'code',
          code: `EID${seq++}`,
          action: { type: 'percent_off_order', percentBp: 1000 },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'feature_not_in_plan',
      extensions: { feature: 'promotionCoupons' },
    });
    const automatic = await s.run((tx) =>
      createPromotion(tx, s.staff, {
        title: { bn: 'ফ্রি ডেলিভারি' },
        kind: 'automatic',
        action: { type: 'delivery_percent_off', percentBp: 10_000 },
      }),
    );
    expect(automatic.id).toBeDefined();
    await expect(
      s.run((tx) => getReports(tx, s.staff, { from: '2026-10-01', to: '2026-10-02' })),
    ).rejects.toMatchObject({
      code: 'feature_not_in_plan',
      extensions: { feature: 'reports' },
    });
  });

  it('keeps a setting on after a downgrade, and lets the store edit everything else', async () => {
    const s = await storeOnPlan(UNLIMITED);
    const store = await s.run((tx) =>
      updateStoreProfile(tx, s.staff, {
        checkout: { ...checkoutSettings.parse({}), accounts: true },
      }),
    );
    expect(store.checkout.accounts).toBe(true);
    await withPlatform(app, (tx) => updatePlan(tx, systemActor, s.plan.id, { entitlements: tiny }));
    const renamed = await s.run((tx) => updateStoreProfile(tx, s.staff, { name: 'Renamed' }));
    expect(renamed.checkout.accounts).toBe(true);
    // Off, then on again: now it needs the plan.
    await s.run((tx) =>
      updateStoreProfile(tx, s.staff, { checkout: { ...renamed.checkout, accounts: false } }),
    );
    await expect(
      s.run((tx) =>
        updateStoreProfile(tx, s.staff, { checkout: { ...renamed.checkout, accounts: true } }),
      ),
    ).rejects.toMatchObject({ code: 'feature_not_in_plan' });
    // Back on a plan with it.
    await setSubscription(app, systemActor, s.id, {
      planId: (await storeOnPlan(UNLIMITED)).plan.id,
      billingDay: 1,
    });
    await s.run((tx) =>
      updateStoreProfile(tx, s.staff, { checkout: { ...renamed.checkout, accounts: true } }),
    );
  });

  it('treats a store without a subscription as unlimited', async () => {
    const slug = `n${Date.now().toString(36)}${seq++}`;
    const created = await createTenant(app, systemActor, {
      slug,
      name: 'No plan',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    });
    const staff: Actor = {
      kind: 'user',
      userId: created.ownerUserId,
      platformRole: null,
      permissions: permissionsOf('owner'),
      tenantId: created.id,
      storeRole: 'owner',
    };
    for (let i = 0; i < 3; i++) {
      await withTenant(app, created.id, (tx) => createProduct(tx, staff, product(i)));
    }
    await expect(
      withTenant(app, created.id, (tx) =>
        getReports(tx, staff, { from: '2026-10-01', to: '2026-10-02' }),
      ),
    ).resolves.toBeDefined();
  });
});
