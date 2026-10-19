// Online payments through the API (phase-5a-plan §3.3–§3.5) against a fake
// SSLCommerz: checkout starts a session, the IPN settles from SSLCommerz's
// own validation (acceptance criterion 1), a forged IPN changes nothing, the
// shopper's return shows the order, and the delayed checks settle or expire.
import {
  type Actor,
  confirmOrder,
  createProduct,
  createShipment,
  createTenant,
  deliverShipment,
  importKeyring,
  receive,
  saveCredentials,
  shipShipment,
  systemActor,
  type TenantTx,
  withTenant,
} from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { objectKey, permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { cleanUpReturnPhotos } from '../src/jobs';
import {
  handlePaymentChecks,
  handleRefundChecks,
  type PaymentCheckMessage,
  type RefundCheckMessage,
} from '../src/payments';
import { browser, signIn } from './staff';
import { appUrl, makeCtx, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

const CREDENTIALS_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
class DelayedQueue {
  sent: { body: PaymentCheckMessage | RefundCheckMessage; delaySeconds?: number }[] = [];
  async send(body: PaymentCheckMessage | RefundCheckMessage, options?: { delaySeconds?: number }) {
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
  refunds: [] as URLSearchParams[],
  refundAnswer: 'processing' as 'processing' | 'success' | 'failed' | 'timeout',
  refundState: 'processing' as 'processing' | 'refunded' | 'cancelled',
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
    if (
      url.pathname === '/validator/api/merchantTransIDvalidationAPI.php' &&
      url.searchParams.has('refund_amount')
    ) {
      gateway.refunds.push(url.searchParams);
      if (gateway.refundAnswer === 'timeout') return new Response('', { status: 504 });
      return gateway.refundAnswer === 'failed'
        ? json({ status: 'failed', errorReason: 'INVALID SOURCE' })
        : json({ status: gateway.refundAnswer, refund_ref_id: 'ref-1' });
    }
    if (
      url.pathname === '/validator/api/merchantTransIDvalidationAPI.php' &&
      url.searchParams.has('refund_ref_id')
    ) {
      return json({ status: gateway.refundState, refund_ref_id: 'ref-1' });
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
  return { id, host: `${slug}.${env.STORE_DOMAIN}`, variant, run, email: `${slug}@example.test` };
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

async function onlineCheckout(
  s: Awaited<ReturnType<typeof store>>,
  paymentMethod: 'online' | 'cod' = 'online',
) {
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
      paymentMethod,
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

describe('payment links', () => {
  it('lets staff send a link the shopper pays from, which can’t cancel the order', async () => {
    fakeSslcommerz();
    const s = await store();
    const { order } = await onlineCheckout(s, 'cod');
    const staff = browser(env);
    expect((await signIn(staff, owner, s.email)).status).toBe(200);
    expect((await staff.call('PUT', '/api/admin/me/active-store', { tenantId: s.id })).status).toBe(
      200,
    );
    const res = await staff.post(`/api/admin/orders/${order.id}/payment-link`);
    const link: Json = await res.json();
    expect(res.status, JSON.stringify(link)).toBe(200);
    expect(link.amount).toBe(order.total);
    expect(link.url).toMatch(new RegExp(`^https://${s.host.replace(/\./g, '\\.')}/track#`));
    const token = link.url.split('#')[1];

    const view: Json = await (
      await call(s.host, 'POST', '/v1/store/orders/view', { token })
    ).json();
    expect(view.onlineDue).toBe(order.total);
    const pay: Json = await (
      await call(s.host, 'POST', '/v1/store/payments/retry', { token })
    ).json();
    expect(pay.url).toBe('https://sandbox.sslcommerz.com/gw/x');
    expect(gateway.sessions.at(-1)?.get('total_amount')).toBe(`${order.total / 100}.00`);
    // The link shows and pays; only tracking by phone cancels.
    expect((await call(s.host, 'POST', '/v1/store/orders/cancel', { token })).status).toBe(404);
  });
});

/** Ships and delivers every line of an order, as staff would. */
async function deliver(s: Awaited<ReturnType<typeof store>>, orderId: string, cash: boolean) {
  const actor: Actor = {
    kind: 'user',
    userId: '0199d000-0000-7000-8000-0000000000b1',
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId: s.id,
    storeRole: 'owner',
  };
  await s.run((tx) => confirmOrder(tx, actor, orderId));
  const { rows } = await owner.query<{ id: string; quantity: number }>(
    'select id, quantity from store.order_lines where order_id = $1 order by position',
    [orderId],
  );
  const shipment = await s.run((tx) =>
    createShipment(tx, actor, orderId, {
      lines: rows.map((l) => ({ orderLineId: l.id, quantity: l.quantity })),
    }),
  );
  await s.run((tx) => shipShipment(tx, actor, shipment.id));
  await s.run((tx) => deliverShipment(tx, actor, shipment.id, { cashCollected: cash }));
  return rows;
}

async function staffOf(s: Awaited<ReturnType<typeof store>>) {
  const staff = browser(env);
  expect((await signIn(staff, owner, s.email)).status).toBe(200);
  expect((await staff.call('PUT', '/api/admin/me/active-store', { tenantId: s.id })).status).toBe(
    200,
  );
  return staff;
}

/** A 1×1 PNG. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  ),
  (ch) => ch.charCodeAt(0),
);

describe('returns and refunds through the API', () => {
  it('lets a tracked shopper ask with a photo, and staff take it to a refund', async () => {
    fakeSslcommerz();
    const s = await store();
    const { order } = await onlineCheckout(s, 'cod');
    const [line] = await deliver(s, order.id, true);
    const tracked: Json = await (
      await call(s.host, 'POST', '/v1/store/orders/track', {
        number: order.displayNumber,
        phone: '01712345678',
      })
    ).json();
    const token = tracked.token as string;
    const options: Json = await (
      await call(s.host, 'POST', '/v1/store/returns/options', { token })
    ).json();
    expect(options).toMatchObject({ open: true, lines: [{ returnable: 1, excluded: false }] });

    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', PNG))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const ctx = makeCtx();
    const upload = await createApp().request(
      `/v1/store/returns/photos/${hash}.png`,
      {
        method: 'PUT',
        headers: {
          'x-forwarded-host': s.host,
          'x-shopper-ip': '203.0.113.9',
          'x-order-token': token,
          'content-type': 'image/png',
        },
        body: PNG,
      },
      env,
      ctx,
    );
    expect(upload.status, await upload.clone().text()).toBe(201);
    // A photo for nobody's order is refused.
    const stranger = await createApp().request(
      `/v1/store/returns/photos/${hash}.png`,
      {
        method: 'PUT',
        headers: { 'x-forwarded-host': s.host, 'x-order-token': 'nope' },
        body: PNG,
      },
      env,
      makeCtx(),
    );
    expect(stranger.status).toBe(404);

    const asked = await call(s.host, 'POST', '/v1/store/returns', {
      token,
      reason: 'wrong_size',
      lines: [{ orderLineId: line?.id, quantity: 1 }],
      photos: [`${hash}.png`],
    });
    expect(asked.status, await asked.clone().text()).toBe(201);
    expect(await asked.json()).toEqual({ number: 'R1001', status: 'requested' });

    const staff = await staffOf(s);
    const list: Json = await (await staff.get('/api/admin/returns')).json();
    expect(list).toMatchObject([{ displayNumber: 'R1001', status: 'requested', units: 1 }]);
    const id = list[0].id as string;
    const detail: Json = await (await staff.get(`/api/admin/returns/${id}`)).json();
    expect(detail.photos).toHaveLength(1);
    const photo = await staff.get(`/api/admin/returns/${id}/photos/${detail.photos[0].id}`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('cache-control')).toBe('private, no-store');

    for (const step of ['approve', 'receive']) {
      expect((await staff.post(`/api/admin/returns/${id}/${step}`)).status).toBe(200);
    }
    const inspected = await staff.post(`/api/admin/returns/${id}/inspect`, {
      lines: [{ orderLineId: line?.id, sellable: 1, damaged: 0 }],
    });
    expect(inspected.status).toBe(200);
    const preview: Json = await (
      await staff.post(`/api/admin/orders/${order.id}/refunds/preview`, { returnId: id })
    ).json();
    const refund = await staff.post(
      `/api/admin/orders/${order.id}/refunds`,
      { returnId: id, method: 'bkash', reference: 'BK777' },
      { 'idempotency-key': `refund-${id}` },
    );
    expect(refund.status, await refund.clone().text()).toBe(201);
    expect(await refund.json()).toMatchObject({ status: 'succeeded', amount: preview.amount });
    const after: Json = await (await staff.get(`/api/admin/orders/${order.id}`)).json();
    expect(after).toMatchObject({
      returnStatus: 'returned',
      refunds: [{ method: 'bkash', status: 'succeeded', reference: 'BK777' }],
      returns: [{ number: 1001, status: 'resolved', resolution: 'refunded' }],
    });
    // Nothing left to return.
    const again: Json = await (
      await call(s.host, 'POST', '/v1/store/returns/options', { token })
    ).json();
    expect(again).toMatchObject({ open: false, lines: [{ returnable: 0 }] });

    // 90 days after the return closed, its photo goes, row and file.
    const key = objectKey('file', s.id, `returns/${hash}.png`);
    expect(env.FILES.objects.has(key)).toBe(true);
    await owner.query(
      `update store.returns set resolved_at = now() - interval '91 days' where id = $1`,
      [id],
    );
    expect(await cleanUpReturnPhotos(env, owner)).toEqual({ files: 1 });
    expect(env.FILES.objects.has(key)).toBe(false);
    const left = await owner.query('select 1 from store.return_photos where return_id = $1', [id]);
    expect(left.rowCount).toBe(0);
  }, 30_000);

  /** An online order paid through SSLCommerz, delivered, returned and inspected. */
  async function inspectedOnlineReturn() {
    fakeSslcommerz();
    const s = await store();
    const { order } = await onlineCheckout(s);
    const payment = await paymentOf(order.id);
    const amount = `${Number(payment?.amount) / 100}.00`;
    gateway.validations.set('paid-1', {
      status: 'VALID',
      tran_id: payment?.id,
      val_id: 'paid-1',
      amount,
      currency_type: 'BDT',
      currency_amount: amount,
      value_a: s.id,
      bank_tran_id: 'BANK-1',
    });
    await ipn(s.id, { val_id: 'paid-1', status: 'VALID', tran_id: payment?.id ?? '' });
    const [line] = await deliver(s, order.id, false);

    const staff = await staffOf(s);
    const created: Json = await (
      await staff.post('/api/admin/returns', {
        orderId: order.id,
        reason: 'damaged',
        lines: [{ orderLineId: line?.id, quantity: 1 }],
      })
    ).json();
    await staff.post(`/api/admin/returns/${created.id}/receive`);
    await staff.post(`/api/admin/returns/${created.id}/inspect`, {
      lines: [{ orderLineId: line?.id, sellable: 0, damaged: 1 }],
    });
    return { s, order, staff, returnId: created.id as string };
  }

  it('refunds an online payment through SSLCommerz, settled by the delayed check', async () => {
    const { s, order, staff, returnId } = await inspectedOnlineReturn();
    gateway.refundAnswer = 'processing';
    gateway.refundState = 'processing';
    const before = delayed.sent.length;
    const res = await staff.post(`/api/admin/orders/${order.id}/refunds`, {
      returnId,
      method: 'gateway',
    });
    const refund: Json = await res.json();
    expect(res.status, JSON.stringify(refund)).toBe(201);
    expect(refund.status).toBe('processing');
    const sent = gateway.refunds.at(-1) as URLSearchParams;
    expect(sent.get('bank_tran_id')).toBe('BANK-1');
    expect(sent.get('refund_trans_id')).toBe(refund.id);
    expect(sent.get('refund_amount')).toBe(`${refund.amount / 100}.00`);
    const check = delayed.sent.slice(before).at(-1);
    expect(check?.body).toEqual({
      kind: 'refund_check',
      tenantId: s.id,
      refundId: refund.id,
      attempt: 1,
    });

    // SSLCommerz has paid it back by the next check.
    gateway.refundState = 'refunded';
    const m = {
      body: check?.body as RefundCheckMessage,
      acked: false,
      ack() {
        m.acked = true;
      },
      retry() {},
    };
    await handleRefundChecks([m] as never, env, makeCtx());
    expect(m.acked).toBe(true);
    const after: Json = await (await staff.get(`/api/admin/orders/${order.id}`)).json();
    expect(after.refunds).toMatchObject([{ method: 'gateway', status: 'succeeded' }]);
    expect(after.paymentStatus).toBe('refunded');
  }, 30_000);

  it('keeps a refund SSLCommerz never answered, and learns its fate by sending it again', async () => {
    const { order, staff, returnId } = await inspectedOnlineReturn();
    gateway.refundAnswer = 'timeout';
    const before = delayed.sent.length;
    const res = await staff.post(`/api/admin/orders/${order.id}/refunds`, {
      returnId,
      method: 'gateway',
    });
    const refund: Json = await res.json();
    expect(res.status, JSON.stringify(refund)).toBe(201);
    expect(refund.status).toBe('processing');
    // It may have gone through, so it still counts: nothing more to refund.
    const preview: Json = await (
      await staff.post(`/api/admin/orders/${order.id}/refunds/preview`, { returnId })
    ).json();
    expect(preview.amount).toBe(0);

    // The check sends the same refund ID again, then asks how it went.
    gateway.refundAnswer = 'processing';
    gateway.refundState = 'refunded';
    const sentBefore = gateway.refunds.length;
    const m = {
      body: delayed.sent.slice(before).at(-1)?.body as RefundCheckMessage,
      acked: false,
      ack() {
        m.acked = true;
      },
      retry() {},
    };
    await handleRefundChecks([m] as never, env, makeCtx());
    expect(m.acked).toBe(true);
    expect(gateway.refunds.slice(sentBefore).map((q) => q.get('refund_trans_id'))).toEqual([
      refund.id,
    ]);
    const after: Json = await (await staff.get(`/api/admin/orders/${order.id}`)).json();
    expect(after.refunds).toMatchObject([{ method: 'gateway', status: 'succeeded' }]);
  }, 30_000);
});
