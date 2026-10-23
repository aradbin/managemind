// Platform terms (phase-5b-plan §3.4, Q7). Versions here take effect in the
// far future, so other test files' owners are never blocked; the clock is
// passed in to see a version in force.
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  acceptTerms,
  createTenant,
  listTermsVersions,
  ownerBlockedByTerms,
  publishTerms,
  setupChecklist,
  systemActor,
  termsStatus,
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
async function store() {
  const slug = `tm${Date.now().toString(36)}${seq++}`;
  const created = await createTenant(app, systemActor, {
    slug,
    name: `Terms ${slug}`,
    owner: { email: `${slug}@example.test`, name: 'Owner' },
  });
  const as = (role: 'owner' | 'manager', extra: Partial<Actor> = {}): Actor => ({
    kind: 'user',
    userId: created.ownerUserId,
    platformRole: null,
    permissions: permissionsOf(role),
    tenantId: created.id,
    storeRole: role,
    ...extra,
  });
  return { ...created, as };
}

/** A version effective far ahead of every earlier one. */
async function publish() {
  const { rows } = await owner.query<{ at: Date | null }>(
    'select max(effective_at) as at from platform.terms_versions',
  );
  const after = Math.max(rows[0]?.at?.getTime() ?? 0, Date.parse('2090-01-01T00:00:00Z'));
  const effectiveAt = new Date(after + 86_400_000);
  const version = await withPlatform(app, (tx) =>
    publishTerms(tx, systemActor, {
      version: `t-${Date.now().toString(36)}-${seq++}`,
      effectiveAt,
      url: 'https://platform.example.test/terms',
      sha256: 'a'.repeat(64),
    }),
  );
  return { version, before: new Date(after), during: new Date(after + 2 * 86_400_000) };
}

describe('platform terms', () => {
  it('asks owners from publication, and makes them read-only from the effective date', async () => {
    const s = await store();
    const { version, before, during } = await publish();
    const status = await withTenant(app, s.id, (tx) => termsStatus(tx, s.id, before));
    expect(status).toMatchObject({ pending: { id: version.id }, blocking: false });
    const blocked = (actor: Actor, now: Date) =>
      withTenant(app, s.id, (tx) => ownerBlockedByTerms(tx, actor, now));
    expect(await blocked(s.as('owner'), before)).toBe(false);
    expect(await blocked(s.as('owner'), during)).toBe(true);
    // Managers, and owners working through a support grant, are never blocked.
    expect(await blocked(s.as('manager'), during)).toBe(false);
    expect(await blocked(s.as('owner', { supportGrantId: 'g' }), during)).toBe(false);

    // A manager can't accept for the store; an owner can, once.
    const accept = (actor: Actor) =>
      withTenant(app, s.id, (tx) =>
        acceptTerms(tx, actor, { versionId: version.id, ip: '203.0.113.7', userAgent: 'test' }),
      );
    await expect(accept(s.as('manager'))).rejects.toMatchObject({ code: 'forbidden' });
    await accept(s.as('owner'));
    await accept(s.as('owner'));
    expect(await blocked(s.as('owner'), during)).toBe(false);
    const { rows } = await owner.query(
      'select user_email, host(ip) as ip from platform.terms_acceptances where tenant_id = $1',
      [s.id],
    );
    expect(rows).toEqual([
      { user_email: expect.stringContaining('@example.test'), ip: '203.0.113.7' },
    ]);
    const checklist = await withTenant(app, s.id, (tx) => setupChecklist(tx));
    expect(checklist.items.find((i) => i.item === 'terms')?.done).toBe(true);

    const versions = await withPlatform(app, (tx) => listTermsVersions(tx, systemActor));
    expect(versions.find((v) => v.id === version.id)?.acceptedStores).toBe(1);
  });

  it('refuses a version that takes effect before the current one, or a taken name', async () => {
    const { version } = await publish();
    await expect(
      withPlatform(app, (tx) =>
        publishTerms(tx, systemActor, {
          version: 'earlier',
          effectiveAt: new Date('2090-01-01T00:00:00Z'),
          url: 'https://platform.example.test/terms',
          sha256: 'b'.repeat(64),
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      withPlatform(app, (tx) =>
        publishTerms(tx, systemActor, {
          version: version.version,
          effectiveAt: new Date('2200-01-01T00:00:00Z'),
          url: 'https://platform.example.test/terms',
          sha256: 'b'.repeat(64),
        }),
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});
