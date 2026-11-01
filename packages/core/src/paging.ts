// Numbered pages for the admin's lists (ADR 0033): how many rows match a
// list's filters, so it can say "1–10 of 482" and jump to a page.
import { type SQL, sql } from 'drizzle-orm';
import type { TenantTx } from './tenant';

/** Counts the rows of `from` (a table with its alias) that match every filter. */
export async function countWhere(
  tx: Pick<TenantTx, 'db'>,
  from: SQL,
  where: readonly SQL[],
): Promise<number> {
  const { rows } = await tx.db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${from} where ${where.length ? sql.join([...where], sql` and `) : sql`true`}`,
  );
  return Number(rows[0]?.n ?? 0);
}
