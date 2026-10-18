// The admin API, /v1/admin/* (reached as /api/admin/* on the admin host;
// phase-1-plan §7.1). Every route needs a session; store routes also need
// an active store, and each core command checks its own permission again.
// Another store's IDs answer 404, never 403, so existence doesn't leak; the
// isolation suite calls every route that takes an ID to prove it.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  acceptInvitation,
  changeRole,
  getStore,
  invite,
  leaveStore,
  listInvitations,
  listMembers,
  listMyStores,
  removeMember,
  resendInvitation,
  revokeInvitation,
  runIdempotent,
  setActiveStore,
  updateMyProfile,
  updateStoreProfile,
  withPlatform,
} from '@managemind/core';
import { invitationEmail } from '@managemind/providers/email';
import { AppError, PERMISSIONS, STORE_ROLES } from '@managemind/shared';
import { checkoutSettings, codSettings } from '@managemind/shared/orders';
import { storeProfile, taxSettings, tenantSettings } from '@managemind/shared/settings';
import { storefrontSettings } from '@managemind/shared/storefront';
import type { Context } from 'hono';
import { createMailer, shopperEmailReady } from '../auth/email';
import { adminOrigin } from '../auth/routes';
import type { AppEnv } from '../env';
import { CATALOG_ROUTES, registerCatalog } from './catalog';
import { inStore, relayTo, type StaffEnv, staffSession } from './context';
import { DOMAIN_ROUTES, registerDomains } from './domains';
import { IMPORT_ROUTES, registerImports } from './imports';
import { MEDIA_ROUTES, registerMediaRoutes } from './media';
import { ORDER_ROUTES, registerOrders } from './orders';
import { PROMOTION_ROUTES, registerPromotions } from './promotions';
import { storeUrls } from './store-urls';
import { registerStorefrontAdmin, STOREFRONT_ROUTES } from './storefront';

const Role = z.enum(STORE_ROLES);
const Locale = z.enum(['bn', 'en']);
const Id = z.object({ id: z.uuid() });
const ok = (description: string) => ({ 204: { description } });
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  200: { content: { 'application/json': { schema } }, description },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});

const MyStore = z.object({
  tenantId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  role: Role,
  supportUntil: z.date().optional(),
});
const Me = z
  .object({
    user: z.object({
      id: z.uuid(),
      name: z.string(),
      email: z.string(),
      locale: Locale,
      twoFactorEnabled: z.boolean(),
      platformRole: z.enum(['support', 'super_admin']).nullable(),
    }),
    stores: z.array(MyStore),
    activeStore: z.uuid().nullable(),
    role: Role.nullable(),
    supportGrant: z.boolean(),
    /** The live support grant behind this access, so support can end it early. */
    supportGrantId: z.uuid().nullable(),
    permissions: z.array(z.enum(PERMISSIONS)),
  })
  .openapi('Me');
const Store = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    status: z.enum(['active', 'suspended', 'closed', 'purged']),
    defaultLocale: Locale,
    profile: storeProfile,
    tax: taxSettings,
    storefront: storefrontSettings,
    display: tenantSettings.shape.display,
    checkout: checkoutSettings,
    cod: codSettings,
    /** The store's home page, for the admin's "View store" link. */
    storeUrl: z.string(),
  })
  .openapi('Store');
const Member = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    name: z.string(),
    email: z.string(),
    role: Role,
    createdAt: z.date(),
  })
  .openapi('Member');
const Invitation = z
  .object({ id: z.uuid(), email: z.string(), role: Role, expiresAt: z.date(), createdAt: z.date() })
  .openapi('Invitation');

/** Drops undefined keys: zod's optional fields carry `undefined`, the core types don't. */
const compact = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['admin'] } as C & {
    tags: string[];
  });

/** Every admin route, by method and path; the isolation suite reads this. */
export const ADMIN_ROUTES = {
  ...CATALOG_ROUTES,
  ...MEDIA_ROUTES,
  ...IMPORT_ROUTES,
  ...STOREFRONT_ROUTES,
  ...DOMAIN_ROUTES,
  ...ORDER_ROUTES,
  ...PROMOTION_ROUTES,
  me: r({
    method: 'get',
    path: '/me',
    summary: 'The signed-in user, their stores and permissions',
    responses: json(Me, 'Me'),
  }),
  updateMe: r({
    method: 'patch',
    path: '/me',
    summary: 'Change your name or language',
    request: body(
      z.object({ name: z.string().trim().min(1).max(100).optional(), locale: Locale.optional() }),
    ),
    responses: ok('Saved'),
  }),
  activeStore: r({
    method: 'put',
    path: '/me/active-store',
    summary: 'Switch store',
    request: body(z.object({ tenantId: z.uuid() })),
    responses: json(Me, 'Me in the new store'),
  }),
  store: r({
    method: 'get',
    path: '/store',
    summary: 'The active store (settings.read)',
    responses: json(Store, 'Store'),
  }),
  updateStore: r({
    method: 'patch',
    path: '/store',
    summary:
      'Edit the store profile, VAT, storefront, display, checkout and COD settings (settings.write)',
    request: body(
      z.object({
        name: z.string().trim().min(1).max(100).optional(),
        defaultLocale: Locale.optional(),
        profile: storeProfile.optional(),
        tax: taxSettings.optional(),
        storefront: storefrontSettings.optional(),
        display: tenantSettings.shape.display.optional(),
        checkout: checkoutSettings.optional(),
        cod: codSettings.optional(),
      }),
    ),
    responses: json(Store, 'Store'),
  }),
  members: r({
    method: 'get',
    path: '/members',
    summary: 'Staff, a page at a time (staff.read)',
    request: {
      query: z.object({
        after: z.uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }),
    },
    responses: json(z.object({ items: z.array(Member), next: z.uuid().nullable() }), 'Members'),
  }),
  leave: r({
    method: 'delete',
    path: '/members/me',
    summary: 'Leave the store',
    responses: ok('Left'),
  }),
  changeRole: r({
    method: 'patch',
    path: '/members/{id}',
    summary: 'Change a role (staff.write)',
    request: { params: Id, ...body(z.object({ role: Role })) },
    responses: ok('Changed'),
  }),
  removeMember: r({
    method: 'delete',
    path: '/members/{id}',
    summary: 'Remove a member (staff.write)',
    request: { params: Id },
    responses: ok('Removed'),
  }),
  invitations: r({
    method: 'get',
    path: '/invitations',
    summary: 'Pending invitations (staff.read)',
    responses: json(z.array(Invitation), 'Invitations'),
  }),
  invite: r({
    method: 'post',
    path: '/invitations',
    summary: 'Invite someone (staff.write; accepts Idempotency-Key)',
    request: body(z.object({ email: z.email().max(254), role: Role })),
    responses: {
      201: { content: { 'application/json': { schema: Invitation } }, description: 'Invited' },
    },
  }),
  resend: r({
    method: 'post',
    path: '/invitations/{id}/resend',
    summary: 'Send a new link (staff.write)',
    request: { params: Id },
    responses: json(Invitation, 'Resent'),
  }),
  revoke: r({
    method: 'delete',
    path: '/invitations/{id}',
    summary: 'Revoke an invitation (staff.write)',
    request: { params: Id },
    responses: ok('Revoked'),
  }),
  accept: r({
    method: 'post',
    path: '/invitations/accept',
    summary: 'Accept an invitation with its token',
    request: body(z.object({ token: z.string().min(20).max(100) })),
    responses: json(Me, 'Me in the joined store'),
  }),
} as const;

async function me(c: Context<StaffEnv>) {
  const { client, actor, user } = c.var.staff;
  const stores = await withPlatform(client, (tx) => listMyStores(tx, actor));
  return {
    user: { ...user, platformRole: actor.platformRole },
    stores,
    activeStore: actor.tenantId ?? null,
    role: actor.storeRole ?? null,
    supportGrant: Boolean(actor.supportGrantId),
    supportGrantId: actor.supportGrantId ?? null,
    permissions: [...actor.permissions],
  };
}

/** Emails a new invitation link, in the store's language, after the response. */
async function sendInvitation(
  c: Context<StaffEnv>,
  issued: { invitation: { email: string; role: (typeof STORE_ROLES)[number] }; token: string },
) {
  const store = await inStore(c, (tx) =>
    getStore(tx, { ...c.var.staff.actor, permissions: new Set(['settings.read']) }),
  );
  const config = c.var.config;
  const rendered = invitationEmail({
    locale: store.defaultLocale,
    platformName: config.PLATFORM_NAME,
    inviterName: c.var.staff.user.name,
    storeName: store.name,
    role: issued.invitation.role,
    // The token is in the fragment, so it never reaches a server log (ADR 0005).
    link: `${adminOrigin(c as unknown as Context<AppEnv>)}/invite#t=${issued.token}`,
    days: 7,
  });
  createMailer(c.env, config, c.executionCtx).sendLater(
    { to: issued.invitation.email, ...rendered },
    'invitation',
  );
}

export function registerAdmin(app: OpenAPIHono<AppEnv>): void {
  const admin = app as unknown as OpenAPIHono<StaffEnv>;
  admin.use('/v1/admin/*', staffSession);
  const R = ADMIN_ROUTES;

  admin.openapi(R.me, async (c) => c.json(await me(c), 200));
  admin.openapi(R.updateMe, async (c) => {
    const { client, actor } = c.var.staff;
    await withPlatform(client, (tx) => updateMyProfile(tx, actor, compact(c.req.valid('json'))));
    return c.body(null, 204);
  });
  admin.openapi(R.activeStore, async (c) => {
    const { client, actor, sessionId } = c.var.staff;
    const { tenantId } = c.req.valid('json');
    c.var.staff.actor = await withPlatform(client, (tx) =>
      setActiveStore(tx, actor, sessionId, tenantId),
    );
    return c.json(await me(c), 200);
  });

  admin.openapi(R.store, async (c) =>
    c.json(
      await inStore(c, async (tx) => ({
        ...(await getStore(tx, c.var.staff.actor)),
        storeUrl: (await storeUrls(c, tx)).store,
      })),
      200,
    ),
  );
  admin.openapi(R.updateStore, async (c) => {
    const patch = compact(c.req.valid('json'));
    // Accounts sign in by email code, so they need shopper email (ADR 0022).
    if (patch.checkout?.accounts && !shopperEmailReady(c.var.config)) {
      throw new AppError('feature_unavailable', {
        detail: 'Shopper email is not set up yet, so accounts can’t be turned on',
      });
    }
    return c.json(
      await inStore(
        c,
        async (tx) => ({
          ...(await updateStoreProfile(tx, c.var.staff.actor, patch)),
          storeUrl: (await storeUrls(c, tx)).store,
        }),
        { write: true },
      ),
      200,
    );
  });

  admin.openapi(R.members, async (c) => {
    const { after, limit = 50 } = c.req.valid('query');
    const items = await inStore(c, (tx) =>
      listMembers(tx, c.var.staff.actor, { ...(after ? { after } : {}), limit }),
    );
    return c.json({ items, next: items.length === limit ? (items.at(-1)?.id ?? null) : null }, 200);
  });
  admin.openapi(R.leave, async (c) => {
    await inStore(c, (tx) => leaveStore(tx, c.var.staff.actor));
    return c.body(null, 204);
  });
  admin.openapi(R.changeRole, async (c) => {
    const { id } = c.req.valid('param');
    const { role } = c.req.valid('json');
    await inStore(c, (tx) => changeRole(tx, c.var.staff.actor, id, role), { write: true });
    return c.body(null, 204);
  });
  admin.openapi(R.removeMember, async (c) => {
    const { id } = c.req.valid('param');
    await inStore(c, (tx) => removeMember(tx, c.var.staff.actor, id), { write: true });
    return c.body(null, 204);
  });

  admin.openapi(R.invitations, async (c) =>
    c.json(await inStore(c, (tx) => listInvitations(tx, c.var.staff.actor)), 200),
  );
  admin.openapi(R.invite, async (c) => {
    const input = c.req.valid('json');
    const key = c.req.header('idempotency-key');
    let issued: Awaited<ReturnType<typeof invite>> | undefined;
    const run = async (tx: Parameters<typeof invite>[0]) => {
      issued = await invite(tx, c.var.staff.actor, input);
      return { status: 201, body: issued.invitation };
    };
    const result = await inStore<{ body: unknown }>(
      c,
      (tx) =>
        key
          ? runIdempotent(tx, { scope: 'admin.invite', key, request: input }, () => run(tx))
          : run(tx),
      { write: true },
    );
    // A replayed request sends no second email.
    if (issued) await sendInvitation(c, issued);
    return c.json(result.body as never, 201);
  });
  admin.openapi(R.resend, async (c) => {
    const { id } = c.req.valid('param');
    const issued = await inStore(c, (tx) => resendInvitation(tx, c.var.staff.actor, id), {
      write: true,
    });
    await sendInvitation(c, issued);
    return c.json(issued.invitation, 200);
  });
  admin.openapi(R.revoke, async (c) => {
    const { id } = c.req.valid('param');
    await inStore(c, (tx) => revokeInvitation(tx, c.var.staff.actor, id), { write: true });
    return c.body(null, 204);
  });
  registerCatalog(admin);
  registerMediaRoutes(admin);
  registerImports(admin);
  registerStorefrontAdmin(admin);
  registerDomains(admin);
  registerOrders(admin);
  registerPromotions(admin);
  admin.openapi(R.accept, async (c) => {
    const { token } = c.req.valid('json');
    const { client, user, sessionId } = c.var.staff;
    const { tenantId } = await acceptInvitation(client, user, token, {
      requestId: c.var.requestId,
      afterCommit: relayTo(c),
    });
    c.var.staff.actor = await withPlatform(client, (tx) =>
      setActiveStore(tx, c.var.staff.actor, sessionId, tenantId),
    );
    return c.json(await me(c), 200);
  });
}
