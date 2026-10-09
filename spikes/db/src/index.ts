// Spike: database path (docs/phases/phase-0-plan.md §3.1, ADR 0002).
// Throwaway code: measures a "set tenant + 3 queries" transaction through
// Hyperdrive (node-postgres, postgres.js, Drizzle) and Neon's serverless
// driver (HTTP, WebSocket), and checks that tenant context never leaks
// between pooled transactions.
import { neon, Pool } from '@neondatabase/serverless';
import { sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import postgres from 'postgres';

interface Env {
  HYPERDRIVE: Hyperdrive;
  NEON_URL: string;
  SPIKE_TOKEN: string;
  PLACEMENT: string;
  PEER_URL?: string;
}

const TENANTS = {
  A: '0199d000-0000-7000-8000-00000000000a',
  B: '0199d000-0000-7000-8000-00000000000b',
} as const;
type TenantKey = keyof typeof TENANTS;

const Q_COUNT = 'select count(*)::int as n from store.notes';
const Q_LIST = 'select id, title, price from store.notes order by created_at desc limit 20';
const Q_ONE = 'select id, title, price from store.notes where id = $1';

const DRIVERS = [
  'pg',
  'pg-packed',
  'drizzle-pg',
  'postgresjs',
  'neon-http',
  'neon-ws',
  'pg-connect',
] as const;
type Driver = (typeof DRIVERS)[number];

type Step = [label: string, ms: number];

class Timer {
  private last = performance.now();
  readonly steps: Step[] = [];
  private readonly start = this.last;
  lap(label: string) {
    const now = performance.now();
    this.steps.push([label, Math.round((now - this.last) * 10) / 10]);
    this.last = now;
  }
  total() {
    return Math.round((performance.now() - this.start) * 10) / 10;
  }
}

interface RunResult {
  driver: Driver;
  ok: boolean;
  totalMs: number;
  roundTrips: number;
  steps: Step[];
  rows: { count: number; listed: number; foreign: number };
  error?: string;
}

async function runPg(env: Env, tenant: string, packed: boolean): Promise<RunResult> {
  const t = new Timer();
  const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  t.lap('connect');
  try {
    if (packed) {
      // Two statements, one round trip. The tenant ID is a validated UUID constant.
      await client.query(`begin; select set_config('app.tenant_id', '${tenant}', true)`);
      t.lap('begin+set_tenant');
    } else {
      await client.query('begin');
      t.lap('begin');
      await client.query("select set_config('app.tenant_id', $1, true)", [tenant]);
      t.lap('set_tenant');
    }
    const c = await client.query<{ n: number }>(Q_COUNT);
    t.lap('q_count');
    const l = await client.query<{ id: string; title: string }>(Q_LIST);
    t.lap('q_list');
    const firstId = l.rows[0]?.id ?? '00000000-0000-0000-0000-000000000000';
    await client.query(Q_ONE, [firstId]);
    t.lap('q_one');
    await client.query('commit');
    t.lap('commit');
    return result(packed ? 'pg-packed' : 'pg', t, packed ? 5 : 6, c.rows[0]?.n, l.rows, tenant);
  } finally {
    await client.end();
  }
}

// Isolates the cost of opening (and authenticating) a connection to Hyperdrive.
async function runPgConnectOnly(env: Env): Promise<RunResult> {
  const t = new Timer();
  const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  t.lap('connect');
  await client.end();
  t.lap('end');
  return {
    driver: 'pg-connect',
    ok: true,
    totalMs: t.total(),
    roundTrips: 0,
    steps: t.steps,
    rows: { count: 0, listed: 0, foreign: 0 },
  };
}

async function runDrizzle(env: Env, tenant: string): Promise<RunResult> {
  const t = new Timer();
  const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  t.lap('connect');
  try {
    const db = drizzle(client);
    const out = await db.transaction(async (tx) => {
      await tx.execute(dsql`select set_config('app.tenant_id', ${tenant}, true)`);
      t.lap('begin+set_tenant');
      const c = await tx.execute<{ n: number }>(dsql.raw(Q_COUNT));
      t.lap('q_count');
      const l = await tx.execute<{ id: string; title: string }>(dsql.raw(Q_LIST));
      t.lap('q_list');
      const firstId = l.rows[0]?.id ?? '00000000-0000-0000-0000-000000000000';
      await tx.execute(dsql`select id, title, price from store.notes where id = ${firstId}`);
      t.lap('q_one');
      return { n: c.rows[0]?.n, rows: l.rows };
    });
    t.lap('commit');
    return result('drizzle-pg', t, 6, out.n, out.rows, tenant);
  } finally {
    await client.end();
  }
}

async function runPostgresJs(env: Env, tenant: string, ctx: ExecutionContext): Promise<RunResult> {
  const t = new Timer();
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 1, fetch_types: false });
  try {
    const out = await sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenant}, true)`;
      t.lap('connect+begin+set_tenant');
      const c = await tx.unsafe<{ n: number }[]>(Q_COUNT);
      t.lap('q_count');
      const l = await tx.unsafe<{ id: string; title: string }[]>(Q_LIST);
      t.lap('q_list');
      const firstId = l[0]?.id ?? '00000000-0000-0000-0000-000000000000';
      await tx.unsafe(Q_ONE, [firstId]);
      t.lap('q_one');
      return { n: c[0]?.n, rows: [...l] };
    });
    t.lap('commit');
    return result('postgresjs', t, 6, out.n, out.rows, tenant);
  } finally {
    ctx.waitUntil(sql.end());
  }
}

async function runNeonHttp(env: Env, tenant: string): Promise<RunResult> {
  const t = new Timer();
  const sql = neon(env.NEON_URL);
  // HTTP mode has no interactive transactions: one batch, one round trip.
  // q_one cannot depend on q_list, so it looks up a fixed position instead.
  const [, c, l] = await sql.transaction([
    sql`select set_config('app.tenant_id', ${tenant}, true)`,
    sql.query(Q_COUNT),
    sql.query(Q_LIST),
    sql.query(
      'select id, title, price from store.notes where id = (select id from store.notes order by created_at desc limit 1)',
    ),
  ]);
  t.lap('batch');
  const rows = l as { id: string; title: string }[];
  return result('neon-http', t, 1, (c as { n: number }[])[0]?.n, rows, tenant);
}

async function runNeonWs(env: Env, tenant: string, ctx: ExecutionContext): Promise<RunResult> {
  const t = new Timer();
  const pool = new Pool({ connectionString: env.NEON_URL });
  const client = await pool.connect();
  t.lap('connect');
  try {
    await client.query('begin');
    t.lap('begin');
    await client.query("select set_config('app.tenant_id', $1, true)", [tenant]);
    t.lap('set_tenant');
    const c = await client.query<{ n: number }>(Q_COUNT);
    t.lap('q_count');
    const l = await client.query<{ id: string; title: string }>(Q_LIST);
    t.lap('q_list');
    const firstId = l.rows[0]?.id ?? '00000000-0000-0000-0000-000000000000';
    await client.query(Q_ONE, [firstId]);
    t.lap('q_one');
    await client.query('commit');
    t.lap('commit');
    return result('neon-ws', t, 6, c.rows[0]?.n, l.rows, tenant);
  } finally {
    client.release();
    ctx.waitUntil(pool.end());
  }
}

function result(
  driver: Driver,
  t: Timer,
  roundTrips: number,
  count: number | undefined,
  rows: { title: string }[],
  tenant: string,
): RunResult {
  const own = tenant === TENANTS.A ? 'A ' : 'B ';
  return {
    driver,
    ok: true,
    totalMs: t.total(),
    roundTrips,
    steps: t.steps,
    rows: {
      count: Number(count ?? -1),
      listed: rows.length,
      foreign: rows.filter((r) => !r.title.startsWith(own)).length,
    },
  };
}

async function run(driver: Driver, env: Env, tenant: string, ctx: ExecutionContext) {
  try {
    switch (driver) {
      case 'pg':
        return await runPg(env, tenant, false);
      case 'pg-packed':
        return await runPg(env, tenant, true);
      case 'drizzle-pg':
        return await runDrizzle(env, tenant);
      case 'postgresjs':
        return await runPostgresJs(env, tenant, ctx);
      case 'neon-http':
        return await runNeonHttp(env, tenant);
      case 'neon-ws':
        return await runNeonWs(env, tenant, ctx);
      case 'pg-connect':
        return await runPgConnectOnly(env);
    }
  } catch (e) {
    return {
      driver,
      ok: false,
      totalMs: -1,
      roundTrips: 0,
      steps: [],
      rows: { count: -1, listed: 0, foreign: 0 },
      error: String(e),
    } satisfies RunResult;
  }
}

// Interleaves many transactions for both tenants on the shared Hyperdrive pool.
// With poison=1, every fifth task also sets the tenant at session level
// (is_local = false), the pattern the plan forbids, to show whether it
// survives on pooled connections. With guarded=1 the queries go to a table
// whose policy only trusts a tenant set in the current transaction.
async function leakTest(env: Env, n: number, poison: boolean, guarded: boolean) {
  const table = guarded ? 'store.notes_guarded' : 'store.notes';
  const setLocal = guarded
    ? "select set_config('app.tenant_id', $1, true), set_config('app.tenant_at', now()::text, true)"
    : "select set_config('app.tenant_id', $1, true)";
  const setSession = guarded
    ? "select set_config('app.tenant_id', $1, false), set_config('app.tenant_at', now()::text, false)"
    : "select set_config('app.tenant_id', $1, false)";
  const tasks = Array.from({ length: n }, async (_, i) => {
    const key: TenantKey = i % 2 === 0 ? 'A' : 'B';
    const tenant = TENANTS[key];
    const sessionLevel = poison && i % 5 === 4;
    const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
    await client.connect();
    try {
      if (sessionLevel) await client.query(setSession, [tenant]);
      await client.query('begin');
      await client.query(setLocal, [tenant]);
      const r = await client.query<{ total: number; foreign: number; pid: number }>(
        `select count(*)::int as total,
                count(*) filter (where title not like '${key} %')::int as foreign,
                pg_backend_pid() as pid
           from ${table}`,
      );
      await client.query('commit');
      // Outside any transaction: must see no rows.
      const after = await client.query<{ rows: number; setting: string | null }>(
        `select (select count(*)::int from ${table}) as rows,
                nullif(current_setting('app.tenant_id', true), '') as setting`,
      );
      return {
        own: tenant,
        sessionLevel,
        total: r.rows[0]?.total ?? -1,
        foreign: r.rows[0]?.foreign ?? -1,
        pid: r.rows[0]?.pid ?? -1,
        rowsWithoutContext: after.rows[0]?.rows ?? -1,
        leftover: after.rows[0]?.setting ?? null,
      };
    } finally {
      await client.end();
    }
  });
  const results = await Promise.all(tasks);
  const clean = results.filter((r) => !r.sessionLevel);
  return {
    table,
    poison,
    transactions: results.length,
    backendPids: new Set(results.map((r) => r.pid)).size,
    insideTxn: {
      wrongTotals: results.filter((r) => r.total !== 500).length,
      foreignRows: results.reduce((s, r) => s + r.foreign, 0),
    },
    afterCommit: {
      rowsSeen: results.reduce((s, r) => s + Math.max(r.rowsWithoutContext, 0), 0),
      leftoverSettings: results.filter((r) => r.leftover !== null).length,
      // Leftovers on clients that never set anything at session level, and
      // leftovers naming the other tenant: proof the state came from the pool.
      leftoversOnCleanClients: clean.filter((r) => r.leftover !== null).length,
      otherTenantLeftovers: results.filter((r) => r.leftover !== null && r.leftover !== r.own)
        .length,
    },
  };
}

async function executionColo(): Promise<string> {
  try {
    const res = await fetch('https://www.cloudflare.com/cdn-cgi/trace');
    const m = /colo=([A-Z]+)/.exec(await res.text());
    return m?.[1] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'cf-placement',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.searchParams.get('k') !== env.SPIKE_TOKEN) {
      return new Response('not found', { status: 404 });
    }
    const cf = (request.cf ?? {}) as { colo?: string; country?: string; asOrganization?: string };

    if (url.pathname === '/run') {
      const driver = url.searchParams.get('driver') as Driver;
      if (!DRIVERS.includes(driver)) return json({ error: 'unknown driver' }, 400);
      const key = (url.searchParams.get('tenant') ?? 'A') as TenantKey;
      const tenant = TENANTS[key] ?? TENANTS.A;
      const trace = url.searchParams.get('trace') !== '0';
      const [res, execColo] = await Promise.all([
        run(driver, env, tenant, ctx),
        trace ? executionColo() : Promise.resolve('skipped'),
      ]);
      const record = {
        spike: 'db',
        placement: env.PLACEMENT,
        entryColo: cf.colo,
        execColo,
        country: cf.country,
        network: cf.asOrganization,
        source: url.searchParams.get('src') ?? 'direct',
        ...res,
      };
      console.log(JSON.stringify(record));
      return json(record);
    }

    if (url.pathname === '/leak') {
      const n = Math.min(Number(url.searchParams.get('n') ?? 20), 50);
      const poison = url.searchParams.get('poison') === '1';
      const guarded = url.searchParams.get('guarded') === '1';
      const out = await leakTest(env, n, poison, guarded);
      console.log(JSON.stringify({ spike: 'db-leak', placement: env.PLACEMENT, ...out }));
      return json(out);
    }

    if (url.pathname === '/') {
      return new Response(page(env, url.searchParams.get('k') ?? ''), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// A small page for measuring from real Bangladeshi networks. It calls this
// Worker and its peer (the other placement) and shows the timings.
function page(env: Env, token: string) {
  const targets = [{ name: env.PLACEMENT, base: '' }];
  if (env.PEER_URL) targets.push({ name: 'peer', base: env.PEER_URL });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Database speed test</title>
<style>body{font:15px system-ui,sans-serif;margin:16px;max-width:720px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #ddd;padding:4px;text-align:left}
button{font-size:16px;padding:10px 16px}#s{margin:12px 0}</style></head><body>
<h1>Database speed test</h1>
<p>Press the button once. It takes about a minute. Results are saved automatically; you can close the page when it says "Done".</p>
<button id="b">Start</button><div id="s"></div>
<table><thead><tr><th>Server</th><th>Driver</th><th>Ran at</th><th>DB time</th><th>Page wait</th></tr></thead><tbody id="t"></tbody></table>
<script>
const token=${JSON.stringify(token)};const targets=${JSON.stringify(targets)};
const drivers=${JSON.stringify(DRIVERS)};
document.getElementById('b').onclick=async()=>{
 const b=document.getElementById('b'),s=document.getElementById('s'),t=document.getElementById('t');b.disabled=true;
 const src=(navigator.connection&&navigator.connection.type)||'browser';
 for(let round=1;round<=3;round++){for(const tg of targets){for(const d of drivers){
  s.textContent='Round '+round+' of 3: '+tg.name+' / '+d;
  const t0=performance.now();
  try{const r=await fetch(tg.base+'/run?driver='+d+'&k='+token+'&src='+encodeURIComponent(src+'-r'+round));
   const j=await r.json();const wait=Math.round(performance.now()-t0);
   const tr=document.createElement('tr');tr.innerHTML='<td>'+j.placement+'</td><td>'+d+'</td><td>'+j.entryColo+' / '+j.execColo+'</td><td>'+(j.ok?j.totalMs+' ms':'error')+'</td><td>'+wait+' ms</td>';t.appendChild(tr);
  }catch(e){const tr=document.createElement('tr');tr.innerHTML='<td>'+tg.name+'</td><td>'+d+'</td><td colspan=3>failed: '+e+'</td>';t.appendChild(tr);}
 }}}
 s.textContent='Done. Thank you!';
};
</script></body></html>`;
}
