// The storefront flows on the preview (phase-3-plan §9): a shopper browses
// the demo stores' home, a category with filters and sorting, a product with
// the variant picker, search in English and in Bangla (a spelling variant), a
// static page, the language switch with hreflang, and a missing page. Axe on
// every page, at a phone and a desktop viewport. The demo catalog is seeded
// by the preview's database step (scripts/demo/catalog.ts); previews pick a
// store with ?store=, which a cookie then remembers. Each page type's own
// JavaScript is held to the 50 KB budget.
import { expect, type Page, test } from '@playwright/test';
import {
  answerConsent,
  expectAccessible,
  expectAddedToCart,
  expectScriptBudget,
  pickArea,
} from './helpers';
import { STOREFRONT } from './urls';

async function openStore(page: Page, store: string, path = '/') {
  const res = await page.goto(
    `${STOREFRONT}${path}${path.includes('?') ? '&' : '?'}store=${store}`,
  );
  expect(res?.status()).toBe(200);
  // A demo store with tracking tags asks for cookie consent first (a preview
  // database branched from production has the owner's tags).
  await answerConsent(page);
}

/** A listing's "N products" line, as a number. */
async function productCount(page: Page): Promise<number> {
  const text = await page.locator('main p.count').first().innerText();
  return Number(/\d+/.exec(text)?.[0] ?? Number.NaN);
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
    // The counts come from the store's stock, which a preview branched from
    // production doesn't share with the seed: the filter must give what its
    // own count said, and leave nothing sold out.
    expect(await productCount(page)).toBeGreaterThanOrEqual(2);
    await openFilters(page, 'Filters');
    const inStock = page.getByLabel('In stock only');
    const expected = Number(
      (await page.locator('label.check', { has: inStock }).locator('.n').innerText()).trim(),
    );
    await inStock.check();
    await applyFilters(page, 'Show products');
    await expect(page).toHaveURL(/stock=1/);
    await expect(page.locator('main p.count').first()).toHaveText(
      expected === 1 ? '1 product' : `${expected} products`,
    );
    // What is applied shows as a chip that removes it.
    await expect(
      page
        .getByRole('navigation', { name: 'Applied filters' })
        .getByRole('link', { name: 'Remove In stock' }),
    ).toBeVisible();
    await expect(page.locator('[data-listing-grid] .badge.out')).toHaveCount(0);

    // With JavaScript the sort applies on change; its button is for no-JS visitors.
    await expect(page.locator('form.sorter').getByRole('button', { name: 'Apply' })).toBeHidden();
    await page.getByLabel('Sort by').selectOption('price_asc');
    await expect(page).toHaveURL(/sort=price_asc/);
    // Cheapest first, whatever the store's prices are now.
    const prices = (
      await page.locator('[data-listing-grid] .price > span:first-child').allInnerTexts()
    ).map((p) => Number(p.replace(/[^\d]/g, '')));
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
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
    // The header's own search (the slim bar pinned on scroll has another).
    const search = page.getByRole('banner').getByRole('search');
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

test('the cart and checkout', async ({ page }) => {
  await openStore(page, 'demo-fashion', '/categories/sarees');
  const add = page.getByRole('button', { name: /^Add .+ to cart$/ }).first();
  await add.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await add.click();
  await expect(page.getByRole('status').filter({ hasText: 'Added · View cart' })).toBeVisible();

  await test.step('the cart', async () => {
    await page.goto(`${STOREFRONT}/cart`);
    await expect(page.getByRole('heading', { level: 2, name: 'Order summary' })).toBeVisible();
    await expect(page.getByText('1 item', { exact: true })).toBeVisible();
    await expectAccessible(page, 'cart');
  });

  await test.step('checkout: problems listed, then the area found by typing', async () => {
    await page.goto(`${STOREFRONT}/checkout`);
    await expect(page.getByText('Secure checkout')).toBeVisible();
    // The pay bar's button on phones, the summary's on desktops: the same one.
    await page.getByRole('button', { name: 'Place order' }).click();
    const problems = page.getByRole('alert').filter({ hasText: 'Please check these:' });
    await expect(problems.getByRole('link', { name: /^Mobile number:/ })).toBeVisible();
    await expect(page.locator('#c-phone')).toBeFocused();
    await expectAccessible(page, 'checkout with problems');
    await pickArea(page, { name: 'Dhanm', id: 513 });
    await expect(page.locator('[data-area-chosen]')).toContainText('Dhanmondi');
  });
});

// The states the store or the server can put checkout in
// (design/storefront-redesign: Checkout's scenarios). The demo stores stay
// open and serve everywhere for the other tests, so the API's answers are
// stood in for here; the answers themselves are tested in the API's suite.
test('checkout when the store or the server says no', async ({ page }) => {
  await openStore(page, 'demo-fashion', '/categories/sarees');
  const add = page.getByRole('button', { name: /^Add .+ to cart$/ }).first();
  await add.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await add.click();
  await expect(page.getByRole('status').filter({ hasText: 'Added · View cart' })).toBeVisible();
  await page.goto(`${STOREFRONT}/checkout`);
  await page.locator('#c-phone').fill('01711000123');
  await page.locator('#c-name').fill('Test Shopper');
  await page.locator('#c-line').fill('House 1, Road 2');
  const orders = '**/api/checkout/orders*';

  await test.step('an area the store does not serve, as soon as it is picked', async () => {
    await page.route('**/api/cart/area*', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), zone: null } });
    });
    await pickArea(page, { name: 'Dhanm', id: 513 });
    await expect(page.locator('#c-area-e')).toHaveText('The store doesn’t deliver to this area.');
    await expect(page.locator('[data-delivery-note]')).toContainText(
      'Ask the store whether they can deliver here',
    );
    await page.unroute('**/api/cart/area*');
    await page.getByRole('button', { name: 'Change' }).click();
    await pickArea(page, { name: 'Dhanm', id: 513 });
    await expect(page.locator('[data-delivery-note]')).toContainText('Delivery in about');
    await expect(page.locator('#c-area-e')).toBeEmpty();
  });

  await test.step('prices changed: the new total, the line marked', async () => {
    await page.route(orders, (r) => r.fulfill({ status: 409, json: { code: 'price_changed' } }));
    await page.route('**/api/cart?*', async (route) => {
      const res = await route.fetch();
      const cart = await res.json();
      cart.lines[0].unitPrice += 5000;
      await route.fulfill({ response: res, json: cart });
    });
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Prices changed' })).toBeFocused();
    await expect(page.getByText(/^Was ৳[\d,]+, now ৳[\d,]+$/)).toBeVisible();
    await page.unroute('**/api/cart?*');
    await page.unroute(orders);
  });

  await test.step('the phone code: a dialog that confirms by itself', async () => {
    await page.route(orders, (r) => r.fulfill({ status: 403, json: { code: 'otp_required' } }));
    await page.route('**/api/checkout/otp?*', (r) => r.fulfill({ json: { sent: true } }));
    await page.route('**/api/checkout/otp/verify*', (r) =>
      r.fulfill({ json: { otpToken: 'token' } }),
    );
    await page.getByRole('button', { name: 'Place order' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm your mobile number' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('01711-000123')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Send a new code in 0:4\d$/ })).toBeDisabled();
    await expectAccessible(page, 'checkout asking for the phone code');
    await page.unroute(orders);
    // The order goes again with the token; this time the store has paused.
    let token: unknown;
    await page.route(orders, (r) => {
      token = r.request().postDataJSON().otpToken;
      return r.fulfill({ status: 503, json: { code: 'checkout_paused' } });
    });
    await dialog.getByLabel('6-digit code').pressSequentially('123456');
    await expect(dialog).toBeHidden();
    await expect.poll(() => token).toBe('token');
  });

  await test.step('the store paused: the form gives way to a panel', async () => {
    await expect(
      page.getByRole('heading', { name: 'The store is not taking orders right now.' }),
    ).toBeVisible();
    await expect(page.locator('[data-checkout]')).toBeHidden();
    await expect(page.getByRole('link', { name: 'Back to cart' }).last()).toBeVisible();
    await expectAccessible(page, 'checkout paused');
    await page.unroute(orders);
  });
});

test('the slim bar pinned on scroll, and search suggestions', async ({ page }) => {
  await openStore(page, 'demo-fashion', '/categories/sarees');
  const pinned = page.locator('[data-pinned]');
  await expect(pinned).toBeHidden();
  await page.mouse.wheel(0, 1200);
  await expect(pinned).toBeVisible();
  // Its menu button goes back up and opens All categories.
  await pinned.getByRole('button', { name: 'All categories' }).click();
  await expect(page.locator('#site-menu')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');

  const search = page.getByRole('banner').getByRole('search');
  await search.getByLabel('Search products').fill('sar');
  const list = page.getByRole('listbox', { name: 'Suggestions' });
  await expect(list.getByRole('option', { name: 'Sarees' })).toBeVisible();
  await expect(list.getByRole('option', { name: 'See all results for “sar”' })).toBeVisible();
  await expectAccessible(page, 'search suggestions');
});

test('searching the Bangla demo store with another spelling', async ({ page }) => {
  await openStore(page, 'demo-grocery');
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  // The header's own search (the slim bar pinned on scroll has another).
  const search = page.getByRole('banner').getByRole('search');
  // The product is "সিলেটি চা পাতা"; shoppers often type ী for ি.
  await search.getByLabel('পণ্য খুঁজুন').fill('সিলেটী চা');
  await search.getByRole('button', { name: 'খুঁজুন' }).click();
  await expect(page.getByRole('link', { name: 'সিলেটি চা পাতা', exact: true })).toBeVisible();
  await expectAccessible(page, 'Bangla search results');

  await page.goto(`${STOREFRONT}/search?q=${encodeURIComponent('কফি')}`);
  await expect(page.getByRole('link', { name: 'ইনস্ট্যান্ট কফি', exact: true })).toBeVisible();

  // Banglish: the same product typed in Latin letters, however spelled.
  for (const q of ['sileti cha', 'shileti cha pata']) {
    await page.goto(`${STOREFRONT}/search?q=${encodeURIComponent(q)}`);
    await expect(page.getByRole('link', { name: 'সিলেটি চা পাতা', exact: true })).toBeVisible();
  }
  // Nothing found: the store's own spelling, offered.
  await page.goto(`${STOREFRONT}/search?q=${encodeURIComponent('ইনস্টেন্ট কফি')}`);
  await page.getByRole('link', { name: 'ইনস্ট্যান্ট কফি', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ইনস্ট্যান্ট কফি');
  // The header suggests a category from Banglish too.
  const field = page.getByRole('banner').getByRole('combobox');
  await field.fill('chal');
  await expect(page.getByRole('option', { name: 'চাল ও ডাল' })).toBeVisible();
});
