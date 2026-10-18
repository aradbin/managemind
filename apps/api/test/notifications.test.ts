// Sending what the pipeline plans (phase-5a-plan §3.6–§3.8): a placed order
// emails the shopper through the platform sender, a redelivered event sends
// nothing more, and the shared quota spares sign-in codes.
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getConfig } from '../src/env';
import { notify, quotaApplies } from '../src/notifications';
import { appUrl, makeCtx, makeEnv, ownerUrl } from './support';

let app: pg.Client;
let owner: pg.Client;
let store: string;
beforeAll(async () => {
  [app, owner] = await Promise.all([connect(appUrl), connect(ownerUrl)]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const slug = `ntf${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Send Store',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
});
afterAll(() => Promise.all([app.end(), owner.end()]));

const staff = () => ({
  kind: 'user' as const,
  userId: '0199d000-0000-7000-8000-0000000000cd',
  platformRole: null,
  permissions: permissionsOf('owner'),
  tenantId: store,
  storeRole: 'owner' as const,
});

async function placedOrder(email: string) {
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(app, store, fn);
  const p = await run((tx) =>
    createProduct(tx, staff(), {
      status: 'active',
      translations: { en: { title: `Thing ${Date.now()}` } },
      variant: { price: 60_000 },
    }),
  );
  const variantId = p.variants[0]?.id as string;
  await run((tx) => receive(tx, staff(), { variantId, quantity: 3, reason: 'received' }));
  const { token } = await run((tx) => addToCart(tx, null, { variantId, quantity: 1 }, 'en'));
  const cart = await run((tx) => setCartArea(tx, token ?? null, { areaId: 513 }));
  const order = await run((tx) =>
    placeOrder(tx, shopperActor(), {
      channel: 'storefront',
      source: 'website',
      cartToken: token ?? null,
      contact: { name: 'Rina', phone: '+8801712000222', email },
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
  const event: OutboxEvent = {
    id: r.id,
    tenantId: store,
    eventType: r.event_type,
    aggregateType: r.aggregate_type,
    aggregateId: r.aggregate_id,
    payload: r.payload,
    requestId: null,
    createdAt: new Date().toISOString(),
  };
  return { order, event };
}

const inbox = async (to: string) =>
  (
    await owner.query<{ subject: string; text: string }>(
      'select subject, text from platform.dev_emails where "to" = $1 order by created_at',
      [to],
    )
  ).rows;

describe('sending notifications', () => {
  it('emails the shopper once, however often the event arrives', async () => {
    const env = makeEnv({ STOREFRONT_ORIGIN: 'https://shop.example.test' });
    const to = `rina${Date.now()}@example.test`;
    const { order, event } = await placedOrder(to);
    const ctx = makeCtx();
    await notify(env, ctx, event);
    await notify(env, ctx, event);
    await ctx.settle();
    const mail = await inbox(to);
    expect(mail).toHaveLength(1);
    expect(mail[0]?.subject).toMatch(/^Order #\d+ received$/);
    expect(mail[0]?.text).toContain('https://shop.example.test/track?store=');
    const { rows } = await owner.query<{ channel: string; status: string; reason: string | null }>(
      'select channel, status, reason from store.messages where order_id = $1 order by channel',
      [order.id],
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { channel: 'email', status: 'sent', reason: null },
        // No gateway: skipped, not failed (acceptance criterion 3).
        { channel: 'sms', status: 'skipped', reason: 'no_gateway' },
      ]),
    );
  });

  it('texts the shopper through the store’s own gateway once it has one', async () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)));
    const env = makeEnv({ CREDENTIALS_KEY: key });
    await withTenant(app, store, async (tx) =>
      saveCredentials(
        tx,
        staff(),
        await importKeyring(key),
        'sms',
        { provider: 'sms_net_bd', secrets: { apiKey: 'k' }, config: { senderId: 'SHOP' } },
        async () => {},
      ),
    );
    const sent: URLSearchParams[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).startsWith('https://api.sms.net.bd/')) return realFetch(input, init);
      sent.push(new URLSearchParams(String(init?.body)));
      return new Response(JSON.stringify({ error: 0, msg: 'ok', data: { request_id: 7 } }));
    }) as typeof fetch;
    try {
      const { order, event } = await placedOrder(`sms${Date.now()}@example.test`);
      const ctx = makeCtx();
      await notify(env, ctx, event);
      await notify(env, ctx, event);
      await ctx.settle();
      expect(sent).toHaveLength(1);
      expect(sent[0]?.get('to')).toBe('8801712000222');
      expect(sent[0]?.get('msg')).toContain(`#${order.number}`);
      const { rows } = await owner.query<{ status: string; provider: string }>(
        `select status, provider from store.messages where order_id = $1 and channel = 'sms'`,
        [order.id],
      );
      expect(rows).toEqual([{ status: 'sent', provider: 'sms_net_bd' }]);
    } finally {
      globalThis.fetch = realFetch;
      await owner.query(`delete from store.provider_credentials where tenant_id = $1`, [store]);
    }
  });

  it('counts platform email against the shared quota, except shopper email through Brevo', () => {
    const resend = getConfig(makeEnv({ SHOPPER_EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' }));
    const brevo = getConfig(makeEnv({ SHOPPER_EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'k' }));
    const shopperUpdate = { recipientType: 'shopper', event: 'order_shipped' } as const;
    expect(quotaApplies(resend, shopperUpdate)).toEqual({ counted: true, guarded: true });
    expect(quotaApplies(brevo, shopperUpdate)).toEqual({ counted: false, guarded: false });
    // "Order placed" and staff alerts keep going past 70%.
    expect(quotaApplies(resend, { recipientType: 'shopper', event: 'order_placed' })).toEqual({
      counted: true,
      guarded: false,
    });
    expect(quotaApplies(brevo, { recipientType: 'staff', event: 'new_order' })).toEqual({
      counted: true,
      guarded: false,
    });
  });
});
