// The platform CLI's commands (phase-1-plan §8), as functions so they can be
// tested against a real database. They call the same core services as the
// platform API, as the system actor, so the CLI and the API can't drift.
import {
  type CreateTenantInput,
  createTenant,
  hostEntries,
  listPlans,
  type OutboxEvent,
  relayEvents,
  seedPlans,
  setPlatformRole,
  systemActor,
  withPlatform,
} from '@managemind/core';
import { createDb, schema } from '@managemind/db';
import { AppError, isPlatformRole, type PlatformRole } from '@managemind/shared';
import { TENANT_KINDS, type TenantKind } from '@managemind/shared/billing';
import { THEME_PRESETS, type ThemePreset } from '@managemind/shared/storefront';
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

export interface TenantSetup {
  kind?: TenantKind;
  plan?: string;
  billingDay?: number;
  trialEndsOn?: string;
  preset?: ThemePreset;
}

/**
 * The onboarding options as one argument, so the Platform workflow keeps
 * within GitHub's input limit: `plan=starter,billing-day=5,preset=grocery,
 * kind=client,trial-ends=2026-12-31`. Unknown keys and bad values are refused.
 */
export function parseSetup(value: string | undefined): TenantSetup {
  const out: TenantSetup = {};
  if (!value?.trim()) return out;
  for (const part of value.split(',')) {
    const [rawKey = '', rawValue = ''] = part.split('=');
    const key = rawKey.trim();
    const v = rawValue.trim();
    const bad = (why: string) =>
      new AppError('validation_failed', { detail: `--setup ${key}: ${why}` });
    if (key === 'kind') {
      if (!(TENANT_KINDS as readonly string[]).includes(v)) throw bad('client, demo or test');
      out.kind = v as TenantKind;
    } else if (key === 'plan') {
      if (!/^[a-z][a-z0-9-]{1,30}$/.test(v)) throw bad('a plan code');
      out.plan = v;
    } else if (key === 'billing-day') {
      const day = Number(v);
      if (!Number.isInteger(day) || day < 1 || day > 28) throw bad('1 to 28');
      out.billingDay = day;
    } else if (key === 'trial-ends') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad('YYYY-MM-DD');
      out.trialEndsOn = v;
    } else if (key === 'preset') {
      if (!(THEME_PRESETS as readonly string[]).includes(v)) throw bad(THEME_PRESETS.join(', '));
      out.preset = v as ThemePreset;
    } else {
      throw bad('unknown option (kind, plan, billing-day, trial-ends, preset)');
    }
  }
  return out;
}

/** The placeholder plans (phase-5b-plan Q5), when there are none. */
export async function plansSeed(client: pg.Client): Promise<string[]> {
  const added = await withPlatform(client, (tx) => seedPlans(tx));
  return added.map((p) => p.code);
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
    /** The onboarding screen's options (phase-5b-plan §3.2), from parseSetup. */
    setup?: TenantSetup;
  },
) {
  let events: readonly OutboxEvent[] = [];
  const setup = input.setup ?? {};
  let subscription: CreateTenantInput['subscription'];
  if (setup.plan) {
    const plans = await withPlatform(client, (tx) => listPlans(tx, systemActor));
    const plan = plans.find((p) => p.code === setup.plan);
    if (!plan) {
      throw new AppError('validation_failed', {
        detail: `no plan ${setup.plan}; plans: ${plans.map((p) => p.code).join(', ')}`,
      });
    }
    subscription = {
      planId: plan.id,
      billingDay: setup.billingDay ?? 1,
      ...(setup.trialEndsOn ? { trialEndsOn: setup.trialEndsOn } : {}),
    };
  }
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
      ...(setup.kind ? { kind: setup.kind } : {}),
      ...(setup.preset ? { preset: setup.preset } : {}),
      ...(subscription ? { subscription } : {}),
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
    adminUrl: `https://${domains.adminHost}/`,
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
