// The Phase 6 sales recovery flows (phase-6-plan §10), on the run's own store
// after the returns flow. A shopper types their phone, name and address at
// checkout, sees the notice that the store saves it, and leaves. Staff find
// the checkout under Orders → Incomplete and create the order from it in one
// click. In the call queue they call it: no answer, then later confirmed. A
// second order from the same phone is cancelled on the call as fake, and the
// phone's delivery score drops. Two identical orders a moment apart are
// flagged as a possible duplicate, and staff merge them. Last, the page an
// SMS link opens says an unknown link has expired. Axe on every new screen,
// and the store's JavaScript budget on the link page.
//
// Previews have no development SMS outbox, so the flow can't read a link's
// code: the API's integration tests answer links (apps/api/test/recovery.test.ts).
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { bn } from '../../apps/admin/src/i18n/bn';
import { ordersBn } from '../../apps/admin/src/i18n/orders-bn';
import { type StoreMessageKey, bn as shopBn } from '../../apps/storefront/src/i18n';
import { expectAccessible, expectScriptBudget, signIn } from './helpers';
import { DEV_TOKEN, people, RUN } from './people';
import { API, STOREFRONT } from './urls';

test.skip(!RUN || !DEV_TOKEN, 'needs a seeded preview: E2E_RUN and DEV_TOKEN');
test.describe.configure({ mode: 'serial', timeout: 300_000 });

const adminMessages = { ...bn, ...ordersBn };
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
  method: 'get' | 'post' | 'patch' | 'put',
  path: string,
  data?: unknown,
): Promise<T> {
  const send = () =>
    request[method](`${API}${path}`, {
      ...(data === undefined ? {} : { data }),
      headers: { origin: API, 'idempotency-key': crypto.randomUUID() },
    });
  let res = await send();
  // A preview's direct connection sometimes answers an empty 503 (phase-5b-report §3).
  // A read is safe to send again; a write is not.
  for (let i = 0; method === 'get' && res.status() === 503 && i < 2; i++) res = await send();
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

interface Risk {
  score: number | null;
  history: { fake: number; open: number };
}

test('sales recovery', async ({ page, browser, viewport: size, hasTouch }, info) => {
  const viewport = info.project.name.replace(/^recovery-/, '');
  const p = people(viewport);
  const store = (path: string) =>
    `${STOREFRONT}${path}${path.includes('?') ? '&' : '?'}store=${p.slug}`;
  // Numbers of their own per run and viewport, under the per-phone limits.
  const stamp = `${String(Date.now()).slice(-7)}${viewport === 'phone' ? '1' : '2'}`;
  const phone = `015${stamp}`;
  const otherPhone = `013${stamp}`;
  const shopperName = `ই২ই অসম্পূর্ণ ${RUN}`;
  const products = [
    { slug: `e2e-mango-${viewport}`, title: `আম ${RUN}`, price: 80_000 },
    { slug: `e2e-lichi-${viewport}`, title: `লিচু ${RUN}`, price: 55_000 },
  ];
  const variants: string[] = [];
  const risk = () =>
    adminCall<Risk>(page.request, 'get', `/v1/admin/phones/${encodeURIComponent(phone)}/risk`);
  const manualOrder = (contact: { name: string; phone: string }, variantId: string) =>
    adminCall<{ id: string; displayNumber: string }>(page.request, 'post', '/v1/admin/orders', {
      source: 'phone',
      lines: [{ variantId, quantity: 1 }],
      contact,
      address: {
        divisionId: DHAKA.division,
        districtId: DHAKA.district,
        areaId: DHAKA.area,
        line: 'বাড়ি ৮, সড়ক ৩',
      },
      confirm: false,
    });

  await test.step('the owner stocks two products and shows incomplete checkouts at once', async () => {
    await signIn(page, p.owner);
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
      variants.map((variantId) => ({ mode: 'delta', variantId, quantity: 10, reason: 'received' })),
    );
    // The earlier flows' pending orders are confirmed, so the call queue
    // holds only this flow's.
    const pending = await adminCall<{ items: { id: string }[] }>(
      page.request,
      'get',
      '/v1/admin/orders?status=pending&limit=100',
    );
    for (const order of pending.items) {
      await adminCall(page.request, 'post', `/v1/admin/orders/${order.id}/confirm`, {});
    }

    await page.goto(`${API}/settings/confirmation`);
    await expect(
      page.getByRole('heading', { name: m('confirmSettings.title'), level: 1 }),
    ).toBeVisible();
    await expectAccessible(page, 'confirmation settings');
    // Shown to staff as soon as the shopper stops typing, not after 30 minutes.
    await adminCall(page.request, 'patch', '/v1/admin/store', {
      recovery: { showAfterMinutes: 0 },
    });
  });

  await test.step('a shopper fills in checkout, sees it is saved, and leaves', async () => {
    const shopper = await (await browser.newContext({ viewport: size, hasTouch })).newPage();
    await shopper.goto(store(`/products/${products[0]?.slug}`));
    await shopper.getByRole('button', { name: s('cart.add') }).click();
    await expect(shopper.getByText(s('cart.added'))).toBeVisible();
    await shopper.goto(store('/checkout'));
    await expect(
      shopper.getByRole('heading', { name: s('checkout.title'), level: 1 }),
    ).toBeVisible();
    await expect(shopper.getByText(pattern(s('checkout.saveNotice')))).toBeVisible();
    await expect(shopper.getByRole('button', { name: s('checkout.dontSave') })).toBeVisible();
    await shopper.locator('#c-phone').fill(phone);
    await shopper.locator('#c-name').fill(shopperName);
    await shopper.locator('#c-division').selectOption(String(DHAKA.division));
    await shopper.locator('#c-district').selectOption(String(DHAKA.district));
    await shopper.locator('#c-area').selectOption(String(DHAKA.area));
    // Saved 2 seconds after the last change, with everything typed by then.
    const saved = shopper.waitForResponse(
      (r) =>
        r.url().includes('/checkout/draft') &&
        r.request().method() === 'PUT' &&
        (r.request().postData() ?? '').includes('বাড়ি ৯'),
    );
    await shopper.locator('#c-line').fill('বাড়ি ৯, সড়ক ১');
    expect((await saved).ok()).toBe(true);
    await expectAccessible(shopper, 'checkout with the save notice');
    await shopper.context().close();
  });

  let first = '';
  await test.step('staff find it under Incomplete and create the order from it', async () => {
    await page.goto(`${API}/orders/incomplete`);
    await expect(
      page.getByRole('heading', { name: m('incomplete.title'), level: 1 }),
    ).toBeVisible();
    await expectAccessible(page, 'incomplete orders');
    await page.getByRole('link', { name: new RegExp(shopperName) }).click();
    await expect(page.getByRole('heading', { name: shopperName, level: 1 })).toBeVisible();
    await expect(page.getByText(products[0]?.title as string).first()).toBeVisible();
    await expectAccessible(page, 'incomplete order');

    await page.getByRole('link', { name: m('incomplete.createOrder') }).click();
    await expect(page.getByRole('heading', { name: m('newOrder.title'), level: 1 })).toBeVisible();
    await expect(page.getByText(pattern(m('incomplete.startedFrom')))).toBeVisible();
    // The shopper's cart, contact and area, as they left them.
    await expect(
      page.getByLabel(m('order.quantityOf', { item: products[0]?.title as string })),
    ).toHaveValue('1');
    await expect(page.getByRole('textbox', { name: m('newOrder.name'), exact: true })).toHaveValue(
      shopperName,
    );
    await expect(page.getByText(m('newOrder.summaryEmpty'))).toBeHidden();
    await expectAccessible(page, 'new order from an incomplete checkout');
    await page.getByRole('button', { name: m('newOrder.save'), exact: true }).click();
    const heading = page.getByRole('heading', { name: pattern(m('order.title')), level: 1 });
    await expect(heading).toBeVisible();
    first = /#?\S+$/.exec(((await heading.textContent()) ?? '').trim())?.[0] ?? '';
    expect(first).not.toBe('');

    await page.goto(`${API}/orders/incomplete?tab=converted`);
    await expect(page.getByRole('link', { name: new RegExp(shopperName) })).toBeVisible();
  });

  const callFrom = async (card: string, number: string) => {
    // The browser has no phone: a tel: link would open its prompt for an
    // app, which takes the page's input. The admin's own click still runs.
    await page.evaluate(() =>
      document.addEventListener(
        'click',
        (e) => {
          if ((e.target as Element).closest('a[href^="tel:"]')) e.preventDefault();
        },
        true,
      ),
    );
    await page
      .getByRole('article', { name: card })
      .getByRole('link', { name: pattern(m('queue.call')) })
      .click();
    const panel = page.getByRole('dialog', {
      name: m('queue.panelTitle', { number, name: card }),
    });
    await expect(panel).toBeVisible();
    return panel;
  };

  await test.step('in the call queue: no answer, then later confirmed', async () => {
    await page.goto(`${API}/orders/confirm`);
    await expect(page.getByRole('heading', { name: m('queue.title'), level: 1 })).toBeVisible();
    await expect(page.getByRole('article', { name: shopperName })).toBeVisible();
    await expectAccessible(page, 'call queue');

    let panel = await callFrom(shopperName, first);
    await expect(panel.getByText(m('queue.script'))).toBeVisible();
    await expectAccessible(page, 'call panel');
    await panel.getByRole('radio', { name: m('outcome.no_answer'), exact: true }).check();
    await panel.getByRole('button', { name: m('queue.save') }).click();
    await expect(toast(page, m('outcome.done.no_answer', { number: first }))).toBeVisible();
    await expect(panel).toBeHidden();

    // Due again in an hour: under Later, where staff can still call it now.
    await page.getByRole('link', { name: new RegExp(m('queue.tab.later')) }).click();
    const card = page.getByRole('article', { name: shopperName });
    await expect(card.getByText(pattern(m('queue.attempts')))).toBeVisible();
    await expectAccessible(page, 'call queue, later');
    panel = await callFrom(shopperName, first);
    await panel.getByRole('radio', { name: m('outcome.confirmed'), exact: true }).check();
    await panel.getByRole('button', { name: m('queue.save') }).click();
    await expect(toast(page, m('outcome.done.confirmed', { number: first }))).toBeVisible();
  });

  await test.step('a second order from the phone is cancelled as fake and its score drops', async () => {
    expect(await risk()).toMatchObject({ score: null, history: { fake: 0 } });
    const name = `ই২ই দ্বিতীয় ${RUN}`;
    const second = await manualOrder({ name, phone }, variants[1] as string);
    await page.goto(`${API}/orders/confirm`);
    const panel = await callFrom(name, second.displayNumber);
    await panel.getByRole('radio', { name: m('outcome.cancelled'), exact: true }).check();
    await panel.getByRole('radio', { name: m('cancelCode.fake') }).check();
    await expectAccessible(page, 'call panel, cancelling');
    await panel.getByRole('button', { name: m('queue.save') }).click();
    await expect(
      toast(page, m('outcome.done.cancelled', { number: second.displayNumber })),
    ).toBeVisible();
    // One order never received out of one decided.
    expect(await risk()).toMatchObject({ score: 0, history: { fake: 1 } });
  });

  await test.step('two identical orders a moment apart are merged', async () => {
    const name = `ই২ই দুবার ${RUN}`;
    const older = await manualOrder({ name, phone: otherPhone }, variants[0] as string);
    const newer = await manualOrder({ name, phone: otherPhone }, variants[0] as string);
    await page.goto(`${API}/orders/${newer.id}`);
    await expect(page.getByText(m('duplicate.banner'))).toBeVisible();
    await expectAccessible(page, 'possible duplicate');
    await page
      .getByRole('button', { name: m('duplicate.merge', { number: older.displayNumber }) })
      .click();
    await expect(toast(page, m('duplicate.merged', { number: older.displayNumber }))).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: m('order.title', { number: older.displayNumber }),
        level: 1,
      }),
    ).toBeVisible();
    const kept = await adminCall<{ lines: { quantity: number }[] }>(
      page.request,
      'get',
      `/v1/admin/orders/${older.id}`,
    );
    expect(kept.lines.map((l) => l.quantity)).toEqual([2]);
    const gone = await adminCall<{ status: string; cancelCode: string | null }>(
      page.request,
      'get',
      `/v1/admin/orders/${newer.id}`,
    );
    expect(gone).toMatchObject({ status: 'cancelled', cancelCode: 'duplicate' });
  });

  await test.step('an SMS link the store doesn’t know says it has expired', async () => {
    const shopper = await (await browser.newContext({ viewport: size, hasTouch })).newPage();
    await shopper.goto(`${store('/c')}#AAAAAAAAAA`);
    await expect(
      shopper.getByRole('heading', { name: s('confirm.title'), level: 1 }),
    ).toBeVisible();
    await expect(shopper.getByText(s('confirm.gone'))).toBeVisible();
    // The code is never left in the address bar.
    expect(new URL(shopper.url()).hash).toBe('');
    await expectAccessible(shopper, 'confirm link');
    await expectScriptBudget(shopper, 'the confirm link page');
    await shopper.context().close();
  });
});
