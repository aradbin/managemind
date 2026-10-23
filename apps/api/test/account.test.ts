// Shopper accounts on many hosts (phase-4-plan §3.11, ADR 0020): off by
// default; email codes; a session cookie under /api only, signed per store,
// so one store's cookie means nothing on another; the account's profile,
// addresses and the orders placed while signed in; the guest cart merged on
// sign-in and dropped on sign-out.
import {
  type Actor,
  createProduct,
  createTenant,
  importKeyring,
  receive,
  saveCredentials,
  systemActor,
  type TenantTx,
  updateStoreProfile,
  withTenant,
} from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import { defaultCheckoutSettings } from '@managemind/shared/orders';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { appUrl, fakeOtpNamespace, makeCtx, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

const CREDENTIALS_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(4)));
const otp = fakeOtpNamespace();
const env = makeEnv({ CREDENTIALS_KEY, OTP_CODES: otp as never });
let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  [app, owner] = await Promise.all([connect(appUrl), connect(ownerUrl)]);
});
afterAll(() => Promise.all([app.end(), owner.end()]));

let seq = 0;
async function store(accounts = true) {
  const slug = `a${Date.now().toString(36)}${seq++}`;
  const { id } = await createTenant(app, systemActor, {
    slug,
    name: `Shop ${slug}`,
    defaultLocale: 'en',
    owner: { email: `${slug}@example.test`, name: 'Owner' },
  });
  const actor: Actor = {
    kind: 'user',
    userId: '0199d000-0000-7000-8000-0000000000ab',
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId: id,
    storeRole: 'owner',
  };
  const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, id, fn);
  if (accounts) {
    await run((tx) =>
      updateStoreProfile(tx, actor, { checkout: { ...defaultCheckoutSettings(), accounts: true } }),
    );
  }
  const product = await run((tx) =>
    createProduct(tx, actor, {
      status: 'active',
      translations: { en: { title: 'Saree' } },
      variant: { price: 100_000 },
    }),
  );
  const variant = product.variants[0]?.id as string;
  await run((tx) => receive(tx, actor, { variantId: variant, quantity: 5, reason: 'received' }));
  const withSms = async () =>
    run(async (tx) =>
      saveCredentials(
        tx,
        actor,
        await importKeyring(CREDENTIALS_KEY),
        'sms',
        { provider: 'sms_net_bd', secrets: { apiKey: 'k' } },
        async () => {},
      ),
    );
  return { id, host: `${slug}.${env.STORE_DOMAIN}`, variant, withSms };
}

function shopper(host: string) {
  const jar = new Map<string, { value: string; line: string }>();
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const ctx = makeCtx();
    const cookie = [...jar].map(([k, v]) => `${k}=${v.value}`).join('; ');
    const res = await createApp().request(
      path,
      {
        method,
        headers: {
          'x-forwarded-host': host,
          'x-shopper-ip': '203.0.113.20',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
      ctx,
    );
    await ctx.settle();
    for (const line of res.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      if (/max-age=0/i.test(line)) jar.delete(name);
      else jar.set(name, { value: pair.slice(i + 1), line });
    }
    return { res, json: async () => (await res.json()) as Json };
  };
  return { jar, call };
}

/** The newest code the dev mailbox holds for `email`. */
async function codeFor(email: string): Promise<string> {
  const { rows } = await owner.query<{ text: string }>(
    `select text from platform.dev_emails where "to" = $1 order by created_at desc limit 1`,
    [email],
  );
  const code = /\b(\d{6})\b/.exec(rows[0]?.text ?? '')?.[1];
  if (!code) throw new Error(`no code for ${email}`);
  return code;
}

async function signIn(b: ReturnType<typeof shopper>, email: string) {
  const sent = await b.call('POST', '/v1/store/auth/email-otp/send-verification-otp', {
    email,
    type: 'sign-in',
  });
  expect(sent.res.status).toBe(200);
  const res = await b.call('POST', '/v1/store/auth/sign-in/email-otp', {
    email,
    otp: await codeFor(email),
  });
  expect(res.res.status).toBe(200);
  return res;
}

describe('shopper accounts', () => {
  it('are off until the store turns them on', async () => {
    const s = await store(false);
    const b = shopper(s.host);
    const res = await b.call('POST', '/v1/store/auth/email-otp/send-verification-otp', {
      email: 'x@example.test',
      type: 'sign-in',
    });
    expect(res.res.status).toBe(404);
    expect((await b.call('GET', '/v1/store/account')).res.status).toBe(404);
  });

  it('signs in by email code, with the session cookie under /api only', async () => {
    const s = await store();
    const b = shopper(s.host);
    const email = `shopper${Date.now()}@example.test`;
    await signIn(b, email);
    const session = [...b.jar].find(([name]) => name.includes('mm_session'));
    expect(session?.[0]).toBe('__Secure-mm_session');
    expect(session?.[1].line).toMatch(/Path=\/api/);
    expect(session?.[1].line).toMatch(/HttpOnly/);
    const me = await (await b.call('GET', '/v1/store/auth/get-session')).json();
    expect(me.user.email).toBe(email);
    const account = await (await b.call('GET', '/v1/store/account')).json();
    expect(account).toMatchObject({ profile: { email, phone: null }, addresses: [] });
    // The unsupported endpoints are not there at all.
    expect((await b.call('POST', '/v1/store/auth/update-user', { name: 'x' })).res.status).toBe(
      404,
    );
  });

  it('signs in by a code to the phone where the store has SMS, as its own account', async () => {
    const s = await store();
    const b = shopper(s.host);
    const phoneNumber = '+8801712345111';
    const signedOut = await b.call('GET', '/v1/store/account');
    expect((await signedOut.json()).phoneSignIn).toBe(false);
    // Without SMS there is no phone sign-in at all.
    expect(
      (await b.call('POST', '/v1/store/auth/phone-number/send-otp', { phoneNumber })).res.status,
    ).toBe(404);

    await s.withSms();
    expect((await (await b.call('GET', '/v1/store/account')).json()).phoneSignIn).toBe(true);
    const realFetch = globalThis.fetch;
    const texts: URLSearchParams[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).startsWith('https://api.sms.net.bd/')) return realFetch(input, init);
      texts.push(new URLSearchParams(String(init?.body)));
      return new Response(JSON.stringify({ error: 0, msg: 'ok', data: { request_id: 1 } }));
    }) as typeof fetch;
    try {
      const sent = await b.call('POST', '/v1/store/auth/phone-number/send-otp', { phoneNumber });
      expect(sent.res.status, await sent.res.clone().text()).toBe(200);
      const code = otp.codes.get(`${s.id}:${phoneNumber}`) as string;
      expect(texts[0]?.get('msg')).toContain(code);
      // Not a Bangladeshi mobile: refused before any code.
      expect(
        (await b.call('POST', '/v1/store/auth/phone-number/send-otp', { phoneNumber: '+15550000' }))
          .res.status,
      ).toBe(400);
      const wrong = await b.call('POST', '/v1/store/auth/phone-number/verify', {
        phoneNumber,
        code: code === '000000' ? '111111' : '000000',
      });
      expect(wrong.res.ok).toBe(false);
      const signedIn = await b.call('POST', '/v1/store/auth/phone-number/verify', {
        phoneNumber,
        code,
      });
      expect(signedIn.res.status, await signedIn.res.clone().text()).toBe(200);
    } finally {
      globalThis.fetch = realFetch;
    }
    const me = await (await b.call('GET', '/v1/store/auth/get-session')).json();
    expect(me.user).toMatchObject({ phoneNumber, phoneNumberVerified: true });
    expect(me.user.email).toBe('8801712345111@phone.invalid');
    expect((await b.call('GET', '/v1/store/account')).res.status).toBe(200);
  });

  it('keeps stores apart: the same email is two shoppers, and a cookie works on its own store only', async () => {
    const a = await store();
    const b = await store();
    const email = `both${Date.now()}@example.test`;
    const onA = shopper(a.host);
    await signIn(onA, email);
    const onB = shopper(b.host);
    await signIn(onB, email);
    const userA = (await (await onA.call('GET', '/v1/store/auth/get-session')).json()).user.id;
    const userB = (await (await onB.call('GET', '/v1/store/auth/get-session')).json()).user.id;
    expect(userA).not.toBe(userB);
    // A's cookies replayed on B's host: no session there.
    const replay = shopper(b.host);
    for (const [k, v] of onA.jar) replay.jar.set(k, v);
    expect(await (await replay.call('GET', '/v1/store/auth/get-session')).json()).toBeNull();
    expect((await replay.call('GET', '/v1/store/account')).res.status).toBe(401);
  });

  it('merges the guest cart on sign-in, links orders, saves details, and drops the cart on sign-out', async () => {
    const s = await store();
    const b = shopper(s.host);
    await b.call('POST', '/v1/store/cart/lines?locale=en', { variantId: s.variant, quantity: 1 });
    const email = `buyer${Date.now()}@example.test`;
    await signIn(b, email);
    expect((await (await b.call('GET', '/v1/store/cart')).json()).itemCount).toBe(1);

    const cart = await (await b.call('PUT', '/v1/store/cart/area', { areaId: 513 })).json();
    const placed = await b.call(
      'POST',
      '/v1/store/checkout/orders?locale=en',
      {
        contact: { name: 'Rahim', phone: '01712345670' },
        address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1' },
        paymentMethod: 'cod',
        expectedTotal: cart.totals.total,
        saveDetails: true,
      },
      { 'idempotency-key': `acct-${Date.now()}` },
    );
    expect(placed.res.status).toBe(201);
    const orders = await (await b.call('GET', '/v1/store/account/orders')).json();
    expect(orders).toHaveLength(1);
    const account = await (await b.call('GET', '/v1/store/account')).json();
    expect(account.profile).toMatchObject({ name: 'Rahim', phone: '+8801712345670' });
    expect(account.addresses).toHaveLength(1);

    const changed = await b.call('PATCH', '/v1/store/account', { name: 'Rahim Uddin' });
    expect((await changed.json()).name).toBe('Rahim Uddin');
    const added = await b.call('POST', '/v1/store/account/addresses', {
      name: 'Rahim',
      phone: '01712345670',
      divisionId: 6,
      districtId: 47,
      areaId: 365,
      line: 'Office 2',
      label: 'Office',
    });
    expect(added.res.status).toBe(201);
    const office = await added.json();
    expect(office).toMatchObject({ label: 'Office', isDefault: false });
    expect((await b.call('DELETE', `/v1/store/account/addresses/${office.id}`)).res.status).toBe(
      204,
    );

    await b.call('POST', '/v1/store/cart/lines?locale=en', { variantId: s.variant, quantity: 1 });
    const out = await b.call('POST', '/v1/store/auth/sign-out', {});
    expect(out.res.status).toBe(200);
    expect([...b.jar.keys()].some((k) => k.includes('mm_session') || k === 'mm_cart')).toBe(false);
    expect((await b.call('GET', '/v1/store/account')).res.status).toBe(401);
  });
});
