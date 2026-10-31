// WhatsApp order updates with the store's own number (phase-9-plan §3.2):
// connecting submits the templates; an update goes by WhatsApp first with
// its SMS waiting; Meta's receipt skips the SMS, a shopper not on WhatsApp
// gets the SMS at once, and ten minutes of silence lets it go; a plain
// message inside the shopper's window; STOP; Confirm and Cancel buttons;
// and a forged webhook changes nothing.
import { createHmac } from 'node:crypto';
import {
  addToCart,
  createProduct,
  createTenant,
  importKeyring,
  type OutboxEvent,
  placeOrder,
  receive,
  saveCredentials,
  setCartArea,
  shopperActor,
  systemActor,
  withTenant,
} from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { notify } from '../src/notifications';
import { fakeWhatsappLog, handleFallbacks, type NotifyFallbackMessage } from '../src/whatsapp';
import { browser, signIn } from './staff';
import { appUrl, makeCtx, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

const CREDENTIALS_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(13)));
class Delayed {
  sent: { body: NotifyFallbackMessage; delaySeconds: number }[] = [];
  async send(body: NotifyFallbackMessage, options: { delaySeconds?: number } = {}) {
    this.sent.push({ body, delaySeconds: options.delaySeconds ?? 0 });
  }
}
const delayed = new Delayed();
const env = makeEnv({ CREDENTIALS_KEY, DOMAINS: delayed as never });
const APP_SECRET = 'a1'.repeat(16);
const PHONE_NUMBER_ID = '1098765432';

let app: pg.Client;
let owner: pg.Client;
let store: { id: string; email: string; variant: string };
const sms: URLSearchParams[] = [];
const realFetch = globalThis.fetch;

const staff = (tenantId: string) => ({
  kind: 'user' as const,
  userId: '0199d000-0000-7000-8000-0000000000ce',
  platformRole: null,
  permissions: permissionsOf('owner'),
  tenantId,
  storeRole: 'owner' as const,
});

beforeAll(async () => {
  [app, owner] = await Promise.all([connect(appUrl), connect(ownerUrl)]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).startsWith('https://api.sms.net.bd/')) return realFetch(input, init);
    sms.push(new URLSearchParams(String(init?.body)));
    return new Response(JSON.stringify({ error: 0, msg: 'ok', data: { request_id: 7 } }));
  }) as typeof fetch;
  const slug = `wa${Date.now().toString(36)}`;
  const email = `${slug}@example.test`;
  const { id } = await createTenant(app, systemActor, {
    slug,
    name: 'WA Store',
    defaultLocale: 'en',
    owner: { email, name: 'Owner' },
  });
  const variant = await withTenant(app, id, async (tx) => {
    const p = await createProduct(tx, staff(id), {
      status: 'active',
      translations: { en: { title: 'Panjabi' } },
      variant: { price: 60_000 },
    });
    const v = p.variants[0]?.id as string;
    await receive(tx, staff(id), { variantId: v, quantity: 50, reason: 'received' });
    await saveCredentials(
      tx,
      staff(id),
      await importKeyring(CREDENTIALS_KEY),
      'sms',
      { provider: 'sms_net_bd', secrets: { apiKey: 'k' }, config: { senderId: 'SHOP' } },
      async () => {},
    );
    return v;
  });
  store = { id, email, variant };
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await Promise.all([app.end(), owner.end()]);
});
beforeEach(() => {
  sms.length = 0;
  fakeWhatsappLog.length = 0;
  delayed.sent.length = 0;
});

async function placed(phone: string): Promise<{ id: string; number: number; event: OutboxEvent }> {
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(app, store.id, fn);
  const { token } = await run((tx) =>
    addToCart(tx, null, { variantId: store.variant, quantity: 1 }, 'en'),
  );
  const cart = await run((tx) => setCartArea(tx, token ?? null, { areaId: 513 }));
  const order = await run((tx) =>
    placeOrder(tx, shopperActor(), {
      channel: 'storefront',
      source: 'website',
      cartToken: token ?? null,
      contact: { name: 'Rina', phone },
      address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1' },
      payment: { kind: 'cod' },
      expectedTotal: cart.quote.totals.total,
      locale: 'en',
    }),
  );
  const { rows } = await owner.query(
    `select id, event_type, aggregate_type, aggregate_id, payload from store.outbox
      where event_type = 'order.placed' and aggregate_id = $1`,
    [order.id],
  );
  const r = rows[0];
  return {
    id: order.id,
    number: Number((order as Json).number),
    event: {
      id: r.id,
      tenantId: store.id,
      eventType: r.event_type,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      payload: r.payload,
      requestId: null,
      createdAt: new Date().toISOString(),
    },
  };
}

const log = async (orderId: string) =>
  (
    await owner.query<{
      channel: string;
      status: string;
      reason: string | null;
      provider: string | null;
    }>(
      `select channel, status, reason, provider from store.messages
        where order_id = $1 and channel in ('sms', 'whatsapp') order by channel, event`,
      [orderId],
    )
  ).rows;

async function webhook(body: unknown, secret = APP_SECRET) {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const ctx = makeCtx();
  const res = await createApp().request(
    `/v1/webhooks/whatsapp/${store.id}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
      body: raw,
    },
    env,
    ctx,
  );
  await ctx.settle();
  return res;
}
const change = (value: Record<string, unknown>) => ({
  entry: [
    {
      changes: [
        { field: 'messages', value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, ...value } },
      ],
    },
  ],
});
const sentIds = async (orderId: string) =>
  (
    await owner.query<{ id: string }>(
      `select provider_message_id as id from store.messages where order_id = $1 and channel = 'whatsapp'`,
      [orderId],
    )
  ).rows.map((r) => r.id);

describe('WhatsApp order updates', () => {
  it('connects with a checked number and submits the templates', async () => {
    const b = browser(env);
    expect((await signIn(b, owner, store.email)).status).toBe(200);
    await b.call('PUT', '/api/admin/me/active-store', { tenantId: store.id });
    const res = await b.call('PUT', '/api/admin/channels/whatsapp', {
      phoneNumberId: PHONE_NUMBER_ID,
      wabaId: '2098765432',
      accessToken: 'fake',
      appSecret: APP_SECRET,
    });
    const wa = (await res.json()) as Json;
    expect(res.status, JSON.stringify(wa)).toBe(200);
    expect(wa).toMatchObject({
      connected: true,
      verifiedName: 'Fake shop',
      qualityRating: 'GREEN',
    });
    expect(wa.templates).toHaveLength(16);
    expect(wa.templates.every((t: Json) => t.status === 'approved')).toBe(true);
    expect(wa.webhook.url).toContain(`/v1/webhooks/whatsapp/${store.id}`);
    // Meta's handshake answers with the challenge only for the right token.
    const ctx = makeCtx();
    const ok = await createApp().request(
      `/v1/webhooks/whatsapp/${store.id}?hub.mode=subscribe&hub.verify_token=${wa.webhook.verifyToken}&hub.challenge=42`,
      {},
      env,
      ctx,
    );
    expect(await ok.text()).toBe('42');
    const bad = await createApp().request(
      `/v1/webhooks/whatsapp/${store.id}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`,
      {},
      env,
      makeCtx(),
    );
    expect(bad.status).toBe(403);
  });

  it('sends WhatsApp first, holds the SMS, and skips it once Meta says delivered', async () => {
    const order = await placed('+8801712000301');
    await notify(env, makeCtx(), order.event);
    expect(fakeWhatsappLog).toMatchObject([
      { kind: 'template', to: '+8801712000301', body: { name: 'mm_order_placed', language: 'en' } },
    ]);
    expect(await log(order.id)).toEqual([
      { channel: 'sms', status: 'waiting', reason: null, provider: null },
      { channel: 'whatsapp', status: 'sent', reason: null, provider: 'whatsapp' },
    ]);
    expect(delayed.sent).toMatchObject([{ body: { kind: 'notify_fallback' }, delaySeconds: 600 }]);
    const [id] = await sentIds(order.id);
    const res = await webhook(
      change({ statuses: [{ id, status: 'delivered', timestamp: '1730000000' }] }),
    );
    expect(res.status).toBe(200);
    expect((await log(order.id))[0]).toMatchObject({
      status: 'skipped',
      reason: 'sent_by_whatsapp',
    });
    expect(sms).toHaveLength(0);
  });

  it('refuses a forged webhook, which changes nothing', async () => {
    const order = await placed('+8801712000302');
    await notify(env, makeCtx(), order.event);
    const [id] = await sentIds(order.id);
    const res = await webhook(change({ statuses: [{ id, status: 'failed' }] }), 'b2'.repeat(16));
    expect(res.status).toBe(401);
    expect((await log(order.id))[0]).toMatchObject({ channel: 'sms', status: 'waiting' });
  });

  it('texts a shopper who isn’t on WhatsApp at once', async () => {
    const order = await placed('+8801710000000');
    await notify(env, makeCtx(), order.event);
    expect(await log(order.id)).toMatchObject([
      { channel: 'sms', status: 'sent' },
      { channel: 'whatsapp', status: 'failed' },
    ]);
    expect(sms).toHaveLength(1);
  });

  it('lets the SMS go when WhatsApp says nothing for ten minutes', async () => {
    const order = await placed('+8801712000303');
    await notify(env, makeCtx(), order.event);
    expect(sms).toHaveLength(0);
    const m = {
      body: delayed.sent[0]?.body as NotifyFallbackMessage,
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await handleFallbacks([m as never], env, makeCtx(), notify);
    expect(m.ack).toHaveBeenCalled();
    expect(sms).toHaveLength(1);
    expect((await log(order.id))[0]).toMatchObject({ channel: 'sms', status: 'sent' });
  });

  it('sends a plain message inside the shopper’s window, and nothing after STOP', async () => {
    const res = await webhook(
      change({
        messages: [
          {
            from: '8801712000304',
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: 'hi' },
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const first = await placed('+8801712000304');
    await notify(env, makeCtx(), first.event);
    expect((await log(first.id))[1]).toMatchObject({
      channel: 'whatsapp',
      provider: 'whatsapp_text',
    });
    expect(fakeWhatsappLog[0]).toMatchObject({ kind: 'text' });

    await webhook(
      change({ messages: [{ from: '8801712000304', type: 'text', text: { body: 'STOP' } }] }),
    );
    sms.length = 0;
    const second = await placed('+8801712000304');
    await notify(env, makeCtx(), second.event);
    expect(await log(second.id)).toMatchObject([
      { channel: 'sms', status: 'sent' },
      { channel: 'whatsapp', status: 'skipped', reason: 'opted_out' },
    ]);
  });

  it('confirms a COD order from its WhatsApp button, once', async () => {
    await owner.query(
      `update platform.tenants set settings = jsonb_set(settings, '{confirmation}',
         coalesce(settings -> 'confirmation', '{}'::jsonb) || '{"queue": true, "smsLink": true}') where id = $1`,
      [store.id],
    );
    const order = await placed('+8801712000305');
    await notify(env, makeCtx(), order.event);
    const request = fakeWhatsappLog.find((l) => (l.body as Json).name === 'mm_confirm_request')
      ?.body as Json;
    expect(request.payloads).toHaveLength(2);
    const [confirm] = request.payloads as string[];
    const tap = change({
      messages: [
        {
          from: '8801712000305',
          type: 'button',
          button: { payload: confirm, text: 'Confirm order' },
        },
      ],
    });
    expect((await webhook(tap)).status).toBe(200);
    const { rows } = await owner.query('select status from store.orders where id = $1', [order.id]);
    expect(rows[0].status).toBe('confirmed');
    expect(fakeWhatsappLog.at(-1)).toMatchObject({
      kind: 'text',
      body: expect.stringContaining('is confirmed'),
    });
    // A replayed tap changes nothing and says so.
    await webhook(tap);
    expect(fakeWhatsappLog.at(-1)).toMatchObject({
      kind: 'text',
      body: expect.stringContaining('no longer'),
    });
  });
});
