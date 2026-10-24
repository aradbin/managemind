// What a restored backup must show (phase-5b-plan §3.14): every table of the
// source is there, each table's rows are within a day's growth of the
// source's, and the newest order is recent. The monthly restore test runs
// it against production; CI runs it against the test database.
import type pg from 'pg';

export interface RestoreReport {
  ok: boolean;
  tables: number;
  rows: { source: number; restored: number };
  /** Hours since the newest order in the restored copy, or null without orders. */
  newestOrderHours: number | null;
  problems: string[];
}

const SCHEMAS = ['platform', 'store', 'ref'];

async function tableCounts(client: pg.Client): Promise<Map<string, number>> {
  const { rows } = await client.query<{ name: string }>(
    `select table_schema || '.' || table_name as name from information_schema.tables
      where table_schema = any($1::text[]) and table_type = 'BASE TABLE' order by 1`,
    [SCHEMAS],
  );
  const counts = new Map<string, number>();
  for (const { name } of rows) {
    const [schema, table] = name.split('.') as [string, string];
    const res = await client.query<{ n: string }>(
      `select count(*) as n from "${schema}"."${table}"`,
    );
    counts.set(name, Number(res.rows[0]?.n ?? 0));
  }
  return counts;
}

/**
 * A day's growth: the dump is at most a day old when it's restored. Some
 * tables shrink (sessions expire, logs are cleaned), so either way.
 */
export const withinADay = (source: number, restored: number) =>
  Math.abs(source - restored) <= Math.max(100, Math.ceil(source * 0.1));

export async function checkRestore(
  source: pg.Client,
  restored: pg.Client,
  options: { maxOrderAgeHours?: number } = {},
): Promise<RestoreReport> {
  const problems: string[] = [];
  const [from, to] = [await tableCounts(source), await tableCounts(restored)];
  let sourceRows = 0;
  let restoredRows = 0;
  for (const [table, n] of from) {
    sourceRows += n;
    const m = to.get(table);
    if (m === undefined) {
      problems.push(`${table} is missing`);
      continue;
    }
    restoredRows += m;
    if (!withinADay(n, m)) problems.push(`${table}: ${m} rows restored, ${n} in the source`);
  }
  const { rows } = await restored.query<{ hours: string | null }>(
    `select extract(epoch from now() - max(placed_at)) / 3600 as hours from store.orders`,
  );
  const hours =
    rows[0]?.hours === null || rows[0]?.hours === undefined ? null : Number(rows[0].hours);
  const max = options.maxOrderAgeHours ?? 48;
  // Only a source that has taken an order in that time can be held to it.
  const { rows: recent } = await source.query<{ n: string }>(
    `select count(*) as n from store.orders where placed_at > now() - make_interval(hours => $1)`,
    [max],
  );
  if (Number(recent[0]?.n ?? 0) > 0 && (hours === null || hours > max)) {
    problems.push(
      `the newest restored order is ${hours === null ? 'missing' : `${Math.round(hours)} hours old`}`,
    );
  }
  return {
    ok: problems.length === 0,
    tables: from.size,
    rows: { source: sourceRows, restored: restoredRows },
    newestOrderHours: hours === null ? null : Math.round(hours * 10) / 10,
    problems,
  };
}
