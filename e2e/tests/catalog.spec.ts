// The Phase 2 flows on the preview (phase-2-plan §8): the owner creates an
// attribute and puts it in a category's template, gives the brand a value,
// creates a product in both languages (formatted description, category,
// specifications, brand, tags), uploads a photo, makes size variants, adds
// stock, imports a spreadsheet and exports the catalog. At the desktop
// viewport the import is the 500-product fixture; at the phone viewport a
// small file, to keep queue use down. Runs after the Phase 1 flows, on the
// same store, with axe on every screen.
import { expect, type Page, test } from '@playwright/test';
import { en } from '../../apps/admin/src/i18n/en';
import { fixtureCsv } from './catalog-fixture';
import { expectAccessible, pngImage, signIn, t } from './helpers';
import { DEV_TOKEN, people, RUN } from './people';
import { API } from './urls';

test.skip(!RUN || !DEV_TOKEN, 'needs a seeded preview: E2E_RUN and DEV_TOKEN');
test.describe.configure({ mode: 'serial', timeout: 600_000 });

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const visible = (page: Page, name: string) =>
  page.getByRole('link', { name, exact: true }).locator('visible=true').first();

test('catalog flows', async ({ page }, info) => {
  const viewport = info.project.name.replace(/^catalog-/, '');
  const p = people(viewport);
  const title = `জামদানি শাড়ি ${RUN}`;
  const titleEn = `Jamdani saree ${RUN}`;
  const category = `শাড়ি ${RUN}`;
  const parent = `পোশাক ${RUN}`;
  const big = viewport === 'desktop';

  await test.step('the owner sees an empty catalog', async () => {
    await signIn(page, p.owner);
    await page.goto(`${API}/products`);
    await expect(
      page.getByRole('heading', { name: t('catalog.products'), level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(t('products.empty'))).toBeVisible();
    await expectAccessible(page, 'empty product list');
  });

  await test.step('they create an attribute and give the brand a value', async () => {
    await page.goto(`${API}/catalog/attributes`);
    await expect(
      page.getByRole('heading', { name: t('catalog.attributes'), level: 1 }),
    ).toBeVisible();
    await page.getByRole('button', { name: t('attributes.new') }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel(`${t('attributes.name')} (বাংলা)`).fill('কাপড়');
    await dialog.getByLabel(t('attributes.key')).fill('fabric');
    await dialog.getByLabel(t('attributes.type')).selectOption('choice');
    for (const value of ['সুতি', 'সিল্ক']) {
      await dialog.getByLabel(t('attributes.newValue')).fill(value);
      await dialog.getByRole('button', { name: t('options.addValue') }).click();
    }
    await expectAccessible(page, 'new attribute');
    await dialog.getByRole('button', { name: t('action.save') }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page, t('attributes.saved')).first()).toBeVisible();
    await expectAccessible(page, 'attributes');

    await page
      .getByRole('button', { name: t('attribute.brand'), exact: true })
      .locator('visible=true')
      .first()
      .click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel(t('attributes.newValue')).fill('আড়ং');
    await dialog.getByRole('button', { name: t('options.addValue') }).click();
    await dialog.getByRole('button', { name: t('action.save') }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page, t('attributes.saved')).first()).toBeVisible();
  });

  await test.step('they make a category whose products have a fabric', async () => {
    await page.goto(`${API}/catalog/categories`);
    await expect(
      page.getByRole('heading', { name: t('catalog.categories'), level: 1 }),
    ).toBeVisible();
    await page.getByRole('button', { name: t('categories.new') }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel(t('categories.name'), { exact: false }).first().fill(category);
    await expectAccessible(page, 'new category');
    await dialog.getByRole('button', { name: t('action.save') }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page, t('categories.saved'))).toBeVisible();
    await expectAccessible(page, 'categories');

    await page
      .getByRole('button', { name: t('categories.template', { count: '০' }) })
      .locator('visible=true')
      .first()
      .click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('কাপড়').check();
    await expectAccessible(page, 'category specifications');
    await dialog.getByRole('button', { name: t('action.save') }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page, t('categories.templateSaved'))).toBeVisible();

    // A second category, and the first moved under it.
    await page.getByRole('button', { name: t('categories.new') }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel(t('categories.name'), { exact: false }).first().fill(parent);
    await dialog.getByRole('button', { name: t('action.save') }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: t('categories.edit', { name: category }) }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel(t('categories.parent')).selectOption({ label: parent });
    await expectAccessible(page, 'edit category');
    await dialog.getByRole('button', { name: t('action.save') }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step('they create a product with a price', async () => {
    await page.goto(`${API}/products`);
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

  const editor = page.getByRole('textbox', { name: new RegExp(`^${t('product.description')}`) });

  await test.step('they describe it in both languages and organize it', async () => {
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

    await page.getByRole('tab', { name: /^English/ }).click();
    await page
      .getByRole('button', { name: t('product.addTranslation', { language: 'English' }) })
      .click();
    await page.getByLabel(t('product.titleIn', { language: 'English' })).fill(titleEn);

    await page.getByLabel(t('status.active'), { exact: false }).check();
    // Listed with its path, now that it sits under the other category.
    await page
      .getByRole('group', { name: t('catalog.categories') })
      .getByLabel(`${parent} › ${category}`)
      .check();
    // The category's template brings the fabric; the brand is added by hand.
    await page.getByLabel('কাপড়', { exact: true }).selectOption({ label: 'সুতি' });
    await page.getByLabel(t('specs.add')).selectOption({ label: t('attribute.brand') });
    await page.getByLabel(t('attribute.brand'), { exact: true }).selectOption({ label: 'আড়ং' });
    const tags = page.getByRole('combobox', { name: new RegExp(`^${t('product.tags')}`) });
    await tags.fill('ঈদ');
    await tags.press('Enter');
    await expectAccessible(page, 'product editor');
    await page.getByRole('button', { name: t('product.save') }).click();
    await expect(toast(page, t('product.saved'))).toBeVisible();

    // What was saved comes back the same after a reload.
    await page.reload();
    await expect(editor.locator('strong')).toHaveText('ঢাকাই');
    await expect(editor.locator('li')).toHaveText('সুতি');
    await expect(page.getByLabel('কাপড়', { exact: true })).toHaveValue(/.+/);
    await expect(page.getByLabel(t('attribute.brand'), { exact: true })).toHaveValue(/.+/);
    await expect(page.getByText('ঈদ', { exact: true })).toBeVisible();
  });

  await test.step('they upload a photo', async () => {
    await page
      .getByRole('region', { name: t('images.title') })
      .locator('input[type=file]')
      .setInputFiles({
        name: 'saree.png',
        mimeType: 'image/png',
        buffer: pngImage(1600, 1200, [180, 40, 60]),
      });
    const alt = page.getByLabel(t('images.alt', { n: '১', language: 'বাংলা' }));
    await expect(alt).toBeVisible({ timeout: 30_000 });
    await alt.fill('লাল জামদানি শাড়ি');
    await expect(page.getByRole('img', { name: 'লাল জামদানি শাড়ি' })).toBeVisible();
    await expectAccessible(page, 'images');
    await page.getByRole('button', { name: t('images.save') }).click();
    await expect(toast(page, t('images.saved'))).toBeVisible();
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
    await expect(dialog).toBeHidden();
    await expect(toast(page, t('inventory.adjusted'))).toBeVisible();
  });

  await test.step(
    big ? 'they import the 500-product file' : 'they import a spreadsheet',
    async () => {
      await page.goto(`${API}/catalog/import`);
      await expect(
        page.getByRole('heading', { name: t('catalog.import'), level: 1 }),
      ).toBeVisible();
      await expectAccessible(page, 'import');
      const csv = big
        ? fixtureCsv(500, `FX${RUN}`)
        : [
            'Title (bn),Price,SKU,Option 1 name (bn),Option 1 value (bn),Stock',
            `টাঙ্গাইল শাড়ি ${RUN},1800,TS-${RUN}-1,রং,লাল,5`,
            `টাঙ্গাইল শাড়ি ${RUN},1800,TS-${RUN}-2,রং,নীল,3`,
            `পাঞ্জাবি ${RUN},950,PJ-${RUN},,,7`,
          ].join('\n');
      await page.locator('input[type=file]').setInputFiles({
        name: 'products.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      });
      await expect(page.getByText(t('import.mappingIntro'))).toBeVisible();
      await expectAccessible(page, 'import mapping');
      if (big) {
        // The fixture's other attributes don't exist yet; the wizard creates them.
        const create = {
          occasion: 'multi_choice',
          weight_kg: 'number',
          care: 'text',
          handmade: 'boolean',
        } as const;
        for (const [key, type] of Object.entries(create)) {
          await page
            .locator('span', { hasText: t('import.unknownAttribute', { key }) })
            .getByRole('button', {
              name: t('import.createAs', { type: t(`attributes.type.${type}`) }),
            })
            .click();
          await expect(page.getByText(t('import.unknownAttribute', { key }))).toBeHidden();
        }
      }
      await page.getByRole('button', { name: t('import.check') }).click();
      const [products, variants] = big ? ['৫০০', '১,৫০০'] : ['২', '৩'];
      await expect(page.getByText(t('import.ready', { products, variants }))).toBeVisible();
      await expectAccessible(page, 'import dry run');
      await page.getByRole('button', { name: t('import.start', { count: products }) }).click();
      await expect(page.getByText(t('import.status.done'))).toBeVisible({ timeout: 300_000 });
      await expectAccessible(page, 'import done');
      await page.getByRole('link', { name: t('import.seeProducts') }).click();
      const imported = big ? 'ফিক্সচার পাঞ্জাবি ৭' : `পাঞ্জাবি ${RUN}`;
      await page.getByLabel(t('products.search')).fill(imported);
      await expect(visible(page, imported)).toBeVisible();
      await expectAccessible(page, 'product list');
    },
  );

  if (big) {
    await test.step('the imported products read in English too', async () => {
      await page.getByRole('button', { name: t('language.switch') }).click();
      await page.getByLabel(en['products.search']).fill('Fixture Panjabi 7');
      await expect(visible(page, 'Fixture Panjabi 7')).toBeVisible();
      await expectAccessible(page, 'product list in English');
      await page.getByRole('button', { name: en['language.switch'] }).click();
    });
  }

  await test.step('they export the catalog', async () => {
    await page.goto(`${API}/products`);
    await page.getByRole('button', { name: t('export.button') }).click();
    await expectAccessible(page, 'export dialog');
    const download = page.waitForEvent('download');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('export.csv') })
      .click();
    const file = await download;
    const chunks = await (await file.createReadStream()).toArray();
    const csv = Buffer.concat(chunks as Buffer[]).toString('utf8');
    expect(csv).toContain(title);
    expect(csv).toContain(titleEn);
    expect(csv).toContain('**ঢাকাই**');
    expect(csv).toContain('আড়ং');
    if (big) {
      // Every variant of the fixture, and its products in both languages.
      expect(csv.match(new RegExp(`\\bFX${RUN}-\\d+-\\d\\b`, 'g'))?.length).toBe(1_500);
      expect(csv).toContain('Fixture Panjabi 499');
      expect(csv).toContain('ফিক্সচার পাঞ্জাবি ৪৯৯');
    } else {
      expect(csv).toContain(`TS-${RUN}-2`);
    }
  });

  if (!big) {
    await test.step('an exported Excel file imports back as updates', async () => {
      await page.getByRole('button', { name: t('export.button') }).click();
      const download = page.waitForEvent('download');
      await page
        .getByRole('dialog')
        .getByRole('button', { name: t('export.xlsx') })
        .click();
      const chunks = await (await (await download).createReadStream()).toArray();
      const xlsx = Buffer.concat(chunks as Buffer[]);

      await page.goto(`${API}/catalog/import`);
      await page.locator('input[type=file]').setInputFiles({
        name: 'products.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: xlsx,
      });
      await expect(page.getByText(t('import.mappingIntro'))).toBeVisible();
      await page.getByRole('button', { name: t('import.check') }).click();
      await expect(
        page.getByText(t('import.ready', { products: '৩', variants: '৫' })),
      ).toBeVisible();
      await page.getByRole('button', { name: t('import.start', { count: '৩' }) }).click();
      await expect(page.getByText(t('import.status.done'))).toBeVisible({ timeout: 120_000 });
      await expect(
        page.getByText(t('import.counts', { created: '০', updated: '৩', failed: '০' })).first(),
      ).toBeVisible();
    });
  }
});
