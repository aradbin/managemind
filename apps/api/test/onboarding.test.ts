// Onboarding and the store lifecycle through the platform API
// (phase-5b-plan §3.1, §3.2, §3.5, §6.1).
import { connect } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, enrollAuthenticator, signIn, totp } from './staff';
import { appUrl, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

let owner: pg.Client;
let app: pg.Client;
beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
});
afterAll(() => Promise.all([owner.end(), app.end()]));

let seq = 0;
const unique = () => `n${Date.now().toString(36)}${seq++}`;

async function platformUser(role: 'support' | 'super_admin') {
  const email = `${unique()}@example.test`;
  await owner.query(
    `insert into platform.users (name, email, email_verified, platform_role) values ('Platform', $1, true, $2)`,
    [email, role],
  );
  const b = browser(makeEnv());
  expect((await signIn(b, owner, email)).status).toBe(200);
  const uri = await enrollAuthenticator(b);
  return Object.assign(b, { email, code: () => totp(uri) });
}

async function plans(b: Awaited<ReturnType<typeof platformUser>>) {
  const res = await b.get('/api/platform/plans');
  expect(res.status).toBe(200);
  return (await res.json()) as Json[];
}

describe('onboarding through the platform screen', () => {
  it('checks the address as it is typed', async () => {
    const admin = await platformUser('super_admin');
    const slug = unique();
    const check = async (s: string) =>
      (await (await admin.get(`/api/platform/tenants/slug-check?slug=${s}`)).json()) as Json;
    expect(await check(slug)).toEqual({ available: true, reason: null });
    expect(await check('admin')).toEqual({ available: false, reason: 'slug_reserved' });
    expect(await check('demo-fashion')).toEqual({ available: false, reason: 'slug_taken' });
    expect(await check('a')).toEqual({ available: false, reason: 'invalid' });
  });

  it('creates a store with its plan and preset, and emails the owner', async () => {
    const admin = await platformUser('super_admin');
    await owner.query(
      `insert into platform.plans (code, name, monthly_price, setup_fee, entitlements)
       select 'test-' || substr(md5(random()::text), 1, 8), '{"bn":"পরীক্ষা","en":"Test"}', 100000, 0,
              '{"limits":{"products":10,"staff":2,"ordersPerMonth":100,"emailsPerMonth":100,"storageMb":100,"customDomains":0},
                "features":{"sslcommerz":false,"sms":false,"shopperAccounts":true,"promotionCoupons":true,"promotionAutomatic":true,"promotionBuyXGetY":false,"promotionFreeDelivery":true,"reports":true,"customEmailKey":false}}'
        where not exists (select 1 from platform.plans where code like 'test-%')`,
    );
    const plan = (await plans(admin)).find((p: Json) => p.code.startsWith('test-'));
    const slug = unique();
    const res = await admin.post('/api/platform/tenants', {
      slug,
      name: 'Tea & Co',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
      preset: 'grocery',
      subscription: { planId: plan.id, billingDay: 12, trialEndsOn: '2026-12-31' },
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as Json;
    const detail = (await (await admin.get(`/api/platform/tenants/${id}`)).json()) as Json;
    expect(detail).toMatchObject({ plan: plan.code, kind: 'client', setup: null });
    const sub = (await (
      await admin.get(`/api/platform/tenants/${id}/subscription`)
    ).json()) as Json;
    expect(sub).toMatchObject({ billingDay: 12, status: 'trialing', plan: { code: plan.code } });
    const mail = await owner.query<{ subject: string; text: string }>(
      `select subject, text from platform.dev_emails where "to" = $1`,
      [`${slug}@example.test`],
    );
    expect(mail.rows[0]?.subject).toBe('Tea & Co is ready on managemind');
    expect(mail.rows[0]?.text).toContain(`https://${slug}.stores.example.test`);

    // The health check fills the checklist the store list shows.
    const health = (await (
      await admin.post(`/api/platform/tenants/${id}/health/refresh`)
    ).json()) as Json;
    expect(health.checklist).toMatchObject({ total: 8, complete: false });
    const listed = (await (await admin.get(`/api/platform/tenants?q=${slug}`)).json()) as Json;
    expect(listed.items[0].setup).toEqual({ done: health.checklist.done, total: 8 });
  });

  it('lets support read plans and health, but not change a plan or subscription', async () => {
    const support = await platformUser('support');
    const [first] = await plans(support);
    expect(
      (await support.call('PATCH', `/api/platform/plans/${first.id}`, { offered: false })).status,
    ).toBe(403);
    const { rows } = await owner.query<{ id: string }>(
      `select id from platform.tenants where slug = 'demo-fashion'`,
    );
    const id = rows[0]?.id;
    expect(
      (
        await support.call('PUT', `/api/platform/tenants/${id}/subscription`, {
          planId: first.id,
          billingDay: 1,
        })
      ).status,
    ).toBe(403);
    expect((await support.post(`/api/platform/tenants/${id}/health/refresh`)).status).toBe(200);
  });
});

describe('closing and reopening', () => {
  it('closes with the slug, a reason and a fresh code; the store answers 410; reopens', async () => {
    const admin = await platformUser('super_admin');
    const slug = unique();
    const created = (await (
      await admin.post('/api/platform/tenants', {
        slug,
        name: 'Closing Shop',
        owner: { email: `${slug}@example.test`, name: 'Owner' },
      })
    ).json()) as Json;
    const close = (body: Json) => admin.post(`/api/platform/tenants/${created.id}/close`, body);
    const noCode = await close({ slug, reason: 'client left', code: '000000' });
    expect(noCode.status).toBe(403);
    expect(((await noCode.json()) as Json).code).toBe('two_factor_required');
    expect((await close({ slug: 'other', reason: 'client left', code: admin.code() })).status).toBe(
      422,
    );
    const closed = await close({ slug, reason: 'client left', code: admin.code() });
    expect(closed.status).toBe(200);
    const out = (await closed.json()) as Json;
    expect(out).toMatchObject({ from: 'active', to: 'closed' });
    expect(Date.parse(out.purgeAfter) - Date.parse(out.closedAt)).toBe(30 * 86_400_000);

    // The storefront learns the store has closed; its pages are gone.
    const context = await admin.call('GET', '/v1/store/context', undefined, {
      'x-forwarded-host': `${slug}.stores.example.test`,
    });
    expect(((await context.json()) as Json).status).toBe('closed');
    const page = await admin.call('GET', '/v1/store/pages/home', undefined, {
      'x-forwarded-host': `${slug}.stores.example.test`,
    });
    expect(page.status).toBe(410);
    expect(((await page.json()) as Json).code).toBe('tenant_closed');

    // Its owner can't open it in the admin.
    const ownerBrowser = browser(makeEnv());
    await signIn(ownerBrowser, owner, `${slug}@example.test`);
    const mine = (await (await ownerBrowser.get('/v1/admin/me')).json()) as Json;
    expect(mine.stores).toEqual([]);
    const open = await ownerBrowser.call('PUT', '/v1/admin/me/active-store', {
      tenantId: created.id,
    });
    expect(open.status).toBe(410);

    const reopened = await admin.post(`/api/platform/tenants/${created.id}/reopen`, {
      reason: 'client came back',
    });
    expect((await reopened.json()) as Json).toEqual({ from: 'closed', to: 'active' });
    const after = (await (await ownerBrowser.get('/v1/admin/me')).json()) as Json;
    expect(after.stores.map((s: Json) => s.tenantId)).toEqual([created.id]);
  });
});

describe("the owner's setup checklist", () => {
  it("shows what's missing, and the subdomain can be kept as final", async () => {
    const admin = await platformUser('super_admin');
    const slug = unique();
    const created = (await (
      await admin.post('/api/platform/tenants', {
        slug,
        name: 'Checklist Shop',
        owner: { email: `${slug}@example.test`, name: 'Owner' },
      })
    ).json()) as Json;
    const b = browser(makeEnv());
    await signIn(b, owner, `${slug}@example.test`);
    await b.call('PUT', '/v1/admin/me/active-store', { tenantId: created.id });
    const first = (await (await b.get('/v1/admin/setup')).json()) as Json;
    const item = (list: Json, name: string) => list.items.find((i: Json) => i.item === name);
    expect(item(first, 'domain')).toEqual({ item: 'domain', done: false, optional: true });
    expect(
      (await b.call('PATCH', '/v1/admin/store', { setup: { subdomainFinal: true } })).status,
    ).toBe(200);
    const next = (await (await b.get('/v1/admin/setup')).json()) as Json;
    expect(item(next, 'domain').done).toBe(true);
  });
});
