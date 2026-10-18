// Store commands (phase-1-plan §4.4, §6.2): creating a store, reading and
// editing its profile, and suspending or reactivating it. Each runs in one
// tenant transaction, writes its audit entries and emits its event there.
import { schema } from '@managemind/db';
import { AppError, checkSlug, uuidv7 } from '@managemind/shared';
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
  context: { reason?: string } = {},
  options: WithTenantOptions = {},
): Promise<{ from: Store['status']; to: Store['status'] }> {
  requirePlatformRole(actor, 'super_admin');
  return withTenant(
    client,
    tenantId,
    async (tx) => {
      const { status } = await loadStore(tx, true);
      const { from, to } = tenantLifecycle.transition(status, event, context);
      await tx.db.update(schema.tenants).set({ status: to }).where(eq(schema.tenants.id, tenantId));
      const reason = context.reason?.trim() || undefined;
      const entry = {
        ...auditActor(actor, 'platform'),
        action: `tenant.${event}`,
        entityType: 'tenant',
        entityId: tenantId,
        before: { status: from },
        after: reason ? { status: to, reason } : { status: to },
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
