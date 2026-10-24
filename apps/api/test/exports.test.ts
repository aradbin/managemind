// Store exports through the API (phase-5b-plan §3.9, §3.10): owners and
// super admins ask for one, the job row is what the workflow runs, the link
// is signed and expires, and the owners are emailed it.
import { connect } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { handleQueue } from '../src/jobs';
import { exportTokenValid, exportUrl } from '../src/tenant-jobs';
import { browser, enrollAuthenticator, signIn } from './staff';
import { makeCtx, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

const env = makeEnv();
let owner: pg.Client;
beforeAll(async () => {
  owner = await connect(ownerUrl);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => owner.end());

let seq = 0;
const unique = () => `ex${Date.now().toString(36)}${seq++}`;

async function signedIn(email: string, role: 'support' | 'super_admin' | null = null) {
  if (role) {
    await owner.query(
      `insert into platform.users (name, email, email_verified, platform_role) values ('P', $1, true, $2)`,
      [email, role],
    );
  }
  const b = browser(env);
  expect((await signIn(b, owner, email)).status).toBe(200);
  if (role) await enrollAuthenticator(b);
  return b;
}

async function setup() {
  const admin = await signedIn(`${unique()}@example.test`, 'super_admin');
  const slug = unique();
  const created = (await (
    await admin.post('/api/platform/tenants', {
      slug,
      name: 'Export Shop',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).json()) as Json;
  const o = await signedIn(`${slug}@example.test`);
  await o.call('PUT', '/v1/admin/me/active-store', { tenantId: created.id });
  return { admin, o, id: created.id as string, slug };
}

/** What the workflow does when an export finishes. */
async function finish(jobId: string, tenantId: string) {
  const key = `exports/tenants/${tenantId}/${jobId}.zip`;
  await env.FILES.put(key, new Uint8Array([80, 75, 5, 6]));
  await owner.query(
    `update platform.tenant_jobs set status = 'succeeded', file_key = $2, finished_at = now() where id = $1`,
    [jobId, key],
  );
}

const download = (url: string) => {
  const u = new URL(url);
  return createApp().request(`${u.pathname}${u.search}`, {}, env, makeCtx());
};

describe('store exports', () => {
  it('lets an owner ask once a day, and serves the file to the signed link only', async () => {
    const { o, id } = await setup();
    expect(await (await o.get('/v1/admin/export')).json()).toBeNull();
    const asked = await o.post('/v1/admin/export');
    expect(asked.status).toBe(202);
    const job = (await asked.json()) as Json;
    expect(job).toMatchObject({ kind: 'export', status: 'pending', downloadUrl: null });
    // Asking again while it's open answers with the same job.
    expect(((await (await o.post('/v1/admin/export')).json()) as Json).id).toBe(job.id);

    await finish(job.id, id);
    const ready = (await (await o.get('/v1/admin/export')).json()) as Json;
    expect(ready.status).toBe('succeeded');
    expect(ready.downloadUrl).toMatch(
      new RegExp(
        `^https://admin\\.platform\\.example\\.test/v1/exports/${job.id}\\?expires=\\d+&token=`,
      ),
    );
    const res = await download(ready.downloadUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([80, 75, 5, 6]));
    // A changed token, or another job's, gets nothing.
    expect((await download(ready.downloadUrl.replace(/token=./, 'token=x'))).status).toBe(404);
    expect((await download(ready.downloadUrl.replace(job.id, id))).status).toBe(404);

    // Done today: the next one waits a day.
    expect((await o.post('/v1/admin/export')).status).toBe(429);
  });

  it('rejects an expired link', async () => {
    const jobId = '0199d000-0000-7000-8000-00000000e001';
    const past = new Date(Date.now() - 60_000);
    const url = new URL(await exportUrl(env, jobId, past));
    const token = url.searchParams.get('token') ?? '';
    const expires = url.searchParams.get('expires') ?? '';
    expect(await exportTokenValid(env, jobId, expires, token, past.getTime() - 1000)).toBe(true);
    expect(await exportTokenValid(env, jobId, expires, token)).toBe(false);
  });

  it('lets a super admin export any store; support sees the jobs but not the link', async () => {
    const { admin, id } = await setup();
    const support = await signedIn(`${unique()}@example.test`, 'support');
    expect((await support.post(`/api/platform/tenants/${id}/export`)).status).toBe(403);
    const asked = await admin.post(`/api/platform/tenants/${id}/export`);
    expect(asked.status).toBe(202);
    const jobs = (await (await support.get(`/api/platform/tenants/${id}/jobs`)).json()) as Json;
    expect(jobs.map((j: Json) => [j.kind, j.status])).toEqual([['export', 'pending']]);
    // Support staff see a store's data only through a granted support session.
    await finish(jobs[0].id, id);
    const seen = async (b: typeof admin) =>
      ((await (await b.get(`/api/platform/tenants/${id}/jobs`)).json()) as Json)[0].downloadUrl;
    expect(await seen(support)).toBeNull();
    expect(await seen(admin)).toMatch(/\/v1\/exports\//);
  });

  it('emails the owners the link when an export is ready', async () => {
    const { admin, id, slug } = await setup();
    await admin.post(`/api/platform/tenants/${id}/export`);
    const [job] = (await (await admin.get(`/api/platform/tenants/${id}/jobs`)).json()) as Json[];
    await finish(job.id, id);
    const ctx = makeCtx();
    await handleQueue(
      {
        queue: 'managemind-outbox',
        messages: [
          {
            id: 'e1',
            attempts: 1,
            body: {
              id: '0199d000-0000-7000-8000-00000000e002',
              eventType: 'tenant.exported',
              tenantId: id,
              aggregateType: 'tenant_job',
              aggregateId: job.id,
              payload: {
                jobId: job.id,
                expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
              },
            },
            ack: () => {},
            retry: () => {},
          },
        ],
      } as unknown as MessageBatch<never>,
      env,
      ctx,
    );
    await ctx.settle();
    const mail = await owner.query<{ subject: string; text: string }>(
      `select subject, text from platform.dev_emails where "to" = $1 and subject like '%download%'`,
      [`${slug}@example.test`],
    );
    expect(mail.rows).toHaveLength(1);
    expect(mail.rows[0]?.text).toContain(`/v1/exports/${job.id}?expires=`);
  });
});
