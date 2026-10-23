// The platform API, /v1/platform/* (reached as /api/platform/* on the admin
// host; phase-1-plan §5.3, §7.1). Every route needs a platform role AND a
// user who has set up two-factor login; a platform user who hasn't is sent
// to enrolment (403 two_factor_required) and can do nothing else here.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  CHECKLIST_ITEMS,
  type Checklist,
  closeTenant,
  createPlan,
  createTenant,
  getSubscription,
  getTenantDetail,
  grantSupportAccess,
  holdSubscription,
  listJobs,
  listPlans,
  listPlatformAudit,
  listPlatformStaff,
  listTenants,
  listTermsVersions,
  platformDashboard,
  publishTerms,
  readStoreHealth,
  refreshStoreHealth,
  reopenTenant,
  requestExport,
  revokeSupportAccess,
  setPlatformRole,
  setSubscription,
  transitionTenant,
  updatePlan,
  withPlatform,
  withTenant,
} from '@managemind/core';
import { supportAccessEmail, welcomeOwnerEmail } from '@managemind/providers/email';
import { AppError, checkSlug, PLATFORM_ROLES } from '@managemind/shared';
import {
  dhakaDate,
  entitlementOverride,
  entitlements,
  SUSPENSION_REASONS,
  TENANT_KINDS,
} from '@managemind/shared/billing';
import { THEME_PRESETS } from '@managemind/shared/storefront';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { relayTo, type StaffEnv, staffSession } from '../admin/context';
import { createMailer } from '../auth/email';
import { requireFreshTwoFactor } from '../auth/fresh-two-factor';
import { adminOrigin } from '../auth/routes';
import type { AppEnv } from '../env';
import { dispatchJobs, Job, jobOut } from '../tenant-jobs';
import { registerPlatformBilling } from './billing';

const Id = z.object({ id: z.uuid() });
const Status = z.enum(['active', 'suspended', 'closed', 'purged']);
const json = <T extends z.ZodType>(schema: T, description: string, status = 200) => ({
  [status]: { content: { 'application/json': { schema } }, description },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});
const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/platform${config.path}`, tags: ['platform'] } as C & {
    tags: string[];
  });

const Kind = z.enum(TENANT_KINDS);
const TenantSummary = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    status: Status,
    plan: z.string(),
    kind: Kind,
    statusReason: z.enum(SUSPENSION_REASONS).nullable(),
    closedAt: z.date().nullable(),
    purgeAfter: z.date().nullable(),
    setup: z.object({ done: z.number().int(), total: z.number().int() }).nullable(),
    createdAt: z.date(),
  })
  .openapi('TenantSummary');
const Localized = z.object({ bn: z.string(), en: z.string() });
const Plan = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: Localized,
    monthlyPrice: z.number().int(),
    setupFee: z.number().int(),
    overagePrices: z.partialRecord(z.enum(['orders', 'emails']), z.number().int()),
    entitlements: entitlements,
    offered: z.boolean(),
  })
  .openapi('Plan');
const SubscriptionBody = z.object({
  planId: z.uuid(),
  priceOverride: z.number().int().min(0).nullable().optional(),
  setupFeeOverride: z.number().int().min(0).nullable().optional(),
  entitlementOverride: entitlementOverride.nullable().optional(),
  billingDay: z.number().int().min(1).max(28),
  trialEndsOn: z.iso.date().nullable().optional(),
});
const Subscription = z
  .object({
    plan: Plan,
    priceOverride: z.number().int().nullable(),
    setupFeeOverride: z.number().int().nullable(),
    entitlementOverride: entitlementOverride.nullable(),
    billingDay: z.number().int(),
    trialEndsOn: z.string().nullable(),
    status: z.enum(['trialing', 'active', 'past_due', 'cancelled']),
    holdUntil: z.string().nullable(),
    holdReason: z.string().nullable(),
  })
  .openapi('Subscription');
const ChecklistOut = z
  .object({
    items: z.array(
      z.object({ item: z.enum(CHECKLIST_ITEMS), done: z.boolean(), optional: z.boolean() }),
    ),
    done: z.number().int(),
    total: z.number().int(),
    complete: z.boolean(),
  })
  .openapi('SetupChecklist');
const Health = z
  .object({
    checkedAt: z.date(),
    /** Empty before the first check. */
    checklist: ChecklistOut.or(z.object({}).strict()),
    payments: z.record(z.string(), z.unknown()),
    email: z.record(z.string(), z.unknown()),
    sms: z.record(z.string(), z.unknown()),
    domains: z.record(z.string(), z.unknown()),
    activity: z.record(z.string(), z.unknown()),
  })
  .openapi('StoreHealth');
/** A fresh authenticator code, for closing and purging (phase-5b-plan §3.17). */
const FreshCode = z.object({ code: z.string().regex(/^\d{6}$/) });
const TenantDetail = TenantSummary.extend({
  defaultLocale: z.enum(['bn', 'en']),
  domains: z.array(z.object({ hostname: z.string(), status: z.string(), isPrimary: z.boolean() })),
  owners: z.array(z.object({ userId: z.uuid(), name: z.string(), email: z.string() })),
  memberCount: z.number().int(),
}).openapi('TenantDetail');
const Reason = z.object({ reason: z.string().trim().min(3).max(500) });

export const PLATFORM_ROUTES = {
  tenants: r({
    method: 'get',
    path: '/tenants',
    summary: 'Stores, searched by slug or name (support)',
    request: {
      query: z.object({
        q: z.string().max(100).optional(),
        status: Status.optional(),
        after: z.string().max(40).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }),
    },
    responses: json(
      z.object({ items: z.array(TenantSummary), next: z.string().nullable() }),
      'Stores',
    ),
  }),
  createTenant: r({
    method: 'post',
    path: '/tenants',
    summary: 'Create a store and its first Owner (super_admin)',
    request: body(
      z.object({
        slug: z.string().max(40),
        name: z.string().trim().min(1).max(100),
        defaultLocale: z.enum(['bn', 'en']).optional(),
        owner: z.object({ email: z.email().max(254), name: z.string().trim().min(1).max(100) }),
        kind: Kind.optional(),
        preset: z.enum(THEME_PRESETS).optional(),
        subscription: SubscriptionBody.optional(),
      }),
    ),
    responses: json(
      z.object({ id: z.uuid(), slug: z.string(), ownerUserId: z.uuid() }),
      'Created',
      201,
    ),
  }),
  slugCheck: r({
    method: 'get',
    path: '/tenants/slug-check',
    summary: "Whether a store address is free, as it's typed (super_admin)",
    request: { query: z.object({ slug: z.string().max(40) }) },
    responses: json(
      z.object({
        available: z.boolean(),
        reason: z.enum(['slug_taken', 'slug_reserved', 'invalid']).nullable(),
        /** The store's address once created. */
        host: z.string().nullable(),
      }),
      'Availability',
    ),
  }),
  tenant: r({
    method: 'get',
    path: '/tenants/{id}',
    summary: 'Registry data, domains, owners and member count (support)',
    request: { params: Id },
    responses: json(TenantDetail, 'Store'),
  }),
  suspend: r({
    method: 'post',
    path: '/tenants/{id}/suspend',
    summary: 'Suspend a store, with why (super_admin)',
    request: {
      params: Id,
      ...body(Reason.extend({ category: z.enum(SUSPENSION_REASONS).optional() })),
    },
    responses: json(z.object({ from: Status, to: Status }), 'Suspended'),
  }),
  close: r({
    method: 'post',
    path: '/tenants/{id}/close',
    summary: 'Close a store: the slug typed, a reason and a fresh authenticator code (super_admin)',
    request: { params: Id, ...body(Reason.extend({ slug: z.string().max(40) }).merge(FreshCode)) },
    responses: json(
      z.object({
        from: Status,
        to: Status,
        closedAt: z.string(),
        purgeAfter: z.string(),
        exportJobId: z.uuid(),
      }),
      'Closed',
    ),
  }),
  jobs: r({
    method: 'get',
    path: '/tenants/{id}/jobs',
    summary: "The store's exports, purges and resets, newest first (support)",
    request: { params: Id },
    responses: json(z.array(Job), 'Jobs'),
  }),
  requestExport: r({
    method: 'post',
    path: '/tenants/{id}/export',
    summary: "Export the store's data; the owners are emailed the link (super_admin)",
    request: { params: Id },
    responses: json(Job, 'Queued', 202),
  }),
  reopen: r({
    method: 'post',
    path: '/tenants/{id}/reopen',
    summary: 'Reopen a closed store before its purge (super_admin)',
    request: { params: Id, ...body(Reason) },
    responses: json(z.object({ from: Status, to: Status }), 'Reopened'),
  }),
  checklist: r({
    method: 'get',
    path: '/tenants/{id}/checklist',
    summary: "The store's setup checklist as of its last health check (support)",
    request: { params: Id },
    responses: json(z.union([ChecklistOut, z.null()]), 'Checklist'),
  }),
  health: r({
    method: 'get',
    path: '/tenants/{id}/health',
    summary: "The store's last health check (support)",
    request: { params: Id },
    responses: json(z.union([Health, z.null()]), 'Health'),
  }),
  refreshHealth: r({
    method: 'post',
    path: '/tenants/{id}/health/refresh',
    summary: "Run the daily job's checks for this store now (support)",
    request: { params: Id },
    responses: json(Health, 'Health'),
  }),
  dashboard: r({
    method: 'get',
    path: '/dashboard',
    summary:
      'Stores, sales, use per store, money, and the free-tier numbers of this morning (support)',
    responses: json(
      z
        .object({
          stores: z.object({
            active: z.number().int(),
            suspended: z.number().int(),
            closed: z.number().int(),
            inSetup: z.number().int(),
          }),
          sales: z.object({
            yesterday: z.object({ orders: z.number().int(), total: z.number().int() }),
            month: z.object({ orders: z.number().int(), total: z.number().int() }),
            days: z.array(
              z.object({ day: z.string(), orders: z.number().int(), total: z.number().int() }),
            ),
          }),
          perStore: z.array(
            z.object({
              tenantId: z.uuid(),
              slug: z.string(),
              name: z.string(),
              products: z.number().int(),
              ordersThisMonth: z.number().int(),
              emailsThisMonth: z.number().int(),
              storageBytes: z.number().int(),
              customDomains: z.number().int(),
            }),
          ),
          money: z.object({
            overdue: z.object({ count: z.number().int(), total: z.number().int() }),
            dueThisWeek: z.object({ count: z.number().int(), total: z.number().int() }),
            paidThisMonth: z.number().int(),
          }),
          /** The daily usage alarm's numbers (scripts/monitor/usage.ts), or null before its first run. */
          freeTier: z
            .object({
              generatedAt: z.string(),
              limits: z.array(
                z.object({
                  name: z.string(),
                  used: z.number(),
                  limit: z.number(),
                  unit: z.string(),
                  share: z.number(),
                }),
              ),
              deadLetters: z.record(z.string(), z.number().nullable()),
              alarms: z.number().int(),
            })
            .nullable(),
        })
        .openapi('PlatformDashboard'),
      'Dashboard',
    ),
  }),
  terms: r({
    method: 'get',
    path: '/terms',
    summary:
      'Versions of the platform terms, newest first, with how many stores accepted each (support)',
    responses: json(
      z.array(
        z.object({
          id: z.uuid(),
          version: z.string(),
          effectiveAt: z.date(),
          url: z.string(),
          sha256: z.string(),
          createdAt: z.date(),
          acceptedStores: z.number().int(),
        }),
      ),
      'Versions',
    ),
  }),
  publishTerms: r({
    method: 'post',
    path: '/terms',
    summary:
      'Publish a version: owners are asked now, and read-only from effectiveAt until one accepts (super_admin)',
    request: body(
      z.object({
        version: z.string().trim().min(1).max(40),
        effectiveAt: z.iso.datetime(),
        url: z.url().max(500),
        /** The published text's SHA-256; fetched from the URL and hashed when left out. */
        sha256: z
          .string()
          .regex(/^[0-9a-fA-F]{64}$/)
          .optional(),
      }),
    ),
    responses: json(
      z.object({
        id: z.uuid(),
        version: z.string(),
        effectiveAt: z.date(),
        url: z.string(),
        sha256: z.string(),
        createdAt: z.date(),
      }),
      'Published',
      201,
    ),
  }),
  plans: r({
    method: 'get',
    path: '/plans',
    summary: 'Plans, offered first (support)',
    responses: json(z.array(Plan), 'Plans'),
  }),
  createPlan: r({
    method: 'post',
    path: '/plans',
    summary: 'A new plan (super_admin)',
    request: body(z.record(z.string(), z.unknown())),
    responses: json(Plan, 'Created', 201),
  }),
  updatePlan: r({
    method: 'patch',
    path: '/plans/{id}',
    summary: "Change a plan; its stores' entitlements follow (super_admin)",
    request: { params: Id, ...body(z.record(z.string(), z.unknown())) },
    responses: json(Plan, 'Saved'),
  }),
  subscription: r({
    method: 'get',
    path: '/tenants/{id}/subscription',
    summary: "The store's plan and terms (support)",
    request: { params: Id },
    responses: json(z.union([Subscription, z.null()]), 'Subscription'),
  }),
  setSubscription: r({
    method: 'put',
    path: '/tenants/{id}/subscription',
    summary: 'Set the plan and terms; takes effect on the next invoice (super_admin)',
    request: { params: Id, ...body(SubscriptionBody) },
    responses: json(Subscription, 'Saved'),
  }),
  holdSubscription: r({
    method: 'post',
    path: '/tenants/{id}/subscription/hold',
    summary: 'Hold reminders and suspension until a date, or end the hold (super_admin)',
    request: {
      params: Id,
      ...body(
        z.object({
          until: z.iso.date().nullable(),
          reason: z.string().trim().max(500).optional(),
        }),
      ),
    },
    responses: json(Subscription, 'Saved'),
  }),
  reactivate: r({
    method: 'post',
    path: '/tenants/{id}/reactivate',
    summary: 'Reactivate a store (super_admin)',
    request: { params: Id, ...body(Reason.partial()) },
    responses: json(z.object({ from: Status, to: Status }), 'Reactivated'),
  }),
  supportAccess: r({
    method: 'post',
    path: '/tenants/{id}/support-access',
    summary: 'Time-limited access to a store: Viewer for support, Manager for super_admin',
    request: {
      params: Id,
      ...body(
        z.object({
          role: z.enum(['viewer', 'manager']),
          reason: z.string().trim().min(10).max(500),
          minutes: z.number().int().min(1).max(240),
        }),
      ),
    },
    responses: json(
      z.object({ id: z.uuid(), role: z.enum(['viewer', 'manager']), expiresAt: z.date() }),
      'Granted',
      201,
    ),
  }),
  revokeSupport: r({
    method: 'delete',
    path: '/support-access/{id}',
    summary: 'End a support grant (the grantee or a super_admin)',
    request: { params: Id },
    responses: { 204: { description: 'Revoked' } },
  }),
  staff: r({
    method: 'get',
    path: '/staff',
    summary: 'Platform users (super_admin)',
    responses: json(
      z.array(
        z.object({
          id: z.uuid(),
          name: z.string(),
          email: z.string(),
          platformRole: z.enum(PLATFORM_ROLES).nullable(),
          twoFactorEnabled: z.boolean(),
        }),
      ),
      'Platform users',
    ),
  }),
  setRole: r({
    method: 'put',
    path: '/staff/{id}/role',
    summary: 'Set or clear a platform role (super_admin)',
    request: { params: Id, ...body(z.object({ role: z.enum(PLATFORM_ROLES).nullable() })) },
    responses: { 204: { description: 'Saved' } },
  }),
  auditLog: r({
    method: 'get',
    path: '/audit-log',
    summary: 'Platform audit log, newest first (super_admin)',
    request: {
      query: z.object({
        before: z.uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }),
    },
    responses: json(
      z.object({ items: z.array(z.record(z.string(), z.unknown())), next: z.uuid().nullable() }),
      'Entries',
    ),
  }),
} as const;

/** Written by the daily usage alarm (scripts/monitor/usage.ts). */
const USAGE_FILE = 'platform/usage/latest.json';
type FreeTierLimit = { name: string; used: number; limit: number; unit: string; share: number };

/** The SHA-256 of the published terms text, so a changed text is a new version (§3.4). */
async function hashOf(url: string, platformDomain: string): Promise<string> {
  // Only our own site is fetched: the terms live on the platform domain.
  const host = new URL(url).hostname;
  if (host !== platformDomain && !host.endsWith(`.${platformDomain}`)) {
    throw new AppError('validation_failed', {
      fields: [
        {
          path: 'url',
          code: 'not_ours',
          message: `give the SHA-256, or a page on ${platformDomain}`,
        },
      ],
    });
  }
  const res = await fetch(url, { redirect: 'manual' }).catch(() => null);
  if (!res?.ok) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'url', code: 'unreachable', message: 'the terms page could not be read' }],
    });
  }
  const digest = await crypto.subtle.digest('SHA-256', await res.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const requireSuperAdmin = (c: Context<StaffEnv>) => {
  if (c.var.staff.actor.platformRole !== 'super_admin') throw new AppError('forbidden');
};
const requireSupport = (c: Context<StaffEnv>) => {
  if (!c.var.staff.actor.platformRole) throw new AppError('forbidden');
};

/** A platform role, and a user who has set up two-factor login (§5.3). */
const platformOnly = createMiddleware<StaffEnv>(async (c, next) => {
  const { actor, user } = c.var.staff;
  if (!actor.platformRole) throw new AppError('forbidden');
  if (!user.twoFactorEnabled) throw new AppError('two_factor_required');
  await next();
});

export function registerPlatform(app: OpenAPIHono<AppEnv>): void {
  const platform = app as unknown as OpenAPIHono<StaffEnv>;
  platform.use('/v1/platform/*', staffSession, platformOnly);
  const R = PLATFORM_ROUTES;

  platform.openapi(R.tenants, async (c) => {
    const { q, status, after, limit = 50 } = c.req.valid('query');
    const items = await withPlatform(c.var.staff.client, (tx) =>
      listTenants(tx, c.var.staff.actor, {
        limit,
        ...(q ? { q } : {}),
        ...(status ? { status } : {}),
        ...(after ? { after } : {}),
      }),
    );
    return c.json(
      { items, next: items.length === limit ? (items.at(-1)?.slug ?? null) : null },
      200,
    );
  });
  platform.openapi(R.createTenant, async (c) => {
    const input = c.req.valid('json');
    const created = await createTenant(
      c.var.staff.client,
      c.var.staff.actor,
      {
        ...input,
        ...(input.defaultLocale ? { defaultLocale: input.defaultLocale } : {}),
      } as Parameters<typeof createTenant>[2],
      { requestId: c.var.requestId, afterCommit: relayTo(c) },
    );
    // The owner hears where the admin and the store are (phase-5b-plan §3.2).
    const locale = input.defaultLocale ?? 'bn';
    const storeUrl = `https://${created.slug}.${c.var.config.STORE_DOMAIN}`;
    createMailer(c.env, c.var.config, c.executionCtx).sendLater(
      {
        to: input.owner.email.trim().toLowerCase(),
        ...welcomeOwnerEmail({
          locale,
          platformName: c.var.config.PLATFORM_NAME,
          storeName: input.name.trim(),
          adminUrl: `${adminOrigin(c as unknown as Parameters<typeof adminOrigin>[0])}/`,
          storeUrl,
        }),
      },
      'welcome_owner',
    );
    const { newOwner: _newOwner, ...out } = created;
    return c.json(out, 201);
  });
  platform.openapi(R.slugCheck, async (c) => {
    requireSuperAdmin(c);
    const checked = checkSlug(c.req.valid('query').slug);
    if (!checked.ok) {
      return c.json(
        {
          available: false,
          reason: checked.code === 'reserved' ? ('slug_reserved' as const) : ('invalid' as const),
          host: null,
        },
        200,
      );
    }
    const found = await withPlatform(c.var.staff.client, (tx) =>
      listTenants(tx, c.var.staff.actor, { q: checked.slug, limit: 100 }),
    );
    const taken = found.some((t) => t.slug === checked.slug);
    return c.json(
      {
        available: !taken,
        reason: taken ? ('slug_taken' as const) : null,
        host: `${checked.slug}.${c.var.config.STORE_DOMAIN}`,
      },
      200,
    );
  });
  platform.openapi(R.tenant, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(
      await withPlatform(c.var.staff.client, (tx) => getTenantDetail(tx, c.var.staff.actor, id)),
      200,
    );
  });
  const transition = (
    c: Context<StaffEnv>,
    id: string,
    event: 'suspend' | 'reactivate',
    reason?: string,
    category?: (typeof SUSPENSION_REASONS)[number],
  ) =>
    transitionTenant(
      c.var.staff.client,
      c.var.staff.actor,
      id,
      event,
      { ...(reason ? { reason } : {}), ...(category ? { category } : {}) },
      { requestId: c.var.requestId, afterCommit: relayTo(c) },
    );
  platform.openapi(R.suspend, async (c) => {
    const { id } = c.req.valid('param');
    const { reason, category } = c.req.valid('json');
    return c.json(await transition(c, id, 'suspend', reason, category), 200);
  });
  platform.openapi(R.close, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    requireSuperAdmin(c);
    await requireFreshTwoFactor(c, input.code);
    const closed = await closeTenant(
      c.var.staff.client,
      c.var.staff.actor,
      id,
      { slug: input.slug, reason: input.reason },
      { requestId: c.var.requestId, afterCommit: relayTo(c) },
    );
    dispatchJobs(c.env, c.executionCtx);
    return c.json(closed, 200);
  });
  platform.openapi(R.jobs, async (c) => {
    const { id } = c.req.valid('param');
    requireSupport(c);
    const jobs = await withPlatform(c.var.staff.client, (tx) => listJobs(tx, id));
    return c.json(await Promise.all(jobs.map((j) => jobOut(c.env, j))), 200);
  });
  platform.openapi(R.requestExport, async (c) => {
    const { id } = c.req.valid('param');
    requireSuperAdmin(c);
    const { job, created } = await withTenant(
      c.var.staff.client,
      id,
      (tx) => requestExport(tx, c.var.staff.actor),
      { requestId: c.var.requestId },
    );
    if (created) dispatchJobs(c.env, c.executionCtx);
    return c.json(await jobOut(c.env, job), 202);
  });
  platform.openapi(R.reopen, async (c) => {
    const { id } = c.req.valid('param');
    const reopened = await reopenTenant(
      c.var.staff.client,
      c.var.staff.actor,
      id,
      c.req.valid('json'),
      { requestId: c.var.requestId, afterCommit: relayTo(c) },
    );
    return c.json(reopened, 200);
  });
  platform.openapi(R.checklist, async (c) => {
    const { id } = c.req.valid('param');
    requireSupport(c);
    const health = await withPlatform(c.var.staff.client, (tx) => readStoreHealth(tx, id));
    const list = health?.checklist;
    return c.json(list && 'items' in list ? (list as Checklist) : null, 200);
  });
  platform.openapi(R.health, async (c) => {
    const { id } = c.req.valid('param');
    requireSupport(c);
    return c.json(await withPlatform(c.var.staff.client, (tx) => readStoreHealth(tx, id)), 200);
  });
  platform.openapi(R.refreshHealth, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(await refreshStoreHealth(c.var.staff.client, c.var.staff.actor, id), 200);
  });
  platform.openapi(R.dashboard, async (c) => {
    const today = dhakaDate(new Date());
    const data = await withPlatform(c.var.staff.client, (tx) =>
      platformDashboard(tx, c.var.staff.actor, today),
    );
    // As of this morning's alarm run: no query, and the alarm stays the source (Q12).
    const file = await c.env.FILES.get(USAGE_FILE).catch(() => null);
    const raw = file
      ? ((await file.json().catch(() => null)) as Record<string, unknown> | null)
      : null;
    const freeTier = raw
      ? {
          generatedAt: String(raw.generatedAt ?? ''),
          limits: Array.isArray(raw.limits) ? (raw.limits as FreeTierLimit[]) : [],
          deadLetters: (raw.deadLetters as Record<string, number | null> | undefined) ?? {},
          alarms: Number(raw.alarms ?? 0),
        }
      : null;
    return c.json({ ...data, freeTier }, 200);
  });
  platform.openapi(R.terms, async (c) =>
    c.json(
      await withPlatform(c.var.staff.client, (tx) => listTermsVersions(tx, c.var.staff.actor)),
      200,
    ),
  );
  platform.openapi(R.publishTerms, async (c) => {
    requireSuperAdmin(c);
    const input = c.req.valid('json');
    const sha256 = input.sha256 ?? (await hashOf(input.url, c.var.config.PLATFORM_DOMAIN));
    const published = await withPlatform(
      c.var.staff.client,
      (tx) =>
        publishTerms(tx, c.var.staff.actor, {
          version: input.version,
          effectiveAt: new Date(input.effectiveAt),
          url: input.url,
          sha256,
        }),
      { requestId: c.var.requestId },
    );
    return c.json(published, 201);
  });
  platform.openapi(R.plans, async (c) =>
    c.json(await withPlatform(c.var.staff.client, (tx) => listPlans(tx, c.var.staff.actor)), 200),
  );
  platform.openapi(R.createPlan, async (c) => {
    const plan = await withPlatform(
      c.var.staff.client,
      (tx) => createPlan(tx, c.var.staff.actor, c.req.valid('json')),
      { requestId: c.var.requestId },
    );
    return c.json(plan, 201);
  });
  platform.openapi(R.updatePlan, async (c) => {
    const { id } = c.req.valid('param');
    const plan = await withPlatform(
      c.var.staff.client,
      (tx) => updatePlan(tx, c.var.staff.actor, id, c.req.valid('json')),
      { requestId: c.var.requestId },
    );
    return c.json(plan, 200);
  });
  platform.openapi(R.subscription, async (c) => {
    const { id } = c.req.valid('param');
    requireSupport(c);
    return c.json(await withTenant(c.var.staff.client, id, (tx) => getSubscription(tx, id)), 200);
  });
  platform.openapi(R.setSubscription, async (c) => {
    const { id } = c.req.valid('param');
    const saved = await setSubscription(
      c.var.staff.client,
      c.var.staff.actor,
      id,
      c.req.valid('json'),
      { requestId: c.var.requestId, afterCommit: relayTo(c) },
    );
    return c.json(saved, 200);
  });
  platform.openapi(R.holdSubscription, async (c) => {
    const { id } = c.req.valid('param');
    const { until, reason } = c.req.valid('json');
    const saved = await holdSubscription(
      c.var.staff.client,
      c.var.staff.actor,
      id,
      { until, ...(reason ? { reason } : {}) },
      { requestId: c.var.requestId },
    );
    return c.json(saved, 200);
  });
  platform.openapi(R.reactivate, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(await transition(c, id, 'reactivate', c.req.valid('json').reason), 200);
  });

  platform.openapi(R.supportAccess, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const { staff } = c.var;
    const granted = await grantSupportAccess(staff.client, staff.actor, id, input, {
      requestId: c.var.requestId,
    });
    // Each Owner hears about it in their own language (§5.4, Q5).
    const mailer = createMailer(c.env, c.var.config, c.executionCtx);
    for (const owner of granted.owners) {
      const rendered = supportAccessEmail({
        locale: owner.locale,
        platformName: c.var.config.PLATFORM_NAME,
        supportName: staff.user.name,
        storeName: granted.store.name,
        role: granted.grant.role,
        reason: input.reason,
        until: granted.grant.expiresAt,
      });
      mailer.sendLater({ to: owner.email, ...rendered }, 'support_access');
    }
    return c.json(granted.grant, 201);
  });
  platform.openapi(R.revokeSupport, async (c) => {
    const { id } = c.req.valid('param');
    await revokeSupportAccess(c.var.staff.client, c.var.staff.actor, id, {
      requestId: c.var.requestId,
    });
    return c.body(null, 204);
  });
  platform.openapi(R.staff, async (c) =>
    c.json(
      await withPlatform(c.var.staff.client, (tx) => listPlatformStaff(tx, c.var.staff.actor)),
      200,
    ),
  );
  platform.openapi(R.setRole, async (c) => {
    const { id } = c.req.valid('param');
    const { role } = c.req.valid('json');
    await withPlatform(
      c.var.staff.client,
      (tx) => setPlatformRole(tx, c.var.staff.actor, id, role),
      {
        requestId: c.var.requestId,
      },
    );
    return c.body(null, 204);
  });
  platform.openapi(R.auditLog, async (c) => {
    const { before, limit = 50 } = c.req.valid('query');
    const items = await withPlatform(c.var.staff.client, (tx) =>
      listPlatformAudit(tx, c.var.staff.actor, { limit, ...(before ? { before } : {}) }),
    );
    return c.json({ items, next: items.length === limit ? (items.at(-1)?.id ?? null) : null }, 200);
  });
  registerPlatformBilling(platform);
}
