// Store commands (phase-1-plan §4.4, §6.2): creating a store, reading and
// editing its profile, and suspending or reactivating it. Each runs in one
// tenant transaction, writes its audit entries and emits its event there.
import { schema } from '@managemind/db';
import { AppError, checkSlug, uuidv7 } from '@managemind/shared';
import { PURGE_GRACE_DAYS, type SuspensionReason } from '@managemind/shared/billing';
import { type NotificationSettings, notificationSettings } from '@managemind/shared/notifications';
import {
  type CheckoutSettings,
  type CodSettings,
  checkoutSettings,
  codSettings,
  type FraudSettings,
  fraudSettings,
  type ReturnSettings,
  returnSettings,
} from '@managemind/shared/orders';
import {
  defaultTenantSettings,
  type StoreProfile,
  type TaxSettings,
  type TenantSettings,
  taxSettings,
  tenantSettings,
} from '@managemind/shared/settings';
import { type StorefrontSettings, storefrontSettings } from '@managemind/shared/storefront';
import { eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, auditActor, authorize, requirePlatformRole } from '../access';
import { recordAudit } from '../audit';
import { emit } from '../outbox';
import { recordPlatformAudit } from '../platform';
import { type DbClient, type TenantTx, type WithTenantOptions, withTenant } from '../tenant';
import { tenantLifecycle } from './lifecycle';

type Locale = 'bn' | 'en';

export interface CreateTenantInput {
  slug: string;
  name: string;
  defaultLocale?: Locale;
  /** The first Owner: an existing user with this email, or a new one. */
  owner: { email: string; name: string };
}

export interface CreatedTenant {
  id: string;
  slug: string;
  ownerUserId: string;
}

/** The Postgres error under a Drizzle query error, if any. */
const pgError = (e: unknown) => {
  const err = (e as { cause?: unknown })?.cause ?? e;
  return err as { code?: string; constraint?: string };
};

/**
 * Creates a store with its first Owner in one transaction: the tenant with
 * default settings, the owner's user (reused if the email exists), the Owner
 * membership, the store's defaults, both audit entries and `tenant.created`.
 */
export async function createTenant(
  client: DbClient,
  actor: Actor,
  input: CreateTenantInput,
  options: WithTenantOptions = {},
): Promise<CreatedTenant> {
  requirePlatformRole(actor, 'super_admin');
  const slugCheck = checkSlug(input.slug);
  if (!slugCheck.ok) {
    if (slugCheck.code === 'reserved') throw new AppError('slug_reserved');
    throw new AppError('validation_failed', {
      fields: [{ path: 'slug', code: 'invalid', message: 'not a valid store address' }],
    });
  }
  const slug = slugCheck.slug;
  const name = input.name.trim();
  const email = input.owner.email.trim().toLowerCase();
  const id = uuidv7();
  const defaultLocale = input.defaultLocale ?? 'bn';

  try {
    return await withTenant(
      client,
      id,
      async (tx) => {
        await tx.db
          .insert(schema.tenants)
          .values({ id, slug, name, defaultLocale, settings: defaultTenantSettings() });

        const u = schema.users;
        const [existing] = await tx.db.select({ id: u.id }).from(u).where(eq(u.email, email));
        const ownerUserId =
          existing?.id ??
          (
            await tx.db
              .insert(u)
              .values({ email, name: input.owner.name.trim(), locale: defaultLocale })
              .returning({ id: u.id })
          )[0]?.id;
        if (!ownerUserId)
          throw new AppError('internal', { detail: 'owner insert returned no row' });

        await tx.db.insert(schema.memberships).values({
          tenantId: id,
          userId: ownerUserId,
          role: 'owner',
          invitedBy: actor.userId,
        });
        // What every store starts with: the brand attribute and a stock location (migration 0011).
        await tx.db.execute(sql`select app.create_store_defaults()`);

        const after = { slug, name, defaultLocale, ownerUserId };
        const who = auditActor(actor, 'platform');
        await recordPlatformAudit(tx, {
          ...who,
          tenantId: id,
          action: 'tenant.created',
          entityType: 'tenant',
          entityId: id,
          after,
        });
        await recordAudit(tx, {
          ...who,
          action: 'tenant.created',
          entityType: 'tenant',
          entityId: id,
          after,
        });
        await emit(tx, 'tenant.created', {
          aggregateType: 'tenant',
          aggregateId: id,
          payload: { slug, name },
        });
        return { id, slug, ownerUserId };
      },
      options,
    );
  } catch (e) {
    const err = pgError(e);
    if (err.code === '23505' && err.constraint === 'tenants_slug_unique') {
      throw new AppError('slug_taken');
    }
    throw e;
  }
}

export interface Store {
  id: string;
  slug: string;
  name: string;
  status: (typeof schema.TENANT_STATUSES)[number];
  defaultLocale: Locale;
  profile: StoreProfile;
  /** VAT settings (phase-2-plan §3.9). */
  tax: TaxSettings;
  /** Indexing, tracking, consent text, chat and holiday mode (phase-3-plan §3.6–§3.10). */
  storefront: StorefrontSettings;
  /** Bangla or Western digits on the storefront. */
  display: TenantSettings['display'];
  /** Checkout fields, limits and shopper accounts (phase-4-plan §4). */
  checkout: CheckoutSettings;
  /** Cash on delivery. */
  cod: CodSettings;
  /** When a phone is flagged (phase-5a-plan §3.11). */
  fraud: FraudSettings;
  /** The return policy (phase-5a-plan §3.10). */
  returns: ReturnSettings;
  /** Which shopper messages go by SMS and email (phase-5a-plan §3.6). */
  notifications: NotificationSettings;
}

async function loadStore(tx: TenantTx, forUpdate = false): Promise<Store & { settings: unknown }> {
  const t = schema.tenants;
  const query = tx.db
    .select({
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      defaultLocale: t.defaultLocale,
      settings: t.settings,
    })
    .from(t)
    .where(eq(t.id, tx.tenantId));
  const [row] = await (forUpdate ? query.for('update') : query);
  if (!row) throw new AppError('store_not_found');
  const settings = tenantSettings.parse(row.settings);
  return {
    ...row,
    profile: settings.profile,
    tax: settings.tax,
    storefront: settings.storefront,
    display: settings.display,
    checkout: settings.checkout,
    cod: settings.cod,
    fraud: settings.fraud,
    returns: settings.returns,
    notifications: settings.notifications,
  };
}

/** The active store's profile (`settings.read`). */
export async function getStore(tx: TenantTx, actor: Actor): Promise<Store> {
  authorize(actor, 'settings.read');
  const { settings: _settings, ...store } = await loadStore(tx);
  return store;
}

/** Parses one settings section, with field paths under its name. */
function parseSection<T>(name: string, schemaOf: z.ZodType<T>, input: unknown): T {
  const result = schemaOf.safeParse(input);
  if (result.success) return result.data;
  throw new AppError('validation_failed', {
    fields: result.error.issues.map((i) => ({
      path: [name, ...i.path].join('.'),
      code: i.code,
      message: i.message,
    })),
  });
}

export interface StoreProfilePatch {
  name?: string;
  defaultLocale?: Locale;
  /** Replaces the whole profile. */
  profile?: StoreProfile;
  /** Replaces the VAT settings. */
  tax?: unknown;
  /** Replaces the storefront settings. */
  storefront?: unknown;
  /** Replaces the display settings. */
  display?: unknown;
  /** Replaces the checkout settings (phase-4-plan §4). */
  checkout?: unknown;
  /** Replaces the cash-on-delivery settings. */
  cod?: unknown;
  /** Replaces the phone flag settings (phase-5a-plan §3.11). */
  fraud?: unknown;
  /** Replaces the return policy (phase-5a-plan §3.10). */
  returns?: unknown;
  /** Replaces the shopper message channels (phase-5a-plan §3.6). */
  notifications?: unknown;
}

/** Edits name, default locale, profile, VAT, storefront and display settings (`settings.write`); refused while suspended. */
export async function updateStoreProfile(
  tx: TenantTx,
  actor: Actor,
  patch: StoreProfilePatch,
): Promise<Store> {
  authorize(actor, 'settings.write');
  const current = await loadStore(tx, true);
  if (current.status !== 'active') throw new AppError('tenant_suspended');

  const settings = tenantSettings.parse(current.settings);
  const next = {
    name: patch.name?.trim() ?? current.name,
    defaultLocale: patch.defaultLocale ?? current.defaultLocale,
    profile: patch.profile
      ? parseSection('profile', tenantSettings.shape.profile, patch.profile)
      : current.profile,
    tax: patch.tax !== undefined ? parseSection('tax', taxSettings, patch.tax) : current.tax,
    storefront:
      patch.storefront !== undefined
        ? parseSection('storefront', storefrontSettings, patch.storefront)
        : current.storefront,
    display:
      patch.display !== undefined
        ? parseSection('display', tenantSettings.shape.display, patch.display)
        : current.display,
    checkout:
      patch.checkout !== undefined
        ? parseSection('checkout', checkoutSettings, patch.checkout)
        : current.checkout,
    cod: patch.cod !== undefined ? parseSection('cod', codSettings, patch.cod) : current.cod,
    fraud:
      patch.fraud !== undefined ? parseSection('fraud', fraudSettings, patch.fraud) : current.fraud,
    returns:
      patch.returns !== undefined
        ? parseSection('returns', returnSettings, patch.returns)
        : current.returns,
    notifications:
      patch.notifications !== undefined
        ? parseSection('notifications', notificationSettings, patch.notifications)
        : current.notifications,
  };
  const fields = (
    [
      'name',
      'defaultLocale',
      'profile',
      'tax',
      'storefront',
      'display',
      'checkout',
      'cod',
      'fraud',
      'returns',
      'notifications',
    ] as const
  ).filter((f) => JSON.stringify(next[f]) !== JSON.stringify(current[f]));
  if (fields.length === 0) return getStore(tx, actor);

  await tx.db
    .update(schema.tenants)
    .set({
      name: next.name,
      defaultLocale: next.defaultLocale,
      settings: {
        ...settings,
        profile: next.profile,
        tax: next.tax,
        storefront: next.storefront,
        display: next.display,
        checkout: next.checkout,
        cod: next.cod,
        fraud: next.fraud,
        returns: next.returns,
        notifications: next.notifications,
      },
    })
    .where(eq(schema.tenants.id, tx.tenantId));
  const pick = (s: typeof next) => Object.fromEntries(fields.map((f) => [f, s[f]]));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'store.profile_updated',
    entityType: 'tenant',
    entityId: tx.tenantId,
    before: pick(current),
    after: pick(next),
  });
  await emit(tx, 'tenant.updated', {
    aggregateType: 'tenant',
    aggregateId: tx.tenantId,
    payload: { fields },
  });
  return { ...current, ...next };
}

/** Suspends or reactivates a store (super admins; a reason is required to suspend). */
export async function transitionTenant(
  client: DbClient,
  actor: Actor,
  tenantId: string,
  event: 'suspend' | 'reactivate',
  context: {
    reason?: string;
    /** Why, for a suspension (phase-5b-plan §3.1); `other` when not given. */
    category?: SuspensionReason;
    /** Reactivate only a store suspended for this reason (an overdue invoice paid, §3.8). */
    onlyIf?: SuspensionReason;
  } = {},
  options: WithTenantOptions = {},
): Promise<{ from: Store['status']; to: Store['status'] }> {
  requirePlatformRole(actor, 'super_admin');
  return withTenant(
    client,
    tenantId,
    async (tx) => {
      const t = schema.tenants;
      const [row] = await tx.db
        .select({ status: t.status, statusReason: t.statusReason })
        .from(t)
        .where(eq(t.id, tenantId))
        .for('update');
      if (!row) throw new AppError('store_not_found');
      if (context.onlyIf && row.statusReason !== context.onlyIf) {
        return { from: row.status, to: row.status };
      }
      const { from, to } = tenantLifecycle.transition(row.status, event, context);
      const category = event === 'suspend' ? (context.category ?? 'other') : null;
      await tx.db.update(t).set({ status: to, statusReason: category }).where(eq(t.id, tenantId));
      const reason = context.reason?.trim() || undefined;
      const entry = {
        ...auditActor(actor, 'platform'),
        action: `tenant.${event}`,
        entityType: 'tenant',
        entityId: tenantId,
        before: { status: from },
        after: {
          status: to,
          ...(reason ? { reason } : {}),
          ...(category && context.category ? { category } : {}),
        },
      };
      await recordPlatformAudit(tx, { ...entry, tenantId });
      await recordAudit(tx, entry);
      await emit(tx, 'tenant.status_changed', {
        aggregateType: 'tenant',
        aggregateId: tenantId,
        payload: reason ? { from, to, reason } : { from, to },
      });
      return { from, to };
    },
    options,
  );
}

export interface ClosedTenant {
  from: Store['status'];
  to: 'closed';
  closedAt: string;
  purgeAfter: string;
}

/**
 * Closes a store (phase-5b-plan §3.1): super admins only, with the store's
 * slug typed and a reason. The storefront answers 410, staff can't open it,
 * and its purge may run from `purge_after`: 30 days later (Q11), or at once
 * for demo and test stores. Its export and the removal of its custom domains
 * follow from `tenant.closed`.
 */
export async function closeTenant(
  client: DbClient,
  actor: Actor,
  tenantId: string,
  input: { slug: string; reason: string },
  options: WithTenantOptions = {},
): Promise<ClosedTenant> {
  requirePlatformRole(actor, 'super_admin');
  return withTenant(
    client,
    tenantId,
    async (tx) => {
      const t = schema.tenants;
      const [row] = await tx.db
        .select({ status: t.status, slug: t.slug, kind: t.kind })
        .from(t)
        .where(eq(t.id, tenantId))
        .for('update');
      if (!row) throw new AppError('store_not_found');
      if (input.slug.trim().toLowerCase() !== row.slug) {
        throw new AppError('validation_failed', {
          fields: [{ path: 'slug', code: 'mismatch', message: "type the store's address" }],
        });
      }
      const { from } = tenantLifecycle.transition(row.status, 'close', input);
      const reason = input.reason.trim();
      const grace = row.kind === 'client' ? PURGE_GRACE_DAYS : 0;
      const [dates] = await tx.db
        .update(t)
        .set({
          status: 'closed',
          statusReason: null,
          closedAt: sql`now()`,
          purgeAfter: sql`now() + make_interval(days => ${grace})`,
        })
        .where(eq(t.id, tenantId))
        .returning({ closedAt: t.closedAt, purgeAfter: t.purgeAfter });
      if (!dates?.closedAt || !dates.purgeAfter) {
        throw new AppError('internal', { detail: 'close returned no dates' });
      }
      const closedAt = dates.closedAt.toISOString();
      const purgeAfter = dates.purgeAfter.toISOString();
      const entry = {
        ...auditActor(actor, 'platform'),
        action: 'tenant.close',
        entityType: 'tenant',
        entityId: tenantId,
        before: { status: from },
        after: { status: 'closed', reason, purgeAfter },
      };
      await recordPlatformAudit(tx, { ...entry, tenantId });
      await recordAudit(tx, entry);
      await emit(tx, 'tenant.status_changed', {
        aggregateType: 'tenant',
        aggregateId: tenantId,
        payload: { from, to: 'closed', reason },
      });
      await emit(tx, 'tenant.closed', {
        aggregateType: 'tenant',
        aggregateId: tenantId,
        payload: { purgeAfter },
      });
      return { from, to: 'closed', closedAt, purgeAfter };
    },
    options,
  );
}

/** Reopens a closed store before its purge (Q11): it's active again, with its data as it was. */
export async function reopenTenant(
  client: DbClient,
  actor: Actor,
  tenantId: string,
  input: { reason: string },
  options: WithTenantOptions = {},
): Promise<{ from: Store['status']; to: 'active' }> {
  requirePlatformRole(actor, 'super_admin');
  return withTenant(
    client,
    tenantId,
    async (tx) => {
      const t = schema.tenants;
      const [row] = await tx.db
        .select({ status: t.status })
        .from(t)
        .where(eq(t.id, tenantId))
        .for('update');
      if (!row) throw new AppError('store_not_found');
      const { from } = tenantLifecycle.transition(row.status, 'reopen', input);
      // A purge that has started can't be undone (§3.11).
      const [running] = await tx.db
        .select({ id: schema.tenantJobs.id })
        .from(schema.tenantJobs)
        .where(
          sql`${schema.tenantJobs.tenantId} = ${tenantId} and ${schema.tenantJobs.kind} = 'purge'
              and ${schema.tenantJobs.status} = 'running'`,
        );
      if (running) throw new AppError('conflict', { detail: 'the purge has started' });
      await tx.db
        .update(t)
        .set({ status: 'active', closedAt: null, purgeAfter: null })
        .where(eq(t.id, tenantId));
      const reason = input.reason.trim();
      const entry = {
        ...auditActor(actor, 'platform'),
        action: 'tenant.reopen',
        entityType: 'tenant',
        entityId: tenantId,
        before: { status: from },
        after: { status: 'active', reason },
      };
      await recordPlatformAudit(tx, { ...entry, tenantId });
      await recordAudit(tx, entry);
      await emit(tx, 'tenant.status_changed', {
        aggregateType: 'tenant',
        aggregateId: tenantId,
        payload: { from, to: 'active', reason },
      });
      await emit(tx, 'tenant.reopened', {
        aggregateType: 'tenant',
        aggregateId: tenantId,
        payload: {},
      });
      return { from, to: 'active' };
    },
    options,
  );
}
