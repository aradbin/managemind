// The load test (phase-5b-plan §11, §12 PR 18), run once before the pilot
// against a preview, which connects to Neon directly, so it costs no
// Hyperdrive queries. About 3,000 requests at a steady concurrency, shaped
// like shoppers: mostly catalog pages, then carts, and a few COD checkouts.
// It reports status codes, errors, requests stopped by the CPU limit,
// and latency percentiles; with the Workers' names it also reads their CPU
// time from Workers Logs for the run's window.
//
//   tsx load/run.ts --storefront-url <url> --api-url <url> --store-host demo-fashion.<store domain>
//     [--store demo-fashion] [--requests 3000] [--concurrency 20] [--orders 20]
//     [--api-worker <name> --storefront-worker <name>]   (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)
import { notice, parseArgs, summary } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';

const args = parseArgs(process.argv.slice(2));
const storefront = (args.get('storefront-url') ?? '').replace(/\/$/, '');
const api = (args.get('api-url') ?? '').replace(/\/$/, '');
const store = args.get('store') ?? 'demo-fashion';
const storeHost = args.get('store-host') ?? `${store}.localhost`;
const total = Number(args.get('requests') ?? 3000);
const concurrency = Number(args.get('concurrency') ?? 20);
const orders = Number(args.get('orders') ?? 20);
if (!storefront || !api) throw new Error('--storefront-url and --api-url are required');

/** The demo catalog's pages (scripts/demo/catalog.ts), weighted as shoppers browse. */
const PAGES: { path: string; query?: string; weight: number }[] = [
  { path: '/', weight: 30 },
  { path: '/categories/sarees', weight: 20 },
  { path: '/products/red-jamdani-saree', weight: 30 },
  { path: '/search', query: 'q=saree', weight: 10 },
  { path: '/pages/about-us', weight: 10 },
];

type Kind = 'page' | 'cart' | 'checkout';
interface Sample {
  kind: Kind;
  status: number;
  ms: number;
}
const samples: Sample[] = [];

/** One request, timed; its body is read, so the time covers the whole answer. */
async function timed(
  kind: Kind,
  run: () => Promise<Response>,
): Promise<{ ok: boolean; text: string } | null> {
  const start = performance.now();
  try {
    const res = await run();
    const text = await res.text().catch(() => '');
    samples.push({ kind, status: res.status, ms: performance.now() - start });
    return { ok: res.ok, text };
  } catch {
    samples.push({ kind, status: 0, ms: performance.now() - start });
    return null;
  }
}

function pickPage() {
  let r = Math.random() * PAGES.reduce((n, p) => n + p.weight, 0);
  for (const p of PAGES) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return PAGES[0] as (typeof PAGES)[number];
}

const page = () => {
  const p = pickPage();
  return timed('page', () =>
    fetch(`${storefront}${p.path}?${p.query ? `${p.query}&` : ''}store=${store}`),
  );
};

/** A shopper's cart through the storefront's /api proxy, keeping its cookie. */
function shopper() {
  const cookie = new Map<string, string>();
  return async (method: string, path: string, kind: Kind, body?: unknown) =>
    timed(kind, async () => {
      const res = await fetch(`${storefront}/api${path}?store=${store}`, {
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
    });
}

// A variant to put in carts: the demo product's first.
const product = (await (
  await fetch(`${api}/v1/store/pages/products/red-jamdani-saree`, {
    headers: { 'x-forwarded-host': storeHost },
  })
).json()) as { page?: { product?: { variants?: { id: string }[] } } };
const variantId = product.page?.product?.variants?.[0]?.id;
if (!variantId) throw new Error(`no demo product on ${storeHost}: is the demo catalog there?`);
const DHANMONDI = { divisionId: 6, districtId: 47, areaId: 513 };

let checkouts = 0;
/** The first refused checkout's answer, which says why. */
let refusal = '';
async function cartSession() {
  const call = shopper();
  await call('POST', '/cart/lines', 'cart', { variantId, quantity: 1 });
  await call('PUT', '/cart/area', 'cart', { areaId: DHANMONDI.areaId });
  const res = await call('GET', '/cart', 'cart');
  if (checkouts >= orders || !res?.ok) return;
  checkouts++;
  const cart = JSON.parse(res.text || 'null') as { totals?: { total: number } } | null;
  const out = await call('POST', '/checkout/orders', 'checkout', {
    contact: { name: 'Load Test', phone: `+8801700${String(800_000 + checkouts)}` },
    address: { ...DHANMONDI, line: 'House 1, Road 2' },
    paymentMethod: 'cod',
    expectedTotal: cart?.totals?.total ?? 0,
    acceptTerms: true,
  });
  if (out && !out.ok && !refusal) refusal = out.text.slice(0, 300);
}

const since = Date.now();
let sent = 0;
async function worker() {
  while (sent < total) {
    sent++;
    // About one in eight is a shopper's cart (three requests, sometimes a checkout).
    if (Math.random() < 0.125) await cartSession();
    else await page();
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
const seconds = (Date.now() - since) / 1000;

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0) : 0;
};
const rows = (['page', 'cart', 'checkout'] as const).map((kind) => {
  const xs = samples.filter((s) => s.kind === kind);
  const ms = xs.map((s) => s.ms);
  return {
    kind,
    n: xs.length,
    errors: xs.filter((s) => s.status === 0 || s.status >= 500).length,
    limited: xs.filter((s) => s.status === 429).length,
    refused: xs.filter((s) => s.status >= 400 && s.status < 500 && s.status !== 429).length,
    p50: pct(ms, 0.5),
    p99: pct(ms, 0.99),
  };
});

let cpu = '';
const workers = [args.get('api-worker'), args.get('storefront-worker')].filter(Boolean) as string[];
if (workers.length && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) {
  // Workers Logs needs a minute to have every invocation.
  await new Promise((r) => setTimeout(r, 60_000));
  const cf = new Cloudflare(process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID);
  const lines: string[] = [];
  for (const name of workers) {
    const stopped = await cf.workerLogStats(
      name,
      since,
      Date.now(),
      [{ operator: 'count', alias: 'n' }],
      undefined,
      {
        '$workers.outcome': 'exceededCpu',
      },
    );
    const value = (alias: string, list: { alias: string; aggregates: { value: number }[] }[]) =>
      list.find((c) => c.alias === alias)?.aggregates[0]?.value ?? 0;
    const all = await cf.workerLogStats(name, since, Date.now(), [
      { operator: 'count', alias: 'n' },
      { operator: 'median', key: '$workers.cpuTimeMs', alias: 'p50' },
      { operator: 'p99', key: '$workers.cpuTimeMs', alias: 'p99' },
    ]);
    lines.push(
      `| ${name} | ${value('n', all)} | ${value('p50', all).toFixed(1)} ms | ${value('p99', all).toFixed(1)} ms | ${stopped[0]?.aggregates[0]?.value ?? 0} |`,
    );
  }
  cpu = `\n\n| Worker | Invocations | CPU p50 | CPU p99 | Stopped at the CPU limit |\n| --- | --- | --- | --- | --- |\n${lines.join('\n')}`;
}

summary(
  `### Load test: ${samples.length} requests in ${seconds.toFixed(0)} s at ${concurrency} at a time\n\n` +
    `| Kind | Requests | Errors (5xx or none) | Rate limited | Other 4xx | p50 | p99 |\n| --- | --- | --- | --- | --- | --- | --- |\n` +
    rows
      .map(
        (r) =>
          `| ${r.kind} | ${r.n} | ${r.errors} | ${r.limited} | ${r.refused} | ${r.p50} ms | ${r.p99} ms |`,
      )
      .join('\n') +
    `\n\n${checkouts} checkouts tried.${refusal ? ` The first refused: \`${refusal}\`` : ''}${cpu}`,
);
const errors = rows.reduce((n, r) => n + r.errors, 0);
notice(`load test: ${samples.length} requests, ${errors} errors`);
if (errors > samples.length * 0.01) process.exitCode = 1;
