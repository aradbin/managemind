// The storefront flows on the preview (phase-3-plan §9): a shopper browses
// the demo stores' home, a category with filters and sorting, a product with
// the variant picker, search in English and in Bangla (a spelling variant), a
// static page, the language switch with hreflang, and a missing page. Axe on
// every page, at a phone and a desktop viewport. The demo catalog is seeded
// by the preview's database step (scripts/demo/catalog.ts); previews pick a
// store with ?store=, which a cookie then remembers. Each page type's own
// JavaScript is held to the 50 KB budget.
import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectAddedToCart, expectScriptBudget } from './helpers';
import { STOREFRONT } from './urls';

async function openStore(page: Page, store: string, path = '/') {
  const res = await page.goto(
    `${STOREFRONT}${path}${path.includes('?') ? '&' : '?'}store=${store}`,
  );
  expect(res?.status()).toBe(200);
}

/** Opens the filters where they fold away (the phone's sheet). */
async function openFilters(page: Page, label: string) {
  const details = page.locator('details.filters');
  if (!(await details.evaluate((d: HTMLDetailsElement) => d.open))) {
    await details.locator('summary', { hasText: label }).click();
  }
}

/** Applies ticked filters: on desktops they apply as they change, the phone's sheet has a button. */
async function applyFilters(page: Page, label: string) {
  const show = page.locator('details.filters').getByRole('button', { name: label });
  if (await show.isVisible()) await show.click();
}

test('browsing the English demo store', async ({ page }) => {
  await test.step('the home page', async () => {
    await openStore(page, 'demo-fashion');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('link[rel=alternate][hreflang=bn]')).toHaveAttribute('href', /\/bn$/);
    await expect(
      page.getByRole('link', { name: 'Red Jamdani saree', exact: true }).first(),
    ).toBeVisible();
    await expectAccessible(page, 'store home');
    await expectScriptBudget(page, 'the home page');
  });

  await test.step('a category, filtered to what is in stock and sorted by price', async () => {
    await page.goto(`${STOREFRONT}/categories/sarees`);
    await expect(page.getByRole('heading', { level: 1, name: 'Sarees' })).toBeVisible();
    await expect(page.getByText('3 products', { exact: true })).toBeVisible();
    await openFilters(page, 'Filters');
    await page.getByLabel('In stock only').check();
    await applyFilters(page, 'Show products');
    await expect(page).toHaveURL(/stock=1/);
    await expect(page.getByText('2 products', { exact: true })).toBeVisible();
    // What is applied shows as a chip that removes it.
    await expect(
      page
        .getByRole('navigation', { name: 'Applied filters' })
        .getByRole('link', { name: 'Remove In stock' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Yellow muslin saree', exact: true })).toHaveCount(
      0,
    );

    // With JavaScript the sort applies on change; its button is for no-JS visitors.
    await expect(page.locator('form.sorter').getByRole('button', { name: 'Apply' })).toBeHidden();
    await page.getByLabel('Sort by').selectOption('price_asc');
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
    const size = page.getByRole('radio', { name: 'L', exact: true });
    // Mid-screen: a store's chat buttons float over the bottom corner on phones.
    await size.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await size.check({ force: true });
    await expect(page.locator('[data-sku]')).toHaveText('FAS-WHITE-COTTON-PANJABI-3');
    await expect(page.locator('[data-stock]')).toHaveText('In stock, ready to ship');
    await expect(page.getByText('Size: L')).toBeVisible();
    await expect(page.locator('script[type="application/ld+json"]').first()).toBeAttached();
    await expectAccessible(page, 'product page');
    await expectScriptBudget(page, 'a product page');
    await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
    await expectAddedToCart(page);
    await expectAccessible(page, 'product page after Add to cart');
    // The desktop's mini-cart is a modal panel.
    await page.keyboard.press('Escape');
  });

  await test.step('search in English', async () => {
    const search = page.getByRole('search');
    await search.getByLabel('Search products').fill('saree');
    await search.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/search\?q=saree/);
    await expect(page.getByRole('link', { name: 'Red Jamdani saree', exact: true })).toBeVisible();
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
    // The top bar, the phone header and the footer each have it.
    await page.getByRole('link', { name: 'বাংলা' }).first().click();
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

test('adding from a card, and recently viewed products', async ({ page }) => {
  await test.step('Add to cart on a card adds it there', async () => {
    await openStore(page, 'demo-fashion', '/categories/sarees');
    const add = page.getByRole('button', { name: /^Add .+ to cart$/ }).first();
    await add.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await add.click();
    await expect(page.getByRole('status').filter({ hasText: 'Added · View cart' })).toBeVisible();
    await expect(page.locator('[data-cart-count]:visible').first()).not.toHaveText('');
  });

  await test.step('Choose options picks a size without leaving the list', async () => {
    await page.goto(`${STOREFRONT}/categories/panjabis`);
    const choose = page.getByRole('link', { name: 'Choose options for White cotton panjabi' });
    await choose.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await choose.click();
    const dialog = page.getByRole('dialog', { name: 'White cotton panjabi' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'L', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'L', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectAccessible(page, 'quick-add picker');
    await dialog.getByRole('button', { name: 'Add to cart' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('link', { name: 'Added · View cart' }).first()).toBeVisible();
  });

  await test.step('a product page lists the products viewed before it', async () => {
    await page.goto(`${STOREFRONT}/products/red-jamdani-saree`);
    await page.goto(`${STOREFRONT}/products/white-cotton-panjabi`);
    const recent = page.getByRole('region', { name: 'Recently viewed' });
    await expect(
      recent.getByRole('link', { name: 'Red Jamdani saree', exact: true }),
    ).toBeVisible();
    // Not the product on screen.
    await expect(
      recent.getByRole('link', { name: 'White cotton panjabi', exact: true }),
    ).toHaveCount(0);
    await expectAccessible(page, 'product page with recently viewed');
    await recent.getByRole('button', { name: 'Clear history' }).click();
    await expect(recent).toBeHidden();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Recently viewed' })).toBeHidden();
  });
});

test('searching the Bangla demo store with another spelling', async ({ page }) => {
  await openStore(page, 'demo-grocery');
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  const search = page.getByRole('search');
  // The product is "সিলেটি চা পাতা"; shoppers often type ী for ি.
  await search.getByLabel('পণ্য খুঁজুন').fill('সিলেটী চা');
  await search.getByRole('button', { name: 'খুঁজুন' }).click();
  await expect(page.getByRole('link', { name: 'সিলেটি চা পাতা', exact: true })).toBeVisible();
  await expectAccessible(page, 'Bangla search results');

  await page.goto(`${STOREFRONT}/search?q=${encodeURIComponent('কফি')}`);
  await expect(page.getByRole('link', { name: 'ইনস্ট্যান্ট কফি', exact: true })).toBeVisible();
});
