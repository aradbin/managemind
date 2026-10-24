// Launch readiness on the preview (phase-5b-plan §10): a super admin sets
// up two-factor login and our invoice details, and onboards a store on the
// Starter plan through the New store screen; its owner signs in, sees the
// setup checklist, and meets the plan's limit on custom domains. We invoice
// the store, the owner sees it, and the super admin records the payment.
// Then the store is closed (the storefront answers 410) and its purge starts
// with the dry run. The purge itself needs the Store jobs runner, which
// previews don't have; scripts/jobs/purge.test.ts covers it (criterion 3).
// Runs once per viewport, with its own seeded super admin, and axe on every
// new screen.
import { type Browser, expect, type Page, test } from '@playwright/test';
import { createStore, expectAccessible, nextMail, signIn, signInHere, t, totp } from './helpers';
import { DEV_TOKEN, people, RUN } from './people';
import { API, STOREFRONT } from './urls';

test.skip(!RUN || !DEV_TOKEN, 'needs a seeded preview: E2E_RUN and DEV_TOKEN');
test.describe.configure({ mode: 'serial', timeout: 300_000 });

async function newPage(browser: Browser, viewport: { width: number; height: number } | null) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  return context.newPage();
}

/** Two-factor login for a platform user; returns a source of fresh codes. */
async function setUpTwoFactor(page: Page): Promise<() => Promise<string>> {
  await page.goto(`${API}/account`);
  await page.getByRole('button', { name: t('account.twoFactor.setUp') }).click();
  const secret = await page.locator('code').innerText();
  await page.getByLabel(t('twoFactor.code')).fill(totp(secret));
  await page.getByRole('button', { name: t('account.twoFactor.enable') }).click();
  await expect(page.getByText(t('account.twoFactor.enabled'))).toBeVisible();
  await page.getByRole('button', { name: t('account.backupCodes.done') }).click();
  // A code is accepted once per 30 seconds: each confirmation waits for a new one.
  let last = totp(secret);
  return async () => {
    for (let code = totp(secret); ; code = totp(secret)) {
      if (code !== last) {
        last = code;
        return code;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  };
}

test('onboarding, billing and closing a store', async ({ browser, viewport }, info) => {
  const p = people(info.project.name.replace(/^launch-/, ''));
  const admin = await newPage(browser, viewport);
  const owner = await newPage(browser, viewport);
  let code: () => Promise<string> = async () => '';

  await test.step('the super admin sets up two-factor login and our invoice details', async () => {
    await signIn(admin, p.platform);
    code = await setUpTwoFactor(admin);
    await admin.goto(`${API}/platform/billing`);
    await expect(admin.getByRole('heading', { name: t('pbilling.title'), level: 1 })).toBeVisible();
    await admin.getByLabel(t('issuer.legalName')).fill('managemind Ltd');
    await admin.getByLabel(t('issuer.address')).fill('Gulshan, Dhaka');
    await admin.getByLabel(t('issuer.bkash')).fill('01700000000');
    await admin.getByRole('button', { name: t('action.save') }).click();
    await expect(admin.getByText(t('pbilling.issuerSaved'))).toBeVisible();
    await expectAccessible(admin, 'platform billing');
  });

  await test.step('the super admin onboards a store on the Starter plan', async () => {
    await createStore(admin, {
      name: p.launchName,
      slug: p.launchSlug,
      ownerEmail: p.launchOwner,
      ownerName: 'Launch Owner',
      kind: 'test',
      plan: 'স্টার্টার',
      preset: 'grocery',
    });
    await expectAccessible(admin, 'store page');
    // The owner is told where the admin is.
    const welcome = await nextMail(p.launchOwner, 0);
    expect(welcome.text).toContain(p.launchName);
  });

  await test.step('the owner signs in and sees the setup checklist', async () => {
    await signIn(owner, p.launchOwner);
    // Terms published on this database come first, when there are any.
    const accept = owner.getByRole('button', { name: t('terms.accept') });
    if (await accept.isVisible().catch(() => false)) await accept.click();
    await expect(owner.getByRole('heading', { name: t('setup.title') })).toBeVisible();
    await expectAccessible(owner, 'dashboard with the checklist');
  });

  await test.step("the plan's limit shows its upgrade message", async () => {
    await owner.goto(`${API}/settings/domains`);
    const add = async (hostname: string) => {
      await owner.getByLabel(t('domains.hostname')).fill(hostname);
      await owner.getByRole('button', { name: t('domains.add') }).click();
    };
    await add(`www.${p.launchSlug}.example.com`);
    await expect(owner.getByText(`www.${p.launchSlug}.example.com`).first()).toBeVisible();
    // Starter includes one custom domain.
    await add(`shop.${p.launchSlug}.example.com`);
    await expect(
      owner.getByText(t('error.planLimit.customDomains'), { exact: false }),
    ).toBeVisible();
  });

  await test.step('we invoice the store; the owner sees it; we record the payment', async () => {
    await admin.getByRole('link', { name: t('tenant.invoices') }).click();
    await expect(admin.getByText(t('pbilling.forStore', { store: p.launchName }))).toBeVisible();
    await admin.getByRole('button', { name: t('pbilling.new') }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByLabel(t('pbilling.descEn')).fill('Setup help');
    await dialog.getByLabel(t('pbilling.unitPrice')).fill('500');
    await dialog.getByLabel(t('pbilling.issueNow')).check();
    await expectAccessible(admin, 'new invoice');
    await dialog.getByRole('button', { name: t('pbilling.new') }).click();
    const title = admin.getByRole('heading', { level: 1, name: /INV-\d{4}-\d{4,}/ });
    await expect(title).toBeVisible();
    const number = /INV-\d{4}-\d{4,}/.exec(await title.innerText())?.[0] ?? '';
    await expectAccessible(admin, 'invoice');

    await owner.goto(`${API}/settings/billing`);
    await expect(owner.getByRole('heading', { name: t('billing.title'), level: 1 })).toBeVisible();
    await expect(owner.getByText(number)).toBeVisible();
    await expectAccessible(owner, 'plan and billing');

    await admin.getByRole('button', { name: t('pbilling.record') }).click();
    const pay = admin.getByRole('dialog');
    await pay.getByLabel(t('pbilling.method')).selectOption('bkash');
    await pay.getByLabel(t('pbilling.reference')).fill('TX-E2E');
    await expectAccessible(admin, 'record a payment');
    await pay.getByRole('button', { name: t('pbilling.record') }).click();
    await expect(admin.getByText(t('pbilling.recorded'))).toBeVisible();
    await owner.reload();
    await expect(owner.getByText(t('invoice.status.paid')).first()).toBeVisible();
  });

  await test.step('the store is closed: its storefront answers 410, and the purge starts', async () => {
    await admin.goto(`${API}/platform`);
    await admin.getByLabel(t('tenants.search')).fill(p.launchSlug);
    await admin
      .getByRole('link', { name: p.launchName, exact: true })
      .locator('visible=true')
      .click();
    await admin.getByRole('button', { name: t('tenant.close') }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByLabel(t('tenant.reason'), { exact: false }).fill('E2E: the test is over');
    await dialog.getByLabel(t('tenant.code')).fill(await code());
    await dialog.getByLabel(t('confirm.typeToConfirm', { word: p.launchSlug })).fill(p.launchSlug);
    await dialog.getByRole('button', { name: t('tenant.close') }).click();
    await expect(admin.getByRole('heading', { name: t('purge.title') })).toBeVisible();

    const res = await fetch(`${STOREFRONT}/?store=${p.launchSlug}`);
    expect(res.status).toBe(410);

    // A test store can be purged at once: the dry run is queued.
    await admin.getByRole('button', { name: t('purge.start') }).click();
    await expect(admin.getByText(t('purge.counting'))).toBeVisible();
    await expectAccessible(admin, 'purge');
  });
});

test('signing in still works for the store owner after closing', async ({
  browser,
  viewport,
}, info) => {
  const p = people(info.project.name.replace(/^launch-/, ''));
  const page = await newPage(browser, viewport);
  await page.goto(`${API}/sign-in`);
  await signInHere(page, p.launchOwner);
  // A closed store isn't listed: the owner has no store to open.
  await expect(page.getByText(p.launchName)).toHaveCount(0);
});
