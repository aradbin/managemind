// The storefront's cart, checkout and order endpoints (phase-4-plan §6.1),
// reached through the store host's /api/*. Never cached. The store comes
// only from X-Forwarded-Host. The cart is an opaque token in an HttpOnly
// cookie with Path=/api, so it never reaches a page request and cached
// pages stay cached; a second cookie holds only the item count for the
// header. Tokens and codes travel in bodies, never in URLs (Workers Logs
// record URLs). Writes from a browser must come from the store's own origin.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  addToCart,
  type CartView,
  cancelOrder,
  checkout,
  clearCartCode,
  draftAllowed,
  findOrderForTracking,
  getCart,
  orderOfGatewayPayment,
  orderSettings,
  pendingGatewayPayment,
  relayEvents,
  removeFromCart,
  resolveHost,
  saveCheckoutDetails,
  setCartArea,
  setCartCode,
  setCartQuantity,
  shopperActor,
  shopperAddresses,
  shopperOrderView,
  shopperProfile,
  type TenantTx,
  withTenant,
} from '@managemind/core';
import { createDb } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  checkoutInput,
  signOrderToken,
  trackInput,
  verifyOrderToken,
} from '@managemind/shared/orders';
import { holidayActive } from '@managemind/shared/storefront';
import { captureException } from '@sentry/cloudflare';
import type { Context } from 'hono';
import { queueSink, withClient } from '../db';
import type { AppEnv } from '../env';
import { log } from '../log';
import { otpVerified, smsGatewayFor } from '../otp/index';
import { gatewayFor, settleFromGateway, startGatewaySession } from '../payments';
import { createLimiter } from '../rate-limit/index';
import { verifyTurnstile } from '../turnstile';
import { shopSiteKey } from '../turnstile-hosts';
import { currentShopper } from './account';

export const CART_COOKIE = 'mm_cart';
export const CART_COUNT_COOKIE = 'mm_cart_n';
const CART_MAX_AGE = 30 * 86_400;

const Host = z.object({
  'x-forwarded-host': z.string().min(1).max(253).openapi({ example: 'demo-fashion.localhost' }),
});
const LocaleQuery = z.object({ locale: z.enum(['bn', 'en']).optional() });
const VariantParam = z.object({ variantId: z.uuid() });
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});

const Localized = z.object({ bn: z.string().optional(), en: z.string().optional() });
const Image = z
  .object({
    width: z.number(),
    height: z.number(),
    files: z.array(z.object({ width: z.number(), file: z.string() })),
    alt: z.string().nullable(),
  })
  .nullable();
const Totals = z.object({
  subtotal: z.number().int(),
  discountTotal: z.number().int(),
  deliveryFee: z.number().int(),
  deliveryDiscount: z.number().int(),
  vatTotal: z.number().int(),
  vatIncluded: z.boolean(),
  rounding: z.number().int(),
  total: z.number().int(),
});
const ShopperCart = z
  .object({
    itemCount: z.number().int(),
    areaId: z.number().int().nullable(),
    ready: z.boolean(),
    maxQuantityPerLine: z.number().int(),
    lines: z.array(
      z.object({
        variantId: z.uuid(),
        productId: z.string(),
        title: Localized,
        slugs: Localized,
        optionLabels: z.array(Localized),
        sku: z.string().nullable(),
        image: Image,
        unitPrice: z.number().int(),
        compareAtPrice: z.number().int().nullable(),
        quantity: z.number().int(),
        total: z.number().int(),
        maxQuantity: z.number().int().nullable(),
        problem: z.enum(['unavailable', 'insufficient_stock', 'over_limit']).nullable(),
      }),
    ),
    zone: z.object({ name: Localized, estimate: Localized }).nullable(),
    deliveryFrom: z.number().int().nullable(),
    totals: Totals,
    promotions: z.array(
      z.object({
        title: Localized,
        amount: z.number().int(),
        target: z.string(),
        code: z.string().optional(),
      }),
    ),
    code: z.object({ code: z.string(), status: z.string() }).nullable(),
    freeDelivery: z.object({ threshold: z.number().int(), remaining: z.number().int() }).nullable(),
  })
  .openapi('ShopperCart');
type ShopperCart = z.infer<typeof ShopperCart>;

const CheckoutState = z
  .object({
    cart: ShopperCart,
    cod: z.object({ enabled: z.boolean(), maxOrderValue: z.number().int().nullable() }),
    /** What can be paid online (phase-5a-plan §3.3, §3.4); off without a working gateway. */
    online: z.object({
      enabled: z.boolean(),
      advance: z.enum(['never', 'always', 'flagged']),
    }),
    holiday: z.object({ active: z.boolean(), message: Localized }),
    email: z.enum(['optional', 'required', 'hidden']),
    termsCheckbox: z.boolean(),
    accounts: z.boolean(),
    /** The signed-in shopper's details and saved addresses, to fill the form (§3.11). */
    account: z
      .object({
        name: z.string(),
        email: z.string(),
        phone: z.string().nullable(),
        addresses: z.array(
          z.object({
            id: z.uuid(),
            name: z.string(),
            phone: z.string(),
            divisionId: z.number().int(),
            districtId: z.number().int(),
            areaId: z.number().int(),
            line: z.string(),
            label: z.string().nullable(),
            isDefault: z.boolean(),
          }),
        ),
      })
      .nullable(),
    turnstileSiteKey: z.string().nullable(),
    /** Whether the checkout is saved as it is typed, with the notice (phase-6-plan §3.2). */
    recovery: z.object({ save: z.boolean() }),
  })
  .openapi('CheckoutState');
const PlacedOrder = z
  .object({
    id: z.uuid(),
    number: z.number().int(),
    displayNumber: z.string(),
    status: z.string(),
    total: z.number().int(),
    codAmount: z.number().int(),
    phone: z.string(),
    locale: z.string(),
    placedAt: z.string(),
    /** Valid for 24 hours: the confirmation page keeps it in its URL's fragment. */
    viewToken: z.string(),
    /** The gateway page to pay at, for an online payment; null if the session failed. */
    payUrl: z.string().nullable(),
  })
  .openapi('PlacedOrder');
const ShopperOrder = z.record(z.string(), z.unknown()).openapi('ShopperOrder');
const Tracked = z.object({ order: ShopperOrder, token: z.string() }).openapi('TrackedOrder');

const cartJson = {
  200: { content: { 'application/json': { schema: ShopperCart } }, description: 'The cart' },
};

const r = <const C extends Omit<Parameters<typeof createRoute>[0], 'tags'>>(config: C) =>
  createRoute({ ...config, tags: ['store'] } as C & { tags: string[] });

export const COMMERCE_ROUTES = {
  cart: r({
    method: 'get',
    path: '/v1/store/cart',
    summary: 'The shopper’s cart, priced now (empty without one)',
    request: { headers: Host },
    responses: cartJson,
  }),
  addLine: r({
    method: 'post',
    path: '/v1/store/cart/lines',
    summary: 'Add to cart; creates the cart and its cookies on the first add',
    request: {
      headers: Host,
      query: LocaleQuery,
      ...body(z.object({ variantId: z.uuid(), quantity: z.number().int() })),
    },
    responses: cartJson,
  }),
  setLine: r({
    method: 'patch',
    path: '/v1/store/cart/lines/{variantId}',
    summary: 'Change a quantity; 0 removes the line',
    request: {
      headers: Host,
      params: VariantParam,
      ...body(z.object({ quantity: z.number().int() })),
    },
    responses: cartJson,
  }),
  removeLine: r({
    method: 'delete',
    path: '/v1/store/cart/lines/{variantId}',
    summary: 'Remove a line',
    request: { headers: Host, params: VariantParam },
    responses: cartJson,
  }),
  setCode: r({
    method: 'put',
    path: '/v1/store/cart/code',
    summary: 'Apply a code (one per cart)',
    request: { headers: Host, ...body(z.object({ code: z.string() })) },
    responses: cartJson,
  }),
  clearCode: r({
    method: 'delete',
    path: '/v1/store/cart/code',
    summary: 'Remove the code',
    request: { headers: Host },
    responses: cartJson,
  }),
  setArea: r({
    method: 'put',
    path: '/v1/store/cart/area',
    summary: 'Choose the delivery area, so totals follow it',
    request: { headers: Host, ...body(z.object({ areaId: z.number().int().nullable() })) },
    responses: cartJson,
  }),
  checkoutState: r({
    method: 'get',
    path: '/v1/store/checkout',
    summary: 'What checkout needs: the cart, COD, holiday mode, fields and the Turnstile site key',
    request: { headers: Host },
    responses: {
      200: { content: { 'application/json': { schema: CheckoutState } }, description: 'Checkout' },
    },
  }),
  placeOrder: r({
    method: 'post',
    path: '/v1/store/checkout/orders',
    summary: 'Place the order (Idempotency-Key required; a retry returns the same order)',
    request: {
      headers: Host.extend({ 'idempotency-key': z.string().min(8).max(255) }),
      query: LocaleQuery,
      ...body(checkoutInput),
    },
    responses: {
      201: { content: { 'application/json': { schema: PlacedOrder } }, description: 'Placed' },
    },
  }),
  paymentReturn: r({
    method: 'post',
    path: '/v1/store/payments/return',
    summary: 'The shopper back from SSLCommerz: settle from its validation, then show the order',
    request: {
      headers: Host,
      ...body(
        z.object({
          status: z.enum(['success', 'failed', 'cancelled']),
          tranId: z.uuid(),
          valId: z.string().max(100).optional(),
        }),
      ),
    },
    responses: {
      200: {
        content: {
          'application/json': { schema: z.object({ viewToken: z.string(), paid: z.boolean() }) },
        },
        description: 'The order to show',
      },
    },
  }),
  retryPayment: r({
    method: 'post',
    path: '/v1/store/payments/retry',
    summary: "A new SSLCommerz session for an order's pending online payment",
    request: { headers: Host, ...body(z.object({ token: z.string().max(200) })) },
    responses: {
      200: {
        content: { 'application/json': { schema: z.object({ url: z.string() }) } },
        description: 'The gateway page',
      },
    },
  }),
  viewOrder: r({
    method: 'post',
    path: '/v1/store/orders/view',
    summary: 'The order behind a view token (the confirmation page)',
    request: { headers: Host, ...body(z.object({ token: z.string().max(200) })) },
    responses: {
      200: { content: { 'application/json': { schema: ShopperOrder } }, description: 'Order' },
    },
  }),
  track: r({
    method: 'post',
    path: '/v1/store/orders/track',
    summary: 'Find an order by number and phone (rate-limited; 5 wrong phones lock the number)',
    request: { headers: Host, ...body(trackInput) },
    responses: {
      200: { content: { 'application/json': { schema: Tracked } }, description: 'Order' },
    },
  }),
  cancel: r({
    method: 'post',
    path: '/v1/store/orders/cancel',
    summary: 'Cancel your order while the store hasn’t confirmed it (the token from tracking)',
    request: {
      headers: Host,
      ...body(
        z.object({ token: z.string().max(200), reason: z.string().trim().max(300).optional() }),
      ),
    },
    responses: {
      200: { content: { 'application/json': { schema: ShopperOrder } }, description: 'Cancelled' },
    },
  }),
} as const;

/** The shopper's IP: the storefront forwards it over the service binding, which has no `cf`. */
export const shopperIp = (c: Context<AppEnv>) =>
  ((c.req.raw as { cf?: unknown }).cf === undefined && c.req.header('x-shopper-ip')) ||
  c.req.header('cf-connecting-ip') ||
  'unknown';

export function cookie(c: Context<AppEnv>, name: string): string | null {
  const header = c.req.header('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || null;
  }
  return null;
}

/** The cart cookie (HttpOnly, /api only) and the count cookie the header reads. */
/** The order a view, tracking or payment link token is for; only tracking also cancels. */
async function orderOfToken(tenantId: string, token: string, secret: string) {
  return (
    (await verifyOrderToken('view', tenantId, token, secret)) ??
    (await verifyOrderToken('track', tenantId, token, secret)) ??
    (await verifyOrderToken('pay', tenantId, token, secret))
  );
}

export function cartCookies(token: string | null, count: number): string[] {
  const base = 'Secure; SameSite=Lax';
  return [
    ...(token
      ? [`${CART_COOKIE}=${token}; Path=/api; HttpOnly; ${base}; Max-Age=${CART_MAX_AGE}`]
      : []),
    `${CART_COUNT_COOKIE}=${count}; Path=/; ${base}; Max-Age=${CART_MAX_AGE}`,
  ];
}

/** Both cart cookies, expired. */
export const clearedCartCookies = (): string[] => [
  `${CART_COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  `${CART_COUNT_COOKIE}=0; Path=/; Secure; SameSite=Lax; Max-Age=0`,
];

export function setCartCookies(c: Context<AppEnv>, token: string | null, count: number) {
  for (const value of cartCookies(token, count)) c.header('Set-Cookie', value, { append: true });
}

export function clearCartCookies(c: Context<AppEnv>) {
  for (const value of clearedCartCookies()) c.header('Set-Cookie', value, { append: true });
}

/** A browser's write must come from the store's own origin (no Origin: SameSite=Lax still applies). */
function checkOrigin(c: Context<AppEnv>, host: string) {
  if (c.req.method === 'GET') return;
  const origin = c.req.header('origin');
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError('forbidden');
  }
  if (originHost.toLowerCase() !== host.toLowerCase())
    throw new AppError('forbidden', { detail: 'Wrong origin' });
}

type Run = <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>;

/**
 * Resolves the store from the forwarded host and hands `fn` a way to run
 * transactions in it (events relayed after each commit), so work that
 * mustn't hold a transaction open (Turnstile, rate limits) can go between.
 */
export async function withShopStore<T>(
  c: Context<AppEnv>,
  fn: (run: Run, tenantId: string) => Promise<T>,
): Promise<T> {
  const host = c.req.header('x-forwarded-host') ?? '';
  checkOrigin(c, host);
  return withClient(c.env, c.executionCtx, async (client) => {
    const record = await resolveHost(createDb(client), host, c.var.config.STORE_DOMAIN);
    if (!record) throw new AppError('store_not_found');
    if (record.status === 'closed') throw new AppError('tenant_closed');
    if (record.status !== 'active') throw new AppError('tenant_suspended');
    c.set('tenantId', record.tenantId);
    const run: Run = (inner) =>
      withTenant(client, record.tenantId, inner, {
        requestId: c.var.requestId,
        afterCommit: async (events) => {
          await relayEvents(client, events, queueSink(c.env.OUTBOX));
        },
      });
    return fn(run, record.tenantId);
  });
}

/** One transaction in the host's store. */
export const inShopStore = <T>(
  c: Context<AppEnv>,
  fn: (tx: TenantTx, tenantId: string) => Promise<T>,
) => withShopStore(c, (run, tenantId) => run((tx) => fn(tx, tenantId)));

const EMPTY_TOTALS: ShopperCart['totals'] = {
  subtotal: 0,
  discountTotal: 0,
  deliveryFee: 0,
  deliveryDiscount: 0,
  vatTotal: 0,
  vatIncluded: true,
  rounding: 0,
  total: 0,
};

/** What a shopper sees of a cart: no allocations, costs or internal reasons. */
export function toShopperCart(view: CartView | null, fallbackMax = 10): ShopperCart {
  if (!view) {
    return {
      itemCount: 0,
      areaId: null,
      ready: false,
      maxQuantityPerLine: fallbackMax,
      lines: [],
      zone: null,
      deliveryFrom: null,
      totals: EMPTY_TOTALS,
      promotions: [],
      code: null,
      freeDelivery: null,
    };
  }
  const q = view.quote;
  return {
    itemCount: view.itemCount,
    areaId: view.areaId,
    ready: view.ready,
    maxQuantityPerLine: view.maxQuantityPerLine,
    lines: q.lines.map((l) => ({
      variantId: l.variantId,
      productId: l.productId,
      title: l.title,
      slugs: l.slugs,
      optionLabels: l.optionLabels,
      sku: l.sku,
      image: l.image,
      unitPrice: l.unitPrice,
      compareAtPrice: l.compareAtPrice,
      quantity: l.quantity,
      total: l.total,
      maxQuantity: l.maxQuantity,
      problem: l.problem,
    })),
    zone: q.zone ? { name: q.zone.name, estimate: q.zone.estimate } : null,
    deliveryFrom: q.deliveryFrom,
    totals: {
      subtotal: q.totals.subtotal,
      discountTotal: q.totals.discountTotal,
      deliveryFee: q.totals.deliveryFee,
      deliveryDiscount: q.totals.deliveryDiscount,
      vatTotal: q.totals.vatTotal,
      vatIncluded: q.totals.vatIncluded,
      rounding: q.totals.rounding,
      total: q.totals.total,
    },
    promotions: q.promotions.map((p) => ({
      title: p.title,
      amount: p.amount,
      target: p.target,
      ...(p.code ? { code: p.code } : {}),
    })),
    code: q.code,
    freeDelivery: q.freeDelivery,
  };
}

export const limiterFor = (c: Context<AppEnv>) =>
  createLimiter(c.env.RATE_LIMITER, (e) =>
    captureException(e, { tags: { request_id: c.var.requestId } }),
  );

/** A cart change: the new view, with the count cookie (and the cart cookie when created). */
function cartResponse(c: Context<AppEnv>, view: CartView, token: string | null = null) {
  setCartCookies(c, token, view.itemCount);
  c.header('Cache-Control', 'no-store');
  return c.json(toShopperCart(view), 200);
}

export function registerCommerce(app: OpenAPIHono<AppEnv>): void {
  const R = COMMERCE_ROUTES;

  app.openapi(R.cart, (async (c: Context<AppEnv>) => {
    const view = await inShopStore(c, (tx) => getCart(tx, cookie(c, CART_COOKIE)));
    c.header('Cache-Control', 'no-store');
    if (!view && cookie(c, CART_COOKIE)) clearCartCookies(c);
    return c.json(toShopperCart(view), 200);
  }) as never);

  app.openapi(R.addLine, (async (c: Context<AppEnv>) => {
    await limiterFor(c).check('cart:ip', shopperIp(c));
    const locale = c.req.query('locale') === 'en' ? 'en' : 'bn';
    const input = await c.req.json();
    const change = await inShopStore(c, (tx) =>
      addToCart(tx, cookie(c, CART_COOKIE), input, locale),
    );
    return cartResponse(c, change.cart, change.token);
  }) as never);

  app.openapi(R.setLine, (async (c: Context<AppEnv>) => {
    const input = await c.req.json();
    const view = await inShopStore(c, (tx) =>
      setCartQuantity(tx, cookie(c, CART_COOKIE), c.req.param('variantId') ?? '', input),
    );
    return cartResponse(c, view);
  }) as never);

  app.openapi(R.removeLine, (async (c: Context<AppEnv>) => {
    const view = await inShopStore(c, (tx) =>
      removeFromCart(tx, cookie(c, CART_COOKIE), c.req.param('variantId') ?? ''),
    );
    return cartResponse(c, view);
  }) as never);

  app.openapi(R.setCode, (async (c: Context<AppEnv>) => {
    await limiterFor(c).check('cart:ip', shopperIp(c));
    const input = await c.req.json();
    const view = await inShopStore(c, (tx) => setCartCode(tx, cookie(c, CART_COOKIE), input));
    return cartResponse(c, view);
  }) as never);

  app.openapi(R.clearCode, (async (c: Context<AppEnv>) => {
    const view = await inShopStore(c, (tx) => clearCartCode(tx, cookie(c, CART_COOKIE)));
    return cartResponse(c, view);
  }) as never);

  app.openapi(R.setArea, (async (c: Context<AppEnv>) => {
    const input = await c.req.json();
    const view = await inShopStore(c, (tx) => setCartArea(tx, cookie(c, CART_COOKIE), input));
    return cartResponse(c, view);
  }) as never);

  app.openapi(R.checkoutState, (async (c: Context<AppEnv>) => {
    const state = await inShopStore(c, async (tx, tenantId) => {
      const settings = await orderSettings(tx);
      const view = await getCart(tx, cookie(c, CART_COOKIE));
      const userId = await currentShopper(c, tx, tenantId, settings);
      const profile = userId ? await shopperProfile(tx, userId) : null;
      return {
        cart: toShopperCart(view, settings.checkout.maxQuantityPerLine),
        cod: { enabled: settings.cod.enabled, maxOrderValue: settings.cod.maxOrderValue },
        online: {
          enabled: (await gatewayFor(tx, c.env)) !== null,
          advance: settings.cod.advance,
        },
        holiday: {
          active: holidayActive(settings.holiday),
          message: settings.holiday?.message ?? {},
        },
        email: settings.checkout.email,
        termsCheckbox: settings.checkout.termsCheckbox,
        accounts: settings.checkout.accounts,
        account:
          profile && userId
            ? {
                name: profile.name,
                email: profile.email,
                phone: profile.phone,
                addresses: await shopperAddresses(tx, userId),
              }
            : null,
        turnstileSiteKey: await shopSiteKey(c, tx),
        recovery: {
          save:
            settings.settings.recovery.incomplete &&
            view !== null &&
            (await draftAllowed(tx, view.id)),
        },
      };
    });
    c.header('Cache-Control', 'no-store');
    return c.json(state, 200);
  }) as never);

  app.openapi(R.placeOrder, (async (c: Context<AppEnv>) => {
    const key = c.req.header('idempotency-key') ?? '';
    const raw = (await c.req.json()) as Record<string, unknown>;
    const parsed = checkoutInput.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('validation_failed', {
        fields: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          code: i.code,
          message: i.message,
        })),
      });
    }
    const input = parsed.data;
    const host = c.req.header('x-forwarded-host') ?? '';
    const ip = shopperIp(c);
    // Turnstile tokens are single-use, so a retry carries a new one, and a
    // phone code comes after a first try: both stay out of what the
    // idempotency key protects.
    const { turnstileToken: _t, otpToken: _o, ...request } = raw;
    const locale = c.req.query('locale') === 'en' ? 'en' : 'bn';
    const result = await withShopStore(c, async (run, tenantId) => {
      // Rate limits and Turnstile first, with no transaction open (§3.15).
      const [settings, siteKey] = await run(
        async (tx) => [await orderSettings(tx), await shopSiteKey(c, tx)] as const,
      );
      const limits = settings.checkout.rateLimits;
      const limiter = limiterFor(c);
      await limiter.check('checkout:phone', `${tenantId}:${input.contact.phone}`, [
        { limit: limits.perPhoneHour, seconds: 3600 },
        { limit: limits.perPhoneDay, seconds: 86_400 },
      ]);
      await limiter.check('checkout:ip', `${tenantId}:${ip}`, [
        { limit: limits.perIpHour, seconds: 3600 },
      ]);
      // A custom domain the widget doesn't list relies on the limits alone.
      if (siteKey)
        await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, input.turnstileToken, { host, ip });
      // A signed-in shopper's order shows in their account (§3.11).
      const shopperUserId = await run((tx) => currentShopper(c, tx, tenantId, settings));
      const onlineReady = await run(async (tx) => (await gatewayFor(tx, c.env)) !== null);
      const smsReady = await run(async (tx) => (await smsGatewayFor(tx, c.env)) !== null);
      const phoneVerified = await otpVerified(c.env, tenantId, input.contact.phone, input.otpToken);
      const placed = await run((tx) =>
        checkout(tx, shopperActor(shopperUserId), key, request, {
          shopperUserId,
          channel: 'storefront',
          source: 'website',
          cartToken: cookie(c, CART_COOKIE),
          contact: input.contact,
          address: input.address,
          payment: { kind: input.paymentMethod },
          onlineReady,
          smsReady,
          otpVerified: phoneVerified,
          note: input.note,
          expectedTotal: input.expectedTotal,
          locale,
          ip: ip === 'unknown' ? null : ip,
          userAgent: c.req.header('user-agent') ?? null,
          attribution: input.attribution,
          acceptTerms: input.acceptTerms,
        }),
      );
      const order = placed.body as { id: string; onlinePayment?: { id: string } | null };
      if (shopperUserId && input.saveDetails && !placed.replayed) {
        await run((tx) =>
          saveCheckoutDetails(tx, shopperUserId, {
            name: input.contact.name,
            phone: input.contact.phone,
            address: input.address,
          }),
        );
      }
      // The gateway session comes after the order is saved (§3.3): if SSLCommerz
      // refuses or is slow, the order stays and the page offers a retry.
      let payUrl: string | null = null;
      if (order.onlinePayment) {
        try {
          payUrl = await startGatewaySession(
            c.env,
            c.executionCtx,
            tenantId,
            order.onlinePayment.id,
            c.req.header('host'),
          );
        } catch (e) {
          log('warn', 'gateway session failed', { tenant_id: tenantId, error: String(e) });
        }
      }
      const { onlinePayment: _p, ...rest } = order;
      return {
        replayed: placed.replayed,
        body: {
          ...rest,
          viewToken: await signOrderToken('view', tenantId, order.id, c.var.config.AUTH_SECRET),
          payUrl,
        },
      };
    });
    clearCartCookies(c);
    c.header('Cache-Control', 'no-store');
    if (result.replayed) c.header('Idempotent-Replayed', 'true');
    return c.json(result.body, 201);
  }) as never);

  // The return pages only show (§3.3): settling uses SSLCommerz's own
  // validation of the val_id, exactly as the IPN does.
  app.openapi(R.paymentReturn, (async (c: Context<AppEnv>) => {
    const input = (await c.req.json()) as { status: string; tranId: string; valId?: string };
    const tenantId = await inShopStore(c, async (_tx, id) => id);
    if (input.status === 'success' && input.valId) {
      try {
        await settleFromGateway(c.env, c.executionCtx, tenantId, input.valId, 'return');
      } catch (e) {
        // SSLCommerz unreachable: the IPN or the 30-minute check settles it.
        log('warn', 'return validation failed', { tenant_id: tenantId, error: String(e) });
      }
    }
    const found = await inShopStore(c, (tx) => orderOfGatewayPayment(tx, input.tranId));
    if (!found) throw new AppError('not_found');
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        viewToken: await signOrderToken('view', tenantId, found.orderId, c.var.config.AUTH_SECRET),
        paid: found.paid,
      },
      200,
    );
  }) as never);

  app.openapi(R.retryPayment, (async (c: Context<AppEnv>) => {
    const { token } = (await c.req.json()) as { token: string };
    await limiterFor(c).check('cart:ip', shopperIp(c));
    const { tenantId, paymentId } = await inShopStore(c, async (tx, tenantId) => {
      const orderId = await orderOfToken(tenantId, token, c.var.config.AUTH_SECRET);
      if (!orderId) throw new AppError('not_found');
      const paymentId = await pendingGatewayPayment(tx, orderId);
      if (!paymentId) throw new AppError('conflict', { detail: 'Nothing is waiting to be paid' });
      return { tenantId, paymentId };
    });
    const url = await startGatewaySession(
      c.env,
      c.executionCtx,
      tenantId,
      paymentId,
      c.req.header('host'),
    );
    c.header('Cache-Control', 'no-store');
    return c.json({ url }, 200);
  }) as never);

  app.openapi(R.viewOrder, (async (c: Context<AppEnv>) => {
    const { token } = (await c.req.json()) as { token: string };
    const view = await inShopStore(c, async (tx, tenantId) => {
      const id = await orderOfToken(tenantId, token, c.var.config.AUTH_SECRET);
      if (!id) throw new AppError('not_found');
      return shopperOrderView(tx, id);
    });
    if (!view) throw new AppError('not_found');
    c.header('Cache-Control', 'no-store');
    return c.json(view, 200);
  }) as never);

  app.openapi(R.track, (async (c: Context<AppEnv>) => {
    const input = trackInput.parse(await c.req.json());
    const limiter = limiterFor(c);
    await limiter.check('track:ip', shopperIp(c));
    const out = await inShopStore(c, async (tx, tenantId) => {
      const numberKey = `${tenantId}:${input.number.replace(/\D/g, '')}`;
      await limiter.check('track:number', numberKey);
      const id = await findOrderForTracking(tx, input);
      if (!id) {
        await limiter.fail('track:number', numberKey);
        throw new AppError('not_found', { detail: 'No order with this number and phone' });
      }
      await limiter.succeed('track:number', numberKey);
      return {
        order: await shopperOrderView(tx, id),
        token: await signOrderToken('track', tenantId, id, c.var.config.AUTH_SECRET),
      };
    });
    c.header('Cache-Control', 'no-store');
    return c.json(out, 200);
  }) as never);

  app.openapi(R.cancel, (async (c: Context<AppEnv>) => {
    const { token, reason } = (await c.req.json()) as { token: string; reason?: string };
    const view = await inShopStore(c, async (tx, tenantId) => {
      const id = await verifyOrderToken('track', tenantId, token, c.var.config.AUTH_SECRET);
      if (!id) throw new AppError('not_found');
      await cancelOrder(tx, shopperActor(), id, {
        reason: reason?.trim() || 'Cancelled by the shopper',
      });
      return shopperOrderView(tx, id);
    });
    c.header('Cache-Control', 'no-store');
    return c.json(view, 200);
  }) as never);
}
