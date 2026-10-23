// The daily usage rollup (phase-5b-plan §3.6): yesterday's use per store,
// into platform.usage_daily, keyed by store, day and metric, so a rerun or a
// missed day filled in later writes the same rows. Flows (orders, emails,
// SMS) are the day's counts; levels (products, staff, storage, domains) are
// the counts at the end of the day. Monthly totals and the owner's meters are
// sums of these rows.
import { createDb, schema } from '@managemind/db';
import { USAGE_METRICS, type UsageMetric } from '@managemind/shared/billing';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { type DbClient, type TenantTx, withTenant } from '../tenant';
import { writeStoreHealth } from './health';

export type DayUsage = Record<UsageMetric, number>;

/** One store's use on a Dhaka day, in one query, in the caller's tenant transaction. */
export async function measureDay(tx: TenantTx, day: string): Promise<DayUsage> {
  // The Dhaka day [00:00, 24:00) as UTC instants.
  const from = sql`(${day}::date)::timestamp at time zone 'Asia/Dhaka'`;
  const to = sql`((${day}::date) + 1)::timestamp at time zone 'Asia/Dhaka'`;
  const { rows } = await tx.db.execute<Record<UsageMetric, string | number | null>>(sql`
    select
      (select count(*) from store.orders o where o.placed_at >= ${from} and o.placed_at < ${to}) as orders,
      (select coalesce(sum(o.total), 0) from store.orders o
        where o.placed_at >= ${from} and o.placed_at < ${to}) as order_total,
      (select count(*) from store.messages m where m.channel = 'email' and m.status = 'sent'
        and m.sent_at >= ${from} and m.sent_at < ${to}) as emails,
      (select count(*) from store.messages m where m.channel = 'sms' and m.status = 'sent'
        and m.sent_at >= ${from} and m.sent_at < ${to}) as sms,
      (select coalesce(sum((f->>'bytes')::bigint), 0) from store.media md
         cross join jsonb_array_elements(md.files) f where md.created_at < ${to})
      + (select coalesce(sum(p.bytes), 0) from store.return_photos p where p.created_at < ${to})
        as storage_bytes,
      (select count(*) from store.products p where p.status <> 'archived' and p.created_at < ${to})
        as products,
      (select count(*) from platform.memberships m
        where m.tenant_id = ${tx.tenantId} and m.created_at < ${to}) as staff,
      (select count(*) from platform.tenant_domains d
        where d.tenant_id = ${tx.tenantId} and d.status = 'active') as custom_domains
  `);
  const row = rows[0] ?? {};
  return Object.fromEntries(
    USAGE_METRICS.map((m) => [m, Number((row as Record<string, unknown>)[m] ?? 0)]),
  ) as DayUsage;
}

/** Writes a day's rows for the store, replacing any from an earlier run. */
export async function recordDay(tx: TenantTx, day: string, usage: DayUsage): Promise<void> {
  const u = schema.usageDaily;
  await tx.db
    .insert(u)
    .values(
      USAGE_METRICS.map((metric) => ({ tenantId: tx.tenantId, day, metric, value: usage[metric] })),
    )
    .onConflictDoUpdate({
      target: [u.tenantId, u.day, u.metric],
      set: { value: sql`excluded.value` },
    });
}

/** A store's usage summed over [from, to] (Dhaka dates): flows summed, levels at the last day. */
export async function usageBetween(
  tx: { db: TenantTx['db'] },
  tenantId: string,
  from: string,
  to: string,
): Promise<DayUsage> {
  const u = schema.usageDaily;
  const rows = await tx.db
    .select({ metric: u.metric, day: u.day, value: u.value })
    .from(u)
    .where(and(eq(u.tenantId, tenantId), gte(u.day, from), lte(u.day, to)));
  const flows = new Set<string>(['orders', 'order_total', 'emails', 'sms']);
  const out = Object.fromEntries(USAGE_METRICS.map((m) => [m, 0])) as DayUsage;
  const lastDay: Partial<Record<UsageMetric, string>> = {};
  for (const r of rows) {
    if (flows.has(r.metric)) out[r.metric] += r.value;
    else if (!lastDay[r.metric] || r.day > (lastDay[r.metric] as string)) {
      lastDay[r.metric] = r.day;
      out[r.metric] = r.value;
    }
  }
  return out;
}

export interface RollupResult {
  stores: number;
  failed: { tenantId: string; error: string }[];
}

/**
 * The nightly pass over every store that isn't purged: yesterday's usage,
 * and any of the last `catchUp` days that have no rows yet, then the store's
 * health. One store failing never stops the others; it is filled in the next
 * night, since every row is keyed by store, day and metric.
 */
export async function runDailyRollup(
  client: DbClient,
  yesterday: string,
  options: { catchUp?: number } = {},
): Promise<RollupResult> {
  const t = schema.tenants;
  const stores = await createDb(client)
    .select({ id: t.id, createdAt: t.createdAt })
    .from(t)
    .where(inArray(t.status, ['active', 'suspended', 'closed']));
  const result: RollupResult = { stores: 0, failed: [] };
  for (const store of stores) {
    try {
      await withTenant(client, store.id, async (tx) => {
        const days = await missingDays(tx, yesterday, options.catchUp ?? 3, store.createdAt);
        for (const day of days) await recordDay(tx, day, await measureDay(tx, day));
        await writeStoreHealth(tx);
      });
      result.stores++;
    } catch (e) {
      result.failed.push({ tenantId: store.id, error: String(e) });
    }
  }
  return result;
}

/** Yesterday, and the days before it (up to `catchUp`) with no rows, from the store's first day. */
async function missingDays(
  tx: TenantTx,
  yesterday: string,
  catchUp: number,
  createdAt: Date,
): Promise<string[]> {
  const u = schema.usageDaily;
  const first = new Date(createdAt.getTime() + 6 * 3_600_000).toISOString().slice(0, 10);
  const candidates: string[] = [];
  for (let i = catchUp; i >= 1; i--) {
    const d = new Date(Date.parse(`${yesterday}T00:00:00Z`) - i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    if (d >= first) candidates.push(d);
  }
  const have = candidates.length
    ? await tx.db
        .selectDistinct({ day: u.day })
        .from(u)
        .where(and(eq(u.tenantId, tx.tenantId), inArray(u.day, candidates)))
    : [];
  const done = new Set(have.map((h) => h.day));
  return [...candidates.filter((d) => !done.has(d)), ...(yesterday >= first ? [yesterday] : [])];
}
