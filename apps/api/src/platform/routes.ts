// The platform API, /v1/platform/* (reached as /api/platform/* on the admin
// host; phase-1-plan §5.3, §7.1). Every route needs a platform role AND a
// user who has set up two-factor login; a platform user who hasn't is sent
// to enrolment (403 two_factor_required) and can do nothing else here.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  createTenant,
  getTenantDetail,
  grantSupportAccess,
  listPlatformAudit,
  listPlatformStaff,
  listTenants,
  revokeSupportAccess,
  setPlatformRole,
  transitionTenant,
  withPlatform,
} from '@managemind/core';
import { supportAccessEmail } from '@managemind/providers/email';
import { AppError, PLATFORM_ROLES } from '@managemind/shared';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { relayTo, type StaffEnv, staffSession } from '../admin/context';
import { createMailer } from '../auth/email';
import type { AppEnv } from '../env';

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

const TenantSummary = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    status: Status,
    plan: z.string(),
    createdAt: z.date(),
  })
  .openapi('TenantSummary');
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
      }),
    ),
    responses: json(
      z.object({ id: z.uuid(), slug: z.string(), ownerUserId: z.uuid() }),
      'Created',
      201,
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
    summary: 'Suspend a store (super_admin)',
    request: { params: Id, ...body(Reason) },
    responses: json(z.object({ from: Status, to: Status }), 'Suspended'),
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
    return c.json(created, 201);
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
  ) =>
    transitionTenant(c.var.staff.client, c.var.staff.actor, id, event, reason ? { reason } : {}, {
      requestId: c.var.requestId,
      afterCommit: relayTo(c),
    });
  platform.openapi(R.suspend, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(await transition(c, id, 'suspend', c.req.valid('json').reason), 200);
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
}
