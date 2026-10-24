// Platform terms through the API (phase-5b-plan §3.4). Versions take effect
// in the far future, so no other test's owner is blocked; the read-only rule
// itself is core's (core/test/terms.test.ts), and here only its wiring is
// checked, with ownerBlockedByTerms answering for one store.
import { connect } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { browser, enrollAuthenticator, signIn } from './staff';
import { makeEnv, ownerUrl } from './support';

const blockedStores = new Set<string>();
vi.mock('@managemind/core', async (original) => {
  const core = await original<typeof import('@managemind/core')>();
  return {
    ...core,
    ownerBlockedByTerms: async (
      tx: Parameters<typeof core.ownerBlockedByTerms>[0],
      actor: Parameters<typeof core.ownerBlockedByTerms>[1],
    ) =>
      blockedStores.has(tx.tenantId)
        ? actor.storeRole === 'owner'
        : core.ownerBlockedByTerms(tx, actor),
  };
});

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

let owner: pg.Client;
beforeAll(async () => {
  owner = await connect(ownerUrl);
});
afterAll(() => owner.end());

let seq = 0;
const unique = () => `tr${Date.now().toString(36)}${seq++}`;

async function signedIn(email: string, role: 'support' | 'super_admin' | null = null) {
  if (role) {
    await owner.query(
      `insert into platform.users (name, email, email_verified, platform_role) values ('P', $1, true, $2)`,
      [email, role],
    );
  }
  const b = browser(makeEnv());
  expect((await signIn(b, owner, email)).status).toBe(200);
  if (role) await enrollAuthenticator(b);
  return b;
}

async function farFuture() {
  const { rows } = await owner.query<{ at: Date | null }>(
    'select max(effective_at) as at from platform.terms_versions',
  );
  const after = Math.max(rows[0]?.at?.getTime() ?? 0, Date.parse('2095-01-01T00:00:00Z'));
  return new Date(after + 86_400_000).toISOString();
}

describe('platform terms', () => {
  it('publishes a version, which owners see and accept; support only reads', async () => {
    const admin = await signedIn(`${unique()}@example.test`, 'super_admin');
    const support = await signedIn(`${unique()}@example.test`, 'support');
    const body = {
      version: `v-${unique()}`,
      effectiveAt: await farFuture(),
      url: 'https://platform.example.test/terms',
      sha256: 'c'.repeat(64),
    };
    expect((await support.post('/api/platform/terms', body)).status).toBe(403);
    // Without a hash, only a page on the platform's own domain is fetched.
    const elsewhere = await admin.post('/api/platform/terms', {
      ...body,
      sha256: undefined,
      url: 'https://evil.example/terms',
    });
    expect(elsewhere.status).toBe(422);
    const published = await admin.post('/api/platform/terms', body);
    expect(published.status).toBe(201);
    const version = (await published.json()) as Json;

    const slug = unique();
    const created = (await (
      await admin.post('/api/platform/tenants', {
        slug,
        name: 'Terms Shop',
        owner: { email: `${slug}@example.test`, name: 'Owner' },
      })
    ).json()) as Json;
    const o = await signedIn(`${slug}@example.test`);
    await o.call('PUT', '/v1/admin/me/active-store', { tenantId: created.id });
    const pending = (await (await o.get('/v1/admin/terms/pending')).json()) as Json;
    expect(pending).toMatchObject({
      pending: { id: version.id, version: body.version },
      blocking: false,
      canAccept: true,
    });
    expect((await o.post('/v1/admin/terms/accept', { versionId: version.id })).status).toBe(200);
    expect(((await (await o.get('/v1/admin/terms/pending')).json()) as Json).pending).toBeNull();
    const versions = (await (await support.get('/api/platform/terms')).json()) as Json[];
    expect(versions.find((v) => v.id === version.id)?.acceptedStores).toBe(1);
  });

  it("refuses an owner's writes with terms_required while blocked, and reads still work", async () => {
    const admin = await signedIn(`${unique()}@example.test`, 'super_admin');
    const slug = unique();
    const created = (await (
      await admin.post('/api/platform/tenants', {
        slug,
        name: 'Blocked Shop',
        owner: { email: `${slug}@example.test`, name: 'Owner' },
      })
    ).json()) as Json;
    const o = await signedIn(`${slug}@example.test`);
    await o.call('PUT', '/v1/admin/me/active-store', { tenantId: created.id });
    blockedStores.add(created.id);
    try {
      const write = await o.call('PATCH', '/v1/admin/store', { name: 'Renamed' });
      expect(write.status).toBe(423);
      expect(((await write.json()) as Json).code).toBe('terms_required');
      expect((await o.get('/v1/admin/store')).status).toBe(200);
    } finally {
      blockedStores.delete(created.id);
    }
    expect((await o.call('PATCH', '/v1/admin/store', { name: 'Renamed' })).status).toBe(200);
  });
});
