// The Phase 0 E2E smoke (phase-0-plan §10): both demo stores resolve with
// their locale, the admin opens at the root of its host, and the API reaches
// the database.
import { expect, test } from '@playwright/test';
import { API, ENVIRONMENT, STOREFRONT } from './urls';

test('the API is alive', async ({ request }) => {
  const res = await request.get(`${API}/health`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: 'ok', environment: ENVIRONMENT });
});

test('the API reaches the database', async ({ request }) => {
  const res = await request.get(`${API}/health/deep`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: 'ok' });
});

test('demo-fashion is served in English', async ({ page }) => {
  const res = await page.goto(`${STOREFRONT}/?store=demo-fashion`);
  expect(res?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('Demo Fashion');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('note').first()).toContainText('Demo Fashion');
});

test('demo-grocery is served in Bangla', async ({ page }) => {
  const res = await page.goto(`${STOREFRONT}/?store=demo-grocery`);
  expect(res?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  await expect(page).toHaveTitle('ডেমো গ্রোসারি');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});

test('an unknown store is a 404', async ({ page }) => {
  const res = await page.goto(`${STOREFRONT}/?store=no-such-store`);
  expect(res?.status()).toBe(404);
});

test('the admin opens at the root and sends a visitor without a session to sign in', async ({
  page,
}) => {
  await page.goto(`${API}/`);
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('সাইন ইন');
});

test('an admin client-side route is served without the Worker', async ({ request }) => {
  const res = await request.get(`${API}/settings`);
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('<div id="root">');
});

// Without its cached copy of the shell, the service worker fetches
// /index.html for every address but /. A redirect there (to /) can't answer
// a page load, so every other address failed to open.
test('an admin address opens when the service worker has lost its copy of the shell', async ({
  page,
}) => {
  const direct = await page.request.get(`${API}/index.html`, { maxRedirects: 0 });
  expect(direct.status()).toBe(200);

  await page.goto(`${API}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  const removed = await page.evaluate(async () => {
    let count = 0;
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname === '/index.html')
          count += Number(await cache.delete(request));
      }
    }
    return { controlled: Boolean(navigator.serviceWorker.controller), count };
  });
  expect(removed).toEqual({ controlled: true, count: 1 });

  await page.goto(`${API}/reports`);
  await expect(page).toHaveURL(/\/sign-in\?redirect=%2Freports$/);
});

// Phase 4 (phase-4-plan §10): the shop API answers through the store's own
// /api, never cached, and an anonymous read makes no cart.
test('the cart and checkout answer on a demo store', async ({ request }) => {
  const cart = await request.get(`${STOREFRONT}/api/cart?store=demo-grocery`);
  expect(cart.status()).toBe(200);
  expect(cart.headers()['cache-control']).toBe('no-store');
  expect(await cart.json()).toMatchObject({ itemCount: 0, lines: [] });
  expect(cart.headers()['set-cookie'] ?? '').not.toContain('mm_cart');
  const checkout = await request.get(`${STOREFRONT}/api/checkout?store=demo-grocery`);
  expect(checkout.status()).toBe(200);
  expect(Object.keys(await checkout.json())).toContain('turnstileSiteKey');
});

test('a write from another site is refused', async ({ request }) => {
  const res = await request.post(`${STOREFRONT}/api/cart/lines?store=demo-grocery`, {
    headers: { origin: 'https://evil.example' },
    data: { variantId: '00000000-0000-4000-8000-000000000000', quantity: 1 },
  });
  expect(res.status()).toBe(403);
});
