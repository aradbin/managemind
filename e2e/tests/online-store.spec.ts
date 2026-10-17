// The online-store flows on the preview (phase-3-plan §9): the owner changes
// the theme's main colour and sees it in the live preview at once, publishes,
// and the store shows it; adds an About page and the store links to it; sets
// a Meta Pixel ID, and a shopper's browser asks Meta for nothing until they
// accept cookies; adds a custom domain and sees its pending DNS instructions
// (previews use a provider that keeps every hostname pending). Axe on every
// screen, at a phone and a desktop viewport. Runs after the catalog flows, on
// the same store.
import { expect, type Page, test } from '@playwright/test';
import { onlineStoreBn } from '../../apps/admin/src/i18n/online-store-bn';
import { expectAccessible, signIn, t } from './helpers';
import { DEV_TOKEN, people, RUN } from './people';
import { API, STOREFRONT } from './urls';

test.skip(!RUN || !DEV_TOKEN, 'needs a seeded preview: E2E_RUN and DEV_TOKEN');
test.describe.configure({ mode: 'serial', timeout: 300_000 });

/** An online-store message in Bangla, with {placeholders} filled. */
function ot(key: keyof typeof onlineStoreBn, params: Record<string, string> = {}): string {
  return onlineStoreBn[key].replace(/\{(\w+)\}/g, (m, name: string) => params[name] ?? m);
}

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('online store flows', async ({ page, context }, info) => {
  const viewport = info.project.name.replace(/^online-store-/, '');
  const p = people(viewport);
  const phone = viewport === 'phone';
  const store = (path = '/') =>
    `${STOREFRONT}${path}${path.includes('?') ? '&' : '?'}store=${p.slug}`;
  const primary = phone ? '#7a2e0e' : '#0f5c4a';

  await test.step('the owner opens the online store', async () => {
    await signIn(page, p.owner);
    await page.goto(`${API}/online-store`);
    await expect(
      page.getByRole('heading', { name: ot('onlineStore.title'), level: 1 }),
    ).toBeVisible();
    await expectAccessible(page, 'online store');
  });

  await test.step('they change the main colour and the preview follows', async () => {
    await page.getByRole('link', { name: new RegExp(ot('theme.title')) }).click();
    await expect(page.getByRole('heading', { name: ot('theme.title'), level: 1 })).toBeVisible();
    await expectAccessible(page, 'theme editor');
    const iframe = page.locator(`iframe[title="${ot('theme.previewTitle')}"]`);
    if (phone) await page.getByRole('tab', { name: ot('theme.preview') }).click();
    // The preview shows the draft, marked as such.
    await expect(page.frameLocator('iframe').locator('.preview-bar').last()).toBeVisible();
    if (phone) await page.getByRole('tab', { name: ot('theme.edit') }).click();

    const field = page
      .getByRole('textbox', { name: ot('theme.color.primary') })
      .and(page.locator('input:not([type=color])'));
    await field.fill(primary);
    await field.blur();
    const preview = await (await iframe.elementHandle())?.contentFrame();
    await expect
      .poll(async () =>
        preview?.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--c-primary').trim(),
        ),
      )
      .toBe(primary);
    await expect(page.getByRole('status').filter({ hasText: ot('theme.saved') })).toBeVisible({
      timeout: 15_000,
    });
  });

  await test.step('they publish and the store shows the colour', async () => {
    await page.getByRole('button', { name: ot('theme.publish'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: ot('theme.publish'), exact: true }).click();
    await expect(toast(page, ot('theme.published')).first()).toBeVisible();

    const shopper = await context.newPage();
    await shopper.goto(store());
    expect(await cssVar(shopper, '--c-primary')).toBe(primary);
    await expectAccessible(shopper, 'store with the new theme');
    await shopper.close();
  });

  await test.step('they add an About page and the store links to it', async () => {
    await page.goto(`${API}/online-store/pages`);
    await expect(page.getByRole('heading', { name: ot('pages.title'), level: 1 })).toBeVisible();
    await expectAccessible(page, 'pages');
    await page.getByRole('button', { name: ot('pages.new') }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(ot('pages.kind')).selectOption('about');
    await dialog.getByRole('button', { name: ot('pages.new') }).click();
    await expect(page).toHaveURL(/\/online-store\/pages\/[0-9a-f-]{36}$/);
    await page.getByRole('checkbox', { name: new RegExp(ot('pages.published')) }).check();
    await expectAccessible(page, 'page editor');
    await page.getByRole('button', { name: t('action.save') }).click();
    await expect(toast(page, ot('onlineStore.purgeNote')).first()).toBeVisible();

    const shopper = await context.newPage();
    await shopper.goto(store());
    await shopper.getByRole('contentinfo').getByRole('link', { name: 'আমাদের সম্পর্কে' }).click();
    await expect(shopper.getByRole('heading', { name: 'আমাদের সম্পর্কে', level: 1 })).toBeVisible();
    await shopper.close();
  });

  await test.step('they set a Meta Pixel ID; tags wait for consent', async () => {
    await page.goto(`${API}/online-store/settings`);
    await expect(
      page.getByRole('heading', { name: ot('storefront.title'), level: 1 }),
    ).toBeVisible();
    await page.getByLabel(ot('storefront.pixel')).fill('123456789012345');
    await expectAccessible(page, 'storefront settings');
    await page.getByRole('button', { name: t('action.save') }).click();
    await expect(toast(page, ot('onlineStore.purgeNote')).first()).toBeVisible();

    const shopper = await context.newPage();
    const asked: string[] = [];
    await shopper.route(/facebook\.(net|com)|googletagmanager\.com/, (route) => {
      asked.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    });
    await shopper.goto(store());
    await shopper.waitForLoadState('load');
    const banner = shopper.getByRole('region', { name: 'কুকি সম্মতি' });
    await expect(banner).toBeVisible();
    await expectAccessible(shopper, 'store with the consent banner');
    await shopper.waitForTimeout(1000);
    expect(asked, 'no tag requests before consent').toEqual([]);
    await banner.getByRole('button', { name: 'গ্রহণ করুন' }).click();
    await expect(banner).toBeHidden();
    await expect.poll(() => asked.length).toBeGreaterThan(0);
    await shopper.close();
  });

  await test.step('they add a custom domain and see what to do next', async () => {
    const hostname = `shop-${RUN}-${viewport}.example.com`;
    await page.goto(`${API}/settings/domains`);
    await expect(page.getByRole('heading', { name: t('domains.title'), level: 1 })).toBeVisible();
    await expectAccessible(page, 'domains');
    await page.getByLabel(ot('domains.hostname')).fill(hostname);
    await page.getByRole('button', { name: ot('domains.add') }).click();
    const card = page.getByRole('listitem').filter({ hasText: hostname });
    await expect(card.getByText(ot('domains.status.pending'))).toBeVisible();
    await expect(card.getByText(ot('domains.dns'))).toBeVisible();
    await expect(card.getByRole('cell', { name: 'CNAME' })).toBeVisible();
    await expectAccessible(page, 'domain pending');

    await card.getByRole('button', { name: ot('domains.remove') }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: ot('domains.remove') })
      .click();
    await expect(card).toHaveCount(0);
  });
});
