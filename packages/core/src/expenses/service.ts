// Expenses (phase-8-plan §3.6): categories (seeded the first time the store
// opens them), entries with an optional receipt photo, and recurring entries
// the daily batch posts on their day. An expense is unique per recurring
// entry and day, so a batch run twice or late posts each day once. Edits and
// deletions are audited with the old values (§8).
import { createDb, schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  type ExpenseCadence,
  expenseCategoryInput,
  expenseCategoryPatch,
  expenseInput,
  expensePatch,
  nextOccurrence,
  occurrences,
  type RecurringSchedule,
  recurringExpenseInput,
  recurringExpensePatch,
  type SpendMethod,
} from '@managemind/shared/back-office';
import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { invalid, parseInput } from '../catalog/common';
import { requireBackOffice, today } from '../purchasing/common';
import { type DbClient, type TenantTx, withTenant } from '../tenant';

const ec = schema.expenseCategories;
const ex = schema.expenses;
const re = schema.recurringExpenses;

export interface ExpenseCategory {
  id: string;
  key: string | null;
  name: { bn: string; en: string };
  position: number;
  archived: boolean;
}

export interface ReceiptMedia {
  key: string;
  mimeType: string;
  bytes: number;
}

export interface Expense {
  id: string;
  spentOn: string;
  categoryId: string;
  amount: number;
  method: SpendMethod;
  payee: string | null;
  note: string | null;
  hasReceipt: boolean;
  recurringExpenseId: string | null;
  recordedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringExpense {
  id: string;
  categoryId: string;
  amount: number;
  method: SpendMethod;
  payee: string | null;
  note: string | null;
  cadence: ExpenseCadence;
  day: number;
  startsOn: string;
  endsOn: string | null;
  nextOn: string | null;
  active: boolean;
}

type CategoryRow = typeof ec.$inferSelect;
type ExpenseRow = typeof ex.$inferSelect;
type RecurringRow = typeof re.$inferSelect;

const toCategory = (r: CategoryRow): ExpenseCategory => ({
  id: r.id,
  key: r.key,
  name: r.name as ExpenseCategory['name'],
  position: r.position,
  archived: r.archivedAt !== null,
});

const toExpense = (r: ExpenseRow): Expense => ({
  id: r.id,
  spentOn: r.spentOn,
  categoryId: r.categoryId,
  amount: r.amount,
  method: r.method,
  payee: r.payee,
  note: r.note,
  hasReceipt: r.receiptMedia !== null,
  recurringExpenseId: r.recurringExpenseId,
  recordedBy: r.recordedBy,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const toRecurring = (r: RecurringRow): RecurringExpense => ({
  id: r.id,
  categoryId: r.categoryId,
  amount: r.amount,
  method: r.method,
  payee: r.payee,
  note: r.note,
  cadence: r.cadence,
  day: r.day,
  startsOn: r.startsOn,
  endsOn: r.endsOn,
  nextOn: r.nextOn,
  active: r.active,
});

// ---- Categories --------------------------------------------------------------------------

/** The default categories, the first time a store has none (§3.6). */
async function seedCategories(tx: TenantTx): Promise<void> {
  const [any] = await tx.db.select({ id: ec.id }).from(ec).limit(1);
  if (any) return;
  await tx.db
    .insert(ec)
    .values(DEFAULT_EXPENSE_CATEGORIES.map((c, i) => ({ key: c.key, name: c.name, position: i })))
    .onConflictDoNothing();
}

/** GET /expense-categories: archived ones too, for old expenses' names. */
export async function listExpenseCategories(
  tx: TenantTx,
  actor: Actor,
): Promise<ExpenseCategory[]> {
  authorize(actor, 'expenses.read');
  await requireBackOffice(tx);
  await seedCategories(tx);
  const rows = await tx.db.select().from(ec).orderBy(asc(ec.position), asc(ec.id));
  return rows.map(toCategory);
}

export async function createExpenseCategory(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<ExpenseCategory> {
  authorize(actor, 'expenses.write');
  await requireBackOffice(tx);
  const v = parseInput(expenseCategoryInput, input);
  await seedCategories(tx);
  const [last] = await tx.db
    .select({ position: sql<number>`coalesce(max(${ec.position}), -1)::int` })
    .from(ec);
  const [row] = await tx.db
    .insert(ec)
    .values({ name: v.name, position: v.position ?? (last?.position ?? -1) + 1 })
    .returning();
  if (!row) throw new AppError('internal');
  return toCategory(row);
}

export async function updateExpenseCategory(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<ExpenseCategory> {
  authorize(actor, 'expenses.write');
  await requireBackOffice(tx);
  const v = parseInput(expenseCategoryPatch, input);
  const [row] = await tx.db
    .update(ec)
    .set({
      ...(v.name ? { name: v.name } : {}),
      ...(v.position !== undefined ? { position: v.position } : {}),
      ...(v.archived !== undefined ? { archivedAt: v.archived ? sql`now()` : null } : {}),
    })
    .where(eq(ec.id, id))
    .returning();
  if (!row) throw new AppError('not_found');
  return toCategory(row);
}

async function activeCategory(tx: TenantTx, id: string): Promise<void> {
  const [row] = await tx.db
    .select({ id: ec.id })
    .from(ec)
    .where(and(eq(ec.id, id), isNull(ec.archivedAt)));
  if (!row) throw invalid('categoryId', 'unknown or archived category', 'not_found');
}

// ---- Expenses ----------------------------------------------------------------------------

export interface ExpenseQuery {
  /** Dhaka dates, inclusive. */
  from?: string | undefined;
  to?: string | undefined;
  categoryId?: string | undefined;
  before?: string | undefined;
  limit?: number | undefined;
}

/**
 * GET /expenses: by date, newest first, with the range's total per category
 * (the month view's category totals).
 */
export async function listExpenses(
  tx: TenantTx,
  actor: Actor,
  q: ExpenseQuery = {},
): Promise<{
  items: Expense[];
  nextCursor: string | null;
  totals: { total: number; count: number; byCategory: { categoryId: string; amount: number }[] };
}> {
  authorize(actor, 'expenses.read');
  await requireBackOffice(tx);
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const range = [
    q.from ? gte(ex.spentOn, q.from) : undefined,
    q.to ? lte(ex.spentOn, q.to) : undefined,
    q.categoryId ? eq(ex.categoryId, q.categoryId) : undefined,
  ].filter((f) => f !== undefined);
  const page = [...range, q.before ? lt(ex.id, q.before) : undefined].filter(
    (f) => f !== undefined,
  );
  const rows = await tx.db
    .select()
    .from(ex)
    .where(page.length ? and(...page) : undefined)
    .orderBy(desc(ex.id))
    .limit(limit + 1);
  const sums = await tx.db
    .select({
      categoryId: ex.categoryId,
      amount: sql<string>`sum(${ex.amount})`,
      count: sql<number>`count(*)::int`,
    })
    .from(ex)
    .where(range.length ? and(...range) : undefined)
    .groupBy(ex.categoryId);
  const items = rows.slice(0, limit).map(toExpense);
  return {
    items,
    nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null,
    totals: {
      total: sums.reduce((a, s) => a + Number(s.amount), 0),
      count: sums.reduce((a, s) => a + s.count, 0),
      byCategory: sums
        .map((s) => ({ categoryId: s.categoryId, amount: Number(s.amount) }))
        .sort((a, b) => b.amount - a.amount),
    },
  };
}

const audited = (r: ExpenseRow) => ({
  spentOn: r.spentOn,
  categoryId: r.categoryId,
  amount: r.amount,
  method: r.method,
  payee: r.payee,
  note: r.note,
  receipt: r.receiptMedia !== null,
});

async function lockExpense(tx: TenantTx, id: string): Promise<ExpenseRow> {
  const [row] = await tx.db.select().from(ex).where(eq(ex.id, id)).for('update');
  if (!row) throw new AppError('not_found');
  return row;
}

export async function getExpense(tx: TenantTx, actor: Actor, id: string): Promise<Expense> {
  authorize(actor, 'expenses.read');
  await requireBackOffice(tx);
  const [row] = await tx.db.select().from(ex).where(eq(ex.id, id));
  if (!row) throw new AppError('not_found');
  return toExpense(row);
}

export async function createExpense(tx: TenantTx, actor: Actor, input: unknown): Promise<Expense> {
  authorize(actor, 'expenses.write');
  await requireBackOffice(tx);
  const v = parseInput(expenseInput, input);
  await activeCategory(tx, v.categoryId);
  const [row] = await tx.db
    .insert(ex)
    .values({
      spentOn: v.spentOn,
      categoryId: v.categoryId,
      amount: v.amount,
      method: v.method,
      payee: v.payee ?? null,
      note: v.note ?? null,
      recordedBy: actor.userId,
    })
    .returning();
  if (!row) throw new AppError('internal');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'expense.created',
    entityType: 'expense',
    entityId: row.id,
    after: audited(row),
  });
  return toExpense(row);
}

export async function updateExpense(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<Expense> {
  authorize(actor, 'expenses.write');
  await requireBackOffice(tx);
  const v = parseInput(expensePatch, input);
  const before = await lockExpense(tx, id);
  if (v.categoryId && v.categoryId !== before.categoryId) await activeCategory(tx, v.categoryId);
  const [row] = await tx.db
    .update(ex)
    .set({
      ...(v.spentOn !== undefined ? { spentOn: v.spentOn } : {}),
      ...(v.categoryId !== undefined ? { categoryId: v.categoryId } : {}),
      ...(v.amount !== undefined ? { amount: v.amount } : {}),
      ...(v.method !== undefined ? { method: v.method } : {}),
      ...(v.payee !== undefined ? { payee: v.payee } : {}),
      ...(v.note !== undefined ? { note: v.note } : {}),
    })
    .where(eq(ex.id, id))
    .returning();
  if (!row) throw new AppError('not_found');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'expense.updated',
    entityType: 'expense',
    entityId: id,
    before: audited(before),
    after: audited(row),
  });
  return toExpense(row);
}

/** Deletes an expense; returns its receipt photo's key for the caller to remove from R2. */
export async function deleteExpense(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<{ receiptKey: string | null }> {
  authorize(actor, 'expenses.write');
  await requireBackOffice(tx);
  const before = await lockExpense(tx, id);
  await tx.db.delete(ex).where(eq(ex.id, id));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'expense.deleted',
    entityType: 'expense',
    entityId: id,
    before: audited(before),
  });
  return { receiptKey: (before.receiptMedia as ReceiptMedia | null)?.key ?? null };
}

/**
 * Sets or clears an expense's receipt photo (Q8), once the caller has
 * stored the file; returns the replaced file's key for the caller to remove.
 */
export async function setExpenseReceipt(
  tx: TenantTx,
  actor: Actor,
  id: string,
  media: ReceiptMedia | null,
): Promise<{ replacedKey: string | null; expense: Expense }> {
  authorize(actor, 'expenses.write');
  await requireBackOffice(tx);
  const before = await lockExpense(tx, id);
  const [row] = await tx.db
    .update(ex)
    .set({ receiptMedia: media })
    .where(eq(ex.id, id))
    .returning();
  if (!row) throw new AppError('not_found');
  const old = (before.receiptMedia as ReceiptMedia | null)?.key ?? null;
  return { replacedKey: old && old !== media?.key ? old : null, expense: toExpense(row) };
}

/** The receipt photo's key and type, for staff who can read expenses. */
export async function expenseReceipt(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<ReceiptMedia> {
  authorize(actor, 'expenses.read');
  await requireBackOffice(tx);
  const [row] = await tx.db.select({ media: ex.receiptMedia }).from(ex).where(eq(ex.id, id));
  const media = row?.media as ReceiptMedia | null | undefined;
  if (!media) throw new AppError('not_found');
  return media;
}

// ---- Recurring entries (§3.6) ------------------------------------------------------------

const schedule = (r: {
  cadence: ExpenseCadence;
  day: number;
  startsOn: string;
  endsOn: string | null;
}): RecurringSchedule => ({
  cadence: r.cadence,
  day: r.day,
  startsOn: r.startsOn,
  endsOn: r.endsOn,
});

export async function listRecurringExpenses(
  tx: TenantTx,
  actor: Actor,
): Promise<RecurringExpense[]> {
  authorize(actor, 'expenses.read');
  await requireBackOffice(tx);
  const rows = await tx.db.select().from(re).orderBy(desc(re.active), asc(re.nextOn), asc(re.id));
  return rows.map(toRecurring);
}

const auditedRecurring = (r: RecurringRow) => ({
  categoryId: r.categoryId,
  amount: r.amount,
  method: r.method,
  payee: r.payee,
  cadence: r.cadence,
  day: r.day,
  startsOn: r.startsOn,
  endsOn: r.endsOn,
  active: r.active,
});

/**
 * POST /recurring-expenses. It posts from today on, never for days already
 * past: months before the store started here come through the import.
 */
export async function createRecurringExpense(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
  on = today(),
): Promise<RecurringExpense> {
  authorize(actor, 'expenses.write');
  await requireBackOffice(tx);
  const v = parseInput(recurringExpenseInput, input);
  await activeCategory(tx, v.categoryId);
  const s = schedule({ ...v, endsOn: v.endsOn ?? null });
  const [row] = await tx.db
    .insert(re)
    .values({
      categoryId: v.categoryId,
      amount: v.amount,
      method: v.method,
      payee: v.payee ?? null,
      note: v.note ?? null,
      cadence: v.cadence,
      day: v.day,
      startsOn: v.startsOn,
      endsOn: v.endsOn ?? null,
      nextOn: nextOccurrence(s, on > v.startsOn ? on : v.startsOn),
      active: v.active ?? true,
      createdBy: actor.userId,
    })
    .returning();
  if (!row) throw new AppError('internal');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'recurring_expense.created',
    entityType: 'recurring_expense',
    entityId: row.id,
    after: auditedRecurring(row),
  });
  return toRecurring(row);
}

/** Changes only future posts (§3.6): the next one is found again from today. */
export async function updateRecurringExpense(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
  on = today(),
): Promise<RecurringExpense> {
  authorize(actor, 'expenses.write');
  await requireBackOffice(tx);
  const v = parseInput(recurringExpensePatch, input);
  const [before] = await tx.db.select().from(re).where(eq(re.id, id)).for('update');
  if (!before) throw new AppError('not_found');
  if (v.categoryId && v.categoryId !== before.categoryId) await activeCategory(tx, v.categoryId);
  const merged = {
    cadence: v.cadence ?? before.cadence,
    day: v.day ?? before.day,
    startsOn: v.startsOn ?? before.startsOn,
    endsOn: v.endsOn !== undefined ? v.endsOn : before.endsOn,
  };
  if (merged.cadence === 'weekly' && (merged.day < 1 || merged.day > 7)) {
    throw invalid('day', 'a weekday from 1 to 7');
  }
  if (merged.endsOn && merged.endsOn < merged.startsOn) {
    throw invalid('endsOn', 'on or after the start');
  }
  // Today's post, if the batch already made it, isn't made again.
  const [postedToday] = await tx.db
    .select({ id: ex.id })
    .from(ex)
    .where(and(eq(ex.recurringExpenseId, id), eq(ex.spentOn, on)));
  const from = postedToday ? addDay(on) : on;
  const [row] = await tx.db
    .update(re)
    .set({
      ...(v.categoryId !== undefined ? { categoryId: v.categoryId } : {}),
      ...(v.amount !== undefined ? { amount: v.amount } : {}),
      ...(v.method !== undefined ? { method: v.method } : {}),
      ...(v.payee !== undefined ? { payee: v.payee } : {}),
      ...(v.note !== undefined ? { note: v.note } : {}),
      ...(v.active !== undefined ? { active: v.active } : {}),
      ...merged,
      nextOn: nextOccurrence(schedule(merged), from > merged.startsOn ? from : merged.startsOn),
    })
    .where(eq(re.id, id))
    .returning();
  if (!row) throw new AppError('not_found');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'recurring_expense.updated',
    entityType: 'recurring_expense',
    entityId: id,
    before: auditedRecurring(before),
    after: auditedRecurring(row),
  });
  return toRecurring(row);
}

/** Deletes a recurring entry; the expenses it posted stay, as ordinary expenses. */
export async function deleteRecurringExpense(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<void> {
  authorize(actor, 'expenses.write');
  await requireBackOffice(tx);
  const [before] = await tx.db.select().from(re).where(eq(re.id, id)).for('update');
  if (!before) throw new AppError('not_found');
  await tx.db.update(ex).set({ recurringExpenseId: null }).where(eq(ex.recurringExpenseId, id));
  await tx.db.delete(re).where(eq(re.id, id));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'recurring_expense.deleted',
    entityType: 'recurring_expense',
    entityId: id,
    before: auditedRecurring(before),
  });
}

const addDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * The daily batch's posting (§3.6): every active entry due by `on` posts
 * each of its days from its next one to `on`, once each (the unique index on
 * entry and day), then moves to its next day. A late run posts the missed
 * days; a second run posts nothing.
 */
export async function postRecurringExpenses(
  tx: TenantTx,
  on = today(),
): Promise<{ posted: number }> {
  const due = await tx.db
    .select()
    .from(re)
    .where(and(eq(re.active, true), lte(re.nextOn, on)))
    .for('update');
  let posted = 0;
  for (const r of due) {
    const days = occurrences(schedule(r), r.nextOn as string, on);
    if (days.length) {
      const inserted = await tx.db
        .insert(ex)
        .values(
          days.map((spentOn) => ({
            spentOn,
            categoryId: r.categoryId,
            amount: r.amount,
            method: r.method,
            payee: r.payee,
            note: r.note,
            recurringExpenseId: r.id,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: ex.id });
      posted += inserted.length;
    }
    await tx.db
      .update(re)
      .set({ nextOn: nextOccurrence(schedule(r), addDay(on)) })
      .where(eq(re.id, r.id));
  }
  return { posted };
}

/**
 * The daily batch's recurring expenses for every open store, each in its own
 * transaction; a store that fails is tried again the next morning, when its
 * missed days are posted too.
 */
export async function runRecurringExpenses(
  client: DbClient,
  on = today(),
): Promise<{ stores: number; posted: number; failed: { tenantId: string; error: string }[] }> {
  const t = schema.tenants;
  const stores = await createDb(client).select({ id: t.id }).from(t).where(eq(t.status, 'active'));
  const result = { stores: 0, posted: 0, failed: [] as { tenantId: string; error: string }[] };
  for (const store of stores) {
    try {
      const { posted } = await withTenant(client, store.id, (tx) => postRecurringExpenses(tx, on));
      result.stores += 1;
      result.posted += posted;
    } catch (e) {
      result.failed.push({ tenantId: store.id, error: String(e) });
    }
  }
  return result;
}
