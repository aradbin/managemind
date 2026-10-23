// Our billing through the API (phase-5b-plan §3.7, §3.8): Platform → Billing
// for super admins, Settings → Plan and billing for the store, the invoice
// emails from the outbox, and the SSLCommerz link on our own account
// against a fake SSLCommerz.
import type { OutboxEvent } from '@managemind/core';
import { connect } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { handleQueue } from '../src/jobs';
import { browser, enrollAuthenticator, signIn } from './staff';
import { makeCtx, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

const gatewayEnv = makeEnv({
  PLATFORM_SSLCOMMERZ_STORE_ID: 'ours',
  PLATFORM_SSLCOMMERZ_PASSWORD: 'secret',
  PLATFORM_SSLCOMMERZ_MODE: 'sandbox',
});

let owner: pg.Client;
beforeAll(async () => {
  owner = await connect(ownerUrl);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => owner.end());

let seq = 0;
const unique = () => `bl${Date.now().toString(36)}${seq++}`;

async function signedIn(
  email: string,
  role: 'support' | 'super_admin' | null = null,
  env = makeEnv(),
) {
  if (role) {
    await owner.query(
      `insert into platform.users (name, email, email_verified, platform_role) values ('P', $1, true, $2)`,
      [email, role],
    );
  }
  const b = browser(env);
  expect((await signIn(b, owner, email)).status).toBe(200);
  if (role) await enrollAuthenticator(b);
  return b;
}

const ISSUER = {
  legalName: 'managemind Ltd',
  address: 'Gulshan, Dhaka',
  vatRateBp: null,
  bank: { name: 'City Bank', accountName: 'managemind Ltd', accountNumber: '0001' },
  bkash: '01700000000',
};

/** A store with an owner signed in to it, and a super admin. */
async function setup(env = makeEnv()) {
  const admin = await signedIn(`${unique()}@example.test`, 'super_admin');
  expect((await admin.call('PUT', '/api/platform/billing/issuer', ISSUER)).status).toBe(200);
  const slug = unique();
  const created = (await (
    await admin.post('/api/platform/tenants', {
      slug,
      name: 'Billing Shop',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).json()) as Json;
  const o = await signedIn(`${slug}@example.test`, null, env);
  expect(
    (await o.call('PUT', '/v1/admin/me/active-store', { tenantId: created.id })).status,
  ).toBeLessThan(300);
  return { admin, o, id: created.id as string, slug };
}

const charge = (amount: number) => ({
  lines: [
    {
      kind: 'adjustment',
      description: { bn: 'সেটআপ সহায়তা', en: 'Setup help' },
      quantity: 1,
      unitPrice: amount,
    },
  ],
});

describe('Platform → Billing', () => {
  it('drafts, issues, takes a payment and voids; support only reads', async () => {
    const { admin, id } = await setup();
    const support = await signedIn(`${unique()}@example.test`, 'support');
    expect(
      (await support.post(`/api/platform/tenants/${id}/invoices`, charge(1000_00))).status,
    ).toBe(403);
    expect((await support.get('/api/platform/billing/issuer')).status).toBe(200);
    expect((await support.call('PUT', '/api/platform/billing/issuer', ISSUER)).status).toBe(403);

    const drafted = await admin.post(`/api/platform/tenants/${id}/invoices`, charge(1000_00));
    expect(drafted.status).toBe(201);
    const draft = (await drafted.json()) as Json;
    expect(draft).toMatchObject({
      status: 'draft',
      number: null,
      total: 1000_00,
      storeName: 'Billing Shop',
    });
    expect(draft.issueAfter).not.toBeNull();
    const drafts = (await (
      await support.get(`/api/platform/invoices?status=draft&tenantId=${id}`)
    ).json()) as Json;
    expect(drafts.items.map((x: Json) => x.id)).toEqual([draft.id]);

    const issued = (await (
      await admin.post(`/api/platform/invoices/${draft.id}/issue`)
    ).json()) as Json;
    expect(issued).toMatchObject({ status: 'issued', amountDue: 1000_00 });
    expect(issued.number).toMatch(/^INV-\d{4}-\d{4,}$/);
    expect(issued.issuer).toMatchObject({ legalName: 'managemind Ltd' });
    expect(issued.billedTo).toMatchObject({ storeName: 'Billing Shop' });

    // A gateway payment is never recorded by hand; more than is due is refused.
    const pay = (body: object) => admin.post(`/api/platform/invoices/${draft.id}/payments`, body);
    const paidOn = issued.issuedOn;
    expect((await pay({ amount: 100_00, method: 'sslcommerz', paidOn })).status).toBe(422);
    expect((await pay({ amount: 2000_00, method: 'bank', paidOn })).status).toBe(422);
    const part = (await (
      await pay({ amount: 400_00, method: 'bkash', reference: 'TX1', paidOn })
    ).json()) as Json;
    expect(part).toMatchObject({ status: 'issued', amountPaid: 400_00, amountDue: 600_00 });
    // Money was taken: voiding is refused.
    expect(
      (await admin.post(`/api/platform/invoices/${draft.id}/void`, { reason: 'mistake' })).status,
    ).toBe(409);
    const paid = (await (await pay({ amount: 600_00, method: 'bank', paidOn })).json()) as Json;
    expect(paid).toMatchObject({ status: 'paid', amountDue: 0 });
    expect(paid.payments.map((p: Json) => p.method)).toEqual(['bkash', 'bank']);

    const other = (await (
      await admin.post(`/api/platform/tenants/${id}/invoices`, charge(50_00))
    ).json()) as Json;
    const voided = (await (
      await admin.post(`/api/platform/invoices/${other.id}/void`, { reason: 'charged twice' })
    ).json()) as Json;
    expect(voided).toMatchObject({ status: 'void', voidReason: 'charged twice', number: null });

    const audit = await owner.query<{ action: string }>(
      `select action from platform.audit_log where tenant_id = $1 and action like 'invoice.%' order by created_at`,
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'invoice.drafted',
      'invoice.issued',
      'invoice.payment_recorded',
      'invoice.payment_recorded',
      'invoice.drafted',
      'invoice.voided',
    ]);
  });

  it('emails the owners when an invoice is issued, in their language', async () => {
    const { admin, id, slug } = await setup();
    const env = makeEnv();
    const issued = (await (
      await admin.post(`/api/platform/tenants/${id}/invoices`, {
        ...charge(250_00),
        issueNow: true,
      })
    ).json()) as Json;
    expect(issued.status).toBe('issued');
    const { rows } = await owner.query<OutboxEvent & { event_type: string; id: string }>(
      `select id, event_type, tenant_id, aggregate_type, aggregate_id, payload from store.outbox
        where tenant_id = $1 and event_type = 'invoice.issued'`,
      [id],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0] as Json;
    const ctx = makeCtx();
    await handleQueue(
      {
        queue: 'managemind-outbox',
        messages: [
          {
            id: row.id,
            attempts: 1,
            body: {
              id: row.id,
              eventType: row.event_type,
              tenantId: row.tenant_id,
              aggregateType: row.aggregate_type,
              aggregateId: row.aggregate_id,
              payload: row.payload,
            },
            ack: () => {},
            retry: () => {},
          },
        ],
      } as unknown as MessageBatch<never>,
      env,
      ctx,
    );
    await ctx.settle();
    const mail = await owner.query<{ subject: string; text: string }>(
      `select subject, text from platform.dev_emails where "to" = $1 and subject like '%${issued.number}%'`,
      [`${slug}@example.test`],
    );
    expect(mail.rows).toHaveLength(1);
    expect(mail.rows[0]?.text).toContain('/settings/billing');
  });
});

/** SSLCommerz, as far as paying our invoice needs it. */
const validations = new Map<string, Record<string, unknown>>();
const sessions: URLSearchParams[] = [];
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
      sessions.push(new URLSearchParams(String(init?.body)));
      return json({
        status: 'SUCCESS',
        GatewayPageURL: 'https://sandbox.sslcommerz.com/gw/i',
        sessionkey: 'k',
      });
    }
    if (url.pathname === '/validator/api/validationserverAPI.php') {
      return json(
        validations.get(url.searchParams.get('val_id') ?? '') ?? { status: 'INVALID_TRANSACTION' },
      );
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

const ipn = (fields: Record<string, string>) =>
  createApp().request(
    '/v1/webhooks/sslcommerz/platform',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    },
    gatewayEnv,
    makeCtx(),
  );

describe('Settings → Plan and billing', () => {
  it("shows the store's plan, meters, its issued invoices only, and how to pay", async () => {
    const { admin, o, id } = await setup();
    await admin.post(`/api/platform/tenants/${id}/invoices`, charge(10_00));
    const issued = (await (
      await admin.post(`/api/platform/tenants/${id}/invoices`, {
        ...charge(300_00),
        issueNow: true,
      })
    ).json()) as Json;
    const res = await o.get('/v1/admin/billing');
    expect(res.status).toBe(200);
    const billing = (await res.json()) as Json;
    expect(billing.invoices.map((x: Json) => x.id)).toEqual([issued.id]);
    expect(billing.payTo).toMatchObject({ legalName: 'managemind Ltd', bkash: '01700000000' });
    expect(billing.payOnline).toBe(false);
    expect(billing.meters.map((m: Json) => m.name)).toContain('ordersPerMonth');

    const detail = (await (await o.get(`/v1/admin/billing/invoices/${issued.id}`)).json()) as Json;
    expect(detail).toMatchObject({ number: issued.number, total: 300_00 });
    expect(detail.lines[0].description.en).toBe('Setup help');
    // The link is off until our merchant account exists.
    expect((await o.post(`/v1/admin/billing/invoices/${issued.id}/pay`)).status).toBe(503);

    // Another store's invoice, or a draft, is not there.
    const elsewhere = await setup();
    expect((await elsewhere.o.get(`/v1/admin/billing/invoices/${issued.id}`)).status).toBe(404);
  });

  it('pays online: settles only on the validation, for exactly what is due, once', async () => {
    fakeSslcommerz();
    const { admin, o, id } = await setup(gatewayEnv);
    const issued = (await (
      await admin.post(`/api/platform/tenants/${id}/invoices`, {
        ...charge(450_00),
        issueNow: true,
      })
    ).json()) as Json;
    const started = await o.post(`/v1/admin/billing/invoices/${issued.id}/pay`);
    expect(started.status).toBe(200);
    expect(((await started.json()) as Json).url).toBe('https://sandbox.sslcommerz.com/gw/i');
    const session = sessions.at(-1);
    expect(session?.get('total_amount')).toBe('450.00');
    expect(session?.get('value_a')).toBe(issued.id);
    expect(session?.get('ipn_url')).toBe(
      'https://api.platform.example.test/v1/webhooks/sslcommerz/platform',
    );

    const valid = (valId: string, amount: string) =>
      validations.set(valId, {
        status: 'VALID',
        tran_id: session?.get('tran_id'),
        val_id: valId,
        amount,
        currency_type: 'BDT',
        currency_amount: amount,
        value_a: issued.id,
        bank_tran_id: `bank-${valId}`,
      });
    const statusOf = async () =>
      (
        await owner.query<{ status: string; amount_paid: number }>(
          'select status, amount_paid from platform.invoices where id = $1',
          [issued.id],
        )
      ).rows[0];

    // A forged IPN: SSLCommerz doesn't know it.
    await ipn({ val_id: 'forged', status: 'VALID' });
    // Less than is due.
    valid(`short-${id}`, '100.00');
    await ipn({ val_id: `short-${id}`, status: 'VALID' });
    expect(await statusOf()).toEqual({ status: 'issued', amount_paid: 0 });

    valid(`real-${id}`, '450.00');
    expect((await ipn({ val_id: `real-${id}`, status: 'VALID' })).status).toBe(200);
    await ipn({ val_id: `real-${id}`, status: 'VALID' });
    expect(await statusOf()).toEqual({ status: 'paid', amount_paid: 450_00 });
    const payments = await owner.query(
      `select method, gateway_val_id from platform.billing_payments where invoice_id = $1`,
      [issued.id],
    );
    expect(payments.rows).toEqual([{ method: 'sslcommerz', gateway_val_id: `real-${id}` }]);
    // Paid: no second session.
    expect((await o.post(`/v1/admin/billing/invoices/${issued.id}/pay`)).status).toBe(409);
  });
});
