// The platform API (phase-1-plan §5.3, §7.1) and the dev mailbox.
import { createTenant, systemActor } from '@managemind/core';
import { connect } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { browser, signIn } from './staff';
import { appUrl, makeCtx, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

let owner: pg.Client;
let app: pg.Client;
beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
});
afterAll(() => Promise.all([owner.end(), app.end()]));

let seq = 0;
const unique = () => `p${Date.now().toString(36)}${seq++}`;

/** A signed-in platform user; `twoFactor` marks them enrolled, as after setup. */
async function platformUser(role: 'support' | 'super_admin' | null, twoFactor = true) {
  const email = `${unique()}@example.test`;
  await owner.query(
    `insert into platform.users (name, email, email_verified, platform_role) values ('Platform', $1, true, $2)`,
    [email, role],
  );
  const b = browser(makeEnv());
  expect((await signIn(b, owner, email)).status).toBe(200);
  if (twoFactor)
    await owner.query(`update platform.users set two_factor_enabled = true where email = $1`, [
      email,
    ]);
  return Object.assign(b, { email });
}

async function store() {
  const slug = unique();
  const created = await createTenant(app, systemActor, {
    slug,
    name: `Store ${slug}`,
    owner: { email: `${slug}@example.test`, name: 'Owner' },
  });
  return { ...created, ownerEmail: `${slug}@example.test` };
}

describe('platform API access', () => {
  it('needs a platform role and two-factor login', async () => {
    expect((await (await platformUser(null)).get('/api/platform/tenants')).status).toBe(403);
    const notEnrolled = await platformUser('super_admin', false);
    const res = await notEnrolled.get('/api/platform/tenants');
    expect(res.status).toBe(403);
    expect(((await res.json()) as Json).code).toBe('two_factor_required');
    expect((await browser().get('/api/platform/tenants')).status).toBe(401);
  });

  it('lets support read the registry but not change it', async () => {
    const s = await store();
    const support = await platformUser('support');
    const list = (await (await support.get(`/api/platform/tenants?q=${s.slug}`)).json()) as Json;
    expect(list.items.map((t: Json) => t.slug)).toEqual([s.slug]);
    const detail = (await (await support.get(`/api/platform/tenants/${s.id}`)).json()) as Json;
    expect(detail).toMatchObject({
      slug: s.slug,
      memberCount: 1,
      owners: [{ email: s.ownerEmail }],
    });
    expect(
      (await support.post(`/api/platform/tenants/${s.id}/suspend`, { reason: 'nope' })).status,
    ).toBe(403);
    expect((await support.get('/api/platform/staff')).status).toBe(403);
    expect((await support.get('/api/platform/audit-log')).status).toBe(403);
  });
});

describe('platform API for super admins', () => {
  it('creates a store with its owner, refuses a taken slug, and suspends and reactivates it', async () => {
    const admin = await platformUser('super_admin');
    const slug = unique();
    const input = {
      slug,
      name: 'New Shop',
      owner: { email: `${slug}@example.test`, name: 'New Owner' },
    };
    const created = await admin.post('/api/platform/tenants', input);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as Json;
    expect((await admin.post('/api/platform/tenants', input)).status).toBe(409);

    expect(
      (await admin.post(`/api/platform/tenants/${id}/suspend`, { reason: 'abuse report' })).status,
    ).toBe(200);
    expect(((await (await admin.get(`/api/platform/tenants/${id}`)).json()) as Json).status).toBe(
      'suspended',
    );
    const back = await admin.post(`/api/platform/tenants/${id}/reactivate`, {});
    expect((await back.json()) as Json).toEqual({ from: 'suspended', to: 'active' });

    const audit = (await (await admin.get('/api/platform/audit-log?limit=100')).json()) as Json;
    const mine = audit.items.filter((e: Json) => e.tenantId === id).map((e: Json) => e.action);
    expect(mine).toEqual(['tenant.reactivate', 'tenant.suspend', 'tenant.created']);
  });

  it('lists platform staff and changes roles', async () => {
    const admin = await platformUser('super_admin');
    const support = await platformUser('support');
    const staff = (await (await admin.get('/api/platform/staff')).json()) as Json;
    const target = staff.find((u: Json) => u.email === support.email);
    expect(target).toMatchObject({ platformRole: 'support', twoFactorEnabled: true });
    expect(
      (await admin.call('PUT', `/api/platform/staff/${target.id}/role`, { role: null })).status,
    ).toBe(204);
    // Changing a role signs the user out.
    expect((await support.get('/api/platform/tenants')).status).toBe(401);
  });
});

describe('support access', () => {
  it('grants Viewer to support with a reason, emails the owners, and can be revoked', async () => {
    const s = await store();
    const support = await platformUser('support');
    const denied = await support.post(`/api/platform/tenants/${s.id}/support-access`, {
      role: 'manager',
      reason: 'needs a setting changed',
      minutes: 30,
    });
    expect(denied.status).toBe(403);
    const res = await support.post(`/api/platform/tenants/${s.id}/support-access`, {
      role: 'viewer',
      reason: 'customer asked for help',
      minutes: 60,
    });
    expect(res.status).toBe(201);
    const grant = (await res.json()) as Json;
    const mail = await owner.query<{ subject: string; text: string }>(
      `select subject, text from platform.dev_emails where "to" = $1`,
      [s.ownerEmail],
    );
    expect(mail.rows).toHaveLength(1);
    expect(mail.rows[0]?.text).toContain('customer asked for help');

    expect(
      (await support.call('PUT', '/api/admin/me/active-store', { tenantId: s.id })).status,
    ).toBe(200);
    expect((await support.call('DELETE', `/api/platform/support-access/${grant.id}`)).status).toBe(
      204,
    );
    expect((await support.get('/api/admin/store')).status).toBe(403);
  });
});

describe('dev mailbox', () => {
  const read = (env: Parameters<typeof makeEnv>[0], headers: Record<string, string> = {}) =>
    createApp().request(
      '/v1/_dev/mailbox?to=someone@example.test',
      { headers },
      makeEnv(env),
      makeCtx(),
    );

  it('is closed in production and, without the token, on previews', async () => {
    expect(
      (await read({ ENVIRONMENT: 'production', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'x' }))
        .status,
    ).toBe(404);
    expect((await read({ ENVIRONMENT: 'preview' })).status).toBe(404);
    const token = 'preview-dev-token-0123456789';
    expect(
      (
        await read(
          { ENVIRONMENT: 'preview', DEV_TOKEN: token },
          { 'x-dev-token': 'wrong-token-000000' },
        )
      ).status,
    ).toBe(404);
    const open = await read({ ENVIRONMENT: 'preview', DEV_TOKEN: token }, { 'x-dev-token': token });
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual([]);
  });

  it('shows captured emails, newest first', async () => {
    const s = await store();
    const support = await platformUser('support');
    await support.post(`/api/platform/tenants/${s.id}/support-access`, {
      role: 'viewer',
      reason: 'customer asked for help',
      minutes: 5,
    });
    const res = await createApp().request(
      `/v1/_dev/mailbox?to=${encodeURIComponent(s.ownerEmail)}`,
      {},
      makeEnv({ ENVIRONMENT: 'development' }),
      makeCtx(),
    );
    const mails = (await res.json()) as Json;
    expect(mails).toHaveLength(1);
    // The owner's language is the store's default, Bangla.
    expect(mails[0].subject).toContain(`Store ${s.slug}`);
  });
});
