// The Phase 2 flows on the preview (phase-2-plan §8): the owner creates a
// product, writes its description in the formatted editor (Bangla), makes
// size variants, adds stock, files it in a category, imports a spreadsheet
// and exports the catalog. Runs after the Phase 1 flows, on the same store,
// at each viewport, with axe on every screen.
import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn, t } from './helpers';
import { DEV_TOKEN, people, RUN } from './people';
import { API } from './urls';

test.skip(!RUN || !DEV_TOKEN, 'needs a seeded preview: E2E_RUN and DEV_TOKEN');
test.describe.configure({ mode: 'serial', timeout: 240_000 });

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test('catalog flows', async ({ page }, info) => {
  const p = people(info.project.name.replace(/^catalog-/, ''));
  const title = `জামদানি শাড়ি ${RUN}`;
  const category = `শাড়ি ${RUN}`;

  await test.step('the owner sees an empty catalog', async () => {
    await signIn(page, p.owner);
    await page.goto(`${API}/products`);
    await expect(
      page.getByRole('heading', { name: t('catalog.products'), level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(t('products.empty'))).toBeVisible();
    await expectAccessible(page, 'empty product list');
  });

  await test.step('they create a product with a price', async () => {
    await page
      .getByRole('link', { name: t('products.new') })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: t('products.new'), level: 1 })).toBeVisible();
    await expectAccessible(page, 'new product');
    await page.getByLabel(t('product.titleIn', { language: 'বাংলা' }), { exact: true }).fill(title);
    await page.getByLabel(t('product.price')).fill('৳১,২৫০');
    await page.getByRole('button', { name: t('products.create') }).click();
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  });

  await test.step('they write the description in the formatted editor', async () => {
    const editor = page.getByRole('textbox', { name: new RegExp(`^${t('product.description')}`) });
    await editor.click();
    await page.keyboard.type('হাতে বোনা ');
    await page.getByRole('button', { name: t('editor.bold'), exact: true }).click();
    await page.keyboard.type('ঢাকাই');
    await page.getByRole('button', { name: t('editor.bold'), exact: true }).click();
    await page.keyboard.type(' জামদানি।');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: t('editor.bulletList'), exact: true }).click();
    await page.keyboard.type('সুতি');
    await expect(editor.locator('strong')).toHaveText('ঢাকাই');
    await expect(editor.locator('li')).toHaveText('সুতি');
    await page.getByLabel(t('status.active'), { exact: false }).check();
    await expectAccessible(page, 'product editor');
    await page.getByRole('button', { name: t('product.save') }).click();
    await expect(toast(page, t('product.saved'))).toBeVisible();

    // What was saved comes back the same after a reload.
    await page.reload();
    await expect(editor.locator('strong')).toHaveText('ঢাকাই');
    await expect(editor.locator('li')).toHaveText('সুতি');
  });

  await test.step('they add sizes, which make variants', async () => {
    await page.getByRole('button', { name: t('options.add') }).click();
    const option = page.getByRole('group', { name: t('options.option', { n: '১' }) });
    await option.getByLabel(`${t('options.name')} (বাংলা)`).fill('সাইজ');
    for (const size of ['ছোট', 'বড়']) {
      await option.getByLabel(t('options.newValue')).fill(size);
      await option.getByRole('button', { name: t('options.addValue') }).click();
    }
    await expectAccessible(page, 'options');
    await page.getByRole('button', { name: t('options.save') }).click();
    await expect(toast(page, t('options.saved', { count: '২' }))).toBeVisible();
    await expect(
      page.getByText('বড়', { exact: true }).locator('visible=true').first(),
    ).toBeVisible();
  });

  await test.step('they receive stock', async () => {
    await page.goto(`${API}/inventory`);
    await expect(
      page.getByRole('heading', { name: t('catalog.inventory'), level: 1 }),
    ).toBeVisible();
    await expectAccessible(page, 'inventory');
    await page
      .getByRole('button', { name: t('inventory.adjust'), exact: true })
      .locator('visible=true')
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(t('inventory.mode.received')).check();
    await dialog.getByLabel(t('inventory.quantity')).fill('১২');
    await expectAccessible(page, 'adjust stock');
    await dialog.getByRole('button', { name: t('action.save') }).click();
    await expect(toast(page, t('inventory.adjusted'))).toBeVisible();
  });

  await test.step('they make a category and file the product in it', async () => {
    await page.goto(`${API}/catalog/categories`);
    await expect(
      page.getByRole('heading', { name: t('catalog.categories'), level: 1 }),
    ).toBeVisible();
    await page.getByRole('button', { name: t('categories.new') }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(t('categories.name'), { exact: false }).first().fill(category);
    await expectAccessible(page, 'new category');
    await dialog.getByRole('button', { name: t('action.save') }).click();
    await expect(toast(page, t('categories.saved'))).toBeVisible();
    await expectAccessible(page, 'categories');

    await page.goto(`${API}/products`);
    await page.getByRole('link', { name: title }).locator('visible=true').first().click();
    await page
      .getByRole('group', { name: t('catalog.categories') })
      .getByLabel(category)
      .check();
    await page.getByRole('button', { name: t('product.save') }).click();
    await expect(toast(page, t('product.saved'))).toBeVisible();
  });

  await test.step('they import a spreadsheet', async () => {
    await page.goto(`${API}/catalog/import`);
    await expect(page.getByRole('heading', { name: t('catalog.import'), level: 1 })).toBeVisible();
    await expectAccessible(page, 'import');
    const csv = [
      'Title (bn),Price,SKU,Option 1 name (bn),Option 1 value (bn),Stock',
      `টাঙ্গাইল শাড়ি ${RUN},1800,TS-${RUN}-1,রং,লাল,5`,
      `টাঙ্গাইল শাড়ি ${RUN},1800,TS-${RUN}-2,রং,নীল,3`,
      `পাঞ্জাবি ${RUN},950,PJ-${RUN},,,7`,
    ].join('\n');
    await page.getByLabel(t('import.chooseFile')).setInputFiles({
      name: 'products.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await expect(page.getByText(t('import.mappingIntro'))).toBeVisible();
    await expectAccessible(page, 'import mapping');
    await page.getByRole('button', { name: t('import.check') }).click();
    await expect(page.getByText(t('import.ready', { products: '২', variants: '৩' }))).toBeVisible();
    await expectAccessible(page, 'import dry run');
    await page.getByRole('button', { name: t('import.start', { count: '২' }) }).click();
    await expect(page.getByText(t('import.status.done'))).toBeVisible({ timeout: 60_000 });
    await expectAccessible(page, 'import done');
    await page.getByRole('link', { name: t('import.seeProducts') }).click();
    await expect(
      page.getByRole('link', { name: `পাঞ্জাবি ${RUN}` }).locator('visible=true'),
    ).toBeVisible();
    await expectAccessible(page, 'product list');
  });

  await test.step('they export the catalog', async () => {
    await page.getByRole('button', { name: t('export.button') }).click();
    await expectAccessible(page, 'export dialog');
    const download = page.waitForEvent('download');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('export.csv') })
      .click();
    const file = await download;
    const text = await (await file.createReadStream()).toArray();
    const csv = Buffer.concat(text as Buffer[]).toString('utf8');
    expect(csv).toContain(title);
    expect(csv).toContain(`TS-${RUN}-2`);
    expect(csv).toContain('**ঢাকাই**');
  });
});
