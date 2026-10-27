// The back office's imports (phase-8-plan §3.10): the browser reads the file
// and sends checked rows, up to 200 a request, each request one transaction
// under its Idempotency-Key. Each chunk is one insert and one audit entry,
// so a large file stays inside a request's CPU. Rows already in the store
// are skipped and said so: a supplier of the same name (its balance isn't
// touched), or an expense identical to one already recorded.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  BACK_OFFICE_IMPORT_LIMITS,
  importExpense,
  importSupplier,
} from '@managemind/shared/back-office';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput } from '../catalog/common';
import type { TenantTx } from '../tenant';
import { requireBackOffice, today } from './common';

export interface ImportResult {
  created: number;
  /** Rows left out because the store already has them, by the file's row number. */
  skipped: { row: number; reason: 'exists' }[];
}

const supplierRows = z.array(importSupplier).min(1).max(BACK_OFFICE_IMPORT_LIMITS.chunk);
const expenseRows = z.array(importExpense).min(1).max(BACK_OFFICE_IMPORT_LIMITS.chunk);

/** POST /suppliers/import: suppliers with opening balances (purchasing.write; balances purchasing.pay). */
export async function importSuppliers(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<ImportResult> {
  authorize(actor, 'purchasing.write');
  await requireBackOffice(tx);
  const rows = parseInput(supplierRows, input);
  if (rows.some((r) => (r.openingBalance ?? 0) !== 0) && !actor.permissions.has('purchasing.pay')) {
    throw new AppError('forbidden', { detail: 'opening balances need purchasing.pay' });
  }
  const { rows: existing } = await tx.db.execute<{ name: string }>(sql`
    select lower(name) as name from store.suppliers
     where lower(name) = any(${sql.param(rows.map((r) => r.name.toLowerCase()))}::text[])`);
  const taken = new Set(existing.map((e) => e.name));
  const skipped: ImportResult['skipped'] = [];
  const fresh = rows.filter((r) => {
    const key = r.name.toLowerCase();
    if (taken.has(key)) {
      skipped.push({ row: r.row, reason: 'exists' });
      return false;
    }
    taken.add(key);
    return true;
  });
  if (fresh.length) {
    await tx.db.insert(schema.suppliers).values(
      fresh.map((r) => ({
        name: r.name,
        contactName: r.contactName ?? null,
        phones: r.phones ?? [],
        email: r.email ?? null,
        address: r.address ?? null,
        note: r.note ?? null,
        openingBalance: r.openingBalance ?? 0,
      })),
    );
    await recordAudit(tx, {
      ...auditActor(actor, 'staff'),
      action: 'suppliers.imported',
      entityType: 'supplier',
      after: {
        count: fresh.length,
        openingBalances: fresh.reduce((a, r) => a + (r.openingBalance ?? 0), 0),
        rows: [fresh[0]?.row, fresh[fresh.length - 1]?.row],
      },
    });
  }
  return { created: fresh.length, skipped };
}

/** POST /expenses/import: past expenses (expenses.write). */
export async function importExpenses(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<ImportResult> {
  authorize(actor, 'expenses.write');
  await requireBackOffice(tx);
  const rows = parseInput(expenseRows, input);
  const now = today();
  const late = rows.find((r) => r.spentOn > now);
  if (late) {
    throw new AppError('validation_failed', {
      fields: [{ path: `${late.row}.spentOn`, code: 'future', message: 'the date is after today' }],
    });
  }
  const ids = [...new Set(rows.map((r) => r.categoryId))];
  const { rows: open } = await tx.db.execute<{ id: string }>(sql`
    select id from store.expense_categories
     where id = any(${sql.param(ids)}::uuid[]) and archived_at is null`);
  if (open.length !== ids.length) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'categoryId', code: 'unknown', message: 'a category is not the store’s' }],
    });
  }
  // The same date, category, amount, payee and note as one already recorded.
  const { rows: dupes } = await tx.db.execute<{ i: number }>(sql`
    select x.i from unnest(
             ${sql.param(rows.map((_, i) => i))}::int[],
             ${sql.param(rows.map((r) => r.spentOn))}::date[],
             ${sql.param(rows.map((r) => r.categoryId))}::uuid[],
             ${sql.param(rows.map((r) => r.amount))}::bigint[],
             ${sql.param(rows.map((r) => r.payee ?? ''))}::text[],
             ${sql.param(rows.map((r) => r.note ?? ''))}::text[])
           as x(i, spent_on, category_id, amount, payee, note)
     where exists (select 1 from store.expenses e
                    where e.spent_on = x.spent_on and e.category_id = x.category_id
                      and e.amount = x.amount and coalesce(e.payee, '') = x.payee
                      and coalesce(e.note, '') = x.note)`);
  const dupe = new Set(dupes.map((d) => Number(d.i)));
  const skipped = rows
    .filter((_, i) => dupe.has(i))
    .map((r) => ({ row: r.row, reason: 'exists' as const }));
  const fresh = rows.filter((_, i) => !dupe.has(i));
  if (fresh.length) {
    await tx.db.insert(schema.expenses).values(
      fresh.map((r) => ({
        spentOn: r.spentOn,
        categoryId: r.categoryId,
        amount: r.amount,
        method: r.method,
        payee: r.payee ?? null,
        note: r.note ?? null,
      })),
    );
    await recordAudit(tx, {
      ...auditActor(actor, 'staff'),
      action: 'expenses.imported',
      entityType: 'expense',
      after: {
        count: fresh.length,
        total: fresh.reduce((a, r) => a + r.amount, 0),
        rows: [fresh[0]?.row, fresh[fresh.length - 1]?.row],
      },
    });
  }
  return { created: fresh.length, skipped };
}
