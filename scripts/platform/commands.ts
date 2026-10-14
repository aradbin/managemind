// The platform CLI's commands (phase-1-plan §8), as functions so they can be
// tested against a real database. They call the same core services as the
// platform API, as the system actor, so the CLI and the API can't drift.
import {
  createTenant,
  hostEntries,
  type OutboxEvent,
  relayEvents,
  setPlatformRole,
  systemActor,
  withPlatform,
} from '@managemind/core';
import { createDb, schema } from '@managemind/db';
import { AppError, isPlatformRole, type PlatformRole } from '@managemind/shared';
import { eq } from 'drizzle-orm';
import type pg from 'pg';

/** Where the CLI sends outbox events and KV writes: Cloudflare in CI, fakes in tests. */
export interface PlatformTargets {
  sendEvents(events: readonly OutboxEvent[]): Promise<void>;
  kvPut(entries: readonly { key: string; value: string }[]): Promise<void>;
  kvDelete(keys: readonly string[]): Promise<void>;
}

export interface Domains {
  storeDomain: string;
  adminHost: string;
}

export async function tenantCreate(
  client: pg.Client,
  targets: PlatformTargets | null,
  domains: Domains,
  input: {
    slug: string;
    name: string;
    ownerEmail: string;
    ownerName?: string;
    locale?: 'bn' | 'en';
  },
) {
  let events: readonly OutboxEvent[] = [];
  const created = await createTenant(
    client,
    systemActor,
    {
      slug: input.slug,
      name: input.name,
      ...(input.locale ? { defaultLocale: input.locale } : {}),
      owner: {
        email: input.ownerEmail,
        name: input.ownerName ?? input.ownerEmail.split('@')[0] ?? 'Owner',
      },
    },
    {
      afterCommit: (e) => {
        events = e;
      },
    },
  );
  // Relayed now, so the outbox consumer fills KV at once instead of at the daily sweep.
  const relayed = targets ? await relayEvents(client, events, { send: targets.sendEvents }) : null;
  return {
    ...created,
    adminUrl: `https://${domains.adminHost}/admin/`,
    storeUrl: `https://${created.slug}.${domains.storeDomain}/`,
    relayed: relayed?.dispatched ?? 0,
  };
}

export async function grantRole(
  client: pg.Client,
  input: { email: string; role: string; name?: string },
): Promise<{ userId: string; created: boolean; role: PlatformRole | null }> {
  const role = input.role === 'none' ? null : input.role;
  if (role !== null && !isPlatformRole(role)) {
    throw new AppError('validation_failed', {
      detail: 'role must be super_admin, support or none',
    });
  }
  const email = input.email.trim().toLowerCase();
  return withPlatform(client, async (tx) => {
    const u = schema.users;
    const [existing] = await tx.db.select({ id: u.id }).from(u).where(eq(u.email, email));
    const userId =
      existing?.id ??
      (
        await tx.db
          .insert(u)
          .values({ email, name: input.name ?? email.split('@')[0] ?? email })
          .returning({ id: u.id })
      )[0]?.id;
    if (!userId) throw new AppError('internal', { detail: 'user insert returned no row' });
    await setPlatformRole(tx, systemActor, userId, role);
    return { userId, created: !existing, role };
  });
}

/** Rewrites the host keys of one store, or of every store. */
export async function kvSync(
  client: pg.Client,
  targets: PlatformTargets,
  storeDomain: string,
  tenantId?: string,
): Promise<{ stores: number; put: number; deleted: number }> {
  const db = createDb(client);
  const ids = tenantId
    ? [tenantId]
    : (await db.select({ id: schema.tenants.id }).from(schema.tenants)).map((t) => t.id);
  let put = 0;
  let deleted = 0;
  for (const id of ids) {
    const entries = await hostEntries(db, id, storeDomain);
    await targets.kvPut(entries.put.map((e) => ({ key: e.key, value: JSON.stringify(e.value) })));
    await targets.kvDelete(entries.delete);
    put += entries.put.length;
    deleted += entries.delete.length;
  }
  return { stores: ids.length, put, deleted };
}
