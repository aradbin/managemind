// CPU per route on a preview (ADR 0003, phase-1-plan §9, phase-2-plan §8),
// after the E2E: signs in as the run's phone owner and sends bursts so most
// requests land on warm isolates: GET /v1/admin/me, PATCH /v1/admin/store,
// and Phase 2's product list, product read, product save and bulk price
// edit on a product with 6 variants. Then reads CPU time per route from
// Workers Logs since --since. Writes a table to the step summary; it never
// fails a run.
//
// Since Oct 23 (ADR 0011, amended) only this step's own requests are
// measured, with --since at its start, so the E2E's import chunks are no
// longer in the table. Since Oct 25 the whole full run, this step included,
// is on a Worker bound to Hyperdrive, production's connection path.
//
// Phase 3 (phase-3-plan §9) adds the storefront: a burst of each page type
// on the demo store. Previews never cache pages, so every one is a miss:
// the storefront Worker's render plus the API's page endpoint behind it,
// both measured.
//
// Phase 4 (phase-4-plan §9) adds a shopper on the run's own store: cart
// adds and reads, setting the area, and placeOrder on its own row (the
// store's checkout limits are raised for the burst), then the admin's order
// list and order detail.
//
// Phase 6 (phase-6-plan §10) saves each shopper's checkout as it is typed
// before the order is placed (which then closes it), and reads the call
// queue and the incomplete orders; the orders the returns don't use are
// claimed and confirmed from the queue.
//
// Phase 8 (phase-8-plan §10) adds a 50-line receipt, a 500-line count's
// apply, and the profit, stock and sales reports.
//
//   tsx preview/cpu.ts --pr 12 --api-url <url> --storefront-url <url> --since <epoch ms>
import { appendFileSync } from 'node:fs';
import { notice, parseArgs, prNumber, requireEnv } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';
import { sleep } from '../lib/http';
import { apiWorker, storefrontWorker } from './names';

const args = parseArgs(process.argv.slice(2));
const pr = prNumber(args);
const api = (args.get('api-url') ?? '').replace(/\/$/, '');
const storefront = (args.get('storefront-url') ?? '').replace(/\/$/, '');
const since = Number(args.get('since'));
if (!api || !storefront || !Number.isFinite(since)) {
  throw new Error('--api-url, --storefront-url and --since are required');
}
const devToken = requireEnv('DEV_TOKEN');
const owner = `e2e-${requireEnv('E2E_RUN')}-phone-owner@example.test`;
const cf = new Cloudflare(requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('CLOUDFLARE_ACCOUNT_ID'));

const BURST = {
  me: 60,
  store: 30,
  list: 30,
  read: 30,
  save: 20,
  bulk: 15,
  page: 20,
  cart: 30,
  order: 15,
  orders: 30,
  returns: 10,
  queue: 30,
  incomplete: 20,
  report: 10,
  receipt: 5,
  backOffice: 10,
};

/** One of each storefront page type on demo-fashion (scripts/demo/catalog.ts). */
const STORE_PAGES = [
  { path: '/', api: '/v1/store/pages/home', label: 'Home' },
  { path: '/categories/sarees', api: '/v1/store/pages/categories/sarees', label: 'Category' },
  {
    path: '/products/red-jamdani-saree',
    api: '/v1/store/pages/products/red-jamdani-saree',
    label: 'Product',
  },
  { path: '/search', query: 'q=saree', api: '/v1/store/pages/search', label: 'Search' },
  { path: '/pages/about-us', api: '/v1/store/pages/pages/about-us', label: 'Static page' },
];

const jar = new Map<string, string>();
/**
 * One admin API request, tried once more on a 5xx: a request the Free plan
 * stops at its CPU limit shouldn't end the measurement. Repeats are harmless
 * here, in the run's own store.
 */
async function call(method: string, path: string, body?: unknown): Promise<Response> {
  // Commands take an idempotency key; the retry sends the same one.
  const key = method === 'GET' ? undefined : crypto.randomUUID();
  const res = await callOnce(method, path, body, key);
  if (res.status < 500) return res;
  await res.body?.cancel();
  return callOnce(method, path, body, key);
}

async function callOnce(
  method: string,
  path: string,
  body?: unknown,
  key?: string,
): Promise<Response> {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      origin: api,
      ...(key ? { 'idempotency-key': key } : {}),
      // Previews run Turnstile with the always-pass test keys, which take the dummy token.
      ...(path.endsWith('/send-verification-otp')
        ? { 'x-turnstile-token': 'XXXX.DUMMY.TOKEN.XXXX' }
        : {}),
      ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const line of res.headers.getSetCookie()) {
    const [pair = ''] = line.split(';');
    const at = pair.indexOf('=');
    if (at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return res;
}

async function latestCode(): Promise<string> {
  const res = await fetch(`${api}/v1/_dev/mailbox?to=${encodeURIComponent(owner)}`, {
    headers: { 'x-dev-token': devToken },
  });
  const [mail] = (await res.json()) as { text: string }[];
  const code = mail && /\b(\d{6})\b/.exec(mail.text)?.[1];
  if (!code) throw new Error('no sign-in code');
  return code;
}

// Sign in, pick the store, then the bursts.
const sent = await call('POST', '/api/auth/email-otp/send-verification-otp', {
  email: owner,
  type: 'sign-in',
});
if (!sent.ok) throw new Error(`send code: ${sent.status} ${await sent.text()}`);
await sleep(3000);
const signedIn = await call('POST', '/api/auth/sign-in/email-otp', {
  email: owner,
  otp: await latestCode(),
});
if (!signedIn.ok) throw new Error(`sign-in: ${signedIn.status}`);
const me = (await (await call('GET', '/v1/admin/me')).json()) as {
  stores: { tenantId: string; name: string }[];
};
const store = me.stores[0];
if (!store) throw new Error('the E2E owner has no store');
await call('PUT', '/v1/admin/me/active-store', { tenantId: store.tenantId });
for (let i = 0; i < BURST.me; i++) await call('GET', '/v1/admin/me');
for (let i = 0; i < BURST.store; i++) await call('PATCH', '/v1/admin/store', { name: store.name });

// A product like a real one: a description of a few paragraphs and a list,
// two options making 6 variants.
const text = (t: string) => ({ type: 'text', text: t });
const description = {
  type: 'doc',
  content: [
    ...Array.from({ length: 4 }, (_, i) => ({
      type: 'paragraph',
      content: [text(`হাতে বোনা ঢাকাই জামদানি, অনুচ্ছেদ ${i + 1}। নরম সুতি, উজ্জ্বল রং, সারা বছর পরার মতো।`)],
    })),
    {
      type: 'bulletList',
      content: ['সুতি', '৬ গজ', 'ব্লাউজ পিস সহ'].map((t) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [text(t)] }],
      })),
    },
  ],
};
async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
const product = await json<{ id: string }>(
  await call('POST', '/v1/admin/products', {
    translations: { bn: { title: 'সিপিইউ পরীক্ষার শাড়ি', description } },
    variant: { price: 125_000 },
  }),
  'create product',
);
const withOptions = await json<{ variants: { id: string }[] }>(
  await call('PUT', `/v1/admin/products/${product.id}/options`, [
    { name: { bn: 'রং' }, values: ['লাল', 'নীল', 'সবুজ'].map((v) => ({ label: { bn: v } })) },
    { name: { bn: 'সাইজ' }, values: ['ছোট', 'বড়'].map((v) => ({ label: { bn: v } })) },
  ]),
  'set options',
);
const productPath = `/v1/admin/products/${product.id}`;
for (let i = 0; i < BURST.list; i++) await call('GET', '/v1/admin/products');
for (let i = 0; i < BURST.read; i++) await call('GET', productPath);
for (let i = 0; i < BURST.save; i++) {
  await call('PATCH', productPath, {
    translations: { bn: { title: `সিপিইউ পরীক্ষার শাড়ি ${i}`, description } },
    tags: ['cpu', `run-${i}`],
  });
}
for (let i = 0; i < BURST.bulk; i++) {
  await call(
    'PATCH',
    '/v1/admin/variants',
    withOptions.variants.map((v) => ({ id: v.id, price: 125_000 + i * 100 })),
  );
}
// A request the Free plan stops for CPU is a result to report, not a reason
// to stop measuring: failures are counted and listed in the summary.
const failures: string[] = [];
for (const page of STORE_PAGES) {
  for (let i = 0; i < BURST.page; i++) {
    const query = `${page.query ? `${page.query}&` : ''}store=demo-fashion`;
    const res = await fetch(`${storefront}${page.path}?${query}`);
    await res.arrayBuffer();
    if (!res.ok) failures.push(`${page.label} page: ${res.status}`);
  }
}
// The shopper (phase-4-plan §9): through the storefront's /api proxy, as a
// browser would, on the run's store. Previews run Turnstile with the
// always-pass test keys, which take Cloudflare's dummy token.
// If its setup is stopped too, the shopper's burst is skipped and reported,
// and the table still covers everything else.
async function shopperSetup() {
  const admin = await json<{ slug: string; checkout: Record<string, unknown> }>(
    await call('GET', '/v1/admin/store'),
    'read store',
  );
  await json(
    await call('PATCH', '/v1/admin/store', {
      checkout: {
        ...admin.checkout,
        rateLimits: { perPhoneHour: 100, perPhoneDay: 500, perIpHour: 500 },
      },
    }),
    'raise checkout limits',
  );
  const item = await json<{ variants: { id: string }[] }>(
    await call('POST', '/v1/admin/products', {
      status: 'active',
      translations: { bn: { title: 'সিপিইউ পরীক্ষার পণ্য' } },
      variant: { price: 50_000, trackInventory: false },
    }),
    'create shop product',
  );
  return { slug: admin.slug, variantId: item.variants[0]?.id as string };
}
const setup = await shopperSetup().catch((e: unknown) => {
  failures.push(`shopper setup: ${e instanceof Error ? e.message : String(e)}`);
  return null;
});
const variantId = setup?.variantId ?? '';
const DHANMONDI = { divisionId: 6, districtId: 47, areaId: 513 };
async function shop(method: string, path: string, cookie: Map<string, string>, body?: unknown) {
  const res = await fetch(`${storefront}/api${path}?store=${setup?.slug}`, {
    method,
    headers: {
      ...(cookie.size ? { cookie: [...cookie].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(path === '/checkout/orders' ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const line of res.headers.getSetCookie()) {
    const [pair = ''] = line.split(';');
    const at = pair.indexOf('=');
    if (at > 0) cookie.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return res;
}
let placedId = '';
const placedOrders: { id: string; number: string; phone: string }[] = [];
for (let i = 0; setup && i < BURST.order; i++) {
  try {
    await shopOnce(i);
  } catch (e) {
    failures.push(`order ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
async function shopOnce(i: number) {
  const cookie = new Map<string, string>();
  await json(await shop('POST', '/cart/lines', cookie, { variantId, quantity: 1 }), 'add');
  await json(await shop('PUT', '/cart/area', cookie, { areaId: DHANMONDI.areaId }), 'area');
  const cart = await json<{ totals: { total: number } }>(
    await shop('GET', '/cart', cookie),
    'cart',
  );
  for (let j = 1; j < BURST.cart / BURST.order; j++) await shop('GET', '/cart', cookie);
  const phone = `+8801700${String(900_000 + i)}`;
  // Saving never stops a checkout, here too: the runner's IP also saved the E2E's.
  const saved = await shop('PUT', '/checkout/draft', cookie, {
    phone,
    name: 'CPU',
    address: { ...DHANMONDI, line: 'House 1, Road 2' },
  });
  if (!saved.ok) failures.push(`save checkout ${i + 1}: ${saved.status}`);
  await saved.body?.cancel();
  const placed = await json<{ id: string; displayNumber: string }>(
    await shop('POST', '/checkout/orders', cookie, {
      contact: { name: 'CPU', phone },
      address: { ...DHANMONDI, line: 'House 1, Road 2' },
      paymentMethod: 'cod',
      expectedTotal: cart.totals.total,
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    }),
    'place order',
  );
  placedId = placed.id;
  placedOrders.push({ id: placed.id, number: placed.displayNumber, phone });
}
for (let i = 0; i < BURST.orders; i++) await call('GET', '/v1/admin/orders');
for (let i = 0; placedId && i < BURST.orders; i++) {
  await call('GET', `/v1/admin/orders/${placedId}`);
}
// Phase 5A's routes (phase-5b-plan §9): each of the first orders is
// delivered, tracked and returned by its shopper, then approved, received,
// inspected back into stock and refunded by bKash. The IPN waits for the
// SSLCommerz sandbox credentials (phase-5a-report §5).
for (const order of placedOrders.slice(0, BURST.returns)) {
  try {
    await returnOnce(order);
  } catch (e) {
    failures.push(`return of ${order.number}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
async function returnOnce(order: { id: string; number: string; phone: string }) {
  await json(await call('POST', `/v1/admin/orders/${order.id}/confirm`, {}), 'confirm');
  const detail = await json<{ lines: { id: string }[] }>(
    await call('GET', `/v1/admin/orders/${order.id}`),
    'order',
  );
  const orderLineId = detail.lines[0]?.id as string;
  const shipment = await json<{ id: string }>(
    await call('POST', `/v1/admin/orders/${order.id}/shipments`, {
      lines: [{ orderLineId, quantity: 1 }],
      carrier: 'Pathao',
    }),
    'shipment',
  );
  await json(await call('POST', `/v1/admin/shipments/${shipment.id}/ship`, {}), 'ship');
  await json(
    await call('POST', `/v1/admin/shipments/${shipment.id}/deliver`, { cashCollected: true }),
    'deliver',
  );
  const cookie = new Map<string, string>();
  const { token } = await json<{ token: string }>(
    await shop('POST', '/orders/track', cookie, { number: order.number, phone: order.phone }),
    'track',
  );
  await json(await shop('POST', '/returns/options', cookie, { token }), 'return options');
  await json(
    await shop('POST', '/returns', cookie, {
      token,
      reason: 'damaged',
      lines: [{ orderLineId, quantity: 1 }],
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    }),
    'request return',
  );
  const [ret] = await json<{ id: string }[]>(
    await call('GET', `/v1/admin/returns?orderId=${order.id}`),
    'returns',
  );
  if (!ret) throw new Error('no return');
  await json(await call('POST', `/v1/admin/returns/${ret.id}/approve`), 'approve');
  await json(await call('POST', `/v1/admin/returns/${ret.id}/receive`), 'receive');
  await json(
    await call('POST', `/v1/admin/returns/${ret.id}/inspect`, {
      lines: [{ orderLineId, sellable: 1, damaged: 0 }],
    }),
    'inspect',
  );
  await json(
    await call('POST', `/v1/admin/orders/${order.id}/refunds`, {
      returnId: ret.id,
      method: 'bkash',
      reference: `CPU${order.number}`.replace(/[^A-Za-z0-9]/g, ''),
    }),
    'refund',
  );
}

// Phase 6's routes: the call queue and incomplete orders, then a call that
// confirms each order the returns left pending.
for (let i = 0; i < BURST.queue; i++) await call('GET', '/v1/admin/confirmations');
for (let i = 0; i < BURST.incomplete; i++) await call('GET', '/v1/admin/incomplete-orders');
for (const order of placedOrders.slice(BURST.returns)) {
  try {
    await json(await call('POST', `/v1/admin/orders/${order.id}/confirmation/claim`), 'claim');
    await json(
      await call('POST', `/v1/admin/orders/${order.id}/confirmation/outcomes`, {
        outcome: 'confirmed',
      }),
      'outcome',
    );
  } catch (e) {
    failures.push(`call to ${order.number}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Phase 7's routes with the test courier: connect it, then for each order
// the queue confirmed, the booking preview and the booking, and the
// courier's webhook saying it was delivered (phase-7-plan §10); then the
// COD reconciliation report.
let booked = 0;
try {
  await json(
    await call('PUT', '/v1/admin/couriers/fake', { secrets: { apiKey: 'cpu' } }),
    'connect',
  );
  const hook = await json<{ url: string; secret: string }>(
    await call('GET', '/v1/admin/couriers/fake/webhook'),
    'webhook',
  );
  const webhookPath = new URL(hook.url).pathname;
  for (const order of placedOrders.slice(BURST.returns)) {
    try {
      await json(
        await call('POST', `/v1/admin/orders/${order.id}/booking/preview`, { courier: 'fake' }),
        'booking preview',
      );
      const b = await json<{ consignmentId: string | null }>(
        await call('POST', `/v1/admin/orders/${order.id}/booking`, { courier: 'fake' }),
        'book',
      );
      if (!b.consignmentId) continue;
      booked++;
      // What the courier will answer when asked, then its webhook, as it sends it.
      await json(
        await call('POST', `/v1/admin/couriers/fake/parcels/${b.consignmentId}`, {
          status: 'picked_up',
        }),
        'move parcel',
      );
      const res = await fetch(`${api}${webhookPath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${hook.secret}` },
        body: JSON.stringify({ consignment_id: b.consignmentId }),
      });
      if (!res.ok) failures.push(`courier webhook: ${res.status}`);
    } catch (e) {
      failures.push(`booking ${order.number}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
} catch (e) {
  failures.push(`courier: ${e instanceof Error ? e.message : String(e)}`);
}
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
for (let i = 0; i < BURST.report; i++) {
  await call('GET', `/v1/admin/reports/cod?from=${day}&to=${day}`);
}

// Phase 8's routes (phase-8-plan §9, §10): five products of 100 variants,
// tagged for a count; five 50-line receipts without a PO, at cost; a count
// of all 500 lines, every line counted, then applied in the request (a
// preview has no queue, and 500 lines is one batch); then the profit,
// stock and sales reports.
let counted = 0;
try {
  const variantIds: string[] = [];
  for (let p = 0; p < 5; p++) {
    const made = await json<{ id: string }>(
      await call('POST', '/v1/admin/products', {
        translations: { bn: { title: `সিপিইউ গণনা ${p + 1}` } },
        variant: { price: 50_000 },
        tags: ['cpu-count'],
      }),
      'count product',
    );
    const options = await json<{ variants: { id: string }[] }>(
      await call('PUT', `/v1/admin/products/${made.id}/options`, [
        {
          name: { bn: 'নম্বর' },
          values: Array.from({ length: 100 }, (_, i) => ({ label: { bn: String(i + 1) } })),
        },
      ]),
      'count options',
    );
    variantIds.push(...options.variants.map((v) => v.id));
  }
  for (let r = 0; r < BURST.receipt; r++) {
    await json(
      await call('POST', '/v1/admin/goods-receipts', {
        lines: variantIds
          .slice(r * 50, r * 50 + 50)
          .map((variantId, i) => ({ variantId, quantity: 4, unitCost: 30_000 + i * 100 })),
      }),
      'receipt',
    );
  }
  const count = await json<{ id: string }>(
    await call('POST', '/v1/admin/stock-counts', { scope: { kind: 'tag', tag: 'cpu-count' } }),
    'start count',
  );
  // Ten at a time; every line one less than the receipts left, or 4 where none came.
  for (let i = 0; i < variantIds.length; i += 10) {
    const done = await Promise.all(
      variantIds.slice(i, i + 10).map(async (variantId, j) => {
        const res = await call('PUT', `/v1/admin/stock-counts/${count.id}/lines/${variantId}`, {
          counted: i + j < BURST.receipt * 50 ? 3 : 4,
        });
        await res.arrayBuffer();
        return res.ok;
      }),
    );
    counted += done.filter(Boolean).length;
  }
  await json(await call('POST', `/v1/admin/stock-counts/${count.id}/submit`), 'submit count');
  await json(await call('POST', `/v1/admin/stock-counts/${count.id}/apply`), 'apply count');
} catch (e) {
  failures.push(`back office: ${e instanceof Error ? e.message : String(e)}`);
}
const monthStart = `${day.slice(0, 8)}01`;
for (let i = 0; i < BURST.backOffice; i++) {
  await call('GET', `/v1/admin/reports/profit?from=${monthStart}&to=${day}`);
  await call('GET', '/v1/admin/reports/stock');
  await call('GET', `/v1/admin/reports/sales?from=${monthStart}&to=${day}`);
}

if (failures.length) {
  notice(`${failures.length} requests in the bursts failed: ${failures.slice(0, 10).join('; ')}`);
}

notice(
  `Sent ${BURST.page} of each storefront page (${STORE_PAGES.map((p) => p.label).join(', ')}), ` +
    `${BURST.me} GET /v1/admin/me, ${BURST.store} PATCH /v1/admin/store, ` +
    `${BURST.list} product lists, ${BURST.read} product reads, ${BURST.save} product saves ` +
    `${BURST.bulk} bulk edits of 6 variants, ${BURST.order} orders (cart, area, checkout), ` +
    `${BURST.cart} cart reads, ${BURST.orders} each of the order list and an order, ` +
    `${BURST.returns} returns (track, request, approve, receive, inspect, refund), ` +
    `${BURST.queue} call queue reads, ${BURST.incomplete} incomplete order lists, ` +
    `${BURST.order - BURST.returns} calls confirmed from the queue, ` +
    `${booked} parcels booked with the test courier with a webhook each, ` +
    `${BURST.report} COD reconciliation reports, ` +
    `${BURST.receipt} receipts of 50 lines, a count of ${counted} counted lines applied, ` +
    `and ${BURST.backOffice} each of the profit, stock and sales reports`,
);

// Workers Logs names an invocation by its method and path, with IDs in the
// path written as REDACTED, and a queue invocation by its queue. A grouped
// query returns only the busiest groups, so each route is queried on its own.
const ROUTES: { trigger: string; label: string; worker?: string }[] = [
  { trigger: 'GET /v1/admin/me', label: 'GET /v1/admin/me' },
  { trigger: 'PATCH /v1/admin/store', label: 'PATCH /v1/admin/store' },
  { trigger: 'GET /v1/admin/products', label: 'GET /v1/admin/products' },
  { trigger: 'GET /v1/admin/products/REDACTED', label: 'GET /v1/admin/products/{id}' },
  { trigger: 'PATCH /v1/admin/products/REDACTED', label: 'PATCH /v1/admin/products/{id} (save)' },
  { trigger: 'PATCH /v1/admin/variants', label: 'PATCH /v1/admin/variants (bulk, 6)' },
  {
    trigger: 'POST /api/auth/email-otp/send-verification-otp',
    label: 'POST /api/auth/email-otp/send-verification-otp',
  },
  { trigger: 'POST /api/auth/sign-in/email-otp', label: 'POST /api/auth/sign-in/email-otp' },
  { trigger: 'POST /v1/store/cart/lines', label: 'POST /v1/store/cart/lines (add)' },
  { trigger: 'PUT /v1/store/cart/area', label: 'PUT /v1/store/cart/area' },
  { trigger: 'GET /v1/store/cart', label: 'GET /v1/store/cart' },
  {
    trigger: 'POST /v1/store/checkout/orders',
    label: 'POST /v1/store/checkout/orders (placeOrder)',
  },
  { trigger: 'GET /v1/admin/orders', label: 'GET /v1/admin/orders' },
  { trigger: 'GET /v1/admin/orders/REDACTED', label: 'GET /v1/admin/orders/{id}' },
  { trigger: 'POST /v1/store/orders/track', label: 'POST /v1/store/orders/track' },
  { trigger: 'PUT /v1/store/checkout/draft', label: 'PUT /v1/store/checkout/draft (save)' },
  { trigger: 'GET /v1/admin/confirmations', label: 'GET /v1/admin/confirmations (queue)' },
  {
    trigger: 'POST /v1/admin/orders/REDACTED/confirmation/claim',
    label: 'POST /v1/admin/orders/{id}/confirmation/claim',
  },
  {
    trigger: 'POST /v1/admin/orders/REDACTED/confirmation/outcomes',
    label: 'POST /v1/admin/orders/{id}/confirmation/outcomes',
  },
  { trigger: 'GET /v1/admin/incomplete-orders', label: 'GET /v1/admin/incomplete-orders' },
  {
    trigger: 'POST /v1/admin/orders/REDACTED/booking/preview',
    label: 'POST /v1/admin/orders/{id}/booking/preview',
  },
  {
    trigger: 'POST /v1/admin/orders/REDACTED/booking',
    label: 'POST /v1/admin/orders/{id}/booking',
  },
  {
    trigger: 'POST /v1/webhooks/couriers/fake/REDACTED',
    label: 'POST /v1/webhooks/couriers/{courier}/{store} (webhook)',
  },
  { trigger: 'GET /v1/admin/reports/cod', label: 'GET /v1/admin/reports/cod' },
  { trigger: 'POST /v1/admin/goods-receipts', label: 'POST /v1/admin/goods-receipts (50 lines)' },
  {
    trigger: 'PUT /v1/admin/stock-counts/REDACTED/lines/REDACTED',
    label: 'PUT /v1/admin/stock-counts/{id}/lines/{variantId}',
  },
  {
    trigger: 'POST /v1/admin/stock-counts/REDACTED/apply',
    label: 'POST /v1/admin/stock-counts/{id}/apply (500 lines)',
  },
  { trigger: 'GET /v1/admin/reports/profit', label: 'GET /v1/admin/reports/profit' },
  { trigger: 'GET /v1/admin/reports/stock', label: 'GET /v1/admin/reports/stock' },
  { trigger: 'GET /v1/admin/reports/sales', label: 'GET /v1/admin/reports/sales' },
  { trigger: 'POST /v1/store/returns', label: 'POST /v1/store/returns (request)' },
  {
    trigger: 'POST /v1/admin/returns/REDACTED/inspect',
    label: 'POST /v1/admin/returns/{id}/inspect',
  },
  {
    trigger: 'POST /v1/admin/orders/REDACTED/refunds',
    label: 'POST /v1/admin/orders/{id}/refunds (bKash)',
  },
  ...STORE_PAGES.flatMap((p) => [
    {
      trigger: `GET ${p.path}`,
      label: `Storefront: ${p.label} page miss`,
      worker: storefrontWorker(pr),
    },
    { trigger: `GET ${p.api}`, label: `API: ${p.label} page data` },
  ]),
];

// Workers Logs takes a little while to make new events queryable.
const service = apiWorker(pr);
type Row = {
  route: string;
  n: number;
  stopped: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
};
async function stats(trigger: string, label: string, worker = service): Promise<Row> {
  const calcs = await cf.workerLogStats(
    worker,
    since,
    Date.now(),
    [
      { operator: 'count', alias: 'n' },
      { operator: 'median', key: '$workers.cpuTimeMs', alias: 'p50' },
      { operator: 'p90', key: '$workers.cpuTimeMs', alias: 'p90' },
      { operator: 'p99', key: '$workers.cpuTimeMs', alias: 'p99' },
      { operator: 'max', key: '$workers.cpuTimeMs', alias: 'max' },
    ],
    undefined,
    { '$metadata.trigger': trigger },
  );
  const value = (alias: string) =>
    Math.round(calcs.find((c) => c.alias === alias)?.aggregates[0]?.value ?? 0);
  return {
    route: label,
    stopped: 0,
    n: value('n'),
    p50: value('p50'),
    p90: value('p90'),
    p99: value('p99'),
    max: value('max'),
  };
}
let rows: Row[] = [];
for (let attempt = 0; attempt < 12; attempt++) {
  await sleep(10_000);
  rows = [];
  for (const r of ROUTES) rows.push(await stats(r.trigger, r.label, r.worker));
  if ((rows.find((r) => r.route.startsWith('PATCH /v1/admin/variants'))?.n ?? 0) >= BURST.bulk)
    break;
}

// Requests the Free plan stopped at its CPU limit (ADR 0013): one grouped
// query per Worker, once, so the step stays inside the job's time limit.
for (const worker of new Set(ROUTES.map((r) => r.worker ?? service))) {
  const calcs = await cf.workerLogStats(
    worker,
    since,
    Date.now(),
    [{ operator: 'count', alias: 'n' }],
    '$metadata.trigger',
    { '$workers.outcome': 'exceededCpu' },
  );
  const stopped = new Map(
    (calcs[0]?.aggregates ?? []).map((a) => [(a.groupKey ?? '').split(' ⬤ ')[0], a.value]),
  );
  ROUTES.forEach((r, i) => {
    const row = rows[i];
    if (row && (r.worker ?? service) === worker)
      row.stopped = Math.round(stopped.get(r.trigger) ?? 0);
  });
}

const table = [
  `### CPU per route on ${service} and ${storefrontWorker(pr)} (Workers Logs, ms)`,
  '',
  '| Route | Requests | Stopped for CPU | p50 | p90 | p99 | Max |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map(
    (r) => `| \`${r.route}\` | ${r.n} | ${r.stopped} | ${r.p50} | ${r.p90} | ${r.p99} | ${r.max} |`,
  ),
  '',
  'Storefront pages are all misses on previews (no page cache); a hit is measured by the production smoke. A row with 0 requests means Workers Logs names that trigger differently.',
  'Limits (ADR 0003): 10 ms per request on the Free plan, with headroom for occasional overruns; the daily alarm fires at request CPU above 250 ms p99 (API) or 100 ms p90 (storefront).',
].join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
