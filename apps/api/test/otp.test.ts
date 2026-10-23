// A code by SMS before cash on delivery (phase-5a-plan §3.14): checkout asks
// for it when the store's rule applies, the code goes through the store's
// own gateway, five wrong tries spend it, and the right one lets the order
// through.
import {
  type Actor,
  createProduct,
  createTenant,
  importKeyring,
  receive,
  saveCredentials,
  systemActor,
  type TenantTx,
  withTenant,
} from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { appUrl, fakeOtpNamespace, makeCtx, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

const CREDENTIALS_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const otp = fakeOtpNamespace();
const env = makeEnv({ CREDENTIALS_KEY, OTP_CODES: otp as never });

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  [app, owner] = await Promise.all([connect(appUrl), connect(ownerUrl)]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => Promise.all([app.end(), owner.end()]));

const texts: URLSearchParams[] = [];
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).startsWith('https://api.sms.net.bd/')) return realFetch(input, init);
    texts.push(new URLSearchParams(String(init?.body)));
    return new Response(JSON.stringify({ error: 0, msg: 'ok', data: { request_id: 1 } }));
  }) as typeof fetch;
});
afterEach(() => {
  texts.length = 0;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

async function store(otpRule: 'always' | 'off') {
  const slug = `otp${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const { id } = await createTenant(app, systemActor, {
    slug,
    name: 'Code Shop',
    defaultLocale: 'en',
    owner: { email: `${slug}@example.test`, name: 'Owner' },
  });
  const actor: Actor = {
    kind: 'user',
    userId: '0199d000-0000-7000-8000-0000000000b1',
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId: id,
    storeRole: 'owner',
  };
  const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, id, fn);
  const product = await run((tx) =>
    createProduct(tx, actor, {
      status: 'active',
      translations: { en: { title: 'Saree' } },
      variant: { price: 100_000 },
    }),
  );
  const variant = product.variants[0]?.id as string;
  await run((tx) => receive(tx, actor, { variantId: variant, quantity: 5, reason: 'received' }));
  const keyring = await importKeyring(CREDENTIALS_KEY);
  await run((tx) =>
    saveCredentials(
      tx,
      actor,
      keyring,
      'sms',
      { provider: 'sms_net_bd', secrets: { apiKey: 'k' } },
      async () => {},
    ),
  );
  await owner.query(
    `update platform.tenants set settings = jsonb_set(settings, '{cod}', $2::jsonb) where id = $1`,
    [id, JSON.stringify({ enabled: true, maxOrderValue: null, advance: 'never', otp: otpRule })],
  );
  return { id, host: `${slug}.${env.STORE_DOMAIN}`, variant };
}

function shopper(host: string) {
  const jar: string[] = [];
  return async (
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) => {
    const ctx = makeCtx();
    const res = await createApp().request(
      path,
      {
        method,
        headers: {
          'x-forwarded-host': host,
          'x-shopper-ip': '203.0.113.9',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(jar.length ? { cookie: jar.join('; ') } : {}),
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
      ctx,
    );
    await ctx.settle();
    for (const line of res.headers.getSetCookie()) jar.push((line.split(';')[0] ?? '') as string);
    return res;
  };
}

describe('a code by SMS before cash on delivery', () => {
  it('asks for it, texts it through the store’s gateway, and lets the order through', async () => {
    const s = await store('always');
    const shop = shopper(s.host);
    await shop('POST', '/v1/store/cart/lines', { variantId: s.variant, quantity: 1 });
    await shop('PUT', '/v1/store/cart/area', { areaId: 513 });
    const state: Json = await (await shop('GET', '/v1/store/checkout')).json();
    const order = (otpToken?: string) =>
      shop(
        'POST',
        '/v1/store/checkout/orders',
        {
          contact: { name: 'Rina', phone: '01712345678' },
          address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1' },
          paymentMethod: 'cod',
          expectedTotal: state.cart.totals.total,
          ...(otpToken ? { otpToken } : {}),
        },
        { 'idempotency-key': 'otp-order-1' },
      );

    const first = await order();
    expect(first.status).toBe(428);
    expect(((await first.json()) as Json).code).toBe('otp_required');

    expect((await shop('POST', '/v1/store/checkout/otp', { phone: '01712345678' })).status).toBe(
      204,
    );
    expect(texts).toHaveLength(1);
    const code = otp.codes.get(`${s.id}:+8801712345678`) as string;
    expect(texts[0]?.get('to')).toBe('8801712345678');
    expect(texts[0]?.get('msg')).toContain(code);

    const wrong = code === '000000' ? '111111' : '000000';
    const refused = await shop('POST', '/v1/store/checkout/otp/verify', {
      phone: '01712345678',
      code: wrong,
    });
    expect(refused.status).toBe(422);
    const verified: Json = await (
      await shop('POST', '/v1/store/checkout/otp/verify', { phone: '01712345678', code })
    ).json();
    expect(verified.otpToken).toMatch(/^[0-9a-f]{48}$/);

    const placed = await order(verified.otpToken);
    expect(placed.status, await placed.clone().text()).toBe(201);
  });

  it('isn’t asked for when the store’s rule is off, and can’t be sent without SMS', async () => {
    const s = await store('off');
    const shop = shopper(s.host);
    await shop('POST', '/v1/store/cart/lines', { variantId: s.variant, quantity: 1 });
    await shop('PUT', '/v1/store/cart/area', { areaId: 513 });
    const state: Json = await (await shop('GET', '/v1/store/checkout')).json();
    const res = await shop(
      'POST',
      '/v1/store/checkout/orders',
      {
        contact: { name: 'Rina', phone: '01712345679' },
        address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1' },
        paymentMethod: 'cod',
        expectedTotal: state.cart.totals.total,
      },
      { 'idempotency-key': 'otp-order-2' },
    );
    expect(res.status).toBe(201);
    await owner.query('delete from store.provider_credentials where tenant_id = $1', [s.id]);
    expect((await shop('POST', '/v1/store/checkout/otp', { phone: '01712345679' })).status).toBe(
      503,
    );
  });
});
