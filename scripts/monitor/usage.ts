// The daily usage alarm (ADR 0013, phase-0-plan §9). Checks the last 24 hours
// against the free plans and the CPU thresholds, writes a table to the job
// summary, and on any alarm opens (or comments on) a GitHub issue assigned to
// the owner and exits 1.
//
//   tsx monitor/usage.ts [--test]   # --test adds one forced alarm, to check the notification
//
// Thresholds:
// - any request (fetch) stopped for CPU or memory on the API or storefront:
//   the trigger to move to Workers Paid (ADR 0013). Import chunks (the API's
//   queue invocations) stopped for CPU are reported but not an alarm: the
//   owner accepted them on the Free plan, and the queue retries them
//   (phase-2-report §3);
// - request CPU, API p99 above 250 ms, storefront p90 above 100 ms:
//   investigate (ADR 0003, raised Oct 16 to about twice what production
//   uses, so the alarm flags regressions rather than the known baseline).
//   Only judged on at least 200 requests a day: below that, p99 is the
//   slowest single request, usually a cold start;
// - any free-plan limit above 70% (PLAN.md growth table).
//
// The numbers also go to R2 as platform/usage/latest.json, which the
// platform dashboard reads (phase-5b-plan §3.3, Q12): as of this morning, at
// no query cost, and the alarm stays their single source.
import { notice, parseArgs, requireEnv, warning } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';
import { apiClient } from '../lib/http';
import { Neon } from '../lib/neon';

const DAY = 24 * 3600 * 1000;
const MIN_REQUESTS = 200;
const SHARE = 0.7;
/** Outcomes that mean Cloudflare stopped the request: the Workers Paid trigger. */
const TERMINATED = ['exceededCpu', 'exceededResources', 'exceededMemory'];

interface Check {
  check: string;
  value: string;
  limit: string;
  alarm: boolean;
}

const cf = new Cloudflare(requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('CLOUDFLARE_ACCOUNT_ID'));
const neon = new Neon(requireEnv('NEON_API_KEY'), requireEnv('NEON_PROJECT_ID'));
const to = Date.now();
const from = to - DAY;
const checks: Check[] = [];
/** The free-plan numbers, for the platform dashboard. */
const limits: { name: string; used: number; limit: number; unit: string; share: number }[] = [];

/** Runs one group of checks; a group that cannot run is itself an alarm. */
async function section(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    checks.push({
      check: `${name}: could not check`,
      value: e instanceof Error ? e.message.slice(0, 200) : String(e),
      limit: 'must be readable (see the token permissions in docs/setup)',
      alarm: true,
    });
  }
}

// Workers Logs: outcomes and CPU per Worker. Analytics reports newer Workers
// as "__unknown__", so per-Worker numbers come from the logs.
for (const [worker, percentile, limitMs] of [
  ['managemind-api', 'p99', 250],
  ['managemind-storefront', 'p90', 100],
] as const) {
  await section(`${worker} (Workers Logs)`, async () => {
    const outcomesOf = async (eventType: string) => {
      const [stats] = await cf.workerLogStats(
        worker,
        from,
        to,
        [{ operator: 'count', alias: 'n' }],
        '$workers.outcome',
        { '$workers.eventType': eventType },
      );
      return new Map((stats?.aggregates ?? []).map((a) => [a.groupKey ?? '', a.value]));
    };
    const byOutcome = await outcomesOf('fetch');
    const total = [...byOutcome.values()].reduce((a, b) => a + b, 0);
    const terminated = TERMINATED.reduce((n, o) => n + (byOutcome.get(o) ?? 0), 0);
    checks.push({
      check: `${worker}: requests stopped for CPU or memory`,
      value: `${terminated} of ${total}`,
      limit: '0 (any means Workers Paid)',
      alarm: terminated > 0,
    });

    if (worker === 'managemind-api') {
      const chunks = await outcomesOf('queue');
      const chunkTotal = [...chunks.values()].reduce((a, b) => a + b, 0);
      const chunkStopped = TERMINATED.reduce((n, o) => n + (chunks.get(o) ?? 0), 0);
      checks.push({
        check: `${worker}: queue invocations (import chunks) stopped for CPU`,
        value: `${chunkStopped} of ${chunkTotal}`,
        limit: 'reported only (retried; accepted on Free)',
        alarm: false,
      });
    }

    const [cpu] = await cf.workerLogStats(
      worker,
      from,
      to,
      [{ operator: percentile, key: '$workers.cpuTimeMs', alias: percentile }],
      undefined,
      { '$workers.eventType': 'fetch' },
    );
    const ms = cpu?.aggregates[0]?.value;
    const judged = total >= MIN_REQUESTS;
    checks.push({
      check: `${worker}: request ${percentile} CPU`,
      value:
        ms === undefined
          ? 'no requests'
          : `${ms} ms${judged ? '' : ` (${total} requests, not judged)`}`,
      limit: `${limitMs} ms`,
      alarm: judged && ms !== undefined && ms > limitMs,
    });
  });
}

// Account-wide free-plan limits (GraphQL Analytics, last 24 hours).
const window = { since: new Date(from).toISOString(), until: new Date(to).toISOString() };
await section('Account usage (GraphQL Analytics)', async () => {
  const account = await cf.analytics<{
    viewer: {
      accounts: {
        workers: { sum: { requests: number } }[];
        hyperdrive: { count: number }[];
        queues: { sum: { billableOperations: number } }[];
        kv: { sum: { requests: number } }[];
      }[];
    };
  }>(
    `query($acct: String!, $since: Time!, $until: Time!) { viewer { accounts(filter: {accountTag: $acct}) {
    workers: workersInvocationsAdaptive(limit: 1, filter: {datetime_geq: $since, datetime_leq: $until}) { sum { requests } }
    hyperdrive: hyperdriveQueriesAdaptiveGroups(limit: 1, filter: {datetime_geq: $since, datetime_leq: $until}) { count }
    queues: queueMessageOperationsAdaptiveGroups(limit: 1, filter: {datetime_geq: $since, datetime_leq: $until}) { sum { billableOperations } }
    kv: kvOperationsAdaptiveGroups(limit: 1, filter: {datetime_geq: $since, datetime_leq: $until, actionType: "write"}) { sum { requests } }
  } } }`,
    window,
  );
  const a = account.viewer.accounts[0];
  for (const [name, used, limit] of [
    ['Worker requests (account)', a?.workers[0]?.sum.requests ?? 0, 100_000],
    ['Hyperdrive queries', a?.hyperdrive[0]?.count ?? 0, 100_000],
    ['Queue operations', a?.queues[0]?.sum.billableOperations ?? 0, 10_000],
    ['KV writes', a?.kv[0]?.sum.requests ?? 0, 1_000],
  ] as const) {
    checks.push(share(`${name}, last 24 hours`, used, limit, ''));
  }
});

// Neon: this billing period's compute, and storage across branches.
await section('Neon', async () => {
  const usage = await neon.usage();
  const cuHours = usage.computeSeconds / 3600;
  const start = Date.parse(usage.periodStart);
  const elapsed = Math.max((to - start) / (30 * DAY), 1 / 30);
  const compute = share('Neon compute this month', cuHours, 100, ' CU-hours');
  compute.value += ` (on pace for ${(cuHours / elapsed).toFixed(1)})`;
  checks.push(compute);
  checks.push(share('Neon storage (all branches)', usage.branchBytes / 2 ** 20, 512, ' MiB'));
});

if (parseArgs(process.argv.slice(2)).has('test')) {
  checks.push({ check: 'Test alarm (manual run)', value: 'forced', limit: '—', alarm: true });
}

// Dead letters, for the dashboard: messages that failed every retry.
// Not an alarm: a count that can't be read shows as unknown.
const deadLetters: Record<string, number | null> = {};
for (const [name, queue] of [
  ['outbox', 'managemind-outbox-dlq'],
  ['imports', 'managemind-imports-dlq'],
] as const) {
  deadLetters[name] = await cf
    .queueId(queue)
    .then((id) => cf.queueBacklog(id))
    .catch(() => null);
}

// Report.
const alarms = checks.filter((c) => c.alarm);
try {
  await cf.r2PutJson('managemind-files', 'platform/usage/latest.json', {
    generatedAt: new Date(to).toISOString(),
    window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    limits,
    deadLetters,
    checks,
    alarms: alarms.length,
  });
} catch (e) {
  // The dashboard shows an older file; the alarm itself still runs.
  warning(`could not write platform/usage/latest.json: ${(e as Error).message}`);
}
const table = [
  '| | Check | Value | Limit |',
  '| --- | --- | --- | --- |',
  ...checks.map((c) => `| ${c.alarm ? '🔴' : '🟢'} | ${c.check} | ${c.value} | ${c.limit} |`),
].join('\n');
console.log(table);
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(summary, `### Usage, last 24 hours\n\n${table}\n`);
}

if (alarms.length === 0) {
  notice('All usage checks are within their limits');
} else {
  for (const c of alarms)
    console.log(`::error title=Usage alarm::${c.check}: ${c.value} (limit ${c.limit})`);
  await reportIssue(table);
  process.exit(1);
}

function share(check: string, used: number, limit: number, unit: string): Check {
  limits.push({ name: check, used, limit, unit: unit.trim(), share: used / limit });
  const round = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en') : n.toFixed(1));
  return {
    check,
    value: `${round(used)}${unit} (${Math.round((100 * used) / limit)}%)`,
    limit: `${limit.toLocaleString('en')}${unit}; alarm above ${SHARE * 100}%`,
    alarm: used > SHARE * limit,
  };
}

/** One open issue per alarm streak: created on the first day, commented on after. */
async function reportIssue(table: string): Promise<void> {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return;
  const github = apiClient('https://api.github.com', token, 'GitHub');
  const run = `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const body = [
    `The daily usage check found ${alarms.length} alarm${alarms.length === 1 ? '' : 's'} ([run](${run})).`,
    '',
    table,
    '',
    'What to do: a stopped request means moving to Workers Paid (ADR 0013); a CPU percentile over its limit means finding the slow route (ADR 0003); a free-plan limit above 70% means planning the upgrade (PLAN.md growth table). Close this issue once it is handled.',
  ].join('\n');
  const open = await github.request<{ number: number }[]>(
    'GET',
    `/repos/${repo}/issues?labels=usage-alarm&state=open&per_page=1`,
  );
  const existing = open[0];
  if (existing) {
    await github.request('POST', `/repos/${repo}/issues/${existing.number}/comments`, { body });
  } else {
    await github.request('POST', `/repos/${repo}/issues`, {
      title: 'Usage alarm',
      body,
      labels: ['usage-alarm'],
      ...(process.env.OWNER ? { assignees: [process.env.OWNER] } : {}),
    });
  }
}
