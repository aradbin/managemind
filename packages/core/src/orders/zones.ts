// Delivery zones and fees (phase-4-plan §3.3). An area belongs to the zone
// that lists it, else to the zone that lists its district, else to the
// store's fallback zone. The fee is flat, plus an optional charge for each
// kilogram (or part of one) over the weight the fee includes.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { DELIVERY_LIMITS, deliveryZoneInput } from '@managemind/shared/orders';
import { eq, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput, pgError } from '../catalog/common';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';
import type { Localized } from './variants';

export interface DeliveryZone {
  id: string;
  name: Localized;
  fee: number;
  freeWeightGrams: number | null;
  feePerExtraKg: number | null;
  estimate: Localized;
  isFallback: boolean;
  position: number;
  active: boolean;
  districtIds: number[];
  areaIds: number[];
}

/** The fee for a parcel of `weightGrams` in `zone`. */
export function deliveryFee(
  zone: Pick<DeliveryZone, 'fee' | 'freeWeightGrams' | 'feePerExtraKg'>,
  weightGrams: number,
): number {
  if (zone.freeWeightGrams === null || zone.feePerExtraKg === null) return zone.fee;
  const extra = Math.max(0, weightGrams - zone.freeWeightGrams);
  return zone.fee + Math.ceil(extra / 1000) * zone.feePerExtraKg;
}

type ZoneRow = Omit<DeliveryZone, 'fee' | 'feePerExtraKg'> & {
  fee: number | string;
  feePerExtraKg: number | string | null;
};
const toZone = (r: ZoneRow): DeliveryZone => ({
  ...r,
  fee: Number(r.fee),
  feePerExtraKg: r.feePerExtraKg === null ? null : Number(r.feePerExtraKg),
  districtIds: r.districtIds ?? [],
  areaIds: r.areaIds ?? [],
});

const ZONE_COLUMNS = sql`z.id, z.name, z.fee, z.free_weight_grams as "freeWeightGrams",
  z.fee_per_extra_kg as "feePerExtraKg", z.estimate, z.is_fallback as "isFallback", z.position, z.active,
  coalesce((select array_agg(a.district_id order by a.district_id) from store.delivery_zone_areas a
             where a.zone_id = z.id and a.district_id is not null), '{}') as "districtIds",
  coalesce((select array_agg(a.area_id order by a.area_id) from store.delivery_zone_areas a
             where a.zone_id = z.id and a.area_id is not null), '{}') as "areaIds"`;

/** The active zone an area belongs to, or null when the store has none for it. */
export async function zoneForArea(tx: TenantTx, areaId: number): Promise<DeliveryZone | null> {
  const { rows } = await tx.db.execute<ZoneRow>(sql`
    select ${ZONE_COLUMNS} from store.delivery_zones z
     where z.active and (
       exists (select 1 from store.delivery_zone_areas a where a.zone_id = z.id and a.area_id = ${areaId})
       or exists (select 1 from store.delivery_zone_areas a join ref.areas r on r.district_id = a.district_id
                   where a.zone_id = z.id and r.id = ${areaId})
       or z.is_fallback)
     order by
       exists (select 1 from store.delivery_zone_areas a where a.zone_id = z.id and a.area_id = ${areaId}) desc,
       z.is_fallback, z.position
     limit 1`);
  return rows[0] ? toZone(rows[0]) : null;
}

/** The lowest fee of any active zone: "from ৳70" before an area is chosen. */
export async function lowestDeliveryFee(tx: TenantTx): Promise<number | null> {
  const { rows } = await tx.db.execute<{ fee: string | null }>(
    sql`select min(fee) as fee from store.delivery_zones where active`,
  );
  return rows[0]?.fee == null ? null : Number(rows[0].fee);
}

export async function getZone(tx: TenantTx, id: string): Promise<DeliveryZone | null> {
  const { rows } = await tx.db.execute<ZoneRow>(
    sql`select ${ZONE_COLUMNS} from store.delivery_zones z where z.id = ${id}`,
  );
  return rows[0] ? toZone(rows[0]) : null;
}

/** Settings → Delivery: every zone, in order. */
export async function listZones(tx: TenantTx, actor: Actor): Promise<DeliveryZone[]> {
  authorize(actor, 'settings.read');
  const { rows } = await tx.db.execute<ZoneRow>(
    sql`select ${ZONE_COLUMNS} from store.delivery_zones z order by z.position, z.id`,
  );
  return rows.map(toZone);
}

async function writeCoverage(
  tx: TenantTx,
  zoneId: string,
  districtIds: number[],
  areaIds: number[],
) {
  await tx.db.delete(schema.deliveryZoneAreas).where(eq(schema.deliveryZoneAreas.zoneId, zoneId));
  const rows = [
    ...[...new Set(districtIds)].map((districtId) => ({ zoneId, districtId })),
    ...[...new Set(areaIds)].map((areaId) => ({ zoneId, areaId })),
  ];
  if (!rows.length) return;
  try {
    await tx.db.insert(schema.deliveryZoneAreas).values(rows);
  } catch (e) {
    const { code, constraint = '' } = pgError(e);
    if (code === '23505') {
      throw new AppError('conflict', {
        detail: 'A district or area is already in another zone',
        fields: [
          {
            path: constraint.includes('district') ? 'districtIds' : 'areaIds',
            code: 'taken',
            message: 'already in another zone',
          },
        ],
      });
    }
    if (code === '23503') {
      throw new AppError('validation_failed', {
        fields: [{ path: 'areaIds', code: 'unknown', message: 'not in the list' }],
      });
    }
    throw e;
  }
}

function fallbackTaken(e: unknown): never {
  const { code, constraint } = pgError(e);
  if (code === '23505' && constraint === 'delivery_zones_one_fallback') {
    throw new AppError('conflict', {
      detail: 'The store already has a fallback zone',
      fields: [{ path: 'isFallback', code: 'taken', message: 'only one fallback zone' }],
    });
  }
  throw e;
}

export async function createZone(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<DeliveryZone> {
  authorize(actor, 'settings.write');
  const z = parseInput(deliveryZoneInput, input);
  const { rows } = await tx.db.execute<{ n: number }>(
    sql`select count(*)::int as n from store.delivery_zones`,
  );
  if ((rows[0]?.n ?? 0) >= DELIVERY_LIMITS.zones) throw new AppError('limit_exceeded');
  const [row] = await tx.db
    .insert(schema.deliveryZones)
    .values({
      name: z.name,
      fee: z.fee,
      freeWeightGrams: z.freeWeightGrams,
      feePerExtraKg: z.feePerExtraKg,
      estimate: z.estimate,
      isFallback: z.isFallback,
      position: z.position,
      active: z.active,
    })
    .returning({ id: schema.deliveryZones.id })
    .catch(fallbackTaken);
  if (!row) throw new AppError('internal');
  await writeCoverage(tx, row.id, z.districtIds, z.areaIds);
  const zone = (await getZone(tx, row.id)) as DeliveryZone;
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'delivery_zone.created',
    entityType: 'delivery_zone',
    entityId: row.id,
    after: zone,
  });
  await emit(tx, 'delivery.zones.changed', {
    aggregateType: 'delivery_zone',
    aggregateId: row.id,
    payload: {},
  });
  return zone;
}

export async function updateZone(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<DeliveryZone> {
  authorize(actor, 'settings.write');
  const before = await getZone(tx, id);
  if (!before) throw new AppError('not_found');
  const { id: _id, ...current } = before;
  const z = parseInput(deliveryZoneInput, { ...current, ...(input as object) });
  await tx.db
    .update(schema.deliveryZones)
    .set({
      name: z.name,
      fee: z.fee,
      freeWeightGrams: z.freeWeightGrams,
      feePerExtraKg: z.feePerExtraKg,
      estimate: z.estimate,
      isFallback: z.isFallback,
      position: z.position,
      active: z.active,
    })
    .where(eq(schema.deliveryZones.id, id))
    .catch(fallbackTaken);
  await writeCoverage(tx, id, z.districtIds, z.areaIds);
  const after = (await getZone(tx, id)) as DeliveryZone;
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'delivery_zone.updated',
    entityType: 'delivery_zone',
    entityId: id,
    before,
    after,
  });
  await emit(tx, 'delivery.zones.changed', {
    aggregateType: 'delivery_zone',
    aggregateId: id,
    payload: {},
  });
  return after;
}

/** Past orders keep the zone's name and fee; their reference is cleared. */
export async function deleteZone(tx: TenantTx, actor: Actor, id: string): Promise<void> {
  authorize(actor, 'settings.write');
  const before = await getZone(tx, id);
  if (!before) throw new AppError('not_found');
  await tx.db.delete(schema.deliveryZones).where(eq(schema.deliveryZones.id, id));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'delivery_zone.deleted',
    entityType: 'delivery_zone',
    entityId: id,
    before,
  });
  await emit(tx, 'delivery.zones.changed', {
    aggregateType: 'delivery_zone',
    aggregateId: id,
    payload: {},
  });
}

/** The fee calculator in Settings → Delivery. */
export async function quoteDelivery(
  tx: TenantTx,
  actor: Actor,
  input: { areaId: number; weightGrams: number },
): Promise<{ zone: DeliveryZone | null; fee: number | null }> {
  authorize(actor, 'settings.read');
  const zone = await zoneForArea(tx, input.areaId);
  return { zone, fee: zone ? deliveryFee(zone, Math.max(0, input.weightGrams)) : null };
}
