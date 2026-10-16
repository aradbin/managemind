// Inventory (phase-2-plan §3.8): the only code that writes stock levels and
// the stock ledger. Every change is a batch of movements applied in one
// transaction: the levels are locked (in a fixed order, so batches never
// deadlock), checked, and updated together with the ledger rows, in a fixed
// number of round trips whatever the batch size.
//
// The invariant: for every variant and location, on_hand is the sum of its
// receive, return, adjustment and sale movements, and reserved the sum of its
// reservation and release movements. `inventoryDrift` checks it.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  inventoryAdjustments,
  MOVEMENT_EFFECT,
  type StockMovementType,
} from '@managemind/shared/catalog';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput } from '../catalog/common';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';

export interface Movement {
  variantId: string;
  /** The store's default location when left out. */
  locationId?: string | undefined;
  type: StockMovementType;
  /** Signed, as stored: positive receives, negative sales (see MOVEMENT_EFFECT). */
  quantity: number;
  reason: string;
  note?: string | null | undefined;
  referenceType?: string | undefined;
  referenceId?: string | undefined;
  /** Unique per store: a repeated key writes nothing (queues and retries deliver twice). */
  idempotencyKey?: string | undefined;
}

export interface Level {
  variantId: string;
  locationId: string;
  onHand: number;
  reserved: number;
  available: number;
}

export interface ApplyResult {
  /** Movements written; those whose idempotency key was already used are skipped. */
  applied: number;
  skipped: number;
  levels: Level[];
}

const MAX_BATCH = 5_000;

/** The store's default stock location. */
export async function defaultLocationId(tx: TenantTx): Promise<string> {
  const sl = schema.stockLocations;
  const [row] = await tx.db.select({ id: sl.id }).from(sl).where(eq(sl.isDefault, true));
  if (!row) throw new AppError('internal', { detail: 'the store has no default stock location' });
  return row.id;
}

function checkSign(m: Movement): void {
  const { sign } = MOVEMENT_EFFECT[m.type];
  const ok =
    Number.isSafeInteger(m.quantity) &&
    m.quantity !== 0 &&
    (sign === 0 || Math.sign(m.quantity) === sign);
  if (!ok) throw new AppError('internal', { detail: `bad quantity ${m.quantity} for ${m.type}` });
}

/**
 * Applies movements in order, as one unit: all or nothing. Refuses a sale or
 * reservation that would take available stock below zero, an adjustment
 * that would take on hand below zero, and a release of more than is
 * reserved, unless the variant allows backorders or isn't tracked.
 */
export async function applyMovements(
  tx: TenantTx,
  actor: Actor,
  movements: readonly Movement[],
): Promise<ApplyResult> {
  if (!movements.length) return { applied: 0, skipped: 0, levels: [] };
  if (movements.length > MAX_BATCH) throw new AppError('limit_exceeded');
  for (const m of movements) checkSign(m);
  const fallback = movements.some((m) => !m.locationId) ? await defaultLocationId(tx) : '';
  const moves = movements.map((m) => ({ ...m, locationId: m.locationId ?? fallback }));
  const key = (m: { variantId: string; locationId: string }) => `${m.variantId}:${m.locationId}`;

  // 1. Make sure every level row exists, then lock them in a fixed order.
  const pairs = [...new Map(moves.map((m) => [key(m), m])).values()].sort((a, b) =>
    key(a) < key(b) ? -1 : 1,
  );
  const variantIds = pairs.map((m) => m.variantId);
  const locationIds = pairs.map((m) => m.locationId);
  try {
    await tx.db.execute(sql`
      insert into store.inventory_levels (variant_id, location_id)
      select * from unnest(${sql.param(variantIds)}::uuid[], ${sql.param(locationIds)}::uuid[])
      on conflict do nothing`);
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code;
    if (code === '23503')
      throw new AppError('not_found', { detail: 'unknown variant or location' });
    throw e;
  }
  const { rows } = await tx.db.execute<{
    variant_id: string;
    location_id: string;
    on_hand: number;
    reserved: number;
    tracked: boolean;
    backorder: boolean;
  }>(sql`
    select l.variant_id, l.location_id, l.on_hand, l.reserved,
           v.track_inventory as tracked, v.allow_backorder as backorder
      from store.inventory_levels l join store.variants v on v.id = l.variant_id
     where (l.variant_id, l.location_id) in (
       select * from unnest(${sql.param(variantIds)}::uuid[], ${sql.param(locationIds)}::uuid[]))
     order by l.variant_id, l.location_id
     for update of l`);
  const levels = new Map(
    rows.map((r) => [key({ variantId: r.variant_id, locationId: r.location_id }), { ...r }]),
  );

  // 2. Movements already written under the same idempotency key are skipped.
  const keys = moves.map((m) => m.idempotencyKey).filter((k): k is string => Boolean(k));
  const done = new Set<string>();
  if (keys.length) {
    const { rows: existing } = await tx.db.execute<{ k: string }>(sql`
      select idempotency_key as k from store.stock_movements
       where idempotency_key = any(${sql.param(keys)}::text[])`);
    for (const row of existing) done.add(row.k);
  }

  // 3. Apply in order, checking each step.
  const written: (typeof moves)[number][] = [];
  for (const m of moves) {
    if (m.idempotencyKey) {
      if (done.has(m.idempotencyKey)) continue;
      done.add(m.idempotencyKey);
    }
    const level = levels.get(key(m));
    if (!level) throw new AppError('not_found');
    const free = !level.tracked || level.backorder;
    if (MOVEMENT_EFFECT[m.type].column === 'reserved') {
      level.reserved += m.quantity;
      if (level.reserved < 0)
        throw new AppError('insufficient_stock', { detail: 'Releasing more than is reserved' });
      if (m.type === 'reservation' && !free && level.on_hand - level.reserved < 0) {
        throw new AppError('insufficient_stock');
      }
    } else {
      level.on_hand += m.quantity;
      if (!free && m.type === 'sale' && level.on_hand - level.reserved < 0)
        throw new AppError('insufficient_stock');
      if (!free && m.type === 'adjustment' && m.quantity < 0 && level.on_hand < 0) {
        throw new AppError('insufficient_stock');
      }
    }
    written.push(m);
  }

  // 4. The ledger rows and the new levels, one statement each.
  if (written.length) {
    const actorType = auditActor(actor, 'staff').actorType;
    const col = <T>(f: (m: (typeof written)[number]) => T) => sql.param(written.map(f));
    try {
      await tx.db.execute(sql`
        insert into store.stock_movements
          (variant_id, location_id, type, quantity, reason, note, reference_type, reference_id,
           idempotency_key, actor_type, actor_id)
        select v, l, t, q, r, n, rt, ri, k, ${actorType}, ${actor.userId}::uuid
          from unnest(${col((m) => m.variantId)}::uuid[], ${col((m) => m.locationId)}::uuid[],
                      ${col((m) => m.type)}::text[], ${col((m) => m.quantity)}::int[],
                      ${col((m) => m.reason)}::text[], ${col((m) => m.note ?? null)}::text[],
                      ${col((m) => m.referenceType ?? null)}::text[], ${col((m) => m.referenceId ?? null)}::uuid[],
                      ${col((m) => m.idempotencyKey ?? null)}::text[])
            as x(v, l, t, q, r, n, rt, ri, k)`);
    } catch (e) {
      const code = (e as { cause?: { code?: string } }).cause?.code;
      if (code === '23505')
        throw new AppError('conflict', { detail: 'idempotency key used for another movement' });
      throw e;
    }
    const changed = [...new Map(written.map((m) => [key(m), m])).keys()].map(
      (k) => levels.get(k) as (typeof rows)[number],
    );
    await tx.db.execute(sql`
      update store.inventory_levels l
         set on_hand = x.on_hand, reserved = x.reserved, updated_at = now()
        from unnest(${sql.param(changed.map((c) => c.variant_id))}::uuid[],
                    ${sql.param(changed.map((c) => c.location_id))}::uuid[],
                    ${sql.param(changed.map((c) => c.on_hand))}::int[],
                    ${sql.param(changed.map((c) => c.reserved))}::int[]) as x(variant_id, location_id, on_hand, reserved)
       where l.variant_id = x.variant_id and l.location_id = x.location_id`);
    const ids = [...new Set(written.map((m) => m.variantId))];
    for (let i = 0; i < ids.length; i += 500) {
      await emit(tx, 'inventory.level.changed', {
        aggregateType: 'inventory',
        payload: { variantIds: ids.slice(i, i + 500), reason: written[0]?.reason ?? 'adjustment' },
      });
    }
  }
  return {
    applied: written.length,
    skipped: moves.length - written.length,
    levels: [...levels.values()].map((l) => ({
      variantId: l.variant_id,
      locationId: l.location_id,
      onHand: l.on_hand,
      reserved: l.reserved,
      available: l.on_hand - l.reserved,
    })),
  };
}

// ---- Commands ----------------------------------------------------------------------

type Common = Omit<Movement, 'type' | 'quantity'>;
const positive = (quantity: number) => {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'quantity', code: 'too_small', message: 'more than zero' }],
    });
  }
  return quantity;
};

export const receive = (tx: TenantTx, actor: Actor, m: Common & { quantity: number }) =>
  applyMovements(tx, actor, [{ ...m, type: 'receive', quantity: positive(m.quantity) }]);

export const returnStock = (tx: TenantTx, actor: Actor, m: Common & { quantity: number }) =>
  applyMovements(tx, actor, [{ ...m, type: 'return', quantity: positive(m.quantity) }]);

export const reserve = (tx: TenantTx, actor: Actor, m: Common & { quantity: number }) =>
  applyMovements(tx, actor, [{ ...m, type: 'reservation', quantity: positive(m.quantity) }]);

export const release = (tx: TenantTx, actor: Actor, m: Common & { quantity: number }) =>
  applyMovements(tx, actor, [{ ...m, type: 'release', quantity: -positive(m.quantity) }]);

/**
 * A sale. With `fromReservation`, it fulfils a reservation: a release and a
 * sale of the same quantity in one transaction (Phase 4's fulfilment).
 */
export const sell = (
  tx: TenantTx,
  actor: Actor,
  m: Common & { quantity: number; fromReservation?: boolean },
) => {
  const { fromReservation, ...rest } = m;
  const quantity = positive(m.quantity);
  const sale: Movement = { ...rest, type: 'sale', quantity: -quantity };
  return applyMovements(
    tx,
    actor,
    fromReservation
      ? [
          {
            ...rest,
            type: 'release',
            quantity: -quantity,
            idempotencyKey: rest.idempotencyKey && `${rest.idempotencyKey}:release`,
          },
          sale,
        ]
      : [sale],
  );
};

export const adjust = (tx: TenantTx, actor: Actor, m: Common & { quantity: number }) =>
  applyMovements(tx, actor, [{ ...m, type: 'adjustment', quantity: m.quantity }]);

export interface OnHandTarget {
  variantId: string;
  locationId?: string | undefined;
  onHand: number;
  reason: string;
  note?: string | null | undefined;
  referenceType?: string | undefined;
  referenceId?: string | undefined;
  idempotencyKey?: string | undefined;
}

/**
 * Sets on-hand counts: one adjustment for each difference, none when equal.
 * Set-based (the import passes a chunk's counts at once, §3.7).
 */
export async function setOnHand(
  tx: TenantTx,
  actor: Actor,
  targets: readonly OnHandTarget[],
): Promise<ApplyResult> {
  if (!targets.length) return { applied: 0, skipped: 0, levels: [] };
  const fallback = targets.some((t) => !t.locationId) ? await defaultLocationId(tx) : '';
  const resolved = targets.map((t) => ({ ...t, locationId: t.locationId ?? fallback }));
  // Create missing levels first, so two counts of a new variant can't both start from zero;
  // then read the current counts under lock (applyMovements locks again, in the same order).
  await tx.db.execute(sql`
    insert into store.inventory_levels (variant_id, location_id)
    select * from unnest(${sql.param(resolved.map((t) => t.variantId))}::uuid[],
                         ${sql.param(resolved.map((t) => t.locationId))}::uuid[])
    on conflict do nothing`);
  const { rows } = await tx.db.execute<{
    variant_id: string;
    location_id: string;
    on_hand: number;
    reserved: number;
  }>(sql`
    select variant_id, location_id, on_hand, reserved from store.inventory_levels
     where (variant_id, location_id) in (
       select * from unnest(${sql.param(resolved.map((t) => t.variantId))}::uuid[],
                            ${sql.param(resolved.map((t) => t.locationId))}::uuid[]))
     order by variant_id, location_id
     for update`);
  const current = new Map(rows.map((r) => [`${r.variant_id}:${r.location_id}`, r.on_hand]));
  const movements: Movement[] = [];
  for (const t of resolved) {
    const delta = t.onHand - (current.get(`${t.variantId}:${t.locationId}`) ?? 0);
    current.set(`${t.variantId}:${t.locationId}`, t.onHand);
    if (delta === 0) continue;
    const { onHand: _onHand, ...rest } = t;
    movements.push({ ...rest, type: 'adjustment', quantity: delta });
  }
  if (movements.length) return applyMovements(tx, actor, movements);
  // Nothing changed: report the levels as they are.
  return {
    applied: 0,
    skipped: 0,
    levels: rows.map((r) => ({
      variantId: r.variant_id,
      locationId: r.location_id,
      onHand: r.on_hand,
      reserved: r.reserved,
      available: r.on_hand - r.reserved,
    })),
  };
}

/** POST /inventory/adjustments: deltas and counts from the admin, with a reason (§7). */
export async function adjustInventory(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<ApplyResult> {
  authorize(actor, 'inventory.write');
  const lines = parseInput(inventoryAdjustments, input);
  const deltas: Movement[] = [];
  const counts: OnHandTarget[] = [];
  for (const line of lines) {
    const base = {
      variantId: line.variantId,
      locationId: line.locationId,
      reason: line.reason,
      note: line.note ?? null,
    };
    if (line.mode === 'delta')
      deltas.push({
        ...base,
        type: line.quantity > 0 && line.reason === 'received' ? 'receive' : 'adjustment',
        quantity: line.quantity,
      });
    else counts.push({ ...base, onHand: line.onHand });
  }
  const first = await applyMovements(tx, actor, deltas);
  const second = await setOnHand(tx, actor, counts);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'inventory.adjusted',
    entityType: 'inventory',
    after: { lines, applied: first.applied + second.applied },
  });
  return {
    applied: first.applied + second.applied,
    skipped: first.skipped + second.skipped,
    levels: [...first.levels, ...second.levels],
  };
}

// ---- Reads ---------------------------------------------------------------------------

export type InventoryRow = {
  variantId: string;
  productId: string;
  titles: Record<string, string>;
  optionLabels: Record<string, string>[];
  sku: string | null;
  trackInventory: boolean;
  allowBackorder: boolean;
  lowStockThreshold: number | null;
  onHand: number;
  reserved: number;
  available: number;
  lowStock: boolean;
};

/** Stock per live variant, summed over locations (or one location), lowest available first when filtered. */
export async function listInventory(
  tx: TenantTx,
  actor: Actor,
  query: {
    lowStock?: boolean | undefined;
    locationId?: string | undefined;
    q?: string | undefined;
    after?: string | undefined;
    limit?: number | undefined;
  } = {},
): Promise<{ items: InventoryRow[]; nextCursor: string | null }> {
  authorize(actor, 'inventory.read');
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const location = query.locationId ? sql`and l.location_id = ${query.locationId}` : sql``;
  const { rows } = await tx.db.execute<InventoryRow>(sql`
    select * from (
      select v.id as "variantId", v.product_id as "productId", v.sku,
        v.track_inventory as "trackInventory", v.allow_backorder as "allowBackorder",
        v.low_stock_threshold as "lowStockThreshold",
        coalesce((select json_object_agg(t.locale, t.title) from store.product_translations t
                   where t.product_id = v.product_id), '{}'::json) as titles,
        coalesce((select json_agg((select json_object_agg(vt.locale, vt.label)
                    from store.product_option_value_translations vt where vt.value_id = vo.value_id)
                    order by o.position)
                   from store.variant_option_values vo
                   join store.product_option_values ov on ov.id = vo.value_id
                   join store.product_options o on o.id = ov.option_id
                  where vo.variant_id = v.id), '[]'::json) as "optionLabels",
        coalesce(s.on_hand, 0)::int as "onHand", coalesce(s.reserved, 0)::int as reserved,
        coalesce(s.on_hand - s.reserved, 0)::int as available,
        (v.track_inventory and v.low_stock_threshold is not null
          and coalesce(s.on_hand - s.reserved, 0) <= v.low_stock_threshold) as "lowStock"
      from store.variants v
      join store.products p on p.id = v.product_id and p.status <> 'archived'
      left join lateral (select sum(l.on_hand) as on_hand, sum(l.reserved) as reserved
                           from store.inventory_levels l where l.variant_id = v.id ${location}) s on true
      where v.archived_at is null
        ${query.after ? sql`and v.id > ${query.after}` : sql``}
        ${
          query.q
            ? sql`and (lower(v.sku) like ${`${query.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`}
          or exists (select 1 from store.product_translations t where t.product_id = v.product_id
                      and app.search_text(t.title) like app.search_text(${`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`})))`
            : sql``
        }
      order by v.id
    ) x ${query.lowStock ? sql`where "lowStock"` : sql``}
    limit ${limit + 1}`);
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? (items[items.length - 1]?.variantId ?? null) : null,
  };
}

export type MovementRow = {
  id: string;
  locationId: string;
  type: StockMovementType;
  quantity: number;
  reason: string;
  note: string | null;
  referenceType: string | null;
  referenceId: string | null;
  actorType: string;
  actorId: string | null;
  createdAt: string;
};

/** A variant's ledger, newest first. */
export async function listMovements(
  tx: TenantTx,
  actor: Actor,
  variantId: string,
  page: { before?: string | undefined; limit?: number | undefined } = {},
): Promise<{ items: MovementRow[]; nextCursor: string | null }> {
  authorize(actor, 'inventory.read');
  // An unknown variant (or another store's) is not found, not an empty ledger.
  const [variant] = await tx.db
    .select({ id: schema.variants.id })
    .from(schema.variants)
    .where(eq(schema.variants.id, variantId));
  if (!variant) throw new AppError('not_found');
  const limit = Math.min(Math.max(page.limit ?? 50, 1), 200);
  const { rows } = await tx.db.execute<MovementRow>(sql`
    select id, location_id as "locationId", type, quantity, reason, note,
           reference_type as "referenceType", reference_id as "referenceId",
           actor_type as "actorType", actor_id as "actorId", created_at as "createdAt"
      from store.stock_movements
     where variant_id = ${variantId} ${page.before ? sql`and id < ${page.before}` : sql``}
     order by id desc limit ${limit + 1}`);
  const items = rows
    .slice(0, limit)
    .map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
  return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null };
}

/**
 * Levels that differ from their movements' sums in the transaction's store
 * (the invariant, §3.8). Empty when all is well.
 */
export async function inventoryDrift(tx: TenantTx): Promise<
  {
    variantId: string;
    locationId: string;
    onHand: number;
    reserved: number;
    movedOnHand: number;
    movedReserved: number;
  }[]
> {
  const { rows } = await tx.db.execute<{
    variantId: string;
    locationId: string;
    onHand: number;
    reserved: number;
    movedOnHand: number;
    movedReserved: number;
  }>(sql`
    select coalesce(l.variant_id, m.variant_id) as "variantId", coalesce(l.location_id, m.location_id) as "locationId",
           coalesce(l.on_hand, 0) as "onHand", coalesce(l.reserved, 0) as reserved,
           coalesce(m.on_hand, 0)::int as "movedOnHand", coalesce(m.reserved, 0)::int as "movedReserved"
      from store.inventory_levels l
      full join (
        select variant_id, location_id,
               sum(quantity) filter (where type in ('receive', 'return', 'adjustment', 'sale')) as on_hand,
               sum(quantity) filter (where type in ('reservation', 'release')) as reserved
          from store.stock_movements group by variant_id, location_id) m
        on m.variant_id = l.variant_id and m.location_id = l.location_id
     where coalesce(l.on_hand, 0) <> coalesce(m.on_hand, 0) or coalesce(l.reserved, 0) <> coalesce(m.reserved, 0)`);
  return rows;
}

// ---- Stock locations -------------------------------------------------------------------

const locationAddress = z
  .object({
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().min(1).max(200).optional(),
    city: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
const locationPatch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  address: locationAddress.nullable().optional(),
});

export interface StockLocation {
  id: string;
  name: string;
  isDefault: boolean;
  address: z.infer<typeof locationAddress> | null;
}

/** The store's stock locations, the default first. */
export async function listLocations(tx: TenantTx, actor: Actor): Promise<StockLocation[]> {
  authorize(actor, 'inventory.read');
  const sl = schema.stockLocations;
  const rows = await tx.db
    .select({ id: sl.id, name: sl.name, isDefault: sl.isDefault, address: sl.address })
    .from(sl)
    .orderBy(sql`${sl.isDefault} desc`, sl.createdAt);
  return rows.map((r) => ({ ...r, address: (r.address as StockLocation['address']) ?? null }));
}

/** Renames a location or sets its address (store settings, §7). */
export async function updateLocation(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<StockLocation> {
  authorize(actor, 'settings.write');
  const patch = parseInput(locationPatch, input);
  const sl = schema.stockLocations;
  const [before] = await tx.db.select().from(sl).where(eq(sl.id, id)).for('update');
  if (!before) throw new AppError('not_found');
  const [after] = await tx.db
    .update(sl)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.address !== undefined ? { address: patch.address } : {}),
    })
    .where(eq(sl.id, id))
    .returning();
  if (!after) throw new AppError('not_found');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'location.updated',
    entityType: 'stock_location',
    entityId: id,
    before: { name: before.name, address: before.address },
    after: { name: after.name, address: after.address },
  });
  return {
    id: after.id,
    name: after.name,
    isDefault: after.isDefault,
    address: (after.address as StockLocation['address']) ?? null,
  };
}
