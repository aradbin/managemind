// The Phase 4 flows on the preview (phase-4-plan §10), on the run's own store:
// the owner adds a code promotion and checks it with the test cart; a shopper
// adds two products, sees the free-delivery progress, applies the code,
// chooses an area, places a COD order, sees the confirmation, then tracks it
// by number and phone and cancels it. Two shoppers race for a last unit
// through the store's /api and exactly one gets it, and a retried checkout
// with the same key gives the same order (acceptance criteria 1 and 2).
// Staff enter a manual order, confirm it,
// export it in Steadfast's format, print an invoice and a packing slip, ship
// it in two parcels, mark it delivered with the cash collected and see it
// completed, with the stock checked at each step and every step on the
// timeline (acceptance criterion 3). Last, the owner turns shopper accounts on and a shopper signs in
// with an emailed code. Axe on every new page and screen, and the store's
// JavaScript budget on the cart, checkout and account pages, at a phone and a
// desktop viewport. Previews run Turnstile with Cloudflare's always-pass keys.
import { readFile } from 'node:fs/promises';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { bn } from '../../apps/admin/src/i18n/bn';
import { catalogBn } from '../../apps/admin/src/i18n/catalog-bn';
import { ordersBn } from '../../apps/admin/src/i18n/orders-bn';
import { promotionsBn } from '../../apps/admin/src/i18n/promotions-bn';
import { type StoreMessageKey, bn as shopBn } from '../../apps/storefront/src/i18n';
import { expectAccessible, expectScriptBudget, mailCount, nextMail, signIn } from './helpers';
import { DEV_TOKEN, people, RUN } from './people';
import { API, STOREFRONT } from './urls';

test.skip(!RUN || !DEV_TOKEN, 'needs a seeded preview: E2E_RUN and DEV_TOKEN');
test.describe.configure({ mode: 'serial', timeout: 300_000 });

const adminMessages = { ...bn, ...catalogBn, ...ordersBn, ...promotionsBn };
type AdminKey = keyof typeof adminMessages;

/** An admin message in Bangla, with {placeholders} filled. */
function m(key: AdminKey, params: Record<string, string> = {}): string {
  return adminMessages[key].replace(/\{(\w+)\}/g, (s, name: string) => params[name] ?? s);
}

/** A store message in Bangla; `{placeholders}` left in match anything. */
function s(key: StoreMessageKey, params: Record<string, string> = {}): string {
  const message = shopBn[key];
  if (typeof message !== 'string') throw new Error(`${key} is a plural message`);
  return message.replace(/\{(\w+)\}/g, (x, name: string) => params[name] ?? x);
}

/** A message with its placeholders as wildcards, for text that holds amounts. */
const pattern = (text: string) =>
  new RegExp(
    text
      .split(/\{\w+\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.+'),
  );

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

// Dhanmondi, Dhaka: the default "Inside Dhaka" zone (৳70).
const DHAKA = { division: '6', district: '47', area: '513' };

/** The admin's API as the signed-in owner, for setting up what the flows need. */
async function adminCall<T>(
  request: APIRequestContext,
  method: 'post' | 'patch' | 'put',
  path: string,
  data: unknown,
): Promise<T> {
  const res = await request[method](`${API}${path}`, {
    data,
    headers: { origin: API, 'idempotency-key': crypto.randomUUID() },
  });
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

/** A variant's stock across locations, as the admin reports it. */
async function stockOf(request: APIRequestContext, title: string, variantId: string) {
  const res = await request.get(`${API}/v1/admin/inventory?q=${encodeURIComponent(title)}`);
  const { items } = (await res.json()) as {
    items: { variantId: string; onHand: number; reserved: number }[];
  };
  const row = items.find((i) => i.variantId === variantId);
  return { onHand: row?.onHand, reserved: row?.reserved };
}

async function choosePlace(page: Page, ids: { division: string; district: string; area: string }) {
  await page.getByLabel(m('place.division'), { exact: true }).selectOption(ids.division);
  await page.getByLabel(m('place.district'), { exact: true }).selectOption(ids.district);
  await page.getByLabel(m('place.area'), { exact: true }).selectOption(ids.area);
}

test('orders, promotions and accounts', async ({
  page,
  browser,
  playwright,
  viewport: size,
  hasTouch,
}, info) => {
  const viewport = info.project.name.replace(/^orders-/, '');
  const p = people(viewport);
  const store = (path: string) =>
    `${STOREFRONT}${path}${path.includes('?') ? '&' : '?'}store=${p.slug}`;
  // A number of its own per run and viewport, under the per-phone limits.
  const phone = `017${String(Date.now()).slice(-7)}${viewport === 'phone' ? '1' : '2'}`;
  const code = `E2E${RUN}${viewport[0]}`.toUpperCase();
  const products = [
    { slug: `e2e-tea-${viewport}`, title: `চা পাতা ${RUN}`, price: 45_000 },
    { slug: `e2e-honey-${viewport}`, title: `মধু ${RUN}`, price: 60_000 },
  ];
  const variants: string[] = [];
  // A shopper's own browser, at the project's viewport.
  const shopperPage = async () =>
    (await browser.newContext({ viewport: size, hasTouch })).newPage();

  await test.step('the owner stocks two products and offers free delivery over ৳1,500', async () => {
    await signIn(page, p.owner);
    // The run's store, chosen before the admin's own first screen does it.
    const me = (await (await page.request.get(`${API}/v1/admin/me`)).json()) as {
      stores: { tenantId: string; slug: string }[];
    };
    const tenantId = me.stores.find((x) => x.slug === p.slug)?.tenantId;
    await adminCall(page.request, 'put', '/v1/admin/me/active-store', { tenantId });
    for (const item of products) {
      const created = await adminCall<{ variants: { id: string }[] }>(
        page.request,
        'post',
        '/v1/admin/products',
        {
          status: 'active',
          translations: { bn: { title: item.title, slug: item.slug } },
          variant: { price: item.price },
        },
      );
      variants.push(created.variants[0]?.id as string);
    }
    await adminCall(
      page.request,
      'post',
      '/v1/admin/inventory/adjustments',
      variants.map((variantId) => ({ mode: 'delta', variantId, quantity: 20, reason: 'received' })),
    );
    await adminCall(page.request, 'post', '/v1/admin/promotions', {
      title: { bn: '৳১,৫০০-এর বেশিতে ফ্রি ডেলিভারি' },
      kind: 'automatic',
      status: 'active',
      conditions: { minSubtotal: 150_000 },
      action: { type: 'delivery_percent_off', percentBp: 10_000 },
    });
  });

  await test.step('they create a code promotion and check it with the test cart', async () => {
    await page.goto(`${API}/promotions`);
    await expect(page.getByRole('heading', { name: m('nav.promotions'), level: 1 })).toBeVisible();
    await expectAccessible(page, 'promotions');
    await page.getByRole('link', { name: m('promo.new') }).click();
    await page.getByLabel(m('promo.titleBn')).fill('ই২ই ৳৫০ ছাড়');
    await page.getByRole('radio', { name: new RegExp(m('promo.kind.code')) }).check();
    await page.getByLabel(m('promo.sharedCode')).fill(code);
    await page.getByLabel(m('promo.actionType')).selectOption('amount_off_order');
    await page.getByLabel(m('promo.amount'), { exact: true }).fill('50');
    await page.getByLabel(m('promo.status')).selectOption('active');
    // The test cart: one of each product, Dhanmondi, the code.
    const cart = page.getByRole('region', { name: m('promo.testCart') });
    for (const item of products) {
      await cart.getByLabel(m('order.addProduct')).fill(item.title);
      await cart
        .getByRole('list', { name: m('order.searchResults') })
        .getByRole('button', { name: new RegExp(item.title) })
        .click();
    }
    await choosePlace(page, DHAKA);
    await cart.getByLabel(m('newOrder.code')).fill(code);
    const results = cart.locator('[aria-live=polite] ul li');
    await expect(results.filter({ hasText: 'ই২ই ৳৫০ ছাড়' })).toContainText('−');
    await expectAccessible(page, 'promotion editor');
    await page.getByRole('button', { name: m('action.save') }).click();
    await expect(page.getByRole('heading', { name: 'ই২ই ৳৫০ ছাড়', level: 1 })).toBeVisible();
  });

  let number = '';
  await test.step('a shopper adds two products, applies the code and places a COD order', async () => {
    const shopper = await shopperPage();
    for (const item of products) {
      await shopper.goto(store(`/products/${item.slug}`));
      await shopper.getByRole('button', { name: s('cart.add') }).click();
      await expect(shopper.getByText(s('cart.added'))).toBeVisible();
    }
    await shopper.goto(store('/cart'));
    await expect(shopper.getByRole('heading', { name: s('cart.title'), level: 1 })).toBeVisible();
    await expect(shopper.getByText(products[0]?.title as string)).toBeVisible();
    await shopper.getByLabel(s('cart.code')).fill(code.toLowerCase());
    await shopper.getByRole('button', { name: s('cart.apply') }).click();
    await expect(shopper.getByText(s('cart.codeApplied', { code }))).toBeVisible();
    await expectAccessible(shopper, 'cart');
    await expectScriptBudget(shopper, 'the cart');

    await shopper.getByRole('link', { name: s('cart.checkout') }).click();
    await expect(
      shopper.getByRole('heading', { name: s('checkout.title'), level: 1 }),
    ).toBeVisible();
    await shopper.locator('#c-phone').fill(phone);
    await shopper.locator('#c-name').fill('ই২ই ক্রেতা');
    await shopper.locator('#c-division').selectOption(DHAKA.division);
    await shopper.locator('#c-district').selectOption(DHAKA.district);
    await shopper.locator('#c-area').selectOption(DHAKA.area);
    await shopper.locator('#c-line').fill('বাড়ি ১, সড়ক ২');
    await expect(shopper.getByText(s('checkout.chooseArea'))).toBeHidden();
    // ৳1,050 of ৳1,500, now that the area gives a delivery charge.
    await expect(shopper.getByText(pattern(s('cart.freeDelivery')))).toBeVisible();
    await expectAccessible(shopper, 'checkout');
    await expectScriptBudget(shopper, 'checkout');
    await shopper.getByRole('button', { name: s('checkout.place') }).click();

    await expect(shopper.getByRole('heading', { name: s('thanks.title'), level: 1 })).toBeVisible();
    const head = shopper.locator('.order-head dd').first();
    await expect(head).toHaveText(/\S/);
    number = (await head.textContent())?.trim() ?? '';
    await expect(shopper.getByText(pattern(s('thanks.cod')))).toBeVisible();
    await expectAccessible(shopper, 'order confirmation');

    await shopper.goto(store('/track'));
    await shopper.getByLabel(s('track.number')).fill(number);
    await shopper.getByLabel(s('track.phone')).fill(phone);
    await shopper.getByRole('button', { name: s('track.submit') }).click();
    await expect(shopper.locator('.order-head')).toContainText(number);
    await expectAccessible(shopper, 'order tracking');
    shopper.once('dialog', (d) => void d.accept());
    await shopper.getByRole('button', { name: s('track.cancel') }).click();
    await expect(shopper.getByText(s('track.cancelled'))).toBeVisible();
    await shopper.context().close();
  });

  await test.step('two shoppers race for the last unit; a retried checkout gives the same order', async () => {
    // Acceptance criteria 1 and 2 (phase-4-plan §13), through the real store
    // host. Previews' Turnstile test secret accepts Cloudflare's dummy token.
    const title = `শেষ পিস ${RUN}`;
    const last = await adminCall<{ variants: { id: string }[] }>(
      page.request,
      'post',
      '/v1/admin/products',
      {
        status: 'active',
        translations: { bn: { title, slug: `e2e-last-${viewport}` } },
        variant: { price: 30_000 },
      },
    );
    const variantId = last.variants[0]?.id as string;
    await adminCall(page.request, 'post', '/v1/admin/inventory/adjustments', [
      { mode: 'delta', variantId, quantity: 1, reason: 'received' },
    ]);
    const shoppers = await Promise.all(
      [0, 1].map(() => playwright.request.newContext({ baseURL: STOREFRONT })),
    );
    const api = (path: string) => `/api${path}?store=${p.slug}`;
    const bodies: Record<string, unknown>[] = [];
    for (const [i, shopper] of shoppers.entries()) {
      expect(
        (await shopper.post(api('/cart/lines'), { data: { variantId, quantity: 1 } })).ok(),
      ).toBe(true);
      expect(
        (await shopper.put(api('/cart/area'), { data: { areaId: Number(DHAKA.area) } })).ok(),
      ).toBe(true);
      const cart = (await (await shopper.get(api('/cart'))).json()) as {
        totals: { total: number };
      };
      bodies.push({
        contact: { name: `দৌড় ${i}`, phone: `018${String(Date.now()).slice(-7)}${i}` },
        address: { divisionId: 6, districtId: 47, areaId: Number(DHAKA.area), line: 'বাড়ি ৫' },
        paymentMethod: 'cod',
        expectedTotal: cart.totals.total,
        turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
      });
    }
    const keys = [crypto.randomUUID(), crypto.randomUUID()];
    const place = (i: number) =>
      shoppers[i]?.post(api('/checkout/orders'), {
        data: bodies[i],
        headers: { 'idempotency-key': keys[i] as string },
      }) as Promise<Awaited<ReturnType<APIRequestContext['post']>>>;
    const results = await Promise.all([place(0), place(1)]);
    const won = results.findIndex((r) => r.ok());
    expect(won, 'one of the two orders went through').toBeGreaterThanOrEqual(0);
    const lost = results[1 - won];
    expect(lost?.status()).toBe(409);
    // Refused at the stock lock if both got that far, or at the quote if the
    // winner had already committed: either way the line is out of stock.
    const refusal = (await lost?.json()) as {
      code: string;
      lines?: { variantId: string; problem?: string; available?: number }[];
    };
    expect(['insufficient_stock', 'cart_invalid']).toContain(refusal.code);
    expect(refusal.lines?.[0]).toMatchObject(
      refusal.code === 'cart_invalid'
        ? { variantId, problem: 'insufficient_stock' }
        : { variantId, available: 0 },
    );
    expect(await stockOf(page.request, title, variantId)).toEqual({ onHand: 1, reserved: 1 });

    const first = (await results[won]?.json()) as { id: string; displayNumber: string };
    const again = await place(won);
    expect(again.ok()).toBe(true);
    expect((await again.json()) as { id: string; displayNumber: string }).toEqual(
      expect.objectContaining({ id: first.id, displayNumber: first.displayNumber }),
    );
    expect(await stockOf(page.request, title, variantId)).toEqual({ onHand: 1, reserved: 1 });
    await Promise.all(shoppers.map((c) => c.dispose()));
  });

  await test.step('staff see the cancelled order, then enter a manual order', async () => {
    await page.goto(`${API}/orders`);
    await expect(page.getByRole('heading', { name: m('nav.orders'), level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: number })).toBeVisible();
    await expectAccessible(page, 'orders');

    await page.getByRole('link', { name: m('orders.new') }).click();
    await expect(page.getByRole('heading', { name: m('newOrder.title'), level: 1 })).toBeVisible();
    await page.getByRole('textbox', { name: m('newOrder.phone'), exact: true }).fill(phone);
    await page.getByRole('textbox', { name: m('newOrder.name'), exact: true }).fill('ই২ই ফোন ক্রেতা');
    await page.getByLabel(m('order.addProduct')).fill(products[0]?.title as string);
    await page
      .getByRole('list', { name: m('order.searchResults') })
      .getByRole('button', { name: new RegExp(products[0]?.title as string) })
      .click();
    await page.getByLabel(m('order.quantityOf', { item: products[0]?.title as string })).fill('2');
    await choosePlace(page, DHAKA);
    await page.getByLabel(m('place.line')).fill('বাড়ি ৩, সড়ক ৪');
    await expect(page.getByText(m('newOrder.summaryEmpty'))).toBeHidden();
    await expectAccessible(page, 'new order');
    // The shopper's cancelled order gave its unit back.
    const item = products[0]?.title as string;
    expect(await stockOf(page.request, item, variants[0] as string)).toEqual({
      onHand: 20,
      reserved: 0,
    });
    await page.getByRole('button', { name: m('newOrder.saveConfirm') }).click();
    await expect(
      page.getByRole('heading', { name: pattern(m('order.title')), level: 1 }),
    ).toBeVisible();
    await expectAccessible(page, 'order detail');
    // Placed and confirmed: two units reserved.
    expect(await stockOf(page.request, item, variants[0] as string)).toEqual({
      onHand: 20,
      reserved: 2,
    });
  });

  await test.step('they export it for Steadfast and print an invoice and a packing slip', async () => {
    const orderUrl = page.url();
    const title = (await page.getByRole('heading', { level: 1 }).textContent()) ?? '';
    const manualNumber = /#?\S+$/.exec(title.trim())?.[0] ?? '';

    for (const [link, heading] of [
      [m('print.invoices'), m('print.invoice')],
      [m('print.slips'), manualNumber],
    ] as const) {
      const [printed] = await Promise.all([
        page.context().waitForEvent('page'),
        page.getByRole('link', { name: link }).click(),
      ]);
      await printed.waitForLoadState();
      await expect(printed.getByText(heading).first()).toBeVisible();
      await expect(printed.getByText(manualNumber).first()).toBeVisible();
      await expectAccessible(printed, link);
      await printed.close();
    }

    await page.goto(`${API}/orders`);
    await page.getByRole('button', { name: m('export.button') }).click();
    await page.getByRole('radio', { name: m('export.format.steadfast') }).check();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: m('export.csv') }).click(),
    ]);
    const csv = await readFile((await download.path()) as string, 'utf8');
    expect(csv.split('\n')[0]).toMatch(/Invoice/i);
    expect(csv).toContain(manualNumber);
    expect(csv).toContain(phone);
    await page.goto(orderUrl);
  });

  await test.step('they ship it in two parcels, deliver it with the cash and see it completed', async () => {
    const item = products[0]?.title as string;
    const variantId = variants[0] as string;
    for (const [i, quantity] of ['1', '1'].entries()) {
      await page
        .getByRole('button', { name: m('order.createShipment') })
        .first()
        .click();
      const dialog = page.getByRole('dialog', { name: m('order.createShipment') });
      await dialog.getByLabel(m('order.quantityOf', { item })).fill(quantity);
      await dialog.getByLabel(m('order.carrier')).fill('Steadfast');
      await expectAccessible(page, 'create shipment');
      await dialog.getByRole('button', { name: m('order.createShipment') }).click();
      await expect(toast(page, m('order.shipmentCreated'))).toBeVisible();
      await page.getByRole('button', { name: m('order.markShipped') }).click();
      await expect(toast(page, m('order.shipped'))).toBeVisible();
      // Each parcel shipped sells its unit: off the shelf and out of reserved.
      await expect
        .poll(() => stockOf(page.request, item, variantId))
        .toEqual({ onHand: 19 - i, reserved: 1 - i });
    }
    // The first parcel brings the cash for the whole order.
    await page
      .getByRole('button', { name: m('order.markDelivered') })
      .first()
      .click();
    const deliver = page.getByRole('dialog', { name: m('order.markDelivered') });
    await deliver.getByRole('checkbox', { name: pattern(m('order.cashCollected')) }).check();
    await deliver.getByRole('button', { name: m('order.markDelivered') }).click();
    await expect(toast(page, m('order.delivered'))).toBeVisible();
    await page
      .getByRole('button', { name: m('order.markDelivered') })
      .first()
      .click();
    await page
      .getByRole('dialog', { name: m('order.markDelivered') })
      .getByRole('button', { name: m('order.markDelivered') })
      .click();
    await expect(page.getByText(m('orderStatus.completed')).first()).toBeVisible();
    await expect(page.getByText(m('paymentStatus.paid')).first()).toBeVisible();
    expect(await stockOf(page.request, item, variantId)).toEqual({ onHand: 18, reserved: 0 });
    // The timeline has every step, from placed to completed.
    const timeline = page.getByRole('region', { name: m('order.timeline') });
    await expect(timeline.getByText(m('history.placed'))).toBeVisible();
    await expect(
      timeline.getByText(m('history.order', { status: m('orderStatus.completed') })),
    ).toBeVisible();
    await expectAccessible(page, 'completed order');
  });

  await test.step('the owner turns accounts on and a shopper signs in with a code', async () => {
    await page.goto(`${API}/settings/checkout`);
    await page.getByRole('checkbox', { name: new RegExp(m('checkoutSettings.accounts')) }).check();
    await expectAccessible(page, 'checkout settings');
    await page
      .getByRole('button', { name: m('action.save') })
      .first()
      .click();
    await expect(toast(page, m('account.saved'))).toBeVisible();

    const shopper = await shopperPage();
    const email = `e2e-${RUN}-${viewport}-shopper@example.test`;
    await shopper.goto(store('/account'));
    await shopper.getByLabel(s('account.email')).fill(email);
    await expectAccessible(shopper, 'account sign-in');
    await expectScriptBudget(shopper, 'the account page');
    const before = await mailCount(email);
    await shopper.getByRole('button', { name: s('account.sendCode') }).click();
    const mail = await nextMail(email, before);
    const otp = /\b(\d{6})\b/.exec(mail.text)?.[1] ?? '';
    await shopper.getByLabel(s('account.code')).fill(otp);
    await shopper.getByRole('button', { name: s('account.signIn'), exact: true }).click();
    await expect(shopper.getByText(s('account.hello', { email }))).toBeVisible();
    await expectAccessible(shopper, 'account');
    await shopper.context().close();
  });
});
