// The Phase 7 courier flows (phase-7-plan §10), on the run's own store after
// the sales recovery flows, with the test courier: the owner connects it
// in Settings → Couriers; a confirmed order is booked from its page through
// the booking sheet; its parcel is moved as the courier would move it
// (picked up, then delivered), which settles the COD; a second parcel comes
// back and staff receive it under Courier returns; two more are booked in
// one bulk booking; and the delivered parcel's payout is recorded under
// Reports → COD reconciliation. Axe on every new screen.
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { bn } from '../../apps/admin/src/i18n/bn';
import { couriersBn } from '../../apps/admin/src/i18n/couriers-bn';
import { ordersBn } from '../../apps/admin/src/i18n/orders-bn';
import { expectAccessible, signIn } from './helpers';
import { DEV_TOKEN, people, RUN } from './people';
import { API } from './urls';

test.skip(!RUN || !DEV_TOKEN, 'needs a seeded preview: E2E_RUN and DEV_TOKEN');
test.describe.configure({ mode: 'serial', timeout: 300_000 });

const adminMessages = { ...bn, ...ordersBn, ...couriersBn };
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

const DHAKA = { division: 6, district: 47, area: 513 };
const FAKE = couriersBn['couriers.name.fake'];

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

interface Order {
  id: string;
  displayNumber: string;
  deliveryStatus: string;
  paymentStatus: string;
  shipments: { id: string; status: string; courier: { consignmentId: string | null } | null }[];
}

test('couriers', async ({ page }, info) => {
  const viewport = info.project.name.replace(/^couriers-/, '');
  const p = people(viewport);
  const stamp = `${String(Date.now()).slice(-7)}${viewport === 'phone' ? '3' : '4'}`;
  let variant = '';
  const order = (path: string) => adminCall<Order>(page.request, 'get', path);
  const confirmedOrder = (n: number) =>
    adminCall<{ id: string; displayNumber: string }>(page.request, 'post', '/v1/admin/orders', {
      source: 'phone',
      lines: [{ variantId: variant, quantity: 1 }],
      contact: { name: `ই২ই কুরিয়ার ${n} ${RUN}`, phone: `016${stamp.slice(0, 7)}${n}` },
      address: {
        divisionId: DHAKA.division,
        districtId: DHAKA.district,
        areaId: DHAKA.area,
        line: 'বাড়ি ১২, সড়ক ৫',
      },
      confirm: true,
    });

  await test.step('the owner connects the test courier', async () => {
    await signIn(page, p.owner);
    const me = (await (await page.request.get(`${API}/v1/admin/me`)).json()) as {
      stores: { tenantId: string; slug: string }[];
    };
    const tenantId = me.stores.find((x) => x.slug === p.slug)?.tenantId;
    await adminCall(page.request, 'put', '/v1/admin/me/active-store', { tenantId });
    const created = await adminCall<{ variants: { id: string }[] }>(
      page.request,
      'post',
      '/v1/admin/products',
      {
        status: 'active',
        translations: { bn: { title: `পাঞ্জাবি ${RUN}`, slug: `e2e-panjabi-${viewport}-${stamp}` } },
        variant: { price: 150_000, weightGrams: 400 },
      },
    );
    variant = created.variants[0]?.id as string;
    await adminCall(page.request, 'post', '/v1/admin/inventory/adjustments', [
      { mode: 'delta', variantId: variant, quantity: 20, reason: 'received' },
    ]);

    await page.goto(`${API}/settings/couriers`);
    await expect(page.getByRole('heading', { name: m('couriers.title'), level: 1 })).toBeVisible();
    await expectAccessible(page, 'courier settings');
    const card = page.getByRole('region', { name: FAKE });
    // A run that is retried finds the courier connected: its keys are then changed.
    const change = card.getByRole('button', { name: m('couriers.change') });
    if (await change.isVisible()) await change.click();
    await card.getByLabel(m('couriers.field.apiKey')).fill('e2e-key');
    await card.getByRole('button', { name: m('couriers.save') }).click();
    await expect(toast(page, m('couriers.saved', { courier: FAKE }))).toBeVisible();
    await card.getByRole('button', { name: m('couriers.webhook.show') }).click();
    await expect(card.getByText('/v1/webhooks/couriers/fake/')).toBeVisible();
    await expectAccessible(page, 'courier settings, connected');
  });

  let delivered = '';
  await test.step('a confirmed order is booked from its page, then delivered by the courier', async () => {
    const placed = await confirmedOrder(1);
    await page.goto(`${API}/orders/${placed.id}`);
    await page
      .getByRole('button', { name: m('couriers.book', { courier: FAKE }) })
      .first()
      .click();
    const sheet = page.getByRole('dialog', { name: m('couriers.book', { courier: FAKE }) });
    await expect(sheet.getByText('বাড়ি ১২, সড়ক ৫', { exact: false })).toBeVisible();
    await expectAccessible(page, 'booking sheet');
    await sheet.getByRole('button', { name: m('couriers.sheet.confirm') }).click();
    await expect(toast(page, pattern(m('couriers.result.booked')))).toBeVisible();
    await expect(page.getByText(pattern(m('couriers.consignment')))).toBeVisible();
    await expectAccessible(page, 'order with a booked parcel');

    for (const [status, delivery] of [
      ['picked_up', 'shipped'],
      ['delivered', 'delivered'],
    ] as const) {
      await page.getByLabel(m('couriers.fake.move')).selectOption(status);
      await page.getByRole('button', { name: m('couriers.fake.move') }).click();
      // The toast of the move before may still show: wait for the order itself.
      await expect
        .poll(async () => (await order(`/v1/admin/orders/${placed.id}`)).deliveryStatus)
        .toBe(delivery);
    }
    const after = await order(`/v1/admin/orders/${placed.id}`);
    expect(after).toMatchObject({ deliveryStatus: 'delivered', paymentStatus: 'paid' });
    delivered = after.shipments[0]?.courier?.consignmentId ?? '';
    expect(delivered).not.toBe('');
    await page.getByText(m('couriers.events')).click();
    await expect(page.getByText(m('couriers.update.delivered')).first()).toBeVisible();
  });

  await test.step('a parcel that comes back waits for staff to receive it', async () => {
    const placed = await confirmedOrder(2);
    const booked = await adminCall<{ consignmentId: string }>(
      page.request,
      'post',
      `/v1/admin/orders/${placed.id}/booking`,
      { courier: 'fake' },
    );
    for (const status of ['picked_up', 'returning', 'returned'] as const) {
      await adminCall(
        page.request,
        'post',
        `/v1/admin/couriers/fake/parcels/${booked.consignmentId}`,
        {
          status,
        },
      );
    }
    await page.goto(`${API}/orders/courier-returns`);
    await expect(
      page.getByRole('heading', { name: m('couriers.returns.title'), level: 1 }),
    ).toBeVisible();
    await expectAccessible(page, 'courier returns');
    const row = page.getByRole('listitem').filter({ hasText: placed.displayNumber });
    await row.getByRole('button', { name: m('couriers.received') }).click();
    await expect(toast(page, m('couriers.receivedDone'))).toBeVisible();
    expect((await order(`/v1/admin/orders/${placed.id}`)).shipments[0]?.status).toBe('returned');
  });

  await test.step('two orders are booked in one bulk booking', async () => {
    const ids = [(await confirmedOrder(3)).id, (await confirmedOrder(4)).id];
    const checks = await adminCall<{ problems: string[] }[]>(
      page.request,
      'post',
      '/v1/admin/shipments/book/check',
      { courier: 'fake', orderIds: ids },
    );
    expect(checks.map((c) => c.problems)).toEqual([[], []]);
    await adminCall(page.request, 'post', '/v1/admin/shipments/book', {
      courier: 'fake',
      orderIds: ids,
    });
    await expect
      .poll(
        async () =>
          (
            await adminCall<{ status: string | null }[]>(
              page.request,
              'get',
              `/v1/admin/shipments/bookings?orderIds=${ids.join(',')}`,
            )
          ).map((s) => s.status),
        { timeout: 60_000 },
      )
      .toEqual(['booked', 'booked']);
    // The dashboard counts them as waiting for pickup.
    await page.goto(`${API}/`);
    await expect(
      page.getByRole('link', { name: new RegExp(m('couriers.dash.booked')) }),
    ).toBeVisible();
    await expectAccessible(page, 'dashboard with parcels');
  });

  await test.step('the delivered parcel’s payout is recorded, and the report shows it', async () => {
    await page.goto(`${API}/reports/cod`);
    await expect(page.getByRole('heading', { name: m('cod.title'), level: 1 })).toBeVisible();
    await expectAccessible(page, 'COD reconciliation');
    await page.getByRole('button', { name: m('cod.record') }).click();
    const dialog = page.getByRole('dialog', { name: m('cod.record') });
    await dialog.getByLabel(m('cod.courier'), { exact: true }).selectOption('fake');
    await dialog.getByLabel(m('cod.reference')).fill(`e2e-${stamp}`);
    await dialog.getByLabel(m('cod.record.consignments')).fill(delivered);
    await dialog.getByRole('button', { name: m('cod.preview') }).click();
    await expect(dialog.getByText(pattern(m('cod.matched')))).toBeVisible();
    await expectAccessible(page, 'record a payout');
    await dialog.getByRole('button', { name: m('cod.save') }).click();
    await expect(toast(page, m('cod.saved'))).toBeVisible();
    await expect(page.getByText(`e2e-${stamp}`)).toBeVisible();
  });
});
