// Platform data: our own records about each client, and staff identity. No
// RLS: access is controlled by grants (migration 0005), and every read of a
// tenant's rows here filters by tenant in code (phase-1-plan §3.3, §6.2).
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
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
/** Phase 5B (phase-5b-plan §3.1); the same lists as @managemind/shared/billing. */
export const TENANT_KINDS = ['client', 'demo', 'test'] as const;
export const SUSPENSION_REASONS = ['overdue', 'abuse', 'client_request', 'other'] as const;

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
    /** `demo` and `test` stores are never billed and can be reset (phase-5b-plan §3.1). */
    kind: text({ enum: TENANT_KINDS }).notNull().default('client'),
    /**
     * The effective entitlements (plan + override), written whenever the
     * subscription changes; empty is unlimited (phase-5b-plan §3.5).
     */
    entitlements: jsonb().notNull().default({}),
    /** Why the store is suspended; null otherwise. */
    statusReason: text({ enum: SUSPENSION_REASONS }),
    closedAt: ts(),
    /** The earliest purge: 30 days after closing (Q11). */
    purgeAfter: ts(),
    purgedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('tenants_slug_format', sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$'`),
    check('tenants_status_valid', sql`${t.status} in ('active', 'suspended', 'closed', 'purged')`),
    check('tenants_locale_valid', sql`${t.defaultLocale} in ('bn', 'en')`),
    check('tenants_kind_valid', sql`${t.kind} in (${inList(TENANT_KINDS)})`),
    check(
      'tenants_status_reason_valid',
      sql`(${t.status} = 'suspended') = (${t.statusReason} is not null) and ${t.statusReason} in (${inList(SUSPENSION_REASONS)})`,
    ),
    check(
      'tenants_closed_dates',
      sql`(${t.status} in ('closed', 'purged')) = (${t.closedAt} is not null and ${t.purgeAfter} is not null)`,
    ),
    check('tenants_purged_at', sql`(${t.status} = 'purged') = (${t.purgedAt} is not null)`),
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
    hostname: text().notNull(),
    status: text({ enum: DOMAIN_STATUSES }).notNull().default('pending'),
    /** The canonical host; without one, the default subdomain is canonical. */
    isPrimary: boolean().notNull().default(false),
    verifiedAt: ts(),
    /** Cloudflare for SaaS custom hostname ID. */
    providerRef: text(),
    /** The certificate's state at Cloudflare (pending_validation, active, …). */
    sslStatus: text(),
    /** The TXT ownership record Cloudflare asks for, when the client's DNS is on Cloudflare. */
    ownershipRecord: jsonb(),
    lastCheckedAt: ts(),
    checkAttempts: integer().notNull().default(0),
    /** Cloudflare's reason, when the domain failed or needs attention. */
    failureReason: text(),
    /**
     * On the Turnstile widget's hostname list (phase-4-plan §3.15). A free
     * widget holds 10 hostnames; a domain that doesn't fit relies on rate
     * limits alone, and the admin says so.
     */
    turnstile: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A removed domain frees its hostname for another store (phase-3-plan §3.9).
    uniqueIndex('tenant_domains_hostname_unique').on(t.hostname).where(sql`status <> 'removed'`),
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

/** Every status change of a custom domain (the state machine's history, PLAN.md lifecycles). */
export const tenantDomainHistory = platform.table(
  'tenant_domain_history',
  {
    id: id(),
    tenantId: tenantRef(),
    domainId: uuid()
      .notNull()
      .references(() => tenantDomains.id, { onDelete: 'cascade' }),
    fromStatus: text({ enum: DOMAIN_STATUSES }),
    toStatus: text({ enum: DOMAIN_STATUSES }).notNull(),
    /** A staff user, or null for the system's checks. */
    actorId: uuid(),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [index('tenant_domain_history_domain_idx').on(t.domainId, t.createdAt)],
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

// Phase 5B: plans and billing, usage, health, terms, and jobs that export,
// purge or reset a store (phase-5b-plan §4). All money is integer poisha.

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled'] as const;
export const USAGE_METRICS = [
  'orders',
  'order_total',
  'emails',
  'sms',
  'storage_bytes',
  'products',
  'staff',
  'custom_domains',
] as const;
export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'void'] as const;
export const INVOICE_LINE_KINDS = ['setup', 'plan', 'overage', 'adjustment', 'vat'] as const;
export const BILLING_PAYMENT_METHODS = ['bank', 'bkash', 'nagad', 'cash', 'sslcommerz'] as const;
export const DUNNING_STEPS = [
  'due_soon',
  'due_today',
  'past_due',
  'final_notice',
  'suspend',
] as const;
export const JOB_KINDS = ['export', 'purge', 'reset'] as const;
export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;

/** Plans a super admin edits (§3.5); entitlements are validated by @managemind/shared/billing. */
export const plans = platform.table(
  'plans',
  {
    id: id(),
    code: text().notNull().unique(),
    /** { bn, en } */
    name: jsonb().notNull(),
    monthlyPrice: integer().notNull(),
    setupFee: integer().notNull().default(0),
    /** Poisha per unit beyond a soft limit, by metric. */
    overagePrices: jsonb().notNull().default({}),
    entitlements: jsonb().notNull(),
    /** Shown when onboarding; a plan no longer offered keeps its subscribers. */
    offered: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('plans_code_format', sql`${t.code} ~ '^[a-z][a-z0-9-]{1,30}$'`),
    check('plans_prices_nonnegative', sql`${t.monthlyPrice} >= 0 and ${t.setupFee} >= 0`),
  ],
);

/** One per store (§3.5): its plan, negotiated terms, billing day and dunning hold. */
export const subscriptions = platform.table(
  'subscriptions',
  {
    id: id(),
    tenantId: tenantRef().unique(),
    planId: uuid()
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    priceOverride: integer(),
    setupFeeOverride: integer(),
    entitlementOverride: jsonb(),
    /** 1–28, so every month has it. */
    billingDay: integer().notNull(),
    trialEndsOn: date({ mode: 'string' }),
    status: text({ enum: SUBSCRIPTION_STATUSES }).notNull().default('active'),
    /** Reminders and suspension wait until this Dhaka date (§3.8). */
    holdUntil: date({ mode: 'string' }),
    holdReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('subscriptions_billing_day', sql`${t.billingDay} between 1 and 28`),
    check('subscriptions_status_valid', sql`${t.status} in (${inList(SUBSCRIPTION_STATUSES)})`),
    check(
      'subscriptions_overrides_nonnegative',
      sql`coalesce(${t.priceOverride}, 0) >= 0 and coalesce(${t.setupFeeOverride}, 0) >= 0`,
    ),
    check('subscriptions_hold_reason', sql`(${t.holdUntil} is null) = (${t.holdReason} is null)`),
    index('subscriptions_billing_day_idx').on(t.billingDay),
  ],
);

/** Yesterday's use per store, rolled up nightly (§3.6); a rerun overwrites the same key. */
export const usageDaily = platform.table(
  'usage_daily',
  {
    tenantId: tenantRef(),
    day: date({ mode: 'string' }).notNull(),
    metric: text({ enum: USAGE_METRICS }).notNull(),
    value: bigint({ mode: 'number' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.day, t.metric] }),
    check('usage_daily_metric_valid', sql`${t.metric} in (${inList(USAGE_METRICS)})`),
    check('usage_daily_value_nonnegative', sql`${t.value} >= 0`),
  ],
);

/** What the platform screens show per store (§3.3), so they never read the store schema. */
export const storeHealth = platform.table('store_health', {
  tenantId: uuid()
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  checkedAt: ts().notNull().defaultNow(),
  payments: jsonb().notNull().default({}),
  email: jsonb().notNull().default({}),
  sms: jsonb().notNull().default({}),
  domains: jsonb().notNull().default({}),
  activity: jsonb().notNull().default({}),
  /** The setup checklist's items (§3.2), counted when the health is written. */
  checklist: jsonb().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Our company's invoice details and VAT (Q8), one row per key; snapshotted on each invoice. */
export const platformSettings = platform.table('settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Invoice numbers: one platform sequence, never reset or reused (§3.7). */
export const invoiceNumberSeq = platform.sequence('invoice_number_seq', { startWith: 1 });

/** Our invoices to clients (§3.7). The number is set when issued and never reused. */
export const invoices = platform.table(
  'invoices',
  {
    id: id(),
    number: text().unique(),
    tenantId: tenantRef(),
    status: text({ enum: INVOICE_STATUSES }).notNull().default('draft'),
    periodStart: date({ mode: 'string' }),
    periodEnd: date({ mode: 'string' }),
    /** A draft is issued automatically at this time unless a super admin acts first. */
    issueAfter: ts(),
    issuedOn: date({ mode: 'string' }),
    dueOn: date({ mode: 'string' }),
    paidAt: ts(),
    voidedAt: ts(),
    voidReason: text(),
    subtotal: integer().notNull().default(0),
    vat: integer().notNull().default(0),
    total: integer().notNull().default(0),
    /** The sum of payments recorded against it. */
    amountPaid: integer().notNull().default(0),
    /** Our company's details when issued. */
    issuer: jsonb(),
    /** The client's billing details when issued. */
    billedTo: jsonb(),
    /** The VAT rate used, in basis points, when the invoice has VAT. */
    vatRateBp: integer(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('invoices_tenant_created_idx').on(t.tenantId, sql`created_at desc`),
    index('invoices_status_due_idx').on(t.status, t.dueOn),
    // The daily job drafts one invoice per store and period.
    uniqueIndex('invoices_tenant_period_unique')
      .on(t.tenantId, t.periodStart)
      .where(sql`status <> 'void' and period_start is not null`),
    check('invoices_status_valid', sql`${t.status} in (${inList(INVOICE_STATUSES)})`),
    check(
      'invoices_issued_has_number',
      sql`(${t.status} in ('issued', 'paid')) <= (${t.number} is not null and ${t.issuedOn} is not null and ${t.dueOn} is not null)`,
    ),
    check('invoices_totals', sql`${t.total} = ${t.subtotal} + ${t.vat} and ${t.total} >= 0`),
    check('invoices_amount_paid', sql`${t.amountPaid} >= 0`),
  ],
);

export const invoiceLines = platform.table(
  'invoice_lines',
  {
    id: id(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    position: integer().notNull(),
    kind: text({ enum: INVOICE_LINE_KINDS }).notNull(),
    /** { bn, en } */
    description: jsonb().notNull(),
    quantity: integer().notNull().default(1),
    unitPrice: integer().notNull(),
    amount: integer().notNull(),
    metric: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('invoice_lines_position_unique').on(t.invoiceId, t.position),
    check('invoice_lines_kind_valid', sql`${t.kind} in (${inList(INVOICE_LINE_KINDS)})`),
    check('invoice_lines_quantity_positive', sql`${t.quantity} > 0`),
    // Only an adjustment can take money off.
    check(
      'invoice_lines_amount_sign',
      sql`${t.kind} = 'adjustment' or (${t.amount} >= 0 and ${t.unitPrice} >= 0)`,
    ),
  ],
);

/** Payments of our invoices, recorded by a super admin or settled by SSLCommerz (§3.7). */
export const billingPayments = platform.table(
  'billing_payments',
  {
    id: id(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    tenantId: tenantRef(),
    amount: integer().notNull(),
    method: text({ enum: BILLING_PAYMENT_METHODS }).notNull(),
    reference: text(),
    paidOn: date({ mode: 'string' }).notNull(),
    recordedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    gatewayTranId: text(),
    gatewayValId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('billing_payments_invoice_idx').on(t.invoiceId),
    index('billing_payments_tenant_idx').on(t.tenantId, sql`created_at desc`),
    uniqueIndex('billing_payments_val_id_unique')
      .on(t.gatewayValId)
      .where(sql`method = 'sslcommerz'`),
    check('billing_payments_amount_positive', sql`${t.amount} > 0`),
    check(
      'billing_payments_method_valid',
      sql`${t.method} in (${inList(BILLING_PAYMENT_METHODS)})`,
    ),
    check(
      'billing_payments_gateway_val_id',
      sql`(${t.method} = 'sslcommerz') = (${t.gatewayValId} is not null)`,
    ),
  ],
);

/** Each dunning step sent, once per invoice (§3.8). */
export const reminders = platform.table(
  'reminders',
  {
    id: id(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    step: text({ enum: DUNNING_STEPS }).notNull(),
    sentAt: ts().notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('reminders_invoice_step_unique').on(t.invoiceId, t.step),
    check('reminders_step_valid', sql`${t.step} in (${inList(DUNNING_STEPS)})`),
  ],
);

/** Versions of the platform terms (§3.4); a new text is a new version. */
export const termsVersions = platform.table(
  'terms_versions',
  {
    id: id(),
    version: text().notNull().unique(),
    /** Owners are asked from publication; their admin is read-only from this time on. */
    effectiveAt: ts().notNull(),
    url: text().notNull(),
    sha256: text().notNull(),
    publishedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('terms_versions_effective_idx').on(sql`effective_at desc`),
    check('terms_versions_sha256', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('terms_versions_url', sql`${t.url} ~ '^https://'`),
  ],
);

/**
 * Append only. The email is kept as written, since a purge deletes staff
 * accounts that belonged only to the purged store and the acceptance stays.
 */
export const termsAcceptances = platform.table(
  'terms_acceptances',
  {
    id: id(),
    tenantId: tenantRef(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    userEmail: text().notNull(),
    versionId: uuid()
      .notNull()
      .references(() => termsVersions.id, { onDelete: 'restrict' }),
    acceptedAt: ts().notNull().defaultNow(),
    ip: inet(),
    userAgent: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('terms_acceptances_once').on(t.tenantId, t.userId, t.versionId),
    index('terms_acceptances_version_idx').on(t.versionId, t.tenantId),
  ],
);

/** Export, purge and reset jobs, run by tenant-jobs.yml in GitHub Actions (§3.9). */
export const tenantJobs = platform.table(
  'tenant_jobs',
  {
    id: id(),
    tenantId: tenantRef(),
    kind: text({ enum: JOB_KINDS }).notNull(),
    status: text({ enum: JOB_STATUSES }).notNull().default('pending'),
    requestedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** The last finished step, so a stopped job resumes from it. */
    progress: jsonb().notNull().default({}),
    result: jsonb(),
    /** The export's R2 key. */
    fileKey: text(),
    error: text(),
    attempts: integer().notNull().default(0),
    startedAt: ts(),
    finishedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tenant_jobs_status_idx').on(t.status, t.createdAt),
    index('tenant_jobs_tenant_idx').on(t.tenantId, sql`created_at desc`),
    // One open job of each kind per store.
    uniqueIndex('tenant_jobs_one_open')
      .on(t.tenantId, t.kind)
      .where(sql`status in ('pending', 'running')`),
    check('tenant_jobs_kind_valid', sql`${t.kind} in (${inList(JOB_KINDS)})`),
    check('tenant_jobs_status_valid', sql`${t.status} in (${inList(JOB_STATUSES)})`),
  ],
);

/** A purge's dry run, approval, counts and verification (§3.11); kept after the purge. */
export const tenantPurges = platform.table(
  'tenant_purges',
  {
    id: id(),
    tenantId: tenantRef(),
    jobId: uuid()
      .notNull()
      .references(() => tenantJobs.id, { onDelete: 'restrict' }),
    dryRun: jsonb(),
    approvedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    approvedAt: ts(),
    deleted: jsonb(),
    verification: jsonb(),
    finishedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tenant_purges_tenant_idx').on(t.tenantId),
    check('tenant_purges_approval', sql`(${t.approvedBy} is null) = (${t.approvedAt} is null)`),
  ],
);
