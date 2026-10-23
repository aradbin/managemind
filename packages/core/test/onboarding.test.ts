// Onboarding (phase-5b-plan §3.2): a store with its plan, preset and
// defaults in one transaction, and the setup checklist.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  createTenant,
  getSubscription,
  holdSubscription,
  listPlans,
  type Plan,
  seedPlans,
  setSubscription,
  setupChecklist,
  systemActor,
  updatePlan,
  withPlatform,
  withTenant,
} from '../src';
import { connectApp, connectOwner } from './setup';

let app: pg.Client;
let owner: pg.Client;
let plans: Plan[];
beforeAll(async () => {
  [app, owner] = await Promise.all([connectApp(), connectOwner()]);
  await withPlatform(app, (tx) => seedPlans(tx));
  plans = await withPlatform(app, (tx) => listPlans(tx, systemActor));
});
afterAll(() => Promise.all([app.end(), owner.end()]));

let seq = 0;
const unique = () => `o${Date.now().toString(36)}${seq++}`;
const plan = (code: string) => plans.find((p) => p.code === code) as Plan;
const rows = async <T extends Record<string, unknown>>(q: string, params: unknown[]) =>
  (await owner.query<T>(q, params)).rows;
const support: Actor = {
  kind: 'user',
  userId: null,
  platformRole: 'support',
  permissions: new Set(),
};

function newStore(extra: Partial<Parameters<typeof createTenant>[2]> = {}) {
  const slug = unique();
  return createTenant(app, systemActor, {
    slug,
    name: `Store ${slug}`,
    owner: { email: `${slug}@example.test`, name: 'Owner' },
    ...extra,
  });
}

describe('plans', () => {
  it('seeds the placeholder plans once', async () => {
    expect(plans.map((p) => p.code).sort()).toEqual(['growth', 'pilot', 'starter']);
    expect(await withPlatform(app, (tx) => seedPlans(tx))).toEqual([]);
    await expect(withPlatform(app, (tx) => listPlans(tx, support))).resolves.toHaveLength(3);
  });
});

describe('onboarding', () => {
  it('creates the store with its plan, preset, zones and legal drafts in one go', async () => {
    const created = await newStore({
      preset: 'grocery',
      subscription: {
        planId: plan('starter').id,
        billingDay: 5,
        priceOverride: 1_200_00,
        entitlementOverride: { limits: { staff: 5 } },
      },
    });
    expect(created.newOwner).toBe(true);
    const [tenant] = await rows<{
      kind: string;
      entitlements: Plan['entitlements'];
      settings: { theme: { preset: string } };
    }>('select kind, entitlements, settings from platform.tenants where id = $1', [created.id]);
    expect(tenant?.kind).toBe('client');
    expect(tenant?.settings.theme.preset).toBe('grocery');
    expect(tenant?.entitlements.limits).toMatchObject({ staff: 5, products: 300 });
    const sub = await withTenant(app, created.id, (tx) => getSubscription(tx, created.id));
    expect(sub).toMatchObject({ billingDay: 5, priceOverride: 1_200_00, status: 'active' });
    expect(sub?.plan.code).toBe('starter');

    const zones = await rows('select fee from store.delivery_zones where tenant_id = $1', [
      created.id,
    ]);
    expect(zones).toHaveLength(3);
    const pages = await rows<{ kind: string; published: boolean }>(
      'select kind, published from store.pages where tenant_id = $1 order by kind',
      [created.id],
    );
    expect(pages).toEqual(
      ['delivery', 'privacy', 'returns', 'terms'].map((kind) => ({ kind, published: false })),
    );
  });

  it('leaves nothing behind when any part fails', async () => {
    const slug = unique();
    await expect(
      createTenant(app, systemActor, {
        slug,
        name: 'Broken',
        owner: { email: `${slug}@example.test`, name: 'Owner' },
        subscription: { planId: '00000000-0000-7000-8000-000000000000', billingDay: 1 },
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await rows('select 1 from platform.tenants where slug = $1', [slug])).toEqual([]);
    expect(
      await rows('select 1 from platform.users where email = $1', [`${slug}@example.test`]),
    ).toEqual([]);
  });

  it('refuses a billing day past the 28th', async () => {
    await expect(
      newStore({ subscription: { planId: plan('starter').id, billingDay: 31 } }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('makes a trial subscription trialing, and a demo store without one', async () => {
    const trial = await newStore({
      subscription: { planId: plan('pilot').id, billingDay: 1, trialEndsOn: '2026-12-31' },
    });
    const sub = await withTenant(app, trial.id, (tx) => getSubscription(tx, trial.id));
    expect(sub?.status).toBe('trialing');
    const demo = await newStore({ kind: 'demo' });
    expect(await withTenant(app, demo.id, (tx) => getSubscription(tx, demo.id))).toBeNull();
    const [row] = await rows<{ kind: string }>('select kind from platform.tenants where id = $1', [
      demo.id,
    ]);
    expect(row?.kind).toBe('demo');
  });

  it('rewrites subscribers’ entitlements when a plan changes, override kept', async () => {
    const created = await newStore({
      subscription: {
        planId: plan('growth').id,
        billingDay: 3,
        entitlementOverride: { features: { sms: false } },
      },
    });
    const growth = plan('growth');
    await withPlatform(app, (tx) =>
      updatePlan(tx, systemActor, growth.id, {
        entitlements: {
          ...growth.entitlements,
          limits: { ...growth.entitlements.limits, products: 2_500 },
        },
      }),
    );
    const [row] = await rows<{ entitlements: Plan['entitlements'] }>(
      'select entitlements from platform.tenants where id = $1',
      [created.id],
    );
    expect(row?.entitlements.limits.products).toBe(2_500);
    expect(row?.entitlements.features.sms).toBe(false);
    await expect(
      setSubscription(app, support, created.id, { planId: growth.id, billingDay: 3 }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('holds dunning with a reason and an end date', async () => {
    const created = await newStore({
      subscription: { planId: plan('starter').id, billingDay: 9 },
    });
    await expect(
      holdSubscription(app, systemActor, created.id, { until: '2026-11-30' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const held = await holdSubscription(app, systemActor, created.id, {
      until: '2026-11-30',
      reason: 'paying next week, agreed by phone',
    });
    expect(held).toMatchObject({ holdUntil: '2026-11-30' });
    const ended = await holdSubscription(app, systemActor, created.id, { until: null });
    expect(ended).toMatchObject({ holdUntil: null, holdReason: null });
  });
});

describe('setup checklist', () => {
  it('starts with what a new store lacks, and ticks items off from its data', async () => {
    const created = await newStore();
    const first = await withTenant(app, created.id, (tx) => setupChecklist(tx));
    const done = (c: typeof first) =>
      Object.fromEntries(c.items.map((i) => [i.item, i.done])) as Record<string, boolean>;
    expect(done(first)).toMatchObject({
      profile: false,
      logo: false,
      products: false,
      delivery: false,
      payments: true, // cash on delivery is on by default
      legal: false,
      email: true,
      sms: false,
      domain: false,
      terms: true, // no terms published yet
    });
    expect(first.complete).toBe(false);

    await owner.query('update store.delivery_zones set fee = fee + 500 where tenant_id = $1', [
      created.id,
    ]);
    await owner.query(`update store.pages set published = true where tenant_id = $1`, [created.id]);
    const next = await withTenant(app, created.id, (tx) => setupChecklist(tx));
    expect(done(next)).toMatchObject({ delivery: true, legal: true });
    expect(next.items.filter((i) => i.optional).map((i) => i.item)).toEqual(['sms', 'domain']);
  });
});
