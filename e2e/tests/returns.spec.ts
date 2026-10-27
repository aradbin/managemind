// The Phase 5A returns flow (phase-5a-plan §10), on the run's own store after
// the orders flows. A shopper's COD order is delivered with the cash. They
// track it, ask for a return of the damaged item with a photo, and see the
// request sent. Staff find it under Returns, see the photo, approve it, mark
// it received, inspect it back into stock and refund the item and the
// delivery charge by bKash with its transaction ID; the shopper gets the
// refund email, and the reports count the return and the refund, whose table
// exports as a CSV. Axe on every
// new screen, and the store's JavaScript budget on the tracking page with the
// return form open.
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { boReportsBn } from '../../apps/admin/src/i18n/back-office-reports-bn';
import { bn } from '../../apps/admin/src/i18n/bn';
import { ordersBn } from '../../apps/admin/src/i18n/orders-bn';
import { returnsBn } from '../../apps/admin/src/i18n/returns-bn';
import { type StoreMessageKey, bn as shopBn } from '../../apps/storefront/src/i18n';
import {
  expectAccessible,
  expectScriptBudget,
  mailCount,
  nextMail,
  pngImage,
  signIn,
} from './helpers';
import { DEV_TOKEN, people, RUN } from './people';
import { API, STOREFRONT } from './urls';

test.skip(!RUN || !DEV_TOKEN, 'needs a seeded preview: E2E_RUN and DEV_TOKEN');
test.describe.configure({ mode: 'serial', timeout: 300_000 });

const adminMessages = { ...bn, ...ordersBn, ...returnsBn, ...boReportsBn };
type AdminKey = keyof typeof adminMessages;

function m(key: AdminKey, params: Record<string, string> = {}): string {
  return adminMessages[key].replace(/\{(\w+)\}/g, (s, name: string) => params[name] ?? s);
}

function s(key: StoreMessageKey, params: Record<string, string> = {}): string {
  const message = shopBn[key];
  if (typeof message !== 'string') throw new Error(`${key} is a plural message`);
  return message.replace(/\{(\w+)\}/g, (x, name: string) => params[name] ?? x);
}

const pattern = (text: string) =>
  new RegExp(
    text
      .split(/\{\w+\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.+'),
  );

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

// Dhanmondi, Dhaka: the default "Inside Dhaka" zone (৳70).
const DHAKA = { division: 6, district: 47, area: 513 };

async function adminCall<T>(
  request: APIRequestContext,
  method: 'get' | 'post' | 'put',
  path: string,
  data?: unknown,
  { transition = false } = {},
): Promise<T> {
  const send = () =>
    request[method](`${API}${path}`, {
      ...(data === undefined ? {} : { data }),
      headers: { origin: API, 'idempotency-key': crypto.randomUUID() },
    });
  let res = await send();
  // A request stopped at the Free plan's CPU limit answers an empty 503 (ADR 0011,
  // amended Oct 25). A read is safe to send again, and so is a state transition:
  // the machine refuses a repeat, so a 409 then means the first one went through.
  for (let i = 0; (method === 'get' || transition) && res.status() === 503 && i < 2; i++) {
    res = await send();
    if (transition && res.status() === 409) return undefined as T;
  }
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

test('returns and refunds', async ({
  page,
  browser,
  playwright,
  viewport: size,
  hasTouch,
}, info) => {
  const viewport = info.project.name.replace(/^returns-/, '');
  const p = people(viewport);
  const store = (path: string) =>
    `${STOREFRONT}${path}${path.includes('?') ? '&' : '?'}store=${p.slug}`;
  const phone = `016${String(Date.now()).slice(-7)}${viewport === 'phone' ? '1' : '2'}`;
  const email = `e2e-${RUN}-${viewport}-returner@example.test`;
  const title = `শাল ${RUN}`;
  let orderNumber = '';
  let variantId = '';

  await test.step('a shopper’s COD order is delivered with the cash', async () => {
    await signIn(page, p.owner);
    const me = (await (await page.request.get(`${API}/v1/admin/me`)).json()) as {
      stores: { tenantId: string; slug: string }[];
    };
    const tenantId = me.stores.find((x) => x.slug === p.slug)?.tenantId;
    await adminCall(page.request, 'put', '/v1/admin/me/active-store', { tenantId });
    const product = await adminCall<{ variants: { id: string }[] }>(
      page.request,
      'post',
      '/v1/admin/products',
      {
        status: 'active',
        translations: { bn: { title, slug: `e2e-shawl-${viewport}` } },
        variant: { price: 50_000 },
      },
    );
    variantId = product.variants[0]?.id as string;
    await adminCall(page.request, 'post', '/v1/admin/inventory/adjustments', [
      { mode: 'delta', variantId, quantity: 5, reason: 'received' },
    ]);

    // Through the store's own /api, as the cart and checkout pages call it.
    const shopper = await playwright.request.newContext({ baseURL: STOREFRONT });
    const api = (path: string) => `/api${path}?store=${p.slug}`;
    expect(
      (await shopper.post(api('/cart/lines'), { data: { variantId, quantity: 1 } })).ok(),
    ).toBe(true);
    expect((await shopper.put(api('/cart/area'), { data: { areaId: DHAKA.area } })).ok()).toBe(
      true,
    );
    const cart = (await (await shopper.get(api('/cart'))).json()) as { totals: { total: number } };
    const placed = await shopper.post(api('/checkout/orders'), {
      data: {
        contact: { name: 'ই২ই ফেরত', phone, email },
        address: {
          divisionId: DHAKA.division,
          districtId: DHAKA.district,
          areaId: DHAKA.area,
          line: 'বাড়ি ৭',
        },
        paymentMethod: 'cod',
        expectedTotal: cart.totals.total,
        turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
      },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(placed.ok(), await placed.text()).toBe(true);
    const order = (await placed.json()) as { id: string; displayNumber: string };
    orderNumber = order.displayNumber;
    await shopper.dispose();

    await adminCall(
      page.request,
      'post',
      `/v1/admin/orders/${order.id}/confirm`,
      {},
      { transition: true },
    );
    const detail = await adminCall<{ lines: { id: string }[] }>(
      page.request,
      'get',
      `/v1/admin/orders/${order.id}`,
    );
    const shipment = await adminCall<{ id: string }>(
      page.request,
      'post',
      `/v1/admin/orders/${order.id}/shipments`,
      { lines: [{ orderLineId: detail.lines[0]?.id, quantity: 1 }], carrier: 'Pathao' },
    );
    await adminCall(
      page.request,
      'post',
      `/v1/admin/shipments/${shipment.id}/ship`,
      {},
      { transition: true },
    );
    await adminCall(
      page.request,
      'post',
      `/v1/admin/shipments/${shipment.id}/deliver`,
      { cashCollected: true },
      { transition: true },
    );
  });

  let returnNumber = '';
  await test.step('they track it and ask for a return with a photo', async () => {
    const shopper = await (await browser.newContext({ viewport: size, hasTouch })).newPage();
    await shopper.goto(store('/track'));
    await shopper.getByLabel(s('track.number')).fill(orderNumber);
    await shopper.getByLabel(s('track.phone')).fill(phone);
    await shopper.getByRole('button', { name: s('track.submit') }).click();
    await expect(shopper.locator('.order-head')).toContainText(orderNumber);
    await shopper.getByRole('button', { name: s('return.request') }).click();
    await expect(shopper.getByRole('heading', { name: s('return.title'), level: 2 })).toBeVisible();
    // One item, one unit: already chosen.
    await expect(shopper.getByLabel(new RegExp(title))).toHaveValue('1');
    await shopper.getByLabel(s('return.reason')).selectOption('damaged');
    await shopper.getByLabel(s('return.note')).fill('ভাঁজে ছেঁড়া');
    await shopper.getByLabel(s('return.photos')).setInputFiles({
      name: 'torn.png',
      mimeType: 'image/png',
      buffer: pngImage(2000, 1500, [120, 90, 60]),
    });
    await expectAccessible(shopper, 'return request');
    await expectScriptBudget(shopper, 'the tracking page with the return form');
    await shopper.getByRole('button', { name: s('return.send') }).click();
    const sent = shopper.getByText(pattern(s('return.sent')));
    await expect(sent).toBeVisible({ timeout: 20_000 });
    returnNumber = /(R\S+?)-/.exec((await sent.textContent()) ?? '')?.[1] ?? '';
    expect(returnNumber).not.toBe('');
    await shopper.context().close();
  });

  await test.step('staff approve it, receive it and inspect it back into stock', async () => {
    await page.goto(`${API}/returns`);
    await expect(page.getByRole('heading', { name: m('returns.title'), level: 1 })).toBeVisible();
    await expectAccessible(page, 'returns');
    await page.getByRole('link', { name: new RegExp(returnNumber) }).click();
    await expect(
      page.getByRole('heading', { name: m('return.title', { number: returnNumber }), level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('img', { name: /^ছবি/ })).toBeVisible();
    await expect(page.getByText('ভাঁজে ছেঁড়া')).toBeVisible();
    await expectAccessible(page, 'return detail');

    await page.getByRole('button', { name: m('return.approve') }).click();
    await expect(page.getByText(m('return.status.approved')).first()).toBeVisible();
    await page.getByRole('button', { name: m('return.receive') }).click();
    await expect(page.getByRole('button', { name: m('return.inspect') })).toBeVisible();
    await page.getByRole('button', { name: m('return.inspect') }).click();
    const inspect = page.getByRole('dialog', { name: m('return.inspect') });
    await expectAccessible(page, 'inspect');
    await inspect.getByRole('button', { name: m('return.inspectSave') }).click();
    await expect(page.getByText(m('return.status.inspected')).first()).toBeVisible();

    const res = await page.request.get(`${API}/v1/admin/inventory?q=${encodeURIComponent(title)}`);
    const { items } = (await res.json()) as {
      items: { variantId: string; onHand: number; reserved: number }[];
    };
    // Five received, one sold, one back on the shelf.
    expect(items.find((i) => i.variantId === variantId)).toMatchObject({ onHand: 5, reserved: 0 });
  });

  await test.step('they refund it by bKash and the shopper is told', async () => {
    const before = await mailCount(email);
    await page.getByRole('button', { name: m('return.refund'), exact: true }).click();
    const dialog = page.getByRole('dialog', { name: m('refund.title') });
    await expect(dialog.getByText(m('refund.delivery'))).toBeVisible();
    await dialog.getByRole('radio', { name: m('refund.method.bkash'), exact: true }).check();
    await dialog.getByLabel(m('refund.reference')).fill(`TRX${RUN}${viewport[0]}`.toUpperCase());
    await expectAccessible(page, 'refund');
    // The item and the delivery charge: the whole order came back damaged.
    await dialog.getByRole('button', { name: pattern(m('refund.confirm')) }).click();
    await expect(toast(page, m('refund.done'))).toBeVisible();
    await expect(page.getByText(m('return.status.resolved')).first()).toBeVisible();

    // The return's earlier emails can still be arriving: this is the one about the refund.
    const mail = await nextMail(email, before, (m) => m.text.includes(orderNumber));
    expect(mail.text).toContain(orderNumber);
  });

  await test.step('the reports count the return and the refund', async () => {
    await page.goto(`${API}/reports`);
    await expect(page.getByRole('heading', { name: m('reports.title'), level: 1 })).toBeVisible();
    const byReason = page.getByRole('row').filter({ hasText: m('return.reason.damaged') });
    await expect(byReason.first()).toBeVisible();
    const byMethod = page.getByRole('row').filter({ hasText: m('refund.method.bkash') });
    await expect(byMethod.first()).toBeVisible();
    await expectAccessible(page, 'reports');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page
        .getByRole('button', {
          name: m('reports.exportOf', {
            what: m('reports.refunds'),
            format: m('reports.export.csv'),
          }),
        })
        .click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^refunds-by-method-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const { readFile } = await import('node:fs/promises');
    const csv = await readFile((await download.path()) as string, 'utf8');
    // The method in Bangla, the count and the taka as plain numbers.
    expect(csv).toMatch(new RegExp(`^${m('refund.method.bkash')},\\d+,\\d+\\.\\d{2}\\r?$`, 'm'));
  });
});
