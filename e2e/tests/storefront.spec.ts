// The storefront flows on the preview (phase-3-plan §9): a shopper browses
// the demo stores' home, a category with filters and sorting, a product with
// the variant picker, search in English and in Bangla (a spelling variant), a
// static page, the language switch with hreflang, and a missing page. Axe on
// every page, at a phone and a desktop viewport. The demo catalog is seeded
// by the preview's database step (scripts/demo/catalog.ts); previews pick a
// store with ?store=, which a cookie then remembers. Each page type's own
// JavaScript is held to the 50 KB budget.
import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectScriptBudget } from './helpers';
import { STOREFRONT } from './urls';

async function openStore(page: Page, store: string, path = '/') {
  const res = await page.goto(
    `${STOREFRONT}${path}${path.includes('?') ? '&' : '?'}store=${store}`,
  );
  expect(res?.status()).toBe(200);
}

/** Opens the filters where they fold away (phones). */
async function openFilters(page: Page, label: string) {
  const details = page.locator('details.filters');
  if (!(await details.evaluate((d: HTMLDetailsElement) => d.open))) {
    await details.locator('summary', { hasText: label }).click();
  }
}

test('browsing the English demo store', async ({ page }) => {
  await test.step('the home page', async () => {
    await openStore(page, 'demo-fashion');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('link[rel=alternate][hreflang=bn]')).toHaveAttribute('href', /\/bn$/);
    await expect(page.getByRole('link', { name: 'Red Jamdani saree' }).first()).toBeVisible();
    await expectAccessible(page, 'store home');
    await expectScriptBudget(page, 'the home page');
  });

  await test.step('a category, filtered to what is in stock and sorted by price', async () => {
    await page.goto(`${STOREFRONT}/categories/sarees`);
    await expect(page.getByRole('heading', { level: 1, name: 'Sarees' })).toBeVisible();
    await expect(page.getByText('3 products')).toBeVisible();
    await openFilters(page, 'Filters');
    await page.getByLabel('In stock only').check();
    await page.locator('details.filters').getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/stock=1/);
    await expect(page.getByText('2 products')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Yellow muslin saree' })).toHaveCount(0);

    await page.getByLabel('Sort by').selectOption('price_asc');
    await page.locator('form.sorter').getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/sort=price_asc/);
    await expect(page.locator('main .card-title').first()).toHaveText(/Blue cotton saree/);
    await expectAccessible(page, 'category with filters');
    await expectScriptBudget(page, 'a category');
  });

  await test.step('a product, choosing a size', async () => {
    await page.goto(`${STOREFRONT}/products/white-cotton-panjabi`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'White cotton panjabi' }),
    ).toBeVisible();
    await expect(page.locator('[data-sku]')).toHaveText('FAS-WHITE-COTTON-PANJABI-1');
    await page.getByRole('radio', { name: 'L', exact: true }).check({ force: true });
    await expect(page.locator('[data-sku]')).toHaveText('FAS-WHITE-COTTON-PANJABI-3');
    await expect(page.locator('[data-stock]')).toHaveText('In stock');
    await expect(page.locator('script[type="application/ld+json"]').first()).toBeAttached();
    await expectAccessible(page, 'product page');
    await expectScriptBudget(page, 'a product page');
  });

  await test.step('search in English', async () => {
    const search = page.getByRole('search');
    await search.getByLabel('Search products').fill('saree');
    await search.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/search\?q=saree/);
    await expect(page.getByRole('link', { name: 'Red Jamdani saree' })).toBeVisible();
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
    await expectAccessible(page, 'search results');
  });

  await test.step('a static page', async () => {
    await page.goto(`${STOREFRONT}/pages/about-us`);
    await expect(page.getByRole('heading', { level: 1, name: 'About us' })).toBeVisible();
    await expectAccessible(page, 'static page');
  });

  await test.step('the language switch keeps the page', async () => {
    await page.goto(`${STOREFRONT}/products/red-jamdani-saree`);
    await page.getByRole('link', { name: 'বাংলা' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
    await expect(page).toHaveURL(/\/bn\/products\//);
    await expect(page.getByRole('heading', { level: 1, name: 'লাল জামদানি শাড়ি' })).toBeVisible();
    await expect(page.locator('link[rel=alternate][hreflang=en]')).toHaveAttribute(
      'href',
      /\/products\/red-jamdani-saree$/,
    );
    await expectAccessible(page, 'product page in Bangla');
  });

  await test.step('a missing product is a 404 with the store around it', async () => {
    const res = await page.goto(`${STOREFRONT}/products/no-such-product`);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expectAccessible(page, 'not found');
  });
});

test('searching the Bangla demo store with another spelling', async ({ page }) => {
  await openStore(page, 'demo-grocery');
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  const search = page.getByRole('search');
  // The product is "সিলেটি চা পাতা"; shoppers often type ী for ি.
  await search.getByLabel('পণ্য খুঁজুন').fill('সিলেটী চা');
  await search.getByRole('button', { name: 'খুঁজুন' }).click();
  await expect(page.getByRole('link', { name: 'সিলেটি চা পাতা' })).toBeVisible();
  await expectAccessible(page, 'Bangla search results');

  await page.goto(`${STOREFRONT}/search?q=${encodeURIComponent('কফি')}`);
  await expect(page.getByRole('link', { name: 'ইনস্ট্যান্ট কফি' })).toBeVisible();
});
