// CPU per route on a preview (ADR 0003, phase-1-plan §9, phase-2-plan §8),
// after the E2E: signs in as the run's phone owner and sends bursts so most
// requests land on warm isolates: GET /v1/admin/me, PATCH /v1/admin/store,
// and Phase 2's product list, product read, product save and bulk price
// edit on a product with 6 variants. Then reads CPU time per route from
// Workers Logs since --since, which covers the E2E's sign-ins and its
// imports: queue invocations (the import chunks) get their own rows. Writes
// a table to the step summary; it never fails a run.
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
//   tsx preview/cpu.ts --pr 12 --api-url <url> --storefront-url <url> --since <epoch ms>
import { appendFileSync } from 'node:fs';
import { notice, parseArgs, prNumber, requireEnv } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';
import { sleep } from '../lib/http';
import { apiWorker, importQueue, storefrontWorker } from './names';

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
  const res = await callOnce(method, path, body);
  if (res.status < 500) return res;
  await res.body?.cancel();
  return callOnce(method, path, body);
}

async function callOnce(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      origin: api,
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
  const placed = await json<{ id: string }>(
    await shop('POST', '/checkout/orders', cookie, {
      contact: { name: 'CPU', phone: `+8801700${String(900_000 + i)}` },
      address: { ...DHANMONDI, line: 'House 1, Road 2' },
      paymentMethod: 'cod',
      expectedTotal: cart.totals.total,
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    }),
    'place order',
  );
  placedId = placed.id;
}
for (let i = 0; i < BURST.orders; i++) await call('GET', '/v1/admin/orders');
for (let i = 0; placedId && i < BURST.orders; i++) {
  await call('GET', `/v1/admin/orders/${placedId}`);
}
if (failures.length) {
  notice(`${failures.length} requests in the bursts failed: ${failures.slice(0, 10).join('; ')}`);
}

notice(
  `Sent ${BURST.page} of each storefront page (${STORE_PAGES.map((p) => p.label).join(', ')}), ` +
    `${BURST.me} GET /v1/admin/me, ${BURST.store} PATCH /v1/admin/store, ` +
    `${BURST.list} product lists, ${BURST.read} product reads, ${BURST.save} product saves ` +
    `${BURST.bulk} bulk edits of 6 variants, ${BURST.order} orders (cart, area, checkout), ` +
    `${BURST.cart} cart reads and ${BURST.orders} each of the order list and an order`,
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
  { trigger: importQueue(pr), label: 'Import chunk (queue, up to 10 products)' },
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
  // Requests the Free plan stopped at its CPU limit (ADR 0013).
  const stopped = await cf.workerLogStats(
    worker,
    since,
    Date.now(),
    [{ operator: 'count', alias: 'n' }],
    undefined,
    { '$metadata.trigger': trigger, '$workers.outcome': 'exceededCpu' },
  );
  return {
    route: label,
    stopped: Math.round(stopped[0]?.aggregates[0]?.value ?? 0),
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
