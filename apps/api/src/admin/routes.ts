// The admin API, /v1/admin/* (reached as /api/admin/* on the admin host;
// phase-1-plan §7.1). Every route needs a session; store routes also need
// an active store, and each core command checks its own permission again.
// Another store's IDs answer 404, never 403, so existence doesn't leak; the
// isolation suite calls every route that takes an ID to prove it.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  acceptInvitation,
  acceptTerms,
  authorize,
  CHECKLIST_ITEMS,
  changeRole,
  getStore,
  getSupport,
  invite,
  leaveStore,
  listInvitations,
  listMembers,
  listMyStores,
  loadCredentials,
  removeMember,
  resendInvitation,
  revokeInvitation,
  runIdempotent,
  setActiveStore,
  setupChecklist,
  termsStatus,
  updateMyProfile,
  updateStoreProfile,
  withPlatform,
} from '@managemind/core';
import { invitationEmail } from '@managemind/providers/email';
import { AppError, PERMISSIONS, STORE_ROLES } from '@managemind/shared';
import { backOfficeSettings } from '@managemind/shared/back-office';
import { metaSettings } from '@managemind/shared/channels';
import { notificationSettings } from '@managemind/shared/notifications';
import {
  checkoutSettings,
  codSettings,
  confirmationSettings,
  courierSettings,
  fraudSettings,
  recoverySettings,
  returnSettings,
} from '@managemind/shared/orders';
import { storeProfile, taxSettings, tenantSettings } from '@managemind/shared/settings';
import { storefrontSettings } from '@managemind/shared/storefront';
import type { Context } from 'hono';
import { createMailer, shopperEmailReady } from '../auth/email';
import { adminOrigin } from '../auth/routes';
import type { AppEnv } from '../env';
import { credentialsKeyring } from '../notifications';
import { gatewayFor } from '../payments';
import { BILLING_ROUTES, registerBilling } from './billing';
import { CATALOG_ROUTES, registerCatalog } from './catalog';
import { CHANNEL_ROUTES, registerChannels } from './channels';
import { inStore, relayTo, type StaffEnv, staffSession } from './context';
import { COURIER_ROUTES, registerCouriers } from './couriers';
import { CREDENTIAL_ROUTES, registerCredentials } from './credentials';
import { DOMAIN_ROUTES, registerDomains } from './domains';
import { EXPENSE_ROUTES, registerExpenses } from './expenses';
import { EXPORT_ROUTES, registerExport } from './export';
import { IMPORT_ROUTES, registerImports } from './imports';
import { MEDIA_ROUTES, registerMediaRoutes } from './media';
import { MESSAGE_ROUTES, registerMessages } from './messages';
import { ORDER_ROUTES, registerOrders } from './orders';
import { PROMOTION_ROUTES, registerPromotions } from './promotions';
import { PURCHASING_ROUTES, registerPurchasing } from './purchasing';
import { REPORT_ROUTES, registerReports } from './reports';
import { RETURN_ROUTES, registerReturns } from './returns';
import { registerStock, STOCK_ROUTES } from './stock';
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
    fraud: fraudSettings,
    confirmation: confirmationSettings,
    recovery: recoverySettings,
    couriers: courierSettings,
    backOffice: backOfficeSettings,
    meta: metaSettings,
    returns: returnSettings,
    notifications: notificationSettings,
    setup: tenantSettings.shape.setup,
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
  ...RETURN_ROUTES,
  ...BILLING_ROUTES,
  ...EXPORT_ROUTES,
  ...REPORT_ROUTES,
  ...CREDENTIAL_ROUTES,
  ...COURIER_ROUTES,
  ...CHANNEL_ROUTES,
  ...PURCHASING_ROUTES,
  ...STOCK_ROUTES,
  ...EXPENSE_ROUTES,
  ...MESSAGE_ROUTES,
  ...PROMOTION_ROUTES,
  help: r({
    method: 'get',
    path: '/help',
    summary:
      "The help menu: the guide, support email and WhatsApp, and the platform's documents (any staff)",
    responses: json(
      z.object({
        helpUrl: z.string().nullable(),
        email: z.string().nullable(),
        whatsapp: z.string().nullable(),
        termsUrl: z.string().nullable(),
        privacyUrl: z.string().nullable(),
        dpaUrl: z.string().nullable(),
      }),
      'Help',
    ),
  }),
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
        fraud: fraudSettings.optional(),
        confirmation: confirmationSettings.optional(),
        recovery: recoverySettings.optional(),
        couriers: courierSettings.optional(),
        backOffice: backOfficeSettings.optional(),
        meta: metaSettings.optional(),
        returns: returnSettings.optional(),
        notifications: notificationSettings.optional(),
        setup: tenantSettings.shape.setup.optional(),
      }),
    ),
    responses: json(Store, 'Store'),
  }),
  termsPending: r({
    method: 'get',
    path: '/terms/pending',
    summary:
      "The platform terms the store's owners haven't accepted, and whether their admin is read-only until one does (phase-5b-plan §3.4)",
    responses: json(
      z.object({
        pending: z
          .object({
            id: z.uuid(),
            version: z.string(),
            effectiveAt: z.date(),
            url: z.string(),
          })
          .nullable(),
        blocking: z.boolean(),
        /** Whether the signed-in user can accept: an owner by membership. */
        canAccept: z.boolean(),
      }),
      'Terms',
    ),
  }),
  acceptTerms: r({
    method: 'post',
    path: '/terms/accept',
    summary: 'Accept a version of the platform terms for the store (owners)',
    request: body(z.object({ versionId: z.uuid() })),
    responses: json(z.object({ accepted: z.literal(true) }), 'Accepted'),
  }),
  setup: r({
    method: 'get',
    path: '/setup',
    summary:
      'What the store still needs before its first order (settings.read; phase-5b-plan §3.2)',
    responses: json(
      z.object({
        items: z.array(
          z.object({ item: z.enum(CHECKLIST_ITEMS), done: z.boolean(), optional: z.boolean() }),
        ),
        done: z.number().int(),
        total: z.number().int(),
        complete: z.boolean(),
      }),
      'Checklist',
    ),
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
  admin.openapi(R.help, async (c) => {
    const { client } = c.var.staff;
    const support = await withPlatform(client, (tx) => getSupport(tx));
    // The terms in force now: the newest version whose date has come.
    const { rows } = await client.query<{ url: string }>(
      'select url from platform.terms_versions where effective_at <= now() order by effective_at desc limit 1',
    );
    return c.json(
      {
        helpUrl: support.helpUrl ?? null,
        email: support.email ?? null,
        whatsapp: support.whatsapp ?? null,
        termsUrl: rows[0]?.url ?? null,
        privacyUrl: support.privacyUrl ?? null,
        dpaUrl: support.dpaUrl ?? null,
      },
      200,
    );
  });
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
  admin.openapi(R.termsPending, async (c) => {
    const actor = c.var.staff.actor;
    const status = await inStore(c, (tx) => termsStatus(tx, tx.tenantId));
    const p = status.pending;
    return c.json(
      {
        pending: p
          ? { id: p.id, version: p.version, effectiveAt: p.effectiveAt, url: p.url }
          : null,
        blocking: status.blocking,
        canAccept: actor.storeRole === 'owner' && !actor.supportGrantId,
      },
      200,
    );
  });
  admin.openapi(R.acceptTerms, async (c) => {
    const { versionId } = c.req.valid('json');
    const ip = c.req.header('cf-connecting-ip') ?? null;
    return c.json(
      await inStore(c, (tx) =>
        acceptTerms(tx, c.var.staff.actor, {
          versionId,
          ip: ip && /^[\d.:a-fA-F]+$/.test(ip) ? ip : null,
          userAgent: c.req.header('user-agent') ?? null,
        }),
      ),
      200,
    );
  });
  admin.openapi(R.setup, async (c) =>
    c.json(
      await inStore(c, (tx) => {
        authorize(c.var.staff.actor, 'settings.read');
        return setupChecklist(tx);
      }),
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
        async (tx) => {
          // The advance is paid online and the OTP goes by SMS (phase-5a-plan §3.4, §3.14):
          // neither can be turned on before the store's gateway works. A rule
          // saved earlier stays, and checkout skips it until the gateway works.
          const current =
            patch.cod || patch.confirmation ? await getStore(tx, c.var.staff.actor) : null;
          const before = current?.cod ?? null;
          if (
            patch.cod &&
            patch.cod.advance !== 'never' &&
            patch.cod.advance !== before?.advance &&
            !(await gatewayFor(tx, c.env))
          ) {
            throw new AppError('validation_failed', {
              detail: 'Set up SSLCommerz first: the advance is paid online',
              fields: [
                { path: 'cod.advance', code: 'needs_gateway', message: 'SSLCommerz is not set up' },
              ],
            });
          }
          if (
            patch.cod &&
            patch.cod.otp !== 'off' &&
            patch.cod.otp !== before?.otp &&
            !(await loadCredentials(tx, await credentialsKeyring(c.env), 'sms'))
          ) {
            throw new AppError('validation_failed', {
              detail: 'Set up an SMS gateway first: the code goes by SMS',
              fields: [{ path: 'cod.otp', code: 'needs_sms', message: 'No SMS gateway is set up' }],
            });
          }
          // The confirmation link goes by SMS too (phase-6-plan §3.7, Q9).
          if (
            patch.confirmation?.smsLink &&
            !current?.confirmation.smsLink &&
            !(await loadCredentials(tx, await credentialsKeyring(c.env), 'sms'))
          ) {
            throw new AppError('validation_failed', {
              detail: 'Set up an SMS gateway first: the link goes by SMS',
              fields: [
                {
                  path: 'confirmation.smsLink',
                  code: 'needs_sms',
                  message: 'No SMS gateway is set up',
                },
              ],
            });
          }
          return {
            ...(await updateStoreProfile(tx, c.var.staff.actor, patch)),
            storeUrl: (await storeUrls(c, tx)).store,
          };
        },
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
  registerReturns(admin);
  registerBilling(admin);
  registerExport(admin);
  registerReports(admin);
  registerCredentials(admin);
  registerCouriers(admin);
  registerChannels(admin);
  registerPurchasing(admin);
  registerStock(admin);
  registerExpenses(admin);
  registerMessages(admin);
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
