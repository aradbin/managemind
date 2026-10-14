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
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to Demo Fashion');
  await expect(page.getByRole('note')).toContainText('Demo Fashion');
});

test('demo-grocery is served in Bangla', async ({ page }) => {
  const res = await page.goto(`${STOREFRONT}/?store=demo-grocery`);
  expect(res?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ডেমো গ্রোসারি-এ স্বাগতম');
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
