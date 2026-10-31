// The Phase 8 back office flows (phase-8-plan §10), on the run's own store
// after the courier flows: the owner adds a supplier, writes a purchase
// order in the editor, picking its products, places it and receives it in two parts, paying for the first on the spot, then
// sees the stock, the cost and the supplier's balance; counts two variants
// by tag while an order ships one of them, and applies only the real
// difference; records an expense with a receipt photo and a monthly rent;
// and opens the profit report and exports it to Excel. Axe on every new
// screen, at a phone and a desktop viewport.
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { boReportsBn } from '../../apps/admin/src/i18n/back-office-reports-bn';
import { bn } from '../../apps/admin/src/i18n/bn';
import { expensesBn } from '../../apps/admin/src/i18n/expenses-bn';
import { ordersBn } from '../../apps/admin/src/i18n/orders-bn';
import { purchasingBn } from '../../apps/admin/src/i18n/purchasing-bn';
import { expectAccessible, pngImage, signIn } from './helpers';
import { DEV_TOKEN, people, RUN } from './people';
import { API } from './urls';

test.skip(!RUN || !DEV_TOKEN, 'needs a seeded preview: E2E_RUN and DEV_TOKEN');
test.describe.configure({ mode: 'serial', timeout: 300_000 });

const adminMessages = { ...bn, ...ordersBn, ...purchasingBn, ...expensesBn, ...boReportsBn };
type AdminKey = keyof typeof adminMessages;

function m(key: AdminKey, params: Record<string, string> = {}): string {
  return adminMessages[key].replace(/\{(\w+)\}/g, (s, name: string) => params[name] ?? s);
}

const pattern = (text: string) =>
  new RegExp(
    text
      .split(/\{\w+\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.+'),
  );

const toast = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text });

async function adminCall<T>(
  request: APIRequestContext,
  method: 'get' | 'post' | 'patch' | 'put',
  path: string,
  data?: unknown,
): Promise<T> {
  const send = () =>
    request[method](`${API}${path}`, {
      ...(data === undefined ? {} : { data }),
      headers: { origin: API, 'idempotency-key': crypto.randomUUID() },
    });
  let res = await send();
  // A preview's direct connection sometimes answers an empty 503 (phase-5b-report §3).
  for (let i = 0; method === 'get' && res.status() === 503 && i < 2; i++) res = await send();
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

const DHAKA = { division: 6, district: 47, area: 513 };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());

test('back office', async ({ page }, info) => {
  const viewport = info.project.name.replace(/^back-office-/, '');
  const p = people(viewport);
  const stamp = `${String(Date.now()).slice(-7)}${viewport === 'phone' ? '5' : '6'}`;
  const tag = `e2e-count-${stamp}`;
  const supplierName = `ই২ই সরবরাহকারী ${stamp}`;
  const variants: string[] = [];
  const titles: string[] = [];
  let poId = '';
  let supplierId = '';

  await test.step('the owner adds a supplier and places a purchase order', async () => {
    await signIn(page, p.owner);
    const me = (await (await page.request.get(`${API}/v1/admin/me`)).json()) as {
      stores: { tenantId: string; slug: string }[];
    };
    const tenantId = me.stores.find((x) => x.slug === p.slug)?.tenantId;
    await adminCall(page.request, 'put', '/v1/admin/me/active-store', { tenantId });
    for (const [i, title] of ['লুঙ্গি', 'গামছা'].entries()) {
      const created = await adminCall<{ variants: { id: string }[] }>(
        page.request,
        'post',
        '/v1/admin/products',
        {
          status: 'active',
          translations: {
            bn: { title: `${title} ${RUN} ${stamp}`, slug: `e2e-bo-${viewport}-${stamp}-${i}` },
          },
          variant: { price: 45_000 },
          tags: [tag],
        },
      );
      variants.push(created.variants[0]?.id as string);
      titles.push(`${title} ${RUN} ${stamp}`);
    }

    await page.goto(`${API}/inventory/suppliers`);
    await expect(page.getByRole('heading', { name: m('suppliers.title'), level: 1 })).toBeVisible();
    await expectAccessible(page, 'suppliers');
    await page.getByRole('button', { name: m('suppliers.new') }).click();
    const dialog = page.getByRole('dialog', { name: m('suppliers.new') });
    await dialog.getByLabel(m('suppliers.name'), { exact: true }).fill(supplierName);
    await dialog.getByLabel(pattern(m('suppliers.openingBalance'))).fill('500');
    await expectAccessible(page, 'new supplier');
    await dialog.getByRole('button', { name: m('action.save') }).click();
    await expect(toast(page, m('suppliers.saved'))).toBeVisible();
    const found = await adminCall<{ items: { id: string; name: string }[] }>(
      page.request,
      'get',
      `/v1/admin/suppliers?q=${encodeURIComponent(stamp)}`,
    );
    supplierId = found.items.find((s) => s.name === supplierName)?.id as string;
    expect(supplierId).toBeTruthy();

    // The editor: the supplier, both products from the variant picker at
    // 10 × ৳200, and ৳20 of transport.
    await page.goto(`${API}/inventory/purchase-orders`);
    await page.getByRole('link', { name: m('po.new') }).click();
    await expect(page.getByRole('heading', { name: m('po.new'), level: 1 })).toBeVisible();
    await page
      .getByRole('combobox', { name: m('po.supplier') })
      .selectOption({ label: supplierName });
    for (const title of titles) {
      await page.getByLabel(m('order.addProduct')).fill(title);
      await page
        .getByRole('list', { name: m('order.searchResults') })
        .getByRole('button', { name: new RegExp(title) })
        .click();
    }
    const ordered = page.getByLabel(m('po.ordered'), { exact: true });
    const unitCost = page.getByLabel(m('po.unitCost'), { exact: true });
    await expect(ordered).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      await ordered.nth(i).fill('10');
      await unitCost.nth(i).fill('200');
    }
    await page.getByRole('button', { name: m('po.addCost') }).click();
    await page.getByLabel(m('po.costLabel'), { exact: true }).fill('পরিবহন');
    await page.getByLabel(m('payment.amount'), { exact: true }).fill('20');
    await expectAccessible(page, 'new purchase order');
    await page.getByRole('button', { name: m('po.save') }).click();
    await expect(toast(page, m('po.saved'))).toBeVisible();
    await page.waitForURL(/\/inventory\/purchase-orders\/[0-9a-f-]{36}$/);
    poId = page.url().split('/').pop() as string;
    const draft = await adminCall<{
      status: string;
      lines: { variantId: string; quantity: number; unitCost: number }[];
    }>(page.request, 'get', `/v1/admin/purchase-orders/${poId}`);
    expect(draft.status).toBe('draft');
    expect(draft.lines.map((l) => [l.variantId, l.quantity, l.unitCost]).sort()).toEqual(
      variants.map((v) => [v, 10, 20_000]).sort(),
    );
    await page.reload();
    await expectAccessible(page, 'purchase order, draft');
    await page.getByRole('button', { name: m('po.place') }).click();
    await expect(toast(page, m('po.placed'))).toBeVisible();
  });

  await test.step('it is received in two parts, the first paid on the spot', async () => {
    for (const [part, quantity] of [
      [1, '6'],
      [2, '4'],
    ] as const) {
      await page.goto(`${API}/inventory/purchase-orders/${poId}`);
      await page.getByRole('link', { name: m('po.receive') }).click();
      await expect(page.getByRole('heading', { name: m('receive.title'), level: 1 })).toBeVisible();
      const fields = page.getByLabel(m('receive.quantity'), { exact: true });
      await expect(fields).toHaveCount(2);
      for (let i = 0; i < 2; i++) await fields.nth(i).fill(quantity);
      if (part === 1) {
        await page.getByLabel(m('receive.payNow')).check();
        await page.getByLabel(m('receive.payAmount')).fill('1000');
        await page.getByLabel(m('purchasing.method.bkash')).check();
        await expectAccessible(page, 'receiving with a payment');
      }
      await page.getByRole('button', { name: m('receive.save') }).click();
      await expect(toast(page, pattern(m('receive.saved')))).toBeVisible();
      await page.waitForURL(`**/inventory/purchase-orders/${poId}`);
    }
    const po = await adminCall<{ status: string }>(
      page.request,
      'get',
      `/v1/admin/purchase-orders/${poId}`,
    );
    expect(po.status).toBe('received');
    // ৳200 each plus ৳20 of transport over ৳4,000 of goods: ৳201 each.
    const history = await adminCall<{ items: { newCost: number }[] }>(
      page.request,
      'get',
      `/v1/admin/variants/${variants[0]}/cost-history`,
    );
    expect(history.items[0]?.newCost).toBe(20_100);
    // ৳500 opening + ৳4,020 received − ৳1,000 paid.
    const supplier = await adminCall<{ balance: number }>(
      page.request,
      'get',
      `/v1/admin/suppliers/${supplierId}`,
    );
    expect(supplier.balance).toBe(352_000);
    await page.goto(`${API}/inventory/suppliers/${supplierId}`);
    await expect(page.getByRole('heading', { name: supplierName, level: 1 })).toBeVisible();
    await expectAccessible(page, 'supplier page');
  });

  await test.step('a count while an order ships applies only the real difference', async () => {
    await page.goto(`${API}/inventory/counts`);
    await expectAccessible(page, 'counts');
    await page.getByRole('button', { name: m('counts.new') }).click();
    const dialog = page.getByRole('dialog', { name: m('counts.new') });
    await dialog.getByLabel(m('counts.scope.tag')).check();
    await dialog.getByLabel(m('counts.tag'), { exact: true }).fill(tag);
    await dialog.getByRole('button', { name: m('counts.start') }).click();
    await page.waitForURL(/\/inventory\/counts\/[0-9a-f-]{36}$/);
    const countId = page.url().split('/').pop() as string;
    await expectAccessible(page, 'counting');
    const counted = page.getByLabel(pattern(`${m('counts.counted')}: `));
    await expect(counted).toHaveCount(2);

    // The first item is counted at 9: one was lost. Then an order ships one
    // of the second item before it is counted, and the shelf shows 9 of it:
    // no difference there.
    await counted.nth(0).fill('9');
    await counted.nth(0).press('Enter');
    const order = await adminCall<{ id: string }>(page.request, 'post', '/v1/admin/orders', {
      source: 'phone',
      lines: [{ variantId: variants[1], quantity: 1 }],
      contact: { name: `ই২ই গণনা ${RUN}`, phone: `017${stamp.slice(0, 7)}1` },
      address: {
        divisionId: DHAKA.division,
        districtId: DHAKA.district,
        areaId: DHAKA.area,
        line: 'বাড়ি ৩, সড়ক ৭',
      },
      confirm: true,
    });
    const detail = await adminCall<{ lines: { id: string }[] }>(
      page.request,
      'get',
      `/v1/admin/orders/${order.id}`,
    );
    const shipment = await adminCall<{ id: string }>(
      page.request,
      'post',
      `/v1/admin/orders/${order.id}/shipments`,
      { lines: [{ orderLineId: detail.lines[0]?.id, quantity: 1 }], carrier: 'Pathao' },
    );
    await adminCall(page.request, 'post', `/v1/admin/shipments/${shipment.id}/ship`, {});
    await counted.nth(1).fill('9');
    await counted.nth(1).press('Enter');
    await expect
      .poll(
        async () =>
          (
            await adminCall<{ countedLines: number }>(
              page.request,
              'get',
              `/v1/admin/stock-counts/${countId}`,
            )
          ).countedLines,
      )
      .toBe(2);

    await page.getByRole('button', { name: m('counts.submit') }).click();
    await expect(page.getByRole('button', { name: m('counts.apply') })).toBeVisible();
    await expectAccessible(page, 'count review');
    await page.getByRole('button', { name: m('counts.apply') }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: m('counts.apply') })
      .click();
    await expect(toast(page, m('counts.applied'))).toBeVisible();
    const levels = await adminCall<{ items: { variantId: string; onHand: number }[] }>(
      page.request,
      'get',
      `/v1/admin/inventory?q=${encodeURIComponent(RUN)}`,
    );
    const onHand = (id: string) => levels.items.find((l) => l.variantId === id)?.onHand;
    expect([onHand(variants[0] as string), onHand(variants[1] as string)]).toEqual([9, 9]);
  });

  await test.step('an expense with a receipt photo, and a monthly rent', async () => {
    await page.goto(`${API}/expenses`);
    await expect(page.getByRole('heading', { name: m('expenses.title'), level: 1 })).toBeVisible();
    await expectAccessible(page, 'expenses');
    await page.getByRole('button', { name: m('expenses.new') }).click();
    const dialog = page.getByRole('dialog', { name: m('expenses.new') });
    await dialog.getByLabel(m('expenses.category')).selectOption({ index: 3 });
    await dialog.getByLabel(m('expenses.amount')).fill('3500');
    await dialog.getByLabel(m('purchasing.method.card')).check();
    await dialog.locator('input[type=file]').setInputFiles({
      name: 'receipt.png',
      mimeType: 'image/png',
      buffer: pngImage(64, 64, [200, 120, 40]),
    });
    await expectAccessible(page, 'expense form');
    await dialog.getByRole('button', { name: m('action.save') }).click();
    await expect(toast(page, m('expenses.saved'))).toBeVisible();
    await expect(page.getByRole('link', { name: m('expenses.receiptView') }).first()).toBeVisible();

    await page.getByRole('button', { name: m('expenses.tab.recurring') }).click();
    await page.getByRole('button', { name: m('recurring.new') }).click();
    const rent = page.getByRole('dialog', { name: m('recurring.new') });
    await rent.getByLabel(m('expenses.category')).selectOption({ index: 1 });
    await rent.getByLabel(m('expenses.amount')).fill('25000');
    await rent.getByLabel(m('recurring.dayOfMonth')).selectOption('5');
    await expectAccessible(page, 'recurring expense form');
    await rent.getByRole('button', { name: m('action.save') }).click();
    await expect(toast(page, m('recurring.saved'))).toBeVisible();
    await expectAccessible(page, 'recurring expenses');
  });

  await test.step('the profit report, exported to Excel', async () => {
    await page.goto(`${API}/reports/profit`);
    await expect(page.getByRole('heading', { name: m('profit.title'), level: 1 })).toBeVisible();
    await expect(page.getByRole('cell', { name: m('profit.netProfit') })).toBeVisible();
    await expectAccessible(page, 'profit report');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page
        .getByRole('button', {
          name: m('reports.exportOf', {
            what: m('profit.title'),
            format: m('reports.export.xlsx'),
          }),
        })
        .click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^profit-\d{4}-\d{2}-01-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    const file = await download.path();
    const { readFileSync } = await import('node:fs');
    // An .xlsx is a zip.
    expect(readFileSync(file).subarray(0, 2).toString('latin1')).toBe('PK');
    const statement = await adminCall<{ current: { expenses: number } }>(
      page.request,
      'get',
      `/v1/admin/reports/profit?from=${today().slice(0, 8)}01&to=${today()}`,
    );
    expect(statement.current.expenses).toBeGreaterThanOrEqual(3_500_00);

    for (const path of [
      '/reports/sales',
      '/reports/stock',
      '/reports/expenses',
      '/reports/cod-outstanding',
    ]) {
      await page.goto(`${API}${path}`);
      // The sidebar (or the phone's Menu) lists the reports; each page has its title.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, path);
    }
  });
});
