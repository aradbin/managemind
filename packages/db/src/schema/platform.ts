// Platform data: our own records about each client, and staff identity. No
// RLS: access is controlled by grants (migration 0005), and every read of a
// tenant's rows here filters by tenant in code (phase-1-plan §3.3, §6.2).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const platform = pgSchema('platform');

export const TENANT_STATUSES = ['active', 'suspended', 'closed', 'purged'] as const;
export const LOCALES = ['bn', 'en'] as const;
export const STORE_ROLES = ['owner', 'manager', 'staff', 'viewer'] as const;
export const PLATFORM_ROLES = ['support', 'super_admin'] as const;

const id = () => uuid().primaryKey().default(sql`uuidv7()`);
const ts = () => timestamp({ withTimezone: true });
const createdAt = () => ts().notNull().defaultNow();
const updatedAt = () => ts().notNull().defaultNow();
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

export const tenants = platform.table(
  'tenants',
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    slug: text().notNull().unique(),
    name: text().notNull(),
    status: text({ enum: TENANT_STATUSES }).notNull().default('active'),
    defaultLocale: text({ enum: LOCALES }).notNull().default('bn'),
    settings: jsonb().notNull().default({}),
    /** Plan label; plans with entitlements arrive in Phase 5B. */
    plan: text().notNull().default('pilot'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('tenants_slug_format', sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$'`),
    check('tenants_status_valid', sql`${t.status} in ('active', 'suspended', 'closed', 'purged')`),
    check('tenants_locale_valid', sql`${t.defaultLocale} in ('bn', 'en')`),
  ],
);

const tenantRef = () =>
  uuid()
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' });

export const DOMAIN_STATUSES = ['pending', 'active', 'failed', 'removed'] as const;

/**
 * Custom domains (Phase 3). The default address `{slug}.<STORE_DOMAIN>` is
 * derived from the slug, not stored, so changing the store domain is a
 * config change (PLAN.md, "if the store domain is ever flagged").
 */
export const tenantDomains = platform.table(
  'tenant_domains',
  {
    id: id(),
    tenantId: tenantRef(),
    hostname: text().notNull().unique(),
    status: text({ enum: DOMAIN_STATUSES }).notNull().default('pending'),
    /** The canonical host; without one, the default subdomain is canonical. */
    isPrimary: boolean().notNull().default(false),
    verifiedAt: ts(),
    /** Cloudflare for SaaS custom hostname ID. */
    providerRef: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tenant_domains_one_primary')
      .on(t.tenantId)
      .where(sql`is_primary and status = 'active'`),
    index('tenant_domains_tenant_status_idx').on(t.tenantId, t.status),
    check(
      'tenant_domains_hostname_format',
      sql`${t.hostname} ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'`,
    ),
    check('tenant_domains_status_valid', sql`${t.status} in (${inList(DOMAIN_STATUSES)})`),
  ],
);

// Staff identity: Better Auth's core tables and its twoFactor plugin's table
// (ADR 0005). Property keys are Better Auth's field names; columns are
// snake_case. Better Auth writes these as the app role.

export const users = platform.table(
  'users',
  {
    id: id(),
    name: text().notNull(),
    email: text().notNull().unique(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    twoFactorEnabled: boolean().notNull().default(false),
    /** Set only by our identity service, never through a Better Auth endpoint. */
    platformRole: text({ enum: PLATFORM_ROLES }),
    locale: text({ enum: LOCALES }).notNull().default('bn'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check('users_platform_role_valid', sql`${t.platformRole} in (${inList(PLATFORM_ROLES)})`),
    check('users_locale_valid', sql`${t.locale} in (${inList(LOCALES)})`),
  ],
);

const userRef = () =>
  uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

export const sessions = platform.table(
  'sessions',
  {
    id: id(),
    userId: userRef(),
    token: text().notNull().unique(),
    expiresAt: ts().notNull(),
    ipAddress: text(),
    userAgent: text(),
    /** The store the session works in; checked against memberships every request. */
    activeTenantId: uuid().references(() => tenants.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const accounts = platform.table(
  'accounts',
  {
    id: id(),
    userId: userRef(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: ts(),
    refreshTokenExpiresAt: ts(),
    scope: text(),
    /** Null on the Free plan: staff sign in with email codes (ADR 0013). */
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('accounts_user_idx').on(t.userId),
    unique('accounts_provider_account_unique').on(t.providerId, t.accountId),
  ],
);

export const verifications = platform.table(
  'verifications',
  {
    // Text, not uuid: Better Auth writes its own non-UUID ids here for the
    // short-lived lock it takes when an unverified user first signs in.
    id: text().primaryKey().default(sql`uuidv7()::text`),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: ts().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('verifications_identifier_idx').on(t.identifier),
    index('verifications_expires_idx').on(t.expiresAt),
  ],
);

export const twoFactors = platform.table(
  'two_factors',
  {
    id: id(),
    userId: userRef(),
    /** Encrypted by Better Auth with the auth secret. */
    secret: text().notNull(),
    backupCodes: text().notNull(),
    verified: boolean().notNull().default(true),
    failedVerificationCount: integer().notNull().default(0),
    lockedUntil: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('two_factors_user_unique').on(t.userId)],
);

// Store membership, invitations and support access: ours, not Better Auth's
// organization plugin (phase-1-plan §3.3).

export const memberships = platform.table(
  'memberships',
  {
    id: id(),
    tenantId: tenantRef(),
    userId: userRef(),
    role: text({ enum: STORE_ROLES }).notNull(),
    invitedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('memberships_tenant_user_unique').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
    check('memberships_role_valid', sql`${t.role} in (${inList(STORE_ROLES)})`),
  ],
);

export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;

export const invitations = platform.table(
  'invitations',
  {
    id: id(),
    tenantId: tenantRef(),
    email: text().notNull(),
    role: text({ enum: STORE_ROLES }).notNull(),
    /** SHA-256 of the token; the token itself exists only in the email. */
    tokenHash: text().notNull().unique(),
    status: text({ enum: INVITATION_STATUSES }).notNull().default('pending'),
    invitedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    acceptedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: ts(),
    expiresAt: ts().notNull().default(sql`now() + interval '7 days'`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('invitations_one_pending').on(t.tenantId, t.email).where(sql`status = 'pending'`),
    check('invitations_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check('invitations_role_valid', sql`${t.role} in (${inList(STORE_ROLES)})`),
    check('invitations_status_valid', sql`${t.status} in (${inList(INVITATION_STATUSES)})`),
  ],
);

export const SUPPORT_ROLES = ['viewer', 'manager'] as const;

/** Time-limited, audited access to one store for a platform user (phase-1-plan §5.4). */
export const supportGrants = platform.table(
  'support_grants',
  {
    id: id(),
    tenantId: tenantRef(),
    userId: userRef(),
    role: text({ enum: SUPPORT_ROLES }).notNull(),
    reason: text().notNull(),
    grantedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts().notNull(),
    revokedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('support_grants_tenant_user_idx').on(t.tenantId, t.userId, t.expiresAt),
    check('support_grants_role_valid', sql`${t.role} in (${inList(SUPPORT_ROLES)})`),
    check('support_grants_reason_length', sql`char_length(${t.reason}) between 10 and 500`),
    check(
      'support_grants_max_4_hours',
      sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '4 hours'`,
    ),
  ],
);

export const PLATFORM_ACTOR_TYPES = ['platform', 'system'] as const;

/** Append-only record of platform actions; purges never touch it. */
export const platformAuditLog = platform.table(
  'audit_log',
  {
    id: id(),
    tenantId: uuid().references(() => tenants.id, { onDelete: 'restrict' }),
    actorType: text({ enum: PLATFORM_ACTOR_TYPES }).notNull(),
    actorId: uuid(),
    action: text().notNull(),
    entityType: text(),
    entityId: uuid(),
    before: jsonb(),
    after: jsonb(),
    requestId: text(),
    ip: inet(),
    createdAt: createdAt(),
  },
  (t) => [
    index('platform_audit_log_created_idx').on(sql`created_at desc`),
    index('platform_audit_log_tenant_created_idx').on(t.tenantId, sql`created_at desc`),
    check(
      'platform_audit_log_actor_type_valid',
      sql`${t.actorType} in (${inList(PLATFORM_ACTOR_TYPES)})`,
    ),
  ],
);

/** Emails captured outside production (phase-1-plan §3.8); deleted after a day. */
export const devEmails = platform.table(
  'dev_emails',
  {
    id: id(),
    to: text().notNull(),
    subject: text().notNull(),
    text: text().notNull(),
    html: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('dev_emails_to_created_idx').on(t.to, sql`created_at desc`)],
);
