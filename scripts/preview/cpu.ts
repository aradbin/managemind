// CPU per route on a preview (ADR 0003, phase-1-plan §9, phase-2-plan §8),
// after the E2E: signs in as the run's phone owner and sends bursts so most
// requests land on warm isolates: GET /v1/admin/me, PATCH /v1/admin/store,
// and Phase 2's product list, product read, product save and bulk price
// edit on a product with 6 variants. Then reads CPU time per route from
// Workers Logs since --since, which covers the E2E's sign-ins and its
// imports: queue invocations (the import chunks) get their own rows. Writes
// a table to the step summary; it never fails a run.
//
//   tsx preview/cpu.ts --pr 12 --api-url <url> --since <epoch ms>
import { appendFileSync } from 'node:fs';
import { notice, parseArgs, prNumber, requireEnv } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';
import { sleep } from '../lib/http';
import { apiWorker } from './names';

const args = parseArgs(process.argv.slice(2));
const pr = prNumber(args);
const api = (args.get('api-url') ?? '').replace(/\/$/, '');
const since = Number(args.get('since'));
if (!api || !Number.isFinite(since)) throw new Error('--api-url and --since are required');
const devToken = requireEnv('DEV_TOKEN');
const owner = `e2e-${requireEnv('E2E_RUN')}-phone-owner@example.test`;
const cf = new Cloudflare(requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('CLOUDFLARE_ACCOUNT_ID'));

const BURST = { me: 60, store: 30, list: 30, read: 30, save: 20, bulk: 15 };

const jar = new Map<string, string>();
async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      origin: api,
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
await call('POST', '/api/auth/email-otp/send-verification-otp', { email: owner, type: 'sign-in' });
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
notice(
  `Sent ${BURST.me} GET /v1/admin/me, ${BURST.store} PATCH /v1/admin/store, ` +
    `${BURST.list} product lists, ${BURST.read} product reads, ${BURST.save} product saves ` +
    `and ${BURST.bulk} bulk edits of 6 variants`,
);

// Workers Logs groups by the request's own path, so the product's ID is in
// its rows; the table shows the route pattern.
const ROUTES: { trigger: string; label: string }[] = [
  { trigger: 'GET /v1/admin/me', label: 'GET /v1/admin/me' },
  { trigger: 'PATCH /v1/admin/store', label: 'PATCH /v1/admin/store' },
  { trigger: 'GET /v1/admin/products', label: 'GET /v1/admin/products' },
  { trigger: `GET ${productPath}`, label: 'GET /v1/admin/products/{id}' },
  { trigger: `PATCH ${productPath}`, label: 'PATCH /v1/admin/products/{id} (save)' },
  { trigger: 'PATCH /v1/admin/variants', label: 'PATCH /v1/admin/variants (bulk, 6)' },
  { trigger: 'POST /v1/admin/imports', label: 'POST /v1/admin/imports' },
  {
    trigger: 'POST /api/auth/email-otp/send-verification-otp',
    label: 'POST /api/auth/email-otp/send-verification-otp',
  },
  { trigger: 'POST /api/auth/sign-in/email-otp', label: 'POST /api/auth/sign-in/email-otp' },
  { trigger: 'GET /health', label: 'GET /health' },
];
const HTTP = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /;

// Workers Logs takes a little while to make new events queryable.
const service = apiWorker(pr);
type Row = { route: string; n: number; p50: number; p90: number; p99: number; max: number };
let rows: Row[] = [];
for (let attempt = 0; attempt < 12; attempt++) {
  await sleep(10_000);
  const calcs = await cf.workerLogStats(
    service,
    since,
    Date.now(),
    [
      { operator: 'count', alias: 'n' },
      { operator: 'median', key: '$workers.cpuTimeMs', alias: 'p50' },
      { operator: 'p90', key: '$workers.cpuTimeMs', alias: 'p90' },
      { operator: 'p99', key: '$workers.cpuTimeMs', alias: 'p99' },
      { operator: 'max', key: '$workers.cpuTimeMs', alias: 'max' },
    ],
    '$metadata.trigger',
  );
  const value = (alias: string, route: string) =>
    calcs.find((c) => c.alias === alias)?.aggregates.find((a) => a.groupKey === route)?.value ?? 0;
  const row = (trigger: string, label: string): Row => ({
    route: label,
    n: value('n', trigger),
    p50: value('p50', trigger),
    p90: value('p90', trigger),
    p99: value('p99', trigger),
    max: value('max', trigger),
  });
  // Queue and cron invocations aren't requests: the import chunks are among them.
  const others = (calcs.find((c) => c.alias === 'n')?.aggregates ?? [])
    .map((a) => a.groupKey ?? '')
    .filter((key) => key && !HTTP.test(key));
  rows = [
    ...ROUTES.map((r) => row(r.trigger, r.label)),
    ...others.map((key) => row(key, `${key} (not a request)`)),
  ];
  if ((rows.find((r) => r.route.startsWith('PATCH /v1/admin/variants'))?.n ?? 0) >= BURST.bulk)
    break;
}

const table = [
  `### CPU per route on ${service} (Workers Logs, ms)`,
  '',
  '| Route | Requests | p50 | p90 | p99 | Max |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| \`${r.route}\` | ${r.n} | ${r.p50} | ${r.p90} | ${r.p99} | ${r.max} |`),
  '',
  'Limits (ADR 0003): 10 ms per request on the Free plan, with headroom for occasional overruns; the daily alarm fires at API p99 above 50 ms.',
].join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
