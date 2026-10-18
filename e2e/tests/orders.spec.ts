// The Phase 4 flows on the preview (phase-4-plan §10), on the run's own store:
// the owner adds a code promotion and checks it with the test cart; a shopper
// adds two products, sees the free-delivery progress, applies the code,
// chooses an area, places a COD order, sees the confirmation, then tracks it
// by number and phone and cancels it. Staff enter a manual order, confirm it,
// export it in Steadfast's format, print an invoice and a packing slip, ship
// it in two parcels, mark it delivered with the cash collected and see it
// completed. Last, the owner turns shopper accounts on and a shopper signs in
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

async function choosePlace(page: Page, ids: { division: string; district: string; area: string }) {
  await page.getByLabel(m('place.division'), { exact: true }).selectOption(ids.division);
  await page.getByLabel(m('place.district'), { exact: true }).selectOption(ids.district);
  await page.getByLabel(m('place.area'), { exact: true }).selectOption(ids.area);
}

test('orders, promotions and accounts', async ({
  page,
  browser,
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
    await page.getByRole('button', { name: m('newOrder.saveConfirm') }).click();
    await expect(
      page.getByRole('heading', { name: pattern(m('order.title')), level: 1 }),
    ).toBeVisible();
    await expectAccessible(page, 'order detail');
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
    for (const quantity of ['1', '1']) {
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
