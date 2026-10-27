// Inventory → Adjustments (phase-8-plan §3.4): every adjustment and every
// receipt typed by hand, with its reason, location, who made it and its value
// at the cost it was made at, filtered, with totals. Values need catalog.cost.
import { AppError } from '@managemind/shared';
import { ADJUSTMENT_REASONS } from '@managemind/shared/catalog';
import { type SQL, sql } from 'drizzle-orm';
import { type Actor, authorize } from '../access';
import { money, requireBackOffice, seesCost } from '../purchasing/common';
import { type Localized, variantLabels } from '../purchasing/variants';
import type { TenantTx } from '../tenant';

export interface AdjustmentRow {
  id: string;
  variantId: string;
  productId: string;
  title: Localized;
  optionLabels: Localized[];
  sku: string | null;
  locationId: string;
  quantity: number;
  reason: string;
  note: string | null;
  referenceType: string | null;
  referenceId: string | null;
  actorType: string;
  actorId: string | null;
  createdAt: string;
  unitCost?: number | null;
  value?: number | null;
}

export interface AdjustmentQuery {
  reason?: string | undefined;
  locationId?: string | undefined;
  actorId?: string | undefined;
  /** Dhaka dates, inclusive. */
  from?: string | undefined;
  to?: string | undefined;
  before?: string | undefined;
  limit?: number | undefined;
}

/** Adjustments, and receipts typed by hand rather than received through purchasing. */
const isAdjustment = sql`(m.type = 'adjustment' or (m.type = 'receive' and m.reference_type is null))`;

function filters(q: AdjustmentQuery): SQL {
  const parts: SQL[] = [isAdjustment];
  if (q.reason) {
    if (!(ADJUSTMENT_REASONS as readonly string[]).includes(q.reason)) {
      throw new AppError('validation_failed', {
        fields: [{ path: 'reason', code: 'invalid', message: 'not a reason' }],
      });
    }
    parts.push(sql`m.reason = ${q.reason}`);
  }
  if (q.locationId) parts.push(sql`m.location_id = ${q.locationId}`);
  if (q.actorId) parts.push(sql`m.actor_id = ${q.actorId}`);
  if (q.from)
    parts.push(sql`m.created_at >= (${q.from}::date)::timestamp at time zone 'Asia/Dhaka'`);
  if (q.to) {
    parts.push(sql`m.created_at < (${q.to}::date + 1)::timestamp at time zone 'Asia/Dhaka'`);
  }
  return sql.join(parts, sql` and `);
}

/** GET /inventory/adjustments: newest first, with totals over every page. */
export async function listAdjustments(
  tx: TenantTx,
  actor: Actor,
  q: AdjustmentQuery = {},
): Promise<{
  items: AdjustmentRow[];
  nextCursor: string | null;
  totals: { count: number; units: number; value?: number; unvalued: number };
}> {
  authorize(actor, 'inventory.read');
  await requireBackOffice(tx);
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const where = filters(q);
  const { rows } = await tx.db.execute<{
    id: string;
    variant_id: string;
    location_id: string;
    quantity: number;
    reason: string;
    note: string | null;
    reference_type: string | null;
    reference_id: string | null;
    actor_type: string;
    actor_id: string | null;
    created_at: string;
    unit_cost: string | null;
  }>(sql`
    select m.id, m.variant_id, m.location_id, m.quantity, m.reason, m.note, m.reference_type,
           m.reference_id, m.actor_type, m.actor_id, m.created_at, m.unit_cost
      from store.stock_movements m
     where ${where} ${q.before ? sql`and m.id < ${q.before}` : sql``}
     order by m.id desc limit ${limit + 1}`);
  const { rows: sums } = await tx.db.execute<{
    count: number;
    units: number;
    value: string;
    unvalued: number;
  }>(sql`
    select count(*)::int as count, coalesce(sum(m.quantity), 0)::int as units,
           coalesce(sum(m.quantity * m.unit_cost), 0) as value,
           count(*) filter (where m.unit_cost is null)::int as unvalued
      from store.stock_movements m where ${where}`);
  const page = rows.slice(0, limit);
  const labels = await variantLabels(
    tx,
    page.map((r) => r.variant_id),
  );
  const cost = seesCost(actor);
  const items = page.map((r) => {
    const label = labels.get(r.variant_id);
    const unitCost = money(r.unit_cost);
    return {
      id: r.id,
      variantId: r.variant_id,
      productId: label?.productId ?? '',
      title: label?.title ?? {},
      optionLabels: label?.optionLabels ?? [],
      sku: label?.sku ?? null,
      locationId: r.location_id,
      quantity: r.quantity,
      reason: r.reason,
      note: r.note,
      referenceType: r.reference_type,
      referenceId: r.reference_id,
      actorType: r.actor_type,
      actorId: r.actor_id,
      createdAt: new Date(r.created_at).toISOString(),
      ...(cost ? { unitCost, value: unitCost === null ? null : unitCost * r.quantity } : {}),
    };
  });
  const s = sums[0];
  return {
    items,
    nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null,
    totals: {
      count: s?.count ?? 0,
      units: s?.units ?? 0,
      unvalued: s?.unvalued ?? 0,
      ...(cost ? { value: Number(s?.value ?? 0) } : {}),
    },
  };
}
