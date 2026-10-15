// CPU per route on a preview (ADR 0003, phase-1-plan §9), after the E2E:
// signs in as the run's phone owner, sends a burst of GET /v1/admin/me and
// PATCH /v1/admin/store so most land on warm isolates, then reads CPU time
// per route from Workers Logs since --since (which covers the E2E's
// sign-ins too). Writes a table to the step summary; it never fails a run.
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

const BURST = { me: 60, store: 30 };
const ROUTES = [
  'GET /v1/admin/me',
  'PATCH /v1/admin/store',
  'POST /api/auth/email-otp/send-verification-otp',
  'POST /api/auth/sign-in/email-otp',
  'GET /health',
];

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
notice(`Sent ${BURST.me} GET /v1/admin/me and ${BURST.store} PATCH /v1/admin/store`);

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
  rows = ROUTES.map((route) => ({
    route,
    n: value('n', route),
    p50: value('p50', route),
    p90: value('p90', route),
    p99: value('p99', route),
    max: value('max', route),
  }));
  if ((rows.find((r) => r.route === 'PATCH /v1/admin/store')?.n ?? 0) >= BURST.store) break;
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
