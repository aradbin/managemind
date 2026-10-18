// Shopper accounts at the store host's /api/auth/* and /api/account/*
// (phase-4-plan §3.11, §6.1): Better Auth's code sign-in, and the account's
// profile, orders and saved addresses. Off unless the store turned accounts
// on and shopper email can go out; then every route answers 404. The
// shopper always comes from the session, never from the request.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  addShopperAddress,
  deleteShopperAddress,
  type OrderSettings,
  orderSettings,
  shopperAddresses,
  shopperOrders,
  shopperProfile,
  signInCart,
  type TenantTx,
  updateShopperAddress,
  updateShopperProfile,
} from '@managemind/core';
import { shopperSignInCodeEmail } from '@managemind/providers/email';
import { AppError } from '@managemind/shared';
import type { Locale } from '@managemind/shared/i18n';
import type { Context } from 'hono';
import { createShopperMailer, shopperEmailReady } from '../auth/email';
import type { AppEnv } from '../env';
import { verifyTurnstile } from '../turnstile';
import { shopSiteKey } from '../turnstile-hosts';
import {
  CART_COOKIE,
  cartCookies,
  clearedCartCookies,
  cookie,
  inShopStore,
  limiterFor,
  shopperIp,
  withShopStore,
} from './commerce';
import {
  createShopperAuth,
  SHOPPER_AUTH_ENDPOINTS,
  SHOPPER_AUTH_PATH,
  SHOPPER_CODE_SECONDS,
  storeSecret,
} from './shopper-auth';

const API_AUTH = '/v1/store/auth';
const SEND_CODE = '/email-otp/send-verification-otp';
const SIGN_IN = '/sign-in/email-otp';
const SIGN_OUT = '/sign-out';

const accountsOn = (c: Context<AppEnv>, settings: OrderSettings) =>
  settings.checkout.accounts && shopperEmailReady(c.var.config);

const requestLocale = (c: Context<AppEnv>, settings: OrderSettings): Locale => {
  const q = c.req.query('locale');
  return q === 'en' || q === 'bn' ? q : settings.defaultLocale;
};

/** The store's auth instance for this request, inside its transaction. */
async function authFor(
  c: Context<AppEnv>,
  tx: TenantTx,
  tenantId: string,
  settings: OrderSettings,
) {
  const host = c.req.header('x-forwarded-host') ?? '';
  const config = c.var.config;
  const mailer = createShopperMailer(c.env, config, c.executionCtx, {
    name: settings.name,
    replyTo: settings.settings.profile.contactEmail,
  });
  return createShopperAuth({
    db: tx.db,
    secret: await storeSecret(config.AUTH_SECRET, tenantId),
    origin: `https://${host}`,
    storeName: settings.name,
    locale: requestLocale(c, settings),
    sendCode: ({ email, code, locale }) => {
      const rendered = shopperSignInCodeEmail({
        locale,
        storeName: settings.name,
        code,
        minutes: SHOPPER_CODE_SECONDS / 60,
      });
      mailer.sendLater({ to: email, ...rendered }, 'shopper_sign_in_code');
    },
  });
}

/** The signed-in shopper's ID, or null. */
export async function currentShopper(
  c: Context<AppEnv>,
  tx: TenantTx,
  tenantId: string,
  settings: OrderSettings,
): Promise<string | null> {
  if (!accountsOn(c, settings) || !(c.req.header('cookie') ?? '').includes('mm_session')) {
    return null;
  }
  const auth = await authFor(c, tx, tenantId, settings);
  const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  return session?.user.id ?? null;
}

/** Runs `fn` for the signed-in shopper, in one store transaction; 401 when signed out. */
const asShopper = <T>(
  c: Context<AppEnv>,
  fn: (tx: TenantTx, userId: string) => Promise<T>,
): Promise<T> =>
  inShopStore(c, async (tx, tenantId) => {
    const settings = await orderSettings(tx);
    if (!accountsOn(c, settings)) throw new AppError('not_found');
    const userId = await currentShopper(c, tx, tenantId, settings);
    // The sign-in form needs the host's Turnstile key (§3.15).
    if (!userId)
      throw new AppError('unauthorized', {
        extensions: { turnstileSiteKey: await shopSiteKey(c, tx) },
      });
    return fn(tx, userId);
  });

async function bodyEmail(request: Request): Promise<string | undefined> {
  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as { email?: unknown } | null;
  return typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined;
}

// ---- Account routes ---------------------------------------------------------------------

const Host = z.object({ 'x-forwarded-host': z.string().min(1).max(253) });
const Profile = z
  .object({ id: z.uuid(), name: z.string(), email: z.string(), phone: z.string().nullable() })
  .openapi('ShopperProfile');
const Address = z
  .object({
    id: z.uuid(),
    name: z.string(),
    phone: z.string(),
    divisionId: z.number().int(),
    districtId: z.number().int(),
    areaId: z.number().int(),
    line: z.string(),
    label: z.string().nullable(),
    isDefault: z.boolean(),
  })
  .openapi('ShopperAddress');
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  200: { content: { 'application/json': { schema } }, description },
});
const AnyBody = {
  body: {
    content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
    required: true,
  },
};
const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/store${config.path}`, tags: ['store'] } as C & {
    tags: string[];
  });

export const ACCOUNT_ROUTES = {
  account: r({
    method: 'get',
    path: '/account',
    summary: 'The signed-in shopper and their saved addresses',
    request: { headers: Host },
    responses: json(z.object({ profile: Profile, addresses: z.array(Address) }), 'Account'),
  }),
  updateAccount: r({
    method: 'patch',
    path: '/account',
    summary: 'Change the name or phone',
    request: { headers: Host, ...AnyBody },
    responses: json(Profile, 'Updated'),
  }),
  accountOrders: r({
    method: 'get',
    path: '/account/orders',
    summary: 'Orders placed while signed in (guest orders aren’t linked by phone)',
    request: { headers: Host },
    responses: json(
      z.array(
        z.object({
          id: z.uuid(),
          number: z.number().int(),
          displayNumber: z.string(),
          status: z.string(),
          paymentStatus: z.string(),
          deliveryStatus: z.string(),
          total: z.number().int(),
          itemCount: z.number().int(),
          placedAt: z.string(),
        }),
      ),
      'Orders',
    ),
  }),
  addAddress: r({
    method: 'post',
    path: '/account/addresses',
    summary: 'Save an address (at most 10)',
    request: { headers: Host, ...AnyBody },
    responses: {
      201: { content: { 'application/json': { schema: Address } }, description: 'Saved' },
    },
  }),
  updateAddress: r({
    method: 'patch',
    path: '/account/addresses/{id}',
    summary: 'Change a saved address',
    request: { headers: Host, params: z.object({ id: z.uuid() }), ...AnyBody },
    responses: json(Address, 'Updated'),
  }),
  deleteAddress: r({
    method: 'delete',
    path: '/account/addresses/{id}',
    summary: 'Delete a saved address',
    request: { headers: Host, params: z.object({ id: z.uuid() }) },
    responses: { 204: { description: 'Deleted' } },
  }),
} as const;

export function registerAccount(app: OpenAPIHono<AppEnv>): void {
  for (const [endpoint, summary] of Object.entries(SHOPPER_AUTH_ENDPOINTS)) {
    const [method = '', path = ''] = endpoint.split(' ');
    app.openAPIRegistry.registerPath({
      method: method.toLowerCase() as 'get' | 'post',
      path: `${API_AUTH}${path}`,
      tags: ['store'],
      summary,
      responses: { 200: { description: 'Better Auth response (JSON)' } },
    });
  }

  app.on(['GET', 'POST'], `${API_AUTH}/*`, async (c) => {
    const path = c.req.path.slice(API_AUTH.length);
    if (!Object.hasOwn(SHOPPER_AUTH_ENDPOINTS, `${c.req.method} ${path}`)) {
      throw new AppError('not_found');
    }
    const host = c.req.header('x-forwarded-host') ?? '';
    const ip = shopperIp(c);
    const email = path === SEND_CODE || path === SIGN_IN ? await bodyEmail(c.req.raw) : undefined;
    const limiter = limiterFor(c);
    const response = await withShopStore(c, async (run, tenantId) => {
      const [settings, siteKey] = await run(
        async (tx) => [await orderSettings(tx), await shopSiteKey(c, tx)] as const,
      );
      if (!accountsOn(c, settings)) throw new AppError('not_found');
      // Limits and Turnstile before any auth work, with no transaction open (§3.15).
      if (path === SEND_CODE) {
        await limiter.check('otp-send:ip', `shop:${ip}`);
        if (email) await limiter.check('otp-send:email', `shop:${tenantId}:${email}`);
        if (siteKey)
          await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, c.req.header('x-turnstile-token'), {
            host,
            ip,
          });
      }
      if (path === SIGN_IN && email)
        await limiter.check('otp-verify:email', `shop:${tenantId}:${email}`);

      return run(async (tx) => {
        const auth = await authFor(c, tx, tenantId, settings);
        // Better Auth sees the request on the store's own origin and path. The
        // storefront proxy has already checked the browser's Origin against
        // this host, so the store's origin stands in for it.
        const url = new URL(c.req.url);
        const headers = new Headers(c.req.raw.headers);
        headers.set('origin', `https://${host}`);
        const request = new Request(`https://${host}${SHOPPER_AUTH_PATH}${path}${url.search}`, {
          method: c.req.method,
          headers,
          ...(c.req.method === 'POST' ? { body: await c.req.raw.clone().text() } : {}),
        });
        const res = await auth.handler(request);
        // Read before the body moves into the copy: a used body can't be cloned on Workers.
        const signedIn =
          path === SIGN_IN && res.ok
            ? ((await res
                .clone()
                .json()
                .catch(() => null)) as { user?: { id?: string } } | null)
            : null;
        const out = new Response(res.body, res);
        if (signedIn) {
          const userId = signedIn.user?.id;
          if (userId) {
            const cart = await signInCart(tx, cookie(c, CART_COOKIE), userId);
            if (cart) {
              for (const value of cartCookies(cart.token, cart.itemCount))
                out.headers.append('Set-Cookie', value);
            }
          }
        }
        return out;
      });
    });
    if (path === SIGN_IN && email) {
      if (response.ok) await limiter.succeed('otp-verify:email', `shop:${c.var.tenantId}:${email}`);
      else if (response.status >= 400 && response.status < 500 && response.status !== 429)
        await limiter.fail('otp-verify:email', `shop:${c.var.tenantId}:${email}`);
    }
    if (path === SIGN_OUT) {
      // The cart belongs to the account now: a shared computer keeps neither.
      for (const value of clearedCartCookies()) response.headers.append('Set-Cookie', value);
    }
    response.headers.set('Cache-Control', 'no-store');
    return response;
  });

  const R = ACCOUNT_ROUTES;
  app.openapi(R.account, (async (c: Context<AppEnv>) => {
    const out = await asShopper(c, async (tx, userId) => ({
      profile: await shopperProfile(tx, userId),
      addresses: await shopperAddresses(tx, userId),
    }));
    c.header('Cache-Control', 'no-store');
    return c.json(out, 200);
  }) as never);
  app.openapi(R.updateAccount, (async (c: Context<AppEnv>) => {
    const input = await c.req.json();
    return c.json(await asShopper(c, (tx, userId) => updateShopperProfile(tx, userId, input)), 200);
  }) as never);
  app.openapi(R.accountOrders, (async (c: Context<AppEnv>) => {
    c.header('Cache-Control', 'no-store');
    return c.json(await asShopper(c, (tx, userId) => shopperOrders(tx, userId)), 200);
  }) as never);
  app.openapi(R.addAddress, (async (c: Context<AppEnv>) => {
    const input = await c.req.json();
    return c.json(await asShopper(c, (tx, userId) => addShopperAddress(tx, userId, input)), 201);
  }) as never);
  app.openapi(R.updateAddress, (async (c: Context<AppEnv>) => {
    const input = await c.req.json();
    const id = c.req.param('id') ?? '';
    return c.json(
      await asShopper(c, (tx, userId) => updateShopperAddress(tx, userId, id, input)),
      200,
    );
  }) as never);
  app.openapi(R.deleteAddress, (async (c: Context<AppEnv>) => {
    const id = c.req.param('id') ?? '';
    await asShopper(c, (tx, userId) => deleteShopperAddress(tx, userId, id));
    return c.body(null, 204);
  }) as never);
}
