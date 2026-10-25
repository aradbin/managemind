// Our areas against each courier's places (phase-7-plan §3.6): the platform's
// match, or the place staff pick at booking. Steadfast reads the address and
// needs neither.
import type { CourierPlace } from '@managemind/providers/couriers';
import { AppError } from '@managemind/shared';
import type { AreaCourier, CourierPlaceInput } from '@managemind/shared/orders';
import { sql } from 'drizzle-orm';
import type { TenantTx } from '../tenant';

type PlaceRow = {
  kind: string;
  external_id: number;
  parent_id: number | null;
  name: string;
};

async function place(tx: TenantTx, courier: AreaCourier, kind: string, id: number) {
  const { rows } = await tx.db.execute<PlaceRow>(sql`
    select kind, external_id, parent_id, name from ref.courier_areas
     where courier = ${courier} and kind = ${kind} and external_id = ${id} and active`);
  return rows[0] ?? null;
}

function invalidPlace(message: string): AppError {
  return new AppError('validation_failed', {
    fields: [{ path: 'place', code: 'invalid', message }],
  });
}

/**
 * The courier's place for one of our areas: what staff picked, checked
 * against the courier's list, or the platform's match. Null when neither.
 */
export async function resolvePlace(
  tx: TenantTx,
  courier: AreaCourier,
  areaId: number,
  picked: CourierPlaceInput | null,
): Promise<CourierPlace | null> {
  if (picked) {
    if (courier === 'pathao') {
      if (!picked.zoneId) throw invalidPlace('pick a Pathao zone');
      const zone = await place(tx, courier, 'zone', picked.zoneId);
      if (!zone) throw invalidPlace('not a Pathao zone');
      let areaName: string | null = null;
      if (picked.areaId) {
        const area = await place(tx, courier, 'area', picked.areaId);
        if (area?.parent_id !== zone.external_id) throw invalidPlace('not an area of that zone');
        areaName = area.name;
      }
      return {
        cityId: zone.parent_id ?? undefined,
        zoneId: zone.external_id,
        areaId: picked.areaId,
        name: areaName ? `${areaName}, ${zone.name}` : zone.name,
      };
    }
    if (!picked.areaId) throw invalidPlace('pick a RedX area');
    const area = await place(tx, courier, 'area', picked.areaId);
    if (!area) throw invalidPlace('not a RedX area');
    return { areaId: area.external_id, name: area.name };
  }
  const { rows } = await tx.db.execute<PlaceRow>(sql`
    select a.kind, a.external_id, a.parent_id, a.name
      from ref.courier_area_map m
      join ref.courier_areas a
        on a.courier = m.courier and a.kind = m.kind and a.external_id = m.external_id
     where m.area_id = ${areaId} and m.courier = ${courier} and a.active`);
  const row = rows[0];
  if (!row) return null;
  return courier === 'pathao'
    ? { cityId: row.parent_id ?? undefined, zoneId: row.external_id, name: row.name }
    : { areaId: row.external_id, name: row.name };
}

/** A courier's places by name, for the booking sheet's search (§3.4). */
export async function searchCourierPlaces(
  tx: TenantTx,
  courier: AreaCourier,
  q: string,
  limit = 20,
): Promise<
  {
    kind: string;
    externalId: number;
    parentId: number | null;
    name: string;
    parent: string | null;
  }[]
> {
  const term = q.trim().toLowerCase().slice(0, 60);
  const kind = courier === 'pathao' ? 'zone' : 'area';
  const { rows } = await tx.db.execute<{
    kind: string;
    external_id: number;
    parent_id: number | null;
    name: string;
    parent: string | null;
  }>(sql`
    select a.kind, a.external_id, a.parent_id, a.name,
           coalesce(p.name, a.district_name) as parent
      from ref.courier_areas a
      left join ref.courier_areas p
        on p.courier = a.courier and p.kind = 'city' and p.external_id = a.parent_id and a.kind = 'zone'
     where a.courier = ${courier} and a.kind = ${kind} and a.active
       and (${term} = '' or lower(a.name) like ${`%${term}%`} or lower(a.name) % ${term})
     order by (lower(a.name) = ${term}) desc, similarity(lower(a.name), ${term}) desc, a.name
     limit ${Math.min(50, Math.max(1, limit))}`);
  return rows.map((r) => ({
    kind: r.kind,
    externalId: r.external_id,
    parentId: r.parent_id,
    name: r.name,
    parent: r.parent,
  }));
}
