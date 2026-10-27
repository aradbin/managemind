// Stock counts (phase-8-plan §3.5, ADR 0031): the shelf against the system
// for a set of variants at one location, while sales keep running. Each line
// keeps when it was counted; what the ledger held then is on hand now less
// the movements after that moment. A movement after the count adds to both
// terms alike, so the difference stays right however late it is applied.
// Applying writes one `count` adjustment per line with a difference: at once
// up to 500 counted lines, then 500 a message on the delayed-work queue.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  BACK_OFFICE_LIMITS,
  countLineInput,
  documentNumber,
  type StockCountScope,
  type StockCountStatus,
  stockCountInput,
  stockCountMachine,
} from '@managemind/shared/back-office';
import { tenantSettings } from '@managemind/shared/settings';
import { and, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { invalid, parseInput } from '../catalog/common';
import { emit } from '../outbox';
import { money, nextNumber, requireBackOffice, seesCost } from '../purchasing/common';
import { type Localized, variantLabels } from '../purchasing/variants';
import type { TenantTx } from '../tenant';
import { applyMovements, defaultLocationId } from './service';

const sc = schema.stockCounts;
const scl = schema.stockCountLines;

type Row = typeof sc.$inferSelect;

export interface StockCountLine {
  variantId: string;
  productId: string;
  title: Localized;
  optionLabels: Localized[];
  sku: string | null;
  barcode: string | null;
  counted: number | null;
  countedAt: string | null;
  countedBy: string | null;
  /** Blind while counting (Q6): from review on. */
  expected?: number;
  difference?: number;
  /** With catalog.cost: the difference at the variant's cost. */
  unitCost?: number | null;
  value?: number;
  applied?: boolean;
}

export interface StockCount {
  id: string;
  number: number;
  /** `SC-0001`. */
  reference: string;
  locationId: string;
  status: StockCountStatus;
  scope: StockCountScope;
  note: string | null;
  lineCount: number;
  countedLines: number;
  startedBy: string | null;
  submittedAt: string | null;
  appliedAt: string | null;
  appliedBy: string | null;
  applyError: string | null;
  createdAt: string;
  lines: StockCountLine[];
  /** From review on: lines with a difference, and with catalog.cost their value. */
  differences?: { lines: number; units: number; value?: number };
  /** Applying needs catalog.cost too when the differences are worth more than this (Q7). */
  approvalThreshold?: number;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function loadCount(tx: TenantTx, id: string, lock = false): Promise<Row> {
  const query = tx.db.select().from(sc).where(eq(sc.id, id));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new AppError('not_found');
  return row;
}

type Measured = {
  variant_id: string;
  counted: number | null;
  counted_at: string | null;
  counted_by: string | null;
  expected: number;
  cost: string | null;
  expected_at_count: number | null;
  difference: number | null;
  unit_cost: string | null;
  applied_at: string | null;
};

/** Each line with what the ledger held when it was counted (§3.5), in one query. */
async function measure(tx: TenantTx, count: Row): Promise<Measured[]> {
  const { rows } = await tx.db.execute<Measured>(sql`
    select l.variant_id, l.counted, l.counted_at, l.counted_by, l.expected_at_count, l.difference,
           l.unit_cost, l.applied_at, v.cost_price as cost,
           (coalesce(il.on_hand, 0) - coalesce((
              select sum(m.quantity) from store.stock_movements m
               where m.variant_id = l.variant_id and m.location_id = ${count.locationId}
                 and m.type in ('receive', 'return', 'adjustment', 'sale')
                 and m.created_at > coalesce(l.counted_at, now())), 0))::int as expected
      from store.stock_count_lines l
      join store.variants v on v.id = l.variant_id
      left join store.inventory_levels il
        on il.variant_id = l.variant_id and il.location_id = ${count.locationId}
     where l.stock_count_id = ${count.id}
     order by l.variant_id`);
  return rows;
}

const reviewed = (status: StockCountStatus) => status !== 'counting' && status !== 'cancelled';

async function view(tx: TenantTx, actor: Actor, row: Row): Promise<StockCount> {
  const lines = await measure(tx, row);
  const labels = await variantLabels(
    tx,
    lines.map((l) => l.variant_id),
  );
  const open = reviewed(row.status);
  const cost = seesCost(actor);
  let units = 0;
  let value = 0;
  let differing = 0;
  const out = lines.map((l): StockCountLine => {
    const label = labels.get(l.variant_id);
    const frozen = l.expected_at_count !== null;
    const expected = frozen ? (l.expected_at_count as number) : l.expected;
    const difference =
      l.counted === null ? 0 : frozen ? (l.difference as number) : l.counted - expected;
    const unitCost = frozen ? money(l.unit_cost) : money(l.cost);
    if (difference !== 0) {
      differing += 1;
      units += difference;
      value += difference * (unitCost ?? 0);
    }
    return {
      variantId: l.variant_id,
      productId: label?.productId ?? '',
      title: label?.title ?? {},
      optionLabels: label?.optionLabels ?? [],
      sku: label?.sku ?? null,
      barcode: label?.barcode ?? null,
      counted: l.counted,
      countedAt: l.counted_at ? new Date(l.counted_at).toISOString() : null,
      countedBy: l.counted_by,
      ...(open
        ? {
            expected,
            difference,
            applied: l.applied_at !== null,
            ...(cost ? { unitCost, value: difference * (unitCost ?? 0) } : {}),
          }
        : {}),
    };
  });
  // Review lists the differences largest value first (§3.5).
  if (open) {
    out.sort(
      (a, b) =>
        Math.abs(b.value ?? b.difference ?? 0) - Math.abs(a.value ?? a.difference ?? 0) ||
        (a.sku ?? '').localeCompare(b.sku ?? ''),
    );
  }
  const threshold = cost ? (await settings(tx)).countApprovalThreshold : undefined;
  return {
    id: row.id,
    number: row.number,
    reference: documentNumber('SC', row.number),
    locationId: row.locationId,
    status: row.status,
    scope: row.scope as StockCountScope,
    note: row.note,
    lineCount: row.lineCount,
    countedLines: lines.filter((l) => l.counted !== null).length,
    startedBy: row.startedBy,
    submittedAt: iso(row.submittedAt),
    appliedAt: iso(row.appliedAt),
    appliedBy: row.appliedBy,
    applyError: row.applyError,
    createdAt: row.createdAt.toISOString(),
    lines: out,
    ...(open ? { differences: { lines: differing, units, ...(cost ? { value } : {}) } } : {}),
    ...(threshold !== undefined ? { approvalThreshold: threshold } : {}),
  };
}

async function settings(tx: TenantTx) {
  const [store] = await tx.db
    .select({ settings: schema.tenants.settings })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tx.tenantId));
  return tenantSettings.parse(store?.settings ?? {}).backOffice;
}

export async function getStockCount(tx: TenantTx, actor: Actor, id: string): Promise<StockCount> {
  authorize(actor, 'inventory.read');
  await requireBackOffice(tx);
  return view(tx, actor, await loadCount(tx, id));
}

export interface StockCountSummary {
  id: string;
  number: number;
  reference: string;
  status: StockCountStatus;
  locationId: string;
  scope: StockCountScope;
  lineCount: number;
  countedLines: number;
  createdAt: string;
  appliedAt: string | null;
}

/** GET /stock-counts: newest first. */
export async function listStockCounts(
  tx: TenantTx,
  actor: Actor,
  query: {
    status?: StockCountStatus | undefined;
    before?: string | undefined;
    limit?: number | undefined;
  } = {},
): Promise<{ items: StockCountSummary[]; nextCursor: string | null }> {
  authorize(actor, 'inventory.read');
  await requireBackOffice(tx);
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const filters = [
    query.status ? eq(sc.status, query.status) : undefined,
    query.before ? lt(sc.id, query.before) : undefined,
  ].filter((f) => f !== undefined);
  const rows = await tx.db
    .select({
      row: sc,
      counted: sql<number>`(select count(*)::int from store.stock_count_lines l where l.stock_count_id = ${sc.id} and l.counted is not null)`,
    })
    .from(sc)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(sc.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit).map(({ row, counted }) => ({
    id: row.id,
    number: row.number,
    reference: documentNumber('SC', row.number),
    status: row.status,
    locationId: row.locationId,
    scope: row.scope as StockCountScope,
    lineCount: row.lineCount,
    countedLines: counted,
    createdAt: row.createdAt.toISOString(),
    appliedAt: iso(row.appliedAt),
  }));
  return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null };
}

/** The live, tracked variants a scope covers, at most 2,000 (§3.5). */
async function scopeVariants(tx: TenantTx, scope: StockCountScope): Promise<string[]> {
  const live = sql`v.archived_at is null and v.track_inventory and p.status <> 'archived'`;
  const max = BACK_OFFICE_LIMITS.linesPerCount + 1;
  let filter = sql`true`;
  if (scope.kind === 'category') {
    filter = sql`exists (
      with recursive tree as (
        select id from store.categories where id = ${scope.categoryId}
        union all
        select c.id from store.categories c join tree t on c.parent_id = t.id)
      select 1 from store.product_categories pc join tree t on t.id = pc.category_id
       where pc.product_id = p.id)`;
  } else if (scope.kind === 'tag') {
    filter = sql`exists (select 1 from store.product_tags pt where pt.product_id = p.id and pt.tag = ${scope.tag})`;
  } else if (scope.kind === 'variants') {
    filter = sql`v.id = any(${sql.param(scope.variantIds)}::uuid[])`;
  }
  const { rows } = await tx.db.execute<{ id: string }>(sql`
    select v.id from store.variants v join store.products p on p.id = v.product_id
     where ${live} and ${filter}
     order by v.id limit ${max}`);
  if (rows.length > BACK_OFFICE_LIMITS.linesPerCount) {
    throw invalid(
      'scope',
      `a count covers at most ${BACK_OFFICE_LIMITS.linesPerCount} items: narrow it`,
    );
  }
  if (scope.kind === 'variants' && rows.length !== scope.variantIds.length) {
    throw invalid('scope.variantIds', 'unknown, archived or untracked variant', 'not_found');
  }
  if (!rows.length) throw invalid('scope', 'nothing to count here');
  return rows.map((r) => r.id);
}

/** POST /stock-counts: starts a count; its lines are created now (§3.5). */
export async function createStockCount(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<StockCount> {
  authorize(actor, 'inventory.write');
  await requireBackOffice(tx);
  const v = parseInput(stockCountInput, input);
  let locationId = v.locationId;
  if (locationId) {
    const sl = schema.stockLocations;
    const [loc] = await tx.db.select({ id: sl.id }).from(sl).where(eq(sl.id, locationId));
    if (!loc) throw invalid('locationId', 'unknown location', 'not_found');
  } else locationId = await defaultLocationId(tx);
  const variants = await scopeVariants(tx, v.scope);
  const [row] = await tx.db
    .insert(sc)
    .values({
      number: await nextNumber(tx, 'stock_count_number'),
      locationId,
      scope: v.scope,
      note: v.note ?? null,
      lineCount: variants.length,
      startedBy: actor.userId,
    })
    .returning();
  if (!row) throw new AppError('internal');
  await tx.db.execute(sql`
    insert into store.stock_count_lines (stock_count_id, variant_id)
    select ${row.id}, x from unnest(${sql.param(variants)}::uuid[]) as x`);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'stock_count.started',
    entityType: 'stock_count',
    entityId: row.id,
    after: { number: row.number, locationId, scope: v.scope, lines: variants.length },
  });
  return view(tx, actor, row);
}

/**
 * PUT /stock-counts/{id}/lines/{variantId}: a counter's number, stamped with
 * when it was counted. A line can be recounted in review, until applied.
 */
export async function setCountLine(
  tx: TenantTx,
  actor: Actor,
  id: string,
  variantId: string,
  input: unknown,
): Promise<StockCountLine> {
  authorize(actor, 'inventory.write');
  await requireBackOffice(tx);
  const { counted } = parseInput(countLineInput, input);
  const count = await loadCount(tx, id);
  if (count.status !== 'counting' && count.status !== 'review') {
    throw new AppError('illegal_transition', {
      detail: `A ${count.status} count can't be changed`,
    });
  }
  const [line] = await tx.db
    .update(scl)
    .set({
      ...(counted === null
        ? { counted: null, countedAt: null, countedBy: null }
        : { counted, countedAt: sql`now()`, countedBy: actor.userId }),
      // A recount after an apply that stopped part-way is measured again.
      expectedAtCount: null,
      difference: null,
      unitCost: null,
    })
    .where(and(eq(scl.stockCountId, id), eq(scl.variantId, variantId), isNull(scl.appliedAt)))
    .returning();
  if (!line) throw new AppError('not_found', { detail: 'not a line of this count' });
  const label = (await variantLabels(tx, [variantId])).get(variantId);
  return {
    variantId,
    productId: label?.productId ?? '',
    title: label?.title ?? {},
    optionLabels: label?.optionLabels ?? [],
    sku: label?.sku ?? null,
    barcode: label?.barcode ?? null,
    counted: line.counted,
    countedAt: iso(line.countedAt),
    countedBy: line.countedBy,
  };
}

async function move(
  tx: TenantTx,
  actor: Actor,
  id: string,
  event: 'submit' | 'reopen' | 'cancel',
): Promise<StockCount> {
  authorize(actor, 'inventory.write');
  await requireBackOffice(tx);
  const before = await loadCount(tx, id, true);
  const t = stockCountMachine.transition(before.status, event, undefined);
  const [after] = await tx.db
    .update(sc)
    .set({ status: t.to, ...(event === 'submit' ? { submittedAt: sql`now()` } : {}) })
    .where(eq(sc.id, id))
    .returning();
  if (!after) throw new AppError('not_found');
  if (event === 'cancel') {
    await recordAudit(tx, {
      ...auditActor(actor, 'staff'),
      action: 'stock_count.cancelled',
      entityType: 'stock_count',
      entityId: id,
      before: { status: before.status },
    });
  }
  return view(tx, actor, after);
}

export const submitStockCount = (tx: TenantTx, actor: Actor, id: string) =>
  move(tx, actor, id, 'submit');
export const reopenStockCount = (tx: TenantTx, actor: Actor, id: string) =>
  move(tx, actor, id, 'reopen');
export const cancelStockCount = (tx: TenantTx, actor: Actor, id: string) =>
  move(tx, actor, id, 'cancel');

/**
 * POST /stock-counts/{id}/apply (§3.5, Q7). Freezes each counted line's
 * expected quantity, difference and cost, then applies the differences: at
 * once when there are at most 500 counted lines, otherwise the count waits
 * in `applying` and `queued` tells the caller to send it to the queue.
 */
export async function applyStockCount(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<{ count: StockCount; queued: boolean }> {
  authorize(actor, 'inventory.write');
  await requireBackOffice(tx);
  const before = await loadCount(tx, id, true);
  stockCountMachine.transition(before.status, 'apply', undefined);
  const lines = (await measure(tx, before)).filter(
    (l) => l.counted !== null && l.applied_at === null,
  );
  // Lines frozen by an earlier apply that failed part-way keep their numbers.
  const frozen = lines.map((l) => {
    const keep = l.expected_at_count !== null;
    const expected = keep ? (l.expected_at_count as number) : l.expected;
    return {
      variantId: l.variant_id,
      expected,
      difference: keep ? (l.difference as number) : (l.counted as number) - expected,
      unitCost: keep ? money(l.unit_cost) : money(l.cost),
    };
  });
  const value = frozen.reduce((a, l) => a + Math.abs(l.difference) * (l.unitCost ?? 0), 0);
  const { countApprovalThreshold } = await settings(tx);
  if (value > countApprovalThreshold && !actor.permissions.has('catalog.cost')) {
    throw new AppError('forbidden', {
      detail: 'differences this large need an owner or manager to apply',
      extensions: { value, threshold: countApprovalThreshold },
    });
  }
  if (frozen.length) {
    await tx.db.execute(sql`
      update store.stock_count_lines l
         set expected_at_count = x.expected, difference = x.difference, unit_cost = x.cost
        from unnest(${sql.param(frozen.map((l) => l.variantId))}::uuid[],
                    ${sql.param(frozen.map((l) => l.expected))}::int[],
                    ${sql.param(frozen.map((l) => l.difference))}::int[],
                    ${sql.param(frozen.map((l) => l.unitCost))}::bigint[]) as x(variant_id, expected, difference, cost)
       where l.stock_count_id = ${id} and l.variant_id = x.variant_id`);
  }
  await tx.db
    .update(sc)
    .set({ status: 'applying', appliedBy: actor.userId, applyError: null })
    .where(eq(sc.id, id));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'stock_count.apply_started',
    entityType: 'stock_count',
    entityId: id,
    after: { lines: frozen.length, value },
  });
  if (frozen.length > BACK_OFFICE_LIMITS.countApplyBatch) {
    return { count: await view(tx, actor, await loadCount(tx, id)), queued: true };
  }
  await applyStockCountBatch(tx, actor, id);
  return { count: await view(tx, actor, await loadCount(tx, id)), queued: false };
}

/**
 * Applies the next 500 frozen lines of an `applying` count as `count`
 * adjustments, and finishes it after the last (§7). Idempotent per line, so
 * a redelivered message writes nothing twice. Returns whether it finished.
 */
export async function applyStockCountBatch(
  tx: TenantTx,
  actor: Actor,
  id: string,
  size: number = BACK_OFFICE_LIMITS.countApplyBatch,
): Promise<{ done: boolean; applied: number }> {
  const count = await loadCount(tx, id, true);
  if (count.status !== 'applying') return { done: count.status === 'applied', applied: 0 };
  const batch = await tx.db
    .select()
    .from(scl)
    .where(and(eq(scl.stockCountId, id), isNotNull(scl.difference), isNull(scl.appliedAt)))
    .orderBy(scl.variantId)
    .limit(size);
  const ref = { referenceType: 'stock_count', referenceId: id };
  await applyMovements(
    tx,
    actor,
    batch
      .filter((l) => l.difference !== 0)
      .map((l) => ({
        ...ref,
        variantId: l.variantId,
        locationId: count.locationId,
        type: 'adjustment' as const,
        quantity: l.difference as number,
        reason: 'count',
        note: documentNumber('SC', count.number),
        unitCost: l.unitCost,
        idempotencyKey: `stock_count:${id}:${l.variantId}`,
      })),
  );
  if (batch.length) {
    await tx.db.execute(sql`
      update store.stock_count_lines set applied_at = now()
       where stock_count_id = ${id} and variant_id = any(${sql.param(batch.map((l) => l.variantId))}::uuid[])`);
  }
  const [left] = await tx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(scl)
    .where(and(eq(scl.stockCountId, id), isNotNull(scl.difference), isNull(scl.appliedAt)));
  if ((left?.n ?? 0) > 0) return { done: false, applied: batch.length };

  const [totals] = await tx.db
    .select({
      adjusted: sql<number>`count(*) filter (where ${scl.difference} <> 0)::int`,
      units: sql<number>`coalesce(sum(${scl.difference}), 0)::int`,
      value: sql<string>`coalesce(sum(${scl.difference} * coalesce(${scl.unitCost}, 0)), 0)`,
    })
    .from(scl)
    .where(eq(scl.stockCountId, id));
  stockCountMachine.transition('applying', 'finish', undefined);
  await tx.db.update(sc).set({ status: 'applied', appliedAt: sql`now()` }).where(eq(sc.id, id));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'stock_count.applied',
    entityType: 'stock_count',
    entityId: id,
    after: {
      number: count.number,
      adjusted: totals?.adjusted ?? 0,
      units: totals?.units ?? 0,
      value: Number(totals?.value ?? 0),
      appliedBy: count.appliedBy,
    },
  });
  await emit(tx, 'stock_count.applied', {
    aggregateType: 'stock_count',
    aggregateId: id,
    payload: { number: count.number, adjusted: totals?.adjusted ?? 0 },
  });
  return { done: true, applied: batch.length };
}

/** A queued apply that keeps failing sends the count back to review, marked (§7). */
export async function failStockCountApply(tx: TenantTx, id: string, error: string): Promise<void> {
  const count = await loadCount(tx, id, true);
  if (count.status !== 'applying') return;
  stockCountMachine.transition('applying', 'fail', undefined);
  await tx.db
    .update(sc)
    .set({ status: 'review', applyError: error.slice(0, 500) })
    .where(eq(sc.id, id));
}
