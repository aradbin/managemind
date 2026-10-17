// The Phase 1 flows on the preview (phase-1-plan §9): an owner signs in with
// a code from the dev mailbox, invites someone who accepts, changes their
// role and switches stores; a super admin sets up two-factor login, creates
// a store and suspends one, and the owner sees the banner and the refusal.
// Runs once per viewport project, on that project's own seeded store, with
// axe on every screen.
import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, mailCount, nextMail, signIn, signInHere, t, totp } from './helpers';
import { DEV_TOKEN, people, RUN } from './people';
import { API, STOREFRONT } from './urls';

test.skip(!RUN || !DEV_TOKEN, 'needs a seeded preview: E2E_RUN and DEV_TOKEN');
test.describe.configure({ mode: 'serial', timeout: 240_000 });

const switcher = (page: Page) =>
  page.getByRole('button', { name: new RegExp(`^${t('store.switch')}`) });

async function newPage(browser: Browser, viewport: { width: number; height: number } | null) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  return context.newPage();
}

test('owner, staff and super admin flows', async ({ browser, viewport }, info) => {
  const p = people(info.project.name.replace(/^flows-/, ''));
  const owner = await newPage(browser, viewport);
  const admin = await newPage(browser, viewport);
  const invitee = await newPage(browser, viewport);

  await test.step('the owner signs in with a code', async () => {
    await owner.goto(`${API}/`);
    await expect(owner).toHaveURL(/\/sign-in/);
    await expectAccessible(owner, 'sign in');
    await signInHere(owner, p.owner);
    await expect(switcher(owner)).toHaveAccessibleName(`${t('store.switch')}: ${p.storeName}`);
    await expectAccessible(owner, 'home');
  });

  await test.step('the owner invites someone', async () => {
    await owner.goto(`${API}/settings/staff`);
    await expect(owner.getByRole('heading', { name: t('settings.staff'), level: 1 })).toBeVisible();
    await expectAccessible(owner, 'staff');
    await owner.getByRole('button', { name: t('staff.invite') }).click();
    const dialog = owner.getByRole('dialog');
    await dialog.getByLabel(t('staff.email')).fill(p.staff);
    await dialog.getByLabel(t('staff.role')).selectOption('staff');
    await expectAccessible(owner, 'invite dialog');
    const before = await mailCount(p.staff);
    await dialog.getByRole('button', { name: t('staff.invite') }).click();
    await expect(owner.getByText(t('staff.invited', { email: p.staff }))).toBeVisible();
    const mail = await nextMail(p.staff, before);
    const link = /https?:\/\/\S+\/invite#t=[\w-]+/.exec(mail.text)?.[0];
    expect(link, 'invitation link').toBeTruthy();

    await test.step('and they accept after signing in', async () => {
      await invitee.goto(link as string);
      await expect(invitee).toHaveURL(/\/sign-in\?redirect=%2Finvite/);
      await signInHere(invitee, p.staff);
      await expect(switcher(invitee)).toHaveAccessibleName(`${t('store.switch')}: ${p.storeName}`);
    });
  });

  await test.step('the owner makes them a viewer', async () => {
    await owner.reload();
    const row = owner.getByRole('listitem').or(owner.getByRole('row')).filter({ hasText: p.staff });
    await row
      .locator('visible=true')
      .getByRole('button', { name: t('staff.changeRole') })
      .click();
    const dialog = owner.getByRole('dialog');
    await dialog.getByLabel(t('staff.role')).selectOption('viewer');
    await expectAccessible(owner, 'change role dialog');
    await dialog.getByRole('button', { name: t('action.save') }).click();
    await expect(owner.getByText(t('staff.roleChanged'))).toBeVisible();
    await expect(row.locator('visible=true').getByText(t('role.viewer'))).toBeVisible();
  });

  await test.step('the super admin sets up two-factor login', async () => {
    await signIn(admin, p.admin);
    await admin.goto(`${API}/platform`);
    await expect(admin.getByText(t('platform.twoFactorRequired'))).toBeVisible();
    await expectAccessible(admin, 'platform without two-factor');
    await admin.goto(`${API}/account`);
    await expectAccessible(admin, 'account');
    await admin.getByRole('button', { name: t('account.twoFactor.setUp') }).click();
    const secret = await admin.locator('code').innerText();
    await expectAccessible(admin, 'authenticator setup');
    await admin.getByLabel(t('twoFactor.code')).fill(totp(secret));
    await admin.getByRole('button', { name: t('account.twoFactor.enable') }).click();
    await expect(admin.getByText(t('account.twoFactor.enabled'))).toBeVisible();
    await admin.getByRole('button', { name: t('account.backupCodes.done') }).click();
  });

  await test.step('the super admin gives the owner a second store, and the owner switches', async () => {
    await admin.goto(`${API}/platform`);
    await expectAccessible(admin, 'platform stores');
    await admin.getByRole('button', { name: t('tenants.create') }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByLabel(t('tenants.slug')).fill(p.secondSlug);
    await dialog.getByLabel(t('store.name')).fill(p.secondName);
    await dialog.getByLabel(t('tenants.ownerEmail')).fill(p.owner);
    await dialog.getByLabel(t('tenants.ownerName')).fill('E2E Owner');
    await expectAccessible(admin, 'create store dialog');
    await dialog.getByRole('button', { name: t('tenants.create') }).click();
    await expect(admin.getByRole('heading', { name: p.secondName })).toBeVisible();

    await owner.goto(`${API}/`);
    await switcher(owner).click();
    await expectAccessible(owner, 'store switcher');
    // A store's button reads "<name> <role>"; one name is a prefix of the other.
    const storeButton = (name: string) =>
      owner.getByRole('dialog').getByRole('button', { name: `${name} ${t('role.owner')}` });
    await storeButton(p.secondName).click();
    await expect(switcher(owner)).toHaveAccessibleName(`${t('store.switch')}: ${p.secondName}`);
    await switcher(owner).click();
    await storeButton(p.storeName).click();
    await expect(switcher(owner)).toHaveAccessibleName(`${t('store.switch')}: ${p.storeName}`);
  });

  await test.step('the super admin suspends the store; the owner sees the banner and the 423', async () => {
    await admin.goto(`${API}/platform`);
    await admin.getByLabel(t('tenants.search')).fill(p.slug);
    await admin
      .getByRole('link', { name: p.storeName, exact: true })
      .locator('visible=true')
      .click();
    await expect(admin.getByRole('heading', { name: p.storeName })).toBeVisible();
    await expectAccessible(admin, 'store detail');
    await admin.getByRole('button', { name: t('tenant.suspend') }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByLabel(t('tenant.reason'), { exact: false }).fill('E2E suspension test');
    await dialog.getByLabel(t('confirm.typeToConfirm', { word: p.slug })).fill(p.slug);
    await expectAccessible(admin, 'suspend dialog');
    await dialog.getByRole('button', { name: t('tenant.suspend') }).click();
    await expect(admin.getByText(t('tenant.suspended', { name: p.storeName }))).toBeVisible();

    await owner.goto(`${API}/settings/store`);
    await expect(owner.getByText(t('banner.suspended', { store: p.storeName }))).toBeVisible();
    await expectAccessible(owner, 'store profile while suspended');
    await owner.getByLabel(t('store.city'), { exact: false }).fill('ঢাকা');
    // "Address (optional)", not "Address line 2 (optional)".
    await owner
      .getByRole('textbox', { name: `${t('store.addressLine1')} (${t('form.optional')})` })
      .fill('E2E');
    await owner.getByRole('button', { name: t('action.save') }).click();
    await expect(owner.getByText(t('error.suspended'))).toBeVisible();

    await admin.getByRole('button', { name: t('tenant.reactivate') }).click();
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: t('tenant.reactivate') })
      .click();
    await expect(admin.getByText(t('tenant.reactivated', { name: p.storeName }))).toBeVisible();
  });

  await test.step('the store answers on its storefront', async () => {
    const res = await owner.goto(`${STOREFRONT}/?store=${p.slug}`);
    expect(res?.status()).toBe(200);
    // A new store shows the default theme: its name is the title and the header's brand.
    await expect(owner).toHaveTitle(p.storeName);
    await expect(owner.getByRole('banner').getByRole('link', { name: p.storeName })).toBeVisible();
  });
});
