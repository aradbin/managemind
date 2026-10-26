// Each variant's cost (phase-8-plan §3.3, ADR 0031): the moving weighted
// average that receipts and restocked returns move, the corrections staff
// and the catalog import make, and the history of every change.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { type CostSource, weightedAverageCost } from '@managemind/shared/back-office';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import type { TenantTx } from '../tenant';

export interface CostReference {
  referenceType: string;
  referenceId: string;
}

/** Units coming in at a cost: a receipt's line, or a restocked return. */
export interface IncomingUnits {
  variantId: string;
  quantity: number;
  /** Landed, per unit. */
  unitCost: number;
}

export interface CostChange {
  variantId: string;
  oldCost: number | null;
  newCost: number | null;
}

const num = (v: string | number | null) => (v === null ? null : Number(v));

async function insertChanges(
  tx: TenantTx,
  actor: Actor,
  changes: readonly (CostChange & { onHand: number })[],
  source: CostSource,
  ref: CostReference | null,
): Promise<void> {
  if (!changes.length) return;
  const { actorType, actorId } = auditActor(actor, 'staff');
  await tx.db.insert(schema.costChanges).values(
    changes.map((c) => ({
      variantId: c.variantId,
      oldCost: c.oldCost,
      newCost: c.newCost,
      onHand: c.onHand,
      source,
      referenceType: ref?.referenceType ?? null,
      referenceId: ref?.referenceId ?? null,
      actorType,
      actorId: actorId ?? null,
    })),
  );
}

/**
 * Moves the average for units coming in (§3.3). Call it before the units'
 * movements are applied: the average weighs them against what was on hand
 * before them. The variants and their levels are locked in the inventory
 * service's order, so a sale can't change on hand in between.
 */
export async function receiveAtCost(
  tx: TenantTx,
  actor: Actor,
  units: readonly IncomingUnits[],
  source: Extract<CostSource, 'receipt' | 'return'>,
  ref: CostReference,
): Promise<CostChange[]> {
  const incoming = units.filter((u) => u.quantity > 0);
  if (!incoming.length) return [];
  const ids = [...new Set(incoming.map((u) => u.variantId))].sort();
  const { rows: variants } = await tx.db.execute<{ id: string; cost: string | null }>(sql`
    select id, cost_price as cost from store.variants
     where id = any(${sql.param(ids)}::uuid[]) order by id for update`);
  if (variants.length !== ids.length)
    throw new AppError('not_found', { detail: 'unknown variant' });
  const { rows: levels } = await tx.db.execute<{ variant_id: string; on_hand: number }>(sql`
    select variant_id, on_hand from store.inventory_levels
     where variant_id = any(${sql.param(ids)}::uuid[])
     order by variant_id, location_id for update`);
  const onHand = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const l of levels) onHand.set(l.variant_id, (onHand.get(l.variant_id) ?? 0) + l.on_hand);
  const cost = new Map(variants.map((v) => [v.id, num(v.cost)]));
  const before = new Map(cost);
  const beforeOnHand = new Map(onHand);

  // Units of the same variant come in one after another.
  for (const u of incoming) {
    const q = onHand.get(u.variantId) ?? 0;
    cost.set(
      u.variantId,
      weightedAverageCost(q, cost.get(u.variantId) ?? null, u.quantity, u.unitCost),
    );
    onHand.set(u.variantId, q + u.quantity);
  }
  const changes = ids
    .map((id) => ({
      variantId: id,
      oldCost: before.get(id) ?? null,
      newCost: cost.get(id) ?? null,
      onHand: beforeOnHand.get(id) ?? 0,
    }))
    .filter((c) => c.oldCost !== c.newCost);
  if (changes.length) {
    await tx.db.execute(sql`
      update store.variants v set cost_price = x.cost, updated_at = now()
        from unnest(${sql.param(changes.map((c) => c.variantId))}::uuid[],
                    ${sql.param(changes.map((c) => c.newCost))}::bigint[]) as x(id, cost)
       where v.id = x.id`);
    await insertChanges(tx, actor, changes, source, ref);
  }
  return changes.map(({ onHand: _o, ...c }) => c);
}

/**
 * Restocked returns and failed deliveries come back in as a receipt at their
 * order line's cost (§3.3). Lines sold without a cost move nothing.
 */
export async function restockAtLineCost(
  tx: TenantTx,
  actor: Actor,
  lines: readonly { variant_id: string; quantity: number; cost_price: string | number | null }[],
  ref: CostReference,
): Promise<CostChange[]> {
  return receiveAtCost(
    tx,
    actor,
    lines.flatMap((l) =>
      l.cost_price === null
        ? []
        : [{ variantId: l.variant_id, quantity: l.quantity, unitCost: Number(l.cost_price) }],
    ),
    'return',
    ref,
  );
}

/**
 * Records costs set as typed (§3.3): staff with catalog.cost, or the
 * catalog import's cost column. The caller has already written them.
 */
export async function recordCostCorrections(
  tx: TenantTx,
  actor: Actor,
  changes: readonly CostChange[],
  source: Extract<CostSource, 'manual' | 'import'>,
  ref: CostReference | null = null,
): Promise<void> {
  const real = changes.filter((c) => c.oldCost !== c.newCost);
  if (!real.length) return;
  const { rows } = await tx.db.execute<{ variant_id: string; on_hand: number }>(sql`
    select variant_id, coalesce(sum(on_hand), 0)::int as on_hand from store.inventory_levels
     where variant_id = any(${sql.param(real.map((c) => c.variantId))}::uuid[])
     group by variant_id`);
  const onHand = new Map(rows.map((r) => [r.variant_id, r.on_hand]));
  await insertChanges(
    tx,
    actor,
    real.map((c) => ({ ...c, onHand: onHand.get(c.variantId) ?? 0 })),
    source,
    ref,
  );
}

export interface CostHistoryRow {
  id: string;
  oldCost: number | null;
  newCost: number | null;
  onHand: number;
  source: CostSource;
  referenceType: string | null;
  referenceId: string | null;
  actorType: string;
  actorId: string | null;
  createdAt: string;
}

/** GET /variants/{id}/cost-history: newest first (catalog.cost). */
export async function variantCostHistory(
  tx: TenantTx,
  actor: Actor,
  variantId: string,
  page: { before?: string | undefined; limit?: number | undefined } = {},
): Promise<{ items: CostHistoryRow[]; nextCursor: string | null }> {
  authorize(actor, 'catalog.cost');
  const [variant] = await tx.db
    .select({ id: schema.variants.id })
    .from(schema.variants)
    .where(eq(schema.variants.id, variantId));
  if (!variant) throw new AppError('not_found');
  const c = schema.costChanges;
  const limit = Math.min(Math.max(page.limit ?? 50, 1), 200);
  const rows = await tx.db
    .select()
    .from(c)
    .where(
      page.before
        ? and(eq(c.variantId, variantId), lt(c.id, page.before))
        : eq(c.variantId, variantId),
    )
    .orderBy(desc(c.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit).map((r) => ({
    id: r.id,
    oldCost: r.oldCost,
    newCost: r.newCost,
    onHand: r.onHand,
    source: r.source,
    referenceType: r.referenceType,
    referenceId: r.referenceId,
    actorType: r.actorType,
    actorId: r.actorId,
    createdAt: r.createdAt.toISOString(),
  }));
  return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null };
}
