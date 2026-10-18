// Online payments through the API (phase-5a-plan §3.3–§3.5) against a fake
// SSLCommerz: checkout starts a session, the IPN settles from SSLCommerz's
// own validation (acceptance criterion 1), a forged IPN changes nothing, the
// shopper's return shows the order, and the delayed checks settle or expire.
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
import { handlePaymentChecks, type PaymentCheckMessage } from '../src/payments';
import { appUrl, makeCtx, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

const CREDENTIALS_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
class DelayedQueue {
  sent: { body: PaymentCheckMessage; delaySeconds?: number }[] = [];
  async send(body: PaymentCheckMessage, options?: { delaySeconds?: number }) {
    this.sent.push({
      body,
      ...(options?.delaySeconds ? { delaySeconds: options.delaySeconds } : {}),
    });
  }
}
const delayed = new DelayedQueue();
const env = makeEnv({ CREDENTIALS_KEY, DOMAINS: delayed as never });

let app: pg.Client;
/** Reads across stores, as the tests check what landed where. */
let owner: pg.Client;
beforeAll(async () => {
  [app, owner] = await Promise.all([connect(appUrl), connect(ownerUrl)]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => Promise.all([app.end(), owner.end()]));

/** SSLCommerz, as far as these tests need it. */
const gateway = {
  validations: new Map<string, Record<string, unknown>>(),
  transactions: new Map<string, Record<string, unknown>[]>(),
  sessions: [] as URLSearchParams[],
};
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
function fakeSslcommerz() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (!url.hostname.endsWith('sslcommerz.com')) return realFetch(input, init);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.pathname === '/gwprocess/v4/api.php') {
      gateway.sessions.push(new URLSearchParams(String(init?.body)));
      return json({
        status: 'SUCCESS',
        GatewayPageURL: 'https://sandbox.sslcommerz.com/gw/x',
        sessionkey: 'k',
      });
    }
    if (url.pathname === '/validator/api/validationserverAPI.php') {
      return json(
        gateway.validations.get(url.searchParams.get('val_id') ?? '') ?? {
          status: 'INVALID_TRANSACTION',
        },
      );
    }
    if (url.pathname === '/validator/api/merchantTransIDvalidationAPI.php') {
      const element = gateway.transactions.get(url.searchParams.get('tran_id') ?? '') ?? [];
      return json({ no_of_trans_found: element.length, element });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

async function store() {
  const slug = `pay${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const { id } = await createTenant(app, systemActor, {
    slug,
    name: 'Online Shop',
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
      'sslcommerz',
      {
        provider: 'sslcommerz',
        mode: 'sandbox',
        secrets: { storeId: 'test1', storePassword: 'pw' },
      },
      async () => {},
    ),
  );
  return { id, host: `${slug}.${env.STORE_DOMAIN}`, variant, run };
}

async function call(
  host: string | null,
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const ctx = makeCtx();
  const res = await createApp().request(
    path,
    {
      method,
      headers: {
        ...(host ? { 'x-forwarded-host': host, 'x-shopper-ip': '203.0.113.9' } : {}),
        ...(body === undefined || typeof body === 'string'
          ? {}
          : { 'content-type': 'application/json' }),
        ...extra,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    },
    env,
    ctx,
  );
  await ctx.settle();
  return res;
}

async function onlineCheckout(s: Awaited<ReturnType<typeof store>>) {
  const jar: string[] = [];
  const shop = async (
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) => {
    const res = await call(s.host, method, path, body, {
      ...(jar.length ? { cookie: jar.join('; ') } : {}),
      ...extra,
    });
    for (const line of res.headers.getSetCookie()) jar.push((line.split(';')[0] ?? '') as string);
    return res;
  };

  await shop('POST', '/v1/store/cart/lines', { variantId: s.variant, quantity: 1 });
  await shop('PUT', '/v1/store/cart/area', { areaId: 513 });
  const state: Json = await (await shop('GET', '/v1/store/checkout')).json();
  const res = await shop(
    'POST',
    '/v1/store/checkout/orders',
    {
      contact: { name: 'Rina', phone: '01712345678' },
      address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1' },
      paymentMethod: 'online',
      expectedTotal: state.cart.totals.total,
    },
    { 'idempotency-key': `k-${crypto.randomUUID()}` },
  );
  return { state, res, order: (await res.json()) as Json };
}

const paymentOf = async (orderId: string) =>
  (
    await owner.query<{ id: string; status: string; amount: string }>(
      `select id, status, amount from store.payments where order_id = $1 and provider = 'sslcommerz'`,
      [orderId],
    )
  ).rows[0];

const ipn = (tenantId: string, fields: Record<string, string>) =>
  call(
    null,
    'POST',
    `/v1/webhooks/sslcommerz/${tenantId}`,
    new URLSearchParams(fields).toString(),
    {
      'content-type': 'application/x-www-form-urlencoded',
    },
  );

describe('online payment through the API', () => {
  it('offers online payment, and starts a session for the order total', async () => {
    fakeSslcommerz();
    const s = await store();
    const { state, res, order } = await onlineCheckout(s);
    expect(state.online).toEqual({ enabled: true, advance: 'never' });
    expect(res.status, JSON.stringify(order)).toBe(201);
    expect(order.payUrl).toBe('https://sandbox.sslcommerz.com/gw/x');
    const payment = await paymentOf(order.id);
    const session = gateway.sessions.at(-1) as URLSearchParams;
    expect(session.get('tran_id')).toBe(payment?.id);
    expect(session.get('value_a')).toBe(s.id);
    expect(session.get('total_amount')).toBe(`${Number(payment?.amount) / 100}.00`);
    expect(session.get('ipn_url')).toBe(`https://${env.ADMIN_HOST}/v1/webhooks/sslcommerz/${s.id}`);
    // Its 30-minute check is scheduled.
    expect(delayed.sent.at(-1)).toEqual({
      body: { kind: 'payment_check', tenantId: s.id, paymentId: payment?.id, stage: 1 },
      delaySeconds: 1800,
    });
  });

  it('settles from the IPN only through SSLCommerz’s validation, once (criterion 1)', async () => {
    fakeSslcommerz();
    const s = await store();
    const { order } = await onlineCheckout(s);
    const payment = await paymentOf(order.id);
    const amount = `${Number(payment?.amount) / 100}.00`;

    // Forged: a val_id SSLCommerz never issued. The posted amount and status mean nothing.
    expect(
      (await ipn(s.id, { val_id: 'forged', status: 'VALID', tran_id: payment?.id ?? '', amount }))
        .status,
    ).toBe(200);
    expect((await paymentOf(order.id))?.status).toBe('pending');

    // Tampered: SSLCommerz says the shopper paid less.
    gateway.validations.set('tampered', {
      status: 'VALID',
      tran_id: payment?.id,
      val_id: 'tampered',
      amount: '10.00',
      currency_type: 'BDT',
      currency_amount: '10.00',
      value_a: s.id,
    });
    await ipn(s.id, { val_id: 'tampered', status: 'VALID', tran_id: payment?.id ?? '' });
    expect((await paymentOf(order.id))?.status).toBe('pending');

    // The real one, twice.
    gateway.validations.set('real', {
      status: 'VALID',
      tran_id: payment?.id,
      val_id: 'real',
      amount,
      currency_type: 'BDT',
      currency_amount: amount,
      value_a: s.id,
      bank_tran_id: 'bank-9',
      risk_level: '0',
    });
    await ipn(s.id, { val_id: 'real', status: 'VALID', tran_id: payment?.id ?? '' });
    await ipn(s.id, { val_id: 'real', status: 'VALID', tran_id: payment?.id ?? '' });
    expect((await paymentOf(order.id))?.status).toBe('paid');
    const settled = await owner.query(
      `select 1 from store.outbox where event_type = 'payment.settled' and aggregate_id = $1`,
      [payment?.id],
    );
    expect(settled.rowCount).toBe(1);

    // The shopper's return shows the paid order.
    const back: Json = await (
      await call(s.host, 'POST', '/v1/store/payments/return', {
        status: 'success',
        tranId: payment?.id,
        valId: 'real',
      })
    ).json();
    expect(back.paid).toBe(true);
    expect(back.viewToken).toMatch(/^[0-9a-f-]{36}\./);
  });

  it("refuses another store's IPN path for a payment", async () => {
    fakeSslcommerz();
    const [a, b] = [await store(), await store()];
    const { order } = await onlineCheckout(a);
    const payment = await paymentOf(order.id);
    const amount = `${Number(payment?.amount) / 100}.00`;
    gateway.validations.set('cross', {
      status: 'VALID',
      tran_id: payment?.id,
      val_id: 'cross',
      amount,
      currency_type: 'BDT',
      currency_amount: amount,
      value_a: a.id,
    });
    await ipn(b.id, { val_id: 'cross', status: 'VALID', tran_id: payment?.id ?? '' });
    expect((await paymentOf(order.id))?.status).toBe('pending');
  });

  it('settles at the 30-minute check when the IPN never came, or expires at 60', async () => {
    fakeSslcommerz();
    const s = await store();
    const paid = await onlineCheckout(s);
    const unpaid = await onlineCheckout(s);
    const p1 = await paymentOf(paid.order.id);
    const p2 = await paymentOf(unpaid.order.id);
    const amount = `${Number(p1?.amount) / 100}.00`;
    gateway.transactions.set(p1?.id ?? '', [
      {
        status: 'VALID',
        tran_id: p1?.id,
        val_id: 'late-ipn',
        amount,
        currency: 'BDT',
        value_a: s.id,
      },
    ]);
    const message = (paymentId: string, stage: 1 | 2) => {
      const m = {
        body: { kind: 'payment_check' as const, tenantId: s.id, paymentId, stage },
        acked: false,
        retried: false,
      };
      return Object.assign(m, {
        ack: () => {
          m.acked = true;
        },
        retry: () => {
          m.retried = true;
        },
      });
    };
    const first = [message(p1?.id ?? '', 1), message(p2?.id ?? '', 1)];
    const before = delayed.sent.length;
    await handlePaymentChecks(first as never, env, makeCtx());
    expect(first.every((m) => m.acked)).toBe(true);
    expect((await paymentOf(paid.order.id))?.status).toBe('paid');
    // The unpaid one waits for its second check.
    expect(delayed.sent.slice(before)).toEqual([
      {
        body: { kind: 'payment_check', tenantId: s.id, paymentId: p2?.id, stage: 2 },
        delaySeconds: 1800,
      },
    ]);
    await handlePaymentChecks([message(p2?.id ?? '', 2)] as never, env, makeCtx());
    expect((await paymentOf(unpaid.order.id))?.status).toBe('expired');
    const { rows } = await owner.query<{ status: string }>(
      'select status from store.orders where id = $1',
      [unpaid.order.id],
    );
    expect(rows[0]?.status).toBe('cancelled');
  });
});
