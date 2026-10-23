// The purge through the platform API (phase-5b-plan §3.11): a closed store's
// purge starts with its dry run, and the approval needs the slug and a fresh
// two-factor code. The purge itself is scripts/jobs/purge.test.ts. Also the
// queue's check that drops messages for stores that are gone (point 4).
import type { OutboxEvent } from '@managemind/core';
import { connect } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { liveMessages } from '../src/gone-stores';
import { browser, enrollAuthenticator, signIn, totp } from './staff';
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
const unique = () => `pr${Date.now().toString(36)}${seq++}`;

async function platformUser(role: 'support' | 'super_admin') {
  const email = `${unique()}@example.test`;
  await owner.query(
    `insert into platform.users (name, email, email_verified, platform_role) values ('P', $1, true, $2)`,
    [email, role],
  );
  const b = browser(env);
  expect((await signIn(b, owner, email)).status).toBe(200);
  const uri = await enrollAuthenticator(b);
  return Object.assign(b, { code: () => totp(uri) });
}

async function testStore(admin: Awaited<ReturnType<typeof platformUser>>) {
  const slug = unique();
  const created = (await (
    await admin.post('/api/platform/tenants', {
      slug,
      name: 'Old Test Shop',
      kind: 'test',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).json()) as Json;
  return { id: created.id as string, slug };
}

describe('the purge through the platform API', () => {
  it('starts with a dry run on a closed store, and approves with the slug and a fresh code', async () => {
    const admin = await platformUser('super_admin');
    const support = await platformUser('support');
    const { id, slug } = await testStore(admin);
    const path = `/api/platform/tenants/${id}/purge`;
    // Open stores aren't purged.
    expect((await admin.post(path)).status).toBe(409);
    expect(
      (
        await admin.post(`/api/platform/tenants/${id}/close`, {
          slug,
          reason: 'done',
          code: admin.code(),
        })
      ).status,
    ).toBe(200);
    expect((await support.post(path)).status).toBe(403);
    const started = await admin.post(path);
    expect(started.status).toBe(202);
    const purge = (await started.json()) as Json;
    expect(purge).toMatchObject({
      dryRun: null,
      approvedAt: null,
      job: { kind: 'purge', status: 'pending' },
    });
    // Asking again answers with the same purge.
    expect(((await (await admin.post(path)).json()) as Json).id).toBe(purge.id);

    // Another super admin approves: the two-factor limit counts each user's checks.
    const approver = await platformUser('super_admin');
    const approve = (body: Json) =>
      approver.post(`${path}/approve`, { purgeId: purge.id, ...body });
    // Not before the dry run has finished.
    expect((await approve({ slug, code: approver.code() })).status).toBe(409);
    await owner.query(
      `update platform.tenant_purges set dry_run = '{"storeRows":{}}' where id = $1`,
      [purge.id],
    );
    expect((await approve({ slug, code: '000000' })).status).toBe(403);
    expect((await approve({ slug: 'other-shop', code: approver.code() })).status).toBe(422);
    const approved = await approve({ slug, code: approver.code() });
    expect(approved.status).toBe(202);
    expect(((await approved.json()) as Json).approvedAt).not.toBeNull();
    // Support reads it.
    expect(((await (await support.get(path)).json()) as Json).id).toBe(purge.id);
    const audit = await owner.query(
      `select 1 from platform.audit_log where tenant_id = $1 and action = 'tenant.purge_approved'`,
      [id],
    );
    expect(audit.rowCount).toBe(1);
  });
});

describe('messages for stores that are gone', () => {
  it('drops a purged store’s messages, and keeps a closed store’s lifecycle and billing', async () => {
    const admin = await platformUser('super_admin');
    const [open, closed, purged] = [
      await testStore(admin),
      await testStore(admin),
      await testStore(admin),
    ];
    await owner.query(
      `update platform.tenants set status = 'closed', closed_at = now(), purge_after = now() where id = $1`,
      [closed.id],
    );
    await owner.query(
      `update platform.tenants set status = 'purged', closed_at = now(), purge_after = now(), purged_at = now()
        where id = $1`,
      [purged.id],
    );
    const acked: string[] = [];
    const message = (id: string, tenantId: string, eventType: string) => ({
      id,
      attempts: 1,
      body: { id, tenantId, eventType } as unknown as OutboxEvent,
      ack: () => acked.push(id),
      retry: () => {},
    });
    const batch = {
      queue: 'managemind-outbox',
      messages: [
        message('a', open.id, 'order.placed'),
        message('b', closed.id, 'order.placed'),
        message('c', closed.id, 'tenant.exported'),
        message('d', closed.id, 'invoice.issued'),
        message('e', purged.id, 'tenant.status_changed'),
      ],
    } as unknown as MessageBatch<OutboxEvent>;
    const live = await liveMessages(batch, env, makeCtx(), 'outbox');
    expect(live.messages.map((m) => m.id)).toEqual(['a', 'c', 'd']);
    expect(acked).toEqual(['b', 'e']);
  });
});
